# PLAN PENYELESAIAN AUDIT — 2026-11-09

- **Status:** **S0–S5 SELESAI** (S5.1 `LiveChatMonitor` 1.211 baris; S5.2 katalog data-driven + seed eksplisit; **S6 verifikasi lokal PASS**). **Seed/deploy produksi menunggu operator.**
- **Baseline:** `f3c6a2c4` (`master`); hasil S0–S4 di `6c368452`; koreksi pasca-review S4 terdaftar di `docs/KNOWN_ISSUES.md` #321.
- **Dasar konsolidasi:** `docs/plans/AUDIT_CONSOLIDATION_2026-11-09.md`.
- **Sumber audit:** Track B (`docs/audit/2026-11-07/*`, `FIXING_PLAN_AUDIT_2026-11-07.md`) dan Track A (`docs/MODULE_AUDIT_01..05`).
- **Prinsip wajib:** fondasional (DB/state/tool contract), tenant-aware, TDD (test merah dulu), tanpa dependency runtime baru, tanpa solusi “DILARANG...” di prompt sebagai pengganti gerbang kode, regression gate per fase.

---

## 0. Ringkasan Masalah yang Diselesaikan

Plan ini menutup **tiga lapisan** yang masih terbuka:

1. **Gate verification belum valid** — artifact `after-fase10.json` mencatat 14 gagal (12 baru vs baseline 2), sedangkan `KNOWN_ISSUES` #320 mengklaim 2 gagal pre-existing / 0 regresi.
2. **Remediasi Track B masih parsial** — W-003 (`wahaClient` global), W-005 (idempotensi sebelum enqueue), Cfg-012 (20 fallback tenant), echo hardcoded, error handler/readiness/boot race, Fase 9.
3. **Track A belum di-re-baseline & gap audit belum jalan** — 5/16 modul selesai; 11 modul belum; temuan lama masih berdasarkan `c8ce5b21`.

**Target akhir:** satu baseline hijau, satu register temuan, tidak ada duplikasi, dan gap audit selesai.

---

## 1. Peta Fase & Dependensi

| Fase | Fokus | Blast radius | Prasyarat | Estimasi |
|---|---|---|---|---|
| **S0** | Rekonsiliasi gate full suite | rendah (test/docs) | — | 1–2 hari |
| **S1** | Durabilitas ingress & tenant isolation (P0) | tinggi (webhook, repo, settings) | S0 | 4–6 hari |
| **S2** | Hardening P1 (echo, error handler, readiness, boot) | sedang (app/health/webhook) | S1 | 3–4 hari |
| **S3** | Re-baseline Track A | rendah (docs) | S1 | 2–3 hari |
| **S4** | Gap audit 6/12/15/16 (read-only) | rendah | S3 | 5–8 hari |
| **S5** | Fase 9: God Object + data-driven | tinggi (dashboard, katalog, DB) | S1, S2 | 2–4 minggu |
| **S6** | Verifikasi & penutupan | sedang | semua | 2–3 hari |

**Urutan wajib:** S0 → S1 → S2 → S3 → S4 → S5 → S6.
**S3 boleh paralel dengan S2** setelah S1 selesai. **S5 tidak boleh mulai** sebelum S0–S2 hijau.

---

## 2. FASE S0 — Rekonsiliasi Gate Full Suite

**Tujuan:** membuktikan status sebenarnya di `f3c6a2c4`; menghapus kontradiksi artifact vs `KNOWN_ISSUES`.

### Task S0.1 — Baseline baru
| Item | Detail |
|---|---|
| File | `docs/audit/2026-11-09/baseline-f3c6a2c4.json` (baru) |
| Aksi | Jalankan full suite dengan reporter JSON |
| Perintah | `npx vitest run --reporter=json --outputFile=docs/audit/2026-11-09/baseline-f3c6a2c4.json` |
| Acceptance | File ada; `numTotalTests`, `numFailedTests`, daftar failure tercatat |

