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

- **Status:** fixed (2026-08-22), recovery mass 30 reservasi 14 hari terakhir.
- **Gejala:** Reservasi #777 (Siska, 6285106962777) form lengkap `Berikut list untuk reservasi...` masuk ke `messages` (2026-08-22 00:42:12), `conversations` status `HUMAN_HANDLING` (CS sudah reply 2026-08-22 01:13:31), tapi `reservations` **0 rows**. Customer cuma dapat balasan manual CS, tidak ada record otomatis.
- **Akar masalah (3 silent-drop berlapis):**
  1. **Human Handling short-circuit** `webhook.route.ts:732-823`: 3 jalur early-return `HUMAN_HANDLING_ACTIVE_SILENT` (grace 30s / `ENABLE_WAHA_HOLD_LABEL=false` default / explicit guard) langsung `logMessage` + `return` tanpa `enqueue` → watcher `human.ts:41` (`isReservationFormMessage` → `parseReservationText` → `prisma.reservation.create`) tidak pernah reachable.
  2. **Stale guard 180s** `webhook.route.ts:407`: WAHA reconnect/QR burst bikin `payload.timestamp` telat >180s → `IGNORED_STALE_MESSAGE` (log saja, skip state machine) — form ikut ter-drop.
  3. **Swallow DB error** `interest.ts:93`: `catch (dbErr) {}` kosong → reply sukses palsu `Baik Bunda, data reservasi sudah kami terima` padahal `prisma.reservation.create` throw `P6001`/`P1001` (client `--no-engine` / offline). Data hilang tanpa jejak.
- **Fix dilakukan (commit `4ec5a6e`, live `6b35353→4ec5a6e`):**
  - `webhook.route.ts:407-430`: Stale guard bypass jika `isReservationFormMessage(payload.body)` true → log `STALE GUARD BYPASS` lanjut capture.
  - `webhook.route.ts:741-882`: 3 early-return human handling (grace / `LABEL_SYNC_DISABLED` / explicit) kini **inline auto-capture** sebelum `logMessage` + silent return: `isReservationFormMessage` → `parseReservationText` → `findFirst 24h treatment_detail` → `prisma.reservation.create` + `reservationLifecycleService.onReservationCreated` (follow-up + `child.service.upsertChildrenFromBabies` + labels) + **`fireCapiEvent InitiateCheckout`** (`source: WEBHOOK_HUMAN_*_CAPTURE`). Idempoten 24h, best-effort, tetap eskalasi hidden jika duplikat/parse fail.
  - `human.ts:73`: Background watcher juga fire `InitiateCheckout` CAPI.
  - `interest.ts:93-112`: Catch DB tidak lagi swallow; `console.error`, update nama `Bunda {nama} {kecamatan}` tetap jalan, eskalasi dengan reply jujur `gangguan penyimpanan — tim cek manual` (bukan sukses palsu).
- **Recovery mass (script `recover_all.js` via `dist/utils/reservation-text-parser.js` + `dist/db/client.js`):**
  - Scan `messages INBOUND` 14 hari (1358 messages) → 38 kandidat form → **30 reservasi baru** dibuat idempoten 24h `treatment_detail` + `reservationLifecycle` + `InitiateCheckout` CAPI (`CAPI SUCCESS` di log). Contoh: `6289667285350 Hansen 1th`, `6281224301155 Althaf`, `6287855873973 zayyan 1.5bln`. Total `reservations` DB: 122 (sebelum 92). Siska #777 manual recover via `POST /api/admin/reservation/parse` → `bfc3020b` + `children.gifton 13bln→12mo` + `CAPI SUCCESS` (organic).
- **Kenapa cara ini:** Seluruh pipeline capture (webhook → human.ts → interest.ts) kini **defense-in-depth**; siapa pun jalur yang lewat, form tidak bisa jatuh ke silent-drop. CAPI `InitiateCheckout` dipastikan fire di setiap titik capture agar Meta tidak lose attribution.

### 15.2 Aisyah 929 (AdClick `landingUrl` tersimpan `app.kalababyspa/cta` bukan URL PageView)

- **Status:** fixed (storage + self-heal), data lama di-heal.
- **Gejala:** `ad_clicks` id `cmt3l5r1s00026xfn0kpkt928` (Aisyah 6285812506929, created 2026-08-21 23:33:56) `landingUrl=https://app.kalababyspa.online/cta?divisi=iklan-utama` padahal iklan landing `https://kalababyspa.online/reservasionline?...`. `event_source_url` CAPI jadi `app.*` → atribusi Meta tidak presisi.
- **Akar masalah:** `external-tracker.js:121-146` wajib bridge `window.location.href → /cta?landing_url=...` — jika LP eksternal tidak pasang script / CTA `href` bukan `/cta` / race 250ms klik sebelum `MutationObserver` scan, `GET /cta` tiba **tanpa `landing_url`** → `landing.route.ts:164` fallback ke `x-forwarded-host` (`app.*`). `resolveCanonicalLandingUrl` (`capi.service.ts:103`) sudah self-heal di `GET /capi-queue` + CAPI send, tapi raw DB tetap `app.*` sebelum queue dibuka.
- **Fix (commit `4ec5a6e`, live):**
  - `landing.route.ts:185-198`: Kanonikalisasi **sebelum simpan** `AdClick` via `resolveCanonicalLandingUrl(fullLandingUrl, tenantDomain)` + warn `CTA LANDING_URL MISSING`. Data baru langsung `kalababyspa.online/reservasionline?fbclid...` (strip `app.`, map `/cta → /reservasionline`, preserve `fbclid/utm_*`, delete `landing_url/slug/p/msg/divisi`). Tenant-aware `Tenant.landing_domain` (`schema.prisma:539`), fallback `kalababyspa.online/reservasionline` bila `landing_domain=""`.
  - Heal existing: `UPDATE ad_clicks SET "landingUrl"='https://kalababyspa.online/reservasionline' WHERE "landingUrl" LIKE '%app.kalababyspa.online/cta%'` → 1 row updated. `GET /api/admin/capi-queue` `reservations.subroute.ts:1141` self-heal konsisten.
- **Tindak lanjut wajib:** Setiap LP eksternal **harus** load `/assets/external-tracker.js?pixel=xxx` dan CTA `href` mengarah `…/cta` agar `landing_url=window.location.href` selalu terkirim. `Tenant.landing_domain` wajib diisi di Settings (SAAS-ready).

### 15.3 JSON/Formatting cleanup (catatan teknis)

- Selama recovery & fix, beberapa file `*.ts` & `*.js` di Docker container `/tmp` & `/app/dist` tidak tersinkron karena multi-stage build `Dockerfile` copy `dist` saja (bukan `src/scripts/*.ts`). Script recovery `recover_all.js` di-copy manual `docker cp` ke container lalu `node /tmp/recover_all.js` — ini workaround, bukan pola ideal.
- Payload raw `payload.json` Siska di-copy manual, parse via `node run2.js` hit `POST /api/admin/reservation/parse` (header `x-api-key` bukan `x-admin-api-key` — middleware `admin.route.ts:72`). Harusnya gunakan CLI `npm run chat` atau script terintegrasi.
- `prisma` query manual via `psql` butuh escaping quote yang menyakitkan (`SELECT "landingUrl" FROM ad_clicks WHERE "landingUrl" LIKE '%app.kala%'`). Harus gunakan Prisma Client atau query builder untuk konsistensi.
- **Perbaikan kedepan:** Tambah script `recover-lost-reservations.ts` ke `package.json` scripts (`npm run recover:reservations -- --dry-run --days=14`) agar run via `docker compose exec app npm run recover:reservations` tanpa manual `docker cp`. Standarisasi header auth `x-api-key` di semua admin endpoint.

---

## 11. [Calendar / UI] Gestur Drag-to-Scroll Horizontal pada Kalender Mingguan (`WeekScheduleGrid.tsx`)

- **Status:** open (investigasi arsitektur gesture sentuh / pending dedicated touch-recognizer).
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

- **Status:** fixed (2026-08-22), recovery mass 30 reservasi 14 hari terakhir.
- **Gejala:** Reservasi #777 (Siska, 6285106962777) form lengkap `Berikut list untuk reservasi...` masuk ke `messages` (2026-08-22 00:42:12), `conversations` status `HUMAN_HANDLING` (CS sudah reply 2026-08-22 01:13:31), tapi `reservations` **0 rows**. Customer cuma dapat balasan manual CS, tidak ada record otomatis.
- **Akar masalah (3 silent-drop berlapis):**
  1. **Human Handling short-circuit** `webhook.route.ts:732-823`: 3 jalur early-return `HUMAN_HANDLING_ACTIVE_SILENT` (grace 30s / `ENABLE_WAHA_HOLD_LABEL=false` default / explicit guard) langsung `logMessage` + `return` tanpa `enqueue` → watcher `human.ts:41` (`isReservationFormMessage` → `parseReservationText` → `prisma.reservation.create`) tidak pernah reachable.
  2. **Stale guard 180s** `webhook.route.ts:407`: WAHA reconnect/QR burst bikin `payload.timestamp` telat >180s → `IGNORED_STALE_MESSAGE` (log saja, skip state machine) — form ikut ter-drop.
  3. **Swallow DB error** `interest.ts:93`: `catch (dbErr) {}` kosong → reply sukses palsu `Baik Bunda, data reservasi sudah kami terima` padahal `prisma.reservation.create` throw `P6001`/`P1001` (client `--no-engine` / offline). Data hilang tanpa jejak.
- **Fix dilakukan (commit `4ec5a6e`, live `6b35353→4ec5a6e`):**
  - `webhook.route.ts:407-430`: Stale guard bypass jika `isReservationFormMessage(payload.body)` true → log `STALE GUARD BYPASS` lanjut capture.
  - `webhook.route.ts:741-882`: 3 early-return human handling (grace / `LABEL_SYNC_DISABLED` / explicit) kini **inline auto-capture** sebelum `logMessage` + silent return: `isReservationFormMessage` → `parseReservationText` → `findFirst 24h treatment_detail` → `prisma.reservation.create` + `reservationLifecycleService.onReservationCreated` (follow-up + `child.service.upsertChildrenFromBabies` + labels) + **`fireCapiEvent InitiateCheckout`** (`source: WEBHOOK_HUMAN_*_CAPTURE`). Idempoten 24h, best-effort, tetap eskalasi hidden jika duplikat/parse fail.
  - `human.ts:73`: Background watcher juga fire `InitiateCheckout` CAPI.
  - `interest.ts:93-112`: Catch DB tidak lagi swallow; `console.error`, update nama `Bunda {nama} {kecamatan}` tetap jalan, eskalasi dengan reply jujur `gangguan penyimpanan — tim cek manual` (bukan sukses palsu).
- **Recovery mass (script `recover_all.js` via `dist/utils/reservation-text-parser.js` + `dist/db/client.js`):**
  - Scan `messages INBOUND` 14 hari (1358 messages) → 38 kandidat form → **30 reservasi baru** dibuat idempoten 24h `treatment_detail` + `reservationLifecycle` + `InitiateCheckout` CAPI (`CAPI SUCCESS` di log). Contoh: `6289667285350 Hansen 1th`, `6281224301155 Althaf`, `6287855873973 zayyan 1.5bln`. Total `reservations` DB: 122 (sebelum 92). Siska #777 manual recover via `POST /api/admin/reservation/parse` → `bfc3020b` + `children.gifton 13bln→12mo` + `CAPI SUCCESS` (organic).
- **Kenapa cara ini:** Seluruh pipeline capture (webhook → human.ts → interest.ts) kini **defense-in-depth**; siapa pun jalur yang lewat, form tidak bisa jatuh ke silent-drop. CAPI `InitiateCheckout` dipastikan fire di setiap titik capture agar Meta tidak lose attribution.

### 15.2 Aisyah 929 (AdClick `landingUrl` tersimpan `app.kalababyspa/cta` bukan URL PageView)

- **Status:** fixed (storage + self-heal), data lama di-heal.
- **Gejala:** `ad_clicks` id `cmt3l5r1s00026xfn0kpkt928` (Aisyah 6285812506929, created 2026-08-21 23:33:56) `landingUrl=https://app.kalababyspa.online/cta?divisi=iklan-utama` padahal iklan landing `https://kalababyspa.online/reservasionline?...`. `event_source_url` CAPI jadi `app.*` → atribusi Meta tidak presisi.
- **Akar masalah:** `external-tracker.js:121-146` wajib bridge `window.location.href → /cta?landing_url=...` — jika LP eksternal tidak pasang script / CTA `href` bukan `/cta` / race 250ms klik sebelum `MutationObserver` scan, `GET /cta` tiba **tanpa `landing_url`** → `landing.route.ts:164` fallback ke `x-forwarded-host` (`app.*`). `resolveCanonicalLandingUrl` (`capi.service.ts:103`) sudah self-heal di `GET /capi-queue` + CAPI send, tapi raw DB tetap `app.*` sebelum queue dibuka.
- **Fix (commit `4ec5a6e`, live):**
  - `landing.route.ts:185-198`: Kanonikalisasi **sebelum simpan** `AdClick` via `resolveCanonicalLandingUrl(fullLandingUrl, tenantDomain)` + warn `CTA LANDING_URL MISSING`. Data baru langsung `kalababyspa.online/reservasionline?fbclid...` (strip `app.`, map `/cta → /reservasionline`, preserve `fbclid/utm_*`, delete `landing_url/slug/p/msg/divisi`). Tenant-aware `Tenant.landing_domain` (`schema.prisma:539`), fallback `kalababyspa.online/reservasionline` bila `landing_domain=""`.
  - Heal existing: `UPDATE ad_clicks SET "landingUrl"='https://kalababyspa.online/reservasionline' WHERE "landingUrl" LIKE '%app.kalababyspa.online/cta%'` → 1 row updated. `GET /api/admin/capi-queue` `reservations.subroute.ts:1141` self-heal konsisten.
- **Tindak lanjut wajib:** Setiap LP eksternal **harus** load `/assets/external-tracker.js?pixel=xxx` dan CTA `href` mengarah `…/cta` agar `landing_url=window.location.href` selalu terkirim. `Tenant.landing_domain` wajib diisi di Settings (SAAS-ready).

### 15.3 JSON/Formatting cleanup (catatan teknis)

