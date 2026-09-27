package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/lxc/incus/shared/api"

	"lxddash/internal/services/host"
	"lxddash/internal/services/lxd"
)

// instanceWithState enriches an api.Instance with its live state
// (network addresses, memory, CPU) for the dashboard.
type instanceWithState struct {
	api.Instance
	State  *api.InstanceState `json:"state,omitempty"`
	Uptime int64              `json:"uptime_seconds,omitempty"`
}

func (h *Handlers) LXDInstances(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	insts, err := h.deps.LXD.Instances(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Enrich with live state (IPs, memory, CPU) when requested.
	if r.URL.Query().Get("state") == "1" {
		out := make([]instanceWithState, 0, len(insts))
		for i := range insts {
			item := instanceWithState{Instance: insts[i]}
			if st, _, err := h.deps.LXD.InstanceState(r.Context(), insts[i].Name); err == nil {
				item.State = st
				// Uptime from the instance's init process start time.
				if st.Pid > 0 {
					item.Uptime = int64(host.ProcessUptime(int(st.Pid)) / time.Second)
				}
			}
			out = append(out, item)
		}
		writeJSON(w, http.StatusOK, out)
		return
	}
	writeJSON(w, http.StatusOK, insts)
}

func (h *Handlers) LXDInstance(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	inst, _, err := h.deps.LXD.Instance(r.Context(), r.PathValue("name"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, inst)
}

func (h *Handlers) LXDUpdateInstance(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	var req lxd.UpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.deps.LXD.UpdateInstance(r.Context(), r.PathValue("name"), req); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (h *Handlers) LXDBackups(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	backups, err := h.deps.LXD.Backups(r.Context(), r.PathValue("name"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, backups)
}

type lxdBackupRequest struct {
	Name string `json:"name"`
}

func (h *Handlers) LXDCreateBackup(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	var req lxdBackupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == "" {
		writeErr(w, http.StatusBadRequest, "name is required")
		return
	}
	if err := h.deps.LXD.CreateBackup(r.Context(), r.PathValue("name"), req.Name); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"status": "created"})
}

func (h *Handlers) LXDDeleteBackup(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	if err := h.deps.LXD.DeleteBackup(r.Context(), r.PathValue("name"), r.PathValue("backup")); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *Handlers) LXDRestoreBackup(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	if err := h.deps.LXD.RestoreBackup(r.Context(), r.PathValue("name"), r.PathValue("backup")); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "restored"})
}

func (h *Handlers) LXDCreateInstance(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	var req lxd.CreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.deps.LXD.CreateInstance(r.Context(), req); err != nil {
		h.logActivity("lxd", "create", req.Name, "", err)
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("lxd", "create", req.Name, "instance created", nil)
	writeJSON(w, http.StatusCreated, map[string]string{"status": "created"})
}

func (h *Handlers) LXDStartInstance(w http.ResponseWriter, r *http.Request) {
	h.lxdState(w, r, "start")
}

func (h *Handlers) LXDStopInstance(w http.ResponseWriter, r *http.Request) {
	h.lxdState(w, r, "stop")
}

func (h *Handlers) LXDRestartInstance(w http.ResponseWriter, r *http.Request) {
	h.lxdState(w, r, "restart")
}

func (h *Handlers) lxdState(w http.ResponseWriter, r *http.Request, action string) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	name := r.PathValue("name")
	if err := h.deps.LXD.SetState(r.Context(), name, action); err != nil {
		h.logActivity("lxd", action, name, "", err)
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("lxd", action, name, "", nil)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handlers) LXDDeleteInstance(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	name := r.PathValue("name")
	if err := h.deps.LXD.DeleteInstance(r.Context(), name); err != nil {
		h.logActivity("lxd", "delete", name, "", err)
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("lxd", "delete", name, "instance deleted", nil)
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *Handlers) LXDSnapshots(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	snaps, err := h.deps.LXD.Snapshots(r.Context(), r.PathValue("name"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, snaps)
}

func (h *Handlers) LXDCreateSnapshot(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.deps.LXD.CreateSnapshot(r.Context(), r.PathValue("name"), req.Name); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"status": "created"})
}

func (h *Handlers) LXDRestoreSnapshot(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	if err := h.deps.LXD.RestoreSnapshot(r.Context(), r.PathValue("name"), r.PathValue("snapshot")); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "restored"})
}

