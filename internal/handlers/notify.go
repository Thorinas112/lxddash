package handlers

import (
	"encoding/json"
	"net/http"

	"lxddash/internal/services/notify"
)

// NotifyGet returns the current webhook URL.
func (h *Handlers) NotifyGet(w http.ResponseWriter, r *http.Request) {
	url := ""
	if h.deps.Notify != nil {
		url = h.deps.Notify.URL()
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": url})
}

type notifySetRequest struct {
	URL string `json:"url"`
}

// NotifySet updates the webhook URL.
func (h *Handlers) NotifySet(w http.ResponseWriter, r *http.Request) {
	if h.deps.Notify == nil {
		writeErr(w, http.StatusServiceUnavailable, "notifications unavailable")
		return
	}
	var req notifySetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.deps.Notify.SetURL(req.URL); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// NotifyTest sends a test notification to the webhook.
func (h *Handlers) NotifyTest(w http.ResponseWriter, r *http.Request) {
	if h.deps.Notify == nil {
		writeErr(w, http.StatusServiceUnavailable, "notifications unavailable")
		return
	}
	h.deps.Notify.Send(notify.Event{
		Type:    "test",
		Title:   "Test notification",
		Message: "LXD Dash webhook is working",
	})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}