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
- **Fase 1.3–1.4 (2026-11-11):** seluruh handler admin/staff dimigrasi ke seam — referensi route turun **166 → 8**; total referensi `DEFAULT_TENANT_ID` di `src` turun **663 → 459** (132 file). Handler: livechat, follow-up, staff/today, migration, auth, evaluations, knowledge, backup, export, push, quick-replies, staff-management, roles, copilot, ctwa, google, WABA, staff-auth.
- **Dikecualikan (per persetujuan):** `admin/landings.subroute.ts` (5 referensi, area landing) dan fallback yang disengaja (seed label default, helper single-tenant, staff login single-tenant).
- **Status tetap OPEN**: `Ar-003` mencakup service/worker + `Ar-004` (unique constraint lintas tenant); `Cfg-012` tinggal area landing.
- **Gerbang regresi Fase 2E:** 7.064 test / 7.034 lulus / **2 gagal pre-existing #287** — `audit-baseline-diff` → **0 regresi baru**; `verify:backlog` PASS; `security:scan` LULUS 2.155 file.

**Gate 2 (Opsi A, fase 2.1–2.2) — C-001:**

- Modul murni `src/services/rag-score.ts`: normalisasi `ts_rank`, skor irisan `keywords`, rerank berbobot (FTS 0.5 / similarity 0.35 / keywords 0.15), gate relatif.
- Terpasang di `knowledge.service.ts` untuk jalur SQL **dan** in-memory fallback.
- Test: `tests/unit/rag-score.test.ts` (8 adversarial) + `tests/unit/rag-rerank-integration.test.ts` (2, tanpa DB).
- **C-001 → FIXED** (bukan embedding; tanpa dependency baru).

- **Register:** **197 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 58 OPEN**.
- **Gerbang bukti:** `npm run verify:backlog` → `PASS` (39 verified baru); `npm run security:scan` → LULUS 2.149 file.
- **Gerbang regresi:** 7.064 test / 7.033 lulus / 3 gagal: 2 pre-existing #287 + 1 time-out flaky `production_edge_cases` LOCATION_CONFIRMED (7,5 dtk terisolasi, timeout 15 dtk saat beban suite penuh). Tidak ada regresi kode.

### 0.6 Fase 2F — 4 item OPEN (2026-11-11)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **S-05** | Payload tugas staf tidak lagi men-select/mengirim `admin_notes`, `ltv_cache`, dan LTV; alamat tetap whitelist | `tests/unit/staff-task-data-minimization.test.ts` |
| **C-012** | Import/update knowledge di produksi → 503 saat DB gagal; non-produksi eksplisit `degraded: true` | `tests/integration/knowledge-db-failure-honesty.test.ts` (3) |
| **I-008** | Telegram: timeout 8 dtk (env), retry 429/5xx + `retry_after`, tidak retry 4xx lain | `tests/unit/telegram-timeout-retry.test.ts` (4) |
| **M-07** | Log alert `PENDING` → `SENT`/`FAILED` sesuai hasil kirim (bukan SENT prematur) | `tests/unit/ad-watchdog-log-status.test.ts` (3) |

- **Register:** **201 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 54 OPEN**.
- **Test lama disesuaikan:** `fase2-rbac-matrix` memakai `importFaqsDetailed` (kontrak C-012); `ad-watchdog-cooldown` mengharapkan `PENDING` lalu update `SENT` (kontrak M-07).
- **Gerbang regresi Fase 2F:** 7.075 test / 7.045 lulus / **2 gagal pre-existing #287**; `audit-baseline-diff` → **0 regresi baru**; `verify:backlog` PASS; `security:scan` LULUS 2.156 file.

### 0.7 Fase 2G — 2 item OPEN (2026-11-11)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **A-012** | Foto tanpa caption hanya di-ack statis bila ada konteks kunjungan; tanpa konteks diserahkan ke triage (tidak mengklaim "tersimpan") | `tests/unit/fast-gate-image-context.test.ts` (2) |
| **K-008** | Invariant monitor default read-only; auto-repair opt-in `INVARIANT_MONITOR_AUTOREPAIR=true`; kegagalan audit/alert dicatat (bukan `catch {}`) | `tests/unit/invariant-monitor-readonly.test.ts` (2) |

- **Register:** **203 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 52 OPEN**.
- **Gerbang regresi Fase 2G:** 7.092 test / 7.062 lulus / **2 gagal pre-existing #287**; udit-baseline-diff → **0 regresi baru**; erify:backlog PASS; security:scan LULUS 2.161 file.

### 0.8 Fase 3A — 4 item OPEN (2026-11-11)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **S-07** | Nominal bayar lapangan dihitung ulang server (item + ongkir); klien tidak bisa mengakali setoran | `tests/unit/staff-payment-validation.test.ts` (3) |
| **S-012** | Password staf minimal 8 (huruf+angka), role divalidasi (bawaan/custom tenant) | `tests/integration/staff-policy-enforcement.test.ts` (3) + `tests/unit/staff-policy.test.ts` (4) |
| **S-016** | Compose app/worker: `no-new-privileges` + `cap_drop: ALL`; Dockerfile `USER node` | `tests/unit/deploy-hardening.test.ts` (2) |
| **Ar-008** | Webhook WAHA/WABA fail-closed via secret/flag izin eksplisit (bukan `NODE_ENV`) | `tests/integration/waha-webhook-unsigned-failclosed.test.ts` (2) + `waba-webhook-unsigned-failclosed.test.ts` (2) |

- **W0 (re-triage):** `M-03`/`Cfg-012`/`Ar-003` tetap OPEN karena sisa area landing & service/worker — tidak ada perubahan kode.
- **Register:** **207 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 48 OPEN**.
- **Gerbang regresi Fase 3A:** 7.108 test / 7.078 lulus / **2 gagal pre-existing #287**; `audit-baseline-diff` → **0 regresi baru**; `verify:backlog` PASS; `security:scan` LULUS 2.165 file.

