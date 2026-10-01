#!/usr/bin/env bash
#
# LXD Dash installer for Ubuntu/Debian servers
#
# Quick install (one-liner from GitHub):
#   curl -sL https://raw.githubusercontent.com/Thorinas112/lxddash/master/deploy/install.sh | sudo bash
#
# Local install (from cloned repo):
#   sudo bash install.sh               # full install (deps + app)
#   sudo bash install.sh --skip-deps   # only install the app (deps already present)
#   sudo bash install.sh --port 9000   # listen on a custom port
#   sudo bash install.sh --no-proxmox  # skip Proxmox import tooling (qemu-utils, lxd-client)
#   sudo bash install.sh --uninstall   # remove LXD Dash completely
#
# The script looks for a prebuilt binary in this order:
#   1. bin/lxddash-linux   (cross-compiled on Windows: make cross)
#   2. bin/lxddash         (built on the server: make backend)
#   3. Downloads from GitHub releases (if REPO is not a local checkout)
#   4. Builds from source  (requires Go 1.22+)
#
set -euo pipefail

PORT="8080"
SKIP_DEPS=0
WITH_PROXMOX=1
UNINSTALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-deps) SKIP_DEPS=1 ;;
    --no-proxmox) WITH_PROXMOX=0 ;;
    --uninstall) UNINSTALL=1 ;;
    --port=*) PORT="${1#*=}" ;;
    --port) PORT="$2"; shift ;;
    -h|--help)
      sed -n '2,16p' "$0"
      exit 0
      ;;
    *) echo "unknown argument: $1 (see --help)" >&2; exit 1 ;;
  esac
  shift
done

# ---------------------------------------------------------------------------
# Uninstall
# ---------------------------------------------------------------------------
if [[ $UNINSTALL -eq 1 ]]; then
  echo "==> Uninstalling LXD Dash..."
  systemctl disable --now lxddash 2>/dev/null || true
  rm -f /etc/systemd/system/lxddash.service
  systemctl daemon-reload 2>/dev/null || true
  rm -f /usr/local/bin/lxddash
  rm -rf /usr/share/lxddash
  rm -f /etc/lxddash/config.json
  rmdir /etc/lxddash 2>/dev/null || true
  # Keep /var/lib/lxddash (data) — user can remove manually if desired
  echo "==> LXD Dash removed. Data preserved at /var/lib/lxddash"
  echo "    To remove data: sudo rm -rf /var/lib/lxddash"
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

# Progress helpers: numbered phase banners with per-step + total timing.
STEP=0
LAST_T=0
step() {
  STEP=$((STEP + 1))
  echo ""
  if [[ $STEP -eq 1 ]]; then
    echo "==> [1/6] $*"
  else
    echo "==> [$STEP/6] $*  (previous step: $((SECONDS - LAST_T))s)"
  fi
  LAST_T=$SECONDS
}

# ---------------------------------------------------------------------------
# 0. Prerequisites
# ---------------------------------------------------------------------------
if [[ $EUID -ne 0 ]]; then
  echo "error: run as root: sudo bash install.sh" >&2
  exit 1
fi

if [[ -f /etc/os-release ]]; then
  . /etc/os-release
else
  ID="unknown"
fi
if [[ "$ID" != "ubuntu" && "$ID" != "debian" ]]; then
  echo "error: unsupported distro '$ID' — LXD Dash targets Ubuntu/Debian" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. System dependencies
# ---------------------------------------------------------------------------
if [[ $SKIP_DEPS -eq 0 ]]; then
  step "Installing system dependencies (apt)..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  # qemu-kvm is a virtual package on newer Ubuntu — request qemu-system-x86 explicitly
  apt-get install -y curl ca-certificates git qemu-system-x86 qemu-utils libvirt-daemon-system

  if [[ $WITH_PROXMOX -eq 1 ]]; then
    # qemu-img (disk conversion) + lxc CLI (rootfs import into LXD)
    # zstd/xz-utils/lzop decompress .vma archives before `vma extract`
    apt-get install -y qemu-utils lxd-client zstd xz-utils lzop || true
    # VM imports write qcow2 images + EFI NVRAM into the libvirt image dir;
    # make it group-writable (setgid) so the service user can create files.
    if [[ -d /var/lib/libvirt/images ]]; then
      chown root:libvirt /var/lib/libvirt/images
      chmod 2775 /var/lib/libvirt/images
    fi
  fi

  # Docker (official install script)
  if ! command -v docker >/dev/null 2>&1; then
    echo "==> Installing Docker..."
    curl -fsSL https://get.docker.com | sh
  fi

  # LXD (snap)
  if ! command -v lxc >/dev/null 2>&1 && ! command -v lxd >/dev/null 2>&1; then
    echo "==> Installing LXD (snap)..."
    snap install lxd
  fi

  # Initialise LXD (default storage pool + network) on first install
  if command -v lxd >/dev/null 2>&1; then
    lxd init --auto 2>/dev/null || true
  fi

  # vma (Proxmox VMA extractor) — only available from Proxmox repos
  if [[ $WITH_PROXMOX -eq 1 ]] && ! command -v vma >/dev/null 2>&1; then
    echo "==> NOTE: the 'vma' tool was not found."
    echo "    It is required to import QEMU VM backups from Proxmox."
    echo "    It ships with Proxmox VE only; on Ubuntu you can skip VM imports"
    echo "    (LXC container imports still work) or install it manually."
  fi

  # Start services
  step "Starting runtime services (libvirtd, docker, snap lxd)..."
  systemctl enable --now libvirtd 2>/dev/null || true
  systemctl enable --now docker 2>/dev/null || true
