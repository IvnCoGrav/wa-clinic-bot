# Laporan Audit Fase 0 — Baseline, Keselamatan, & Regenerasi Inventaris

> **Tanggal Audit:** 2026-11-02  
> **Auditor:** Antigravity AI Agent & User  
> **Commit Target:** `d06c90f1`  
> **Status Gerbang Fase 0:** **PASS (LULUS 100%)**

---

## 1. Protokol Keselamatan Audit (§C.3 Checklist)

- [x] **Mode Kerja Ditetapkan:** Mode **M1 (Audit Statis)** & **M2 (Bangku Uji Terisolasi)**
- [x] **Konfigurasi Mock:** `.env.audit` dibuat dengan `WAHA_MOCK=true` (Dilarang mengirim pesan WhatsApp riil)
- [x] **Target Basis Data:** Mock in-memory store offline (`tests/setup.ts`), DILARANG menyentuh DB produksi
- [x] **Daftar Perintah Terlarang Dipahami:**
  - Dilarang: `wahaClient.addLabel / removeLabel`
  - Dilarang: Restart container WAHA di server live
  - Dilarang: `prisma migrate dev` atau `prisma generate --no-engine`
  - Dilarang: Skrip pembersihan destruktif tanpa `--confirm`
  - Dilarang: Deploy atau modifikasi kode produksi selama audit
- [x] **Artefak Tersedia:** `docs/audit/2026-11-02/fase-00/`

---

## 2. Hasil Eksekusi Tugas Mikro Fase 0

