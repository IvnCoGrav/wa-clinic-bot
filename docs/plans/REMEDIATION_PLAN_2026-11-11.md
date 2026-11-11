# Rencana Remediasi Lanjutan — 52 OPEN + 4 UNVERIFIED + Code Health + Fase 3–5

- **Tanggal:** 2026-11-11
- **Dasar:** register `docs/plans/REMAINING_BACKLOG_2026-11-09.md` (203 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 52 OPEN) dan `docs/KNOWN_ISSUES.md` #325–#326.
- **Prinsip:** fondasional (state machine / kontrak data / gerbang kode), TDD, tenant-aware, tanpa dependency runtime baru, tanpa solusi tambal-sulam prompt, deploy produksi tetap diblokir sampai semua gate lulus.
- **Batas:** area `src/landing/*`, `src/routes/landing.route.ts`, dan `packages/admin-dashboard/*` TIDAK disentuh tanpa koordinasi dengan pengguna.

## 0. Status awal & definisi selesai

| Metrik | Nilai |
|---|---:|
| FIXED terverifikasi | 203 |
| OPEN | 52 |
| UNVERIFIED | 4 |
| Test suite | 7.092 test / 7.062 lulus / 2 gagal pre-existing #287 |
| File >1.500 baris | 9 |
| `as any` di `src` | 1.903 |

**Definition of Done (DoD) tiap task:**
1. Test ditulis lebih dulu (merah) lalu hijau.
2. `npx tsc --noEmit` 0 error dan `npm run build` exit 0.
3. Tidak ada regresi baru: `node scripts/audit-baseline-diff.mjs <before> <after>` → `GATE PASS`.
4. Item register naik ke `FIXED` + entri bukti di `backlog-evidence.json`; `npm run verify:backlog` → PASS.
5. `npm run security:scan` → LULUS.
6. Satu wave = satu commit (atau beberapa commit kecil) + catatan di `EVIDENCE_LEDGER.md`.

**Gerbang regresi standar (dijalankan setiap wave):**
```bash
npx tsc --noEmit
npm run build
npx vitest run <suite relevan>
npx vitest run --reporter=json --outputFile=docs/audit/2026-11-11/after-<wave>.json
node scripts/audit-baseline-diff.mjs docs/audit/2026-11-11/after-fase2g.json docs/audit/2026-11-11/after-<wave>.json
npm run verify:backlog
npm run security:scan
```

---

## 1. Urutan wave (dependency & blast radius)

| Wave | Fokus | Item | Risiko | Butuh DB? |
|---|---|---|---|---|
| **W0** | Re-triage cepat item yang mungkin sudah terbereskan wave tenant | `M-03`, `Cfg-012` sisa, `Ar-003` status | Rendah | Tidak |
| **W1** | Keamanan & kebenaran staf (offline) | `S-07`, `S-03`, `S-01`, `S-012`, `S-008`, `S-016`, `Ar-005`, `Ar-008` | Sedang | Tidak |
| **W2** | Config/RBAC jujur & data-driven | `Cfg-009`, `Cfg-010`, `Cfg-013`, `Cfg-011`, `Cfg-017`, `Cfg-007`, `CFG-16`, `CFG-17`, `CFG-12` | Sedang–Tinggi | Tidak |
| **W3** | AI pipeline & RAG | `A-008`, `A-009`, `C-010`, `A-011`, `C-007`, `C-008` | Tinggi | Tidak |
| **W4** | Cron, cache, integrasi | `K-005`, `K-009`, `K-010`, `W-006`, `UTL-15`, `W-010`, `W-011`, `I-006`, `I-007`, `I-011`, `I-002` | Sedang | Sebagian |
| **W5** | Marketing/landing/staf UX (koordinasi pengguna) | `M-02`, `M-04`, `M-05`, `M-06`, `M-10`, `S-02`, `S-06`, `S-08`, `S-09`, `Cfg-015` | Sedang | Tidak |
| **W6** | Multi-tenant schema & DB | `Ar-003` sisa, `Ar-004`, `S-015` | Tinggi | **Ya** |
| **W7** | UNVERIFIED | `SM-02`, `C-002`, `C-006`, `A-013` | Rendah | Sebagian |
| **W8** | Fase 3–5 audit | artefak F5, rekonsiliasi dokumen, deploy gate | Tinggi | Staging |
| **W9** | Code health #326 | pecah 9 God file, dead export, `as any`, benchmark | Sedang | Tidak |

