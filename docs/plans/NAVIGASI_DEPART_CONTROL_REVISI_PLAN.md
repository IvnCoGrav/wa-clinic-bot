# Implementation Plan — Revisi Fitur Navigasi & OTW: "Depart Control" (Ganti Tracking Kontinu)

> **Status:** ✅ DIEKSEKUSI (2026-09-30) — Fase 0–4 selesai. Lihat §5 Catatan Eksekusi.
> **Tanggal:** 2026-09-30
> **Keputusan pemilik:** tracking GPS kontinu **di-deprecate** (akan layak saat aplikasi native, bukan PWA).
> Pengganti: kontrol keberangkatan — klik Navigasi + jadwal ±1 jam → kirim OTW + status
> **"dalam perjalanan"** + lokasi sekarang + estimasi tiba, terhubung ke flow yang ada.
> **Menggantikan:** `docs/plans/NAVIGASI_AUTO_TELEMETRY_DISPATCH_PLAN.md` (arsipkan setelah plan ini dieksekusi)
> **Terkait:** KNOWN_ISSUES #162 (Dispatch & Tracking), #162d (throttle OS), #174 (KB-2)

---

## §0. Fakta Terverifikasi Kode (`file:line`) & Keputusan Desain

### 0.1. Kenapa tracking kontinu tidak jalan (bukan bug kode, tapi batas platform)

| Fakta | Lokasi | Implikasi Plan |
|---|---|---|
| Tracking = `watchPosition` + kirim tiap 25 dtk di **tab** StaffToday | `useTripTelemetry.ts:139-200` | Mati dibekukan OS saat tab di-background |
| `navigationUrl` = link `https://www.google.com/maps/dir/...` | `staff-reservation.service.ts:164-171` | OS menangkap → buka **aplikasi** Maps → browser dibekukan |
| Wake Lock hanya cegah layar mati, **bukan** cegah freeze background | `useTripTelemetry.ts:53-65` | Bukan solusi; jangan diandalkan |
| PWA sudah ada (`manifest.json`, `sw.js`) tapi SW **tidak bisa** akses `navigator.geolocation` | `packages/admin-dashboard/public/sw.js`, `geoUtils.ts:144-158` | Background-sync GPS via SW tidak memungkinkan di web |
| State trip in-memory TTL 10 mnt, single-instance | `staff-trip-tracking.service.ts:24,393-396` | Tak ada migrasi yang dibutuhkan untuk deprecate |
| `sendAdminReply` hanya teks/gambar; driver WAHA (`waha.driver.ts:22-155`) **tanpa** `sendLocation` | `live-chat.service.ts:359-387` | "Kirim lokasi" = **link Google Maps dalam teks**, bukan pin lokasi WA asli (pin asli butuh ekstensi gateway → di luar scope) |
| Template OTW data-driven (`STAFF_OTW`) hanya kenal `{patientName}`, `{therapistName}`, `{clinicName}` | `staff-reservation.service.ts:1111-1125,1131-1171` | ETA/lokasi butuh placeholder baru yang dirender server |
| `reservation.status` = **kolom String biasa** (tanpa enum/check DB) | `prisma/schema.prisma` (kolom `status`, default `"confirmed"`) | Status baru **tanpa migrasi DB** |
| Otoritas status = `src/domain/reservation-status.ts` (zero-import) | `:10-12` `ACTIVE_RESERVATION_STATUSES`, `:31-39` `isActiveReservation` | Satu-satunya tempat definisi "aktif" — wajib disentuh |
| Guard OTW server: maksimal **2 jam** sebelum booking (non-supervisor), wajib assigned, wajib ada conversation | `today.subroute.ts:383-406` | Tetap dipertahankan (fail-closed); jendela ±1 jam adalah *kontrol klien* di atasnya |
| Util siap pakai (tanpa dep baru): GPS sekali-tembak + Haversine + kalibrasi ETA | `geoUtils.ts:75-96,144-158` (`getCurrentDeviceLocation`, `calculateHaversineKm`, `estimateTravelMinutesKm` = maks(5, 2.05·km+3)) | Dipakai ulang persis (reuse-first) |

### 0.2. Keputusan desain (Confirmation Gate — perlu tanda tangan pemilik sebelum eksekusi)

