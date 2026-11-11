# EVIDENCE LEDGER — FASE 0 (FREEZE SERTIFIKASI) + FASE 1 (EVIDENCE GATE)

- **Tanggal:** 2026-11-10
- **Auditor:** AI Agent (audit read-only; tidak mengubah kode produksi)
- **Commit acuan:** `e98d4ffe` (rekonsiliasi register dokumentasi), `1d972cac` (remediasi F4)
- **Register:** [`docs/plans/REMAINING_BACKLOG_2026-11-09.md`](../../plans/REMAINING_BACKLOG_2026-11-09.md)
- **Status:** **FREEZE** — tidak ada deploy produksi sampai Fase 0–5 selesai.

## 0. Pembaruan Fase 1 (2026-11-10)

- **6 item `BUKTI AWAL` dinaikkan ke `FIXED`** setelah test lulus:

| ID | Bukti test | Hasil |
|---|---|---|
| **S-002** | `tests/unit/fase1-perimeter-hardening.test.ts` | Lulus |
| **S-003** | `tests/unit/rbac-scope-fail-closed.test.ts` | Lulus |
| **S-013** | `tests/unit/security-secret-scan-all.test.ts` | Lulus |
| **I-010** | `tests/unit/web-push-fail-closed.test.ts` | Lulus |
| **A-001** | `tests/unit/tool-execution-authz.test.ts` | Lulus |
| **A-003** | `tests/unit/v3-triage-gate.test.ts`, `tests/unit/v3/vaccine-safety.test.ts` | Lulus |

- **17 item `KNOWN` dikembalikan ke `OPEN`** karena isu keamanan/tenant/privacy/korektness belum terselesaikan: `CFG-12`, `UTL-15`, `S-008`, `S-011`, `S-012`, `S-015`, `S-016`, `Ar-004`, `Ar-008`, `W-006`, `W-010`, `W-011`, `I-006`, `S-02`, `S-06`, `S-09`, `Cfg-015`.
- **3 item tetap `KNOWN`** dengan justifikasi: `DOM-02`, `ING-09`, `ING-10`. `API-04` tetap `KNOWN` dengan syarat deployment single-tenant.
- **Register:** **164 FIXED / 78 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 17 OPEN** (268 total).
- **Gerbang bukti:** `npm run verify:backlog` — manifest mesin: [`backlog-evidence.json`](./backlog-evidence.json).

### 0.1 Mekanisme Gerbang Bukti

| Aturan | Ditegakkan oleh |
|---|---|
| FIXED wajib di baseline historis atau punya entri `verified` | `scripts/verify-backlog-evidence.mjs` |
| Baseline FIXED historis tidak boleh tumbuh (>158) | idem |
| Bukti wajib punya 1 `file` ber-`line` + 1 `test` | idem |
| `path` bukti wajib ada dan `contains` wajib cocok | idem |
| KNOWN wajib `justification` + `acceptance` | idem |
| DUPLICATE wajib `canonical` + `reason` | idem |
| Status OPEN/UNVERIFIED tidak boleh punya entri manifest basi | idem |
| CI menolak PR yang melanggar | `.github/workflows/ci.yml` step **Backlog Evidence Gate** |

Uji adversarial gerbang: `tests/unit/backlog-evidence-gate.test.ts` (6 test — lolos pada kondisi sah, dan **gagal** pada: FIXED tanpa bukti, `contains` tidak cocok, baseline tumbuh, KNOWN tanpa acceptance, DUPLICATE tanpa reason).

### 0.2 Pembaruan Fase 2A (2026-11-10)

Lima item pertama Fase 2 diperbaiki secara fondasional (gerbang kode/data, bukan tambalan prompt) dan naik ke `FIXED`:

| ID | Akar masalah | Perbaikan (fondasional) | Bukti test | Hasil |
|---|---|---|---|---|
| **S-001** | Kredensial admin tertulis di dokumentasi ter-track, dan scanner tidak memeriksa pola markdown | `GUIDE_OPERASIONAL.md` diredaksi ke placeholder env; rule `scanDocumentationCredential` di `scripts/scan-secrets.ts` (anchored, filter placeholder & potongan kode) | `tests/unit/security-doc-credential-scan.test.ts` (7, termasuk anti-false-positive baris audit) | Lulus; `security:scan` LULUS 2.135 file |
| **W-009** | Cache `phone_number_id -> tenant` tanpa TTL: reassignment tidak pernah terbaca | `src/utils/ttl-cache.ts` + cache ber-TTL di `waba-tenant.service.ts` + invalidasi pada PATCH admin WABA | `tests/unit/ttl-cache.test.ts` (6) | Lulus |
| **A-006** | Riwayat chat dikirim mentah; injeksi di history lolos isolasi | `buildSanitizedHistory()` menetralkan seluruh entri + membungkus pesan `user`, dipakai `agent-runner.ts` | `tests/unit/v3/prompt-injection-sanitizer.test.ts` (+4 adversarial) | Lulus |
| **C-003** | Pre-grounding katalog memakai mandat koersif yang menimpa *clinical dominance* | `goal-tracker.ts` jadi rujukan netral ("Rujukan katalog klinis"), tanpa larangan penggantian | `tests/unit/v3-pregrounding-catalog.test.ts` (assertion baru) | Lulus |
| **K-013** | Drift dokumentasi jumlah cron (21/23 vs 22) | `docs/FEATURE_INVENTORY.md` menyatakan 22 interval cron / 23 pekerja logis (definisi kanonis `background-crons.ts`) | `tests/unit/cron-registry-consistency.test.ts` (3) | Lulus |

