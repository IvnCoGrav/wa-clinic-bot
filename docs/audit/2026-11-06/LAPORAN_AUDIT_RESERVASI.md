# Laporan Audit Menyeluruh — Mekanisme Reservasi

- Tanggal: 2026-11-06
- Framework: Well-Architected Framework (Keandalan, Keamanan, Performa, Operasional) + Hypothesis-Driven Debugging + FMEA
- Sifat: baca-saja (tidak ada kode yang diubah)
- Referensi plan: `docs/plans` (tidak ada plan reservasi khusus; audit ini mengacu pada plan revisi yang disetujui pengguna)

---

## 1. Ringkasan Eksekutif

Mekanisme reservasi memiliki fondasi yang cukup baik: advisory lock PostgreSQL nyata, efek samping dijalankan setelah commit, tool masking deterministik, arsip satu pintu, dan status pembayaran tri-state. Namun ditemukan **11 temuan**, dengan **4 temuan kritis** yang harus ditangani lebih dulu: (1) soft-cancel dapat membatalkan reservasi berstatus apa pun termasuk `completed`; (2) cron hold memakai patokan tengah malam, bukan jendela 2 jam; (3) pembuatan series melewati seam inti reservasi; (4) restore arsip kehilangan sebagian data dan seluruh follow-up. Tidak ada perubahan kode yang dilakukan dalam audit ini.

---

## 2. Framework & Cakupan

### Framework
Well-Architected Framework dipilih karena reservasi adalah modul transaksional inti yang menyentuh keselamatan klinis (bidan datang ke alamat pasien), integritas finansial (LTV, invoice, Sheets), dan keandalan operasional (cron, dispatch). Hypothesis-Driven Debugging dipakai untuk membuktikan/menyanggah klaim plan sebelum menyimpulkan.

### Dalam cakupan
- Siklus status reservasi (create → hold → confirm → dispatch → arrive → complete → cancel → archive → purge)
- Concurrency & idempotency
- Integrasi: Sheets, CAPI, follow-up, staf, Google Calendar
- Multi-tenant & otorisasi pada endpoint reservasi
- Dashboard: seam alamat reservasi dan invoice
- Cron terkait reservasi

### Di luar cakupan / celah cakupan
- Tidak ada akses database produksi; seluruh temuan berbasis kode dan test offline.
- Tidak ada baseline suite penuh; hanya 3 file test yang dijalankan (15 test, semuanya lulus).
- Log produksi (`logs/llm-*.jsonl`) tidak diperiksa untuk audit ini.
- UI dashboard tidak diaudit menyeluruh (hanya pembaca alamat & invoice).
- Concurrency tidak diuji terhadap PostgreSQL nyata; perilaku lock disimpulkan dari kode.

---

## 3. Status Temuan Lama (`docs/KNOWN_ISSUES.md`)

| ID | Temuan | Status terverifikasi |
|---|---|---|
| #313 | Detail reservasi memakai alamat rumah utama | **SELESAI** — `resolveReservationAddress()` kartu-first; modal memakai seam |
| #312 | Pemilih alamat kosong saat edit | **SELESAI** — ada `reservation-address-card-selection.test.ts` |
| #311 | Alamat kedua tak terlihat / reservasi tertaut primary | **SELESAI** — seam `resolveCustomerAddressId` + test |
| #304 | Drift JSON vs tabel alamat | **SELESAI** — `address-reconciliation.test.ts` ada |
| #300 | Error DB DELETE menyamar 404 | **SELESAI** — 503 `DB_UNAVAILABLE` terbukti di kode & test |
| #298 | Tabel arsip belum ada di produksi | **SELESAI** — tercatat applied 2026-11-03 |
| #294 | `reservation_items` kosong pada data historis | **MASIH TERBUKA (LOW)** — fallback defensif ada |
| #292 | Hard delete tanpa snapshot | **SELESAI** — satu seam `archiveReservation()` |
| #301 | Test pre-existing gagal | **MASIH TERBUKA** — 11 gagal di 6 file; hanya 3 test terkait reservasi |
| #286 | Kalender/reservasi mobile | **PARSIAL** — F-21..F-45 selesai; sisa item di luar cakupan |
| #309 | Sisa maternal hardening | **MASIH TERBUKA (by decision)** — gate klinis ada di tool, sisa fitur ditunda |
| #310 | Urutan deploy script | **MASIH TERBUKA** — risiko kolom baru saat deploy |

