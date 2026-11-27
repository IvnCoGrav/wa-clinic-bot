# Catatan Recon Awal — Kandidat, Bukan Temuan

Semua item di bawah adalah **calon temuan** hasil pembacaan source (recon). Belum ada yang berstatus `confirmed`, belum punya severity, dan belum boleh masuk laporan akhir sebelum melewati F2 (hunting) + F3 (verifier independen).

Tanda verifikasi:
- ✅ = sudah dibaca ulang langsung pada source saat menyusun catatan ini.
- ○ = berasal dari recon otomatis; wajib dicek ulang hunter.

Format: `R-xx` dipakai sebagai referensi silang di [CHECKLIST.md](CHECKLIST.md) Lampiran A.

---

## Bagian 1 — HTTP, auth & sesi

| ID | Indikasi | Bukti | Modul | Cara membuktikan |
|---|---|---|---|---|
| R-01 ✅ | `GET /proof/:reservationId` menyajikan bukti pembayaran tanpa autentikasi; hanya syarat panjang ID ≥ 10 | `src/routes/media.route.ts:511-561` | M08, M18 | Ambil ID reservasi dummy, akses tanpa cookie/API key. Dampak: dokumen finansial (nominal, rekening) terbuka bagi siapa pun yang tahu ID |
| R-02 ✅ | `GET /media/avatar/:customerId` publik dan melakukan `findUnique({where:{id}})` **tanpa filter tenant**, plus fallback `?tenantId=` | `src/routes/media.route.ts:426-446` | M08, M07 | Dua customer dummy beda tenant; akses tanpa auth; cek respons/404 dan cache |
| R-03 ✅ | `POST /api/tracking/pageview` tidak punya autentikasi sama sekali, menulis `LandingPageView`, dan bisa memicu CAPI `PageView` dengan `eventID` dari body | `src/routes/tracking.route.ts:388-493` (CAPI `:464-489`) | M08, M16 | Kirim 10 pageview acak dari IP berbeda; cek baris DB + event CAPI (sandbox/mock). Dampak: polusi metrik & event pixel |
| R-04 ✅ | Login admin mengembalikan **token sesi mentah** di body JSON meski cookie HttpOnly | `src/routes/admin/auth.subroute.ts:132-149` (token `:137`); jalur staf `:225` | M04, M20 | Periksa respons login; cek apakah JS frontend menyimpannya |
| R-05 ✅ | `GET /api/admin/settings/daily-report` mengembalikan `telegramPairingToken`, dan path ini ada di `SETTINGS_READ_ALLOWLIST` — padahal komentar kode menyatakan `/settings/notifications` dilarang karena token yang sama | `src/routes/admin/settings-notifications.subroute.ts:38-57`; `src/domain/role-module-scopes.ts:56-66` | M06, M03 | Sesi staf non-super-admin dengan scope settings; cek apakah token terkirim |
| R-06 ✅ | `verifyMetaSignature` mengembalikan `true` bila signature/secret kosong **atau** `appSecret === 'mock_secret'` selama `strictMode` false | `src/integrations/whatsapp/signature.ts:16-23`; strictness `src/routes/waba-webhook.route.ts:62-70` | M02 | Set `WABA_ALLOW_UNSIGNED_WEBHOOK=true` + `mock_secret`; lihat apakah POST diterima |
| R-07 ✅ | Hook staf menerima `admin_session` dan meng-impersonasi sebagai `SPV_CS`; tenant diambil dari `request.tenantId` → `x-tenant-id` → `?tenant_id` → sesi → default | `src/routes/staff.route.ts:52-88` | M05, M07 | Login admin tanpa `staff_session`; panggil `/api/staff/*` dengan `?tenant_id=` berbeda |
| R-08 ✅ | Login/logout (admin & staf) tidak memakai CSRF guard; hanya `/auth/restore` yang memeriksa header | `src/routes/admin.route.ts:96-105`; `src/routes/staff.route.ts:23-29`; `src/utils/csrf-guard.ts` | M04, M05 | Form lintas-origin ke `/api/admin/auth/logout` (forced logout) & login (forced login) |
| R-09 ✅ | Cookie sesi `Secure` hanya dipasang bila `request.protocol === 'https'` atau `X-Forwarded-Proto` https | `src/routes/admin/auth.subroute.ts:123-125` | M04 | Request HTTP langsung (jika port app terbuka) → cookie tanpa Secure |
| R-10 ○ | WAHA memakai **shared secret statis**, bukan HMAC body; header `X-Waha-Signature` dialiaskan ke secret yang sama; secret global diterima untuk semua tenant | `src/routes/webhook.route.ts:124-145`; `src/config/waha-webhook-auth.ts:23-57` | M01 | Rekam satu request valid, kirim ulang dari IP lain; coba secret global dengan `X-Tenant-Id` lain |
| R-11 ○ | WAHA unsigned hanya ditolak bila `expectedSecrets.length > 0`; `WAHA_ALLOW_UNSIGNED_WEBHOOK` dapat melonggarkan | `src/routes/webhook.route.ts:130-145`; `src/app.ts:42-49` | M01 | Boot tanpa secret (dev) + kirim POST; ulangi dengan flag |
| R-12 ○ | Verify token GET WABA dibandingkan dengan `===`, bukan timing-safe; 500 bila env kosong | `src/routes/waba-webhook.route.ts:27-37` | M02 | Kirim token salah/tepat; ukur respons |
| R-13 ○ | `GET /ready` mengungkap status komponen dan job cron yang gagal | `src/routes/health.route.ts:33-155` | M19 | Akses tanpa auth; cek field yang terekspos |
| R-14 ○ | Static `/admin/*` dan `/vendor/*` dikecualikan dari auth; `/admin/assets/*` & `/admin/geo/*` hanya memakai segmen terakhir tanpa cek containment eksplisit (beda dengan `/vendor/*`) | `src/routes/admin.route.ts:96-105,361-383,486-549` | M04, M08 | `..%2f`, `%252e%252e`, backslash, symlink; bandingkan dengan `/vendor/*` |
| R-15 ○ | CSP admin memakai `script-src 'unsafe-inline'` dan `connect-src https: wss: ws:`; landing & admin berada di origin yang sama pada Caddy bawaan | `src/app.ts:144-152`; `Caddyfile:7-24`; guard origin hanya `pages.<ADMIN_DOMAIN>` `src/routes/admin.route.ts:81-93` | M19, M20 | XSS di landing → akses API admin same-origin; cek CSP aktual |
| R-16 ○ | Rate-limit allowList menyebut `/api/admin/events` dan `/api/events` yang tidak terdaftar; `/api/admin/live-chat/events` (SSE) tidak di-throttle | `src/app.ts:238-244` | M09, M19 | 500 koneksi SSE paralel (sandbox) |
| R-17 ○ | Tenant dari body/query dibaca **sebelum** resolusi sesi di beberapa handler (`backup`, `export`, `google-integration`, `staff-management`, `waba`) | `src/routes/admin/backup.subroute.ts:23,48,131,171,226`; `export.subroute.ts:24`; `google-integration.subroute.ts:178-373`; `staff-management.subroute.ts:398`; `waba.subroute.ts:11-26` | M07 | Sesi staf dengan prefix terlarang; pastikan guard prefix benar-benar menutup |
| R-18 ○ | `POST /api/admin/backup/upload-file` menerima body 50 MB; restore menerima dump — vektor DoS/overwrite | `src/routes/admin/backup.subroute.ts:159-231`; `src/services/backup.service.ts` | M14 | Upload 50 MB dummy (sandbox); dump cacat |
| R-19 ○ | `/api/admin/sandbox/chat` menandai customer nyata `is_sandbox_test` bila nomor salah; cleanup menghapus global berdasarkan flag/prefix | `src/routes/admin/evaluations.subroute.ts:36,153-157`; `src/services/sandbox-cleanup.service.ts:8-22` | M15, M14 | Jalankan dengan nomor dummy lalu cleanup; cek cakupan delete |
| R-20 ○ | `X-Admin-Identity` hanya label; `X-API-KEY` (super admin) dapat memilih tenant lewat header/query | `src/routes/admin.route.ts:121-124`; `src/routes/admin/route-helpers.ts:18-32` | M06, M07 | API key + `X-Tenant-Id`; pastikan hanya API key, bukan cookie |
| R-21 ○ | `ADMIN_API_KEY` diterima sebagai `password`/`apiKey` pada body login dan dibandingkan timing-safe | `src/routes/admin/auth.subroute.ts:92,114-115` | M04, M17 | Uji login dengan API key; cek rate limit & audit |
| R-22 ○ | Debug admin (`/api/admin/debug/*`, `sandbox`, `llm-logs`) aktif tanpa gate `NODE_ENV`; `?tenant=` diterima langsung | `src/routes/admin/evaluations.subroute.ts:458-599`; `meta-attribution.subroute.ts:140-799` | M14, M21 | Sesi non-super-admin; `?tenant=` lain |

