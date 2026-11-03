# Laporan Audit Fase 8 — Otomasi, Background Crons & Pekerja Mandiri

> **Tanggal Audit:** 2026-11-02  
> **Auditor:** Antigravity AI Agent & User  
> **Commit Target:** `d06c90f1`  
> **Status Gerbang Fase 8:** **PASS (LULUS SECARA KODE; TEMUAN KRITIS MIGRASI SERVER LIVE TERCATAT)**

---

## 1. Ringkasan Eksekutif Fase 8

Fase 8 mengaudit 21 pekerja latar belakang (*background workers & cron sweeps*) yang dideklarasikan di `src/lifecycle/background-crons.ts`, memeriksa bukti eksekusi riil pada container live `wa-clinic-bot-worker-1` di server `43.173.11.79`, serta memverifikasi status default dan mekanisme proteksi idempotensi tiap worker.

---

## 2. Matriks 4-Kolom Seluruh 21 Background Worker

| # | Nama Worker / Sweeper | Terdaftar di Kode | Status Default | Bukti Run di Server Live / Audit | Idempotensi |
|---|---|:---:|:---:|---|:---:|
| 1 | **Google Sheets Outbox Sync** (3m) | ✅ | **Aktif** (`ENABLE_SHEETS_SYNC_CRON !== 'false'`) | Sinkronisasi outbox berkala | `outbox.claimed_at` + atomic claim |
| 2 | **Frustration SLA Sweep** (5m) | ✅ | **Aktif** (`ENABLE_FRUSTRATION_SWEEP !== 'false'`) | **Terbukti di log live:** *"Frustration sweep: 1-2 percakapan ditandai"* | Flag `needs_attention` idempotent |
| 3 | **Assignment Notification Sweep** (2m) | ✅ | **Aktif** (`ENABLE_ASSIGNMENT_NOTIF_SWEEP !== 'false'`) | Buffer 5 menit ke perangkat bidan | Status `BUFFERED` -> `SENT` |
| 4 | **Trip Auto-Close Sweep** (15m) | ✅ | **Aktif** (`ENABLE_TRIP_AUTOCLOSE_SWEEP !== 'false'`) | Menutup trip kedaluwarsa | Filter status `IN_TRANSIT` |
| 5 | **Slot Overlap Sweep** (15m) | ✅ | **Aktif** (`ENABLE_SLOT_OVERLAP_SWEEP !== 'false'`) | Peringatan dini bentrok jadwal | Read-only detection |
| 6 | **Shareloc Reminder Sweep** (15m) | ✅ | **Nonaktif** (`ENABLE_SHARELOC_REMINDER_SWEEP === 'true'`) | Butuh opt-in env | Flag `shareloc_reminder_sent` |
| 7 | **Follow-Up Drip Worker** (15m) | ✅ | **Nonaktif** (di `.env` server: **Aktif**) | **Terbukti di log live:** *"[FollowUp Worker] Di luar jam kerja (09:00 - 17:00 WIB)"* | Status `PENDING` -> `SENT` |
| 8 | **Pre-Visit Brief Bidan** (10m, H-30) | ✅ | **Aktif** (`ENABLE_PRE_VISIT_BRIEF !== 'false'`) | Briefing pasien 30m sebelum jadwal | Flag `pre_visit_brief_sent` |
| 9 | **Nightly Watchdog** (21:00 WIB) | ✅ | **Aktif** (Cek tiap 15m, target jam 21) | Laporan malam operasional Telegram/WA | `idempotencyKey: ${tenant}:NIGHTLY_WATCHDOG:${date}` |
| 10 | **Morning Jobs & Briefing** (06:00 WIB) | ✅ | **Aktif** (Cek tiap 15m, target jam 06) | Briefing pagi ke staf | `lastMorningRunDate === todayDateStr` |
| 11 | **Daily Ops Report** (07:00 WIB) | ✅ | **Aktif** (Cek tiap 30m, target jam 07) | Laporan performa bisnis harian | Filter jam eksekusi |
| 12 | **Expired Hold Sweep** (6h) | ✅ | **Aktif** (`ENABLE_EXPIRED_HOLD_SWEEP !== 'false'`) | Auto-cancel slot hold kadaluwarsa | Transisi status `HOLD` -> `CANCELLED` |
| 13 | **AI LLM Quality Evaluation** (6h) | ✅ | **Nonaktif** (`ENABLE_AI_EVAL_CRON === 'true'`) | Butuh opt-in env | Idempotent evaluator |
| 14 | **Daily Chat Export** (6h) | ✅ | **Nonaktif** (`ENABLE_CHAT_EXPORT_CRON === 'true'`) | Butuh opt-in env | File overwrite per tanggal |
| 15 | **Media Retention Cleanup** (24h) | ✅ | **Aktif** (`ENABLE_MEDIA_CLEANUP_CRON !== 'false'`) | Hapus file media live chat > retensi | Unlink file + metadata update |
| 16 | **Message Retention Cleanup** (24h) | ✅ | **Nonaktif** (di `.env`: **Aktif**) | Pembersihan teks chat lama | Retention policy date filter |
| 17 | **Staff Session Housekeeping** (24h) | ✅ | **Aktif** (Tanpa gate) | Hapus sesi staf expired | Delete where `expires_at < now` |
| 18 | **Reservation Archive Purge** (24h) | ✅ | **Aktif** (`ENABLE_RESERVATION_ARCHIVE_PURGE !== 'false'`) | **Error di server:** `table reservation_archives does not exist` (lihat §3) | Delete where `restore_until < now` |
| 19 | **Daily Invariant Monitor** (24h) | ✅ | **Aktif** (`ENABLE_INVARIANT_MONITOR !== 'false'`) | **Error di server:** `table reservation_archives does not exist` (lihat §3) | Read-only check |
| 20 | **Label Reconciliation** (4h) | ✅ | **Nonaktif** (`ENABLE_LABEL_RECONCILIATION_CRON === 'true'`) | Butuh opt-in env | Status tag alignment |
| 21 | **Weekly Database Backup** (Senin 02:00) | ✅ | **Aktif** (Target Senin jam 02:00 WIB) | Pg_dump terenkripsi ke GDrive | `lastWeeklyBackupRunDate === todayDateStr` |

