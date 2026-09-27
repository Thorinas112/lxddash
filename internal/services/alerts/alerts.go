package alerts

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"

	"lxddash/internal/services/host"
	"lxddash/internal/services/notify"
)

// Config holds the alert thresholds (percentages).
type Config struct {
	Enabled    bool    `json:"enabled"`
	CPUPercent float64 `json:"cpu_percent"`  // 0 = disabled
	MemPercent float64 `json:"mem_percent"`  // 0 = disabled
	DiskPercent float64 `json:"disk_percent"` // 0 = disabled
	Interval   int     `json:"interval"`     // seconds between checks
}

// DefaultConfig returns sensible defaults (all disabled).
func DefaultConfig() Config {
	return Config{Interval: 60}
}

// Service periodically checks host resource usage and sends webhook
// notifications when a threshold is exceeded. Each alert type has a
// cooldown so it only fires once per breach.
type Service struct {
	host   *host.Service
	notify *notify.Service
	path   string

	mu     sync.Mutex
	cfg    Config
	active map[string]bool // alert key -> currently breaching
	stop   chan struct{}
}

func New(h *host.Service, n *notify.Service, dataDir string) *Service {
	s := &Service{
		host:   h,
		notify: n,
		path:   dataDir + "/alerts.json",
		cfg:    DefaultConfig(),
		active: map[string]bool{},
		stop:   make(chan struct{}),
	}
	s.Load()
	go s.run()
	return s
}

func (s *Service) Close() { close(s.stop) }

// Config returns the current configuration.
func (s *Service) Config() Config {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cfg
}

// SetConfig updates thresholds and persists them.
func (s *Service) SetConfig(cfg Config) error {
	s.mu.Lock()
	s.cfg = cfg
	data, _ := json.Marshal(cfg)
	s.mu.Unlock()
	return os.WriteFile(s.path, data, 0o600)
}

// Load restores the persisted configuration.
func (s *Service) Load() {
	data, err := os.ReadFile(s.path)
	if err != nil {
		return
	}
	var cfg Config
	if json.Unmarshal(data, &cfg) == nil {
		s.mu.Lock()
		s.cfg = cfg
		s.mu.Unlock()
	}
}

func (s *Service) run() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-s.stop:
			return
		case <-ticker.C:
			s.check()
		}
	}
}

func (s *Service) check() {
	s.mu.Lock()
	cfg := s.cfg
	s.mu.Unlock()
	if !cfg.Enabled || s.host == nil || s.notify == nil {
		return
	}
	interval := time.Duration(cfg.Interval) * time.Second
	if interval <= 0 {
		interval = 60 * time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	st, err := s.host.Stats(ctx)
	if err != nil {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// CPU
	if cfg.CPUPercent > 0 {
		s.eval("cpu", st.CPUPercent, cfg.CPUPercent, interval,
			"High CPU usage", "Host CPU is at %.1f%% (threshold %.0f%%)", st.CPUPercent, cfg.CPUPercent)
	}
	// Memory
	if cfg.MemPercent > 0 {
		s.eval("mem", st.MemPercent, cfg.MemPercent, interval,
			"High memory usage", "Host memory is at %.1f%% (threshold %.0f%%)", st.MemPercent, cfg.MemPercent)
	}
	// Disk
	if cfg.DiskPercent > 0 {
		s.eval("disk", st.DiskPercent, cfg.DiskPercent, interval,
			"Disk almost full", "Host disk (/) is at %.1f%% (threshold %.0f%%)", st.DiskPercent, cfg.DiskPercent)
	}
}

// eval checks one metric and fires a notification when it crosses the
// threshold, with a cooldown so it doesn't spam.
func (s *Service) eval(key string, value, threshold float64, cooldown time.Duration, title, format string, args ...any) {
	breaching := value >= threshold
	if breaching && !s.active[key] {
		s.active[key] = true
		s.notify.Send(notify.Event{
			Type:      "alert_" + key,
			Title:     title,
			Message:   sprintf(format, args...),
			Timestamp: time.Now(),
		})
		// Reset after the cooldown so a sustained breach re-fires.
		go func(k string, d time.Duration) {
			time.Sleep(d)
			s.mu.Lock()
			s.active[k] = false
			s.mu.Unlock()
		}(key, cooldown)
	} else if !breaching {
		s.active[key] = false
	}
}

func sprintf(format string, args ...any) string {
	return fmt.Sprintf(format, args...)
}