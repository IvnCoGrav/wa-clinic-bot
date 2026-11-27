#!/usr/bin/env bash
# =============================================================================
# vps-migrate-export.sh — Export Data & Volume Sesi WAHA di Server Lama
# 
# Dijalankan di SERVER LAMA (43.157.197.148):
#   bash scripts/vps-migrate-export.sh
# =============================================================================
set -euo pipefail
# F7/M17-13: semua artefak migrasi memuat PII & .env — direktori/berkas privat.
umask 077

APP_DIR="/opt/wa-clinic-bot"
BACKUP_DIR="$APP_DIR/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BUNDLE_NAME="wa-clinic-migration-$TIMESTAMP"
BUNDLE_TAR="$BACKUP_DIR/$BUNDLE_NAME.tar.gz"
BUNDLE_ENC="$BUNDLE_TAR.enc"

cd "$APP_DIR"
mkdir -p "$BACKUP_DIR"

# Kunci enkripsi diambil dari environment; fallback baca aman dari .env
# (tanpa `source`/xargs — nilai tidak dieksekusi dan tidak dipecah spasi).
if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ] && [ -f "$APP_DIR/.env" ]; then
  BACKUP_ENCRYPTION_KEY="$(sed -n 's/^BACKUP_ENCRYPTION_KEY=//p' "$APP_DIR/.env" | head -1 | tr -d '"')"
  export BACKUP_ENCRYPTION_KEY
fi
TMP_DIR="/tmp/$BUNDLE_NAME"
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"
chmod 700 "$TMP_DIR"

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
docker run --rm -v wa-clinic-bot_waha_sessions:/data -v "$TMP_DIR":/backup alpine:3@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf tar -czf /backup/waha_sessions.tar.gz -C /data .
echo "Arsip sesi WAHA selesai: $(du -sh "$TMP_DIR/waha_sessions.tar.gz" | cut -f1)"

echo
echo "======================================================"
echo "==> [4/6] BACKUP SERTIFIKAT SSL (caddy_data) ..."
echo "======================================================"
echo "Mengarsipkan volume Caddy SSL..."
docker run --rm -v wa-clinic-bot_caddy_data:/data -v "$TMP_DIR":/backup alpine:3@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf tar -czf /backup/caddy_data.tar.gz -C /data .
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
chmod 600 "$TMP_DIR/.env"
echo "File .env disalin (mode 600, ikut terenkripsi bersama bundel)."

echo
echo "======================================================"
echo "==> [6/6] PACKAGING + ENKRIPSI MIGRATION BUNDLE ..."
echo "======================================================"
tar -czf "$BUNDLE_TAR" -C "/tmp" "$BUNDLE_NAME"

# F7/M17-13: bundel WAJIB dienkripsi sebelum meninggalkan server (format ENC1,
# AES-256-GCM — kontrak yang sama dengan scripts/backup.sh). Fail-closed bila
# kunci tidak ada; plaintext tidak boleh disimpan/ditransfer.
if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ]; then
  echo "ERROR: BACKUP_ENCRYPTION_KEY kosong. Bundel migrasi plaintext DILARANG." >&2
  rm -f "$BUNDLE_TAR"
  exit 1
fi
npx tsx scripts/encrypt-backup.ts "$BUNDLE_TAR" "$BUNDLE_ENC"
if [ "$(head -c 4 "$BUNDLE_ENC")" != "ENC1" ]; then
  echo "ERROR: magic header ENC1 tidak ditemukan pada bundel terenkripsi." >&2
  rm -f "$BUNDLE_ENC"
  exit 1
fi
( cd "$BACKUP_DIR" && sha256sum "$(basename "$BUNDLE_ENC")" > "$(basename "$BUNDLE_ENC").sha256" )
echo "Bundel terenkripsi: $BUNDLE_ENC"

# Bersihkan direktori temporary
rm -rf "$TMP_DIR"

echo "======================================================"
echo "==> [7/7] TRANSFER BUNDLE KE VPS BARU (FAST INTERNAL) ..."
echo "======================================================"
# F7/M17-13: host key diverifikasi (accept-new = TOFU, menolak perubahan key
# berikutnya). Kunci host tidak tersedia saat pertama kali, jadi `yes` mutlak
# akan memblokir migrasi tanpa interaksi manual.
scp -P 1403 -o StrictHostKeyChecking=accept-new \
  "$BUNDLE_ENC" "$BUNDLE_ENC.sha256" ubuntu@10.11.25.104:/opt/
echo "Bundle terenkripsi berhasil ditransfer ke VPS baru di /opt/"

echo "======================================================"
echo "✅ EXPORT & TRANSFER KE VPS BARU SELESAI!"
echo "Lokasi Arsip : $BUNDLE_ENC"
echo "Ukuran Total : $(du -sh "$BUNDLE_ENC" | cut -f1)"
echo "Checksum     : $(cat "$BUNDLE_ENC.sha256")"
echo "======================================================"
echo "Langkah selanjutnya: Jalankan import di VPS Baru:"
echo "  ssh klinik-server-baru 'bash /opt/wa-clinic-bot/scripts/vps-migrate-import.sh'"