### 0.9 Fase 3B — sesi staf & kejujuran DB knowledge (2026-11-11)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **S-01** | Restore sesi staf hanya dari cookie HttpOnly; token body/localStorage ditolak 401 | `tests/integration/staff-routes.test.ts` (29, termasuk 3 kontrak baru) |
| **S-008 (staf)** | Restore wajib header AJAX (403) + cookie `SameSite=Strict` | idem |
| **Ar-005 (sebagian)** | GET knowledge chunks/unanswered: produksi 503, non-produksi `degraded` | `tests/integration/knowledge-db-failure-honesty.test.ts` (5) |

- **S-03 tertahan:** butuh penanda persisten (kolom DB) → W6.
- **Register:** **208 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 47 OPEN**.
- **Gerbang regresi Fase 3B:** 7.113 test / 7.082 lulus / 3 gagal: 2 pre-existing #287 + **1 environment-dependent** `queue.test.ts` FIFO (gagal hanya saat Redis lokal aktif/BullMQ warm-up; lulus 11/11 dengan `DISABLE_REDIS=true`) — bukan regresi kode. `verify:backlog` PASS; `security:scan` LULUS 2.173 file.

### 0.10 Fase 4A — W2 katalog & quick reply (2026-11-11)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **Cfg-010** | Upsert/delete katalog menunggu commit DB + rollback memori; produksi 503; validasi promo≤normal & durasi 15–480 | `tests/unit/settings-catalog-honesty.test.ts` (4) |
| **Cfg-007** | Template ongkir dari `DeliveryTier` tenant; jam/alamat placeholder; seed pakai tier DB | `tests/unit/quick-replies-data-driven.test.ts` (4) |

- **Cfg-013 tertahan:** butuh Confirmation Gate (otorisasi tulis).
- **Register:** **210 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 45 OPEN**.
- **Gerbang regresi Fase 4A:** 7.121 test / 7.080 lulus / 13 gagal: 2 pre-existing #287 + 11 suite media/livechat berat yang **time-out saat beban suite penuh** dan lulus saat dijalankan terisolasi (mis. `live-chat-reply` 14/14, `quick-replies-media`, `media-route-range`, `media.service`) — bukan regresi kode. `verify:backlog` PASS; `security:scan` LULUS 2.174 file.

### 0.11 Fase 4B — Cfg-013 Opsi A (2026-11-11)

- Endpoint tulis `/api/admin/services`, `/api/admin/delivery-tiers`, `/api/admin/meta-performance` → **Super Admin only** (`403 FORBIDDEN_SUPER_ADMIN_ONLY_WRITE`); GET tetap untuk staf.
- Test: `tests/integration/admin-config-write-rbac.test.ts` (6).
- **Register:** **211 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 44 OPEN**.
- **Gerbang regresi Fase 4B:** 7.127 test / 7.097 lulus / **2 gagal pre-existing #287**; `audit-baseline-diff` → **0 regresi baru** (+11 failure flaky sebelumnya pulih); `verify:backlog` PASS; `security:scan` LULUS 2.177 file.

### 0.12 Fase 4C — provider runtime & follow-up tanpa mutilasi (2026-11-11)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **CFG-12** | Validasi provider hanya Kenari/SumoPod (runtime), bukan katalog 9 | `tests/unit/ai-provider-runtime-validation.test.ts` (3) |
| **CFG-16** | Regex mutilasi kata dihapus dari template & engine; brand tenant async | `tests/unit/followup-no-mutilation.test.ts` (2) |

- **Sisa W2:** `Cfg-009` (audit config), `Cfg-011` (endpoint setelan), `Cfg-017` (dokumen).
- **Register:** **213 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 42 OPEN**.
- **Gerbang regresi Fase 4C:** 7.132 test / 7.102 lulus / **2 gagal pre-existing #287**; `audit-baseline-diff` → **0 regresi baru**; `verify:backlog` PASS; `security:scan` LULUS 2.179 file.

### 0.13 Fase 4D — audit config jujur & tenant-aware (2026-11-11)

- 30 pemanggilan `logAdminAction` di settings (general/AI/notifications/catalog/meta) kini menyertakan `tenantId`; audit retry 1x; warning bila tenant kosong; payload rekening dimask.
- Test: `tests/unit/audit-service-resilience.test.ts` (3).
- **Register:** **214 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 41 OPEN**.
- **Gerbang regresi Fase 4D:** 7.135 test / 7.105 lulus / **2 gagal pre-existing #287**; `audit-baseline-diff` → **0 regresi baru**; `verify:backlog` PASS; `security:scan` LULUS 2.182 file.

### 0.14 Fase 5A — guardrail final, brand tenant, isolasi KB (2026-11-11)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **A-008** | Sanitizer final setelah semua fallback deterministik | `tests/unit/v3/guardrail-final-sanitize.test.ts` (2) |
| **A-009** | Brand jalur deterministik/Call 2 memakai tenant async | `tests/unit/v3/brand-tenant-wiring.test.ts` (2) |
| **C-010** | Fallback guardrail memakai brand tenant | idem |
| **C-008** | Konten KB disanitasi + dibungkus `<knowledge_chunk>` | `tests/unit/v3/kb-isolation.test.ts` (2) |

- **Register:** **218 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 37 OPEN**.
- **Gerbang regresi Fase 5A:** 7.141 test / 7.111 lulus / **2 gagal pre-existing #287**; `audit-baseline-diff` → **0 regresi baru**; `verify:backlog` PASS; `security:scan` LULUS 2.184 file.

### 0.15 Fase 5B — gate specificTreatmentName (2026-11-11)

- **C-007:** gate diekstrak ke `src/v3/tools/treatment-name-gate.ts`; nama hanya lolos bila disebut di pesan turn ini; nama generik ditolak. Test adversarial: `tests/unit/v3/treatment-name-gate.test.ts` (4).
- **A-011 tetap OPEN:** pembatalan efek samping butuh kontrak `AbortSignal` lintas tool-registry & save_reservation (desain/Confirmation Gate).
- **Register:** **219 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 36 OPEN**.
- **Gerbang regresi Fase 5B:** 7.145 test / 7.115 lulus / **2 gagal pre-existing #287**; `audit-baseline-diff` → **0 regresi baru**; `verify:backlog` PASS; `security:scan` LULUS 2.188 file.

