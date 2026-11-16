# Modul Kanonis & Registry Reuse

> **PERINGATAN — FILE INI DIBUAT OTOMATIS.**
> Jangan edit file ini secara manual. Sumber kebenaran adalah `scripts/module-registry.json`.
> Untuk memperbarui dokumen ini, jalankan: `npm run docs:modules`.
> Untuk mencari modul dari CLI sebelum membuat kode baru, jalankan: `npm run find:module -- "<kebutuhan>"`.

## 1. Daftar Kapabilitas Kanonis Aktif

Total kapabilitas terdaftar: **17 modul**.

| ID Kapabilitas | Judul & Deskripsi | Modul Kanonis | Ekspor Resmi | Test File |
|---|---|---|---|---|
| `capi.pure_helpers` | **Helper murni Meta Conversions API**<br>Transformasi deterministik nilai CAPI, format _fbc, hash SHA-256, decrypt token, kanonikalisasi landing URL, ekstraksi nominal template, dan event_id Purchase — tanpa I/O. | [`src/services/capi.helpers.ts`](../src/services/capi.helpers.ts) | `maskName`, `parseCapiValue`, `formatMetaFbc`, `sha256Hash`, `decryptCapiToken`, `resolveCanonicalLandingUrl`, `extractValueByFormat`, `normalizeCapiMatchingGeo`, `buildDeterministicPurchaseEventId`, `buildLegacyPurchaseEventId` | [`capi-value-guard.test.ts`](../tests/unit/capi-value-guard.test.ts) |
| `date.parse_indonesian` | **Parser tanggal bahasa Indonesia**<br>Parsing ekspresi tanggal bahasa alami Indonesia (hari, nama bulan teks/angka, relatif) menjadi objek Date standar. | [`src/utils/indonesian-date-parser.ts`](../src/utils/indonesian-date-parser.ts) | `parseIndonesianDate`, `parseHistoricalIndonesianDate`, `applyBookingTimeToDate` | [`indonesian-date-parser.test.ts`](../tests/unit/v3/indonesian-date-parser.test.ts) |
| `json.extract` | **Ekstraksi JSON dari output AI**<br>Mengekstrak blok JSON seimbang dari respons teks LLM yang mengandung markdown atau teks pelengkap. | [`src/utils/json-extract.ts`](../src/utils/json-extract.ts) | `extractBalancedJson`, `extractJsonContent`, `repairTruncatedJson` | [`json-extract.test.ts`](../tests/unit/json-extract.test.ts) |
| `livechat.serialize` | **Proyeksi DTO LiveChat**<br>Memetakan baris percakapan/kustomer/reservasi menjadi DTO LiveChat (badge reservasi, sumber lokasi, awaiting-reply) tanpa akses DB. | [`src/services/live-chat.serializer.ts`](../src/services/live-chat.serializer.ts) | `serializeLiveChatConversation` | [`livechat-payload-completeness.test.ts`](../tests/unit/livechat-payload-completeness.test.ts) |
| `location.clinic_question` | **Klasifikasi pertanyaan lokasi klinik**<br>Mendeteksi apakah pesan customer menanyakan lokasi atau alamat klinik fisik. | [`src/utils/location-classifier.ts`](../src/utils/location-classifier.ts) | `isClinicLocationQuestion` | [`location-classifier.test.ts`](../tests/unit/location-classifier.test.ts) |
| `log.date_key` | **Kunci tanggal nama file log harian**<br>Menghasilkan tanggal YYYY-MM-DD dari komponen lokal server untuk penamaan file log harian (llm-*.jsonl, app-*.log). | [`src/utils/log-date.ts`](../src/utils/log-date.ts) | `getLogDateString` | [`log-date.test.ts`](../tests/unit/log-date.test.ts) |
| `log.staff_rejection` | **Logging penolakan bisnis rute staf**<br>Logging terstruktur ke console.warn untuk penolakan bisnis (HTTP 400) rute staf agar otomatis diserap ke logs/app-YYYY-MM-DD.log. | [`src/utils/staff-rejection-log.ts`](../src/utils/staff-rejection-log.ts) | `logStaffRejection` | [`staff-rejection-log.test.ts`](../tests/unit/staff-rejection-log.test.ts) |
| `phone.normalize` | **Normalisasi nomor telepon Indonesia**<br>Normalisasi nomor HP format Indonesia (08x, +628x, 628x) ke format 628x standar atau E164. | [`src/utils/phone-normalizer.ts`](../src/utils/phone-normalizer.ts) | `normalizePhoneID`, `normalizePhoneToE164` | [`security-and-parsing-helpers.test.ts`](../tests/unit/security-and-parsing-helpers.test.ts) |
| `pii.mask_phone` | **Masking nomor telepon (PII)**<br>Menyensor nomor HP untuk log internal, audit trail, dan tampilan staf. | [`src/utils/pii-masker.ts`](../src/utils/pii-masker.ts) | `maskPhoneNumber`, `maskPhoneInText`, `maskPhoneWithTenantSuffix` | [`staff-chat-pii-masker.test.ts`](../tests/unit/staff-chat-pii-masker.test.ts) |
| `regex.escape` | **Escape string untuk ekspresi reguler**<br>Meng-escape karakter khusus regex (.*+?^${}()|[\]) agar aman digunakan di RegExp dinamis. | [`src/utils/regex-escape.ts`](../src/utils/regex-escape.ts) | `escapeRegex` | [`regex-escape.test.ts`](../tests/unit/regex-escape.test.ts) |
| `reservation.payment_evaluation` | **Evaluasi status pembayaran reservasi**<br>Menentukan status evaluasi pembayaran reservasi secara kanonis. | [`src/services/reservation-core.service.ts`](../src/services/reservation-core.service.ts) | `resolveReservationPaymentEvaluation` | *Belum ada (Fase lanjutan)* |
| `reservation.payment_response` | **Response wrapper evaluasi pembayaran reservasi**<br>Menyematkan hasil kalkulasi paymentEvaluation ke dalam payload respons reservasi admin. | [`src/routes/admin/shared/reservation-response.ts`](../src/routes/admin/shared/reservation-response.ts) | `withPaymentEvaluation` | [`reservation-payment-response.test.ts`](../tests/unit/reservation-payment-response.test.ts) |
| `schedule.overlap` | **Deteksi tumpang tindih slot jadwal**<br>Menghitung durasi efektif dan memeriksa tumpang-tindih interval reservasi atau janji temu. | [`src/services/slot-overlap.service.ts`](../src/services/slot-overlap.service.ts) | `effectiveDuration`, `intervalsOverlap` | [`slot-overlap-parity.test.ts`](../tests/unit/slot-overlap-parity.test.ts) |
| `tenant.resolve` | **Resolusi ID tenant admin**<br>Mendapatkan tenant_id dari request Fastify admin secara aman dengan fallback DEFAULT_TENANT_ID. | [`src/routes/admin/settings-helpers.ts`](../src/routes/admin/settings-helpers.ts) | `resolveTenantId`, `requireTenantId` | *Belum ada (Fase lanjutan)* |
| `tenant.scope` | **Isolasi tenant pembacaan baris**<br>Gerbang kanonis yang hanya mengembalikan baris milik tenant pemanggil (atau baris tanpa tenant_id/data lama), dan menolak baris milik tenant lain. | [`src/utils/tenant-scope.ts`](../src/utils/tenant-scope.ts) | `tenantScopedRow` | [`tenant-scope.test.ts`](../tests/unit/tenant-scope.test.ts) |
| `text.strip_edges` | **Pembersihan tepi token kata utuh**<br>Membuang karakter non-alfanumerik (a-z, 0-9) di awal dan akhir token hasil split spasi sebelum dicocokkan dengan himpunan kata. | [`src/utils/text-edge.ts`](../src/utils/text-edge.ts) | `stripNonAlnumEdges` | [`text-edge.test.ts`](../tests/unit/text-edge.test.ts) |
| `time.wib` | **Waktu Indonesia Barat (WIB)**<br>Operasi waktu dan tanggal berbasis WIB (UTC+7), offset milidetik, konversi UTC, dan batasan hari WIB. | [`src/utils/wib-time.ts`](../src/utils/wib-time.ts) | `WIB_OFFSET_MS`, `getWibNow`, `wibDayBoundsUtc`, `formatWibTime`, `wibDayRangeToUtc`, `formatWibDateYYYYMMDD`, `getWibDayName` | [`wib-time-consolidation.test.ts`](../tests/unit/wib-time-consolidation.test.ts) |

