package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"lxddash/internal/api"
	"lxddash/internal/auth"
	"lxddash/internal/config"
	"lxddash/internal/handlers"
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

func main() {
	configPath := flag.String("config", "", "path to config file (optional)")
	flag.Parse()

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	// Startup watchdog: service constructors dial their backends eagerly;
	// if one hangs (e.g. a half-initialised daemon accepting connections
	// but never answering), exit so systemd restarts instead of leaving
	// the dashboard unreachable on port 8080.
	var started atomic.Bool
	go func() {
		time.Sleep(90 * time.Second)
		if !started.Load() {
			log.Printf("startup watchdog: server not listening after 90s — exiting for systemd restart")
			os.Exit(1)
		}
	}()

	authSvc, err := auth.New(cfg)
	if err != nil {
		log.Fatalf("auth: %v", err)
	}

	hostSvc := host.New()

	dockerSvc, err := docker.New()
	if err != nil {
		log.Printf("warning: docker service unavailable: %v", err)
	}

	lxdSvc, err := lxd.New(cfg.LXDUnixSocket)
	if err != nil {
		log.Printf("warning: lxd service unavailable: %v", err)
	}

	libvirtSvc, err := libvirt.New(cfg.LibvirtURI, cfg.VMImageDir, cfg.ISODir)
	if err != nil {
		log.Printf("warning: libvirt service unavailable: %v", err)
	}

	// LXD and libvirt connect eagerly at startup; if their sockets are not
	// ready yet (fresh installs), those services would stay "Unavailable"
	// forever. Exit so systemd restarts the process with fresh connections,
	// retrying every 30s up to 20 times (count persisted in the data dir).
	retryPath := filepath.Join(cfg.DataDir, "service-retries")
	if lxdSvc != nil && libvirtSvc != nil {
		_ = os.Remove(retryPath)
	} else {
		missing := make([]string, 0, 2)
		if lxdSvc == nil {
			missing = append(missing, "LXD")
		}
		if libvirtSvc == nil {
			missing = append(missing, "libvirt")
		}
		log.Printf("warning: %s not ready at startup — will retry via restart every 30s (max 20)", strings.Join(missing, "+"))
		go func() {
			n := 0
			if b, err := os.ReadFile(retryPath); err == nil {
				n, _ = strconv.Atoi(strings.TrimSpace(string(b)))
			}
			for n < 20 {
				time.Sleep(30 * time.Second)
				n++
				_ = os.WriteFile(retryPath, []byte(strconv.Itoa(n)), 0o600)
				log.Printf("services still not ready — restarting to retry (%d/20)", n)
				os.Exit(1)
			}
			log.Printf("giving up after 20 retries — start the missing services, then: sudo systemctl restart lxddash")
		}()
	}

	proxmoxSvc := proxmox.New(cfg.ProxmoxDumpDir, cfg.ProxmoxStaging, cfg.VMImageDir, lxdSvc, libvirtSvc)

	ollamaSvc := ollama.New("")

	activitySvc := activity.New(500, cfg.DataDir)

	backupSvc := backup.New(lxdSvc, cfg.DataDir)

	metricsSvc := metrics.New(hostSvc, 1440)

	systemdSvc := systemd.New()
	if !systemdSvc.Available() {
		systemdSvc = nil
		log.Printf("warning: systemd unavailable (not a systemd host)")
	}

	updatesSvc := updates.New()

	notifySvc := notify.New(cfg.DataDir)
	notifySvc.Load()

	alertsSvc := alerts.New(hostSvc, notifySvc, cfg.DataDir)

	resMetricsSvc := resmetrics.New(dockerSvc, lxdSvc, libvirtSvc, cfg.DataDir)

	forwardSvc := forward.New(cfg.DataDir)

	tagsStore := tags.New(cfg.DataDir)

	h := handlers.New(handlers.Deps{
		Config:     cfg,
		Auth:       authSvc,
		Host:       hostSvc,
		Docker:     dockerSvc,
		LXD:        lxdSvc,
		Libvirt:    libvirtSvc,
		Proxmox:    proxmoxSvc,
		Ollama:     ollamaSvc,
		Activity:   activitySvc,
		Backup:     backupSvc,
		Metrics:    metricsSvc,
		Systemd:    systemdSvc,
		Updates:    updatesSvc,
		Notify:     notifySvc,
		Alerts:     alertsSvc,
		ResMetrics: resMetricsSvc,
		Forward:    forwardSvc,
		Tags:       tagsStore,
	})

	// Notify on backup completion/failure.
	if backupSvc != nil && notifySvc != nil {
		backupSvc.OnResult = func(jobName string, ok bool, detail string) {
			notifySvc.NotifyBackup(ok, jobName, detail)
		}
	}

	router := api.NewRouter(h, authSvc, cfg)

	srv := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
	}

	started.Store(true)
	log.Printf("LXD Dash listening on %s", cfg.ListenAddr)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
