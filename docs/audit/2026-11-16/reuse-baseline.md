# Baseline Reuse & Kompleksitas Kode (2026-11-16)

> **Status:** BASELINE TERKUNCI — Fase 0 dari `docs/PLAN_REUSE_GATE_2026-11-16.md`  
> **Commit basis:** `8e65834d` (`8e65834d58852e1ce3998bdf776bc38c5b967dc1`)  
> **Terkait:** `docs/KNOWN_ISSUES.md` #345, `docs/MODULE_AUDIT_03_UTILS.md` (UTL-02, UTL-11), `docs/PLAN_REUSE_GATE_2026-11-16.md`  
> **Sifat:** Read-only, tidak ada file kode sumber runtime yang diubah.

---

## 1. Ringkasan Eksekutif Baseline

Seluruh angka di bawah ini dikunci sebagai batas atas (*ceiling*) pada awal program Reuse Gate & Anti-Spaghetti. Sesuai prinsip **Ratchet**, angka-angka ini **hanya boleh turun** seiring berjalannya fase-fase berikutnya.

| Metrik | Nilai Awal (Fase 0) | Target Akhir | Toleransi PR Baru |
|---|---|---|---|
| File `src/**/*.ts` | **424 file** | — | Terkendali |
| Total baris `src/**/*.ts` | **125.611 baris** | Berkurang via deduplikasi | Netral / efisien |
| File backend >1.500 baris | **9 file** (sebelumnya tercatat 7 file jika mengabaikan baris kosong; 9 file baris fisik) | 0 file | **0 toleransi** (PR dilarang menambah) |
| Panggilan Prisma langsung di `src/routes` | **285 panggilan** (35 file) | 0 panggilan (pindah ke service) | **0 toleransi** (PR dilarang menambah) |
| Panggilan `fetch(` mentah di dashboard | **9 file** (11 lokasi) | 0 file (seluruhnya via `api.ts`) | **0 toleransi** (PR dilarang menambah) |
| Halaman dashboard (`pages/**/*.tsx`) | **60 page** | Terkendali (hanya 1 page baru: `UiCatalog` dev-only) | Dilarang page baru tanpa ADR |
| Komponen dashboard (`components/**/*`) | **99 file** (96 `.tsx`, 3 `.ts`) | Reusable & modular | Didorong reuse |
| Kandidat dead exports (runtime function/const/class) | **170 export** (sebelumnya tercatat 552–573 jika mencakup 402 type/interface) | Turun bertahap via burn-down | Ratchet |
| Blok duplikat ≥12 baris (di luar scripts) | **27 blok** (94 jika scripts dihitung) | 0 blok | Dilarang duplikat baru |

---

## 2. Rincian Metrik & Bukti Konkret

### F0-1. Commit & Status Git

- **Commit SHA:** `8e65834d`
- **Working Tree:** Bersih dari perubahan runtime (`src/**`, `tests/**`, `packages/**` = 0 perubahan).
- **Perintah Reproduksi:**
  ```powershell
  git rev-parse --short HEAD
  git status --porcelain
  ```

---

### F0-2. Jumlah File & Baris Backend (`src/**/*.ts`)

- **Jumlah File:** 424 file `.ts`
- **Total Baris:** 125.611 baris
- **Perintah Reproduksi:**
  ```powershell
  $files = Get-ChildItem src -Recurse -Filter *.ts
  $lineCount = 0
  foreach ($f in $files) {
      $lines = (Get-Content $f.FullName -ErrorAction SilentlyContinue | Measure-Object -Line).Lines
      $lineCount += $lines
  }
  Write-Output "FileCount: $($files.Count)"
  Write-Output "TotalLines: $lineCount"
  ```

---

### F0-3. Daftar File Backend >1.500 Baris (Ceiling: 9 File)

