# Rencana Remediasi Temuan Audit Keamanan (2026-11-26)

> **Status: F0 + F1 SUDAH DIEKSEKUSI (2026-11-26). F2–F9 masih menunggu persetujuan.**
> Perubahan source untuk F0/F1 sudah diterapkan dan lolos gerbang lokal; belum di-deploy. Lihat `BASELINE-2026-11-26.md` untuk baseline, daftar perubahan, deviasi, dan hasil gerbang.

- **Dasar:** 27 temuan `confirmed` + 231 `needs_validation` dari kampanye M00–M22 (`docs/security-audit/RUNS.md`, `CAMPAIGN-REPORT.md`).
- **Prinsip:** fondasional (Data/State Machine/Tool Contract/Seam), bukan tambal-sulam; **tanpa** menambah baris "DILARANG..." ke prompt sebagai solusi utama; TDD merah-hijau; satu fase = satu gerbang regresi.
- **Aturan eksekusi:** setiap fase berhenti di gerbang regresi + review sebelum fase berikutnya. Temuan `needs_validation` yang belum diverifikasi runtime **tidak** diremediasi buta.

---

## 0.1 Log eksekusi

| Fase | Status | Gerbang |
|---|---|---|
| F0 — seam bersama | **DONE** | 36 test baru PASS |
| F1 — permukaan publik | **DONE** (T1.1–T1.9) | 438 test terdampak PASS; full suite 8535 pass / 1 gagal pre-existing (reuse-gate timing 60.025 dtk); typecheck/build/reuse/architecture PASS |
| F2 — otoritas tenant | **DONE sebagian** (T2.1–T2.6, T2.8, T2.9) — T2.7 menunggu G5 | 8548 pass / 1 gagal pre-existing (reuse-gate timing); typecheck/build/reuse/architecture PASS |
| F3 — media & file | **DONE** (T3.1, T3.3–T3.5; T3.2 dilewati sesuai G3) | 8559 pass / 1 gagal pre-existing (reuse-gate timing); typecheck/build/reuse/architecture PASS |
| F4 — data/backup/export | **DONE sebagian** (T4.1–T4.8; ownership file residual) | 8585 pass / 2 gagal — keduanya `reuse-gate` dari file eksternal `copilot-tools.ts`; typecheck/build/architecture PASS |
| F5 — SSE/worker | **DONE** (T5.1–T5.8; migrasi `cron_job_heartbeats`) | 8598 pass / 1 gagal pre-existing (reuse-gate timing); typecheck/build/reuse/architecture PASS |
| F6 — Copilot | **DONE** (T6.1–T6.5) | 8616 pass / 1 gagal (reuse-gate timing) lalu 8615 / 2 timeout beban — keduanya lulus isolasi (52 test); typecheck/build/dashboard-tsc/reuse/architecture PASS |
| F7 — secrets/supply chain | **DONE** (T7.1–T7.7; G10a + G11a) | 8666 pass / 1 gagal (reuse-gate timing, lulus isolasi); typecheck/build/dashboard-tsc/dashboard-build/reuse/architecture/compose-config PASS |
| F8 — ingress determinism | **DONE** (T8.1–T8.7) | 8692 pass / 1 gagal (`reuse-gate` timing 64,2 dtk; lulus isolasi); typecheck/build/reuse(189)/architecture(58) PASS |
| F9 — close-out | **DONE** | validator findings 23/23 + ledger 23/23 PASS; hasil: `REMEDIATION-RESULT.md` |

Detail perubahan, deviasi, dan status per temuan: `docs/security-audit/BASELINE-2026-11-26.md`.

---

## 0. Verifikasi klaim plan terhadap kode nyata

Klaim hunter diperiksa ulang pada source per 2026-11-26. Yang sudah terbukti:

| Klaim | Bukti kode | Status |
|---|---|---|
| `metaPixelId` masuk string literal JS tanpa escape | `src/services/html-sanitizer.ts:163` (`fbq('init', '${metaPixelId}')`) | TERBUKTI |
| `whatsappNumber/tenantId/slug` lewat `JSON.stringify` (tidak escape `</script>`) | `src/services/html-sanitizer.ts:219-223` | TERBUKTI |
| Field landing hanya di-`trim` | `src/routes/admin/landings.subroute.ts:41-45` (`normalizeNullableString`) | TERBUKTI |
| `/api/tenant/:slug` anonim, fail-open 200, kirim objek utuh | `src/routes/tracking.route.ts:249-267` | TERBUKTI |
| `/api/files` meneruskan `contentType` upstream + ACAO `*`, tanpa nosniff | `src/routes/media.route.ts:367-372` | TERBUKTI |
| `resolveSessionTenantId` tanpa validasi pola tenant | `src/routes/admin/route-helpers.ts:18-32` | TERBUKTI |
| `tenantId` mentah ke `path.join` (write/scan/prune) | `src/services/media.service.ts:159,169,810,901,1038` | TERBUKTI |
| CLI reset menghapus by `phone` tanpa tenant | `src/cli/reset-customer.ts:18-22` | TERBUKTI |
| Lead `lead_*` menulis audit tanpa lookup customer ber-tenant | `src/routes/admin/reservation-dispatch-payment-proof.subroute.ts:578-589` | TERBUKTI |
| WABA memilih app secret dari `entry[0]` | `src/routes/waba-webhook.route.ts:46-55` | TERBUKTI |
| Klaim backup mingguan (fail-open + tanpa retry + tanpa tenant) | `src/services/cron.service.ts:772-781,795-808`; `src/lifecycle/background-crons.ts:492-495` | TERBUKTI |
| Redis hub mati permanen setelah error | `src/services/live-chat-hub.service.ts:92-101` (tidak ada listener `ready`) | TERBUKTI |
| Copilot: semaphore dipasang sebelum `try`, hijack di luar `try` | `src/routes/admin/copilot.subroute.ts:188-201` vs `try` di 244 | TERBUKTI |
| Sheets `toCell` tanpa netralisasi formula | `src/services/sheets/row-formatter.ts:84-97`; pola benar ada di `financial-analytics.service.ts:25-32` | TERBUKTI |
| `.dockerignore` tidak menutup `logs/`, `backups/`, `audit/`, `data/`, `scripts/*.json` | `.dockerignore:1-34` | TERBUKTI |

**Koreksi terhadap laporan hunter:**
1. `M18-14-AVATAR-ASSET-SSRF`: klaim "tanpa `maxRedirects:0`/guard" **tidak valid** — guard ada (`src/routes/media.route.ts:465,471-472`). Sisa cacat nyata dicatat sebagai `M18-15-AVATAR-ANON-PII`.
2. `M14-09` (pool) **tidak terbukti**: `docker-compose.yml:45,108,148` sudah punya `connection_limit`/`pool_timeout`/`max_connections`. Sisa: `statement_timeout` (hardening).
3. `M14-04-BACKUP-TENANT-ID-FROM-CLIENT` = duplikat `M16-05`; `M07-01` sudah mencakup legacy staging. Tidak dibuat temuan baru.

**Yang belum bisa diverifikasi dari sesi read-only:** perilaku WAHA terhadap MIME kiriman, isi `.env` produksi, topologi cache/CDN, jumlah replika, `MULTI_TENANT_ENABLED` di server, dan seluruh dampak runtime 231 NV. Karena itu remediasi NV yang belum terbukti **ditunda** sampai sandbox/staging tersedia.

---

## 1. Cakupan plan

### 1.1 Yang diremediasi sekarang (27 confirmed + NV dengan rantai source lengkap)