---

## Bagian 2 — Integrasi, LLM, RAG, outbound

| ID | Indikasi | Bukti | Modul | Cara membuktikan |
|---|---|---|---|---|
| R-23 ○ | Semua fetch media WhatsApp (WAHA & WABA) tanpa `maxContentLength`/batas redirect → memori penuh sebelum cek kuota | `src/integrations/waha/client.ts:1201-1207,1264-1268`; `src/routes/waba-webhook.route.ts:198-202`; `src/services/media.service.ts:334` | M01, M02, M18 | Kirim media besar/URL redirect (sandbox), ukur memori |
| R-24 ○ | Nama profil WhatsApp (`pushname`) masuk ke system prompt **tanpa sanitasi**, di luar delimiter `<customer_message>` | `src/routes/webhook.route.ts:810-816` → `src/v3/state/goal-tracker.ts:508` | M11 | Set nama profil berisi instruksi, lihat prompt di `llm-*.jsonl` |
| R-25 ○ | Command Telegram `/clean` menulis `storage/.clean-request` yang dieksekusi cron host; `/server` membocorkan metrik host | `src/routes/telegram-webhook.route.ts:444-546`, `306-438` | M03, M15, M19 | Chat terotorisasi mengirim `/clean`; cek file & cron |
| R-26 ○ | `llm_audit_logs.customer_phone` tidak dimasking; `llm-*.jsonl` menyimpan **system prompt + seluruh pesan** dengan redaksi terbatas (telepon/nama) | `src/utils/llm-audit-buffer.ts:153,170-173`; `src/v3/agent/pipeline/generation-stage.ts:1063`; `src/utils/llm-execution-logger.ts:216-233` | M21 | Isi file log dummy; cek alamat/keluhan/anak |
| R-27 ○ | `receiptVisionBaseUrl` dari setting tenant dipakai sebagai endpoint LLM untuk **gambar bukti bayar** → tenant admin bisa mengirim data pasien ke host sembarang | `src/services/payment-receipt-vision.service.ts:132-137,160-195` | M16 | Set base URL host uji (sandbox), lihat request keluar |
| R-28 ○ | Endpoint Web Push dari klien disimpan tanpa validasi skema/host, lalu di-POST | `src/routes/admin/push.subroute.ts:43-66`; `src/services/web-push.service.ts:289,399,456` | M16 | Daftarkan endpoint internal, picu push (sandbox) |
| R-29 ○ | `pricelist_image_url` tenant boleh URL http(s) apa pun, di-fetch server-side tanpa allowlist/ukuran | `src/services/pricelist-config.service.ts:83-104`; `src/integrations/waha/client.ts:642-651` | M16, M08 | Set URL internal, kirim pricelist |
| R-30 ○ | `sendImageDetailed` punya cabang path lokal (`existsSync` + `readFile`) tanpa validasi di seam | `src/integrations/waha/client.ts:652-674` | M16, M18 | Panggil seam dengan path di luar `media/outbound` |
| R-31 ○ | Rahasia di URL: `access_token` Meta CAPI, API key Google, token bot Telegram di path | `src/services/capi.service.ts:1115,1330`; `src/integrations/google-maps/geocoding.ts:943,1024`; `src/services/alert.service.ts:217` | M16, M17 | Periksa access log/proxy egress |
| R-32 ○ | `Tenant.settings.receiptVisionApiKey` & `integrationGuards.*.apiKey` disimpan **plaintext** di JSON DB | `src/services/integration-guard.service.ts:60-95`; `payment-receipt-vision.service.ts:135-136` | M16, M17 | Baca baris DB dummy |
| R-33 ○ | Prompt RAG pra-retrieval dimasukkan sebagai **teks sistem otoritatif** (bukan kutipan), dengan rank floor 0.35 | `src/v3/agent/pipeline/context-grounder.ts:505-531`; `generation-stage.ts:947-952` | M12, M11 | Chunk berisi instruksi; lihat kepatuhan model |
| R-34 ○ | Riwayat asisten diputar ulang verbatim ke prompt → injeksi lama bertahan antar turn | `src/utils/prompt-injection-sanitizer.ts:95-108`; `agent-runner.ts:214` | M11 | Kirim instruksi, balas, lanjutkan sesi |
| R-35 ○ | `/ready` & `/api/webhook/telegram` GET membocorkan info tanpa auth | `health.route.ts:33-155`; `telegram-webhook.route.ts:14-20` | M19 | Akses anonim |