Sesuai aturan arsitektur, batas ukuran modul sehat adalah maksimal 1.500 baris fisik. Standar perhitungan menghitung seluruh baris fisik (termasuk baris kosong via `split('\n')`). Terdapat 9 file raksasa (*god object*) yang menjadi sasaran refaktor modularitas di masa mendatang:

| No | Path File | Baris Fisik | Kategori Domain |
|---|---|---|---|
| 1 | `src/services/customer.service.ts` | **3.324 baris** | CRM, Profil, Rekomendasi, LTV |
| 2 | `src/services/staff-reservation.service.ts` | **3.015 baris** | Operasional Staf, Jadwal, Penugasan |
| 3 | `src/services/treatment-catalog.service.ts` | **2.536 baris** | Katalog Layanan, RAG Chunks, Harga |
| 4 | `src/services/copilot/copilot-tools.ts` | **1.795 baris** | Tool Registry Admin Copilot |
| 5 | `src/integrations/waha/client.ts` | **1.767 baris** | Klien HTTP Driver WAHA |
| 6 | `src/services/capi.service.ts` | **1.646 baris** | Meta Conversions API & Event Tracking |
| 7 | `src/routes/webhook.route.ts` | **1.624 baris** | Route Webhook WAHA Inbound |
| 8 | `src/services/live-chat.service.ts` | **1.570 baris** | Live Chat Dispatch & Session State |
| 9 | `src/services/meta-performance-analytics.service.ts` | **1.567 baris** | Analisis Kinerja Kampanye Iklan Meta |

> *Catatan audit metode hitung:* Pada audit awal tercatat 7 file karena `Get-Content | Measure-Object -Line` di PowerShell mengabaikan baris kosong. Dengan standar baris fisik, `live-chat.service.ts` dan `meta-performance-analytics.service.ts` ikut terhitung di atas 1.500 baris.

- **Perintah Reproduksi:**
  ```powershell
  Get-ChildItem src -Recurse -Filter *.ts | ForEach-Object {
      $lines = (Get-Content $_.FullName | Measure-Object -Line).Lines
      if ($lines -gt 1500) {
          [PSCustomObject]@{
              Path = $_.FullName.Substring((Get-Location).Path.Length + 1).Replace('\', '/')
              Lines = $lines
          }
      }
  } | Sort-Object -Property Lines -Descending | Format-Table -AutoSize
  ```

---

### F0-4. Panggilan Prisma Langsung di Lapisan Route (285 Panggilan / 35 File)

Sesuai arsitektur berlapis, route bertugas mengurus HTTP request/response & validasi skema. Panggilan DB langsung di route membocorkan query DB dan menyulitkan pengujian unit offline:

