# STAGED MICRO IMPLEMENTATION PLAN — Audit V3 Customer Handling

- **Tanggal:** 2026-09-19
- **Sumber:** `docs/AUDIT_V3_CUSTOMER_HANDLING_2026-09-19.md` (60 temuan + Lampiran A) dan sintesis 9 root cause (RC-01…RC-09).
- **Sifat dokumen:** RENCANA. Belum ada eksekusi. Setiap stage HANYA boleh dimulai setelah regression gate stage sebelumnya hijau.
- **Aturan eksekusi:** satu micro-task = satu concern kecil, satu-dua file. Setiap micro-task wajib mencantumkan:
  file pasti, fungsi, langkah prosedural (perintah terminal persis), acceptance criteria otomatis (perintah + output yang diharapkan),
  dan regression gate. DILARANG melompat stage.
- **Batasan repo:** zero new runtime dependencies; tenant-aware; tanpa `prisma generate --no-engine`;
  `migrate diff --from-migrations` diketahui rusak — gunakan `--from-url` untuk cek drift;
  tanpa testing live yang memicu event Meta tanpa verifikasi 2-langkah.

## Peta Stage

| Stage | Nama | Dependensi | Blast radius |
|---|---|---|---|
| 0 | Preflight & Confirmation Gate | — | Nol (read-only + keputusan) |
| 1 | Correlation Spine + Real-DB Harness | Stage 0 | Rendah (additive metadata + test config baru) |
| 2 | Tenant Identity Boundary | Stage 0, 1 | TINGGI (schema Customer + seluruh lookup) |
| 3 | Provider Parity WABA/WAHA | Stage 1, 2 | Sedang-Tinggi (ingress + outbound transport) |
| 4 | Conversation Episode State | Stage 2 | TINGGI (GoalTracker + session ownership) |
| 5 | Durable Turn Inbox/Outbox + Handoff | Stage 1, 3 | TINGGI (queue + machine + typing + schema baru) |
| 6 | Commitment Semantics + Claim Grounding | Stage 4 | Sedang (V3 domain/router/cart/validator) |
| 7 | Reservation Aggregate | Stage 4, 5, 6 | TINGGI (schema Reservation/Child/FollowUp + admin) |
| 8 | Degraded Mode + Observability + Rollout | Stage 5 | Sedang (queue fallback, breaker, logging, rollout) |

**Urutan ini berdasarkan dependensi, bukan kemudahan.** Identity dan provider boundary harus stabil sebelum migrasi
session; session dan commitment harus stabil sebelum reservation lifecycle; durable turn harus ada sebelum handoff
dan retry semantics dianggap aman.

---

# STAGE 0 — Preflight & Confirmation Gate (read-only + keputusan)

**Tujuan:** mengunci fakta produksi dan keputusan bisnis sebelum satu baris kode pun diubah.
**Gate keluar:** PRE-01 (fakta) + PRE-02 (keputusan CG-01…CG-10) selesai dan ditandatangani.

## MT-0.1 — Catat baseline deployment

- **Files:** `deploy_config.txt`, `package.json`, `prisma/migrations/` (daftar), output perintah.
- **Steps:**
  1. `git rev-parse HEAD` → catat commit.
  2. `npx prisma --version` → catat versi Prisma client.
  3. `psql "$DATABASE_URL" -c "select version();"` → catat versi PostgreSQL.
  4. `redis-cli INFO server | head -5` (atau catat bila Redis tidak ada) → catat kebijakan Redis.
  5. Catat jumlah instance aplikasi yang berjalan di produksi.
- **Acceptance:** satu file catatan berisi 5 item di atas, tanpa nilai secret.

## MT-0.2 — Query anomali identity (read-only, counts + IDs saja)

