# Katalog Modul & Daftar Periksa Audit

Dipakai bersama [README.md](README.md) (fase, gate, prompt) dan [REVALIDATION.md](REVALIDATION.md) (temuan lama).

Cara baca tiap modul:
- **Profile / agen** — saran profile skill dan perkiraan jumlah penugasan.
- **Entry surface** — semua pintu masuk yang harus punya unit ledger.
- **Target** — titik awal pembacaan (bukan daftar lengkap; hunter wajib menelusuri sibling path).
- **Check** — invariant yang harus dibuktikan/dipatahkan. `ID` dipakai sebagai nama unit kerja di papan tugas.

Kelas: `INJ` Injection · `AC` Access control · `RES` Resource & file handling · `CRYPT` Cryptography & secrets · `BIZ` Business logic · `LEAK` Feature abuse & data leakage · `CHAIN` Chained vulnerabilities · `TENANT` Data isolation & lifecycle · `AI` AI/LLM · `WEB` Web protocol & auth · `CLIENT` Client-side · `SUPPLY` Supply chain · `CLOUD` Cloud/deployment · `MSG` Protocols/RPC/messaging.

---

## M00 — Revalidasi temuan lama & baseline

**Profile:** standard · **Agen:** 8–12 · **Depends:** F0
**Entry surface:** tidak ada (audit atas bukti lama) · **Target:** `docs/CYBERSECURITY_AUDIT_REPORT.md`, `docs/KNOWN_ISSUES.md` #129/#367/#336/#29/#128/#134/#179/#250
**Keluaran:** `prior-ledger.json` berisi status revalidasi tiap item + unit baru untuk yang belum beres.

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M00-01 | 16 temuan lama dipetakan ke unit modul dan tidak ada yang hilang | — | REVALIDATION.md | tabel 16/16 terisi |
| M00-02 | Temuan lama yang diklaim fixed masih benar pada source sekarang | AC/INJ | per temuan | trace `file:line` + test lokal bila memungkinkan |
| M00-03 | Sisa #129.1 (19 subroute `DEFAULT_TENANT_ID`) dihitung ulang, bukan dipercaya angkanya | TENANT | grep per file | hitungan baru + contoh query tanpa filter |
| M00-04 | #129.2 status seed RBAC diverifikasi di DB dummy | AC | `role_api_scopes`, `roles.subroute.ts` | isi tabel + route yang lolos |
| M00-05 | #129.3 soft-delete `/reset` tidak bocor di endpoint lain | TENANT | `customers.subroute.ts`, export, map-points | daftar endpoint yang masih menampilkan arsip |
| M00-06 | #129.5 env wajib terdokumentasi & divalidasi saat boot | CRYPT | `.env.example`, `src/app.ts` | daftar env hilang + efek boot |
| M00-07 | #367 kontrak `/api/admin/auth/me` untuk sesi staf vs admin | AC | `admin/auth.subroute.ts` | respons kedua jenis sesi |
| M00-08 | #134/#179 tidak ada kredensial/PII live di tree & history | CRYPT | `git log`, docs | hasil scan (tanpa mencetak nilai) |
| M00-09 | #128 silent fallback DB memengaruhi keputusan otorisasi | TENANT | 74 titik fallback | daftar fallback di jalur auth/tenant |
| M00-10 | #250 isolasi balasan AI worker | CLOUD | `src/worker.ts`, queue | routing tenant pada job |

**Gate:** semua item punya status (`confirmed`/`needs_validation`/`rejected`/`superseded`) + modul tujuan.

---

## M01 — Ingress WhatsApp WAHA

**Profile:** deep · **Agen:** 16–22 · **Depends:** F0, M00
**Entry surface:** `POST /webhook` (teks, gambar, audio/PTT, dokumen, lokasi, kontak, reaksi, status ack/read, quoted)
**Target:** `src/routes/webhook.route.ts` (1494 baris), `src/config/waha-webhook-auth.ts`, `src/services/ingress/inbound-guard.service.ts`, `src/services/burst-coalesce.service.ts`, `src/services/turn-recovery.service.ts`, `src/integrations/whatsapp/waha.driver.ts`
**Prior:** #14 (`/state`, `/reset`), #129.4, #365 (quote), `webhook.route.ts` adalah file terbesar

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M01-01 | Secret webhook wajib di produksi, fail-closed, timing-safe, dan tidak bisa dilewati lewat header tenant | AC | `app.ts:42-47`, `webhook.route.ts:124-140` | request tanpa secret ditolak; cek cabang `expectedSecrets.length===0` |
| M01-02 | `X-Tenant-Id` tidak boleh memilih tenant/secrets sembarangan | TENANT | `resolveExpectedWebhookSecrets` | dua tenant dummy, secret silang |
| M01-03 | Payload divalidasi: tipe pesan, bentuk `_data`, array, properti proto, ukuran | INJ | parser webhook | fixture aneh: `__proto__`, tipe campur, null |
| M01-04 | Idempotensi: kiriman ulang tidak memproses pesan dua kali | MSG | `turn-recovery.service.ts`, `InboundTurn` | dua POST identik → satu turn |
| M01-05 | Pesan basi/out-of-order ditolak sesuai epoch, bukan hanya timestamp klien | BIZ | `inbound-guard.service.ts` | pesan masa lalu/masa depan |
| M01-06 | Identitas pengirim tidak bisa dipalsukan (from/participant/author, grup, LID) | AC | normalizer | payload dengan from ≠ participant |
| M01-07 | Media: host allowlist, batas ukuran, MIME sniff, nama file aman, tidak ada traversal | RES | download media | URL internal/metadata, file 100MB, `../` |
| M01-08 | Bypass admin/Skip tidak bisa dipicu customer | AC | inbound-guard | nomor admin dari DB vs env, spoof |
| M01-09 | Opt-out (STOP) tidak bisa dilewati jalur follow-up/template | BIZ | `waba-optout.service.ts`, follow-up | daftar jalur kirim yang memeriksa opt-out |
| M01-10 | Flood/burst tidak membanjiri worker (quota, coalesce, backpressure) | RES | `burst-coalesce`, rate limit | 1.000 pesan dummy (sandbox) |
| M01-11 | Teks masuk tidak masuk log mentah/PII | LEAK | logger | contoh baris log |
| M01-12 | Command internal (`/state`, `/reset`) hanya untuk admin berlabel & tidak merusak data | AC/BIZ | handler command | request customer vs admin |

**Gate:** unit untuk semua tipe pesan + status callback; tidak ada unit `planned`.

---

## M02 — Ingress WABA (Meta Cloud API)

**Profile:** deep · **Agen:** 12–16 · **Depends:** F0
**Entry surface:** `GET|POST /api/webhook/waba` (challenge, messages, statuses, template, media)
**Target:** `src/routes/waba-webhook.route.ts`, `src/integrations/whatsapp/waba.driver.ts`, `signature.ts`, `wabaTenantService`
**Prior:** audit 2026 (signature), #129.1 `waba.subroute.ts`

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M02-01 | Verifikasi GET memakai perbandingan aman dan tidak memantulkan input berbahaya | WEB | route GET | token salah/tepat, payload echo |
| M02-02 | HMAC dihitung atas raw body, bukan JSON hasil parse ulang | CRYPT | `rawBody` | body dengan spasi/urutan kunci berbeda |
| M02-03 | Secret hilang → fail-closed; `WABA_ALLOW_UNSIGNED_WEBHOOK` tidak bisa aktif tak sengaja | AC | route:46-70 | env unset/true, NODE_ENV produksi |
| M02-04 | `phone_number_id` → tenant tidak bisa dipalsukan untuk menulis ke tenant lain | TENANT | `resolveTenantByPhoneNumberId` | dua tenant dummy |
| M02-05 | Status callback (sent/delivered/read/failed) tidak bisa memanipulasi status pesan tenant lain | MSG | handler statuses | wa_message_id lintas tenant |
| M02-06 | Media ID diambil dengan batas ukuran/tipe dan tidak mengikuti URL arbitrer | RES | media fetch | ID salah, URL internal |
| M02-07 | Pesan ganda & out-of-order tidak menggandakan efek | MSG | dedup | dua POST identik |
| M02-08 | Template/format body tidak bisa dipakai untuk injeksi ke nomor lain | BIZ | send path | nomor tujuan dari payload vs sesi |
| M02-09 | PII tidak bocor ke log/error | LEAK | logger | contoh log |

---

## M03 — Telegram (ingress & egress)