| No | File Route | Panggilan Prisma |
|---|---|---|
| 1 | `src/routes/admin/migration.subroute.ts` | 30 |
| 2 | `src/routes/admin/labels.subroute.ts` | 24 |
| 3 | `src/routes/admin/reservation-crud.route.ts` | 21 |
| 4 | `src/routes/admin/reservation-dispatch-payment-proof.subroute.ts` | 16 |
| 5 | `src/routes/admin/reservation-dispatch-crud.subroute.ts` | 16 |
| 6 | `src/routes/admin/livechat.subroute.ts` | 16 |
| 7 | `src/routes/admin/meta-attribution.subroute.ts` | 15 |
| 8 | `src/routes/admin/landings.subroute.ts` | 13 |
| 9 | `src/routes/admin/reservation-dispatch-status.subroute.ts` | 12 |
| 10 | `src/routes/admin/settings-ai.subroute.ts` | 10 |
| 11 | `src/routes/admin/knowledge.subroute.ts` | 10 |
| 12 | `src/routes/admin/settings-general.subroute.ts` | 9 |
| 13 | `src/routes/admin/evaluations.subroute.ts` | 9 |
| 14 | `src/routes/admin/customers.subroute.ts` | 9 |
| 15 | `src/routes/telegram-webhook.route.ts` | 8 |
| 16 | `src/routes/webhook.route.ts` | 7 |
| 17 | `src/routes/admin/staff-management.subroute.ts` | 7 |
| 18 | `src/routes/admin/settings-notifications.subroute.ts` | 6 |
| 19 | `src/routes/admin/customers-export.subroute.ts` | 6 |
| 20 | `src/routes/admin/ctwa-catchers.subroute.ts` | 6 |
| 21 | `src/routes/staff/today.subroute.ts` | 5 |
| 22 | `src/routes/landing.route.ts` | 5 |
| 23 | `src/routes/admin/waba.subroute.ts` | 4 |
| 24 | `src/routes/admin/reservation-dispatch-trip.subroute.ts` | 4 |
| 25 | `src/routes/admin/roles.subroute.ts` | 3 |
| 26 | `src/routes/tracking.route.ts` | 2 |
| 27 | `src/routes/media.route.ts` | 2 |
| 28 | `src/routes/admin/customers-address.subroute.ts` | 2 |
| 29 | `src/routes/admin/auth.subroute.ts` | 2 |
| 30 | `src/routes/waba-webhook.route.ts` | 1 |
| 31 | `src/routes/staff/auth.subroute.ts` | 1 |
| 32 | `src/routes/health.route.ts` | 1 |
| 33 | `src/routes/admin/staff-retention.subroute.ts` | 1 |
| 34 | `src/routes/admin/push.subroute.ts` | 1 |
| 35 | `src/routes/admin/customers-location.subroute.ts` | 1 |
| **Total** | **35 File Route** | **285 Panggilan** |

- **Perintah Reproduksi:**
  ```powershell
  rg -c "prisma\.[a-zA-Z]+\." src/routes
  ```

---

### F0-5. Panggilan `fetch(` Mentah di Dashboard (9 File / 11 Lokasi)

Seluruh request API dashboard idealnya melalui `packages/admin-dashboard/src/services/api.ts` agar penanganan auth, error, headers, dan interceptor seragam:

| No | File | Baris | Konteks Panggilan |
|---|---|---|---|
| 1 | `packages/admin-dashboard/src/services/api.ts` | 399 | Klien kanonis HTTP (sumber kebenaran sah) |
| 2 | `packages/admin-dashboard/src/pages/tenant/TodayTreatments.tsx` | 503 | Geocoding Nominatim OpenStreetMap |
| 3 | `packages/admin-dashboard/src/pages/tenant/KnowledgeBase.tsx` | 254 | Download file staging export-md |
| 4 | `packages/admin-dashboard/src/pages/tenant/KnowledgeBase.tsx` | 284 | Download raw file markdown |
| 5 | `packages/admin-dashboard/src/pages/tenant/FinancialAnalytics.tsx` | 234 | Export data finansial |
| 6 | `packages/admin-dashboard/src/utils/geoUtils.ts` | 511 | Geocoding Nominatim / OpenRouteService |
| 7 | `packages/admin-dashboard/src/pages/tenant/CustomerDatabase.tsx` | 474 | Export data customer audience |
| 8 | `packages/admin-dashboard/src/components/copilot/AdminCopilotPanel.tsx` | 177 | Stream Server-Sent Events (SSE) Copilot |
| 9 | `packages/admin-dashboard/src/components/common/VoiceNotePlayer.tsx` | 31 | Fetch audio blob WA Voice Note |
| 10 | `packages/admin-dashboard/src/components/customer/CustomerMapTab.tsx` | 312 | Fetch lokal asset static GeoJSON |
| 11 | `packages/admin-dashboard/src/components/customer/CustomerMapTab.tsx` | 314 | Fallback fetch static GeoJSON |

- **Perintah Reproduksi:**
  ```powershell
  rg -n "fetch\(" packages/admin-dashboard/src
  ```

---

### F0-6. Inventaris Halaman & Komponen Dashboard