### 0.16 Fase 6A — restore tenant, template WAHA, drain cron (2026-11-11)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **I-002** | Restore menolak dump beda tenant / baris terkontaminasi | `tests/unit/backup-restore-tenant-guard.test.ts` (2) |
| **W-011** | WAHA `sendTemplateMessage` gagal eksplisit (tidak kirim teks palsu) | `tests/unit/v3/waha-template-unsupported.test.ts` + `whatsapp-gateway.test.ts` |
| **K-010** | Worker shutdown drain cron in-flight sebelum queue/DB ditutup | `tests/unit/cron-drain-shutdown.test.ts` (3) |

- **Register:** **222 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 33 OPEN**.
- **Gerbang regresi Fase 6A:** 7.151 test / 7.120 lulus / 3 gagal: 2 pre-existing #287 + 1 `queue.test.ts` FIFO (environment-dependent, Redis lokal; lulus dengan `DISABLE_REDIS=true`) — bukan regresi kode. `verify:backlog` PASS; `security:scan` LULUS 2.191 file.

### 0.18 Fase 6B — status/alert cron & 2 cron hilang (2026-11-11)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **K-005** | `src/lifecycle/cron-health.ts`: status, durasi, kegagalan beruntun per cron; alert `CRON_JOB_FAILED` setelah ambang; diekspos di `/api/admin/health` + `/ready` | `tests/unit/cron-health.test.ts` (8) |
| **K-009** | `sandbox-cleanup` (harian) + `staff-retention-snapshot` (tgl 1 03:00 WIB) terdaftar; route manual memakai service yang sama; snapshot idempoten & tidak menimpa `FINAL` | `tests/unit/cron-k009-jobs.test.ts` (9) + `cron-registry-consistency.test.ts` |

- **Register:** **224 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 31 OPEN**.
- **Gerbang regresi Fase 6B:** 7.169 test / 7.139 lulus / 2 gagal pre-existing #287 (0 regresi); `tsc` 0 error; `build` exit 0; `verify:backlog` PASS (66 item terverifikasi); `security:scan` LULUS 2.195 file.

### 0.19 Fase 6C — CSRF restore sesi & integritas klaim audit (2026-11-11)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **S-008** | `POST /api/admin/auth/restore` wajib header AJAX + Origin/Referer sehost (`src/utils/csrf-guard.ts`); token boleh dari cookie sesi (bukan hanya body). Staf sudah cookie-only sejak S-01 | `tests/unit/admin-restore-csrf-guard.test.ts` (11) |
| **Ar-009** | Gerbang `npm run audit:verify-claims` (`scripts/verify-audit-claims.mjs`) memvalidasi seluruh rujukan `file:line` laporan audit; addendum integritas di laporan Fase 1/11 | `tests/unit/audit-claims-integrity.test.ts` (3) |

- **Register:** **226 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 29 OPEN**.
- **Catatan konfigurasi baru:** `ADMIN_ALLOWED_ORIGINS` (dipisah koma) wajib diisi bila dashboard dilayani dari origin berbeda dengan API; tanpa itu gerbang CSRF hanya menerima same-origin.
- **Gerbang regresi Fase 6C:** 7.183 test / 7.153 lulus / 2 gagal pre-existing #287 (0 regresi vs 6B); `tsc` 0 error; `build` exit 0; `verify:backlog` PASS (68 item); `audit:verify-claims` PASS (10 rujukan); `security:scan` LULUS.

- **Gerbang regresi W10:** 7.448 test / 7.418 lulus / 2 gagal pre-existing #287 (0 regresi vs W9). Dijalankan dengan `--minWorkers 1 --maxWorkers 2` karena concurrency default memicu flake timeout pada `media-mime-audio`/`live-chat-reply`/`waha-webhook` (semua lulus saat dijalankan sendiri). `tsc` 0 error; `build` root exit 0; `verify:backlog` PASS (89 item); `security:scan` LULUS 2.333 file; **dashboard build (tsc+vite) sukses**.

### 0.45 W18 — pecah modul buku alamat (DOM-02, 2026-11-13)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **DOM-02** | `src/domain/customer-address.ts` (620 baris) dipecah ke `customer-address/{types,internal,matching,list,tombstones}.ts` + barrel; file lama jadi re-export tipis (<40 baris) sehingga 21 pemanggil tetap kompatibel | `tests/unit/dom02-address-modules.test.ts` (3) + 13 suite address (142 test) |

- **Sisa KNOWN:** `ING-10` (duplikasi pipeline ingress WAHA/WABA), `C-006` (butuh log RAG runtime), `C-002` (butuh dump DB produksi).
- **Register:** **260 FIXED / 0 OPEN / 0 UNVERIFIED / 3 KNOWN / 5 DUPLICATE**.
- **Perbaikan hermetik test (bukan regresi W18):** `tests/unit/queue.test.ts` FIFO gagal karena Redis lokal aktif menyimpan jobId deterministik lama (`job_628123456789_msg_1..5`, dibuat 2026-09-09, tanpa `finishedOn`) sehingga `queue.add()` menjadi no-op (dedup BullMQ) → `processMessage` 0 panggilan. Terbukti: 11/11 lulus saat Redis tidak terjangkau (`REDIS_PORT=6399`). Test kini memaksa jalur in-memory di `beforeAll` (kontrak `forceDisconnectRedis` + `close`) dan memakai `vi.waitFor` (bukan timer 600/300 ms); 11/11 lulus berulang dengan Redis lokal aktif.
- **Gerbang regresi W18:** 7.475 test / 7.445 lulus / 2 gagal pre-existing #287 (0 regresi vs W17). `tsc` 0; `build` 0; `verify:backlog` PASS (102 item); `security:scan` LULUS.
- **Verifikasi migrasi terpadu (W18, Postgres 16 ephemeral):** keempat migrasi di atas baseline `f306d6af^` (`20261112130000_ar004_*`, `20261113100000_ar004_landing_slug_per_tenant`, `20261113120000_add_reservation_heatmap_index`, `20261113120000_api04_admin_session_tenant`) diterapkan berurutan via `migrate deploy` → sukses; drift `--from-url` → *empty migration*; 11 assertion skema OK; uji adversarial unique lintas/sama tenant & default `admin_sessions.tenant_id` sesuai harapan. Artefak: [`MIGRATION_VERIFY_W18.md`](../2026-11-13/MIGRATION_VERIFY_W18.md).