func (h *Handlers) LXDDeleteSnapshot(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	if err := h.deps.LXD.DeleteSnapshot(r.Context(), r.PathValue("name"), r.PathValue("snapshot")); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *Handlers) LXDImages(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	imgs, err := h.deps.LXD.Images(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, imgs)
}

type lxdImagePullRequest struct {
	Remote string `json:"remote"`
	Alias  string `json:"alias"`
}

// LXDPullImage copies an image from a remote into the local store.
func (h *Handlers) LXDPullImage(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	var req lxdImagePullRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.deps.LXD.PullImage(r.Context(), req.Remote, req.Alias); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("lxd", "image-pull", req.Remote, "image pulled", nil)
	writeJSON(w, http.StatusOK, map[string]string{"status": "pulled"})
}

// LXDDeleteImage removes an image from the local store.
func (h *Handlers) LXDDeleteImage(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	if err := h.deps.LXD.DeleteImage(r.Context(), r.PathValue("fingerprint")); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("lxd", "image-delete", r.PathValue("fingerprint"), "image deleted", nil)
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *Handlers) LXDProfiles(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	profiles, err := h.deps.LXD.Profiles(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, profiles)
}

type lxdProfileRequest struct {
	Name    string                       `json:"name"`
	Config  map[string]string            `json:"config"`
	Devices map[string]map[string]string `json:"devices"`
}

func (h *Handlers) LXDCreateProfile(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	var req lxdProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == "" {
		writeErr(w, http.StatusBadRequest, "name is required")
		return
	}
	if err := h.deps.LXD.CreateProfile(r.Context(), req.Name, req.Config, req.Devices); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"status": "created"})
}

