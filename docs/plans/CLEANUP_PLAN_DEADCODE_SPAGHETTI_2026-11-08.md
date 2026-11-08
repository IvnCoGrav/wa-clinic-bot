# Rencana Perbaikan Bertahap — Dead Code & Spaghetti Code

- **Status:** DRAFT — **belum ada eksekusi kode**. Menunggu persetujuan eksplisit pengguna.
- **Tanggal basis audit:** 2026-11-08 (setelah commit `f3c6a2c4`, push ke `origin/master`).
- **Dasar temuan:** scan read-only `src/` (369 file TS), `packages/admin-dashboard/src`, dan `tests/`.
- **Prinsip wajib:** perbaikan fondasional, tenant-aware, tanpa dependency runtime baru, tanpa solusi "DILARANG..." di prompt, TDD untuk perubahan perilaku, dan **regression gate per fase**.
- **Larangan dalam plan ini:** tidak menyentuh `prisma/schema.prisma` kecuali disebut eksplisit; tidak deploy ke server live; tidak menyentuh label WAHA.

---

## 0. Metrik Baseline (2026-11-08)

| Indikator | Baseline | Target akhir |
|---|---|---|
| File yatim (0 rujukan) | 0 | 0 |
| Export mati (0 rujukan sama sekali) | 37 | 0 |
| Fungsi sanitizer mati di runtime | 13 dari 14 | 0 |
| Endpoint deprecated masih terdaftar | 2 (GET/PATCH `purchase-moderation`) | 0 |
| File > 1.500 baris | 17 | 0 |
| Fungsi ≥ 120 baris | 112 | ≤ 20 |
| Nesting ≥ 7 level | 48 | ≤ 10 |
| Grup duplikasi ≥ 16 baris lintas file | 32 (13 lintas batas, 19 dalam runtime yang sama) | 0 dalam runtime yang sama |
| `TODO(tenant-aware)` aktif | 8 | 0 |
| Test di-skip | 24 | ≤ 5 (hanya DB-gated) |
| Diagnostik `--noUnusedLocals` | 234 | 0 |

**Catatan koreksi:** angka "10 TODO" pada laporan awal keliru — 3 di antaranya adalah string nominal `Rp XX.XXX` yang ikut ter-match pola `XXX`. Jumlah riil `TODO/FIXME/HACK` = **8**.

---

## 1. Confirmation Gate (D1–D7)

| ID | Pertanyaan | Rekomendasi | Dampak bila salah |
|---|---|---|---|
| **D1** | Nasib `src/utils/language-sanitizer.ts` (13 dari 14 fungsi mati di runtime) | **Opsi A:** sambungkan 2 fungsi teknis yang aman (`stripNonIndonesianScripts`, `sanitizeStrayBackslashes`) ke `OutputSanitizer.cleanOutboundReply`; hapus 11 sisanya + test-nya; `sanitizeEmDash` tetap | Menyambungkan fungsi semantik (pengganti kata) berisiko mutilasi kalimat — dilarang mandat |
| **D2** | Endpoint `GET/PATCH /api/admin/purchase-moderation` + toggle UI | **Hapus endpoint + toggle** (Queue-First satu-satunya jalur). Kolom `Tenant.auto_send_purchase_capi` **tidak** di-drop (hindari migrasi berisiko); catat di `KNOWN_ISSUES` | Toggle palsu tetap ada = admin mengira bisa mengubah kebijakan yang sebenarnya selalu `false` |
| **D3** | Urutan pemecahan God Object | Backend dulu: `reservation-dispatch` → `settings.subroute` → `customer.service`; dashboard belakangan | Memecah dashboard (7.751 baris) lebih dulu → risiko regresi UI tanpa jaring E2E |
| **D4** | Metode refactor dashboard | **Mechanical extraction**: pindahkan blok verbatim, satu ekstraksi per commit, tanpa ubah perilaku | Refactor + ubah perilaku sekaligus = sulit membedakan penyebab regresi |
| **D5** | Duplikasi lintas batas backend ↔ dashboard (13 grup) | **Pertahankan** (tidak ada paket shared; membuat paket shared = infrastruktur baru → butuh approval terpisah) | Memaksa share = build/bundling berubah, blast radius besar |
| **D6** | 24 test di-skip | Triase: DB-gated tetap; obsolete (handler lama) dihapus; "manual LLM live" ditulis ulang jadi fixture offline bila memungkinkan | Menghapus test yang masih relevan = kehilangan jaring pengaman |
| **D7** | Penegakan `--noUnusedLocals` di CI | Non-blocking report dulu (Fase 0), blocking setelah Fase 6 selesai | Menjadikan blocking sekarang = CI merah 234 error |

**Aturan:** plan ini tidak dieksekusi sebelum pengguna mengetik persetujuan eksplisit, mis. `"Setuju D1 Opsi A, eksekusi Fase 0 dan 1"`.

