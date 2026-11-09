# Rencana Perbaikan Bertahap — Hasil Audit Deep-Dive 2026-11-07

- **Status:** PARTIALLY IMPLEMENTED (Fase 1–8 & 10 selesai di `f3c6a2c4`; Fase 9 (data-driven & God Object) masih pending; gate S0 rekonsiliasi full suite terverifikasi pada `baseline-f3c6a2c4.json`).
- **Dasar:** `docs/audit/2026-11-07/RINGKASAN_AKHIR_AUDIT_MODUL_1-11.md` (122 temuan: 22 kritis, 44 tinggi, 46 sedang, 10 rendah).
- **Cakupan perbaikan:** Modul 1, 2, 3A/3B, 5, 7, 8, 9, 10, 11. Modul 4 & 6 tidak diubah dalam plan ini kecuali titik sambung yang disebut eksplisit.
- **Prinsip wajib:** fondasional (DB/skema, state machine, tool contract, RAG/retrieval), tenant-aware, tanpa dependency runtime baru, tanpa solusi "DILARANG..." di prompt sebagai pengganti gerbang kode, TDD (test merah dulu), dan regression gate per fase.

---

## 0. Keputusan yang Harus Diambil Sebelum Eksekusi (Confirmation Gate)

| ID | Pertanyaan | Rekomendasi | Dampak bila salah |
|---|---|---|---|
| D1 | Kunci enkripsi backup | Buat `BACKUP_ENCRYPTION_KEY` baru (64 hex) di produksi; backup **gagal** bila key tidak ada | Backup plaintext tetap bocor; restore tidak bisa dibuka |
| D2 | Migrasi RBAC | Seed `role_api_scopes` eksplisit untuk semua role sistem; role tanpa scope = **deny**; super-admin bypass eksplisit | Admin CS kehilangan akses atau justru tetap fail-open |
| D3 | `conversation-behavior` | Jika tidak ada konsumen UI → hapus/501; jika dipakai → simpan ke `Tenant.settings` (tenant-aware) | Fitur palsu tetap ada atau UI rusak |
| D4 | Endpoint `whatsapp-provider/*` | Batasi ke **super-admin** + audit log; staf biasa tidak boleh QR/session takeover | Pengambilalihan sesi WhatsApp |
| D5 | Kode tracking iklan | Ganti ke kode ≥12 karakter acak + expiry 7 hari + lookup DB; kode lama diberi masa transisi | Atribusi palsu / kehilangan data kampanye lama |
| D6 | Migrasi katalog/SOP hardcode | Onboarding tenant eksplisit (dry-run + persetujuan), bukan auto-seed diam-diam | Data tenant lain tercampur atau katalog hilang |