- **Register:** **169 FIXED / 73 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 17 OPEN** (268 total).
- **Gerbang bukti:** `npm run verify:backlog` -> `PASS` (11 verified baru, baseline 158/158 tidak tumbuh).
- **Ditunda dengan justifikasi:** `C-001` (rewrite/rerank RAG, blast radius besar -> butuh Confirmation Gate) dan `Ar-003` (661 referensi `DEFAULT_TENANT_ID` di 133 file -> butuh Confirmation Gate migrasi bertahap).

### 0.3 Triage Fase 2B — 73 item `UNVERIFIED` (2026-11-10)

Seluruh 73 item `UNVERIFIED` ditriase read-only terhadap kode aktual. Hasil: **22 naik `FIXED`** (kode sudah benar + test relevan), **46 turun `OPEN`** (cacat masih ditemukan di `file:line`), dan **5 tetap `UNVERIFIED`** (butuh artefak runtime/DB atau Confirmation Gate).

**22 FIXED (bukti di `backlog-evidence.json`):** `UTL-11`, `W-008`, `I-001`, `I-005`, `A-002`, `A-004`, `A-005`, `A-010`, `C-004`, `C-005`, `C-009`, `C-011`, `M-01`, `M-08`, `M-09`, `K-001`, `K-002`, `K-004`, `K-012`, `Cfg-001`, `Cfg-002`, `Cfg-003`.

**Test baru yang mengunci item:**

| Test | Item | Sifat |
|---|---|---|
| `tests/unit/cron-advisory-lock-lease.test.ts` | `K-001`, `K-002` | lease tunggal, fail-closed produksi, release aman |
| `tests/integration/knowledge-tenant-isolation.test.ts` | `Cfg-002` | BOLA lintas tenant (PUT/DELETE 404, tanpa mutasi) |
| `tests/integration/waba-webhook-route.test.ts` | `W-008` | `phone_number_id` tak dikenal 200 `UNKNOWN_TENANT_REJECTED` (anti retry storm) |
| `tests/unit/get-catalog-tool-grounding.test.ts` | `A-004` | `specificTreatmentName` tidak mengeliminasi rekomendasi klinis |

**5 tetap `UNVERIFIED`:** `SM-02` (inert, 0 pemanggil), `C-001` (Confirmation Gate), `C-002` (butuh dump korpus DB), `C-006` (butuh log RAG runtime), `A-013` (klaim dokumentasi tanpa contoh konkret).

**46 OPEN** dicatat ulang dengan alasan spesifik di register (contoh: `Ar-003` 661 referensi `DEFAULT_TENANT_ID`, `Cfg-012` handler tulis default-tenant, `A-008` template deterministik pasca-sanitizer, `K-006` batas hari UTC).

- **Register:** **191 FIXED / 5 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 63 OPEN** (268 total).
- **Gerbang bukti:** `npm run verify:backlog` -> `PASS` (33 verified baru, baseline 158/158).
- **Gerbang regresi:** full suite **6.997 test / 6.966 lulus / 3 gagal**; 2 gagal pre-existing #287, 1 gagal berasal dari WIP pengguna yang belum di-commit (`packages/admin-dashboard/src/lib/dashboard-metrics.ts` re-export ke `utils/money.ts`) — bukan regresi perubahan ini.

### 0.4 Fase 2C — remediasi 5 item OPEN (2026-11-11)

Lima item `OPEN` diperbaiki secara fondasional (gerbang kode + test), bukan tambalan prompt:

