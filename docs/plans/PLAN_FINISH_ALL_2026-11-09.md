# PLAN PENYELESAIAN TOTAL — AUDIT 16 MODUL & REMEDIASI

- **Status:** **DRAFT — BELUM DIEKSEKUSI.** Wajib persetujuan eksplisit pengguna per fase.
- **Baseline:** `0a940b64` (`master`), working tree bersih (2026-11-09).
- **Baseline uji:** `docs/audit/2026-11-09/after-s5-final.json` — 6.774 test / 6.743 lulus / 3 gagal known / 28 skip.
- **Sumber backlog:**
  - Track A: `docs/plans/TRACK_A_REBASELINE_2026-11-09.md` (96 temuan).
  - S4: `docs/MODULE_AUDIT_06/12/15/16` (50 temuan).
  - Track B: `docs/audit/2026-11-07/RINGKASAN_AKHIR_AUDIT_MODUL_1-11.md` (122 temuan) + `docs/audit/2026-11-06/*`.
  - `docs/KNOWN_ISSUES.md` #320, #321.
- **Prinsip wajib:** fondasional (DB/state/tool contract/RAG), tenant-aware, TDD (test merah dulu), tanpa dependency runtime baru, tanpa solusi “DILARANG...” di prompt sebagai pengganti gerbang kode, regression gate per fase.

---

## 0. Kondisi Saat Ini

| Area | Status |
|---|---|
| S0–S4 | **SELESAI** — gate, register Track A, 4 laporan gap audit |
| S5.1 | **SELESAI** — `LiveChatMonitor.tsx` 8.127 → 1.211 baris |
| S5.2 | **SELESAI** — katalog 42 layanan data-driven + seed eksplisit |
| Zipcode/CAPI + LiveChat links | **SELESAI** — commit `21b059e6` |
| S6 lokal | **PASS** — build/typecheck/dashboard, full suite, security scan |
| Seed/deploy produksi | **PENDING** |
| F0 Baseline & Register Terpadu | **SELESAI** — baseline `f0-baseline.json`, backlog terpadu 268 temuan, diff 0 regresi baru |
| F1 Audit Modul 11 & Re-baseline Track B | **SELESAI** — `MODULE_AUDIT_11` (10 file / 9.111 baris) + `TRACK_B_REBASELINE_7_14` (122 temuan) |
| Audit 16/16 modul | **SELESAI (100% COVERAGE)** — 10 laporan granular A–G + 7 Track B ter-rebaseline |
| Remediasi F2–F6 | **SIAP DIEKSEKUSI** — menunggu persetujuan per fase |

---

## 1. Inventaris Sisa Pekerjaan

### 1.1 Track A (Modul 1–5)

| Status | Jumlah |
|---|---:|
| FIXED | 10 |
| DUPLICATE | 2 |
| PARTIAL | 3 |
| OPEN | 81 |
| **Total** | **96** |

### 1.2 S4 (Modul 6/12/15/16)

| Modul | Temuan | Known/By-design | Baru |
|---|---:|---:|---:|
| 06 State machine | 14 | 0 | 14 |
| 12 Follow-up/Notif | 12 | 0 | 12 |
| 15 Admin/Staff API | 12 | 1 (`API-04`) | 11 |
| 16 Delivery/Build | 12 | 1 (`DEL-04`) | 11 |
| **Total** | **50** | **2** | **48** |

**Catatan:** `DEL-03` sudah diremediasi 2026-11-09 (hardening `.dockerignore`). Jadi sisa S4 baru yang masih open = **47** (48 new − 1 fixed).

### 1.3 Track B (Modul 7–14)

- 122 temuan (22 kritis, 44 tinggi, 46 sedang, 10 rendah) dari 9 modul Track B.
- Sebagian sudah diremediasi Fase 1–8 & 10; Fase 9 selesai via S5.
- **Belum ada register status terkini** — wajib re-baseline (F1.2).

### 1.4 Total minimum yang harus ditutup

- Track A unresolved: **84** (81 OPEN + 3 PARTIAL).
- S4 unresolved: **47** (48 new − 1 sudah fixed: DEL-03).
- **Subtotal: ±131 temuan** + sisa Track B + temuan Modul 11.

---

## 2. Peta Fase

