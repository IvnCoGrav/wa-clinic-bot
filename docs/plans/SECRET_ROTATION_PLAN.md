# Rencana Rotasi Kredensial, Sanitasi PII & Purge Histori Publik

Status: **DRAFT KOMPREHENSIF — Hasil Audit Menyeluruh 16 September 2026**
Target Repo: `IvnCoGrav/wa-clinic-bot` (GitHub Publik)

---

## 1. Ringkasan Temuan Audit Menyeluruh

Repo bersifat **publik**. Audit menyeluruh menemukan **4 Vektor Kerentanan Kritis**:

### Vektor A: Kredensial API Aktif Ter-Commit di Branch Master
Ditemukan API Key aktif yang saat ini masih dapat dibaca oleh publik pada branch `master`:
- **`sk-xPRgkZmQakNaOq44qqzPLw` (SumoPod AI Key)**:
  Ter-hardcode di 4 script aktif:
  - `scripts/inspect-mimo.js` (line 13)
  - `scripts/test-live-call.js` (line 20)
  - `scripts/test-mimo-deep.js` (line 29)
  - `scripts/test-reasoning.js` (line 29)
  *Tindakan*: Segera cabut (revoke) di dashboard SumoPod dan ubah script agar membaca `process.env.LLM_API_KEY`.

### Vektor B: Kebocoran PII & Rekam Medis Ratusan Pasien Klinik (UU PDP)
Data asli pasien, nomor telepon WhatsApp, dan rekam reservasi ter-commit di repo publik:
1. `scripts/db_customers.json`: **282+ data customer asli** memuat nama lengkap dan nomor HP WhatsApp (`628...`).
2. `scripts/db_reservations.json`: **Ratusan riwayat reservasi** memuat nama lengkap bayi, usia, dan keluhan terapi medis.
3. `docs/spreadsheet_booking_data.tsv`: **288 baris spreadsheet transaksi klinik** (nama, lokasi, nama bayi, biaya).
4. `scripts/cleanup-bunda-bella-duplicates.sql` & `scripts/cleanup-bunda-retno-reservation.sql`: Nama bunda, anak, nomor WA `6289670370062` dan `6282132249740`.
5. `scripts/add-customers.sh` & `scripts/add-remaining.sh` / `v2.sh`: Nomor WA `6285706086863`, `6281241245461`, `6283856165785`.
6. `scripts/fix-bunda-gita.ts`: Nomor WA `6282232833258` dan **titik koordinat GPS rumah pribadi persis** (`-7.469139575958252, 112.71034240722656`).
7. `scripts/sync-export-data.ts`, `scripts/verify-db-live.js`, `scripts/test-customer-case-62895622156277.ts`: Memuat nomor WhatsApp customer riil.
8. `docs/KNOWN_ISSUES.md`: 15+ nomor telepon customer asli dalam laporan kronologi bug.

### Vektor C: Eksposur Akses SSH Server Produksi
Sebanyak 13 script di `scripts/*.js` memuat hardcoded:
- Host IP: `43.157.197.148`
- Port SSH: `1403`
- User: `ubuntu`
- Key SSH: `C:/Users/Ivan/.ssh/id_ed25519_klinik`
- Path root server: `/opt/wa-clinic-bot`
- Container name: `wa-clinic-bot-app-1`, `wa-clinic-bot-postgres-1`, `wa-clinic-bot-waha-1`