---

## W0 — Re-triage cepat (tanpa kode)

**Tujuan:** jangan memperbaiki barang yang sudah beres; kunci status dengan bukti.

- **W0-01 `M-03`** — verifikasi `src/routes/admin/meta-attribution.subroute.ts` sudah memakai `resolveSessionTenantId` (hasil W2E). Bila seluruh query memakai tenant sesi: tambah test isolasi 2 tenant → `FIXED`; bila ada sisa literal `DEFAULT_TENANT_ID` di query: lanjut ke W5.
- **W0-02 `Cfg-012`** — hitung ulang referensi route (`node scripts/internal/scan_tenant_refs` manual) ; sisa 5 di `admin/landings.subroute.ts` dipindah ke W5 (area landing). Bila hanya itu: `FIXED` dengan catatan pengecualian.
- **W0-03 `Ar-003`** — catat metrik terkini (459 ref / 132 file). Item tetap `OPEN`; sisa pekerjaan dipetakan ke W6.
- **Acceptance:** tiga item punya keputusan status + bukti; tanpa perubahan kode.

---

## W1 — Keamanan & kebenaran staf

### W1-01 `S-07` — nominal pembayaran diverifikasi server
- **File:** `src/routes/staff/today.subroute.ts` (handler payment ± baris 1024–1049), `src/services/staff-reservation.service.ts` (`recordPayment`).
- **Perubahan:** jangan percaya `amount` klien. Hitung ulang dari `reservation.purchase_value` + `delivery_fee` (snapshot) atau katalog; tolak `|amount - expected| > toleransi 0` dengan `400 PAYMENT_AMOUNT_MISMATCH`; simpan `expected_amount` di audit payload.
- **Test:** `tests/unit/staff-payment-validation.test.ts` — nominal kurang/lebih/dipecah, katalog berubah, ongkir promo.
- **Acceptance:** tidak ada jalur yang menyimpan nominal klien tanpa verifikasi; test adversarial lulus.

### W1-02 `S-03` — auto-close trip lintas proses
- **File:** `src/services/staff-trip-tracking.service.ts` (`listActiveTrips`, store memori), `src/services/cron.service.ts:595-628`, `src/lifecycle/background-crons.ts:204`.
- **Perubahan:** pindahkan sumber kebenaran trip aktif ke tabel/kolom persisten (mis. `reservations.trip_started_at` + status), atau query DB di sweep; jangan bergantung pada Map proses `app`.
- **Test:** `tests/unit/trip-autoclose-cross-process.test.ts` — worker sweep menutup trip yang dimulai proses lain (simulasi dua instance store).
- **Acceptance:** sweep menemukan trip tanpa state memori proses; test lulus; tidak ada regresi `staff-trip-*`.

### W1-03 `S-01` — kontrak sesi staf tunggal
- **File:** `src/routes/staff/auth.subroute.ts` (login :96-127, restore :132-164), `src/services/staff-auth.service.ts`.
- **Perubahan:** hapus jalur restore token dari body/localStorage; satu sumber = cookie `HttpOnly`; `restore` hanya memperpanjang sesi dari cookie valid; update kontrak test.
- **Test:** `tests/integration/staff-session-contract.test.ts` — login tidak mengembalikan token; restore tanpa cookie → 401; dengan cookie → 200.
- **Acceptance:** tidak ada token sesi di body/localStorage; dashboard tetap bisa login (koordinasi bila perlu).

### W1-04 `S-012` — kebijakan password & lockout staf
- **File:** `src/services/staff-auth.service.ts`, `src/routes/admin/staff-management.subroute.ts`, `src/services/account-lockout.service.ts`.
- **Perubahan:** validasi panjang/kompleksitas minimal; lockout per akun (bukan hanya per IP) dengan counter persisten; `role` divalidasi terhadap daftar role sah (tolak input bebas).
- **Test:** `tests/unit/staff-password-policy.test.ts` + lockout lintas IP.
- **Acceptance:** password lemah ditolak; 5 gagal → 423; role tak dikenal ditolak 400.