| ID | Akar masalah | Perbaikan | Bukti test |
|---|---|---|---|
| **A-007** | `kota`/centroid dianggap lokasi presisi sehingga `save_reservation` bisa dikunci tanpa alamat pasti | `LocationState.isEstimatedCentroid` dipersist dari tool; masker menolak kota-only/centroid (butuh kelurahan/kecamatan/rawText presisi/jarak+ongkir non-centroid) | `tests/unit/v3/booking-precision-location.test.ts` (3) |
| **K-006** | Ekspor chat memakai batas hari UTC sehingga pesan 00:00–06:59 WIB hilang | `parseDateRange()` memakai offset `+07:00` (hari WIB) | `tests/unit/chat-export.test.ts` (batas WIB + pesan 00:30 WIB) |
| **Cfg-004** | `GET /api/admin/settings/notifications` (memuat `telegramPairingToken`) ada di allowlist baca staf | Endpoint dicabut dari allowlist; log & daily-report tetap boleh dibaca | `tests/integration/admin-settings-secret-allowlist.test.ts` (2) |
| **I-009** | Resend sukses tidak memperbarui baris log idempotensi → `FAILED` permanen & kirim ulang terus | P2002 branch memperbarui status ke `SENT`/`SKIPPED`; status `SENT` tidak diturunkan | `tests/unit/notification-idempotency-resend.test.ts` (2) |
| **Cfg-014** | API bisa menimpa `allowedPaths` role sistem; fallback memori global lintas tenant | Role sistem `409 SYSTEM_ROLE_IMMUTABLE`; memori diisolasi per tenant | `tests/integration/admin-roles-hardening.test.ts` (2) |

- **Ar-005 parsial:** `GET /api/admin/roles` kini `503 DATABASE_UNAVAILABLE` saat DB gagal di produksi (bukan 200 kosong); route admin lain masih perlu audit serupa → tetap `OPEN`.
- **Register:** **196 FIXED / 5 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 58 OPEN** (268 total).
- **Gerbang bukti:** `npm run verify:backlog` → `PASS` (38 verified baru, baseline 158/158).
- **Gerbang regresi:** 7.044 test / 7.011 lulus / 5 gagal: 2 pre-existing #287; 3 time-out flaky saat beban suite penuh (`media-mime-audio` ×2 ~9,5 dtk dan `staff-auth-and-reservation` GPS ×1 ~4 dtk) — ketiganya lulus saat dijalankan terisolasi. Tidak ada regresi kode dari perubahan Fase 2C.

### 0.5 Fase 2D — Confirmation Gate: tenant seam + RAG rerank (2026-11-11)

**Gate 1 (Opsi A, fase 1.1–1.2) — Ar-003/Cfg-012:**

- Seam `resolveSessionTenantId()` + flag `MULTI_TENANT_ENABLED` di `src/routes/admin/route-helpers.ts`. Default single-tenant tetap; mode multi-tenant **fail-closed 401 TENANT_REQUIRED** bila tenant tidak eksplisit.
- Handler dimigrasi ke tenant peminta (bukan `default-tenant`): `labels.subroute.ts`, `meta-attribution.subroute.ts`, `google-integration.subroute.ts`, `waba.subroute.ts`, `staff/auth.subroute.ts`.
- `waba.subroute.ts`: body/query tidak lagi bisa menimpa tenant sesi.
- Test: `tests/unit/tenant-resolution-seam.test.ts` (6), `tests/integration/admin-tenant-failclosed.test.ts` (3), isolasi label di `tests/integration/labels-admin.test.ts`.
- **Status tetap OPEN**: 133 file dan domain `livechat`/`follow-up`/`migration`/`settings` belum dimigrasi (fase 1.3–1.4).

**Gate 2 (Opsi A, fase 2.1–2.2) — C-001:**

- Modul murni `src/services/rag-score.ts`: normalisasi `ts_rank`, skor irisan `keywords`, rerank berbobot (FTS 0.5 / similarity 0.35 / keywords 0.15), gate relatif.
- Terpasang di `knowledge.service.ts` untuk jalur SQL **dan** in-memory fallback.
- Test: `tests/unit/rag-score.test.ts` (8 adversarial) + `tests/unit/rag-rerank-integration.test.ts` (2, tanpa DB).
- **C-001 → FIXED** (bukan embedding; tanpa dependency baru).

- **Register:** **197 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 58 OPEN**.
- **Gerbang bukti:** `npm run verify:backlog` → `PASS` (39 verified baru); `npm run security:scan` → LULUS 2.149 file.
- **Gerbang regresi:** 7.064 test / 7.033 lulus / 3 gagal: 2 pre-existing #287 + 1 time-out flaky `production_edge_cases` LOCATION_CONFIRMED (7,5 dtk terisolasi, timeout 15 dtk saat beban suite penuh). Tidak ada regresi kode.

### 0.6 Gerbang Regresi Fase 1