| # | Keputusan | Rekomendasi | Alternatif (ditolak bila tak dipilih) |
|---|---|---|---|
| D1 | **Nilai status baru**: `en_route` | ✅ `en_route` (snake_case, konsisten gaya `otw_sent_at`) | Label Indonesia di status DB → merusak konsistensi + query case-sensitive |
| D2 | **Jendela keberangkatan**: booking dalam **≤ 60 menit** ke depan → tawarkan OTW + `en_route`; di luar itu → buka peta diam-diam (mode intip) | ✅ 60 mnt (sesuai "sekitar 1 jam" + menutup celah kirim OTW kepagian) | Ikuti guard server 2 jam → OTW bisa terkirim 2 jam sebelum berangkat (menyesatkan customer) |
| D3 | **Isi pesan OTW**: template DB + blok ETA/lokasi yang dirender **server** (placeholder baru `{etaMinutes}`, `{arrivalWib}`, `{departMapsUrl}`) | ✅ Server-render (template tetap milik admin, konsisten preview `/otw-template`) | Rakit teks di TSX (`customText`) → template admin di-bypass, duplikasi format |
| D4 | **"Kirim lokasi"** = link Google Maps posisi Bidan saat berangkat + ETA dalam teks | ✅ Link teks (tanpa sentuh WAHA/gateway) | Pin lokasi WA asli → butuh `sendLocation` di gateway + driver WAHA/WABA (fase terpisah) |
| D5 | **Scope deprecate tracking**: hentikan *semua* auto-start pemancar (klik Navigasi + tombol OTW + auto-start H-30), biarkan hook + endpoint backend utuh untuk aplikasi native kelak | ✅ Hapus pemicu, simpan mesin | Hapus total hook/service → kerja ulang saat native; atau biarkan auto-start → tracking setengah-mati menyesatkan |
| D6 | **Transisi status**: hanya `confirmed`/`pending` → `en_route` (ditolak bila `completed`/`cancelled`/`rejected`/lampau); `arrive`/`complete` tak berubah | ✅ Fail-closed di server, mirror guard `/arrive` | Bebas transisi → data anomali |

---

## §1. Arsitektur Target (ringkas, deterministik)

```
Klik "Navigasi" (StaffToday)
  │  1. window.open(navUrl) SINKRON (anti popup-blocker) — peta selalu terbuka
  │  2. Hitung menit-menuju-booking dari task.bookingDate (WIB)
  ├─ DI LUAR jendela ±60 mnt ──► selesai (mode intip, tanpa modal, tanpa pesan)
  └─ DALAM jendela ──► getCurrentDeviceLocation() sekali-tembak (timeout 10 dtk)
       ├─ GPS gagal → modal OTW standar (tanpa blok ETA; JANGAN blokir/ulang)
       └─ GPS ok → Haversine(Staff→Pasien) → estimateTravelMinutesKm → tiba ±HH:MM WIB
            → modal "Kirim OTW?" menampilkan ETA preview
            ├─ "Hanya Lihat Peta" → selesai
            └─ "Kirim OTW" → POST /otw + { lat,lng,accuracy,etaMinutes,arrivalWib,markEnRoute:true }
                 ──► server: guard assigned + ≤2 jam + conversation (TETAP)
                 ──► server: set otw_sent_at + status='en_route' + kirim template+blok ETA
                 ──► server: audit STAFF_SEND_OTW (+ field en_route) + SSE update
CS LiveChat: sidebar standby → kartu "🛵 Dalam Perjalanan" (otwSentAt + en_route, tanpa trip)
             + badge "📅 Terjadwal" tetap; Reservations badge baru 🛵.
```

**Yang TIDAK berubah:** guard 2 jam server, template `STAFF_OTW` eksisting (kompatibel mundur bila
placeholder tak dipakai), flow `/arrive` & `/complete`, KB-2 same-day, watchdog/Fase E, label WAHA
(tidak disentuh sama sekali).

---

## §2. Staged Phases & Micro-Tasks

### 🔹 Fase 0 — Deprecate Tracking Kontinu (tanpa hapus mesin)

| # | File & baris | Aksi | Verifikasi |
|---|---|---|---|
| 0.1 | `StaffToday.tsx:1552-1590` (`handleStartNavigation`) | Hapus blok `startTelemetry` auto-start dari handler Navigasi (modal OTW dipertahankan; telemetry hanya dipicu langkah Fase 2 bila dipilih — lihat catatan Fase 2) | `grep startTelemetry StaffToday.tsx` hanya di import/destructure |
| 0.2 | `StaffToday.tsx:1534` (dalam `handleSendOtw`) | Hapus `startTelemetry(task.reservationId)` pasca-OTW sukses | OTW manual tetap kirim pesan + `otw_sent_at`, tanpa pemancar |
| 0.3 | `StaffToday.tsx:793-837` (efek auto-start H-30) | Hapus seluruh efek auto-start (termasuk `autoStartInFlightRef`, permission query) | Tidak ada `watchPosition` tanpa aksi Bidan |
| 0.4 | — | `useTripTelemetry.ts`, `staff-trip-tracking.service.ts`, `POST /telemetry`, `POST /trip/stop`, sweep auto-close **DIBIARKAN** (mesin untuk aplikasi native; tanpa produsen = idle, tanpa biaya) | Build hijau; test dispatch tetap hijau (backend tak tersentuh) |