| Fase | Fokus | Prasyarat | Blast radius | Estimasi | Gate |
|---|---|---|---|---|---|
| **F0** | Baseline & register terpadu | — | rendah (docs) | 1 hari | build + full suite + hitungan rekonsiliasi |
| **F1** | Audit Modul 11 + re-baseline Track B 7–14 | F0 | rendah (read-only) | 2–3 hari | 16/16 coverage, tidak ada line numbers basi |
| **F2** | P0/P1 keamanan, safety, tenant | F1 | tinggi (DB, auth, webhook) | 2 minggu | targeted + full suite + security scan |
| **F3** | P1 struktural: SM/FN/API/DEL + God Object | F2 | tinggi (service/routes/dashboard) | 2–3 minggu | build + parity test + file <1.500 baris |
| **F4** | P2/P3 & sisa Track A/B | F3 | sedang | 2–4 minggu | full suite, 0 failure baru |
| **F5** | Seed produksi, backup, cron, PWA, deploy | F2–F4 | sangat tinggi (produksi) | 1 minggu | backup + staging + canary + approval |
| **F6** | Verifikasi akhir & penutupan | semua | rendah | 1–2 hari | DoD global |

**Urutan wajib:** F0 → F1 → F2 → F3 → F4 → F5 → F6.
**F2 dan F3 tidak boleh paralel** pada file yang sama. **F5 tidak boleh mulai** sebelum F2–F4 hijau.

---

## 3. Detail Fase

### F0 — Baseline & Register Terpadu (read-only, docs) — **SELESAI (PASS)**

| ID | Aksi | File/Perintah | Acceptance | Status |
|---|---|---|---|:---:|
| F0.1 | Catat identitas & gate | `git status`, `git rev-parse HEAD`, `npm run build`, `npm run typecheck`, `npm --prefix packages/admin-dashboard run build`, `npm run security:scan` | exit 0; commit dicatat | **PASS** |
| F0.2 | Full suite baseline baru | `npx vitest run --reporter=json --outputFile=docs/audit/2026-11-09/f0-baseline.json` | total/fail/skip dicatat (6.774 / 6.744 / 2 fail / 28 skip) | **PASS** |
| F0.3 | Gabungkan register | Baru: `docs/plans/REMAINING_BACKLOG_2026-11-09.md` — kolom: ID, sumber, modul, severity, file:line aktual, status, fase target | Semua 268 ID Track A (96) + S4 (50) + Track B (122) masuk | **PASS** |
| F0.4 | Dedupe & prioritas | Tandai `DUPLICATE`/`KNOWN`; petakan P0/P1/P2/P3 | 9 klaster lintas modul dipetakan; prioritas P0..P3 jelas | **PASS** |
| F0.5 | Baseline diff | `node scripts/audit-baseline-diff.mjs docs/audit/2026-11-09/after-s5-final.json docs/audit/2026-11-09/f0-baseline.json` | 0 failure baru (fixed: 1, new: 0) | **PASS** |

**Gate F0:** hitungan Track A (96) + S4 (50) + Track B (122) = 268 temuan terekonsiliasi; tidak ada perubahan kode. **STATUS: PASS.**

---

### F1 — Audit Modul 11 + Re-baseline Track B 7–14 (read-only) — **SELESAI (PASS)**

#### F1.1 Audit Modul 11 — Customer/Catalog/Location (A–G) — **SELESAI**

**Scope file (baca penuh 100%):**

| File | Baris | Fokus |
|---|---:|---|
| `src/services/customer.service.ts` | 3.262 | seam customer, 19 bypass update, alamat, lokasi, enrichment, LTV |
| `src/repositories/customer.repository.ts` | 172 | tenant scoping, update semantics, Postgres vs InMemory |
| `src/domain/customer-address.ts` | 621 | dedupe deterministik, rekonsiliasi, Zod schema |
| `src/services/location-resolver.service.ts` | 116 | URL Maps, geocode, kandidat lokasi |
| `src/utils/gazetteer.ts`, `gazetteer-zipcode-resolver.ts` | 959 | dataset & resolusi, regex compiling hot-path |
| `src/services/treatment-catalog.service.ts` | 2.459 | pasca-S5.2: DB read/fallback per tenant |
| `src/services/delivery.service.ts` | 391 | tier DB, fallback routing ORS/Google, clinic coords tenant |
| `src/config/landmarks.ts` | 801 | 800 baris data landmark statis |
| `src/utils/google-maps-url-resolver.ts` | 330 | overlap UTL-04 (SSRF allowlist) |

