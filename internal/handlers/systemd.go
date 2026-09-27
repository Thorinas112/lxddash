package handlers

import (
	"net/http"
)

// SystemdServices lists host systemd services.
func (h *Handlers) SystemdServices(w http.ResponseWriter, r *http.Request) {
	if h.deps.Systemd == nil {
		writeErr(w, http.StatusServiceUnavailable, "systemd unavailable (not a systemd host)")
		return
	}
	svcs, err := h.deps.Systemd.List(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, svcs)
}

// SystemdService returns details for one service.
func (h *Handlers) SystemdService(w http.ResponseWriter, r *http.Request) {
	if h.deps.Systemd == nil {
		writeErr(w, http.StatusServiceUnavailable, "systemd unavailable (not a systemd host)")
		return
	}
	svc, err := h.deps.Systemd.Detail(r.Context(), r.PathValue("name"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, svc)
}

// SystemdAction runs start/stop/restart/enable/disable on a service.
func (h *Handlers) SystemdAction(w http.ResponseWriter, r *http.Request) {
	if h.deps.Systemd == nil {
		writeErr(w, http.StatusServiceUnavailable, "systemd unavailable (not a systemd host)")
		return
	}
	action := r.PathValue("action")
	switch action {
	case "start", "stop", "restart", "enable", "disable":
	default:
		writeErr(w, http.StatusBadRequest, "invalid action")
		return
	}
	name := r.PathValue("name")
	if err := h.deps.Systemd.Action(r.Context(), name, action); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("systemd", action, name, "service "+action, nil)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}