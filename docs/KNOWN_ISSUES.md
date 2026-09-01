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


