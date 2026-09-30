package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"

	"lxddash/internal/services/libvirt"
)

func (h *Handlers) VMs(w http.ResponseWriter, r *http.Request) {
	if h.deps.Libvirt == nil {
		writeErr(w, http.StatusServiceUnavailable, "libvirt service unavailable")
		return
	}
	domains, err := h.deps.Libvirt.Domains(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, domains)
}

// VMStats returns live CPU/memory usage for all VMs.
func (h *Handlers) VMStats(w http.ResponseWriter, r *http.Request) {
	if h.deps.Libvirt == nil {
		writeErr(w, http.StatusServiceUnavailable, "libvirt service unavailable")
		return
	}
	stats, err := h.deps.Libvirt.Stats(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

// VMCreate creates a new KVM/QEMU VM.
func (h *Handlers) VMCreate(w http.ResponseWriter, r *http.Request) {
	if h.deps.Libvirt == nil {
		writeErr(w, http.StatusServiceUnavailable, "libvirt service unavailable")
		return
	}
	var req libvirt.CreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	uuid, err := h.deps.Libvirt.CreateVM(r.Context(), req)
	if err != nil {
		h.logActivity("vm", "create", req.Name, "", err)
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("vm", "create", req.Name, "VM created", nil)
	writeJSON(w, http.StatusCreated, map[string]string{"uuid": uuid})
}

// VMISOs lists install ISOs available on the host.
func (h *Handlers) VMISOs(w http.ResponseWriter, r *http.Request) {
	if h.deps.Libvirt == nil {
		writeErr(w, http.StatusServiceUnavailable, "libvirt service unavailable")
		return
	}
	isos, err := h.deps.Libvirt.ListISOs()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, isos)
}

// VMISOUpload stores an uploaded ISO in the ISO directory.
func (h *Handlers) VMISOUpload(w http.ResponseWriter, r *http.Request) {
	if h.deps.Libvirt == nil {
		writeErr(w, http.StatusServiceUnavailable, "libvirt service unavailable")
		return
	}
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid multipart form")
		return
	}
	file, header, err := r.FormFile("iso")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "missing 'iso' file field")
		return
	}
	defer file.Close()

	name := filepath.Base(header.Filename)
	if !strings.HasSuffix(strings.ToLower(name), ".iso") {
		writeErr(w, http.StatusBadRequest, "only .iso files are accepted")
		return
	}
	dest := h.deps.Libvirt.ISOPath(name)
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out, err := os.Create(dest)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer out.Close()
	if _, err := io.Copy(out, file); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"name": name})
}

