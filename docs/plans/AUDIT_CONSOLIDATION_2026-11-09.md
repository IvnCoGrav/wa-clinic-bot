# Konsolidasi Audit 16-Modul vs 12-Modul — 2026-11-09

- **Sifat:** read-only consolidation. Tidak ada file source yang diubah.
- **Baseline commit:** `f3c6a2c4` (`master`), working tree bersih.
- **Sumber Track A (audit saya):** `docs/MODULE_AUDIT_01_DATA_ACCESS.md` … `MODULE_AUDIT_05_INGRESS.md`.
- **Sumber Track B (audit + remediasi repo):** `docs/audit/2026-11-06/*`, `docs/audit/2026-11-07/*`, `docs/plans/FIXING_PLAN_AUDIT_2026-11-07.md`, `docs/KNOWN_ISSUES.md` #320.
- **Execution plan:** `docs/plans/PLAN_FINISH_AUDIT_2026-11-09.md` (DRAFT — menunggu persetujuan).

---

## 0. Ringkasan Eksekutif

Ada **dua track yang berbeda**, bukan satu track dengan dua penomoran:

1. **Track A — audit 16 modul (saya):** audit read-only, granular, 5/16 selesai. Temuan belum di-remediasi dan belum di-re-baseline ke `f3c6a2c4`.
2. **Track B — audit 12 modul + remediasi (repo):** audit 12/12 selesai (Modul 4 & 6 dari 2026-11-06; 1,2,3A,3B,5,7,8,9,10,11 dari 2026-11-07; 12 = konsolidasi). Remediasi sudah banyak diterapkan, tetapi **gate verifikasi belum terbukti hijau**.

**Kesimpulan sinkronisasi:**
- **Audit:** Track B sudah mencakup 12/12 modulnya; Track A baru 5/16.
- **Perbaikan:** Track B sudah mengimplementasikan sebagian besar Fase 1–8, tetapi Fase 9 (data-driven/God Object) belum, dan beberapa temuan masih parsial.
- **Gate:** artifact `after-fase10.json` mencatat **14 test gagal (12 baru vs baseline 2)**, sedangkan `KNOWN_ISSUES` #320 mengklaim **2 gagal pre-existing / 0 regresi**. Ini **kontradiksi bukti** yang wajib diselesaikan dengan full-suite run baru di `f3c6a2c4`.
- **Rekomendasi:** jadikan Track B sebagai baseline eksekusi, Track A sebagai lampiran deep-dive; jangan menjalankan audit modul baru sebelum gate Track B hijau atau baseline baru disetujui.

---

## 1. Dua Peta Modul

| Track A (16 modul) | Track B (12 modul) | Hubungan |
|---|---|---|
| 1. Data access (`db` + `repositories`) | 1 + 11 (arsitektur/keamanan) | Sebagian |
| 2. Config (`src/config`) | 10 (settings/data-driven), 3B (prompt) | Sebagian |
| 3. Utils (`src/utils`) | 1 + 11, 2 + 9, 3B | Sebagian |
| 4. Domain (`src/domain`) | 4 (reservasi), 3A, 6 | Sebagian |
| 5. Bootstrap & webhook ingress | 2 + 9, 1 + 11, 8 | Sebagian |
| 6. State machine & conversation core | 3A / 2 + 9 (tidak eksplisit) | **Belum jelas** |
| 7. WhatsApp integrations | 2 + 9 | Sudah di Track B |
| 8. v3 AI agent | 3A / 3B | Sudah di Track B |
| 9. v3 tools/state/guardrails | 3A / 3B | Sudah di Track B |
| 10. Reservation | 4 (2026-11-06) | Sudah di Track B |
| 11. Customer/catalog/location | 10 / 2 + 9 | Sebagian |
| 12. Live chat/follow-up/notification | 6 (livechat); follow-up/notification tidak eksplisit | **Sebagian** |
| 13. Meta/CAPI/WABA/staff-auth | 5 + 7 / 2 + 9 | Sudah di Track B |
| 14. Ops queue/cron/backup | 8 | Sudah di Track B |
| 15. Admin/staff API | 5 + 7 / 10 | Sebagian |
| 16. Dashboard/tests/build/deploy/CI | 5 + 7 (web app saja) | **Sebagian** |