### Vektor D: Kredensial Historis di Blob Git
| # | Secret / File | Lokasi Bocor | Status Nilai |
|---|---|---|---|
| 1 | `ADMIN_API_KEY` | `.env` di commit `42d346f` | `"admin_prod_key_123"` (20 char) — Hak akses penuh `/api/admin/*` |
| 2 | `LLM_API_KEY` (SumoPod) | `.env` di commit `8869ea8`, `28425e3`, `42d346f` | `"sk-znFVknm5AgYRh8G4PzH7wQ"` (25 char) |
| 3 | `WAHA_API_KEY` | 3 blob `.env` yang sama | `"3659a2481bce46a2801173dc5ec7d668"` (32 char hex) |
| 4 | `ORS_API_KEY` | `.env` di commit `42d346f` + 4 file scratch | `"eyJvcmciOiI1..."` (OpenRouteService token) |
| 5 | `apiKey` di `opencode.json` | Commit `abc9bd6`, `0939230`, `6d4ef6b` | `"sk-8ff19ada8ced4e29-9rq5n2-861940cb"` (9Router local proxy) |
| 6 | `DATABASE_URL` | 3 blob `.env` yang sama | Password default lokal `"postgres:postgres@localhost:5432"` |
| 7 | `GOOGLE_MAPS_API_KEY` | 3 blob `.env` yang sama | `"mock_google_maps_key"` (**Bukan bocor**, nilai adalah mock) |

---

## 2. Rencana Eksekusi Berdasarkan Tahapan

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│ TAHAP 1: Sanitasi Lokal Segera (Hapus PII, Masking, & Amankan Script Master)      │
│ TAHAP 2: Tindakan User di Console Eksternal (Revoke SumoPod, Buat Key Baru)      │
│ TAHAP 3: Rotasi Live Server (Update .env, Sync POSTGRES_PASSWORD, Recreate WAHA)   │
│ TAHAP 4: Purge Histori Git Komprehensif (git-filter-repo untuk PII & Secrets)    │
│ TAHAP 5: Verifikasi Akhir & Monitoring 24 Jam                                     │
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

### Tahap 1 — Sanitasi Lokal Repo Segera (Non-Destruktif, Tanpa Downtime)

Langkah ini dilakukan di repo lokal untuk menghentikan eksposur data PII dan API key aktif:

- [ ] **1.1 Perketat `.gitignore`**:
  Tambahkan aturan komprehensif agar file secret, dump PII, dan backup tidak pernah ter-stage:
  ```gitignore
  # Secrets & Environment
  .env*
  !.env.example
  *.pem
  *.key
  *.log

  # Database Dumps & Customer Data (UU PDP)
  scripts/db_customers.json
  scripts/db_reservations.json
  docs/spreadsheet_booking_data.tsv
  ```
- [ ] **1.2 Untrack File PII dari Git Tracking (`git rm --cached`)**:
  Hapus file PII dari stage git tanpa menghapus file lokal jika masih disimpan untuk arsip:
  ```bash
  git rm --cached scripts/db_customers.json scripts/db_reservations.json docs/spreadsheet_booking_data.tsv scripts/cleanup-bunda-bella-duplicates.sql scripts/cleanup-bunda-retno-reservation.sql scripts/add-customers.sh scripts/add-remaining.sh scripts/add-remaining-v2.sh scripts/fix-bunda-gita.ts scripts/sync-export-data.ts scripts/verify-db-live.js scripts/test-customer-case-62895622156277.ts
  ```
- [ ] **1.3 Sanitasi Script Aktif di `scripts/`**:
  Ubah 4 script (`scripts/inspect-mimo.js`, `scripts/test-live-call.js`, `scripts/test-mimo-deep.js`, `scripts/test-reasoning.js`) agar membaca token dari `process.env.LLM_API_KEY` dan membaca SSH host dari `process.env.DEPLOY_HOST || '43.157.197.148'`.
- [ ] **1.4 Pasang Pre-Commit Hook yang Telah Diperbaiki**:
  Pasang hook di `.git/hooks/pre-commit` yang mengecualikan `.env.example` secara eksplisit:
  ```sh
  #!/bin/sh
  staged=$(git diff --cached --name-only | grep -E '^\.env(\..+)?$|^opencode(\..+)?\.json$' | grep -v '^\.env\.example$')
  if [ -n "$staged" ]; then
    echo "BLOCKED: file secret ikut ter-stage: $staged. Unstage manual sebelum commit."
    exit 1
  fi
  ```