| Pemeriksaan | Hasil |
|---|---|
| `npx tsc --noEmit` | ✅ 0 error |
| `npm run build` | ✅ exit 0 |
| `npm run verify:backlog` | ✅ PASS (164 FIXED / 78 UNVERIFIED / 5 DUP / 4 KNOWN / 17 OPEN) |
| Full suite Vitest | **6.964 test / 6.934 lulus / 2 gagal pre-existing #287 / 28 skip** — artefak [`after-fase1.json`](./after-fase1.json) |
| `audit-baseline-diff.mjs` vs `after-f4-remediation.json` | ✅ **New failures: 0** |
| Test re-sertifikasi + gate | ✅ 9 suite / 55 test lulus |

### 0.3 Nasib 20 Item `OPEN → KNOWN` (temuan Fase 0)

| Keputusan Fase 1 | Item | Dasar |
|---|---|---|
| **Kembali ke `OPEN`** | 17 item (lihat daftar di atas) | Isu keamanan/tenant/privacy/korektness belum terselesaikan; bukan *by-design* |
| **Tetap `KNOWN`** | `DOM-02`, `ING-09`, `ING-10` | Tech debt struktural/trace audit, tanpa risiko data langsung; punya acceptance criteria |
| **Tetap `KNOWN` (bersyarat)** | `API-04` | Diterima hanya untuk deployment single-tenant; wajib `tenant_id` sebelum tenant kedua |

---

## 1. Tujuan

Fase 0 menghentikan sertifikasi palsu. Commit `e98d4ffe` hanya mengubah dua file dokumentasi, tetapi mengubah **83 item** dari `OPEN/PARTIAL` menjadi `FIXED`. Tidak ada file `src/`, `tests/`, atau `scripts/` di commit itu. Skrip `scratch/update_backlog.js` bahkan menjadikan **FIXED sebagai default** untuk semua item yang tidak masuk dua daftar kecil.

Karena itu, seluruh 83 item diturunkan ke `UNVERIFIED`. Satu item tambahan, `SM-02`, juga diturunkan karena terbukti **inert** (kode ada, tetapi tidak pernah dipanggil produksi).

---

## 2. Ringkasan

| Kategori | Jumlah | Arti |
|---|---:|---|
| Item mass-flip `OPEN/PARTIAL → FIXED` | **83** | Diturunkan ke `UNVERIFIED` |
| — dengan bukti awal | **6** | Kandidat re-sertifikasi Fase 1 setelah test formal |
| — terbukti masih bermasalah | **7** | Tidak boleh dikembalikan ke FIXED sebelum diperbaiki |
| — belum ada bukti | **70** | Wajib diverifikasi Fase 1 |
| Item tambahan `SM-02` | **1** | `INERT` — diturunkan ke `UNVERIFIED` |
| **Total diturunkan** | **84** | `158 FIXED` tersisa dari 242 |

---

## 3. Metode

1. Bandingkan register pada `e98d4ffe~1` vs `e98d4ffe`; hitung transisi status per ID.
2. Baca kode aktual untuk item berisiko tinggi (kredensial, tenant, klinis, RAG, prompt, cron, cache).
3. Jalankan gerbang yang bisa direproduksi:
   - `npx tsc --noEmit` → 0 error.
   - `npm run build` → exit 0.
   - `npm run security:scan` → 2.129 file, 0 kebocoran.
   - `npx vitest run` subset adversarial/state-machine/media/parser → 50 test lulus.
   - `node scripts/audit-baseline-diff.mjs docs/audit/2026-11-10/after-f4-4.json docs/audit/2026-11-10/after-f4-remediation.json` → 0 regresi baru.
4. Setiap verdict wajib punya bukti `file:line`, test, atau perintah. Tanpa itu → `BELUM ADA BUKTI`.

---

## 4. Daftar 83 Item Mass-Flip (`OPEN/PARTIAL → FIXED`)

