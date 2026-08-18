#!/usr/bin/env bash
# server-clean.sh — Pembersihan server produksi (dipanggil oleh clean-trigger.sh
# saat ada request dari Telegram /clean, atau manual via cron / SSH).
#
# AMAN: HANYA membersihkan yang tidak berbahaya:
#   - Build cache Docker (semua umur — build berikutnya akan rebuild dari awal)
#   - Image Docker dangling (tidak terpakai)
#   - Cache apt + file temp + log lama (.gz / journal vacuum)
# TIDAK disentuh: image aktif, container, volume (Postgres/WAHA/Redis/Caddy).
set -uo pipefail

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] $*"; }

log "server-clean start"

# 1. Docker build cache (reclaim terbesar — bisa puluhan GB)
docker builder prune -af 2>/dev/null | tail -2 || true

# 2. Docker dangling image
docker image prune -f 2>/dev/null | tail -2 || true

# 3. Cache apt + temp
apt-get clean 2>/dev/null || true
rm -rf /var/lib/apt/lists/* 2>/dev/null || true
rm -rf /tmp/* /var/tmp/* 2>/dev/null || true

# 4. Log lama: rotasi .gz + vacuum journal ke 50MB
find /var/log -name "*.gz" -delete 2>/dev/null || true
journalctl --vacuum-size=50M 2>/dev/null | tail -1 || true

log "server-clean done"
df -h / | tail -1