---

## 2. Peta Fase & Dependensi

| Fase | Fokus | Blast radius | Prasyarat | Estimasi |
|---|---|---|---|---|
| 0 | Baseline, artefak, alat audit | rendah (tanpa ubah runtime) | — | 0,5 hari |
| 1 | Hapus dead code & fitur deprecated | rendah | Fase 0, D1, D2 | 1–2 hari |
| 2 | Pecah God Object backend | sedang–tinggi (routing admin) | Fase 1, D3 | 6–9 hari |
| 3 | Pecah God Object dashboard | tinggi (UI) | Fase 2, D4 | 8–12 hari |
| 4 | Deduplikasi dalam runtime yang sama | sedang | Fase 2, 3, D5 | 3–4 hari |
| 5 | Tuntaskan `TODO(tenant-aware)` | sedang (klinis + config) | Fase 1 | 3–5 hari |
| 6 | Test hygiene & unused diagnostics | rendah | Fase 1–5, D6, D7 | 2–3 hari |
| 7 | Verifikasi menyeluruh & dokumentasi | — | semua | 1 hari |

**Aturan gate per fase (wajib):**
```powershell
npm run build
npm run typecheck
npx vitest run tests/unit/<test-terkait>.test.ts
npm run security:scan -- --all
npx vitest run --reporter=json --outputFile=docs/audit/2026-11-08/after-fase-X.json
# bandingkan dengan baseline; failure baru = STOP
```
Klaim "pre-existing" wajib dibuktikan dengan **revert-and-rerun** (kembalikan file ke HEAD, jalankan test yang sama, harus tetap gagal).

---

## 3. Micro-Tasks

### FASE 0 — Baseline & Alat Audit

**0.1 Buat direktori artefak**
```powershell
New-Item -ItemType Directory -Force docs\audit\2026-11-08 | Out-Null
```

