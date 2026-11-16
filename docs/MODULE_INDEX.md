# Modul Kanonis & Registry Reuse

> **PERINGATAN — FILE INI DIBUAT OTOMATIS.**
> Jangan edit file ini secara manual. Sumber kebenaran adalah `scripts/module-registry.json`.
> Untuk memperbarui dokumen ini, jalankan: `npm run docs:modules`.
> Untuk mencari modul dari CLI sebelum membuat kode baru, jalankan: `npm run find:module -- "<kebutuhan>"`.

## 1. Daftar Kapabilitas Kanonis Aktif

Total kapabilitas terdaftar: **9 modul**.

| ID Kapabilitas | Judul & Deskripsi | Modul Kanonis | Ekspor Resmi | Test File |
|---|---|---|---|---|
| `date.parse_indonesian` | **Parser tanggal bahasa Indonesia**<br>Parsing ekspresi tanggal bahasa alami Indonesia (hari, nama bulan teks/angka, relatif) menjadi objek Date standar. | [`src/utils/indonesian-date-parser.ts`](../src/utils/indonesian-date-parser.ts) | `parseIndonesianDate`, `applyBookingTimeToDate` | [`indonesian-date-parser.test.ts`](../tests/unit/v3/indonesian-date-parser.test.ts) |
| `json.extract` | **Ekstraksi JSON dari output AI**<br>Mengekstrak blok JSON seimbang dari respons teks LLM yang mengandung markdown atau teks pelengkap. | [`src/utils/json-extract.ts`](../src/utils/json-extract.ts) | `extractBalancedJson`, `extractJsonContent`, `repairTruncatedJson` | [`json-extract.test.ts`](../tests/unit/json-extract.test.ts) |
| `location.clinic_question` | **Klasifikasi pertanyaan lokasi klinik**<br>Mendeteksi apakah pesan customer menanyakan lokasi atau alamat klinik fisik. | [`src/utils/location-classifier.ts`](../src/utils/location-classifier.ts) | `isClinicLocationQuestion` | [`location-classifier.test.ts`](../tests/unit/location-classifier.test.ts) |
| `phone.normalize` | **Normalisasi nomor telepon Indonesia**<br>Normalisasi nomor HP format Indonesia (08x, +628x, 628x) ke format 628x standar atau E164. | [`src/utils/phone-normalizer.ts`](../src/utils/phone-normalizer.ts) | `normalizePhoneID`, `normalizePhoneToE164` | [`security-and-parsing-helpers.test.ts`](../tests/unit/security-and-parsing-helpers.test.ts) |
| `pii.mask_phone` | **Masking nomor telepon (PII)**<br>Menyensor nomor HP untuk log internal, audit trail, dan tampilan staf. | [`src/utils/pii-masker.ts`](../src/utils/pii-masker.ts) | `maskPhoneNumber`, `maskPhoneInText` | [`staff-chat-pii-masker.test.ts`](../tests/unit/staff-chat-pii-masker.test.ts) |
| `reservation.payment_evaluation` | **Evaluasi status pembayaran reservasi**<br>Menentukan status evaluasi pembayaran reservasi secara kanonis. | [`src/services/reservation-core.service.ts`](../src/services/reservation-core.service.ts) | `resolveReservationPaymentEvaluation` | *Belum ada (Fase lanjutan)* |
| `schedule.overlap` | **Deteksi tumpang tindih slot jadwal**<br>Menghitung durasi efektif dan memeriksa tumpang-tindih interval reservasi atau janji temu. | [`src/services/slot-overlap.service.ts`](../src/services/slot-overlap.service.ts) | `effectiveDuration`, `intervalsOverlap` | [`slot-overlap-parity.test.ts`](../tests/unit/slot-overlap-parity.test.ts) |
| `tenant.resolve` | **Resolusi ID tenant admin**<br>Mendapatkan tenant_id dari request Fastify admin secara aman dengan fallback DEFAULT_TENANT_ID. | [`src/routes/admin/settings-helpers.ts`](../src/routes/admin/settings-helpers.ts) | `resolveTenantId`, `requireTenantId` | *Belum ada (Fase lanjutan)* |
| `time.wib` | **Waktu Indonesia Barat (WIB)**<br>Operasi waktu dan tanggal berbasis WIB (UTC+7), offset milidetik, konversi UTC, dan batasan hari WIB. | [`src/utils/wib-time.ts`](../src/utils/wib-time.ts) | `WIB_OFFSET_MS`, `getWibNow`, `wibDayBoundsUtc`, `formatWibTime`, `wibDayRangeToUtc`, `formatWibDateYYYYMMDD`, `getWibDayName` | [`wib-time-consolidation.test.ts`](../tests/unit/wib-time-consolidation.test.ts) |

## 2. Rincian Modul & Aturan Guardrail

### `date.parse_indonesian` — Parser tanggal bahasa Indonesia

- **Deskripsi:** Parsing ekspresi tanggal bahasa alami Indonesia (hari, nama bulan teks/angka, relatif) menjadi objek Date standar.
- **File Kanonis:** [`src/utils/indonesian-date-parser.ts`](../src/utils/indonesian-date-parser.ts)
- **Ekspor Kanonis:** `parseIndonesianDate`, `applyBookingTimeToDate`
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

### `location.clinic_question` — Klasifikasi pertanyaan lokasi klinik

- **Deskripsi:** Mendeteksi apakah pesan customer menanyakan lokasi atau alamat klinik fisik.
- **File Kanonis:** [`src/utils/location-classifier.ts`](../src/utils/location-classifier.ts)
- **Ekspor Kanonis:** `isClinicLocationQuestion`
- **Simbol Terlarang di Luar Kanonis:** `isClinicLocationQuestion`
- **File yang Diizinkan:** `src/utils/location-classifier.ts`
- **File Test:** [`tests/unit/location-classifier.test.ts`](../tests/unit/location-classifier.test.ts)

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
- **Ekspor Kanonis:** `maskPhoneNumber`, `maskPhoneInText`
- **Simbol Terlarang di Luar Kanonis:** `maskPhone`, `maskPhoneNumber`, `maskPhoneInText`
- **File yang Diizinkan:** `src/utils/pii-masker.ts`
- **File Test:** [`tests/unit/staff-chat-pii-masker.test.ts`](../tests/unit/staff-chat-pii-masker.test.ts)

### `reservation.payment_evaluation` — Evaluasi status pembayaran reservasi

- **Deskripsi:** Menentukan status evaluasi pembayaran reservasi secara kanonis.
- **File Kanonis:** [`src/services/reservation-core.service.ts`](../src/services/reservation-core.service.ts)
- **Ekspor Kanonis:** `resolveReservationPaymentEvaluation`
- **Simbol Terlarang di Luar Kanonis:** `resolveReservationPaymentEvaluation`
- **File yang Diizinkan:** `src/services/reservation-core.service.ts`
- **File Test:** *Belum didefinisikan*

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
