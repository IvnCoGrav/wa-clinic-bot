#!/bin/bash
# Script untuk backup otomatis database PostgreSQL dan konfigurasi chatbot
# Versi: 1.0

# 1. Konfigurasi
BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
ARCHIVE_NAME="wa_clinic_bot_backup_$TIMESTAMP.tar.gz"

# Buat folder backup jika belum ada
mkdir -p "$BACKUP_DIR"

echo "=== MEMULAI PROSES CADANGAN (BACKUP) ==="

# 2. Backup Database PostgreSQL
echo "[1/3] Melakukan dump database PostgreSQL..."
if [ -z "$DATABASE_URL" ]; then
  # Fallback jika var tidak diset di shell, coba baca dari .env
  if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
  fi
fi

if [ -z "$DATABASE_URL" ]; then
  echo "⚠️ ERROR: DATABASE_URL tidak didefinisikan! Gagal mem-backup database."
  exit 1
fi

# Ekstrak pg_dump params dari DATABASE_URL atau panggil langsung pg_dump
# Format DATABASE_URL: postgresql://username:password@host:port/database
# Kita bisa langsung menggunakan pg_dump dengan koneksi string
pg_dump "$DATABASE_URL" > "$BACKUP_DIR/db_dump_$TIMESTAMP.sql"

if [ $? -eq 0 ]; then
  echo "✅ Database berhasil di-dump: db_dump_$TIMESTAMP.sql"
else
  echo "⚠️ Gagal melakukan dump database!"
fi

# 3. Kompresi Konfigurasi, Aset, dan Dump Database
echo "[2/3] Mengarsipkan file konfigurasi, aset, dan database..."
# Salin berkas .env ke lokasi aman dengan enkripsi sederhana (misal tar + gzip)
# Kita masukkan berkas database dump, .env, folder config, dan folder assets
tar -czf "$BACKUP_DIR/$ARCHIVE_NAME" \
  "$BACKUP_DIR/db_dump_$TIMESTAMP.sql" \
  .env \
  ./src/config/surabaya_sidoarjo_subdistricts.json \
  ./assets/pricelist_spa.jpg 2>/dev/null

if [ $? -eq 0 ]; then
  echo "✅ Arsip cadangan berhasil dibuat: $BACKUP_DIR/$ARCHIVE_NAME"
  # Bersihkan file sql mentah agar hemat disk space
  rm "$BACKUP_DIR/db_dump_$TIMESTAMP.sql"
else
  echo "⚠️ Gagal membuat arsip kompresi!"
  exit 1
fi

# 4. Selesai
echo "[3/3] Proses backup selesai!"
echo "Lokasi cadangan: $BACKUP_DIR/$ARCHIVE_NAME"
echo "========================================="
