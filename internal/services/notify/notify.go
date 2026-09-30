package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"
)

// Event is a notification payload sent to webhooks.
type Event struct {
	Type      string    `json:"type"`      // backup_done, backup_failed, vm_down, etc
	Title     string    `json:"title"`     // short title
	Message   string    `json:"message"`   // detail
	Timestamp time.Time `json:"timestamp"` // when it happened
}

// Service sends webhook notifications. The URL can be changed at runtime
// (persisted to the data dir).
type Service struct {
	url  string
	path string
	cli  *http.Client
}

func New(dataDir string) *Service {
	return &Service{
		path: dataDir + "/webhook.json",
		cli:  &http.Client{Timeout: 10 * time.Second},
	}
}

// SetURL updates the webhook URL and persists it.
func (s *Service) SetURL(url string) error {
	s.url = url
	data, _ := json.Marshal(map[string]string{"url": url})
	return writeFile(s.path, data)
}

// URL returns the current webhook URL.
func (s *Service) URL() string { return s.url }

// Load restores the persisted webhook URL.
func (s *Service) Load() {
	data, err := readFile(s.path)
	if err != nil {
		return
	}
	var m map[string]string
	if json.Unmarshal(data, &m) == nil {
		s.url = m["url"]
	}
}

// Send posts an event to the webhook (fire-and-forget).
func (s *Service) Send(ev Event) {
	if s.url == "" {
		return
	}
	body, _ := json.Marshal(ev)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.url, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.cli.Do(req)
	if err != nil {
		return
	}
	_ = resp.Body.Close()
}

// NotifyBackup sends a backup completion/failure notification.
func (s *Service) NotifyBackup(ok bool, jobName, detail string) {
	ev := Event{Timestamp: time.Now()}
	if ok {
		ev.Type = "backup_done"
		ev.Title = "Backup completed"
		ev.Message = "Backup job \"" + jobName + "\" finished" + suffix(detail)
	} else {
		ev.Type = "backup_failed"
		ev.Title = "Backup failed"
		ev.Message = "Backup job \"" + jobName + "\" failed" + suffix(detail)
	}
	s.Send(ev)
}

// NotifyVM sends a VM state notification.
func (s *Service) NotifyVM(name, state string) {
	s.Send(Event{
		Type:      "vm_state",
		Title:     "VM " + state,
		Message:   "VM \"" + name + "\" is now " + state,
		Timestamp: time.Now(),
	})
}

// NotifyLXD sends an LXD instance lifecycle notification.
func (s *Service) NotifyLXD(name, action string) {
	s.Send(Event{
		Type:      "lxd_" + action,
		Title:     "LXD " + action,
		Message:   "Instance \"" + name + "\" was " + action,
		Timestamp: time.Now(),
	})
}

// NotifyDocker sends a Docker container lifecycle notification.
func (s *Service) NotifyDocker(name, action string) {
	s.Send(Event{
		Type:      "docker_" + action,
		Title:     "Docker " + action,
		Message:   "Container \"" + name + "\" was " + action,
		Timestamp: time.Now(),
	})
}

// NotifyAlert sends a threshold alert notification.
func (s *Service) NotifyAlert(metric string, value float64, threshold float64) {
	s.Send(Event{
		Type:      "alert",
		Title:     "Threshold alert",
		Message:   fmt.Sprintf("%s at %.1f%% (threshold: %.1f%%)", metric, value, threshold),
		Timestamp: time.Now(),
	})
}

func suffix(detail string) string {
	if detail == "" {
		return ""
	}
	return ": " + detail
}

func writeFile(path string, data []byte) error {
	return os.WriteFile(path, data, 0o600)
}

func readFile(path string) ([]byte, error) {
	return os.ReadFile(path)
}