- **Files:** none (DB read-only).
- **Steps** (jalankan terhadap REPLIKA/backup bila tersedia; jangan di primary saat jam sibuk):
  1. Customer dengan phone sama di >1 tenant:
     `SELECT phone, count(DISTINCT tenant_id) FROM customers GROUP BY phone HAVING count(DISTINCT tenant_id) > 1;`
  2. Child record yang `tenant_id`-nya berbeda dari customer induk:
     `SELECT c.id FROM children c JOIN customers cu ON cu.id = c.customer_id WHERE c.tenant_id <> cu.tenant_id LIMIT 100;`
  3. Tenant dengan `waha_session_id` / `waba_phone_number_id` duplikat atau null.
  4. Conversation aktif ganda per `(tenant_id, customer_id)`.
- **Acceptance:** counts + daftar ID terdampak tercatat; TANPA mengekspor teks chat/nomor berlebih.

## MT-0.3 — Inventarisasi status reservation & follow-up

- **Steps:**
  1. `SELECT status, count(*) FROM reservations GROUP BY status;`
  2. Same-day multi-reservation per customer: `SELECT tenant_id, customer_id, date_trunc('day', booking_date), count(*) FROM reservations WHERE status <> 'cancelled' GROUP BY 1,2,3 HAVING count(*) > 1;`
  3. Follow-up duplikat per `(tenant_id, reservation_id, type, stage)`.
  4. Outbound rows `deliveryStatus='sent'` yang tidak pernah ACK + rows `failed`.
- **Acceptance:** counts tercatat; owner rekonsiliasi data ditunjuk.

## MT-0.4 — Cek schema drift

- **Steps:** `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script`
- **Acceptance:** output persis `-- This is an empty migration.` Bila tidak kosong → STOP, eskalasi sebelum stage schema apa pun.

## MT-0.5 — Keputusan CG-01…CG-10 (Confirmation Gate)

- **Files:** ADR baru `docs/plans/ADR_AUDIT_V3_DECISIONS.md`.
- **Keputusan wajib:** CG-01 unknown provider (default: fail-closed/quarantine); CG-02 episode boundary; CG-03 pesan transisi error;
  CG-04 human release policy; CG-05 status awal non-same-day (`REQUESTED` vs `CONFIRMED`); CG-06 multi-appointment same-day;
  CG-07 definisi commitment; CG-08 degraded mode (wajib Redis vs DB inbox); CG-09 retention/masking PII; CG-10 `DELIVERY_UNKNOWN`.
- **Acceptance:** 10 keputusan tertulis + penandatangan. Tanpa ini, Stage 2/3/4/5/7 DILARANG mulai.

**REGRESSION GATE STAGE 0:** dokumen preflight + ADR keputusan lengkap. Tidak ada gate test kode (belum ada perubahan).

---

# STAGE 1 — Correlation Spine + Real-DB Harness (additive, risiko rendah)

**Tujuan:** satu `turnId` menelusuri webhook→queue→V3→send; test PostgreSQL asli tersedia tanpa merusak suite offline.
**Dependensi:** Stage 0 (CG-09 untuk batas PII).

## MT-1.1 — Verifikasi lokasi kode (wajib sebelum edit)

- **Files:** `src/utils/context.ts`, `src/routes/webhook.route.ts`, `src/routes/waba-webhook.route.ts`,
  `src/services/queue.service.ts` (`QueuePayload`, worker), `src/state-machine/types.ts`, `src/state-machine/machine.ts`,
  `src/v3/agent/agent-runner.ts`.
- **Steps:** baca tiap file; konfirmasi nama type/field aktual (`QueuePayload`, `StateHandlerContext`, `contextStorage`).
  Bila nama berbeda dari plan → perbarui plan, JANGAN tebak.
- **Acceptance:** daftar field aktual tercatat.

## MT-1.2 — Tambahkan `turnId`/`correlationId`/provider ke queue payload

