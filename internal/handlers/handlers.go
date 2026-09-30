package handlers

import (
	"encoding/json"
	"net/http"

	"lxddash/internal/auth"
	"lxddash/internal/config"
	"lxddash/internal/services/activity"
	"lxddash/internal/services/alerts"
	"lxddash/internal/services/backup"
	"lxddash/internal/services/docker"
	"lxddash/internal/services/forward"
	"lxddash/internal/services/host"
	"lxddash/internal/services/libvirt"
	"lxddash/internal/services/lxd"
	"lxddash/internal/services/metrics"
	"lxddash/internal/services/notify"
	"lxddash/internal/services/ollama"
	"lxddash/internal/services/proxmox"
	"lxddash/internal/services/resmetrics"
	"lxddash/internal/services/systemd"
	"lxddash/internal/services/tags"
	"lxddash/internal/services/updates"
)

// Deps bundles every service the HTTP handlers need. Services that failed
// to connect at startup are nil and the handlers return 503 for them.
type Deps struct {
	Config     *config.Config
	Auth       *auth.Service
	Host       *host.Service
	Docker     *docker.Service
	LXD        *lxd.Service
	Libvirt    *libvirt.Service
	Proxmox    *proxmox.Service
	Ollama     *ollama.Service
	Activity   *activity.Service
	Backup     *backup.Service
	Metrics    *metrics.Service
	Systemd    *systemd.Service
	Updates    *updates.Service
	Notify     *notify.Service
	Alerts     *alerts.Service
	ResMetrics *resmetrics.Service
	Forward    *forward.Service
	Tags       *tags.Store
}

type Handlers struct {
	deps Deps
}

func New(deps Deps) *Handlers {
	return &Handlers{deps: deps}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
