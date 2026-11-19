# Modul Kanonis & Registry Reuse

> **PERINGATAN — FILE INI DIBUAT OTOMATIS.**
> Jangan edit file ini secara manual. Sumber kebenaran adalah `scripts/module-registry.json`.
> Untuk memperbarui dokumen ini, jalankan: `npm run docs:modules`.
> Untuk mencari modul dari CLI sebelum membuat kode baru, jalankan: `npm run find:module -- "<kebutuhan>"`.

## 1. Daftar Kapabilitas Kanonis Aktif

Total kapabilitas terdaftar: **29 modul**.

| ID Kapabilitas | Judul & Deskripsi | Modul Kanonis | Ekspor Resmi | Test File |
|---|---|---|---|---|
| `capi.pure_helpers` | **Helper murni Meta Conversions API**<br>Transformasi deterministik nilai CAPI, format _fbc, hash SHA-256, decrypt token, kanonikalisasi landing URL, ekstraksi nominal template, dan event_id Purchase — tanpa I/O. | [`src/services/capi.helpers.ts`](../src/services/capi.helpers.ts) | `maskName`, `parseCapiValue`, `formatMetaFbc`, `sha256Hash`, `decryptCapiToken`, `resolveCanonicalLandingUrl`, `extractValueByFormat`, `normalizeCapiMatchingGeo`, `buildDeterministicPurchaseEventId`, `buildLegacyPurchaseEventId` | [`capi-value-guard.test.ts`](../tests/unit/capi-value-guard.test.ts) |
| `date.parse_indonesian` | **Parser tanggal bahasa Indonesia**<br>Parsing ekspresi tanggal bahasa alami Indonesia (hari, nama bulan teks/angka, relatif) menjadi objek Date standar. | [`src/utils/indonesian-date-parser.ts`](../src/utils/indonesian-date-parser.ts) | `parseIndonesianDate`, `parseHistoricalIndonesianDate`, `applyBookingTimeToDate` | [`indonesian-date-parser.test.ts`](../tests/unit/v3/indonesian-date-parser.test.ts) |
| `followup.holiday_scheduling` | **Kontrak & resolusi Mode Libur Follow-Up**<br>Parser konfigurasi libur tenant, resolver state (active/exit_pending/manual_expired), clamp jadwal ke hari buka pertama, dan epoch skema repeat 25/50/75 hari yang non-retroaktif. | [`src/config/followup-scheduling.ts`](../src/config/followup-scheduling.ts) | `parseFollowUpHolidayConfig`, `parseFollowUpHolidayInput`, `resolveFollowUpHolidayState`, `clampScheduledAtToPostHoliday`, `countWibDaysBetween`, `isRepeatSchemeEligible`, `NEXT_TREATMENT_SCHEME_EPOCH` | [`followup-holiday-state.test.ts`](../tests/unit/followup-holiday-state.test.ts) |
| `followup.schedule_allocator` | **Alokator slot follow-up beban-aware**<br>Membagi antrean follow-up ke slot jam kerja WIB secara deterministik, menghormati beban existing per hari, dan mengisi celah slot kosong untuk mencegah blasting. | [`src/services/followup-schedule-allocator.ts`](../src/services/followup-schedule-allocator.ts) | `allocateFollowUpSlots`, `loadFollowUpDailyLoad`, `loadFollowUpDailyLoadDetailed`, `getWibMinutes` | [`followup-schedule-allocator.test.ts`](../tests/unit/followup-schedule-allocator.test.ts) |
| `json.extract` | **Ekstraksi JSON dari output AI**<br>Mengekstrak blok JSON seimbang dari respons teks LLM yang mengandung markdown atau teks pelengkap. | [`src/utils/json-extract.ts`](../src/utils/json-extract.ts) | `extractBalancedJson`, `extractJsonContent`, `repairTruncatedJson` | [`json-extract.test.ts`](../tests/unit/json-extract.test.ts) |
| `livechat.serialize` | **Proyeksi DTO LiveChat**<br>Memetakan baris percakapan/kustomer/reservasi menjadi DTO LiveChat (badge reservasi, sumber lokasi, awaiting-reply) tanpa akses DB. | [`src/services/live-chat.serializer.ts`](../src/services/live-chat.serializer.ts) | `serializeLiveChatConversation` | [`livechat-payload-completeness.test.ts`](../tests/unit/livechat-payload-completeness.test.ts) |
| `location.adequacy` | **Kecukupan, presisi, dan precedence lokasi tugas**<br>Resolver kanonis kecukupan/presisi/kepercayaan lokasi serta precedence titik tugas (pemilik koordinat) berbasis status; mencegah penurunan label & shareloc palsu. | [`src/domain/location-adequacy.ts`](../src/domain/location-adequacy.ts) | `resolveLocationAdequacy`, `resolveTaskLocationPrecedence`, `extractStaffVerifiedCoords`, `SAME_PLACE_TOLERANCE_M` | [`location-adequacy.test.ts`](../tests/unit/location-adequacy.test.ts) |
| `location.clinic_question` | **Klasifikasi pertanyaan lokasi klinik**<br>Mendeteksi apakah pesan customer menanyakan lokasi atau alamat klinik fisik. | [`src/utils/location-classifier.ts`](../src/utils/location-classifier.ts) | `isClinicLocationQuestion` | [`location-classifier.test.ts`](../tests/unit/location-classifier.test.ts) |
| `location.gps_tier` | **Pemilihan tier kandidat GPS**<br>Pemilih deterministik kandidat koordinat berdasarkan hierarki tier dan kebaruan dalam tier yang sama. | [`src/domain/gps-tier.ts`](../src/domain/gps-tier.ts) | `pickGpsTier` | [`location-ingest.test.ts`](../tests/unit/location-ingest.test.ts) |
| `location.heal_provenance` | **Healing provenance kartu lokasi (data)**<br>Skrip idempoten (default dry-run, tenant-scoped) untuk memperbaiki provenance 1-kartu yang cocok dengan pin WA pelanggan; audit trail, tanpa tulis last_used_at. | [`src/scripts/heal-single-card-provenance.ts`](../src/scripts/heal-single-card-provenance.ts) | `runHeal`, `hasWaGpsEvidence` | [`heal-single-card-provenance.test.ts`](../tests/unit/heal-single-card-provenance.test.ts) |
| `location.source_seam` | **Sumber & label lokasi kanonis (anti-siklus)**<br>Normalisasi sumber lokasi (gps_pin/manual_staff/estimated_area) dan label dinamis sebagai seam bersama domain/services untuk memutus siklus import (Plan Lokasi Kepercayaan v2.2). | [`src/domain/location-source.ts`](../src/domain/location-source.ts) | `resolveEffectiveLocationSource`, `resolveLocationSource`, `buildLocationSourceLabel`, `STAFF_VERIFIED_LOCATION_LABEL`, `FIELD_VERIFIED_LOCATION_LABEL` | [`staff-location-sync.test.ts`](../tests/unit/staff-location-sync.test.ts) |
| `location.travel_duration` | **Estimasi durasi tempuh motor**<br>Estimasi durasi tempuh sepeda motor dari jarak km (kalibrasi + buffer) untuk kartu/itinerary staf. | [`src/utils/travel-duration.ts`](../src/utils/travel-duration.ts) | `estimateTravelDurationMinutes` | [`staff-location-sync.test.ts`](../tests/unit/staff-location-sync.test.ts) |
| `location.trust_verification` | **Verifikasi lapangan lokasi (field_verified)**<br>Kontrak derivasi field_verified dari bukti GPS lapangan nyata (foto + GPS segar/valid + rumah sama) dan riwayat verifikasi. | [`src/domain/location-trust.ts`](../src/domain/location-trust.ts) | `deriveFieldVerification`, `hasFieldVerifiedGpsHistory` | [`staff-task-location-precedence.test.ts`](../tests/unit/staff-task-location-precedence.test.ts) |
| `log.date_key` | **Kunci tanggal nama file log harian**<br>Menghasilkan tanggal YYYY-MM-DD dari komponen lokal server untuk penamaan file log harian (llm-*.jsonl, app-*.log). | [`src/utils/log-date.ts`](../src/utils/log-date.ts) | `getLogDateString` | [`log-date.test.ts`](../tests/unit/log-date.test.ts) |
| `log.staff_rejection` | **Logging penolakan bisnis rute staf**<br>Logging terstruktur ke console.warn untuk penolakan bisnis (HTTP 400) rute staf agar otomatis diserap ke logs/app-YYYY-MM-DD.log. | [`src/utils/staff-rejection-log.ts`](../src/utils/staff-rejection-log.ts) | `logStaffRejection` | [`staff-rejection-log.test.ts`](../tests/unit/staff-rejection-log.test.ts) |
| `migration.staging` | **Akses data staging migrasi & FAQ**<br>Query tenant-scoped untuk antrean staging migrasi legacy, LTV customer, serta staging FAQ medis/umum (termasuk batch chunk anti N+1). | [`src/services/migration-staging.service.ts`](../src/services/migration-staging.service.ts) | `listLegacyStaging`, `listLegacyStagingByStatus`, `updateLegacyStagingStatus`, `bulkApproveStagingPurchases`, `countTenantConversations`, `clearPendingFaqStaging`, `deleteAllFaqStaging`, `listFaqStaging`, `reviewMedicalFaqStaging`, `reviewGeneralFaqStaging` | [`migration-staging.test.ts`](../tests/unit/migration-staging.test.ts) |
| `phone.normalize` | **Normalisasi nomor telepon Indonesia**<br>Normalisasi nomor HP format Indonesia (08x, +628x, 628x) ke format 628x standar atau E164. | [`src/utils/phone-normalizer.ts`](../src/utils/phone-normalizer.ts) | `normalizePhoneID`, `normalizePhoneToE164` | [`security-and-parsing-helpers.test.ts`](../tests/unit/security-and-parsing-helpers.test.ts) |
| `pii.mask_phone` | **Masking nomor telepon (PII)**<br>Menyensor nomor HP untuk log internal, audit trail, dan tampilan staf. | [`src/utils/pii-masker.ts`](../src/utils/pii-masker.ts) | `maskPhoneNumber`, `maskPhoneInText`, `maskPhoneWithTenantSuffix` | [`staff-chat-pii-masker.test.ts`](../tests/unit/staff-chat-pii-masker.test.ts) |
| `rbac.role_module_scopes` | **Kebijakan Layer 1 RBAC & derivasi scope custom role**<br>Sumber kebenaran tunggal daftar batas keamanan Layer 1 RBAC (Super Admin only/write-only/restricted sub-paths) dan pemetaan deterministik modul UI ke role_api_scopes tanpa I/O. | [`src/domain/role-module-scopes.ts`](../src/domain/role-module-scopes.ts) | `SUPER_ADMIN_ONLY_PREFIXES`, `SETTINGS_READ_ALLOWLIST`, `SUPER_ADMIN_WRITE_PREFIXES`, `SUPER_ADMIN_RESTRICTED_SUBPATHS`, `SUPER_ADMIN_ONLY_MODULE_PATHS`, `BASELINE_STAFF_API_SCOPES`, `MODULE_PATH_TO_API_SCOPES`, `isScopeFullyBlockedByLayer1`, `deriveApiScopesForAllowedPaths` | [`rbac-route-contract-matrix.test.ts`](../tests/unit/rbac-route-contract-matrix.test.ts) |
| `regex.escape` | **Escape string untuk ekspresi reguler**<br>Meng-escape karakter khusus regex (.*+?^${}()|[\]) agar aman digunakan di RegExp dinamis. | [`src/utils/regex-escape.ts`](../src/utils/regex-escape.ts) | `escapeRegex` | [`regex-escape.test.ts`](../tests/unit/regex-escape.test.ts) |
| `reservation.payment_evaluation` | **Evaluasi status pembayaran reservasi**<br>Menentukan status evaluasi pembayaran dan snapshot ongkir reservasi secara kanonis (murni, tanpa I/O). | [`src/domain/payment-expected.ts`](../src/domain/payment-expected.ts) | `resolveReservationPaymentEvaluation`, `resolveDeliveryFeeSnapshot` | *Belum ada (Fase lanjutan)* |
| `reservation.payment_response` | **Response wrapper evaluasi pembayaran reservasi**<br>Menyematkan hasil kalkulasi paymentEvaluation ke dalam payload respons reservasi admin. | [`src/routes/admin/shared/reservation-response.ts`](../src/routes/admin/shared/reservation-response.ts) | `withPaymentEvaluation` | [`reservation-payment-response.test.ts`](../tests/unit/reservation-payment-response.test.ts) |
| `reservation.payment_verification` | **Verifikasi bukti pembayaran reservasi**<br>Seam kanonis verifikasi pembayaran transfer/non-tunai: simpan bukti permanen, hitung tagihan kanonis (GROSS), catat pembayaran tanpa mengubah status kunjungan, audit tenant-aware — tanpa akses Prisma di route. | [`src/services/reservation-payment-verification.service.ts`](../src/services/reservation-payment-verification.service.ts) | `verifyReservationPayment` | [`admin-verify-payment.test.ts`](../tests/integration/admin-verify-payment.test.ts) |
| `schedule.overlap` | **Deteksi tumpang tindih slot jadwal**<br>Menghitung durasi efektif dan memeriksa tumpang-tindih interval reservasi atau janji temu. | [`src/services/slot-overlap.service.ts`](../src/services/slot-overlap.service.ts) | `effectiveDuration`, `intervalsOverlap` | [`slot-overlap-parity.test.ts`](../tests/unit/slot-overlap-parity.test.ts) |
| `tenant.resolve` | **Resolusi ID tenant admin**<br>Mendapatkan tenant_id dari request Fastify admin secara aman dengan fallback DEFAULT_TENANT_ID. | [`src/routes/admin/settings-helpers.ts`](../src/routes/admin/settings-helpers.ts) | `resolveTenantId`, `requireTenantId` | *Belum ada (Fase lanjutan)* |
| `tenant.scope` | **Isolasi tenant pembacaan baris**<br>Gerbang kanonis yang hanya mengembalikan baris milik tenant pemanggil (atau baris tanpa tenant_id/data lama), dan menolak baris milik tenant lain. | [`src/utils/tenant-scope.ts`](../src/utils/tenant-scope.ts) | `tenantScopedRow` | [`tenant-scope.test.ts`](../tests/unit/tenant-scope.test.ts) |
| `text.strip_edges` | **Pembersihan tepi token kata utuh**<br>Membuang karakter non-alfanumerik (a-z, 0-9) di awal dan akhir token hasil split spasi sebelum dicocokkan dengan himpunan kata. | [`src/utils/text-edge.ts`](../src/utils/text-edge.ts) | `stripNonAlnumEdges` | [`text-edge.test.ts`](../tests/unit/text-edge.test.ts) |
| `time.wib` | **Waktu Indonesia Barat (WIB)**<br>Operasi waktu dan tanggal berbasis WIB (UTC+7), offset milidetik, konversi UTC, dan batasan hari WIB. | [`src/utils/wib-time.ts`](../src/utils/wib-time.ts) | `WIB_OFFSET_MS`, `getWibNow`, `wibDayBoundsUtc`, `formatWibTime`, `wibDayRangeToUtc`, `formatWibDateYYYYMMDD`, `getWibDayName` | [`wib-time-consolidation.test.ts`](../tests/unit/wib-time-consolidation.test.ts) |
| `treatment.catalog_value` | **Resolusi nilai treatment dari katalog**<br>Mencari harga treatment (promo/original) dari katalog tenant dengan pencocokan alias, bundle, multi-item, dan fallback kategori — tanpa DB langsung. | [`src/services/treatment-value.service.ts`](../src/services/treatment-value.service.ts) | `resolveTreatmentValue` | [`capi-value-no-hardcode.test.ts`](../tests/unit/capi-value-no-hardcode.test.ts) |

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