| No | ID | Modul | Severity | Track | Verdict Fase 0 | Bukti / Catatan |
|---:|---|---|---|---|---|---|
| 1 | **CFG-16** | Modul 02 Config & Persona | Sedang | Track A | BELUM ADA BUKTI | Klaim F4.1; belum ada test/bukti tervalidasi di ledger. |
| 2 | **CFG-17** | Modul 02 Config & Persona | Sedang | Track A | BELUM ADA BUKTI | Klaim F4.1; belum ada test lintas-proses `saveQueue`. |
| 3 | **UTL-11** | Modul 03 Utilities | Sedang | Track A | BELUM ADA BUKTI | Klaim F4.1; belum ada bukti konsolidasi `wib-time`/`time-wib`. |
| 4 | **S-001** | Modul 01/11 Inti & Keamanan | Kritis | Track B | TIDAK TERBUKTI | `GUIDE_OPERASIONAL.md:36-40` masih memuat `admin12345` dan `my_waha_api_key_secret`. |
| 5 | **S-002** | Modul 01/11 Inti & Keamanan | Kritis | Track B | BUKTI AWAL | Guard `SUPER_ADMIN` di `src/routes/admin/waba.subroute.ts:20-35`; perlu test formal Fase 1. |
| 6 | **S-003** | Modul 01/11 Inti & Keamanan | Tinggi | Track B | BUKTI AWAL | Fail-closed di `src/services/role-scope.service.ts:70`; perlu test formal Fase 1. |
| 7 | **S-013** | Modul 01/11 Inti & Keamanan | Sedang | Track B | BUKTI AWAL | `npm run security:scan` memindai 2.129 file (`--all`); perlu bukti CI Fase 1. |
| 8 | **Ar-003** | Modul 01/11 Inti & Keamanan | Tinggi | Track B | TIDAK TERBUKTI | 661 referensi `DEFAULT_TENANT_ID` di 133 file `src/`; login admin hardcode di `src/routes/admin/auth.subroute.ts:130,190,219,285,316,369,386,407`; login staf default di `src/routes/staff/auth.subroute.ts:42`. |
| 9 | **Ar-005** | Modul 01/11 Inti & Keamanan | Sedang | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 10 | **Ar-009** | Modul 01/11 Inti & Keamanan | Sedang | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 11 | **W-008** | Modul 02/09 WhatsApp & Integrasi | Sedang | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 12 | **W-009** | Modul 02/09 WhatsApp & Integrasi | Kritis | Track B | TIDAK TERBUKTI | `src/services/waba-tenant.service.ts:8,20,32` cache `Map` tanpa TTL/`expiresAt`. |
| 13 | **I-001** | Modul 02/09 WhatsApp & Integrasi | Kritis | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 14 | **I-002** | Modul 02/09 WhatsApp & Integrasi | Kritis | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 15 | **I-005** | Modul 02/09 WhatsApp & Integrasi | Sedang | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 16 | **I-007** | Modul 02/09 WhatsApp & Integrasi | Tinggi | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 17 | **I-008** | Modul 02/09 WhatsApp & Integrasi | Sedang | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 18 | **I-009** | Modul 02/09 WhatsApp & Integrasi | Sedang | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 19 | **I-010** | Modul 02/09 WhatsApp & Integrasi | Tinggi | Track B | BUKTI AWAL | `src/services/web-push.service.ts:63-68` fail-closed di produksi; perlu test formal Fase 1. |
| 20 | **I-011** | Modul 02/09 WhatsApp & Integrasi | Sedang | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 21 | **A-001** | Modul 03 AI Engine Pipeline | Kritis | Track B | BUKTI AWAL | Otorisasi eksekusi tool di `src/v3/agent/pipeline/tool-pipeline.ts:283-284`; perlu test formal Fase 1. |
| 22 | **A-002** | Modul 03 AI Engine Pipeline | Kritis | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 23 | **A-003** | Modul 03 AI Engine Pipeline | Kritis | Track B | BUKTI AWAL | Triage klinis di `src/v3/agent/pipeline/medical-signal-detector.ts:14,269-306`; perlu uji adversarial Fase 1. |
| 24 | **A-004** | Modul 03 AI Engine Pipeline | Tinggi | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 25 | **A-005** | Modul 03 AI Engine Pipeline | Tinggi | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 26 | **A-006** | Modul 03 AI Engine Pipeline | Tinggi | Track B | TIDAK TERBUKTI | `src/v3/agent/agent-runner.ts:209-212` mengirim riwayat mentah; hanya pesan saat ini di-`wrapCustomerMessage` (`:214`). |
| 27 | **A-007** | Modul 03 AI Engine Pipeline | Tinggi | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 28 | **A-008** | Modul 03 AI Engine Pipeline | Sedang | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 29 | **A-009** | Modul 03 AI Engine Pipeline | Sedang | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 30 | **A-010** | Modul 03 AI Engine Pipeline | Sedang | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 31 | **A-011** | Modul 03 AI Engine Pipeline | Tinggi | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 32 | **A-012** | Modul 03 AI Engine Pipeline | Sedang | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 33 | **A-013** | Modul 03 AI Engine Pipeline | Rendah | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 34 | **C-006** | Modul 03 AI RAG & Prompt | Kritis | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 35 | **C-001** | Modul 03 AI RAG & Prompt | Tinggi | Track B | TIDAK TERBUKTI | `src/services/knowledge.service.ts:191-253` masih leksikal (`ts_rank`/`plainto_tsquery`/trigram); tanpa query rewriting/rerank. |
| 36 | **C-002** | Modul 03 AI RAG & Prompt | Tinggi | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 37 | **C-003** | Modul 03 AI RAG & Prompt | Kritis | Track B | TIDAK TERBUKTI | `src/v3/state/goal-tracker.ts:472,493` masih memuat `[MANDAT ... DILARANG mengganti ...]`. |
| 38 | **C-004** | Modul 03 AI RAG & Prompt | Kritis | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 39 | **C-005** | Modul 03 AI RAG & Prompt | Kritis | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 40 | **C-007** | Modul 03 AI RAG & Prompt | Tinggi | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 41 | **C-008** | Modul 03 AI RAG & Prompt | Tinggi | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 42 | **C-009** | Modul 03 AI RAG & Prompt | Sedang | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 43 | **C-010** | Modul 03 AI RAG & Prompt | Tinggi | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 44 | **C-011** | Modul 03 AI RAG & Prompt | Kritis | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 45 | **C-012** | Modul 03 AI RAG & Prompt | Tinggi | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 46 | **S-01** | Modul 05/07 Staf & Marketing | Kritis | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 47 | **S-03** | Modul 05/07 Staf & Marketing | Tinggi | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 48 | **S-05** | Modul 05/07 Staf & Marketing | Sedang | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 49 | **S-07** | Modul 05/07 Staf & Marketing | Tinggi | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 50 | **S-08** | Modul 05/07 Staf & Marketing | Sedang | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 51 | **S-10** | Modul 05/07 Staf & Marketing | Rendah | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 52 | **M-01** | Modul 05/07 Staf & Marketing | Kritis | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 53 | **M-02** | Modul 05/07 Staf & Marketing | Kritis | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 54 | **M-03** | Modul 05/07 Staf & Marketing | Kritis | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 55 | **M-04** | Modul 05/07 Staf & Marketing | Tinggi | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 56 | **M-05** | Modul 05/07 Staf & Marketing | Tinggi | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 57 | **M-06** | Modul 05/07 Staf & Marketing | Tinggi | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 58 | **M-07** | Modul 05/07 Staf & Marketing | Sedang | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 59 | **M-08** | Modul 05/07 Staf & Marketing | Tinggi | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 60 | **M-09** | Modul 05/07 Staf & Marketing | Tinggi | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 61 | **M-10** | Modul 05/07 Staf & Marketing | Sedang | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 62 | **K-001** | Modul 08 Background Cron | Tinggi | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 63 | **K-002** | Modul 08 Background Cron | Kritis | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 64 | **K-004** | Modul 08 Background Cron | Kritis | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 65 | **K-005** | Modul 08 Background Cron | Kritis | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 66 | **K-006** | Modul 08 Background Cron | Tinggi | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 67 | **K-008** | Modul 08 Background Cron | Tinggi | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 68 | **K-009** | Modul 08 Background Cron | Tinggi | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 69 | **K-010** | Modul 08 Background Cron | Tinggi | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 70 | **K-012** | Modul 08 Background Cron | Sedang | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 71 | **K-013** | Modul 08 Background Cron | Rendah | Track B | TIDAK TERBUKTI | `src/lifecycle/background-crons.ts` mendaftarkan 22 cron; `docs/FEATURE_INVENTORY.md:198,271` menyebut 23. |
| 72 | **Cfg-001** | Modul 10 Settings & RBAC | Tinggi | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 73 | **Cfg-002** | Modul 10 Settings & RBAC | Kritis | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 74 | **Cfg-003** | Modul 10 Settings & RBAC | Kritis | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 75 | **Cfg-004** | Modul 10 Settings & RBAC | Tinggi | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 76 | **Cfg-007** | Modul 10 Settings & RBAC | Tinggi | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 77 | **Cfg-009** | Modul 10 Settings & RBAC | Tinggi | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 78 | **Cfg-010** | Modul 10 Settings & RBAC | Tinggi | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 79 | **Cfg-011** | Modul 10 Settings & RBAC | Sedang | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 80 | **Cfg-012** | Modul 10 Settings & RBAC | Kritis | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 81 | **Cfg-013** | Modul 10 Settings & RBAC | Kritis | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 82 | **Cfg-014** | Modul 10 Settings & RBAC | Tinggi | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |
| 83 | **Cfg-017** | Modul 10 Settings & RBAC | Sedang | Track B | BELUM ADA BUKTI | Hanya klaim mass-flip `e98d4ffe`; belum ada bukti kode/test. |

