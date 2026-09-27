package forward

import (
	"encoding/json"
	"io"
	"net"
	"os"
	"sync"
	"time"
)

// Rule is a single port-forward rule: host:Port -> Target.
type Rule struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Port   int    `json:"port"`
	Target string `json:"target"` // e.g. "10.9.48.75:22"
	Proto  string `json:"proto"`  // "tcp" (only tcp for now)
}

// Service manages TCP port forwards. Each rule opens a listener on
// the host and proxies connections to the target (e.g. a container's
// SSH port). Rules are persisted to the data dir.
type Service struct {
	path string
	mu   sync.Mutex
	rules map[string]*Rule
	lns   map[string]net.Listener
	stop  chan struct{}
}

func New(dataDir string) *Service {
	s := &Service{
		path:  dataDir + "/port-forwards.json",
		rules: map[string]*Rule{},
		lns:   map[string]net.Listener{},
		stop:  make(chan struct{}),
	}
	s.load()
	s.startAll()
	return s
}

func (s *Service) Close() {
	close(s.stop)
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, ln := range s.lns {
		_ = ln.Close()
		delete(s.lns, id)
	}
}

func (s *Service) load() {
	data, err := os.ReadFile(s.path)
	if err != nil {
		return
	}
	var rules []Rule
	if json.Unmarshal(data, &rules) != nil {
		return
	}
	for i := range rules {
		r := rules[i]
		if r.ID == "" {
			r.ID = ruleID(r.Port)
		}
		s.rules[r.ID] = &r
	}
}

func (s *Service) save() {
	s.mu.Lock()
	rules := make([]Rule, 0, len(s.rules))
	for _, r := range s.rules {
		rules = append(rules, *r)
	}
	s.mu.Unlock()
	data, _ := json.MarshalIndent(rules, "", "  ")
	_ = os.WriteFile(s.path, data, 0o600)
}

// saveLocked persists rules. Caller must hold s.mu.
func (s *Service) saveLocked() {
	rules := make([]Rule, 0, len(s.rules))
	for _, r := range s.rules {
		rules = append(rules, *r)
	}
	data, _ := json.MarshalIndent(rules, "", "  ")
	_ = os.WriteFile(s.path, data, 0o600)
}

func ruleID(port int) string {
	return "fwd-" + itoa(port)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}

// List returns all rules.
func (s *Service) List() []Rule {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Rule, 0, len(s.rules))
	for _, r := range s.rules {
		out = append(out, *r)
	}
	return out
}

// Add creates a rule and starts its listener.
func (s *Service) Add(name string, port int, target string) (*Rule, error) {
	if port <= 0 || port > 65535 {
		return nil, errInvalid("port must be 1-65535")
	}
	if target == "" {
		return nil, errInvalid("target is required (e.g. 10.9.48.75:22)")
	}
	if _, _, err := net.SplitHostPort(target); err != nil {
		return nil, errInvalid("target must be host:port (e.g. 10.9.48.75:22)")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range s.rules {
		if r.Port == port {
			return nil, errInvalid("port already forwarded")
		}
	}
	r := &Rule{ID: ruleID(port), Name: name, Port: port, Target: target, Proto: "tcp"}
	if err := s.startLocked(r); err != nil {
		return nil, err
	}
	s.rules[r.ID] = r
	s.saveLocked()
	return r, nil
}

// Remove stops and deletes a rule.
func (s *Service) Remove(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.rules[id]
	if !ok {
		return errInvalid("rule not found")
	}
	if ln, ok := s.lns[id]; ok {
		_ = ln.Close()
		delete(s.lns, id)
	}
	delete(s.rules, id)
	s.saveLocked()
	_ = r
	return nil
}

func (s *Service) startAll() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range s.rules {
		_ = s.startLocked(r)
	}
}

// startLocked opens the listener for a rule. Caller must hold s.mu.
func (s *Service) startLocked(r *Rule) error {
	ln, err := net.Listen("tcp", ":"+itoa(r.Port))
	if err != nil {
		return err
	}
	s.lns[r.ID] = ln
	go s.acceptLoop(r.ID, ln)
	return nil
}

func (s *Service) acceptLoop(id string, ln net.Listener) {
	for {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		go s.proxy(conn, id)
	}
}

func (s *Service) proxy(client net.Conn, id string) {
	defer client.Close()
	s.mu.Lock()
	r, ok := s.rules[id]
	s.mu.Unlock()
	if !ok {
		return
	}
	upstream, err := net.DialTimeout("tcp", r.Target, 10*time.Second)
	if err != nil {
		return
	}
	defer upstream.Close()
	done := make(chan struct{}, 2)
	go func() {
		_, _ = io.Copy(upstream, client)
		done <- struct{}{}
	}()
	go func() {
		_, _ = io.Copy(client, upstream)
		done <- struct{}{}
	}()
	<-done
	_ = client.(*net.TCPConn).CloseWrite()
	<-done
}

type ruleError struct{ msg string }

func (e ruleError) Error() string { return e.msg }

func errInvalid(msg string) error { return ruleError{msg: msg} }