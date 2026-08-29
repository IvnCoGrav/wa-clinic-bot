# Implementation Plan — LiveChat vs WA Web Last Message Tidak Sinkron

**Tanggal:** 2026-08-29  
**Branch rencana:** `plan/livechat-wa-sync`  
**Status:** Plan (belum eksekusi kode) — push ke GitHub untuk eksekusi selanjutnya  
**Penulis investigasi:** Muse Spark (analisa DB lokal 2026-08-29)

---

## 1. Ringkasan Masalah (Faktual, bukan hipotesa)

Laporan: “livechat dan WA web tidak sama untuk message terakhir”.

Verifikasi lokal (DB `clinic-postgres` 2026-08-29, `7519` messages, `609` conversations, `613` customers):
* **64 phantom conversations** — `conversations.last_message_at IS NOT NULL` tapi `LEFT JOIN messages = 0` (`SELECT count(*) FROM conversations c LEFT JOIN messages m ON m.conversation_id=c.id WHERE m.id IS NULL` → `64`). Contoh `23228037-9b93-4bb5-b09a-1989262d42ba` (`6289999215847`, `INITIAL`, `last_message_at 2026-08-28 06:56:02.77`) — dibuat `src/services/conversation.service.ts:31-77` `getOrCreateConversation`, tapi tidak ada `messages` yang pernah ter-log (early return / HUMAN_HANDLING / stale guard).
* **197 conversations `last_message_at` desync** dengan `max(messages.created_at)` (`src/services/message.service.ts:343-349` vs `src/services/waha-history-sync.service.ts:268-283`). Diff terbesar 48 hari (`ab597f1b 6281234285950`: `last_at 2026-07-09` vs `max_msg 2026-08-26`, `+4202852s`). Urutan LiveChat `src/services/conversation.service.ts:184-188` `orderBy [is_pinned desc, last_message_at desc]` vs WA Web sort by WA timestamp asli → last preview beda bubble.
* **173 outbound `wa_message_id IS NULL`** — `typingService.simulateHumanReply` + `messageService.logMessage` tanpa `messageId` saat WAHA `DISCONNECTED` (log `WAHA_DISCONNECTED` berulang, queue `PAUSED`, `waha` container tidak ada di `docker ps` lokal). `updateDeliveryStatus` `src/services/message.service.ts:558-640` by `wa_message_id` tidak pernah match → centang `sent ✓` stuck.
* **Environment lokal tidak merepresentasikan prod:** `WAHA_BASE_URL=http://localhost:3001` timeout, app tidak listen `3000`, `waha` container hilang. DB lokal stale (`max created_at 2026-08-28 00:53:55`). Live prod butuh cek terpisah (2-step gate, lihat §6).

Akar di kode (sudah ada tapi belum konsisten):
* Preview LiveChat `src/services/live-chat.service.ts:116-131` (`WITH ranked … rn<=3`) dan `src/services/live-chat.service.ts:765` `effectiveLastMsgAt = lastMsg.created_at || last_message_at` — kalau `last_message_at` stale, list sort tetap stale walau `lastMsg` benar.
* History sync filter `src/services/waha-history-sync.service.ts:197,379` `m.body && trim().length>0` → image/video tanpa caption ter-drop (WA Web ada, LiveChat hilang). Webhook inbound `src/routes/webhook.route.ts:637-729` sudah benar (download sebelum stale guard), tapi sync path belum.
* `src/routes/webhook.route.ts:734-780` stale guard 180s (`MAX_INBOUND_MESSAGE_AGE_SECONDS`) + `src/services/message.service.ts:47-125` in-flight dedup 45s — jika admin HP balas teks mirip bot dalam window, `OUTBOUND_DUPLICATE_SKIPPED` → hilang di LiveChat.

Referensi file: semua `file:line` di atas + `src/routes/webhook.route.ts:232-290` (outbound HP gate), `src/routes/admin/livechat.subroute.ts:453` (SSE).

---

## 2. Tujuan

* LiveChat `lastMessageAt` + `lastMessages[0..2]` **identik** dengan WA Web untuk semua percakapan (single source: WA timestamp + `messages` table).
* Phantom conversation tidak muncul di list, atau muncul konsisten (collapsed).
* Tidak ada lagi `last_message_at` drift > 5 detik dari `max(messages.created_at)`.
* Media tanpa caption tetap tampil (via history sync & webhook).
* Deploy aman: idempotent, no `prisma migrate diff --from-migrations` break (lihat `docs/KNOWN_ISSUES.md#1`), no data loss.

Non-tujuan: ubah SOP greeting/ongkir penolakan out-of-coverage (tetap deterministik), tidak ganti pinned WAHA `devlikeapro/waha:noweb-2026.7.2`.

