# Laporan Audit Fase 10 — Pengaturan Sistem, RBAC & Keamanan

> **Tanggal Audit:** 2026-11-02  
> **Auditor:** Antigravity AI Agent & User  
> **Commit Target:** `d06c90f1`  
> **Status Gerbang Fase 10:** **PASS (dengan catatan rekonsiliasi Cfg-017 — lihat §4)**

---

## 1. Ringkasan Eksekutif Fase 10

Fase 10 mengaudit modul pengaturan sistem administratif di Admin Dashboard, meliputi manajemen pelanggan (AI override, buku alamat, pemblokiran), master katalog layanan dan tier ongkir dinamis, konfigurasi persona Bidan & few-shot exemplars, pembatasan cakupan rollout AI (`NEW_ONLY` vs `ALL`), basis pengetahuan SOP klinik, rekening pembayaran & upload QRIS, serta sistem otorisasi Role-Based Access Control (RBAC) berbasis `role_api_scopes`.

---

## 2. Hasil Audit Per Sub-Modul Admin (10.1 s/d 10.7)

| ID | Sub-Modul Admin | Kriteria PASS | Bukti Riil (`file:line`) | Status |
| :--- | :--- | :--- | :--- | :---: |
| **10.1** | **Manajemen Customer & Alamat** | Override status AI (`FORCE_ON`, `FORCE_OFF`, `AUTO`), buku alamat multi-lokasi, pemblokiran nomor | `src/routes/admin/customers.subroute.ts`; `tests/unit/customer-database-api.test.ts` (lulus 100%) | **PASS** |
| **10.2** | **Katalog Master & Delivery Tiers** | Master layanan klinik (kategori, harga, durasi, clinical eligibility) dan tarif ongkir dinamis DB | `src/routes/admin/services.subroute.ts`; `src/routes/admin/delivery-tiers.subroute.ts` | **PASS** |
| **10.3** | **Persona, Few-Shots & Model AI** | Penyesuaian nama bidan, prompt, few-shots, dan pemilihan model LLM per-tugas tanpa sentuh kode | `src/routes/admin/persona.subroute.ts`; `few-shots.subroute.ts`; `ai-models.subroute.ts`; `tests/unit/few-shot-api.test.ts` | **PASS** |
| **10.4** | **Scope Rollout AI** | Pembatasan bot AI (`NEW_ONLY` vs `ALL`) dengan tanggal cutoff dinamis | `src/routes/admin/ai-rollout-scope.subroute.ts`; `tests/integration/ai-rollout-scope-admin.test.ts` | **PASS** |
| **10.5** | **SOP Knowledge & Pembayaran** | Potongan FAQ SOP klinik, unanswered questions queue, upload QRIS dinamis | `src/routes/admin/knowledge.subroute.ts`; `tests/unit/knowledge-search.test.ts`; `tests/unit/admin-payment-info-settings.test.ts` | **PASS** |
| **10.6** | **RBAC & Hak Akses Endpoint** | **Hibrida:** scope data-driven via tabel `role_api_scopes` + daftar prefix sensitif yang di-hardcode di `src/routes/admin.route.ts` (`superAdminOnlyPrefixes`) sebagai defense-in-depth; isolasi Admin vs Therapist vs Advertiser | `src/routes/admin/roles.subroute.ts`; `src/routes/admin.route.ts`; `tests/unit/role-permissions.test.ts`; `tests/unit/admin-rbac-guard.test.ts` | **PASS (dengan catatan)** |
| **10.7** | **Cadangan Manual & Forensik LLM** | Backup dump PostgreSQL programatik, modul evaluasi token prompt & sandbox | `src/routes/admin/backup.subroute.ts`; `src/routes/admin/evaluations.subroute.ts` | **PASS** |

---

## 3. Hasil Pengujian Unit & Gerbang Regresi

* **Koreksi Path Test Suite (Resolusi Drift A-001):**
  Rencana lama memuat 7 nama berkas test abstrak; audit menggunakan 10 berkas test riil yang mencakup seluruh domain otorisasi dan konfigurasi sistem.
* **Perintah Uji:**
  ```powershell
  npx vitest run tests/unit/role-permissions.test.ts tests/unit/admin-rbac-guard.test.ts tests/unit/customer-database-api.test.ts tests/unit/admin-payment-info-settings.test.ts tests/unit/few-shot-api.test.ts tests/unit/few-shot-exemplars.test.ts tests/integration/ai-rollout-scope-admin.test.ts tests/unit/knowledge-search.test.ts tests/unit/admin-persona-prompt-config.test.ts tests/unit/ai-model-settings.test.ts --reporter=json --outputFile=docs/audit/2026-11-02/fase-10.json
  ```
* **Hasil:** **10 file suites, 74 tests passed (100% green)** — artefak diregenerasi 2026-11-12 dari repo ini.
* **Catatan artefak (Cfg-017):** `fase-10.json` lama berisi path mesin lain (`C:/Users/Ivan/...`) dan 72 test. Artefak kini berisi 10 file/74 test dengan path repo ini.
* **Evaluasi Gerbang Anti-Regresi:**
  ```powershell
  node scripts/audit-baseline-diff.mjs docs/audit/2026-11-02/baseline.json docs/audit/2026-11-02/fase-10.json
  ```
  * New failures: **0**
  * Fixed failures: **31**
  * Status: **✅ GATE PASS (Tidak ada regresi baru)**.

---

## 4. Catatan Rekonsiliasi Klaim (Cfg-017)

Audit ini semula memakai frasa normatif yang lebih luas daripada bukti kodenya. Rekonsiliasi 2026-11-12 mencatat batas yang sebenarnya:

1. **RBAC bukan 100% data-driven.** `role_api_scopes` mengatur scope per peran, tetapi daftar `superAdminOnlyPrefixes` di `src/routes/admin.route.ts` di-hardcode sebagai lapis pertahanan kedua. Konsekuensi: penambahan endpoint sensitif baru WAJIB disertai penambahan prefix di kode (bukan hanya data DB). Pengujian: `tests/unit/admin-rbac-guard.test.ts` + `tests/unit/role-permissions.test.ts`.
2. **Setelan tenant dulu hanya bisa dibaca.** Sejak Cfg-011 (commit `e6e264e9`) ada `GET|PATCH /api/admin/tenant-settings` (Super Admin only) untuk `clinicLocation`, `operationalHours`, `staffNotification`, `estimateTtlDays`, `copilot.styleTone`, dan `brand`. **UI sub-tab dashboard belum ada** — status UI dicatat di `docs/KNOWN_ISSUES.md`, bukan diklaim selesai di sini.
3. **Dashboard masih memuat data bisnis hardcode.** Tenant default, brand, rekening placeholder, dan koordinat klinik di frontend adalah temuan **Cfg-015 yang masih OPEN** (area dashboard pengguna). Karena itu label "PASS" di laporan ini hanya berlaku untuk API/backend, bukan untuk paritas UI.
4. **Artefak test harus berasal dari repo ini.** Gerbang `tests/unit/fase10-audit-artifact.test.ts` mengunci jumlah file/test, asal path, dan keberadaan catatan ini agar drift tidak terulang.