---

## 3. TEMUAN KRITIS AUDIT SERVER LIVE (Migrasi Pending #298)

* **Gejala:** Log container `wa-clinic-bot-worker-1` mencatat error berulang:
  ```text
  prisma:error Invalid `prisma.reservationArchive.findMany()` invocation:
  The table `public.reservation_archives` does not exist in the current database.
  [Cron Service] Error running reservation archive purge: The table public.reservation_archives does not exist...
  [INVARIANT MONITOR] DB offline / query gagal: The table public.reservation_archives does not exist...
  ```
* **Akar Masalah:**
  Migrasi `20261101000000_add_reservation_archive` telah dibuat di repositori lokal pada 1 November 2026 untuk mengimplementasikan sistem arsip 60 hari (#292). Namun perintah `npx prisma migrate deploy` **belum pernah dieksekusi pada server live**. Akibatnya, tabel fisik `reservation_archives` belum terbentuk di PostgreSQL produksi, menyebabkan cron `runReservationArchivePurge` dan `runDailyInvariantMonitor` gagal saat mencoba mengakses tabel tersebut.
* **Tindakan Perbaikan yang Disiapkan:**
  Jalankan `npx prisma migrate deploy` di server live saat gerbang migrasi resmi dibuka.

---

## 4. Hasil Pengujian Unit & Gerbang Regresi

* **Perintah Uji:**
  ```powershell
  npx vitest run tests/unit/sheets-sync.service.test.ts tests/unit/daily-invariant-monitor.test.ts tests/unit/frustration-detector.test.ts tests/unit/slot-overlap.test.ts tests/unit/staff-trip-tracker.test.ts tests/unit/nightly-watchdog.test.ts tests/unit/daily-report.test.ts --reporter=json --outputFile=docs/audit/2026-11-02/fase-08.json
  ```
* **Hasil:** **7 file suites, 33 tests passed (100% green)**.
* **Evaluasi Gerbang Anti-Regresi:**
  ```powershell
  node scripts/audit-baseline-diff.mjs docs/audit/2026-11-02/baseline.json docs/audit/2026-11-02/fase-08.json
  ```
  * New failures: **0**
  * Fixed failures: **31**
  * Status: **✅ GATE PASS (Tidak ada regresi baru)**.
