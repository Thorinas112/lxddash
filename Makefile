BINARY := bin/lxddash
LINUX_BINARY := bin/lxddash-linux

.PHONY: all frontend backend build cross install clean dev

all: build

frontend:
	cd web && npm install && npm run build

backend:
	go build -o $(BINARY) ./cmd/server

build: frontend backend

# Cross-compile a Linux binary (e.g. from Windows) for the Ubuntu server
cross: frontend
	GOOS=linux GOARCH=amd64 go build -o $(LINUX_BINARY) ./cmd/server
	@echo "Built $(LINUX_BINARY) — copy it to the server and run deploy/install.sh"

install: build
	sudo install -m 0755 $(BINARY) /usr/local/bin/lxddash
	sudo install -m 0644 deploy/lxddash.service /etc/systemd/system/lxddash.service
	sudo systemctl daemon-reload
	@echo "Done. Start with: sudo systemctl enable --now lxddash"

dev:
	cd web && npm run dev

clean:
	rm -rf bin web/dist