### W1-05 `S-008` — CSRF/session fixation pada restore
- **File:** `src/routes/admin/auth.subroute.ts`, `src/routes/staff/auth.subroute.ts`.
- **Perubahan:** wajibkan `SameSite=Strict`/`Lax` + origin check pada restore; rotasi token sesi saat restore; tolak restore tanpa `Origin/Referer` sah di produksi.
- **Test:** `tests/integration/restore-csrf.test.ts`.
- **Acceptance:** restore lintas origin → 403.

### W1-06 `S-016` — hardening container
- **File:** `docker-compose.yml`, `Dockerfile` (bila ada).
- **Perubahan:** `user: nonroot`, `security_opt: no-new-privileges:true`, `cap_drop: [ALL]`, read-only rootfs bila memungkinkan, healthcheck.
- **Test:** `docker compose config` valid; test statis `tests/unit/deploy-hardening.test.ts` membaca YAML.
- **Acceptance:** config lolos; tidak mengubah port/volume fungsional.

### W1-07 `Ar-005` sisa — hentikan "false success"
- **File:** `src/routes/admin/*.subroute.ts` (pola `catch → 200 + []`), mulai dari `roles` (sudah), `settings-*`, `landings` (W5).
- **Perubahan:** produksi → 5xx dengan `code: 'DATABASE_UNAVAILABLE'`; non-produksi → 200 `degraded: true`.
- **Test:** `tests/integration/admin-db-failure-honesty.test.ts` (matriks route).
- **Acceptance:** tidak ada 200 + data kosong saat DB gagal di produksi.

### W1-08 `Ar-008` — postur aman tanpa string `NODE_ENV`
- **File:** `src/app.ts:41-57`, `src/integrations/whatsapp/signature.ts:16-23`, `src/routes/waba-webhook.route.ts:66-71`.
- **Perubahan:** fail-closed berdasarkan keberadaan secret (`WAHA_WEBHOOK_SECRET`/`WABA_APP_SECRET`), bukan `NODE_ENV`; staging tanpa secret → tolak webhook.
- **Test:** `tests/unit/webhook-secret-failclosed.test.ts`.
- **Acceptance:** staging tanpa secret tidak bisa menerima webhook.

**Gate W1:** suite keamanan/staf hijau + full suite tanpa regresi baru + commit `audit(w1): ...`.

---

## W2 — Config/RBAC jujur & data-driven

- **W2-01 `Cfg-013`** — endpoint tulis katalog/tier/SOP/few-shot/CAPI wajib Super Admin.
  - File: `src/routes/admin.route.ts:204-229` (prefix list), test `tests/integration/admin-write-matrix.test.ts`.
  - Acceptance: ADMIN_CS/SPV_CS → 403 untuk semua method tulis; baca tetap sesuai allowlist.
- **W2-02 `Cfg-009`** — audit write lengkap.
  - File: `src/services/audit.service.ts`, `settings-general.subroute.ts`, `settings-catalog.subroute.ts`, `payment info`.
  - Perubahan: panggil `logAdminAction` di semua write config; `tenantId` wajib; kegagalan audit → log error + retry 1x (jangan ditelan); jangan simpan nomor rekening mentah (mask).
  - Test: matriks write→audit.
- **W2-03 `Cfg-010`** — hilangkan ghost success tulis katalog/tier.
  - File: `settings-catalog.subroute.ts`, `treatment-catalog.service.ts`.
  - Perubahan: tunggu commit DB sebelum 200; validasi harga promo ≤ normal, durasi 15–480, katalog tenant.
  - Test: mock DB reject → 5xx; harga invalid → 400.
- **W2-04 `Cfg-011`** — jalur tulis setelan yang hilang.
  - File: `settings-general.subroute.ts`, route baru **sebagai sub-handler settings** (bukan page baru).
  - Perubahan: endpoint tulis untuk clinicLocation, operationalHours, staffNotification, estimateTtlDays, copilot.styleTone, brand lengkap.
  - Test: round-trip GET→PUT→GET.