**Output:** `docs/MODULE_AUDIT_11_CUSTOMER_CATALOG_LOCATION.md` (12 temuan: CCL-01 s.d. CCL-12; 3 Before/After; FMEA). **STATUS: SELESAI.**

#### F1.2 Re-baseline Track B untuk Modul 7–14 — **SELESAI**

**Hasil re-baseline 122 temuan Track B:**
- **FIXED:** 10 temuan (`S-004`, `S-005`, `Ar-002`, `Ar-006`, `W-002`, `W-003`, `W-005`, `K-011`, `Cfg-006`, `Cfg-016`)
- **DUPLICATE:** 3 temuan (`S-04` -> API-02; `K-003` -> DEL-07/I-001; `Cfg-005` -> CFG-06/07)
- **PARTIAL:** 2 temuan (`Ar-001`, `C-009`)
- **OPEN:** 107 temuan

**Output:** `docs/plans/TRACK_B_REBASELINE_7_14.md`.
**Acceptance:** 16/16 modul punya status; tidak ada line number basi; tidak ada perubahan kode.

**Gate F1:** review laporan; daftar P1 track B masuk F2/F3. **STATUS: PASS.**

---

### F2 — P0/P1 Keamanan, Safety & Tenant Isolation

**Aturan tiap task:** tulis test merah dulu; verifikasi `file:line`; perbaiki akar masalah; jangan menambah dependency; jalankan targeted test + build/typecheck.

#### F2A — Kritis (safety & data) — **SELESAI (PASS)**

| ID | File:Line | Perbaikan fondasional | Test baru | Acceptance | Status |
|---|---|---|---|---|---|
| `CFG-01` | `src/config/medical-keywords.ts:155-172` | Evaluasi `NON_MEDICAL_PHRASES` hanya pada frasa yang cocok, bukan seluruh teks; keyword darurat tetap menang | `tests/unit/medical-keywords-scope.test.ts` | “step by step, anak kejang” → terdeteksi darurat | **FIXED** |
| `UTL-01` | `src/utils/conversation-transaction-extractor.ts:208-293` | Hapus default `month = 6`; tanpa bulan → `null`, bukan Juli fiktif | `tests/unit/conversation-date-null.test.ts` | Input tanpa bulan tidak menghasilkan tanggal | **FIXED** |
| `D-01` | `prisma/schema.prisma` Conversation; `conversation.repository.ts:40-60` | Partial unique index `(tenant_id, customer_id) WHERE closed_at IS NULL` + kolom penanda | test repository + migration dry-run | Satu conversation aktif per customer/tenant | **FIXED** |

#### F2B — Tinggi: keamanan & isolasi tenant - **SELESAI (PASS)**

| ID | File:Line | Perbaikan fondasional | Test baru | Acceptance | Status |
|---|---|---|---|---|---|
| `UTL-04` | `src/utils/google-maps-url-resolver.ts:276` | Host allowlist Google Maps; batasi redirect; blok private IP; `URL` API | `tests/unit/google-maps-ssrf.test.ts` | Host asing/redirect internal ditolak | **FIXED** |
| `UTL-05` | `src/utils/language-sanitizer.ts:23-42` | Hapus `/g` dari regex `.test()` atau reset `lastIndex` | `tests/unit/language-sanitizer-state.test.ts` | Hasil `.test()` deterministik berulang | **FIXED** |
| `D-02` | `customer.service.ts:435,722,1102,1246,1392`; `message.service.ts:460-475` | Semua mutasi customer lewat `CustomerRepository` seam | test seam + grep call-site | 0 `prisma.customer.update` langsung | **FIXED** |
| `D-03` | `customer.repository.ts:37,75-77` | `update(id, patch, tenantId)` wajib; hapus `as any` | test dua tenant | Update lintas tenant ditolak | **FIXED** |
| `API-02` | `src/routes/staff.route.ts:71` | Tenant impersonation dari sesi/header terverifikasi, bukan `DEFAULT_TENANT_ID` | test dua tenant | Admin Tenant B hanya melihat data B | **FIXED** |
| `API-03` | `src/routes/admin/auth.subroute.ts:146-148` | Login staf menerima `tenantId` (body/header), query scoped | test login tenant A/B | Staf tenant B bisa login, tidak bocor | **FIXED** |
| `FN-02` | `src/services/shareloc-reminder.service.ts:267` | Setelah kirim: `logMessage` OUTBOUND + `registerInFlightBotOutbound`; clear saat gagal | test outbound livechat + echo | Pesan shareloc muncul di Live Chat | **FIXED** |
| `FN-05` | `src/services/web-push.service.ts:29,68-93` | Production wajib ENV VAPID; file plaintext ditolak/dienkripsi | test config fail-closed | Tanpa ENV di production → gagal jelas | **FIXED** |