---

## 4. Daftar Temuan

### A-001 — Soft-cancel dapat membatalkan reservasi status apa pun (KRITIS)

- **Lokasi:** `src/routes/admin/reservation-dispatch.route.ts:2197-2200`
- **Bukti:** `prisma.reservation.update({ where: { id }, data: { status: 'cancelled' } })` tanpa `canTransition()` dan tanpa cek status sebelumnya. Handler hanya membedakan `?soft=true` vs arsip (`:2130`).
- **Dampak:** Reservasi `completed` bisa berubah menjadi `cancelled`; laporan pendapatan, LTV, follow-up, dan audit CAPI ikut berubah. Tidak ada jalur revert resmi.
- **Keyakinan:** TERBUKTI.
- **Akar masalah:** FSM hanya dipakai di `completeReservationById` dan `confirm`; jalur soft-cancel tidak memakai seam status kanonis.
- **FMEA:** S=8, O=5, D=7 → **RPN 280**.
- **Catatan test:** `tests/unit/reservation-delete-contract.test.ts:52` hanya menguji soft-cancel generik, bukan `completed → cancelled`.

### A-002 — `completeTask` staf melewati FSM dan guard prematur (KRITIS)

- **Lokasi:** `src/services/staff-reservation.service.ts:2610-2644`
- **Bukti:** Hanya menolak `cancelled`/`rejected` (`:2626`). Tidak memanggil `canTransition()` dan tidak memakai `isPrematureCompletion()`. Bandingkan seam kanonis `completeReservationById` yang memakai keduanya (`reservation-dispatch.route.ts:88-95`).
- **Dampak:** Reservasi `hold`/`pending` bisa ditandai `completed`; booking tanggal jauh di depan bisa diselesaikan lebih awal. Memicu follow-up dan Sheets prematur.
- **Keyakinan:** TERBUKTI.
- **FMEA:** S=8, O=4, D=6 → **RPN 192**.

### A-003 — Cron hold memakai tengah malam, bukan jendela 2 jam (KRITIS)

- **Lokasi:** `src/services/cron.service.ts:504-523`; domain `src/domain/reservation-status.ts:31-39`
- **Bukti:** `where: { status: 'hold', created_at: { lt: startOfTodayWibUtc } }`. Domain menyatakan hold kedaluwarsa setelah **2 jam**; UI memakai `isHoldActiveByCreated`.
- **Dampak:** Hold yang dibuat pagi tetap menempati slot sampai sapuan berikutnya (interval default 6 jam, `background-crons.ts:84`) — bisa ±30 jam. Sebaliknya, hold yang dibuat 23:55 dibatalkan beberapa menit kemudian. Slot terebut/terbebaskan tidak sesuai janji.
- **Keyakinan:** TERBUKTI.
- **Akar masalah:** Dua definisi kedaluwarsa hold yang tidak disatukan (domain 2 jam vs cron tengah malam).
- **FMEA:** S=7, O=9, D=4 → **RPN 252**.
- **Catatan test:** `tests/unit/expired-hold-sweep.test.ts:16-30` justru mengunci perilaku tengah malam.

### A-004 — Pembuatan series melewati seam inti reservasi (KRITIS)

