# Laporan Audit Modul 5 (Web App Staf/Bidan) & Modul 7 (Marketing, CTWA & Meta Ads)

> **Tanggal audit:** 2026-11-07  
> **Commit yang dibaca:** `8c6ee2ea`  
> **Mode:** AUDIT BACA-SAJA. Tidak ada kode, test, config, `.env`, database, WAHA, Meta, atau server yang diubah/dijalankan.  
> **Metode:** `audit-sistem-berlapis` Tahap 0–6 (framework → temuan lama → scoping → horizontal → vertikal + 5 Whys → FMEA/collateral → verifikasi), dengan verifikasi bukti `file:line` dan pemeriksaan silang dokumen vs kode.  
> **Laporan lama yang dibaca:** `docs/audit/2026-11-02/fase-05/LAPORAN_FASE_05.md`, `docs/audit/2026-11-02/fase-07/LAPORAN_FASE_07.md`, `docs/plans/EVIDENCE_AD_FUNNEL_2026-11-06.md`, `docs/KNOWN_ISSUES.md`, `docs/META_CAPI_SETUP.md`, `docs/INTEGRASI_LANDING_EXTERNAL.md`.

---

## 1. Ringkasan Eksekutif

Modul 5 dan 7 secara fungsional berjalan, tetapi audit menemukan **20 temuan**: **5 KRITIS, 8 TINGGI, 6 SEDANG, 1 RENDAH**. Tiga pola sistemik mendominasi: (a) kontrak sesi/PII staf yang saling bertentangan (token di JSON + `localStorage`, sesi 30 hari, outbox PII tidak dibersihkan saat logout); (b) state perjalanan staf hanya di memori proses `app` sehingga sweep auto-close di container `worker` tidak pernah melihatnya; (c) jalur marketing masih mengandung tenant hardcode dan fallback yang bisa mengarahkan trafik/PII ke tenant default. Prioritas pertama adalah menutup kebocoran sesi/PII staf dan memperbaiki integritas atribusi iklan sebelum menyentuh optimasi UX. Sebagai catatan proses, klaim **PASS** Fase 5 (2026-11-02) tidak sah: `fase-05.json` hanya berisi 1 file test (`staff-colors.test.ts`, 16 test), bukan 7 file seperti yang ditulis laporan — pola yang sama dengan #299/#302.

---

## 2. Framework & Cakupan

### 2.1 Framework dan alasan

| Framework | Alasan pemakaian | Bagian yang dipakai |
|---|---|---|
| **AWS Well-Architected** | Modul 5/7 menyangkut keandalan lapangan (offline, worker terpisah), keamanan sesi/PII, biaya iklan, dan operational excellence | Security, Reliability, Performance Efficiency, Cost Optimization, Operational Excellence |
| **OWASP ASVS v4 + Top 10 2021** | Login staf, cookie sesi, otorisasi per objek, PII, logging | V2 (auth), V3 (session), V4 (access control), V7 (logging), V8 (data protection); A01, A02, A07, A09 |
| **Heuristik UX mobile** | Target bidan memakai HP di lapangan, sinyal 1-bar, keyboard, notch | target sentuh ≥44px, kontras, zoom iOS (input ≥16px), safe-area, umpan balik status, offline |
| **Hypothesis-driven / 5 Whys** | Memisahkan gejala permukaan dari akar arsitektural | setiap temuan diberi akar masalah dan uji yang membantah/menguatkan |

### 2.2 Ruang lingkup

**Modul 5 — dibaca:**
- `src/routes/staff.route.ts`, `src/routes/staff/auth.subroute.ts`, `src/routes/staff/today.subroute.ts`, `src/routes/staff/quick-replies.subroute.ts`
- `src/services/staff-auth.service.ts`, `staff-reservation.service.ts`, `staff-trip-tracking.service.ts`, `staff-ownership.service.ts`, `staff-notification.service.ts`, `telemetry.service.ts`
- `src/routes/admin/auth.subroute.ts`, `src/routes/admin/staff-management.subroute.ts`, `src/routes/admin/route.ts` (hanya bagian yang menyentuh sesi/RBAC staf)
- `packages/admin-dashboard/src/pages/staff/StaffLogin.tsx`, `StaffToday.tsx`, `StaffSchedule.tsx`; `contexts/StaffAuthContext.tsx`, `contexts/AuthContext.tsx`; `components/staff/StaffProtectedRoute.tsx`; `utils/geoUtils.ts`; `hooks/useTripTelemetry.ts`; `public/sw.js`
- `docker-compose.yml`, `src/app.ts`, `src/worker.ts`, `src/lifecycle/background-crons.ts`, `src/services/cron.service.ts` (hanya alur trip)

**Modul 7 — dibaca:**
- `src/routes/landing.route.ts`, `src/routes/tracking.route.ts`, `src/routes/admin/ctwa-catchers.subroute.ts`, `src/routes/admin/landings.subroute.ts`, `src/routes/admin/meta-attribution.subroute.ts`
- `src/services/capi.service.ts`, `ad-attribution.service.ts`, `ad-funnel-metrics.service.ts`, `ad-watchdog.service.ts`, `ctwa-text-catcher.service.ts`, `landing-content.service.ts`, `meta-ads-insights.service.ts`, `meta-performance-analytics.service.ts`
- `src/landing/public/external-tracker.js`, `go.html`, `pricelist.html`
- `packages/admin-dashboard/src/pages/tenant/LandingPage.tsx`, `MetaClickCatcher.tsx`, `MetaCapiQueue.tsx`; `components/meta-performance/*`
- `docs/META_CAPI_SETUP.md`, `docs/INTEGRASI_LANDING_EXTERNAL.md`, `docs/plans/EVIDENCE_AD_FUNNEL_2026-11-06.md`

**Di luar cakupan (tidak diaudit ulang):** Modul 4 (Reservasi) dan Modul 6 (Live Chat), kecuali titik sambung yang wajib diperiksa untuk membuktikan klaim modul 5/7 (mis. `recordPayment`, `sendAdminReply`, SSE staf). Meta Ads live, WAHA live, server produksi, database live, dan perangkat fisik tidak diakses.

### 2.3 Prioritas awal area (Tahap 2)

| Area | Prioritas | Alasan |
|---|---|---|
| Login/sesi staf + PII lokal | KRITIS | A02/A07, token 30 hari, localStorage, dipakai di HP pribadi |
| Trip/GPS/auto-close | TINGGI | privasi lokasi + lintas proses `app`/`worker` |
| Pembayaran lapangan | TINGGI | nilai uang dipercaya dari klien |
| Landing/tenant isolation | KRITIS | konten publik & pixel/WhatsApp bisa lintas tenant |
| Tracking/CAPI/attribution | KRITIS | salah atribusi = salah biaya iklan |
| UX mobile/offline | SEDANG | non-kritis tetapi memengaruhi operasi lapangan |

---

## 3. Status Temuan Lama (Tahap 1)

| ID | Temuan lama | Status verifikasi 2026-11-07 |
|---|---|---|
| **#315** | Shareloc badge + draf staf dari DB | **PARTIAL.** `src/domain/location-adequacy.ts`, endpoint `PATCH .../shareloc-requested`, dan `GET /api/staff/quick-replies` ada. Namun chip "Sedang OTW"/"Sudah Sampai" di `StaffToday.tsx:4081-4082` masih teks hardcode, dan quick reply DB hanya dipakai untuk `shareloc` (`StaffToday.tsx:1947-1948`). Klaim "draf staf mengambil template DB" belum menyeluruh. |
| **#316** | Live Chat 5 dimensi | **SELESAI (kode), di luar cakupan.** Tidak diaudit ulang. Yang tersentuh modul 5: daftar event SSE staf sudah memuat `staff.trip_delay_warning`, `staff.trip_arrived`, `staff.trip_closed` (`today.subroute.ts:1237-1248`). |
| **#317** | Watchdog LPWA/native CTWA | **MITIGATED.** Filter `paidMediums` masih ada (`ad-watchdog.service.ts:19,36`; `ad-funnel-metrics.service.ts:44`). |
| **#318** | Klik nol tetapi chat normal diberi label `LOW_CTR` | **OPEN.** `listSignals()` tidak berubah: tidak ada `CLICK_TRACKING_SUSPECT` (`ad-watchdog.service.ts:113-156`). Tidak diduplikasi; temuan M-07 di laporan ini berbeda (status `SENT` sebelum kirim). |
| **#278** | CAPI Tahap B hardening | **PARTIAL (multi-tenant).** Isolasi kredensial CAPI di service benar (`capi.service.ts:392-413`), tetapi isolasi belum diperluas ke `external-tracker.js` (pixel hardcode) dan endpoint debug/manual CAPI masih `DEFAULT_TENANT_ID` — lihat M-02/M-03. |
| **#270** | Atribusi Purchase repeat order | **IMPLEMENTED + tech debt.** Tidak diaudit ulang. Catatan: `AdClick.customerId @unique` (`schema.prisma:707`) membuat satu pelanggan hanya punya satu baris klik; histori multi-touch hilang saat campaign berganti. |
| **#288** | God object frontend | **OPEN.** `StaffToday.tsx` 6.098 baris (dihitung ulang); tidak dipecah dalam audit ini. |
| **#299 / #302** | Integritas audit & path test | **RESOLVED untuk laporan lama, tetapi berulang.** Laporan Fase 5 2026-11-02 mengklaim 7 path test; `fase-05.json` hanya berisi 1 file (16 test `staff-colors`). Lihat S-10. |
| **#308** | Pricelist flash/path | **FIXED.** Tidak diaudit ulang; route `/pricelist` masih menyuntik payload (`landing.route.ts:59-102`). |
| **#314** | FSM reservasi | **RESOLVED.** Tidak diaudit ulang. Titik sambung staf memakai seam `reservationStatusService.applyTransition` (`staff-reservation.service.ts:2681-2688`). |
| **#319** | Polish dashboard & peta | **SELESAI.** Tidak diaudit ulang. |

---

## 4. Daftar Temuan

> Konvensi: **Keyakinan** = TERBUKTI (kode/berkas langsung), KEMUNGKINAN BESAR (bukti kuat, perlu konfirmasi lingkungan), DUGAAN (perlu uji).  
> **Severity** mengikuti S: 9–10 KRITIS, 7–8 TINGGI, 5–6 SEDANG, 1–4 RENDAH. RPN tetap dilaporkan terpisah.

### S-01 — Kontrak sesi staf saling bertentangan: token di JSON + localStorage, sesi 30 hari, restore PWA tidak pernah menerima token