- [ ] **1.5 Masking Nomor Telepon Riil di `docs/KNOWN_ISSUES.md`**:
  Ganti nomor telepon pelanggan menjadi format anonim (misal `6289667285xxx`).

---

### Tahap 2 — Tindakan User di Console Eksternal (Di Luar Kode)

Langkah ini **wajib dilakukan oleh pemilik akun** melalui browser / dashboard penyedia layanan:

- [ ] **2.1 Dashboard SumoPod AI**:
  1. Login ke `https://ai.sumopod.com` (atau dashboard penyedia LLM Anda).
  2. Cabut (Revoke/Delete) API Key:
     - `sk-xPRgkZmQakNaOq44qqzPLw` (Key aktif di script)
     - `sk-znFVknm5AgYRh8G4PzH7wQ` (Key di histori `.env`)
  3. Buat API Key baru. Simpan key baru untuk Tahap 3.
- [ ] **2.2 Dashboard OpenRouteService (ORS)**:
  1. Login ke `https://openrouteservice.org/dev/#/home`.
  2. Revoke token lama (`eyJvcmciOiI1YjNjZTM1...`).
  3. Generate token baru.
- [ ] **2.3 Dashboard Kenari AI (Jika Memakai Kenari)**:
  1. Login ke `https://kenari.id`.
  2. Pastikan API key Kenari yang dipakai saat ini aman. Jika pernah dibagikan, rotate key baru.

---

### Tahap 3 — Rotasi di Live Server (`43.157.197.148`)

Lakukan rotasi bertahap di server produksi via SSH.

> [!IMPORTANT]
> **Koreksi Kritis Docker Compose (Trap 1 & 3)**:
> 1. Variabel `POSTGRES_PASSWORD` di `.env` server **WAJIB** diupdate bersamaan dengan `ALTER USER`, karena Compose menyuntikkan `${POSTGRES_PASSWORD}` ke `DATABASE_URL` service `app`.
> 2. Recreate `waha` container **WAJIB** bersamaan dengan `app` saat merotasi `WAHA_API_KEY`, karena WAHA membaca key ini dari env compose (`WAHA_API_KEY=${WAHA_API_KEY}`).

#### Batch A — ORS API Key (Risiko Terendah)
- [ ] A.1 Update `ORS_API_KEY` di `/opt/wa-clinic-bot/.env`.
- [ ] A.2 Recreate container app:
  ```bash
  ssh -p 1403 ubuntu@43.157.197.148 "cd /opt/wa-clinic-bot && docker compose up -d --force-recreate app"
  ```
- [ ] A.3 Uji 1x hitung ongkir di admin live chat.

#### Batch B — LLM API Key (Risiko Sedang)
- [ ] B.1 Update `LLM_API_KEY` di `.env` live dengan key SumoPod/Kenari baru dari Tahap 2.1.
- [ ] B.2 Recreate app container (`docker compose up -d --force-recreate app`).
- [ ] B.3 Uji 1 pesan percakapan di simulator chat atau live WhatsApp.

#### Batch C — WAHA API Key (Risiko Tinggi, Jendela Low-Traffic)
- [ ] C.1 Generate key WAHA baru (hex 32 char): `openssl rand -hex 16`.
- [ ] C.2 Update `WAHA_API_KEY` baru di `.env` live.
- [ ] C.3 Recreate kedua container (`waha` dan `app`):
  ```bash
  ssh -p 1403 ubuntu@43.157.197.148 "cd /opt/wa-clinic-bot && docker compose up -d --force-recreate waha app"
  ```
- [ ] C.4 Verifikasi status sesi WAHA di log: `docker logs wa-clinic-bot-waha-1 --tail 30` (pastikan `WORKING`).