else
  step "System dependencies — skipped (--skip-deps)"
  step "Runtime services — skipped (--skip-deps)"
fi

# ---------------------------------------------------------------------------
# 2. Locate or build the binary
# ---------------------------------------------------------------------------
BINARY=""
for candidate in "$REPO_DIR/bin/lxddash-linux" "$REPO_DIR/bin/lxddash"; do
  if [[ -x "$candidate" ]]; then
    BINARY="$candidate"
    break
  fi
done

# Rebuild when the source tree is newer than a prebuilt binary (e.g. after
# `git pull`) — otherwise a stale binary gets reinstalled forever.
if [[ -n "$BINARY" && -d "$REPO_DIR/internal" ]]; then
  if [[ -n "$(find "$REPO_DIR/internal" "$REPO_DIR/cmd" "$REPO_DIR/go.mod" -type f -newer "$BINARY" 2>/dev/null | head -1)" ]]; then
    echo "==> Source is newer than $BINARY — rebuilding..."
    BINARY=""
  fi
fi

if [[ -n "$BINARY" ]]; then
  step "Go toolchain — not needed (prebuilt binary found)"
  step "Backend binary — reusing $(basename "$BINARY")"
else
  step "Go toolchain (>= 1.26)..."
  # Building from source needs Go >= 1.26 (Incus client requirement);
  # bootstrap the official toolchain if missing or too old.
  if ! command -v go >/dev/null 2>&1 || ! dpkg --compare-versions "$(go env GOVERSION 2>/dev/null | sed 's/^go//')" ge "1.26"; then
    # Reuse a previously bootstrapped toolchain (sudo's secure_path does not
    # include /usr/local/go/bin, so `go` looks missing on every run).
    if [[ -x /usr/local/go/bin/go ]] && dpkg --compare-versions "$(/usr/local/go/bin/go env GOVERSION 2>/dev/null | sed 's/^go//')" ge "1.26"; then
      echo "    using existing toolchain at /usr/local/go"
    else
      GOVER="1.26.1"
      GOARCH_T="$(uname -m)"; case "$GOARCH_T" in aarch64|arm64) GOARCH_T=arm64 ;; *) GOARCH_T=amd64 ;; esac
      echo "    downloading Go ${GOVER} (~78 MB) — progress bar below"
      curl -fL --progress-bar "https://go.dev/dl/go${GOVER}.linux-${GOARCH_T}.tar.gz" -o /tmp/go.tgz
      echo "    extracting to /usr/local/go..."
      rm -rf /usr/local/go
      tar -C /usr/local -xzf /tmp/go.tgz
      rm -f /tmp/go.tgz
    fi
  else
    echo "    $(go version 2>/dev/null || echo 'go') already available"
  fi
  export PATH="$PATH:/usr/local/go/bin"
  if ! command -v go >/dev/null 2>&1; then
    echo "error: no prebuilt binary found and Go could not be installed." >&2
    echo "  Build one on your dev machine with: make cross" >&2
    exit 1
  fi
  step "Compiling backend from source (about a minute)..."
  (cd "$REPO_DIR" && go build -o bin/lxddash-linux ./cmd/server)
  BINARY="$REPO_DIR/bin/lxddash-linux"
  echo "    built $(basename "$BINARY")"
fi

# ---------------------------------------------------------------------------
# 3. Install files
# ---------------------------------------------------------------------------
step "Installing binary and frontend assets..."
echo "    backend: $BINARY"
install -d /usr/local/bin /etc/lxddash /var/lib/lxddash \
  /usr/share/lxddash/web /var/lib/vz/dump /var/lib/libvirt/images
install -m 0755 "$BINARY" /usr/local/bin/lxddash

# Frontend — build from source when dist is missing OR older than web/src
# (needs Node.js 18+); otherwise stale UI assets get reinstalled forever.
NEED_WEB_BUILD=0
if [[ -f "$REPO_DIR/web/package.json" ]]; then
  if [[ ! -f "$REPO_DIR/web/dist/index.html" ]]; then
    NEED_WEB_BUILD=1
  elif [[ -n "$(find "$REPO_DIR/web/src" -type f -newer "$REPO_DIR/web/dist/index.html" 2>/dev/null | head -1)" ]]; then
    NEED_WEB_BUILD=1
  fi