**Regression gate Fase 0:** `npm run build` (dashboard) + `npx vitest run tests/unit/dispatch-map-projection.test.ts tests/integration/staff-trip-dispatch.test.ts` hijau.
**Catatan jujur:** CS widget tetap menampilkan kartu standby/OTW dari `otw_sent_at` (jalur non-GPS, tak terpengaruh).

### 🔹 Fase 1 — Status `en_route` di Lapisan Domain & Inti (⚠️ Confirmation Gate D6)

> Blast radius: ±12 file. DILARANG mulai tanpa persetujuan D1–D6. Semua perubahan = penambahan
> `en_route` ke daftar yang sudah ada (tanpa mengubah makna nilai lama).

| # | File & baris | Aksi | Verifikasi |
|---|---|---|---|
| 1.1 | `src/domain/reservation-status.ts:10-12,31-39` | `ACTIVE_RESERVATION_STATUSES += 'en_route'`; `isActiveReservation` true untuknya; tambah tipe union | Test unit domain (baru): confirmed/pending/hold/en_route aktif; lainnya tidak |
| 1.2 | `src/services/reservation-core.service.ts:69` (+ query `:209,313,393`) | `ACTIVE_STATUSES += 'en_route'`; pastikan query bentrok pelanggan + cek bentrok staf + kuota KB-3 (`:553-559`, hitung `assigned_staff_id null` × status) mencakupnya sebagai slot-terisi | `reservation-core.test.ts` + `reservation-idempotency-request-id.test.ts` hijau |
| 1.3 | `src/services/slot-overlap.service.ts` | Sertakan `en_route` sebagai status overlap (peringatan dini tetap jalan) | `slot-overlap-sweep.test.ts` hijau |
| 1.4 | `src/services/follow-up.service.ts` | **Tidak ada perubahan perilaku**: follow-up dibuat saat `confirmed` (`reservation-core.service.ts:759`); transisi→`en_route` DILARANG memicu ulang | Suite follow-up hijau |
| 1.5 | `packages/admin-dashboard/src/pages/tenant/Reservations.tsx:602-621,1136-1137` | `getStatusBadge` case `en_route` → `🛵 Dalam Perjalanan`; stats/filter sertakan `en_route` (jangan jatuh ke `default`→Hold!) | `vite build` hijau |
| 1.6 | `packages/admin-dashboard/src/pages/staff/StaffToday.tsx` (tab grouping + badge kartu) | `en_route` tampil di tab Hari Ini + badge "🛵 Dalam Perjalanan" di kartu | Build hijau |
| 1.7 | `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx` (selector reservasi aktif + kartu CS) | `en_route` diperlakukan aktif; kartu dispatch: `otwSentAt && !trip && status==='en_route'` → teks "Dalam Perjalanan — estimasi tiba ±HH:MM" (ETA dari pesan/DB, bukan live) | Build hijau |
| 1.8 | Laporan/invarian (`daily-report`, `financial-analytics`, `daily-invariant-monitor`, `reservation-series`) | Sertakan `en_route` di himpunan "aktif/terjadwal" di mana `confirmed` dihitung (daftar per-file di review) | Suite terkait hijau |

**Regression gate Fase 1:** root `tsc` + full `npm test` hijau. **Tanpa migrasi DB.**

### 🔹 Fase 2 — Endpoint Depart: GPS Sekali-Tembak + ETA + Pesan OTW (Backend)

