package handlers

import (
	"net/http"
	"strconv"
	"time"
)

// MetricsSeries returns historical host metrics.
// Query params: ?hours=1 (default 1, max 24)
func (h *Handlers) MetricsSeries(w http.ResponseWriter, r *http.Request) {
	if h.deps.Metrics == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	hours := 1
	if v := r.URL.Query().Get("hours"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 24 {
			hours = n
		}
	}
	writeJSON(w, http.StatusOK, h.deps.Metrics.Series(time.Duration(hours)*time.Hour))
}

// ResourceMetrics returns up to 24h of per-resource history for
// Docker containers, LXD instances and VMs.
// Query params: ?hours=24 (default 24, max 24)
func (h *Handlers) ResourceMetrics(w http.ResponseWriter, r *http.Request) {
	if h.deps.ResMetrics == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	hours := 24
	if v := r.URL.Query().Get("hours"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 24 {
			hours = n
		}
	}
	writeJSON(w, http.StatusOK, h.deps.ResMetrics.Series(time.Duration(hours)*time.Hour))
}