## 2. Rincian Modul & Aturan Guardrail

### `capi.pure_helpers` — Helper murni Meta Conversions API

- **Deskripsi:** Transformasi deterministik nilai CAPI, format _fbc, hash SHA-256, decrypt token, kanonikalisasi landing URL, ekstraksi nominal template, dan event_id Purchase — tanpa I/O.
- **File Kanonis:** [`src/services/capi.helpers.ts`](../src/services/capi.helpers.ts)
- **Ekspor Kanonis:** `maskName`, `parseCapiValue`, `formatMetaFbc`, `sha256Hash`, `decryptCapiToken`, `resolveCanonicalLandingUrl`, `extractValueByFormat`, `normalizeCapiMatchingGeo`, `buildDeterministicPurchaseEventId`, `buildLegacyPurchaseEventId`
- **Simbol Terlarang di Luar Kanonis:** `maskName`, `parseCapiValue`, `formatMetaFbc`, `sha256Hash`, `decryptCapiToken`, `resolveCanonicalLandingUrl`, `extractValueByFormat`, `normalizeCapiMatchingGeo`, `buildDeterministicPurchaseEventId`, `buildLegacyPurchaseEventId`
- **File yang Diizinkan:** `src/services/capi.helpers.ts`
- **File Test:** [`tests/unit/capi-value-guard.test.ts`](../tests/unit/capi-value-guard.test.ts)

