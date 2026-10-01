# LXD Dash

A self-hosted, Proxmox-style web dashboard for managing an Ubuntu server's **Docker containers**, **LXD containers**, and **KVM/QEMU virtual machines** — including migration of existing **Proxmox** containers and VMs.

## Features

- **Host overview** — live CPU / memory / disk / network stats over WebSocket
- **Docker** — list, create, start, stop, restart, delete containers; view logs; pull images
- **LXD** — list, create (from image), start, stop, restart, delete instances; snapshots (create / restore / delete)
- **KVM/QEMU (libvirt)** — create VMs, start/stop/reboot/delete, snapshots, resize, autostart; in-browser VNC console + serial terminal; network interfaces table + open-port discovery with one-click localhost port forwards
- **Proxmox migration** — import vzdump backups: LXC containers → LXD, QEMU VMs → libvirt (compressed archives decompressed automatically; OVMF/UEFI VMs supported)
- **Port forwards** — expose container/VM service ports on the host, persisted across restarts
- **Activity log** — audit trail of management actions, persisted across restarts
- **Auth** — JWT login; on first run a setup page lets you create the admin account

## Architecture

| Layer    | Tech |
|----------|------|
| Backend  | Go (single static binary) — official Docker (moby), LXD (incus) and libvirt clients |
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| Realtime | WebSocket (`/api/ws`) broadcasting host stats every 2s |

```
cmd/server/            entry point
internal/api/          HTTP router, auth middleware, WebSocket hub
internal/auth/         JWT + bcrypt
internal/handlers/     REST handlers
internal/services/     docker / lxd / libvirt / proxmox / host clients
web/                   React frontend (Vite)
deploy/                systemd unit
```

## Requirements (Ubuntu server)

```bash
# Docker (for Docker management)
curl -fsSL https://get.docker.com | sh

# LXD (for LXD management)
snap install lxd && lxd init

# KVM/QEMU + libvirt (for VM management)
apt install -y qemu-system-x86 qemu-utils libvirt-daemon-system

# Proxmox imports only
apt install -y qemu-utils lxd-client zstd xz-utils lzop  # qemu-img, lxc CLI, decompressors
# the 'vma' tool comes from Proxmox (not in Ubuntu repos): apt install vma
```

## Build

Requires Go 1.26+ (the Incus client requires it) and Node.js 18+.

```bash
make build          # builds web/ + backend into bin/lxddash
# or separately:
make frontend
make backend
```

## Install & run

### Option A — one-liner install (fresh server)

On a fresh Ubuntu/Debian server, run this single command:

```bash
curl -sL https://raw.githubusercontent.com/Thorinas112/lxddash/master/deploy/quick-install.sh | sudo bash
```

This installs Docker, LXD, libvirt/KVM, downloads the latest binary, creates
the systemd service, and prints the URL + admin setup instructions.

### Option B — install script (from cloned repo)

On your Ubuntu server, with this repo checked out (or just the `deploy/`
folder + a built binary):

```bash
sudo bash deploy/install.sh
```

The script installs Docker, LXD, KVM/libvirt and the app itself, writes
`/etc/lxddash/config.json`, and starts the `lxddash` systemd service.

Useful flags:

```bash
sudo bash deploy/install.sh --skip-deps   # deps already installed
sudo bash deploy/install.sh --port 9000   # custom port
sudo bash deploy/install.sh --no-proxmox  # skip Proxmox import tooling
```

If you built on another machine, copy the binary + frontend first:

```bash
# on the dev machine (Windows/macOS):
make cross          # builds bin/lxddash-linux + web/dist
scp -r bin/lxddash-linux web/dist deploy user@server:/tmp/lxddash/
# on the server:
sudo bash /tmp/lxddash/deploy/install.sh
```

### Option C — Docker

```bash
cd deploy
docker compose up -d
```

Requires the host sockets (`/var/run/docker.sock`, `/var/lib/lxd/unix.socket`,
`/var/run/libvirt/libvirt-sock`) to be present. Uses host networking so the
VNC console works. Note: QEMU VM imports from Proxmox need the `vma` tool,
which is not available inside the container.