---

## 3. Prinsip

* Tenant-aware: semua query filter `tenant_id` (`DEFAULT_TENANT_ID`) — jangan hardcode.
* Idempotent & re-runnable (sync bisa jalan ulang tanpa duplikat `wa_message_id`).
* Defense-in-depth seperti fix Siska #777 (`docs/KNOWN_ISSUES.md#12`).
* Offline test green: `tests/setup.ts` mock DB tetap hijau.

---

## 4. Fase Implementasi

### Fase 0 — Diagnostic & Guard (0.5 hari, no code prod, read-only)

**Deliverable:** skrip `src/scripts/check-livechat-sync.ts` + `npm run check:livechat-sync`.

* Query laporan (read-only):
  ```sql
  -- phantom
  SELECT c.id, cust.phone FROM conversations c JOIN customers cust ON cust.id=c.customer_id LEFT JOIN messages m ON m.conversation_id=c.id WHERE m.id IS NULL LIMIT 20;
  -- drift
  SELECT c.id, cust.phone, c.last_message_at, (SELECT max(m.created_at) FROM messages m WHERE m.conversation_id=c.id) AS max_at FROM conversations c JOIN customers cust ON cust.id=c.customer_id WHERE (SELECT max(m.created_at) FROM messages m WHERE m.conversation_id=c.id) IS NOT NULL AND c.last_message_at <> (SELECT max(m.created_at) FROM messages m WHERE m.conversation_id=c.id) LIMIT 20;
  -- null wa id
  SELECT count(*), min(created_at), max(created_at) FROM messages WHERE wa_message_id IS NULL;
  -- history media drop check: WAHA getChats vs DB (butuh waha up)
  ```
* Output JSON + exit code (fail jika `phantom>0` atau `drift>0`). Mirip `src/scripts/check-router-accuracy.ts`.
* Log WAHA health: `wahaClient.getSessionStatus()` + `docker ps waha` — fail gate jika `DISCONNECTED`.
* **Notes eksekutor:** jalankan dulu di lokal (`WAHA_MOCK=true` expect phantom 64), lalu di staging & prod (read-only, no write).

### Fase 1 — Fix `last_message_at` Single Source (1 hari, high impact)

**Masalah:** 197 drift.

**Ubah:**
* `src/services/message.service.ts:324-353` — `logMessage` sudah `Promise.all [create, conversation.update last_message_at=effectiveMsgDate]`. Pastikan `effectiveMsgDate` selalu `createdAt` (WA timestamp) bukan `new Date()` saat `createdAt` ada. Tambah `await prisma.conversation.update` retry + fallback `memoryConversations` (sudah ada tapi tidak set `last_message_at` saat `existing` null).
* `src/services/conversation.service.ts:328-371` `updateConversationState` — jangan set `last_message_at=now` otomatis saat hanya ubah `is_human_handling` / `current_state`. Pisah: `touchLastMessageAt: boolean` param. Call site `escalateToHumanHandling`, `checkAndApplyAutoRelease`, `setManualUnread`, `togglePinConversation` harus `touch=false`. Hanya `logMessage` dan `waha-history-sync` yang `touch=true`. Saat ini `updateConversationState` selalu `last_message_at: new Date()` → overwrite drift.
* `src/services/live-chat.service.ts:764-766` `serialize` — `effectiveLastMsgAt = lastMsg?.created_at || c.last_message_at || c.updated_at` biarkan, tapi `listConversations` order harus `COALESCE(last_message_at, updated_at) desc` sama dengan serialize (sudah, tapi tambah komentar).
* **Migrasi repair (idempotent, no schema change):** tambah `src/scripts/repair-last-message-at.ts` yang `UPDATE conversations SET last_message_at = (SELECT max(created_at) FROM messages WHERE conversation_id=conversations.id) WHERE last_message_at <> (SELECT max(...))` — jalan sekali di prod via `docker compose exec app npx tsx src/scripts/repair-last-message-at.ts --dry-run` dulu.

**Test:** `tests/unit/conversation.test.ts` + `tests/unit/message.test.ts` — mock `logMessage` lalu assert `conversation.last_message_at === message.created_at`. Tambah `tests/unit/livechat-serialize.test.ts` (pinned vs lastMessageAt).

**Verifikasi:** `npx tsc` (`npm run build`) + `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script` harus `-- This is an empty migration.`

### Fase 2 — Phantom Conversations Hardening (0.5 hari)

**Masalah:** 64 rows `conversations` tanpa `messages` ter-sort paling atas.