**Catatan:** angka “Modul 6” di Track B adalah **Live Chat**, bukan state machine. Ini sumber kebingungan “5 atau 6”.

---

## 2. Status Track A — 16 Modul

Legenda status: **AUDIT-DONE** = saya sudah audit; **B-COVERED** = sudah ada di audit repo; **REMEDIATED** = sudah ada perubahan kode; **VERIFIED** = sudah lulus gate; **OPEN** = belum ditangani.

| No | Modul | Audit saya | Coverage Track B | Remediasi | Status sinkron |
|---:|---|---|---|---|---|
| 1 | Data access | ✅ 18 temuan | Sebagian (1+11, W-005) | Tidak spesifik | **OPEN / perlu re-baseline** |
| 2 | Config | ✅ 20 temuan | Sebagian (10, 3B) | Sebagian (brand, settings) | **PARTIAL** |
| 3 | Utils | ✅ 25 temuan | Sebagian (1+11, 2+9, 3B) | Sebagian (encryption, backup, log) | **PARTIAL** |
| 4 | Domain | ✅ 15 temuan | Sebagian (4, 3A, 6) | Tidak spesifik | **OPEN / perlu re-baseline** |
| 5 | Ingress | ✅ 18 temuan | Sebagian (2+9, 1+11, 8) | Sebagian | **PARTIAL** |
| 6 | State machine & conversation core | ❌ belum | Tidak eksplisit | — | **NOT-AUDITED** |
| 7 | WhatsApp integrations | ❌ belum | ✅ 2+9 | Sebagian (W-003 open) | **B-COVERED, PARTIAL** |
| 8 | v3 AI agent | ❌ belum | ✅ 3A/3B | Sebagian | **B-COVERED, PARTIAL** |
| 9 | v3 tools/state/guardrails | ❌ belum | ✅ 3A/3B | Sebagian | **B-COVERED, PARTIAL** |
| 10 | Reservation | ❌ belum | ✅ 4 (2026-11-06) | Tidak di plan baru | **B-COVERED, OPEN** |
| 11 | Customer/catalog/location | ❌ belum | Sebagian (10/2+9) | Sebagian | **PARTIAL** |
| 12 | Live chat/follow-up/notification | ❌ belum | 6 (livechat) | Sebagian | **PARTIAL** |
| 13 | Meta/CAPI/WABA/staff-auth | ❌ belum | ✅ 5+7/2+9 | Sebagian | **B-COVERED, PARTIAL** |
| 14 | Ops queue/cron/backup | ❌ belum | ✅ 8 | Sebagian | **B-COVERED, PARTIAL** |
| 15 | Admin/staff API | ❌ belum | Sebagian (5+7/10) | Sebagian | **PARTIAL** |
| 16 | Dashboard/tests/build/deploy/CI | ❌ belum | 5+7 (web app saja) | — | **NOT-AUDITED** |

**Angka Track A: 5/16 selesai, 11/16 belum.** Dari 11 yang belum, 6 area sudah tercakup Track B (7,8,9,10,13,14), 4 area parsial (11,12,15, plus 6 state machine), 1 area belum (16).

---

## 3. Status Track B — 12 Modul & Fase Remediasi