### Task S0.2 — Diff terhadap baseline lama
| Item | Detail |
|---|---|
| File | `docs/audit/2026-11-07/baseline-before.json` |
| Aksi | Bandingkan failure baru vs lama |
| Perintah | `node scripts/audit-baseline-diff.mjs docs/audit/2026-11-07/baseline-before.json docs/audit/2026-11-09/baseline-f3c6a2c4.json` |
| Acceptance | Daftar 12 failure baru (atau lebih) terklasifikasi: regresi / perilaku disengaja / flaky / pre-existing |

### Task S0.3 — Klasifikasi & perbaikan
Failure yang tercatat di `after-fase10.json`:
1. `staff-routes.test.ts` — login staff cookie.
2. `v3-conversation-matrix.test.ts` — CM-07 vaksin DPT.
3. `v3-conversation-matrix.test.ts` — CM-12 slot inquiry vs commit.
4. `ad-attribution.test.ts` — promo new customer.
5. `ad-attribution.test.ts` — promo existing customer.
6. `admin-payment-info-settings.test.ts` — default bank account.
7. `admin-rbac-guard.test.ts` — ADMIN_CS GET settings.
8. `admin-rbac-guard.test.ts` — ADMIN_CS GET notifications.
9. `dynamic-knowledge-maternal.test.ts` — fallback kosong.
10. `faq-statement-only-310995.test.ts` — statement-only.
11. `faq-statement-only-310995.test.ts` — fallback kosong.
12. `knowledge-safe-upsert.test.ts` — 45 vs 48 artikel.

| Aksi | Acceptance |
|---|---|
| Untuk tiap failure: baca test + kode; tentukan apakah test usang atau kode regresi | Setiap failure punya verdict + alasan |
| Jika regresi: perbaiki kode, bukan test | Test hijau tanpa melemahkan assertion |
| Jika perilaku disengaja: update test + catat di `KNOWN_ISSUES` | Perubahan perilaku terdokumentasi |
| Jika pre-existing: buktikan dengan revert-and-rerun | Bukti sebelum/sesudah |

### Task S0.4 — Sinkronisasi dokumen
| File | Aksi |
|---|---|
| `docs/KNOWN_ISSUES.md:6-20` | Ganti klaim “6.724 / 2 gagal / 0 regresi” dengan hasil S0.1; sebutkan artifact baru |
| `docs/changelog/INDEX.md` | Catat status gate |
| `docs/plans/FIXING_PLAN_AUDIT_2026-11-07.md:3` | Ubah header `DRAFT` → status aktual (mis. `Fase 1–8 implemented; gate pending`) |

**Gate S0:** full suite baseline-diff menunjukkan **tidak ada failure baru yang tidak disetujui**; build/typecheck hijau.

**Rollback:** tidak ada perubahan produksi; revert test/doc jika perlu.

---

## 3. FASE S1 — Durabilitas Ingress & Tenant Isolation (P0)

### Task S1.1 — W-005: pisahkan “cek duplikat” dari “klaim”

**Masalah:** `message.service.ts:238-267` menambahkan memory key saat `isDuplicateMessage` dipanggil, sebelum enqueue/log sukses. `webhook.route.ts:750-762` memanggilnya sebelum guard `!phone` dan sebelum enqueue.

| Langkah | File | Aksi | Acceptance |
|---|---|---|---|
| 1.1.1 | `src/services/message.service.ts:238-267` | Pisahkan menjadi `isDuplicateMessage()` (read-only) dan `claimMessageId()` / `releaseMessageClaim()` | `isDuplicateMessage` tidak menulis memory |
| 1.1.2 | `src/routes/webhook.route.ts:750-762` | Pindahkan cek duplikat **setelah** guard `!phone`; jangan klaim di sini | Phone unresolved tidak mengklaim ID |
| 1.1.3 | `src/routes/webhook.route.ts:1549-1576` | Urutan: `persistInbound` → `enqueueMessage` → `logMessage` → `claimMessageId` | Enqueue throw → tidak ada claim; retry memproses |
| 1.1.4 | `src/routes/waba-webhook.route.ts:163-167`, `471-495` | Sama untuk WABA | Test yang sama |
| 1.1.5 | `tests/unit/fase5-ingress-durability.test.ts` | Tambah kasus: enqueue throw, retry sukses, phone unresolved retry | Test merah dulu, lalu hijau |

