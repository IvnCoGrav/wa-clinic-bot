# Known Issues & Tech Debt

Catatan temuan yang sengaja dipisah dari fitur aktif, supaya tidak hilang dan
tidak disalahartikan sebagai bug dari perubahan terbaru.

---

## 1. [Migrations] Enum ordering `FollowUpStatus` mematahkan `migrate diff --from-migrations`

- **Status:** open (tech debt), **pre-existing** (bukan dari perubahan AI Router).
- **Ditemukan:** 2026-08-02, saat verifikasi drift migrasi `ai_router_evaluations`.
- **Gejala:** shadow replay migration dari scratch gagal di `20260801000000_add_failed_followup_status`:

  ```
  Migration `20260801000000_add_failed_followup_status` failed to apply cleanly to the shadow database.
  ERROR: type "FollowUpStatus" does not exist
  ```

- **Akibat:** drift-detection berbasis full migration chain (`--from-migrations`) menjadi **blind spot**.
  Developer lain yang mencoba `prisma migrate diff --from-migrations` akan gagal dan berisiko salah
  kira itu masalah dari perubahan mereka sendiri.
- **Workaround (dipakai sekarang):** diff terhadap DB asli, bukan replay migration:
  ```bash
  npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
  # output harus "-- This is an empty migration." (zero drift)
  ```
- **Akar masalah (diperbarui 2026-08-14):** BUKAN sekadar urutan enum — **baseline migrasi tidak lengkap**.
  Audit `prisma/migrations` menunjukkan:
  - `20260721070211_init` hanya membuat 3 tabel (`customers`, `conversations`, `messages`) + 2 enum.
  - Sebagian tabel SUDAH dibuat migrasi existing (knowledge_chunks, reservations, follow_up_templates,
    delivery_tiers, clinic_services, tenant_persona, tenant_ai_config, children, ai_router_evaluations,
    waba_templates, landing_pages, ai_evaluations, daily_report_logs) — tapi sejumlah tabel & enum inti
    TIDAK pernah dibuat di migrasi mana pun: `follow_ups` (+ enum `FollowUpType`/`FollowUpStatus`),
    `tenants`, `audit_logs`, `ad_clicks`, `legacy_staging`, `medical_faq_staging`, `general_faq_staging`,
    `llm_audit_logs`, dan enum `StagingStatus`/`LandingType`/`StagingReviewStatus`.
  - Lebih lanjut: banyak migrasi menengah melakukan `ALTER TABLE ... ADD COLUMN` pada tabel yang
    TIDAK pernah dibuat di chain (mis. `add_waba_provider` menambah kolom ke `tenants`), karena
    proyek memakai `db push` di masa awal lalu migrasi dimulai belakangan tanpa baseline penuh.
  - Diverifikasi 2026-08-14 (Postgres lokal via Docker): replay `--from-migrations` gagal di
    `20260801000000` ("FollowUpStatus does not exist"); setelah enum ditambal, gagal beruntun di
    `add_waba_provider` ("WhatsappProvider already exists") dan seterusnya — konfirmasi masalah
    sistemik, bukan satu migrasi.