| # | File & baris | Aksi | Verifikasi |
|---|---|---|---|
| 2.1 | `staff-reservation.service.ts:1111-1125` (`renderStaffTripMessage`) | Tambah param opsional `{ etaMinutes?, arrivalWib?, departMapsUrl? }` + substitusi placeholder `{etaMinutes}`, `{arrivalWib}`, `{departMapsUrl}` (absen = string kosong, template lama tetap valid) | Test unit renderer (baru): template lama tak berubah; template + placeholder ter-render |
| 2.2 | `today.subroute.ts:320-457` (`POST /:id/otw`) | Terima body opsional `{ lat, lng, accuracy, etaMinutes, arrivalWib, markEnRoute }`. Validasi: lat/lng finite + dalam bbox Indonesia kasar, accuracy ≤ 100 m (selaras `MIN_ACCURACY_M`); ETA 5–180 mnt. Bila `markEnRoute` dan status ∈ {confirmed, pending} → `status='en_route'` **dalam transaksi yang sama** dengan `otw_sent_at`. Tolak (`400`) bila status terminal/lampau. Audit `STAFF_SEND_OTW` + field `enRoute`, `etaMinutes` | Test route (baru, mock prisma): confirmed→en_route + pesan terkirim; completed→400; tanpa markEnRoute → perilaku lama persis |
| 2.3 | `today.subroute.ts:264-287` (`GET /otw-template`) | Opsional (bila waktu): teruskan query `etaMinutes/arrivalWib` agar preview modal identik pesan akhir | Preview = pesan akhir |
| 2.4 | Pesan akhir | `getOtwMessageText` + blok ETA/lokasi: `📍 Titik berangkat Bidan: <mapsUrl>\n⏱️ Estimasi tiba ±HH:MM WIB (~X mnt)` — dirender server dari template, **bukan** dirakit di TSX | Snapshot test teks (tanpa PII nyata) |

**Keputusan sadar:** TIDAK ada pesan pin-lokasi WA asli (butuh `sendLocation` gateway — fase terpisah). Link teks cukup & tanpa risiko WAHA.

### 🔹 Fase 3 — Dashboard: Jendela ±60 Menit + GPS Sekali-Tembak + Modal (Frontend)

| # | File & baris | Aksi | Verifikasi |
|---|---|---|---|
| 3.1 | `geoUtils.ts:144-158` | Reuse `getCurrentDeviceLocation` (sudah ada). Tambah helper murni `minutesUntilBooking(bookingDateIso, nowMs)` + konstanta `DEPART_WINDOW_MINUTES = 60` di satu modul (bukan angka tersebar) | Test util (baru): batas 60/61 mnt, tanggal lampau, invalid |
| 3.2 | `StaffToday.tsx:1552` (`handleStartNavigation`) | Urutan baru: (1) `window.open` SINKRON; (2) hitung menit-menuju-booking — **di luar jendela → selesai diam-diam** (mode intip); (3) `getCurrentDeviceLocation` sekali-tembak (gagal → lanjut tanpa ETA, JANGAN toast error keras); (4) Haversine→`estimateTravelMinutesKm`→tiba ±HH:MM WIB; (5) modal `confirm` ("Kirim OTW?" + preview ETA); (6) bila ya → `POST /otw` + payload depart + update state `otwSentAt`/`status` lokal | Manual di emulator: >60 mnt = tanpa modal; ≤60 mnt = modal + ETA |
| 3.3 | State lokal | Setelah sukses: `otwSentAt=nowIso` + `status='en_route'` di `tasks`/`upcomingTasks`/`selectedTask` (cermin server, tanpa refetch berat) | Badge kartu berubah 🛵 |
| 3.4 | `useUiFeedback` | Reuse `confirm` (tanpa `window.confirm` baru) | — |

**Regression gate Fase 3:** `vite build` hijau + review manual 3 skenario (dalam jendela, luar jendela, GPS mati).

### 🔹 Fase 4 — Visibilitas CS & Dokumentasi

| # | File | Aksi |
|---|---|---|
| 4.1 | `LiveChatDispatchWidget.tsx` | Standby → bila `otwSentAt && !trip && status==='en_route'`: kartu "🛵 Dalam Perjalanan (tanpa live tracking)" + ETA bila ada di pesan |
| 4.2 | `CHANGELOG.md`, `NAVIGASI_AUTO_TELEMETRY_DISPATCH_PLAN.md` (§4 Deprecate), `KNOWN_ISSUES.md` #162 | Catat: tracking kontinu deprecated; alasan; sisa (aplikasi native kelak) |
| 4.3 | Full gate | root `tsc` + `vite build` + `npm test` penuh hijau |

---

## §3. Acceptance Criteria

