# Audit Modul 16 — Delivery, CI/CD, Build & Test Harness

**Tanggal Audit:** 2026-11-09  
**Status Audit:** READ-ONLY COMPLETED (S4.4 dari Plan `PLAN_FINISH_AUDIT_2026-11-09.md`)  
**Commit:** `d9c0ea59` (`master`)
**Auditor:** Antigravity AI Agent  
**Cakupan Modul:**  
- Kontainer & Proksi: `Dockerfile` (68 baris), `.dockerignore` (25 baris), `docker-compose.yml` (212 baris), `Caddyfile` (78 baris), `deploy/logrotate.d/wa-clinic-bot` (11 baris)
- Skrip Deployment & Operasional: `scripts/deploy.sh` (14 baris), `scripts/deploy-prod.sh` (156 baris), `scripts/deploy-live.js` (46 baris), `scripts/deploy-to-server.js` (77 baris), `scripts/backup.sh` (62 baris), `scripts/server-watchdog.sh` (179 baris), `scripts/vps-harden-server.sh` (113 baris), `scripts/vps-setup-new.sh` (116 baris), `scripts/vps-migrate-export.sh` (104 baris), `scripts/vps-migrate-import.sh` (167 baris), `scripts/scan-secrets.ts` (256 baris), `scripts/verify-backup-restore.ts` (181 baris)
- Harness Pengujian & Build: `package.json` (76 baris), `vitest.config.ts` (19 baris), `vitest.db.config.ts` (25 baris), `tests/setup.ts` (480 baris), `.git/hooks/pre-commit` (24 baris)
- Frontend Build & Dashboard: `packages/admin-dashboard/package.json` (31 baris), `packages/admin-dashboard/vite.config.ts` (21 baris), `packages/admin-dashboard/scripts/check-design-tokens.mjs` (64 baris), `packages/admin-dashboard/scripts/check-dark-parity.mjs` (110 baris)
- **Total Baris Diinspeksi:** 2.715 baris konfigurasi, skrip, dan harness.

---

## (A) Ringkasan & Skor Kesehatan

### Skor Kesehatan: 2.5 / 5.0 (Cukup Berfungsi di Server Tunggal, Celah Keamanan Tinggi, Zero CI Automation)

```
[█████░░░░░] 2.5 / 5.0
Status: OPERASIONAL BERISIKO (Celah Kebocoran Data di Docker Build, Zero CI/CD, Skrip Zombie)
```

Modul 16 mencakup seluruh infrastruktur build, testing harness, dockerisasi, proksi Caddy, dan skrip automasi operasional server. Sistem memiliki pondasi operasional produksi yang cukup matang: pemisahan container `app` dan `worker` (`SEPARATE_WORKER=true`), healthcheck non-blocking berbasis Node 20 `fetch`, migrasi database nir-henti via one-shot container di `deploy-prod.sh`, serta watchdog pemantau downtime independen di host via Telegram.