### 0.44 W17 — tutup 3 KNOWN yang bisa dikerjakan (2026-11-13)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **SM-02** | Header form tenant benar-benar data-driven: cache-miss memicu warm-up DB `Tenant.settings.formHeaders` (sekali per tenant, fail-open) | `tests/unit/sm02-tenant-form-headers.test.ts` (3) |
| **ING-09** | Log outbound admin retry 3x (backoff 200/400 ms), tidak menelan error sekali | `tests/unit/ing09-outbound-log-retry.test.ts` (2) |
| **API-04** | `AdminSession.tenant_id` + migrasi `20261113120000_api04_admin_session_tenant`; tenant sesi jadi otoritas (header klien tidak bisa memindahkan tenant). Diverifikasi di Postgres 16 ephemeral (drift *empty*) | `tests/unit/api04-admin-session-tenant.test.ts` (2) |

- **Sisa KNOWN:** `DOM-02` (file 620 baris), `ING-10` (duplikasi pipeline ingress WAHA/WABA), `C-006` (butuh log RAG runtime), `C-002` (butuh dump DB produksi).
- **Register:** **259 FIXED / 0 OPEN / 0 UNVERIFIED / 4 KNOWN / 5 DUPLICATE**.
- **Gerbang regresi W17:** 7.472 test / 7.442 lulus / 2 gagal pre-existing #287 (0 regresi vs W16). `tsc` 0; `build` 0; `verify:backlog` PASS (101 item); `security:scan` LULUS 2.350 file; migrasi API-04 diverifikasi di Postgres ephemeral (drift *empty*).

### 0.43 W16 — penutupan 5 item dashboard + Gate F4 (2026-11-13)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **S-02** | Outbox gagal pindah ke `sessionStorage` (TTL 2 jam, tanpa gambar), dibersihkan saat logout | `tests/unit/staff-dashboard-hardening.test.ts` (9) |
| **S-06** | Warm-up GPS hanya setelah consent eksplisit; cache dihapus saat stop | idem |
| **S-08** | Ambang jarak & titik klinik dari tenant (`clinicLocation`); quick reply tetap DB-driven | idem |
| **S-09** | Toast kedatangan jujur (`waResult`), input login 16px | idem |
| **Cfg-015** | Brand dashboard dari API, watermark tanpa brand hardcode, `x-tenant-id` dari user, titik klinik dari tenant-settings | idem |
| **A-013** | Komentar `phase-resolver.ts` yang kontradiktif dikoreksi (tool masking fisik) | `tests/unit/v3/tool-masking-enforce.test.ts` |

- **Reklasifikasi:** `SM-02` → KNOWN (dead code inert), `C-006` → KNOWN (butuh log RAG runtime), `C-002` → KNOWN (butuh dump DB produksi). Semua punya acceptance criteria.
- **Gate F4:** **TERPENUHI** — 0 OPEN, 0 UNVERIFIED. Register: **256 FIXED / 0 OPEN / 0 UNVERIFIED / 7 KNOWN / 5 DUPLICATE**.
- **Gerbang regresi W16:** 7.465 test / 7.435 lulus / 2 gagal pre-existing #287 (0 regresi vs W15). `tsc` 0; root build 0; dashboard build 0; `verify:backlog` PASS (98 item); `security:scan` LULUS 2.347 file.

### 0.42 W15 — penutupan Ar-003 + guard filter tenant (2026-11-13)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **Ar-003** | Jalur produksi bebas filter `tenant_id: DEFAULT_TENANT_ID` (sisa 3 baris = fallback default/seed: labels memori, konten landing default, template retensi). Handler admin/staff memakai seam tenant sesi; worker sweep memproses semua tenant. Guard baru menolak filter hardcode tambahan | `tests/unit/ar003-tenant-filter-guard.test.ts` (2) |

- **Keputusan desain:** default parameter `tenantId = DEFAULT_TENANT_ID` dipertahankan untuk single-tenant/CLI; pemanggil produksi WAJIB mengirim tenant eksplisit (dijaga guard + test per domain W1–W15).
- **Register:** **250 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 5 OPEN**.
- **Gerbang regresi W15:** 7.456 test / 7.426 lulus / 2 gagal pre-existing #287 (0 regresi vs W14). `tsc` 0; `build` 0; `verify:backlog` PASS (92 item); `security:scan` LULUS 2.345 file.

### 0.41 W14 — ekspor chat harian semua tenant (Ar-003, 2026-11-13)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **Ar-003** (sebagian) | `runDailyChatExport` memproses **semua tenant** (`getAllTenantIds`), bukan hanya `default-tenant`; kegagalan satu tenant dicatat dan tidak menghentikan tenant lain; log merangkum total percakapan/pesan | `tests/unit/cron-daily-chat-export-tenant.test.ts` (2) |

- **Status register:** Ar-003 tetap **OPEN** — 264 referensi default parameter masih perlu audit pemanggil per domain + keputusan fail-closed.
- **Register:** **249 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 6 OPEN** (tidak berubah).
- **Gerbang regresi W14:** 7.454 test / 7.424 lulus / 2 gagal pre-existing #287 (0 regresi vs W12; `--minWorkers 1 --maxWorkers 2`). Catatan: run pertama mencatat flake `broadcast-queue` (spy 2x) yang lulus saat dijalankan sendiri dan lulus pada rerun penuh. `tsc` 0 error; `build` 0; `verify:backlog` PASS; `security:scan` LULUS 2.343 file.

### 0.40 W13 — token admin keluar dari localStorage (S-011 selesai, 2026-11-13)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **S-011** | Login admin tidak lagi menulis token ke localStorage; sesi hanya cookie `HttpOnly admin_session`. `restoreSessionToken` memulihkan dari cookie (token body hanya untuk perangkat legacy). Umur cookie mengikuti `ADMIN_SESSION_TTL_HOURS` (default 7 hari). CSP `/admin/*` + Caddy: tanpa `unsafe-eval`, `object-src 'none'`, `base-uri`, `form-action` | `tests/unit/admin-session-hardening.test.ts` (7) + auth signal/manifest tests |