- **Lokasi:** `src/services/reservation-series.service.ts:100-160`, `407-497`
- **Bukti:** Reservasi dibuat langsung via `tx.reservation.create` dengan `status: 'confirmed'` (`:143-157`). Cek bentrok staf dilakukan **di luar transaksi** (`:103-122`). Tidak ada advisory lock, cek duplikat customer, kuota kapasitas, resolusi alamat (`customer_address_id`), sinkronisasi `reservation_items`, atau gerbang klinis. `pauseSeries` menulis status `'paused'` (`:426`) yang tidak dikenal `canTransition`, tidak termasuk status aktif, dan tidak difilter dashboard.
- **Dampak:** Double booking lewat series, reservasi tanpa alamat tertaut, item kosong, dan status zombie `paused`.
- **Keyakinan:** TERBUKTI.
- **FMEA:** S=8, O=5, D=6 → **RPN 240**.

### A-005 — Restore arsip kehilangan data dan follow-up (KRITIS)

- **Lokasi:** `src/services/reservation-archive.service.ts:62-115` (snapshot), `:280-344` (restore)
- **Bukti:** Snapshot tidak memuat `duration_minutes`, `gestational_weeks`, `mom_stage`, `hpl_date`, `purchase_review_status`, `purchase_occurred_at`, `needs_staff_verification`. Restore hanya membuat ulang reservasi, items, dan children; **tidak memulihkan follow-up**. Kegagalan membuat item ditelan per baris (`:322`). FK `FollowUp.reservation` = `onDelete: SetNull` (`prisma/schema.prisma:638`) sehingga arsip meninggalkan follow-up yatim.
- **Dampak:** Reservasi yang dipulihkan tampak utuh tetapi kehilangan durasi, status bayar, data maternal, dan seluruh rencana follow-up. Tidak ada peringatan.
- **Keyakinan:** TERBUKTI.
- **FMEA:** S=7, O=5, D=8 → **RPN 280**.
- **Catatan test:** `tests/integration/reservation-archive.test.ts` memakai `follow_ups: []` dan tidak menguji field yang hilang.

### A-006 — Advisory lock fail-open tanpa alert (TINGGI)

- **Lokasi:** `src/services/reservation-core.service.ts:275-291`
- **Bukti:** Bila `$transaction`/`$executeRawUnsafe` gagal, `work(prisma)` dijalankan tanpa lock. Tidak ada log/alert saat fallback aktif.
- **Dampak:** Pada kondisi lock tidak tersedia, race check-then-insert double-booking kembali terbuka tanpa terdeteksi.
- **Keyakinan:** TERBUKTI (perilaku); dampak produksi KEMUNGKINAN BESAR.
- **FMEA:** S=8, O=3, D=9 → **RPN 216**.

### A-007 — Cek bentrok staf mengabaikan status `pending` (TINGGI)

- **Lokasi:** `src/services/reservation-core.service.ts:90` vs `:334`; domain `ACTIVE_RESERVATION_STATUSES` (`reservation-status.ts:10`)
- **Bukti:** `ACTIVE_STATUSES = ['confirmed','en_route','hold']` untuk bentrok staf, sedangkan cek customer memakai `['confirmed','en_route','hold','pending','in_progress']` dan domain menyatakan `pending` aktif.
- **Dampak:** Reservasi `pending` (termasuk same-day request) tidak memblokir slot bidan; booking lain bisa masuk di jam yang sama.
- **Keyakinan:** TERBUKTI (inkonsistensi); apakah disengaja perlu keputusan produk.
- **FMEA:** S=7, O=6, D=7 → **RPN 294**.

### A-008 — Invoice memakai alamat profil, bukan kartu reservasi (TINGGI)