Namun, terdapat anomali dan celah sistemik kritikal:
1. **Zero CI/CD Automation**: Direktori `.github/workflows` **TIDAK ADA**. Tidak ada pipeline otomatis untuk unit test, typecheck, lint, secret scan, maupun image build pada saat `git push` atau pull request. Semua verifikasi bergantung pada disiplin manual operator.
2. **Celah Kebocoran Kredensial & PII di Docker Build (`.dockerignore`)**: `.dockerignore` belum mengecualikan direktori `storage/` yang berisi kunci privat Web Push (`storage/vapid_keys.json`, 171 B) dan dump SQL mentah (`storage/live_clinic_services.sql`, 28 KB), serta `children-null-backup.csv` di root. Perintah `COPY . .` di `Dockerfile:13` memboyong berkas-berkas ini ke **builder stage/build context**. Final runner image tidak menyalin `storage/` (hanya `dist`, `assets`, config JSON, dan dashboard), sehingga bukan kebocoran image final; risikonya adalah build context, cache builder, dan remote builder/registry cache.
3. **Skrip Deployment Zombie yang Berbahaya (`scripts/deploy.sh`)**: Terdapat `scripts/deploy.sh` primitif (14 baris) yang hanya membangun container `app` tanpa menyentuh `worker`, tanpa menjalankan migrasi database (`npx prisma migrate deploy`), dan tanpa healthcheck. Jika operator menjalankan skrip ini alih-alih `deploy-prod.sh`, background crons akan menjalankan kode usang dan skema DB tertinggal.
4. **Jebakan Jaringan Eksternal `docker-compose.yml`**: Compose mengasumsikan network `hermes-net` sebagai `external: true`, namun skrip setup server baru (`vps-setup-new.sh`) tidak pernah membuat network tersebut sehingga boot fresh server pasti crash.
5. **Skrip Cadangan Host Rusak & Bocor Plaintext (`scripts/backup.sh`)**: Menjalankan `pg_dump "$DATABASE_URL"` langsung di host, padahal Postgres tidak membuka port ke host dan hostname `postgres` adalah DNS internal Docker. Skrip ini juga membungkus file `.env` plaintext ke dalam tarball unencrypted, bertolak belakang dengan modul enkripsi `backup.service.ts` (AES-256-GCM).
6. **Hardcoded Kredensial, IP, dan Path Pengembang di Skrip Operasional**: Berkas deploy (`deploy-live.js`, `deploy-to-server.js`, `server-watchdog.sh`, `vps-*.sh`) dipenuhi IP hardcoded (`43.173.11.79`, `43.157.197.148`), kunci SSH kustom, dan path lokal Windows pengembang (`C:/Users/Ivan/...`).
7. **Frontend Admin Dashboard Terisolasi dari Pipeline Build & Test**: Root `npm run build` dan `npm test` sama sekali tidak memeriksa maupun mengompilasi `packages/admin-dashboard`. Dashboard React memiliki **0 unit test**.

---

## (B) Tabel Temuan Lengkap

