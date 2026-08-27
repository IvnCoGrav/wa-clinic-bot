# Plan Auto-Save Jarak & Lokasi Saat Human Handling

Tanggal: 2026-08-27
Status: PLAN (belum eksekusi — untuk dieksekusi di sesi terpisah)
Trigger: Customer `6283831256927` (Bunda Mukodimatul Hikma, Sawotratap) jarak tidak terekam

## 1. Ringkasan

Customer Sawotratap mengirim `Jl anusanata No.19 Sawotratap Gedangan Sidoarjo` dan form reservasi lengkap saat conversation sudah `is_human_handling=true`. Sistem sekarang `ABORT` di `machine.ts:47` dan `decision-matrix.ts:40` tanpa geocoding sama sekali, sehingga `customers.lat/lng/distance_km/ongkir` tetap `NULL` meski alamat jelas dan ada di gazetteer `Sawotratap -7.3708486,112.7301098`. Balasan admin `jaraknya 4km, free 0-5km` hanya teks manual, tidak `updateCustomerLocation()`.

Tujuan: **auto-save lokasi ke DB secara silent (fire-and-forget) meski dipegang admin, tanpa bot membalas.**

## 2. Diagnosis Akar Masalah

1. **Gate human handling terlalu keras** — `machine.ts#45-53` dan `decision-matrix PRIORITY 2 (SILENT_HUMAN_ACTIVE)` langsung `return shouldSendReply:false` sebelum `EntityExtractor` / `geocodingService` dipanggil.
2. **human.ts hanya cover 2 kasus** — form reservasi lengkap (`isReservationFormMessage`) dan pin GPS native (`incomingMessage.type === 'location'`). Alamat teks biasa saat human handling tidak diproses.
3. **Form reservasi tidak geocode** — `slot-engine.ts#41-112` dan `human.ts#42-101` hanya `prisma.reservation.create`, tidak panggil `geocodeText` untuk `kec/kota/address` di form.
4. **Tidak ada backfill** — customer lama yang sudah human handling tetap `NULL` selamanya.

## 3. Prinsip (Wajib Dipatuhi)

- **SaaS-ready / Anti-hardcode**: homebase, tier ongkir, semua dari DB/service per tenant — jangan hardcode nama kelurahan/kecamatan, harga, brand.
- **Zero regex untuk intent**: deteksi `provide_location` / alamat WAJIB via `EntityExtractor` (AI NLU), bukan regex gatekeeper. Regex hanya untuk sanitasi teknis (`np`→`no`, normalisasi nomor).
- **Tenant-aware**: semua write pakai `tenantId` (`DEFAULT_TENANT_ID` fallback).
- **Silent enrichment**: `shouldSendReply` tetap `false`, tidak ganggu chat admin. Fail-safe: error geocoding/DB tidak boleh bikin webhook 500.
- **Tracer & observability**: log terstruktur `[HUMAN ENRICH]` + audit LLM.

## 4. Arsitektur Solusi

```
Inbound WA (WAHA/WABA)
  → machine.ts gate HUMAN_HANDLING
      → jika is_human_handling && !medical_blocked
          → panggil humanBackgroundEnrichment.enrichAsync(ctx)  // fire-and-forget, no await blocking reply
          → return SILENT_HUMAN_ACTIVE (bot diam)
      → enrichAsync di dalam:
          a) text location: EntityExtractor.extract(incomingText) → jika locationText → geocodingService.geocodeText(compositeAddress) → deliveryService.calculateDelivery() → customerService.updateCustomerLocation()
          b) native pin: reverseGeocode + calculateDelivery → updateCustomerLocation + markShareLocationSent
          c) form reservasi: parseReservationText → geocode kec/kota/address jika ada → updateCustomerLocation (jika belum ada lat/lng) + reservation.create (sudah ada)
```

- Enrichment jalan **async background** (`void enrich().catch(...)` atau `setImmediate`) agar webhook tetap <200ms.
- Semua cabang pakai `geocodingService` Tier-1 gazetteer dulu (0ms), baru Google Maps API, baru LLM fallback — konsisten dengan flow normal.
- GPS pin tetap prioritas (`isNativePin=true`, guard `share_location_sent` di `customer.service.ts#208`).