**Profile:** standard · **Agen:** 10–14 · **Depends:** F0
**Entry surface:** `POST /telegram-webhook`, bot commands, pengiriman laporan/alert
**Target:** `src/routes/telegram-webhook.route.ts` (491), `src/services/telegram.service.ts`, `daily-report.service.ts`, `alert.service.ts`
**Prior:** audit #01 (diklaim fixed)

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M03-01 | Secret token wajib, fail-closed, timing-safe, tidak ada cabang opsional | AC | `telegram-webhook.route.ts:27-34` | request tanpa secret → 403 |
| M03-02 | Hanya chat/topic yang diizinkan yang bisa memicu aksi | AC | allowlist chat_id | chat asing, grup lain |
| M03-03 | Command (`/state`, `/reset`, lain) punya otorisasi & tidak mengeksekusi data mentah | INJ | command handler | command dari chat tidak berwenang |
| M03-04 | Isi pesan tidak dirender sebagai HTML/Markdown berbahaya | INJ | sendMessage | `<script>`, markdown link |
| M03-05 | Bot token tidak bocor ke respons API, dashboard, log, atau pesan error | CRYPT | settings, logger | grep respons `telegramBotToken` |
| M03-06 | Pairing bidan: token sekali pakai, terikat staf, tidak bisa ditebak | AC | `staff/auth.subroute.ts:242-` | dua staff, token bekas |
| M03-07 | Replay/duplikasi update Telegram tidak menggandakan aksi | MSG | update_id | kirim ulang update |
| M03-08 | Alert webhook keluar tidak bisa diarahkan ke URL internal | RES | `ALERT_WEBHOOK_URL` | URL metadata/internal (sandbox) |

---

## M04 — Autentikasi & sesi Admin

