package config

import (
	"encoding/json"
	"os"
)

// Config holds all runtime configuration for LXD Dash.
// Values can be provided via a JSON config file and/or environment
// variables (LXDDASH_*), with environment variables taking precedence.
type Config struct {
	ListenAddr     string `json:"listen_addr"`
	DataDir        string `json:"data_dir"`
	JWTSecret      string `json:"jwt_secret"`
	AdminUser      string `json:"admin_user"`
	AdminPassword  string `json:"admin_password"`
	LXDUnixSocket  string `json:"lxd_unix_socket"`
	LibvirtURI     string `json:"libvirt_uri"`
	ProxmoxDumpDir string `json:"proxmox_dump_dir"`
	ProxmoxStaging string `json:"proxmox_staging"`
	VMImageDir     string `json:"vm_image_dir"`
	ISODir         string `json:"iso_dir"`
	StaticDir      string `json:"static_dir"`
}

func Default() *Config {
	return &Config{
		ListenAddr:     ":8080",
		DataDir:        "/var/lib/lxddash",
		AdminUser:      "admin",
		LXDUnixSocket:  "/var/lib/lxd/unix.socket",
		LibvirtURI:     "qemu:///system",
		ProxmoxDumpDir: "/var/lib/vz/dump",
		ProxmoxStaging: "/var/lib/lxddash/staging",
		VMImageDir:     "/var/lib/libvirt/images",
		ISODir:         "/var/lib/libvirt/iso",
		StaticDir:      "web/dist",
	}
}

// Load reads the optional config file, then applies LXDDASH_* environment
// variable overrides on top.
func Load(path string) (*Config, error) {
	cfg := Default()

	if path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		if err := json.Unmarshal(data, cfg); err != nil {
			return nil, err
		}
	}

	cfg.ListenAddr = envOr("LXDDASH_LISTEN", cfg.ListenAddr)
	cfg.DataDir = envOr("LXDDASH_DATA_DIR", cfg.DataDir)
	cfg.JWTSecret = envOr("LXDDASH_JWT_SECRET", cfg.JWTSecret)
	cfg.AdminUser = envOr("LXDDASH_ADMIN_USER", cfg.AdminUser)
	cfg.AdminPassword = envOr("LXDDASH_ADMIN_PASSWORD", cfg.AdminPassword)
	cfg.LXDUnixSocket = envOr("LXDDASH_LXD_SOCKET", cfg.LXDUnixSocket)
	cfg.LibvirtURI = envOr("LXDDASH_LIBVIRT_URI", cfg.LibvirtURI)
	cfg.ProxmoxDumpDir = envOr("LXDDASH_PROXMOX_DUMP_DIR", cfg.ProxmoxDumpDir)
	cfg.ProxmoxStaging = envOr("LXDDASH_PROXMOX_STAGING", cfg.ProxmoxStaging)
	cfg.VMImageDir = envOr("LXDDASH_VM_IMAGE_DIR", cfg.VMImageDir)
	cfg.ISODir = envOr("LXDDASH_ISO_DIR", cfg.ISODir)
	cfg.StaticDir = envOr("LXDDASH_STATIC_DIR", cfg.StaticDir)

	return cfg, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}