### `followup.holiday_scheduling` — Kontrak & resolusi Mode Libur Follow-Up

- **Deskripsi:** Parser konfigurasi libur tenant, resolver state (active/exit_pending/manual_expired), clamp jadwal ke hari buka pertama, dan epoch skema repeat 25/50/75 hari yang non-retroaktif.
- **File Kanonis:** [`src/config/followup-scheduling.ts`](../src/config/followup-scheduling.ts)
- **Ekspor Kanonis:** `parseFollowUpHolidayConfig`, `parseFollowUpHolidayInput`, `resolveFollowUpHolidayState`, `clampScheduledAtToPostHoliday`, `countWibDaysBetween`, `isRepeatSchemeEligible`, `NEXT_TREATMENT_SCHEME_EPOCH`
- **Simbol Terlarang di Luar Kanonis:** `parseFollowUpHolidayConfig`, `parseFollowUpHolidayInput`, `resolveFollowUpHolidayState`, `clampScheduledAtToPostHoliday`, `isRepeatSchemeEligible`
- **File yang Diizinkan:** `src/config/followup-scheduling.ts`
- **File Test:** [`tests/unit/followup-holiday-state.test.ts`](../tests/unit/followup-holiday-state.test.ts)

### `followup.schedule_allocator` — Alokator slot follow-up beban-aware