## 5. Rencana Bertahap (5 Fase)

### Fase 0 — Backfill Satu Customer (Quick Win, 0 risiko)
- **File**: one-off script `src/scripts/backfill-sawotratap.ts` atau SQL langsung.
- **Aksi**: `UPDATE customers SET kelurahan='Sawotratap', kecamatan='Gedangan', kota='Kabupaten Sidoarjo', lat=-7.3708486, lng=112.7301098, distance_km=~4.x, ongkir=0, zipcode='61254' WHERE phone='6283831256927'` (hitung via `deliveryService.calculateDelivery` di live, bukan tebak manual).
- **Kriteria selesai**: `SELECT` di live menampilkan `distance_km` tidak NULL untuk 6283831256927.

### Fase 1 — Service Enrichment Baru (Inti)
- **File baru**: `src/services/human-background-enrichment.service.ts`
- **Aksi**:
  - Export `humanBackgroundEnrichmentService.enrichAsync(ctx, tenantId)` dan `enrichSync()` (untuk test).
  - Input: `StateHandlerContext` + `tenantId`.
  - Langkah dalam service:
    1. Jika `incomingMessage.type==='location'` → `reverseGeocode` → `calculateDelivery` → `updateCustomerLocation` + `markShareLocationSent` (reuse logic `human.ts#108-143` tapi ekstrak ke service).
    2. Jika `isReservationFormMessage(incomingText)` → `parseReservationText` → jika `parsed.kec/kota/address` ada dan `customer.lat IS NULL` → `geocodeText([address,kec,kota].join(', '))` → jika `isPrecise` → `updateCustomerLocation` (jangan timpa GPS pin presisi). Tetap lanjutkan `reservation.create` yang sudah ada di `human.ts`.
    3. Jika teks biasa → `EntityExtractor.extract(incomingText, {history, customerPhone, conversationId, tenantId, incomingMessage})` → jika `locationText` ada → `geocodeText(compositeAddress: streetDetail+locationText atau rawText)` → jika `isPrecise` → `calculateDelivery` → `updateCustomerLocation`.
  - Semua `try/catch`, log `console.log('[HUMAN ENRICH] ...')`, jangan throw.
  - Hormati `customer.share_location_sent` guard.
- **Kriteria selesai**: service bisa dipanggil tanpa `shouldSendReply`, tidak throw, unit testable.

### Fase 2 — Integrasi di Gate Human Handling (Silent, Non-Blocking)
- **File**: `src/state-machine/machine.ts` (gate `is_human_handling` line 47), `src/slot-engine/slot-engine.ts` (opsional, jika flow slot-engine masih reachable), `src/slot-engine/decision-matrix.ts` (P2 SILENT_HUMAN_ACTIVE), `src/state-machine/handlers/human.ts` (refactor pakai service)
- **Aksi**:
  - `machine.ts#47`: sebelum `return {shouldSendReply:false}`, panggil `void humanBackgroundEnrichmentService.enrichAsync(ctx, tenantId)` (tanpa `await` atau `await` dengan timeout 8s tapi tidak block reply — pilih fire-and-forget agar webhook cepat).
  - `decision-matrix.ts`: di `if (updatedSlate.isHumanHandling)` tetap return `SILENT_HUMAN_ACTIVE` tapi sebelumnya trigger enrichment yang sama (atau andalkan gate machine.ts saja — cukup satu titik).
  - Refactor `human.ts#37-143` untuk pakai service baru (hapus duplikasi GPS/form logic, panggil service).
  - Pastikan `is_human_handling` tidak di-reset oleh enrichment.
- **Kriteria selesai**: pesan teks Sawotratap saat human handling tetap `shouldSendReply:false` tapi DB terisi `lat/lng/distance_km`.

### Fase 3 — Form Parser Enrichment Lanjutan
- **File**: `human.ts` + `humanBackgroundEnrichment.service.ts`
- **Aksi**: saat `parseReservationText` sukses, selalu coba geocode `address + kec + kota` meski `isReservationFormMessage` true, untuk isi `kelurahan/kecamatan/kota` yang belum ada. Jika geocode gagal, jangan block reservasi.
- **Kriteria selesai**: customer yang kirim form `Kec: Sawotratap Kota: Sidoarjo` langsung punya `kecamatan/kota` terisi tanpa tunggu admin edit manual.

