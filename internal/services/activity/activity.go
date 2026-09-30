package activity

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Entry is a single activity log entry.
type Entry struct {
	ID        int64     `json:"id"`
	Time      time.Time `json:"time"`
	Category  string    `json:"category"` // docker | lxd | vm | proxmox | llm | system
	Action    string    `json:"action"`   // e.g. "create", "start", "stop", "import"
	Target    string    `json:"target"`   // e.g. container name, VM uuid
	Message   string    `json:"message"`
	Status    string    `json:"status"` // ok | error
}

// Service keeps a ring buffer of recent activity, persisted to
// dataDir/activity.json so the log survives server restarts.
type Service struct {
	mu      sync.Mutex
	entries []Entry
	nextID  int64
	max     int
	path    string
}

func New(max int, dataDir string) *Service {
	if max <= 0 {
		max = 500
	}
	s := &Service{max: max}
	if dataDir != "" {
		s.path = filepath.Join(dataDir, "activity.json")
		s.load()
	}
	return s
}

// persisted is the on-disk JSON shape.
type persisted struct {
	NextID int64   `json:"next_id"`
	Items  []Entry `json:"items"`
}

// load restores the buffer from disk (best-effort).
func (s *Service) load() {
	data, err := os.ReadFile(s.path)
	if err != nil {
		return
	}
	var p persisted
	if json.Unmarshal(data, &p) != nil {
		return
	}
	s.entries = p.Items
	s.nextID = p.NextID
	if s.nextID == 0 {
		for _, e := range s.entries {
			if e.ID > s.nextID {
				s.nextID = e.ID
			}
		}
	}
	if len(s.entries) > s.max {
		s.entries = s.entries[len(s.entries)-s.max:]
	}
}

// saveLocked writes the buffer to disk. Caller must hold s.mu.
func (s *Service) saveLocked() {
	if s.path == "" {
		return
	}
	data, err := json.MarshalIndent(persisted{NextID: s.nextID, Items: s.entries}, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(s.path, data, 0o600)
}

// Log appends an entry, trimming the oldest when over capacity.
func (s *Service) Log(category, action, target, message, status string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.nextID++
	s.entries = append(s.entries, Entry{
		ID:       s.nextID,
		Time:     time.Now(),
		Category: category,
		Action:   action,
		Target:   target,
		Message:  message,
		Status:   status,
	})
	if len(s.entries) > s.max {
		s.entries = s.entries[len(s.entries)-s.max:]
	}
	s.saveLocked()
}

// List returns entries, newest first, optionally filtered by category.
func (s *Service) List(category string, limit int) []Entry {
	s.mu.Lock()
	defer s.mu.Unlock()
	if limit <= 0 || limit > s.max {
		limit = s.max
	}
	out := make([]Entry, 0, limit)
	for i := len(s.entries) - 1; i >= 0 && len(out) < limit; i-- {
		e := s.entries[i]
		if category != "" && e.Category != category {
			continue
		}
		out = append(out, e)
	}
	return out
}