### `date.parse_indonesian` — Parser tanggal bahasa Indonesia

- **Deskripsi:** Parsing ekspresi tanggal bahasa alami Indonesia (hari, nama bulan teks/angka, relatif) menjadi objek Date standar.
- **File Kanonis:** [`src/utils/indonesian-date-parser.ts`](../src/utils/indonesian-date-parser.ts)
- **Ekspor Kanonis:** `parseIndonesianDate`, `parseHistoricalIndonesianDate`, `applyBookingTimeToDate`
- **Simbol Terlarang di Luar Kanonis:** `parseIndonesianDate`
- **File yang Diizinkan:** `src/utils/indonesian-date-parser.ts`
- **File Test:** [`tests/unit/v3/indonesian-date-parser.test.ts`](../tests/unit/v3/indonesian-date-parser.test.ts)

### `json.extract` — Ekstraksi JSON dari output AI

- **Deskripsi:** Mengekstrak blok JSON seimbang dari respons teks LLM yang mengandung markdown atau teks pelengkap.
- **File Kanonis:** [`src/utils/json-extract.ts`](../src/utils/json-extract.ts)
- **Ekspor Kanonis:** `extractBalancedJson`, `extractJsonContent`, `repairTruncatedJson`
- **Simbol Terlarang di Luar Kanonis:** `extractBalancedJson`
- **File yang Diizinkan:** `src/utils/json-extract.ts`
- **File Test:** [`tests/unit/json-extract.test.ts`](../tests/unit/json-extract.test.ts)

### `livechat.serialize` — Proyeksi DTO LiveChat

- **Deskripsi:** Memetakan baris percakapan/kustomer/reservasi menjadi DTO LiveChat (badge reservasi, sumber lokasi, awaiting-reply) tanpa akses DB.
- **File Kanonis:** [`src/services/live-chat.serializer.ts`](../src/services/live-chat.serializer.ts)
- **Ekspor Kanonis:** `serializeLiveChatConversation`
- **Simbol Terlarang di Luar Kanonis:** `serializeLiveChatConversation`
- **File yang Diizinkan:** `src/services/live-chat.serializer.ts`
- **File Test:** [`tests/unit/livechat-payload-completeness.test.ts`](../tests/unit/livechat-payload-completeness.test.ts)

### `location.clinic_question` — Klasifikasi pertanyaan lokasi klinik

- **Deskripsi:** Mendeteksi apakah pesan customer menanyakan lokasi atau alamat klinik fisik.
- **File Kanonis:** [`src/utils/location-classifier.ts`](../src/utils/location-classifier.ts)
- **Ekspor Kanonis:** `isClinicLocationQuestion`
- **Simbol Terlarang di Luar Kanonis:** `isClinicLocationQuestion`
- **File yang Diizinkan:** `src/utils/location-classifier.ts`
- **File Test:** [`tests/unit/location-classifier.test.ts`](../tests/unit/location-classifier.test.ts)

### `log.date_key` — Kunci tanggal nama file log harian

- **Deskripsi:** Menghasilkan tanggal YYYY-MM-DD dari komponen lokal server untuk penamaan file log harian (llm-*.jsonl, app-*.log).
- **File Kanonis:** [`src/utils/log-date.ts`](../src/utils/log-date.ts)
- **Ekspor Kanonis:** `getLogDateString`
- **Simbol Terlarang di Luar Kanonis:** `getLogDateString`
- **File yang Diizinkan:** `src/utils/log-date.ts`
- **File Test:** [`tests/unit/log-date.test.ts`](../tests/unit/log-date.test.ts)