| ID | Tingkat | Lokasi Berkas / Baris | Deskripsi Masalah | Dampak Sistemik | Solusi Fondasional |
|---|---|---|---|---|---|
| **DEL-01** | **P0 (Kritis)** | `.github/workflows/` (Absen) | Tidak ada pipeline CI/CD sama sekali di repositori. | Kode regresi, type error, kebocoran secret, dan test gagal dapat ter-push langsung ke master tanpa filter. | Buat workflow GitHub Actions `.github/workflows/ci.yml` mencakup secret scan, typecheck, lint, dan test suite offline. |
| **DEL-02** | **P0 (Kritis)** | `scripts/deploy.sh:1-14` vs `scripts/deploy-prod.sh` | Skrip `deploy.sh` hanya restart container `app` tanpa `worker`, tanpa `prisma migrate deploy`, tanpa healthcheck. | Jika dieksekusi operator, container worker menjalankan kode lama; migrasi skema terlewat sehingga DB crash di runtime. | Hapus `deploy.sh` atau alihkan (symlink/redirect) langsung ke `deploy-prod.sh`. |
| **DEL-03** | **P1 (Tinggi) — REMEDIATED 2026-11-09** | `.dockerignore`, `Dockerfile:13`, `storage/vapid_keys.json`, `storage/live_clinic_services.sql`, `children-null-backup.csv` | `.dockerignore` tidak memasukkan `storage/` (berisi VAPID private key 171 B dan dump SQL 28 KB), `*.sql`, `*.csv`, dan `.watchdog.env`. **Status remediasi:** `.dockerignore` sudah diperluas di commit `d227c947`; verifikasi `docker build` pending karena daemon Docker tidak aktif. | `COPY . .` di builder membawa kunci privat + dump PII ke build context/cache. Final runner image tidak menyalin `storage/`, tetapi build cache/remote builder tetap berisiko. | Tambahkan `storage`, `storage/**`, `*.sql`, `*.csv`, `.watchdog.env`, `vapid_keys.json`, dan `children-null-backup.csv` ke `.dockerignore`. Rotasi VAPID key bila build pernah dikirim ke remote builder/registry. |
| **DEL-04** | **P1 (Tinggi) — KNOWN #196a** | `docker-compose.yml:211-212`, `scripts/vps-setup-new.sh` | `hermes-net: external: true` wajib ada, namun `vps-setup-new.sh` tidak membuat network tersebut. Sudah tercatat di `docs/KNOWN_ISSUES.md:2709-2713` (fix hanya di server lama; host fresh akan gagal lagi). | `docker compose up` langsung gagal fatal pada instalasi server baru dengan error network missing. | Tambahkan `docker network create hermes-net 2>/dev/null \|\| true` di skrip setup VPS atau jadikan network non-external/optional di compose. |
| **DEL-05** | **P1 (Tinggi)** | `Dockerfile:46-47` | Runner stage menjalankan `npm ci --only=production` lalu `RUN npx prisma generate`. Namun `prisma` berada di `devDependencies`. | `npx` terpaksa mengunduh ulang binary Prisma via internet publik saat build runner. Jika registry lambat/offline, build gagal. | Salin binary client prisma yang sudah di-generate dari builder stage (`COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma`). |
| **DEL-06** | **P1 (Tinggi)** | `scripts/deploy-live.js:5`, `scripts/deploy-to-server.js:14-16`, `scripts/server-watchdog.sh:97` | Hardcoded path developer Windows (`C:/Users/Ivan/...`), IP VPS (`43.173.11.79`), dan SSH user. | Skrip deploy otomatis gagal di komputer pengembang lain; melanggar portabilitas tim dan standarisasi konfigurasi. | Standarisasi variabel SSH via environment (`SSH_USER`, `SSH_HOST`, `SSH_PORT`, `SSH_KEY_PATH`) dengan fallback graceful. |
| **DEL-07** | **P1 (Tinggi)** | `scripts/backup.sh:32-48` | `backup.sh` memanggil `pg_dump` di host dan mengompres `.env` plaintext ke `.tar.gz`. Port 5432 tidak diekspos ke host. | Script gagal total saat dieksekusi di host VPS; jika berhasil, memproduksi backup tanpa enkripsi (kredensial `.env` terekspos). | Migrasikan skrip bash host ke pemanggilan `docker compose exec app npx tsx scripts/verify-backup-restore.ts` (AES-256-GCM). |
| **DEL-08** | **P2 (Sedang)** | `Caddyfile:15, 7, 63, 75` | Header usang `X-XSS-Protection "1; mode=block"`, ketiadaan CSP & Permissions-Policy, domain hardcoded `kalababyspa.online`. | Keamanan browser modern kurang optimal; konfigurasi reverse proxy tidak siap untuk domain dinamis multi-tenant. | Hapus header usang, tambahkan CSP dasar, gunakan environment variable untuk domain Caddy (`{$APP_DOMAIN}`). |
| **DEL-09** | **P2 (Sedang)** | `package.json:7`, `packages/admin-dashboard` | Root `npm run build` tidak membangun admin dashboard. Di dalam package dashboard tidak ada test render; hanya 3 test utilitas dashboard di root (`status-tone`, `staff-colors`, `customer-map-utils`). | Perubahan komponen React (render/interaksi) tidak tercakup test; error build dashboard baru terdeteksi saat Docker builder berjalan. | Tambahkan `build:all` di root yang membangun frontend & backend, serta test render dasar di `packages/admin-dashboard`. |
| **DEL-10** | **P2 (Sedang)** | `package.json:13`, `tests/setup.ts` | Tidak ada script `test:db` di `package.json` untuk menjalankan `vitest.db.config.ts`. Redis tidak di-mock di setup unit test. | Uji PostgreSQL nyata jarang dijalankan pengembang; warning koneksi Redis muncul secara liar saat suite pengujian dijalankan. | Tambahkan `"test:db": "vitest run --config vitest.db.config.ts"`, mock ioredis secara silent di `tests/setup.ts`. |
| **DEL-11** | **P3 (Rendah)** | `deploy/logrotate.d/wa-clinic-bot` | Logrotate menunjuk `/var/log/wa-clinic-bot/*.log` user `nodejs`, padahal log berada di `./logs/` dan dikelola in-app. | Konfigurasi logrotate usang/dangling; file `.jsonl` forensik AI tidak pernah dirotasi oleh host. | Selaraskan path logrotate dengan bind-mount `./logs/*.log` dan `./logs/*.jsonl` atau dokumentasikan rotasi in-app. |
| **DEL-12** | **P3 (Rendah)** | Root directory (`install.sh`, `children-null-backup.csv`), `assets/pricelist_spa.jpg` | Terdapat file installer pihak ketiga asing (`rtk`) yang **tracked** di root, file backup CSV PII (gitignored), dan aset gambar di `assets/`. | Mengotori root direktori, membingungkan pengembang baru, memperbesar ukuran kloning git. | Hapus `install.sh` asing, pindahkan/bersihkan file CSV cadangan dari root, dan deduplikasi aset gambar. |