| Modul / Fase | Audit | Remediasi kode | Gate |
|---|---|---|---|
| 1 + 11 (arsitektur/keamanan) | ✅ | **Implemented** — trustProxy CIDR, rate-limit bucket, encryption fail-closed, secret scan `--all` | **Belum terbukti** — rotasi kunci produksi tidak bisa diverifikasi lokal; artifact test kontradiktif |
| 2 + 9 (WhatsApp/ingestion) | ✅ | **Partial** — label tenant fixed; `wahaClient` global masih dipakai (W-003) | **Belum hijau** — perlu test dua tenant |
| 3A (AI engine/tool/state/guardrail) | ✅ | **Implemented** — `allowedToolNames`, commitment user-only, `verifiedTreatmentNames`, tri-state | **Kontradiktif** — artifact `after-fase10` menunjukkan CM-07/CM-12 gagal |
| 3B (RAG/prompt/persona/log) | ✅ | **Partial** — SOP vaksin fixed; FAQ test & knowledge count masih gagal | **Belum hijau** |
| 4 (Reservasi) | ✅ 2026-11-06 | Tidak di plan baru | Status lama; `reservation-status` tidak berubah |
| 5 + 7 (web app/marketing) | ✅ | **Partial** — tracking code 12 char + expiry, HttpOnly, PII outbox; staff auth/ad attribution/payment test gagal | **Belum hijau** |
| 6 (Live Chat) | ✅ 2026-11-06 | Tidak di plan baru | Status lama |
| 8 (cron/worker) | ✅ | **Implemented** — advisory lock, replay sweep, ingress order | **Partial** — idempotency claim sebelum enqueue masih ada |
| 10 (settings/RBAC/data-driven) | ✅ | **Partial** — conversation-behavior persist; masih 20 `DEFAULT_TENANT_ID` di settings | **Belum tuntas** |
| 12 (konsolidasi) | ✅ | — | **Klaim vs bukti belum sinkron** |
| Fase 9 (data-driven/God Object) | — | **Belum** — `LiveChatMonitor.tsx` 7.751 baris; 47 kemunculan “Kala” (42 layanan auto-seed) di `treatment-catalog.service.ts` | **Belum** |
| Fase 10 (verifikasi) | — | Artifact ada | **Tidak hijau** — lihat §5 |

### 3.1 Yang sudah diperbaiki (bukti kode)

- **Label tenant:** `handleLabelChatEvent(event, tenantId)` dan `setLabelFlags(phone, flags, tenantId)` wajib tenant (`webhook.route.ts:38,55,132`; `customer.service.ts:164-168`).
- **Trust proxy & rate limit:** `TRUST_PROXY_CIDRS`/`TRUST_PROXY_ANY`, bucket API key hanya untuk key sah, allowList path exact (`app.ts:70-180`).
- **Enkripsi & backup:** produksi menolak fallback `ADMIN_API_KEY` kecuali flag transisi; `BACKUP_ENCRYPTION_KEY` fail-closed; backup memakai `pg_dump` fail-closed + checksum/manifest/enkripsi (`encryption.ts:17-45`; `backup.service.ts:73-109,204-246`).
- **RBAC:** role tanpa `role_api_scopes` = deny (`role-scope.service.ts:70`; `admin.route.ts:280-287`).
- **Tool authz/commitment/treatment:** `allowedToolNames` di pipeline & DSML salvage; `applyUserCommitmentSignal`; `verifiedTreatmentNames` (`tool-pipeline.ts:40,283`; `booking-commit-gate.ts:24`; `save-reservation.tool.ts:450-491`).
- **Triase klinis:** tri-state `unsafeHealth`/`safeTime`; SOP vaksin 48–72 jam (`medical-signal-detector.ts:370-434`; `clinic-faq.tool.ts:112-153`).
- **Cron:** advisory lock + replay turn (`background-crons.ts:22`; `cron.service.ts:743`; `cron-advisory-lock.ts`).
- **Conversation behavior:** persist ke `Tenant` (`settings.subroute.ts:1818-1913`).
- **Tracking code:** 12–16 karakter + expiry 7 hari (`tracking.route.ts:214-223`).
- **Secret scan:** `security:scan` default `--all` (`package.json`).

### 3.2 Yang masih parsial / terbuka

- **W-003:** `webhook.route.ts` masih memakai `wahaClient` global di 14 titik (LID, contact, labels, media).
- **W-005/idempotensi:** `isDuplicateMessage` masih menambah memory key sebelum enqueue/log (`message.service.ts:264-266`); `webhook.route.ts:750-762` memanggilnya sebelum `!phone` guard dan sebelum enqueue.
- **Cfg-012:** `settings.subroute.ts` masih punya **20** fallback `DEFAULT_TENANT_ID`.
- **Echo hardcoded:** `webhook.route.ts:372-379` masih memakai string tenant A (`Pricelist`, `[AUTOMATED]`, dll.) di samping `getTenantEchoPatterns`.
- **Error handler:** tidak ada `setErrorHandler`/`setNotFoundHandler`.
- **Readiness:** `/ready` hanya cek Prisma + `wahaClient` global; WABA-only/Redis/queue tidak dicek (`health.route.ts:21-58`).
- **Boot race:** `server.listen()` masih dipanggil sebelum init tenant (`app.ts:246-276`).
- **Worker shutdown:** queue ditutup sebelum `flushAll()` (`worker.ts:47-55`).
- **Fase 9:** God Object & 47 kemunculan hardcode “Kala” (42 layanan auto-seed) belum dipindah ke DB.
- **Track A findings:** sebagian besar D-/CFG-/UTL-/DOM- belum di-remediasi dan belum di-re-baseline.