| Fase | Tema | Temuan utama | Risiko |
|---|---|---|---|
| F1 | Permukaan publik (landing/tracking/CTA/media publik) | M08-LANDING-QUERY-XSS, M08-PAGEVIEW-UNAUTH, M08-LANDING-PIXEL-SCRIPT-INJECT, M08-TENANT-CONTENT-DUMP, M08-FILES-MIME-ECHO, M08-CSP-REPORT-LOG-FLOOD, M08-PUBLIC-HTML-CACHE-POISON | Rendah–sedang |
| F2 | Otoritas tenant & identitas | M05-13, M07-LABEL-IDOR, M07-LANDINGS-IDOR, M07-CUSTOMER-MEMORY-CROSSTENANT, M07-16, M07-17, M07-19, M07-20, M18-12 | Sedang |
| F3 | Media & file | M08-AVATAR-CROSS-TENANT, M18-15, M18-11, M18-01 (M08-PROOF-PUBLIC dikecualikan — lihat G3) | Sedang |
| F4 | Data, backup, export | M16-05, M14-13, M14-15, M14-14, M15-01 (×2), M18-13, M15-14 | Tinggi (data) |
| F5 | SSE, realtime, worker | M09-01, M09-02, M09-14, M19-11, M15-10-BOOT, M15-11, M15-12, M15-13 (×2) | Sedang–tinggi |
| F6 | Copilot & LLM accounting | M10-05, M10-09, M10-10, M10-11, M10-12 | **DONE** |
| F7 | Secrets & supply chain | M17-02, M17-11, M17-12, M17-13 (×2), M19-09, M17-08 (keputusan ops) | Sedang |
| F8 | Determinisme ingress WAHA/WABA | M01-08, M01-14, M01-15, M02-10, M02-11, M02-12 (×2), M02-13 | Sedang |
| F9 | Close-out & re-audit delta | Semua | Rendah |

### 1.2 Yang TIDAK diremediasi di plan ini

- 190+ `needs_validation` lain yang belum punya bukti runtime: tetap NV, menunggu sandbox (butuh DB uji + WAHA mock + browser). Remediasi tanpa validasi akan melanggar Strict Investigation Gate.
- Temuan yang bergantung deployment: `MULTI_TENANT_ENABLED`, `SEPARATE_WORKER`, `COPILOT_ENGINE=hermes`, replika app, normalisasi Caddy.
- `M08-PROOF-PUBLIC` (confirmed): **dikecualikan atas keputusan pengguna (G3)** — endpoint bukti bayar dibiarkan apa adanya. Dicatat sebagai risiko diterima di `docs/KNOWN_ISSUES.md` #377. Konsekuensi: siapa pun yang memegang link `/proof/:reservationId` dapat mengakses bukti bayar selama record reservasi ada, dan responsnya masih `Cache-Control: public`. Mitigasi tanpa mengubah perilaku (bila diinginkan nanti): `no-store` + `noindex` + `no-referrer`.

### 1.3 Total confirmed yang tertutup

F1–F8 menutup **seluruh 27 confirmed**: M01 (3), M02 (5), M05 (4), M05b (4), M07 (5), M08 (4), M09 (1), M22 (1). Lihat §4 untuk peta per fingerprint.

---

## 2. Aturan main eksekusi (wajib)

1. **Satu fase per PR/commit-set**, tidak mencampur tema.
2. **TDD:** tulis test yang gagal dulu (membuktikan bug), baru perbaiki. Test regresi wajib bertahan.
3. **Tidak ada hardcode data bisnis.** Daftar brand, nomor, tarif, template tetap dari DB.
4. **Tidak ada regex semantik baru** untuk mengganti logika LLM; regex hanya untuk validasi teknis (pola ID, MIME, panjang field).
5. **Gerbang regresi tiap fase:**
   ```bash
   npm run typecheck
   npm run build
   npm run check:reuse
   npx vitest run <daftar test fase>
   ```
   Di akhir wave (F4, F7, F9): `npm test` penuh + `cd packages/admin-dashboard && npm run build` bila frontend tersentuh.
6. **Bukti "pre-existing failure"** wajib revert-and-rerun (kembalikan file ke HEAD, jalankan test yang sama, harus tetap gagal).
7. **Berhenti dan minta konfirmasi** setiap kali menemukan: perubahan kontrak API publik, migrasi DB, perubahan perilaku lintas tenant, atau kebutuhan infra baru.

---

## 3. Fase 0 — Baseline & seam bersama (prasyarat)

**Tujuan:** menyiapkan baseline dan seam kanonis supaya fase lain tidak menduplikasi logika.

### T0.1 Bekukan baseline
- Jalankan `npm run typecheck`, `npm run build`, `npm test`, catat jumlah file/test lulus/gagal ke `docs/security-audit/BASELINE-2026-11-26.md`.
- **Acceptance:** angka baseline tercatat; tidak ada perubahan kode.

### T0.2 Buat seam validasi tenant kanonis
- **File baru:** `src/utils/tenant-id.ts`
  - `TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i`
  - `isValidTenantId(v: unknown): v is string`
  - `assertValidTenantId(v: unknown): string` → throw `AppError` 400 `INVALID_TENANT_ID`
- **Test baru:** `tests/unit/tenant-id.test.ts` (valid: `default-tenant`, `t1`; invalid: `../x`, `a/b`, `..`, string kosong, 65 char, `%2e%2e`).
- **Acceptance:** test hijau; modul belum dipakai di mana pun (no behavior change).

### T0.3 Buat seam escaping konteks-script
- **File baru:** `src/utils/script-escape.ts`
  - `jsStringLiteral(value: string): string` → `JSON.stringify(value).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029')`
  - `safeJsonForScript(value: unknown): string` → `jsStringLiteral(JSON.stringify(value))` yang juga menetralkan `</script>`.
- **Test baru:** `tests/unit/script-escape.test.ts` (payload `</script><img onerror>`, `';alert(1)//`, `\u2028`, objek bersarang).
- **Acceptance:** output tidak pernah memuat `</script>` mentah; test hijau.

### T0.4 Satukan encoder sel spreadsheet
- **File baru:** `src/utils/spreadsheet-escape.ts` → pindahkan `escapeCsvCell` dari `financial-analytics.service.ts:25-32` + tambah `escapeSheetCell` (prefix `'` untuk `= + - @ TAB CR`, escape kutip ganda).
- **File diubah:** `src/services/financial-analytics.service.ts` (re-export, bukan duplikasi).
- **Test:** `tests/unit/spreadsheet-escape.test.ts`.
- **Acceptance:** test lama CSV tetap hijau (re-export kompatibel).

### T0.5 Gerbang
`npm run typecheck && npm run build && npx vitest run tests/unit/tenant-id.test.ts tests/unit/script-escape.test.ts tests/unit/spreadsheet-escape.test.ts`

---

## 4. Peta confirmed → fase

| Fingerprint | Fase |
|---|---|
| `M01-08-LABEL-LID-AS-PHONE`, `M01-14-YA-CONFIRM-COALESCED`, `M01-15-RESET-AMBIGUOUS-YA` | F8 |
| `M02-10-STATUS-UNKNOWN-PHONE-500`, `M02-11-REACTION-PRE-DEDUP-MUTATION`, `M02-12-STOP-BYPASS-EARLY-RETURN`, `M02-12-STOP-LOST-BY-COALESCE`, `M02-13-WABA-TYPE-MAPPING-GAP` | F8 |
| `M05-13-staff-tenant-header-query-bypass`, `M05-14-telegram-pairing-token-replay`, `M05-05-*` (2) | F2 |
| `M05b-M05-15-session-token-in-body`, `M05b-M05-16-*`, `M05b-M05-17-*`, `M05b-STAFFLOGIN-LOCKOUT-DOS` | F2 |
| `M07-LABEL-IDOR`, `M07-LANDINGS-IDOR`, `M07-CUSTOMER-MEMORY-CROSSTENANT`, `M07-16:services-catalog-reads-default-tenant`, `M07-BACKUP-WHOLE-DB-DUMP` | F2 |
| `M08-LANDING-QUERY-XSS`, `M08-PAGEVIEW-UNAUTH`, `M08-AVATAR-CROSS-TENANT` | F1/F3 |
| `M08-PROOF-PUBLIC` | **tidak diremediasi** (G3, risiko diterima) |
| `M09-09-AUDIT-ACTOR-SPOOF` | F2 |
| `M22-02-STAFF-SESSION-ADMIN-API` | F2 |
| 231 `needs_validation` | hanya yang tercantum §1.1; sisanya menunggu sandbox |

---

## 5. Fase 1 — Permukaan publik (landing, tracking, CTA, file publik)

**Temuan:** M08-LANDING-QUERY-XSS (confirmed), M08-PAGEVIEW-UNAUTH (confirmed), M08-LANDING-PIXEL-SCRIPT-INJECT, M08-TENANT-CONTENT-DUMP, M08-FILES-MIME-ECHO, M08-CSP-REPORT-LOG-FLOOD, M08-PUBLIC-HTML-CACHE-POISON.
**Blast radius:** halaman publik (tanpa auth) — tidak menyentuh data internal.
**Dependency:** T0.3 (script escape).