- **Deskripsi:** Membagi antrean follow-up ke slot jam kerja WIB secara deterministik, menghormati beban existing per hari, dan mengisi celah slot kosong untuk mencegah blasting.
- **File Kanonis:** [`src/services/followup-schedule-allocator.ts`](../src/services/followup-schedule-allocator.ts)
- **Ekspor Kanonis:** `allocateFollowUpSlots`, `loadFollowUpDailyLoad`, `loadFollowUpDailyLoadDetailed`, `getWibMinutes`
- **Simbol Terlarang di Luar Kanonis:** `allocateFollowUpSlots`, `loadFollowUpDailyLoad`
- **File yang Diizinkan:** `src/services/followup-schedule-allocator.ts`
- **File Test:** [`tests/unit/followup-schedule-allocator.test.ts`](../tests/unit/followup-schedule-allocator.test.ts)

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

### `location.adequacy` — Kecukupan, presisi, dan precedence lokasi tugas

- **Deskripsi:** Resolver kanonis kecukupan/presisi/kepercayaan lokasi serta precedence titik tugas (pemilik koordinat) berbasis status; mencegah penurunan label & shareloc palsu.
- **File Kanonis:** [`src/domain/location-adequacy.ts`](../src/domain/location-adequacy.ts)
- **Ekspor Kanonis:** `resolveLocationAdequacy`, `resolveTaskLocationPrecedence`, `extractStaffVerifiedCoords`, `SAME_PLACE_TOLERANCE_M`
- **Simbol Terlarang di Luar Kanonis:** `resolveLocationAdequacy`, `resolveTaskLocationPrecedence`
- **File yang Diizinkan:** `src/domain/location-adequacy.ts`
- **File Test:** [`tests/unit/location-adequacy.test.ts`](../tests/unit/location-adequacy.test.ts)

