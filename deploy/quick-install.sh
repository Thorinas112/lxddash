#!/usr/bin/env bash
#
# LXD Dash — one-liner installer for fresh Ubuntu/Debian servers
#
# Usage:
#   curl -sL https://raw.githubusercontent.com/Thorinas112/lxddash/master/deploy/quick-install.sh | sudo bash
#
# What this does:
#   1. Installs Docker, LXD (snap), libvirt/qemu-kvm + tools
#   2. Fetches LXD Dash — GitHub release assets when available, otherwise a
#      shallow git clone built from source (Go toolchain auto-installed)
#   3. Delegates to deploy/install.sh for install + config + systemd
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
apt-get install -y curl ca-certificates git jq tar

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
SRC_DIR="/tmp/lxddash-src"
rm -rf "$SRC_DIR"
FETCHED=0
if [[ "$VERSION" != "dev" ]]; then
  log "Trying release assets ($VERSION)..."
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64)  ARCH="amd64" ;;
    aarch64) ARCH="arm64" ;;
    *)       ARCH="amd64" ;;
  esac
  if [[ "$VERSION" == "latest" ]]; then
    BASE="https://github.com/$REPO/releases/latest/download"
  else
    BASE="https://github.com/$REPO/releases/download/${VERSION}"
  fi
  mkdir -p "$SRC_DIR/bin" "$SRC_DIR/web"
  if curl -fsSL "$BASE/lxddash-linux-${ARCH}" -o "$SRC_DIR/bin/lxddash-linux" \
     && curl -fsSL "$BASE/lxddash-web.tar.gz" -o "$SRC_DIR/web-dist.tar.gz"; then
    mkdir -p "$SRC_DIR/web/dist"
    tar -xzf "$SRC_DIR/web-dist.tar.gz" -C "$SRC_DIR/web/dist"
    rm -f "$SRC_DIR/web-dist.tar.gz"
    chmod +x "$SRC_DIR/bin/lxddash-linux"
    FETCHED=1
    log "Release assets downloaded"
  else
    rm -rf "$SRC_DIR"
    warn "Release assets unavailable — falling back to a git clone + source build"
  fi
fi
if [[ $FETCHED -eq 0 ]]; then
  log "Cloning https://github.com/$REPO.git (master)..."
  git clone --depth 1 "https://github.com/$REPO.git" "$SRC_DIR"
fi

log "Running deploy/install.sh (install + config + systemd)..."
bash "$SRC_DIR/deploy/install.sh" --port "$PORT"