- **Tipe:** Horizontal (auth/session) + Vertikal (login UI → API → DB → cookie)
- **Lokasi:** `src/routes/staff/auth.subroute.ts:85-107`, `src/services/staff-auth.service.ts:6,50-58`, `packages/admin-dashboard/src/contexts/StaffAuthContext.tsx:24,34-38,183`, `packages/admin-dashboard/src/contexts/AuthContext.tsx:220,225`, `src/routes/admin/auth.subroute.ts:143,188`
- **Bukti:**
  - `auth.subroute.ts:95-107` mengembalikan token di body: `return reply.status(200).send({ success: true, ..., token: result.token })`.
  - Cookie yang sama `HttpOnly` tetapi `Max-Age=2592000` (30 hari) — `auth.subroute.ts:85`.
  - `staff-auth.service.ts:6`: `const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 hari`; tidak ada idle timeout/rotasi.
  - `StaffAuthContext.tsx:24,183`: `const TOKEN_STORAGE_KEY = 'staff_session_token';` lalu `localStorage.setItem(TOKEN_STORAGE_KEY, data.token)`.
  - Login yang benar-benar dipakai UI adalah `/api/admin/auth/login` (`AuthContext.tsx:220`), yang menyimpan token staf ke `admin_session_token` (`AuthContext.tsx:225`), bukan ke `staff_session_token`. Akibatnya `StaffAuthContext.restoreSession()` (`StaffAuthContext.tsx:37`) tidak punya token saat cookie PWA hilang — fallback restore staf praktis mati pada jalur login aktual.
  - `admin/auth.subroute.ts:143` memanggil `StaffAuthService.login(staff.phone, inputKey, DEFAULT_TENANT_ID)`; tenant staf tidak dibaca dari akun.
- **Keyakinan:** TERBUKTI (kode); dampak eksternal (pencurian token) memerlukan XSS/akses perangkat, tetapi desainnya sendiri sudah membatalkan proteksi `HttpOnly`.
- **Framework:** OWASP A02/A07, ASVS V2/V3/V7; Well-Architected Security.
- **Akar masalah (5 Whys):** (1) Kenapa token bisa dieksfiltrasi? Karena disimpan di `localStorage`. (2) Kenapa disimpan? Karena PWA butuh fallback saat cookie hilang. (3) Kenapa fallback dipakai? Karena cookie dianggap tidak stabil di PWA Android. (4) Kenapa tidak memakai refresh cookie/rotasi? Belum ada desain sesi dua-lapis; `HttpOnly` dianggap cukup sambil tetap mengembalikan token. (5) Kenapa dua jalur login? Login admin dan login staf berevolusi terpisah; tidak ada kontrak sesi kanonis.
- **Risiko:** Pencurian sesi 30 hari; satu token berlaku untuk seluruh perangkat (tidak ada device binding); logout tidak mencabut token yang sudah dieksfiltrasi jika server tidak dihubungi; PWA restore pecah.
- **FMEA:** S=9 × O=5 × D=6 = **270**.
- **Collateral damage:** Menghapus token dari JSON dapat memutus fallback PWA lama; perlu migrasi UX (cookie persisten + refresh cookie) dan uji perangkat. Menurunkan TTL dapat memaksa login ulang di lapangan.
- **Rekomendasi:**
  1. Jadikan cookie `HttpOnly` satu-satunya autentikator; **hapus `token` dari respons login**.
  2. Bila fallback PWA tetap diperlukan, buat **refresh token terpisah** (acak 32 byte, hash di DB, TTL pendek 7–14 hari, rotasi setiap restore, terikat `staff_id` + user-agent hash), bukan memakai token sesi utama.
  3. TTL: idle 12–24 jam, absolute 7 hari; rotasi token pada aktivitas; revoke semua saat password/role berubah (sudah ada `revokeAllSessions`).
  4. Satukan login staf ke satu seam (`StaffAuthService.login`) dan baca tenant dari akun staf, bukan `DEFAULT_TENANT_ID`.
- **Verifikasi:** Test baru: login response tidak mengandung `token`; cookie `HttpOnly; SameSite=Lax; Secure` (di HTTPS); restore hanya bekerja dengan refresh token yang belum dipakai; setelah logout token lama 401; sesi 30 hari tidak lagi dibuat. Uji manual PWA Android (tutup paksa → buka) sebelum deploy.

---

### S-02 — Outbox pesan gagal menyimpan teks/gambar PII di `localStorage` dan tidak dibersihkan saat logout

- **Tipe:** Vertikal (UI → localStorage) + Horizontal (semua staf di perangkat yang sama)
- **Lokasi:** `packages/admin-dashboard/src/pages/staff/StaffToday.tsx:406-417,1653-1668,1729-1748`; `packages/admin-dashboard/src/contexts/StaffAuthContext.tsx:208-226`
- **Bukti:**
  - Tipe outbox menyimpan `text` dan `image.dataUrl` (base64) — `StaffToday.tsx:409-416`.
  - Disimpan ke `localStorage` tanpa enkripsi/kedaluwarsa: `StaffToday.tsx:1733` `localStorage.setItem(FAILED_OUTBOX_KEY, JSON.stringify(list.slice(-20)))`.
  - Dipulihkan saat mount tanpa filter pemilik: `StaffToday.tsx:1738-1748`.
  - Logout hanya menghapus `TOKEN_STORAGE_KEY` (`StaffAuthContext.tsx:210`); tidak ada `localStorage.removeItem('staff_failed_outbox_v1')`.
  - Kunci outbox tidak mengandung `staffId`; grep seluruh dashboard hanya menemukan satu definisi kunci (`StaffToday.tsx:1730`).
- **Keyakinan:** TERBUKTI.
- **Framework:** OWASP A02/A09, ASVS V8; UU PDP (data pribadi tetap tersimpan setelah关系的 kerja berakhir); Well-Architected Security/Privacy.
- **Akar masalah (5 Whys):** (1) Kenapa PII tersisa? Karena outbox sengaja persisten agar tidak mengetik ulang. (2) Kenapa tidak dibersihkan? Karena lifecycle logout tidak memiliki hook pembersihan data lokal. (3) Kenapa tidak dienkripsi? Karena dianggap "hanya cache sementara". (4) Kenapa tidak di-scope per staf? Karena kunci global dibuat saat satu pengguna diasumsikan per perangkat. (5) Kenapa asumsi itu salah? Bidan sering bergantian memakai HP klinik.
- **Risiko:** Pesan pasien, foto rumah, dan nomor telepon dapat dibaca staf berikutnya atau siapa pun yang membuka DevTools; data bertahan tanpa batas; gambar base64 memperbesar kuota dan dapat membuat `setItem` gagal senyap.
- **FMEA:** S=7 × O=7 × D=8 = **392**.
- **Collateral damage:** Membersihkan saat logout dapat menghilangkan pesan yang belum terkirim jika logout tidak sengaja; perlu konfirmasi "ada N pesan gagal" sebelum logout.
- **Rekomendasi:**
  1. Kunci outbox per staf: `staff_outbox_v1:{staffId}`; TTL 24 jam; maksimal 20 item; simpan hanya teks dan URL media (bukan `dataUrl` penuh) bila memungkinkan.
  2. Hapus outbox pada logout, pada 401 tegas, dan saat ganti staf di perangkat yang sama.
  3. Tambah indikator "ada pesan gagal" dan konfirmasi sebelum logout.
- **Verifikasi:** Test unit murni `outboxKey(staffId)` + test integrasi logout: setelah logout, `localStorage.getItem(key)` null; login staf B tidak melihat item staf A; item >24 jam dibuang saat mount.

---

### S-03 — Auto-close trip tidak pernah berjalan di produksi: sweep ada di `worker`, sedangkan store GPS ada di memori proses `app`

- **Tipe:** Horizontal (arsitektur proses) + Vertikal (HP → API telemetry → Map memori → cron sweep)
- **Lokasi:** `src/services/staff-trip-tracking.service.ts:33,407-408,468-472,487-493`; `src/services/cron.service.ts:595-628`; `src/lifecycle/background-crons.ts:121-129`; `src/app.ts:314-318`; `src/worker.ts:116-118`; `docker-compose.yml:62,79,90`; `docs/audit/2026-11-02/fase-05/LAPORAN_FASE_05.md:23`
- **Bukti:**
  - Store adalah `Map` per proses: `private readonly store = new Map<string, ...>` (`staff-trip-tracking.service.ts:408`); TTL 2 jam (`:33` `TRIP_PING_TTL_SEC = 7200`).
  - Sweep memanggil store lokal: `const active = staffTripTrackingService.listActiveTrips();` (`cron.service.ts:600`).
  - Cron hanya didaftarkan di `startBackgroundCrons()` (`background-crons.ts:121-129`); `app.ts:315-318` melewati seluruh cron bila `SEPARATE_WORKER === 'true'`.
  - `worker.ts:117` memanggil `startBackgroundCrons()`; `docker-compose.yml:62,90` menetapkan `SEPARATE_WORKER=true` untuk `app` dan `worker`, dan `:79` menjalankan worker (`node dist/worker.js`).
  - Laporan Fase 5 mengklaim "auto-close trip 15m" (`LAPORAN_FASE_05.md:23`), padahal TTL 2 jam dan sweep tidak melihat data `app`.
- **Keyakinan:** TERBUKTI (arsitektur + konfigurasi compose). Di dev monolith (`npm run dev`) sweep berjalan; di production terpisah tidak.
- **Framework:** Well-Architected Reliability/Operational Excellence; OWASP privacy (lokasi).
- **Akar masalah (5 Whys):** (1) Kenapa sesi tidak tertutup? Karena sweep tidak menemukan trip. (2) Kenapa tidak menemukan? Karena state hanya di memori `app`. (3) Kenapa dipisah? Untuk mencegah memory leak di webhook dan menyiapkan Redis. (4) Kenapa belum Redis? Implementasi ditunda; komentar menyebut "calon Redis SETEX". (5) Kenapa lolos uji? Test hanya menguji fungsi murni + `listActiveTrips` dalam satu proses (`staff-trip-auto-close.test.ts:21-77`), tidak menguji `SEPARATE_WORKER`.
- **Risiko:** Posisi GPS terakhir staf dapat tampil hingga 2 jam setelah jadwal; privasi lokasi staf; klaim operasional "auto-close" palsu; bila nanti telemetry kontinu diaktifkan lagi, risiko lebih besar.
- **FMEA:** S=7 × O=9 × D=8 = **504** (tertinggi).
- **Collateral damage:** Memindahkan sweep ke `app` menambah beban event loop webhook; lebih baik persist ke DB/Redis. Migrasi state dapat mengubah kontrak `getTrip`/SSE; perlu uji dispatch map.
- **Rekomendasi fondasional:**
  1. Persist sesi trip ke tabel `staff_trip_sessions` (tenant_id, reservation_id, staff_id, lat, lng, accuracy, origin_source, updated_at, expires_at) **atau** Redis hash + TTL (Redis sudah ada di compose). Sweep membaca DB/Redis, bukan Map.
  2. Sampai migrasi selesai: jalankan `runTripAutoCloseSweep` di proses `app` (bukan `worker`) atau kirim perintah close melalui Redis pub/sub.
  3. Hapus/ubah klaim "auto-close 15m" di dokumentasi; TTL sebenarnya 2 jam.
- **Verifikasi:** Test integrasi dua proses: catat ping di instance A, jalankan sweep di instance B, assert `getTrip` null dan event `staff.trip_closed` terkirim. Uji compose `SEPARATE_WORKER=true` di staging; query `staff_trip_sessions` (bila migrasi) memastikan `expires_at` dihormati.

---

### S-04 — Sesi admin otomatis menjadi supervisor staf dengan `tenant_id = DEFAULT_TENANT_ID`