### `log.staff_rejection` — Logging penolakan bisnis rute staf

- **Deskripsi:** Logging terstruktur ke console.warn untuk penolakan bisnis (HTTP 400) rute staf agar otomatis diserap ke logs/app-YYYY-MM-DD.log.
- **File Kanonis:** [`src/utils/staff-rejection-log.ts`](../src/utils/staff-rejection-log.ts)
- **Ekspor Kanonis:** `logStaffRejection`
- **Simbol Terlarang di Luar Kanonis:** `logStaffRejection`
- **File yang Diizinkan:** `src/utils/staff-rejection-log.ts`
- **File Test:** [`tests/unit/staff-rejection-log.test.ts`](../tests/unit/staff-rejection-log.test.ts)

### `phone.normalize` — Normalisasi nomor telepon Indonesia

- **Deskripsi:** Normalisasi nomor HP format Indonesia (08x, +628x, 628x) ke format 628x standar atau E164.
- **File Kanonis:** [`src/utils/phone-normalizer.ts`](../src/utils/phone-normalizer.ts)
- **Ekspor Kanonis:** `normalizePhoneID`, `normalizePhoneToE164`
- **Simbol Terlarang di Luar Kanonis:** `normalizePhone`, `normalizePhoneID`, `normalizePhoneToE164`
- **File yang Diizinkan:** `src/utils/phone-normalizer.ts`
- **File Test:** [`tests/unit/security-and-parsing-helpers.test.ts`](../tests/unit/security-and-parsing-helpers.test.ts)

### `pii.mask_phone` — Masking nomor telepon (PII)

- **Deskripsi:** Menyensor nomor HP untuk log internal, audit trail, dan tampilan staf.
- **File Kanonis:** [`src/utils/pii-masker.ts`](../src/utils/pii-masker.ts)
- **Ekspor Kanonis:** `maskPhoneNumber`, `maskPhoneInText`, `maskPhoneWithTenantSuffix`
- **Simbol Terlarang di Luar Kanonis:** `maskPhone`, `maskPhoneNumber`, `maskPhoneInText`, `maskPhoneWithTenantSuffix`
- **File yang Diizinkan:** `src/utils/pii-masker.ts`
- **File Test:** [`tests/unit/staff-chat-pii-masker.test.ts`](../tests/unit/staff-chat-pii-masker.test.ts)

### `regex.escape` — Escape string untuk ekspresi reguler

- **Deskripsi:** Meng-escape karakter khusus regex (.*+?^${}()|[\]) agar aman digunakan di RegExp dinamis.
- **File Kanonis:** [`src/utils/regex-escape.ts`](../src/utils/regex-escape.ts)
- **Ekspor Kanonis:** `escapeRegex`
- **Simbol Terlarang di Luar Kanonis:** `escapeRegex`, `escapeRegExp`
- **File yang Diizinkan:** `src/utils/regex-escape.ts`
- **File Test:** [`tests/unit/regex-escape.test.ts`](../tests/unit/regex-escape.test.ts)

### `reservation.payment_evaluation` — Evaluasi status pembayaran reservasi

- **Deskripsi:** Menentukan status evaluasi pembayaran reservasi secara kanonis.
- **File Kanonis:** [`src/services/reservation-core.service.ts`](../src/services/reservation-core.service.ts)
- **Ekspor Kanonis:** `resolveReservationPaymentEvaluation`
- **Simbol Terlarang di Luar Kanonis:** `resolveReservationPaymentEvaluation`
- **File yang Diizinkan:** `src/services/reservation-core.service.ts`
- **File Test:** *Belum didefinisikan*

### `reservation.payment_response` — Response wrapper evaluasi pembayaran reservasi

- **Deskripsi:** Menyematkan hasil kalkulasi paymentEvaluation ke dalam payload respons reservasi admin.
- **File Kanonis:** [`src/routes/admin/shared/reservation-response.ts`](../src/routes/admin/shared/reservation-response.ts)
- **Ekspor Kanonis:** `withPaymentEvaluation`
- **Simbol Terlarang di Luar Kanonis:** `withPaymentEvaluation`
- **File yang Diizinkan:** `src/routes/admin/shared/reservation-response.ts`
- **File Test:** [`tests/unit/reservation-payment-response.test.ts`](../tests/unit/reservation-payment-response.test.ts)

