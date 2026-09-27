package handlers

import (
	"encoding/json"
	"net/http"
)

func (h *Handlers) ProxmoxBackups(w http.ResponseWriter, r *http.Request) {
	if h.deps.Proxmox == nil {
		writeErr(w, http.StatusServiceUnavailable, "proxmox service unavailable")
		return
	}
	backups, err := h.deps.Proxmox.Backups()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, backups)
}

// ProxmoxUpload accepts a multipart upload of a vzdump backup file and
// saves it into the dump directory.
func (h *Handlers) ProxmoxUpload(w http.ResponseWriter, r *http.Request) {
	if h.deps.Proxmox == nil {
		writeErr(w, http.StatusServiceUnavailable, "proxmox service unavailable")
		return
	}
	if err := r.ParseMultipartForm(512 << 20); err != nil { // 512 MB max in memory
		writeErr(w, http.StatusBadRequest, "invalid multipart form: "+err.Error())
		return
	}
	file, header, err := r.FormFile("backup")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "missing 'backup' file field")
		return
	}
	defer file.Close()

	path, err := h.deps.Proxmox.Upload(header.Filename, file)
	if err != nil {
		h.logActivity("proxmox", "upload", header.Filename, "", err)
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	h.logActivity("proxmox", "upload", header.Filename, "backup uploaded", nil)
	writeJSON(w, http.StatusCreated, map[string]string{"path": path, "filename": header.Filename})
}

// ProxmoxDelete removes a backup file from the dump directory.
func (h *Handlers) ProxmoxDelete(w http.ResponseWriter, r *http.Request) {
	if h.deps.Proxmox == nil {
		writeErr(w, http.StatusServiceUnavailable, "proxmox service unavailable")
		return
	}
	filename := r.PathValue("filename")
	if err := h.deps.Proxmox.Delete(filename); err != nil {
		h.logActivity("proxmox", "delete", filename, "", err)
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("proxmox", "delete", filename, "backup deleted", nil)
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

type importRequest struct {
	Path string `json:"path"`
}

func (h *Handlers) ProxmoxImport(w http.ResponseWriter, r *http.Request) {
	if h.deps.Proxmox == nil {
		writeErr(w, http.StatusServiceUnavailable, "proxmox service unavailable")
		return
	}
	var req importRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	task, err := h.deps.Proxmox.Import(r.Context(), req.Path)
	if err != nil {
		h.logActivity("proxmox", "import", req.Path, "", err)
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	h.logActivity("proxmox", "import", req.Path, "import started", nil)
	writeJSON(w, http.StatusAccepted, task)
}

func (h *Handlers) ProxmoxTasks(w http.ResponseWriter, r *http.Request) {
	if h.deps.Proxmox == nil {
		writeErr(w, http.StatusServiceUnavailable, "proxmox service unavailable")
		return
	}
	writeJSON(w, http.StatusOK, h.deps.Proxmox.Tasks())
}