#### F2C — Tinggi: arsitektur & operasional - **SELESAI (PASS)**

| ID | File:Line | Perbaikan | Acceptance | Status |
|---|---|---|---|---|
| `CFG-02` | `config/persona.ts:12,101-107`; `Dockerfile:50-51` | Salin `persona_custom.txt` ke image; satu sumber persona | Build image memuat persona | **FIXED** |
| `CFG-04` | `config/brand.ts:27-38`; `followup-templates.ts:80-334` | Semua brand/follow-up lewat `getBrandIdentityAsync(tenantId)` | Dua tenant beda brand | **FIXED** |
| `CFG-05` | `services/delivery.service.ts:244,335` | Origin ongkir dari `getClinicLocationAsync(tenantId)` | Ongkir beda per tenant | **FIXED** |
| `UTL-02` | `utils/reservation-text-parser.ts:795-958` | Tanggal pakai timezone WIB, bukan `getDay()` UTC | Test dini hari WIB | **FIXED** |
| `UTL-03` | `utils/reservation-text-parser.ts:1-1148` | Pecah parser >1.148 baris per domain | File <1.500; test parser hijau | **FIXED** |
| `UTL-06` | `utils/date-confirmation.ts:170-185` | Normalisasi konfirmasi tanggal deterministik | Test variasi parafrase | **FIXED** |
| `DEL-01` | `.github/workflows/ci.yml` (baru) | CI: secret scan, typecheck, build backend+dashboard, test | Workflow valid; PR gate | **FIXED** |
| `DEL-02` | `scripts/deploy.sh` | Delegasi ke `deploy-prod.sh`, bukan restart app saja | `bash -n`; worker & migrasi ikut | **FIXED** |
| `DEL-05` | `Dockerfile:46-47` | Copy `.prisma`/`@prisma/client` dari builder; hapus `npx prisma generate` runner | Build offline runner | **FIXED** |
| `DEL-07` | `scripts/backup.sh:32-48` | Backup via container + `verify-backup-restore.ts`; tanpa `.env` plaintext | Restore drill row-count | **FIXED** |

**Gate F2:** semua test baru hijau; build backend+dashboard; typecheck; full suite baseline-diff 0 failure baru; security scan bersih; commit per kelompok (F2A/F2B/F2C).

---

### F3 — P1 Struktural: State Machine, Follow-up, Admin API, Delivery

#### F3.1 Modul 6 — `MODULE_AUDIT_06` (SM-01..SM-14)

| Sub-fase | Temuan | Fokus | Acceptance |
|---|---|---|---|
| F3.1a | `SM-01` | Pecah `message.service.ts` 2.208 → `messagePinService`, `messageReactionService`, `messageReadStatusService`; facade kompatibilitas | File utama 1.390 (<1.500); test hijau | **FIXED** |
| F3.1b | `SM-02`, `SM-04`, `SM-06`, `SM-07`, `SM-08` | Form pattern data-driven; reset sesi atomik; sapaan persona; paritas `MessageTransport`; satu `isCommandText` | Test parafrase + dua tenant | **FIXED** |
| F3.1c | `SM-03`, `SM-05`, `SM-09`..`SM-14` | Bounded memory; hapus dead import; alert logging; timer registry; type safety; cache tenant; backpressure; batch memory | Test memory/regresi | **FIXED** |

#### F3.2 Modul 12 — `MODULE_AUDIT_12` (FN-01..FN-12)

