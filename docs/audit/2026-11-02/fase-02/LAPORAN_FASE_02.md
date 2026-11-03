# Laporan Audit Fase 2 — WhatsApp Gateway & Ingestion Layer

> **Tanggal Audit:** 2026-11-02  
> **Auditor:** Antigravity AI Agent & User  
> **Commit Target:** `d06c90f1`  
> **Status Gerbang Fase 2:** **PASS (LULUS 100% SECARA SISTEMIK; REALISME WPM PERLU PENYELARASAN)**

---

## 1. Ringkasan Eksekutif Fase 2

Fase 2 memverifikasi lapisan penerimaan pesan WhatsApp ganda (WAHA container + WABA Meta Cloud API), proteksi tanda tangan kriptografi HMAC SHA-256, deduplikasi turn idempotensi, sakelar darurat outbound, serta parameter efektif anti-burst coalescing dan simulasi pengetikan (*typing humanizer*).

---

## 2. Hasil Audit Per Fitur Mikro (2.1 s/d 2.6)

| ID | Fitur Mikro | Kriteria PASS | Bukti Riil (`file:line`) | Status |
| :--- | :--- | :--- | :--- | :---: |
| **2.1** | **Abstraksi Driver WhatsApp** | 0 pemanggilan `WahaClient` langsung dari rute domain; semua traffic melewati `getGateway()` / provider service | `src/integrations/whatsapp/` (driver layer); `src/routes/admin/evaluations.subroute.ts` hanya stub sandbox; `src/services/typing.service.ts` memakai interface `IWahaClient` | **PASS** |
| **2.2** | **Webhook Ingestion & HMAC** | Token challenge GET valid; tanda tangan Meta invalid -> 401; pesan basi (*stale*) diabaikan | `src/routes/webhook.route.ts`; `src/routes/waba-webhook.route.ts`; `tests/unit/webhook-security.test.ts` (lulus 100%) | **PASS** |
| **2.3** | **Anti-Burst Coalescing** | Nilai efektif dilaporkan apa adanya; kontradiksi kode vs komentar dicatat; penggabungan multi-pesan terbukti | `src/services/burst-coalesce.service.ts:69` (default kode `7500ms`, `.env` = `7500ms`); komentar baris 24 keliru menyatakan default 0 passthrough | **PASS (dengan catatan koreksi komentar)** |
| **2.4** | **Idempotensi Turn** | Turn duplikat tidak diproses dua kali; tabel `InboundTurn` & `OutboundAttempt` mengunci `payload_hash` | `src/services/turn-recovery.service.ts`; `tests/unit/turn-recovery.test.ts`; `tests/unit/turn-repository-claim.test.ts` (lulus 100%) | **PASS** |
| **2.5** | **Kill-Switch & Opt-Out** | Outbound kill-switch memutus respon; kata kunci `STOP`/`BERHENTI` membatalkan follow-up | `src/services/waba-optout.service.ts`; `src/services/whatsapp-provider.service.ts`; `tests/unit/waba-template-consent-optout.test.ts` | **PASS** |
| **2.6** | **Simulasi Mengetik Manusiawi** | Nilai efektif env dilaporkan jujur; WPM > 55 dievaluasi terhadap realisme manusia | `src/services/typing.service.ts:101-110`. Fakta: `.env` memuat `WPM=500` (peringatan kode >55), `minMs=700`, `maxMs=700`. Delay efektif ter-cap flat **700ms (0,7 detik)** | **MEKANISME: PASS / REALISME: FAIL (Perlu Penyelarasan Bersama Pemilik)** |

---

## 3. Catatan Temuan Khusus (Koreksi Rekomendasi)

1. **Kontradiksi Dokumentasi Burst Coalesce**:
   * Komentar di `src/services/burst-coalesce.service.ts:24` menyatakan bahwa burst coalescing *"Nonaktif secara default: env BURST_COALESCE_MS = 0"*.
   * Namun implementasi kode di baris 69 adalah `process.env.BURST_COALESCE_MS || '7500'`.
   * Di lingkungan `.env` lokal maupun produksi, nilainya aktif pada **7.500 ms (7,5 detik)**.
2. **Konfigurasi Humanizer Mengetik Cepat (Fast-Bot)**:
   * Nilai `.env` saat ini menyetel `WPM=500` dan `HUMANIZER_MAX_TYPING_DELAY_MS=700`.
   * Hal ini menyebabkan bot membalas sangat cepat dengan jeda mengetik tetap 0,7 detik, mengabaikan kurva pengetikan manusiawi yang sebenarnya disiapkan kode (WPM normal 40–55 WPM, jeda 2–5 detik).
   * **Rekomendasi**: Diskusikan dengan pemilik klinik apakah bot ingin dipertahankan membalas super-kilat (0,7 detik) atau dikembalikan ke delay natural manusia (2-4 detik).

---

## 4. Hasil Pengujian Unit & Gerbang Regresi

* **Perintah Uji:**
  ```powershell
  npx vitest run tests/unit/typing.test.ts tests/unit/typing-sync.test.ts tests/unit/typing-transport.test.ts tests/unit/burst-coalesce.test.ts tests/unit/turn-recovery.test.ts tests/unit/turn-repository-claim.test.ts tests/unit/webhook-security.test.ts tests/unit/webhook-stale-message-guard.test.ts tests/unit/waba-driver-and-webhook.test.ts tests/unit/waba-template-consent-optout.test.ts tests/unit/waha-retry.test.ts --reporter=json --outputFile=docs/audit/2026-11-02/fase-02.json
  ```
* **Hasil:** **11 file suites, 88 tests passed (100% green)**.
* **Evaluasi Gerbang Anti-Regresi:**
  ```powershell
  node scripts/audit-baseline-diff.mjs docs/audit/2026-11-02/baseline.json docs/audit/2026-11-02/fase-02.json
  ```
  * New failures: **0**
  * Fixed failures: **31**
  * Status: **✅ GATE PASS (Tidak ada regresi baru)**.
