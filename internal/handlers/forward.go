package handlers

import (
	"encoding/json"
	"net/http"
)

// ForwardsList returns all port-forward rules.
func (h *Handlers) ForwardsList(w http.ResponseWriter, r *http.Request) {
	if h.deps.Forward == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	writeJSON(w, http.StatusOK, h.deps.Forward.List())
}

// ForwardsAdd creates a new port-forward rule.
func (h *Handlers) ForwardsAdd(w http.ResponseWriter, r *http.Request) {
	if h.deps.Forward == nil {
		writeErr(w, http.StatusServiceUnavailable, "forward service unavailable")
		return
	}
	var req struct {
		Name   string `json:"name"`
		Port   int    `json:"port"`
		Target string `json:"target"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	rule, err := h.deps.Forward.Add(req.Name, req.Port, req.Target)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	h.logActivity("forward", "add", rule.ID, "port forward added", nil)
	writeJSON(w, http.StatusCreated, rule)
}

// ForwardsRemove deletes a port-forward rule.
func (h *Handlers) ForwardsRemove(w http.ResponseWriter, r *http.Request) {
	if h.deps.Forward == nil {
		writeErr(w, http.StatusServiceUnavailable, "forward service unavailable")
		return
	}
	if err := h.deps.Forward.Remove(r.PathValue("id")); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	h.logActivity("forward", "remove", r.PathValue("id"), "port forward removed", nil)
	writeJSON(w, http.StatusOK, map[string]string{"status": "removed"})
}