| Sub-fase | Temuan | Fokus | Acceptance | Status |
|---|---|---|---|:---:|
| F3.2a | `FN-01`, `FN-03` | Pecah `follow-up.service.ts` 2.895 & `staff-notification.service.ts` 1.101 | File utama <1.500; parity test | **FIXED** |
| F3.2b | `FN-02` (jika belum), `FN-05`, `FN-07`, `FN-08` | Outbound log; VAPID; cooldown per tenant; subjek VAPID tenant | Test dua tenant | **FIXED** |
| F3.2c | `FN-04`, `FN-06`, `FN-09`..`FN-12` | Bounded memory; tenant eksplisit; type safety; transaksi; log fallback; pruning | Test memory/tenant | **FIXED** |

#### F3.3 Modul 15 — `MODULE_AUDIT_15` (API-01..API-12)

| Sub-fase | Temuan | Fokus | Acceptance |
|---|---|---|---|
| F3.3a | `API-01` | Pecah `reservation-dispatch.route.ts` 3.244, `settings.subroute.ts` 2.817, `customers.subroute.ts` 1.997 per domain; rute tetap terdaftar | File <1.500; integration test boot app |
| F3.3b | `API-05`, `API-07`, `API-08` | Mutasi scoped; schema validation; alias route satu handler | Test IDOR/payload/route |
| F3.3c | `API-04` (known), `API-09`..`API-12` | Perjelas by-design; tipe Fastify; cache headers; audit alert; rate limit | Test kontrak |

#### F3.4 Modul 16 — `MODULE_AUDIT_16` (DEL-01..DEL-12)

| Sub-fase | Temuan | Fokus | Acceptance |
|---|---|---|---|
| F3.4a | `DEL-01`, `DEL-02`, `DEL-05`, `DEL-06`, `DEL-07` | CI, deploy, prisma runner, env script, backup | CI hijau; shellcheck/bash -n |
| F3.4b | `DEL-08`, `DEL-09`, `DEL-10` | Caddy CSP/domain; build dashboard; `test:db` | Build dashboard di CI |
| F3.4c | `DEL-11`, `DEL-12` | Logrotate; bersihkan root file | Repo hygiene |

#### F3.5 Track B P1 (dari F1.2)

- Ambil seluruh status `OPEN`/`PARTIAL` severity kritis/tinggi dari `TRACK_B_REBASELINE_7_14.md`.
- Kelompokkan per modul 7–14; setiap temuan mendapat test + perbaikan fondasional.
- Gate: build + targeted + full suite.

**Gate F3:** file utama God Object <1.500 baris; 0 route duplikat; build backend+dashboard; full suite 0 failure baru.

---

### F4 — P2/P3 & Sisa Track A/B

| Batch | Cakupan | Contoh |
|---|---|---|
| F4.1 | Track A P2/P3 (D-04..D-18, CFG-06..20, UTL-07..25, DOM-01..15, ING-09..18) | query 3 round-trip, bounded cache, dead code, test coverage |
| F4.2 | S4 P2/P3 (SM/FN/API/DEL sisanya) | memory bounded, type safety, cleanup, rate limit |
| F4.3 | Track B P2/P3 hasil F1.2 | cron evidence, settings tenant, marketing, dsb. |
| F4.4 | Hardening test | adversarial multi-phrasing, dua tenant, race condition |

**Aturan:** setiap item harus punya status akhir `FIXED`, `KNOWN` (dengan alasan produk), atau `WONTFIX` (dengan persetujuan). Tidak boleh dibiarkan `OPEN` tanpa catatan.
**Gate F4:** full suite 0 failure baru; security scan; register 100% berstatus.

---

### F5 — Produksi: Seed, Backup, Cron, PWA, Deploy

**Prasyarat:** F2–F4 hijau; persetujuan eksplisit terpisah untuk migrasi/seed/deploy.

| ID | Aksi | Perintah | Acceptance |
|---|---|---|---|
| F5.1 | Backup DB + verifikasi restore | `npx tsx scripts/verify-backup-restore.ts` | Checksum/manifest valid; row-count cocok |
| F5.2 | Seed katalog dry-run | `npm run seed:catalog -- --tenant=default-tenant --brand=Kala` | 42 layanan + 7 tier; tidak menulis |
| F5.3 | Seed katalog commit | `npm run seed:catalog -- --tenant=default-tenant --brand=Kala --commit` | DB terisi; dua tenant berbeda |
| F5.4 | Cron paralel + restart + alert | staging | Tidak ada dobel; alert saat worker mati |
| F5.5 | PWA perangkat fisik | staging | Kamera, push, safe-area, offline |
| F5.6 | Deploy staging → canary → produksi | `scripts/deploy-prod.sh` | Migrasi dulu, app, worker terakhir |
| F5.7 | Smoke pasca-deploy | `/health`, `/ready`, webhook, chat, CAPI | Semua hijau |