---

## (C) Bukti Kode Before / After

### 1. DEL-01: GitHub Actions CI Pipeline Automatis (`.github/workflows/ci.yml`)

*Kondisi Sekarang (Before):*  
Direktori `.github` tidak ada. Verifikasi dilakukan manual di laptop developer, rentan kelalaian.

*Rekomendasi Perbaikan (After):*  
Buat `.github/workflows/ci.yml`:
```yaml
name: CI Quality Gate

on:
  push:
    branches: [ master ]
  pull_request:
    branches: [ master ]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Node.js 20
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install Dependencies
        run: npm ci

      - name: Generate Prisma Client
        run: npx prisma generate

      - name: Scan Secrets & PII
        run: npm run security:scan

      - name: Typecheck Backend & Frontend
        run: |
          npm run typecheck
          cd packages/admin-dashboard && npm ci && npm run build

      - name: Run Vitest Suite (Offline)
        run: npm test
```

---

### 2. DEL-03 & DEL-05: Hardening `.dockerignore` & Stage Runner `Dockerfile`

*Kondisi Sekarang (Before):*  
`.dockerignore`:
```text
# Kurang: vapid_keys.json, *.sql, *.csv, .watchdog.env lolos ke Docker build
```
`Dockerfile`:
```dockerfile
# Stage 2 Runner
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --only=production
RUN npx prisma generate  # prisma CLI tidak ada di dependencies, npx download dari internet
```

*Rekomendasi Perbaikan (After):*  
`.dockerignore`:
```text
node_modules
**/node_modules
dist
packages/**/dist
.env
.env.*
*.local
.watchdog.env
vapid_keys.json
children-null-backup.csv
*.sql
*.csv
storage
storage/**
test-results
scratch
*.log
.DS_Store
Thumbs.db
```

`storage`/`storage/**` mengecualikan seluruh runtime storage (`vapid_keys.json`, `live_clinic_services.sql`, media, backups). `*.sql`/`*.csv` menjadi lapisan kedua untuk file di root. Final runner image tetap tidak menyalin `storage/`; hardening ini melindungi build context dan cache.

`Dockerfile`:
```dockerfile
# Stage 2 Runner
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev

# Salin client & engine Prisma yang SUDAH ter-generate di builder stage (tanpa internet)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
```

---

### 3. DEL-02 & DEL-07: Penyingkiran Zombie `deploy.sh` & Perbaikan Enkripsi `backup.sh`

*Kondisi Sekarang (Before):*  
`scripts/deploy.sh`:
```bash
# Zombie script: hanya restart app, worker tertinggal, migrasi DB tidak dijalankan
docker compose build app
docker compose up -d --no-deps app
```
`scripts/backup.sh`:
```bash
# Gagal di host karena postgres tidak buka port & DATABASE_URL mengarah ke container internal
pg_dump "$DATABASE_URL" > "$BACKUP_DIR/db_dump_$TIMESTAMP.sql"
tar -czf "$BACKUP_DIR/$ARCHIVE_NAME" ... .env ... # Kredensial .env plaintext tidak terenkripsi
```

