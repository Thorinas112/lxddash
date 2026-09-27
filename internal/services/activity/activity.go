package activity

import (
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

// Service keeps an in-memory ring buffer of recent activity.
type Service struct {
	mu      sync.Mutex
	entries []Entry
	nextID  int64
	max     int
}

func New(max int) *Service {
	if max <= 0 {
		max = 500
	}
	return &Service{max: max}
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