# Rencana Stage 5 — Durable Turn Inbox/Outbox + Handoff

- **Status:** RENCANA — menunggu persetujuan. Belum ada perubahan schema/kode.
- **Root cause:** RC-04 — satu turn tidak menjadi transisi durable & idempoten. Inbound persistence, state mutation, handoff, send, log, retry punya commit point terpisah.
- **Dependensi:** Stage 1 (correlation `turnId`) ✅, Stage 2 (tenant identity) ✅, Stage 4 (session per-conversation) ✅.

## 1. Masalah konkret (bukti kode)
- Worker BullMQ retry `attempts: 3` (`queue.service.ts:132`) — throw apa pun mengulang seluruh turn.
- `machine.ts` menyimpan state SEBELUM kirim (sudah sebagian diperbaiki R4 untuk log gagal).
- Send terjadi sebelum outbound persistence; tidak ada ledger per-bubble.
- Handoff (`escalate-human.tool`) bisa lapor sukses walau persist gagal (belum diperbaiki; bagian Stage 5).
- In-memory fallback tidak retry/tidak durable.

## 2. Tujuan (acceptance)
- Setiap inbound yang **diterima** bersifat durable (DB) sebelum ack.
- Setiap **bubble** outbound punya status attempt (SENDING→SENT/FAILED/UNKNOWN) yang dapat diaudit.
- Retry **tidak** mengirim ulang pesan yang sudah SENT (anti balasan ganda).
- Handoff tidak bisa "sukses" tanpa bukti durable.
- Ketahanan Redis-down: pesan masuk DB inbox, bukan hilang.

## 3. Desain (bertahap)

### Fase 1 — Schema `InboundTurn` + `OutboundAttempt`
- `InboundTurn`: `id, tenant_id, provider, inbound_message_id, customer_id, conversation_id, status (RECEIVED|QUEUED|PROCESSING|RESPONSE_READY|DELIVERED|FAILED|HANDOFF), created_at, updated_at`, `@@unique([tenant_id, provider, inbound_message_id])`.
- `OutboundAttempt`: `id, turn_id, bubble_index, content_hash, status (SENDING|SENT|FAILED|UNKNOWN), provider_message_id, error, created_at`, `@@unique([turn_id, bubble_index])`.
- Migrasi via `migrate diff` + `deploy` (bypass shadow-DB).

### Fase 2 — Inbound durable (persist sebelum ack)
- Webhook: setelah dedupe, **persist `InboundTurn` (RECEIVED)** sebelum `enqueueMessage`.
- Job membawa `turnId`; worker claim atomik (compare-and-set RECEIVED→PROCESSING).
- Worker retry aman: tidak memproses turn yang sudah `RESPONSE_READY/DELIVERED`.

### Fase 3 — Outbound ledger (per-bubble)
- Sebelum `sendText` tiap bubble: catat `OutboundAttempt` SENDING.
- Setelah sukses: `SENT` + `provider_message_id`.
- Timeout tak pasti: `UNKNOWN` (jangan blind-resend).
- `machine` state maju hanya setelah bubble wajib terkirim.
- Retry worker tidak mengirim ulang bubble yang sudah SENT.

### Fase 4 — Handoff durable
- `HandoffService` terpusat; `REQUESTED→NOTIFIED→QUEUED→ACKNOWLEDGED→RESOLVED/FAILED`.
- `executeEscalateHuman` gagal bila persist gagal.
- `is_human_handling` disinkronkan dari handoff record.

### Fase 5 — Degraded mode (terkait CG-08)
- Produksi: Redis = dispatcher, DB = source of truth. Redis down → inbox menampung; replay `RECEIVED/QUEUED`.
- Memory fallback = test/dev saja.

## 4. Blast radius
- `queue.service.ts`, `webhook.route.ts`, `machine.ts`, `typing.service.ts`, `message.service.ts`, `escalate-human.tool.ts`, schema baru, `shutdown.ts`.
- **Tidak** menyentuh cart/commitment/session V3.
- Banyak test queue/webhook/typing akan perlu disesuaikan.

## 5. Risiko & mitigasi
| Risiko | Mitigasi |
|---|---|
| Write load DB naik (2 tabel/turn) | Index tepat; retention; opsional sampling |
| Retry semantics berubah → test merah | Sesuaikan test ke kontrak baru (bukan longgarkan) |
| Handoff refactor merusak medical safety | Guard deterministik medis TIDAK diubah |
| Redis-down complexity | Fail-closed + replay; uji fault-injection |

## 6. Keputusan yang diperlukan
1. **Persetujuan** memulai Fase 1 (schema aditif) — risiko rendah.
2. **CG-08 (degraded mode):** saat Redis down → (a) fail-closed (webhook 503, provider retry), atau (b) terima ke DB inbox lalu replay? (Rekomendasi: b.)
3. **CG-10 (delivery unknown):** timeout setelah send → tandai `UNKNOWN`, jangan resend otomatis? (Rekomendasi: ya.)
4. **Retention** `InboundTurn/OutboundAttempt` (mis. 30–90 hari)?

## 7. Acceptance akhir
- Send sukses + log gagal → retry TIDAK mengirim ulang.
- Dua worker claim turn sama → satu proses.
- Redis down setelah DB receipt → replay sekali.
- Handoff gagal persist → tidak lapor sukses.
- Full suite hijau; build 0.