### Fase 4 — Observability & Guard Tambahan
- **File**: `src/services/customer.service.ts` (sudah ada guard GPS), `src/utils/llm-audit-buffer.ts`
- **Aksi**:
  - Tambah log audit `HUMAN_ENRICH` ke `llm-audit-buffer` / `messages` payloadRaw (opsional).
  - Tambah metric `human_enrich_success / human_enrich_skipped / human_enrich_failed`.
  - Pastikan tidak spam LLM: jika `incomingText` <3 huruf atau filler (`makasih`, `oke`) skip enrichment (reuse check di `geocoding.ts#881`).
- **Kriteria selesai**: live log `docker compose logs app | grep HUMAN` terlihat setiap alamat human handling.

### Fase 5 — Test & Verifikasi
- **File**: `tests/unit/human-background-enrichment.test.ts` (baru), update `tests/setup.ts` mock jika perlu
- **Aksi**:
  - Unit test: teks Sawotratap saat `is_human_handling=true` → `updateCustomerLocation` terpanggil dengan `isPrecise:true`, `distance_km` ~4km, `ongkir` 0.
  - Unit test: pin GPS saat human handling → `reverseGeocode` + `markShareLocationSent`.
  - Unit test: form reservasi saat human handling → `reservation` + `geocode`.
  - Unit test: chitchat `makasih` saat human handling → tidak geocode.
  - Jalankan `npm run build` (typecheck), `npm test -- tests/unit/human-background-enrichment.test.ts`.
  - Manual: `WAHA_MOCK=true npm run chat` atau `npx tsx` geocode Sawotratap langsung.
- **Kriteria selesai**: semua test hijau, build pass, tidak ada regresi `slot-engine-conversational-flow`, `centralized-persona-architecture`.

## 6. Daftar File Berubah / Baru

- Baru: `src/services/human-background-enrichment.service.ts`, `tests/unit/human-background-enrichment.test.ts`, `src/scripts/backfill-sawotratap.ts` (opsional)
- Ubah: `src/state-machine/machine.ts`, `src/state-machine/handlers/human.ts`, `src/slot-engine/decision-matrix.ts` (opsional), `docs/KNOWN_ISSUES.md` (catat issue Sawotratap sudah fix)
- Tidak diubah: `delivery_tiers`, `clinic.ts`, tier DB

## 7. Urutan Eksekusi

1. Fase 0 backfill live (manual SQL) — langsung nilai untuk 6283831256927
2. Fase 1 service baru
3. Fase 2 integrasi gate
4. Fase 3 form geocode
5. Fase 4 observability
6. Fase 5 test + build

## 8. Risiko & Mitigasi

- **LLM cost naik** karena tiap pesan human handling panggil `EntityExtractor` → mitigasi: skip jika pesan <4 kata filler, atau cache, tetap pakai `callChatCompletionsWithFallback` yang sudah ada.
- **Race dengan admin edit** → `updateCustomerLocation` non-blocking, last-write wins; guard GPS pin mencegah timpa koordinat presisi.
- **Webhook latency** → enrichment fire-and-forget, tidak `await` di path kritis; webhook tetap 200 OK cepat.
- **Geocoding salah** → hanya save jika `isPrecise=true` (kelurahan level), kecamatan-only tidak disimpan sebagai confirmed.

## 9. Kriteria Selesai Keseluruhan

- Customer 6283831256927 di live `distance_km != null` (backfill + future proof).
- Pesan baru `Jl anusanata No.19 Sawotratap` saat `is_human_handling=true` menghasilkan `lat=-7.370...`, `distance_km` ~3-5km, `ongkir` sesuai tier (0 untuk freeTier), tanpa bot membalas.
- `npm run build` pass, `npm test` pass, tidak ada `window.confirm` baru di admin, tidak ada hardcode nama lokasi di code.
- `docs/KNOWN_ISSUES.md` diupdate, CHANGELOG ditambah.

## 10. Deliverable

- 1 service baru + 1 test baru + 2 handler di-refactor + 1 backfill script + plan ini sebagai gate.