- Selama recovery & fix, beberapa file `*.ts` & `*.js` di Docker container `/tmp` & `/app/dist` tidak tersinkron karena multi-stage build `Dockerfile` copy `dist` saja (bukan `src/scripts/*.ts`). Script recovery `recover_all.js` di-copy manual `docker cp` ke container lalu `node /tmp/recover_all.js` — ini workaround, bukan pola ideal.
- Payload raw `payload.json` Siska di-copy manual, parse via `node run2.js` hit `POST /api/admin/reservation/parse` (header `x-api-key` bukan `x-admin-api-key` — middleware `admin.route.ts:72`). Harusnya gunakan CLI `npm run chat` atau script terintegrasi.
- `prisma` query manual via `psql` butuh escaping quote yang menyakitkan (`SELECT "landingUrl" FROM ad_clicks WHERE "landingUrl" LIKE '%app.kala%'`). Harus gunakan Prisma Client atau query builder untuk konsistensi.
- **Perbaikan kedepan:** Tambah script `recover-lost-reservations.ts` ke `package.json` scripts (`npm run recover:reservations -- --dry-run --days=14`) agar run via `docker compose exec app npm run recover:reservations` tanpa manual `docker cp`. Standarisasi header auth `x-api-key` di semua admin endpoint.

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

---

## 14b. [Customer] Jarak tidak terekam saat human handling (Sawotratap 6283831256927) — FIXED 2026-08-27

- **Status:** fixed (2026-08-27).
- **Gejala:** Customer Sawotratap kirim `Jl anusanata No.19 Sawotratap Gedangan Sidoarjo` + form reservasi `Kec Sawotratap Kota Sidoarjo` saat `is_human_handling=true` → `customers.lat/lng/distance_km/ongkir` tetap NULL. Balasan admin `jaraknya 4km` hanya teks manual.
- **Akar masalah:** gate `machine.ts#47` & `decision-matrix P2 SILENT_HUMAN_ACTIVE` langsung `return shouldSendReply:false` sebelum geocoding. `human.ts` hanya handle form lengkap & pin GPS, tidak ada enrichment teks alamat biasa.
- **Fix:** service baru `human-background-enrichment.service.ts` (silent enrichment via `EntityExtractor` → `geocodingService.geocodeText` → `deliveryService.calculateDelivery` → `customerService.updateCustomerLocation`, fail-safe). `machine.ts` gate kini fire-and-forget `enrichAsync` sebelum return; `human.ts` delegasi ke `enrichSync` + fallback form geocode. Backfill live: Sawotratap `distance_km 5.03km ongkir 5000` via ORS.
- **Verifikasi:** `tests/unit/human-background-enrichment.test.ts` 5 passed, `npm run build` pass, live `SELECT` Sawotratap `distance_km!=null`.

---

## 14. [Follow-Up / Live Chat] Pesan Multi-Bubble Follow-Up & Reminder Hanya Mencatat Bubble Terakhir di Live Chat — FIXED 2026-08-26

- **Status:** fixed (2026-08-26).
- **Ditemukan:** 2026-08-26, saat investigasi customer Bunda Mika Tegalsari (`+62 812-1733-2334`), Sita wonokromo (`6285755140841`), dan Novi Candi (`6282311154677`).
- **Gejala:** Pesan follow-up otomatis (`NEXT_TREATMENT`, `NO_PURCHASE`, `Review H+1`, `Morning Reminder`) yang dipecah oleh engine Humanizer menjadi 2 bubble terkirim utuh ke WhatsApp customer, namun di database `messages` dan tampilan Live Chat Admin Dashboard HANYA bubble terakhir yang tersimpan. Bubble 1 (sapaan awal) hilang dari riwayat Live Chat.
- **Akar Masalah (3 faktor):**
  1. **Ketiadaan Pre-Logging di Modul Background**: `FollowUpService.executeFollowUp`, `CronService`, dan `BroadcastQueueService` langsung memanggil `typingService.simulateHumanReply()` tanpa mencatat pesan ke tabel `messages` sebelum/sesudah kirim.
  2. **Anti-Duplication Webhook Mengabaikan Bubble 1**: `simulateHumanReply` mendaftarkan kedua bubble ke registry `inFlightBotOutbounds`. Saat Bubble 1 terkirim, webhook WAHA `fromMe: true` melihat status in-flight aktif dan men-skip penyimpanan ke DB (mengira bot sudah mencatatnya).
  3. **Race Condition Pembersihan In-Flight pada Bubble 2**: Saat Bubble 2 selesai dikirim, blok `finally` di `simulateHumanReply` langsung menghapus data in-flight seketika (`clearInFlightBotOutbound`). Webhook WAHA untuk Bubble 2 yang tiba beberapa ms kemudian tidak menemukan status in-flight maupun record di DB, sehingga mengira Bubble 2 adalah pesan baru dari luar dan mencatat Bubble 2 saja.
- **Fix:**
  - `follow-up.service.ts`, `cron.service.ts`, `broadcast-queue.service.ts`: Explicit pre-logging seluruh pesan outbound otomatis ke `messageService.logMessage` dengan `direction: 'OUTBOUND'`, `senderType: 'BOT'`.
  - `typing.service.ts`: Menghapus pembersihan sinkron prematur di `finally`; membiarkan TTL 45 detik (`ttlMs = 45000`) di `messageService` melindungi seluruh echo webhook WAHA dari false-positive.
  - `message.service.ts`: Menambahkan multi-bubble fragment matching (`existing.content.includes(normalizedContent)`) pada `checkAndAttachOutboundDuplicate` agar echo potongan bubble otomatis terikat ke pesan gabungan yang sudah ada tanpa duplikasi.
- **Verifikasi:** `npx vitest run tests/unit/follow-up-livechat-sync.test.ts` (4/4 PASS), seluruh suite follow-up (36/36 PASS), TypeScript `npm run build` 100% lolos (0 error).

---

## 16. [Reservation / Location] Tautan Google Maps di Alamat Form & Teks Treatment Bebas Menyebabkan Jarak Null & Duplikasi Reservasi

- **Status:** planned (Implementation Plan siap di `implementation_plan.md`).
- **Ditemukan:** 2026-08-29, kasus Bunda Ifa Karangpilang (`6281455029665`).
- **Gejala:**
  1. Alamat form yang menyertakan tautan Google Maps (`Jl. Griya Kebraon Utama AU 18 (https://maps.app.goo.gl/DGusQAqJDvPWznBV6)`) tersimpan ke kolom `kelurahan` dan gagal di-resolve oleh Google Geocoding API -> `lat`, `lng`, `distance_km`, dan `ongkir` bernilai `NULL`.
  2. Input treatment bebas pelanggan (`pijat ceria` + `Bundling breast massage+oksitosin`) belum terpetakan ke item resmi di tabel `clinic_services` beserta durasi & harganya.
  3. Tercipta 2 reservasi pending (Auto-Capture bot vs Input Manual Admin) untuk jadwal kunjungan yang sama dalam selisih 13 detik.
- **Akar Masalah:**
  1. Ketiadaan modul ekstraksi dan ekspansi URL Google Maps pendek (`maps.app.goo.gl`) di `reservation-text-parser.ts` & `human-background-enrichment.service.ts`.
  2. Auto-Capture mencatat string mentah tanpa pencocokan kemiripan (*fuzzy matching*) ke database layanan.
  3. Endpoint create reservasi manual admin dan webhook bot belum memiliki logika merge/deduplikasi berbasis customer & tanggal 24 jam.
- **Rencana Tindak Lanjut:**
  - Eksekusi 4 tahap di `implementation_plan.md`:
    - Tahap 1: Google Maps URL extractor & cleaner + auto-kalkulasi jarak.
    - Tahap 2: Fuzzy Treatment Normalizer ke `clinic_services` DB.
    - Tahap 3: Smart Deduplication & Merge Reservasi.
    - Tahap 4: UI Admin Dashboard auto-category & price sync.

---

## 17. [Slot Engine] Hardcoded Treatment Keyword Harvester di `slate-store.ts` (SaaS Multi-Tenant Tech Debt)

- **Status:** open (tech debt, deferred).
- **Ditemukan:** 2026-08-31, saat audit mendalam perbaikan kasus `6281237904919`.
- **Gejala / Deskripsi:** `SlateStore.harvestGroundTruthFromHistorySync` memiliki daftar array statis `treatmentKeywords` (seperti *oksitosin*, *laktasi*, *pulih ceria*, *batuk*, dll.) untuk mendeteksi treatment yang pernah dibahas di riwayat pesan.
- **Dampak:** Sesuai konvensi SaaS-readiness di `AGENTS.md`, seluruh nama layanan dan kata kunci seharusnya dimuat secara dinamis per-tenant dari tabel database `clinic_services`. Untuk tenant default klinik Mom & Baby saat ini bekerja dengan baik, namun untuk tenant multi-klinik baru di masa depan perlu dihubungkan ke `TreatmentCatalogService`.
- **Rencana Mitigasi:** Pindahkan daftar keyword ke query dinamis `clinicService.getServices(tenantId)` saat inisialisasi / caching per-tenant.

---

## 18. [Live Chat / UI] Pencarian Keyword Pesan (misal "5km") Tidak Otomatis Scroll & Highlight ke Bubble Pesan Target

- **Status:** planned (tercatat di `docs/IMPLEMENTATION_PLAN_LIVECHAT_WA_SYNC.md` Fase 6).
- **Ditemukan:** 2026-08-31.
- **Gejala:** Saat admin melakukan pencarian keyword spesifik (misal *"5km"*, info ongkir, atau template jawaban) di panel Live Chat, daftar percakapan di kiri berhasil menyaring customer yang relevan. Namun saat percakapan diklik, tampilan chat selalu otomatis scroll ke pesan paling bawah (`scrollToBottom`), sehingga admin harus mencari dan men-scroll manual ke atas tanpa adanya penanda (highlight) kata kunci atau navigasi bubble.
- **Akar Masalah:**
  1. Komponen `LiveChatMonitor.tsx` selalu menjalankan `scrollToBottom()` setiap kali `messages` selesai dimuat tanpa memeriksa apakah ada `searchQuery` aktif.
  2. Belum ada rendering `<mark>` atau visual highlight styling pada bubble pesan yang mengandung kata kunci pencarian.
  3. Belum ada in-chat match counter & navigasi loncat pesan (🔼 / 🔽).