**Catatan WAHA:** jika deploy menyentuh/merestart WAHA, wajib **2-step verification** + WARNING eksplisit.

---

### F6 — Verifikasi Akhir & Penutupan

| ID | Aksi | Acceptance |
|---|---|---|
| F6.1 | Full suite final + baseline-diff | 0 failure baru vs `after-s5-final.json` |
| F6.2 | Build backend+dashboard + typecheck | exit 0 |
| F6.3 | Security scan `--all` | 0 kebocoran |
| F6.4 | Uji dua tenant E2E (RBAC, settings, knowledge, webhook, media, marketing) | Isolasi terbukti |
| F6.5 | Update `KNOWN_ISSUES`, `FEATURE_INVENTORY`, `CHANGELOG`, `docs/changelog/INDEX.md` | Semua status final tercatat |
| F6.6 | Tutup register & tag rilis | 16/16 modul, 100% status |

---

## 4. Regression Gate Wajib (setiap fase)

```powershell
npm run build
npm run typecheck
npm --prefix packages/admin-dashboard run build
npm run security:scan
npx vitest run <targeted-tests>
npx vitest run --reporter=json --outputFile=docs/audit/2026-11-09/<fase>.json
node scripts/audit-baseline-diff.mjs docs/audit/2026-11-09/after-s5-final.json docs/audit/2026-11-09/<fase>.json
```

**Aturan:** failure yang diklaim pre-existing WAJIB dibuktikan dengan revert-and-rerun; flaky diuji 3× terisolasi; tidak boleh melemahkan assertion.

---

## 5. Definition of Done Global

- [ ] 16/16 modul punya laporan/re-baseline dengan `file:line` terverifikasi.
- [ ] 100% temuan berstatus `FIXED`, `KNOWN` (alasan produk), atau `WONTFIX` (disetujui).
- [ ] Semua P0/P1 fixed + test; P2/P3 selesai atau tercatat resmi.
- [ ] Build backend+dashboard, typecheck, full suite 0 failure baru, security scan bersih.
- [ ] Seed katalog produksi + backup/restore + cron + PWA terverifikasi.
- [ ] Deploy staging → canary → produksi sukses.
- [ ] `KNOWN_ISSUES`, `FEATURE_INVENTORY`, `CHANGELOG` mutakhir.
- [ ] Tidak ada dependency runtime baru.

---

## 6. Confirmation Gate

Plan ini **tidak boleh dieksekusi** sebelum pengguna mengetik salah satu:

- `Setuju F0` — baseline & register terpadu.
- `Setuju F0–F1` — tambah audit Modul 11 + re-baseline Track B.
- `Setuju F2` — mulai remediasi P0/P1.
- Persetujuan per fase.

**DB migration (`D-01`), seed `--commit`, dan deploy produksi** memerlukan persetujuan terpisah. Auto-approval hook sistem bukan persetujuan.

---

## 7. Risiko & Rollback

| Risiko | Mitigasi |
|---|---|
| Refactor God Object merusak alur | Strangler + facade; test parity; commit per sub-fase |
| Migrasi `D-01`/seed kehilangan data | Backup + dry-run + approval + row-count |
| Tenant isolation memblokir admin sah | Test dua tenant + super-admin; pesan error jelas |
| Deploy menyentuh WAHA | 2-step verification + WARNING; staging dulu |
| Flaky full suite | Isolasi 3×; klasifikasi; jangan lemahkan assertion |
| Plan menambah dependency | Larangan; review `package.json` per fase |

---

## 8. Titik Mulai yang Disarankan

1. **F0** — 1 hari, read-only + docs.
2. **F1** — 2–3 hari, menutup Modul 11 dan menghasilkan register Track B terkini.
3. **F2A** — mulai dari 3 temuan kritis: `CFG-01`, `UTL-01`, `D-01`.

Setelah F1 selesai, kita punya angka pasti: berapa temuan Track B yang benar-benar masih OPEN, sehingga F2–F4 bisa dieksekusi tanpa menebak.