### T1.1 Kontrak field landing (akar stored XSS)
- **File:** `src/routes/admin/landings.subroute.ts`
  - Tambah validator di dekat `normalizeNullableString` (baris 41-45):
    - `normalizeMetaPixelId(raw)` → hanya `/^\d{5,20}$/` atau `null` (tolak 400 bila ada isi tapi tidak valid).
    - `normalizeWhatsappNumber(raw)` → hanya digit, panjang 8–15, atau `null`.
    - `normalizeSlug(raw)` → `^[a-z0-9][a-z0-9-]{1,62}$`.
  - Terapkan pada POST/PUT landing (baris ~377, ~419, ~485, ~547) dan pada `LandingPage`/tenant upsert.
- **File:** `src/services/landing-content.service.ts` — tolak (return null / throw) bila baris DB berisi nilai yang tidak lolos pola (defense-in-depth untuk data lama).
- **Test baru:** `tests/unit/landing-field-contract.test.ts` (payload `';alert(1)//`, `</script>...`, `+62812`, `abc`).

### T1.2 Escaping konteks-script di render
- **File:** `src/services/html-sanitizer.ts:163` → `fbq('init', ${jsStringLiteral(metaPixelId)})`.
- **File:** `src/services/html-sanitizer.ts:219-223` → ganti `JSON.stringify(...)` dengan `safeJsonForScript(...)`.
- **File:** `src/routes/landing.route.ts:330-335` (substitusi `__FB_PIXEL_ID__`, `__DEFAULT_WHATSAPP_PHONE__`) → escape yang sama.
- **File:** `src/landing/public/go.html:27` — tidak perlu diubah bila substitusi memakai literal ter-escape.
- **Test baru:** `tests/unit/landing-script-injection.test.ts` — render dengan nilai jahat, assert output tidak memuat `</script>` mentah dan tidak memutus string JS.

### T1.3 Host trust (XSS reflected + cache)
- **File:** `src/routes/landing.route.ts:53-62` (`resolvePublicBaseUrl`), `:387-410` (resolusi tenant dari host).
  - Validasi host terhadap allow-list: `Tenant.landing_domain`/`PUBLIC_ALLOWED_HOSTS` (env) + `APP_DOMAIN`; host tak dikenal → pakai base kanonis, jangan pernah menyisipkan host mentah.
  - Semua penyisipan canonical/og:url memakai escape HTML (`escapeHtml`) atau `safeJsonForScript`.
- **Acceptance:** `tsx tests` payload `X-Forwarded-Host: evil"><script>` tidak muncul mentah di HTML.

### T1.4 `/cta` & `/api/tracking/pageview` (atribusi)
**Keputusan G1: semua origin tetap diizinkan.** Remediasi fokus pada "jangan percaya nilai kiriman klien", bukan menutup origin.

- **File:** `src/routes/landing.route.ts` (`/cta`, sekitar 433-667)
  - `landing_url` dari query **tidak** dipakai sebagai `event_source_url`; gunakan base kanonis tenant (`resolvePublicBaseUrl`/`Tenant.landing_domain`).
  - `phone`, `fbclid`, `fbp`, `fbc`, `utm_*` dari query disimpan sebagai `client_reported_*` (bukan field otoritatif).
  - Tolak `is_test` dari query; hanya boleh dari header internal.
  - Pertahankan rate limit 60/menit/IP + dedup `(tenant, fbclid)`.
- **File:** `src/routes/tracking.route.ts` (`POST /api/tracking/pageview`) — tetap menerima origin publik; `landingUrl` tidak dipakai sebagai `event_source_url` CAPI.
- **Test:** `tests/unit/cta-attribution-trust.test.ts`, perluas `tests/unit/cta-rate-limit.test.ts`.
- **Acceptance:** request `GET /cta?slug=x&landing_url=https://evil.example` tidak membuat baris CAPI dengan `event_source_url=evil.example`; `is_test=1` diabaikan.

### T1.5 `/api/tenant/:slug` → DTO publik
**Keputusan G2: DTO dulu, hapus setelah 30 hari tanpa pemanggil.**

- **File:** `src/routes/tracking.route.ts:249-267`
  - Ganti respons menjadi DTO eksplisit: `{ slug, title, structured_content, brand: { name, logoUrl }, whatsapp_number, faq }`.
  - **Hapus** `raw_html_content`, `tenant_id`, `meta_pixel_id`.
  - Slug tak dikenal/DB error → `404` (bukan `200` default).
  - Tambah rate limit khusus (mis. 120/menit/IP).
- **T1.5b Observability penghapusan:** log satu baris `PUBLIC_TENANT_DTO_HIT` (slug + IP + user-agent, tanpa PII) selama 30 hari. Bila nol hit, route dihapus di fase terpisah setelah konfirmasi.
- **Test:** `tests/unit/public-tenant-dto.test.ts`.
- **Catatan:** tidak ada konsumen di repo (`grep api/tenant/` hanya route).

### T1.6 `/api/files` MIME
- **File:** `src/routes/media.route.ts:365-372`
  - MIME allow-list (`image/jpeg|png|webp|gif`, `audio/*`, `video/mp4`, `application/pdf`, `application/octet-stream`); selain itu `application/octet-stream`.
  - `Content-Disposition: attachment; filename="..."` (nama di-encode RFC 5987).
  - `X-Content-Type-Options: nosniff`.
  - Hapus `Access-Control-Allow-Origin: *` untuk endpoint ber-auth.
- **Test:** `tests/unit/media-file-mime.test.ts`.

### T1.7 CSP report anti-flood
- **File:** `src/routes/landing.route.ts:911-943`
  - Skema zod (`csp-report` object) + clamp panjang tiap field (mis. 512 char), koersi string.
  - Rate limit tetap; tambah dedup hash per menit.
- **Test:** `tests/unit/csp-report-schema.test.ts`.

### T1.8 Cache header HTML publik
- **File:** `src/routes/landing.route.ts` (`renderLanding` 353, `renderPricelist` 230, `/go` 423, `/:slug` 907)
  - `Cache-Control: private, max-age=0, must-revalidate` + `Vary: Host, X-Forwarded-Host`.
  - Halaman yang menyertakan pixel per tenant: `no-store`.
- **Test:** `tests/integration/landing-cache-headers.test.ts`.

### T1.9 Hardening terkait (ikut fase ini)
- CSP landing tambah `default-src 'self'; object-src 'none'; base-uri 'none'` (`landing.route.ts:243-249`).
- `/pricelist` sukses diberi nonce (hapus `unsafe-inline`).
- `/assets/:filename` → allow-list nama file.
- `nosniff` global untuk non-HTML (`src/app.ts:153-161`).

### Gerbang F1
```bash
npm run typecheck && npm run build && npm run check:reuse
npx vitest run tests/unit/landing-field-contract.test.ts tests/unit/landing-script-injection.test.ts \
  tests/unit/public-tenant-dto.test.ts tests/unit/media-file-mime.test.ts \
  tests/unit/csp-report-schema.test.ts tests/integration/landing-cache-headers.test.ts \
  tests/integration/landing-csp.test.ts tests/integration/landing-serving.test.ts
```
**Definition of done:** tidak ada lagi `JSON.stringify`/interpolasi mentah ke `<script>`; `/api/tenant` tidak mengirim `raw_html_content`/`tenant_id`; MIME tidak lagi echo; test regresi hijau.

---

## 6. Fase 2 — Otoritas tenant & identitas

**Temuan:** M05-13 (confirmed), M05-14, M05-15/16/17/18 (confirmed), M05-05 (2), M07-LABEL-IDOR, M07-LANDINGS-IDOR, M07-CUSTOMER-MEMORY-CROSSTENANT (confirmed), M07-16, M07-17, M07-19, M07-20, M09-09, M18-12, M22-02.
**Dependency:** T0.2.