- **Mengapa tidak ditambal begitu saja:** membuat baseline/squash migrasi yang aman memerlukan
  modifikasi banyak migrasi existing menjadi idempotent (CREATE TYPE/ADD COLUMN dengan guard) ATAU
  squash total — keduanya mengubah checksum & berisiko pada `migrate deploy` di environment yang
  sudah punya semua tabel (pola `already exists`, sama seperti masalah `children` di #2). Perbaikan
  hanya layak dilakukan sebagai proyek terpisah dengan rencana per-env (migrate resolve / db push)
  dan pengujian replay di staging.
- **Workaround tetap:** diff terhadap DB asli (`--from-url`), bukan replay migration.
- **Fix yang disarankan (proyek terpisah):** (a) squash seluruh schema menjadi satu baseline baru
  + tandai semua migrasi lama sebagai applied di tiap env, ATAU (b) jadikan setiap migrasi existing
  idempotent (CREATE TYPE via DO block, CREATE TABLE/ADD COLUMN/INDEX dengan IF NOT EXISTS) lalu
  verifikasi `migrate diff --from-migrations` menghasilkan empty migration di shadow DB.
  Jangan lakukan tanpa Postgres lokal aktif & rencana per-env.

---

## 2. [Migrations] `add_children` tercatat failed (`finished_at = NULL`) di DB lokal

- **Status:** resolved di DB lokal via `migrate resolve --applied 20260802000000_add_children`.
- **Risiko saat deploy ke environment baru:** jika tabel `children` sudah ada tapi migration belum
  tercatat applied, `migrate deploy` gagal dengan `relation "children" already exists`.
- **Runbook lengkap:** lihat `README.md` bagian **"Deployment & Runbook Migration"** dan comment
  header di `prisma/migrations/20260802000000_add_children/migration.sql`.

---

## 3. [Ops] `prisma generate --no-engine` mengunci client ke URL `prisma://` (Accelerate)

- **Status:** resolved (2026-08-02), tercatat sebagai pelajaran.
- **Gejala:** setelah `prisma generate --no-engine` (workaround EPERM dll yang terkunci), semua
  `new PrismaClient()` gagal dengan:
  ```
  P6001: the URL must start with the protocol `prisma://`
  ```
  Client `--no-engine` adalah varian **Accelerate-only**, bukan sekadar "types tanpa binary".
- **Akibat:** kalau app di-restart dalam kondisi ini, seluruh operasi DB mati (silent jika error
  tertangkap try-catch). Test tetap hijau karena mock `tests/setup.ts`.
- **Fix:** matikan proses yang lock `query_engine-windows.dll.node` (dev server, prisma studio),
  lalu jalankan `prisma generate` penuh (tanpa `--no-engine`); verifikasi runtime error berubah dari
  `P6001` menjadi `P2021`/`P1001` (error koneksi normal) sebelum restart app.

## 4. [Build] Artefak kompilasi `.js` nyasar di `src/` menimpa `.ts` pada resolusi module Vite

- **Status:** resolved (2026-08-09).
- **Gejala:** `injectTracking()` (events onload/click landing) tidak pernah ter-inject walaupun
  kode `src/services/html-sanitizer.ts` sudah punya param `events`. `TenantHtmlService.injectTracking.toString()`
  menampilkan signature lama `(htmlString, metaPixelId, nonce, config)` tanpa `events`.
- **Akar masalah:** file kompilasi nyasar `src/services/tenant-html.service.js` (berisi class lama
  inline, hasil tsc ke direktori salah) ter-tack. Vite/tsx mengutamakan ekstensi `.js` sebelum `.ts`
  dalam resolusi, sehingga re-export `tenant-html.service.ts` terselesaikan ke file `.js` stale
  yang shadowing source aslinya.
- **Akibat:** test integration landing (events onload/click) merah secara membingungkan; behavior
  runtime di production ikut salah (event tracking tidak jalan).
- **Fix:** hapus artefak `.js` dari `src/` (`git rm src/services/tenant-html.service.js`) dan
  jangan commit hasil kompilasi ke direktori source. Verifikasi: `npx vitest run tests/integration/landing-serving.test.ts`.
- **Pelajaran:** grep file `*.js` di `src/` sebelum debug perilaku aneh; periksa juga
  `dist/` untuk sumber kebenaran perilaku yang dipakai di test.

---

## 5. [Queue] Stale state / race condition pesan beruntun — FIXED via fresh-fetch di worker

- **Status:** resolved (2026-08-10), tercatat sebagai risiko "Konkurensi & Pengolahan Paralel" PRD yang kini tervalidasi.
- **Gejala:** saat customer mengirim 2 pesan afirmasi beruntun dalam waktu singkat (~19 detik),
  pesan kedua diproses seolah-olah state percakapan belum berubah dari pesan pertama — bot
  mengulang balasan identik, alih-alih lanjut ke langkah berikutnya.
- **Akar masalah:** `webhook.route.ts` & `waba-webhook.route.ts` memasukkan **snapshot**
  `customer`/`conversation` (di-fetch di awal webhook) ke dalam payload queue. Worker BullMQ
  maupun in-memory fallback memproses `job.data` apa adanya tanpa query ulang, sehingga job kedua
  yang di-enqueue sebelum job pertama selesai menulis state baru memakai `current_state` basi.
- **Fix:** payload queue kini hanya membawa identifier (`customerId` + fallback `phone` +
  `incomingMessage`). Worker me-refresh `customer` (via `getCustomerById`, fallback
  `getOrCreateCustomer`) dan `conversation` (via `getOrCreateConversation`) dari DB tepat
  sebelum `stateMachine.processMessage()`. Fresh-fetch gagal total → skip + log `[QUEUE SKIP]`
  (bukan fallback snapshot basi). FIFO per-customer (concurrency 1 per shard, memory queue per
  `phone`) tidak berubah — re-fetch terjadi di awal tiap job, tetap urut sesuai antrian.
- **Verifikasi:** `tests/unit/queue.test.ts` (test #4: 2 afirmasi beruntun → `['INITIAL',
  'AWAITING_INTEREST']`), `tests/integration/queue-stale-state.test.ts` (2 webhook beruntun,
  state akhir tersimpan `AWAITING_INTEREST`). Full suite 752 test hijau.

---

## 6. [Behavior] Jawaban FAQ treatment dulunya berbunyi seperti "membaca katalog", bukan rekomendasi personal

- **Status:** resolved (2026-08-11) — lihat juga commit "FAQ answer rekomendasi personal + idle greeting".
- **Gejala:** saat customer bertanya treatment (misal "pijat ibu hamil apa ya"), bot membalas
  dengan daftar bullet "Berikut treatment yang relevan... • *Nama*" — terdengar kaku seperti
  membacakan katalog, dan rawan memuat detail (harga, durasi) yang tidak ada di data.
- **Akar masalah:** jalur FAQ treatment meng-inject konten katalog yang sudah diformat jadi
  "Pertanyaan:/Jawaban:" dan menyuruh LLM membacakannya verbatim; `fallbackFaqResponse` juga
  mengembalikan chunk apa adanya. Konten chunk menentukan gaya jawaban.
- **Fix:**
  1. `treatment-catalog.service.ts`: tambah `formatCatalogData()` (blok `[DATA TREATMENT]`
     Nama/Kategori/Usia/Durasi/Deskripsi — **tanpa harga**) dan `searchCatalogItems()` yang
     mengembalikan data mentah `ClinicServiceItem[]`.
  2. `interest.ts`: fallback katalog kini meng-inject `formatCatalogData` sebagai **konteks
     terstruktur**, bukan jawaban jadi.
  3. `generator.ts`: system prompt `generateFaqResponse` ditambah instruksi **nada rekomendasi
     personal** + aturan **anti-halusinasi** (hanya fakta dari Referensi, sebut semua opsi relevan,
     jujur saat tidak tersedia, dilarang mengarang harga/durasi/usia).
  4. `generator.ts` `fallbackFaqResponse`: dibangun ulang jadi rekomendasi deterministik dari data
     `[DATA TREATMENT]` (satu opsi → rekomendasi + tawaran bantu pilih; multi opsi → sebut semuanya;
     no-match → jujur tidak tersedia).
- **Verifikasi:** `tests/unit/faq-grounding.test.ts` (6 test: single/multi treatment grounded,
  context tanpa harga, no-data jujur, format blok tanpa bullet). Full unit suite 665 test hijau.
- **Catatan harga:** harga TETAP tidak dikelola di context FAQ treatment; pertanyaan harga lewat
  intent `ask_price` (mapping ke faq_question) dijawab tanpa menyebut nominal jika harga tidak ada
  di Referensi — arahkan ke tim bila perlu.

---

## 7. [Queue] Burst coalescing: balasan ditunda window debounce saat aktif

- **Status:** by-design (2026-08-11), fitur off secara default (`BURST_COALESCE_MS=0`).
- **Gejala (saat diaktifkan, mis. `BURST_COALESCE_MS=5000`):** pesan text tunggal dari customer
  mendapat balasan **tertunda hingga window habis** (≤5 detik), karena semua pesan text di-buffer
  dulu untuk digabung jadi 1 balasan. Ini bisa terasa lambat untuk sapaan/pertanyaan cepat.
- **Alasan:** trade-off yang dipilih user — menggabung burst chat (1 LLM call + 1 balasan untuk
  banyak pesan) lebih penting daripada respons secepat kilat per pesan tunggal.
- **Batasan yang sengaja:** hanya pesan **text** dan hanya state open-ended (`INITIAL`,
  `AWAITING_INTEREST`, `COMPLETED`). Lokasi/media & state menunggu input spesifik (`AWAITING_LOCATION`,
  `LOCATION_CONFIRMED`, `RESERVATION_SENT`, `HUMAN_HANDLING`) TIDAK di-merge → tidak ada delay.
- **Catatan penting:** pesan asli tetap di-log realtime saat diterima (Live Chat panel tidak tertunda),
  hanya **balasan bot** yang ditunda window. Idempotency per `wa_message_id` tetap aktif sejak pesan
  diterima (bukan saat flush).
- **Tuning:** sesuaikan `BURST_COALESCE_MS` (lebih kecil = lebih responsif, lebih besar = penggabungan
  lebih agresif) dan `BURST_COALESCE_MAX_MESSAGES` (batas pesan per batch, default 10).
- **Verifikasi:** `tests/unit/burst-coalesce.test.ts` (6 test: off→passthrough, 3 pesan→1 job,
  text→location flush, state non-open-ended tidak merge, batch lintas window, max-messages).
  Full suite 796 test hijau.

---

## 8. [Ops] Token CAPI tenant invalid (code 190) + Redis `noeviction` belum ter-deploy

- **Status:** open (ops) — butuh aksi di server, bukan bug kode.
- **Gejala:** request Meta CAPI tenant gagal silent dengan `error.code 190` (invalid OAuth token);
  token tersimpan di DB sudah di-revoke, fallback env `FB_CAPI_ACCESS_TOKEN` juga belum valid.
  Sejak 2026-08-11, log menunjukkan prefix termask token saat decrypt gagal (mis. `EAA…abcd`)
  untuk memudahkan pengecekan.
- **Fix:**
  1. Rotasi token via Admin API `PATCH /api/admin/capi-config` (dashboard → Settings → CAPI) dengan token yang masih aktif; setelah itu warning `[CAPI WARNING]` hilang dari log.
  2. `docker-compose.yml` Redis memakai `--maxmemory-policy noeviction` — terapkan lewat deploy berikutnya (jangan `allkeys-lru`, antrian/kunci bisa ter-evict saat memory penuh).
- **Verifikasi pasca-fix:** `docker stats` saat jam ramai (RSS Redis stabil, tidak ada evict), log tanpa `[CAPI WARNING]`/code 190.

---

## 9. [UI/Safari] iOS Safari Keyboard Accessory Bar (`∧` `∨` `✓`) di Live Chat

- **Status:** open (iOS platform limitation / web limitation).
- **Ditemukan:** 2026-08-19, saat pengujian Live Chat Monitor di iPhone Safari / PWA.
- **Gejala:** Saat admin mengetuk kolom input pesan di Live Chat pada iPhone, bilah abu-abu navigasi keyboard native iOS (`∧` Previous, `∨` Next, dan `✓` Done) muncul di atas keyboard virtual.
- **Akar masalah:** Bilah ini adalah komponen native sistem operasi iOS (`UITextInputAssistantItem`), bukan elemen DOM/CSS web. WebKit di iOS Safari secara otomatis memunculkan bilah ini pada *seluruh* elemen yang menerima input teks (`<textarea>`, `<input>`, maupun `contentEditable`) tanpa ada API web standar untuk menyembunyikannya dari browser.
- **Mitigasi yang sudah diterapkan (Strategi A):**
  1. Menggunakan `contentEditable="plaintext-only"` dan meng-unmount form inputs panel daftar dari DOM saat mode chat mobile aktif.
  2. Integrasi **Visual Viewport API** (`window.visualViewport`) agar tampilan pesan melakukan auto-scroll halus saat keyboard muncul sehingga percakapan terakhir tidak tertutup.

---

## 10. [Live Chat] Sinkronisasi Presensi WhatsApp (Read Receipts, Typing Indicator, & Status Delivery)

- **Status:** open (backlog / pending deep WAHA engine verification).
- **Ditemukan:** 2026-08-19, saat pengujian Live Chat Monitor terhadap WhatsApp real-time.
- **Gejala & Ruang Lingkup Masalah:**
  1. **Read Receipt (*Centang Biru*) on Typing:** Sinyal penandaan pesan telah dibaca (`sendSeen`) saat admin mulai mengetik di Live Chat belum terpicu konsisten ke HP WhatsApp pelanggan.
  2. **Typing Indicator (*"sedang mengetik..."*):** Status presensi pengetikan (`startTyping` / `stopTyping`) di header WhatsApp customer saat admin mengetik balasan di dashboard belum aktif secara stabil.
  3. **Status Centang Pengiriman (*Sent `✓`*, *Delivered `✓✓` abu-abu*, *Read `✓✓` biru*):** Pembaruan status centang pesan keluar di Live Chat monitor masih tertahan di status `sent` (`✓`) dan belum bertransisi penuh secara dinamis saat pesan diterima/dibaca di HP pelanggan.
- **Akar Masalah & Keterbatasan Engine Saat Ini:**
  - Engine backend dan antarmuka web dashboard telah menyediakan routing (`POST /api/admin/live-chat/conversations/:id/typing`), debouncer pengetikan, handler `message.ack`, serta status UI centang.
  - Namun, aktivasi sinyal presensi (`/api/startTyping`, `/api/stopTyping`, `/api/sendSeen`) dan penerimaan webhook `message.ack` sangat bergantung pada konfigurasi internal driver WAHA (`devlikeapro/waha:noweb-2026.7.2` / WhatsApp Web multi-device socket).
  - Normalisasi format JID target (`@c.us` vs `@s.whatsapp.net` vs `@lid`) dan event subscription WAHA (`WAHA_HOOK_EVENTS` / `message.ack` payload format) memerlukan audit dan kalibrasi langsung pada instance WAHA live di server.
- **Rencana Tindak Lanjut (Next Steps / Roadmap):**
  1. Melakukan pengujian langsung (*live diagnostic probe*) ke endpoint container WAHA (`/api/sendSeen`, `/api/startTyping`, `/api/stopTyping`).
  2. Memeriksa konfigurasi webhook event WAHA pada `docker-compose.yml` untuk memastikan event `message.ack` diaktifkan secara eksplisit pada sesi WAHA.
  3. Menyempurnakan pencocokan ID pesan (`wa_message_id`) lintas versi driver (NOWEB vs GOWS) untuk keakuratan transisi centang `✓` $\rightarrow$ `✓✓` abu $\rightarrow$ `✓✓` biru.

---

## 12. [Reservations] Reservasi gagal capture saat Human Handling & stale guard (Siska #777) — FIXED 2026-08-22

- **Status:** fixed (2026-08-22).
- **Gejala:** Reservasi nomor 777 atas nama Siska tidak masuk `reservations` meski customer sudah kirim form lengkap. Di `messages` ada, di kalender/`/api/admin/reservations` kosong. Kasus serupa bisa terjadi pada form lain saat CS sudah take-over.
- **Akar masalah:**
  1. `webhook.route.ts` `HUMAN_HANDLING_ACTIVE_SILENT` (grace 30s / `ENABLE_WAHA_HOLD_LABEL=false` / explicit guard) langsung `return` tanpa `enqueue` — `human.ts` watcher tidak reachable.
  2. `STALE MESSAGE GUARD` 180s drop form saat reconnect/QR burst.
  3. `interest.ts` catch DB error kosong → reply sukses palsu.
- **Fix:** stale guard bypass untuk `isReservationFormMessage`, 3 early-return human handling kini inline `prisma.reservation.create` + `reservationLifecycleService` best-effort (idempoten 24h), `interest.ts` catch log + update nama + eskalasi jujur. Verif `npx vitest run 1495 passed`.
- **Sisa risiko:** tenant yang `landing_domain` belum diisi tetap fallback `kalababyspa.online/reservasionline` (by design). Idempoten `treatment_detail` exact match bisa skip duplikat legit jika customer kirim 2 treatment identik <24h — monitor via `AuditLog`.

## 13. [Attribution] AdClick `landingUrl` tersimpan `app.kalababyspa/cta` bukan URL PageView asli (Aisyah 929) — FIXED 2026-08-22

- **Status:** fixed (storage), self-heal untuk data lama tetap jalan.
- **Gejala:** CAPI queue / `ad_clicks.landingUrl` untuk Aisyah 929 tampil `https://app.kalababyspa.online/cta?...` padahal iklan landing `https://kalababyspa.online/reservasionline?...`. `event_source_url` ke Meta jadi `app.*` → atribusi kurang presisi.
- **Akar masalah:** `external-tracker.js` tidak terpasang di LP eksternal / CTA `href` bukan `/cta` / race 250ms → `GET /cta` tanpa `landing_url` → `landing.route.ts` fallback ke `x-forwarded-host` (`app.*`). Self-heal `resolveCanonicalLandingUrl` (strip `app.`, map `/cta → /reservasionline`) sudah ada di `capi.service.ts` + `GET /capi-queue` tapi baru heal saat CAPI send/queue view, raw DB tetap `app.*` sampai itu.
- **Fix:** `landing.route.ts` kanonikalisasi **sebelum simpan** via `resolveCanonicalLandingUrl(fullLandingUrl, tenantDomain)` + warn `CTA LANDING_URL MISSING`. Data baru langsung `kalababyspa.online/reservasionline`. Data lama tetap heal on-read.
- **Tindak lanjut:** pastikan setiap LP eksternal load `/assets/external-tracker.js?pixel=xxx` dan CTA `href` mengarah `…/cta` agar `landing_url=window.location.href` selalu terkirim. Cek `Tenant.landing_domain` terisi di Settings.

---

## 11. [Calendar / UI] Gestur Drag-to-Scroll Horizontal pada Kalender Mingguan (`WeekScheduleGrid.tsx`)

- **Status:** open (investigasi arsitektur gesture sentuh / pending dedicated touch-recognizer).
- **Ditemukan:** 2026-08-21, saat pengujian interaksi 2D panning tabel kalender mingguan di perangkat touchscreen dan desktop.
- **Gejala:** Interaksi drag-to-scroll horizontal (menggeser kolom hari ke kanan/kiri) terkadang tersendat atau tidak merespons secara mulus, terutama saat terjadi konflik antara scrolling vertikal halaman/kontainer dan sumbu horizontal tabel.
- **Akar Masalah:**
  - Browser mobile secara native melakukan *axis locking* saat mendeteksi sentuhan awal (jika gerakan sentuhan 5px pertama condong vertikal, browser mengunci pergerakan ke sumbu Y dan membatalkan event pointer horizontal).
  - Penambahan pointer capture (`container.setPointerCapture`) dan CSS `touch-action: pan-x pan-y` membantu di desktop mouse drag, namun pada browser mobile tertentu (WebKit iOS / Chromium Android) native scroll engine masih memotong event pointer sebelum pointermove selesai dieksekusi.
- **Rencana Tindak Lanjut (Next Steps / Roadmap):**
  - Mengimplementasikan dedicated gesture engine berbasis custom touch delta tracker (menyimpan posisi `touchstart` dan menghitung akumulasi vektor `deltaX` & `deltaY` secara manual dengan `preventDefault` pada touchmove saat threshold drag terpenuhi).
  - Menambahkan toggle tombol navigasi horizontal manual (misal: panah geser hari di header kalender) sebagai alternatif cepat bagi pengguna smartphone.