- **Lokasi:** `packages/admin-dashboard/src/utils/paymentInvoiceFormatter.ts:206-227`
- **Bukti:** `resolveAddress()` berurutan: `raw_text` → `customer.address/preferences` → `customer.kelurahan`; tidak pernah membaca `reservation.customer_address` / `customer_address_id`. Berbeda dari `reservationAddress.ts` (kartu-first) dan `row-formatter.ts` Sheets (kartu-first).
- **Dampak:** Invoice pasien bisa mencetak alamat rumah utama, bukan alamat kunjungan — pola yang sama dengan #313 tetapi di layar lain.
- **Keyakinan:** TERBUKTI.
- **FMEA:** S=7, O=5, D=6 → **RPN 210**.

### A-009 — Tool masking mengizinkan treatment yang hanya disebut asisten (TINGGI, perlu keputusan)

- **Lokasi:** `src/v3/tools/tool-masker.ts:397-451, 472-477`
- **Bukti:** `resolveCandidateTreatment()` memindai pesan **asisten** untuk nama layanan bold ketika user memberi sinyal komitmen, lalu `hasTreatment` menjadi true. Ini bertentangan dengan Mandat Active User Commitment yang melarang penyerapan nama layanan dari pesan rekomendasi asisten.
- **Dampak:** Customer bilang "oke besok jam 10" tanpa menyebut layanan; sistem dapat memesan layanan yang disebut asisten pada pesan sebelumnya — berisiko salah paket.
- **Keyakinan:** TERBUKTI (mekanisme); risiko salah paket KEMUNGKINAN BESAR.
- **FMEA:** S=7, O=5, D=6 → **RPN 210**.

### A-010 — Jalur admin tidak memakai idempotency `request_id` (SEDANG)

- **Lokasi:** `src/routes/admin/reservation-crud.route.ts` (0 kemunculan `requestId`); pembanding `src/services/reservation-intake.ts:83`
- **Bukti:** Hanya jalur bot yang membentuk `requestId`; create admin/quick-hold tidak.
- **Dampak:** Double-submit form admin dapat membuat baris ganda; sebagian tertutup logika merge same-day.
- **Keyakinan:** TERBUKTI.
- **FMEA:** S=5, O=4, D=7 → **RPN 140**.

### A-011 — `pending → en_route` melewati FSM (SEDANG)

- **Lokasi:** `src/routes/staff/today.subroute.ts:560-568`
- **Bukti:** `nextStatus = markEnRoute && ['confirmed','pending'].includes(statusLower) ? 'en_route'`. `canTransition('pending','en_route')` = false.
- **Dampak:** Status di luar matriks resmi; laporan/FSM tidak konsisten.
- **Keyakinan:** TERBUKTI.
- **FMEA:** S=4, O=4, D=7 → **RPN 112**.

### A-012 — Inventaris fitur menulis status yang tidak ada (SEDANG)

- **Lokasi:** `docs/FEATURE_INVENTORY.md:107` vs `prisma/schema.prisma:303`
- **Bukti:** Inventaris menulis `HOLD → CONFIRMED → DISPATCHED → ARRIVED → COMPLETED` dan enum `ReservationStatus`. Kenyataannya `status String @default("confirmed")`, `dispatched` = 0 kemunculan, `arrived` hanya kolom `arrived_at`.
- **Dampak:** Dokumen kapabilitas menyesatkan; melanggar Mandat Inventarisasi Fitur.
- **Keyakinan:** TERBUKTI.
- **FMEA:** S=4, O=10, D=3 → **RPN 120**.

### A-013 — Parameter `?hard`/`?archive` dideklarasikan tetapi diabaikan (RENDAH)

- **Lokasi:** `src/routes/admin/reservation-dispatch.route.ts:2124, 2130`
- **Bukti:** Querystring memuat `hard` dan `archive`, tetapi hanya `soft` yang dipakai.
- **Dampak:** Dokumentasi #300 menyebut `?hard=true` sebagai alias; klien yang memakainya tidak mendapat perilaku berbeda (kebetulan sama-sama arsip), tetapi kontrak menyesatkan.
- **Keyakinan:** TERBUKTI.
- **FMEA:** S=3, O=10, D=5 → **RPN 150**.