### `schedule.overlap` — Deteksi tumpang tindih slot jadwal

- **Deskripsi:** Menghitung durasi efektif dan memeriksa tumpang-tindih interval reservasi atau janji temu.
- **File Kanonis:** [`src/services/slot-overlap.service.ts`](../src/services/slot-overlap.service.ts)
- **Ekspor Kanonis:** `effectiveDuration`, `intervalsOverlap`
- **Simbol Terlarang di Luar Kanonis:** `effectiveDuration`, `intervalsOverlap`
- **File yang Diizinkan:** `src/services/slot-overlap.service.ts`
- **File Test:** [`tests/unit/slot-overlap-parity.test.ts`](../tests/unit/slot-overlap-parity.test.ts)

### `tenant.resolve` — Resolusi ID tenant admin

- **Deskripsi:** Mendapatkan tenant_id dari request Fastify admin secara aman dengan fallback DEFAULT_TENANT_ID.
- **File Kanonis:** [`src/routes/admin/settings-helpers.ts`](../src/routes/admin/settings-helpers.ts)
- **Ekspor Kanonis:** `resolveTenantId`, `requireTenantId`
- **Simbol Terlarang di Luar Kanonis:** `resolveTenant`, `resolveTenantId`
- **File yang Diizinkan:** `src/routes/admin/settings-helpers.ts`
- **File Test:** *Belum didefinisikan*

### `tenant.scope` — Isolasi tenant pembacaan baris

- **Deskripsi:** Gerbang kanonis yang hanya mengembalikan baris milik tenant pemanggil (atau baris tanpa tenant_id/data lama), dan menolak baris milik tenant lain.
- **File Kanonis:** [`src/utils/tenant-scope.ts`](../src/utils/tenant-scope.ts)
- **Ekspor Kanonis:** `tenantScopedRow`
- **Simbol Terlarang di Luar Kanonis:** `tenantScopedRow`
- **File yang Diizinkan:** `src/utils/tenant-scope.ts`
- **File Test:** [`tests/unit/tenant-scope.test.ts`](../tests/unit/tenant-scope.test.ts)

### `text.strip_edges` — Pembersihan tepi token kata utuh

- **Deskripsi:** Membuang karakter non-alfanumerik (a-z, 0-9) di awal dan akhir token hasil split spasi sebelum dicocokkan dengan himpunan kata.
- **File Kanonis:** [`src/utils/text-edge.ts`](../src/utils/text-edge.ts)
- **Ekspor Kanonis:** `stripNonAlnumEdges`
- **Simbol Terlarang di Luar Kanonis:** `stripNonAlnumEdges`
- **File yang Diizinkan:** `src/utils/text-edge.ts`
- **File Test:** [`tests/unit/text-edge.test.ts`](../tests/unit/text-edge.test.ts)

### `time.wib` — Waktu Indonesia Barat (WIB)

- **Deskripsi:** Operasi waktu dan tanggal berbasis WIB (UTC+7), offset milidetik, konversi UTC, dan batasan hari WIB.
- **File Kanonis:** [`src/utils/wib-time.ts`](../src/utils/wib-time.ts)
- **Ekspor Kanonis:** `WIB_OFFSET_MS`, `getWibNow`, `wibDayBoundsUtc`, `formatWibTime`, `wibDayRangeToUtc`, `formatWibDateYYYYMMDD`, `getWibDayName`
- **Simbol Terlarang di Luar Kanonis:** `WIB_OFFSET_MS`, `getWibNow`, `wibDayBoundsUtc`, `formatWibTime`, `wibDayRangeToUtc`
- **File yang Diizinkan:** `src/utils/wib-time.ts`, `src/utils/time-wib.ts`
- **File Test:** [`tests/unit/wib-time-consolidation.test.ts`](../tests/unit/wib-time-consolidation.test.ts)

---

## 3. Cara Menambah atau Mengubah Modul Kanonis

1. Pastikan kapabilitas baru benar-benar bersifat fondasional dan dipakai lintas modul.
2. Daftarkan entri baru di `scripts/module-registry.json`.
3. Jalankan `npm run docs:modules` untuk memperbarui dokumen ini.
4. Jalankan `npx vitest run tests/unit/module-registry.test.ts` untuk memastikan kepatuhan skema dan fakta disk.