**Keputusan turunan yang sudah pasti dari audit sebelumnya:** `completed` tidak boleh dibatalkan lewat soft-cancel (D1 reservasi #314); `pending` menempati slot; `paused` adalah status resmi. Plan ini tidak membuka ulang keputusan tersebut.

---

## 1. Peta Fase & Dependensi

| Fase | Fokus | Temuan utama | Blast radius | Prasyarat | Estimasi |
|---|---|---|---|---|---|
| 0 | Baseline & test merah | semua P0 | rendah (test only) | — | 1–2 hari |
| 1 | Perimeter kredensial & akses | S-001, S-004, S-005, S-013, S-002 | tinggi (auth, dokumen, env) | Fase 0 | 2–3 hari |
| 2 | RBAC & isolasi tenant | S-003, Cfg-002, Cfg-012, Cfg-013, W-002 | **tinggi** (semua route admin) | Fase 1 | 4–6 hari |
| 3 | Backup & recovery | K-003, I-001, I-002 | sedang (cron + Drive) | Fase 1 | 2–3 hari |
| 4 | Keselamatan klinis & kontrak AI | A-001–A-005, C-005, C-006, C-004, C-010 | **tinggi** (pipeline V3) | Fase 2 | 5–7 hari |
| 5 | Durabilitas ingress, outbox, cron | W-001, W-004, W-005, K-001, K-002, K-004, K-005, I-003–I-005 | tinggi (webhook + worker) | Fase 2, 3 | 5–7 hari |
| 6 | Ghost config & hardcode | Cfg-001, Cfg-003, Cfg-005, Cfg-012 | sedang (settings + UI) | Fase 2 | 3–5 hari |
| 7 | Staf & marketing | S-01–S-06, M-01–M-09 | sedang (PWA + tracking) | Fase 1 | 4–6 hari |
| 8 | RAG/prompt & log | C-001, C-002, C-009, C-011 | sedang (retrieval + log) | Fase 4 | 3–5 hari |
| 9 | Data-driven & arsitektur | Cfg-005, T-12, God Object | tinggi (katalog, UI) | Fase 6, 8 | 2–4 minggu |
| 10 | Verifikasi & penutupan | semua | — | semua | 2–3 hari |

**Aturan gate:** setiap fase ditutup `npm run build` + `npm run typecheck` + test terkait hijau + full suite dengan **baseline-diff**. Klaim "pre-existing" wajib dibuktikan dengan revert-and-rerun.

---

## 2. Protokol Keselamatan & Gate Regresi

### 2.1 Mode kerja
- **M1 — statis (default):** baca kode, grep, unit test offline.
- **M2 — bangku uji:** `WAHA_MOCK=true`, DB uji/offline, chat sandbox; setiap customer uji wajib `is_sandbox_test=true`.
- **M3 — server live (read-only):** hanya `git rev-parse`, `docker ps/logs`, `SELECT`; dilarang restart/deploy/menulis DB.

### 2.2 Perintah gate
```powershell
npm run build
npm run typecheck
npx vitest run tests/unit/<test-terkait>.test.ts
npm run security:scan
# full suite + baseline-diff (wajib simpan artefak JSON sebelum/sesudah)
npx vitest run --reporter=json --outputFile=docs/audit/2026-11-07/baseline-before.json
npx vitest run --reporter=json --outputFile=docs/audit/2026-11-07/after-fase-X.json
node scripts/audit-baseline-diff.mjs <baseline-before.json> <after-fase-X.json>
```

### 2.3 Aturan keras
1. Dilarang `prisma migrate dev` di produksi; gunakan `prisma migrate deploy` setelah review.
2. Dilarang `prisma generate --no-engine`.
3. Dilarang menyentuh label WAHA (`addLabel`/`removeLabel`); label hanya di DB internal.
4. Dilarang menambah dependency runtime baru.
5. Setiap perubahan perilaku AI wajib punya test adversarial multi-parafrase, bukan test kalimat persis.
6. Rollback per fase: revert commit fase + kembalikan feature flag ke default lama.

---

## 3. FASE 0 — Baseline & Test Merah (TDD)

**Tujuan:** membuktikan setiap bug P0 dengan test yang gagal sebelum kode diubah; merekam baseline.

| ID | File | Tindakan | Acceptance |
|---|---|---|---|
| 0.1 | `tests/unit/security-secret-scan-all.test.ts` (baru) | Fixture key generik (`ADMIN_API_KEY=...`, hex 32) harus terdeteksi mode `--all` | Test gagal pada scanner saat ini |
| 0.2 | `tests/unit/rbac-scope-fail-closed.test.ts` (baru) | Role tanpa baris `role_api_scopes` → 403; role dengan scope → 200 | Gagal pada kode saat ini |
| 0.3 | `tests/unit/settings-tenant-scope.test.ts` (baru) | Tenant B tidak boleh membaca/menulis config tenant A | Gagal pada kode saat ini |
| 0.4 | `tests/unit/backup-integrity.test.ts` (baru) | Dump parsial/error → backup gagal; file terenkripsi tidak terbaca tanpa key | Gagal pada kode saat ini |
| 0.5 | `tests/unit/vaccine-screening-conflict.test.ts` (baru) | "baru vaksin tadi pagi tapi tidak demam" → SCREEN; "vaksin 4 hari lalu masih demam" → SCREEN; "demam" tanpa angka → SCREEN | Gagal pada kode saat ini |
| 0.6 | `tests/unit/tool-execution-authz.test.ts` (baru) | DSML salvage tidak boleh mengeksekusi tool yang tidak ada di `allowedToolNames` | Gagal pada kode saat ini |
| 0.7 | `tests/unit/commitment-user-only.test.ts` (baru) | Argumen tool LLM tidak boleh mengisi `bookingCommitConfirmed`; hanya pesan `role==='user'` | Gagal pada kode saat ini |
| 0.8 | `tests/unit/treatment-identity-contract.test.ts` (baru) | `save_reservation` di luar `verifiedTreatmentNames` → `success:false` | Gagal pada kode saat ini |
| 0.9 | `tests/unit/rate-limit-bucket.test.ts` (baru) | `x-api-key` palsu tidak membuat bucket baru; XFF spoof tidak mengubah IP | Gagal pada kode saat ini |
| 0.10 | `tests/unit/settings-conversation-behavior.test.ts` (baru) | PATCH harus mempersistensi atau mengembalikan 501 — bukan 200 palsu | Gagal pada kode saat ini |
| 0.11 | terminal | Rekam baseline full suite ke `docs/audit/2026-11-07/baseline-before.json` | Artefak ada; daftar gagal pre-existing tercatat |

**Gate Fase 0:** semua test baru **merah** (atau terverifikasi gagal pada kode lama); baseline tersimpan. Tidak ada perubahan kode produksi.

---

## 4. FASE 1 — Perimeter Kredensial & Akses (P0)

**Temuan:** S-001, S-004, S-005, S-013, S-002.
**Blast radius:** tinggi — menyentuh auth, dokumen, env, dan rate limit.

### 1.1 Amankan kunci enkripsi sebelum rotasi (URUTAN WAJIB)
`src/utils/encryption.ts:6-21` memakai `WABA_TOKEN_ENCRYPTION_KEY`, dengan fallback turunan `ADMIN_API_KEY`. Jika `ADMIN_API_KEY` dirotasi lebih dulu, seluruh secret terenkripsi (token WABA/CAPI/Telegram) tidak bisa didekripsi.

| ID | File | Tindakan | Acceptance |
|---|---|---|---|
| 1.1.1 | `.env` produksi (bukan repo) | Set `WABA_TOKEN_ENCRYPTION_KEY` = 64 hex baru | Boot sukses; decrypt secret lama masih bekerja |
| 1.1.2 | `scripts/reencrypt-tenant-secrets.ts` (baru) | Baca dengan key lama/fallback, tulis ulang dengan key baru; dry-run default | Dry-run melaporkan 0 error; apply idempoten |
| 1.1.3 | `src/utils/encryption.ts` | Hapus fallback `ADMIN_API_KEY` setelah migrasi; wajib key eksplisit di produksi | Test: tanpa key → throw; dengan key → decrypt |

### 1.2 Redaksi & rotasi kredensial
| ID | File | Tindakan | Acceptance |
|---|---|---|---|
| 1.2.1 | `GUIDE_OPERASIONAL.md:71` | Ganti nilai `admin_prod_key_123` dengan `<ADMIN_API_KEY_DARI_ENV>` | `git grep "admin_prod_key_123"` = 0 |
| 1.2.2 | `docs/plans/SECRET_ROTATION_PLAN.md:54-56` | Redaksi nilai lama; simpan hanya sidik jari (8 karakter hash) | Tidak ada nilai rahasia utuh |
| 1.2.3 | Server produksi | Rotasi `ADMIN_API_KEY` + `WAHA_API_KEY`; invalidasi `admin_sessions` | Login lama 401; login baru sukses |

### 1.3 Scanner rahasia menyeluruh
`scripts/scan-secrets.ts:128-155` hanya memindai `git status` (file berubah), bukan seluruh tracked files; tidak ada rule key generik.

| ID | File | Tindakan | Acceptance |
|---|---|---|---|
| 1.3.1 | `scripts/scan-secrets.ts` | Tambah mode `--all` (`git ls-files`), rule generik `(API_KEY|SECRET|TOKEN|PASSWORD)\s*=\s*["']?[A-Za-z0-9_\-]{12,}`, allowlist placeholder | `npm run security:scan -- --all` menemukan fixture; repo bersih |
| 1.3.2 | `package.json` | `security:scan` default `--all`; tambah `security:scan:staged` untuk pre-commit | Dua mode berjalan |
| 1.3.3 | CI/pre-commit hook | Jalankan scanner pada staged + full | Commit dengan key generik ditolak |

### 1.4 Trust proxy & rate limit
`src/app.ts:71` `trustProxy: true`; `src/app.ts:159-161` memakai `x-api-key` mentah sebagai bucket.

| ID | File | Tindakan | Acceptance |
|---|---|---|---|
| 1.4.1 | `src/app.ts:71` | Ganti ke `trustProxy: <CIDR loopback/reverse-proxy>` dari env `TRUST_PROXY_CIDRS` (default `127.0.0.1/8,::1/128`) | XFF dari IP non-proxy diabaikan |
| 1.4.2 | `src/app.ts:151-164` | Validasi `x-api-key` terhadap hash key yang sah **sebelum** dipakai sebagai bucket; key tidak valid → bucket IP | Test: key palsu tetap bucket IP |
| 1.4.3 | `src/app.ts:143-150` | Ganti `url.includes('/events')` menjadi path exact/prefix yang di-parse `URL` | `/foo/events` tidak lolos allowList |
| 1.4.4 | auth login routes | Lockout per akun (5 gagal / 15 menit) di samping IP throttle | Test lockout; akun valid tidak terkunci oleh IP lain |

### 1.5 Endpoint WhatsApp provider
| ID | File | Tindakan | Acceptance |
|---|---|---|---|
| 1.5.1 | `src/routes/admin/*whatsapp-provider*` (verifikasi path saat eksekusi) | Guard super-admin eksplisit + audit log; staf biasa 403 | Test role `admin_cs` → 403; super-admin → 200 |
| 1.5.2 | route registry | Daftarkan endpoint di matriks RBAC allow-list | Tidak ada route tanpa scope |

**Gate Fase 1:** `npm run build` + `typecheck` + test 1.x hijau + `security:scan --all` bersih + rekaman before/after secret rotation. Rollback: kembalikan env key lama (jika belum dihapus) dan revert commit guard.

---

## 5. FASE 2 — RBAC & Isolasi Tenant (P0)

**Temuan:** S-003, Cfg-002, Cfg-012, Cfg-013, W-002, W-003.
**Akar masalah:** `src/routes/admin.route.ts:278-290` — role tanpa baris `role_api_scopes` dianggap "legacy" dan lolos; banyak handler memakai `DEFAULT_TENANT_ID`.

### 2.1 Model otorisasi allow-list
| ID | File | Tindakan | Acceptance |
|---|---|---|---|
| 2.1.1 | `src/services/role-scope.service.ts` | Ubah `isApiScopeAllowed`: role tanpa baris = **deny**; super-admin hanya bypass eksplisit | Test 0.2 hijau |
| 2.1.2 | `src/routes/admin.route.ts:278-290` | Hapus komentar/behavior "legacy"; semua role wajib punya scope | Tidak ada jalur `allowed` tanpa baris |
| 2.1.3 | `prisma/migrations/<baru>_seed_system_role_scopes` | Seed scope minimal untuk `admin_cs`, `spv_cs`, `therapist`, `super_admin` | Migrasi idempoten; role sistem tidak kehilangan akses yang sah |
| 2.1.4 | `src/routes/admin/roles.subroute.ts` | Tolak `allowedPaths: ['*']` untuk non-super-admin; validasi path ke registry | Create/update role invalid → 400 |
| 2.1.5 | test matriks | Uji role × endpoint untuk `/services`, `/delivery-tiers`, `/knowledge`, `/few-shots`, `/capi-config`, `/whatsapp-provider` | Semua mutasi non-super-admin → 403 |

### 2.2 Tenant dari sesi, bukan body/header
| ID | File | Tindakan | Acceptance |
|---|---|---|---|
| 2.2.1 | `src/routes/admin.route.ts` | `tenantId` diambil dari sesi/API key, bukan `x-tenant-id` body | Test dua tenant: body tenant B diabaikan |
| 2.2.2 | `src/routes/admin/settings.subroute.ts` | Ganti seluruh `DEFAULT_TENANT_ID` pada handler mutasi dengan tenant sesi; baca tetap boleh default hanya untuk super-admin | `grep -n DEFAULT_TENANT_ID` di handler mutasi = 0 |
| 2.2.3 | `src/routes/admin/knowledge*` | Semua `findUnique/update/delete` memakai `tenant_id` | Test BOLA lintas tenant → 404 |
| 2.2.4 | `src/routes/admin/few-shots*`, `capi*` | Predikat tenant + audit log | Test lintas tenant |

### 2.3 Label webhook tenant-aware
| ID | File | Tindakan | Acceptance |
|---|---|---|---|
| 2.3.1 | `src/routes/webhook.route.ts:55,972,1424,1431` | Teruskan `resolvedTenantId` ke semua `setLabelFlags` | Test dua tenant: flag tenant B tidak berubah |
| 2.3.2 | `src/services/customer.service.ts:164-168` | Jadikan `tenantId` parameter **wajib** (tanpa default) | Compile error pada pemanggil yang lupa |
| 2.3.3 | `src/integrations/waha/client.ts:225` | Teruskan tenant dari sesi | Tidak ada fallback default |

**Gate Fase 2:** test RBAC + tenant isolation hijau; `grep DEFAULT_TENANT_ID` pada mutasi = 0; dua tenant teruji; build/typecheck hijau. Rollback: feature flag `RBAC_ENFORCE_ALLOWLIST=false` hanya untuk darurat, default `true`.

---

## 6. FASE 3 — Backup & Recovery (P0)

**Temuan:** K-003, I-001, I-002.
**Akar masalah:** `src/services/backup.service.ts:52-82` hanya `gzip`; fallback programmatic (`:87-148`) menelan error dan mengekspor subset tabel; `cron.service.ts:654-663` mengunggah ke Drive tanpa verifikasi/enkripsi.

| ID | File | Tindakan | Acceptance |
|---|---|---|---|
| 3.1 | `src/services/backup.service.ts:52-82` | Jika `pg_dump` gagal → **throw** (kecuali mode test eksplisit); jangan fallback diam-diam | Test 0.4: dump parsial → gagal |
| 3.2 | `src/services/backup.service.ts:87-148` | Fallback programmatic wajib mengekspor daftar tabel kanonis lengkap; error per tabel dikumpulkan dan menggagalkan backup | Row-count tabel utama > 0; tidak ada `.catch(() => [])` yang menelan |
| 3.3 | `src/services/backup.service.ts` | Tambah manifest (`schemaVersion`, row counts, SHA-256, timestamp, tenantId) | Manifest tersimpan bersama file |
| 3.4 | `src/utils/encryption.ts` + backup | Enkripsi AES-256-GCM dengan `BACKUP_ENCRYPTION_KEY` **sebelum** upload; nama file tidak membocorkan tenant | File di Drive diawali header terenkripsi; tanpa key gagal |
| 3.5 | `src/services/backup.service.ts:153+` | Upload hanya setelah verifikasi checksum + ukuran; folder per tenant | Upload parsial tidak terjadi |
| 3.6 | `scripts/verify-backup-restore.ts` (baru) | Restore ke DB uji, bandingkan row-count tabel utama | Restore drill lulus |
| 3.7 | `src/services/cron.service.ts:654-663` | Cron mencatat status `success/failed` + alert; tidak ada "sukses" bila verifikasi gagal | Test cron gagal → alert terkirim |

**Gate Fase 3:** uji backup gagal (dump parsial) + uji restore dari file terenkripsi; tidak ada file plaintext di Drive; build/typecheck hijau. Rollback: matikan cron backup, kembalikan kode lama; file lama tetap dapat diunduh manual.

---

## 7. FASE 4 — Keselamatan Klinis & Kontrak AI (P0)

**Temuan:** A-001–A-005, C-004, C-005, C-006, C-010.

### 4.1 Tri-state triage
`src/v3/agent/pipeline/medical-signal-detector.ts:381-395` memeriksa sinyal aman lebih dulu; `:486-497` hanya memblokir `!isSafe`; `src/v3/state/patient-extractor.ts:422-442` hanya suhu numerik.

| ID | File | Tindakan | Acceptance |
|---|---|---|---|
| 4.1.1 | `medical-signal-detector.ts` | Ganti ke tri-state `{safeTime, unsafeHealth, unknown}`; `unsafeHealth` menang; `isSafe` hanya jika waktu cukup **DAN** bebas demam | Test 0.5 hijau |
| 4.1.2 | `patient-extractor.ts` | Tambah `feverSuspected` dari kata "demam/panas/suhu" tanpa angka | "demam" → flag true |
| 4.1.3 | `context-grounder.ts:278-299` | Teruskan `feverSuspected` ke session | `save_reservation` menerima flag |
| 4.1.4 | `src/services/clinical-eligibility.service.ts:70-78` | Blokir booking bila `feverSuspected` dan `screeningConfirmed` belum ada | Test booking demam → ditolak |
| 4.1.5 | `ClinicPolicy` | Ambang 48–72 jam dan aturan demam dari DB, fallback aman | Tenant berbeda boleh beda kebijakan |

### 4.2 SOP vaksinasi satu sumber
`src/v3/tools/clinic-faq.tool.ts:117,157` memuat "BOLEH dijadwalkan langsung" yang bertentangan dengan safety.

| ID | File | Tindakan | Acceptance |
|---|---|---|---|
| 4.2.1 | `clinic-faq.tool.ts` | Hapus teks "boleh langsung"; satu teks kanonis "tunda 48–72 jam + bebas demam" dari `ClinicPolicy` | `rg "boleh langsung" src` = 0 |
| 4.2.2 | seed/migration `ClinicPolicy` | Samakan teks di semua tenant | Test tenant A/B membaca teks sama |
| 4.2.3 | golden/few-shot | Perbarui contoh pasca-vaksin agar tidak mengajarkan "langsung" | Test `vaccine-sop-flow` hijau |

### 4.3 Otorisasi eksekusi tool
`src/v3/agent/pipeline/dsml-tool-salvage.ts` + `generation-stage.ts` dapat mengeksekusi tool yang sudah di-mask.

| ID | File | Tindakan | Acceptance |
|---|---|---|---|
| 4.3.1 | `src/v3/agent/pipeline/tool-pipeline.ts` | Tambah `allowedToolNames` di `ToolExecutionContext`; tolak eksekusi di luar daftar | Test 0.6 hijau |
| 4.3.2 | `dsml-tool-salvage.ts` + `generation-stage.ts` | Filter hasil salvage terhadap `allowedToolNames` | Tool ter-mask tidak dieksekusi |
| 4.3.3 | `tool-masker.ts` | Tetap cabut tool dari schema (sudah ada) + log alasan | Tidak ada regresi masking |

### 4.4 Komitmen hanya dari pesan user
| ID | File | Tindakan | Acceptance |
|---|---|---|---|
| 4.4.1 | `booking-commit-gate.ts` | Hapus pembacaan `bookingCommitConfirmed` dari argumen tool; satu seam `applyUserCommitmentSignal` | Test 0.7 hijau |
| 4.4.2 | `tool-schemas.ts` | Hapus field `commitment` dari schema umum | LLM tidak bisa mengisi |
| 4.4.3 | test adversarial | "cara booking", "mau tanya paket", "besok bisa?" tidak boleh memicu `save_reservation` | Semua ditolak/di-mask |

### 4.5 Identitas treatment
| ID | File | Tindakan | Acceptance |
|---|---|---|---|
| 4.5.1 | `tool-pipeline.ts:428-439` | Ganti token-match longgar dengan `matchCatalogItem`/semua token signifikan | Test 0.8 hijau |
| 4.5.2 | `save-reservation.tool.ts:455-460` | Tolak `treatmentName` di luar `verifiedTreatmentNames`; jangan menimpa `selectedTreatment` | Test nama lintas kategori ditolak |
| 4.5.3 | `cart-manager.ts` | Simpan `userConfirmedNames` dari pesan user | Anaphora "yang tadi" tetap lolos |

### 4.6 RAG-miss & prompt 4-Section
| ID | File | Tindakan | Acceptance |
|---|---|---|---|
| 4.6.1 | RAG/prompt builder (verifikasi path saat eksekusi) | Hapus lisensi "jawab dari pengetahuan umum" saat RAG miss; wajib refusal/eskalasi | Test RAG miss → refusal |
| 4.6.2 | Jalur 4-Section DB | Jadikan **overlay** di atas guardrail kode, bukan replace; pertahankan 21 constraints + pruning | Test prompt memuat guardrail |
| 4.6.3 | prompt assembly | Teruskan `tenantId`; jangan fallback ke brand Kala | Test tenant B tidak melihat brand A |

**Gate Fase 4:** test 0.5–0.8 hijau; test adversarial multi-parafrase; `npm run build`; evaluasi golden corpus tidak menurun. Rollback: env `TOOL_EXEC_AUTHZ_ENFORCE=false`, `COMMITMENT_DETERMINISTIC_ONLY=false`, `TRIAGE_STRICT_SCREEN=false` (default true setelah stabil).

---

## 8. FASE 5 — Durabilitas Ingress, Outbox & Cron (P0/P1)

**Temuan:** W-001, W-004, W-005, K-001, K-002, K-004, K-005, I-003–I-005.

### 5.1 Urutan ingress
| ID | File | Tindakan | Acceptance |
|---|---|---|---|
| 5.1.1 | `src/routes/webhook.route.ts` | Urutan kanonis `persistInbound → enqueue → logMessage`; jangan log sebelum enqueue durable | Test: enqueue gagal → pesan tidak diklaim terkirim |
| 5.1.2 | `src/services/burst-coalesce.service.ts` | Buffer RAM hanya untuk dedupe; state durable di `InboundTurn` | Restart tidak menghilangkan turn |
| 5.1.3 | `src/services/typing.service.ts` / outbound | Cache kill-switch ber-TTL 5 dtk + invalidasi lintas proses (Redis/DB) | Worker terpisah berhenti mengirim |

### 5.2 Replay turn macet
| ID | File | Tindakan | Acceptance |
|---|---|---|---|
| 5.2.1 | `src/services/cron.service.ts` | Tambah sweep turn `pending/stuck` (>2 menit) + klaim atomik + retry maksimal | Test turn macet di-replay |
| 5.2.2 | `src/lifecycle/background-crons.ts` | Daftarkan cron replay + alarm bila >N turn macet | Job terdaftar dan terpantau |
| 5.2.3 | observability | Metrik `stuck_turn_count`, `replay_success`, `replay_failed` | Dashboard/alert tersedia |

### 5.3 Sheets/Contacts/Telegram outbox
| ID | File | Tindakan | Acceptance |
|---|---|---|---|
| 5.3.1 | `src/services/sheets/*` | Atomic claim (`status=processing`, `locked_until`) + idempotency key | Retry/overlap tidak menggandakan baris |
| 5.3.2 | `google-contacts`/`telegram` | Claim + lease yang sama | Tidak ada duplikat kirim |
| 5.3.3 | test | Dua worker paralel memproses satu outbox | Hanya satu yang menulis |

### 5.4 Cron runner
| ID | File | Tindakan | Acceptance |
|---|---|---|---|
| 5.4.1 | `src/lifecycle/background-crons.ts` | Satu runner ber-advisory-lock; `SEPARATE_WORKER` tetap didukung | Tidak ada cron ganda saat dua container |
| 5.4.2 | `src/services/cron.service.ts` | Jadwal persisten + catch-up (last-run di DB), bukan hanya `setInterval` | Restart tidak melewatkan jadwal 6/24 jam |
| 5.4.3 | alert | Kegagalan/zero-run memicu alert; status per pekerja | Alert teruji |
| 5.4.4 | inventory | Selaraskan 22 pekerja di kode vs dokumentasi | `FEATURE_INVENTORY` = 22 |

**Gate Fase 5:** test paralel dua worker; uji restart; alert stub; build/typecheck. Rollback: matikan cron baru via flag, kembalikan scheduler lama.

---

## 9. FASE 6 — Ghost Config & Hardcode (P0/P1)

**Temuan:** Cfg-001, Cfg-003, Cfg-005, Cfg-012.

| ID | File | Tindakan | Acceptance |
|---|---|---|---|
| 6.1 | `src/routes/admin/settings.subroute.ts:1802-1838` | Implementasi `conversation-behavior` ke `Tenant.settings` (tenant-aware) atau kembalikan 501 | Test 0.10 hijau; GET mengembalikan nilai tersimpan |
| 6.2 | `src/services/staff-reservation.service.ts:2471-2477` | Hapus rekening fiktif `BCA 1234567890`; fallback = "pembayaran belum diatur" + blokir invoice | `rg "1234567890"` = 0 |
| 6.3 | `packages/admin-dashboard/src/components/.../PaymentInfoPanel.tsx:164,175` | Hapus `BCA 8877665544/PT Kala`; ambil dari API tenant | Tidak ada rekening hardcode |
| 6.4 | `src/services/treatment-catalog.service.ts:199-926`, `delivery.service.ts:22-30` | Pindahkan katalog/tier ke DB dengan onboarding eksplisit; hapus auto-seed diam-diam | Tenant baru tanpa data → state "belum dikonfigurasi", bukan katalog Kala |
| 6.5 | `src/v3/tools/clinic-faq.tool.ts`, `router-direct-reply.layer.ts:84`, `guardrail-pipeline.ts:877`, `gold-few-shot-exemplars.ts:46` | Pindahkan SOP/jam/area ke `ClinicPolicy`/`TenantPromptConfig` | `rg` hardcode Kala = 0 |
| 6.6 | `src/routes/admin/quick-replies.subroute.ts:133` | Quick reply alamat dari DB | Tidak ada alamat hardcode |

**Gate Fase 6:** test config persist; `rg` nilai fiktif = 0; tenant baru tidak melihat data Kala; build dashboard + backend. Rollback: feature flag `USE_DB_CONFIG=false` sementara.

---

## 10. FASE 7 — Staf & Marketing (P1)

**Temuan:** S-01–S-06, M-01–M-09.

| ID | Area | Tindakan | Acceptance |
|---|---|---|---|
| 7.1 | Sesi staf | Hapus token dari JSON/localStorage; HttpOnly cookie saja; restore PWA tanpa token di JS | XSS tidak bisa mencuri token |
| 7.2 | PII outbox | Bersihkan outbox chat (teks/foto) saat logout; enkripsi bila harus persist | Logout → localStorage kosong |
| 7.3 | GPS/trip | Persist trip ke DB/Redis; hapus state in-memory; consent + indikator aktif | Auto-close trip berjalan di worker; consent tercatat |
| 7.4 | Tracking code | Kode ≥12 char + expiry 7 hari + lookup DB; migrasi kode lama | Kode 2 char tidak lagi dibuat |
| 7.5 | Pixel/beacon/CAPI | Tenant-aware; validasi origin/beacon; CAPI manual tidak default tenant | Test dua tenant |
| 7.6 | Spend audit | Simpan perubahan spend + audit log; CAC/ROAS hanya dari spend tersimpan | Test perubahan spend tercatat |

**Gate Fase 7:** test perangkat fisik untuk Modul 5 (T-08, safe-area, keyboard, tap target) sebelum deploy; build dashboard; test tenant marketing.

---

## 11. FASE 8 — RAG/Prompt & Log (P1)

**Temuan:** C-001, C-002, C-009, C-011.

| ID | Area | Tindakan | Acceptance |
|---|---|---|---|
| 8.1 | Retrieval | Query rewriting + rank/IDF selaras; kalibrasi ambang dengan data nyata | Context precision naik pada golden set |
| 8.2 | Korpus | Dedupe, pisahkan artikel klinis vs cuplikan chat, buang "Nanti saya info lagi" | Korpus bersih; test retrieval |
| 8.3 | Prompt | Overlay 4-Section di atas guardrail; jangan replace; tenantId | Prompt memuat guardrail + tenant |
| 8.4 | Log | Redaksi PII di `logs/llm-*.jsonl`; retensi; log output pasca-guardrail | Tidak ada PII mentah; retensi berjalan |

**Gate Fase 8:** golden corpus before/after; faithfulness/relevancy tidak menurun; build.

---

## 12. FASE 9 — Data-Driven & Arsitektur (P2)

| ID | Area | Tindakan | Acceptance |
|---|---|---|---|
| 9.1 | Katalog/SOP/tier/payment | Migrasi ke DB + onboarding tenant; migration dry-run + approval | Tenant baru tidak melihat data Kala |
| 9.2 | God Object | Pecah `LiveChatMonitor.tsx` (7.932 baris) dan route/service >1.500 baris per domain; pindahkan pemanggil | Build + test integrasi hijau |
| 9.3 | Observability | Metrik untuk jalur silent (cron, RAG, replay, backup) | Dashboard/alert tersedia |
| 9.4 | Dokumentasi | Sinkronkan `FEATURE_INVENTORY` (22 pekerja), `KNOWN_ISSUES`, `CHANGELOG` | 0 drift path |

---

## 13. FASE 10 — Verifikasi & Penutupan

1. Full suite + baseline-diff; tidak ada failure baru.
2. `npm run security:scan -- --all` bersih.
3. Uji dua tenant untuk RBAC, config, knowledge, media, marketing.
4. Uji backup/restore dari file terenkripsi.
5. Uji cron paralel + restart + alert.
6. Uji klinis: konflik vaksin/demam, tool authz, commitment, treatment identity.
7. Uji perangkat fisik Modul 5/6 sebelum deploy.
8. Perbarui `docs/KNOWN_ISSUES.md` (22 temuan kritis + status), `CHANGELOG.md`, `docs/changelog/INDEX.md`, `docs/FEATURE_INVENTORY.md`.
9. Deploy bertahap: staging → canary → produksi; backup sebelum migrasi; migrasi dulu, app kemudian, worker terakhir.

---

## 14. Register Risiko Plan (FMEA)

| Risiko | S | O | D | RPN | Mitigasi |
|---|---:|---:|---:|---:|---|
| Rotasi `ADMIN_API_KEY` memutus dekripsi secret lama | 9 | 6 | 4 | 216 | Fase 1.1 wajib sebelum rotasi; dry-run re-encrypt |
| RBAC fail-closed mengunci admin CS yang sah | 8 | 6 | 3 | 144 | Seed scope + uji matriks + feature flag darurat |
| Backup enkripsi tidak bisa direstore | 9 | 4 | 3 | 108 | Restore drill wajib sebelum aktif |
| Tri-state triage meningkatkan over-refusal | 6 | 6 | 3 | 108 | Ambang dari DB + uji golden + monitoring |
| Tool authz memblokir tool sah | 7 | 5 | 3 | 105 | `allowedToolNames` dari registry + test regresi |
| Cron lock menyebabkan job tidak jalan | 8 | 4 | 4 | 128 | Heartbeat + alert zero-run |
| Migrasi katalog menghapus data tenant | 9 | 3 | 3 | 81 | Dry-run + backup + approval |

**Urutan aman:** Fase 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10. Fase 1.1 (kunci enkripsi) adalah **blocker** untuk rotasi kredensial. Fase 2 adalah **blocker** untuk semua perubahan route/config. Fase 3 dan 4 boleh paralel setelah Fase 2, tetapi deploy tetap berurutan.

---

## 15. Definition of Done

- Semua P0 (Fase 1–4) lulus gate dan tidak ada temuan kritis baru.
- Semua P1 (Fase 5–8) lulus gate; P2 (Fase 9) terjadwal.
- `npm run build`, `npm run typecheck`, full suite baseline-diff hijau.
- `security:scan --all` bersih; tidak ada kredensial di repo.
- Uji dua tenant, backup restore, cron restart, dan klinis adversarial lulus.
- `KNOWN_ISSUES`, `CHANGELOG`, `FEATURE_INVENTORY` diperbarui.
- Tidak ada dependency runtime baru.
- Deploy staging + canary + produksi dengan backup dan rollback plan.

---

## 16. Validasi Klaim Plan (apa yang sudah diverifikasi)

| Klaim | Status verifikasi |
|---|---|
| `GUIDE_OPERASIONAL.md:71` memuat `admin_prod_key_123` | **TERBUKTI** (dibaca langsung) |
| `SECRET_ROTATION_PLAN.md:54-56` memuat nilai lama | **TERBUKTI** |
| RBAC role tanpa scope = legacy/lolos (`admin.route.ts:278-290`) | **TERBUKTI** |
| `conversation-behavior` stub (`settings.subroute.ts:1802-1838`) | **TERBUKTI** |
| Backup hanya gzip + fallback programmatic menelan error (`backup.service.ts:52-148`) | **TERBUKTI** |
| `trustProxy: true` + `x-api-key` bucket (`app.ts:71,159-161`) | **TERBUKTI** |
| `setLabelFlags` punya default tenant; webhook tidak meneruskan tenant (`customer.service.ts:164-168`; `webhook.route.ts:55,972,1424,1431`) | **TERBUKTI** |
| GPS trip store in-memory (`staff-trip-tracking.service.ts:408`) | **TERBUKTI** |
| Scanner hanya `git status` + tanpa rule generik (`scan-secrets.ts:128-155`) | **TERBUKTI** |
| Triase OR & demam numerik (`medical-signal-detector.ts:381-395,486-497`) | **TERBUKTI** via laporan Modul 3A; verifikasi ulang saat eksekusi |
| DSML salvage bisa eksekusi tool ter-mask | **TERBUKTI** via laporan Modul 3A; verifikasi call-site saat eksekusi |
| Tracking code 2 char (`tracking.route.ts:356`) | **TERBUKTI** |
| Path/line lain dari laporan agent | **PERLU VERIFIKASI ULANG** saat mulai setiap task (line drift) |

> Catatan: plan ini **tidak boleh dieksekusi** sebelum pengguna mengetik persetujuan eksplisit ("Setuju" / "Lanjut" / "Eksekusi"). Auto-approval hook sistem tidak dihitung sebagai persetujuan.