- **Verifikasi:** `npm run build` dashboard (tsc+vite) sukses; auth tests 30 lulus.
- **Register:** **249 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 6 OPEN**.

### 0.39 W12 — LandingPage.slug per tenant & resolusi landing tenant-aware (Ar-004 selesai, 2026-11-13)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **Ar-004** | `LandingPage.slug` → `@@unique([tenant_id, slug])`; resolusi landing memakai `?tenant=` (terverifikasi DB) atau host `Tenant.landing_domain`; tanpa hint tetap slug-global. Migrasi `20261113100000_...` diverifikasi di Postgres 16 ephemeral (deploy sukses, drift *empty*, slug sama dua tenant diterima, duplikat satu tenant ditolak) | `tests/unit/landing-tenant-resolution.test.ts` (4) + `tests/unit/ar004-tenant-unique-schema.test.ts` (4) |

- **Status register:** Ar-004 **FIXED** (kode + migrasi tervalidasi). **Deploy:** jalankan `prisma migrate deploy` SEBELUM kode di staging/produksi pengguna.
- **Register:** **248 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 7 OPEN**.
- **Gerbang regresi W12/W13:** 7.452 test / 7.422 lulus / 2 gagal pre-existing #287 (0 regresi vs W10, `--minWorkers 1 --maxWorkers 2`); `tsc` 0 error; root+dashboard build exit 0; `verify:backlog` PASS (91 item); `security:scan` LULUS 2.340 file.

### 0.38 W11 — brand dashboard data-driven & tenant header (Cfg-015 sebagian, 2026-11-13)

- **Cfg-015 (sebagian):** `BrandContext` baru mengambil `businessName`/`botDisplayName` dari `GET /api/admin/settings` (sumber `Tenant.settings.brand`/kolom tenant) dengan fallback netral "Klinik". Layout (sidebar + header mobile), quick-chat template, MetaCapiQueue (origin), nama file ekspor, label/placeholder pengaturan tidak lagi memakai "Kala". `x-tenant-id` di `api.ts` diambil dari `last_auth_user` (user terautentikasi), bukan hardcode `default-tenant`.
- **Verifikasi:** `npm run build` di `packages/admin-dashboard` (tsc + vite) **sukses**.
- **Status register:** Cfg-015 tetap **OPEN** — sisa teks di `StaffToday.tsx` (sedang diedit pengguna), watermark foto, nama klinik di `slotRecommendations`/`CreateReservationModal`, dan koordinat/slot yang butuh endpoint khusus.
- **Register:** **247 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 8 OPEN** (tidak berubah).

### 0.37 W10 — landing admin tenant-aware, jujur, & pixel data-driven (2026-11-13)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **M-03** | Landing create/list/duplikat slug memakai tenant peminta (`resolveSessionTenantId`); meta-attribution tetap `resolveTenant(request)` | `tests/unit/landing-admin-tenant-honesty.test.ts` (8) |
| **M-04** | create/update/delete/reset landing → **503 `DATABASE_UNAVAILABLE`** saat DB gagal di produksi (fallback memori hanya non-produksi) | idem |
| **Cfg-012** | Sisa `DEFAULT_TENANT_ID` di `admin/landings` ditutup (tenant peminta); dua ref tersisa hanya pixel env default-tenant | idem |
| **M-06** | `/cta` memakai `request.ip` (trustProxy), bukan XFF kiri yang bisa dipalsukan | `tests/unit/landing-cta-ip-spoof.test.ts` (1) |
| **M-05** | `resolveLandingContent` tidak fallback ke tenant pertama; slug tak dikenal → `null`/404 | `tests/unit/landing-content-unknown-slug.test.ts` (2) |
| **M-02** | `external-tracker.js` tanpa pixel hardcode: `/assets/external-tracker.js?tenant=` mengisi `__DEFAULT_PIXEL_ID__` dari DB (validasi digit); dashboard menampilkan "Belum diset" | `tests/unit/external-tracker-pixel.test.ts` (5) |
| **M-10** | Dokumentasi CAPI/landing direkonsiliasi (placeholder, tracker bukan read-only, wajib `?pixel=`/`?tenant=`, sisa M-02 dicatat) | `tests/unit/capi-docs-accuracy.test.ts` (3) |
| **Ar-005** | Sisa route admin false-success ditutup (landing + route W6C) | `tests/unit/admin-db-degradation-honesty.test.ts` + landing tests |

- **Register:** **247 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 8 OPEN**.

### 0.36 W9 — tenant seam untuk worker broadcast & debug (Ar-003, 2026-11-13)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **Ar-003** (sebagian) | `enqueuePendingFollowUps` memproses **semua tenant** (`getAllTenantIds`) dan `updateMany` ikut difilter `tenant_id`; `collectSystemInfo`, `collectRecentMessages`, `collectConversationTrace` menerima `tenantId` dan route debug meneruskannya. Inventaris 497 referensi + klasifikasi ditulis di `docs/audit/2026-11-13/AR003_TENANT_INVENTORY.md` | `tests/unit/ar003-tenant-worker-sweeps.test.ts` (5) + `tests/integration/broadcast-queue.test.ts` |

- **Status register:** Ar-003 tetap **OPEN** — sisa default parameter service (264 ref), landing (area pengguna), dan kendala skema.
- **Register:** **239 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 16 OPEN** (tidak berubah).
- **Gerbang regresi W9:** 7.367 test / 7.337 lulus / 2 gagal pre-existing #287 (0 regresi vs W7); `tsc` 0 error; `build` exit 0; `verify:backlog` PASS (81 item); `security:scan` LULUS 2.320 file.

### 0.35 W8 — verifikasi migrasi Ar-004 di Postgres ephemeral (2026-11-13)

- **Lingkungan:** container `postgres:16-alpine` sekali-pakai (port 55432) + bootstrap schema lama → 109 migrasi lama ditandai `--applied` → `prisma migrate deploy` migrasi Ar-004.
- **Hasil:**
  - `migrate deploy` → `All migrations have been successfully applied.`
  - Drift `migrate diff --from-url` → `-- This is an empty migration.`
  - Staf: nomor sama dua tenant **diterima**; tenant sama **ditolak** `staff_tenant_id_phone_key`.
  - AdClick: `trackingCode` sama dua tenant **diterima**; tenant sama **ditolak** `ad_clicks_tenant_id_trackingCode_key`.
  - Prisma `upsert({ where: { tenant_id_phone } })` 2× → 1 baris, nama ter-update (runtime compound OK).