// VMISODelete removes an ISO from the ISO directory.
func (h *Handlers) VMISODelete(w http.ResponseWriter, r *http.Request) {
	if h.deps.Libvirt == nil {
		writeErr(w, http.StatusServiceUnavailable, "libvirt service unavailable")
		return
	}
	name := filepath.Base(r.PathValue("name"))
	if !strings.HasSuffix(strings.ToLower(name), ".iso") {
		writeErr(w, http.StatusBadRequest, "only .iso files are accepted")
		return
	}
	if err := os.Remove(h.deps.Libvirt.ISOPath(name)); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("vm", "iso-delete", name, "ISO deleted", nil)
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *Handlers) VM(w http.ResponseWriter, r *http.Request) {
	if h.deps.Libvirt == nil {
		writeErr(w, http.StatusServiceUnavailable, "libvirt service unavailable")
		return
	}
	uuid := r.PathValue("uuid")
	info, err := h.deps.Libvirt.Domain(r.Context(), uuid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Attach live stats (uptime/CPU/memory) so detail pages get everything
	// in one call.
	resp := struct {
		libvirt.DomainInfo
		Stats *libvirt.DomainStat `json:"stats,omitempty"`
	}{DomainInfo: info}
	if st, err := h.deps.Libvirt.Stat(r.Context(), uuid); err == nil {
		resp.Stats = st
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handlers) VMStart(w http.ResponseWriter, r *http.Request)     { h.vmAction(w, r, "start") }
func (h *Handlers) VMShutdown(w http.ResponseWriter, r *http.Request)  { h.vmAction(w, r, "shutdown") }
func (h *Handlers) VMReboot(w http.ResponseWriter, r *http.Request)    { h.vmAction(w, r, "reboot") }
func (h *Handlers) VMForceStop(w http.ResponseWriter, r *http.Request) { h.vmAction(w, r, "force-stop") }

func (h *Handlers) vmAction(w http.ResponseWriter, r *http.Request, action string) {
	if h.deps.Libvirt == nil {
		writeErr(w, http.StatusServiceUnavailable, "libvirt service unavailable")
		return
	}
	uuid := r.PathValue("uuid")
	var err error
	switch action {
	case "start":
		err = h.deps.Libvirt.Start(r.Context(), uuid)
	case "shutdown":
		err = h.deps.Libvirt.Shutdown(r.Context(), uuid)
	case "reboot":
		err = h.deps.Libvirt.Reboot(r.Context(), uuid)
	case "force-stop":
		err = h.deps.Libvirt.ForceStop(r.Context(), uuid)
	}
	if err != nil {
		h.logActivity("vm", action, uuid, "", err)
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("vm", action, uuid, "VM "+action, nil)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handlers) VMDelete(w http.ResponseWriter, r *http.Request) {
	if h.deps.Libvirt == nil {
		writeErr(w, http.StatusServiceUnavailable, "libvirt service unavailable")
		return
	}
	if err := h.deps.Libvirt.Delete(r.Context(), r.PathValue("uuid")); err != nil {
		h.logActivity("vm", "delete", r.PathValue("uuid"), "", err)
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("vm", "delete", r.PathValue("uuid"), "VM deleted", nil)
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

type vmCloneRequest struct {
	Name string `json:"name"`
}

// VMClone clones an existing VM (disk + domain).
func (h *Handlers) VMClone(w http.ResponseWriter, r *http.Request) {
	if h.deps.Libvirt == nil {
		writeErr(w, http.StatusServiceUnavailable, "libvirt service unavailable")
		return
	}
	var req vmCloneRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	uuid, err := h.deps.Libvirt.CloneVM(r.Context(), r.PathValue("uuid"), req.Name)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("vm", "clone", req.Name, "VM cloned", nil)
	writeJSON(w, http.StatusCreated, map[string]string{"uuid": uuid})
}

// VMSnapshots lists snapshots of a VM.
func (h *Handlers) VMSnapshots(w http.ResponseWriter, r *http.Request) {
	if h.deps.Libvirt == nil {
		writeErr(w, http.StatusServiceUnavailable, "libvirt service unavailable")
		return
	}
	snaps, err := h.deps.Libvirt.Snapshots(r.Context(), r.PathValue("uuid"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, snaps)
}

type vmSnapshotRequest struct {
	Name string `json:"name"`
}

// VMCreateSnapshot takes a snapshot of a VM.
func (h *Handlers) VMCreateSnapshot(w http.ResponseWriter, r *http.Request) {
	if h.deps.Libvirt == nil {
		writeErr(w, http.StatusServiceUnavailable, "libvirt service unavailable")
		return
	}
	var req vmSnapshotRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.deps.Libvirt.CreateSnapshot(r.Context(), r.PathValue("uuid"), req.Name); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("vm", "snapshot", req.Name, "VM snapshot created", nil)
	writeJSON(w, http.StatusCreated, map[string]string{"status": "created"})
}

// VMRevertSnapshot restores a VM to a snapshot.
func (h *Handlers) VMRevertSnapshot(w http.ResponseWriter, r *http.Request) {
	if h.deps.Libvirt == nil {
		writeErr(w, http.StatusServiceUnavailable, "libvirt service unavailable")
		return
	}
	if err := h.deps.Libvirt.RevertSnapshot(r.Context(), r.PathValue("uuid"), r.PathValue("name")); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("vm", "snapshot-revert", r.PathValue("name"), "VM snapshot reverted", nil)
	writeJSON(w, http.StatusOK, map[string]string{"status": "reverted"})
}

// VMDeleteSnapshot removes a snapshot from a VM.
func (h *Handlers) VMDeleteSnapshot(w http.ResponseWriter, r *http.Request) {
	if h.deps.Libvirt == nil {
		writeErr(w, http.StatusServiceUnavailable, "libvirt service unavailable")
		return
	}
	if err := h.deps.Libvirt.DeleteSnapshot(r.Context(), r.PathValue("uuid"), r.PathValue("name")); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("vm", "snapshot-delete", r.PathValue("name"), "VM snapshot deleted", nil)
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

type vmAutostartRequest struct {
	Enabled bool `json:"enabled"`
}

// VMSetAutostart toggles whether the VM starts on host boot.
func (h *Handlers) VMSetAutostart(w http.ResponseWriter, r *http.Request) {
	if h.deps.Libvirt == nil {
		writeErr(w, http.StatusServiceUnavailable, "libvirt service unavailable")
		return
	}
	var req vmAutostartRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.deps.Libvirt.SetAutostart(r.Context(), r.PathValue("uuid"), req.Enabled); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("vm", "autostart", r.PathValue("uuid"), fmt.Sprintf("VM autostart set to %v", req.Enabled), nil)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// VMResize changes vCPU/memory of a VM.
func (h *Handlers) VMResize(w http.ResponseWriter, r *http.Request) {
	if h.deps.Libvirt == nil {
		writeErr(w, http.StatusServiceUnavailable, "libvirt service unavailable")
		return
	}
	var req libvirt.ResizeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.VCPUs == nil && req.MemoryMB == nil {
		writeErr(w, http.StatusBadRequest, "vcpus or memory_mb is required")
		return
	}
	if err := h.deps.Libvirt.Resize(r.Context(), r.PathValue("uuid"), req); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("vm", "resize", r.PathValue("uuid"), fmt.Sprintf("VM resized (vcpus=%v memory_mb=%v)", req.VCPUs, req.MemoryMB), nil)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

var vncUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// upgrader upgrades HTTP requests to WebSockets for the terminal
// consoles (LXD exec and VM serial console).
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// VMPorts discovers a VM's IPv4 address (libvirt DHCP lease) and scans it
// for open TCP ports. Default scans a common-service port list (fast);
// ?scan=full sweeps 1-65535 (can take ~30s).
func (h *Handlers) VMPorts(w http.ResponseWriter, r *http.Request) {
	if h.deps.Libvirt == nil {
		writeErr(w, http.StatusServiceUnavailable, "libvirt service unavailable")
		return
	}
	uuid := r.PathValue("uuid")
	name, err := h.deps.Libvirt.ConsoleName(r.Context(), uuid)
	if err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	ip, err := h.deps.Libvirt.IPAddress(r.Context(), uuid)
	if err != nil || ip == "" {
		writeErr(w, http.StatusNotFound,
			fmt.Sprintf("no IP address found for %q (VM stopped or no DHCP lease?): %v", name, err))
		return
	}
	start := time.Now()
	var open []int
	if r.URL.Query().Get("scan") == "full" {
		open = libvirt.ScanRange(r.Context(), ip)
	} else {
		open = libvirt.ScanPorts(r.Context(), ip, libvirt.CommonScanPorts, 64, 400*time.Millisecond)
	}
	ports := make([]libvirt.PortInfo, 0, len(open))
	for _, p := range open {
		ports = append(ports, libvirt.PortInfo{Port: p, Service: libvirt.DescribePort(p)})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ip":          ip,
		"ports":       ports,
		"scan":        r.URL.Query().Get("scan"),
		"duration_ms": time.Since(start).Milliseconds(),
	})
}

// VMVNC bridges the VM's VNC TCP port to a WebSocket so the browser can
// connect with noVNC. The VM must be running and have a VNC display.
func (h *Handlers) VMVNC(w http.ResponseWriter, r *http.Request) {
	if h.deps.Libvirt == nil {
		writeErr(w, http.StatusServiceUnavailable, "libvirt service unavailable")
		return
	}
	port, err := h.deps.Libvirt.VNCPort(r.Context(), r.PathValue("uuid"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	conn, err := vncUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	tcp, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 5*time.Second)
	if err != nil {
		return
	}
	defer tcp.Close()

	// VNC -> WebSocket
	done := make(chan struct{})
	go func() {
		defer close(done)
		buf := make([]byte, 32*1024)
		for {
			n, err := tcp.Read(buf)
			if n > 0 {
				if err := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); err != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()

	// WebSocket -> VNC
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		if _, err := tcp.Write(data); err != nil {
			return
		}
	}
}

// VMConsole bridges a `virsh console` session (via a PTY) to a
// WebSocket so the browser can interact with the VM's serial console.
// The VM must be running and have a serial console configured.
func (h *Handlers) VMConsole(w http.ResponseWriter, r *http.Request) {
	if h.deps.Libvirt == nil {
		writeErr(w, http.StatusServiceUnavailable, "libvirt service unavailable")
		return
	}
	name, err := h.deps.Libvirt.ConsoleName(r.Context(), r.PathValue("uuid"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	// Spawn `virsh console <name>` attached to a PTY so the guest's
	// serial console gets a real terminal.
	cmd := exec.Command("virsh", "console", name, "--force")
	ptmx, err := pty.Start(cmd)
	if err != nil {
		_ = conn.WriteMessage(websocket.TextMessage, []byte("failed to start console: "+err.Error()))
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
		// Text messages may be terminal input (xterm.js onData sends
		// strings) or JSON resize control messages.
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

// VMAttachISO attaches or detaches a CDROM ISO on a VM.
func (h *Handlers) VMAttachISO(w http.ResponseWriter, r *http.Request) {
	if h.deps.Libvirt == nil {
		writeErr(w, http.StatusServiceUnavailable, "libvirt service unavailable")
		return
	}
	var req struct {
		ISO string `json:"iso"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.deps.Libvirt.AttachISO(r.Context(), r.PathValue("uuid"), req.ISO); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}