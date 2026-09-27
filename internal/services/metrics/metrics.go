package metrics

import (
	"context"
	"sync"
	"time"

	"lxddash/internal/services/host"
)

// Sample is a single metrics snapshot.
type Sample struct {
	Time        time.Time       `json:"time"`
	CPUPercent  float64         `json:"cpu_percent"`
	MemUsed     uint64          `json:"mem_used"`
	MemTotal    uint64          `json:"mem_total"`
	MemPercent  float64         `json:"mem_percent"`
	DiskUsed    uint64          `json:"disk_used"`
	DiskTotal   uint64          `json:"disk_total"`
	DiskPercent float64         `json:"disk_percent"`
	NetRx       uint64          `json:"net_rx"`
	NetTx       uint64          `json:"net_tx"`
	NetIfaces   []host.NetIface `json:"net_ifaces"`
	GPUs        []host.GPUInfo  `json:"gpus"`
}

// Service samples host metrics periodically and keeps a ring buffer.
type Service struct {
	host    *host.Service
	mu      sync.Mutex
	samples []Sample
	max     int
	stop    chan struct{}
}

func New(h *host.Service, max int) *Service {
	if max <= 0 {
		max = 1440 // 4 hours at 10s intervals
	}
	s := &Service{host: h, max: max, stop: make(chan struct{})}
	go s.run()
	return s
}

func (s *Service) Close() {
	close(s.stop)
}

func (s *Service) run() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-s.stop:
			return
		case <-ticker.C:
			s.sample()
		}
	}
}

func (s *Service) sample() {
	if s.host == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	st, err := s.host.Stats(ctx)
	if err != nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.samples = append(s.samples, Sample{
		Time:       st.Timestamp,
		CPUPercent: st.CPUPercent,
		MemUsed:    st.MemUsed,
		MemTotal:   st.MemTotal,
		MemPercent: st.MemPercent,
		DiskUsed:   st.DiskUsed,
		DiskTotal:  st.DiskTotal,
		DiskPercent: st.DiskPercent,
		NetRx:      st.NetRx,
		NetTx:      st.NetTx,
		NetIfaces:  st.NetIfaces,
		GPUs:       st.GPUs,
	})
	if len(s.samples) > s.max {
		s.samples = s.samples[len(s.samples)-s.max:]
	}
}

// Series returns samples within the given duration (e.g. 1h, 24h).
func (s *Service) Series(duration time.Duration) []Sample {
	s.mu.Lock()
	defer s.mu.Unlock()
	if duration <= 0 {
		duration = time.Hour
	}
	cutoff := time.Now().Add(-duration)
	out := make([]Sample, 0, len(s.samples))
	for _, sm := range s.samples {
		if sm.Time.After(cutoff) {
			out = append(out, sm)
		}
	}
	return out
}