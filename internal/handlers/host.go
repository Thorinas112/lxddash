package handlers

import (
	"encoding/json"
	"net/http"
	"os/exec"
	"strconv"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"

	"lxddash/internal/services/alerts"
)

// HostTerminal upgrades the HTTP request to a WebSocket and bridges it
// to an interactive shell on the host machine. The browser sends
// terminal input as text/binary messages; the shell output is streamed
// back. A JSON control message {"type":"resize","cols":N,"rows":N}
// resizes the PTY.
func (h *Handlers) HostTerminal(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	// Spawn an interactive shell on the host attached to a PTY.
	shell := "/bin/bash"
	if _, err := exec.LookPath(shell); err != nil {
		shell = "/bin/sh"
	}
	cmd := exec.Command(shell, "-l")
	ptmx, err := pty.Start(cmd)
	if err != nil {
		_ = conn.WriteMessage(websocket.TextMessage, []byte("failed to start shell: "+err.Error()))
		return
	}
	defer func() {
		_ = ptmx.Close()
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	}()

	// PTY -> WebSocket
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := ptmx.Read(buf)
			if n > 0 {
				if werr := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); werr != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()

	// WebSocket -> PTY, handling resize control messages.
	for {
		mt, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		if mt == websocket.TextMessage {
			var msg struct {
				Type string `json:"type"`
				Cols int    `json:"cols"`
				Rows int    `json:"rows"`
			}
			if err := json.Unmarshal(data, &msg); err == nil && msg.Type == "resize" {
				_ = pty.Setsize(ptmx, &pty.Winsize{Rows: uint16(msg.Rows), Cols: uint16(msg.Cols)})
				continue
			}
			// Not a control message → terminal input.
			if _, werr := ptmx.Write(data); werr != nil {
				return
			}
			continue
		}
		if mt == websocket.BinaryMessage {
			if _, werr := ptmx.Write(data); werr != nil {
				return
			}
		}
	}
}

// HostPower reboots or shuts down the host machine.
func (h *Handlers) HostPower(w http.ResponseWriter, r *http.Request) {
	if h.deps.Systemd == nil {
		writeErr(w, http.StatusServiceUnavailable, "systemd unavailable")
		return
	}
	var req struct {
		Action string `json:"action"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.deps.Systemd.PowerAction(r.Context(), req.Action); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("host", "power", req.Action, "host power action", nil)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// HostLogs returns the last N lines of a systemd unit's journal.
func (h *Handlers) HostLogs(w http.ResponseWriter, r *http.Request) {
	if h.deps.Systemd == nil {
		writeErr(w, http.StatusServiceUnavailable, "systemd unavailable")
		return
	}
	unit := r.URL.Query().Get("unit")
	if unit == "" {
		writeErr(w, http.StatusBadRequest, "unit query param is required")
		return
	}
	lines, _ := strconv.Atoi(r.URL.Query().Get("lines"))
	out, err := h.deps.Systemd.Logs(r.Context(), unit, lines)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"logs": out})
}

// HostDisks returns per-mount usage and physical disk SMART health.
func (h *Handlers) HostDisks(w http.ResponseWriter, r *http.Request) {
	if h.deps.Host == nil {
		writeErr(w, http.StatusServiceUnavailable, "host service unavailable")
		return
	}
	mounts, disks, err := h.deps.Host.Disks(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"mounts": mounts, "disks": disks})
}

// AlertsGet returns the current alert thresholds.
func (h *Handlers) AlertsGet(w http.ResponseWriter, r *http.Request) {
	if h.deps.Alerts == nil {
		writeErr(w, http.StatusServiceUnavailable, "alerts service unavailable")
		return
	}
	writeJSON(w, http.StatusOK, h.deps.Alerts.Config())
}

// AlertsSet updates the alert thresholds.
func (h *Handlers) AlertsSet(w http.ResponseWriter, r *http.Request) {
	if h.deps.Alerts == nil {
		writeErr(w, http.StatusServiceUnavailable, "alerts service unavailable")
		return
	}
	var cfg struct {
		Enabled     bool    `json:"enabled"`
		CPUPercent  float64 `json:"cpu_percent"`
		MemPercent  float64 `json:"mem_percent"`
		DiskPercent float64 `json:"disk_percent"`
		Interval    int     `json:"interval"`
	}
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.deps.Alerts.SetConfig(alertsConfig(cfg)); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// alertsConfig converts the wire struct to the alerts service config.
func alertsConfig(cfg struct {
	Enabled     bool    `json:"enabled"`
	CPUPercent  float64 `json:"cpu_percent"`
	MemPercent  float64 `json:"mem_percent"`
	DiskPercent float64 `json:"disk_percent"`
	Interval    int     `json:"interval"`
}) alerts.Config {
	return alerts.Config{
		Enabled:     cfg.Enabled,
		CPUPercent:  cfg.CPUPercent,
		MemPercent:  cfg.MemPercent,
		DiskPercent: cfg.DiskPercent,
		Interval:    cfg.Interval,
	}
}