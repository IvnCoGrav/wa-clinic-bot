# Laporan Audit Fase 1 — Arsitektur Inti, Multi-Tenant SaaS, & Lifecycle

> **Tanggal Audit:** 2026-11-02  
> **Auditor:** Antigravity AI Agent & User  
> **Commit Target:** `d06c90f1`  
> **Status Gerbang Fase 1:** **PASS (LULUS 100%)**

---

## 1. Ringkasan Eksekutif Fase 1

Fase 1 memverifikasi fondasi arsitektur multi-tenant, pemuatan data boot database, pemisahan worker background, 7 tahapan graceful shutdown, kebijakan kompresi & rate limit, serta observabilitas forensik log.

---

## 2. Hasil Audit Per Fitur Mikro (1.1 s/d 1.6)

| ID | Fitur Mikro | Kriteria PASS | Bukti Riil (`file:line`) | Status |
| :--- | :--- | :--- | :--- | :---: |
| **1.1** | **Isolasi Multi-Tenant** | 0 query lintas-tenant tanpa filter; fail-closed saat `tenantId` hilang/kosong | `src/routes/admin/route-helpers.ts:15-30` (`tenantOf` melempar 401 jika kosong); `customer.repository.ts:48,80`; `conversation.repository.ts:42,64` | **PASS** |
| **1.2** | **Boot Data-Driven** | 5 jenis konfigurasi dimuat per tenant dari DB; fallback DB-offline menghasilkan peringatan eksplisit | `src/app.ts:217-248` (`loadServicesFromDb`, `getDeliveryTiersFromDb`, `loadPersonaFromDb`, `AiModelConfigService`, `AiEligibilityConfigService`) | **PASS** |
| **1.3** | **Pemisahan Worker** | Server live menjalankan container worker terpisah dengan `SEPARATE_WORKER=true` | Server `43.173.11.79` `docker inspect wa-clinic-bot-app-1` & `wa-clinic-bot-worker-1` memuat `SEPARATE_WORKER=true`; `src/app.ts:294-298` melewati crons jika flag aktif | **PASS** |
| **1.4** | **Graceful Shutdown** | Urutan 7 tahap tereksekusi tertib; `prisma.$disconnect` terakhir; cron dihentikan pertama | `src/lifecycle/shutdown.ts:42-89` (1. `clearAllIntervals` -> 2. `server.close` -> 3. `burst flush` -> 4. `queue.close` -> 5. `llm audit flush` -> 6. `llm jsonl flush` -> 7. `prisma.$disconnect`) | **PASS** |
| **1.5** | **Kompresi & Rate Limit** | `threshold=1024`, Brotli/Gzip/Deflate; SSE bypass; webhook dipisah bucket `webhook:${clientIp}` (kuota sama 1000/menit) | `src/app.ts:130-164` (klaim lama "kuota lebih tinggi" dikoreksi menjadi "bucket terpisah, kuota sama") | **PASS** |
| **1.6** | **Forensik Auth & Log Buffer** | Respons 401/503 dicatat JSON satu baris dengan hash prefix 8-karakter; token penuh DILARANG; buffer direhidrasi saat startup | `src/utils/auth-access-log.ts:1-60`; `src/app.ts:80-98`; `src/utils/log-buffer.ts` | **PASS** |

---

## 3. Hasil Pengujian Unit & Gerbang Regresi

* **Perintah Uji:**
  ```powershell
  npx vitest run tests/unit/tenant-failclosed.test.ts tests/unit/tenant-resolve-failclosed.test.ts tests/unit/lifecycle-shutdown.test.ts tests/unit/lifecycle-interval-registry.test.ts tests/unit/auth-access-log.test.ts tests/unit/log-buffer.test.ts tests/unit/queue.test.ts --reporter=json --outputFile=docs/audit/2026-11-02/fase-01.json
  ```
* **Hasil:** **7 file suites, 47 tests passed (100% green)**.
* **Evaluasi Gerbang Anti-Regresi:**
  ```powershell
  node scripts/audit-baseline-diff.mjs docs/audit/2026-11-02/baseline.json docs/audit/2026-11-02/fase-01.json
  ```
  * New failures: **0**
  * Fixed failures: **31**
  * Status: **✅ GATE PASS (Tidak ada regresi baru)**.

---

## Addendum Integritas Rujukan (Ar-009) — 2026-11-11

Audit ulang menemukan bahwa sebagian klaim PASS pada laporan ini tidak dapat diverifikasi dari repo (rujukan baris bisa basi, dan sebagian bukti bersifat inspeksi server live). Koreksi yang dilakukan:

1. **Gerbang otomatis** `npm run audit:verify-claims` (`scripts/verify-audit-claims.mjs`) memindai seluruh rujukan `file:line` di laporan ini dan gagal bila file hilang atau baris di luar batas. Status saat addendum ditulis: **semua rujukan valid**.
2. **Reklasifikasi kejujuran status:**
   - Klaim yang dapat dibuktikan dari repo (file + line + test) tetap **PASS**.
   - Klaim yang bergantung pada kondisi server live / inspeksi manual ditandai **PASS (repo) / UNVERIFIABLE (server)** dan tidak boleh dipakai sebagai bukti tunggal gerbang deploy.
   - **1.3 Pemisahan Worker:** bukti utama adalah `docker inspect` di server live (tidak dapat direproduksi dari repo). Kode yang mendukung (`src/app.ts` flag `SEPARATE_WORKER`, `src/worker.ts`) tetap PASS; status deployment nyata diverifikasi terpisah saat runbook deploy.

3. Rujukan baris pada laporan ini **tidak dijadikan patokan beku**; patokan kebenaran perilaku tetap test otomatis (lihat `tests/` dan `docs/audit/2026-11-10/EVIDENCE_LEDGER.md`).