**Kontrol kuat yang sudah terverifikasi (jangan diburu ulang tanpa alasan):** `parallel_tool_calls:false` (`generation-stage.ts:660`), validasi argumen Zod (`tool-schemas.ts`), masking tool fisik (`tool-masker.ts`), query knowledge parameterized (Prisma tagged template), sanitasi HTML landing + CSP nonce, `maxRedirects:0` + blokir IP pada avatar proxy, enkripsi AES-256-GCM token tenant.

---

## Bagian 3 — Data, tenancy, worker, deploy

| ID | Indikasi | Bukti | Modul | Cara membuktikan |
|---|---|---|---|---|
| R-36 ○ | Tidak ada FK `tenant_id → Tenant`, tidak ada RLS, tidak ada Prisma middleware; isolasi 100% manual di ~1.057 panggilan Prisma pada 197 file | `prisma/schema.prisma` (54 model); `rg '$use\|\$extends'` kosong | M07, M14 | Hitung query tanpa filter; dua tenant dummy |
| R-37 ○ | `GET /api/admin/landings/:id` memakai `findUnique({id})` tanpa tenant; label assignment `label.findUnique({id})` tanpa tenant | `landings.subroute.ts:311-320`; `labels.subroute.ts:443-449` | M07 | ID tenant lain |
| R-38 ○ | `GET /api/admin/services` membaca katalog **default tenant** untuk semua admin; `getAllServices(tenantId = DEFAULT_TENANT_ID)` | `settings-catalog.subroute.ts:9-12`; `treatment-catalog.service.ts:1192` | M07, M06 | Dua tenant dengan katalog berbeda |
| R-39 ○ | Backup global: list menampilkan semua file; `download/:fileName` tanpa cek kepemilikan tenant; dump membaca 12 tabel tanpa filter tapi diberi stempel tenant | `backup.service.ts:79-83,149-200,280-302`; `backup.subroute.ts:85-142` | M14 | Dua tenant; unduh backup tenant lain |
| R-40 ○ | Backup mingguan otomatis hanya `DEFAULT_TENANT_ID` | `cron.service.ts:795` | M15 | Tenant kedua tidak pernah dibackup |
| R-41 ○ | `broadcast_queue` worker dibuat saat modul di-import; `GET /api/admin/health` mengimpor modul itu → worker berjalan di proses web di luar gating `SEPARATE_WORKER`/`CHAT_CONSUMER_ENABLED`; producer-nya dead code | `broadcast-queue.service.ts:60-85,308`; `settings-general.subroute.ts:819` | M15 | Panggil `/api/admin/health`, cek worker/Redis |
| R-42 ○ | Uniqueness parsial `Conversation` hanya ada di migration, bukan schema; `LegacyStaging.phoneNumber`, `LandingPageView.eventId`, `PushSubscription.endpoint` unik **global** | `prisma/migrations/20261109120000_.../migration.sql:26-28`; schema `:786,808,1147` | M14, M07 | Dua tenant, tabrakan unik |
| R-43 ○ | `README.md` mencantumkan kredensial default WAHA `admin/admin12345`; compose hardcode username `admin` (password dari env) | `README.md:125`; `docker-compose.yml:195-198` | M19 | Baca docs + compose |
| R-44 ○ | `hermes-net` eksternal dipakai `app`, `worker`, `caddy`, `waha`; apa pun di network itu bisa mencapai `app:3000` dan `waha:3000` (API/dashboard) | `docker-compose.yml:81-82,126-127,185-187,230-233` | M19 | Inspeksi network |
| R-45 ○ | Script deploy hardcode IP/user produksi dan `StrictHostKeyChecking=no` | `scripts/deploy-to-server.js:23-27` + 6 script serupa | M17, M19 | Baca script |
| R-46 ○ | CI tidak punya dependency audit/SAST/container scan; gate test hanya membandingkan nama test gagal dengan baseline tetap | `.github/workflows/ci.yml:44-97`; `scripts/audit-baseline-diff.mjs:46-58` | M17 | Baca workflow |
| R-47 ○ | `.env` lokal memuat kunci yang tidak ada di `.env.example` (`COMMANDCODE_API_KEY`, `OPENROUTER_API_KEY`, `WAHA_DASHBOARD_PASSWORD`, dll.); `APP_DOMAIN` tidak ada | `.env` (nama saja) vs `.env.example` | M17 | Diff nama env |
| R-48 ○ | `tenantId` dari header dipakai `path.join(MEDIA_ROOT, scope, tenantId)` tanpa validasi pola (write path) | `media.service.ts:158-171`; `route-helpers.ts:18-31` | M18 | `x-tenant-id: ../../x` (sandbox) |
| R-49 ○ | Pencarian tenant WAHA/WABA memakai `findFirst` pada kolom tanpa unique index → duplikat mengarah ke tenant arbitrer | `waha-tenant.service.ts:42-45`; `waba-tenant.service.ts:33-35`; schema `:861,863` | M01, M02 | Duplikat nilai di DB dummy |
| R-50 ○ | `audit.service` fail-soft dan memakai `default-tenant` bila tenant kosong → audit lintas tenant salah atribusi | `audit.service.ts:25-39,69-79` | M21, M07 | Aksi tanpa tenant |
| R-51 ○ | `logs/app-*.log` tanpa batas ukuran per file (ditemukan 88 MB); retensi hanya berbasis tanggal | `log-buffer.ts:22-23,103-128` | M21 | Ukur file |
| R-52 ○ | Staff `complete` menerima `forceUnpaid` dari body; supervisor override assignment | `today.subroute.ts:976-1028`; `staff-reservation.service.ts:2465-2518` | M13 | Complete tanpa bayar |