**Catatan:** `persistInbound` sudah ada di `turn.repository.ts`; jangan hapus. Jika `logMessage` gagal setelah enqueue, turn tetap durable dan worker bisa memproses; jangan klaim ulang.

### Task S1.2 — W-003: client WAHA per tenant

**Masalah:** `webhook.route.ts` memakai `wahaClient` global di 14 titik (LID, contact, labels, media).

| Langkah | File | Aksi |
|---|---|---|
| 1.2.1 | `src/routes/webhook.route.ts:21-27` | Import `getWahaClientForTenant` dari `../integrations/whatsapp/factory` |
| 1.2.2 | `webhook.route.ts:332-345`, `738`, `770`, `966`, `1148`, `1419` | Ganti `wahaClient.*` dengan `tenantWaha.*`; resolve sekali per request setelah `resolvedTenantId` |
| 1.2.3 | `webhook.route.ts:591-634`, `775-867`, `1008-1092` | Media `fetchUrl`/`downloadMedia` memakai client tenant |
| 1.2.4 | `src/integrations/whatsapp/factory.ts:96` | Pastikan `getWahaClientForTenant(tenantId)` mengembalikan client dengan session tenant; fallback hanya untuk default tenant |
| 1.2.5 | Test | Mock dua tenant dengan client berbeda; pastikan `getChatLabels` dipanggil pada client tenant B |

**Acceptance:** `rg "wahaClient\\." src/routes/webhook.route.ts` = 0 (kecuali fallback eksplisit default tenant). Test dua tenant hijau.

### Task S1.3 — Cfg-012: hapus fallback tenant pada mutasi settings

**Masalah:** `settings.subroute.ts:42` `resolveTenantId(request)` mengembalikan `DEFAULT_TENANT_ID` bila `request.tenantId` kosong; ada 20 pemakaian.

| Langkah | File | Aksi |
|---|---|---|
| 1.3.1 | `src/routes/admin/settings.subroute.ts:42` | Buat `requireTenantId(request)` yang melempar `400 TENANT_REQUIRED` bila tidak ada; `resolveTenantId` hanya untuk read super-admin |
| 1.3.2 | 20 call site (daftar via `rg -n "DEFAULT_TENANT_ID" src/routes/admin/settings.subroute.ts`) | Ganti pada handler mutasi (`POST/PATCH/PUT/DELETE`) dengan `requireTenantId`; read tetap `resolveTenantId` |
| 1.3.3 | Test | Dua tenant: body tenant B tidak boleh menulis tenant A; request tanpa tenant → 400 |

**Acceptance:** `grep DEFAULT_TENANT_ID` pada handler mutasi = 0; test dua tenant hijau.

**Gate S1:** build/typecheck; test S1.1–S1.3; webhook failure injection; dua tenant. **Rollback:** revert commit S1; feature flag `INGRESS_DURABLE_CLAIM=false` hanya darurat.

---

## 4. FASE S2 — Hardening P1

### Task S2.1 — Echo bot dari DB, bukan literal
| File | Aksi |
|---|---|
| `src/routes/webhook.route.ts:368-379` | Hapus literal `'Bunda, untuk kondisi darurat seperti ini'`, `'Pricelist'`, `'[IMAGE: Pricelist'`, `'[AUTOMATED]'`; gunakan `getTenantEchoPatterns(resolvedTenantId)` + pola teknis universal dari config/DB |
| Test | Tenant B: balasan bot tenant B tidak memicu `escalateToHumanHandling` |