- **Temuan baru:** fresh DB tidak bisa replay seluruh migrasi (`20260801000000_add_failed_followup_status`: `type "FollowUpStatus" does not exist`) — enum tidak pernah dibuat oleh migrasi; dicatat di KNOWN_ISSUES.
- Container & volume sementara sudah dihapus. **Migrasi belum diterapkan** ke staging/produksi pengguna.
- **Register tidak berubah:** **239 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 16 OPEN** (Ar-004 tetap OPEN untuk LandingPage.slug + deploy staging/produksi).

### 0.34 W7 — implementasi Ar-004 untuk Staff & AdClick (2026-11-12, migrasi BELUM diterapkan)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **Ar-004** (sebagian) | Schema: `Staff.phone` → `@@unique([tenant_id, phone])`, `AdClick.trackingCode` → `@@unique([tenant_id, trackingCode])`; migration SQL otoritatif dari `prisma migrate diff` offline; `backup.service.ts` upsert memakai `tenant_id_phone`. `LandingPage.slug` sengaja tetap global (resolusi slug belum per-host, area landing pengguna) | `tests/unit/ar004-tenant-unique-schema.test.ts` (4) + `tests/unit/staff-auth-and-reservation.test.ts` (28) + `tests/unit/backup*.test.ts` (19) |

- **Status register:** Ar-004 tetap **OPEN** — migrasi belum diterapkan ke DB (tidak ada staging di environment ini) dan `LandingPage.slug` ditunda.
- **Urutan deploy wajib:** `prisma migrate deploy` SEBELUM kode baru (upsert Prisma butuh index komposit).
- **Register:** **239 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 16 OPEN** (tidak berubah).
- **Gerbang regresi W7:** 7.358 test / 7.328 lulus / 2 gagal pre-existing #287 (0 regresi vs W6H); `tsc` 0 error; `prisma generate` penuh berhasil (dev server dihentikan sementara karena EPERM engine DLL); `build` exit 0; `verify:backlog` PASS (81 item); `security:scan` LULUS 2.243 file.

### 0.33 W6I — rencana migrasi Ar-004 (2026-11-12, BELUM DIEKSEKUSI)

- **Ar-004** tetap **OPEN**. Rencana eksekusi lengkap ditulis di `docs/plans/MIGRATION_PLAN_AR004_2026-11-12.md`: target schema (`@@unique([tenant_id, phone])`, `@@unique([tenant_id, trackingCode])`, `@@unique([tenant_id, slug])`), SQL migrasi + rollback, daftar perubahan kode wajib (lookup slug/phone per tenant), urutan M0→M1 staging→M2 produksi, drift check `--from-url`, dan Confirmation Gate.
- **Tidak ada perubahan DB maupun kode** pada wave ini. Register tidak berubah: **239 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 16 OPEN**.

### 0.32 W6H — store trip lintas proses untuk auto-close (S-03, 2026-11-12)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **S-03** | `recordTripPing` di-write-through ke KV bersama (`distributedKv`, TTL 2 jam) + index tenant; `listActiveTripsAcrossProcesses()` menggabungkan memori lokal + KV; cron `runTripAutoCloseSweep` memakai metode itu sehingga sweep di `worker` melihat ping dari `app` | `tests/unit/staff-trip-tracking-persisted.test.ts` (8) |

- **Kontrak baru:** `listActiveTripsAcrossProcesses(tenantId?)`, `clearAllPersisted()`; key `staff:trip:<tenant>:<reservation>`, index `staff:trip:index:<tenant>`, `staff:trip:tenants`.
- **Register:** **239 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 16 OPEN**.
- **Gerbang regresi W6H:** 7.354 test / 7.324 lulus / 2 gagal pre-existing #287 (0 regresi vs W6G); `tsc` 0 error; `build` exit 0; `verify:backlog` PASS (81 item); `security:scan` LULUS 2.240 file. Catatan: run pertama sempat mencatat timeout `production_edge_cases` (flaky di bawah beban paralel); file itu lulus saat dijalankan sendiri (4,7 dtk) dan lulus pada run ulang penuh — bukan regresi.

### 0.31 W6G — secret webhook WAHA per tenant (S-015, 2026-11-12)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **S-015** | Secret webhook diturunkan per tenant (`HMAC-SHA256(WAHA_WEBHOOK_SECRET, waha-webhook:<tenantId>)`); config session WAHA memasang `X-Webhook-Secret` turunan + `X-Tenant-Id`. Route `/webhook` menerima turunan tenant (atau global lama untuk session yang belum di-sync) dan menolak secret tenant lain | `tests/unit/waha-webhook-tenant-secret.test.ts` (12) |

- **Kontrak baru:** `deriveTenantWebhookSecret`, `buildWahaWebhookHeaders`, `resolveExpectedWebhookSecrets` (`src/config/waha-webhook-auth.ts`).
- **Register:** **238 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 17 OPEN**.
- **Gerbang regresi W6G:** 7.346 test / 7.316 lulus / 2 gagal pre-existing #287 (0 regresi vs W6F); `tsc` 0 error; `build` exit 0; `verify:backlog` PASS (80 item); `security:scan` LULUS 2.237 file.

### 0.30 W6F — hardening sesi admin & CSP dashboard (S-011, 2026-11-12)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **S-011** (sebagian) | TTL sesi default **7 hari** (bisa diatur `ADMIN_SESSION_TTL_HOURS`, batas 1–720 jam; nilai salah → default). `/admin/*` selalu membawa CSP + `X-Content-Type-Options`/`Referrer-Policy`/`X-Frame-Options`/`Permissions-Policy` dari Fastify; CSP Caddy dipertajam: `unsafe-eval` & `https:` bebas dihapus, `object-src 'none'`, `base-uri`, `form-action` ditambah | `tests/unit/admin-session-hardening.test.ts` (7) |

