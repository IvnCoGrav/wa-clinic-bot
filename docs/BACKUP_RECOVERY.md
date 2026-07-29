# Panduan Backup & Pemulihan Sistem (Disaster Recovery)

Dokumen ini menjelaskan langkah-langkah praktis untuk mencadangkan (backup) dan memulihkan (restore) seluruh data dan konfigurasi sistem WhatsApp Clinic Automation Chatbot dari server VPS.

---

## 💾 1. Mekanisme Backup Otomatis

Backup dilakukan melalui skrip shell [**`backup.sh`**](file:///C:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/scripts/backup.sh). Skrip ini mencadangkan 4 komponen utama:
1.  **Database PostgreSQL Dump** (struktur data dan transaksi)
2.  **Berkas Lingkungan (`.env`)** (seluruh API Key, Database URL, dll.)
3.  **Aset Gambar (`./assets/pricelist_spa.jpg`)** (pricelist yang dikirim otomatis)
4.  **Database Kelurahan Lokal (`./src/config/surabaya_sidoarjo_subdistricts.json`)** (fuzzy match database)

### Konfigurasi Cron Job di VPS Linux (Tiap 6 Jam)
Untuk menjalankan backup secara berkala setiap 6 jam, tambahkan baris berikut ke `crontab` server:

```bash
# Buka crontab editor
crontab -e

# Tambahkan baris berikut (sesuaikan path absolut repositori bot Anda)
0 */6 * * * cd /path/to/wa-clinic-bot && ./scripts/backup.sh >> ./backups/backup.log 2>&1
```

Arsip cadangan akan tersimpan di folder `./backups` dengan format nama `wa_clinic_bot_backup_YYYYMMDD_HHMMSS.tar.gz`.

---

## 🔄 2. Langkah Pemulihan 3 Tahap (Disaster Recovery)

Jika server mati total, ikuti 3 langkah berikut untuk memulihkan layanan di server baru:

### Tahap 1: Ekstrak Konfigurasi dan Aset
1.  Salin file arsip backup `.tar.gz` terakhir ke VPS baru Anda.
2.  Ekstrak arsip di dalam direktori proyek:
    ```bash
    tar -xzf wa_clinic_bot_backup_XXXX.tar.gz -C /path/to/new-directory
    ```
3.  Verifikasi berkas berikut telah terekstrak dengan benar:
    *   Berkas `.env` (berisi database connection URL dan API keys)
    *   Berkas `db_dump_XXXX.sql` (dump database postgres)
    *   Aset gambar `./assets/pricelist_spa.jpg`

### Tahap 2: Pemulihan Database PostgreSQL
1.  Pastikan PostgreSQL telah berjalan di server baru dan database kosong telah dibuat.
2.  Import file dump SQL ke database baru:
    ```bash
    # Ganti "username", "dbname", dan path file sql sesuai kondisi Anda
    psql -U username -d dbname -f backups/db_dump_XXXX.sql
    ```
    *Catatan: Jika menggunakan Docker Compose, Anda bisa langsung melakukan import dari kontainer:*
    ```bash
    docker-compose exec -T postgres psql -U admin_user -d clinic_db < backups/db_dump_XXXX.sql
    ```

### Tahap 3: Memulai Ulang Service Chatbot
1.  Instal seluruh dependensi proyek:
    ```bash
    npm install
    ```
2.  Jalankan Prisma client generation:
    ```bash
    npx prisma generate
    ```
3.  Jalankan kembali aplikasi menggunakan PM2 atau Docker Compose:
    ```bash
    # Menggunakan Docker Compose
    docker-compose up -d --build
    
    # Menggunakan PM2 / Node secara langsung
    pm2 restart wa-clinic-bot || pm2 start dist/app.js --name "wa-clinic-bot"
    ```
4.  Lakukan tes hit `/health` untuk memverifikasi bot kembali aktif dan berjalan lancar!