- **W2-05 `Cfg-017`** — rekonsiliasi dokumen dengan kontrol nyata (dilakukan setelah W2-01..04).
- **W2-06 `Cfg-007`** — quick reply ongkir hardcode → data-driven.
  - File: `quick-replies.subroute.ts:59-93`.
  - Perubahan: seed dari `DeliveryTier` tenant saat create; jangan hardcode nominal/km.
  - Test: tier berubah → quick reply ikut berubah.
- **W2-07 `CFG-16`** — follow-up render tanpa brand sinkron + tanpa regex mutilasi.
  - File: `src/config/followup-templates.ts` (getRollingFollowUpMessage), pemanggil `follow-up-engine.service.ts:638-851`, `staff-reservation.service.ts:1607-1661`.
  - Perubahan: semua render async dengan `tenantId`; hapus regex pasca-render (ganti template bersih).
  - Test: brand tenant A/B; tidak ada "Bunda Bunda".
- **W2-08 `CFG-17`** — saveQueue lintas proses.
  - File: `src/config/ai-models.config.ts:507-560`.
  - Perubahan: serialisasi berbasis DB (advisory lock/lease per tenant) atau optimistic version; test dua instance.
- **W2-09 `CFG-12`** — provider AI: 9 di UI vs 2 didukung.
  - File: `ai-models.config.ts` (SUPPORTED_PROVIDERS), `settings-ai.subroute.ts`, UI (koordinasi).
  - Perubahan: satu sumber daftar provider; tolak provider tak didukung saat save.

---

## W3 — AI pipeline & RAG

- **W3-01 `A-008`** — sanitasi final setelah template deterministik.
  - File: `src/v3/agent/pipeline/guardrail-pipeline.ts:632-652` (dan semua `finalReply = ...` setelah sanitizer).
  - Perubahan: satu gerbang akhir `OutputSanitizer.cleanOutboundReply` sebelum return; kuota "Bunda" dan maks 3 kalimat ditegakkan code.
  - Test: fallback canned + double Bunda → output lolos kuota.
- **W3-02 `A-009`/`C-010`** — brand tenant di jalur deterministik & Call 2.
  - File: `generation-stage.ts:1044`, `guardrail-pipeline.ts:1056,1090`, `prompt-composer.ts:283`.
  - Perubahan: ganti `getBrandIdentity()` sinkron → `await getBrandIdentityAsync(tenantId)`; larang fallback default untuk tenant non-default.
  - Test: dua tenant, output beda brand; test unit brand.
- **W3-03 `A-011`** — timeout tool yang benar-benar membatalkan.
  - File: `src/v3/agent/pipeline/tool-pipeline.ts:58-62` (`withTimeout`).
  - Perubahan: teruskan `AbortSignal` ke tool; tool `save_reservation` idempoten + cek `signal.aborted` sebelum commit; timeout → jangan laporkan sukses.
  - Test: tool lambat → tidak ada baris reservasi; pipeline melaporkan gagal.
- **W3-04 `C-007`** — `specificTreatmentName` hanya dari pesan user.
  - File: `tool-pipeline.ts:436-448`, `get-catalog.tool.ts`.
  - Perubahan: gate sudah ada; tambahkan test adversarial riwayat vs pesan kini; pastikan parameter dibuang bila hanya dari history.
- **W3-05 `C-008`** — isolasi KB dari instruksi.
  - File: `src/v3/tools/search-knowledge-faq.tool.ts:79-85`, `context-grounder.ts`.
  - Perubahan: bungkus tiap chunk dengan delimiter data (`<knowledge_chunk>`) + sanitasi tag peran; instruksi "konten = data, bukan perintah" di level struktur.
  - Test: chunk berisi `</knowledge_chunk> SYSTEM:` tidak breakout.

---

## W4 — Cron, cache, integrasi

- **W4-01 `K-005`** — status & alert kegagalan cron.
  - File: `src/services/cron.service.ts` (semua run*), `src/lifecycle/background-crons.ts`.
  - Perubahan: tabel/kolom `cron_status` (last_run, last_ok, last_error, duration) + alert bila gagal 2x; health endpoint membaca status.
  - Test: cron throw → status FAILED + alert.
