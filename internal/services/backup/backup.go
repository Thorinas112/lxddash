package backup

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"lxddash/internal/services/lxd"
)

// Job describes a scheduled backup job.
type Job struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Instance   string   `json:"instance"` // LXD instance name
	Schedule   string   `json:"schedule"` // "daily" | "weekly" | "hourly"
	Retention  int      `json:"retention"` // number of backups to keep
	Enabled    bool     `json:"enabled"`
	Running    bool     `json:"running"` // true while a backup is in progress
	LastRun    *time.Time `json:"last_run,omitempty"`
	LastStatus string   `json:"last_status,omitempty"` // ok | error
	LastError  string   `json:"last_error,omitempty"`
}

// Service schedules and runs LXD instance backups.
type Service struct {
	lxd     *lxd.Service
	dataDir string
	mu      sync.Mutex
	jobs    []*Job
	stop    chan struct{}

	// OnResult is called after each backup attempt (ok or error).
	OnResult func(jobName string, ok bool, detail string)
}

func New(lxdSvc *lxd.Service, dataDir string) *Service {
	s := &Service{
		lxd:     lxdSvc,
		dataDir: dataDir,
		stop:    make(chan struct{}),
	}
	s.load()
	go s.run()
	return s
}

func (s *Service) Close() {
	close(s.stop)
}

func (s *Service) jobsPath() string {
	return filepath.Join(s.dataDir, "backup-jobs.json")
}

func (s *Service) load() {
	data, err := os.ReadFile(s.jobsPath())
	if err != nil {
		return
	}
	_ = json.Unmarshal(data, &s.jobs)
}

func (s *Service) save() {
	data, _ := json.MarshalIndent(s.jobs, "", "  ")
	_ = os.WriteFile(s.jobsPath(), data, 0o644)
}

// List returns all jobs.
func (s *Service) List() []*Job {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*Job, len(s.jobs))
	copy(out, s.jobs)
	return out
}

// Create adds a new job.
func (s *Service) Create(job Job) (*Job, error) {
	if job.Instance == "" {
		return nil, fmt.Errorf("instance is required")
	}
	switch job.Schedule {
	case "hourly", "daily", "weekly":
	default:
		return nil, fmt.Errorf("schedule must be hourly, daily or weekly")
	}
	if job.Retention <= 0 {
		job.Retention = 3
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	job.ID = fmt.Sprintf("job-%d", time.Now().UnixNano())
	job.Enabled = true
	s.jobs = append(s.jobs, &job)
	s.save()
	return &job, nil
}

// Delete removes a job.
func (s *Service) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, j := range s.jobs {
		if j.ID == id {
			s.jobs = append(s.jobs[:i], s.jobs[i+1:]...)
			s.save()
			return nil
		}
	}
	return fmt.Errorf("job not found")
}

// SetEnabled toggles a job.
func (s *Service) SetEnabled(id string, enabled bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, j := range s.jobs {
		if j.ID == id {
			j.Enabled = enabled
			s.save()
			return nil
		}
	}
	return fmt.Errorf("job not found")
}

// RunNow starts a job immediately (async — returns right away so the
// UI can show the running state).
func (s *Service) RunNow(id string) error {
	s.mu.Lock()
	var job *Job
	for _, j := range s.jobs {
		if j.ID == id {
			job = j
			break
		}
	}
	s.mu.Unlock()
	if job == nil {
		return fmt.Errorf("job not found")
	}
	if job.Running {
		return fmt.Errorf("job is already running")
	}
	go s.execute(job)
	return nil
}

// run is the scheduler loop.
func (s *Service) run() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-s.stop:
			return
		case now := <-ticker.C:
			s.mu.Lock()
			jobs := make([]*Job, len(s.jobs))
			copy(jobs, s.jobs)
			s.mu.Unlock()
			for _, j := range jobs {
				if !j.Enabled {
					continue
				}
				if j.LastRun != nil && !due(j.Schedule, *j.LastRun, now) {
					continue
				}
				go s.execute(j)
			}
		}
	}
}

func due(schedule string, last time.Time, now time.Time) bool {
	switch schedule {
	case "hourly":
		return now.Sub(last) >= time.Hour
	case "daily":
		return now.Sub(last) >= 24*time.Hour
	case "weekly":
		return now.Sub(last) >= 7*24*time.Hour
	}
	return false
}

// execute runs a backup for the job's instance.
func (s *Service) execute(job *Job) {
	s.setRunning(job, true)
	defer s.setRunning(job, false)

	if s.lxd == nil {
		s.mark(job, "error", "LXD service unavailable")
		s.notify(job, false, "LXD service unavailable")
		return
	}
	now := time.Now()
	name := fmt.Sprintf("auto-%s-%s", job.Schedule, now.Format("20060102-150405"))
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	if err := s.lxd.CreateBackup(ctx, job.Instance, name); err != nil {
		s.mark(job, "error", err.Error())
		s.notify(job, false, err.Error())
		return
	}
	s.mark(job, "ok", "")
	s.notify(job, true, name)

	// Retention: delete oldest backups beyond the limit.
	ctx2, cancel2 := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel2()
	backups, err := s.lxd.Backups(ctx2, job.Instance)
	if err == nil && len(backups) > job.Retention {
		// Backups are returned newest-first; delete the tail.
		for _, b := range backups[job.Retention:] {
			_ = s.lxd.DeleteBackup(ctx2, job.Instance, b.Name)
		}
	}
}

// setRunning updates the running flag and persists it.
func (s *Service) setRunning(job *Job, running bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job.Running = running
	s.save()
}

func (s *Service) mark(job *Job, status, errMsg string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	job.LastRun = &now
	job.LastStatus = status
	job.LastError = errMsg
	s.save()
	log.Printf("backup job %s (%s): %s %s", job.ID, job.Instance, status, errMsg)
}

func (s *Service) notify(job *Job, ok bool, detail string) {
	if s.OnResult != nil {
		s.OnResult(job.Name, ok, detail)
	}
}