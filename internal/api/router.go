package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"lxddash/internal/auth"
	"lxddash/internal/config"
	"lxddash/internal/handlers"
)

// NewRouter wires up all HTTP routes, the WebSocket hub, static file
// serving and the JWT auth middleware.
func NewRouter(h *handlers.Handlers, authSvc *auth.Service, cfg *config.Config) http.Handler {
	mux := http.NewServeMux()

	hub := newWSHub(h)

	// Auth
	mux.HandleFunc("GET /api/auth/status", h.AuthStatus)
	mux.HandleFunc("POST /api/auth/setup", h.Setup)
	mux.HandleFunc("POST /api/auth/login", h.Login)
mux.HandleFunc("POST /api/auth/reset-password", h.ResetPassword)
	mux.HandleFunc("POST /api/auth/password", h.ChangePassword)
	mux.HandleFunc("GET /api/auth/tokens", h.AuthTokens)
	mux.HandleFunc("POST /api/auth/tokens", h.AuthCreateToken)
	mux.HandleFunc("DELETE /api/auth/tokens/{id}", h.AuthDeleteToken)

	// Dashboard
	mux.HandleFunc("GET /api/dashboard/overview", h.Overview)

	// Metrics
	mux.HandleFunc("GET /api/metrics", h.MetricsSeries)
	mux.HandleFunc("GET /api/resource-metrics", h.ResourceMetrics)

	// Global search
	mux.HandleFunc("GET /api/search", h.Search)

	// Activity log
	mux.HandleFunc("GET /api/activity", h.ActivityList)

	// Scheduled backups
	mux.HandleFunc("GET /api/backups/jobs", h.BackupJobs)
	mux.HandleFunc("POST /api/backups/jobs", h.BackupCreate)
	mux.HandleFunc("DELETE /api/backups/jobs/{id}", h.BackupDelete)
	mux.HandleFunc("POST /api/backups/jobs/{id}/toggle", h.BackupToggle)
	mux.HandleFunc("POST /api/backups/jobs/{id}/run", h.BackupRunNow)

	// Docker
	mux.HandleFunc("GET /api/docker/containers", h.DockerContainers)
	mux.HandleFunc("GET /api/docker/stats", h.DockerStats)
	mux.HandleFunc("POST /api/docker/containers", h.DockerCreateContainer)
	mux.HandleFunc("GET /api/docker/containers/{id}", h.DockerContainer)
	mux.HandleFunc("POST /api/docker/containers/{id}/start", h.DockerStartContainer)
	mux.HandleFunc("POST /api/docker/containers/{id}/stop", h.DockerStopContainer)
	mux.HandleFunc("POST /api/docker/containers/{id}/restart", h.DockerRestartContainer)
	mux.HandleFunc("DELETE /api/docker/containers/{id}", h.DockerRemoveContainer)
	mux.HandleFunc("GET /api/docker/containers/{id}/logs", h.DockerContainerLogs)
	mux.HandleFunc("GET /api/docker/containers/{id}/exec", h.DockerExec)
	mux.HandleFunc("GET /api/docker/containers/{id}/logs/stream", h.DockerLogsStream)
	mux.HandleFunc("POST /api/docker/bulk", h.DockerBulkAction)
	mux.HandleFunc("GET /api/docker/images", h.DockerImages)
	mux.HandleFunc("POST /api/docker/images/pull", h.DockerPullImage)
	mux.HandleFunc("DELETE /api/docker/images/{id}", h.DockerRemoveImage)
	mux.HandleFunc("POST /api/docker/images/prune", h.DockerPruneImages)
	mux.HandleFunc("GET /api/docker/networks", h.DockerNetworks)
	mux.HandleFunc("DELETE /api/docker/networks/{id}", h.DockerRemoveNetwork)
	mux.HandleFunc("GET /api/docker/volumes", h.DockerVolumes)
	mux.HandleFunc("DELETE /api/docker/volumes/{name}", h.DockerRemoveVolume)
	mux.HandleFunc("POST /api/docker/compose/up", h.DockerComposeUp)
	mux.HandleFunc("POST /api/docker/compose/down", h.DockerComposeDown)
	mux.HandleFunc("POST /api/docker/compose/pull", h.DockerComposePull)
	mux.HandleFunc("POST /api/docker/compose/ps", h.DockerComposePS)
	mux.HandleFunc("POST /api/docker/compose/deploy", h.DockerComposeDeploy)

	// LXD
	mux.HandleFunc("GET /api/lxd/instances", h.LXDInstances)
	mux.HandleFunc("POST /api/lxd/instances", h.LXDCreateInstance)
	mux.HandleFunc("GET /api/lxd/instances/{name}", h.LXDInstance)
	mux.HandleFunc("PATCH /api/lxd/instances/{name}", h.LXDUpdateInstance)
	mux.HandleFunc("POST /api/lxd/instances/{name}/start", h.LXDStartInstance)
	mux.HandleFunc("POST /api/lxd/instances/{name}/stop", h.LXDStopInstance)
	mux.HandleFunc("POST /api/lxd/instances/{name}/restart", h.LXDRestartInstance)
	mux.HandleFunc("DELETE /api/lxd/instances/{name}", h.LXDDeleteInstance)
	mux.HandleFunc("POST /api/lxd/instances/{name}/clone", h.LXDCloneInstance)
	mux.HandleFunc("POST /api/lxd/instances/{name}/resize", h.LXDResizeLimits)
	mux.HandleFunc("POST /api/lxd/bulk", h.LXDBulkAction)
	mux.HandleFunc("GET /api/lxd/instances/{name}/snapshots", h.LXDSnapshots)
	mux.HandleFunc("POST /api/lxd/instances/{name}/snapshots", h.LXDCreateSnapshot)
	mux.HandleFunc("POST /api/lxd/instances/{name}/snapshots/{snapshot}/restore", h.LXDRestoreSnapshot)
	mux.HandleFunc("DELETE /api/lxd/instances/{name}/snapshots/{snapshot}", h.LXDDeleteSnapshot)
	mux.HandleFunc("GET /api/lxd/instances/{name}/snapshots/{snapshot}/export", h.LXDExportSnapshot)
	mux.HandleFunc("GET /api/lxd/instances/{name}/backups", h.LXDBackups)
	mux.HandleFunc("POST /api/lxd/instances/{name}/backups", h.LXDCreateBackup)
	mux.HandleFunc("POST /api/lxd/instances/{name}/backups/{backup}/restore", h.LXDRestoreBackup)
	mux.HandleFunc("GET /api/lxd/instances/{name}/backups/{backup}/download", h.LXDDownloadBackup)
	mux.HandleFunc("DELETE /api/lxd/instances/{name}/backups/{backup}", h.LXDDeleteBackup)
	mux.HandleFunc("GET /api/lxd/instances/{name}/backups/{backup}/verify", h.LXDVerifyBackup)
	mux.HandleFunc("GET /api/lxd/instances/{name}/backups/{backup}/proxmox", h.LXDExportProxmox)
	mux.HandleFunc("GET /api/lxd/instances/{name}/exec", h.LXDExec)
	mux.HandleFunc("GET /api/lxd/instances/{name}/updates", h.LXDInstanceUpdates)
	mux.HandleFunc("GET /api/lxd/instances/{name}/logs", h.LXDInstanceLogs)
	mux.HandleFunc("GET /api/lxd/instances/{name}/processes", h.LXDInstanceProcesses)
	mux.HandleFunc("GET /api/lxd/instances/{name}/ports", h.LXDInstancePorts)
	mux.HandleFunc("GET /api/lxd/instances/{name}/files", h.LXDFiles)
	mux.HandleFunc("POST /api/lxd/instances/{name}/files", h.LXDFileUpload)
	mux.HandleFunc("DELETE /api/lxd/instances/{name}/files", h.LXDFileDelete)
	mux.HandleFunc("GET /api/lxd/images", h.LXDImages)
	mux.HandleFunc("POST /api/lxd/images/pull", h.LXDPullImage)
	mux.HandleFunc("DELETE /api/lxd/images/{fingerprint}", h.LXDDeleteImage)
	mux.HandleFunc("GET /api/lxd/profiles", h.LXDProfiles)
	mux.HandleFunc("POST /api/lxd/profiles", h.LXDCreateProfile)
	mux.HandleFunc("PATCH /api/lxd/profiles/{name}", h.LXDUpdateProfile)
	mux.HandleFunc("DELETE /api/lxd/profiles/{name}", h.LXDDeleteProfile)
	mux.HandleFunc("GET /api/lxd/networks", h.LXDNetworks)
	mux.HandleFunc("POST /api/lxd/networks", h.LXDCreateNetwork)
	mux.HandleFunc("DELETE /api/lxd/networks/{name}", h.LXDDeleteNetwork)
	mux.HandleFunc("GET /api/lxd/acls", h.LXDNetworkACLs)
	mux.HandleFunc("POST /api/lxd/acls", h.LXDCreateNetworkACL)
	mux.HandleFunc("PATCH /api/lxd/acls/{name}", h.LXDUpdateNetworkACL)
	mux.HandleFunc("DELETE /api/lxd/acls/{name}", h.LXDDeleteNetworkACL)
	mux.HandleFunc("GET /api/lxd/storage-pools", h.LXDStoragePools)
	mux.HandleFunc("POST /api/lxd/storage-pools", h.LXDCreateStoragePool)
	mux.HandleFunc("DELETE /api/lxd/storage-pools/{name}", h.LXDDeleteStoragePool)
	mux.HandleFunc("GET /api/lxd/storage-pools/{pool}/volumes", h.LXDStorageVolumes)
	mux.HandleFunc("POST /api/lxd/storage-pools/{pool}/volumes", h.LXDCreateStorageVolume)
	mux.HandleFunc("DELETE /api/lxd/storage-pools/{pool}/volumes/{name}", h.LXDDeleteStorageVolume)

	// VMs (libvirt)
	mux.HandleFunc("GET /api/vms", h.VMs)
	mux.HandleFunc("GET /api/vms/stats", h.VMStats)
	mux.HandleFunc("POST /api/vms", h.VMCreate)
	mux.HandleFunc("GET /api/vms/isos", h.VMISOs)
	mux.HandleFunc("POST /api/vms/isos/upload", h.VMISOUpload)
	mux.HandleFunc("DELETE /api/vms/isos/{name}", h.VMISODelete)
	mux.HandleFunc("GET /api/vms/{uuid}", h.VM)
	mux.HandleFunc("POST /api/vms/{uuid}/start", h.VMStart)
	mux.HandleFunc("POST /api/vms/{uuid}/shutdown", h.VMShutdown)
	mux.HandleFunc("POST /api/vms/{uuid}/reboot", h.VMReboot)
	mux.HandleFunc("POST /api/vms/{uuid}/force-stop", h.VMForceStop)
	mux.HandleFunc("POST /api/vms/{uuid}/clone", h.VMClone)
	mux.HandleFunc("GET /api/vms/{uuid}/snapshots", h.VMSnapshots)
	mux.HandleFunc("POST /api/vms/{uuid}/snapshots", h.VMCreateSnapshot)
	mux.HandleFunc("POST /api/vms/{uuid}/snapshots/{name}/revert", h.VMRevertSnapshot)
	mux.HandleFunc("DELETE /api/vms/{uuid}/snapshots/{name}", h.VMDeleteSnapshot)
	mux.HandleFunc("POST /api/vms/{uuid}/autostart", h.VMSetAutostart)
	mux.HandleFunc("POST /api/vms/{uuid}/resize", h.VMResize)
	mux.HandleFunc("POST /api/vms/{uuid}/attach-iso", h.VMAttachISO)
	mux.HandleFunc("DELETE /api/vms/{uuid}", h.VMDelete)
	mux.HandleFunc("GET /api/vms/{uuid}/vnc", h.VMVNC)
	mux.HandleFunc("GET /api/vms/{uuid}/console", h.VMConsole)
	mux.HandleFunc("GET /api/vms/{uuid}/ports", h.VMPorts)

	// Proxmox migration
	mux.HandleFunc("GET /api/proxmox/backups", h.ProxmoxBackups)
	mux.HandleFunc("POST /api/proxmox/backups/upload", h.ProxmoxUpload)
	mux.HandleFunc("DELETE /api/proxmox/backups/{filename}", h.ProxmoxDelete)
	mux.HandleFunc("POST /api/proxmox/import", h.ProxmoxImport)
	mux.HandleFunc("GET /api/proxmox/tasks", h.ProxmoxTasks)
	mux.HandleFunc("GET /api/proxmox/download/{file}", h.ProxmoxDownloadBackup)

	// WebSocket (live stats)
	mux.HandleFunc("/api/ws", hub.handle)

	// Host terminal
	mux.HandleFunc("GET /api/host/terminal", h.HostTerminal)

	// Host power, logs, disks
	mux.HandleFunc("POST /api/host/power", h.HostPower)
	mux.HandleFunc("GET /api/host/logs", h.HostLogs)
	mux.HandleFunc("GET /api/host/disks", h.HostDisks)

	// Alerts (thresholds -> webhook)
	mux.HandleFunc("GET /api/alerts", h.AlertsGet)
	mux.HandleFunc("POST /api/alerts", h.AlertsSet)

	// Tags (shared for Docker containers and VMs)
	mux.HandleFunc("GET /api/tags/{id}", h.GetTags)
	mux.HandleFunc("PUT /api/tags/{id}", h.SetTags)

	// Port forwards
	mux.HandleFunc("GET /api/forwards", h.ForwardsList)
	mux.HandleFunc("POST /api/forwards", h.ForwardsAdd)
	mux.HandleFunc("DELETE /api/forwards/{id}", h.ForwardsRemove)

	// Ollama (LLM)
	mux.HandleFunc("GET /api/ollama/models", h.OllamaModels)
	mux.HandleFunc("POST /api/ollama/models/pull", h.OllamaPull)
	mux.HandleFunc("DELETE /api/ollama/models/{name}", h.OllamaDelete)
	mux.HandleFunc("POST /api/ollama/chat", h.OllamaChat)
	mux.HandleFunc("POST /api/ollama/assist", h.OllamaAssist)
	mux.HandleFunc("GET /api/ollama/stats", h.OllamaStats)

	// Systemd services
	mux.HandleFunc("GET /api/systemd/services", h.SystemdServices)
	mux.HandleFunc("GET /api/systemd/services/{name}", h.SystemdService)
	mux.HandleFunc("POST /api/systemd/services/{name}/{action}", h.SystemdAction)

	// Software updates
	mux.HandleFunc("GET /api/updates", h.UpdatesStatus)
	mux.HandleFunc("POST /api/updates/upgrade", h.UpdatesUpgrade)

	// Notifications (webhook)
	mux.HandleFunc("GET /api/notify", h.NotifyGet)
	mux.HandleFunc("POST /api/notify", h.NotifySet)
	mux.HandleFunc("POST /api/notify/test", h.NotifyTest)

	// Static frontend with SPA fallback: unknown non-API paths serve
	// index.html so client-side routes (e.g. /lxd, /vms) work on
	// refresh and direct navigation.
	if cfg.StaticDir != "" {
		mux.Handle("/", spaHandler(cfg.StaticDir))
	}

	return authMiddleware(mux, authSvc)
}

// spaHandler serves static files from dir and falls back to
// index.html for any path that doesn't match an existing file, so
// React Router paths work on refresh and direct navigation.
func spaHandler(dir string) http.Handler {
	fs := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path == "/" {
			fs.ServeHTTP(w, r)
			return
		}
		// If the requested path maps to an existing file, serve it.
		file := filepath.Join(dir, filepath.Clean(path))
		if fi, err := os.Stat(file); err == nil && !fi.IsDir() {
			fs.ServeHTTP(w, r)
			return
		}
		// Otherwise serve index.html (SPA fallback).
		// Add no-cache headers so the browser always fetches the latest HTML
		// (which references the content-hashed JS/CSS bundles).
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		http.ServeFile(w, r, filepath.Join(dir, "index.html"))
	})
}

// authMiddleware protects all /api/* routes except the auth endpoints.
// The WebSocket endpoint accepts the token as a query parameter.
func authMiddleware(next http.Handler, authSvc *auth.Service) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path == "/api/auth/login" || path == "/api/auth/status" || path == "/api/auth/setup" || path == "/api/auth/reset-password" || !strings.HasPrefix(path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if token == "" {
			token = r.URL.Query().Get("token")
		}
		if _, err := authSvc.Validate(token); err != nil {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}