---

## 4. Crosswalk Temuan Kunci

| Track A | Track B | Status aktual | Bukti |
|---|---|---|---|
| ING-01 label cross-tenant | W-002 | **FIXED** | `handleLabelChatEvent(..., resolvedTenantId)`; `setLabelFlags` wajib tenant |
| ING-04 trustProxy spoof | S-005 | **FIXED** | `TRUST_PROXY_CIDRS` default private CIDR |
| ING-02 idempotency before enqueue | W-005 | **PARTIAL** | Urutan persist→enqueue→log fixed; claim memory masih sebelum enqueue |
| ING-03 echo hardcoded | Cfg-005 | **OPEN** | Literal `Pricelist`/`[AUTOMATED]` masih ada |
| ING-05 no error handler | — | **OPEN** | `rg setErrorHandler` = 0 |
| ING-07 global wahaClient | W-003 | **OPEN** | 14 pemakaian `wahaClient` di webhook |
| ING-08 readiness only WAHA | — | **OPEN** | `health.route.ts` hanya Prisma+WAHA |
| UTL-22 encryption fallback | S-001 | **PARTIAL** | Produksi fail-closed; fallback dev/flag masih ada |
| UTL-21 backup fd/encryption | I-001/K-003 | **FIXED/PARTIAL** | Backup enkripsi+checksum; fd fix perlu verifikasi |
| CFG-07/08 hardcode katalog/SOP | Cfg-005 | **PARTIAL** | SOP vaksin fixed; 47 kemunculan “Kala” masih di katalog |
| DOM-01 active status semantics | A-005 | **OPEN** | `reservation-status.ts` tidak berubah |
| D-01/D-02/D-03 data access | — | **OPEN** | `customer.repository`/schema conversation tidak berubah |
| CFG-02 persona prod/dev | — | **OPEN** | `config/persona.ts`/`persona_custom.txt` tidak berubah |
| UTL-01 bogus date | — | **OPEN** | `conversation-transaction-extractor.ts` tidak berubah |
| UTL-04 SSRF maps resolver | — | **OPEN** | `google-maps-url-resolver.ts` tidak berubah |
| UTL-05 stateful regex | — | **OPEN** | `language-sanitizer.ts` tidak berubah |

**Cara membaca:** FIXED = ada bukti kode dan tidak ada kontradiksi; PARTIAL = sebagian jalur sudah benar; OPEN = belum tersentuh; perlu re-baseline = temuan Track A masih berdasarkan `c8ce5b21`.

---

## 5. Konflik Bukti Gate (Paling Penting)

`docs/KNOWN_ISSUES.md` #320 mengklaim:

> “Full suite aktual: **6.724 test (6.694 lulus / 2 gagal pre-existing / 28 skipped)** — 0 regresi baru.”

Artifact yang di-commit:

| Artifact | Total | Passed | Failed | Pending |
|---|---:|---:|---:|---:|
| `baseline-before.json` | 6.659 | 6.629 | **2** | 28 |
| `after-remediation.json` | 6.722 | 6.692 | **2** | 28 |
| `after-fase10.json` | 6.722 | 6.680 | **14** | 28 |

`after-fase10.json` mencatat **12 failure baru** dibanding baseline:

1. `staff-routes.test.ts` — login staff tidak set cookie.
2. `v3-conversation-matrix.test.ts` — CM-07 (vaksin DPT) tidak memanggil tool.
3. `v3-conversation-matrix.test.ts` — CM-12 (slot inquiry vs commit) tidak memanggil tool.
4. `ad-attribution.test.ts` — promo code new customer.
5. `ad-attribution.test.ts` — promo code existing customer.
6. `admin-payment-info-settings.test.ts` — default bank account kosong.
7. `admin-rbac-guard.test.ts` — ADMIN_CS GET settings 403.
8. `admin-rbac-guard.test.ts` — ADMIN_CS GET notifications 403.
9. `dynamic-knowledge-maternal.test.ts` — fallback kosong.
10. `faq-statement-only-310995.test.ts` — statement-only.
11. `faq-statement-only-310995.test.ts` — fallback kosong.
12. `knowledge-safe-upsert.test.ts` — 45 vs 48 artikel.

