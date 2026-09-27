#!/usr/bin/env bash
#
# LXD Dash — one-liner installer for fresh Ubuntu/Debian servers
#
# Usage:
#   curl -sL https://raw.githubusercontent.com/YOUR_ORG/lxddash/main/deploy/quick-install.sh | sudo bash
#
# What this does:
#   1. Installs Docker, LXD (snap), libvirt, qemu-kvm
#   2. Downloads the latest LXD Dash release binary
#   3. Installs the frontend + backend
#   4. Creates a systemd service
#   5. Prints the admin password
#
set -euo pipefail

REPO="${LXDDASH_REPO:-Thorinas112/lxddash}"
VERSION="${LXDDASH_VERSION:-latest}"
PORT="${LXDDASH_PORT:-8080}"
INSTALL_DIR="/usr/local/bin"
DATA_DIR="/var/lib/lxddash"
WEB_DIR="/usr/share/lxddash/web"
CONFIG_DIR="/etc/lxddash"

# Colors (only if terminal supports it)
if [[ -t 1 ]]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'
else
  RED=''; GREEN=''; BLUE=''; BOLD=''; RESET=''
fi

log()  { echo -e "${GREEN}==>${RESET} $*"; }
warn() { echo -e "${RED}warning:${RESET} $*" >&2; }
die()  { echo -e "${RED}error:${RESET} $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------
[[ $EUID -eq 0 ]] || die "Run as root: sudo bash $0"

if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  [[ "$ID" == "ubuntu" || "$ID" == "debian" ]] || die "Unsupported distro: $ID (Ubuntu/Debian required)"
else
  die "Cannot detect OS (/etc/os-release missing)"
fi

echo -e "${BOLD}LXD Dash Installer${RESET}"
echo "  Distro:  $PRETTY_NAME"
echo "  Port:    $PORT"
echo "  Version: $VERSION"
echo ""

# ---------------------------------------------------------------------------
# 1. System dependencies
# ---------------------------------------------------------------------------
log "Installing system dependencies..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates jq

# Docker
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
fi

# LXD (snap)
if ! command -v lxc >/dev/null 2>&1; then
  log "Installing LXD (snap)..."
  snap install lxd
fi
lxd init --auto 2>/dev/null || true

# libvirt + KVM
if ! systemctl is-active --quiet libvirtd 2>/dev/null; then
  log "Installing libvirt + KVM..."
  apt-get install -y qemu-kvm libvirt-daemon-system libvirt-clients || true
fi
systemctl enable --now libvirtd 2>/dev/null || true

# Add current user to groups (if not root)
REAL_USER="${SUDO_USER:-root}"
if [[ "$REAL_USER" != "root" ]]; then
  usermod -aG docker,lxd,libvirt "$REAL_USER" 2>/dev/null || true
  log "Added $REAL_USER to docker, lxd, libvirt groups"
fi

# ---------------------------------------------------------------------------
# 2. Download or locate the binary
# ---------------------------------------------------------------------------
BINARY=""
for candidate in "$PWD/bin/lxddash-linux" "$PWD/bin/lxddash"; do
  if [[ -x "$candidate" ]]; then
    BINARY="$candidate"
    break
  fi
done

if [[ -z "$BINARY" && "$VERSION" != "dev" ]]; then
  log "Downloading LXD Dash $VERSION..."
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64)  ARCH="amd64" ;;
    aarch64) ARCH="arm64" ;;
    *)       die "Unsupported architecture: $ARCH" ;;
  esac

  if [[ "$VERSION" == "latest" ]]; then
    DOWNLOAD_URL="https://github.com/$REPO/releases/latest/download/lxddash-linux-${ARCH}"
  else
    DOWNLOAD_URL="https://github.com/$REPO/releases/download/${VERSION}/lxddash-linux-${ARCH}"
  fi

  mkdir -p "$INSTALL_DIR"
  curl -sL "$DOWNLOAD_URL" -o "$INSTALL_DIR/lxddash" || die "Download failed: $DOWNLOAD_URL"
  chmod +x "$INSTALL_DIR/lxddash"
  BINARY="$INSTALL_DIR/lxddash"
fi

if [[ -z "$BINARY" ]]; then
  die "No binary found. Build with 'make cross' or set LXDDASH_VERSION."
fi

# ---------------------------------------------------------------------------
# 3. Install
# ---------------------------------------------------------------------------
log "Installing LXD Dash..."
mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$DATA_DIR" "$WEB_DIR" /var/lib/vz/dump /var/lib/libvirt/images
install -m 0755 "$BINARY" "$INSTALL_DIR/lxddash"

# Frontend — check common locations
for dist in "$PWD/web/dist" "/tmp/lxddash-web/dist"; do
  if [[ -d "$dist" ]]; then
    cp -r "$dist/." "$WEB_DIR/"
    log "Installed frontend from $dist"
    break
  fi
done

# Detect LXD socket
LXD_SOCKET="/var/lib/lxd/unix.socket"
if [[ -S /var/snap/lxd/common/lxd/unix.socket ]]; then
  LXD_SOCKET="/var/snap/lxd/common/lxd/unix.socket"
  log "Detected snap LXD socket"
fi

# Config
if [[ ! -f "$CONFIG_DIR/config.json" ]]; then
  cat > "$CONFIG_DIR/config.json" <<EOF
{
  "listen_addr": ":$PORT",
  "data_dir": "$DATA_DIR",
  "static_dir": "$WEB_DIR",
  "lxd_unix_socket": "$LXD_SOCKET",
  "libvirt_uri": "qemu:///system",
  "proxmox_dump_dir": "/var/lib/vz/dump",
  "proxmox_staging": "$DATA_DIR/staging",
  "vm_image_dir": "/var/lib/libvirt/images"
}
EOF
  log "Wrote $CONFIG_DIR/config.json"
else
  log "Keeping existing config"
fi

# Sudoers for updates page
SUDOERS="/etc/sudoers.d/lxddash"
if [[ ! -f "$SUDOERS" ]]; then
  cat > "$SUDOERS" <<EOF
# LXD Dash — allow software updates from the web UI
$REAL_USER ALL=(ALL) NOPASSWD: /usr/bin/apt, /usr/bin/apt-get, /usr/bin/dnf
EOF
  chmod 0440 "$SUDOERS"
  log "Wrote $SUDOERS"
fi

# systemd
cat > /etc/systemd/system/lxddash.service <<'EOF'
[Unit]
Description=LXD Dash - server management dashboard
After=network-online.target lxd.service libvirtd.service docker.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/lxddash -config /etc/lxddash/config.json
Restart=on-failure
RestartSec=5
SupplementaryGroups=docker lxd libvirt

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now lxddash

# ---------------------------------------------------------------------------
# 4. Done
# ---------------------------------------------------------------------------
sleep 2
if systemctl is-active --quiet lxddash; then
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo ""
  echo "============================================================"
  echo -e " ${BOLD}LXD Dash installed and running!${RESET}"
  echo ""
  echo "   URL:      http://${IP:-<server-ip>}:$PORT"
  echo "   First run: the browser will ask you to create the admin"
  echo "              account (username + password)"
  echo "   Logs:     journalctl -u lxddash -f"
  echo "   Config:   $CONFIG_DIR/config.json"
  echo "   Uninstall: sudo systemctl stop lxddash && sudo rm -f /etc/systemd/system/lxddash.service && sudo rm -f $INSTALL_DIR/lxddash"
  echo "============================================================"
else
  die "The lxddash service failed to start. Check: journalctl -u lxddash -n 50"
fi