- **Rencana Tindak Lanjut:** Implementasi **Fase 6** di [`docs/IMPLEMENTATION_PLAN_LIVECHAT_WA_SYNC.md`](file:///c:/Users/User/Documents/chatbot%20AG/docs/IMPLEMENTATION_PLAN_LIVECHAT_WA_SYNC.md) (Search-to-Message Jump, Keyword Highlighting, & In-Chat Match Navigation).

---

## 19. [Customer DB] Timeout 10s pada Database Customer (500 rows) — Skeleton + Retry + LTV Materialization

- **Status:** mitigated (2026-09-01) — Fase 0.5-5.5 di `IMPLEMENTATION_PLAN_CUSTOMER_DB_SKELETON.md`.
- **Ditemukan:** 2026-09-01.
- **Gejala:** Buka Database Customer → loading lama → toast "Gagal memuat database customer: Koneksi internet lambat (Timeout 10s)" meskipun data hanya 500 baris.
- **Akar Masalah:** 5 faktor konkuren:
  1. N+1 `resolveTreatmentValue` per-row (500 unique texts × sequential await).
  2. 6 query paralel per request (findMany + count + 4 stats) memblok response.
  3. `pool_timeout=10` = FE timeout 10s → race condition.
  4. Search `ILIKE %q%` pada 6 field tanpa index trigram.
  5. UI hanya spinner, tidak ada skeleton atau retry.
- **Fix yang Diterapkan:**
  - Skeleton `animate-pulse` + retry banner manual (Phase 1+2).
  - Batch resolve N+1 via `Promise.all` + Map (Phase 1.5).
  - Stats endpoint terpisah cached 60s (Phase 3).
  - Observability structured logging >500ms warning (Phase 3.5).
  - Search guard: <4 huruf = 3 field, ≥4 huruf = 6 field (Phase 4).
  - `ltv_cache` kolom DB + hook sync + backfill SQL (Phase 4).
  - `pool_timeout=10→15` (Phase 5.5).
  - Composite indexes: `tenant_id+is_sandbox_test`, `tenant_id+is_mql`, `tenant_id+is_sandbox_test+created_at`, `ltv_cache` (Phase 4).
- **Sisa Risiko:**
  - `ltv_cache` perlu backfill saat deploy: `UPDATE customers SET ltv_cache = COALESCE((SELECT SUM...)` — sudah ada di migration SQL.
  - Index GIN `pg_trgm` belum ditambahkan (opsional, hanya jika search lokasi sering dipakai).
  - Load test `autocannon -c 8 -d 20` belum dijalankan di staging — needs Phase 6 sebelum prod.

---

## 20. [Follow-Up Queue] Penundaan Sementara (Postponed) Eksekusi Otomatis Pengingat H-1 dan Review H+1

- **Status:** open / active postponement (kebijakan operasional klinik).
- **Ditemukan/Ditetapkan:** 2026-09-01, sesuai instruksi user/klinik.
- **Deskripsi & Kebijakan:**
  Pengiriman otomatis untuk tipe follow-up **`REMINDER_H1` (Pengingat H-1 Malam 19:00 WIB)** dan **`REVIEW_H1_BABY` / `REVIEW_H1_MOMS` (Review H+1 Pagi 08:00 WIB)** diputuskan untuk **ditunda sementara (*POSTPONED*)** dari eksekusi background worker bot.
- **Perilaku Sistem Saat Ini:**
  1. Saat reservasi baru dikonfirmasi (`confirmed`), baris follow-up tetap dibuat di tabel `follow_ups` dengan status awal **`PENDING`** (bukan auto `QUEUED`), sehingga admin tetap dapat melihatnya di Dashboard Antrian Follow-Up.
  2. Background worker (`processDueFollowUps`) secara eksplisit melewati (*skips*) follow-up tipe `REMINDER_H1`, `REVIEW_H1_BABY`, dan `REVIEW_H1_MOMS`, sehingga tidak terkirim otomatis ke WhatsApp.
  3. Admin dapat mengirimkannya secara manual (*Send Now*) dari dashboard jika sewaktu-waktu dibutuhkan.
- **Rencana Tindak Lanjut:**
  Bila klinik siap mengaktifkan kembali reminder & review otomatis, hapus postponement guard di `processDueFollowUps` dan kembalikan default status pembuatan menjadi `QUEUED`.

---

## 21. [Geocoding] Resolusi Nama Jalan Lokal Tanpa Indikator Jalan ("Jl." / "Gang") Memerlukan Klarifikasi Kelurahan

- **Status:** mitigated / open tech-debt.
- **Ditemukan:** 2026-09-03, saat backtest 30 percakapan riil pelanggan database.
- **Gejala:** Pelanggan yang menyebut nama jalan lokal tanpa awalan penanda jalan (contoh: *"Di bronggalan"*, *"Klampis jaya"*) tidak terdaftar di kamus kelurahan/kecamatan `surabaya_sidoarjo_subdistricts.json`. Gazetteer Pre-Validation Gate mengarahkan bot meminta klarifikasi kelurahan: *"Boleh diinfokan detail kelurahan atau desa di Bronggalan Bunda agar kami bantu cekkan ongkir presisinya? 😊"*.
- **Mitigasi Saat Ini:**
  - `isStreetOrLandmark` mengizinkan pencarian Google Maps jika ada kata penanda (*"jl"*, *"jalan"*, *"gang"*, *"perumahan"*, *"no"*).
  - Jika nama jalan berdiri sendiri tanpa kata penanda dan bukan kelurahan, bot secara sopan dan aman meminta kelurahan spesifik, menghindari kesalahan tebak ongkir.
- **Rencana Tindak Lanjut:**
  - Tambahkan kamus alias koridor/jalan arteri utama Surabaya & Sidoarjo ke dalam `landmarks.ts` / `gazetteer.ts` agar nama jalan populer seperti Bronggalan, Klampis, Kertajaya langsung terpetakan ke kelurahan induknya tanpa perlu tanya ulang.

---

## 22. [Vitest Test Isolation] Race Condition State Mock pada Multi-File Integration Test Suite

- **Status:** open (test runner isolation tech-debt).
- **Ditemukan:** 2026-09-03.
- **Gejala:** Ketika seluruh vitest suite (207 file test, 1.700+ tes) dijalankan paralel via `npm test`, sebanyak 4-5 integration test (`bot-toggle-messaging-schema.test.ts`, `control_center_ui.test.ts`, `queue-stale-state.test.ts`) mengalami transient assertion failure karena berbagi in-memory mock store (Prisma/Redis fallback) yang ter-reset di tengah jalan oleh test runner lain. Tes-tes ini lulus 100% jika dijalankan secara terisolasi (`npx vitest run tests/integration/...`).
- **Rencana Tindak Lanjut:**
  - Pisahkan runner unit test (`npm run test:unit`) dan integration test (`npm run test:integration`).
  - Tambahkan konfigurasi `--no-file-parallelism` atau `--isolate` khusus untuk folder `tests/integration/` di `vitest.config.ts`.

---

## 23. [UI] Dark Mode: halaman non-flagship mengandalkan remap CSS global + preferensi per-browser

- **Status:** open (tech debt ringan, by-design), **bukan bug** — hasil implementasi Dual Theme 2026-09-03.
- **Ditemukan:** 2026-09-03, saat implementasi Tema Hitam & Putih Admin Dashboard.
- **Konteks:** Varian `dark:` eksplisit hanya ditambahkan ke permukaan flagship
  (`Layout`, `Login`, `Overview`/`FinancialAnalytics` charts, `AppearancePanel`,
  `ThemeToggle`, `ToggleSwitch`, `UiFeedback`, `Pagination`). Seluruh ~50 halaman
  lain (CRM, katalog, reservasi, modal) menjadi readable di dark mode lewat blok
  remap `.dark` di `packages/admin-dashboard/src/index.css` yang memetakan
  utilitas hardcoded light (`bg-white`, `bg-[#f0f2f5]`, `text-[#111b21]`,
  `border-[#e9edef]`, badge pastel, `bg-[#efeae2]`→wallpaper `#0b141a`,
  `bg-[#d9fdd3]`→bubble `#005c4b`) ke palet WhatsApp Dark.
- **Limitasi yang diketahui:**
  1. Warna hardcoded eksotis di luar kamus remap (mis. `bg-blue-100`/`border-blue-100`
     di `CreateReservationModal.tsx:1784`) tetap tampil terang saat dark mode.
  2. Recharts `Tooltip` default (Pie di `FinancialAnalytics.tsx:569`) memakai style
     inline bawaan — sudah di-override via CSS `.recharts-default-tooltip`, tapi
     warna label formatter tertentu bisa kurang kontras.
  3. Preferensi tema disimpan di `localStorage` per-browser (`wa_clinic_theme`) —
     tidak sinkron antar perangkat dan bukan data bisnis (sengaja tidak tenant-aware / DB).
- **Pembaruan 2026-09-04:** kamus remap CSS global di `packages/admin-dashboard/src/index.css`
  telah diperluas mencakup input focus anti white-out (`focus:bg-white`→`#2a3942`),
  teks netral gelap (`text-slate-700/800/900`, `text-gray-700/800/900`,
  `text-[#374151]`/`text-[#4b5563]`/`text-[#64748b]`/`text-[#666]`), badge WhatsApp
  (`bg-[#d9fdd3] text-[#008069]`→teks `#e9edef` di atas `rgba(0,92,75,0.7)`),
  hover anti-silau (`hover:bg-[#f8fafc]`/`[#f5f6f6]`/`[#f0f4f7]`/`[#fafafa]`/
  `slate-50`/`gray-50`→`#2a3942`; `[#c2e7e0]`/`[#d0ece7]`→mint transparan),
  inverted tab/pill (`bg-[#e9edef]`→`#2a3942`) & sticky (`bg-[#fafafa]`/
  `[#fcfcfc]`/`[#f5f5f5]`→`#111b21`), palet pastel semantik (blue, purple, red),
  kartu kalender pastel (`bg-[#e0f2fe]`/`[#f3e8ff]`/`[#fef3c7]`/`[#dcfce7]` beserta
  teks & border terkait → versi dark-transparan), dan divider kartu
  (`border-[#f0f2f5]`, `divide-[#f0f2f5]`, `border-[#cbd5e1]`/`slate-300`/`gray-300`/
  `[#e2ddd5]`→`#2a3942`/`#374248`).
- **Rencana Tindak Lanjut:**
  - Tambah entri remap `.dark` baru di `index.css` setiap kali warna eksotis ditemukan.
  - Migrasi bertahap halaman prioritas ke varian `dark:` eksplisit saat halaman disentuh refactor lain.

---

## 24. [CAPI] Gazetteer Zipcode Coverage Terbatas Surabaya & Sidoarjo (EMQ)

- **Status:** by-design (2026-09-07).
- **Ditemukan:** saat implementasi Integrasi Otomatis Data Gazetteer untuk Zipcode Meta CAPI.
- **Gejala:** Dataset `src/config/surabaya_sidoarjo_subdistricts.json` hanya memuat 573 entri kelurahan/desa SBY-SDA. Customer di luar 2 kota/kabupaten tersebut (mis. Gresik, Malang, Jakarta, atau alamat tanpa kec/kel yang dikenali) akan tetap `zipcode = NULL` dan event CAPI terkirim tanpa `zp` — EMQ tidak meningkat untuk segmen non-SBY/SDA. Kecamatan multi-zip (Wonokromo 60241-60246) memakai representatif tunggal (60243) sehingga presisi 100% hanya bila kelurahan ikut terdeteksi.
- **Mitigasi Saat Ini:** Resolver 3-layer (kel+ kec → kec representatif → free-text) + non-destruktif guard (tidak timpa zip existing) + backfill batch 200. CAPI & human enrichment sudah otomatis, log `[CAPI] zp enriched` memudahkan audit.
- **Rencana Tindak Lanjut (opsional, bila EMQ perlu >90%):** Perluas dataset Gazetteer ke kota/kabupaten tambahan atau fallback ke geocoding reverse `zipcode` dari Google `geocodeText` (sudah ada `resolved.zipcode`) bila tersedia; evaluasi cost/benefit postcode prefix table nasional.

---

## 25. [Test] `tests/integration/ad-click.test.ts` gagal pasca-decoupling CAPI dari konfirmasi reservasi

- **Status:** open (dampak disengaja dari kebijakan, bukan bug kode baru).
- **Ditemukan:** 2026-09-07, saat full `npm test` (2 file / 4 test gagal; 3 di antaranya di `ad-click.test.ts` bagian "Meta CAPI Event Integration").
- **Gejala:** Test `should fire Purchase (not Lead) event to CAPI Service on reservation confirmation`, `should also fire Purchase event with value...`, dan `should send Purchase without value when treatment is unknown` mengharapkan `capiService.sendCapiEvent({ eventName: 'Purchase', customData: { source: 'ADMIN_CONFIRM' } })` saat reservasi dikonfirmasi.
- **Akar masalah:** Commit `59f434c` ("pisahkan Tandai Lunas dari Meta CAPI") SENGAJA menghapus auto-trigger Purchase dari `PATCH /api/admin/reservation/:id/confirm` dan `PATCH /api/admin/reservation/:id` — Purchase kini eksklusif via Meta Purchase Queue (`POST /api/admin/reservation/:id/approve-purchase`). Test belum diselaraskan dengan kebijakan baru ini.
- **Rencana Tindak Lanjut:** Update `tests/integration/ad-click.test.ts` agar (a) menegaskan confirm TIDAK memicu `sendCapiEvent`, dan (b) menegaskan Purchase terkirim via `approve-purchase`. Tidak terkait perubahan extractor/invoice (test tersebut tidak mengimpor file dashboard mana pun).

---

## 26. [V3 Guardrail] Multi-Treatment Combo Pricing Arithmetic Ungrounded (TC-24, TC-25)

- **Status:** open (backlog arsitektur produk — sprint berikutnya).
- **Ditemukan:** 2026-09-08, saat closure eval harness V3 (`tests/evals/numeric-hallucination-harness.ts`).
- **Gejala:** Ketika customer menanyakan total harga untuk kombinasi 2+ layanan sekaligus (misal: "Pijat pulih ceria plus sinar moksa totalnya berapa?"), model memanggil tool `get_catalog_and_price` untuk 1 layanan utama. Saat LLM di Call 2 melakukan penjumlahan aritmatika (Rp 70.000 + Rp 10.000 = Rp 80.000), guardrail `NumericFactValidator` mendeteksi nominal Rp 80.000 tidak ada di whitelist hasil tool resmi, menganggapnya halusinasi, dan mengganti balasan ke harga single treatment (Rp 70.000).
- **Rencana Tindak Lanjut (Sprint Berikutnya):**
  - Perluas skema `get_catalog_and_price` agar menerima array nama treatment (`treatmentNames: string[]` atau `addons: string[]`).
  - Tool mengembalikan rincian per-item beserta total resmi terhitung langsung dari database katalog.
  - Dengan demikian, nominal total combo memiliki grounding resmi sebelum sampai ke `NumericFactValidator`.

---

## 27. [V3 UX] Respon Permintaan "Pricelist Lengkap" Naratif vs Daftar Lengkap (TC-16)

- **Status:** open (backlog UX produk — sprint berikutnya).
- **Ditemukan:** 2026-09-08, saat closure eval harness V3.
- **Gejala:** Pada input umum tanpa keluhan seperti "Minta pricelist lengkap pijat bayi dong min", LLM merespon secara conversational dengan menyajikan 1-2 opsi terpopuler (Pijat Bayi Ceria Rp 60.000) alih-alih mendump seluruh puluhan variasi layanan dalam 1 bubble chat.
- **Rencana Tindak Lanjut (Sprint Berikutnya):**
  - Evaluasi bersama tim CS dan bisnis klinik: apakah customer WhatsApp lebih menyukai rekomendasi ringkas berfokus keluhan (pendekatan conversational), atau perlu mode tombol/link brosur PDF / daftar lengkap eksplisit jika intent minta pricelist terdeteksi.

---

## 28. [V3 Test Suite] Porting 4 File Skenario Fungsional Legacy V2 ke V3

- **Status:** open (test debt terjadwal — sprint berikutnya).
- **Ditemukan:** 2026-09-08, saat audit 39 file test legacy sebelum pembersihan V2.
- **Gejala:** 4 file test warisan V2 memuat skenario bisnis nyata yang sangat berharga namun masih mengimpor file `src/slot-engine/*` yang telah didekomisioning:
  1. `tests/unit/slot-engine-back-gesture.test.ts` (Customer berubah pikiran: ganti lokasi, batal treatment, tunda hari booking).
  2. `tests/unit/need-time-and-non-destructive-revoke.test.ts` (Customer "minta waktu berpikir / tanya suami dulu" tanpa membatalkan draft booking).
  3. `tests/regression/real-conversations.test.ts` (Konsultasi pasca-vaksin BCG/Polio & bayi 26 hari batuk pilek).
  4. `tests/unit/slot-engine-transcript-e2e.test.ts` (Replay transkrip percakapan utuh dari customer riil).
- **Keputusan:** Keempat file ini **DIPROTEKSI dari penghapusan** pada Phase 6.
- **Rencana Tindak Lanjut (Sprint Berikutnya):** Jadwalkan 1 sub-task khusus untuk me-refactor assertion keempat file tersebut agar memanggil `V3AgentRunner.processMessage` secara native, lalu hapus sisa file legacy setelah 100% lulus.

---

## 29. [RAG] In-memory fallback memakai substring `includes` sehingga token umum over-match + seed maternal induksi belum dijalankan di live DB

- **Status:** open sebagian (defensive fix sudah applied 2026-09-08; sisa: migrasi live + matcher presisi).
- **Ditemukan:** 2026-09-08, saat implementasi Dynamic Knowledge Grounding (kasus maternal 38 weeks + induksi + capek).
- **Gejala / detail:**
  - Fallback in-memory `knowledge.service.ts:searchRelevantChunks` memakai `text.includes(kw)` per token, sehingga token pendek/umum seperti "ada" ikut cocok via substring di kata "pada" (query nonsense "xyzqwerty topik tidak ada 999" sempat me-return 1 chunk). Relevansi FTS Postgres tidak terdampak; hanya jalur offline/test.
  - Kolom `keywords` (migrasi `20260907000000_add_knowledge_chunk_keywords`) + artikel "Panduan Usia Kehamilan untuk Pijat Induksi Alami" baru tersedia di seed lokal (`src/cli/seed-faq.ts`, `src/scripts/seed-maternal-induction-knowledge.ts`); live DB masih perlu `npx prisma migrate deploy` + `npx tsx src/scripts/seed-maternal-induction-knowledge.ts`. Kode kini defensif (retry FTS tanpa kolom `keywords` saat error 42703) sehingga live lama tetap jalan dengan degradasi tanpa sinonim keywords.
- **Rencana Tindak Lanjut:** (a) ganti matcher in-memory ke word-boundary/token-overlap scoring (seperti `treatmentStringParser`) bila relevansi offline jadi masalah; (b) jalankan migrasi + seed induksi di server live, verifikasi via `POST /api/admin/knowledge` / query "38 weeks induksi capek".
- **Update 2026-09-08 (post-deploy `b56864f`):** Live DB ternyata SUDAH punya kolom `keywords` (`migrate deploy` = no pending; 43 chunks, artikel induksi FTS-hit ✓). Error P2022 kemarin berasal dari **DB lokal dev**, bukan live — jalankan `npx prisma migrate deploy` di lokal juga.

---

## 35. [V3 UX] Audit sesi 435731: over-questioning, halusinasi Waru, cart putus (2026-09-09)

- **Status:** implemented (kode + test); verifikasi simulator skenario 1/2/4
  (balasan LLM aktual) dan eksekusi skrip enrich ke live DB di luar
  jangkauan offline — butuh runs manual sesuai Verification Plan.
- **Konteks:** 14 balasan bot, 12 diakhiri pertanyaan, todong jadwal 6x
  (termasuk Turn 14 setelah jadwal Sabtu final + reservasi tercatat 2x);
  halusinasi "Kecamatan Waru ini cukup luas..." padahal customer di
  Kedungkendo-Candi; `cartItems` kehilangan `Pijat Bayi Ceria` (Rp 60rb)
  karena nama resmi `Pijat Bayi Ceria (Rileksasi)` gagal exact-match.
- **Yang dilakukan:**
  1. `goal-tracker.ts` (`syncCartItems`): normalisasi nama katalog tanpa
     regex (buang `(...)` akhir via operasi string) — cocok utuh ATAU bersih;
     HANYA full-match yang menekan fuzzy; kandidat fuzzy wajib bawa ≥2 token
     signifikan yang belum dijelaskan exact-hit (anti-kompetisi
     Ceria-vs-Pulih; "pulih ceria" tetap lolos mendampingi "sinar moksa").
  2. `persona.ts`: hapus "Closing CTA WAJIB" (baris 189/196) → panduan
     statement-only untuk pertanyaan teknis; contoh durasi tanpa todong
     jadwal; Waru ditegaskan basecamp (aturan 3 + constraint #11);
     larangan tanya hari bila jadwal sudah final (aturan 6).
  3. `conversation-summarizer.ts`: guard `booking.preferredDate/reservationId`
     → larangan eksplisit tanya hari lagi; cooldown jadwal tetap aktif walau
     ada sebutan hari bila jadwal sudah final.
  4. Komponen 3 (gate alamat longgar) & 4 (keyword enrichment + live 48/48
     chunks + 25/25 exemplars): SUDAH ada dari sesi sebelumnya (lihat #34);
     diverifikasi tetap hijau (kontrak test + spot-check resolver).
- **Sisa / limitasi yang diketahui:**
  1. Aturan fuzzy ≥2-token: pesan yang menyebut exact-clean + 1 token lepas
     layanan lain (mis. exact "Ceria" + kata "pulih" tanpa "ceria") TIDAK
     menambah item kedua — by-design (mencegah phantom); user bisa sebut
     nama lebih lengkap.
  2. `live-chat-reply.test.ts` (suggest-reply) gagal timeout 5 dtk SEKALI
     saat full-suite load; lolos solo (10/10). Flaky LLM-timing, tak terkait
     perubahan ini (mirip pola isolasi #22).

## 34. [V3 Retrieval] Keyword enrichment KB & bank chat + hapus penodongan alamat (2026-09-09)

- **Status:** resolved (kode + data live termigrasi).
- **Konteks:** 44/48 `knowledge_chunks.keywords` NULL + FTS 'simple' tanpa stemming
  (`persiapan` ≠ `disiapkan`) membuat artikel yang ADA gagal ter-retrieve; bot
  menodong nama/alamat ("bolehkah kami tahu nama Bunda dan alamat lengkap...")
  padahal lokasi wilayah sudah ada — atas arahan user, penodongan dihapus
  (form reservasi + Admin yang menangani kelengkapan titik).
- **Yang dilakukan:**
  1. `src/services/keyword-enrichment.service.ts` (single source of truth) +
     `scripts/enrich-kb-and-bank-chat-keywords.ts` (`--tenant`, `--dry-run`):
     live 48/48 chunks + 25/25 exemplars ter-update, 0 tak cocok. Verifikasi FTS:
     "persiapan sebelum pijat induksi" → chunk persiapan + induksi;
     "apa yang perlu disiapkan" → 2 chunk persiapan; "bayar pake apa" → 3 chunk pembayaran.
  2. `src/cli/seed-faq.ts` mengisi keywords otomatis via resolver (seed ulang aman).
  3. Tags in-memory (7 default + gold) sinkron dengan kurasi (kontrak test).
  4. Persona aturan 21 + panduan `save_reservation` baru: konfirmasi cek jadwal
     tanpa todong nama/alamat/shareloc, tanpa sebut "Admin CS" (termasuk
     string LLM-visible di clinic-faq/escalate-human + 4 respons exemplar).
  5. Gate `save_reservation` tidak lagi menolak booking; selalu simpan pending +
     konfirmasi cek jadwal. `booking.isConfirmed` kini false (state RESERVATION_SENT).
- **Sisa:** seed maternal-prep (`scripts/seed-maternal-prep-faq.ts`) tetap perlu
  dijalankan per tenant bila artikelnya belum ada; util `hasStreetDetail` /
  `isGenericCustomerName` dipertahankan sebagai util non-pemblokir.

---

## 33. [V3 Reservasi] Sisa tech-debt audit homecare Agent V3 (2026-09-09)

- **Status:** open (tech debt ringan, by-design — fungsi inti live & teruji).
- **Konteks:** Perbaikan fondasional audit sesi 567292 (kategori MOMS, anti-collision
  keranjang, purchaseValue, validation gate, aturan jam, normalisasi `**`, seed FAQ persiapan).
- **Sisa yang diketahui:**
  1. `resolveTreatmentCategory` memakai fallback `includes` dua arah bila nama tidak
     persis sama — untuk nama layanan yang sangat pendek/umum bisa salah pasang.
     Mitigasi: kecocokan exact diprioritaskan; fallback entity pasien terstruktur.
  2. Validation gate aktif hanya bila `conversationId` tersedia (jalur agent).
     Pemanggilan langsung `executeSaveReservation` tanpa session (test, skrip) tetap
     berperilaku lama — by design agar kompatibel mundur.
  3. Gate alamat memakai daftar penanda `STREET_DETAIL_MARKERS` (data-driven
     includes). Alamat tanpa penanda umum namun valid (mis. "Kedungkendo 12" tanpa
     kata jalan — tercakup via digit check; murni nama dusun tanpa nomor akan
     diminta dilengkapi, sesuai SOP homecare).
  4. Seed `scripts/seed-maternal-prep-faq.ts` perlu dijalankan per tenant live
     (`npx tsx scripts/seed-maternal-prep-faq.ts`) agar artikel persiapan tersedia
     di FTS — kode bertahan tanpa artikel (fallback grounding katalog).
- **Rencana Tindak Lanjut:** perluas sinonim/alias katalog bila nama layanan baru
  bermunculan; jalankan seed maternal di live; verifikasi manual 5 input sesuai
  Verification Plan (total Rp 130.000 Kedungkendo, gate "boleh bund").

---

## 32. [V3 Fondasional] Deviasi Pilar 6 & sisa regex teritorial geocoding (2026-09-09)

- **Status:** open/by-design (keputusan arsitektur tercatat, bukan bug).
- **Konteks:** Master Plan Pilar 6 memerintahkan DELETE `sanitizeHallucinatedTerms`,
  `sanitizeStrayBackslashes`, `sanitizeDoubleQuestions` (language-sanitizer.ts) serta
  `stripEnglishLeakage`/`sanitizeFirstPersonPronoun` (sanitizer.ts), dan memindah
  `sanitizeEmDash`.
- **Temuan audit (mengapa TIDAK dihapus):**
  1. Keempat fungsi language-sanitizer dicakup aktif oleh
     `tests/unit/language-sanitizer.test.ts`, `language-sanitizer-fixes.test.ts`, dan
     `lead-greeting-preservation.test.ts`; `sanitizeEmDash` diimpor produksi oleh
     `src/utils/whatsapp-format.ts`. Audit `src/` membuktikan tidak satu pun fungsi
     tersebut terpasang di jalur outbound V3 (agent-runner hanya memakai
     `OutputSanitizer` + `normalizeWhatsAppFormat`) — penghapusan mematahkan test
     tanpa manfaat runtime.
  2. Kedua method sanitizer.ts dicakup `tests/unit/v3-persona-rules.test.ts` dan sudah
     dikeluarkan dari pipeline `cleanOutboundReply` sebelumnya.
- **Yang dilakukan (varian aman):** ekspor dipertahankan; fungsi yang tidak terpasang
  ditandai `@deprecated` eksplisit + catatan modul; `sanitizeEmDash` dinyatakan tetap
  aktif via `normalizeWhatsAppFormat`. Kendali perilaku LLM tetap di level
  Prompt/Grounding/Few-Shot sesuai mandat AGENTS.md.
- **Sisa regex teritorial:** `src/integrations/google-maps/geocoding.ts:103`
  (`hasExplicitOutsideCity`, bias Surabaya/Sidoarjo) dan beberapa pola teknis
  (`hasSpecificStreetOrEstate`, dx `escapeRegex` gazetteer) sengaja TIDAK diubah —
  di luar scope Pilar 5 (hanya `calculate-delivery.tool.ts`) dan terikat perilaku
  Territory-biased geocoding yang diuji test perbatasan. Penghapusan butuh proyek
  geocoding tersendiri dengan evaluasi live.
- **Rencana Tindak Lanjut:** hapus ekspor mati hanya bila (a) test yang mencakupnya
  dihapus/dipindah lebih dulu, dan (b) tidak ada impor produksi; audit ulang saat
  refactor geocoding.

---

## 31. [V3 Domain] Sisa tech-debt Multi-Audience & Hybrid RAG (Agent V3, 2026-09-09)

- **Status:** open (tech debt ringan, by-design — fungsi inti sudah live).
- **Ditemukan:** 2026-09-09, saat redesign Multi-Audience Patient Domain & Hybrid RAG Grounding.
- **Yang sudah fixed:** `uk 38 weeks` tidak lagi bocor ke `childProfile.ageMonths`; `momProfile`/`targetAudience` first-class; pre-retrieval FTS deterministik + katalog terdaftar di `retrievedChunks`; Inspector `AiSandbox` adaptif (🤰/👶).
- **Sisa yang diketahui:**
  1. `syncChildrenProfiles` masih memakai regex usia warisan (`/(\d+...)\s*(bulan|bln|tahun|thn|th)/`) — dipertahankan untuk backward-compat; parser maternal baru (`parseGestationalWeeks`) sudah tanpa regex semantik. Guard `isMaternalOnlyMessage` mencegah kontaminasi silang.
  2. Sugesti summarizer untuk keluhan ibu generik (mis. "capek") memakai kandidat MOMS pertama bila skor semantik 0 — bukan halusinasi, tapi belum sepresisi skor gejala anak. Perlu perluasan sinonim katalog MOMS bila keluhan ibu bertambah.
  3. Pre-retrieval hanya berjalan untuk pesan substantif (`isSubstantiveForPreGrounding`); artikel induksi harus ada di live DB (47 chunks) agar Inspector terisi — jalankan seed maternal bila chunk belum ada.
- **Rencana Tindak Lanjut:** (a) migrasi parser usia anak ke tokenizer tanpa regex saat refactor berikutnya; (b) tambah sinonim MOMS (`capek→relaksasi/oksitosin`) di `treatment-catalog.service`; (c) verifikasi manual Sandbox Turn 1/2 sesuai Verification Plan proposal.

---

## 30. [Migrations] Live `tenants.settings` tidak ada di DB (P2022 di log app)

- **Status:** open (pre-existing drift, bot tetap jalan — error ter-catch).
- **Ditemukan:** 2026-09-08, saat verifikasi log pasca-deploy `b56864f` di live server.
- **Gejala:** log app live berulang: `Invalid prisma.tenant.findUnique()/findFirst() ... The column tenants.settings does not exist in the current database.` Alur pesan tetap berjalan (HUMAN_HANDLING + web push normal).
- **Akar masalah (dugaan):** drift baseline yang sama seperti #1 — migrasi penambah kolom `tenants.settings` tidak ada / belum applied di live, sementara `migrate deploy` melaporkan no pending. Perlu audit `prisma/migrations` vs `information_schema` untuk tabel `tenants`.
- **Mitigasi kode 2026-09-09:** query terpanas (`reservations.subroute.ts:2300`, CAPI queue) kini memakai `select: { id, landing_domain }` eksplisit sehingga tidak lagi memicu P2022 apa pun status kolom `settings`. Puluhan `prisma.tenant.*` lain tanpa `select` masih berisiko memicu log yang sama — sengaja TIDAK diubah massal karena banyak test menegaskan argumen panggilan eksak (`toHaveBeenCalledWith({ where })`).
- **Rencana Tindak Lanjut (proyek terpisah):** audit kolom `tenants` live vs schema, buat migrasi penambahan kolom yang hilang, verifikasi `migrate diff --from-url` empty. Jangan ubah manual tanpa rencana per-env. Penyembuh cepat per-DB (bila diperlukan): `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS settings JSONB;`.

---

## 33. [Reservasi] Redesain Fondasional Lifecycle & Integritas Transaksi (2026-09-09)

- **Status:** implemented (2026-09-09); sisa: eksekusi SQL live menunggu verifikasi 2-langkah + 2 kegagalan test pre-existing.
- **Konteks:** audit 6 titik mutasi (`reservations.subroute.ts`, `reservation-lifecycle.service.ts`, `machine.ts`, `webhook.route.ts`, `save-reservation.tool.ts`, `conversation-transaction-extractor.ts`) menemukan 5 akar masalah: fragmentasi domain mutasi, tanpa validasi konflik jadwal, dedup naif berbasis `created_at`, parser keuangan global + heuristik `num<=500 → *1000` (korupsi `Usia >4-6 th` → 46000), dan penimpaan buta `purchase_value` resmi oleh parser.
- **Yang sudah dikerjakan:**
  1. `src/services/reservation-core.service.ts` (baru, kanonis): Customer Conflict Guard + Staff Collision Guard (overlap interval + buffer 20 mnt), channel-aware (`ADMIN_PANEL` → 409 kecuali `force:true`; `BOT/WEBHOOK/AGENT` → idempotent merge + auto-consolidate duplikat ke `cancelled`), lifecycle terstandarisasi (children, follow-up bila `confirmed`).
  2. `conversation-transaction-extractor.ts`: isolasi blok pembayaran (cari SETELAH `Payment:/Pembayaran:/Rincian Biaya/Tagihan`), filter token non-mata-uang (`th/tahun/usia/...` tanpa `rp/rb/k` → 0), hapus pelipatgandaan `<=500`, invarian `Total == Treatment + Ongkir - Promo` + auto-rekonsiliasi.
  3. `purchase-detection.service.ts`: pencocokan `booking_date` dari teks (fallback `created_at desc`) + downside guard (nilai baru < nilai resmi → pertahankan resmi).
  4. `CreateReservationModal.tsx`: banner pre-flight + dialog 409 `[Batal & Buka Existing | Tetap Simpan (Force)]` (tanpa `window.confirm/alert`, via state React).
  5. `upsertReservationForm` dipertahankan sebagai wrapper deprecated → delegasi ke core (4 situs webhook + test lama tetap jalan).
- **Sisa / limitasi yang diketahui:**
  1. Pembersihan data live Bunda Bella (cancel `7a6e494a…`, restore `bbbde4bd…` → 160000) BELUM dieksekusi — user menyetujui eksekusi, tetapi gate server mewajibkan verifikasi 2-langkah; script siap di `scripts/cleanup-bunda-bella-duplicates.sql` (jalankan via SSH ke Postgres live, lalu verifikasi SELECT).
  2. Conflict guard fail-open saat lookup DB gagal (dianggap tak ada konflik; kegagalan tulis ditangani fallback memory pemanggil) — by-design agar offline-fallback admin tetap jalan; di produksi read-fail hampir selalu diikuti write-fail sehingga risiko duplikat lolos minimal.
  3. `extractRupiahAmount` (purchase-detection) TIDAK diubah — masih mengambil nominal terbesar pola umum; korupsi angka dilindungi downside guard + parser yang sudah diperbaiki.
  4. Test lama `conversation-transaction-extractor.test.ts` bagian `parseCurrencyValue('70') → 70000` SENGAJA diubah ke `0` (perilaku lama adalah akar korupsi; kasus `Total = 100 + 70 + …` tetap lolos via invarian rekonsiliasi).
- **Kegagalan test pre-existing (terverifikasi di baseline via `git stash`, bukan dari redesign):**
  - `tests/integration/live-chat-reply.test.ts` → `suggest-reply menghasilkan draf saran AI`.
  - `tests/integration/robustness.test.ts` → `5-Minute Passive Confirmation Timeout`.
- **Verifikasi redesign:** `npm run build` bersih; `tsc --noEmit` dashboard bersih; 7 file test reservasi 52+19+16 tes hijau; full suite 1551 passed / 2 failed (pre-existing di atas).

---

## 36. [Pasien] Redesain Fondasional Klasifikasi Lifecycle & Active Appointment Guard (insiden Bunda Retno, 2026-09-09)

- **Status:** implemented + deployed live (2026-09-09 13:09 WIB); runbook Retno DIEKSEKUSI (`cancelled`, terverifikasi).
- **Konteks:** bot AI membalas pasien lama (treatment pertama `completed` 29 Agu) dan pasien berjadwal aktif H-0 ("Sdh smp mana ya?") dengan template marketing generik. Akar: gate hanya cek `confirmed`; properti hantu `purchase_count` / `status='repeat'` (tidak pernah ditulis production); tanpa guard jadwal aktif; label `repeat` hanya hitung `confirmed`; test lama mem-passing mock fiktif.
- **Yang sudah dikerjakan:**
  1. `src/services/patient-lifecycle.service.ts` (baru, kanonis): `hasTreatmentHistory` (`confirmed`/`completed`, fallback `ltv_cache`), `getActiveAppointment` (`pending`/`confirmed`/`hold`, jendela [now-12 jam, now+24 jam]), `getPatientClinicalProfile`. Tenant-aware, best-effort (DB gagal → default aman).
  2. `ai-eligibility.service.ts`: kontrak valid (`has_treatment_history`, `has_active_appointment`, `ltv_cache`; `has_confirmed_reservation` deprecated-alias); properti hantu DIHAPUS; reason baru `ACTIVE_APPOINTMENT_MANUAL` (guard wajib tanpa toggle, di bawah FORCE_*).
  3. `ai-scope-gate.service.ts`: baca profil kanonis (flag eksplisit OR DB OR ltv; tanpa fallback `status='repeat'`); pesan eskalasi operasional baru. `conversation.service.ts`: `ACTIVE_APPOINTMENT_MANUAL` exempt dari auto-release 6 jam.
  4. `reservation-lifecycle` (label `repeat`), `label-reconciliation`, `machine.ts` (`hasPriorConfirmed`), `cron` (review H+1): `confirmed` → `in ['confirmed','completed']`.
  5. Test ditulis ulang tanpa mock fiktif (`legacy-and-repeat-bypass.test.ts`) + `patient-lifecycle.test.ts` baru (10) + simulasi Retno (DB `completed` → silence `EXISTING_PATIENT_MANUAL`; jadwal aktif → silence `ACTIVE_APPOINTMENT_MANUAL`).
- **Sisa / limitasi yang diketahui:**
  1. Runbook `scripts/cleanup-bunda-retno-reservation.sql` DIEKSEKUSI 2026-09-09 13:09 WIB (BLOK 1 cancel, `UPDATE 1`, verifikasi `cancelled`). State akhir Retno: 1 `completed` (riwayat 29 Agu, guard aktif) + 1 `cancelled` (jadwal AI 9 Sept). Deploy: commit `5c0f06f` push master → live pull + rebuild app (WAHA tak tersentuh, up 3 minggu); app boot bersih, full suite lokal 201 file / 1618 passed / 0 failed.
  2. `status === 'legacy'` dipertahankan sebagai sinyal legacy (konvensi riil `migration.service.ts`), berdampingan dengan kolom `is_legacy_source`.
  3. Lookup jadwal aktif fail-open saat DB down (tidak silence); fail-closed tetap dijaga langkah scope (`NEW_ONLY` + cutoff) di resolver.
- **Verifikasi:** `tsc --noEmit` bersih; full suite **201 file, 1618 passed, 0 failed**.

---

## 38. [GPS] Redesign fondasional parsing pin, klaster hierarki & sticky GPS (kasus Valencia Retno, 2026-09-09)

- **Status:** implemented (2026-09-09); verifikasi ORS live 10.92 km + survei koordinat klaster non-PSJ di luar jangkauan offline.
- **Konteks:** alamat "Valencia spring puri surya jaya DD 3 no.28" terhitung 8.5 km (gerbang depan) padahal titik klaster ~10.7–10.9 km rute ORS. Akar: 1 titik/coarse per mega-estate; payload Baileys (`_data.message.locationMessage.degreesLatitude`) tak terbaca → NaN; `share.google` tak terekstrak; flag `share_location_sent` tak pernah menyala sehingga guard sticky tak bekerja.
- **Yang sudah dikerjakan:**
  1. `src/utils/waha-location-parser.ts` (baru, murni/testable): `_data/message.locationMessage` + `liveLocationMessage` (`latitude`/`degreesLatitude`), 0,0 dibuang, tipe-tanpa-koordinat → false (anti bocor NaN). `webhook.route.ts:643-654` didelegasikan (downstream `incomingMessage.location` + `enrichSync` tak berubah).
  2. `google-maps-url-resolver.ts`: regex + `share.google` (redirect follow generik sudah ada, tanpa kode tambahan).
  3. `landmarks.ts`: 3 entri klaster PSJ (Valencia/Sydney-Boston/Osaka-Vancouver, koordinat terverifikasi rencana) SEBELUM gerbang utama (first-match-wins = cluster-first). E2E offline: `geocodeText("Valencia spring…")` → presisi, (-7.393858, 112.745941, Punggul/Gedangan); Haversine lurus 5.04 km (vs gerbang 4.44 km, arah benar); 10.92 km → Tier 11–15 (normal 25000, promo 15000).
  4. Sticky invariant: SUDAH ada & terverifikasi (`updateCustomerLocation` + memory fallback + skip teks di enrich 295/411); override admin via jalur tulis dashboard langsung (bypass service, tak terblokir guard). Test `sticky-gps` 4/4.
- **Sisa / limitasi yang diketahui:**
  1. Klaster CitraHarmoni / Kahuripan Nirwana / CitraLand (Riverside, Stamford, Babatan, North West, …) SENGAJA belum ditambah — koordinat titik dalam belum tersurvei; dilarang memfabrikasi. Butuh survei/pin GPS per klaster, lalu tambah entri (mekanisme cluster-first sudah siap).
  2. Angka ORS 10.92 km dari audit (live); ekuivalen offline = Haversine 5.04 km × 1.6 ≈ 8.06 km (estimasi). Verifikasi tarif live 10.92 km → Tier 15/25k/15k perlu konfirmasi sekali via ORS saat ada API key.
- **Verifikasi:** test baru `waha-location-parser` (9) + `cluster-geocoding` (7) + `sticky-gps` (4) + 2 share.google hijau; full suite **204 file, 1640 passed, 0 failed**; `npm run build` bersih.

## 37. [Pasien] Audit live: pola Retno di customer lain (2026-09-09 13:15 WIB / 05:15 UTC)

- **Status:** audit read-only selesai; tindakan data menunggu keputusan operasional.
- **Cakupan:** 638 customer; 310 `completed`, 13 `pending`, 1 `cancelled` (Retno, dieksekusi sesi ini).
- **Temuan (existing-patient + pending, pola Retno):**
  1. **Bunda Bella (6289670370062)** — KOMBO duplikat + nilai korup, slot 09:30 WIB hari ini (sudah lewat, keduanya masih `pending`): `bbbde4bd` = 46000 (tertulis dari teks bot "Selamat Malam bunda Bella!..." → signature overwrite buta `maybeFirePurchaseEvent` pra-fix, relasi 2 anak) vs `7a6e494a` = 160000 (`[Admin Manual]`, tanpa anak). Rencana approved sebelumnya (cancel `7a6e49…`, restore `bbbd…`→160000) BELUM pernah dieksekusi. Perlu keputusan: batalkan salah satu + status baris kept (completed bila treatment tadi pagi terjadi / tetap pending / cancel).
  2. **Bunda Devia (6285850166929, histori 12)** — 2 pending Newborn (`[Admin Manual]`, dibuat selisih 2 menit): booking kemarin 08:00 WIB (overdue) + hari ini 08:00 WIB (overdue). Dugaan double-entry admin. Rekomendasi: cancel baris kemarin, konfirmasi status baris hari ini ke CS.
  3. **Bunda Fitria Wonokromo (628563567095, histori 2)** — 2 pending 13 Sept: 09:00 WIB form customer (165k) + 13:00 WIB admin (180k), detail berbeda. Belum jelas duplikat vs 2 sesi sah. Rekomendasi: klarifikasi CS dulu, JANGAN eksekusi buta.
- **Normal (tanpa tindakan):** 7 pending milik new-lead (tanpa riwayat) — booking sah; 1 upcoming aktif hari ini (Agnes 13:30 WIB, guard kini melindungi); Retno bersih (1 completed + 1 cancelled).
- **Kronologi eksekusi Bella + admin konkuren (UTC, 2026-09-09, dari `audit_logs`):**
  - 04:12 admin `REJECT_PURCHASE_OUTLIER` pada `7a6e49…` (duplikat yatim Bella).
  - ~05:2x sesi ini: `UPDATE 1` — `7a6e49…` → `cancelled` (sesuai rencana approved).
  - 05:36:49 admin `DELETE_RESERVATION_PERMANENT` pada `a0c5e10c…` (reservasi AI Retno — admin memilih hapus permanen, lebih kuat dari cancel sesi ini; state Retno akhir: hanya riwayat `completed`, bersih).
  - 05:39:50 admin `DELETE_RESERVATION_PERMANENT` pada `bbbde4bd…` (baris korup 46000 Bella) — terjadi SESAAT setelah audit read-only sesi ini, menjelaskan `UPDATE 0` + baris hilang saat verifikasi. BUKAN error skrip.
  - 05:40:31/45 admin `CONFIRM` → `COMPLETE` pada `f37579…` (Newborn Devia hari ini — treatment terjadi; rencana cancel Devia BATAL relevansinya untuk baris ini).
  - Dampak relasi: `children.reservation_id` = `SetNull` — Arhan/Ardhan tetap ada (NULL), tidak ikut terhapus. Tidak ada tabrakan tulis (UPDATE kondisional sesi ini hanya menyentuh baris yatim yang memang ditargetkan).
- **Pelajaran operasional:** dashboard admin aktif konkuren saat runbook dieksekusi — untuk runbook berikutnya, kunci dulu pembagian tugas (siapa mengeksekusi apa) atau bekukan edit dashboard selama jendela eksekusi.

---

## 38. [Tests] `production_edge_cases.test.ts` #28 flaky pada full-suite run (mock WAHA hold-label bocor antar file)

- **Status:** open (test flakiness), **pre-existing** — bukan regresi perubahan V3 fondational (ditemukan 2026-09-10 saat verifikasi plan Tool Output Scoping / Phase / Cart Scope).
- **Gejala:** `28. should auto-resume bot handling when webhook receives message and hold label is missing from WAHA` gagal dengan `expected [] to include 'hold'` (getChatLabels mock mengembalikan kosong) HANYA pada `npm test` full-suite; lolos konsisten bila file dijalankan sendiri (`npx vitest run tests/unit/production_edge_cases.test.ts` → 12 passed).
- **Bukti flaky, bukan regresi:** (1) file yang gagal (`production_edge_cases`, domain WAHA hold-label) tidak tersentuh perubahan (yang diubah: `get-catalog.tool.ts`, `agent-runner.ts`, `goal-tracker.ts`, `conversation-summarizer.ts` + test katalog); (2) pada full-run pertama di sesi yang sama test ini LOLOS, pada full-run kedua GAGAL — dengan delta kode di antaranya (`inquirePrice: true` di `agent-tools.test.ts`) yang mustahil memengaruhi mock WAHA labels; (3) pola klasik kebocoran state mock antar file test pada run paralel/berurutan.
- **Workaround:** jalankan file tersebut tersendiri untuk verifikasi; abaikan 1 failure ini pada full-suite bila hanya test ini yang merah.
- **Fix yang disarankan (proyek terpisah):** isolasi mock WAHA client per-file (`vi.resetAllMocks` / factory mock scoped) atau tandai test #28 sebagai serial (`describe.sequential`) agar tidak tergantung urutan eksekusi file lain.

---

## 39. [V3] Multi-lapisan fondasional sesi 214956/222655: disambiguasi multi-anak, integritas matematika, anti-brosur (2026-09-10)

- **Status:** implemented (kode + test, 2026-09-10); seed FAQ live + penonaktifan baris `clinic_services` live MENUNGGU eksekusi gated (backup dulu).
- **Konteks:** (1) AI menebak 1-vs-2 anak sepihak (17 bln lalu 2 thn); (2) halusinasi aritmatika 75k+105k+15k=120k lolos whitelist; (3) rekomendasi usia format brosur bernomor tanpa pemantik klinis; (4) saran pijat langsung pasca-imunisasi (RAG salah.)
- **Temuan audit pra-koding (deviasi dari draf rencana):** `extractChildrenState` TIDAK ADA (jalur riil: `syncChildrenProfiles` + alokasi slot kedua sudah ada); total resmi SUDAH disuntik di grounding; tool katalog SUDAH anti-brosur; artikel vaksin + keywords SUDAH di `seed-faq.ts`; persona SUDAH punya aturan 10b + pengecualian vaksin; duplikat kids generik mencakup file + code default + DB live + test yang mengassert-nya. Semua diadaptasi, bukan diabaikan.
- **Yang sudah dikerjakan:**
  1. `goal-tracker.ts`: flag `isMultiChildUnconfirmed`, `extractAgesMonths` bersama, `isExplicitChildCountSignal`, `detectUnconfirmedMultiChild`, injeksi `[MANDAT KLARIFIKASI JUMLAH ANAK]` dinamis, `[MANDAT INTEGRITAS MATEMATIKA]` total resmi + rincian; latch di `agent-runner.ts` (naik saat usia-2-tanpa-sinyal, turun HANYA oleh sinyal eksplisit); aturan persona DETEKSI MULTI-ANAK.
  2. `numeric-fact-validator.ts`: mode strict multi-item (parsial sp+op DITOLAK bila cart ≥2), pesan pelanggaran menyebut total resmi + `expectedTotals`; `agent-runner.ts`: re-prompt bersih 1x (`attemptNumericReprompt`, tereskpos untuk test) lalu fallback swap template (prioritas `cartTotalReply`); `get-catalog.tool.ts`: `cartTotalReply` multi-item dihitung mesin + wiring `cartSnapshot` via `tool-registry.ts`. TANPA regex replace teks (pelanggaran hanya dilaporkan).
  3. Template tool + persona A.1: narasi 1 paragraf + pemantik klinis; `kids-massage-ceria` generik DINONAKTIFKAN (`isActive:false` di `services_custom.json` + code default; test usia-30-bln dialihkan ke `kids-massage-2-4th`).
  4. Vaksin: tidak ada perubahan kode dibutuhkan (aturan 10b + seed artikel + test `vaccine-safety` sudah hijau); seed live destruktif (`deleteMany`) DITUNDA ke langkah gated.
- **Eksekusi live 2026-09-10 14:04–14:07 WIB (SSH, approved):**
  - Backup `knowledge_chunks_backup_20260910` (43 baris) — rollback: `DELETE FROM knowledge_chunks; INSERT INTO knowledge_chunks SELECT * FROM knowledge_chunks_backup_20260910;`
  - Temuan pra-eksekusi: live 43 baris (12 ber-keywords; artikel vaksin ADA 2 baris tapi tipis; baris kurasi admin ada → full seed `deleteMany` DITOLAK sebagai terlalu destruktif).
  - Backfill bedah 43 UPDATE kondisional (`keywords IS NULL`) + 13 UPDATE union (seed-eksplisit + rule + existing; baris terisi tak tersentuh) — hasil: 43/43 ber-keywords.
  - `clinic_services.kids-massage-ceria` → `is_active=false` (`UPDATE 1`).
  - Verifikasi FTS persis query service (`websearch_to_tsquery`, judul+keywords+konten): "habis imunisasi boleh pijat" → artikel vaksin ✓ (bukan mandi).
- **Sisa / limitasi yang diketahui:**
  1. Kode sesi ini BELUM di-deploy (live masih 18d1f33) — perbaikan data di atas bekerja mandiri; deploy ikut gate server-update terpisah.
  2. Seed file punya 4 set keywords eksplisit; 1 artikel seed ("terapis/bidan sama atau berbeda") TIDAK ADA di live (insert aman, non-destruktif) — follow-up.
  3. Frasa konfirmasi "1 anak" ("cuma 1 anak") membersihkan latch TANPA meruntuhkan slot anak kedua — disengaja (non-destruktif); CS/admin resolvasi final di booking.
- **Verifikasi:** build `tsc` bersih; test baru 3 file (disambiguasi 10, cross-sum 6, anti-brosur 4) + regresi terkait hijau; full suite **222 file, 1756 passed, 0 failed**.

---

## 40. [V3] Bot menjawab pertanyaan lowongan kerja dengan jawaban jadwal bidan + buta isi gambar (kasus 6289681655911, 2026-09-11)

- **Status:** implemented (2026-09-11, plan v2 — mekanisme fondasional; BUKAN tambal per-kasus).
- **Kronologi live (fakta DB + log + WAHA store, read-only via SSH):** customer Rizki Dwi S kirim 3x foto flyer loker + caption ("Pagi kak mau tanya lokernya masih tersedia ?", 00:19/00:22/00:24 UTC). Bot menjawab di luar domain — preview log: "Halo Bapak! ✨ Terima kasih sudah menghubungi..." lalu 2x "Bapak, mohon maaf untuk hari ini jadwal Bidan..." (completion 97/40/41 token, `retrievedChunks` 2-3, `toolCount` 0). `admin@kalamomsspa.com` menarik ketiga balasan via Live Chat (`REVOKE_MESSAGE` 00:28:33–39 UTC), `manual_takeover` 00:29:43 + balasan manual berisi link Google Form rekrutmen; customer mengisi form 00:36. Teks lengkap balasan bot tak terpulihkan (DB ditimpa placeholder oleh `markMessageDeleted`, WAHA store terprune).
- **Akar masalah (multi-layer):**
  1. **Retrieval:** `knowledge_chunks` live 0 artikel rekrutmen; pre-retrieval grounding (`agent-runner.ts:826-858`) tidak punya cabang grounding-miss — kekosongan dianggap tetap jawab dari prior.
  2. **Domain:** tak ada konsep batas-domain; `entity-extractor.service.ts:469-484` + `persona.ts:64` diam untuk kalimat ini, LLM menebak `ask_schedule` dari pola "…tersedia"; `escalate_to_human` (`persona.ts:366-367`) tidak mencakup topik non-klinis; `ask_unlisted_service` nol hit di `agent-runner.ts`.
  3. **Vision:** `src/v3/` nol referensi media/gambar; V3 hanya menerima caption (`machine.ts:411-421` tidak meneruskan `media`), isi foto flyer tak pernah dibaca.
  4. **Sapaan:** regex nama `goal-tracker.ts:212` (`dwi` → "Bapak"; `dwi` unisex).
- **Penutup struktural (plan v2):** Mekanisme A grounding-miss→eskalasi (Retrieval); Mekanisme B gate `out_of_domain` di state machine + gambar tak-tergrounding ikut jalur sama; Mekanisme C sapaan data-driven (hapus regex, default `Bunda` per keputusan D1, simpan koreksi eksplisit); learning loop via filter `GET /unanswered` (`knowledge.subroute.ts:71-101`). Keputusan: tanpa vision (eskalasi saja), tanpa data rekrutmen di sistem (eskalasi saja), eskalasi silent (D2).
- **Verifikasi:** `npm run build` bersih; `npx tsc --noEmit` 0 error; test baru 3 file (`out-of-domain-intent` 7, `out-of-domain-gate` 5, `gender-greeting-neutral` 17) + regresi terkait hijau (extractor/machine/v3 44 file-254 test, greeting 5 file-33 test); full suite **237 file, 1833 passed, 0 failed** (baseline 1803 passed + 1 flaky `migration.test.ts` yang lolos solo maupun full-run pasca-perubahan); `grep loker|lowongan src/` nol hit runtime; `grep` daftar nama regex lama nol hit; log test membuktikan `LABEL SKIP` (tanpa mutasi label WAHA).

---

## 41. [Audit] Temuan audit penanganan customer 2026-09-11 — status keputusan & tindak lanjut

- **Konteks:** audit mendalam 4-agen (alur end-to-end, NLU, grounding, sesi/handoff) menghasilkan 12 temuan. Keputusan owner 2026-09-11:
- **By design / dibiarkan (BUKAN kekurangan):**
  1. Handoff permanen ke manusia (tanpa auto-release kembali ke bot) — disengaja: LLM belum dilatih menangani pasca-reservasi, perlu human touch. Konsekuensi sadar: CS wajib `release` manual; notifikasi eskalasi wajib kuat.
  2. Follow-up tetap jalan saat `is_human_handling` (hanya cooldown 72 jam) — dibiarkan. Koreksi analisis: `NO_PURCHASE` tak mungkin terkirim pasca-treatment (skip saat pembuatan `follow-up.service.ts:300-312` + auto-CANCEL saat eksekusi `:1100-1117`); sisa risiko hanya eskalasi pra-pembelian (LOW, diterima).
  3. Sapaan kembali default saat DB offline/restart — dibiarkan (degradasi sementara yang sadar).
- **Backlog paling belakang (dicatat, belum dikerjakan):** voice note/stiker/video/dokumen tidak ditranskripsi/dijawab bermakna (`webhook.route.ts:824-852` arsip saja; grep `transcrib/whisper` nihil). Akan dikerjakan terpisah, prioritas terakhir.
- **Diteliti tanpa plan (belum diputuskan):** pesan basi >180 dtk hanya dicatat DB tanpa sapaan pemulihan (`webhook.route.ts:748-798`); sebagai langkah kecil, default `MAX_INBOUND_MESSAGE_AGE_SECONDS` 180→300 dtk (2026-09-11, override env tetap bisa).
- **Dieksekusi 2026-09-11 (Fase A–G, lihat kode):**
  1. Learning loop `unresolved_faq` disambung (penulis: grounding kosong + eskalasi LLM non-medis; medis → `medical_concern`).
  2. Outage LLM total → eskalasi sunyi TANPA balasan (hapus fallback tanya-alamat; `agent-runner.ts` catch).
  3. Intent `complaint`/`human_agent` dihidupkan → eskalasi sunyi (`complaint`/`manual_request`); opt-out STOP berlaku semua provider; slash-command dipindah setelah gate medis/domain.
  4. `factual-claim-validator.ts`: silang nama layanan/durasi/vaksin/anjuran/efikasi vs output tool; gagal pasca re-prompt → sunyi + `unresolved_faq`.
  5. Form tak lengkap 3x → eskalasi sunyi `reservation_incomplete` (counter `formRetryCount` di sesi).
- **Verifikasi:** `npm run build` bersih; `npx tsc --noEmit` 0 error; test baru 6 file (unresolved-faq 4, outage 1, fase-c 5, factual 7, fase-e 2, + perbaikan 1 test lama); full suite **242 file, 1852 passed, 0 failed** (19 skipped, sama seperti baseline). Satu regresi tertangkap gate Fase C (`medical-silent-escalation` — mock lapisan salah, diperbaiki) + satu false-positive D3 (penolakan sopan, diperketat) — keduanya hijau kembali.

---

## 42. [Tests] `medical-silent-escalation.test.ts` "Non-medical" memalsukan LLM di lapisan salah (2026-09-11)

- **Fakta:** test memock `model-fallback` namun runner memakai `v3LlmCircuitBreaker` langsung — V3 selalu throw (`LLM_FALLBACK_API_KEY not configured`) dan lolos via fallback tanya-alamat lama. Setelah Fase B (outage → eskalasi), test ini gagal dengan benar.
- **Perbaikan:** test 3 kini memock `V3AgentRunner.executeChatCompletion` (lapisan yang benar) agar menguji normal flow sungguhan; skenario outage dicakup `llm-outage-silent.test.ts`.
- **Pelajaran:** mock di lapisan yang salah menyembunyikan perilaku outage — waspadai pola ini di test V3 lain.

---

## 43. [V3] Halusinasi domisili "Kecamatan Waru" + janji cek-jadwal buta (simulator 725870, 2026-09-11)

- **Status:** implemented (2026-09-11, fondasional — hierarki prompt + gate kode D6 + replay test).
- **Kejadian:** customer "galo" → "Hari Minggu pagi kosong tidak ya ?" → bot janji "cekkan... Nanti kami infokan" tanpa tanya lokasi/treatment; customer "baik kak" → bot "Area Kecamatan Waru ini masih cukup luas..." padahal lokasi tak pernah disebut.
- **Bukti (bukan tebakan):** `logs/llm-2026-09-11.jsonl` entry `llm_1789098711706` + `llm_1789098754163` (customer `6289999725870`): kedua turn `TOOLS: []`, ringkasan sesi `Lokasi: Belum diketahui`. Dieliminasi: seed simulator, default GoalTracker, substring gazetteer (nol hit), bocoran extractor (guard aktif), state basi.
- **Akar:**
  1. RC-1 slot-fill: pola `persona.ts:155` ("Kecamatan [Kecamatan]...") + primer basecamp Waru (`:150-151`) vs larangan (`:156`, aturan 11 `:334`) — prompt-level tanpa enforcement; model mengisi slot dengan satu-satunya kecamatan yang dikenalnya.
  2. RC-2 konflik aturan: pola cekkan (aturan 5/21) vs tanya-lokasi (`:327`) tanpa precedence; summarizer mem-prime "cekkan"; fast-intent gagal tandai `ask_schedule`; fase GENERAL lemah; "baik kak" bukan afirmasi deterministik.
  3. RC-3 fixing lama tak mempan: `v3-anti-todong-jadwal.test.ts` hanya cek string prompt, tak pernah replay 2-turn.
- **Perbaikan:** Fase 1 hierarki 5a>5b+aturan 21 + direktif GENERAL + summarizer kondisional (prompt-only, keputusan owner); Fase 2 validator D6 (`factual-claim-validator.ts`, daftar kecamatan dari `getGazetteerKecamatanNames`, kecuali homebase) + `TEMPLATES.askDomicileNeutral` + wiring blok 7b (D6-murni → template netral + `unresolvedFaq`); Fase 3 `simulator-minggu-waru-replay.test.ts` (MERAH 2/2 sebelum fix → HIJAU sesudah) + unit D6 + perluasan test statis.
- **Verifikasi:** `npm run build` bersih; `tsc --noEmit` 0 error; replay test MERAH 2/2 sebelum fix → HIJAU sesudah; full suite **243 file, 1858 passed, 0 failed** (19 skipped = baseline).

---

## 44. [V3] Auto-locking selectedTreatment + salah jawab nominal 100rb (simulator 973126, 2026-09-11)

- **Status:** implemented (2026-09-11, fondasional 4 fase — state machine + tool contract + summarizer + prompt).
- **Kejadian:** customer "Mba 100rb berapa menit pijetnya?" dijawab "Pijat Bayi Ceria ... 40 menit" padahal Ceria promo 60rb/normal 80rb; yang promo 100rb adalah Prenatal Massage 60 mnt.
- **Akar (audit read-only, terbukti di kode):**
  1. `agent-runner.ts:1158-1166` — tool read-only `get_catalog_and_price` menulis `selectedTreatment = treatments[0]` (auto-locking warisan).
  2. `detectAgreedTreatment (:304-320)` + auto-capture (`:593-606`) memindai semua role — sebutan asisten dianggap persetujuan customer.
  3. Tool contract tanpa `targetPrice`; router menebak `category BABY` hingga MOMS terfilter keluar; service tanpa pencocokan nominal.
  4. `conversation-summarizer.ts:163-165` hanya cek substring menit/durasi → dikaitkan ke paket yang dibajak; `summarizer:77-79` + fase `TREATMENT_DISCUSSED` melarang tanya treatment.
- **Perbaikan:** Fase 1 hapus total auto-locking (customer-agreed only) + filter `role==='user'`; Fase 2 `findServicesByPrice()` tenant-aware + `targetPrice` di `GetCatalogInput`/`GET_CATALOG_TOOL_SCHEMA`/zod + pool lintas kategori + `priceClarification` + `showPrices` paksa; Fase 3 cabang komposit nominal+durasi berbasis token kata (anti false-positive "bRp"); Fase 4 router guidance targetPrice + few-shot 100rb (klarifikasi Bunda vs si kecil).
- **Limitasi sadar:** nominal diekstrak LLM router ke `targetPrice` (tanpa parser regex deterministik — sesuai mandat minimal-regex); `tolerance` default exact-match 0.
- **Verifikasi:** `npm run build` exit 0; tests baru `catalog-price-matching` (6) + `simulator-100rb-replay` (4) hijau; inti 30/30; full suite **245 file, 1868 passed, 0 failed** (19 skipped = baseline).

---

## 45. [V3] Deadlock validator faktual D2↔D3 + pembajakan sanitizer eskalasi (simulator 446090, 2026-09-12)

- **Status:** implemented (2026-09-12, fondasional 4 fase — guardrail + runner + FTS + test).
- **Kejadian:** pertanyaan SOP vaksin ("pijat habis imunisasi apa sebelum ya?") dijawab sapaan Turn-0 tak relevan, bukan SOP vaksin.
- **Akar (audit read-only, terbukti di kode):**
  1. `persona.ts:369` mewajibkan vaksin via `get_clinic_policy_faq` (JANGAN `search_knowledge_faq`), tetapi D3 (`factual-claim-validator.ts:168-175`) hanya mengakui chunk `search_knowledge_faq` dan argumen `_retrievedChunks` (`:109`) adalah dead parameter — deadlock mutlak.
  2. `agent-runner.ts:1448` sanitizer menimpa `finalReply=''` eskalasi dengan sapaan Turn-0 (tanpa guard `!isEscalated`); brand hardcoded di fallback.
  3. `knowledge.service.ts:233-243` Step 3 `plainto_tsquery` tanpa Relevance Gate (Step 2 punya) — artikel skor 0.015 lolos sebagai noise.
- **Perbaikan:** D2/D3 mengakui policy-tool + `retrievedChunks` substantif; guard `!isEscalated && shouldSendReply` + `replyText ''` saat eskalasi + brand dinamis `getBrandIdentity()` (tanpa argumen — signature belum per-tenant, lihat brand.ts:25); gate token+`rank>=0.025` di Step 3 dan fallback tanpa-kolom; test baru `tests/unit/vaccine-sop-flow.test.ts` (5).
- **Sengaja TIDAK disentuh:** `persona.ts` (aturan vaksin sudah konsisten), seed vaksin sudah ada (`seed-faq.ts:139-145`) — Fase seed = verifikasi sinkronisasi DB saja, dan `npm run seed:faq` (deleteMany destruktif) DILARANG jalan di live tanpa backup+staging.
- **Pre-existing (terbukti di tree bersih via stash, BUKAN regresi perubahan ini):** full suite `npm test` gagal 19-23 test keluarga harga katalog (Pulih Ceria 70rb→75k, nama Prenatal/Ceria/Sinar Moksa di `services_custom.json` drift tanpa update ekspektasi test: `agent-tools`, `catalog-price-matching`, `treatment-swap-cart-sync`, `catalog-session-total`, `consultation-mode-no-premature-price`, `cross-sum-math-integrity`, `v3-audit-homecare-fix`, `v3-fondasional-pilar`, `cart-dedup-total`, `cart-single-primary-domain`, `treatment-followup-personal`, `simulator-100rb-replay` + 1 flaky `production_edge_cases` label). Targeted suites perubahan ini hijau: vaccine-sop-flow 5/5, factual 9/9, knowledge 3/3, agent-runner 7/7; `npm run build` exit 0.
- **Tindak lanjut:** selaraskan ekspektasi test harga dengan data katalog dinamis (jangan hardcode nominal — mandat non-hardcode) ATAU kunci ulang `services_custom.json`; verifikasi manual Sandbox 2 query vaksin setelah deploy.
- **Update 2026-09-12 sore (sinkron lokal 64b43e7):** `catalog-price-matching` + `simulator-100rb-replay` ditulis ulang data-driven (ekspektasi diturunkan dari katalog aktif, tanpa hafalan nama/nominal) → hijau 10/10 + contoh few-shot 100rb diberi disclaimer ilustrasi (otoritas angka = hasil tool). 16 failures lain di atas tetap pre-existing (terbukti ulang via stash di tree bersih).

---

## 46. [Data] Drift live↔seed: RAG 43 vs 34, bank 26 vs 37 (2026-09-12)

- **Status:** open (tech debt) — snapshot live diarsipkan di `docs/live-snapshots/` (`knowledge-chunks-2026-09-12.json`, `few-shot-exemplars-2026-09-12.json`); live TIDAK diubah.
- **Temuan (bukti: dump `row_to_json` live vs `seed-faq.ts` + bank lokal):**
  - 14 judul live tidak ada di seed lokal (kurasi admin via dashboard: mandi, susu, minyak, tumbuh-gigi+bapil, cukur-gundul, paket ibu komplit, "Mending mana pijat sebelum/sesudah imunisasi", dll).
  - 5 seed lokal tidak ada di live (lokasi, durasi, bapil-boleh, terapis sama/bebeda, **artikel "bayi jatuh"**).
  - 2 skenario bank live tidak ada di file lokal ("Treatment setelah/sebelum imunisasi", "Treatment untuk susah makan"); 16 skenario default lokal tidak ada di live (bank live dari seed versi lama).
- **Risiko:** `npm run seed:faq` (deleteMany) akan MENGHAPUS 14 kurasi admin live; seed ulang bank bisa menimpa koreksi admin. Jangan seed live tanpa backup + merge kurasi dulu.
- **Tindak lanjut:** putuskan apakah 14 baris live di-merge ke `seed-faq.ts` + 2 skenario ke bank default (perlu konfirmasi owner).

---

## 47. [Tests] `npm test` mengotori tracked `services_custom.json` (2026-09-12)

- **Status:** open (tech debt).
- **Fakta:** setiap full-suite run memutasi `services_custom.json` di working tree (teramati: Bubble Spa `isActive: false` → `true` + field `serviceType`/`isAddon` hilang — test memutasi katalog in-memory lalu `saveServices()` menulis balik ke file tracked).
- **Risiko:** diff noise / commit tak sengaja berisi perubahan katalog artifisial; harga lokal bisa menyimpang dari DB tanpa disadari.
- **Workaround sekarang:** `git checkout -- services_custom.json` setelah run test bila diff hanya artifak test.
- **Fix yang disarankan:** mock `saveServices`/isolasi file katalog saat test, atau pindahkan katalog test ke fixture temp (butuh persetujuan — menyentuh harness test global).

---

## 48. [Retrieval] Skor token tunggal ambigu: "susah makan" seri vs "susah BAB" (sesi 138207, 2026-09-12)

- **Status:** open (limitation, by-design trade-off), **bukan regresi**.
- **Fakta:** `recommendServiceBySymptoms` (dan cerminannya `therapyScoreOf` di `get-catalog.tool.ts`) memakai overlap token tunggal: gejala `susah makan` → token `susah` cocok dengan "susah BAB" di deskripsi *Pijat Bayi Pulih Ceria* (+2), seri dengan `makan` → deskripsi *Pijat Lahap Juara* (+2). Pemenang seri ditentukan urutan katalog.
- **Dampak saat ini:** TIDAK mengenai jalur produksi sesi 138207 — ekstraksi gejala produksi menghasilkan `['gtm','makan']` (tanpa `susah`), sehingga Lahap Juara menang mutlak dan kini dikunci oleh test `tests/unit/symptom-gtm-recommendation.test.ts`.
- **Risiko:** bila ekstraktor suatu saat mengeluarkan gejala mentah `susah makan`, rekomendasi bisa jatuh ke Pulih Ceria (terapi bapil) padahal keluhannya nafsu makan.
- **Fix yang disarankan (butuh desain):** penilaian frasa multi-kata / pencocokan objek kata benda (`makan` vs `BAB`) di scorer terpusat — menyentuh retrieval global, wajib gerbang regresi `symptoms-therapy-routing` + `catalog-price-matching` sebelum diterapkan.

---

## 49. [Simulator] 4 anomali sesi 138207 — FIXED 2026-09-12 (lapisan fondasional, tanpa dependency baru)

- **Status:** fixed, dikunci 8 unit test baru (`symptom-gtm-recommendation`, `numeric-validator-session-ongkir`, `day-evidence-sameday`).
- **Bukti log:** `logs/llm-2026-09-12.jsonl` (prompt payload turn 10–12) + `logs/app-2026-09-12.log` (`NUMERIC_HALLUCINATION_DETECTED` Rp 20.000, `V3_TOOL_RESERVATION_DAY_GATE_REJECTED` bookingDate "Hari ini").
- **Akar & perbaikan:**
  1. Summarizer hardcode `includes('pulih')` vs grounding goal-tracker (Lahap < 2 thn) → grounding kontradiktif. Fix: summarizer kini memanggil `recommendServiceBySymptoms` yang sama (`src/v3/state/conversation-summarizer.ts`).
  2. Ongkir promo sesi tak diotorisasi sebagai angka mandiri → false-positive + fallback kaku. Fix: ongkir session masuk `authorizedNumbers` (`src/v3/guardrails/numeric-fact-validator.ts`).
  3. Keranjang mengunci varian `> 2 thn` (usia dikarang 24 bln) + label `[Adik]` anak tunggal. Fix: kebijakan default tier BABY saat usia tak diketahui (tie-break di `treatment-catalog.service.ts` + `get-catalog.tool.ts`), prefix kinship hanya bila ≥2 anak (`src/v3/agent/agent-runner.ts`).
  4. `save_reservation` prematur saat "siap bund" + gate menolak "siang ini". Fix: alias same-day (`SAME_DAY_EVIDENCE_ALIASES`) + pesan penolakan hangat + larangan routing eksplisit (`save-reservation.tool.ts`, `persona.ts`).
- **Sisa yang disengaja:** harga paket dasar bayi-sehat disembunyikan dari grounding sampai customer bertanya harga (`goal-tracker.ts`); nominal tetap mengalir via `get_catalog_and_price` saat `inquirePrice=true` (tidak ada kehilangan data harga).

---

## 50. [Tests] Ekspektasi harga test usang vs `services_custom.json` — RESOLVED 2026-09-12

- **Status:** resolved (2026-09-12) — 10 berkas test disinkronkan ke katalog aktif; full suite 263/263 files, 1936 passed + 19 skipped (0 failures).
- **Fakta awal:** 9 file / 12+ test gagal karena drift DATA (Pulih Ceria 70k→75k, Moksa Add-on 10k→Infrared/Moxa 25k, nomenklatur bundle/follow-up), bukan regresi logika.
- **Fix:** ekspektasi promo/total/nama resmi diselaraskan (`agent-tools`, `cart-single-primary-domain`, `catalog-session-total` 95k, `consultation-mode` 95k, `treatment-swap-cart-sync` 75k, `v3-fondasional-pilar` 70k+25k=95k, `treatment-followup-personal` Infrared/Moxa + Newborn + Prenatal Gentle, `cart-dedup-total` nama resmi + `priceDiscussed: true`, `v3-audit-homecare-fix` Oksitosin Fullbody + copy `tampung`/`cekkan`, `v3-persona-rules` regex emoji penutup).

---

## 51. [Tool Contract] `targetPrice` LLM tidak diteruskan ke `executeGetCatalog` — RESOLVED 2026-09-12

- **Status:** resolved (2026-09-12).
- **Fakta:** router prompt memerintahkan LLM mengisi `targetPrice` untuk nominal tanpa nama paket ("100rb berapa menit"), dan schema tool + zod mendukungnya — tetapi `executeToolByName` (`src/v3/tools/tool-registry.ts`) membangun `GetCatalogInput` manual TANPA `targetPrice`, sehingga `hasTargetPrice` selalu false di produksi dan jalur `priceClarification` mati.
- **Fix:** satu baris `targetPrice: args.targetPrice` di `tool-registry.ts` + bug swap varian se-famili di `GoalTracker.resolveAffirmativeSwap` (proteksi Covered Tokens: token milik item cart yang disebut asisten tidak boleh memicu fuzzy-match varian sibling seperti Kids Pulih Ceria). Verifikasi: full suite 263/263 files hijau (0 failures), `npm run build` 0 error.

---

## 53. [Simulator] Direct reply Call 1 kehilangan persona (sesi 309274) — FIXED 2026-09-12

- **Status:** fixed, dikunci 3 unit test (`v3-call1-direct-reply-natural`).
- **Bukti log:** `logs/llm-2026-09-12.jsonl` (`customerPhone 6289999309274`, Turn-0 "siang kak untuk pijat dengan sinar moksa apa bisa homecare ya?", `executedTools: []`, `modelUsed gpt-4o-mini`) → `finalReply` birokratis tanpa sapaan/perkenalan ("Sebelum melanjutkan, bolehkah Bunda memberitahukan ... Ini penting untuk ...").
- **Akar:** jalur direct-reply Call 1 (`finalReply = assistantMessage?.content`, `temperature: 0.2` di `agent-runner.ts:984`) hanya memakai `buildRouterPrompt` yang dirampingkan untuk routing — tanpa panduan sapaan Turn-0 (param `isFollowUp` tidak dipakai), tanpa panduan gaya WhatsApp, tanpa larangan frasa birokrasi.
- **Fix (prompt-level, sesuai User Review Required):** butir 2 `buildRouterPrompt` kini memuat panduan sapaan Turn-0 kondisional (`isFollowUp`), contoh nada luwes, dan daftar hitam frasa birokratis — tetap ringkas (±4 baris) agar router tidak girmuk.
- **Catatan jujur:** pertanyaan "apa bisa homecare" secara ideal memicu `get_clinic_policy_faq` — model memilih jawab langsung. Sensitivitas routing tidak diubah (di luar cakupan; berisiko over-triggering tool).
- **Fase 834128 yang diusulkan ulang di plan ini TIDAK dikerjakan ulang** — sudah live di working tree dan terverifikasi (offer-confirmation gate, core-first durasi, `asksDuration`, pronoun validator). Usulan plan yang tetap ditolak demi mandat: helper regex `isAmbiguousRelativeReference` (gatekeeper intent via regex), daftar nama hardcode, dan sanitasi string `output-sanitizer.ts` (file tidak ada; penggantian kalimat dilarang).

---

## 54. [Simulator] Kaset rusak reprompt + orphan add-on + jam/durasi direct-reply (sesi 188034) — FIXED 2026-09-12

- **Status:** fixed, dikunci 12 unit test baru (`reprompt-payload-integrity`, `cart-orphan-addon-protection`) + 1 butir router di `v3-call1-direct-reply-natural`.
- **Bukti log:** `logs/llm-2026-09-12.jsonl` (`customerPhone 6289999188034`): T5 `calculate_delivery` → rincian Moksa Rp 15k + ongkir Rp 25k = Rp 40k; T6 "Besok apakah bisa kak" (`executedTools: []`) → pengulangan kata-per-kata rincian T5; T7 "Pulih ceria + moksa" → "Estimasi durasi 55 menit" + "kasih tahu jam berapa". `logs/app-2026-09-12.log`: `PRONOUN_SLIP_DETECTED` 02:01:05 + `PRONOUN_REPROMPT_FIXED` 02:01:07 pada turn yang sama — reprompt "berhasil" tetapi output = teks Turn 5 (model merevisi pesan turn salah karena draf tak disertakan).
- **Akar & perbaikan:**
  1. Payload reprompt (numerik/faktual/pronoun) = `[...messages, correction]` tanpa draf asisten. Fix: helper pure `buildRepromptMessages` (dengan guard draf-kosong anti HTTP 400) dipakai ketiga jalur + `currentDraft: finalReply` di pemanggil numerik; reprompt berantai tersinkron otomatis karena tiap tahap membaca `finalReply` terbaru.
  2. `syncCartItems` mem-push ADDON akumulatif tanpa syarat utama. Fix: gate per-turn (keranjang berjalan ATAU pesan se-turn memuat non-addon) + gerbang penutup (tanpa utama → buang semua ADDON). Kasus 3/5/9 terverifikasi hijau (`cart-dedup-total` moksa, `cart-single-primary-domain` combo).
  3. Router Section 2 belum memuat aturan emas. Fix: blok `ATURAN EMAS MUTLAK BALASAN LANGSUNG` (jam/durasi/harga/pronoun) — tanpa menduplikasi panduan Turn-0/anti-birokrasi yang sudah ada.
- **Keputusan bisnis/medis (disetujui user):** ADDON (Moksa, Nebulizer) tidak melayani homecare mandiri — dikunci deterministik di state machine; bot menjelaskan edukatif, keranjang tetap `[]`.
- **Batasan jujur:** ekspektasi nominal plan (Rp 90.000, Rp 115.000) memakai harga lama — test baru menghitung ekspektasi dari katalog aktif (Pulih 75k + Moksa 25k). Simulasi manual `npm run chat` tidak dijalankan (CLI interaktif, tanpa TTY di lingkungan ini) — cakupan diganti replay log + unit test deterministik.

---

## 55. [Simulator] Loop pasca-reservasi + disclaimer same-day + frasa pihak ketiga (sesi 462651) — FIXED 2026-09-12

- **Status:** fixed, dikunci 15 unit test baru (`post-reservation-handoff`, `same-day-disclaimer`, `no-third-party-phrasing`, `symptom-bypass-guard`).
- **Bukti log:** `logs/llm-2026-09-12.jsonl` (`customerPhone 6289999462651`): T4 "untuk perut kembung bisa ya?" (`executedTools: []`) → "Tentu saja bisa ... sangat efektif ... ingin reservasi? hari apa?"; T5 "hari ini jam 16.00" → `save_reservation`, disclaimer "kemungkinan penuh" dibuang Call 2 + "Bidan yang ready"; T6 "oke kak" → T7 "siap" = reassurance nyaris identik (loop).
- **Akar & perbaikan:**
  1. Tanpa handoff, ack "oke/siap" memanggil LLM selamanya. Fix: acknowledgement gate deterministik (0 token) — ack pertama → 1x closing + `isEscalated` + `escalationReason: 'pending_reservation_check'` (machine meneruskan ke `escalateToHumanHandling`: antrean live-chat + alert Telegram + web push; guard `machine.ts:51` membisukan turn berikut); ack berikutnya → senyap total. Flag `booking.needsStaffVerification/handoffClosingSent` persist via `customer.preferences` (tanpa migrasi). Non-ack ("bayar pake apa") SENGAJA tidak di-escalate (butuh jawaban; visibilitas staf via rekaman reservasi) — deviasi sadar dari plan.
  2. Call 2 membuang disclaimer. Fix dua lapis: direktif `[MANDAT SAME-DAY BOOKING]` saat `save_reservation.isSameDay` + safety-net deterministik `ensureSameDayDisclaimer` (append bila tanpa indikasi "penuh").
  3. "Bidan yang ready" diajarkan contoh BENAR di 4 lokasi (few-shot:42, gold:46, persona:199, config:86) — dibersihkan ke "jadwal kami". Invarian test: frasa hanya boleh di kalimat DILARANG.
  4. Bypass keluhan: router mewajibkan `get_catalog_and_price` untuk keluhan fisik baru + A.2 melarang afirmasi mutlak/overclaim/todong ganda.
- **Phase 5 plan (188034) TIDAK dikerjakan ulang** — `buildRepromptMessages` + orphan gate terverifikasi live di working tree.

---

## 56. [Simulator] Reprompt collapse Turn 3 + lokasi ditanya ulang (sesi 310843) — FIXED 2026-09-12

- **Status:** fixed, dikunci 4 unit test (`reprompt-payload-integrity` ditulis ulang ke kontrak isolated) + 1 butir 5b di `v3-call1-direct-reply-natural`.
- **Bukti log:** `logs/llm-2026-09-12.jsonl` (`customerPhone 6289999310843`): T3 "Hari minggu apa bisa ?" (`executedTools: []`) → pengulangan 100% teks Turn 1 (lokasi Waru + todong domisili padahal Wiguna 8.1 km sudah diketahui). Prompt runtime SUDAH memuat seluruh fix sebelumnya (Turn-0, asksDuration, golden router) — kolaps terjadi DI ATAS kode terbaru. `logs/app-2026-09-12.log`: `PRONOUN_SLIP_DETECTED` 02:40:33 → `PRONOUN_REPROMPT_FIXED` 02:40:35 — "fix" yang diadopsi = salinan Turn 1 (lolos recheck karena teks Turn 1 pronoun-clean). Membuktikan `currentDraft` (fix 188034) perlu TAPI tidak cukup: riwayat 8 pesan + draf + koreksi tetap collapse ke pesan salient.
- **Fix:** `buildIsolatedRepromptMessages` (system editor + user draft, TANPA riwayat) menggantikan `buildRepromptMessages` di 3 jalur (numerik/faktual/pronoun). Ekspektasi perilaku lain dipertahankan: suhu per jalur, fallback sunyi faktual (D6 template), reprompt-tidak-membisu pronoun, kompatibilitas `cross-sum` (last=user, sekali panggil — hijau).
- **Router 5b:** lokasi-diketahui → DILARANG tanya lokasi lagi; treatment belum dipilih → konfirmasi cek jadwal + tanyakan rencana perawatan (Call-1 direct reply tidak terjangkau aturan 16 Call-2 — ini celah lapisannya).
- **Trade-off jujur:** retry terisolasi kehilangan konteks gaya percakapan (disangga system editor + draf utuh); efek ke kualitas revisi dipantau via event `*_REPROMPT_FIXED/STILL_INVALID` di log.
- **Fase 2/3/4/6 plan ini TIDAK dikerjakan ulang** — handoff pasca-reservasi, disclaimer same-day, bersih frasa, guard keluhan, orphan gate terverifikasi live di working tree.

---

## 58. [V3] Anti-premature totaling 694493 + copy reservasi + bundling — DONE 2026-09-12

- **Status:** done (gap-only; Fase 4/5 dilewati karena DONE). `calculate_delivery` kini gating `priceDiscussed` (tool input + registry snapshot + runner wiring + pesan + Bagian 4 persona Mode Konsultasi/Transaksional); copy non-same-day `save_reservation` menjadi "sudah kami tampung ... cekkan slot" (tanpa "berhasil dicatat"); kontrak bundling di Call 1 prompt; micro-template usia 2 kalimat; 3 sisa frasa "yang ready" → "jadwal kami".
- **Kunci uji:** `anti-premature-invoicing` (2) + `reservation-response-copy` (1) hijau; `consultation-mode` 4/5 — 1 gagal pre-existing drift katalog (test harap 90.000, katalog kini 75.000/95.000 via perubahan `treatment-catalog` di working tree, bukan dari patch ini).
- **`npm run build` lolos.**

---

## 57. [Tracing] Refaktor fondasional Dedicated LLM Execution Tracing — DONE 2026-09-12

- **Status:** done (5 fase). Kontrak `LlmFlowType` V3 (`NLU_EXTRACTOR/V3_ROUTING/V3_GENERATION/V3_REPROMPT`, legacy tetap diparse), field token/biaya/tools/callSequence, propagasi `bubbleCorrelationId` per-pesan (machine→NLU→V3+sandbox), tracing per-call dengan latensi bersih, UI Debug V3 + filter `customerPhone`.
- **Sisa tech-debt jujur:** (1) `rehydrate` masih `readFile` penuh lalu slice 500 baris terakhir — aman untuk ≤10MB tapi bukan true streaming tail; (2) reprompt numerik tidak mencatat token per-call detail (hanya durasi + koreksi) karena `attemptNumericReprompt` agregat via `addUsage`; (3) `npm test` 14 gagal di working tree ini vs 51 gagal di HEAD bersih — gagal sisa pre-existing/flaky di luar modul tracing (tracing: 14/14 hijau, `npm run build` lolos).
- **Regresi:** `tests/unit/hierarchical-debug-logs.test.ts` (3 legacy V2) tetap hijau; heuristik fallback hanya untuk ID generik `@c.us`.

---

## 52. [Simulator] 4 temuan sesi 834128 — FIXED 2026-09-12 (fondasional, tanpa dependency baru)

- **Status:** fixed, dikunci 11 unit test baru (`ambiguous-choice-clarification`, `catalog-promo-core-first`, `pronoun-validator`) + 1 test diperbarui (`tool-output-scoping` → aturan emas 3 via `asksDuration`).
- **Bukti log:** `logs/llm-2026-09-12.jsonl` (`customerPhone 6289999834128`: turn "apakah ada promo kak ?" → `get_catalog_and_price`, 5 chunk `[Katalog Layanan]` similarity 1.0; turn "boleh deh yang itu" → tanpa tool, cart `Memandikan Bayi Rp 30.000`, balasan "beritahu saya ...").
- **Akar & perbaikan (menyimpang dari plan awal demi mandat repo):**
  1. Kunci sepihak BUKAN dari `detectAgreedTreatment` (sudah user-only, mengembalikan null dengan benar) — melainkan pesan asisten sendiri yang ikut di-exact-match `syncCartItems` + single-PRIMARY-replace menyisakan item terpendek. Fix: offer-confirmation gate — tawaran ≥2 PRIMARY hanya masuk keranjang bila user pernah merujuk itemnya (`goal-tracker.ts`); deteksi tanpa daftar frasa hafalan. Prompt klarifikasi di `persona.ts` sebagai pelengkap.
  2. Etalase support-first: urutan chunk = urutan tool = urutan file katalog (satu titik fix di `executeGetCatalog`). Core-first via heuristik durasi DB (`< 30 mnt` tenggelam, disetujui user) — `category`/`serviceType` tidak membedakan (mandi/cukur/tindik = BABY/STANDARD), `sort_order` DB belum dimuat ke runtime (butuh migrasi + admin UI bila diinginkan kelak).
  3. Durasi proaktif: kontrak tool baru `asksDuration` (schema + zod + registry + instruksi router); strip durasi di `treatments`, `summaryList`, `priceClarification`, `recommendationReason`, chunk observabilitas, dan template persona KONDISI B/aturan 2/contoh (cakupan "semua balasan harga" sesuai pilihan user).
  4. "beritahu saya": TANPA regex-replace kalimat (penggantian string `saya→kami` sengaja sudah dihapus dari pipeline sanitizer — `sanitizer.ts:38-44`). Fix: validator deteksi `pronoun-validator.ts` + reprompt 1x di `agent-runner.ts` (kegagalan reprompt TIDAK membisukan balasan — pelanggaran gaya, bukan faktual) + penguatan aturan 7 di persona. Plan awal yang menunjuk `src/v3/agent/output-sanitizer.ts` keliru — file itu tidak ada.

---

## 59. [V3] Dekomposisi agent-runner.ts → Deep Pipeline + kolaps split-brain NLU — DONE 2026-09-12

- **Status:** done, full suite 266/266 files hijau (1951 passed + 19 skipped, 0 failures), `npm run build` 0 error.
- **Struktur baru (`src/v3/agent/pipeline/`):** `context-grounder.ts` (Stage 1: sinyal/fase/RAG/label + FastResponseGate + POST_RESERVATION_*), `tool-pipeline.ts` (Stage 2-3: eksekusi tool + state reducer), `guardrail-pipeline.ts` (Stage 5: 3 reprompt + same-day + fallback), `generation-stage.ts` (transport LLM + Call 1/Call 2 + telemetri + SAME_DAY_DISCLAIMER). `agent-runner.ts` 1928 → 241 baris (orkestrator murni, tanpa re-export).
- **Phase 5 (machine.ts):** panggilan LLM `EntityExtractor.extract` dipensiunkan; fallback kini `preExtractDeterministic` (0 token, existing). Komplain/permintaan manusia yang luput dari gate deterministik ditangani Call 1 Router via `escalate_to_human` (jalur ini tetap sunyi ke customer: `shouldSendReply=false`).
- **Perubahan perilaku yang disetujui user:** (a) eskalasi complaint/human_agent/OOD tak lagi sunyi pre-V3 via LLM — mengalir lewat V3 tool-escalation (tetap tanpa balasan ke customer, tapi memakan Call 1+2); (b) tanpa re-export — 12 berkas test dimigrasi ke path modul baru; (c) seam mock LLM pindah ke `GenerationStage.executeChatCompletion` (static, spyOn-able); (d) klaim hemat "~2 detik per turn" hanya berlaku untuk pesan yang luput dari fast intents (mayoritas pesan normal sebelumnya juga 2 calls).
- **Deviasi dari plan yang WAJIB dicatat (Confirmation Gate, disetujui eksplisit via prompt):** opsi "full plan apa adanya" dipilih user atas temuan audit (overclaim latensi, matinya V3 DOMAIN GATE untuk OOD, konflik mandat non-hardcode pada keyword darurat, target <250 baris). Pengecualian hardcode sementara: TIDAK ada daftar keyword baru yang ditambahkan — darurat medis tetap mengandalkan `preExtractDeterministic` existing + router `escalate_to_human`.
- **Risiko sisa:** OOD yang hanya terdeteksi semantik LLM kini dijawab V3 dulu (bukan silent-gate pre-V3) kecuali Call 1 memilih `escalate_to_human` — monitor via reason `unresolved_faq`/HUMAN_HANDLING; `EntityExtractor.extract` (LLM) masih dipakai jalur lain bila ada — grep berkala bila ingin dipensiunkan total.