fi
if [[ $NEED_WEB_BUILD -eq 1 ]]; then
  echo "==> building frontend — npm install + vite can take a few minutes..."
  if ! command -v npm >/dev/null 2>&1; then
    apt-get install -y nodejs npm >/dev/null
  fi
  (cd "$REPO_DIR/web" && npm install --no-audit --no-fund && npm run build)
  echo "    frontend built in $((SECONDS - LAST_T))s"
else
  echo "    frontend: using existing web/dist"
fi

# Frontend (built web/dist) — required for the web UI
if [[ -d "$REPO_DIR/web/dist" ]]; then
  cp -r "$REPO_DIR/web/dist/." /usr/share/lxddash/web/
else
  echo "warning: web/dist not found — the web UI will not be served." >&2
  echo "  Build it with: cd web && npm install && npm run build" >&2
fi

step "Configuring and starting the service..."
# Wait for runtime sockets so the app doesn't start against services that
# are still initialising (snap LXD in particular takes a few seconds) —
# detection below and the app's eager connections both depend on this.
echo "==> Waiting for service sockets..."
for i in $(seq 1 30); do
  missing=0
  [[ -S /var/run/docker.sock ]] || missing=1
  [[ -S /var/snap/lxd/common/lxd/unix.socket || -S /var/lib/lxd/unix.socket ]] || missing=1
  [[ -S /run/libvirt/libvirt-sock ]] || missing=1
  if [[ $missing -eq 0 ]]; then
    echo "    all sockets ready (${i}s)"
    break
  fi
  sleep 1
done

# Detect LXD socket (snap vs apt)
LXD_SOCKET="/var/lib/lxd/unix.socket"
if [[ -S /var/snap/lxd/common/lxd/unix.socket ]]; then
  LXD_SOCKET="/var/snap/lxd/common/lxd/unix.socket"
  echo "  Detected snap LXD socket"
elif [[ -S /var/lib/lxd/unix.socket ]]; then
  echo "  Detected apt LXD socket"
else
  echo "  warning: LXD socket not found — LXD features may not work" >&2
fi

# Config (only if not already present)
if [[ ! -f /etc/lxddash/config.json ]]; then
  cat > /etc/lxddash/config.json <<EOF
{
  "listen_addr": ":$PORT",
  "data_dir": "/var/lib/lxddash",
  "static_dir": "/usr/share/lxddash/web",
  "lxd_unix_socket": "$LXD_SOCKET",
  "libvirt_uri": "qemu:///system",
  "proxmox_dump_dir": "/var/lib/vz/dump",
  "proxmox_staging": "/var/lib/lxddash/staging",
  "vm_image_dir": "/var/lib/libvirt/images"
}
EOF
  echo "==> Wrote /etc/lxddash/config.json (listen port $PORT)"
else
  echo "==> Keeping existing /etc/lxddash/config.json"
fi

# Sudoers — allow lxddash user to run apt/dnf without password (for updates page)
SUDOERS_FILE="/etc/sudoers.d/lxddash"
if [[ ! -f "$SUDOERS_FILE" ]]; then
  # Detect the user that will run the service (default: root)
  SVC_USER="root"
  if id lxddash >/dev/null 2>&1; then
    SVC_USER="lxddash"
  fi
  cat > "$SUDOERS_FILE" <<EOF
# LXD Dash — allow software updates from the web UI
$SVC_USER ALL=(ALL) NOPASSWD: /usr/bin/apt, /usr/bin/apt-get, /usr/bin/dnf
EOF
  chmod 0440 "$SUDOERS_FILE"
  echo "==> Wrote $SUDOERS_FILE"
fi

# systemd unit — always restart so a newly installed binary actually takes
# effect (enable --now is a no-op on an already-running service).
install -m 0644 "$SCRIPT_DIR/lxddash.service" /etc/systemd/system/lxddash.service
systemctl daemon-reload
systemctl enable lxddash
systemctl restart lxddash

# ---------------------------------------------------------------------------
# 4. Done
# ---------------------------------------------------------------------------
sleep 1
if systemctl is-active --quiet lxddash; then
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo
  echo "============================================================"
  echo " LXD Dash installed and running!"
  echo "   Duration:  ${SECONDS}s total"
  echo "   URL:      http://${IP:-<server-ip>}:$PORT"
  echo "   First run: the browser will ask you to create the admin"
  echo "              account (username + password)"
  echo "   Logs:     journalctl -u lxddash -f"
  echo "   Config:   /etc/lxddash/config.json"
  echo "============================================================"
else
  echo "error: the lxddash service failed to start." >&2
  echo "  Check the logs: journalctl -u lxddash -n 50" >&2
  exit 1
fi