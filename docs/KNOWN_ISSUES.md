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
  - `20260721070211_init` hanya membuat 3 tabel (`customers`, `conversations`, `messages`).
  - Tidak ada satupun migrasi yang `CREATE TYPE "FollowUpStatus"` maupun `CREATE TABLE "follow_ups"`,
    `follow_up_templates`, tabel treatment/catalog, dst. — padahal semua ada di `schema.prisma`.
  - `20260801000000_add_failed_followup_status` hanya `ALTER TYPE "FollowUpStatus" ADD VALUE 'FAILED'`
    pada enum yang tak pernah dibuat di chain.
  - Kemungkinan besar proyek memakai `db push` di masa awal (schema jadi sumber kebenaran, bukan
    migrasi), lalu migrasi dimulai belakangan tanpa baseline penuh.
- **Mengapa tidak ditambal begitu saja:** menulis migrasi baru yang `CREATE TYPE "FollowUpStatus"`
  di urutan awal akan sukses di shadow DB, tetapi berisiko **gagal di env existing** yang DB-nya sudah
  punya enum/tabel tersebut (`type already exists` / `relation already exists`) — pola yang sama dengan
  masalah `children` (lihat #2). Perbaikan hanya boleh dilakukan dengan shadow DB lokal aktif untuk
  verifikasi replay penuh, lalu direncanakan migrate resolve per env.
- **Fix yang disarankan (butuh verifikasi replay):** buat migrasi baseline squash yang merekonstruksi
  schema penuh, ATAU tambahkan migrasi `CREATE TYPE "FollowUpStatus"` di urutan sebelum referensi
  pertama, lalu verifikasi `migrate diff --from-migrations` kembali menghasilkan empty migration.
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

