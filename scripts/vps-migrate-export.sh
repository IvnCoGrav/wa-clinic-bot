#!/usr/bin/env bash
# =============================================================================
# vps-migrate-export.sh — Export Data & Volume Sesi WAHA di Server Lama
# 
# Dijalankan di SERVER LAMA (43.157.197.148):
#   bash scripts/vps-migrate-export.sh
# =============================================================================
set -euo pipefail

APP_DIR="/opt/wa-clinic-bot"
BACKUP_DIR="$APP_DIR/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BUNDLE_NAME="wa-clinic-migration-$TIMESTAMP"
BUNDLE_TAR="$BACKUP_DIR/$BUNDLE_NAME.tar.gz"

cd "$APP_DIR"
mkdir -p "$BACKUP_DIR"
TMP_DIR="/tmp/$BUNDLE_NAME"
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"

echo "======================================================"
echo "==> [1/6] PENGHENTIAN GRACEFUL APP & WAHA ..."
echo "======================================================"
echo "Menghentikan app dan waha agar tidak ada pesan/data baru masuk saat dump..."
docker compose stop app waha
echo "Container app & waha telah berhenti. Database Postgres masih aktif."

echo
echo "======================================================"
echo "==> [2/6] DUMP DATABASE POSTGRESQL (wa_clinic_db) ..."
echo "======================================================"
# Catat statistik data sebelum dump untuk verifikasi
echo "Mencatat statistik tabel utama..."
docker compose exec -T postgres psql -U postgres -d wa_clinic_db -t -c "
SELECT 'customers: ' || count(*) FROM customers
UNION ALL
SELECT 'conversations: ' || count(*) FROM conversations
UNION ALL
SELECT 'messages: ' || count(*) FROM messages
UNION ALL
SELECT 'reservations: ' || count(*) FROM reservations
UNION ALL
SELECT 'ad_clicks: ' || count(*) FROM ad_clicks
UNION ALL
SELECT 'knowledge_chunks: ' || count(*) FROM knowledge_chunks;
" > "$TMP_DIR/db_stats.txt"
cat "$TMP_DIR/db_stats.txt"

echo "Melakukan dump SQL database..."
docker compose exec -T postgres pg_dump -U postgres -d wa_clinic_db --clean --if-exists | gzip -9 > "$TMP_DIR/wa_clinic_db.sql.gz"
echo "Dump database selesai: $(du -sh "$TMP_DIR/wa_clinic_db.sql.gz" | cut -f1)"

echo
echo "======================================================"
echo "==> [3/6] BACKUP SESI WHATSAPP (waha_sessions) ..."
echo "======================================================"
echo "Mengarsipkan volume sesi WhatsApp..."
docker run --rm -v wa-clinic-bot_waha_sessions:/data -v "$TMP_DIR":/backup alpine tar -czf /backup/waha_sessions.tar.gz -C /data .
echo "Arsip sesi WAHA selesai: $(du -sh "$TMP_DIR/waha_sessions.tar.gz" | cut -f1)"

echo
echo "======================================================"
echo "==> [4/6] BACKUP SERTIFIKAT SSL (caddy_data) ..."
echo "======================================================"
echo "Mengarsipkan volume Caddy SSL..."
docker run --rm -v wa-clinic-bot_caddy_data:/data -v "$TMP_DIR":/backup alpine tar -czf /backup/caddy_data.tar.gz -C /data .
echo "Arsip Caddy selesai: $(du -sh "$TMP_DIR/caddy_data.tar.gz" | cut -f1)"

echo
echo "======================================================"
echo "==> [5/6] BACKUP STORAGE & .ENV ..."
echo "======================================================"
if [ -d "$APP_DIR/storage" ]; then
  tar -czf "$TMP_DIR/storage.tar.gz" -C "$APP_DIR" storage
  echo "Arsip storage selesai: $(du -sh "$TMP_DIR/storage.tar.gz" | cut -f1)"
fi
cp "$APP_DIR/.env" "$TMP_DIR/.env"
echo "File .env disalin."

echo
echo "======================================================"
echo "==> [6/6] PACKAGING MIGRATION BUNDLE ..."
echo "======================================================"
tar -czf "$BUNDLE_TAR" -C "/tmp" "$BUNDLE_NAME"
sha256sum "$BUNDLE_TAR" > "$BUNDLE_TAR.sha256"

# Bersihkan direktori temporary
rm -rf "$TMP_DIR"

echo "======================================================"
echo "==> [7/7] TRANSFER BUNDLE KE VPS BARU (FAST INTERNAL) ..."
echo "======================================================"
scp -P 1403 -o StrictHostKeyChecking=no "$BUNDLE_TAR" "$BUNDLE_TAR.sha256" ubuntu@10.11.25.104:/opt/
echo "Bundle berhasil ditransfer ke VPS baru di /opt/"

echo "======================================================"
echo "✅ EXPORT & TRANSFER KE VPS BARU SELESAI!"
echo "Lokasi Arsip : $BUNDLE_TAR"
echo "Ukuran Total : $(du -sh "$BUNDLE_TAR" | cut -f1)"
echo "Checksum     : $(cat "$BUNDLE_TAR.sha256")"
echo "======================================================"
echo "Langkah selanjutnya: Jalankan import di VPS Baru:"
echo "  ssh klinik-server-baru 'bash /opt/wa-clinic-bot/scripts/vps-migrate-import.sh'"
