# PLAN PENYELESAIAN AUDIT — 2026-11-09

- **Status:** **DRAFT — BELUM DIEKSEKUSI.** Wajib persetujuan eksplisit pengguna (`Setuju` / `Lanjut` / `Eksekusi`) sebelum menyentuh kode.
- **Baseline:** `f3c6a2c4` (`master`), working tree bersih.
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

## 6. FASE S4 — Gap Audit (Read-Only)

Hanya area yang belum tercakup Track B. Setiap audit berhenti setelah laporan dan menunggu perintah.

| Task | Modul | Scope file | Output |
|---|---|---|---|
| S4.1 | State machine & conversation core | `src/state-machine/*`, `src/services/conversation.service.ts`, `message.service.ts`, `command.service.ts`, `burst-coalesce.service.ts`, `typing.service.ts`, `response-cache.service.ts`, `outbound-ledger.service.ts`, `turn-recovery.service.ts`, `greeting-template.service.ts` | `docs/MODULE_AUDIT_06_STATE_MACHINE.md` |
| S4.2 | Follow-up & notification | `src/services/follow-up*.ts`, `shareloc-*.ts`, `alert.service.ts`, `notification-*.ts`, `staff-notification.service.ts`, `telegram.service.ts`, `web-push.service.ts` | `docs/MODULE_AUDIT_12_FOLLOWUP_NOTIF.md` |
| S4.3 | Admin/staff API penuh | `src/routes/admin/*`, `src/routes/staff/*`, `admin.route.ts`, `staff.route.ts` | `docs/MODULE_AUDIT_15_ADMIN_STAFF_API.md` |
| S4.4 | Dashboard/tests/build/deploy/CI | `packages/admin-dashboard`, `tests`, `Dockerfile`, `docker-compose.yml`, `Caddyfile`, deploy scripts, CI | `docs/MODULE_AUDIT_16_DELIVERY.md` |

**Aturan:** read-only; format A–G; minimal 3 Before/After; katalog reuse; file belum dibaca; berhenti setelah laporan.

---

## 7. FASE S5 — Fase 9: God Object & Data-Driven

**Prasyarat:** S0–S2 hijau; S4 selesai; persetujuan terpisah untuk migrasi DB.

### Task S5.1 — Pecah `LiveChatMonitor.tsx`
| Langkah | Aksi |
|---|---|
| 5.1.1 | Inventaris section & dependency via `rg`; catat line range aktual (jangan menebak) |
| 5.1.2 | Ekstrak hooks: `useLiveChatThreads`, `useLiveChatSse`, `useLiveChatFilters` ke `src/hooks/` |
| 5.1.3 | Ekstrak komponen: `ThreadList`, `MessagePane`, `Composer`, `CustomerSidebar` |
| 5.1.4 | Pertahankan props/behavior; test render + interaction |
| Acceptance | File utama < 1.500 baris; build dashboard; test livechat hijau |

### Task S5.2 — Katalog/SOP data-driven
| Langkah | Aksi |
|---|---|
| 5.2.1 | Audit 42 layanan di `src/services/treatment-catalog.service.ts:199-926` + 7 tier `delivery.service.ts:22-30`; petakan ke tabel `Treatment`/delivery tier |
| 5.2.2 | Migration/seed eksplisit per tenant; hapus auto-seed diam-diam |
| 5.2.3 | Dual-read + feature flag `USE_DB_CATALOG`; fallback hanya untuk tenant default dengan peringatan |
| 5.2.4 | Onboarding tenant baru: state “belum dikonfigurasi”, bukan katalog Kala |
| Acceptance | `rg "Kala" src/services/treatment-catalog.service.ts` = 0 atau hanya dokumentasi; dua tenant berbeda katalog |

**Gate S5:** build backend+dashboard; test katalog; dua tenant; migration dry-run + approval.

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

**Definition of Done:**
- [ ] S0 gate hijau; `KNOWN_ISSUES` #320 akurat.
- [ ] S1 P0 (W-003, W-005, Cfg-012) selesai + test.
- [ ] S2 P1 selesai.
- [ ] S3 register Track A selesai; tidak ada duplikasi.
- [ ] S4 gap audit selesai (4 laporan).
- [ ] S5 Fase 9 selesai atau dijadwalkan dengan approval.
- [ ] S6 semua gate lulus.
- [ ] Tidak ada dependency runtime baru.

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
