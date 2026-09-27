# Workspace Instructions — LXD Dash

LXD Dash is a self-hosted, Proxmox-style web dashboard for managing an Ubuntu
server's Docker containers, LXD containers, and KVM/QEMU virtual machines,
including migration of Proxmox vzdump backups.

## Project structure

- `cmd/server/` — Go entry point
- `internal/api/` — HTTP router, JWT auth middleware, WebSocket hub
- `internal/auth/` — JWT + bcrypt auth service
- `internal/handlers/` — REST handlers (docker, lxd, libvirt, proxmox, dashboard)
- `internal/services/` — backend clients: docker (moby), lxd (incus), libvirt (go-libvirt), proxmox (vzdump import), host (gopsutil)
- `web/` — React 18 + TypeScript + Vite + Tailwind frontend
- `deploy/` — systemd unit file

## Key dependencies (current versions)

- `github.com/moby/moby/client` v0.6.0 + `github.com/moby/moby/api` v1.56.0 (Docker)
- `github.com/lxc/incus` v0.7.0 (LXD client; package name is `incus`, not `lxd`)
- `github.com/digitalocean/go-libvirt` (uses `socket/dialers` package for connections)
- `github.com/shirou/gopsutil/v3` (host stats)
- `github.com/golang-jwt/jwt/v5`, `golang.org/x/crypto/bcrypt`, `github.com/gorilla/websocket`

## Build commands

```bash
# Full build (frontend + backend)
make build

# Backend only (Go 1.22+)
go build -o bin/lxddash ./cmd/server

# Frontend only
cd web && npm install && npm run build
```

The VS Code build task (`.vscode/tasks.json`) runs the frontend and backend
builds. On this Windows dev machine, Go is installed at
`%USERPROFILE%\go-sdk\bin\go.exe` (portable install, not on PATH).

## Run

```bash
# Backend (serves web/dist at :8080)
go run ./cmd/server

# Frontend dev server with hot reload (proxies /api to :8080)
cd web && npm run dev
```

On first run the server generates an admin password and prints it to the
console (also stored in the data dir). Services that cannot connect (Docker,
LXD, libvirt) log warnings and their API endpoints return 503.

## Conventions

- Go: standard library `net/http` with Go 1.22+ method-based routing
  (`mux.HandleFunc("GET /api/...", ...)`), `r.PathValue()` for path params.
- Handlers return JSON via `writeJSON`/`writeErr` helpers.
- Services return typed errors; handlers map them to HTTP status codes.
- Frontend: React Router pages under `web/src/pages/`, shared UI in
  `web/src/components/`, API client in `web/src/api/client.ts`.
- Auth: JWT bearer token stored in `localStorage` (`lxddash_token`); WebSocket
  endpoints accept `?token=` query param.