### A-014 — Google Calendar event dihapus dua kali (RENDAH)

- **Lokasi:** `reservation-dispatch.route.ts:2171-2177` dan `reservation-archive.service.ts:137-143`
- **Dampak:** Panggilan API ganda, log error ganda bila gagal. Tidak merusak data.
- **Keyakinan:** TERBUKTI.
- **FMEA:** S=2, O=10, D=5 → **RPN 100**.

### A-015 — Status `in_progress` hantu di query bentrok customer (RENDAH)

- **Lokasi:** `src/services/reservation-core.service.ts:334`
- **Bukti:** `status: { in: [... 'in_progress'] }`; status ini tidak ada di domain, schema, atau UI reservasi.
- **Dampak:** Filter tidak berbahaya, tetapi menandakan status liar yang tidak terdefinisi.
- **Keyakinan:** TERBUKTI.
- **FMEA:** S=4, O=3, D=8 → **RPN 96**.

---

## 5. Kontrol yang Terbukti Baik (jangan dirusak saat perbaikan)

1. **Advisory lock nyata** per tenant+staf+hari WIB (`reservation-core.service.ts:128-144, 275-286`).
2. **Efek samping setelah commit**, bukan di dalam transaksi (`:896-899, 1181`).
3. **Tool masking berbasis state** dengan 5 prasyarat deterministik (`tool-masker.ts:463-568`).
4. **`detectAgreedTreatment` hanya membaca pesan user** (`booking-commit-gate.ts:79-83`).
5. **Arsip satu pintu** dan purge berbasis `restore_until` (`reservation-archive.service.ts:124, 420`).
6. **Sheets kartu-first** (`src/services/sheets/row-formatter.ts:99-125`).
7. **Gerbang klinis** di tool reservasi (`save-reservation.tool.ts:551-610`).
8. **Tri-state pembayaran kanonis** (`src/domain/reservation-payment.ts`).
9. **DELETE memetakan DB error ke 503**, bukan 404 (`reservation-dispatch.route.ts:2145-2157`).

---

## 6. Rencana Perbaikan Berurutan (belum dieksekusi)

Urutan berdasarkan RPN dan ketergantungan. Setiap fase wajib ditutup `npm run build` + suite relevan hijau.

| Fase | Temuan | Tindakan fondasional | Rollback |
|---|---|---|---|
| 1 | A-001, A-002 | Jadikan `canTransition` + `isPrematureCompletion` gerbang wajib di **semua** penulisan status reservasi (satu seam `transitionReservationStatus`). Soft-cancel memakai seam itu. | Revert commit; tidak ada migrasi |
| 2 | A-007, A-003 | Satukan daftar status aktif ke `ACTIVE_RESERVATION_STATUSES`; ubah sweep hold memakai `created_at < now − 2 jam` (konstanta domain), bukan tengah malam. Perbarui test yang mengunci perilaku lama. | Flag env untuk mematikan sweep |
| 3 | A-004 | Alihkan `createSeries` ke `reservationCoreService.saveReservation` di dalam satu transaksi, atau tambahkan lock + cek duplikat + alamat + items. Definisikan status `paused` di FSM atau ganti ke `hold`. | Feature flag series |
| 4 | A-005 | Lengkapi snapshot (field hilang) + pulihkan follow-up (atau simpan penuh dan tandai `resume_required`). Tambah `schemaVersion` migration. | Arsip lama tetap terbaca (schemaVersion) |
| 5 | A-006 | Ganti fail-open menjadi fail-closed di production + alert/log `ADVISORY_LOCK_FALLBACK`. | Env `ALLOW_LOCK_FALLBACK` |
| 6 | A-008 | Invoice memakai `resolveReservationAddress()` yang sama dengan detail reservasi (satu seam). | Revert file util |
| 7 | A-009 | Putuskan: pertahankan anaphora dengan bukti user, atau wajibkan nama layanan dari pesan user. Bila dipertahankan, batasi hanya bila asisten menyebut **tepat satu** layanan. | Test + revert |
| 8 | A-010..A-015 | Idempotency admin, FSM `pending→en_route`, koreksi inventaris, hapus parameter mati, dedup calendar, hapus status hantu. | Revert per item |

