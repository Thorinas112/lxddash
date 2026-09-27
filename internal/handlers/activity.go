package handlers

import (
	"net/http"
	"strconv"
)

// ActivityList returns recent activity entries, newest first.
// Query params: ?category=docker&limit=50
func (h *Handlers) ActivityList(w http.ResponseWriter, r *http.Request) {
	if h.deps.Activity == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	category := r.URL.Query().Get("category")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	writeJSON(w, http.StatusOK, h.deps.Activity.List(category, limit))
}

// logActivity is a helper for handlers to record an action.
func (h *Handlers) logActivity(category, action, target, message string, err error) {
	if h.deps.Activity == nil {
		return
	}
	status := "ok"
	if err != nil {
		status = "error"
		if message == "" {
			message = err.Error()
		}
	}
	h.deps.Activity.Log(category, action, target, message, status)
}