- **Files:** `src/services/queue.service.ts`, `src/state-machine/types.ts`, `src/routes/webhook.route.ts`, `src/routes/waba-webhook.route.ts`.
- **Steps:**
  1. Perluas `QueuePayload` dengan `correlationId: string`, `turnId: string`, `provider: 'WAHA'|'WABA'`, `inboundMessageId: string`.
  2. WAHA route: bentuk `turnId = tenantId + ':' + waMessageId` (atau UUID bila ID tidak ada); teruskan ke `enqueueMessage`.
  3. WABA route: bentuk sama dari Meta message ID; bungkus handler dalam `contextStorage.run()`.
  4. Worker: `contextStorage.run()` ulang di dalam callback BullMQ dan memory processor sebelum `processMessage`.
- **Acceptance:** `npx tsc --noEmit` exit 0; test penanda: satu pesan WAHA + satu WABA → log worker memuat `turnId` yang sama dari ingress sampai send.
- **Regression:** `npx vitest run tests/unit/queue.test.ts tests/integration/waba-webhook-route.test.ts` hijau.

## MT-1.3 — Teruskan IDs ke V3 + execution records

- **Files:** `src/v3/agent/agent-runner.ts`, `src/v3/agent/pipeline/generation-stage.ts`, `src/utils/llm-execution-logger.ts`.
- **Steps:**
  1. Tambahkan `turnId/correlationId` ke input runner dan telemetry.
  2. Perluas `LlmExecutionRecord` dengan `tenantId`, `conversationId`, `turnId`, `actualModel`, `actualProvider`, `guardrailVerdict`, `finalReplyHash` (hash, bukan teks penuh bila CG-09 membatasi).
  3. Tambahkan flush eksplisit pada graceful shutdown (`src/lifecycle/shutdown.ts`).
- **Acceptance:** satu query/filter by `turnId` merekonstruksi Call1→Call2→reprompt tanpa heuristic phone/waktu.
- **Regression:** `npx vitest run tests/unit/typing.test.ts` + build hijau.

## MT-1.4 — Real-DB test harness terpisah

- **Files:** `vitest.db.config.ts` (baru), `tests/db/v3-foundation.db.test.ts` (baru).
- **Steps:**
  1. Buat `vitest.db.config.ts` yang SAMA dengan config utama kecuali `setupFiles` TIDAK memuat `tests/setup.ts`.
  2. Tambahkan guard: bila `DATABASE_URL` mengandung host produksi → throw sebelum connect.
  3. Tulis smoke test: insert customer→conversation→message dalam transaksi, rollback, dan parallel-insert conflict test.
- **Commands:**
  - `npx vitest run --config vitest.db.config.ts tests/db/v3-foundation.db.test.ts` → semua hijau.
  - `npm test` (suite offline) → tetap hijau, tidak berubah.
- **Regression gate Stage 1:** kedua suite hijau + `npm run build` exit 0.

---

# STAGE 2 — Tenant Identity Boundary (risiko TINGGI)

**Tujuan:** `(tenant_id, normalized_phone)` menjadi identitas customer; provider unknown fail-closed.
**Dependensi:** Stage 0 (data anomali + CG-01), Stage 1 (harness DB untuk uji constraint).

## MT-2.1 — Verifikasi call sites global identity

- **Steps:** grep seluruh repo untuk `findByPhoneGlobal`, `updateManyByPhone`, `phone:` tanpa `tenant_id` di `src/repositories/`, `src/services/`, `src/routes/admin/`.
- **Acceptance:** daftar lengkap call sites tercatat; tiap site dipetakan ke micro-task di bawah.

## MT-2.2 — Migration: composite unique + partial unique provider IDs

- **Files:** `prisma/schema.prisma`, `prisma/migrations/<timestamp>_tenant_identity_boundary/migration.sql`.
- **SQL (sesuaikan nama constraint aktual setelah MT-0.4):**
  ```sql
  -- Prakondisi: MT-0.2 sudah merekonsiliasi duplikat; migrasi GAGAL bila masih ada duplikat (by design).
  ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_phone_key;
  ALTER TABLE customers ADD CONSTRAINT customers_tenant_phone_key UNIQUE (tenant_id, phone);
  CREATE UNIQUE INDEX IF NOT EXISTS tenants_waha_session_uidx ON tenants (waha_session_id) WHERE waha_session_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS tenants_waba_pnid_uidx ON tenants (waba_phone_number_id) WHERE waba_phone_number_id IS NOT NULL;
  ```
