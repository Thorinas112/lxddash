package handlers

import (
	"encoding/json"
	"net/http"

	"lxddash/internal/services/backup"
)

// BackupJobs lists all scheduled backup jobs.
func (h *Handlers) BackupJobs(w http.ResponseWriter, r *http.Request) {
	if h.deps.Backup == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	writeJSON(w, http.StatusOK, h.deps.Backup.List())
}

// BackupCreate adds a new scheduled backup job.
func (h *Handlers) BackupCreate(w http.ResponseWriter, r *http.Request) {
	if h.deps.Backup == nil {
		writeErr(w, http.StatusServiceUnavailable, "backup service unavailable")
		return
	}
	var req backup.Job
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	job, err := h.deps.Backup.Create(req)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	h.logActivity("system", "backup-create", job.Instance, "scheduled backup created", nil)
	writeJSON(w, http.StatusCreated, job)
}

// BackupDelete removes a scheduled backup job.
func (h *Handlers) BackupDelete(w http.ResponseWriter, r *http.Request) {
	if h.deps.Backup == nil {
		writeErr(w, http.StatusServiceUnavailable, "backup service unavailable")
		return
	}
	if err := h.deps.Backup.Delete(r.PathValue("id")); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

type backupToggleRequest struct {
	Enabled bool `json:"enabled"`
}

// BackupToggle enables/disables a job.
func (h *Handlers) BackupToggle(w http.ResponseWriter, r *http.Request) {
	if h.deps.Backup == nil {
		writeErr(w, http.StatusServiceUnavailable, "backup service unavailable")
		return
	}
	var req backupToggleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.deps.Backup.SetEnabled(r.PathValue("id"), req.Enabled); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// BackupRunNow executes a job immediately.
func (h *Handlers) BackupRunNow(w http.ResponseWriter, r *http.Request) {
	if h.deps.Backup == nil {
		writeErr(w, http.StatusServiceUnavailable, "backup service unavailable")
		return
	}
	if err := h.deps.Backup.RunNow(r.PathValue("id")); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "started"})
}