func (h *Handlers) LXDUpdateProfile(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	var req lxdProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.deps.LXD.UpdateProfile(r.Context(), r.PathValue("name"), req.Config, req.Devices); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (h *Handlers) LXDDeleteProfile(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	if err := h.deps.LXD.DeleteProfile(r.Context(), r.PathValue("name")); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *Handlers) LXDNetworks(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	ns, err := h.deps.LXD.Networks(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, ns)
}

type lxdCreateNetworkRequest struct {
	Name string `json:"name"`
	IPv4 string `json:"ipv4"`
	IPv6 string `json:"ipv6"`
	DNS  string `json:"dns"`
	NAT  bool   `json:"nat"`
}

// LXDCreateNetwork creates a managed bridge network.
func (h *Handlers) LXDCreateNetwork(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	var req lxdCreateNetworkRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == "" {
		writeErr(w, http.StatusBadRequest, "network name is required")
		return
	}
	if err := h.deps.LXD.CreateNetwork(r.Context(), req.Name, req.IPv4, req.IPv6, req.DNS, req.NAT); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("lxd", "create-network", req.Name, "network created", nil)
	writeJSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

// LXDDeleteNetwork removes a managed network.
func (h *Handlers) LXDDeleteNetwork(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	if err := h.deps.LXD.DeleteNetwork(r.Context(), r.PathValue("name")); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("lxd", "delete-network", r.PathValue("name"), "network deleted", nil)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handlers) LXDStoragePools(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	pools, err := h.deps.LXD.StoragePools(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, pools)
}

// LXDStorageVolumes lists custom volumes in a pool.
func (h *Handlers) LXDStorageVolumes(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	vols, err := h.deps.LXD.StorageVolumes(r.Context(), r.PathValue("pool"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, vols)
}

type lxdCreateVolumeRequest struct {
	Name        string `json:"name"`
	Size        string `json:"size"`
	ContentType string `json:"content_type"`
}

// LXDCreateStorageVolume creates a custom volume in a pool.
func (h *Handlers) LXDCreateStorageVolume(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	var req lxdCreateVolumeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == "" {
		writeErr(w, http.StatusBadRequest, "volume name is required")
		return
	}
	if req.ContentType == "" {
		req.ContentType = "filesystem"
	}
	if err := h.deps.LXD.CreateStorageVolume(r.Context(), r.PathValue("pool"), req.Name, req.Size, req.ContentType); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("lxd", "create-volume", req.Name, "storage volume created", nil)
	writeJSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

// LXDDeleteStorageVolume removes a custom volume from a pool.
func (h *Handlers) LXDDeleteStorageVolume(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	if err := h.deps.LXD.DeleteStorageVolume(r.Context(), r.PathValue("pool"), r.PathValue("name")); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("lxd", "delete-volume", r.PathValue("name"), "storage volume deleted", nil)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type lxdCreatePoolRequest struct {
	Name   string `json:"name"`
	Driver string `json:"driver"`
	Size   string `json:"size"`
}

// LXDCreateStoragePool creates a new storage pool.
func (h *Handlers) LXDCreateStoragePool(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	var req lxdCreatePoolRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == "" || req.Driver == "" {
		writeErr(w, http.StatusBadRequest, "pool name and driver are required")
		return
	}
	if err := h.deps.LXD.CreateStoragePool(r.Context(), req.Name, req.Driver, req.Size); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("lxd", "create-pool", req.Name, "storage pool created", nil)
	writeJSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

// LXDDeleteStoragePool removes a storage pool.
func (h *Handlers) LXDDeleteStoragePool(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	if err := h.deps.LXD.DeleteStoragePool(r.Context(), r.PathValue("name")); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("lxd", "delete-pool", r.PathValue("name"), "storage pool deleted", nil)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// LXDExec upgrades the HTTP request to a WebSocket and bridges it to
// an interactive shell inside the LXD instance. The browser sends
// terminal input as binary messages; the shell output is streamed
// back. A JSON control message {"type":"resize","cols":N,"rows":N}
// resizes the PTY.
func (h *Handlers) LXDExec(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	name := r.PathValue("name")

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	// Bidirectional pipes between the browser websocket and the
	// LXD exec streams.
	stdinR, stdinW := io.Pipe()
	stdoutR, stdoutW := io.Pipe()

	// Control channel for window resize.
	controlCh := make(chan *websocket.Conn, 1)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	// Run the shell in a goroutine.
	execErr := make(chan error, 1)
	go func() {
		execErr <- h.deps.LXD.Exec(ctx, name, []string{"/bin/sh", "-l"}, 80, 24, stdinR, stdoutW, func(c *websocket.Conn) {
			select {
			case controlCh <- c:
			default:
			}
		})
	}()

	// Stream LXD stdout -> browser.
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := stdoutR.Read(buf)
			if n > 0 {
				if werr := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); werr != nil {
					cancel()
					return
				}
			}
			if err != nil {
				cancel()
				return
			}
		}
	}()

	// Stream browser -> LXD stdin, and handle control messages.
	for {
		mt, data, err := conn.ReadMessage()
		if err != nil {
			cancel()
			break
		}
		// Text messages may be either terminal input (from xterm.js
		// onData, which sends strings) or JSON control messages
		// (resize). Try parsing as control first; if it's not valid
		// JSON control, treat it as terminal input.
		if mt == websocket.TextMessage {
			var msg struct {
				Type string `json:"type"`
				Cols int    `json:"cols"`
				Rows int    `json:"rows"`
			}
			if err := json.Unmarshal(data, &msg); err == nil && msg.Type == "resize" {
				select {
				case c := <-controlCh:
					ctrl := api.InstanceExecControl{Command: "window-resize", Args: map[string]string{
						"width":  fmt.Sprintf("%d", msg.Cols),
						"height": fmt.Sprintf("%d", msg.Rows),
					}}
					_ = c.WriteJSON(ctrl)
				default:
				}
				continue
			}
			// Not a control message → terminal input.
			if _, werr := stdinW.Write(data); werr != nil {
				cancel()
				break
			}
			continue
		}
		if mt == websocket.BinaryMessage {
			if _, werr := stdinW.Write(data); werr != nil {
				cancel()
				break
			}
		}
	}

	// Wait for the exec to finish.
	<-execErr
}

// lxdUpdateResult reports pending package updates inside an instance.
type lxdUpdateResult struct {
	Manager  string   `json:"manager"`
	Count    int      `json:"count"`
	Packages []string `json:"packages"`
	Running  bool     `json:"running"`
	Checked  string   `json:"checked_at,omitempty"`
}

// updateScript detects the package manager inside the instance and
// prints "manager:count" on the first line, followed by one package
// per line. It always exits 0 so the output is always captured. The
// package-manager commands are wrapped in `timeout` so a container
// without network access can't hang the check.
const updateScript = `
if command -v apt-get >/dev/null 2>&1; then
  out=$(timeout 20 apt list --upgradable 2>/dev/null | sed '1d')
  n=$(printf '%s\n' "$out" | grep -c . || true)
  echo "apt:$n"
  printf '%s\n' "$out"
elif command -v dnf >/dev/null 2>&1; then
  out=$(timeout 20 dnf list upgrades 2>/dev/null | sed '1d')
  n=$(printf '%s\n' "$out" | grep -c . || true)
  echo "dnf:$n"
  printf '%s\n' "$out"
elif command -v apk >/dev/null 2>&1; then
  out=$(timeout 20 apk version -l '<' 2>/dev/null)
  n=$(printf '%s\n' "$out" | grep -c . || true)
  echo "apk:$n"
  printf '%s\n' "$out"
else
  echo "none:0"
fi
`

// LXDInstanceUpdates checks for pending package updates inside an LXD
// instance by running its package manager's upgrade check.
func (h *Handlers) LXDInstanceUpdates(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	name := r.PathValue("name")

	inst, _, err := h.deps.LXD.Instance(r.Context(), name)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if inst.Status != "Running" {
		writeJSON(w, http.StatusOK, lxdUpdateResult{Packages: []string{}})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	out, err := h.deps.LXD.ExecOutput(ctx, name, []string{"/bin/sh", "-c", updateScript})
	if err != nil && out == "" {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, parseUpdateOutput(out))
}

// parseUpdateOutput parses the "manager:count\npackage..." output of
// updateScript into a lxdUpdateResult.
func parseUpdateOutput(out string) lxdUpdateResult {
	res := lxdUpdateResult{
		Packages: []string{},
		Running:  true,
		Checked:  time.Now().UTC().Format(time.RFC3339),
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) == 0 {
		return res
	}
	first := strings.SplitN(strings.TrimSpace(lines[0]), ":", 2)
	if len(first) == 2 {
		res.Manager = first[0]
		res.Count, _ = strconv.Atoi(first[1])
	}
	for _, ln := range lines[1:] {
		ln = strings.TrimSpace(ln)
		if ln == "" {
			continue
		}
		fields := strings.Fields(ln)
		if len(fields) == 0 {
			continue
		}
		pkg := fields[0]
		// apt: "pkg/arch" → "pkg"; dnf: "pkg.arch" → "pkg"
		if i := strings.IndexByte(pkg, '/'); i > 0 {
			pkg = pkg[:i]
		} else if i := strings.LastIndexByte(pkg, '.'); i > 0 {
			pkg = pkg[:i]
		}
		res.Packages = append(res.Packages, pkg)
	}
	if res.Count == 0 {
		res.Count = len(res.Packages)
	}
	return res
}

// LXDInstanceLogs returns the last N lines of syslog/dmesg from inside an instance.
func (h *Handlers) LXDInstanceLogs(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	name := r.PathValue("name")
	lines := r.URL.Query().Get("lines")
	if lines == "" {
		lines = "200"
	}
	// Try syslog first, fall back to dmesg.
	out, err := h.deps.LXD.ExecOutput(r.Context(), name, []string{"sh", "-c", "cat /var/log/syslog 2>/dev/null || journalctl --no-pager -n " + lines + " 2>/dev/null || dmesg 2>/dev/null || echo 'No logs available'"})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/plain")
	_, _ = w.Write([]byte(out))
}

// LXDInstanceProcesses returns the process list from inside an instance.
func (h *Handlers) LXDInstanceProcesses(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	name := r.PathValue("name")
	out, err := h.deps.LXD.ExecOutput(r.Context(), name, []string{"sh", "-c", "ps aux --sort=-pcpu 2>/dev/null || ps aux 2>/dev/null || echo 'ps not available'"})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/plain")
	_, _ = w.Write([]byte(out))
}