---

## 5. Tujuh Item yang Terbukti Masih Bermasalah

| ID | Klaim register | Bukti aktual | Dampak |
|---|---|---|---|
| **S-001** | Kredensial historis sudah dibersihkan | `GUIDE_OPERASIONAL.md:36-40` masih memuat `admin12345` dan `my_waha_api_key_secret` | Akses admin/WAHA tidak sah |
| **Ar-003** | Isolasi multi-tenant konsisten | 661 referensi `DEFAULT_TENANT_ID` di 133 file; login admin/staf masih default tenant | Kebocoran data antar-tenant |
| **C-003** | `MANDAT` tidak lagi menimpa clinical dominance | `src/v3/state/goal-tracker.ts:472,493` masih memuat `[MANDAT ... DILARANG mengganti ...]` | Salah rekomendasi terapi |
| **C-001** | Retrieval sudah pakai rewriting/rerank | `src/services/knowledge.service.ts:191-253` masih leksikal; tanpa rewriting/rerank | Jawaban RAG tidak relevan |
| **A-006** | Riwayat sudah disanitasi | `src/v3/agent/agent-runner.ts:209-212` mengirim riwayat mentah | Prompt injection lewat history |
| **W-009** | Cache tenant sudah ber-TTL | `src/services/waba-tenant.service.ts:8,20,32` tanpa `expiresAt` | Reassignment tenant permanen |
| **K-013** | Dokumentasi cron sudah selaras | 22 cron terdaftar vs 23 di `docs/FEATURE_INVENTORY.md:198,271` | Salah asumsi operasional |

