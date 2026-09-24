#!/usr/bin/env bash
# Pembersihan berkala Docker (dijalankan via cron, Minggu 03:30 server time)
# Membersihkan build cache tidak terpakai + image dangling (semua umur).
# Image aktif dan volume (Postgres/WAHA/Redis) TIDAK disentuh.
# REVISI FASE 1R: hapus filter until=168h (menyebabkan 15GB cache mengendap), log ke storage/ agar tanpa sudo.
set -uo pipefail
LOG_FILE="/opt/wa-clinic-bot/storage/docker-prune.log"
mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] docker-prune start" >> "$LOG_FILE" 2>&1 || true
docker builder prune -af >> "$LOG_FILE" 2>&1 || true
docker image prune -f >> "$LOG_FILE" 2>&1 || true
echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] docker-prune done" >> "$LOG_FILE" 2>&1 || true