### Option D — manual (make install)

```bash
make build
sudo make install
sudo systemctl enable --now lxddash
```

On first start, open `http://<server>:8080` — you'll be shown a setup page to
create the admin account (username + password, min 8 chars). After that, log in
with those credentials. Credentials are stored (bcrypt-hashed) in
`/var/lib/lxddash/admin.json`.

### Configuration

`/etc/lxddash/config.json` (optional; every key can also be set via `LXDDASH_*` env vars):

### Uninstall

```bash
sudo bash deploy/install.sh --uninstall
# or manually:
sudo systemctl stop lxddash
sudo systemctl disable lxddash
sudo rm -f /etc/systemd/system/lxddash.service /usr/local/bin/lxddash
sudo rm -rf /usr/share/lxddash /etc/lxddash
# Data is preserved at /var/lib/lxddash — remove if desired:
sudo rm -rf /var/lib/lxddash
```

```json
{
  "listen_addr": ":8080",
  "data_dir": "/var/lib/lxddash",
  "admin_user": "admin",
  "admin_password": "change-me",
  "lxd_unix_socket": "/var/lib/lxd/unix.socket",
  "libvirt_uri": "qemu:///system",
  "proxmox_dump_dir": "/var/lib/vz/dump",
  "proxmox_staging": "/var/lib/lxddash/staging",
  "vm_image_dir": "/var/lib/libvirt/images",
  "iso_dir": "/var/lib/libvirt/iso",
  "static_dir": "web/dist"
}
```

## Migrating from Proxmox

1. Copy your vzdump backups to the server's dump directory (default `/var/lib/vz/dump`):
   ```bash
   scp root@proxmox:/var/lib/vz/dump/vzdump-*.{tar,vma}.* server:/var/lib/vz/dump/
   ```
2. Open the **Proxmox** page in LXD Dash and click **Import** on a backup.
3. Track progress in the *Import tasks* table.

How imports work:

- **LXC backups** (`vzdump-lxc-*.tar.zst|gz|xz|lzo`) — the archive is extracted, the PVE config
  (hostname, memory, cores, rootfs size) is parsed, an LXD container is created, and the rootfs
  is pushed into it with `lxc file push`. Requires the `lxc` CLI.
- **QEMU backups** (`vzdump-qemu-*.vma.zst|gz|xz|lzo`) — decompressed automatically, extracted
  with the `vma` tool, the disk is converted to qcow2 with `qemu-img`, and a libvirt domain is
  defined (VNC console included). Requires `vma`, `qemu-utils`, and the matching decompressor
  (`zstd`, `gzip`, `xz-utils`, or `lzop`).

> Note: network config from Proxmox (bridges) is not carried over — imported containers/VMs
> attach to the LXD/libvirt default network. Adjust networking after import as needed.

## Development

```bash
# terminal 1: backend
go run ./cmd/server

# terminal 2: frontend with hot reload (proxies /api to :8080)
cd web && npm run dev
```

## API overview

```
POST /api/auth/login
GET  /api/dashboard/overview
GET  /api/docker/containers | POST /api/docker/containers
POST /api/docker/containers/{id}/start|stop|restart   DELETE /api/docker/containers/{id}
GET  /api/docker/containers/{id}/logs
GET  /api/docker/images | POST /api/docker/images/pull | DELETE /api/docker/images/{id}
GET  /api/lxd/instances | POST /api/lxd/instances
POST /api/lxd/instances/{name}/start|stop|restart      DELETE /api/lxd/instances/{name}
GET  /api/lxd/instances/{name}/snapshots | POST .../snapshots
POST .../snapshots/{snapshot}/restore                  DELETE .../snapshots/{snapshot}
GET  /api/vms | POST /api/vms | GET /api/vms/isos | POST /api/vms/isos/upload
POST /api/vms/{uuid}/start|shutdown|reboot|force-stop | DELETE /api/vms/{uuid}
GET  /api/vms/{uuid}/vnc        (WebSocket VNC proxy)
GET  /api/proxmox/backups | POST /api/proxmox/import | GET /api/proxmox/tasks
WS   /api/ws                    (live overview stream)
```