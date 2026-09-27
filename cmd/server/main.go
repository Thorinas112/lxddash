package main

import (
	"flag"
	"log"
	"net/http"
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
	"lxddash/internal/services/updates"
)

func main() {
	configPath := flag.String("config", "", "path to config file (optional)")
	flag.Parse()

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}

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

	proxmoxSvc := proxmox.New(cfg.ProxmoxDumpDir, cfg.ProxmoxStaging, cfg.VMImageDir, lxdSvc, libvirtSvc)

	ollamaSvc := ollama.New("")

	activitySvc := activity.New(500)

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

	h := handlers.New(handlers.Deps{
		Config:   cfg,
		Auth:     authSvc,
		Host:     hostSvc,
		Docker:   dockerSvc,
		LXD:      lxdSvc,
		Libvirt:  libvirtSvc,
		Proxmox:  proxmoxSvc,
		Ollama:   ollamaSvc,
		Activity: activitySvc,
		Backup:   backupSvc,
		Metrics:  metricsSvc,
		Systemd:  systemdSvc,
		Updates:  updatesSvc,
		Notify:   notifySvc,
		Alerts:   alertsSvc,
		ResMetrics: resMetricsSvc,
		Forward:  forwardSvc,
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

	log.Printf("LXD Dash listening on %s", cfg.ListenAddr)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}