Dua failure baseline (`hybrid-reservation-parser` x2) tetap ada; jadi total 14.

**Status:** gate Fase 10 **tidak terbukti hijau**. Klaim “SELESAI / 0 regresi” di `KNOWN_ISSUES` #320 tidak konsisten dengan artifact yang di-commit. Ini harus diselesaikan sebelum audit/fix baru dianggap valid.

**Tindakan wajib:**
1. Jalankan full suite baru di `f3c6a2c4` dengan output JSON.
2. Bandingkan dengan `baseline-before.json`.
3. Untuk setiap failure baru: tentukan **regresi** vs **perubahan perilaku yang disengaja**; jika diklaim pre-existing, wajib revert-and-rerun.
4. Perbarui `KNOWN_ISSUES` #320 dan artifact; jangan biarkan klaim “SELESAI” tanpa bukti.

---

## 6. Apa yang Sudah vs Belum

### Sudah
- **Audit:** Track B 12/12 modul; Track A 5/16 modul.
- **Remediasi kode:** Fase 1–8 sebagian besar sudah diterapkan; Fase 3/4/8 punya test baru.
- **Perbaikan kritis:** label tenant, RBAC fail-closed, trust proxy/rate limit, backup enkripsi/checksum, tool authz, commitment user-only, treatment identity, triase vaksin, cron lock/replay, conversation-behavior.
- **Dokumentasi:** laporan audit 12 modul + fixing plan + ringkasan.

### Belum
- **Gate full suite hijau** — 14 failure artifact vs klaim 2.
- **Fase 9** — God Object (`LiveChatMonitor.tsx` 7.751 baris) dan data-driven katalog (47 kemunculan “Kala”).
- **W-003** — `wahaClient` global.
- **W-005** — idempotency claim sebelum enqueue.
- **Cfg-012** — 20 `DEFAULT_TENANT_ID` di settings.
- **Echo hardcoded** — `Pricelist`/`[AUTOMATED]`.
- **Error handler & readiness** — belum ada; `/ready` hanya WAHA.
- **Track A findings** — D-/CFG-/UTL-/DOM-/ING- yang belum tersentuh dan belum di-re-baseline.
- **Gap audit:** state machine/conversation core, follow-up/notification, admin/staff API penuh, dashboard/tests/deploy/CI.

---

## 7. Rencana Sinkronisasi (Urutan Wajib)

### Fase S0 — Reconcile gate (0–1 hari)
1. Full suite di `f3c6a2c4` → JSON baru.
2. Diff vs `baseline-before.json`; klasifikasikan 12 failure baru.
3. Perbaiki/terima secara eksplisit; perbarui `KNOWN_ISSUES` #320 + artifact.
4. **Gate:** build/typecheck + full suite baseline-diff; tidak ada failure baru yang tidak disetujui.

### Fase S1 — Tutup partial Track B (1–3 hari)
1. W-003: ganti `wahaClient` global dengan client per tenant di webhook.
2. W-005: pisahkan `isDuplicateMessage` (read) dari `claim` (write); klaim setelah enqueue/log sukses.
3. Cfg-012: hapus 20 fallback `DEFAULT_TENANT_ID` pada mutasi settings; tenant dari sesi.
4. ING-03: hapus echo literal; pakai `getTenantEchoPatterns`.
5. ING-05/08: `setErrorHandler` + readiness provider-aware/timeout.
6. ING-06: init tenant sebelum `listen` atau readiness gate.
7. **Gate:** test dua tenant + webhook failure injection + build.

### Fase S2 — Re-baseline Track A (2–3 hari)
1. Untuk setiap temuan D-/CFG-/UTL-/DOM-/ING-, cek ulang di `f3c6a2c4`.
2. Status: FIXED / PARTIAL / OPEN / DUPLICATE / STALE.
3. Temuan yang sudah tercakup Track B → tandai DUPLICATE, jangan buat tiket baru.
4. Temuan yang masih OPEN → masukkan ke register tunggal dengan ID `A-xx`.
5. **Gate:** register sinkron; tidak ada temuan ganda.

