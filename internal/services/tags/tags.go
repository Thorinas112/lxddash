package tags

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

// Store persists key-value tags for Docker containers and VMs.
// Tags are keyed by resource ID (container ID or VM UUID).
type Store struct {
	mu   sync.RWMutex
	file string
	data map[string][]string // id → tags
}

func New(dataDir string) *Store {
	s := &Store{
		file: filepath.Join(dataDir, "tags.json"),
		data: make(map[string][]string),
	}
	s.load()
	return s
}

func (s *Store) load() {
	raw, err := os.ReadFile(s.file)
	if err != nil {
		return
	}
	_ = json.Unmarshal(raw, &s.data)
}

func (s *Store) save() {
	raw, _ := json.MarshalIndent(s.data, "", "  ")
	_ = os.WriteFile(s.file, raw, 0644)
}

// Get returns tags for a resource.
func (s *Store) Get(id string) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.data[id]
}

// Set replaces tags for a resource.
func (s *Store) Set(id string, tags []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(tags) == 0 {
		delete(s.data, id)
	} else {
		s.data[id] = tags
	}
	s.save()
}

// All returns all stored tags keyed by resource ID.
func (s *Store) All() map[string][]string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string][]string, len(s.data))
	for k, v := range s.data {
		out[k] = v
	}
	return out
}