### `location.clinic_question` — Klasifikasi pertanyaan lokasi klinik

- **Deskripsi:** Mendeteksi apakah pesan customer menanyakan lokasi atau alamat klinik fisik.
- **File Kanonis:** [`src/utils/location-classifier.ts`](../src/utils/location-classifier.ts)
- **Ekspor Kanonis:** `isClinicLocationQuestion`
- **Simbol Terlarang di Luar Kanonis:** `isClinicLocationQuestion`
- **File yang Diizinkan:** `src/utils/location-classifier.ts`
- **File Test:** [`tests/unit/location-classifier.test.ts`](../tests/unit/location-classifier.test.ts)

### `location.gps_tier` — Pemilihan tier kandidat GPS

- **Deskripsi:** Pemilih deterministik kandidat koordinat berdasarkan hierarki tier dan kebaruan dalam tier yang sama.
- **File Kanonis:** [`src/domain/gps-tier.ts`](../src/domain/gps-tier.ts)
- **Ekspor Kanonis:** `pickGpsTier`
- **Simbol Terlarang di Luar Kanonis:** `pickGpsTier`
- **File yang Diizinkan:** `src/domain/gps-tier.ts`
- **File Test:** [`tests/unit/location-ingest.test.ts`](../tests/unit/location-ingest.test.ts)