**Profile:** deep · **Agen:** 16–22 · **Depends:** F0
**Entry surface:** `/api/admin/auth/{login,logout,me,restore}`, semua `/api/admin/*`, `/admin/*` statis
**Target:** `src/routes/admin.route.ts:69-200`, `src/routes/admin/auth.subroute.ts`, `AdminSessionService`, `src/utils/auth-access-log.ts`, `src/services/admin-session*`
**Prior:** #02, #09, #367, #129.4

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M04-01 | `X-API-KEY` dibandingkan timing-safe dan tidak pernah diterima dari query/cookie | CRYPT | `safeCompare` | key salah/tepat, timing |
| M04-02 | Sesi disimpan sebagai hash, bukan plaintext; tidak ada penulisan file sesi | CRYPT | `admin_sessions` | isi baris DB dummy |
| M04-03 | Cookie `admin_session`: HttpOnly, Secure, SameSite, Path, umur, rotasi saat login | WEB | login handler | header Set-Cookie |
| M04-04 | Login: rate limit, lockout, pesan seragam, bcrypt cost, tidak ada user enumeration | AC | login | 100 percobaan sandbox |
| M04-05 | Session fixation & invalidasi: login baru membatalkan sesi lama; logout menghapus server-side | WEB | session service | token lama setelah logout |
| M04-06 | CSRF guard `X-Requested-With` mencakup semua mutasi cookie-auth, termasuk subroute di luar hook | AC | semua `POST/PUT/PATCH/DELETE /api/admin` | inventaris route + uji tanpa header |
| M04-07 | `/api/admin/auth/me` tidak membocorkan identitas/role lintas jenis sesi (#367) | LEAK | `auth.subroute.ts:460-490` | respons sesi staf & admin |
| M04-08 | `/api/admin/auth/restore` tidak bisa memulihkan sesi tanpa bukti kepemilikan | AC | restore | token acak/kedaluwarsa |
| M04-09 | Fallback sesi memori saat DB mati tidak membuka bypass/multi-instance inconsistency | AC | session service | DB mati (mock) |
| M04-10 | Reset/ubah password (bila ada) memvalidasi kepemilikan & membatalkan sesi lain | AC | auth | alur reset |
| M04-11 | Endpoint statis `/admin/*`, `/vendor/*`, `sw.js`, `manifest.json` tidak bisa traversal | RES | `admin.route.ts:370-570` | `..%2f`, `%2e%2e`, backslash, symlink |
| M04-12 | Log 401/503 tidak memuat kredensial penuh | LEAK | `auth-access-log.ts` | contoh baris |

---

## M05 — Autentikasi & sesi Staf (Bidan)

**Profile:** deep · **Agen:** 12–18 · **Depends:** F0, M04
**Entry surface:** `/api/staff/auth/{login,restore,logout,me}`, `/api/staff/*`, pairing Telegram
**Target:** `src/routes/staff/auth.subroute.ts`, `staff-auth.service.ts`, `staff.route.ts`, `staff/today.subroute.ts`
**Prior:** #03 (BOLA pairing), #367, #336

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M05-01 | Pairing token: entropi cukup, TTL, sekali pakai, terikat staf+tenant | AC | restore/pairing | token bekas, token staf lain |
| M05-02 | `staff_session` cookie: HttpOnly/Secure/SameSite/umur; token di DB sebagai hash | WEB | service | Set-Cookie + isi DB |
| M05-03 | Role diambil dari DB tiap request, bukan dari token/klien | AC | validateSession | ubah role di DB dummy |
| M05-04 | IDOR: setiap `:id` (reservasi, customer, chat) di-scope tenant+penugasan | TENANT | `staff/today.subroute.ts`, chat | dua bidan dummy |
| M05-05 | PII pelanggan dimasking untuk peran terapis | LEAK | `pii-masker`, respons | nomor/alamat di respons |
| M05-06 | `staff_session` diterima `/api/admin/*` → cek scope apa yang diberikan | AC | `admin.route.ts:126-158` | route admin dengan cookie staf |
| M05-07 | Logout & ganti perangkat membatalkan sesi server (termasuk saat offline) | WEB | `#367` | token lama |
| M05-08 | Login staf: rate limit, lockout, pesan seragam | AC | login | percobaan berulang |
| M05-09 | Skor/scorecard: `staffId` dari sesi, bukan parameter | AC | `staff/scorecard.subroute.ts` | param lawan |
| M05-10 | Edit/hapus pesan chat oleh staf hanya pada percakapan miliknya | AC | livechat staf | percakapan bidan lain |

---

## M06 — RBAC & otorisasi

**Profile:** deep · **Agen:** 14–20 · **Depends:** F0, M04, M05
**Entry surface:** semua route `/api/admin/*` dan `/api/staff/*`, UI path matrix
**Target:** `src/domain/role-module-scopes.ts`, `role-scope.service.ts`, `admin/roles.subroute.ts`, `admin/staff-management.subroute.ts`, `admin.route.ts`, `packages/admin-dashboard/src/config/actionPermissions.ts`, `rolePermissions.ts`
**Prior:** #04, #129.2, #125 (mismatch UI/API)

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M06-01 | Default-deny untuk role yang punya baris scope; hanya role legacy yang dikecualikan | AC | `role-scope.service.ts` | role baru tanpa scope → 403 |
| M06-02 | Prefix `superAdminOnly` benar-benar menutup semua route sensitif (bukan hanya daftar hafalan) | AC | `role-module-scopes.ts` | matriks route × role |
| M06-03 | Scope `:param` tidak bisa dieskalasi (path param injection) | AC | matcher scope | `/api/admin/x/../../y` |
| M06-04 | UI path yang terlihat ≠ API yang boleh dipanggil; UI bukan kontrol | AC | `rolePermissions.ts` vs route | role `admin_cs` memanggil API terlarang |
| M06-05 | Perubahan role langsung menginvalidasi cache scope (stale privilege) | AC | `invalidateScopeCache` | ubah role → request berikutnya |
| M06-06 | Siapa boleh membuat/mengubah role & menetapkan scope (anti self-escalation) | AC | `roles.subroute.ts` | admin_cs membuat role super |
| M06-07 | Manajemen staf: buat/ubah/reset password tidak bisa lintas tenant | TENANT | `staff-management.subroute.ts` | dua tenant |
| M06-08 | Seed role `admin_cs`/`spv_cs`/`therapist` konsisten dengan route nyata | AC | seed/migrasi | daftar route tanpa pemilik |
| M06-09 | Route SSE/livechat juga melewati RBAC, bukan hanya REST | AC | `livechat.subroute.ts`, media | stream dengan role minim |
| M06-10 | Route tanpa auth hook (auth/*, static, health) sesuai desain, tidak ada yang tak sengaja terbuka | AC | inventaris | daftar endpoint publik |
| M06-11 | `tenant_admin` = `ALL_PATHS` di FE vs blokir backend: tidak ada jalur yang lolos | AC | `rolePermissions.ts:240` | uji path terlarang |

---

## M07 — Multi-tenancy & isolasi objek (IDOR/BOLA)

**Profile:** deep · **Agen:** 18–26 · **Depends:** F0, M04–M06
**Entry surface:** semua route ber-`:id`, semua query DB, SSE, export, backup
**Target:** `src/config/tenant.ts`, `resolveTenantId`, 19 subroute sisa `DEFAULT_TENANT_ID` (#129.1), `prisma/schema.prisma`
**Prior:** #07, #129.1, #129.3, #282 (resolved)

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M07-01 | Setiap model bisnis punya `tenant_id` + index; tabel anak mewarisi lewat relasi | TENANT | schema | daftar model tanpa tenant |
| M07-02 | Setiap query baca/tulis memfilter tenant; hitung ulang sisa `DEFAULT_TENANT_ID` | TENANT | grep 19 file | hitungan baru + contoh bocor |
| M07-03 | Lookup by `:id` menolak objek tenant lain (bukan 404 vs 403 bocor) | TENANT | reservation/customer/conversation | dua tenant dummy |
| M07-04 | Mutasi (update/delete/approve) tidak bisa lintas tenant via id | TENANT | route mutasi | uji tulis lintas tenant |
| M07-05 | Cache & key memori menyertakan tenant (livechat, label, settings) | TENANT | cache | dua tenant isi berbeda |
| M07-06 | SSE/event hanya mengirim data tenant penerima | TENANT | livechat SSE | dua koneksi |
| M07-07 | Export/backup/report dibatasi tenant & role | TENANT | export, backup | role minim |
| M07-08 | Super admin lintas tenant hanya lewat jalur eksplisit (API key/sesi), bukan header sembarang | AC | `resolveSessionTenantId` | header `X-Tenant-Id` |
| M07-09 | Soft-deleted/archived tidak muncul di list, count, map, export | TENANT | endpoint terkait | customer dihapus |
| M07-10 | Data duplikat (customer vs reservation `tenant_id`) tidak bisa divergen | TENANT | service | pindah tenant |
| M07-11 | Webhook/worker menulis dengan tenant yang benar, bukan default | TENANT | ingress, cron | job tenant B |
| M07-12 | Knowledge, persona, katalog, tier ongkir tenant A tidak terbaca tenant B | TENANT | settings/knowledge | dua tenant |

---

## M08 — Permukaan publik: landing, pricelist, tracking, media

**Profile:** deep · **Agen:** 14–20 · **Depends:** F0
**Entry surface:** `/`, `/go`, `/cta`, `/promo/:slug`, `/:slug`, `/pricelist`, `/layanan`, `/api/tracking/*`, `/api/csp-report`, `/media/*`, `/proof/:id`, `/media/avatar/:customerId`
**Target:** `landing.route.ts` (875), `tracking.route.ts` (459), `media.route.ts` (509), `src/services/tenant-html.service.ts`, `Caddyfile`
**Prior:** #05, #08, #15, #16

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M08-01 | Template/HTML tenant tidak bisa menyuntik script ke origin publik | INJ | `landing.route.ts` | brand/slug berisi `<script>` |
| M08-02 | Resolusi file/slug tenant tidak bisa traversal (encode, backslash, symlink) | RES | `tenant-html.service.ts` | `..%2f`, `%252e` |
| M08-03 | Redirect `/go`, `/:slug` tidak terbuka ke domain luar | WEB | redirect handler | `?to=//evil`, `javascript:` |
| M08-04 | CSP ketat, tanpa `unsafe-inline` yang tidak perlu; `/api/csp-report` tidak menyimpan input mentah | WEB | landing headers | header respons + isi laporan |
| M08-05 | Tracking: origin/Referer diverifikasi, IP dari koneksi bukan cookie | WEB | `tracking.route.ts` | cookie `x-forwarded-for` |
| M08-06 | Avatar proxy: host allowlist per hop, tolak IP privat/link-local, skema selain http(s) | RES | `/media/avatar/:id` | redirect 302 ke 169.254.169.254 |
| M08-07 | Avatar/media path tidak bisa keluar direktori (`../`, null byte, ADS Windows) | RES | media handlers | path traversal |
| M08-08 | Media chat hanya untuk pengguna berwenang; nama file tidak bisa ditebak/di-enumerasi | AC | `/media/:scope/:tenant/:file` | akses anonim |
| M08-09 | `/proof/:reservationId` memeriksa kepemilikan bukti bayar | AC | media route | id reservasi tenant lain |
| M08-10 | Pricelist publik tidak membocorkan data internal (modal, catatan, kontak staf) | LEAK | landing/pricelist | isi JSON publik |
| M08-11 | Cache publik tidak menyimpan respons privat (Cache-Control/Vary) | WEB | header | dua pengguna |

---

## M09 — Live Chat, SSE & realtime

**Profile:** deep · **Agen:** 14–20 · **Depends:** F0, M04, M05, M07
**Entry surface:** `/api/admin/live-chat/*`, `/api/staff/live-chat/*`, `/api/admin/events`, `/api/staff/live-chat/events`, kirim/edit/hapus/reaksi/pin/hide, sync-history
**Target:** `admin/livechat.subroute.ts` (1359), `live-chat.service.ts`, `useLiveChatSse.ts`, `staff/today.subroute.ts`
**Prior:** #365, #160, #187 (ownership banner)

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M09-01 | SSE terautentikasi & ter-scope tenant; token tidak di query string | AC | SSE handler | anonim + dua tenant |
| M09-02 | Event tidak membawa PII/tenant lain (termasuk payload error) | LEAK | event builder | dua koneksi |
| M09-03 | Takeover/release hanya oleh CS/SPV berwenang & tercatat | AC | takeover route | role minim |
| M09-04 | Edit/hapus pesan: hanya pengirim/role sah, ada audit trail | BIZ | message routes | edit pesan orang lain |
| M09-05 | Reply/quote tidak lintas percakapan (#365) & fallback aman | MSG | live-chat.service | reply ke id percakapan lain |
| M09-06 | `sync-history`/`sync-full`: dibatasi role, kuota, bisa dibatalkan | RES | sync routes | dua request paralel |
| M09-07 | Upload media chat: tipe, ukuran, nama file, pemindaian | RES | composer/send | SVG/HTML, 50MB |
| M09-08 | Quick reply: interpolasi tidak mengeksekusi template/injeksi | INJ | quick-replies | `{{...}}`, newline |
| M09-09 | Pin/hide/reaction tidak bisa memanipulasi pesan percakapan lain | AC | routes | id lintas chat |
| M09-10 | Daftar percakapan tidak membocorkan yang belum ditugaskan ke role terapis | AC | listing | role terapis |
| M09-11 | SSE tidak menjadi vektor DoS (koneksi tanpa batas, rate limit di-skip) | RES | rate limit allowList | 500 koneksi (sandbox) |
| M09-12 | Delay alert/monitor hanya data tenant & role berwenang | LEAK | delay-alerts | role minim |

---

## M10 — AI Copilot analitik admin

**Profile:** deep · **Agen:** 10–14 · **Depends:** F0, M04, M06, M07
**Entry surface:** `POST /api/admin/copilot/chat`, `/copilot/stream`, 10 tool analitik
**Target:** `admin/copilot.subroute.ts` (281), tool implementasi copilot, prompt builder
**Prior:** FEATURE_INVENTORY §6 (10 tool dinamis, budget 5 menit)

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M10-01 | Tool copilot tidak menerima SQL/ekspresi arbitrer dari model | INJ | tool args | arg `'; DROP` |
| M10-02 | Data yang bisa dibaca copilot mengikuti role pemanggil (bukan super admin default) | AC | tool scope | role CS vs super |
| M10-03 | Prompt injection dari isi chat tidak bisa mengubah tool/kebijakan | AI | prompt/tool loop | chat berisi instruksi jahat |
| M10-04 | Output streaming dirender aman (markdown/HTML) di dashboard | INJ | renderer | `<img onerror>` |
| M10-05 | Budget/waktu/paralelisme dibatasi; pembatalan klien menghentikan biaya | RES | stream handler | 10 stream paralel |
| M10-06 | PII pasien tidak dikirim ke provider tanpa kebutuhan & tidak masuk log | LEAK | prompt, logger | contoh prompt |
| M10-07 | Hasil tool dibatasi ukuran (bukan dump ribuan baris) | RES | tool result | query luas |
| M10-08 | Setiap pemanggilan punya jejak audit (siapa, tool, argumen) | LEAK | audit log | satu sesi copilot |

---

## M11 — Mesin AI percakapan (V3)

**Profile:** deep · **Agen:** 18–26 · **Depends:** F0, M01, M07
**Entry surface:** pesan WhatsApp customer, riwayat, ringkasan, state sesi, 6 tool katalog, output ke WhatsApp
**Target:** `src/v3/agent/prompt/**`, `src/v3/agent/pipeline/**`, `src/v3/tools/**`, `src/v3/guardrails/**`, `src/v3/state/**`, `src/services/agent-runner.ts`
**Prior:** mandat AGENTS.md (tool masking, commit gate), #127, #199, #29

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M11-01 | Customer tidak bisa mengeluarkan system prompt/instruksi internal | AI | prompt + output | percobaan jailbreak beragam parafrase |
| M11-02 | Harga/durasi hanya dari grounding DB; guardrail numerik menolak angka karangan | BIZ | `numeric-fact-validator.ts` | respons dengan harga palsu |
| M11-03 | Tool masking fisik: tool terlarang tidak ada di schema, bukan hanya dilarang teks | AI | `tool-masker.ts` | dump tools per state |
| M11-04 | `save_reservation` hanya setelah komitmen eksplisit user (bukan asisten) | BIZ | `booking-commit-gate.ts` | riwayat asisten menyebut paket |
| M11-05 | Tidak ada kebocoran konteks lintas sesi/customer (summary, goal, cart) | TENANT | state, summarizer | dua sesi paralel |
| M11-06 | Prompt injection dari konten RAG/pengetahuan tidak menjadi instruksi | AI | context builder | chunk berisi "abaikan aturan" |
| M11-07 | State machine tidak bisa dilewati/diulang (booking tanpa slot, replay) | BIZ | machine | urutan pesan aneh |
| M11-08 | Guardrail output tidak bisa dilewati unicode/zero-width/emoji | INJ | sanitizer/validator | variasi teks |
| M11-09 | Fallback provider/model tidak membuka bypass (base URL, prompt berbeda) | AI | `llm-gateway.ts` | provider fallback |
| M11-10 | Input panjang/token bomb tidak membuat biaya/CPU tak terbatas | RES | pipeline | pesan 100KB |
| M11-11 | Eskalasi medis tidak bisa ditekan oleh instruksi customer | BIZ | medical-signal-detector | red flag + "jangan eskalasi" |
| M11-12 | Output ke WhatsApp tidak menyuntik mention/link/format berbahaya | INJ | sender | teks dengan `@all`, CRLF |
| M11-13 | Data pelanggan lain tidak bisa muncul di jawaban lewat tool | TENANT | tool args/DB | pertanyaan "nomor pelanggan X" |

---

## M12 — RAG & knowledge base

**Profile:** deep · **Agen:** 10–14 · **Depends:** F0, M07, M11
**Entry surface:** `admin/knowledge.subroute.ts`, `sync:knowledge`, scrape scripts, FAQ cache, unanswered questions
**Target:** `src/services/knowledge*`, `src/services/faq*`, embedding/retrieval, `knowledge_chunks`, `ClinicPolicy`
**Prior:** #29, FEATURE_INVENTORY §10

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M12-01 | Hanya role berwenang yang bisa menulis knowledge/policy tenant | AC | knowledge routes | role CS |
| M12-02 | Konten knowledge tidak menjadi instruksi (sanitasi & pemisahan peran) | AI | chunk ingestion | chunk berisi perintah |
| M12-03 | Retrieval selalu terfilter tenant; embedding tidak lintas tenant | TENANT | query retrieval | dua tenant |
| M12-04 | Fallback in-memory substring tidak over-match/kebocoran (#29) | TENANT | fallback | query umum |
| M12-05 | Skor/threshold tidak bisa dimanipulasi lewat konten untuk mendominasi konteks | AI | scorer | chunk pengulang kata kunci |
| M12-06 | Cache FAQ menyertakan tenant + versi, tidak menyajikan jawaban basi | TENANT | cache | ubah knowledge |
| M12-07 | Unanswered questions tidak membocorkan PII ke role lain | LEAK | queue | role terapis |
| M12-08 | Scraper/sync hanya mengambil sumber yang diizinkan, dengan timeout/ukuran | RES | sync scripts | URL internal |
| M12-09 | Ukuran chunk/konteks dibatasi (context stuffing) | RES | retrieval | 10.000 chunk |
| M12-10 | Hapus knowledge benar-benar menghapus chunk/embedding turunan | TENANT | delete | cari setelah hapus |

---

## M13 — Reservasi, jadwal & pembayaran

**Profile:** deep · **Agen:** 20–28 · **Depends:** F0, M07, M11
**Entry surface:** `/api/admin/reservation*`, `/api/staff/reservations/*`, pembayaran, bukti bayar, invoice, series, dispatch
**Target:** `reservation-crud.route.ts` (1149), `reservation-dispatch-*.subroute.ts`, `reservation-series.route.ts`, `staff/today.subroute.ts` (1356), `reservation-payment*`, `invoice*`
**Prior:** #153, #126, #363, `purchase-value-guard`

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M13-01 | Harga, diskon, ongkir dihitung server; nilai klien diabaikan | BIZ | create/update | kirim harga 0 |
| M13-02 | Tidak ada double-booking pada request paralel (lock/unique) | BIZ | create + hold | dua request bersamaan |
| M13-03 | Hold kedaluwarsa & slot overlap tidak bisa dipakai ganda | BIZ | sweep, overlap | dua hold |
| M13-04 | Bukti bayar: hanya pemilik/role sah bisa unggah/lihat/ganti | AC | payment proof route | id tenant lain |
| M13-05 | Nominal tidak cocok tidak bisa ditandai lunas tanpa verifikasi | BIZ | payment modal/service | bayar 1 rupiah |
| M13-06 | Invoice/struk tidak bisa injeksi HTML/CSV saat diekspor | INJ | invoice generator | nama pasien `<script>` |
| M13-07 | CAPI purchase value tidak bisa dimanipulasi pasca-kirim tanpa jejak | BIZ | `purchase-value-guard` | ubah nilai setelah kirim |
| M13-08 | Series: kartu alamat & layanan milik tenant/customer yang sama | TENANT | series route | card id tenant lain |
| M13-09 | Transisi status (cancel/complete/reopen) berwenang & idempoten | BIZ | status route | replay complete |
| M13-10 | OTW/arrive/complete: klaim atomik, `requestId` idempoten, replay aman | BIZ | staff today | dua POST |
| M13-11 | Tanggal lampau/zona waktu WIB tidak menciptakan state invalid | BIZ | date utils | 23:59 WIB |
| M13-12 | Skor bidan tidak bisa diubah lewat input (hanya agregasi server) | BIZ | scorecard | POST nilai |
| M13-13 | Arsip/purge tidak menghapus data di luar tenant/rentang | TENANT | archive sweep | dua tenant |

---

## M14 — Database, migrasi & backup/restore

**Profile:** deep · **Agen:** 12–16 · **Depends:** F0
**Entry surface:** semua query Prisma/raw SQL, `admin/backup.subroute.ts`, `backup.service.ts`, migrasi, CLI scripts
**Target:** `prisma/schema.prisma`, `prisma/migrations/**`, `src/db/client.ts`, `backup.service.ts` (35KB)
**Prior:** #06, #128, #129.6

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M14-01 | Tidak ada `$queryRawUnsafe`/string SQL dengan input user | INJ | grep raw SQL | daftar pemakaian |
| M14-02 | Restore menolak SQL mentah, memvalidasi skema dump, dan tidak mengeksekusi perintah shell | INJ | backup.service | file `.sql`, dump rusak |
| M14-03 | Nama file backup/download tidak bisa traversal & hanya role super | RES | backup route | `../.env` |
| M14-04 | Backup terenkripsi; kunci tidak disimpan bersama file | CRYPT | backup/Drive | file + kunci |
| M14-05 | Migrasi destruktif tidak menghapus/menimpa data lintas tenant | TENANT | migrations | dry-run dummy |
| M14-06 | Cascade delete tidak menghapus data tenant lain | TENANT | schema | hapus satu tenant dummy |
| M14-07 | Soft delete konsisten di semua pembaca | TENANT | query | arsip |
| M14-08 | Kredensial DB tidak bocor ke log/error/health | CRYPT | app/log | `/ready` |
| M14-09 | Pool/koneksi dibatasi; query berat tidak bisa dijalankan user | RES | db client | query mahal |
| M14-10 | Transaksi uang/booking memakai isolasi yang benar | BIZ | service | dua transaksi |
| M14-11 | Endpoint `evaluations` (log prompt) tidak membocorkan data lintas tenant/role | LEAK | `evaluations.subroute.ts` | role CS |

---

## M15 — Worker, cron & antrean

**Profile:** standard · **Agen:** 10–14 · **Depends:** F0, M07, M14
**Entry surface:** 26 cron, BullMQ/Redis, outbox Sheets, worker process, endpoint pemicu manual
**Target:** `src/worker.ts`, `src/lifecycle/background-crons.ts`, `src/services/cron.service.ts`, queue services
**Prior:** #250, #128, #129.7

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M15-01 | Cron tidak berjalan ganda saat multi-instance (lock/idempotensi) | MSG | cron service | dua worker dummy |
| M15-02 | Pengguna tidak bisa memicu job berat berulang (sync, backup, export) | RES | endpoint pemicu | 50 request |
| M15-03 | Retry punya backoff & batas; tidak ada retry storm | RES | queue | job gagal terus |
| M15-04 | Laporan lintas tenant tidak tercampur | TENANT | daily report, sheets | dua tenant |
| M15-05 | Cleanup sandbox/retensi tidak menghapus data produksi | BIZ | cleanup cron | record mirip sandbox |
| M15-06 | Outbox Sheets tidak mengirim PII ke spreadsheet yang salah | LEAK | sheets sync | tenant B |
| M15-07 | Retensi pesan/media menghormati batas & tidak bisa dipicu user | BIZ | retention | request manual |
| M15-08 | Worker tidak membuka port/HTTP surface tambahan | CLOUD | worker entry | port scan lokal |
| M15-09 | Job yang membawa kredensial tidak menulisnya ke log | CRYPT | logger | contoh job |
| M15-10 | Shutdown/drain tidak meninggalkan job setengah jalan | MSG | shutdown | SIGTERM saat job |

---

## M16 — Integrasi eksternal

**Profile:** deep · **Agen:** 14–20 · **Depends:** F0, M07, M17
**Entry surface:** Google OAuth/Contacts/Sheets/Drive, Meta CAPI, Telegram keluar, Web Push, Google Maps/ORS, LLM gateway
**Target:** `src/integrations/**`, `admin/google-integration.subroute.ts`, `capi.service.ts`, `web-push.service.ts`, `telegram.service.ts`, `admin/push.subroute.ts`
**Prior:** #10, #11, #08

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M16-01 | OAuth state: HMAC wajib, nonce sekali pakai, TTL, terikat sesi | WEB | OAuth flow | state palsu/kedaluwarsa |
| M16-02 | Scope Google minimal; refresh token tidak bisa dipakai lintas tenant | AC | google services | dua tenant |
| M16-03 | Token OAuth/Telegram terenkripsi & tidak muncul di respons API | CRYPT | encryption util | respons settings |
| M16-04 | Sheets/Contacts tidak menjadi jalur eksfiltrasi PII lintas tenant | LEAK | sync | tenant B |
| M16-05 | Drive backup tidak dapat diakses publik (permission/link) | CLOUD | drive client | metadata file |
| M16-06 | CAPI: event tidak bisa dipalsukan dari klien; token aman; PII di-hash | BIZ | `capi.service.ts` | POST tracking forge |
| M16-07 | Web Push: endpoint subscription divalidasi (anti SSRF), payload tanpa PII berlebih | RES | push service | endpoint internal |
| M16-08 | Maps/ORS: API key dibatasi, URL tidak bisa diarahkan ke host lain | RES | clients | param URL |
| M16-09 | LLM gateway: base URL tidak bisa ditimpa user; key tidak bocor | CRYPT | llm client | override env/tenant |
| M16-10 | Alert webhook keluar tidak SSRF & tidak memuat rahasia | RES | alert service | URL internal |
| M16-11 | Semua panggilan keluar punya timeout & batas ukuran respons | RES | semua client | respons lambat/besar |

---

## M17 — Secrets, konfigurasi & supply chain

**Profile:** deep · **Agen:** 10–14 · **Depends:** F0
**Entry surface:** `.env`, `.env.example`, Dockerfile/compose, package.json/lock, CI, build
**Target:** `src/app.ts` boot checks, `src/utils/encryption.ts`, `package.json`, `.github/workflows/**`, `scripts/security*`
**Prior:** #11, #129.5, #134, #179

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M17-01 | Env kritis divalidasi saat boot (ADMIN_API_KEY, webhook secret, encryption key) | CRYPT | `app.ts:30-65` | boot tanpa env |
| M17-02 | Tidak ada secret di source/commit/build artifact/frontend bundle | CRYPT | git, dist | scan tanpa mencetak nilai |
| M17-03 | Enkripsi: algoritma, IV unik, kunci dari env, fallback plaintext terdokumentasi | CRYPT | `encryption.ts` | dua enkripsi nilai sama |
| M17-04 | Rotasi kunci & data lama tetap terbaca (dual-read) tanpa membuka plaintext baru | CRYPT | util | rotasi dummy |
| M17-05 | `.env.example` lengkap untuk semua env wajib | CRYPT | `.env.example` | daftar env hilang |
| M17-06 | Dependensi: lockfile, `npm audit`, paket tanpa maintainer, postinstall | SUPPLY | package.json/lock | laporan audit |
| M17-07 | CI: secret tidak tersedia untuk PR fork; workflow tidak menjalankan kode PR dengan privilege | SUPPLY | `.github/workflows` | definisi workflow |
| M17-08 | Image Docker di-pin (WAHA), bukan `latest`; digest/versi jelas | SUPPLY | compose | tag image |
| M17-09 | `npm run security:scan` menangkap high/critical dan hasilnya dipakai | SUPPLY | script | jalankan (offline bila memungkinkan) |
| M17-10 | Source map/asset build tidak mengekspos kode internal & path server | LEAK | `dist/` | file `.map` |

---

## M18 — File, media & export

**Profile:** deep · **Agen:** 12–16 · **Depends:** F0, M08
**Entry surface:** upload gambar/PDF/audio/QRIS/bukti bayar/avatar, `/media/*`, export CSV/Excel, chat export, backup file
**Target:** `src/services/media.service.ts`, `media.route.ts`, `admin/customers-export.subroute.ts`, `admin/export.subroute.ts`, `scripts/capi-*`
**Prior:** #05, #08, #12, #363

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M18-01 | Upload: MIME sniff (bukan ekstensi), batas ukuran, tolak SVG/HTML/polyglot | RES | upload handlers | file `.jpg` berisi HTML |
| M18-02 | Dekompresi gambar dibatasi (pixel/dimensi) — anti decompression bomb | RES | `sharp` pipeline | gambar 30.000×30.000 |
| M18-03 | Path simpan kanonik, nama file di-sanitasi, tidak bisa keluar direktori | RES | media service | nama `..\\x` |
| M18-04 | Media privat memerlukan otorisasi; URL tidak dapat ditebak | AC | media route | anonim |
| M18-05 | Kuota/retensi tidak bisa dilewati lewat upload berulang | RES | quota | 100 upload |
| M18-06 | CSV/Excel: formula injection di semua sel & nama file | INJ | `escapeCsvCell` | sel `=cmd|'` |
| M18-07 | Export dibatasi tenant/role dan tidak memuat data terarsip/rahasia | TENANT | export | role CS |
| M18-08 | Chat export (Markdown) tidak menyimpan PII tanpa kontrol akses | LEAK | export cron | isi file |
| M18-09 | `Content-Disposition` tidak bisa header injection | WEB | download | nama file `\r\n` |
| M18-10 | File sementara/orphan dibersihkan tanpa menghapus referensi aktif | RES | sweep | referensi aktif |

---

## M19 — Infra & deployment

**Profile:** deep · **Agen:** 12–18 · **Depends:** F0
**Entry surface:** docker-compose, Caddy, WAHA, Postgres, Redis, health/ready, jaringan
**Target:** `docker-compose.yml`, `Caddyfile`, `Dockerfile`, `deploy_config.txt`, `src/app.ts:71-84`
**Prior:** #13, #16, #135 (proxy), #129.6

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M19-01 | Hanya port yang perlu terekspos; Postgres/Redis/WAHA dashboard tidak publik | CLOUD | compose | daftar port |
| M19-02 | Tidak ada kredensial default (postgres/redis/WAHA) | CRYPT | compose/env | nilai default |
| M19-03 | Redis tanpa auth tidak bisa diakses dari host lain | CLOUD | compose | bind address |
| M19-04 | WAHA dashboard/webhook terlindungi; secret tidak sama dengan API key | AC | WAHA config | akses anonim |
| M19-05 | Caddy: header keamanan, HSTS, CSP per path, domain `hermes*` tidak membuka service internal | CLOUD | Caddyfile | route per domain |
| M19-06 | `trustProxy` sesuai topologi; `TRUST_PROXY_ANY` tidak aktif di produksi | WEB | app.ts:71 | spoof `X-Forwarded-For` |
| M19-07 | Container tidak root/docker.sock/capability berlebih | CLOUD | Dockerfile/compose | user & mounts |
| M19-08 | Volume log/backup tidak memuat PII tanpa kontrol akses host | LEAK | compose volumes | isi direktori |
| M19-09 | `/health` & `/ready` tidak membocorkan info sensitif | LEAK | health route | respons |
| M19-10 | Rate limit: allowList tidak bisa di-bypass (encoding, trailing slash) | RES | `app.ts:230-244` | variasi path |
| M19-11 | Graceful shutdown/queue drain tidak membuat kehilangan pesan | MSG | lifecycle | SIGTERM |
| M19-12 | Migrasi produksi (#129.6) tercatat & tidak destruktif | TENANT | migrations | rencana deploy |

---

## M20 — Frontend admin & PWA staf

**Profile:** deep · **Agen:** 14–20 · **Depends:** F0, M04, M05, M06
**Entry surface:** SPA `/admin/*`, PWA staf, SSE client, service worker, localStorage
**Target:** `packages/admin-dashboard/src/**`, `public/sw.js`, `App.tsx`, `services/api.ts`, `utils/*`
**Prior:** #125, #336, #160

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M20-01 | Tidak ada sink XSS: `dangerouslySetInnerHTML`, markdown, HTML chat, URL | CLIENT | grep + renderer | payload `<img onerror>` |
| M20-02 | URL `javascript:`/`data:` ditolak; `target=_blank` pakai `rel=noopener` | CLIENT | link renderer | pesan berisi URL jahat |
| M20-03 | API key/token tidak disimpan di tempat yang bisa dibaca skrip lintas origin | CLIENT | `api.ts`, storage | isi localStorage |
| M20-04 | CSP admin tidak memaksa `unsafe-inline` untuk script yang bisa dieksploitasi | WEB | Caddy/headers | header |
| M20-05 | RBAC UI tidak menjadi satu-satunya kontrol; route tersembunyi tetap ditolak server | AC | `rolePermissions.ts` | panggil API langsung |
| M20-06 | Service worker tidak menyajikan konten privat basi lintas sesi | CLIENT | `sw.js` | logout → cache |
| M20-07 | SSE client tidak membocorkan event ke tab/sesi lain | CLIENT | `useLiveChatSse` | dua akun |
| M20-08 | Error boundary tidak menampilkan stack/data sensitif | LEAK | `AppErrorBoundary` | error paksa |
| M20-09 | Bundle tidak memuat secret/env server (`VITE_*` sensitif) | CRYPT | `dist/assets` | grep nilai |
| M20-10 | Klikjacking: `X-Frame-Options`/`frame-ancestors` konsisten | WEB | headers | iframe |
| M20-11 | Data offline PWA (chat, alamat) dihapus saat logout | LEAK | storage | logout |

---

## M21 — Logging, observability & PII

**Profile:** standard · **Agen:** 10–14 · **Depends:** F0, M14, M19
**Entry surface:** `logs/*.jsonl`, `logs/app-*.log`, log buffer, audit log, alert
**Target:** `src/utils/llm-execution-logger.ts`, `log-buffer.ts`, `pii-masker.ts`, `audit.service.ts`, `audit-payload-sanitizer.ts`, `admin/evaluations.subroute.ts`
**Prior:** #216 (sanitizer), #29, #250

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M21-01 | PII (nomor, nama, alamat, isi chat medis) dimasking sebelum ditulis | LEAK | masker + logger | contoh log |
| M21-02 | Log injection: newline/ANSI/CRLF dari input tidak memalsukan baris log | INJ | logger | pesan berisi `\n` |
| M21-03 | Nama file log tidak bisa traversal lewat kunci tanggal/tenant | RES | `log.date_key` | input tanggal |
| M21-04 | Log prompt/LLM dibatasi aksesnya (role) & tidak lintas tenant | AC | evaluations | role CS |
| M21-05 | Retensi log menghapus PII sesuai kebijakan | TENANT | retention | file lama |
| M21-06 | Alert/Telegram tidak memuat token, stack, atau data pasien | CRYPT | alert service | contoh pesan |
| M21-07 | Audit log tidak bisa diubah/dihapus dari aplikasi | LEAK | audit service | endpoint hapus |
| M21-08 | Penghapusan data (soft delete/purge) konsisten ke log, backup, Sheets, Contacts | TENANT | alur hapus | cari setelah hapus |
| M21-09 | Tidak ada endpoint debug yang membuka state/log mentah | AC | `/debug`, `/state` | akses anonim |
| M21-10 | Log tidak menulis body request penuh pada error validasi | LEAK | error handler | request berisi PII |

---

## M22 — Rantai lintas modul (dijalankan setelah W1–W5)

**Profile:** deep · **Agen:** 10–16 · **Depends:** semua ledger modul
**Metode:** setiap rantai = urutan prasyarat yang sudah `confirmed`/terbukti lokal. Jangan mengklaim rantai bila satu prasyarat masih `needs_validation`.

Kandidat rantai yang wajib diuji:

| ID | Rantai yang diuji | Prasyarat |
|---|---|---|
| M22-01 | Webhook tanpa secret → pesan palsu → AI tool → tulis DB / kirim WA | M01-01, M11-04 |
| M22-02 | Staff session → `/api/admin/*` → lintas tenant | M05-06, M07-03 |
| M22-03 | Prompt injection customer → tool call → data pelanggan lain di balasan | M11-06, M11-13, M12-03 |
| M22-04 | XSS landing/publik → sesi admin (cookie) → CSRF guard dilewati | M08-01, M04-03, M04-06 |
| M22-05 | SSRF avatar/media → metadata internal → kredensial cloud | M08-06, M16-07 |
| M22-06 | Backup download → kredensial DB → akses penuh | M14-03, M14-04, M17-02 |
| M22-07 | CAPI/tracking palsu → event purchase → keputusan bisnis | M16-06, M13-07 |
| M22-08 | RBAC cache basi → role dicabut tetap bisa menulis | M06-05, M06-06 |
| M22-09 | Media publik/ID enumerable → PII pasien → ekstraksi massal | M08-08, M18-04 |
| M22-10 | Cron/worker → tenant salah → notifikasi/Sheets bocor | M15-04, M15-06, M07-11 |
| M22-11 | `pushname`/riwayat berisi injeksi → model → eskalasi + kirim nomor pasien ke Telegram | M11-14, M11-15, M03-05 |
| M22-12 | Tenant admin → `receiptVisionBaseUrl` → gambar bukti bayar pasien keluar ke host sendiri | M16-12, M16-02 |
| M22-13 | Chat Telegram terotorisasi → `/clean` → cron host → eksekusi di server | M03-09, M19-07 |
| M22-14 | `/proof/:id` publik → enumerasi → data finansial + identitas pasien | M08-12, M18-04 |
| M22-15 | XSS landing same-origin → API admin (CSP `unsafe-inline`, `connect-src` luas) | M08-01, M20-04, M20-12 |

**Gate:** setiap rantai punya status eksplisit (`confirmed`/`rejected`/`needs_validation`) + trace berurutan `entrypoint → propagation → sink`.

---

## Lampiran A — Check tambahan dari recon awal

Check berikut lahir dari pemetaan source awal dan **wajib** masuk ledger. Detail bukti ada di [RECON-NOTES.md](RECON-NOTES.md) (kolom `R-xx`).

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M01-13 | Secret webhook WAHA bukan HMAC body → replay request lama harus tidak menghasilkan efek ganda; secret global tidak boleh menulis tenant lain | AC/MSG | `webhook.route.ts:124-145`, `waha-webhook-auth.ts:23-57` | R-10: replay + `X-Tenant-Id` silang |
| M01-14 | Jalur unsigned (`expectedSecrets.length===0` / `WAHA_ALLOW_UNSIGNED_WEBHOOK`) tidak aktif di produksi | AC | `webhook.route.ts:130-145`, `app.ts:42-49` | R-11: boot tanpa secret |
| M02-10 | Verify token GET dibandingkan timing-safe; env kosong tidak membocorkan detail | WEB | `waba-webhook.route.ts:27-37` | R-12: token salah/tepat |
| M02-11 | `mock_secret` / unsigned tidak lolos saat strict | AC | `signature.ts:16-23`, `waba-webhook.route.ts:62-70` | R-06: env flag + POST |
| M04-13 | Token sesi mentah tidak dikembalikan ke klien | CRYPT | `admin/auth.subroute.ts:132-149` | R-04: body login |
| M04-14 | Login/logout punya perlindungan CSRF (forced login/logout) | WEB | `admin.route.ts:96-105`, `staff.route.ts:23-29` | R-08: form lintas-origin |
| M04-15 | Cookie `Secure` tidak bergantung pada header klien | WEB | `admin/auth.subroute.ts:123-125` | R-09: request HTTP |
| M04-16 | `ADMIN_API_KEY` sebagai password login adalah keputusan sadar + dibatasi | AC | `admin/auth.subroute.ts:92-115` | R-21: uji login |
| M05-11 | `admin_session` → `SPV_CS` tidak boleh memilih tenant lewat header/query | TENANT | `staff.route.ts:52-88` | R-07: `?tenant_id=` |
| M05-12 | Mutasi staf via cookie punya CSRF guard | WEB | `staff.route.ts` | R-08: request tanpa header |
| M06-12 | `telegramPairingToken` tidak boleh terbaca role non-super-admin (kontradiksi allowlist) | AC/LEAK | `role-module-scopes.ts:56-66`, `settings-notifications.subroute.ts:38-57` | R-05: sesi scope settings |
| M07-13 | Tenant dari body/query dibaca sebelum resolusi sesi → pastikan guard prefix menutup semua | TENANT | `backup`, `export`, `google-integration`, `staff-management`, `waba` | R-17: sesi staf |
| M08-12 | `/proof/:id` tidak boleh publik tanpa otorisasi | AC | `media.route.ts:511-561` | R-01: akses anonim |
| M08-13 | Avatar publik tidak boleh lookup lintas tenant | TENANT | `media.route.ts:426-446` | R-02: dua tenant |
| M08-14 | `POST /api/tracking/pageview` tidak boleh menulis + memicu CAPI tanpa autentikasi | BIZ | `tracking.route.ts:388-493` | R-03: 10 request acak |
| M09-13 | Allowlist SSE tidak memuat path mati; stream tetap punya batas koneksi | RES | `app.ts:238-244` | R-16: 500 koneksi |
| M14-12 | Upload backup 50 MB & restore tidak membuka DoS/overwrite | RES/BIZ | `backup.subroute.ts:159-231` | R-18: upload dummy |
| M14-13 | Debug admin tidak membocorkan lintas tenant & tidak aktif tanpa gate | LEAK | `evaluations.subroute.ts:458-599` | R-22: `?tenant=` |
| M14-17 | Restore hanya menerima field yang diizinkan (bukan `role`/`password_hash` arbitrer) | INJ/AC | `backup.service.ts:562-587` | R-61: `.json.gz` berisi staff SUPER_ADMIN |
| M15-11 | Cleanup sandbox tidak menghapus customer nyata | BIZ | `sandbox-cleanup.service.ts:8-22` | R-19: nomor mirip |
| M17-11 | `X-API-KEY` memilih tenant secara eksplisit; `X-Admin-Identity` hanya label | AC | `admin.route.ts:121-124`, `route-helpers.ts:18-32` | R-20: header silang |
| M19-13 | `/ready` tidak mengungkap detail komponen/cron | LEAK | `health.route.ts:33-155` | R-13: akses anonim |
| M19-14 | Landing & admin same-origin: guard origin menutup semua deployment | CLOUD | `Caddyfile:7-24`, `admin.route.ts:81-93` | R-15: host berbeda |
| M20-12 | CSP admin tidak memberi jalan eksfiltrasi (`connect-src` luas, `unsafe-inline`) | CLIENT | `app.ts:144-152` | R-15: header aktual |

---

## Lampiran B — Check tambahan dari recon integrasi/AI

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M01-15 | Fetch media WhatsApp dibatasi ukuran & redirect (tidak ada `maxContentLength`) | RES | `waha/client.ts:1201-1268`, `media.service.ts:334` | R-23: media besar/redirect |
| M02-12 | Media WABA diambil dari host yang diizinkan & dibatasi ukurannya | RES | `waba-webhook.route.ts:198-202`, `whatsapp/media.ts` | R-23: respons Graph dipalsukan |
| M03-09 | `/clean` tidak boleh memicu eksekusi host dari chat | AC/RES | `telegram-webhook.route.ts:444-546` | R-25: chat terotorisasi |
| M03-10 | `/server` hanya untuk pengirim berwenang (bukan sekadar secret webhook) dan tidak membocorkan metrik host | AC/LEAK | `telegram-webhook.route.ts:306-438` | R-25, R-59: chat asing kirim `/server` |
| M05-14 | Token pairing Telegram: TTL, sekali pakai, tidak plaintext, terikat tenant+staf | AC | `telegram-webhook.route.ts:74-129`, `staff-notification.service.ts:41-58` | R-60: pakai token dua kali dengan chat berbeda |
| M11-14 | `pushname` customer disanitasi sebelum masuk system prompt | AI | `webhook.route.ts:810-816`, `goal-tracker.ts:508` | R-24: nama profil berisi instruksi |
| M11-15 | Riwayat asisten tidak mempertahankan injeksi antar turn | AI | `prompt-injection-sanitizer.ts:95-108` | R-34: sesi berlanjut |
| M12-11 | Chunk RAG tidak masuk sebagai teks sistem otoritatif tanpa batas kepercayaan | AI | `context-grounder.ts:505-531` | R-33: chunk berisi perintah |
| M16-12 | Endpoint receipt-vision dari tenant tidak bisa mengeksfiltrasi gambar bukti bayar | TENANT/RES | `payment-receipt-vision.service.ts:132-195` | R-27: host uji |
| M16-13 | Web Push endpoint divalidasi (skema/host) sebelum dikirimi | RES | `push.subroute.ts:43-66`, `web-push.service.ts:289` | R-28: endpoint internal |
| M16-14 | Pricelist image URL dibatasi host & ukuran sebelum di-fetch | RES | `pricelist-config.service.ts:83-104`, `waha/client.ts:642-651` | R-29: URL internal |
| M16-15 | Seam `sendImageDetailed` menolak path lokal di luar media outbound | RES | `waha/client.ts:652-674` | R-30: path lain |
| M16-16 | Rahasia tidak dikirim di URL (CAPI token, Google key, Telegram token) | CRYPT | `capi.service.ts:1115`, `geocoding.ts:943`, `alert.service.ts:217` | R-31: log egress |
| M17-12 | Kunci API tenant tidak disimpan plaintext di JSON settings | CRYPT | `integration-guard.service.ts:60-95` | R-32: baris DB |
| M18-11 | Kuota media dihitung sebelum buffer penuh (anti memori habis) | RES | `media.service.ts:334` | R-23: media 100MB |
| M21-11 | `llm_audit_logs.customer_phone` tidak menyimpan nomor mentah | LEAK | `llm-audit-buffer.ts:153` | R-26: isi tabel |
| M21-12 | Prompt lengkap tidak disimpan tanpa redaksi PII memadai | LEAK | `generation-stage.ts:1063`, `llm-execution-logger.ts:216-233` | R-26: isi `llm-*.jsonl` |

---

## Lampiran C — Check tambahan dari recon data/infra

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M01-16 | Tenant WAHA tidak boleh ditentukan oleh `findFirst` pada kolom non-unik | TENANT | `waha-tenant.service.ts:42-45` | R-49: duplikat `waha_session_id` |
| M02-13 | Tenant WABA tidak boleh ditentukan oleh `findFirst` pada kolom non-unik | TENANT | `waba-tenant.service.ts:33-35` | R-49: duplikat `phone_number_id` |
| M07-14 | Isolasi tenant tidak boleh bergantung pada disiplin per-query tanpa FK/RLS/middleware | TENANT | seluruh `prisma.*` (197 file) | R-36: audit query tanpa `tenant_id` |
| M07-15 | Lookup ID-only (`landings`, `labels`) menolak objek tenant lain | TENANT | `landings.subroute.ts:311`, `labels.subroute.ts:443` | R-37: dua tenant |
| M07-16 | Katalog tidak boleh selalu membaca tenant default saat multi-tenant | TENANT | `settings-catalog.subroute.ts:9`, `treatment-catalog.service.ts:1192` | R-38: dua katalog |
| M13-14 | `forceUnpaid`/override supervisor tidak bisa dipakai staf biasa untuk menutup task tanpa bayar | BIZ | `today.subroute.ts:976`, `staff-reservation.service.ts:2465` | R-52: role terapis |
| M14-14 | Backup list/download/restore memeriksa kepemilikan tenant | TENANT | `backup.subroute.ts:85-142`, `backup.service.ts:280-302` | R-39: file tenant lain |
| M14-15 | Dump programatik tidak mencampur semua tenant lalu memberi stempel satu tenant | TENANT | `backup.service.ts:149-200` | R-39: isi dump |
| M14-16 | Uniqueness kritis ada di schema/migration yang konsisten (`Conversation`, staging, eventId) | TENANT | `migrations/20261109120000`, schema `:786,808,1147` | R-42: tabrakan dua tenant |
| M15-12 | Backup otomatis mencakup semua tenant aktif | TENANT | `cron.service.ts:795` | R-40: tenant kedua |
| M15-13 | Worker `broadcast_queue` tidak berjalan di proses web di luar gating | CLOUD | `broadcast-queue.service.ts:60-85,308`, `settings-general.subroute.ts:819` | R-41: panggil `/api/admin/health` |
| M17-13 | CI punya dependency audit/SAST dan tidak hanya membandingkan nama test gagal | SUPPLY | `.github/workflows/ci.yml:44-97` | R-46: definisi workflow |
| M17-14 | `.env.example` sinkron dengan env yang benar-benar dipakai; env wajib tidak hilang | CRYPT | `.env.example` vs `.env` (nama) | R-47: diff nama |
| M18-12 | `tenantId` divalidasi pola sebelum dipakai menyusun path media | RES | `media.service.ts:158-171` | R-48: `..%2f` |
| M19-15 | Tidak ada kredensial default yang dipublikasikan (WAHA `admin/admin12345`) | CRYPT | `README.md:125`, `docker-compose.yml:195-198` | R-43: baca docs/compose |
| M19-16 | Network eksternal (`hermes-net`) tidak membuka `app:3000`/`waha:3000` ke pihak lain | CLOUD | `docker-compose.yml:81-187,230-233` | R-44: inspeksi network |
| M19-17 | Script deploy tidak memakai `StrictHostKeyChecking=no` dan tidak hardcode host produksi | CLOUD | `scripts/deploy-to-server.js:23-27` dkk | R-45: baca script |
| M21-13 | Audit log tidak salah atribusi tenant saat tenant kosong | TENANT | `audit.service.ts:25-39,69-79` | R-50: aksi tanpa tenant |
| M21-14 | Log per file dibatasi ukurannya (bukan hanya retensi harian) | RES | `log-buffer.ts:22-23,103-128` | R-51: file 88 MB |

---

## Lampiran D — Check dari revalidasi M00 (temuan lama yang masih parsial)

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M04-17 | CSRF guard tidak boleh dilewati hanya karena header `x-api-key` ada (harus valid) | WEB:CSRF | `admin.route.ts:196-208` | R-55: cookie valid + `x-api-key: junk` pada PATCH |
| M05-13 | Route staf wajib memakai tenant dari sesi, bukan `x-tenant-id`/`?tenant_id` | TENANT | `staff.route.ts:96-99`, `staff/today.subroute.ts:47` | R-53: terapis tenant A minta tenant B |
| M16-17 | Nonce OAuth satu kali pakai (disimpan & dikonsumsi), bukan hanya ditandatangani | WEB:CSRF | `google-oauth.client.ts:88,106-140` | R-56: replay state < 15 menit |
| M18-13 | Export Google Sheets tidak memakai `USER_ENTERED` untuk teks tak tepercaya | INJ | `sheets-client.ts:207-233`, `row-formatter.ts:259-294` | R-57: nama `=HYPERLINK(...)` |
| M20-13 | Export CSV sisi klien menetralkan `= + - @` dan meng-escape kutip | CLIENT | `RetentionTab.tsx:185-198` | R-58: nama staf `a","=1+1` |
| M20-14 | Klien tidak mengasumsikan `super_admin` saat `/me` tidak membawa `role`/`sessionType` | CLIENT | `AuthContext.tsx:126-144`, `admin/auth.subroute.ts:388-494` | R-66: respons `/me` tanpa role |

---

## Lampiran E — Check dari coverage critic M05

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M05-15 | Login terpadu admin (cabang staf) punya paritas throttle/lockout/gate role dengan login staf | AC | `admin/auth.subroute.ts:152-243` | Login staf lewat pintu admin; cek limiter & role |
| M05-16 | Penerbitan/rotasi token pairing punya CSRF, audit, dan melepas binding lama | LEAK | `staff-notification.service.ts:77-84` | Regenerate token saat binding aktif |
| M05-17 | Web Push: endpoint milik staf sendiri & notifikasi berhenti saat sesi/staf dicabut | TENANT | `web-push.service.ts:204,327` | Dua staf; unsubscribe silang |
| M05-18 | Cabang gagal login tidak menjadi orakel nama/role dan tidak bisa dipakai DoS akun | LEAK | `staff/auth.subroute.ts:81-101` | Percobaan lintas tenant+identifier |
| M05-19 | Guard delay memakai seam kanonis & parameter template tidak masuk mentah | AC | `staff-departure-watchdog.service.ts:314-380` | Supervisor `force`; query delayMinutes |

---

## Lampiran F — Check dari coverage critic M07

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M07-17 | Bukti bayar/CAPI: tenant + kepemilikan pada upload/verify/approve/reject | TENANT | `reservation-dispatch-payment-proof.subroute.ts` | Dua tenant; bukti/verify lintas tenant |
| M07-18 | Endpoint thread livechat: tenant + kepemilikan pada reply/edit/revoke/pin/hide | TENANT | `admin/livechat.subroute.ts`, `live-chat.service.ts` | Dua tenant; edit pesan lintas |
| M07-19 | WABA ingress: phone_number_id → tenant, status/media menulis tenant benar | TENANT | `waba-webhook.route.ts`, `waba-tenant.service.ts` | Payload tenant B; DB offline |
| M07-20 | Konfigurasi bisnis per tenant (brand/lokasi/jam/delay) tidak mewarisi default | TENANT | `src/config/*` | Tenant tanpa override |

---

## Lampiran G — Check dari coverage critic M08

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M08-15 | `/api/tenant/:slug` tidak membocorkan LandingContent tenant lain | LEAK | `tracking.route.ts` | Dua tenant; slug silang |
| M08-16 | `/cta` tidak menulis atribusi/redirect dari query tanpa gerbang | BIZ | `landing.route.ts` | `tenantId`/`phone`/`is_test` dari query |
| M08-17 | `/api/csp-report` tidak menyimpan input mentah tanpa batas | INJ | `landing.route.ts` | Body 100KB/objek polimorfik |
| M08-18 | Allow-list RAW_HTML menutup style/link/data URI berbahaya | INJ | `html-sanitizer.ts` | `<style>@import`, `<link>` eksternal |
| M08-19 | `/api/files/:session/:file` terikat tenant + parameter file aman | TENANT | `media.route.ts` | Session/file silang |
| M08-20 | `/assets` + substitusi pixel per tenant tidak lintas tenant/cache bocor | LEAK | `landing.route.ts` | `?tenant=` silang; regex `..` |

---

## Lampiran H — Check dari coverage critic M09

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M09-14 | Suggest-reply: PII ke provider, budget, injection, audit | AI | `livechat.subroute.ts`, `live-chat.service.ts` | Prompt berisi 6 pesan; ukur biaya |
| M09-15 | Read/unread/pin/dismiss/shareloc: scoping pelaku + audit + broadcast | BIZ | `message-read-status.service.ts` | Satu CS menghapus unread tenant |
| M09-16 | SSE staf: filter kepemilikan per jenis event fail-closed | AC | `staff/today.subroute.ts` | Event tanpa staffId |
| M09-17 | Sync status/cancel/health: kepemilikan job + biaya agregat | RES | `livechat.subroute.ts` | CS A cancel job CS B |
| M09-18 | Typing/seen: side effect + reset lease bot-off | BIZ | `livechat.subroute.ts` | Panggil typing berulang |
| M09-19 | Quick reply authoring/media: konten outbound tenant-wide | LEAK | `quick-replies.subroute.ts` | Media eksternal/tenant lain |

---

## Lampiran I — Check dari coverage critic M10

| ID | Invariant | Kelas | Target | Bukti minimum |
|---|---|---|---|---|
| M10-09 | Body `history`/`activeContext` divalidasi skema; role klien tidak masuk provider | AI | `copilot.subroute.ts` | Kirim history role `system` |
| M10-10 | Rate limit per principal, bukan IP/API-key bucket | RES | `copilot.subroute.ts`, `app.ts` | Dua admin NAT sama |
| M10-11 | Jalur degradasi melewati sanitizer/grounding sebelum render | AI | `copilot.service.ts` | Timeout → lastMessage mentah |
| M10-12 | Cost/usage tercatat per tenant dan engine (Hermes vs internal) | RES | `copilot.service.ts`, `hermes-adapter.ts` | Engine Hermes tanpa usage |

---

## Ringkasan jumlah unit minimum

| Kelompok | Modul | Estimasi check |
|---|---|---|
| Fondasi & identitas | M00–M07 | 115 |
| Data, uang, realtime, AI admin | M09, M10, M13, M14 | 62 |
| AI inti, RAG, integrasi | M11, M12, M16 | 43 |
| Publik, file, frontend, log | M08, M18, M20, M21 | 61 |
| Worker, supply chain, infra | M15, M17, M19 | 46 |
| Rantai lintas modul | M22 | 15 |
| **Total** | **23** | **342** |

Angka ini adalah **batas bawah** cakupan. Coverage critic di setiap wave wajib menambah unit bila menemukan surface/boundary/lifecycle yang belum terwakili.
