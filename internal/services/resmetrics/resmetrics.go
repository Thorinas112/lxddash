package resmetrics

import (
	"context"
	"encoding/json"
	"os"
	"strconv"
	"sync"
	"time"

	"lxddash/internal/services/docker"
	"lxddash/internal/services/libvirt"
	"lxddash/internal/services/lxd"
)

// Sample is one point in a resource's history.
type Sample struct {
	Time       time.Time `json:"time"`
	CPUUsage   uint64    `json:"cpu_usage"`   // cumulative CPU time in ns
	CPUPercent float64   `json:"cpu_percent"` // computed from delta at sample time
	MemUsage   uint64    `json:"mem_usage"`
	MemLimit   uint64    `json:"mem_limit"`
	Status     string    `json:"status"`
	CPUs       int       `json:"cpus"`
}

// Resource is a monitored container/instance/VM with its history.
type Resource struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Kind    string   `json:"kind"` // "docker" | "lxd" | "vm"
	Samples []Sample `json:"samples"`
}

// Service periodically samples Docker containers, LXD instances and
// VMs and keeps a rolling 24h history per resource. History is
// persisted to disk so it survives restarts.
type Service struct {
	docker  *docker.Service
	lxd     *lxd.Service
	libvirt *libvirt.Service
	path    string

	mu      sync.Mutex
	res     map[string]*Resource
	max     int // max samples per resource (24h at 10s = 8640)
	prevCpu map[string]prevCpuSample
	stop    chan struct{}
}

type prevCpuSample struct {
	usage uint64
	t     time.Time
	cpus  int
}

func New(d *docker.Service, l *lxd.Service, v *libvirt.Service, dataDir string) *Service {
	s := &Service{
		docker:  d,
		lxd:     l,
		libvirt: v,
		path:    dataDir + "/resmetrics.json",
		res:     map[string]*Resource{},
		max:     8640, // 24h at 10s intervals
		prevCpu: map[string]prevCpuSample{},
		stop:    make(chan struct{}),
	}
	s.Load()
	go s.run()
	return s
}

func (s *Service) Close() {
	close(s.stop)
	s.Save()
}

func (s *Service) run() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	saveTicker := time.NewTicker(60 * time.Second)
	defer saveTicker.Stop()
	for {
		select {
		case <-s.stop:
			return
		case <-ticker.C:
			s.sample()
		case <-saveTicker.C:
			s.Save()
		}
	}
}

// Load restores persisted history from disk (best-effort).
func (s *Service) Load() {
	data, err := os.ReadFile(s.path)
	if err != nil {
		return
	}
	var res []Resource
	if json.Unmarshal(data, &res) != nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	cutoff := time.Now().Add(-24 * time.Hour)
	for _, r := range res {
		if r.ID == "" {
			continue
		}
		// Drop samples older than 24h.
		start := 0
		for i, sm := range r.Samples {
			if sm.Time.After(cutoff) {
				start = i
				break
			}
		}
		r.Samples = r.Samples[start:]
		if len(r.Samples) > s.max {
			r.Samples = r.Samples[len(r.Samples)-s.max:]
		}
		s.res[r.ID] = &r
	}
}

// Save persists all history to disk (best-effort).
func (s *Service) Save() {
	s.mu.Lock()
	res := make([]Resource, 0, len(s.res))
	for _, r := range s.res {
		res = append(res, *r)
	}
	s.mu.Unlock()
	data, err := json.Marshal(res)
	if err != nil {
		return
	}
	_ = os.WriteFile(s.path, data, 0o600)
}