- **Steps:** backup + rehearsal restore → `npx prisma migrate deploy` di staging → drift check `--from-url` harus empty.
- **Acceptance:** insert phone sama di 2 tenant sukses; insert duplikat dalam 1 tenant ditolak DB.
- **Rollback:** JANGAN kembalikan global unique setelah dua tenant memiliki phone sama. Rollback = dual-read sementara (lihat MT-2.3), bukan revert constraint.

## MT-2.3 — Hapus global lookup/update dari production flow

- **Files:** `src/repositories/customer.repository.ts`, `src/services/customer.service.ts`.
- **Functions:** `findByPhoneGlobal`, `getOrCreateCustomer`, `setChatLabelFlag`/`setLabelFlags`.
- **Steps:**
  1. Hapus `findByPhoneGlobal` dari interface + implementasi + semua import.
  2. `getOrCreateCustomer`: atomic composite-key upsert (atau create + catch unique-conflict → reread dalam tenant).
  3. Label updates: wajib `(tenantId, normalizedPhone)`.
  4. Tambahkan `tenantId` ke semua in-memory key customer.
- **Acceptance:** grep `findByPhoneGlobal` di `src/` → nol hasil (kecuali komentar TODO yang dihapus).
- **Regression:** `npx vitest run tests/unit/capi-tenant-isolation.test.ts tests/unit/waha-tenant-resolution.test.ts tests/unit/whatsapp-factory-multitenant.test.ts tests/integration/waba-webhook-route.test.ts` + DB test MT-2.2 hijau.

## MT-2.4 — Provider resolver fail-closed

- **Files:** `src/services/waha-tenant.service.ts`, `src/services/waba-tenant.service.ts`, kedua webhook routes.
- **Steps:** kembalikan discriminated result `resolved|unknown|unavailable`; unknown/unavailable → quarantine/retry SESUAI CG-01, tidak pernah default tenant.
- **Acceptance:** unknown session/phoneNumberId → nol row customer/conversation/message baru (assert di DB test).
- **Eskalasi:** bila mapping produksi tidak lengkap → STOP, lengkapi mapping dulu.

**REGRESSION GATE STAGE 2:** seluruh test di MT-2.3 + DB concurrency + build hijau; drift check empty.

---

# STAGE 3 — Provider Parity WABA/WAHA (risiko sedang-tinggi)

**Dependensi:** Stage 1 (correlation), Stage 2 (tenant boundary + CG-01).

## MT-3.1 — WABA mixed payload: proses statuses DAN messages

- **File:** `src/routes/waba-webhook.route.ts` (handler, sekitar baris 78-117).
- **Steps:** hapus `return` dini setelah status; loop statuses lalu lanjut `normalizeWabaPayload`; kembalikan response gabungan.
- **Acceptance:** fixture berisi 1 status + 2 messages → 3 record diproses (test baru `tests/integration/waba-mixed-payload.test.ts`).
- **Regression:** `tests/integration/waba-webhook-route.test.ts` hijau.

## MT-3.2 — WABA pre-log + `_preLogged` + auto-release parity

- **Files:** `src/routes/waba-webhook.route.ts`, `src/state-machine/machine.ts` (guard log).
- **Steps:**
  1. `logMessage` inbound kanonis SEBELUM human-suppression/stale/burst/enqueue (mirip WAHA).
  2. Tandai queued message `_preLogged` agar machine tidak double-log.
  3. Panggil `checkAndApplyAutoRelease` setelah conversation diambil (sama seperti WAHA).
