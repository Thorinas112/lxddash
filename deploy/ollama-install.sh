#!/usr/bin/env bash
#
# Resumable Ollama installer — works around flaky connections where the
# official installer's HTTP/2 download of the ~1.6 GB tarball dies mid-stream
# (curl error 92 / "HTTP/2 stream was not closed cleanly: PROTOCOL_ERROR").
# Forces HTTP/1.1 and resumes partial downloads (-C -) until complete,
# verifies the archive, then installs the binary, ollama user, and systemd
# unit directly.
#
# Run as root:  sudo bash deploy/ollama-install.sh
# Safe to re-run: a failed run resumes from where it stopped.
#
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "error: run as root: sudo bash deploy/ollama-install.sh" >&2
  exit 1
fi

URL="https://ollama.com/download/ollama-linux-amd64.tar.zst"
TGZ=/tmp/ollama-linux-amd64.tar.zst

echo "==> Downloading Ollama (HTTP/1.1, resumable)..."
for attempt in $(seq 1 30); do
  # --speed-limit/--speed-time: abandon stalled streams after 15s below
  # 20KB/s so the resume loop restarts them instead of hanging for minutes
  # on a dead connection. -m caps any single attempt at 30 minutes.
  if curl -fL --http1.1 --retry 3 -C - --speed-limit 20000 --speed-time 15 -m 1800 -o "$TGZ" "$URL"; then
    break
  fi
  SIZE=$(stat -c%s "$TGZ" 2>/dev/null || echo 0)
  echo "    attempt $attempt incomplete (${SIZE} bytes so far) — resuming in 3s..."
  sleep 3
  if [[ $attempt -eq 30 ]]; then
    echo "error: download failed after 30 attempts — check connectivity/disk and re-run" >&2
    exit 1
  fi
done

echo "==> Verifying archive..."
if ! zstd -t "$TGZ"; then
  echo "error: archive corrupt — removed; re-run this script to resume" >&2
  rm -f "$TGZ"
  exit 1
fi

echo "==> Installing binary to /usr/local..."
id ollama >/dev/null 2>&1 || useradd -r -s /bin/false -U -m -d /usr/share/ollama ollama
mkdir -p /usr/share/ollama
tar --zstd -xf "$TGZ" -C /usr/local
chown -R ollama:ollama /usr/share/ollama /usr/local/lib/ollama 2>/dev/null || true
rm -f "$TGZ"

echo "==> Writing systemd unit..."
cat > /etc/systemd/system/ollama.service <<'EOF'
[Unit]
Description=Ollama Service
After=network-online.target

[Service]
ExecStart=/usr/local/bin/ollama serve
User=ollama
Group=ollama
Restart=always
RestartSec=3
Environment="HOME=/usr/share/ollama"
Environment="PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now ollama

sleep 2
if systemctl is-active --quiet ollama && curl -s --max-time 3 http://localhost:11434/api/version >/dev/null; then
  echo "============================================================"
  echo " Ollama installed and running!"
  echo "   Version: $(/usr/local/bin/ollama --version 2>/dev/null)"
  echo "   Next: pull a model from the LLM page (e.g. llama3.2:1b)"
  echo "============================================================"
else
  echo "error: ollama service failed to start — check: journalctl -u ollama -n 20" >&2
  exit 1
fi