### Task S2.2 — Error handler & 404
| File | Aksi |
|---|---|
| `src/app.ts` setelah `Fastify(...)` | Tambah `app.setErrorHandler` + `app.setNotFoundHandler`; log detail server, response generik |
| Test | 400 validasi, 500 internal tanpa stack, 404 JSON |

### Task S2.3 — Readiness provider-aware
| File | Aksi |
|---|---|
| `src/routes/health.route.ts:21-58` | Cek provider aktif: WAHA hanya jika provider WAHA; WABA token/tenant jika WABA; Redis/queue bila `SEPARATE_WORKER`/Redis aktif; timeout 2–3 dtk per check |
| Test | WABA-only → 200 bila DB+WABA sehat; WAHA down tidak memblok WABA |

### Task S2.4 — Boot init sebelum listen
| File | Aksi |
|---|---|
| `src/app.ts:246-276` | Ekstrak init tenant ke `src/lifecycle/tenant-bootstrap.ts`; panggil sebelum `server.listen`; worker memakai fungsi yang sama |
| `src/worker.ts:90-110` | Ganti loop duplikat dengan `initializeTenantRuntime()` |
| Acceptance | Request pertama tidak melihat cache kosong; init gagal → readiness false, bukan listen sukses |

### Task S2.5 — Worker shutdown order
| File | Aksi |
|---|---|
| `src/worker.ts:47-55` | Urutan: `clearAllIntervals` → `burstCoalesceService.flushAll()` → `queueService.close()` → `prisma.$disconnect()` |
| Acceptance | Sama dengan `src/lifecycle/shutdown.ts:56-63`; test urutan via mock |

**Gate S2:** build/typecheck; test S2.1–S2.5; smoke `buildApp` + `/ready`.

---

## 5. FASE S3 — Re-baseline Track A

**Tujuan:** semua temuan `D-`, `CFG-`, `UTL-`, `DOM-`, `ING-` diverifikasi ulang di `f3c6a2c4`, tidak ada duplikasi dengan Track B.

### Task S3.1 — Register status
| File | Aksi |
|---|---|
| `docs/plans/TRACK_A_REBASELINE_2026-11-09.md` (baru) | Tabel: ID, file:baris lama, status baru, bukti, Track B ID, catatan |
| Status | `FIXED`, `PARTIAL`, `OPEN`, `DUPLICATE`, `STALE` |

### Task S3.2 — Batch per modul
| Batch | Sumber | Fokus |
|---|---|---|
| A1 | `MODULE_AUDIT_01_DATA_ACCESS.md` | D-01–D-18; cek schema/repo |
| A2 | `MODULE_AUDIT_02_CONFIG.md` | CFG-01–CFG-20; cek persona, pricing, cache, hardcode |
| A3 | `MODULE_AUDIT_03_UTILS.md` | UTL-01–UTL-25; cek date, SSRF, regex, log, PII |
| A4 | `MODULE_AUDIT_04_DOMAIN.md` | DOM-01–DOM-15; cek reservation-status, address, location |
| A5 | `MODULE_AUDIT_05_INGRESS.md` | ING-01–ING-18; cek label, idempotency, echo, client, ready |

**Aturan:** baca kode aktual; jangan mengutip line lama tanpa verifikasi; jika line drift, catat line baru.
**Acceptance:** setiap ID punya status; temuan yang sudah ditangani Track B ditandai `DUPLICATE`; daftar `OPEN` menjadi backlog baru.

---

## 6. FASE S4 — Gap Audit (Read-Only) [SELESAI 2026-11-09]

Hanya area yang belum tercakup Track B. Seluruh 4 modul telah selesai diaudit secara mendalam (read-only) dengan format standar A–G.