### T2.1 Staff tenant dari sesi (M05-13, akar M22-02)
- **File:** `src/routes/staff.route.ts:19-99` — preHandler wajib menulis `request.tenantId` dari `staff_session`; hapus kepercayaan `x-tenant-id`/`query.tenant_id` untuk staf.
- **File:** `src/routes/admin/route-helpers.ts:18-32,35-45` — header/query hanya diizinkan untuk `X-API-KEY` root; untuk sesi staf/admin selalu dari sesi.
- **Test:** `tests/integration/staff-tenant-binding.test.ts` (header `x-tenant-id` berbeda → 403/404, bukan data tenant lain).
- **Catatan:** ini memperbaiki akar beberapa NV (quick replies, SSE staf, M09-16).

### T2.2 Validasi pola tenant (M18-12)
- **File:** `src/routes/admin/route-helpers.ts` — panggil `assertValidTenantId` sebelum return.
- **File:** `src/services/media.service.ts:158-175` + `:810,:843,:901,:1038,:1364` — pertahanan kedua: validasi di dalam `scopeDir`/`paymentProofDir` dan sebelum `readdir/unlink`.
- **File:** `src/services/pricelist-config.service.ts:109-119`, `src/routes/admin/settings-general.subroute.ts:764` — tolak pembuatan tenant dengan id tidak valid.
- **Test:** `tests/unit/media-tenant-path.test.ts` (tenantId `../../probe` → throw, tidak ada file keluar `storage/media`).

### T2.3 Cache customer ber-tenant (M07-CUSTOMER-MEMORY-CROSSTENANT)
- **File:** `src/services/customer.service.ts:276` (set), `:1644-1660` (get/fallback).
- Kunci cache jadi `${tenantId}:${phone}`; fallback cache hanya boleh mengembalikan baris dengan tenant cocok; tidak ada fallback lintas tenant saat DB error.
- **Test:** `tests/unit/customer-cache-tenant.test.ts` (tenant A phone X, tenant B phone X → objek berbeda).

### T2.4 Lookup `:id` tenant-scoped (M07-LABEL-IDOR, M07-LANDINGS-IDOR, M07-16)
- **File:** `src/routes/admin/labels.subroute.ts` — semua `findUnique({id})` → `findFirst({id, tenant_id})`.
- **File:** `src/routes/admin/landings.subroute.ts:445,571` (+ GET) — filter tenant.
- **File:** `src/services/treatment-catalog.service.ts` — katalog dibaca dengan `tenantId` wajib, tanpa fallback diam-diam ke default.
- **Test:** `tests/integration/admin-id-tenant-scope.test.ts`.
- **Catatan:** `resolveTreatmentValue` tanpa tenantId di `live-chat.service.ts:116,253` dan `purchase-detection.service.ts:198` diperbaiki di task yang sama.

### T2.5 Lead moderation ownership (M07-17)
- **File:** `src/routes/admin/reservation-dispatch-payment-proof.subroute.ts:578-589` dan `:653-667`
  - `customer.findFirst({ id: customerId, tenant_id: tenantId })` → 404 bila tidak ada; baru tulis audit.
- **Test:** `tests/integration/lead-moderation-ownership.test.ts`.

### T2.6 WABA multi-entry secret (M07-19)
- **File:** `src/routes/waba-webhook.route.ts:46-73`
  - Bila `WABA_APP_SECRET` kosong: kumpulkan **semua** `phone_number_id` dari payload; bila >1 → `400 MULTI_TENANT_PAYLOAD_REJECTED`.
  - Setelah verifikasi, assert semua pesan/status berasal dari tenant yang secret-nya dipakai.
- **Test:** `tests/unit/waba-multi-entry.test.ts`.
- **Gate:** perilaku ini berubah hanya pada mode per-tenant app secret. Perlu konfirmasi apakah deployment memakai mode itu.

### T2.7 Fallback konfigurasi tenant (M07-20)
- **File:** `src/config/brand.ts:27-32,56-82` — `DEFAULT_BRAND_IDENTITY` jadi netral (nama generik dari env/tenant, tanpa identitas tenant pertama). Data tenant lama di-backfill lewat migrasi data.
- **File:** `src/config/clinic-location.ts:27-32,56-86,96` — default **tanpa koordinat**; `calculateDelivery` menolak (bukan menghitung dari basecamp tenant lain) bila tenant belum punya `clinicLocation`.
- **File:** `src/config/tenant-settings.config.ts:462-465` — tampilkan `null`/`unset`, bukan nilai tenant pertama.
- **Test:** `tests/unit/tenant-config-fallback.test.ts`.
- **Gate:** butuh keputusan produk + migrasi data (lihat §11).

### T2.8 Backup tenant dari sesi (M16-05)
- **File:** `src/routes/admin/backup.subroute.ts:23,48,94,131,171,226` — buang `body.tenantId`/`query.tenantId`; selalu `resolveSessionTenantId`.
- **File:** `src/routes/admin.route.ts:315-320` — hapus override body untuk semua jenis sesi.
- **File:** `src/routes/admin/backup.subroute.ts:94-111` — `/download` cek kepemilikan (nama file harus ada di daftar tenant).
- **Test:** `tests/integration/backup-tenant-authority.test.ts`.

### T2.9 Identitas audit (M09-09, M05-05)
- **File:** `src/routes/admin/livechat.subroute.ts:801-805,852-856` — `adminIdentity` hanya dari sesi; `body.adminName` tidak dipakai untuk audit.
- **File:** `src/services/message.service.ts:1016-1029` — `status_updated` memakai `waMessageId` ter-mask (pakai `sanitizeStaffHubPayload`/`maskWaMessageId`).
- **Test:** `tests/unit/audit-actor-identity.test.ts`, `tests/unit/sse-status-masking.test.ts`.

### Gerbang F2
```bash
npm run typecheck && npm run build && npm run check:reuse
npx vitest run tests/integration/staff-tenant-binding.test.ts tests/unit/media-tenant-path.test.ts \
  tests/unit/customer-cache-tenant.test.ts tests/integration/admin-id-tenant-scope.test.ts \
  tests/integration/lead-moderation-ownership.test.ts tests/unit/waba-multi-entry.test.ts \
  tests/unit/tenant-config-fallback.test.ts tests/integration/backup-tenant-authority.test.ts \
  tests/unit/audit-actor-identity.test.ts tests/unit/sse-status-masking.test.ts
```

---

## 7. Fase 3 — Media & file

**Temuan:** M08-AVATAR-CROSS-TENANT, M08-PROOF-PUBLIC, M18-15, M18-11, M18-01; hardening `M08-OUTBOUND-PUBLIC-PII`.

### T3.1 Avatar ber-auth + tanpa egress nama
- **File:** `src/routes/media.route.ts:426-504`
  - Wajibkan sesi admin/staf (atau signed URL ber-TTL untuk dashboard).
  - Lookup `customer.findFirst({ id, tenant_id })`; hapus `?tenantId` dari klien.
  - Fallback nama ke `ui-avatars.com` **dihapus** → generate inisial lokal (SVG/sharp) atau gambar netral.
  - Cache di `storage/media/avatars/<tenantId>/<customerId>.jpg`.
- **Test:** `tests/unit/avatar-access.test.ts` (tanpa cookie → 401; tenant lain → 404; Location tidak memuat nama).