- **Acceptance:** inbound WABA saat human handling TETAP ada di DB/livechat; conversation kedaluwarsa ter-release (test baru).
- **Eskalasi:** bila struktur payload Meta live berbeda dari fixture → capture redacted shape, STOP.

## MT-3.3 — Outbound provider affinity (perbaikan A-BUG-P0-04)

- **Files:** `src/services/typing.service.ts`, `src/state-machine/machine.ts`, `src/integrations/whatsapp/factory.ts`, transport types.
- **Steps:**
  1. Konstruksi production `TypingService` dengan `tenantId => createGatewayTransport(resolveGatewayForTenant(tenantId))`.
  2. Perluas hasil send dengan `providerMessageId` untuk SEMUA transport (bukan boolean untuk WABA).
  3. Hilangkan pembentukan `@c.us` chatId untuk WABA di domain layer (serahkan ke driver).
- **Acceptance:** inbound WABA → spy assert HANYA driver WABA dipanggil + Meta message ID tersimpan; perilaku WAHA tidak berubah.
- **Rollback:** flag per-tenant WABA manual-only; DILARANG fallback WABA→WAHA.

**REGRESSION GATE STAGE 3:** seluruh test WABA route/driver/template + WAHA webhook + follow-up WABA + build hijau.

---

# STAGE 4 — Conversation Episode State (risiko TINGGI)

**Dependensi:** Stage 2 (identity stabil) + CG-02 (episode boundary).

## MT-4.1 — Schema: `Conversation.session_data` + version + partial unique open episode

- **Files:** `prisma/schema.prisma`, migration baru.
- **SQL:**
  ```sql
  ALTER TABLE conversations ADD COLUMN IF NOT EXISTS session_data JSONB;
  ALTER TABLE conversations ADD COLUMN IF NOT EXISTS session_version INT NOT NULL DEFAULT 1;
  ALTER TABLE conversations ADD COLUMN IF NOT EXISTS episode_started_at TIMESTAMPTZ NOT NULL DEFAULT now();
  ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;
  CREATE UNIQUE INDEX IF NOT EXISTS conv_open_episode_uidx
    ON conversations (tenant_id, customer_id) WHERE ended_at IS NULL;
  ```
- **Acceptance:** dua open episode untuk customer sama ditolak DB; episode tertutup boleh banyak.
- **Eskalasi:** bila customer punya banyak conversation terbuka → tutup/merge sesuai kebijakan CG-02 dulu.

## MT-4.2 — GoalTracker pindah authority + optimistic locking

- **Files:** `src/v3/state/goal-tracker.ts`, `src/repositories/goal-session.repository.ts` (baru).
- **Functions:** `getGoalSession`, `updateGoalSession`.
- **Steps:**
  1. Read/write `Conversation.session_data` + CAS `session_version` (retry terbatas dengan reread).
  2. Persistence error HARUS throw (bukan dianggap sukses); memory hanya cache baca.
  3. Profil durable (nama, sapaan, alamat terverifikasi) tetap di `Customer`; referensi anak via `childId` ke tabel `Child`.
- **Acceptance:** dua worker update disjoint → tidak ada lost update diam-diam; DB failure → caller menerima error.
- **Regression:** goal-tracker, cart, context-grounder, queue stale-state, full V3 suite + DB concurrency hijau.

## MT-4.3 — History ownership: current inbound tepat satu kali

- **Files:** `src/state-machine/machine.ts` (assembly history), `src/v3/agent/agent-runner.ts` (assembly messages).
- **Steps:** exclude current inbound ID dari history sebelum append sekali; instrumentasi count (log jumlah kemunculan) satu rilis sebelum enforce bila ragu.
- **Acceptance:** test assert current inbound tepat 1x untuk path normal, prelogged burst, dan short replies.

## MT-4.4 — Episode closure/reset policy