| Task | Modul | Scope file | Status | Output & Bukti |
|---|---|---|---|---|
| S4.1 | State machine & conversation core | `src/state-machine/*`, `conversation.service.ts`, `message.service.ts`, dll. (12 file / 5.721 baris) | **SELESAI** | `docs/MODULE_AUDIT_06_STATE_MACHINE.md` (14 temuan SM-01..SM-14, skor 3.0/5, commit `62f64472`) |
| S4.2 | Follow-up & notification | `follow-up*.ts`, `shareloc-*.ts`, `alert.service.ts`, dll. (11 file / 6.033 baris) | **SELESAI** | `docs/MODULE_AUDIT_12_FOLLOWUP_NOTIF.md` (12 temuan FN-01..FN-12, skor 3.0/5, commit `a99c758d`) |
| S4.3 | Admin/staff API penuh | `src/routes/admin/*`, `src/routes/staff/*`, dll. (35 file / 21.725 baris) | **SELESAI** | `docs/MODULE_AUDIT_15_ADMIN_STAFF_API.md` (12 temuan API-01..API-12, 1 known: API-04, skor 2.5/5, commit `b8876012`) |
| S4.4 | Dashboard/tests/build/deploy/CI | `packages/admin-dashboard`, `Dockerfile`, `docker-compose.yml`, `Caddyfile`, deploy scripts (2.715 baris) | **SELESAI** | `docs/MODULE_AUDIT_16_DELIVERY.md` (12 temuan DEL-01..DEL-12, 1 known: DEL-04, skor 2.5/5, commit `d9c0ea59`) |

**Hasil Akhir S4:** 4 dokumen audit resmi diterbitkan, total **50 temuan (48 baru + 2 known/by-design: API-04, DEL-04)**, 0 baris kode runtime disentuh (kepatuhan read-only 100%). Koreksi pasca-review 2026-11-09 sudah diterapkan pada keempat laporan. Menunggu konfirmasi pengguna untuk eksekusi Fase S5.

---

## 7. FASE S5 — Fase 9: God Object & Data-Driven

**Prasyarat:** S0–S2 hijau; S4 selesai; S5.0 re-baseline selesai; persetujuan terpisah untuk migrasi DB.

### Task S5.0 — Re-baseline LiveChatMonitor (SELESAI 2026-11-09)
- Lokasi aktual terverifikasi: `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx` (8.127 baris, 427.033 bytes).
- Baseline build: `npm --prefix packages/admin-dashboard run build` PASS (Exit 0, 16.48s; chunk 305.58 kB).
- Baseline unit test frontend: `npx vitest run tests/unit/livechat-*.test.ts` PASS (20/20 test).
- Dokumen pemetaan lengkap: `docs/plans/REBASELINE_LIVECHAT_S5_2026-11-09.md`.

