# Ringkasan Status Audit & Implementasi V3

- **Tanggal:** 2026-09-20
- **Lingkup:** implementasi perbaikan hasil audit V3 (`docs/AUDIT_V3_CUSTOMER_HANDLING_2026-09-19.md`).
- **Status umum:** seluruh perubahan berjalan di **LOKAL (dev DB)**; **kode belum di-deploy** dan **migrasi produksi belum dijalankan**.
- **Kesehatan suite:** `npm test` → **403 files / 2941 passed / 0 failed** (28 skipped); `npm run build` → exit 0.

---

## 1. Root Cause (RC) dari audit → status

| RC | Inti | Status |
|---|---|---|
| RC-01 | Tenant/customer identity (phone global) | ✅ inti selesai (lokal); fail-closed resolver ditunda (#103) |
| RC-02 | Episodic state tercampur (session per-customer) | ✅ Selesai (Fase A-D: session → `Conversation.session_data`) |
| RC-03 | Provider lifecycle WABA/WAHA | ⏸️ tidak relevan (WAHA saja) |
| RC-04 | Turn atomicity (balasan ganda saat log gagal) | ✅ Selesai (Stage 5: durable inbox/outbox + ledger + handoff fail-closed + replay) |
| RC-05 | Commitment semantics (tanya vs beli) | ✅ selesai (verdict LLM) |
| RC-06 | Reservation aggregate (idempotency, status) | ✅ parsial (request_id + flag CG-05); concurrency DB belum |
| RC-07 | Claim provenance (harga entity-bound) | ⚠️ parsial (validasi direct reply); claim ledger belum |
| RC-08 | Degraded mode | ❌ belum |
| RC-09 | Observability (correlation, JSONL) | ⚠️ parsial (correlation spine + flush shutdown); PII/actual-model belum |

---

## 2. Stage yang sudah diimplementasikan

### Stage 1 — Correlation Spine + Real-DB Harness ✅
- `turnId`/`correlationId`/`provider`/`inboundMessageId` dari webhook → queue → V3 → execution log.
- `contextStorage.run` di worker BullMQ & in-memory (sebelumnya correlation hilang setelah webhook).
- `LlmExecutionRecord` + `tenantId/conversationId/turnId/actualProvider/actualModel`.
- `vitest.db.config.ts` + `tests/db/` (harness PostgreSQL nyata, guard anti-produksi, auto-skip tanpa `TEST_DATABASE_URL`).

### Stage 2 — Tenant Identity Boundary ✅ (lokal)
- Migrasi `phone @unique` (global) → `@@unique([tenant_id, phone])` (`20260920000000_tenant_identity_boundary`).
- Hapus `findByPhoneGlobal`; `updateManyByPhone` → `updateManyByPhoneTenant`; `setLabelFlags(…, tenantId)`.
- `getOrCreateCustomer`: buang fallback global, create atomic (catch P2002 → reread dalam tenant).
- `backup.service.ts`: upsert pakai compound unique.
- **Ditunda (#103):** provider resolver fail-closed (CG-01) — butuh desain event-type-aware/quarantine.

### Stage 4 (parsial) — Idle Reset Menyelaraskan Sesi V3 ✅
- Idle reset kini membersihkan sesi V3 **episodik** (cart, treatment, booking, komitmen), mempertahankan profil durable.
- **Belum:** session pindah ke `Conversation.session_data` (butuh CG-02 + migrasi).

### Stage 6 — Commitment Semantics ✅
- Call 1 (LLM) menilai komitmen (`EXPLORING|CONSIDERING|COMMITTED`) via field `commitment` di **semua 6 tool**.
- `lastCommitment` persist lintas-turn; `syncCartItems` memveto cart saat EXPLORING (lintas-turn, termasuk tawaran asisten).
- ST6-4: `COMMITTED` me-latch `bookingCommitConfirmed`.
- Diverifikasi lewat sandbox LLM asli.

### Stage 7 — Reservation Idempotency & Follow-up Uniqueness ✅ (lokal)
- Migrasi: `reservations.request_id` + `@@unique([tenant_id, request_id])`; `follow_ups @@unique([tenant_id, reservation_id, type, stage])`.
- `saveReservation` idempotent by `request_id`; tool generate requestId stabil.
- **Tidak mengubah** merge same-day (CG-06 Opsi D).

### Stage 8 (parsial) — Observability ✅
- Flush LLM JSONL saat graceful shutdown (`flushLlmExecutionLogs`).
- **Belum:** PII masking/retention, actual-model labeling, degraded mode.

### Perbaikan Lain
- **R4:** log outbound gagal setelah send tidak memicu retry/balasan ganda.
- **R7:** validasi numerik aktif pada direct reply tanpa tool.
- **P1-14:** cancel/delete reservasi membatalkan follow-up terkait.
- **#101:** 2 test flaky diperbaiki (isolasi LLM); 185 data sandbox dibersihkan.
- **CG-05 (flag):** `reservations.needs_staff_verification` (tanpa ubah `status`).

---

## 3. Keputusan (ADR) status

| ID | Topik | Status |
|---|---|---|
| CG-01 | Identitas customer/tenant | ✅ FINAL (`(tenant_id, phone)`) |
| CG-02 | Batas episode/reset | ⏳ SEBAGIAN (butuh definisi closing + koreksi konfirmasi) |
| CG-03 | Pesan saat error | ✅ FINAL (Opsi A: sunyi; admin fast response) |
| CG-04 | Rilis handoff manusia | ⏳ OPEN |
| CG-05 | Status reservasi → **flag** | ✅ FINAL & terimplementasi |
| CG-06 | Multi-appointment same-day | ✅ FINAL (Opsi D: merge kontrak lama) |
| CG-07 | Semantik komitmen | ✅ terimplementasi (verdict LLM) |
| CG-08 | Degraded mode | ⏳ OPEN |
| CG-09 | Retention/PII | ⏳ OPEN |
| CG-10 | Delivery unknown | ⏳ OPEN |
| CG-11 | Akses DB | ✅ (read-only lokal) |

Referensi: `docs/plans/ADR_AUDIT_V3_DECISIONS.md`.

---

## 4. Sisa pekerjaan (butuh keputusan/migrasi besar)

| Prioritas | Item | Blocker |
|---|---|---|
| Tinggi | Stage 4 penuh: session per-conversation | CG-02 final + migrasi |
| Tinggi | Stage 5: durable turn inbox/outbox + handoff | Arsitektur + schema baru |
| Sedang | RC-07: claim ledger entity-bound | Kontrak generator |
| Sedang | Stage 8: PII masking/retention, actual-model, degraded mode | CG-08/CG-09 |
| Ops | Deploy kode + migrasi produksi | Kode belum live |

---

## 5. Risiko & catatan operasional

- **Flaky full-suite (#101):** beberapa test integrasi (waha-webhook/robustness/migration) kadang timeout hanya saat full-suite; lulus isolasi. Bukan bug logika.
- **Client Prisma:** `prisma generate` terakhir kena DLL-lock dev server; tipe sudah sinkron (tsc 0). **Regenerate bersih saat dev server dimatikan**, sebelum deploy.
- **Migrasi produksi:** WAJIB backup + rehearsal + maintenance window + (kode harus ikut ter-deploy agar `findUnique` compound tidak mismatch).
- **CG-01 fail-closed (#103):** ditunda; untuk 1 tenant, fail-open belum berisiko.

---

## 6. Urutan rekomendasi lanjutan

1. **CG-02 final** → buka Stage 4 penuh (session per-conversation). Dampak besar ke amnesia/konteks.
2. **Stage 5 durable inbox/outbox** → reliability inti (bot diam, retry, handoff). Butuh desain schema.
3. **Stage 8 lanjutan** (PII/retention/actual-model) → butuh CG-08/CG-09.
4. **Deploy + migrasi produksi** setelah kode siap & diuji di staging.

---

## 7. Dokumen terkait
- `docs/AUDIT_V3_CUSTOMER_HANDLING_2026-09-19.md` — audit lengkap + Lampiran A.
- `docs/plans/STAGED_MICRO_IMPLEMENTATION_PLAN_AUDIT_V3.md` — rencana stage.
- `docs/plans/ADR_AUDIT_V3_DECISIONS.md` — keputusan.
- `docs/plans/STAGE_2_MIGRATION_PLAN_TENANT_IDENTITY.md` — rencana migrasi tenant.
- `docs/KNOWN_ISSUES.md` — #99..#103.
