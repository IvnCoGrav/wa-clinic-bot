#!/usr/bin/env bash
# Pembersihan berkala Docker (dijalankan via cron, Minggu 03:30 server time)
# Hanya membersihkan: build cache >7 hari + image dangling.
# Image aktif (WAHA, Postgres, Redis, Caddy, App) dan volume TIDAK disentuh.
set -uo pipefail

echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] docker-prune start" >> /var/log/docker-prune.log

docker builder prune -af --filter "until=168h" >> /var/log/docker-prune.log 2>&1 || true
docker image prune -f >> /var/log/docker-prune.log 2>&1 || true

echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] docker-prune done" >> /var/log/docker-prune.log