#### Batch D — Database Password & ADMIN API Key (Risiko Tertinggi)
- [ ] D.1 Generate DB password baru (hex 32 char): `NEW_DB_PASS=$(openssl rand -hex 16)`.
- [ ] D.2 Generate Admin key baru: `NEW_ADMIN_KEY=$(openssl rand -hex 24)`.
- [ ] D.3 Ubah password di PostgreSQL container:
  ```bash
  ssh -p 1403 ubuntu@43.157.197.148 "docker exec wa-clinic-bot-postgres-1 psql -U postgres -d postgres -c \"ALTER USER postgres WITH PASSWORD '${NEW_DB_PASS}';\""
  ```
- [ ] D.4 Di `.env` server live, update **KEDUA VARIABEL**:
  - `POSTGRES_PASSWORD="<NEW_DB_PASS>"`
  - `ADMIN_API_KEY="<NEW_ADMIN_KEY>"`
  - (Dan perbarui `DATABASE_URL` jika ada string manual).
- [ ] D.5 Recreate container app:
  ```bash
  ssh -p 1403 ubuntu@43.157.197.148 "cd /opt/wa-clinic-bot && docker compose up -d --force-recreate app"
  ```
- [ ] D.6 Verifikasi container sehat: login ke Admin Dashboard menggunakan `ADMIN_API_KEY` baru.

---

### Tahap 4 — Purge Histori Git Komprehensif (Destruktif — Sekali Jalan)

> [!CAUTION]
> Menghapus file secara permanen dari histori Git akan menulis ulang seluruh commit hash.
> Sebelum eksekusi, backup mirror git wajib dibuat terlebih dahulu.

- [ ] **4.1 Backup Mirror Git**:
  ```bash
  git clone --mirror https://github.com/IvnCoGrav/wa-clinic-bot.git wa-clinic-bot-mirror-bak
  ```
- [ ] **4.2 Eksekusi `git-filter-repo`**:
  Pastikan `git-filter-repo` terinstall (`pip install git-filter-repo`). Jalankan satu perintah yang mencakup **seluruh file secret, PII, dan scratch**:
  ```bash
  git filter-repo --invert-paths \
    --path .env \
    --path opencode.json \
    --path scripts/db_customers.json \
    --path scripts/db_reservations.json \
    --path docs/spreadsheet_booking_data.tsv \
    --path scripts/cleanup-bunda-bella-duplicates.sql \
    --path scripts/cleanup-bunda-retno-reservation.sql \
    --path scripts/add-customers.sh \
    --path scripts/add-remaining.sh \
    --path scripts/add-remaining-v2.sh \
    --path scripts/add-remaining-v3.sh \
    --path scripts/fix-bunda-gita.ts \
    --path scripts/sync-export-data.ts \
    --path scripts/verify-db-live.js \
    --path scripts/test-customer-case-62895622156277.ts \
    --path scratch/compare_ors.js \
    --path scratch/compare_50.js \
    --path scratch/compare_urban.js \
    --path scratch/route_analysis.js \
    --force
  ```
- [ ] **4.3 Force Push ke GitHub**:
  ```bash
  git push --force --all origin
  git push --force --tags origin
  ```
- [ ] **4.4 Sinkronisasi Server Live & Tim**:
  Di server live, lakukan fetch fresh / re-clone agar pointer histori sinkron dengan commit hash baru hasil rewrite.

---

### Tahap 5 — Verifikasi Akhir & Monitoring

- [ ] 5.1 Smoke test end-to-end pesan WA masuk -> balasan AI bot.
- [ ] 5.2 Verifikasi login Admin Dashboard dengan key baru.
- [ ] 5.3 Cek histori GitHub via browser (`/commits/master`) untuk memastikan file `.env`, `db_customers.json`, dan `spreadsheet_booking_data.tsv` sudah 100% hilang dari riwayat commit.
- [ ] 5.4 Monitoring log app selama 24 jam untuk mendeteksi error autentikasi.