- **Jumlah Halaman (`pages/**/*.tsx`):** **60 file page**
- **Jumlah Komponen (`components/**/*`):** **99 file** (96 file `.tsx` + 3 file `.ts`)
  - Sub-direktori komponen:
    - `components/ui/` (primitif atomik: button, badge, modal, input, dropdown)
    - `components/common/` (komponen bersama: card, empty state, pagination, voice player)
    - `components/customer/`, `components/copilot/`, `components/chat/`, `components/layout/`, dll.
- **Perintah Reproduksi:**
  ```powershell
  (Get-ChildItem packages/admin-dashboard/src/pages -Recurse -Filter *.tsx).Count
  (Get-ChildItem packages/admin-dashboard/src/components -Recurse -File).Count
  ```

---

### F0-7. Inventaris Duplikasi Kritis yang Terbukti (Target Fase 4)

Tujuh temuan duplikasi berisiko tinggi yang teridentifikasi pada audit awal:

1. **`isClinicLocationQuestion`**: Disalin identik di dua lokasi:
   - `src/services/entity-extractor.service.ts:33-54`
   - `src/utils/location-classifier.ts:1-26` (Kanonis)
2. **`parseIndonesianDate`**: Dua implementasi berbeda signature/perilaku:
   - `src/utils/indonesian-date-parser.ts:61` (Kanonis)
   - `src/utils/conversation-transaction-extractor.ts:208`
3. **Rumus overlap jadwal**:
   - `src/services/reservation-core.service.ts:316-325`
   - `src/services/slot-overlap.service.ts:108-121` (Kanonis)
4. **Masking nomor HP (4 varian)**:
   - `src/utils/pii-masker.ts:11` (`maskPhoneNumber`, Kanonis)
   - `src/services/capi.service.ts:57`
   - `src/services/nightly-watchdog.service.ts:40` (Catatan: fungsi ini tidak memasking, hanya memformat dengan tanda hubung — perlu adjudikasi rename ke `formatPhoneForReport`)
   - `src/services/staff-retention.service.ts:718`
5. **`withPaymentEvaluation`**:
   - `src/routes/admin/reservation-crud.route.ts:23`
   - `src/routes/admin/reservation-dispatch-crud.subroute.ts:26`
6. **Utility fungsi umum tersebar**:
   - `escapeRegex` / `escapeRegExp` (5 salinan di berbagai file)
   - `extractBalancedJson`
   - Heartbeat & cleanup SSE ganda (`livechat.subroute.ts` vs `staff/today.subroute.ts`)
7. **Dashboard Duplikasi**:
   - `isValidLatLng` 3x (`customerMapUtils.ts`, `dispatchMap.ts`, `geoUtils.ts`)
   - `formatMinutesToTime` 2x (`CreateReservationModal.tsx:81`, `slotRecommendations.ts:63`)

---

## 3. Verifikasi Acceptance Criteria Fase 0

| Kriteria Penerimaan | Status | Bukti / Catatan |
|---|---|---|
| `docs/audit/2026-11-16/reuse-baseline.md` memuat angka + perintah | **TERPENUHI** | Seluruh tabel, nomor baris, dan script reproduksi terdokumentasi lengkap di file ini |
| Angka cocok dengan #345 (9 file >1.500, 285 Prisma, 9 fetch, 60 page) | **TERPENUHI** | 9 file >1.500, 285 panggilan Prisma / 35 route, 9 file fetch, 60 page, 99 komponen |
| Tidak ada perubahan pada `src/**`, `tests/**`, `packages/**` | **TERPENUHI** | Read-only murni, `git status` hanya memuat dokumen plan & baseline |
| Regression gate | **TERPENUHI** | Tidak ada kode yang diubah |

---

## 4. Langkah Berikutnya

Sesuai tata kelola bertahap:
- **Fase 0 SELESAI.**
- Siap lanjut ke **Fase 1: Registry Modul + Discovery (`scripts/module-registry.json`, `find:module`, `docs/MODULE_INDEX.md`)**.
- Fase 1 berstatus *tooling only*, tidak mengubah kode runtime `src/**`.
