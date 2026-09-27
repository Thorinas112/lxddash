package systemd

import (
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// ServiceInfo describes a systemd unit.
type ServiceInfo struct {
	Name      string `json:"name"`
	Load      string `json:"load"`
	Active    string `json:"active"`
	Sub       string `json:"sub"`
	Running   bool   `json:"running"`
	Enabled   bool   `json:"enabled"`
	Desc      string `json:"desc"`
	Uptime    string `json:"uptime,omitempty"`
	Memory    string `json:"memory,omitempty"`
	PID       string `json:"pid,omitempty"`
}

// Service manages host systemd units via systemctl.
type Service struct{}

func New() *Service { return &Service{} }

// Available reports whether systemctl exists on this host.
func (s *Service) Available() bool {
	_, err := exec.LookPath("systemctl")
	return err == nil
}

// List returns all units with their state.
func (s *Service) List(ctx context.Context) ([]ServiceInfo, error) {
	out, err := run(ctx, "systemctl", "list-units", "--type=service", "--all", "--no-pager", "--no-legend", "--plain")
	if err != nil {
		return nil, err
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	services := make([]ServiceInfo, 0, len(lines))
	for _, ln := range lines {
		fields := strings.Fields(ln)
		if len(fields) < 4 {
			continue
		}
		name := fields[0]
		if !strings.HasSuffix(name, ".service") {
			continue
		}
		svc := ServiceInfo{
			Name:   name,
			Load:   fields[1],
			Active: fields[2],
			Sub:    fields[3],
			Running: fields[2] == "active",
		}
		// Description is the rest of the line.
		rest := strings.TrimSpace(strings.TrimPrefix(ln, fields[0]+" "+fields[1]+" "+fields[2]+" "+fields[3]))
		svc.Desc = rest
		services = append(services, svc)
	}
	return services, nil
}

// Detail fills in enabled state, uptime, memory and PID for one service.
func (s *Service) Detail(ctx context.Context, name string) (ServiceInfo, error) {
	svc := ServiceInfo{Name: name}
	if out, err := run(ctx, "systemctl", "is-enabled", name); err == nil {
		svc.Enabled = strings.TrimSpace(out) == "enabled"
	}
	if out, err := run(ctx, "systemctl", "show", name, "-p", "ActiveState", "-p", "SubState", "-p", "Description", "-p", "MainPID", "-p", "MemoryCurrent", "-p", "ActiveEnterTimestamp"); err == nil {
		for _, ln := range strings.Split(strings.TrimSpace(out), "\n") {
			kv := strings.SplitN(ln, "=", 2)
			if len(kv) != 2 {
				continue
			}
			switch kv[0] {
			case "ActiveState":
				svc.Active = kv[1]
				svc.Running = kv[1] == "active"
			case "SubState":
				svc.Sub = kv[1]
			case "Description":
				svc.Desc = kv[1]
			case "MainPID":
				svc.PID = kv[1]
			case "MemoryCurrent":
				svc.Memory = kv[1]
			case "ActiveEnterTimestamp":
				if kv[1] != "" && kv[1] != "n/a" {
					if t, err := time.Parse("Mon 2006-01-02 15:04:05 MST", kv[1]); err == nil {
						svc.Uptime = time.Since(t).Truncate(time.Second).String()
					}
				}
			}
		}
	}
	return svc, nil
}

// Action runs start/stop/restart/enable/disable on a unit.
func (s *Service) Action(ctx context.Context, name, action string) error {
	_, err := run(ctx, "systemctl", action, name)
	return err
}

// PowerAction reboots or shuts down the host.
func (s *Service) PowerAction(ctx context.Context, action string) error {
	switch action {
	case "reboot", "poweroff":
	default:
		return fmt.Errorf("invalid power action %q", action)
	}
	_, err := run(ctx, "systemctl", action)
	return err
}

// Logs returns the last N lines of a unit's journal.
func (s *Service) Logs(ctx context.Context, unit string, lines int) (string, error) {
	if lines <= 0 {
		lines = 200
	}
	args := []string{"-u", unit, "-n", strconv.Itoa(lines), "--no-pager", "-o", "short-iso"}
	out, err := run(ctx, "journalctl", args...)
	if err != nil {
		// journalctl exits non-zero when the unit has no logs yet.
		if strings.TrimSpace(out) == "" {
			return "", err
		}
	}
	return out, nil
}

func run(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	out, err := cmd.CombinedOutput()
	return string(out), err
}