- **Status register:** S-011 tetap **OPEN** — token masih disimpan di `localStorage` pada `packages/admin-dashboard/src/contexts/AuthContext.tsx` (area dashboard pengguna, belum diubah).
- **Register:** **237 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 18 OPEN** (tidak berubah).
- **Gerbang regresi W6F:** 7.334 test / 7.304 lulus / 2 gagal pre-existing #287 (0 regresi vs W6E); `tsc` 0 error; `build` exit 0; `verify:backlog` PASS (79 item); `security:scan` LULUS 2.235 file.

### 0.29 W6E — rekonsiliasi klaim dokumen & audit Fase 10 (Cfg-017, 2026-11-12)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **Cfg-017** | RBAC dinyatakan **hibrida** (`role_api_scopes` + `superAdminOnlyPrefixes` hardcode), laporan Fase 10 diberi §4 catatan rekonsiliasi (Cfg-011 endpoint ada tapi UI belum; Cfg-015 masih OPEN), artefak `fase-10.json` diregenerasi dari repo (10 file / 74 test) | `tests/unit/fase10-audit-artifact.test.ts` (4) |

- **Kontrak baru:** gerbang `tests/unit/fase10-audit-artifact.test.ts` mengunci jumlah/asal path artefak, klaim hibrida, dan keberadaan catatan rekonsiliasi.
- **Register:** **237 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 18 OPEN**.
- **Gerbang regresi W6E:** 7.327 test / 7.297 lulus / 2 gagal pre-existing #287 (0 regresi vs W6D); `tsc` 0 error; `build` exit 0; `verify:backlog` PASS (79 item); `security:scan` LULUS 2.233 file.

### 0.28 W6D — artefak audit Fase 5 diregenerasi (S-10, 2026-11-12)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **S-10** | `docs/audit/2026-11-02/fase-05.json` diregenerasi dari suite yang masih ada (15 file / 150 test, 100% lulus); laporan dikoreksi — klaim lama "7 suites/16 test" dicabut karena 6 dari 7 path-nya sudah tidak ada di repo | `tests/unit/fase05-audit-artifact.test.ts` (3) |

- **Kontrak baru:** gerbang `tests/unit/fase05-audit-artifact.test.ts` (jumlah file ≥7, `numTotalTests=150`, semua path artefak dari repo ini, laporan bebas klaim lama).
- **Register:** **236 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 19 OPEN**.
- **Gerbang regresi W6D:** 7.323 test / 7.293 lulus / 2 gagal pre-existing #287 (0 regresi vs W6C); `tsc` 0 error; `build` exit 0; `verify:backlog` PASS (78 item); `security:scan` LULUS 2.231 file.

### 0.27 W6C — kejujuran degradasi DB route admin (Ar-005, 2026-11-12)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **Ar-005** (sisa non-landing) | 7 route admin berhenti mengembalikan `200 + data kosong` saat DB gagal: `settings/notifications/logs`, `medical-faq-staging`, `general-faq-staging`, `debug/meta-manual-history`, `ai-evaluations`, `ai-audit-summary`, `customers/flagged` → **503 `DATABASE_UNAVAILABLE`** di produksi; 200 + `degraded:true` hanya di non-produksi | `tests/unit/admin-db-degradation-honesty.test.ts` (14) |

- **Status register:** Ar-005 tetap **OPEN** — sisa route `landings.subroute.ts` berada di area landing pengguna (tercatat sebagai M-03/M-04).
- **Register:** **235 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 20 OPEN** (tidak berubah).
- **Gerbang regresi W6C:** 7.320 test / 7.290 lulus / 2 gagal pre-existing #287 (0 regresi vs W6B); `tsc` 0 error; `build` exit 0; `verify:backlog` PASS (77 item); `security:scan` LULUS 2.229 file.

### 0.26 W6B — antrean retry Google Contacts (I-007, 2026-11-12)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **I-007** | `googleContactsOutbox` (KV bersama, TTL 7 hari, satu item per customer): kegagalan sync otomatis diantrekan, backoff 1m→5m→30m→2j→6j→12j, maksimal 6 percobaan lalu dibuang + log; cron 5 menit `drainAll()`; `syncCustomer` lookup `findFirst({ id, tenant_id })`; status integrasi menampilkan `outboxPending` | `tests/unit/google-contacts-outbox.test.ts` (13) + `tests/unit/google-contacts.test.ts` (32) |

- **Kontrak baru:** `googleContactsOutbox.enqueue/list/drain/drainAll/pendingCount/clear`; `syncCustomer(..., { fromOutbox })`; `GoogleIntegrationStatus.outboxPending`.
- **Register:** **235 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 20 OPEN**.
- **Gerbang regresi W6B:** 7.306 test / 7.276 lulus / 2 gagal pre-existing #287 (0 regresi vs W6A); `tsc` 0 error; `build` exit 0; `verify:backlog` PASS (77 item); `security:scan` LULUS 2.226 file.

### 0.25 W6A — Google Calendar tenant-aware & idempoten (I-006, 2026-11-12)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **I-006** | Kalender tujuan per tenant (`Tenant.settings.googleCalendar`), ID event deterministik `resv`+hex dari `reservation.id` (409 duplicate = sukses idempoten), durasi dari `Reservation.duration_minutes` (default 60 bila tak sah), brand via `getBrandIdentityAsync(tenantId)`; 9 call-site meneruskan `tenantId` | `tests/unit/google-calendar-tenant.test.ts` (17) + `tests/integration/google-calendar.test.ts` (3) |

- **Kontrak baru:** `getGoogleCalendarConfig(tenantId)`, `resolveEventDurationMinutes`, `buildCalendarEventId`; `createEvent/updateEvent/deleteEvent(..., tenantId?)`.
- **Register:** **234 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 21 OPEN**.
- **Gerbang regresi W6A:** 7.285 test / 7.255 lulus / 2 gagal pre-existing #287 (0 regresi vs W5E); `tsc` 0 error; `build` exit 0; `verify:backlog` PASS (76 item); `security:scan` LULUS 2.223 file.

