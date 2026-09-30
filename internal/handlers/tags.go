package handlers

import (
	"encoding/json"
	"net/http"
)

// GetTags returns tags for a resource.
func (h *Handlers) GetTags(w http.ResponseWriter, r *http.Request) {
	if h.deps.Tags == nil {
		writeJSON(w, http.StatusOK, []string{})
		return
	}
	id := r.PathValue("id")
	writeJSON(w, http.StatusOK, h.deps.Tags.Get(id))
}

// SetTags replaces tags for a resource.
func (h *Handlers) SetTags(w http.ResponseWriter, r *http.Request) {
	if h.deps.Tags == nil {
		writeErr(w, http.StatusServiceUnavailable, "tags service unavailable")
		return
	}
	id := r.PathValue("id")
	var req struct {
		Tags []string `json:"tags"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	h.deps.Tags.Set(id, req.Tags)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