### Task S5.1 — Pecah `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx` (8.127 Baris) [SELESAI 2026-11-09]
| Langkah | Aksi | Target File | Status |
|---|---|---|---|
| 5.1.1 | Ekstrak hooks modular: draf chat & scroll tracker | `packages/admin-dashboard/src/hooks/useLiveChatDrafts.ts`, `useLiveChatScroll.ts` | **SELESAI** |
| 5.1.2 | Ekstrak Panel Kiri: Thread List, Header, Search & Filter Cards | `packages/admin-dashboard/src/components/livechat/LiveChatThreadList.tsx` (832 baris) | **SELESAI** |
| 5.1.3 | Ekstrak Panel Tengah: Chat Header, Alert Banners, Bubbles & Reactions | `packages/admin-dashboard/src/components/livechat/LiveChatMessagePane.tsx` (828 baris) | **SELESAI** |
| 5.1.4 | Ekstrak Modals & Dialogs Sekunder: Customer Detail, Payment Proof, Sync Info, Modals Orchestrator | `packages/admin-dashboard/src/components/livechat/LiveChatCustomerModal.tsx`, `LiveChatPaymentProofModal.tsx`, `LiveChatSyncModal.tsx`, `LiveChatMessageContextMenu.tsx`, `LiveChatModals.tsx` | **SELESAI** |
| 5.1.5 | Ekstrak Hooks Bisnis & Data: Threads, Active Thread, SSE, Message Ops, Composer/Invoice, Banners, Background Sync, Reservations & Detail, Bot & Labels | `useLiveChatThreads.ts`, `useLiveChatActiveThread.ts`, `useLiveChatSse.ts`, `useLiveChatMessageOperations.ts`, `useLiveChatComposerHandler.ts`, `useLiveChatBanners.ts`, `useLiveChatBackgroundSync.ts`, `useLiveChatReservations.ts`, `useLiveChatBotAndLabels.ts` | **SELESAI** |
| 5.1.6 | Hubungkan orchestrator utama `LiveChatMonitor.tsx` dengan seluruh sub-komponen dan hooks | `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx` (**1.211 baris**, turun dari 8.127 baris / -85%) | **SELESAI** |
| Acceptance | File utama < 1.500 baris (**1.211 baris**); `npm run build` dashboard PASS (Exit 0, 11.69s); unit test livechat PASS (**73/73 passing**); root `npm run build` PASS (Exit 0); commit `e15cf2ce`. | **PASS** |

### Task S5.2 — Katalog/SOP data-driven [SELESAI 2026-11-09]
*Catatan: seed database produksi tetap memerlukan backup + persetujuan operator; kode & dry-run sudah selesai.*
| Langkah | Aksi | Status |
|---|---|---|
| 5.2.1 | Audit 42 layanan di `src/services/treatment-catalog.service.ts:199-926` + 7 tier `delivery.service.ts` | **SELESAI** — 42 layanan; 39 nama "Kala" di-rebrand menjadi generik (`rg "Kala"` = 0); 7 tier tetap |
| 5.2.2 | Migration/seed eksplisit per tenant; hapus auto-seed diam-diam | **SELESAI** — `src/scripts/seed-tenant-catalog.ts` + `src/services/tenant-catalog-seed.service.ts` (dry-run default, `--commit`, `--brand`, upsert per `service_id`); auto-seed dihapus dari `loadServicesFromDb` & `getDeliveryTiersFromDb` |
| 5.2.3 | Dual-read + feature flag `USE_DB_CATALOG`; fallback hanya default tenant | **SELESAI** — DB sumber utama; `USE_DB_CATALOG=false` untuk rollback; fallback in-memory hanya `DEFAULT_TENANT_ID` dengan warning |
| 5.2.4 | Onboarding tenant baru: state "belum dikonfigurasi", bukan katalog Kala | **SELESAI** — tenant non-default tanpa baris DB = katalog kosong; delivery tanpa tier = pesan "belum dikonfigurasi" |
| Acceptance | `rg "Kala" src/services/treatment-catalog.service.ts` = 0; dua tenant berbeda katalog; seed dry-run 42 layanan + 7 tier; commit upsert atomik | **PASS** — unit test `tests/unit/s5-catalog-data-driven.test.ts` (12 test) |

**Gate S5:** build backend+dashboard PASS; test livechat & katalog hijau; dua tenant (unit) PASS; seed dry-run PASS; seed commit produksi PENDING (butuh DB + backup).

---

## 8. FASE S6 — Verifikasi & Penutupan

1. `npm run build` + `npm run typecheck`.
2. Full suite + baseline-diff; tidak ada failure baru.
3. `npm run security:scan` (`--all`) bersih.
4. Uji dua tenant: RBAC, settings, knowledge, webhook, media, marketing.
5. Uji backup/restore dari file terenkripsi; row-count.
6. Uji cron paralel + restart + alert.
7. Uji klinis: vaksin/demam, tool authz, commitment, treatment identity.
8. Uji perangkat fisik PWA staf (jika deploy).
9. Update `KNOWN_ISSUES`, `FEATURE_INVENTORY`, `CHANGELOG`, `docs/changelog/INDEX.md`.
10. Deploy staging → canary → produksi; migrasi dulu, app, worker terakhir.