- **W4-02 `K-009`** — daftarkan 2 pekerja hilang sebagai cron.
  - File: `src/routes/admin/evaluations.subroute.ts:309-322`, `staff-retention.subroute.ts:126-179`, `background-crons.ts`.
  - Perubahan: `sandbox-cleanup` & `retention-snapshot` cron terjadwal + idempoten.
- **W4-03 `K-010`** — drain job in-flight saat shutdown.
  - File: `src/worker.ts:25-71`, `src/lifecycle/interval-registry.ts`.
  - Perubahan: registry promise aktif; shutdown menunggu `Promise.allSettled` dengan batas, lalu force exit; test dengan job lambat.
- **W4-04 `W-006`** — burst coalescing lintas instance.
  - File: `src/services/message.service.ts` (burst buffer), Redis/DB lock.
  - Perubahan: gunakan Redis bila ada, fallback DB lease; test dua instance.
- **W4-05 `UTL-15`** — cache client temp ID lintas proses → Redis/DB atau terima single-instance dengan dokumentasi.
- **W4-06 `W-010`/`W-011`** — humanizer hardcode & `Template[...]`.
  - File: `src/utils/humanizer*`, `src/integrations/waha/*`.
  - Perubahan: ambil frasa dari config tenant; `sendTemplateMessage` kirim template nyata atau lempar `NOT_IMPLEMENTED` (jangan teks palsu).
- **W4-07 `I-006`/`I-007`** — Calendar/Contacts tenant-aware + outbox/retry.
- **W4-08 `I-011`** — kuota/circuit per tenant untuk ORS/Maps (token bucket di DB).
- **W4-09 `I-002`** — restore validasi kepemilikan dump (tenantId di manifest; tolak baris tenant lain).

---

## W5 — Marketing/landing/staf UX (koordinasi pengguna)

Item: `M-02`, `M-04`, `M-05`, `M-06`, `M-10`, `S-02`, `S-06`, `S-08`, `S-09`, `Cfg-015`.
- **Aturan:** hanya dikerjakan setelah pengguna menyatakan area landing/dashboard siap; satu PR per file.
- Prioritas: `M-04` (false success) → `M-05` (404 slug) → `M-06` (beacon origin/XFF) → `M-02` (pixel config) → `S-02` (localStorage PII) → `S-09` (touch target) → `S-08`/`Cfg-015` (hardcode brand/tenant) → `M-10` (dokumentasi).

---

## W6 — Multi-tenant schema & DB (butuh staging)

- **W6-01 `Ar-004`** — migration unique constraint per tenant:
  `Staff.phone` → `@@unique([tenant_id, phone])`, `AdClick.trackingCode` → `@@unique([tenant_id, trackingCode])`, `LandingPage.slug` → `@@unique([tenant_id, slug])`.
  - Prasyarat: backup DB, cek duplikat, migration `CONCURRENTLY` bila memungkinkan, rollback plan.
  - Test: dua tenant boleh phone/slug sama; tenant sama ditolak.
- **W6-02 `S-015`** — `WAHA_WEBHOOK_SECRET` per tenant: kolom `tenants.waha_webhook_secret_enc`, resolver per session, rotasi via admin, fallback env hanya single-tenant.
- **W6-03 `Ar-003` sisa** — service/worker memakai tenant eksplisit; target <50 referensi `DEFAULT_TENANT_ID`.
- **W6-04 `Cfg-012` sisa** — `admin/landings.subroute.ts` (koordinasi W5).

**Gate W6:** migrasi diuji di staging + backup + `prisma migrate diff` bersih + full suite.

---

## W7 — UNVERIFIED

- **W7-01 `SM-02`** — putuskan: hapus kode inert (0 pemanggil) atau sambungkan ke pemanggil nyata + test. Default: hapus.
- **W7-02 `C-002`** — audit korpus dengan dump DB: hapus duplikat/cuplikan chat, kunci jumlah artikel di test.
- **W7-03 `C-006`** — audit log RAG: hitung persentase jawaban tanpa chunk; bila > ambang, panggil `search_knowledge_faq` wajib (tool masking).
- **W7-04 `A-013`** — audit komentar/kontrak yang bertentangan dengan runtime; perbaiki komentar atau kode + test.

