package handlers

import (
	"io"
	"net/http"
	"path/filepath"
	"strconv"
)

// LXDFiles lists a directory or reads a file inside an instance.
// Query: ?path=/etc (default /)
func (h *Handlers) LXDFiles(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	name := r.PathValue("name")
	path := r.URL.Query().Get("path")
	if path == "" {
		path = "/"
	}
	entries, err := h.deps.LXD.ListFiles(r.Context(), name, path)
	if err != nil {
		// Not a directory — return the file content.
		data, rerr := h.deps.LXD.ReadFile(r.Context(), name, path)
		if rerr != nil {
			writeErr(w, http.StatusInternalServerError, rerr.Error())
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("X-File-Name", filepath.Base(path))
		_, _ = w.Write(data)
		return
	}
	writeJSON(w, http.StatusOK, entries)
}

// LXDFileUpload writes a file into an instance (multipart form: "file").
// Query: ?path=/etc/foo.conf
func (h *Handlers) LXDFileUpload(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	name := r.PathValue("name")
	path := r.URL.Query().Get("path")
	if path == "" {
		writeErr(w, http.StatusBadRequest, "path query param is required")
		return
	}
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid multipart form")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "file field is required")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(file)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	mode := 0o644
	if m := r.FormValue("mode"); m != "" {
		if n, err := strconv.ParseInt(m, 8, 32); err == nil {
			mode = int(n)
		}
	}
	if err := h.deps.LXD.WriteFile(r.Context(), name, path, data, mode); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("lxd", "upload-file", name, "uploaded "+path, nil)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// LXDFileDelete removes a file inside an instance. Query: ?path=/etc/foo
func (h *Handlers) LXDFileDelete(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	name := r.PathValue("name")
	path := r.URL.Query().Get("path")
	if path == "" || path == "/" {
		writeErr(w, http.StatusBadRequest, "invalid path")
		return
	}
	if err := h.deps.LXD.DeleteFile(r.Context(), name, path); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("lxd", "delete-file", name, "deleted "+path, nil)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}