1. Klik "Navigasi" SELALU membuka Google Maps (sinkron, anti popup-blocker).
2. Di luar jendela ±60 mnt: TIDAK ada modal, TIDAK ada pesan, TIDAK ada telemetry.
3. Dalam jendela: modal ETA muncul; "Kirim OTW" → 1 pesan WA berisi template resmi + titik berangkat + ETA; `otw_sent_at` terisi; `status='en_route'`.
4. GPS mati / akurasi buruk: OTW tetap terkirim TANPA blok ETA (degradasi jujur di pesan).
5. CS melihat badge/kartu "Dalam Perjalanan"; Reservations tidak lagi menampilkan `en_route` sebagai "Hold".
6. Tidak ada `watchPosition`/ping telemetry yang berjalan tanpa aksi Bidan; tidak ada pesan duplikat (idempotency `sendAdminReply` 2 dtk tetap).
7. Nol perubahan perilaku jalur lain (arrive/complete, KB-2, follow-up, kuota KB-3).

---

## §4. Risiko & Batasan Jujur

- **GPS sekali-tembak bisa gagal** (izin ditolak/indoor) → desain di atas TIDAK memblokir OTW; ETA absen.
- **ETA Haversine ≠ ETA jalan raya** (kalibrasi `2.05·km+3` frontend; backend punya `calculateDelayStatus` untuk trip live). Pesan memakai kata "estimasi".
- **`en_route` tanpa migrasi** aman di DB, TAPI semua daftar status harus disinkronkan manual (risiko utama Fase 1 — itulah kenapa butuh gate).
- **Uji perangkat nyata** (HP Bidan) & deploy tetap OPEN seperti biasa.

---

## §5. Catatan Eksekusi (2026-09-30)

- **Fase 0 — SELESAI.** Tiga pemicu pemancar telemetry dihapus dari `StaffToday.tsx`
  (auto-start H-30, pasca-OTW manual, pemicu di handler Navigasi). Mesin telemetry
  (hook + endpoint + service + sweep) DIBIARKAN utuh untuk aplikasi native kelak.
- **Fase 1 — SELESAI.** Status `en_route` ditambahkan ke seam domain
  (`src/domain/reservation-status.ts`: `ACTIVE_RESERVATION_STATUSES`,
  `CONFIRMED_FAMILY_STATUSES`, `EN_ROUTE_STATUS`, `isActiveReservationStatus`) dan
  disinkronkan ke seluruh daftar status: `reservation-core.service.ts`,
  `slot-overlap.service.ts`, `patient-lifecycle.service.ts`, `follow-up.service.ts`,
  `capi.service.ts`, `cron.service.ts`, `staff-notification.service.ts`,
  `reservation-lifecycle.service.ts`, `daily-report.service.ts`, `machine.ts`,
  `customers.subroute.ts`. Dashboard: badge `🛵 Dalam Perjalanan` (Reservations),
  kartu staf, selector LiveChatMonitor. **Tanpa migrasi DB.** Test baru:
  `tests/unit/reservation-status-en-route.test.ts` (6).
- **Fase 2 — SELESAI.** `POST /:id/otw` menerima body depart opsional
  (`lat/lng/accuracy/etaMinutes/arrivalWib/markEnRoute`): pesan diperkaya blok
  estimasi/lokasi (placeholder baru `{etaMinutes}`/`{arrivalWib}`/`{departMapsUrl}`),
  status → `en_route` dalam 1 update. `GET /otw-template` meneruskan ETA agar preview
  = pesan akhir. Test: `tests/integration/otw-depart-endpoint.test.ts` (8).
- **Fase 3 — SELESAI.** `StaffToday.tsx` `handleStartNavigation`: buka Maps sinkron →
  `isWithinDepartWindow` (±60 mnt; luar jendela = mode intip) → `getCurrentDeviceLocation`
  sekali-tembak → Haversine + `estimateTravelMinutesKm` → modal ETA → kirim OTW +
  `markEnRoute`. Helper murni baru di `geoUtils.ts` (`DEPART_WINDOW_MINUTES`,
  `minutesUntilBooking`, `isWithinDepartWindow`, `formatWibClock`). Test:
  `tests/unit/depart-window.test.ts` (10).
- **Fase 4 — SELESAI.** Teks kartu CS disesuaikan (tracking kontinu dinonaktifkan).
- **Gate:** root `tsc` exit 0; dashboard `vite build` hijau; full suite hijau (lihat CHANGELOG).
- **Sisa (deploy, bukan kode):** rebuild dist dashboard + restart bot di server.
  Uji perangkat nyata (HP Bidan) tetap OPEN. `sendLocation` pin WA asli TIDAK dibuat
  (di luar scope; link teks cukup).