**Catatan arsitektur:** tidak ada RLS/tenant FK — ini bukan satu bug, tetapi berarti setiap query baru berpotensi bocor. Check M07-14 sengaja dibuat sebagai audit sistemik, bukan per-endpoint.

---

## Bagian 5 — Kandidat baru dari revalidasi M00

Kandidat ini muncul saat memverifikasi 16 temuan lama; semuanya **belum** `confirmed` dan wajib lewat verifier.

| ID | Indikasi | Bukti | Modul | Cara membuktikan |
|---|---|---|---|---|
| R-53 ✅ | Route staf tidak mengikat tenant ke sesi; `resolveSessionTenantId` membaca `x-tenant-id`/`?tenant_id` | `src/routes/staff.route.ts:96-99` (tidak set `request.tenantId`), `src/routes/staff/today.subroute.ts:47` | M05, M07 | Login terapis tenant A, panggil `/api/staff/today-tasks?tenant_id=B` |
| R-54 ✅ | `admin_session` + body/query tenant mengalahkan sesi di route tertentu; rewrite body hanya untuk staf | `admin.route.ts:313-320` (hanya `staffTenantId`), `backup.subroute.ts:23,48,131,171,226`, `export.subroute.ts:24`, `google-integration.subroute.ts:135-373`, `push.subroute.ts:173` | M07 | Cookie admin A + `?tenantId=B` ke backup/export |
| R-55 ✅ | CSRF guard dilewati hanya karena header `x-api-key` **ada**, bukan valid | `admin.route.ts:196-208` (`if (isStateChanging && !clientKey)`) | M04 | Cookie valid + `x-api-key: junk` pada PATCH admin |
| R-56 ✅ | Nonce OAuth dibuat tapi tidak disimpan/diverifikasi → replay state dalam TTL | `google-oauth.client.ts:88` (nonce), `:106-140` (parse tanpa store) | M16 | Panggil `parseState` dua kali dengan state sama |
| R-57 ✅ | Google Sheets memakai `USER_ENTERED` untuk baris mentah; netralisasi formula tidak di lapisan itu | `sheets-client.ts:207-233`, `row-formatter.ts:259-294` | M18, M16 | Nama pasien `=HYPERLINK(...)` lalu sync |
| R-58 ✅ | CSV di dashboard (RetentionTab) tidak meng-escape kutip/formula | `packages/admin-dashboard/src/components/analytics/RetentionTab.tsx:185-198` | M20 | Nama staf `a","=1+1` lalu export |
| R-59 ✅ | `/server` Telegram tidak memeriksa pengirim; secret webhook hanya membuktikan asal Telegram, bukan admin | `telegram-webhook.route.ts:306-438` (bandingkan `/set_*` yang memanggil `findTenantForChat` di `:179`) | M03 | Chat asing di bot mengirim `/server` |
| R-60 ✅ | Token pairing Telegram tanpa TTL/sekali-pakai, disimpan plaintext, dan lookup tanpa tenant (SUPER_ADMIN staf lintas tenant) | `telegram-webhook.route.ts:74-129`; `staff-notification.service.ts:41-58` | M05, M03 | Pakai token dua kali; staf SUPER_ADMIN tenant A baca token tenant B |
| R-61 ✅ | Restore backup JSON menerima baris apa adanya: `staff.role`/`password_hash` ikut ditulis | `backup.service.ts:562-587` (`create: { ...st }`), `:423-429` hanya cek bentuk JSON | M14 | Unggah `.json.gz` berisi staff SUPER_ADMIN |
| R-62 ✅ | Allowlist rate limit berbasis prefix, bukan path exact; `/api/admin/events` & `/api/events` tidak ada route → 404 flood tanpa throttle | `app.ts:230-244` | M19 | 120 request ke `/api/admin/live-chat/events/x` |
| R-63 ✅ | Arsip `/reset` bersifat sementara: pesan berikutnya me-revive customer; arsip tetap tampil di beberapa endpoint | `customer.service.ts:221-229`; `customers.subroute.ts:89,575`; `livechat.subroute.ts:111`; `customers-export.subroute.ts:191`; `customer.service.ts:2649` | M07, M01 | `/reset` → kirim "Halo" → cek daftar |
| R-64 ✅ | Tracking membandingkan Origin dengan `request.hostname` (dari header Host klien) → klien non-browser bisa lolos | `tracking.route.ts:42-68` | M08 | POST dengan `Host` + `Origin` sama |
| R-65 ✅ | `/ready` mengirim inventaris komponen, status WAHA/WABA, nama cron gagal, dan `err.message` mentah | `health.route.ts:84-154` | M19 | Akses anonim `/ready` |
| R-66 ✅ | Frontend memakai `role: data.user.role || 'super_admin'`; `/me` tidak punya `sessionType` | `AuthContext.tsx:137`; `auth.subroute.ts:388-494` | M20, M05 | `/me` tanpa role |
| R-67 ✅ | Draft live chat & form reservasi (berisi PII) disimpan di localStorage dan tidak dibersihkan saat logout | `useLiveChatDrafts.ts:5,14`; `useFormDraft.ts:195-200`; `AuthContext.tsx:270-273` | M20 | Simpan draft → logout → cek storage |