- **Files:** `src/services/conversation.service.ts`, `src/state-machine/machine.ts` (idle reset), `src/services/command.service.ts`.
- **Steps:** tutup episode sesuai CG-02 (idle timeout / handoff selesai / `/reset` / reservasi final); next inbound membuka episode bersih; profile durable dipertahankan.
- **Acceptance:** returning customer: cart/complaint/commitment kosong; child + profil terverifikasi bertahan.
- **Rollback:** idle timeout per-tenant configurable.

**REGRESSION GATE STAGE 4:** V3 suite + matrix + command reset + DB concurrency + build hijau.

---

# STAGE 5 — Durable Turn Inbox/Outbox + Handoff (risiko TINGGI)

**Dependensi:** Stage 1, 3 + CG-03/CG-04/CG-10.

## MT-5.1 — Schema `InboundTurn` + repository + worker claim protocol

- **Files:** `schema.prisma` (model baru), migration, `src/repositories/turn.repository.ts` (baru), `queue.service.ts`.
- **Model (inti):** `id`, `tenant_id`, `provider`, `inbound_message_id`, `customer_id`, `conversation_id`, `status` enum
  (`RECEIVED→QUEUED→PROCESSING→RESPONSE_READY→DELIVERED`, plus `FAILED/HANDOFF`), `@@unique([tenant_id, provider, inbound_message_id])`.
- **Steps:** persist SEBELUM ack webhook; claim atomik compare-and-set; Redis hanya dispatcher; replay `RECEIVED/QUEUED` setelah recovery.
- **Acceptance:** dua worker claim turn sama → tepat satu memproses; provider retry → diterima idempoten.
- **Eskalasi:** queue age/SLA melonjak → STOP.

## MT-5.2 — Per-bubble `OutboundAttempt` ledger

- **Files:** schema/migration, `src/services/outbound-dispatch.service.ts` (baru), `typing.service.ts`, `machine.ts`.
- **Steps:** persist attempt `(turn_id, bubble_index)` SEBELUM send; `SENDING`→`SENT(+providerId)`; timeout tak pasti → `DELIVERY_UNKNOWN` (CG-10: tanpa blind-resend); partial bubble tercatat independen.
- **Acceptance:** send-sukses + log-gagal → retry TIDAK mengirim ulang confirmed send; bubble 1 ok/2 gagal terwakili akurat.

## MT-5.3 — Handoff lifecycle terpusat

- **Files:** schema/migration (model `Handoff` atau kolom Conversation), `src/services/handoff.service.ts` (baru),
  `generation-stage.ts` (`reportTurnError`), `escalate-human.tool.ts`, `machine.ts`, `conversation-gates.ts`.
- **States:** `REQUESTED→NOTIFIED→QUEUED→ACKNOWLEDGED→RESOLVED/FAILED`.
- **Steps:** sentralkan SEMUA eskalasi via `HandoffService`; `executeEscalateHuman` gagal bila persist gagal/tenant beda;
  hapus swallowed errors; ganti auto-release stale-`previous_state` dengan resolusi CG-04.
- **Acceptance:** LLM 401/429/500 → satu transition message + satu handoff persisted; tidak ada silent technical handoff.

## MT-5.4 — Customer-visible transition notice

- **Files:** `generation-stage.ts`, tenant policy/prompt config.
- **Steps:** enqueue template transisi milik tenant SEBELUM suppression aktif; bind reason/SLA.
- **Acceptance:** tidak ada technical handoff tanpa pesan ke customer.
- **Eskalasi:** template/SLA belum disetujui → STOP.

**REGRESSION GATE STAGE 5:** queue, burst, anti-silent-drop, typing, message-idempotency, provider parity + fault injection (DB down, Redis down, provider timeout, worker crash) hijau.

---

# STAGE 6 — Commitment Semantics + Claim Grounding (risiko sedang)

**Dependensi:** Stage 4 (+ CG-07), Stage 5 untuk handoff priority.

## MT-6.1 — Typed turn interpretation

- **Files:** `src/v3/domain/types.ts`, `src/v3/domain/turn-interpretation.ts` (baru), `persona.ts` (`extractFastIntents`),
  `generation-stage.ts` (`routeTools`).