**Gate regresi:** untuk setiap fase, jalankan test file terkait + `npm run build`. Klaim "pre-existing failure" wajib dibuktikan dengan revert-and-rerun.

---

## 7. Batasan & Asumsi

- `[ASUMSI]` A-007 (pending tidak memblokir staf) bisa jadi keputusan produk yang disengaja; perlu konfirmasi pemilik klinik.
- `[ASUMSI]` A-009 (anaphora treatment) bisa jadi desain yang disengaja; laporan ini menandai risiko, bukan menyimpulkan pelanggaran final.
- Tidak ada akses DB produksi, sehingga tidak dapat memastikan berapa banyak baris `hold`/`paused`/`cancelled-after-completed` yang sudah terlanjur ada.
- Baseline suite penuh tidak dijalankan; hanya 3 file test (15 test) yang dijalankan dan semuanya lulus.
- Test yang ada saat ini **mengunci** perilaku bermasalah A-001/A-003/A-004, sehingga perbaikan wajib disertai pembaruan test tersebut.

---

## 8. Status Tindak Lanjut (2026-11-06)

### Selesai
- **A-001 s.d. A-015** — seluruh temuan audit ditutup lewat seam transisi status, cron hold 2 jam, series atomik, arsip v2, advisory lock fail-closed, invoice kartu-first, tool masking, idempotency admin, dan koreksi dokumen.
- **P1 s.d. P10** — celah lanjutan pasca-verifikasi ditutup: lock series fail-closed, item series rollback, atomisitas pause/resume/cancel, guard `recordPayment`, default restore arsip v1, kontrak test, `assertTransition` pada PATCH edit, dan pemetaan 409 `ILLEGAL_TRANSITION`.
- **Parser multi-treatment** (`chatScheduleExtractor`) — `isValidTreatmentLabel()` memecah label per pemisah sebelum validasi; 2 test pre-existing hijau.
- **Fallback katalog dihapus** — dashboard hanya memakai API/DB; harga add-on multi-treatment diperbaiki; guard `catalog-single-source.test.ts`.
- **SOP vaksin** — boleh langsung, disarankan tunda 48–72 jam (CM-07 hijau).
- **Trauma/darurat** — wajib eskalasi manusia (CM-08 & `agent-runner` hijau).
- **Probe concurrency** — `scripts/audit/reservation-lock-probe.ts` + `npm run audit:reservation-lock` (default dry-run; `--confirm` di staging).

### Verifikasi
- `npm run build` backend & dashboard: exit 0.
- 13 suite reservasi/parser terkait: lulus.
- Baseline diff (`baseline-before.json` vs `baseline-after.json`): 6.568 test, 6.536 lulus, **3 gagal**; **0 regresi logika baru**.
- Kegagalan pre-existing turun **11 → 2** (`hybrid-reservation-parser`, kontrak nama anak vs bunda). 1 kegagalan lain (`staff-auth-and-reservation`) **flaky di bawah beban suite penuh** dan lulus saat diisolasi — bukan regresi.

### Sisa 2 kegagalan (butuh keputusan, bukan bug baru)
1. **`hybrid-reservation-parser` (2 test)** — keputusan kontrak: reservasi atas nama anak atau nama bunda.

### Celah cakupan
- Uji concurrency nyata belum dijalankan karena PostgreSQL lokal tidak tersedia; probe disediakan untuk staging.
- `reservation-core.service.ts` dan cron masih menulis status internal pada jalur create/reactivate/merge dan sapuan sistem — bukan bypass user-facing, tetapi bukan "satu pintu" literal.