---

## 6. Item Tambahan: `SM-02` (FIXED tetapi Inert)

| Field | Isi |
|---|---|
| ID | `SM-02` |
| Klaim | Pengecekan form reservasi data-driven via header template tenant dinamis |
| Bukti kode | `src/utils/reservation-text-parser.ts:131` menyediakan `getTenantFormHeadersAsync`; `:162` menyediakan getter sinkron |
| Masalah | Kedua fungsi **0 pemanggil produksi**. Getter sinkron hanya membaca cache yang tidak pernah diisi loader DB. Header dari `Tenant.settings.formHeaders` tidak pernah dimuat |
| Verdict | **INERT** → `UNVERIFIED` |

---

## 7. 20 Item `OPEN → KNOWN` Tanpa Justifikasi By-Design

Item berikut tidak diubah menjadi FIXED, tetapi juga diubah statusnya pada commit dokumentasi yang sama. Fase 1 wajib mengisi justifikasi by-design + acceptance criteria; jika tidak, kembalikan ke `OPEN`.

> **Pembaruan Fase 1:** tabel ini adalah kondisi **awal Fase 0**. Hasil akhirnya ada di [§0.3](#03-nasib-20-item-open--known-temuan-fase-0) — 17 item kembali `OPEN`, 3 tetap `KNOWN` dengan acceptance criteria, dan `API-04` tetap `KNOWN` bersyarat single-tenant.

| No | ID | Modul | Severity | Status | Ringkasan |
|---:|---|---|---|---|---|
| 1 | **CFG-12** | Modul 02 Config & Persona | Sedang | KNOWN | UI mencantumkan 9 provider AI, namun runtime hanya benar-benar memproses endpoint KENARI dan SUMOPOD. |
| 2 | **UTL-15** | Modul 03 Utilities | Sedang | KNOWN | Cache idempotensi client temp ID hanya berbasis `Map` memori lokal, tidak tersinkronisasi lintas node/worker. |
| 3 | **DOM-02** | Modul 04 Domain Logic | Sedang | KNOWN | Modul 620 baris menangani validasi Zod, deduplikasi, koordinat, rekonsiliasi, dan manipulasi tombstone dalam satu file. |
| 4 | **ING-09** | Modul 05 Ingress Webhook | Sedang | KNOWN | Perekaman pesan outbound admin (`messageService.logMessage`) masih menelan error dengan `.catch((err) => console.error)` tanpa retry ke outbox. |
| 5 | **ING-10** | Modul 05 Ingress Webhook | Sedang | KNOWN | Pipeline ingress WAHA dan WABA masih menduplikasi logika guard, sanitasi, dan pre-logging di dua file terpisah. |
| 6 | **S-008** | Modul 01/11 Inti & Keamanan | Sedang | KNOWN | Login CSRF / session fixation pada `/api/admin/auth/restore` dan `/api/staff/auth/restore` |
| 7 | **S-011** | Modul 01/11 Inti & Keamanan | Tinggi | KNOWN | Token sesi disimpan di `localStorage`, TTL 30 hari, dan dashboard `/admin/*` tidak memiliki CSP |
| 8 | **S-012** | Modul 01/11 Inti & Keamanan | Tinggi | KNOWN | Tidak ada kebijakan password staf, tidak ada lockout per akun, dan `role` bebas diisi |
| 9 | **S-015** | Modul 01/11 Inti & Keamanan | Tinggi | KNOWN | Satu `WAHA_WEBHOOK_SECRET` global dipakai untuk semua tenant dan disimpan sebagai custom header di konfigurasi WAHA tiap tenant |
| 10 | **S-016** | Modul 01/11 Inti & Keamanan | Sedang | KNOWN | Hardening deployment: container app berjalan sebagai root, tanpa `cap_drop`, dan terhubung ke `hermes-net` bersama agen pihak ketiga |
| 11 | **Ar-004** | Modul 01/11 Inti & Keamanan | Sedang | KNOWN | Constraint skema masih global: `Staff.phone`, `AdClick.trackingCode`, `LandingPage.slug` unik lintas tenant |
| 12 | **Ar-008** | Modul 01/11 Inti & Keamanan | Tinggi | KNOWN | Postur keamanan bergantung pada string `NODE_ENV === 'production'` (fail-open di staging) |
| 13 | **W-006** | Modul 02/09 WhatsApp & Integrasi | Tinggi | KNOWN | Burst coalescing mengasumsikan satu proses (tanpa lock lintas instance) |
| 14 | **W-010** | Modul 02/09 WhatsApp & Integrasi | Rendah | KNOWN | Humanizer: daftar frasa bisnis hardcode + label lama "Alamat & Shareloc" |
| 15 | **W-011** | Modul 02/09 WhatsApp & Integrasi | Rendah | KNOWN | `WahaGatewayDriver.sendTemplateMessage` mengirim teks literal `Template[...]` (kontrak bohong, laten) |
| 16 | **I-006** | Modul 02/09 WhatsApp & Integrasi | Tinggi | KNOWN | Google Calendar: tidak tenant-aware, tanpa idempotensi, durasi tetap 60 menit |
| 17 | **S-02** | Modul 05/07 Staf & Marketing | Tinggi | KNOWN | Outbox pesan gagal menyimpan teks/gambar PII di `localStorage` dan tidak dibersihkan saat logout |
| 18 | **S-06** | Modul 05/07 Staf & Marketing | Sedang | KNOWN | GPS warm-up berjalan diam-diam di latar belakang tanpa disclosure/consent dan cache tidak dibersihkan saat stop |
| 19 | **S-09** | Modul 05/07 Staf & Marketing | Sedang | KNOWN | Ergonomi lapangan & kejujuran status: target sentuh <44px, input login 14px, aksi kritis tidak antre offline, dan "pesan terkirim" palsu saat WA gagal |
| 20 | **Cfg-015** | Modul 10 Settings & RBAC | Tinggi | KNOWN | Dashboard hardcode tenant & data bisnis: `x-tenant-id: default-tenant`, brand Kala, rekening placeholder, logo Kala, koordinat/slot klinik |

---

## 8. Perintah Verifikasi (dapat diulang)

```bash
# 1. Typecheck & build
npx tsc --noEmit
npm run build

# 2. Security scan seluruh tracked tree
npm run security:scan

# 3. Regression gate artefak terakhir
node scripts/audit-baseline-diff.mjs docs/audit/2026-11-10/after-f4-4.json docs/audit/2026-11-10/after-f4-remediation.json

# 4. Subset uji F4.5
npx vitest run tests/unit/adversarial-multi-phrasing.test.ts tests/unit/state-machine-residuals.test.ts tests/unit/media-and-settings-resilience.test.ts tests/unit/reservation-text-parser.test.ts

# 5. Subset isolasi tenant eksplisit (5 suite / 23 test)
npx vitest run tests/integration/customers-tenant-isolation.test.ts tests/unit/capi-tenant-isolation.test.ts tests/unit/media-tenant-isolation.test.ts tests/unit/meta-performance-route-tenant-isolation.test.ts tests/unit/staff-tenant-isolation-auth.test.ts
```

---

## 9. Batas Cakupan

- Audit tidak menjalankan DB produksi, WAHA live, atau deploy server.
- `npm test` penuh tidak dijalankan ulang pada Fase 0; bukti memakai artefak `after-f4-remediation.json` (6.953 test, 6.923 lulus, 2 gagal pre-existing #287, 28 skip).
- Angka “37 test isolasi 2 tenant” pada laporan tidak memiliki suite/script rujukan. Yang terverifikasi: 5 suite / 23 test isolasi eksplisit lulus; total test bernuansa tenant 167 test di 34 file.
- Item `KNOWN` lama (26) belum diaudit ulang selain 20 item yang baru diubah pada `e98d4ffe`.

---

## 10. Aturan Masuk Fase 1

1. Setiap item hanya boleh kembali ke `FIXED` jika memiliki: bukti `file:line`, nama test yang lulus, commit, dan verifier.
2. Perubahan status massal lewat dokumen saja **dilarang**; wajib menyertakan file sumber/test.
3. `UNVERIFIED` tidak boleh dihitung sebagai “selesai” di laporan mana pun.
4. Deploy produksi tetap **diblokir** sampai Fase 0–5 lulus.