### `location.heal_provenance` — Healing provenance kartu lokasi (data)

- **Deskripsi:** Skrip idempoten (default dry-run, tenant-scoped) untuk memperbaiki provenance 1-kartu yang cocok dengan pin WA pelanggan; audit trail, tanpa tulis last_used_at.
- **File Kanonis:** [`src/scripts/heal-single-card-provenance.ts`](../src/scripts/heal-single-card-provenance.ts)
- **Ekspor Kanonis:** `runHeal`, `hasWaGpsEvidence`
- **Simbol Terlarang di Luar Kanonis:** `runHeal`
- **File yang Diizinkan:** `src/scripts/heal-single-card-provenance.ts`
- **File Test:** [`tests/unit/heal-single-card-provenance.test.ts`](../tests/unit/heal-single-card-provenance.test.ts)

### `location.source_seam` — Sumber & label lokasi kanonis (anti-siklus)

- **Deskripsi:** Normalisasi sumber lokasi (gps_pin/manual_staff/estimated_area) dan label dinamis sebagai seam bersama domain/services untuk memutus siklus import (Plan Lokasi Kepercayaan v2.2).
- **File Kanonis:** [`src/domain/location-source.ts`](../src/domain/location-source.ts)
- **Ekspor Kanonis:** `resolveEffectiveLocationSource`, `resolveLocationSource`, `buildLocationSourceLabel`, `STAFF_VERIFIED_LOCATION_LABEL`, `FIELD_VERIFIED_LOCATION_LABEL`
- **Simbol Terlarang di Luar Kanonis:** `resolveLocationSource`, `STAFF_VERIFIED_LOCATION_LABEL`
- **File yang Diizinkan:** `src/domain/location-source.ts`
- **File Test:** [`tests/unit/staff-location-sync.test.ts`](../tests/unit/staff-location-sync.test.ts)