---

## W8 — Fase 3–5 audit

- **W8-01** — artefak `after-f5.json`: jalankan suite penuh + simpan hasil; perbaiki `scripts/deploy-prod.sh` agar memvalidasi `APP_DOMAIN` & `BACKUP_ENCRYPTION_KEY`.
- **W8-02** — `backup:verify` script + test restore berkala.
- **W8-03** — rekonsiliasi dokumen: `FEATURE_INVENTORY`, laporan audit lama, klaim "production-ready".
- **W8-04** — deploy gate: checklist 2 langkah, verifikasi WAHA tidak terganggu, staging dulu.

---

## W9 — Code health (#326)

- **W9-01** pecah `customer.service.ts` (3.283) per domain (profile, address, ltv, dsb) — satu PR per ekstraksi + test pemanggil.
- **W9-02** pecah `staff-reservation.service.ts` (2.976) — task query, payment, trip, chat window.
- **W9-03** pecah `treatment-catalog.service.ts` (2.489) — catalog read, scoring, admin write.
- **W9-04** pecah `copilot-tools.ts`, `waha/client.ts`, `capi.service.ts`, `webhook.route.ts`, `live-chat.service.ts`, `meta-performance-analytics.service.ts`.
- **W9-05** hapus dead export (`setBrandIdentity`, `resetBrandIdentity`, `getRollingFollowUpMessageAsync` bila tetap test-only) + pasang guard test "tidak ada export mati".
- **W9-06** turunkan `as any` bertahap di jalur transaksional (target <1.000) + `strict` bertahap.
- **W9-07** benchmark ringan: latensi webhook, retrieval RAG, render prompt; catat baseline di `docs/audit/2026-11-11/BENCHMARK.md`.

---

## 2. Matriks item → wave

| Wave | Item |
|---|---|
| W1 | S-07, S-03, S-01, S-012, S-008, S-016, Ar-005, Ar-008 |
| W2 | Cfg-009, Cfg-010, Cfg-013, Cfg-011, Cfg-017, Cfg-007, CFG-16, CFG-17, CFG-12 |
| W3 | A-008, A-009, C-010, A-011, C-007, C-008 |
| W4 | K-005, K-009, K-010, W-006, UTL-15, W-010, W-011, I-006, I-007, I-011, I-002 |
| W5 | M-02, M-04, M-05, M-06, M-10, S-02, S-06, S-08, S-09, Cfg-015 |
| W6 | Ar-003 sisa, Ar-004, S-015, Cfg-012 sisa |
| W7 | SM-02, C-002, C-006, A-013 |
| W8 | Fase 3–5 audit |
| W9 | #326 code health |

---

## 3. Yang dibutuhkan dari pengguna

1. **W6 (migrasi DB):** jendela staging + backup + izin `prisma migrate deploy`.
2. **W5 (landing/dashboard):** konfirmasi area sudah siap disentuh.
3. **W2-01/Cfg-013 & W3-03/A-011:** persetujuan Confirmation Gate (perubahan otorisasi & pembatalan efek samping tool).
4. **W7-02/C-002 & W7-03/C-006:** akses dump DB / log produksi.
5. **W8:** izin deploy staging (2 langkah) — produksi tetap diblokir.

## 4. Estimasi kasar

| Wave | Estimasi |
|---|---|
| W0 | 0,5 hari |
| W1 | 3–4 hari |
| W2 | 4–5 hari |
| W3 | 3–4 hari |
| W4 | 4–5 hari |
| W5 | 3–4 hari (setelah izin) |
| W6 | 3–5 hari (dengan staging) |
| W7 | 1–2 hari |
| W8 | 2–3 hari |
| W9 | 5–8 hari |

Total ± **29–41 hari kerja** untuk 52 OPEN + 4 UNVERIFIED + code health + Fase 3–5, dengan asumsi tiap wave ditutup gate regresi.