**Ubah:**
* `src/services/conversation.service.ts:159-215` `listConversations` where `messages:{some:{}}` sudah benar untuk Prisma, tapi fallback memory `all` tidak respect `messages.some` untuk `mode=all` (hanya filter `mode !== all`). Fix memory fallback: filter `all.filter(c => memoryMessages.some(m=>m.conversation_id===c.id))` sebelum slice.
* **Cleanup one-off (opsional, soft):** `src/scripts/cleanup-phantom-conversations.ts` — tidak delete (audit), tapi set `last_message_at = created_at` dan `updated_at = created_at` agar turun ke bawah list, atau DELETE jika `created_at > 7 hari` dan `last_message_at = created_at` dan `0 messages` (dengan `--dry-run` default).
* **Prevention:** `getOrCreateConversation` tidak set `last_message_at` ke `now` saat create — set `null` atau `created_at` saja, biarkan `logMessage` yang isi. Ubah `src/services/conversation.service.ts:42-46` `create { last_message_at: null }` atau hapus default.

**Test:** `tests/unit/conversation-phantom.test.ts` — create conv tanpa message, assert `listConversations` tidak return.

### Fase 3 — History Sync Media Tanpa Body (0.5 hari)

**Masalah:** `waha-history-sync` drop media tanpa caption.

**Ubah:**
* `src/services/waha-history-sync.service.ts:196-199,378-381` — ganti filter `m.body && trim().length>0` menjadi `hasContent = (m.body && trim().length>0) || isMedia(m)` (`isMedia` cek `m.type==='image'|| m.hasMedia || m.mediaUrl`). Simpan `content = m.body || '[IMAGE]'` dan `payload_raw.media` jika ada (reuse logic `src/routes/webhook.route.ts:636-722` `isInboundImage` + `mergeMediaIntoPayload`). Idempotent via `isDuplicateMessage`.
* `src/services/waha-history-sync.service.ts:195,377` `getMessages` sudah sort `a.timestamp - b.timestamp` — pastikan `latestMsgDate` dihitung dari `rawTimestamp` termasuk media-only messages.

**Test:** `tests/unit/waha-history-sync.test.ts` — mock `wahaClient.getMessages` return `[{id:'x', body:'', type:'image', mediaUrl:'http://...'}]` assert `messageService.logMessage` dipanggil dengan `content='[IMAGE]'` dan `payload_raw.media.url`.

### Fase 4 — `wa_message_id` NULL & Ack Reconciliation (0.5 hari)

**Masalah:** 173 null → centang stuck.

**Ubah:**
* `src/services/typing.service.ts` / `src/services/follow-up.service.ts` / `cron` — sudah explicit `logMessage` dengan `wa_message_id` dari `sendTextDetailed` (fix follow-up 2026-08-26). Audit `src/routes/webhook.route.ts:461-471` outbound HP: `logMessage` dengan `waMessageId=payload.id` sudah benar. Tapi `src/services/live-chat.service.ts:402-412` admin reply via LiveChat: `logMessage` dengan `sendResult.messageId` — jika `sendResult.success=false` (WAHA down) jangan log `null`, tapi log dengan `delivery_status='failed'` + `wa_message_id=null` dan UI tampil `failed` (sudah ada cabang `if (!sendResult.success)` return error, tidak log — biarkan, tapi tambah alert `THIRD_PARTY_OUTAGE` sudah ada). Untuk `success=true` tapi `messageId` undefined (edge WAHA), fallback `wa_message_id='pending_'+logged.id` dan reconciliation cron `src/services/waha-monitor.service.ts` coba `getChats` later.
* Tambah `src/scripts/reconcile-null-wa-ids.ts` — `SELECT id FROM messages WHERE wa_message_id IS NULL AND created_at > now()-7d` → `wahaClient.getMessages(chatId)` lookup by `created_at ±5m` + `content` exact match → `UPDATE messages SET wa_message_id=...`.

### Fase 5 — Observabilitas (0.5 hari)

* Tambah `GET /api/admin/live-chat/sync-health` — return `{phantomCount, driftCount, nullWaIdCount, wahaStatus, lastSyncAt}` (reuse Fase 0 queries, no auth tambahan selain `ADMIN_API_KEY`). Frontend `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx` tampil banner kuning jika `driftCount>0` (link ke repair script).
* Log `src/routes/webhook.route.ts:372` `OUTBOUND_DUPLICATE_SKIPPED` dan `STALE MESSAGE GUARD` sudah ada — tambah `stageLog` structured agar `logs/app-*.log` grepable untuk next executor: `grep "STALE GUARD BYPASS\|OUTBOUND_DUPLICATE\|IN-FLIGHT BOT MATCH" logs/app-*.log`.

---

## 5. Urutan Eksekusi & Estimasi