- **Steps:** hasilkan `intent`, `commitmentLevel` (`EXPLORING|CONSIDERING|COMMITTED`), `referencedEntityIds`,
  `handoffRequested`, `targetRecipient`; `handoffRequested` prioritas tertinggi; `parallel_tool_calls:false` tetap.
- **Acceptance:** matriks parafrase adversarial: inquiry vs interest vs selection vs commitment terpisah.
- **Rollback:** shadow evaluate per tenant tanpa mutasi.

## MT-6.2 — Cart mutation hanya dari active user commitment

- **Files:** `cart-manager.ts` (`syncCartItems`), `booking-commit-gate.ts`, `context-grounder.ts`, `tool-masker.ts`.
- **Steps:** izinkan mutasi HANYA bila: sumber = current `role=user` + `COMMITTED` + entity ID katalog tenant valid +
  afirmasi ambigu terikat tepat satu offer aktif; pisahkan `discussed` dari `cart`; scope `priceDiscussed`/commitment
  per entity + source turn + freshness.
- **Acceptance:** konsultasi deklaratif multi-frasa (tanpa `?`, typo, slang) TIDAK mengubah cart; komitmen eksplisit mengubah cart.
- **Eskalasi:** false-negative commitment > threshold → STOP, jangan longgarkan via phrase lists.

## MT-6.3 — Claim ledger per tool call

- **Files:** `src/v3/domain/claim-ledger.ts` (baru), `tool-pipeline.ts`, catalog/policy/delivery tools.
- **Steps:** normalisasi output tool menjadi typed claims per entity ID + tool-call ID (harga, durasi, rentang usia, fee, policy).
- **Acceptance:** setiap fakta customer-visible punya source ID tenant-scoped.

## MT-6.4 — Final factual validation + deterministic render

- **Files:** numeric/factual validators, `guardrail-pipeline.ts`, `src/v3/guardrails/claim-renderer.ts` (baru).
- **Steps:** hapus tenant-wide price whitelist; validasi SEMUA token currency termasuk direct reply; validasi FINAL setelah
  reprompt/normalizer terakhir; render nama/nilai entity dari ledger; regex hanya untuk ekstraksi teknis.
- **Acceptance:** harga Treatment B untuk Treatment A DITOLAK; direct price tanpa claim DITOLAK; total multi-item valid tetap diterima.

**REGRESSION GATE STAGE 6:** cart, treatment-swap, booking-commit, tool-masker, atomic routing, adversarial paraphrase + build hijau.

---

# STAGE 7 — Reservation Aggregate (risiko TINGGI)

**Dependensi:** Stage 4, 5, 6 + CG-05/CG-06 + inventarisasi MT-0.3.

## MT-7.1 — Schema: typed status + request identity + follow-up uniqueness

- **Files:** `schema.prisma` (Reservation, Child, FollowUp), migration.
- **SQL (inti):**
  ```sql
  ALTER TABLE reservations ADD COLUMN IF NOT EXISTS request_id TEXT;
  CREATE UNIQUE INDEX IF NOT EXISTS res_tenant_request_uidx ON reservations (tenant_id, request_id) WHERE request_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS fu_tenant_res_type_stage_uidx ON follow_ups (tenant_id, reservation_id, type, stage) WHERE reservation_id IS NOT NULL;
  -- Status values dimigrasi sesuai CG-05 setelah MT-0.3 (jangan tebak mapping di sini).
  ```
- **Acceptance:** request ID sama → satu reservation; follow-up reservation unik per type/stage.

## MT-7.2 — Transactional save tanpa destructive date merge

- **Files:** `reservation-core.service.ts` (`saveReservation`), `save-reservation.tool.ts`.
- **Steps:** transaksi PostgreSQL + advisory lock/conflict-safe constraint; idempotency by `request_id`; appointment berbeda
  (child/slot beda) TIDAK digabung berdasarkan customer+date; `pending/REQUESTED` masuk active dedupe.