**Status temuan lama setelah revalidasi:** 01, 02, 03, 05, 06, 08, 10 (state), 12 (CSV server), 14, 15, 16 = fixed di source; 04, 07, 09, 10 (nonce), 11, 12 (Sheets/klien) = partial; `#129.1` sebagian besar sudah tidak berlaku (hanya 2 pemakaian data nyata), `#129.5` sebagian.



Agar hunter tidak membuang anggaran, kontrol berikut sudah terlihat benar di source (tetap boleh diuji, tapi prioritas rendah):
- Tool masking fisik + `parallel_tool_calls:false` + validasi Zod argumen tool.
- Enkripsi AES-256-GCM token tenant; produksi menolak fallback ke `ADMIN_API_KEY`.
- Avatar proxy: `maxRedirects: 0` + blokir IP privat (kecuali lookup tenant-nya, R-02).
- Landing HTML: `sanitize-html` + CSP nonce.
- Cron: leader election via `cron_leases` + advisory lock; `SEPARATE_WORKER` memisahkan proses.
- Backup: enkripsi sebelum tulis, restore menolak SQL mentah, checksum diverifikasi.
- Media simpan: nama UUID + ekstensi hasil sniff; path baca dicek containment.
- Knowledge retrieval: query parameterized (Prisma tagged template), bukan string SQL.