| Fase | Estimasi | Ketergantungan | Risiko |
|------|----------|----------------|--------|
| 0 diagnostic | 0.5d | none | read-only, no risk |
| 1 last_message_at | 1d | 0 | medium (write DB) — but idempotent, test `prisma migrate diff` |
| 2 phantom | 0.5d | 1 | low |
| 3 history media | 0.5d | 0 | low (idempotent dedup) |
| 4 null ack | 0.5d | 1 | low |
| 5 observability | 0.5d | 1-4 | low |
| **Total** | **~3.5 hari** | | |

---

## 6. Verifikasi & Deploy

* **Lokal:** `WAHA_MOCK=true npm test` (full Vitest, `tests/setup.ts` DB offline mock), `npm run build` (`tsc`), `npx prisma migrate diff --from-url` empty.
* **Staging (wajib):** deploy `docker compose up -d` dengan `devlikeapro/waha:noweb-2026.7.2` pinned, `waha` container healthy, `GET /api/admin/live-chat/sync-health` phantom=0, `repair-last-message-at --dry-run` 0 rows, manual test: kirim WA image tanpa caption → LiveChat muncul `[IMAGE]`, kirim 2 bubble admin cepat → tidak `OUTBOUND_DUPLICATE_SKIPPED` palsu.
* **Prod deploy (2-step gate, lihat `.agents/rules/server-update-gate.md` & `docs/KNOWN_ISSUES.md#1`):**
  1. Backup: `docker exec clinic-postgres pg_dump -U postgres wa_clinic_db > /tmp/pre-livechat-fix.sql` + `npx prisma migrate diff --from-url` catat.
  2. Jalankan repair scripts dengan `--dry-run` dulu, lalu tanpa flag (idempotent). Log ke `logs/repair-*.log`.
  3. `docker compose up -d app` (jangan `latest` untuk WAHA), `docker compose logs -f app` 2 menit cek `WAHA_DISCONNECTED` tidak muncul.
  4. `GET /api/admin/live-chat/conversations?limit=5` bandingkan dengan WA Web manual (2 nomor sample).
  5. Jika drift masih >0, rollback `psql < /tmp/pre-livechat-fix.sql` atau `git revert`.

---

## 7. Risiko & Mitigasi

* **WAHA down saat repair** → repair tetap aman (hanya DB), tapi `sync-health` akan `wahaStatus=DISCONNECTED` → tunda Fase 3/4 sampai `waha` healthy.
* **Migrasi drift false alarm** → ikuti `docs/KNOWN_ISSUES.md#1` workaround `--from-url`, jangan `--from-migrations`.
* **Duplicate `wa_message_id`** → `messageService.isDuplicateMessage` + `checkAndAttachOutboundDuplicate` sudah handle, Fase 3 reuse dedup yang sama.

---

## 8. Notes untuk Eksekutor Selanjutnya

* **Lokasi plan ini:** `docs/IMPLEMENTATION_PLAN_LIVECHAT_WA_SYNC.md` (branch `plan/livechat-wa-sync`). Jangan edit `master` langsung — PR dari branch ini.
* **File yang akan diubah:** `src/services/message.service.ts`, `src/services/conversation.service.ts`, `src/services/live-chat.service.ts`, `src/services/waha-history-sync.service.ts`, `src/routes/webhook.route.ts`, `src/routes/admin/livechat.subroute.ts`, `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx` (banner), tambah `src/scripts/check-livechat-sync.ts`, `repair-last-message-at.ts`, `cleanup-phantom-conversations.ts`, `reconcile-null-wa-ids.ts`.
* **Cara lanjut:**
  ```bash
  git checkout plan/livechat-wa-sync
  # Fase 0 dulu (read-only)
  npx tsx src/scripts/check-livechat-sync.ts --json | jq
  # Fase 1
  # edit src/services/conversation.service.ts#328 touch flag, src/services/message.service.ts#343 effectiveMsgDate
  npm run build && npm test
  npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
  git commit -m "fix(livechat): sync last_message_at to max(messages.created_at)"
  git push origin plan/livechat-wa-sync
  ```
* **Jangan deploy Jumat malam / jam ramai iklan.** Staging wajib `waha` `WORKING` (`docker logs waha | grep SESSION_STATUS`).
* **Jika butuh data live:** minta 1-2 `phone` contoh yang mismatch + `conversationId` (dari `GET /api/admin/live-chat/conversations?search=phone`), lalu `docker exec clinic-postgres psql -c "SELECT ..."` seperti §6. Tanpa itu, eksekusi blind.
* **Catat ke `docs/KNOWN_ISSUES.md` setelah selesai:** tambah entry baru `#15 LiveChat WA sync mismatch` dengan `Status: fixed (2026-08-29)` + link commit, seperti entri `#14` & `#12`.
