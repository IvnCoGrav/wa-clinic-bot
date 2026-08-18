#!/usr/bin/env bash
# clean-trigger.sh — Dipanggil cron tiap menit di server produksi.
# Jika ada file request dari bot (storage/.clean-request, berisi chatId Telegram),
# jalankan server-clean.sh, tulis hasil ke storage/.clean-result, lalu hapus request.
#
# Cron entry (server):
#   * * * * * /opt/wa-clinic-bot/scripts/clean-trigger.sh
set -uo pipefail

BASE_DIR="/opt/wa-clinic-bot"
REQUEST_FILE="$BASE_DIR/storage/.clean-request"
RESULT_FILE="$BASE_DIR/storage/.clean-result"

if [ ! -f "$REQUEST_FILE" ]; then
  exit 0
fi

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] $*" >> /var/log/server-clean.log; }

log "clean-trigger: request terdeteksi ($(cat "$REQUEST_FILE" 2>/dev/null | head -c 200))"

# Jalankan clean (butuh akses docker + apt — umumnya user sudah punya; fallback sudo)
if bash "$BASE_DIR/scripts/server-clean.sh" > "$RESULT_FILE.tmp" 2>&1; then
  mv "$RESULT_FILE.tmp" "$RESULT_FILE"
  log "clean-trigger: selesai OK"
else
  mv "$RESULT_FILE.tmp" "$RESULT_FILE"
  log "clean-trigger: selesai (dengan error, lihat result)"
fi

rm -f "$REQUEST_FILE"
chmod 666 "$RESULT_FILE" 2>/dev/null || true
log "clean-trigger: request dihapus, result ditulis"