*Rekomendasi Perbaikan (After):*  
`scripts/deploy.sh` diganti dengan symlink / alias aman:
```bash
#!/usr/bin/env bash
echo "Menjalankan deployment produksi kanonis via scripts/deploy-prod.sh..."
exec "$(dirname "$0")/deploy-prod.sh" "$@"
```
`scripts/backup.sh` memanfaatkan container app dengan enkripsi AES-256-GCM:
```bash
#!/usr/bin/env bash
set -euo pipefail
echo "Membuat cadangan database terenkripsi (AES-256-GCM) via service internal..."
docker compose exec -T app npx tsx scripts/verify-backup-restore.ts
```

---

## (D) Katalog Reuse & Komponen Bersama

Modul 16 memiliki aset automasi berkualitas tinggi yang harus dijadikan standar tunggal dan dimanfaatkan secara konsisten:
1. **`scripts/deploy-prod.sh`**: Standar emas deployment server. Memiliki validasi env, build paralel `app` + `worker`, migrasi DB nir-henti dengan auto-resolve issue `children`, drift verification, dan pengecekan `/health` serta `/ready`.
2. **`src/services/backup.service.ts` & `scripts/verify-backup-restore.ts`**: Standar enkripsi cadangan (AES-256-GCM) dengan validasi manifest schema 2.0, checksum SHA-256, dan penghitungan baris tabel. Seluruh script bash cadangan harus memanfaatkan engine ini.
3. **`scripts/scan-secrets.ts`**: Mesin audit keamanan komprehensif untuk mendeteksi token OpenAI, Meta CAPI, Google Maps, private keys PEM, dan password. Sangat siap dipasang ke git hook maupun CI.
4. **`scripts/server-watchdog.sh`**: Pengawas uptime host anti-flap yang andal mengirim alert dan recovery Telegram saat Caddy/App down tanpa membebani database.

---

## (E) File Belum Dibaca & Blind Spots

Seluruh berkas utama dalam lingkup kontainer, deployment, konfigurasi proksi Caddy, skrip migrasi VPS, dan harness pengujian telah dibaca dan diverifikasi. Area di luar cakupan langsung modul ini:
- **`scripts/build_landing.js` & `scripts/build_pricelist.js`**: Skrip generator HTML landing page statis (tidak memengaruhi runtime chatbot).
- **Infrastruktur VPS Tencent Cloud**: Spesifikasi konfigurasi firewall eksternal (Security Group provider cloud) tidak dapat diinspeksi dari kode lokal.
- **Konfigurasi DNS Cloudflare / Registrar**: TTL dan routing record untuk domain `kalababyspa.online` dikelola di dashboard luar repo.

---

## (F) FMEA & Matriks Regresi

| Komponen | Potensi Mode Kegagalan | Dampak Kegagalan | Tindakan Mitigasi / Guardrail |
|---|---|---|---|
| **Docker Build** | File PII / Kredensial ikut ter-bundle ke image publik | Kebocoran data pelanggan dan token API | Tambahkan entri ketat di `.dockerignore`, jalankan `security:scan` sebelum build |
| **VPS Provisioning** | Jaringan `hermes-net` tidak ditemukan saat fresh install | Container gagal boot (`network not found`) | Tambahkan `docker network create` di `vps-setup-new.sh` |
| **Prisma Engine Runner** | Runner stage gagal download engine prisma saat offline | Docker build gagal di server dengan koneksi terbatas | `COPY --from=builder` untuk `.prisma` & `@prisma/client` |
| **Deployment Script** | Eksekusi `deploy.sh` tidak meng-update `worker` | Cron job & background tasks menjalankan logika basi | Ganti `deploy.sh` menjadi delegasi ke `deploy-prod.sh` |
| **Admin Dashboard** | Error TypeScript di dashboard lolos ke server | Build Docker produksi gagal saat deployment darurat | Masukkan build dashboard ke root `npm run build` dan CI |
| **Database Backup** | Backup plaintext bocor dari folder publik atau backup gagal senyap | Kehilangan data tanpa adanya cadangan terenkripsi valid | Wajibkan uji restore berkala via `verify-backup-restore.ts` |

---