**0.2 Simpan baseline full suite**
```powershell
npx vitest run --reporter=json --outputFile=docs/audit/2026-11-08/baseline-cleanup.json
```
- Acceptance: `numTotalTests = 6724`, `numFailedTests = 2` (keduanya di `tests/unit/hybrid-reservation-parser.test.ts`, isu #287).

**0.3 Simpan laporan diagnostik unused**
```powershell
npx tsc --noEmit --noUnusedLocals --noUnusedParameters --pretty false > docs\audit\2026-11-08\unused-locals-before.txt 2>&1
```
- Acceptance: file berisi 234 baris `TS6133|TS6196|TS6192`.

**0.4 Simpan laporan dead code**
- Buat `scripts/audit-deadcode.mjs` (tooling, bukan runtime dependency) yang menghasilkan:
  - daftar export tanpa rujukan,
  - daftar export yang hanya dipakai test,
  - daftar file tanpa rujukan.
- Acceptance: output JSON tersimpan di `docs/audit/2026-11-08/deadcode-before.json`, isinya sama dengan temuan manual (37 dead export).

**0.5 Buat branch kerja**
```powershell
git switch -c chore/cleanup-deadcode-spaghetti
```
- Acceptance: `git status -sb` bersih.

**Gate Fase 0:** baseline tersimpan, branch aktif, tidak ada perubahan kode.

---

### FASE 1 — Hapus Dead Code & Fitur Deprecated

#### 1.1 Hapus 37 export mati

Hapus **deklarasi + kata `export`** (bila isinya masih dipakai internal, cukup hapus `export`). Daftar final (terverifikasi 1 rujukan = definisi itu sendiri):

| File | Baris | Simbol | Aksi |
|---|---|---|---|
| `src/config/ai-models.config.ts` | 33 | `KENARI_SECONDARY_MODEL` | hapus |
| `src/config/ai-models.config.ts` | 37 | `DISPLAY_MODEL_LABEL` | hapus |
| `src/config/brand.ts` | 89 | `setBrandIdentity` | hapus |
| `src/config/brand.ts` | 94 | `resetBrandIdentity` | hapus |
| `src/config/staff-chat-config.ts` | 116 | `clearStaffChatConfigCache` | hapus |
| `src/domain/reservation-status.ts` | 1 | `PAUSED_STATUS` | hapus |
| `src/domain/reservation-status.ts` | 13 | `ActiveReservationStatus` | hapus |
| `src/domain/reservation-status.ts` | 46 | `activeHoldCutoff` | hapus |
| `src/integrations/whatsapp/types.ts` | 1 | `WebhookVerificationQuery` | hapus |
| `src/routes/admin.route.ts` | 52 | `clearAdminStaticCache` | hapus |
| `src/routes/admin/stores.ts` | 118 | `stopLoginAttemptsCleanupTimer` | hapus |
| `src/services/capi.service.ts` | 700 | `MetaRepeatDecision` | hapus |
| `src/services/capi.service.ts` | 791 | `getTenantAutoSendPurchaseCapi` | hapus |
| `src/services/keyword-enrichment.service.ts` | 246 | `enrichTenantKeywords` | hapus `export` (masih dipakai `scripts/enrich-kb-and-bank-chat-keywords.ts`) |
| `src/services/llm-evaluator.service.ts` | 37 | `EvalResult` | hapus |
| `src/services/location-resolver.service.ts` | 106 | `resolveFirstMapsUrlInText` | hapus |
| `src/services/meta-performance-analytics.service.ts` | 1537 | `_internal` | hapus |
| `src/services/migration.service.ts` | 11 | `parseTimestampSafe` | hapus |
| `src/services/sheets/sheets-client.ts` | 94 | `parseRowIndexFromRange` | hapus |
| `src/services/whatsapp-provider.service.ts` | 18 | `WAHA_STATUS_WITHOUT_QR` | hapus |
| `src/types/telemetry.ts` | 37 | `HealthStatus` | hapus |
| `src/utils/env-numeric.ts` | 18 | `parseNonNegativeNumber` | hapus |
| `src/utils/gazetteer-zipcode-resolver.ts` | 213 | `getKecamatanRepresentativeMap` | hapus |
| `src/utils/gazetteer.ts` | 390 | `getGazetteerZipcode` | hapus |
| `src/utils/typo-match.ts` | 29 | `isSkippedGeoToken` | hapus |
| `src/v3/agent/prompt/layers/core-persona.layer.ts` | 146 | `TONE_NEG_CONSTRAINTS` | hapus |
| `src/v3/agent/prompt/phases/location-rules.phase.ts` | 113 | `FEE_INFORMATION_HIDING_PIN` | hapus |
| `src/v3/agent/prompt/phases/scheduling.phase.ts` | 33 | `SCHEDULE_NEG_CONSTRAINTS_HEAD` | hapus |
| `src/v3/domain/types.ts` | 260 | `TurnInterpretation` | hapus |
| `src/v3/state/goal-tracker.ts` | 89 | `__getMemorySessionsMap` | hapus |
| `src/v3/state/goal-tracker.ts` | 92 | `__getMemorySessionTimestampsMap` | hapus |

Sisanya (6 fungsi sanitizer) ditangani di 1.2 sesuai keputusan **D1**.

**Acceptance 1.1:**
```powershell
npx tsc --noEmit
npm run build
```
exit 0; `git grep` untuk setiap nama mengembalikan 0 hasil di `src/`.

#### 1.2 Bersihkan `src/utils/language-sanitizer.ts` (D1)

| Simbol | Baris | Status runtime | Aksi Opsi A |
|---|---|---|---|
| `stripNonIndonesianScripts` | 30 | mati | **sambungkan** ke `cleanOutboundReply` |
| `containsForeignScripts` | 39 | mati | hapus (tidak dipakai) |
| `stripAiReasoningAndMonologue` | 48 | mati | hapus (sudah ada `monologuePatterns` di `cleanOutboundReply`) |
| `sanitizeRagLeakage` | 79 | mati | hapus (sudah ada `stripInternalInstructionArtifacts`) |
| `sanitizeForbiddenEnglishWords` | 92 | mati | hapus (penggantian kata mid-sentence dilarang mandat) |
| `sanitizeHallucinatedTerms` | 112 | mati | hapus |
| `sanitizeRepetitiveGreetings` | 135 | mati | hapus (sudah ada `sanitizeFollowUpGreetingRepetition`) |
| `sanitizeEmDash` | 162 | **aktif** | pertahankan |
| `sanitizeStrayBackslashes` | 177 | mati | **sambungkan** ke `cleanOutboundReply` |
| `sanitizePronounsAndSlang` | 190 | mati | hapus (sudah ada `detectFirstPersonSlip` + `sanitizeFirstPersonPronoun`) |
| `sanitizeGreetingRepetitionForFollowUp` | 222 | mati | hapus (duplikat `OutputSanitizer.sanitizeFollowUpGreetingRepetition`) |
| `stripDuplicateTurn0Greeting` | 235 | mati | hapus |
| `formatParagraphsAfterEmoji` | 249 | mati | hapus (sudah ada aturan Enter-setelah-emot di `cleanOutboundReply`) |
| `sanitizeDoubleQuestions` | 268 | mati | hapus |

**Micro-task:**
1. `src/v3/guardrails/sanitizer.ts` — di dalam `cleanOutboundReply`, **sebelum baris 216** (komentar `// 6. Normalisasi spasi dan baris baru berlebih`), tambahkan:
   ```ts
   text = sanitizeStrayBackslashes(text);
   text = stripNonIndonesianScripts(text);
   ```
   Tambahkan import di kepala file:
   ```ts
   import { sanitizeStrayBackslashes, stripNonIndonesianScripts } from '../../utils/language-sanitizer';
   ```
2. Hapus 12 fungsi dari `language-sanitizer.ts` (semua kecuali `sanitizeEmDash`, `stripNonIndonesianScripts`, `sanitizeStrayBackslashes`).
3. Hapus `tests/unit/language-sanitizer.test.ts` dan `tests/unit/language-sanitizer-fixes.test.ts`, **ganti** dengan `tests/unit/language-sanitizer-active.test.ts` yang hanya menguji 3 fungsi aktif.
4. `tests/unit/lead-greeting-preservation.test.ts:209` — ganti pemanggilan `sanitizeGreetingRepetitionForFollowUp` → `OutputSanitizer.sanitizeFollowUpGreetingRepetition`.

**Acceptance 1.2:**
```powershell
npx vitest run tests/unit/language-sanitizer-active.test.ts tests/unit/lead-greeting-preservation.test.ts tests/unit/v3/guardrail-pipeline.test.ts
```
Semua hijau; tambahkan fixture yang membuktikan aksara Mandarin dan `\Bundlebih` hilang dari output `cleanOutboundReply`.

#### 1.3 Hapus fitur `purchase-moderation` (D2)

| File | Baris | Aksi |
|---|---|---|
| `src/routes/admin/settings.subroute.ts` | 2204–2223 | hapus handler GET |
| `src/routes/admin/settings.subroute.ts` | 2225–2280± | hapus handler PATCH |
| `packages/admin-dashboard/src/pages/tenant/Settings.tsx` | 132 | hapus state `autoSendPurchaseCapi` |
| `packages/admin-dashboard/src/pages/tenant/Settings.tsx` | 228–261 | hapus `loadPurchaseModeration` + `handleSavePurchaseModeration` |
| `packages/admin-dashboard/src/pages/tenant/Settings.tsx` | 921 | hapus prop `autoSendPurchaseCapi` |
| `packages/admin-dashboard/src/components/settings/MetaCapiPanel.tsx` | 15, 32, dst. | hapus prop + toggle |

**Acceptance 1.3:**
```powershell
git grep -n "purchase-moderation" -- src packages
```
0 hasil; `npm run build` dan build dashboard exit 0; test `tests/unit/capi-config-admin.test.ts`, `tests/unit/capi-queue-first-workflow.test.ts`, dan `tests/unit/settings-tenant-scope.test.ts` hijau.

#### 1.4 Hapus `morningReminder` deprecated
- `src/config/persona.ts:583–591` — hapus properti `morningReminder` beserta komentarnya.
- Acceptance: `git grep -n "morningReminder" -- src` = 0.

#### 1.5 Hapus metode label WAHA yang mati
Terverifikasi **0 pemanggilan** di jalur produksi (hanya definisi + mock).

| File | Baris | Aksi |
|---|---|---|
| `src/integrations/waha/client.ts` | 57–60 | hapus deklarasi `addLabel`/`removeLabel` dari interface |
| `src/integrations/waha/client.ts` | 653–745 | hapus implementasi `addLabel` |
| `src/integrations/waha/client.ts` | 750–816 | hapus implementasi `removeLabel` |
| `src/integrations/waha/client.ts` | 818–900± | audit `batchUpdateLabels`: bila 0 pemanggil → hapus |
| `src/cli/mock-waha-client.ts` | 70–78 | hapus implementasi mock |
| `src/routes/admin/evaluations.subroute.ts` | 83–90 | hapus `addLabel`/`removeLabel` dari mock object |

**Acceptance 1.5:** `git grep -n -E "\.addLabel\(|\.removeLabel\(" -- src` = 0; build exit 0; test WAHA/gateway hijau.

#### 1.6 Hapus export `_internal` (test hook tak terpakai)
- `src/services/meta-performance-analytics.service.ts:1537` — sudah tercakup 1.1.

**Gate Fase 1:**
```powershell
npm run build
npm run typecheck
npm run security:scan -- --all
npx vitest run --reporter=json --outputFile=docs/audit/2026-11-08/after-fase-1.json
```
- Acceptance: 0 failure baru vs baseline; jumlah export mati = 0.

---

### FASE 2 — Pecah God Object Backend

> **Aturan umum:** satu file target per commit. Pindahkan kode **verbatim**, jangan ubah logika. Setelah setiap pemindahan, jalankan test yang meng-boot app (`tests/integration/**`) untuk menangkap rute ganda/hilang.

#### 2.1 `src/routes/admin/reservation-dispatch.route.ts` (3.054 → target ≤ 400 baris/file)

**Struktur saat ini:** helper `49–196`, satu fungsi raksasa `reservationDispatchRoutes` `198–3244` dengan 18 rute.

**Target direktori:** `src/routes/admin/reservation-dispatch/`

| File baru | Sumber baris | Isi |
|---|---|---|
| `shared.ts` | 49–196 | `withPaymentEvaluation`, `completeReservationById`, `runCompletionSideEffects`, `BULK_COMPLETE_MAX_IDS` |
| `trip.route.ts` | 204–366 | `GET /api/admin/dispatch/trip/:reservationId` |
| `hold-archive.route.ts` | 367–502 | release-hold, archive list, archive restore |
| `detail.route.ts` | 503–608 | `GET /api/admin/reservation/:id` |
| `lifecycle.route.ts` | 609–937 | confirm, complete, bulk-complete |
| `update.route.ts` | 938–1706 | `PATCH /api/admin/reservation/:id` (769 baris → pecah lagi jadi `update-operations.ts` per operasi) |
| `status.route.ts` | 1707–1987 | status, set-date |
| `proof-assign.route.ts` | 1988–2176 | proof, assign-staff |
| `delete.route.ts` | 2177–2374 | `DELETE /api/admin/reservation/:id` |
| `purchase.route.ts` | 2375–2827 | approve/reject/unreject purchase |
| `capi-queue.route.ts` | 2828–3054 | `GET /api/admin/capi-queue` |
| `index.ts` | baru | registrasi semua modul + re-export `reservationDispatchRoutes` |

**Micro-task 2.1:**
1. Buat folder + `shared.ts`, pindahkan helper 49–196; update import di pemakai.
2. Pindahkan rute per tabel di atas; setiap file mengekspor `export async function registerXxxRoutes(fastify: FastifyInstance)`.
3. `index.ts` memanggil semua registrar; `export default reservationDispatchRoutes`.
4. Hapus file lama; update `src/routes/admin.route.ts` (atau pemanggil) bila path import berubah.
5. **Pecah `update.route.ts`**: inventaris operasi di dalam handler 938–1706 (mis. update tanggal, jam, layanan, alamat, catatan, diskon). Ekstrak tiap operasi ke `update-operations.ts` sebagai fungsi murni `(payload, ctx) => Promise<Result>`.

**Acceptance 2.1:**
```powershell
npx vitest run tests/integration tests/unit/admin-reservation*.test.ts tests/unit/reservation*.test.ts
npm run build
```
- Semua path rute identik (`git grep "'/api/admin/"` pada folder baru = 18 kecocokan).
- Tidak ada error Fastify `FST_ERR_DUPLICATED_ROUTE`.
- `reservation-dispatch.route.ts` terhapus; tidak ada file > 800 baris di folder baru.

#### 2.2 `src/routes/admin/settings.subroute.ts` (2.582 → 57 rute)

Kelompokkan berdasarkan prefix (hasil inventaris):

| File baru | Prefix rute | Jumlah |
|---|---|---|
| `settings/notifications.route.ts` | `settings/notifications`, `settings/daily-report`, `settings/telegram` | 8 |
| `settings/ai-models.route.ts` | `ai-models*`, `ai-rollout-scope` | 7 |
| `settings/persona.route.ts` | `persona*`, `few-shots*` | 8 |
| `settings/pricelist.route.ts` | `services*`, `settings/pricelist-*`, `delivery-tiers` | 10 |
| `settings/capi.route.ts` | `capi-config`, `settings/meta-purchase-policy`, `settings/mql` | 6 |
| `settings/clinic.route.ts` | `settings/clinic-policies`, `settings/conversation-behavior`, `settings/payment-info`, `settings/media`, `customer-service`, `health` | 9 |
| `settings/index.ts` | registrasi | — |

**Micro-task:** inventaris dulu dengan
```powershell
git grep -n "'/api/admin/" -- src/routes/admin/settings.subroute.ts
```
lalu pindahkan per kelompok. **Acceptance:** 57 path identik, build exit 0, test `tests/unit/settings-tenant-scope.test.ts`, `tests/unit/settings-conversation-behavior.test.ts`, `tests/unit/ai-model-settings.test.ts`, dan `tests/unit/admin-payment-info-settings.test.ts` hijau.

#### 2.3 `src/services/customer.service.ts` (3.021 baris, 33 metode publik)

| File baru | Metode (baris awal) |
|---|---|
| `customer/labels.service.ts` | `setChatLabelFlag` 94, `markInternalStaffCustomer` 134, `setLabelFlags` 164 |
| `customer/location.service.ts` | `updateCustomerLocation` 282, `markShareLocationSent` 720, `updateCustomerPendingLocation` 743, `clearPendingLocation` 805, `resetFullLocation` 824, `promotePendingLocation` 879, `refreshCustomerLocationAndOngkir` 2658 |
| `customer/address.service.ts` | `getSavedAddresses` 1656, `upsertSavedAddress` 1666, `addSavedAddress` 1690, `setDefaultAddress` 1706, `resolveActiveSavedAddress` 1721, `deleteSavedAddress` 1736 |
| `customer/profile.service.ts` | `getOrCreateCustomer` 201, `updateCustomerName` 1061, `updateCustomer` 1136, `setAiOverride` 1511, `blockCustomer` 1002, `unblockCustomer` 1029, `updateProfilePicture` 3054, `syncProfilePictureInBackground` 3004 |
| `customer/query.service.ts` | `getCustomerById` 1532, `getCustomerByPhone` 1559, `listCustomersWithLtvAndAdClick` 2205, `getCustomerStats` 2515, `computeCustomerLtv` 2570, `recalculateCustomerLtv` 2578, `backfillAllLtvCache` 2593, `getCustomerGroundTruth` 2606, `getLastDeliveryFee` 3085 |
| `customer/mql.service.ts` | `getMqlSettings` 2011, `updateMqlSettings` 2026, `incrementCustomerMessageCount` 2066, `mergeCustomerPreferences` 1810 |

`customer.service.ts` menjadi facade yang mendelegasikan ke modul (kontrak kanonis tetap satu).

**Acceptance:** semua pemanggil `customerService.*` tidak berubah; test `tests/unit/customer*.test.ts` + `tests/integration/**` hijau.

#### 2.4 `src/services/staff-reservation.service.ts` (2.780 baris, kelas mulai baris 462)
Pecah berdasarkan domain: `task-builder` (128–460 fungsi murni), `queue`, `assignment`, `trip-tracking`, `checkin-complete`, `reporting`. Lakukan inventaris metode dulu:
```powershell
git grep -n -E "^\s{2}(public |private )?(async )?[a-zA-Z0-9_]+\(" -- src/services/staff-reservation.service.ts
```

#### 2.5 `src/services/follow-up.service.ts` (2.679 baris, 26 metode publik)
Pecah: `templates` (151–242), `creation` (409–1147), `scheduler` (1317–1673), `executor` (1937–2625), `maintenance` (2626–end).

#### 2.6 File backend lain (prioritas setelah 2.1–2.5)
- `src/services/message.service.ts` (2.010)
- `src/services/treatment-catalog.service.ts` (2.287)
- `src/routes/admin/customers.subroute.ts` (1.869, 27 rute)
- `src/services/copilot/copilot-tools.ts` (1.659)
- `src/integrations/waha/client.ts` (1.595) — sisa setelah Fase 1

**Gate Fase 2:** `npm run build` + `npm run typecheck` + full suite dengan 0 failure baru; tidak ada file > 1.500 baris di `src/`.

---

### FASE 3 — Pecah God Object Dashboard

#### 3.1 `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx` (7.751 baris)

**Struktur:** helper `124–262`, draft/scroll `666–727`, state+logika `347–4427`, JSX `4428–7751`. **89 `useState`, 43 `useEffect`, 55 `useRef`** dalam satu komponen.

**Target ekstraksi (urutan aman, satu per commit):**

| Langkah | File baru | Sumber | Isi |
|---|---|---|---|
| 3.1a | `utils/liveChatFormatting.ts` | 150–262 | `renderHighlightedText`, `cleanSnippetText`, `extractSmartSearchSnippet`, `formatChatDateSeparator`, `isDifferentDay`, `extractQuotedMessage` |
| 3.1b | `utils/liveChatDraft.ts` | 666–727 | draft + scroll position helpers |
| 3.1c | `hooks/useLiveChatConversations.ts` | state daftar chat, filter, SSE, `loadChats` | data layer |
| 3.1d | `hooks/useLiveChatThread.ts` | `loadThread`, pagination cursor, optimistic bubbles | data layer |
| 3.1e | `components/livechat/ChatListPanel.tsx` | JSX mulai 4582 | panel kiri |
| 3.1f | `components/livechat/ChatWindow.tsx` | JSX mulai 5413 | panel kanan |
| 3.1g | `components/livechat/CustomerInfoPanel.tsx` | panel detail customer | panel kanan-atas |

**Acceptance 3.1:** build dashboard exit 0; `LiveChatMonitor.tsx` ≤ 800 baris; smoke manual: buka daftar chat, buka thread, kirim pesan, infinite scroll, pencarian, buka modal reservasi.

#### 3.2 `packages/admin-dashboard/src/pages/staff/StaffToday.tsx` (6.098 baris, 67 `useState`)
Ekstrak: `hooks/useStaffTodayTasks.ts`, `hooks/useStaffTrip.ts`, `components/staff/TaskCard.tsx`, `components/staff/TaskDetailModal.tsx`, `components/staff/TripPanel.tsx`.

#### 3.3 `packages/admin-dashboard/src/components/calendar/CreateReservationModal.tsx` (3.236 baris, 48 `useState`)
Ekstrak: `hooks/useReservationDraft.ts`, `components/calendar/ReservationFormFields.tsx`, `components/calendar/DeliveryFeeSection.tsx`, `components/calendar/SchedulePicker.tsx`.

#### 3.4 Sisanya (setelah 3.1–3.3)
`TodayTreatments.tsx` (2.332), `Reservations.tsx` (2.144), `CustomerDatabase.tsx` (1.641), `StaffManagement.tsx` (1.519).

**Gate Fase 3:** `cd packages/admin-dashboard; npm run build` exit 0; tidak ada file > 1.500 baris di dashboard; smoke manual per halaman.

---

### FASE 4 — Deduplikasi (dalam runtime yang sama)

| # | Duplikasi | Lokasi | Aksi |
|---|---|---|---|
| 4.1 | Auth context (4 blok) | `contexts/AuthContext.tsx:67,95,149,183` ↔ `contexts/StaffAuthContext.tsx:42,69,111,143` | Ekstrak `hooks/useSessionRestore.ts` + `utils/authStorage.ts` |
| 4.2 | Halaman login | `pages/auth/Login.tsx:77` ↔ `pages/staff/StaffLogin.tsx:73` | Ekstrak `components/auth/LoginForm.tsx` |
| 4.3 | Grid jadwal | `components/calendar/DayScheduleGrid.tsx:179,209` ↔ `WeekScheduleGrid.tsx:70,100` | Ekstrak `components/calendar/scheduleSlots.ts` |
| 4.4 | Blok chat | `pages/staff/StaffToday.tsx:2206,2243,5341,6186,6202,6222` ↔ `LiveChatMonitor.tsx:2847,2884,7944,7960,7980` ↔ `TodayTreatments.tsx:1520` | Ekstrak `components/chat/MessageBubble.tsx` + `utils/chatMessage.ts` |
| 4.5 | Modal invoice | `CreateReservationModal.tsx:1906` ↔ `modals/InvoiceGeneratorModal.tsx:569` | Ekstrak `utils/invoiceFormat.ts` |
| 4.6 | Seed script backend | `src/scripts/backfill-customer-name-source.ts:15` ↔ `seed-analytics-settings.ts:10` ↔ `seed-delivery-settings.ts:10` | Ekstrak `src/scripts/lib/seed-utils.ts` |
| 4.7 | Persona vs validator | `src/v3/agent/persona.ts:35` ↔ `src/v3/guardrails/pronoun-validator.ts:22` | Satukan konstanta pronoun di `src/v3/guardrails/pronoun-constants.ts` |

**Dikecualikan (D5):** 13 grup duplikasi lintas batas `src/` ↔ `packages/admin-dashboard/` (mis. `customer-address.ts` ↔ `addressMatch.ts`).

**Acceptance 4:** build + full suite hijau; jumlah grup duplikat dalam runtime yang sama = 0 (diverifikasi ulang dengan `dup-scan`).

---

### FASE 5 — Tuntaskan `TODO(tenant-aware)`

| # | File:baris | Konstanta/ambang | Target |
|---|---|---|---|
| 5.1 | `src/services/staff-notification.service.ts:27` | konfigurasi notifikasi staf | `TenantNotificationConfig` (tabel baru) atau `Tenant.settings` |
| 5.2 | `src/services/staff-reservation.service.ts:467` | ambang reservasi staf | `ClinicPolicy` |
| 5.3 | `src/services/staff-trip-tracking.service.ts:60` | ambang perjalanan | `ClinicPolicy` |
| 5.4 | `src/services/staff-trip-tracking.service.ts:70` | ambang ETA | `ClinicPolicy` |
| 5.5 | `src/v3/agent/persona.ts:154` | sinonim bisnis | `TenantPromptConfig` |
| 5.6 | `src/v3/state/goal-tracker.ts:49` | ambang klinis | `ClinicPolicy` |
| 5.7 | `src/v3/tools/save-reservation.tool.ts:156` | ambang klinis | `ClinicPolicy` |
| 5.8 | `packages/admin-dashboard/src/utils/geoUtils.ts:421` | konstanta akurasi | config tenant (read-only dari API) |

**Aturan:** setiap item wajib punya nilai default yang sama dengan konstanta sekarang (backward-compatible), plus test yang membuktikan override per-tenant berlaku.

**Gate Fase 5:** migrasi (bila ada tabel baru) + `prisma validate` + drift check:
```powershell
npx prisma migrate diff --from-url "$env:DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
```
harus `-- This is an empty migration.` setelah migrasi diterapkan.

---

### FASE 6 — Test Hygiene & Unused Diagnostics

#### 6.1 Triase 24 test di-skip

| File | Jumlah | Klasifikasi | Aksi |
|---|---|---|---|
| `tests/db/v3-foundation.db.test.ts:31` | 1 | DB-gated | pertahankan |
| `tests/integration/robustness.test.ts:118` | 1 | rate-limit lama | tulis ulang atau hapus |
| `tests/unit/v3/deterministic-guardrails-session-310995.test.ts:64,71` | 2 | manual LLM live | ubah ke fixture offline |
| `tests/unit/v3/deterministic-guardrails-session-993955.test.ts:137,146` | 2 | manual LLM live | ubah ke fixture offline |
| `tests/unit/production_edge_cases.test.ts` | 18 | handler lama (slot engine) | hapus blok obsolete + ganti dengan test slot engine |

#### 6.2 Turunkan 234 diagnostik unused

| Prioritas | File | Jumlah | Aksi |
|---|---|---|---|
| 1 | `src/routes/admin/evaluations.subroute.ts` | 39 | prefix `_` pada parameter mock interface; hapus import mati |
| 2 | `src/cli/mock-waha-client.ts` | 28 | prefix `_` |
| 3 | `src/services/customer.service.ts` | 13 | hapus variabel mati |
| 4 | `src/v3/state/goal-tracker.ts` + `cart-manager.ts` | 16 | hapus variabel mati |
| 5 | sisanya | 138 | per file |

#### 6.3 Aktifkan gate (D7)
- Setelah 6.2 selesai, tambahkan script `"typecheck:strict": "tsc --noEmit --noUnusedLocals --noUnusedParameters"` dan jalankan di CI sebagai blocking.

**Gate Fase 6:** 234 → 0 diagnostik; skipped test ≤ 5 (DB-gated); full suite hijau.

---

### FASE 7 — Verifikasi & Dokumentasi

1. Full gate:
```powershell
npm run build
npm run typecheck
npm run security:scan -- --all
npx prisma validate
cd packages/admin-dashboard; npm run build
npx vitest run --reporter=json --outputFile=docs/audit/2026-11-08/after-cleanup.json
```
2. Bandingkan `after-cleanup.json` dengan `baseline-cleanup.json`: **0 failure baru**.
3. Ukur ulang metrik (file >1.500 baris, fungsi ≥120 baris, nesting, duplikasi, dead export) dan isi tabel "Metrik Akhir".
4. Update dokumentasi:
   - `CHANGELOG.md` (entri per fase),
   - `docs/KNOWN_ISSUES.md` (keputusan D1/D2/D5 + kolom `auto_send_purchase_capi` yang dipertahankan),
   - `docs/FEATURE_INVENTORY.md` (endpoint `purchase-moderation` dihapus, modul baru hasil pemecahan),
   - `docs/changelog/INDEX.md` (regenerate: `node scripts/make-changelog-index.mjs --write`).
5. Commit per fase (bukan satu commit raksasa) dengan pesan `refactor(cleanup): fase X - ...`.

---

## 4. Risiko & Rollback

| Risiko | Mitigasi | Rollback |
|---|---|---|
| Rute hilang/ganda saat pecah route | test integrasi yang meng-boot app | revert commit fase |
| Regresi perilaku AI saat menyambungkan sanitizer (D1) | fixture test sebelum/sesudah + full suite | revert commit 1.2 |
| UI rusak saat ekstraksi dashboard | satu ekstraksi per commit + smoke manual | revert commit |
| Perubahan perilaku tenant saat TODO dipindah ke DB | nilai default identik + test override | revert commit fase 5 |
| Test lama dihapus padahal masih relevan | triase per test dengan bukti "handler lama sudah tidak ada" | restore dari git |

---

## 5. Definition of Done (global)

- [ ] 0 export mati, 0 file yatim, 0 endpoint deprecated.
- [ ] 0 file > 1.500 baris di `src/` dan `packages/admin-dashboard/src`.
- [ ] 0 grup duplikasi ≥16 baris dalam runtime yang sama.
- [ ] 0 `TODO(tenant-aware)`.
- [ ] 0 diagnostik `--noUnusedLocals`.
- [ ] Full suite hijau (hanya 2 failure pre-existing #287).
- [ ] `CHANGELOG.md`, `KNOWN_ISSUES.md`, `FEATURE_INVENTORY.md`, `INDEX.md` diperbarui.
- [ ] **Tidak ada deploy** ke server live tanpa persetujuan terpisah.

---

## 6. Yang Dibutuhkan dari Pengguna

Balas dengan format bebas, minimal menyebut:
1. **D1:** `Opsi A` / `Opsi B` / `Opsi C`.
2. **D2:** setuju hapus endpoint + toggle?
3. **Lingkup eksekusi:** `Fase 0–1 saja`, `Fase 0–2`, atau `semua fase`.
4. **D7:** setuju `--noUnusedLocals` jadi blocking di CI setelah Fase 6?

Sampai balasan itu diterima, **tidak ada file kode, test, atau migrasi yang diubah**.