### Status Verifikasi S6 (lokal, 2026-11-09)
| Gate | Status | Bukti |
|---|---|---|
| Build backend | **PASS** | `npm run build` exit 0 |
| Build dashboard | **PASS** | `npm --prefix packages/admin-dashboard run build` exit 0 (27,15 dtk) |
| Typecheck | **PASS** | `npm run typecheck` exit 0 |
| Unit S5.2 | **PASS** | `tests/unit/s5-catalog-data-driven.test.ts` 12/12 |
| Full suite | **PASS (lokal)\*** | 6.771 test / 6.738 lulus / 5 gagal / 28 skip; 2 pre-existing #287 + 3 flaky beban (`staff-auth`, `media-mime`, `production_edge_cases`) yang lulus terisolasi; 0 regresi S5.2 |
| Security scan | **PASS** | `npm run security:scan` — 2.035 file, 0 kebocoran |
| Dua tenant (unit) | **PASS** | katalog A/B berbeda; tenant tanpa data = unconfigured |
| Backup/restore | **PENDING** | butuh DB aktif |
| Cron paralel/restart | **PENDING** | butuh DB + Redis |
| PWA perangkat fisik | **PENDING** | butuh staging |
| Seed `--commit` produksi | **PENDING** | butuh backup + persetujuan operator |
| Deploy staging → canary → produksi | **PENDING** | di luar sesi lokal |

\* Full suite dijalankan saat working tree juga memuat perubahan zipcode dari sesi paralel; hasil S5.2 sendiri (12 test) dan targeted regression hijau. Jalankan ulang full suite setelah semua perubahan di-commit untuk gate final yang bersih.

**Definition of Done:**
- [x] S0 gate hijau; `KNOWN_ISSUES` #320 akurat.
- [x] S1 P0 (W-003, W-005, Cfg-012) selesai + test.
- [x] S2 P1 selesai.
- [x] S3 register Track A selesai; tidak ada duplikasi.
- [x] S4 gap audit selesai (4 laporan).
- [x] S5 Fase 9 selesai atau dijadwalkan dengan approval.
- [ ] S6 semua gate lulus (lokal PASS; staging/production PENDING).
- [x] Tidak ada dependency runtime baru.

---

## 9. Register Risiko (FMEA Ringkas)

| Risiko | S | O | D | RPN | Mitigasi |
|---|---:|---:|---:|---:|---|
| Perubahan idempotensi menggandakan pesan | 9 | 4 | 3 | 108 | Test enqueue throw/retry; release claim eksplisit |
| Client WAHA per tenant salah session | 9 | 4 | 3 | 108 | Test dua tenant; fallback hanya default |
| Cfg-012 memblokir admin sah | 7 | 5 | 2 | 70 | `requireTenantId` + test super-admin; pesan 400 jelas |
| Readiness baru false-negative | 7 | 4 | 2 | 56 | Timeout + test provider |
| Pecah LiveChatMonitor merusak UI | 8 | 5 | 3 | 120 | Ekstrak bertahap + test render/interaction |
| Migrasi katalog kehilangan data | 9 | 3 | 3 | 81 | Dry-run + backup + approval |

---

## 10. Confirmation Gate

Plan ini **tidak boleh dieksekusi** sebelum pengguna mengetik salah satu:

- `Setuju` / `Lanjut` / `Eksekusi` untuk **S0 saja**, atau
- `Setuju S0–S1`, atau
- persetujuan per fase.

Auto-approval hook sistem **bukan** persetujuan.

**Rekomendasi mulai:** **S0** (rekonsiliasi gate) karena semua fase lain bergantung pada baseline yang valid.