- **Tipe:** Horizontal (authz/tenant) + Vertikal (cookie admin → preHandler staf → service)
- **Lokasi:** `src/routes/staff.route.ts:49-78`; `src/routes/staff/today.subroute.ts:46-50`
- **Bukti:**
  - `staff.route.ts:64-76`: setiap `admin_session` valid diubah menjadi `{ staff: { id: adminSession.id || 'admin', role: 'SPV_CS', tenant_id: DEFAULT_TENANT_ID }, isAdminImpersonation: true }`.
  - `today.subroute.ts:46-50`: `isAdminImpersonation && isSupervisor` → default `scope = 'all'` (semua tugas tim).
  - Tidak ada pemeriksaan apakah admin tersebut memang berhak atas tenant default atau apakah ada pemetaan admin→tenant.
- **Keyakinan:** TERBUKTI (kode). Dampak produksi saat ini rendah karena baru satu tenant (`default-tenant`); ini **KRITIS untuk SaaS multi-tenant**.
- **Framework:** OWASP A01/A04, ASVS V4; Well-Architected Security.
- **Akar masalah (5 Whys):** (1) Kenapa admin bisa masuk portal staf? Untuk kenyamanan CS. (2) Kenapa memakai default tenant? Karena `AdminSession` tidak menyimpan `tenant_id` (tercatat di #316 K-03). (3) Kenapa tidak ditolak? Tidak ada gerbang eksplisit "impersonasi staf hanya untuk tenant sendiri". (4) Kenapa role dinaikkan ke SPV_CS? Karena semua admin dianggap supervisor. (5) Kenapa tidak teruji? Matriks RBAC hanya menguji 401/403 tanpa sesi, bukan pemetaan tenant admin.
- **Risiko:** Admin tenant B melihat/mengubah tugas, chat, dan pembayaran tenant A; audit mencatat identitas admin tetapi data tenant A; kebocoran lintas tenant saat SaaS aktif.
- **FMEA:** S=9 × O=2 × D=6 = **108** (S tinggi, O rendah hari ini).
- **Collateral damage:** Menambahkan `tenant_id` ke `AdminSession` memerlukan migrasi/penyesuaian login admin; jangan sampai memutus admin lama. Rollback: feature flag `ALLOW_ADMIN_STAFF_IMPERSONATION=false`.
- **Rekomendasi:** Simpan `tenant_id` + role pada `AdminSession`; tolak impersonasi bila tenant tidak cocok; jangan menaikkan role menjadi `SPV_CS` secara implisit (gunakan role sebenarnya); audit `impersonatedBy`.
- **Verifikasi:** Test integrasi: admin tenant B → `/api/staff/today-tasks?scope=all` hanya tenant B atau 403; admin tenant A tetap bisa; `request.staffSession.tenant_id` diassert.

---

### S-05 — Data tugas staf mengambil LTV, `admin_notes`, dan seluruh `preferences` pelanggan

- **Tipe:** Horizontal (data minimization di semua endpoint tugas) + Vertikal (DB → service → UI)
- **Lokasi:** `src/services/staff-reservation.service.ts:592-605,622`; `:910-912` (upcoming)
- **Bukti:**
  - `select.customer` memuat `preferences: true` (`:592`), `admin_notes: true` (`:594`), `ltv_cache: true` (`:604`), dan `customer_address: true` (`:622`).
  - `getUpcomingSchedule` juga memuat `preferences` dan `admin_notes` (`:910-912`).
  - `admin_notes` dan `ltv_cache` bukan kebutuhan terapis untuk eksekusi kunjungan; `preferences` adalah JSON bebas yang dapat berisi catatan internal/lokasi.
- **Keyakinan:** TERBUKTI.
- **Framework:** OWASP A01/A09, ASVS V8; prinsip need-to-know; UU PDP.
- **Akar masalah (5 Whys):** (1) Kenapa data itu terkirim? Karena `select` menyalin payload admin secara borongan. (2) Kenapa borongan? Tidak ada kontrak DTO staf yang eksplisit. (3) Kenapa tidak ada DTO? Endpoint staf tumbuh dari endpoint admin. (4) Kenapa tidak ada uji? Tidak ada test yang memeriksa field terlarang pada payload staf. (5) Kenapa penting? LTV/notes dapat memengaruhi perlakuan tidak adil dan membocorkan strategi bisnis.
- **Risiko:** Terapis melihat nilai belanja pelanggan dan catatan internal (mis. "pelanggan sulit", "VIP"); data ini bisa disalahgunakan atau bocor dari HP.
- **FMEA:** S=5 × O=10 × D=7 = **350**.
- **Collateral damage:** Menghapus field dapat memutus UI yang memakainya (mis. badge foto/alamat); perlu grep pemakaian FE dan sediakan field pengganti `house_photo_url`, `landmark`, `address`.
- **Rekomendasi:** Buat DTO eksplisit `StaffTaskCustomerDTO`; hanya kirim `name`, alamat yang diperlukan, `lat/lng`, `kelurahan/kecamatan`, `children` (nama/usia), `house_photo_url`, `landmark`, `distance_km/ongkir` bila perlu menagih. `admin_notes`/`ltv_cache` hanya untuk supervisor (endpoint terpisah) atau hapus dari payload.
- **Verifikasi:** Test unit `getTodayTasks` dengan mock DB: assert `JSON.stringify(result)` tidak mengandung `admin_notes`/`ltv_cache`; test supervisor tetap mendapat field yang diizinkan (bila disetujui).

---

### S-06 — GPS warm-up berjalan diam-diam di latar belakang tanpa disclosure/consent dan cache tidak dibersihkan saat stop

- **Tipe:** Vertikal (UI lifecycle → geolocation) + Horizontal (semua tugas dalam jendela)
- **Lokasi:** `packages/admin-dashboard/src/pages/staff/StaffToday.tsx:864-872`; `packages/admin-dashboard/src/utils/geoUtils.ts:435-453,460-469`
- **Bukti:**
  - `StaffToday.tsx:864-872`: `hasDepartWindowTask` dihitung dari semua `tasks/upcomingTasks`; jika ada, `startDepartGpsWarmup()` dipanggil otomatis.
  - `geoUtils.ts:439-452`: `navigator.geolocation.watchPosition(..., { enableHighAccuracy: true, ... })`; error callback hanya komentar `/* silent: izin ditolak ... */` (`:449-451`).
  - `stopDepartGpsWarmup()` (`:460-469`) hanya `clearWatch`, **tidak** mengosongkan `departCache` (module-level, `:428`).
  - Tidak ada banner/indikator "GPS aktif" di UI; komentar menyebut "Silent total".
- **Keyakinan:** TERBUKTI (kode); pelanggaran persetujuan/UU PDP adalah penilaian hukum, bukan uji teknis.
- **Framework:** OWASP privacy, UU PDP; Well-Architected Security; UX trust.
- **Akar masalah (5 Whys):** (1) Kenapa GPS menyala? Untuk mempercepat tombol Navigasi. (2) Kenapa otomatis? Agar bidan tidak menunggu GPS dingin. (3) Kenapa silent? Agar tidak mengganggu. (4) Kenapa tidak ada consent? Belum ada desain izin lokasi bertingkat. (5) Kenapa cache tidak dibersihkan? `stop` hanya melepas watch, bukan state.
- **Risiko:** Lokasi presisi staf direkam terus-menerus saat aplikasi terbuka (termasuk di luar jam kerja jika jadwal masih dalam window); data lokasi tersisa 60 detik setelah stop; kepercayaan staf turun bila menyadari.
- **FMEA:** S=6 × O=8 × D=9 = **432**.
- **Collateral damage:** Menghapus warm-up dapat memperlambat navigasi; kompensasi dengan one-shot `getCurrentPosition` saat tombol ditekan (sudah ada `getDepartPositionFast`).
- **Rekomendasi:** Hapus `watchPosition` silent; gunakan one-shot hanya saat pengguna menekan "Navigasi"/"OTW"; tampilkan indikator "Lokasi dipakai untuk keberangkatan" + tombol hentikan; kosongkan cache pada stop/unmount; dokumentasikan retensi.
- **Verifikasi:** Test unit `geoUtils` dengan mock `navigator.geolocation`: tidak ada `watchPosition` pada mount; `getDepartPositionFast` memanggil `getCurrentPosition`; `stop` mengosongkan cache. Uji perangkat: indikator lokasi muncul saat aktif dan hilang saat stop.

---

### S-07 — Nominal pembayaran lapangan dipercaya dari klien; tidak ada validasi terhadap harga katalog/ongkir

- **Tipe:** Vertikal (UI → route → service → DB) + Horizontal (semua metode bayar)
- **Lokasi:** `src/routes/staff/today.subroute.ts:1016-1053`; `src/services/staff-reservation.service.ts:1729-1735`; `packages/admin-dashboard/src/pages/staff/StaffToday.tsx:2331-2332`
- **Bukti:**
  - Route hanya mewajibkan `paymentMethod` (`today.subroute.ts:1039-1041`); `amount` diteruskan apa adanya (`:1043-1053`).
  - Service: `const totalCollected = amount != null ? amount : ((reservation as any).purchase_value || 0);` dan `pureTreatmentValue = amount != null ? Math.max(0, totalCollected - deliveryFee) : ...` (`:1729-1734`). Tidak ada rentang minimum/maksimum, tidak ada pembandingan dengan `treatment_detail`/katalog, tidak ada penolakan nominal negatif/NaN.
  - UI mengirim `amount: paymentModalTask.pricing.totalFee` (`StaffToday.tsx:2331-2332`), tetapi API dapat dipanggil langsung dengan nominal lain.
  - Audit `STAFF_RECORD_PAYMENT` mencatat nominal setelah transaksi (`staff-reservation.service.ts:1864-1885`), bukan pencegahan.
- **Keyakinan:** TERBUKTI (kode). Penyalahgunaan memerlukan kredensial staf aktif; bukan serangan anonim.
- **Framework:** Well-Architected Cost/Financial control; COSO internal control; OWASP A04.
- **Akar masalah (5 Whys):** (1) Kenapa nominal bisa diubah? Karena kontrak route menganggap klien terpercaya. (2) Kenapa? UI sudah menghitung total. (3) Kenapa tidak divalidasi ulang? Tidak ada seam harga kanonis di server untuk pembayaran lapangan. (4) Kenapa? Harga tersebar di `pricing` FE dan `purchase_value` historis. (5) Kenapa tidak teruji? Test pembayaran hanya happy path UI.
- **Risiko:** Kasir lapangan dapat mencatat Rp 1 untuk treatment Rp 300.000; LTV/CAC/komisi/Sheets ikut salah; audit hanya mendeteksi setelah uang hilang.
- **FMEA:** S=8 × O=3 × D=3 = **72** (dampak tinggi, occurrence rendah karena butuh staf).
- **Collateral damage:** Validasi ketat dapat menolak diskon manual/ongkir khusus yang sah. Perlu jalur override dengan persetujuan supervisor + alasan + audit.
- **Rekomendasi:** Server menghitung `expectedTotal = treatmentPrice(reservation) + deliveryFee`; tolak `amount` di luar toleransi (mis. ±Rp 1.000) kecuali `overrideReason` + supervisor; simpan `expectedTotal`, `submittedAmount`, `approvedBy` di audit; tolak NaN/negatif; batasi metode ke enum.
- **Verifikasi:** Test adversarial: amount 0, -1, "abc", 1, 10× expected → 400; amount = expected → 200; override supervisor tercatat; UI tetap menampilkan total.

---

### S-08 — Teks pesan bisnis staf dan ambang operasional masih hardcode

- **Tipe:** Horizontal (pelanggaran mandat non-hardcode) + Vertikal (UI → WA)
- **Lokasi:** `packages/admin-dashboard/src/pages/staff/StaffToday.tsx:4080-4082`; `src/routes/staff/quick-replies.subroute.ts:5-11`; `src/services/staff-reservation.service.ts:2120,2180,2189`
- **Bukti:**
  - `StaffToday.tsx:4081-4082`: `{ label: '🛵 Sedang OTW', text: 'Halo Bunda, saya sudah dalam perjalanan (OTW)...' }` dan `{ label: '📍 Sudah Sampai', text: 'Halo Bunda, saya sudah sampai...' }` — literal di bundle.
  - `quick-replies.subroute.ts:8-11`: komentar eksplisit "Teks bisnis tetap berasal dari DB ... bukan hardcode di bundle frontend"; endpoint ada, tetapi hanya dipakai untuk shareloc (`StaffToday.tsx:1947-1948`).
  - `staff-reservation.service.ts:2120` batas akurasi 50 m, `:2180` `MAX_ALLOWED_DISTANCE_KM = 45`, `:2189` selisih 25 km — konstanta operasional di kode, bukan `ClinicPolicy`/tenant settings.
  - `#315` (KNOWN_ISSUES baris 138) mengklaim draf staf mengambil template DB; klaim ini tidak mencakup dua chip di atas.
- **Keyakinan:** TERBUKTI.
- **Framework:** AGENTS.md Mandat Non-Hardcode & Data-Driven; SaaS-readiness; UX consistency.
- **Akar masalah (5 Whys):** (1) Kenapa teks hardcode? Karena chip dibuat sebelum endpoint DB tersedia. (2) Kenapa tidak dimigrasikan? Karena hanya shareloc yang dimigrasikan. (3) Kenapa ambang hardcode? Karena dianggap konstanta operasional global. (4) Kenapa tidak ada gate? Tidak ada lint/test yang menolak teks bisnis di bundle staf. (5) Kenapa penting? Perubahan brand/SOP memerlukan deploy ulang dan bisa berbeda dari template server.
- **Risiko:** Pesan staf tidak konsisten dengan template resmi (nada, nama brand, syarat), dan ambang 45 km/25 km tidak dapat disesuaikan per tenant.
- **FMEA:** S=5 × O=10 × D=6 = **300**.
- **Collateral damage:** Memindahkan chip ke DB memerlukan seed template `otw_staff`/`arrival_staff` dan fallback yang jelas; jangan mengosongkan UI bila DB offline (gunakan endpoint `/otw-template`/`/arrival-template` yang sudah ada).
- **Rekomendasi:** Tambah shortcut quick reply di DB (seed idempoten) untuk "Sedang OTW" dan "Sudah Sampai"; FE mengambil dari `/api/staff/quick-replies` dengan fallback ke `/api/staff/otw-template` dan `/api/staff/arrival-template` (bukan teks literal). Pindahkan ambang 45/25/50 ke `ClinicPolicy`/`Tenant.settings` dengan default di service (bukan hardcode tersebar).
- **Verifikasi:** Test: DB berisi template → chip memakai isi DB; DB kosong → chip memakai template server, bukan literal; ubah template di DB → UI berubah tanpa rebuild. Test tenant dengan ambang berbeda.

---

### S-09 — Ergonomi lapangan & kejujuran status: target sentuh <44px, input login 14px, aksi kritis tidak antre offline, dan "pesan terkirim" palsu saat WA gagal

- **Tipe:** Horizontal (UX mobile) + Vertikal (tap → API → WA → feedback)
- **Lokasi:** `packages/admin-dashboard/src/pages/staff/StaffToday.tsx:4040,4148,4165,4187,1568-1571,1973-1976,2111`; `packages/admin-dashboard/src/pages/staff/StaffLogin.tsx:73,91`; `src/services/staff-reservation.service.ts:2569-2607`; `src/routes/staff/today.subroute.ts:904-909`
- **Bukti:**
  - Tombol kamera/galeri/kirim `h-10 w-10` = 40px (`StaffToday.tsx:4148,4165,4187`), di bawah 44px; tombol retry pesan gagal `px-2 py-1` (~26px) di area kritis (`:4040`).
  - Input login `text-sm` (14px) (`StaffLogin.tsx:73,91`) memicu auto-zoom iOS saat fokus.
  - Aksi kritis diblokir saat offline tanpa antrean: kirim chat (`:1568-1571`), catat tiba (`:1973-1976`), kirim info pembayaran (`:2111`). Hanya chat yang punya outbox; arrival/complete/payment tidak.
  - `recordArrival` mengabaikan hasil WA: `waResult = await liveChatService.sendAdminReply(...)` (`staff-reservation.service.ts:2577`) lalu tetap `success: true` (`:2602-2607`); route selalu mengembalikan pesan "pesan telah dikirim ke pasien" (`today.subroute.ts:904-909`).
- **Keyakinan:** TERBUKTI.
- **Framework:** Heuristik UX mobile (target 44px, keyboard/zoom, feedback), WCAG 2.5.8; Well-Architected Reliability (offline).
- **Akar masalah (5 Whys):** (1) Kenapa target kecil? Karena desain desktop dipadatkan untuk layar HP. (2) Kenapa input 14px? Mengikuti skala teks dashboard, bukan aturan iOS. (3) Kenapa tidak ada antrean? Hanya jalur chat yang diberi outbox. (4) Kenapa status palsu? Kontrak `sendAdminReply` mengembalikan objek, tetapi route hanya memeriksa `success` reservation, bukan `waResult.success`. (5) Kenapa lolos? Tidak ada test UI mobile/offline dan tidak ada test kontrak "WA gagal".
- **Risiko:** Bidan salah tap, gagal kirim di basement, mengira pasien sudah diberi tahu padahal tidak; kepercayaan pasien turun.
- **FMEA:** S=5 × O=6 × D=6 = **180**.
- **Collateral damage:** Mengubah ukuran tombol dapat mengurangi ruang composer; solusi: naikkan ke 44px dan kurangi elemen lain. Antrean aksi kritis memerlukan idempotency key agar tidak dobel.
- **Rekomendasi:** (a) Naikkan semua aksi utama ke `min-h-[44px] min-w-[44px]`; (b) input login `text-base` (16px); (c) route `recordArrival` mengembalikan `waSent: boolean`/`warning` dan UI hanya mengklaim "pesan terkirim" bila benar; (d) outbox terpadu untuk arrival/complete/payment dengan `clientTempId` + retry (reuse pola chat), atau minimal simpan status "pending sync" dan blokir klaim sukses.
- **Verifikasi:** Lighthouse/Chrome mobile emulation (target size), iOS Safari focus (tidak zoom), test route: mock `sendAdminReply` gagal → response `waSent:false` dan UI menampilkan peringatan; test offline: aksi masuk antrean dan terkirim saat online.

---

### S-10 — Gate audit Fase 5 2026-11-02 tidak sah: 7 path test diklaim, `fase-05.json` hanya berisi 1 file/16 test

- **Tipe:** Proses (integritas audit) — bukan bug runtime
- **Lokasi:** `docs/audit/2026-11-02/fase-05/LAPORAN_FASE_05.md:20-35`, `docs/audit/2026-11-02/fase-05.json`
- **Bukti:**
  - Laporan menulis 7 path test (`staff-auth`, `staff-chat-unsend`, `staff-colors`, `staff-photo-capture`, `staff-today-tasks`, `staff-trip-tracker`, `staff-session`) dan "7 file suites, 16 tests passed" (`LAPORAN_FASE_05.md:33-35`).
  - `fase-05.json` (dibaca dengan `ConvertFrom-Json`) hanya memuat `tests/unit/staff-colors.test.ts` dengan 16 test. Tidak ada file auth/session/trip/today.
  - Enam dari tujuh path di laporan **tidak ada** di repo; test yang relevan ada dengan nama lain (`staff-auth-and-reservation.test.ts`, `staff-trip-tracking.test.ts`, `staff-trip-auto-close.test.ts`, dll.) tetapi tidak dijalankan pada gate tersebut.
  - Ini pola berulang dari **#299/#302** (laporan audit mengklaim cakupan yang tidak sesuai JSON gate).
- **Keyakinan:** TERBUKTI.
- **Framework:** ISO 19011 (audit evidence), AGENTS.md gate regresi; bukan OWASP.
- **Akar masalah (5 Whys):** (1) Kenapa PASS? Karena laporan tidak direkonsiliasi dengan `fase-05.json`. (2) Kenapa tidak? Tidak ada gate otomatis yang membandingkan daftar path laporan dengan `testResults`. (3) Kenapa path salah? Path ditulis dari rencana, bukan dari eksekusi. (4) Kenapa berulang? #299/#302 hanya memperbaiki laporan lama, bukan menambah validator. (5) Kenapa penting? Modul 5 dinyatakan aman padahal test auth/trip/session tidak dijalankan.
- **Risiko:** Keputusan "sudah diaudit/PASS" menutup celah nyata (S-01/S-03/S-06) tanpa bukti; regresi berikutnya lolos.
- **FMEA:** S=4 × O=10 × D=9 = **360** (dampak tidak langsung, tetapi hampir pasti terjadi).
- **Collateral damage:** Menambah validator gate memperlambat rilis sedikit; jangan mengubah test lama.
- **Rekomendasi:** Buat skrip `scripts/verify-audit-gate.mjs` yang membandingkan path di laporan dengan `testResults[].name` JSON; exit non-zero bila ada path hilang/ekstra. Jalankan di CI audit. Perbaiki laporan Fase 5 menjadi status **PARSIAL** dan cantumkan test yang benar-benar dijalankan.
- **Verifikasi:** Jalankan skrip pada `fase-05.json` → harus gagal (6 path hilang); pada `fase-07.json` → harus lulus (9 file/95 test). Setelah perbaikan laporan, gate hijau.

---

### M-01 — Kode tracking 2 karakter tanpa masa berlaku dapat dipakai ulang/ditebak; pelanggan dapat menyuntik kampanye palsu

- **Tipe:** Vertikal (landing → AdClick → chat → CAPI → dashboard) + Horizontal (semua kampanye)
- **Lokasi:** `src/routes/tracking.route.ts:162-170,198-237`; `src/services/ad-attribution.service.ts:56-57,120-161,198-216`; `src/services/cron.service.ts:309-371`; `prisma/schema.prisma:691-715`
- **Bukti:**
  - Alfabet 32 karakter dan panjang awal **2** (`tracking.route.ts:162-170`); eskalasi 2→3→4 hanya setelah 5 collision (`:214-236`).
  - Pesan pelanggan dicocokkan dengan regex `[\w\s-]{2,32}` (`ad-attribution.service.ts:56-57`).
  - `updateMany({ where: { trackingCode, tenant_id, matchedAt: null } })` (`:142-147`) tidak memeriksa usia klik atau apakah kode memang milik kampanye yang masih aktif.
  - Jika tidak ada klik yang cocok, service **membuat AdClick baru** dengan `utmCampaign: trackingCode` dan `utmSource: 'whatsapp_direct'` (`:198-216`) — pelanggan dapat mengirim `[promo-apa-saja]` dan menciptakan baris kampanye palsu.
  - `cleanupOldAdClicks` menghapus klik tak cocok >7 hari dan melepas kode >100 hari (`cron.service.ts:311-365`), sehingga kode 2 karakter didaur ulang terus-menerus.
  - `AdClick` tidak punya `expires_at` (`schema.prisma:691-715`).
- **Keyakinan:** TERBUKTI (jalur kode). Eksploitasi aktif tidak diuji ke produksi.
- **Framework:** Well-Architected Cost (biaya iklan), OWASP A04; data integrity.
- **Akar masalah (5 Whys):** (1) Kenapa kode pendek? Agar mudah dibaca/diketik pelanggan. (2) Kenapa tanpa expiry? Fokus awal pada throughput klik. (3) Kenapa kode didaur ulang? Keyspace 2 karakter cepat penuh. (4) Kenapa tidak diikat ke klik? Karena pencocokan hanya berbasis teks. (5) Kenapa tidak terdeteksi? Metrik hanya menghitung matched/unmatched, bukan validitas asal kode.
- **Risiko:** Atribusi kampanye salah, CAC/ROAS salah, pelanggan lama memakai kode lama dan cocok ke klik orang lain, kampanye palsu muncul di dashboard, CAPI Contact mengirim `fbclid/fbc` klik yang salah.
- **FMEA:** S=9 × O=5 × D=8 = **360**.
- **Collateral damage:** Memperpanjang kode mengubah pesan WA dan kebiasaan pelanggan; kode lama harus tetap didukung selama masa transisi. Menaikkan panjang mengurangi collision tetapi tidak menghilangkan tebakan; perlu expiry + binding.
- **Rekomendasi fondasional:** (a) Panjang minimum 10–12 karakter dari alfabet yang ada (tanpa dependency); (b) tambah `expires_at` (24–72 jam) dan `campaign_id`/`fbclid` binding; (c) tolak pencocokan bila `createdAt` di luar window atau `tenant_id` berbeda; (d) jangan buat AdClick baru untuk kode yang tidak dikenal — catat `unmatchedCode` di log/metric, bukan sebagai kampanye; (e) gunakan transaksi `updateMany` + cek `count` sebelum CAPI.
- **Verifikasi:** Test adversarial: kirim `[zz]` tanpa klik → tidak ada AdClick; kirim kode klik >72 jam → tidak match; dua pelanggan mengirim kode sama → hanya satu match; kode 10 karakter tidak collision pada 10.000 generate; review pesan WA (panjang kode).

---

### M-02 — `external-tracker.js` hardcode pixel Kala + domain fallback; pixel di dokumen (1382300863013984) berbeda dari pixel tracker (1465457801784141)

- **Tipe:** Horizontal (semua landing eksternal) + Vertikal (script → pixel/CAPI)
- **Lokasi:** `src/landing/public/external-tracker.js:15-16,52-55,231`; `packages/admin-dashboard/src/pages/tenant/MetaClickCatcher.tsx:1240`; `docs/META_CAPI_SETUP.md:24,103`; `src/services/capi.service.ts:392`
- **Bukti:**
  - `external-tracker.js:16`: `var DEFAULT_PIXEL_ID = '1465457801784141';` dan `:52-55` memakai ID itu bila tidak ada `?pixel`/`?p`.
  - `:231`: fallback base API `'https://app.kalababyspa.online'`.
  - `META_CAPI_SETUP.md:24` dan `:103` menyebut pixel DB `1382300863013984`.
  - `MetaClickCatcher.tsx:1240` menampilkan fallback `'1465457801784141'`.
  - `capi.service.ts:392`: `if (tenant?.meta_pixel_id) pixelId = tenant.meta_pixel_id;` — CAPI memakai pixel DB.
  - #278 B4 sudah menghapus domain hardcode di `capi.service.ts`, tetapi belum di `external-tracker.js`.
- **Keyakinan:** TERBUKTI untuk hardcode; **KEMUNGKINAN BESAR** untuk split pixel (perlu cek DB live; tidak diakses).
- **Framework:** Well-Architected Security/Cost; AGENTS.md SaaS-readiness; OWASP A01.
- **Akar masalah (5 Whys):** (1) Kenapa pixel hardcode? Script dibuat untuk satu klinik. (2) Kenapa tidak diubah saat multi-tenant? Karena script disajikan statis, bukan route yang bisa membaca tenant. (3) Kenapa ada dua ID? Dokumentasi/server dan script tidak disinkronkan. (4) Kenapa tidak ada test? Test landing hanya memeriksa `/assets/external-tracker.js` tersaji, bukan isi pixel. (5) Kenapa penting? PageView/AddToCart ke pixel A dan Purchase CAPI ke pixel B tidak bisa didedup/dioptimasi bersama.
- **Risiko:** Trafik tenant lain masuk ke pixel Kala (kebocoran data & biaya iklan), atau PageView dan Purchase berada di dataset berbeda; dedup PageView (`eventID`) tidak pernah terbukti (#278 poin 4).
- **FMEA:** S=9 × O=5 × D=7 = **315**.
- **Collateral damage:** Menghapus default pixel dapat mematikan pelacakan landing lama yang tidak mengirim `?pixel`; perlu fallback ke konfigurasi tenant via route, bukan default global.
- **Rekomendasi:** Sajikan tracker lewat route (`/assets/external-tracker.js?tenant=slug`) yang menyuntik `pixelId`/`apiBaseUrl` dari DB tenant (verifikasi slug), atau wajibkan `data-pixel`/`?pixel` dan **hapus DEFAULT_PIXEL_ID**; samakan dengan `Tenant.meta_pixel_id`; tambah test yang memastikan tenant B tidak mendapat pixel tenant A. Perbarui dokumen agar satu ID kanonis.
- **Verifikasi:** Test integrasi `GET /assets/external-tracker.js?tenant=tenant-b` mengandung pixel B dan tidak mengandung pixel A/default; request tanpa tenant → tidak ada `fbq('init')`; cek DB live `SELECT id, meta_pixel_id` (read-only) untuk memastikan ID kanonis.

---

### M-03 — Jalur admin marketing masih tenant-blind / hardcode `DEFAULT_TENANT_ID`

- **Tipe:** Horizontal (tenant isolation) + Vertikal (UI → API → DB)
- **Lokasi:** `src/routes/admin/landings.subroute.ts:264-276,282-307,344-355,407-449,510-518`; `src/routes/admin/settings.subroute.ts:1601-1607,1643-1665`; `src/routes/admin/meta-attribution.subroute.ts:637-642,692-701,714,806-811`; `src/routes/tracking.route.ts:319`
- **Bukti:**
  - `landings.subroute.ts:265`: `const tenantId = (request.query as any)?.tenantId || DEFAULT_TENANT_ID;` — daftar landing dapat dibaca untuk tenant mana pun dengan query.
  - `:346`: create selalu `tenant_id: DEFAULT_TENANT_ID`.
  - `:287` GET by id `findUnique({ where: { id } })` tanpa tenant; `:407` PUT dan `:515` DELETE juga tanpa tenant.
  - `settings.subroute.ts:1607,1643,1659`: konfigurasi CAPI hanya untuk `DEFAULT_TENANT_ID`.
  - `meta-attribution.subroute.ts:642` test CAPI, `:692-694` `customer.findFirst({ where: { phone: { contains: last9 } } })` tanpa tenant, `:714` manual send `tenantId: DEFAULT_TENANT_ID`, `:810` history default.
  - `tracking.route.ts:319`: `tenant_id = body.tenantId || body.tenant_id || DEFAULT_TENANT_ID` untuk `/api/tracking/click` tanpa verifikasi.
  - Audit landing tidak mengirim `tenantId` (`landings.subroute.ts:358-365,451-458,520-527`).
- **Keyakinan:** TERBUKTI. Dampak produksi saat ini rendah (satu tenant); **KRITIS untuk SaaS**.
- **Framework:** OWASP A01/A04, ASVS V4; Well-Architected Security; AGENTS.md SaaS-readiness.
- **Akar masalah (5 Whys):** (1) Kenapa tenant hardcode? Fitur dibangun sebelum multi-tenant. (2) Kenapa tidak diperbaiki? Ada `tenantOf()` tetapi tidak dipakai konsisten. (3) Kenapa UI bisa memilih tenant? `?tenantId=` dianggap alat admin. (4) Kenapa tidak ada test? Test landing offline hanya menguji default; test CTWA hanya menguji isolasi di route CTWA. (5) Kenapa penting? Konten publik, pixel, dan PII dapat berpindah tenant.
- **Risiko:** Staff/admin tenant B mengubah landing/pixel tenant A; landing tenant B tidak pernah muncul (selalu dibuat di default); manual CAPI mengirim PII pelanggan tenant B ke pixel default; audit tidak menunjukkan tenant.
- **FMEA:** S=9 × O=3 × D=5 = **135** (S tinggi, occurrence rendah hari ini).
- **Collateral damage:** Migrasi data landing lama yang `tenant_id` default perlu pemetaan; endpoint `?tenantId=` mungkin dipakai tooling internal; jangan memutus super-admin.
- **Rekomendasi:** Gunakan `tenantOf(request)`/`request.tenantId` di semua route; untuk create gunakan tenant sesi, bukan default; GET/PUT/DELETE harus `findFirst({ id, tenant_id })` dan 404 bila tidak cocok; super-admin lintas tenant hanya lewat header eksplisit + audit. Hapus `tenantId` dari body click atau verifikasi ke DB. Tambahkan `tenantId` ke audit.
- **Verifikasi:** Test multi-tenant: staff tenant B `GET/PUT/DELETE` landing A → 404/403; create landing B → `tenant_id=B`; CAPI config B → DB B; manual send B → pixel B; audit berisi tenant B. Query DB memastikan tidak ada baris `DEFAULT_TENANT_ID` baru dari tenant B.

---

### M-04 — Simpan/reset landing mengembalikan HTTP 200 "sukses" saat DB gagal, tetapi tidak menulis apa pun

- **Tipe:** Vertikal (UI → API → DB) + Horizontal (semua editor landing)
- **Lokasi:** `src/routes/admin/landings.subroute.ts:190-206,251-257,343-394,467-503`
- **Bukti:**
  - `PUT /api/admin/tenant/:id/html` catch DB error → `return reply.status(200).send({ success: true, message: '... (In-Memory Fallback Mode).' ... })` (`:202-206`), tetapi tidak ada `memoryLandings.set` di jalur ini.
  - `POST /tenant/:id/landing/reset` catch → 200 sukses "In-Memory Fallback Mode" (`:252-256`), juga tanpa penulisan memori.
  - `POST /api/admin/landings` catch menulis `memoryLandings` (`:371-394`), tetapi hanya proses lokal; setelah restart/multi-instance hilang.
  - `PUT /api/admin/landings/:id` catch menulis `memoryLandings` (`:467-503`).
- **Keyakinan:** TERBUKTI.
- **Framework:** Well-Architected Reliability; OWASP A09 (logging/monitoring); UX trust.
- **Akar masalah (5 Whys):** (1) Kenapa 200? Pola "degrade-silent" agar dashboard tetap hidup. (2) Kenapa tanpa tulis? Fallback memori tidak diimplementasikan untuk jalur tenant HTML/reset. (3) Kenapa tidak terdeteksi? Tidak ada test DB-offline untuk endpoint tulis. (4) Kenapa berbahaya? Admin mengira konten sudah dipublikasikan. (5) Kenapa pola ini dipakai? Tidak ada kontrak error yang konsisten antara read dan write.
- **Risiko:** Kampanye berjalan dengan landing lama/kosong; admin menutup modal dengan tenang; setelah restart konten hilang; di multi-instance, instance lain tidak melihat perubahan.
- **FMEA:** S=7 × O=5 × D=8 = **280**.
- **Collateral damage:** Mengubah ke 503 dapat memblokir editing saat DB gangguan; solusi: tampilkan status "belum tersimpan" + retry, bukan klaim sukses.
- **Rekomendasi:** Untuk operasi tulis, **fail-closed**: 503 + `saved:false` + pesan jelas; hapus "In-Memory Fallback Mode" untuk write produksi (atau aktifkan hanya `NODE_ENV==='test'` dengan flag eksplisit). Untuk read, fallback memori boleh. Tambahkan audit `LANDING_SAVE_FAILED` + alert.
- **Verifikasi:** Test dengan mock Prisma reject: `PUT/POST` → 503, tidak ada response `success:true`; UI menampilkan error dan tidak menutup modal; setelah DB pulih, data benar-benar tersimpan (query DB).

---

### M-05 — Slug landing tidak dikenal mengembalikan landing tenant pertama, bukan 404

- **Tipe:** Vertikal (route publik → service → DB) + Horizontal (semua slug)
- **Lokasi:** `src/services/landing-content.service.ts:133-146`; `src/routes/landing.route.ts:477-483,559-568`; `tests/integration/landing-serving.test.ts:102-110`
- **Bukti:**
  - `resolveLandingContent` mencari `landingPage` by slug; jika tidak ada, mencari tenant by slug/id (`:119-131`); jika masih tidak ada, **`tenant = await prisma.tenant.findFirst({ select: ... })` tanpa `where`** (`:133-146`).
  - Route `/promo/:slug` dan `/:slug` secara eksplisit mengharapkan 404 (`landing.route.ts:479-483,564-568`).
  - Test `landing-serving.test.ts:102-110` hanya berjalan dengan DB offline; saat DB offline query tenant juga gagal sehingga 404. Jalur "DB online + slug tidak ada + ada tenant" tidak diuji.
- **Keyakinan:** TERBUKTI (kode). Perlu konfirmasi DB live, tetapi logika `findFirst` tanpa `where` deterministik.
- **Framework:** Well-Architected Reliability/Security; SEO/lead integrity.
- **Akar masalah (5 Whys):** (1) Kenapa tenant pertama? Untuk kompatibilitas landing legacy tanpa slug. (2) Kenapa tidak dibatasi? Tidak ada penanda `is_legacy_default`. (3) Kenapa test lolos? Test hanya offline. (4) Kenapa route `/promo` tidak 404? Service menutupi kekosongan. (5) Kenapa penting? Typo iklan mengirim calon pasien ke klinik yang salah.
- **Risiko:** Iklan dengan slug typo menampilkan landing/WhatsApp/pixel tenant pertama (biasanya default) → lead salah klinik, attribution salah, kepercayaan turun.
- **FMEA:** S=8 × O=6 × D=7 = **336**.
- **Collateral damage:** Menghapus fallback dapat mematikan landing legacy yang memang mengandalkan tenant default; perlu migrasi slug eksplisit atau flag `allowLegacyFallback` per tenant.
- **Rekomendasi:** Hapus `findFirst` tanpa `where`; return `null` → 404. Bila kompatibilitas legacy dibutuhkan, hanya untuk `tenant.slug === 'default'` dan dengan flag konfigurasi tenant, bukan semua slug. Tambah test online (mock DB dengan tenant rows) untuk `/promo/tidak-ada` → 404.
- **Verifikasi:** Test integrasi dengan mock DB berisi 1 tenant: `/promo/typo` → 404, bukan 200; `/promo/slug-valid` → 200; `/go?slug=typo` tetap 200 generik (fail-open khusus `/go`).

---

### M-06 — Beacon PageView publik tanpa origin/auth; `/cta` memakai XFF kiri yang dapat dipalsukan; tenant klik dari body

- **Tipe:** Vertikal (landing eksternal → beacon/CTA → metric → watchdog) + Horizontal (semua kampanye)
- **Lokasi:** `src/routes/tracking.route.ts:278-307,319,382-413`; `src/routes/landing.route.ts:262,316`; `src/services/ad-funnel-metrics.service.ts:69-82`; `src/app.ts:70-71`
- **Bukti:**
  - `/api/tracking/pageview` tidak memakai `isTrustedTrackingOrigin` (hanya `/api/tracking/click` yang memakainya, `tracking.route.ts:302`); endpoint menerima `landingUrl`, `fbclid`, UTM dari siapa pun (`:398-435`).
  - `/api/tracking/click` mengambil `tenant_id` dari body tanpa verifikasi (`:319`).
  - `/cta` menyimpan IP dari header kiri: `const ip = (request.headers['x-forwarded-for'] as string) || request.ip || '';` lalu `ip.split(',')[0]` (`landing.route.ts:262,316`) — berbeda dari `/api/tracking/pageview` yang memakai `request.ip` (`tracking.route.ts:407`).
  - Metrik paid views membaca `landing_page_views` apa adanya (`ad-funnel-metrics.service.ts:69-82`).
- **Keyakinan:** TERBUKTI untuk kode; dampak (fake views) KEMUNGKINAN BESAR, belum diuji live.
- **Framework:** OWASP A04/A09; Well-Architected Reliability/Cost.
- **Akar masalah (5 Whys):** (1) Kenapa beacon terbuka? Karena script eksternal harus mengirim lintas domain. (2) Kenapa tanpa origin? Karena sendBeacon tidak selalu mengirim Origin; hanya UA filter. (3) Kenapa IP kiri? Sisa implementasi lama; `request.ip` belum dipakai konsisten. (4) Kenapa tidak ada dedup/verifikasi? eventId unik global, tetapi penyerang dapat membuat eventId baru. (5) Kenapa penting? Watchdog memakai paidViews sebagai denominator.
- **Risiko:** Penyerang/bot dengan UA normal dapat menyuntik ribuan view dengan `fbclid` fiktif → CTR turun → alert `LOW_CTR` palsu, tim marketing mematikan kampanye sehat; IP poisoning pada CAPI (matching).
- **FMEA:** S=8 × O=6 × D=7 = **336**.
- **Collateral damage:** Menambah signature/origin check dapat memblokir landing eksternal lama; sediakan token per tenant di script tag dan masa transisi. Jangan memakai `request.ip` mentah untuk CAPI tanpa mempertimbangkan proxy.
- **Rekomendasi:** (a) Terapkan origin allowlist juga pada pageview (Origin/Referer same-site atau `landing_domain`), dengan pengecualian `sendBeacon` yang tidak mengirim Origin → wajib token `tenant` bertanda tangan (HMAC pendek) yang disuntik server ke script; (b) validasi `tenant_id` klik ke DB (bukan body); (c) gunakan `request.ip` (bukan XFF kiri) untuk `ipAddress` `/cta`; (d) filter `utm_source=test`/sandbox dari metrik; (e) rate limit per `eventId` + per IP.
- **Verifikasi:** Test: POST pageview dari origin tak terdaftar tanpa token → 403; dengan token valid → 200; `/cta` dengan XFF palsu → `ipAddress` sama dengan `request.ip`; simulasi 1000 view fiktif → watchdog tidak menghasilkan alert (atau alert `INSTRUMENTATION_SUSPECT`).

---

### M-07 — Watchdog menulis status `SENT` sebelum alert benar-benar terkirim; nama tenant/jam banner hardcode

- **Tipe:** Vertikal (cron → log → AlertService → Telegram) + Horizontal (semua tenant)
- **Lokasi:** `src/services/ad-watchdog.service.ts:216,252,322-334,341,368-421`; `tests/unit/ad-watchdog-cooldown.test.ts`
- **Bukti:**
  - `AdminNotificationLog.create({ data: { ..., status: 'SENT' } })` dilakukan **sebelum** `AlertService.notifyAlert` (`:368-396` vs `:398-421`).
  - Bila `notifyAlert` gagal, catch hanya `console.error` dan `return { sent:false }` (`:418-421`); log tetap `SENT`.
  - Cooldown berikutnya membaca log `sent_at` apa pun (`:322-334`) sehingga alert yang gagal tidak dicoba ulang selama 180 menit; idempotency key per jam juga memblokir.
  - `formatMessage` hardcode "sejak 08:00 WIB" (`:216`), `evaluate` hardcode `'Kala Baby Spa'` (`:252`), `checkAndNotify` fallback `let tenantName = 'Kala Baby Spa'` (`:341`).
- **Keyakinan:** TERBUKTI.
- **Framework:** Well-Architected Operational Excellence; OWASP A09; AGENTS.md non-hardcode.
- **Akar masalah (5 Whys):** (1) Kenapa log SENT? Untuk klaim idempotensi sebelum efek samping. (2) Kenapa tidak diupdate? Tidak ada status `PENDING/FAILED`. (3) Kenapa cooldown memakai log? Karena satu-satunya sumber. (4) Kenapa brand hardcode? Fallback cepat saat tenant lookup gagal. (5) Kenapa tidak teruji? Test hanya happy path + P2002, tidak mock AlertService gagal.
- **Risiko:** Alert penting hilang tanpa jejak; tenant non-Kala melihat nama Kala; jam "08:00" salah bila konfigurasi tenant berbeda; tim marketing tidak tahu kampanye bermasalah.
- **FMEA:** S=6 × O=5 × D=8 = **240**.
- **Collateral damage:** Mengubah status log dapat memengaruhi query/cooldown; perlu migrasi status lama `SENT` yang sebenarnya gagal (tidak bisa dibedakan) — mulai dari sekarang.
- **Rekomendasi:** Simpan log `PENDING` → kirim → update `SENT`/`FAILED`; cooldown hanya untuk `SENT`; tambah retry terbatas untuk `FAILED`; ambil jam aktif dari `cfg.activeStartHourWib` dan nama tenant dari DB (fallback ke `DEFAULT` yang netral, bukan merek); tambah test `notifyAlert` reject → status `FAILED`, retry berikutnya diizinkan.
- **Verifikasi:** Test unit baru: mock `notifyAlert` reject; assert `status:'FAILED'`, `checkAndNotify` berikutnya (dalam cooldown) tetap mencoba; mock tenant name "Klinik B" → pesan berisi "Klinik B"; set `activeStartHourWib=9` → pesan "sejak 09:00 WIB".

---

### M-08 — Pemilihan CTWA catcher memakai skor mentah tertinggi, sehingga kandidat yang tidak lolos anchor dapat menutupi kandidat yang cocok

- **Tipe:** Vertikal (teks WA → catcher → AdClick → CAPI) + Horizontal (multi-kampanye)
- **Lokasi:** `src/services/ctwa-text-catcher.service.ts:147-205`
- **Bukti:**
  - `matched` dihitung dari `guardOk && effectiveScore >= threshold` (`:182-185`).
  - Namun pemilihan `best` memakai `if (!best || bestScore > best.similarityScore)` (`:187-201`), **bukan** `matched`/`effectiveScore`.
  - Contoh: Catcher A skor mentah 0.84 tetapi anchor tidak cocok (tidak match); Catcher B skor 0.80 + anchor cocok (match). Loop mempertahankan A karena 0.84 > 0.80 → hasil `matched:false`, padahal B cocok.
- **Keyakinan:** TERBUKTI (logika murni).
- **Framework:** Well-Architected Reliability; data attribution integrity.
- **Akar masalah (5 Whys):** (1) Kenapa skor mentah? Awalnya hanya satu catcher. (2) Kenapa tidak memprioritaskan matched? Tidak ada aturan tie-break. (3) Kenapa tidak teruji? Test hanya satu catcher dominan, bukan dua dengan anchor berbeda (`ad-attribution-ctwa-catch.test.ts`). (4) Kenapa penting? Multi-kampanye adalah kondisi normal. (5) Kenapa tidak terdeteksi di dashboard? Simulator hanya menampilkan hasil akhir, bukan kandidat yang kalah.
- **Risiko:** Lead iklan CTWA teratribusi organik; CAPI Contact tidak membawa campaign; laporan kanal salah; biaya iklan tidak terukur.
- **FMEA:** S=7 × O=6 × D=8 = **336**.
- **Collateral damage:** Mengubah tie-break dapat mengubah atribusi historis baru; jangan mengubah data lama. Perlu uji dengan template mirip.
- **Rekomendasi:** Pilih kandidat `matched` terlebih dahulu, lalu bandingkan `effectiveScore`; bila seri, pilih `similarityScore` lebih tinggi, lalu `catcherId` stabil. Tambah test dua catcher (satu anchor gagal skor tinggi, satu cocok skor rendah) dan test anchor bypass.
- **Verifikasi:** Test unit baru dengan dua catcher; assert hasil `matched:true` dan `campaignName` dari catcher yang anchor-nya cocok; test regresi single-catcher tetap sama.

---

### M-09 — Perubahan biaya iklan bulanan tidak diaudit; dashboard menghitung CAC/ROAS dari spend yang belum disimpan

- **Tipe:** Vertikal (UI → settings → report) + Horizontal (semua tenant)
- **Lokasi:** `src/routes/admin/meta-attribution.subroute.ts:539-605`; `packages/admin-dashboard/src/components/meta-performance/MetaPerformancePanel.tsx:80,86-90,156-161`
- **Bukti:**
  - `PUT /api/admin/meta-performance/settings` menulis `settings.metaPerformanceSettings` (`:565-601`) tanpa `auditService.logAdminAction` (bandingkan endpoint CAPI config yang mencatat audit, `settings.subroute.ts:1669-1679`).
  - `MetaPerformancePanel.tsx:80`: `const totalSpendNum = (Number(lpwaSpend) || 0) + (Number(ctwaSpend) || 0);`
  - `:156-161`: effect memanggil `load(totalSpendNum > 0 ? totalSpendNum : undefined)` setiap `totalSpendNum` berubah (debounce 300 ms), termasuk saat pengguna baru mengetik dan belum menekan "Simpan".
  - `:89`: report dikirim dengan `spend` yang belum tentu tersimpan.
- **Keyakinan:** TERBUKTI.
- **Framework:** COSO/Well-Architected Cost; OWASP A09; audit trail.
- **Akar masalah (5 Whys):** (1) Kenapa tidak diaudit? Endpoint dianggap "setting ringan". (2) Kenapa UI menghitung? Untuk feedback cepat. (3) Kenapa tidak ada status "dirty"? Tidak ada state `isDirty`. (4) Kenapa tidak ada test? Test analitik menguji service, bukan endpoint settings/UI. (5) Kenapa penting? Spend adalah input utama CAC/ROAS; perubahan tanpa jejak tidak dapat dipertanggungjawabkan.
- **Risiko:** Angka CAC/ROAS menyesatkan saat pengguna mengetik; keputusan budget berdasarkan angka yang tidak tersimpan; perubahan spend oleh admin lain tidak dapat diaudit; race dua tab dapat menimpa pengaturan.
- **FMEA:** S=7 × O=6 × D=9 = **378**.
- **Collateral damage:** Menambah audit log memperbesar `AuditLog`; gunakan payload ringkas (bulan, lpwa, ctwa, aktor). Menghapus auto-load saat mengetik mengurangi feedback; sediakan tombol "Hitung" eksplisit atau status "belum disimpan".
- **Rekomendasi:** (a) Audit setiap PUT: `tenant`, `month`, `before`, `after`, `adminIdentity`; (b) pisahkan `draftSpend` dari `savedSpend`; hanya kirim `savedSpend` ke report; tampilkan badge "Belum disimpan"; (c) optimistic lock/version pada `settings` agar dua tab tidak saling menimpa; (d) role-gate PUT (advertiser read-only sudah; pastikan hanya super admin/tenant admin yang boleh write).
- **Verifikasi:** Test endpoint: PUT → audit row berisi before/after; dua PUT bersamaan dengan version sama → salah satu 409; UI test: ketik spend tanpa simpan → laporan tidak berubah; simpan → laporan berubah dan badge hilang.

---

### M-10 — Dokumentasi operasional CAPI/landing tidak akurat (server legacy, pixel ganda, klaim keamanan script)

- **Tipe:** Proses/Dokumentasi (namun berdampak deploy & keamanan)
- **Lokasi:** `docs/META_CAPI_SETUP.md:4,24,38-40,103`; `docs/INTEGRASI_LANDING_EXTERNAL.md:40-42,227`; `src/routes/landing.route.ts:233`; `src/landing/public/external-tracker.js:115,258-268`
- **Bukti:**
  - `META_CAPI_SETUP.md:4`: "sudah dicek terhadap kondisi server produksi (`43.157.197.148`)" dan `:38-40` menyuruh `ssh -p 1403 ubuntu@43.157.197.148`. Konteks operasional sesi ini menyebut produksi aktif `43.173.11.79:1403`; host lama adalah legacy yang harus tetap stop. **[ASUMSI]** dokumen belum diperbarui; verifikasi host sebelum eksekusi.
  - `META_CAPI_SETUP.md:24,103` pixel `1382300863013984` vs `external-tracker.js:16` `1465457801784141` (lihat M-02).
  - `INTEGRASI_LANDING_EXTERNAL.md:41-42`: "Nomor WhatsApp ... mustahil disalahgunakan via link"; kode `landing.route.ts:233`: `const phone = content.whatsapp_number || query.phone || process.env.DEFAULT_WHATSAPP_PHONE || '';` — jika `whatsapp_number` kosong, `?phone=` menang.
  - `INTEGRASI_LANDING_EXTERNAL.md:227`: "Script tanpa `eval`, tanpa `fetch`, tanpa akses cross-origin"; `external-tracker.js:258-268` memakai `navigator.sendBeacon`/`fetch`; `:115` memuat `connect.facebook.net` (cross-origin).
- **Keyakinan:** TERBUKTI untuk kontradiksi kode vs dokumen; KEMUNGKINAN BESAR untuk host produksi (tidak diakses).
- **Framework:** ISO 19011 (bukti), Well-Architected Operational Excellence; keamanan operasional.
- **Akar masalah (5 Whys):** (1) Kenapa dokumen basi? Diperbarui saat insiden, tidak saat pindah server/pixel. (2) Kenapa klaim keamanan salah? Ditulis sebelum tracker memakai `fetch`/sendBeacon. (3) Kenapa tidak ada gate? Dokumentasi tidak diuji terhadap kode. (4) Kenapa penting? Operator dapat deploy ke host legacy atau salah mengira script tidak cross-origin. (5) Kenapa tidak terdeteksi? Tidak ada review docs di CI.
- **Risiko:** deploy ke server salah/legacy (outage), CAPI diarahkan ke pixel salah, ekspektasi keamanan landing salah, nomor WA dapat dialihkan via URL saat konfigurasi kosong.
- **FMEA:** S=5 × O=8 × D=5 = **200**.
- **Collateral damage:** Memperbarui dokumen tidak mengubah runtime; tetapi jika `?phone=` dihapus, landing lama yang mengandalkan parameter itu rusak (sebaiknya parameter hanya boleh untuk default tenant + feature flag).
- **Rekomendasi:** Perbarui `META_CAPI_SETUP.md` ke host produksi saat ini, satu pixel kanonis, dan cara verifikasi; perbaiki klaim keamanan `INTEGRASI...`; jika `?phone=` tidak lagi didukung, hapus dari kode dan dokumen sekaligus, atau batasi ke default tenant dengan validasi; tambahkan checklist review docs saat deploy.
- **Verifikasi:** `rg "43.157.197.148|1465457801784141|mustahil disalahgunakan|tanpa .*fetch" docs` → tidak ada; test `/cta?phone=...` pada tenant dengan `whatsapp_number` kosong → nomor dari env/tenant, bukan query (atau 400); review manual dengan operator.

---

## 5. Rencana Perbaikan Berurutan

> Prinsip: perbaikan fondasional (state/DB/contract), bukan tambal-sulam prompt/UI. Setiap fase ditutup **regression gate**: `npm run build` (backend) + `npm run build` di `packages/admin-dashboard` + suite relevan + full suite tanpa failure baru; klaim pre-existing wajib revert-and-rerun. Tidak ada dependency runtime baru.

### Fase 0 — Bekukan klaim & siapkan bukti (0,5 hari)

1. Turunkan status Fase 5 2026-11-02 dari PASS ke **PARSIAL**; catat S-10 di `docs/KNOWN_ISSUES.md` (rujuk #299/#302).
2. Buat `scripts/verify-audit-gate.mjs` (baca JSON Vitest, bandingkan path laporan) — tanpa dependency.
3. Kumpulkan baseline test: `npx vitest run tests/unit/staff-auth-and-reservation.test.ts tests/unit/staff-session-store.test.ts tests/unit/staff-trip-tracking.test.ts tests/unit/staff-trip-auto-close.test.ts tests/unit/ad-watchdog-cooldown.test.ts tests/unit/ad-attribution-ctwa-catch.test.ts`.
4. **Gate:** skrip gate menolak `fase-05.json` (6 path hilang), menerima `fase-07.json`; baseline test stabil.

### Fase 1 — Tutup kebocoran sesi & PII staf (RPN 270–392; blast radius auth)

1. **S-01:** hapus `token` dari respons login staf (`staff/auth.subroute.ts` dan `admin/auth.subroute.ts`); hapus penyimpanan token di `AuthContext`/`StaffAuthContext`; pindahkan fallback ke refresh token terpisah (hash DB, TTL 7–14 hari, rotasi). Samakan jalur login ke satu seam; baca tenant dari `staff.tenant_id`.
2. **S-02:** kunci outbox per `staffId`, TTL 24 jam, clear saat logout/401; jangan simpan `dataUrl` penuh (simpan URL media atau kompres).
3. **S-09 (sebagian):** route `recordArrival` mengembalikan `waSent`/`warning`; UI tidak mengklaim "terkirim" bila gagal; tombol kritis 44px; input login 16px.
4. **Gate:** test auth session (tidak ada token di body, cookie flags, restore/rotate, logout), test outbox, test arrival WA gagal; build backend + dashboard; uji manual PWA Android/iOS.
5. **Rollback:** revert route/context; refresh token dapat di-flag `ENABLE_STAFF_REFRESH_TOKEN=false`; tidak ada migrasi DB wajib (kecuali tabel refresh token; sediakan migrasi aditif).

### Fase 2 — Perbaiki trip/GPS & privasi lapangan (RPN 432–504)

1. **S-03:** tambah `staff_trip_sessions` (migrasi aditif) atau Redis hash + TTL; `recordTripPing` menulis ke store persisten; `runTripAutoCloseSweep` membaca DB/Redis; event `staff.trip_closed` tetap.
2. **S-06:** hapus `watchPosition` warm-up; gunakan one-shot `getCurrentPosition` saat tombol Navigasi/OTW; indikator lokasi + tombol stop; clear cache; dokumentasikan retensi.
3. **S-07:** validasi nominal di service (expected total dari katalog + ongkir), tolak negatif/NaN/di luar toleransi; override supervisor + alasan + audit.
4. **Gate:** test dua proses/`SEPARATE_WORKER=true`; test sweep dengan DB; test GPS satu tembakan; test nominal adversarial; build + full suite.
5. **Rollback:** `ENABLE_TRIP_AUTOCLOSE_SWEEP=false` (tetap ada), `ENABLE_STAFF_GPS_WARMUP=false`; migrasi tabel baru tidak boleh drop.

### Fase 3 — Integritas atribusi marketing (RPN 315–378)

1. **M-01:** panjang kode ≥10, `expires_at`, binding klik, tolak kode tak dikenal (jangan buat AdClick), atomik `updateMany`; migrasi kolom `expires_at` (nullable) + backfill.
2. **M-02:** route `/assets/external-tracker.js?tenant=` menyuntik pixel/API base dari DB; hapus default pixel; test tenant B.
3. **M-06:** origin/token pageview; validasi tenant klik; pakai `request.ip` untuk `/cta`; filter test/sandbox.
4. **M-08:** perbaiki tie-break catcher; test dua kandidat.
5. **M-09:** audit spend settings + `draft` vs `saved` + optimistic version.
6. **Gate:** test adversarial kode/expiry/catcher/beacon; cek drift Prisma (`--from-url ... --to-schema-datamodel ...` harus empty migration); build + dashboard build.
7. **Rollback:** kode lama tetap valid selama masa transisi (`expires_at` null = legacy); feature flag `TRACKING_CODE_V2=false`; jangan hapus data lama.

### Fase 4 — Tenant isolation & ghost success landing (RPN 135–336)

1. **M-03:** semua route landing/CAPI/manual memakai `tenantOf`; create memakai tenant sesi; GET/PUT/DELETE `id + tenant_id`; audit tenant.
2. **M-04:** write fail-closed 503, hapus "In-Memory Fallback Mode" untuk write produksi; UI status belum tersimpan.
3. **M-05:** hapus `tenant.findFirst()` tanpa `where`; 404; test online.
4. **M-07:** watchdog `PENDING→SENT/FAILED`, retry; brand/jam dari tenant.
5. **M-10:** perbarui dokumen server/pixel/security; verifikasi `rg`.
6. **Gate:** test multi-tenant landing/CAPI; test DB-offline write; test watchdog failure; build + full suite.
7. **Rollback:** `LANDING_WRITE_FAIL_CLOSED=false` sementara (default true setelah stabil); migrasi data landing legacy terpisah.

### Fase 5 — UX lapangan & operasional (RPN 180–200)

1. **S-05:** DTO staf minimal; supervisor-only untuk LTV/notes.
2. **S-08:** seed quick reply DB untuk chip OTW/arrival; pindahkan ambang ke `ClinicPolicy`/settings.
3. **S-09 (sisa):** outbox terpadu untuk arrival/complete/payment (idempotency key) bila disetujui; indikator offline.
4. **Gate:** test payload tidak mengandung field terlarang; test UI mobile (Chrome emulation), uji perangkat fisik; build.
5. **Rollback:** DTO dapat di-flag; outbox baru hanya untuk aksi baru.

**Urutan alasan:** Fase 1 lebih dulu karena memutus kebocoran PII/sesi dengan blast radius terbatas dan tanpa migrasi besar; Fase 2 menghilangkan klaim palsu auto-close dan privasi lokasi; Fase 3 memperbaiki uang/atribusi; Fase 4 menutup isolasi tenant/ghost success; Fase 5 polish. Jika kapasitas terbatas, minimal **Fase 1 + Fase 2 + M-01/M-03**.

---

## 6. Batasan & Asumsi

### 6.1 Batasan (tidak diuji)

- **Tidak ada uji perangkat fisik** (Android/iPhone), sehingga target sentuh, zoom iOS, safe-area, dan perilaku PWA hanya dinilai dari kelas/CSS dan kode.
- **Tidak ada akses Meta Ads/Events Manager**, sehingga dedup pixel↔CAPI, efek `event_id`, dan pixel ID live tidak dapat diverifikasi; M-02 tetap **KEMUNGKINAN BESAR**.
- **Tidak ada akses database produksi/server/WAHA**, sehingga angka klik/chat, isi `tenants.meta_pixel_id`, dan status container aktual tidak diperiksa.
- **Tidak ada eksekusi test/build** (mode baca-saja); semua temuan statis. `fase-05.json` diperiksa dengan parser JSON, bukan rerun Vitest.
- **Tidak ada pembacaan log mesin** `logs/llm-*.jsonl`; audit ini tidak menyimpulkan perilaku LLM/chat.
- **Tidak ada uji beban/race** untuk outbox, trip store, atau landing admin.
- Modul 4 dan 6 tidak diaudit; temuan yang menyentuhnya hanya titik sambung yang diperlukan.

### 6.2 Asumsi

- **[ASUMSI]** Produksi memakai `SEPARATE_WORKER=true` sesuai `docker-compose.yml:62,90`; bila server menjalankan monolith, S-03 berkurang menjadi bug TTL/dokumentasi (auto-close tetap berjalan di `app`).
- **[ASUMSI]** Caddy meng-append `X-Forwarded-For` (sesuai #252), sehingga `request.ip` adalah IP klien asli dan rate limit tidak otomatis dapat di-bypass dengan header palsu. Karena itu laporan ini **tidak** mengklaim bypass rate limit via XFF; yang disorot adalah `/cta` memakai XFF kiri untuk `ipAddress`.
- **[ASUMSI]** `tenantId` untuk sesi staf diisi dari `staff.tenant_id` (`admin.route.ts:145-149`), sehingga `tenantOf` tidak dapat dioverride header oleh staf; risiko M-03 terutama untuk jalur admin/default dan landing create.
- **[ASUMSI]** Role `advertiser` tidak memiliki scope `/api/admin/landings` (migrasi hanya meta-performance GET + ctwa-catchers + customer-service); role legacy (mis. ADMIN_CS) yang tidak punya baris `role_api_scopes` dapat lolos ke route landing. Perlu konfirmasi di staging.
- **[ASUMSI]** `isStaffSupervisorRole` sengaja mencakup `ADMIN_CS`/`ADMIN`; bila tidak, S-04/S-12 perlu penyesuaian.
- **[ASUMSI]** `META_CAPI_SETUP.md` memakai host legacy; host produksi aktif menurut konteks operasional adalah `43.173.11.79:1403`. Tidak diverifikasi via SSH.
- **[ASUMSI]** Dokumen `META_CAPI_SETUP.md` pixel `1382300863013984` adalah nilai DB saat dokumen ditulis; bila DB sudah diubah ke `1465457801784141`, M-02 turun menjadi sekadar hardcode/tenant isolation tanpa split pixel.

### 6.3 Catatan kepatuhan mandat

- **Tidak ada** perubahan kode/test/config/database; satu-satunya file yang ditulis adalah laporan ini.
- Rekomendasi tidak menambah dependency runtime; memakai Prisma, Redis yang sudah ada, `crypto`, dan komponen/hook yang sudah ada.
- Rekomendasi tidak membuat halaman baru; perbaikan landing/CAPI/watchdog berada di route/service/panel yang sudah ada.
- Temuan yang belum dieksekusi (S-01…M-10) perlu dicatat ke `docs/KNOWN_ISSUES.md` setelah persetujuan manusia; laporan ini belum mengubah `KNOWN_ISSUES.md` karena mode baca-saja.

---

## 7. Verifikasi Ringkas (Tahap 6)

| Temuan | Cara membuktikan sudah beres | Regression risk |
|---|---|---|
| S-01 | Login response tanpa `token`; cookie `HttpOnly`; refresh token rotasi; test logout 401 | PWA logout tak sengaja |
| S-02 | `localStorage` key per staf; clear saat logout; TTL 24 jam; test dua staf | Pesan gagal hilang saat logout |
| S-03 | Test dua proses/worker; query store persisten; event closed | Beban DB/Redis, latency ping |
| S-04 | Test tenant admin B → 403/tenant B; audit impersonasi | Admin lama tidak bisa masuk |
| S-05 | Snapshot payload tanpa `admin_notes`/`ltv_cache`; test supervisor | UI kehilangan field yang dipakai |
| S-06 | Mock geolocation: tanpa `watchPosition`; cache clear | Navigasi lebih lambat |
| S-07 | Test amount adversarial; override audit | Diskon/ongkir manual ditolak |
| S-08 | Ubah template DB → UI berubah; test fallback | Template DB kosong |
| S-09 | Test WA gagal → `waSent:false`; audit ukuran target | Layout composer |
| S-10 | Skrip gate menolak `fase-05.json`; laporan diperbaiki | Rilis lebih lambat |
| M-01 | Test kode tak dikenal/kedaluwarsa/collision; tidak ada AdClick palsu | Pelanggan lama komplain kode panjang |
| M-02 | Test tracker tenant B; tidak ada pixel default | Landing lama tanpa `?pixel` mati |
| M-03 | Matriks tenant A/B untuk landing/CAPI/manual; audit tenant | Tooling admin `?tenantId=` rusak |
| M-04 | Mock DB reject → 503; UI tidak klaim sukses | Editing saat DB down terblokir |
| M-05 | Test online `/promo/typo` → 404 | Landing legacy tanpa slug |
| M-06 | Test origin/token; IP `/cta` = `request.ip`; fake views tidak memicu alert | Landing eksternal lama ditolak |
| M-07 | Test `notifyAlert` reject → FAILED + retry | Duplikasi alert |
| M-08 | Test dua catcher; matched menang | Atribusi historis berubah |
| M-09 | Test audit spend; UI draft vs saved; 409 version | Dua tab admin |
| M-10 | `rg` dokumen; test `?phone=`; review operator | Tidak ada runtime |

---

*Laporan ini disusun tanpa mengubah sistem. Semua rekomendasi memerlukan persetujuan manusia sebelum eksekusi, sesuai AGENTS.md (Human-in-the-Loop Confirmation Gate).*
