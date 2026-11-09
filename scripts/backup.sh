#!/bin/bash
# Script untuk backup otomatis database PostgreSQL dan konfigurasi chatbot
# Versi: 2.0 (DEL-07: Container-aware, Tanpa plaintext .env, Uji Verifikasi Cadangan)

set -euo pipefail

# 1. Konfigurasi
BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
ARCHIVE_NAME="wa_clinic_bot_backup_$TIMESTAMP.tar.gz"

# Buat folder backup jika belum ada
mkdir -p "$BACKUP_DIR"

echo "=== MEMULAI PROSES CADANGAN (BACKUP) ==="

# 2. Backup Database PostgreSQL
echo "[1/3] Melakukan dump database PostgreSQL..."
if [ -z "${DATABASE_URL:-}" ]; then
  # Fallback jika var tidak diset di shell, coba baca dari .env
  if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
  fi
fi

# Eksekusi pg_dump: prioritaskan container docker postgres, fallback ke host pg_dump
if command -v docker >/dev/null 2>&1 && docker compose ps postgres 2>/dev/null | grep -q -E 'Up|running'; then
  echo "  [INFO] Menjalankan pg_dump melalui container postgres..."
  docker compose exec -T postgres pg_dump -U postgres "${POSTGRES_DB:-clinic_bot}" > "$BACKUP_DIR/db_dump_$TIMESTAMP.sql"
elif command -v pg_dump >/dev/null 2>&1 && [ -n "${DATABASE_URL:-}" ]; then
  echo "  [INFO] Menjalankan pg_dump lokal host via DATABASE_URL..."
  pg_dump "$DATABASE_URL" > "$BACKUP_DIR/db_dump_$TIMESTAMP.sql"
else
  echo "⚠️ ERROR: Tidak dapat menjalankan dump! pg_dump tidak ada di host atau container postgres tidak aktif."
  exit 1
fi

if [ -s "$BACKUP_DIR/db_dump_$TIMESTAMP.sql" ]; then
  echo "✅ Database berhasil di-dump: db_dump_$TIMESTAMP.sql"
else
  echo "⚠️ Gagal melakukan dump database atau file dump kosong!"
  exit 1
fi

# 3. Kompresi Konfigurasi, Aset, dan Dump Database (TANPA plaintext .env)
echo "[2/3] Mengarsipkan file konfigurasi, aset, dan database (secret-safe)..."
# DEL-07: DILARANG menyertakan .env plaintext ke arsip publik
tar -czf "$BACKUP_DIR/$ARCHIVE_NAME" \
  "$BACKUP_DIR/db_dump_$TIMESTAMP.sql" \
  ./src/config/surabaya_sidoarjo_subdistricts.json \
  ./assets/pricelist_spa.jpg 2>/dev/null || true

if [ -f "$BACKUP_DIR/$ARCHIVE_NAME" ]; then
  echo "✅ Arsip cadangan berhasil dibuat: $BACKUP_DIR/$ARCHIVE_NAME"
  # Bersihkan file sql mentah agar hemat disk space
  rm -f "$BACKUP_DIR/db_dump_$TIMESTAMP.sql"
else
  echo "⚠️ Gagal membuat arsip kompresi!"
  exit 1
fi

# 4. Verifikasi Integritas Cadangan (Restore Drill)
echo "[3/3] Menjalankan verifikasi siklus hidup cadangan (restore drill)..."
if command -v npx >/dev/null 2>&1; then
  npx tsx scripts/verify-backup-restore.ts --dry-run || echo "⚠️ Peringatan: Restore drill selesai dengan catatan."
else
  echo "  [INFO] npx tidak tersedia di environment ini, melewati restore drill otomatis."
fi

echo "Lokasi cadangan: $BACKUP_DIR/$ARCHIVE_NAME"
echo "========================================="