func (s *Service) sample() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	now := time.Now()

	s.mu.Lock()
	defer s.mu.Unlock()

	// Docker containers.
	if s.docker != nil {
		if stats, err := s.docker.Stats(ctx); err == nil {
			for _, st := range stats {
				s.push("docker", st.ID, st.Name, Sample{
					Time:       now,
					CPUUsage:   st.CPUUsage,
					CPUPercent: st.CPUPercent,
					MemUsage:   st.MemUsage,
					MemLimit:   st.MemLimit,
					Status:     "running",
					CPUs:       0,
				})
			}
		}
	}

	// LXD instances.
	if s.lxd != nil {
		if insts, err := s.lxd.Instances(ctx); err == nil {
			for _, inst := range insts {
				if inst.Status != "Running" {
					continue
				}
				st, _, err := s.lxd.InstanceState(ctx, inst.Name)
				if err != nil {
					continue
				}
				cpus := 1
				if v, err := strconv.Atoi(inst.Config["limits.cpu"]); err == nil && v > 0 {
					cpus = v
				}
				usage := uint64(0)
				if st.CPU.Usage > 0 {
					usage = uint64(st.CPU.Usage)
				}
				memUsage, memLimit := uint64(0), uint64(0)
				if st.Memory.Usage > 0 {
					memUsage = uint64(st.Memory.Usage)
				}
				if st.Memory.Total > 0 {
					memLimit = uint64(st.Memory.Total)
				}
				s.push("lxd", inst.Name, inst.Name, Sample{
					Time:       now,
					CPUUsage:   usage,
					CPUPercent: s.cpuPercent("lxd:"+inst.Name, usage, now, cpus),
					MemUsage:   memUsage,
					MemLimit:   memLimit,
					Status:     inst.Status,
					CPUs:       cpus,
				})
			}
		}
	}

	// VMs.
	if s.libvirt != nil {
		if stats, err := s.libvirt.Stats(ctx); err == nil {
			for _, st := range stats {
				s.push("vm", st.UUID, st.Name, Sample{
					Time:       now,
					CPUUsage:   st.CPUTime,
					CPUPercent: s.cpuPercent("vm:"+st.UUID, st.CPUTime, now, int(st.VCPUs)),
					MemUsage:   st.MemUsage,
					MemLimit:   st.MemLimit,
					Status:     st.State,
					CPUs:       int(st.VCPUs),
				})
			}
		}
	}
}

// cpuPercent computes the CPU percentage from the delta between the
// previous sample and now (cumulative ns -> % of wall time / cpus).
func (s *Service) cpuPercent(key string, usage uint64, now time.Time, cpus int) float64 {
	if cpus <= 0 {
		cpus = 1
	}
	prev, ok := s.prevCpu[key]
	s.prevCpu[key] = prevCpuSample{usage: usage, t: now, cpus: cpus}
	if !ok || usage < prev.usage || now.Sub(prev.t) <= 0 {
		return 0
	}
	wall := now.Sub(prev.t).Seconds()
	if wall <= 0 {
		return 0
	}
	cpuDelta := float64(usage-prev.usage) / 1e9
	return cpuDelta / wall * 100 / float64(cpus)
}

// push appends a sample to a resource's history, creating the
// resource if needed and trimming to the ring buffer size.
func (s *Service) push(kind, id, name string, sm Sample) {
	r, ok := s.res[id]
	if !ok {
		r = &Resource{ID: id, Name: name, Kind: kind}
		s.res[id] = r
	}
	r.Name = name
	r.Samples = append(r.Samples, sm)
	if len(r.Samples) > s.max {
		r.Samples = r.Samples[len(r.Samples)-s.max:]
	}
}

// Series returns all resources with samples within the given window.
func (s *Service) Series(duration time.Duration) []Resource {
	s.mu.Lock()
	defer s.mu.Unlock()
	if duration <= 0 {
		duration = 24 * time.Hour
	}
	cutoff := time.Now().Add(-duration)
	out := make([]Resource, 0, len(s.res))
	for _, r := range s.res {
		// Keep only samples in the window.
		start := 0
		for i, sm := range r.Samples {
			if sm.Time.After(cutoff) {
				start = i
				break
			}
		}
		cp := *r
		cp.Samples = r.Samples[start:]
		out = append(out, cp)
	}
	return out
}