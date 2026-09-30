#!/usr/bin/env bash
# =============================================================================
# vps-migrate-import.sh — Restore Data, Sesi WAHA & Launch di VPS Baru
# 
# Dijalankan di VPS BARU (43.173.11.79):
#   bash scripts/vps-migrate-import.sh [PATH_TO_BUNDLE_TAR_GZ]
# =============================================================================
set -euo pipefail

APP_DIR="/opt/wa-clinic-bot"
cd "$APP_DIR"

BUNDLE_FILE="${1:-}"
if [ -z "$BUNDLE_FILE" ]; then
  # Cari bundle terbaru di /opt atau $APP_DIR/backups
  BUNDLE_FILE=$(ls -t /opt/wa-clinic-migration-*.tar.gz "$APP_DIR"/backups/wa-clinic-migration-*.tar.gz 2>/dev/null | head -1 || true)
fi

if [ -z "$BUNDLE_FILE" ] || [ ! -f "$BUNDLE_FILE" ]; then
  echo "ERROR: File bundle migrasi tidak ditemukan!"
  echo "Penggunaan: bash scripts/vps-migrate-import.sh /path/to/wa-clinic-migration-*.tar.gz"
  exit 1
fi

echo "======================================================"
echo "==> [1/7] VERIFIKASI & EKSTRAK BUNDLE: $BUNDLE_FILE ..."
echo "======================================================"
if [ -f "$BUNDLE_FILE.sha256" ]; then
  echo "Memeriksa integritas checksum SHA256..."
  sha256sum -c "$BUNDLE_FILE.sha256"
  echo "Integritas bundle VALID ✓"
fi

TMP_DIR="/tmp/migration_restore_$(date +%s)"
mkdir -p "$TMP_DIR"
tar -xzf "$BUNDLE_FILE" -C "$TMP_DIR"

BUNDLE_CONTENT_DIR=$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -1)
if [ -z "$BUNDLE_CONTENT_DIR" ]; then
  BUNDLE_CONTENT_DIR="$TMP_DIR"
fi

echo
echo "======================================================"
echo "==> [2/7] MEMULIHKAN .ENV & STORAGE ..."
echo "======================================================"
cp "$BUNDLE_CONTENT_DIR/.env" "$APP_DIR/.env"
echo "File .env berhasil dipulihkan ✓"

if [ -f "$BUNDLE_CONTENT_DIR/storage.tar.gz" ]; then
  tar -xzf "$BUNDLE_CONTENT_DIR/storage.tar.gz" -C "$APP_DIR"
  echo "Folder storage berhasil dipulihkan: $(du -sh "$APP_DIR/storage" | cut -f1) ✓"
fi

echo
echo "======================================================"
echo "==> [3/7] MEMULIHKAN VOLUME DOCKER (WAHA & CADDY) ..."
echo "======================================================"
# Pastikan volume Docker dibuat
docker volume create wa-clinic-bot_waha_sessions
docker volume create wa-clinic-bot_caddy_data

echo "Memulihkan volume sesi WhatsApp (anti-scan QR)..."
docker run --rm -v wa-clinic-bot_waha_sessions:/data -v "$BUNDLE_CONTENT_DIR":/backup alpine sh -c "rm -rf /data/* && tar -xzf /backup/waha_sessions.tar.gz -C /data"
echo "Sesi WhatsApp berhasil dipulihkan ✓"

echo "Memulihkan volume sertifikat Caddy SSL..."
docker run --rm -v wa-clinic-bot_caddy_data:/data -v "$BUNDLE_CONTENT_DIR":/backup alpine sh -c "rm -rf /data/* && tar -xzf /backup/caddy_data.tar.gz -C /data"
echo "Sertifikat Caddy SSL berhasil dipulihkan ✓"

echo
echo "======================================================"
echo "==> [4/7] MENJALANKAN DATABASE & RESTORE DATA ..."
echo "======================================================"
echo "Memulai container Postgres dan Redis..."
docker compose up -d postgres redis

echo "Menunggu Postgres siap menerima koneksi..."
for i in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U postgres &>/dev/null; then
    break
  fi
  sleep 1
done

echo "Merestore database PostgreSQL dari dump..."
gunzip -c "$BUNDLE_CONTENT_DIR/wa_clinic_db.sql.gz" | docker compose exec -T postgres psql -U postgres -d wa_clinic_db > /dev/null
echo "Database PostgreSQL berhasil direstore ✓"

echo "Verifikasi perbandingan statistik tabel:"
echo "--- Statistik Server Lama ---"
cat "$BUNDLE_CONTENT_DIR/db_stats.txt"
echo "--- Statistik Server Baru ---"
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
"

echo
echo "======================================================"
echo "==> [5/7] BUILD & START CONTAINER APP ..."
echo "======================================================"
docker compose up -d --build app

echo "Menunggu container app healthy..."
for i in $(seq 1 45); do
  if docker compose ps app --format '{{.State}}' 2>/dev/null | grep -q running; then
    break
  fi
  sleep 2
done

echo
echo "======================================================"
echo "==> [6/7] PRISMA MIGRATIONS & DRIFT CHECK ..."
echo "======================================================"
if ! docker compose exec -T app npx prisma migrate deploy; then
  echo "Prisma migrate deploy mendeteksi konflik pitfall, meresolve..."
  docker compose exec -T app npx prisma migrate resolve --applied 20260802000000_add_children || true
  docker compose exec -T app npx prisma migrate deploy
fi

DRIFT=$(docker compose exec -T app sh -c 'npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script' 2>&1 || true)
if echo "$DRIFT" | grep -q "This is an empty migration"; then
  echo "Verifikasi skema DB: NO DRIFT ✓"
else
  echo "WARNING: Ditemukan drift skema Prisma:"
  echo "$DRIFT"
fi

echo
echo "======================================================"
echo "==> [7/7] START WAHA & CADDY SERTA HEALTHCHECK ..."
echo "======================================================"
docker compose up -d waha caddy

echo "Menunggu 5 detik untuk inisialisasi WAHA..."
sleep 5

echo "Status Container:"
docker compose ps

echo
echo "Health Check /health:"
docker compose exec -T app node -e "fetch('http://localhost:3000/health').then(r=>r.text()).then(console.log)" || true

echo
echo "Ready Check /ready:"
docker compose exec -T app node -e "fetch('http://localhost:3000/ready').then(r=>r.text()).then(console.log)" || true

# Bersihkan direktori temporary
rm -rf "$TMP_DIR"

echo "======================================================"
echo "✅ IMPORT & RESTORE DI VPS BARU SELESAI!"
echo "Sistem telah aktif dan berjalan di VPS baru."
echo "Langkah selanjutnya: Arahkan DNS A-Record ke IP VPS Baru (43.173.11.79)."
echo "======================================================"