### `location.travel_duration` — Estimasi durasi tempuh motor

- **Deskripsi:** Estimasi durasi tempuh sepeda motor dari jarak km (kalibrasi + buffer) untuk kartu/itinerary staf.
- **File Kanonis:** [`src/utils/travel-duration.ts`](../src/utils/travel-duration.ts)
- **Ekspor Kanonis:** `estimateTravelDurationMinutes`
- **Simbol Terlarang di Luar Kanonis:** `estimateTravelDurationMinutes`
- **File yang Diizinkan:** `src/utils/travel-duration.ts`
- **File Test:** [`tests/unit/staff-location-sync.test.ts`](../tests/unit/staff-location-sync.test.ts)

### `location.trust_verification` — Verifikasi lapangan lokasi (field_verified)

- **Deskripsi:** Kontrak derivasi field_verified dari bukti GPS lapangan nyata (foto + GPS segar/valid + rumah sama) dan riwayat verifikasi.
- **File Kanonis:** [`src/domain/location-trust.ts`](../src/domain/location-trust.ts)
- **Ekspor Kanonis:** `deriveFieldVerification`, `hasFieldVerifiedGpsHistory`
- **Simbol Terlarang di Luar Kanonis:** `deriveFieldVerification`
- **File yang Diizinkan:** `src/domain/location-trust.ts`
- **File Test:** [`tests/unit/staff-task-location-precedence.test.ts`](../tests/unit/staff-task-location-precedence.test.ts)

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

### `migration.staging` — Akses data staging migrasi & FAQ

- **Deskripsi:** Query tenant-scoped untuk antrean staging migrasi legacy, LTV customer, serta staging FAQ medis/umum (termasuk batch chunk anti N+1).
- **File Kanonis:** [`src/services/migration-staging.service.ts`](../src/services/migration-staging.service.ts)
- **Ekspor Kanonis:** `listLegacyStaging`, `listLegacyStagingByStatus`, `updateLegacyStagingStatus`, `bulkApproveStagingPurchases`, `countTenantConversations`, `clearPendingFaqStaging`, `deleteAllFaqStaging`, `listFaqStaging`, `reviewMedicalFaqStaging`, `reviewGeneralFaqStaging`
- **Simbol Terlarang di Luar Kanonis:** `bulkApproveStagingPurchases`, `listLegacyStaging`, `listFaqStaging`
- **File yang Diizinkan:** `src/services/migration-staging.service.ts`
- **File Test:** [`tests/unit/migration-staging.test.ts`](../tests/unit/migration-staging.test.ts)

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

### `rbac.role_module_scopes` — Kebijakan Layer 1 RBAC & derivasi scope custom role

- **Deskripsi:** Sumber kebenaran tunggal daftar batas keamanan Layer 1 RBAC (Super Admin only/write-only/restricted sub-paths) dan pemetaan deterministik modul UI ke role_api_scopes tanpa I/O.
- **File Kanonis:** [`src/domain/role-module-scopes.ts`](../src/domain/role-module-scopes.ts)
- **Ekspor Kanonis:** `SUPER_ADMIN_ONLY_PREFIXES`, `SETTINGS_READ_ALLOWLIST`, `SUPER_ADMIN_WRITE_PREFIXES`, `SUPER_ADMIN_RESTRICTED_SUBPATHS`, `SUPER_ADMIN_ONLY_MODULE_PATHS`, `BASELINE_STAFF_API_SCOPES`, `MODULE_PATH_TO_API_SCOPES`, `isScopeFullyBlockedByLayer1`, `deriveApiScopesForAllowedPaths`
- **Simbol Terlarang di Luar Kanonis:** `deriveApiScopesForAllowedPaths`, `isScopeFullyBlockedByLayer1`
- **File yang Diizinkan:** `src/domain/role-module-scopes.ts`
- **File Test:** [`tests/unit/rbac-route-contract-matrix.test.ts`](../tests/unit/rbac-route-contract-matrix.test.ts)