### 0.1 Regenerasi Inventaris dari Kode
* **Skrip:** [`scripts/audit-inventory-report.mjs`](file:///c:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/scripts/audit-inventory-report.mjs)
* **Hasil Pemindaian Nyata:**
  * **Model Database Prisma:** **47 model** (sebelumnya tercatat 43 di inventaris lama; 4 model baru: `InboundTurn`, `OutboundAttempt`, `TenantSheetsConfig`, `SheetsSyncOutbox`).
  * **Enum Database Prisma:** **16 enum**.
  * **Deklarasi Endpoint Fastify:** **292 endpoint unik**, terdiri dari **343 pasangan Method+Path** (sebelumnya tercatat 117 di inventaris lama).
  * **Background Worker & Cron:** **21 pekerja** (terdaftar di `src/lifecycle/background-crons.ts`).
    * **15 Worker Aktif Default** (misal Sheets Sync, Pre-Visit Brief, Expired Hold, Invariant Monitor, Trip Auto-Close).
    * **6 Worker Default Nonaktif (Opt-in via Env/DB)**:
      1. `Label Reconciliation` (`ENABLE_LABEL_RECONCILIATION_CRON`)
      2. `Message Retention Cleanup` (default kode nonaktif, di `.env` aktif `'true'`)
      3. `Shareloc Reminder Sweep` (`ENABLE_SHARELOC_REMINDER_SWEEP`)
      4. `AI LLM Quality Evaluation` (`ENABLE_AI_EVAL_CRON`)
      5. `Daily Chat Export` (`ENABLE_CHAT_EXPORT_CRON`)
      6. `Follow-Up Drip Worker` (`ENABLE_FOLLOWUP_WORKER`)
  * **Validasi Path File Inventaris:** Dari 57 path file yang dirujuk di `docs/FEATURE_INVENTORY.md`:
    * 37 path cocok persis (*Exact Match*).
    * 20 path mengalami drift penulisan direktori/basename (telah berhasil dipetakan ke path aktualnya).
    * **0 path hilang** (*0 missing files*).
* **Artefak Bukti:** [`docs/audit/2026-11-02/fase-00/inventory-report.json`](file:///c:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/docs/audit/2026-11-02/fase-00/inventory-report.json)

---

### 0.2 Baseline Test Suite & Flaky Reconciliation
* **Perintah:** `npx vitest run --reporter=json --outputFile=docs/audit/2026-11-02/baseline.json`
* **Hasil Suite Keseluruhan:**
  * Total Test Files: **2.134 suites**
  * Total Test Cases: **6.241 tests**
  * Lulus: **6.182 tests**
  * Gagal Pre-Existing: **31 tests** (tersebar di 19 file)
* **Analisis Rekonsiliasi dengan KNOWN_ISSUES #287:**
  * Kegagalan pre-existing disebabkan oleh **Date Rot** (fixture tes menggunakan tanggal kalender mati di masa lampau seperti 10 Oktober 2026, yang gagal saat dievaluasi terhadap tanggal riil 2 November 2026) serta **Mock Prisma Drift** saat offline.
  * Skrip gate regresi [`scripts/audit-baseline-diff.mjs`](file:///c:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/scripts/audit-baseline-diff.mjs) telah dibuat dan diverifikasi: menguji bahwa setiap fase audit ke depan **tidak boleh menimbulkan kegagalan baru** (`gagal(current) ⊆ gagal(baseline)`).
* **Artefak Bukti:** [`docs/audit/2026-11-02/baseline.json`](file:///c:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/docs/audit/2026-11-02/baseline.json)

---

### 0.3 Verifikasi Environment (Read-Only)
* **Node.js Version:** `v24.18.0`
* **NPM Version:** `12.0.2`
* **Prisma Schema Validation:** `npx prisma validate` → **The schema at prisma/schema.prisma is valid 🚀**
* **Typecheck (Kompilasi TypeScript Bersih):** `npm run typecheck` (`tsc --noEmit`) → **Exit Code 0 (Bersih tanpa error)**
* **Security Scanner (Anti Kebocoran Secret):** `npm run security:scan` → **Exit Code 0 (7 file dipindai, 0 kebocoran)**

---

### 0.5 Rekonsiliasi Temuan Lama (`docs/KNOWN_ISSUES.md`)

| ID Issue | Judul & Domain | Status Saat Ini | Dampak Terhadap Audit |
| :--- | :--- | :--- | :--- |
| **#297** | [Baseline Audit] Drift Inventaris, 5 Cron Mati, Humanizer | **OPEN - MEDIUM** | Diverifikasi di Fase 0; menjadi dasar regenerasi data. |
| **#294** | [Reservasi] `reservation_items` Kosong di Reservasi Historis | **OPEN - LOW** | Handled gracefully via fallback teks snapshot. |
| **#291** | [Database] Drift Skema `Child.first_reservation_id` | **OPEN - LOW** | Dilarang `prisma migrate dev`, wajib deploy script. |
| **#288** | [Design System V2] Token Brand Belum Tenant-Aware | **OPEN - MEDIUM** | Masuk cakupan evaluasi Fase 6 (Dashboard). |
| **#287** | [Test Suite] 22-31 Test Gagal Pre-Existing (Date Rot) | **OPEN - MEDIUM** | Dikunci di `baseline.json` sebagai baseline-diff gate. |
| **#286** | [Kalender Mobile] UI/UX View Mingguan di HP | **OPEN - HIGH** | Masuk cakupan evaluasi Fase 5 & Fase 6. |

---

### 0.6 Verifikasi Sinkronisasi Server Live Produksi (M3 Read-Only)
* **Koneksi SSH:** `ubuntu@43.173.11.79:1403`
* **Commit Hash Server:** `d06c90f1` (**100% Identik** dengan lokal & GitHub `origin/master`)
* **Status Docker Containers Server Live:**
  * `wa-clinic-bot-app-1`: **Up 29 hours (healthy)**
  * `wa-clinic-bot-worker-1`: **Up 29 hours (normal)**
  * `wa-clinic-bot-postgres-1`: **Up 3 weeks (healthy)**
  * `wa-clinic-bot-redis-1`: **Up 4 weeks (healthy)**
  * `wa-clinic-bot-waha-1`: **Up 4 weeks (normal)**
  * `wa-clinic-bot-caddy-1`: **Up 4 weeks (normal)**

---

## 3. Kesimpulan Gerbang Fase 0
Seluruh kriteria kelulusan Fase 0 telah **TERPENUHI 100%**:
1. Fondasi inventaris telah diregenerasi langsung dari kode program aktual.
2. Baseline pengujian otomatis 6.241 test telah terkunci di `baseline.json`.
3. Skrip gerbang anti-regresi `audit-baseline-diff.mjs` siap mengawal fase berikutnya.
4. Lingkungan uji aman (`WAHA_MOCK=true`, typecheck bersih, secret scanner lolos, server live sinkron).

**Sistem SIAP melanjutkan ke Fase 1 (Audit Arsitektur Inti, Multi-Tenant SaaS, dan Lifecycle).**