## (G) Rekomendasi Tindakan & Prioritas

### Prioritas 1 (P1 — Mendesak untuk Keamanan & Stabilitas Rilis)
1. **Tambahkan `.github/workflows/ci.yml`**: Pasang pipeline GitHub Actions otomatis untuk menjalankan secret scan, typecheck, dan unit test offline pada setiap commit/PR.
2. **Koreksi `.dockerignore`**: Masukkan `vapid_keys.json`, `*.csv`, `*.sql`, `.watchdog.env`, dan `storage/backups` agar tidak bocor ke image Docker.
3. **Pensiunkan / Alihkan `scripts/deploy.sh`**: Ubah isi `scripts/deploy.sh` agar meneruskan eksekusi ke `scripts/deploy-prod.sh` untuk mencegah container worker tertinggal.
4. **Optimasi Dockerfile Runner**: Salin hasil prisma generate langsung dari builder stage alih-alih mengunduh ulang via internet di runner stage.

### Prioritas 2 (P2 — Standarisasi Lingkungan & Frontend)
1. **Integrasikan Build Admin Dashboard**: Tambahkan build dashboard ke script `build` atau buat `build:all` di root `package.json`.
2. **Perbaiki Network `hermes-net`**: Tambahkan pembuatan network otomatis di `scripts/vps-setup-new.sh`.
3. **Standarisasi Variabel Lingkungan Skrip VPS**: Hilangkan path hardcoded Windows (`C:/Users/Ivan/...`) dan IP hardcoded di `deploy-live.js` dan `deploy-to-server.js`.
4. **Modernisasi Header Caddyfile**: Hapus header usang `X-XSS-Protection` dan tambahkan Content-Security-Policy dasar.

### Prioritas 3 (P3 — Kebersihan Repositori)
1. **Bersihkan File Asing di Root**: Hapus `install.sh` (skrip pihak ketiga rtk) dan bersihkan file cadangan CSV/SQL mentah dari root.
2. **Tambahkan Script `npm run test:db`**: Daftarkan runner test PostgreSQL nyata di `package.json` untuk pengujian integrasi database lokal.
3. **Selaraskan Konfigurasi Logrotate**: Sesuaikan path logrotate dengan direktori logs in-app.

---

## Catatan Koreksi Pasca-Review (2026-11-09)

- **Total baris** dikoreksi dari 2.548 menjadi **2.715**; angka per file `vps-migrate-import.sh` (167), `check-design-tokens.mjs` (64), dan `check-dark-parity.mjs` (110) diselaraskan dengan kode aktual.
- **DEL-03** dikoreksi: file sensitif berada di `storage/` (`vapid_keys.json` 171 B, `live_clinic_services.sql` 28 KB) dan root (`children-null-backup.csv`), bukan seluruhnya di root. Severity diturunkan dari **P0** ke **P1** karena final runner image tidak menyalin `storage/`; risiko utama ada di build context/cache. Rekomendasi `.dockerignore` diperluas dengan `storage`, `storage/**`, `*.sql`, `*.csv`, dan `children-null-backup.csv`; **sudah diremediasi di commit `d227c947`**, verifikasi `docker build` pending karena daemon Docker tidak aktif.
- **DEL-04** ditandai **KNOWN #196a** dengan rujukan `docs/KNOWN_ISSUES.md:2709-2713`.
- **DEL-09** dikoreksi: bukan "0 unit test" — ada 3 test utilitas dashboard di root (`status-tone.test.ts`, `staff-colors.test.ts`, `customer-map-utils.test.ts`); yang tidak ada adalah test render/interaksi di dalam `packages/admin-dashboard`.
- **DEL-12** dikoreksi: `pricelist_spa.jpg` berada di `assets/`, bukan root; `install.sh` tracked dan `children-null-backup.csv` gitignored.
- **Verifikasi ulang**: `.github/workflows` tetap tidak ada; `deploy.sh` 14 baris; `Dockerfile:13 COPY . .`; `docker-compose.yml:211-212 hermes-net external`; seluruh klaim DEL-01/02/06/07/08 tetap cocok.