### Fase S3 — Audit gap (setelah S1/S2)
Hanya area yang belum tercakup Track B:
- Modul 6 — state machine & conversation core.
- Modul 12 — follow-up/notification (bagian yang belum).
- Modul 15 — admin/staff API penuh (bukan hanya settings/RBAC).
- Modul 16 — dashboard/tests/build/deploy/CI.

**Gate:** laporan A–G per modul, read-only, tanpa duplikasi temuan Track B.

### Fase S4 — Fase 9 Track B
- Pecah God Object (`LiveChatMonitor.tsx` 7.751 baris; route/service >1.500).
- Pindahkan 42 layanan katalog “Kala” (47 kemunculan teks) + tier ongkir + SOP ke DB dengan onboarding eksplisit.
- **Gate:** build + test integrasi + dua tenant.

---

## 8. Aturan Sinkronisasi (Supaya Tidak Ada Dua Kebenaran)

1. **Satu register:** dokumen ini menjadi indeks; semua temuan memakai ID Track B (`S-`, `W-`, `Cfg-`, `A-`, `K-`, `I-`, `M-`) dan Track A (`D-`, `CFG-`, `UTL-`, `DOM-`, `ING-`).
2. **Track B = eksekusi; Track A = lampiran bukti.** Jangan membuat fix plan baru dari Track A sebelum temuan di-re-baseline.
3. **Status vocabulary:** `AUDIT-DONE`, `FIXED-VERIFIED`, `FIXED-UNVERIFIED`, `PARTIAL`, `OPEN`, `NOT-AUDITED`, `STALE`.
4. **Gate tunggal:** `npm run build` + `npm run typecheck` + full suite baseline-diff + `npm run security:scan`.
5. **Klaim “SELESAI” hanya boleh setelah artifact gate cocok**; revert-and-rerun untuk klaim pre-existing.
6. **Jangan audit ulang** area yang sudah 12/12; fokus ke gap + re-baseline.

---

## 9. Definition of Done Konsolidasi

- [ ] Full suite `f3c6a2c4` hijau dengan baseline-diff; 12 failure baru sudah diklasifikasi/diperbaiki.
- [ ] `KNOWN_ISSUES` #320 diperbarui sesuai artifact (bukan klaim).
- [ ] W-003, W-005, Cfg-012, ING-03, ING-05, ING-06, ING-08 ditutup.
- [ ] Track A findings di-re-baseline; tidak ada duplikasi dengan Track B.
- [ ] Gap audit 6/12/15/16 selesai (read-only).
- [ ] Fase 9 (God Object + data-driven) dijadwalkan dengan migration dry-run.
- [ ] Satu register status; tidak ada dua daftar “sudah/belum” yang saling bertentangan.

---

## Lampiran A — Bukti Perintah

```text
git pull --ff-only origin master
# 73a3803c -> f3c6a2c4 (fast-forward), working tree clean

git show --stat f3c6a2c4
# 119 files changed, 9601 insertions(+), 463 deletions(-)

# artifact gate
baseline-before.json     total=6659 passed=6629 failed=2  pending=28
after-remediation.json   total=6722 passed=6692 failed=2  pending=28
after-fase10.json        total=6722 passed=6680 failed=14 pending=28
```

## Lampiran B — File Rujukan

- `docs/audit/2026-11-07/RINGKASAN_AKHIR_AUDIT_MODUL_1-11.md`
- `docs/plans/FIXING_PLAN_AUDIT_2026-11-07.md`
- `docs/audit/2026-11-07/modul-01-11/LAPORAN_MODUL_01_DAN_11.md`
- `docs/audit/2026-11-07/modul-02-09/LAPORAN_MODUL_02_DAN_09.md`
- `docs/audit/2026-11-07/modul-03/LAPORAN_MODUL_03_PART_A.md`
- `docs/audit/2026-11-07/modul-03/LAPORAN_MODUL_03_PART_B.md`
- `docs/audit/2026-11-07/modul-05-07/LAPORAN_MODUL_05_DAN_07.md`
- `docs/audit/2026-11-07/modul-08/LAPORAN_MODUL_08.md`
- `docs/audit/2026-11-07/modul-10/LAPORAN_MODUL_10.md`
- `docs/KNOWN_ISSUES.md` #320