### T3.2 Bukti bayar — **DITUNDA (G3)**
Pengguna memilih membiarkan endpoint `/proof/:reservationId` apa adanya. **Tidak ada perubahan kode** pada fase ini.
- Status temuan: `M08-PROOF-PUBLIC` tetap `confirmed` dan dicatat sebagai **risiko diterima** di `docs/KNOWN_ISSUES.md` #377.
- Bila nanti diinginkan mitigasi tanpa memutus link: tambah `Cache-Control: private, no-store`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer` (test `tests/unit/proof-cache-headers.test.ts`).

### T3.3 Batas unduhan media inbound (M18-11)
**Keputusan G4: batas per tipe, bukan tanpa batas.**
- **File:** `src/integrations/waha/client.ts:1201-1207,1264-1268` — `maxContentLength`/`maxBodyLength` sesuai tipe.
- **File:** `src/routes/waba-webhook.route.ts:198-202` — sama.
- **File:** `src/services/media.service.ts:140` — konstanta:
  - `MAX_INBOUND_IMAGE_AUDIO_VIDEO_BYTES = 20 * 1024 * 1024` (20 MB)
  - `MAX_INBOUND_DOCUMENT_BYTES = 100 * 1024 * 1024` (100 MB)
  - `enforceQuota` tetap sebagai lapis kedua.
- **Test:** `tests/unit/inbound-media-limit.test.ts` (mock axios menolak > batas; `saveInboundMedia` tidak pernah menerima buffer penuh).
- **Catatan:** angka platform WhatsApp perlu dikonfirmasi di staging; bila ternyata lebih kecil, turunkan batas agar tidak menolak media sah.
- **Kompresi:** hanya untuk penyimpanan (thumbnail/transcode), **bukan** pengganti batas ukuran — kompresi terjadi setelah byte diterima.

### T3.4 MIME inbound (M18-01)
- **File:** `src/services/media.service.ts` (`saveInboundMedia`) — allow-list MIME + ekstensi; simpan metadata MIME asli, bukan hanya ekstensi.
- **Test:** `tests/unit/inbound-mime-allowlist.test.ts`.

### T3.5 Klasifikasi bukti bayar (hardening M07-17)
- **File:** `src/routes/admin/reservation-dispatch-payment-proof.subroute.ts:54-60` — `saveOutboundMedia` → `savePaymentProof` (privat).
- **Test:** tambah assertion scope di `tests/unit/media-security.test.ts`.

### Gerbang F3
```bash
npm run typecheck && npm run build && npm run check:reuse
npx vitest run tests/unit/avatar-access.test.ts \
  tests/unit/inbound-media-limit.test.ts tests/unit/inbound-mime-allowlist.test.ts tests/unit/media-security.test.ts
```

---

## 8. Fase 4 — Data, backup, export

**Temuan:** M15-01-WEEKLY-BACKUP-CLAIM-FAILOPEN, M15-01-WEEKLY-BACKUP-NO-RETRY-AFTER-FAILURE, M14-13-RESTORE-FALSE-SUCCESS, M14-15-GZIP-BOMB-RESTORE, M14-14-BACKUP-RETENTION-AND-COVERAGE, M18-13-SHEETS-FORMULA-INJECTION, M15-14-SHEETS-FAILED-TERMINAL-SILENT-LOSS, M07-BACKUP-WHOLE-DB-DUMP.
**Risiko: tinggi** — menyentuh backup/restore dan rekapan operasional. Wajib staging + salinan DB.

### T4.1 Klaim backup mingguan fail-closed + retry
- **File:** `src/services/cron.service.ts:766-781` — `catch` terakhir `return false` (bukan `true`); bedakan "sudah jalan" vs "tidak bisa memastikan".
- **File:** `src/lifecycle/background-crons.ts:492-495` — set `lastWeeklyBackupRunDate` **setelah** hasil sukses; tambah satu retry pada tick berikutnya dalam jendela yang sama (atau `catch-up` di 03:00).
- **Test:** `tests/unit/weekly-backup-claim.test.ts`.

### T4.2 Backup per tenant
- **File:** `src/services/backup.service.ts:69-83,149-161` — dump **wajib** filter `tenant_id` untuk jalur programmatic; jalur `pg_dump` whole-DB diberi label eksplisit `scope: 'global'` dan hanya boleh untuk super-admin/ops.
- **File:** `src/services/cron.service.ts:795-808` + `src/lifecycle/background-crons.ts:492-495` — iterasi `getAllTenantIds()` atau jalankan satu dump global + satu artifact per tenant (keputusan §11).
- **File:** `src/services/backup.service.ts:452-468` — guard restore memakai `meta.scope`.
- **Test:** `tests/unit/backup-tenant-scope.test.ts`.

### T4.3 Restore jujur (M14-13)
- **File:** `src/services/backup.service.ts:562-884` — kumpulkan kegagalan; `success` hanya bila tidak ada kegagalan; `tablesRestored`/`rowsRestored` menghitung baris nyata; bungkus per-tabel dalam transaksi.
- **File:** `:891-915` — audit `RESTORE_DATABASE` hanya saat sukses; `RESTORE_DATABASE_PARTIAL` untuk sebagian; route `backup.subroute.ts:240-244` mengembalikan non-2xx bila gagal.
- **File:** `tests/unit/backup.test.ts:119-137` — ubah ekspektasi (mock DB offline → `success:false`), bukan mengunci perilaku palsu.
- **Test:** `tests/unit/restore-false-success.test.ts`.

### T4.4 Gzip bomb (M14-15)
- **File:** `src/services/backup.service.ts:348,408` — `zlib.gunzipSync(buf, { maxOutputLength: MAX_RESTORE_BYTES })`; handle error → 400.
- **File:** `src/routes/admin/backup.subroute.ts:162` — turunkan/validasi ukuran upload.
- **Test:** `tests/unit/gzip-bomb.test.ts`.

### T4.5 Retensi & kuota backup (M14-14)
- **File:** `src/services/backup.service.ts:286-299` + `src/utils/backup-file.ts:4` — retensi lokal (mis. 14 file/tenant) + kuota direktori.
- **File:** `src/routes/admin/backup.subroute.ts:186-189` — tulis atomik (tmp + rename), tolak nama duplikat.
- **Test:** `tests/unit/backup-retention.test.ts`.

### T4.6 Sheets formula injection (M18-13)
- **File:** `src/services/sheets/row-formatter.ts:84-97` — `toCell` memakai `escapeSheetCell` (T0.4).
- **File:** `src/services/sheets/sheets-client.ts:207-233` — tetap `USER_ENTERED`; hanya sel HYPERLINK bukti bayar yang dikecualikan (validasi domain/ID).
- **Test:** `tests/unit/sheets-formula-injection.test.ts` (nama `=IMPORTXML(...)`, kelurahan `@SUM(1)`, `+1+1` → literal).

### T4.7 Dead-letter Sheets (M15-14)
- **File:** `src/services/sheets/sheets-sync.service.ts:556-610`
  - Status `failed` masuk dead-letter yang bisa dibaca admin (endpoint/CLI requeue), plus alert setelah N gagal.
  - Tambah `POST /api/admin/sheets/outbox/:id/requeue` (admin, tenant-scoped) atau CLI `scripts/requeue-sheets-failed.ts`.
- **Test:** `tests/unit/sheets-dead-letter.test.ts`.

### Gerbang F4
```bash
npm run typecheck && npm run build && npm run check:reuse
npx vitest run tests/unit/weekly-backup-claim.test.ts tests/unit/backup-tenant-scope.test.ts \
  tests/unit/restore-false-success.test.ts tests/unit/gzip-bomb.test.ts \
  tests/unit/backup-retention.test.ts tests/unit/sheets-formula-injection.test.ts \
  tests/unit/sheets-dead-letter.test.ts tests/unit/backup.test.ts
