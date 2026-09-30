package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
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
// streams it directly to the dump directory (no in-memory buffering,
// so multi-GB files upload without freezing).
func (h *Handlers) ProxmoxUpload(w http.ResponseWriter, r *http.Request) {
	if h.deps.Proxmox == nil {
		writeErr(w, http.StatusServiceUnavailable, "proxmox service unavailable")
		return
	}
	mr, err := r.MultipartReader()
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid multipart form: "+err.Error())
		return
	}
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			writeErr(w, http.StatusBadRequest, "read form: "+err.Error())
			return
		}
		if part.FormName() != "backup" {
			part.Close()
			continue
		}
		path, err := h.deps.Proxmox.Upload(part.FileName(), part)
		part.Close()
		if err != nil {
			h.logActivity("proxmox", "upload", part.FileName(), "", err)
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		h.logActivity("proxmox", "upload", part.FileName(), "backup uploaded", nil)
		writeJSON(w, http.StatusCreated, map[string]string{"path": path, "filename": part.FileName()})
		return
	}
	writeErr(w, http.StatusBadRequest, "missing 'backup' file field")
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

// ProxmoxDownloadBackup streams a backup file for download.
func (h *Handlers) ProxmoxDownloadBackup(w http.ResponseWriter, r *http.Request) {
	if h.deps.Proxmox == nil {
		writeErr(w, http.StatusServiceUnavailable, "proxmox service unavailable")
		return
	}
	filename := r.PathValue("file")
	path := filepath.Join(h.deps.Config.ProxmoxDumpDir, filepath.Base(filename))
	if _, err := os.Stat(path); err != nil {
		writeErr(w, http.StatusNotFound, "backup file not found")
		return
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filepath.Base(path)))
	http.ServeFile(w, r, path)
}