### `regex.escape` — Escape string untuk ekspresi reguler

- **Deskripsi:** Meng-escape karakter khusus regex (.*+?^${}()|[\]) agar aman digunakan di RegExp dinamis.
- **File Kanonis:** [`src/utils/regex-escape.ts`](../src/utils/regex-escape.ts)
- **Ekspor Kanonis:** `escapeRegex`
- **Simbol Terlarang di Luar Kanonis:** `escapeRegex`, `escapeRegExp`
- **File yang Diizinkan:** `src/utils/regex-escape.ts`
- **File Test:** [`tests/unit/regex-escape.test.ts`](../tests/unit/regex-escape.test.ts)

### `reservation.payment_evaluation` — Evaluasi status pembayaran reservasi

- **Deskripsi:** Menentukan status evaluasi pembayaran dan snapshot ongkir reservasi secara kanonis (murni, tanpa I/O).
- **File Kanonis:** [`src/domain/payment-expected.ts`](../src/domain/payment-expected.ts)
- **Ekspor Kanonis:** `resolveReservationPaymentEvaluation`, `resolveDeliveryFeeSnapshot`
- **Simbol Terlarang di Luar Kanonis:** `resolveReservationPaymentEvaluation`, `resolveDeliveryFeeSnapshot`
- **File yang Diizinkan:** `src/domain/payment-expected.ts`
- **File Test:** *Belum didefinisikan*

### `reservation.payment_response` — Response wrapper evaluasi pembayaran reservasi

- **Deskripsi:** Menyematkan hasil kalkulasi paymentEvaluation ke dalam payload respons reservasi admin.
- **File Kanonis:** [`src/routes/admin/shared/reservation-response.ts`](../src/routes/admin/shared/reservation-response.ts)
- **Ekspor Kanonis:** `withPaymentEvaluation`
- **Simbol Terlarang di Luar Kanonis:** `withPaymentEvaluation`
- **File yang Diizinkan:** `src/routes/admin/shared/reservation-response.ts`
- **File Test:** [`tests/unit/reservation-payment-response.test.ts`](../tests/unit/reservation-payment-response.test.ts)

### `reservation.payment_verification` — Verifikasi bukti pembayaran reservasi

- **Deskripsi:** Seam kanonis verifikasi pembayaran transfer/non-tunai: simpan bukti permanen, hitung tagihan kanonis (GROSS), catat pembayaran tanpa mengubah status kunjungan, audit tenant-aware — tanpa akses Prisma di route.
- **File Kanonis:** [`src/services/reservation-payment-verification.service.ts`](../src/services/reservation-payment-verification.service.ts)
- **Ekspor Kanonis:** `verifyReservationPayment`
- **Simbol Terlarang di Luar Kanonis:** `verifyReservationPayment`
- **File yang Diizinkan:** `src/services/reservation-payment-verification.service.ts`
- **File Test:** [`tests/integration/admin-verify-payment.test.ts`](../tests/integration/admin-verify-payment.test.ts)

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

### `treatment.catalog_value` — Resolusi nilai treatment dari katalog

- **Deskripsi:** Mencari harga treatment (promo/original) dari katalog tenant dengan pencocokan alias, bundle, multi-item, dan fallback kategori — tanpa DB langsung.
- **File Kanonis:** [`src/services/treatment-value.service.ts`](../src/services/treatment-value.service.ts)
- **Ekspor Kanonis:** `resolveTreatmentValue`
- **Simbol Terlarang di Luar Kanonis:** `resolveTreatmentValue`
- **File yang Diizinkan:** `src/services/treatment-value.service.ts`
- **File Test:** [`tests/unit/capi-value-no-hardcode.test.ts`](../tests/unit/capi-value-no-hardcode.test.ts)

---

## 3. Cara Menambah atau Mengubah Modul Kanonis

1. Pastikan kapabilitas baru benar-benar bersifat fondasional dan dipakai lintas modul.
2. Daftarkan entri baru di `scripts/module-registry.json`.
3. Jalankan `npm run docs:modules` untuk memperbarui dokumen ini.
4. Jalankan `npx vitest run tests/unit/module-registry.test.ts` untuk memastikan kepatuhan skema dan fakta disk.