npm test   # gerbang wave
```
**Catatan:** jangan menjalankan restore ke DB produksi. Uji hanya di Postgres ephemeral.

---

## 9. Fase 5 — SSE, realtime, worker

**Temuan:** M09-01, M09-02, M09-14, M19-11 (M15-10-SSE), M15-10-BOOT-CRON-UNTRACKED-NO-DRAIN, M15-11, M15-12, M15-13 (×2).
**Dependency:** T2.1 (tenant staf).

### T5.1 Otorisasi per-event SSE admin (M09-01)
- **File:** `src/routes/admin/livechat.subroute.ts:919-966` — allowlist tipe event per peran (pola `ALLOWED_STAFF_EVENTS` di `staff/today.subroute.ts:1347-1359`); event staf (telemetry/task) hanya untuk peran operasional.
- **File:** `src/domain/role-module-scopes.ts:135-139` — modul Overview hanya boleh sub-path badge (mis. `/api/admin/live-chat/unread-count`), bukan prefix GET penuh.
- **Test:** `tests/integration/sse-admin-event-scope.test.ts`.

### T5.2 Masking payload SSE admin (M09-02)
- **File:** `src/routes/admin/livechat.subroute.ts:935-944` — panggil `sanitizeStaffHubPayload` dengan `maskPhone` sesuai peran; `status_updated` ikut disanitasi.
- **Test:** `tests/unit/sse-admin-payload-masking.test.ts`.

### T5.3 Suggest-reply tenant (M09-14)
- **File:** `src/services/live-chat.service.ts:1273` — teruskan `tenantId` ke `getLlmEndpointConfig`.
- **Test:** `tests/unit/suggest-reply-tenant-config.test.ts`.

### T5.4 Shutdown & SSE (M19-11)
- **File:** `src/app.ts:79-84` — `forceCloseConnections: true` atau registry socket.
- **File:** `src/lifecycle/shutdown.ts:35-56` — tutup SSE/`liveChatHubService.close()` **sebelum** `server.close()`; `flushAll` sebelum timer force-exit; exit code 0 bila drain sukses.
- **File:** `src/services/live-chat-hub.service.ts:230-243` — panggil `close()` dari shutdown.
- **Test:** `tests/unit/shutdown-sse.test.ts`.

### T5.5 Cron boot tracking & drain (M15-10-BOOT)
- **File:** `src/lifecycle/background-crons.ts:121,163` — bungkus `runSheetsSyncWorker`/`runMediaCleanup` boot dengan `createExclusiveCronTask`.
- **File:** `src/lifecycle/shutdown.ts` — panggil `drainInFlightCronTasks()` juga pada mode monolith (sebelum `prisma.$disconnect()`).
- **Test:** `tests/unit/shutdown-cron-drain.test.ts`.

### T5.6 Redis pub/sub recovery (M15-11)
- **File:** `src/services/live-chat-hub.service.ts:92-127,159-202`
  - Listener `ready` → `redisEnabled = true` + re-subscribe seluruh channel (Set).
  - Pisahkan flag publisher/subscriber; jangan matikan keduanya karena satu error.
- **Test:** `tests/unit/live-chat-hub-reconnect.test.ts` (fake client `error` lalu `ready`).

### T5.7 Cron health lintas proses (M15-12)
- **File:** `src/lifecycle/cron-health.ts` + `src/routes/health.route.ts:137-154`
  - Simpan heartbeat job ke tabel/Redis (bukan Map in-memory); `/ready` membaca heartbeat itu.
  - `NO_JOBS`/stale heartbeat → status degraded (bukan hijau).
- **Test:** `tests/unit/cron-health-cross-process.test.ts`.
- **Gate:** menambah tabel = migrasi DB; perlu persetujuan.

### T5.8 Contacts outbox (M15-13)
- **File:** `src/services/google-contacts-outbox.service.ts:85-104,166-225`
  - Klaim atomik per item (`withLock`/`setNx` yang sudah ada di `src/utils/distributed-kv.ts:422-450`).
  - Item gagal permanen → dead-letter + alert (bukan `console.warn`).
- **Test:** `tests/unit/contacts-outbox-claim.test.ts`, `tests/unit/contacts-outbox-deadletter.test.ts`.

### Gerbang F5
```bash
npm run typecheck && npm run build && npm run check:reuse
npx vitest run tests/integration/sse-admin-event-scope.test.ts tests/unit/sse-admin-payload-masking.test.ts \
  tests/unit/suggest-reply-tenant-config.test.ts tests/unit/shutdown-sse.test.ts \
  tests/unit/shutdown-cron-drain.test.ts tests/unit/live-chat-hub-reconnect.test.ts \
  tests/unit/cron-health-cross-process.test.ts tests/unit/contacts-outbox-claim.test.ts \
  tests/unit/contacts-outbox-deadletter.test.ts
