package handlers

import (
	"net/http"
)

// UpdatesStatus reports pending OS package updates.
func (h *Handlers) UpdatesStatus(w http.ResponseWriter, r *http.Request) {
	if h.deps.Updates == nil {
		writeErr(w, http.StatusServiceUnavailable, "package manager not found")
		return
	}
	st, err := h.deps.Updates.Check(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, st)
}

// UpdatesUpgrade applies all pending upgrades.
func (h *Handlers) UpdatesUpgrade(w http.ResponseWriter, r *http.Request) {
	if h.deps.Updates == nil {
		writeErr(w, http.StatusServiceUnavailable, "package manager not found")
		return
	}
	out, err := h.deps.Updates.Upgrade(r.Context())
	if err != nil {
		// Include the command output so the user can see why it
		// failed (e.g. apt's exit status 100 with the real reason).
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error":  err.Error(),
			"output": out,
		})
		return
	}
	h.logActivity("updates", "upgrade", "system", "OS packages upgraded", nil)
	writeJSON(w, http.StatusOK, map[string]string{"output": out})
}