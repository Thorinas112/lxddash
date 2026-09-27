# LXD Dash — containerized build
#
# Build:   docker build -t lxddash .
# Run:     docker compose up -d   (see docker-compose.yml)
#
# NOTE: the container manages the HOST's Docker/LXD/libvirt via mounted
# sockets, and the VNC console proxy needs host networking — use the
# provided docker-compose.yml (network_mode: host) rather than port
# publishing.

# --- Stage 1: build the frontend -------------------------------------------
FROM node:20-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ .
RUN npm run build

# --- Stage 2: build the backend --------------------------------------------
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/lxddash ./cmd/server

# --- Stage 3: runtime --------------------------------------------------------
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      qemu-utils \
      lxd-client \
    && rm -rf /var/lib/apt/lists/*
# Note: the 'vma' tool (Proxmox QEMU imports) is not available on Ubuntu;
# LXC container imports work, QEMU VM imports need a host install of vma.

COPY --from=build /out/lxddash /usr/local/bin/lxddash
COPY --from=web /web/dist /usr/share/lxddash/web

ENV LXDDASH_STATIC_DIR=/usr/share/lxddash/web \
    LXDDASH_DATA_DIR=/var/lib/lxddash \
    LXDDASH_PROXMOX_DUMP_DIR=/var/lib/vz/dump \
    LXDDASH_VM_IMAGE_DIR=/var/lib/libvirt/images

VOLUME ["/var/lib/lxddash", "/var/lib/vz/dump", "/var/lib/libvirt/images"]
EXPOSE 8080

CMD ["lxddash"]