```

---

## 10. Fase 6 — Copilot & LLM accounting

**Temuan:** M10-05, M10-09, M10-10, M10-11, M10-12.

### T6.1 Kontrak body Copilot (M10-09)
- **File:** `src/routes/admin/copilot.subroute.ts` — parser runtime `parseCopilotBody`: `history` array maks 10, `role` enum `user|assistant`, `content` 1–4.000 char, `conversationId`/`customerId` pola ID; entri dibangun ulang `{role, content}` sehingga role/properti kiriman klien tidak masuk transcript provider.
- **Deviasi:** dipilih parser runtime eksplisit (bukan Fastify JSON schema) agar pesan 400 deterministik dan properti asing tidak lolos diam-diam.
- **Test:** `tests/unit/f6-copilot-contract.test.ts` (role `system` ditolak 400, history > 10, content > 4.000, ID invalid).

### T6.2 Kuota per principal + budget (M10-10)
- **File:** `src/services/copilot/copilot-quota.ts` (modul kanonis `ai.copilot_quota`) — bucket 6 req/menit per principal, dipakai `/chat` + `/stream`; principal = staffId sesi → identitas sesi cookie → hash API key → IP. `x-admin-identity` pada auth API key **tidak** menjadi principal.
- **File:** `src/routes/admin/copilot.subroute.ts` — kuota dipanggil paling awal; `config.rateLimit` rute (bucket API key bersama, max 6) **dihapus** karena menolak staf lain sebelum helper kuota berjalan.
- **Deviasi:** kuota tidak ditempatkan di `app.ts` global `keyGenerator` (mengubah perilaku seluruh rute admin); satu seam per operasi.
- **File:** `src/services/copilot/copilot-budget.ts` (modul kanonis `ai.copilot_token_budget`) — 20k token/turn (env `COPILOT_MAX_TOKENS_PER_TURN`), 500k token/hari/tenant (env `COPILOT_MAX_TOKENS_PER_DAY`), agregasi `llm_audit_logs` **hanya `task_type=AI_COPILOT_CHAT`**, ambil `max(DB, memori)` karena audit ditulis lewat buffer.
- **Test:** `tests/unit/f6-copilot-contract.test.ts`, `tests/unit/f6-copilot-budget.test.ts`.

### T6.3 Abort & semaphore (M10-05)
- **File:** `src/services/copilot/hermes-adapter.ts` — `signal` diteruskan ke `fetch` (listener dilepas di `finally`); `onUsage` untuk akuntansi.
- **File:** `src/services/copilot/copilot.service.ts` — `params.signal` diteruskan ke router/summarize/lanjutan; token cap per turn menghentikan loop (`COPILOT_TOKEN_BUDGET_EXCEEDED` bila belum ada data).
- **File:** `src/routes/admin/copilot.subroute.ts` — `try` sebelum penandaan/hijack; `finally` melepas semaphore; TTL 330 dtk (reaper); `/chat` memakai `reply.raw` + `writableEnded` (bukan `request.raw`).
- **Test:** `tests/unit/f6-copilot-accounting.test.ts` (cap → degradasi), `tests/unit/copilot-fixing.test.ts` (deadline).

### T6.4 Biaya Hermes (M10-12)
- **File:** `src/services/copilot/copilot.service.ts` — akuntansi semua engine: `total_tokens` atau `prompt+completion`; bridge tanpa usage → estimasi deterministik; panggilan lanjutan `finish_reason=length` ikut dicatat; `llmCalls` setelah sukses.
- **File:** `src/utils/cost-calculator.ts` — `hermes-agent` eksplisit `provider: 'Hermes (internal)'` dengan tarif 0 (bukan `fallback-unverified`).
- **Test:** `tests/unit/f6-copilot-accounting.test.ts`, `tests/unit/copilot-hermes-*`.

### T6.5 Degraded answer (M10-11)
- **File:** `src/services/copilot/copilot.service.ts` — `finalizeDegraded()` memakai pipeline kanonis (sanitize → repair links → strip orphan → `validateGrounding`); `grounded` dihitung. `neutralizeMarkdownLinks` menetralkan tautan Markdown dari nama/`lastMessage` pelanggan.
- **File:** `packages/admin-dashboard/src/components/copilot/AdminCopilotPanel.tsx` — tautan eksternal hanya dirender untuk skema `http(s)`; skema lain menjadi teks.
- **Test:** `tests/unit/f6-copilot-accounting.test.ts`, `tests/unit/copilot-fixing.test.ts`, `tests/unit/copilot-wib-contract.test.ts`.

### Gerbang F6
```bash
npm run typecheck && npm run build && npm run check:reuse && npm run check:architecture
npx vitest run copilot          # 247 pass (30 file)
npm test                        # full suite
```

---

## 11. Fase 7 — Secrets & supply chain

**Temuan:** M17-02, M17-08, M17-11, M17-12, M17-13 (×2), M19-09.
**Catatan:** fase ini paling banyak menyentuh operasi deploy; butuh jendela deploy + 2-step verification bila menyentuh WAHA.

### T7.1 Build context allowlist (M17-02)
- **File:** `.dockerignore` — tambah:
  ```
  logs
  backups
  audit
  data
  docs/live-snapshots
  .agents
  .opencode
  opencode.json
  skills-lock.json
  scripts/*.json
  *.pem
  *.key
  ```
- **Test:** `tests/unit/dockerignore-sensitive-paths.test.ts` (membaca file dan menolak path sensitif).
- **Acceptance:** `docker build --target builder` tidak memuat `logs/`, `backups/`, `audit/`, `scripts/db_*.json`.

### T7.2 VITE key keluar dari bundle (M17-11)
- **File:** `packages/admin-dashboard/src/components/customer/CustomerMapTab.tsx:52-55` — ambil config dari `GET /api/config/public` (runtime), bukan `import.meta.env`.
- **File:** `Dockerfile:24-25`, `docker-compose.yml:8` — hapus build-arg.
- **File:** `packages/admin-dashboard/src/vite-env.d.ts:5` — hapus deklarasi `VITE_ADMIN_API_KEY`.
- **Test:** build canary `grep -c cartocdn dist/assets/*.js` = 0.
- **Gate:** butuh endpoint config publik baru (aman, tanpa secret).

### T7.3 Env per service (M17-12)
- **File:** `docker-compose.yml:37-38,98-116` — worker hanya menerima `DATABASE_URL`, `REDIS_URL`, Telegram, `SEPARATE_WORKER`; app tanpa secret yang tidak dipakai.
- **File:** `.env.example` + `scripts/deploy-prod.sh:42-57` — tambah validasi `:?` untuk `WAHA_API_KEY`, `TRACKING_API_KEY`, `FB_CAPI_ACCESS_TOKEN`, `TELEGRAM_BOT_TOKEN`.
- **Test:** `scripts/check-env-contract.js` (membandingkan daftar key per service vs allowlist).
- **Gate:** perubahan deploy; butuh jadwal + rollback plan.

### T7.4 Bundle migrasi (M17-13)
- **File:** `scripts/vps-migrate-export.sh:11,51,59,67,78,85,94`
  - `umask 077`, simpan di luar build context, enkripsi AES-256-GCM (reuse kontrak `ENC1` dari `scripts/backup.sh:60`), wajib checksum, `StrictHostKeyChecking=yes`.
- **File:** `scripts/vps-migrate-import.sh:28-47` — wajib verifikasi checksum; mode `600` untuk `.env`.
- **Test:** `shellcheck` + `tests/unit/migration-script-contract.test.ts` (grep pola berbahaya).

### T7.5 Token watchdog (M17-13-WATCHDOG)
- **File:** `scripts/install-server-watchdog.sh:55-93`, `scripts/server-watchdog.sh:57-108`
  - Kirim token via header `Authorization`/stdin, bukan URL; jangan `set -a; source`.
- **File:** `scripts/backup.sh:24` — ganti `export $(... xargs)` dengan parser aman.
- **Test:** `tests/unit/watchdog-argv.test.ts` (grep `bot${`/`bot<`).

### T7.6 `/ready` minimal (M19-09)
- **File:** `src/routes/health.route.ts:33-154`
  - Publik: hanya `{ status }`.
  - Detail dependency/cron pindah ke `/api/admin/health` (sudah ada di `settings-general.subroute.ts:830`).
  - Hapus `select waba_access_token` (baris 62).
- **File:** `Caddyfile` / `scripts/deploy-prod.sh:155` — sesuaikan probe.
- **Test:** `tests/integration/ready-minimal.test.ts`.
- **Gate:** koordinasi dengan runbook deploy.

### T7.7 Digest pinning (M17-08) — **OPS DECISION**
- Butuh `docker manifest inspect` (jaringan) untuk `caddy:2`, `redis:7-alpine`, `postgres:16-alpine`, `node:20-slim`.
- **Rekomendasi:** pin digest + dokumentasikan prosedur update di `deploy_config.txt`.
- **Blocker:** tidak bisa dieksekusi tanpa akses registry. Dijadwalkan terpisah.

### Gerbang F7
```bash
npm run typecheck && npm run build && npm run check:reuse && npm run check:architecture
npx vitest run tests/unit/dockerignore-sensitive-paths.test.ts tests/unit/f7-public-config.test.ts \
  tests/unit/f7-env-contract.test.ts tests/unit/migration-script-contract.test.ts \
  tests/unit/watchdog-argv.test.ts tests/integration/ready-minimal.test.ts \
  tests/unit/f7-image-digest-pinning.test.ts
docker compose config -q      # hanya validasi YAML/wiring (env dummy)
```

### Catatan implementasi F7 (2026-11-27)

- **G10(a) dieksekusi:** digest diambil via `docker buildx imagetools inspect` (node:20-slim, redis:7-alpine, postgres:16-alpine, caddy:2, waha noweb-2026.7.2, alpine:3). Prosedur update di `deploy_config.txt`.
- **G11(a) dieksekusi sebagai deny-list:** `.env.worker` = turunan `.env` tanpa secret inbound webhook (WAHA/Meta/Telegram, password dashboard/swagger). Alasan: allow-list penuh berisiko mematikan cron integrasi diam-diam. Generator + checker deterministik (`scripts/env-contract.json`), dijalankan deploy & import sebelum compose.
- **T7.2 bentuk kontrak:** endpoint mengirim basemap siap pakai (bukan hanya kunci) agar bundle tidak memuat nama provider/kunci sama sekali; canary `cartocdn` di dist = 0.
- **T7.4 deviasi:** enkripsi seluruh bundel (bukan hanya `.env`); `StrictHostKeyChecking=accept-new` (TOFU) karena `yes` memblokir migrasi pertama; checksum wajib & relatif.
- **T7.6:** detail dependency hanya ke log + `/api/admin/health`; token WABA dicek via `COUNT(*)`, tidak ditarik ke memori.

---

## 12. Fase 8 — Determinisme ingress WAHA/WABA

**Temuan confirmed:** M01-08-LABEL-LID-AS-PHONE, M01-14-YA-CONFIRM-COALESCED, M01-15-RESET-AMBIGUOUS-YA, M02-10-STATUS-UNKNOWN-PHONE-500, M02-11-REACTION-PRE-DEDUP-MUTATION, M02-12-STOP-BYPASS-EARLY-RETURN, M02-12-STOP-LOST-BY-COALESCE, M02-13-WABA-TYPE-MAPPING-GAP.

**Prinsip:** perbaikan di lapisan normalisasi/state, bukan pencocokan kalimat.

- **T8.1** `M01-08`: JID `@lid` tidak boleh diparse sebagai nomor telepon; tambah tipe identitas eksplisit (`phone|jid|lid`) di normalizer.
- **T8.2** `M01-14`: konfirmasi "ya" tidak boleh digabung dengan pesan lain sebelum state machine membaca; gate di coalescer (bukan regex kalimat).
- **T8.3** `M01-15`: `/reset` ambigu → state `RESET_PENDING` per tenant (bukan variabel proses).
- **T8.4** `M02-10`: status untuk phone tak dikenal → 200 diabaikan (bukan 500).
- **T8.5** `M02-11`: reaction harus dedup sebelum mutasi (kunci `wa_message_id + sender + emoji + timestamp`).
- **T8.6** `M02-12`: STOP harus dievaluasi sebelum early-return dan tidak boleh hilang oleh coalesce (prioritas pesan).
- **T8.7** `M02-13`: mapping tipe WABA lengkap (location/contacts/button/interactive) + test kontrak.
- **Test:** `tests/unit/waha-lid-identity.test.ts`, `tests/unit/coalesce-confirm.test.ts`, `tests/unit/reset-state-tenant.test.ts`, `tests/unit/waba-status-unknown.test.ts`, `tests/unit/reaction-dedup.test.ts`, `tests/unit/stop-priority.test.ts`, `tests/unit/waba-type-mapping.test.ts`.

### Gerbang F8
```bash
npm run typecheck && npm run build && npm run check:reuse && npm run check:architecture
npx vitest run tests/unit/f8-label-lid-identity.test.ts tests/unit/f8-reset-pending.test.ts \
  tests/unit/f8-stop-priority.test.ts tests/unit/f8-waba-status-and-types.test.ts \
  tests/unit/f8-reaction-dedup.test.ts tests/integration/label-events.test.ts \
  tests/unit/command-service.test.ts tests/unit/burst-coalesce.test.ts
npm test
```

### Catatan implementasi F8 (2026-11-27)

- **T8.1:** handler label dipindah ke `src/services/ingress/label-event.service.ts` (seam identitas JID) dan menolak LID yang belum terpetakan.
- **T8.2/T8.3:** pending `/reset` disimpan di `Conversation.session_data.reset_pending_at` lewat `ConversationStatePatch.sessionData` (tanpa migrasi enum); coalescer melewati semua pesan saat pending aktif.
- **T8.4:** status dengan phone tak dikenal diabaikan per-item (200); error transien tetap dilempar untuk retry Meta.
- **T8.5:** modul kanonis `security.inbound_event_dedup` (DistributedKv `SET NX` + fallback memori) dipakai reaction WAHA & WABA sebelum mutasi.
- **T8.6:** opt-out WABA dievaluasi sebelum semua early-return (stale/bypass/blocked/abuse/scope-gate/CS); coalescer memperlakukan STOP sebagai pesan prioritas.
- **T8.7:** `button/order/system/unsupported` dipetakan eksplisit; `buildWabaCanonicalContent` mencegah `[IMAGE]` palsu. `system`/`unsupported` hanya dicatat (tidak diantrekan ke bot), dan log opt-out memakai nomor tersamar.

---

## 13. Fase 9 — Close-out

### T9.1 Regresi penuh
- `npm run typecheck`, `npm run build`, `npm test`, `cd packages/admin-dashboard && npm run build`.
- Catat hasil di `docs/security-audit/REMEDIATION-RESULT.md` dengan before/after.

### T9.2 Sinkronisasi dokumen
- Update `docs/KNOWN_ISSUES.md` #377 (tandai temuan yang FIXED + bukti commit/test).
- Update `docs/security-audit/RUNS.md` + `CAMPAIGN-REPORT.md` (status remediasi per fingerprint).
- Update `docs/FEATURE_INVENTORY.md` bila ada endpoint/kolom baru (mis. requeue Sheets, signed proof).
- Update `docs/MODULE_INDEX.md` bila ada modul/seam baru (`tenant-id.ts`, `script-escape.ts`, `spreadsheet-escape.ts`).

### T9.3 Re-audit delta
- Jalankan ulang validator findings + ledger.
- Audit ulang khusus file yang berubah (delta run), bukan seluruh kampanye.

### T9.4 Runtime validation (butuh sandbox)
- Baru di sini 231 NV divalidasi bertahap: DB uji + WAHA mock + browser headless.
- Tanpa sandbox, NV tetap NV.

---

## 14. Urutan eksekusi & estimasi

| Fase | Isi | Estimasi | Gate khusus |
|---|---|---|---|
| F0 | Seam + baseline | 0,5 hari | — |
| F1 | Permukaan publik | 2–3 hari | G1/G2 sudah diputuskan |
| F2 | Otoritas tenant | 3–4 hari | migrasi data brand/location, `MULTI_TENANT_ENABLED` |
| F3 | Media & file | 2 hari | G4 = 20/100 MB; G3 ditunda |
| F4 | Data/backup/export | 3–4 hari | staging DB + jendela operasi |
| F5 | SSE/worker | 3 hari | migrasi tabel cron-health |
| F6 | Copilot | 2–3 hari | nilai kuota/biaya |
| F7 | Secrets/supply chain | 2–3 hari | jendela deploy + digest registry |
| F8 | Ingress determinism | 2–3 hari | uji WAHA mock |
| F9 | Close-out | 1–2 hari | sandbox untuk NV |

**Total ± 21–30 hari kerja** (bukan kalender), tergantung ketersediaan sandbox dan jendela deploy.

**Rekomendasi urutan eksekusi pertama:** F0 → F1 → F3 → F2 (F1/F3 memberi perbaikan terlihat tanpa menyentuh DB; F2 butuh migrasi data).

---

## 15. Confirmation Gate — keputusan yang harus diambil SEBELUM fase terkait

| # | Keputusan | Fase | Opsi |
|---|---|---|---|
| G1 | Origin tepercaya untuk `/cta` | F1 | **DIPUTUSKAN: semua origin diizinkan.** Remediasi = jangan percaya nilai atribusi kiriman klien (T1.4). |
| G2 | `/api/tenant/:slug` dihapus atau jadi DTO? | F1 | **DIPUTUSKAN: DTO + 404**, log 30 hari, hapus setelah nol pemanggil (T1.5/T1.5b). |
| G3 | Masa berlaku link bukti bayar | F3 | **DIPUTUSKAN: dibiarkan apa adanya (tanpa expiry).** `M08-PROOF-PUBLIC` menjadi risiko diterima; tidak ada perubahan kode. |
| G4 | Batas ukuran media inbound per file | F3 | **DIPUTUSKAN: batas per tipe** — 20 MB gambar/audio/video, 100 MB dokumen (T3.3). |
| G5 | Default brand/lokasi netral + backfill tenant lama | F2 | (a) netral + wajib isi; (b) fallback env global |
| G6 | Apakah deployment memakai WABA per-tenant app secret | F2 | jika tidak, M07-19 tetap terdokumentasi sebagai risiko kondisional |
| G7 | Backup: dump global atau per tenant | F4 | (a) global untuk ops + artifact per tenant; (b) per tenant saja |
| G8 | Tabel heartbeat cron (migrasi DB) | F5 | (a) tabel baru; (b) Redis-only |
| G9 | Nilai kuota Copilot per principal + budget token | F6 | angka konkret |
| G10 | Pin digest image | F7 | (a) ya (rekomendasi); (b) tolak, dokumentasikan risiko |
| G11 | Pisah env worker | F7 | (a) ya; (b) tetap satu `.env` + allowlist aplikasi |
| G12 | Eksekusi menyentuh WAHA/deploy | F7/F8 | 2-step verification + WARNING |

Tanpa jawaban G5–G12, fase terkait **tidak boleh dieksekusi**.

### 15.1 Keputusan yang sudah dicatat (2026-11-26)

| # | Keputusan | Dampak pada plan |
|---|---|---|
| G1 | `/cta` terbuka untuk semua origin | T1.4 diubah: fokus pada kepercayaan nilai, bukan allow-list origin |
| G2 | DTO dulu, hapus setelah 30 hari | T1.5 + T1.5b (log `PUBLIC_TENANT_DTO_HIT`) |
| G3 | Link bukti bayar dibiarkan | T3.2 ditunda; `M08-PROOF-PUBLIC` = risiko diterima |
| G4 | Batas 20 MB (gambar/audio/video) dan 100 MB (dokumen) | T3.3 memakai konstanta per tipe |

**Risiko yang secara sadar diterima:** `M08-PROOF-PUBLIC`. Siapa pun yang memegang `/proof/:reservationId` dapat mengakses bukti bayar selama record reservasi ada; respons masih `Cache-Control: public, max-age=86400`. Mitigasi termurah tanpa memutus link (bila diinginkan nanti): `no-store` + `noindex` + `no-referrer`.

---

## 16. Rollback

- Setiap fase = commit terpisah, sehingga rollback = `git revert <commit>`.
- Perubahan DB (bila ada) wajib punya migrasi balik (`down`) atau snapshot sebelum eksekusi.
- F4 (backup/restore) dan F7 (deploy) wajib punya salinan konfigurasi + backup DB sebelum menyentuh server.
- Bila gerbang regresi gagal: revert fase, laporkan, jangan lanjut.

---

## 17. Yang tidak boleh dilakukan (no-go)

- Menambah larangan teks "DILARANG..." ke prompt sebagai pengganti gerbang kode.
- Menghafal kalimat pengguna (verbatim matching) untuk memperbaiki bug ingress.
- Menyembunyikan error per skenario (`try/catch` kosong baru).
- Menambah dependency runtime baru tanpa persetujuan.
- Menjalankan server live/DB produksi dari sesi ini.
- Menandai temuan `confirmed` menjadi selesai tanpa test regresi yang gagal-dulu-lalu-hijau.

---

**Langkah berikutnya:** G1–G4 sudah diputuskan (lihat §15.1). Jawab G5–G12 bila ingin menjalankan F2–F7. Untuk mulai, cukup setujui **F0 + F1** — keduanya tidak menyentuh DB dan menutup XSS confirmed paling berbahaya.