### 0.24 W5E — endpoint setelan tenant (Cfg-011, 2026-11-12)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **Cfg-011** | `GET|PATCH /api/admin/tenant-settings` (Super Admin only) untuk `clinicLocation`, `operationalHours`, `staffNotification`, `deliverySettings.estimateTtlDays`, `copilot.styleTone`, `brand`. Validasi ketat per field (`parseTenantSettingsPatch`), menolak kunci tak dikenal, patch hanya menyentuh section terkirim (aiConfig/integrationGuards utuh), `styleTone:null` menghapus override, cache reader dibersihkan setelah simpan | `tests/unit/tenant-settings-endpoint.test.ts` (19) |

- **Kontrak baru:** `parseTenantSettingsPatch`, `applyTenantSettingsPatch`, `getTenantSettingsView`; route `settings-tenant.subroute.ts`; prefix RBAC `/api/admin/tenant-settings`.
- **Register:** **233 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 22 OPEN**.
- **Gerbang regresi W5E:** 7.268 test / 7.238 lulus / 2 gagal pre-existing #287 (0 regresi vs W5D); `tsc` 0 error; `build` exit 0; `verify:backlog` PASS (75 item); `security:scan` LULUS 2.219 file.

### 0.23 W5D — kuota/circuit/kunci API per tenant (2026-11-12)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **I-011** | Modul baru `src/services/integration-guard.service.ts`: kuota harian WIB di KV bersama (`distributedKv.incr`, kunci `quota:<layanan>:<tenant>:<YYYY-MM-DD>`), circuit breaker per tenant, dan kunci API per tenant dari `Tenant.settings.integrationGuards` (cache 5 menit). ORS, Google Distance Matrix, serta geocoding (text/reverse/kandidat) memakai `guard.run` + `resolveApiKey`; saat kuota habis/circuit OPEN klien tidak memanggil axios. DB offline → perilaku lama (env, tanpa batas) agar layanan tidak mati | `tests/unit/integration-guard-tenant.test.ts` (13) |

- **Kontrak baru:** `IntegrationGuard.run(tenantId, service, fn)`, `resolveApiKey(tenantId, service, envKey)`, `consume`, `getCircuitState`, `reset`; config `Tenant.settings.integrationGuards.{ors|googleDistanceMatrix|googleGeocode}`.
- **Register:** **232 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 23 OPEN**.
- **Gerbang regresi W5D:** 7.249 test / 7.219 lulus / 2 gagal pre-existing #287 (0 regresi vs W5C); `tsc` 0 error; `build` exit 0; `verify:backlog` PASS (74 item); `security:scan` LULUS 2.216 file.

### 0.22 W5C — humanizer bubble struktural (2026-11-12)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **W-010** | `splitIntoBubbles` mendeteksi form dari struktur baris (`Label : nilai`, ≥3 field) + judul pendek; `concludingKeywords` & label lama "Alamat & Shareloc" dihapus. Pemisah tenant via `Tenant.settings.humanizerBubble.extraSeparators` (modul `src/config/humanizer-bubble.config.ts`) | `tests/unit/typing-bubble-structural.test.ts` (17) + `tests/unit/typing.test.ts` (12) |

- **Register:** **231 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 24 OPEN**.
- **Gerbang regresi W5C:** 7.236 test / 7.206 lulus / 2 gagal pre-existing #287 (0 regresi vs W5B); `tsc` 0 error; `build` exit 0; `verify:backlog` PASS (73 item); `security:scan` LULUS 2.213 file.

### 0.21 W5B — AbortSignal end-to-end (2026-11-12)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **A-011** | `runToolWithAbort` meng-abort `AbortSignal` saat timeout (bukan `Promise.race` buta); `ToolExecutionContext.signal` → `SaveReservationInput.signal`; gerbang abort tepat sebelum `reservationCoreService.saveReservation` (=0 baris DB); `committed` membedakan "timeout sebelum tulis" vs "commit sudah terjadi" (jendela settle 1,5 dtk) | `tests/unit/tool-abort-signal.test.ts` (10) |

- **Kontrak baru:** `runToolWithAbort(runner, timeoutMs, toolName, { awaitSettleMs })`; `SaveReservationOutput.committed`.
- **Register:** **230 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 25 OPEN**.
- **Gerbang regresi W5B:** 7.219 test / 7.189 lulus / 2 gagal pre-existing #287 (0 regresi vs W5A); `tsc` 0 error; `build` exit 0; `verify:backlog` PASS (72 item); `security:scan` LULUS 2.211 file.

### 0.20 W5A — koordinasi lintas proses (2026-11-11)

| ID | Perbaikan | Bukti test |
|---|---|---|
| **W-006** | Buffer burst + lock `SET NX PX` di KV bersama; hanya pemegang lock enqueue; urutan pesan pakai counter `INCR`; Redis mati → fallback buffer memori | `tests/unit/burst-coalesce-distributed.test.ts` (5) |
| **UTL-15** | `ClientIdempotencyStore.getAsync/setAsync` menyebar hasil kirim antar proses (TTL sama, cache lokal tetap L1) | `tests/unit/client-idempotency-distributed.test.ts` (6) |
| **CFG-17** | `saveConfigsToDb` dibungkus lease `lock:ai-config-save:<tenant>` (wait 10s, fail-open) | `tests/unit/ai-config-save-lock.test.ts` (4) |

- **Modul baru:** `src/utils/distributed-kv.ts` (`get/set/setNx/sadd/smembers/rename/mget/incr/withLock`) di atas `ioredis` yang sudah ada, fallback memori otomatis.
- **Env baru:** `DISTRIBUTED_KV_DISABLED=true` (paksa memori/rollback), `BURST_COALESCE_NAMESPACE` (isolasi key bila satu Redis dipakai beberapa lingkungan), `REDIS_URL` (sudah ada).
- **Register:** **229 FIXED / 4 UNVERIFIED / 5 DUPLICATE / 4 KNOWN / 26 OPEN**.
- **Gerbang regresi W5A:** 7.209 test / 7.179 lulus / 2 gagal pre-existing #287 (0 regresi vs 6C); `tsc` 0 error; `build` exit 0; `verify:backlog` PASS (71 item); `security:scan` LULUS 2.205 file.

### 0.17 Gerbang Regresi Fase 1

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