- **Acceptance:** 20 parallel identical requests → 1 reservation + 1 follow-up set; two-child same-day sah → 2 record.
- **Rollback:** matikan bot booking sementara; JANGAN cabut constraint.

## MT-7.3 — Status/follow-up lifecycle konsisten

- **Files:** `reservation-transition.service.ts` (baru), `follow-up.service.ts`, `reservations.subroute.ts` (semua path cancel/delete), lifecycle service.
- **Steps:** sentralkan transisi; create/cancel follow-up dalam transaksi/event durable yang sama; worker follow-up revalidasi
  status sebelum send; samakan wording respons dengan status persisted.
- **Acceptance:** cancelled/deleted → nol reminder terkirim; confirmed appointment tetap menerima reminder.
- **Eskalasi:** orphan follow-up massal → STOP dan rekonsiliasi dulu.

**REGRESSION GATE STAGE 7:** reservation core/stress/same-day/multi-child, admin CRUD, follow-up engine/admin/WABA, CAPI, DB concurrency + build hijau.

---

# STAGE 8 — Degraded Mode + Observability + Rollout (risiko sedang)

**Dependensi:** Stage 5 (+ CG-08/CG-09/CG-10).

## MT-8.1 — Production memory fallback OFF; breaker scoped

- **Files:** `queue.service.ts`, `generation-stage.ts`, breaker/fallback modules.
- **Steps:** nonaktifkan in-memory processing produksi (DB inbox menampung saat Redis down); breaker per tenant/provider/model;
  catat actual model/provider (bukan configured primary).
- **Acceptance:** matriks failure Redis/DB/LLM/provider: guarantee dipertahankan ATAU work ditolak eksplisit tanpa pura-pura sukses.
- **Eskalasi:** inbox SLA terlampaui → STOP.

## MT-8.2 — Redacted turn envelope + retention

- **Files:** `llm-execution-logger.ts`, `llm-audit-buffer.ts`, shutdown, admin evaluations route (hapus destructive truncate).
- **Steps:** satu ringkasan turn ter-redact (IDs, interpretation, state version before/after, tools, model/provider aktual,
  draft hash, guardrail changes, final hash, outbound attempts, ACK, handoff/reservation IDs); requeue audit gagal;
  flush saat shutdown; retention deletion ber-audit (bukan truncate file).
- **Acceptance:** satu `turnId` merekonstruksi seluruh journey; tidak ada raw secret; sesuai CG-09.

## MT-8.3 — Rollout per tenant + dokumentasi

- **Files:** `Tenant.settings`, `CHANGELOG.md`, `docs/KNOWN_ISSUES.md`.
- **Steps:** rollout shadow → canary → full per tenant; metrik/alert (unknown tenant, inbox age, replay count, delivery unknown,
  handoff SLA, optimistic conflicts, idempotency conflicts, follow-up drift); update changelog; catat limitasi tertunda.
- **Acceptance:** full suite + DB suite + build + staging fault injection + webhook replay (gateway mocked) hijau.
- **Rollback:** per tenant via settings; pertahankan correlation + durable records.

**REGRESSION GATE FINAL:** `npm test`, `npm run build`, `npx vitest run --config vitest.db.config.ts`, staging replay hijau.

---

# Aturan Wajib Tiap Stage

1. Mulai dengan micro-task verifikasi (nama file/fungsi/baris aktual). Bila berbeda dari plan → revisi plan dulu.
2. Satu micro-task selesai = acceptance criteria + regression gate-nya hijau, bukan "kode ditulis".
3. Setiap migration: backup + rehearsal restore + staging deploy + drift check empty + full `prisma generate`.
4. Setiap temuan baru saat eksekusi → catat di `docs/KNOWN_ISSUES.md`, JANGAN diam-diam memperluas scope stage.
5. Setiap perubahan perilaku user-visible → catat di `CHANGELOG.md` setelah hijau.
