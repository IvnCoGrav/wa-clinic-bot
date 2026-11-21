# Rencana Implementasi Revisi — Reply & Quoted Message End-to-End

- **Tanggal:** 2026-11-21
- **Status:** IMPLEMENTED & VERIFIED (2026-11-21) — termasuk hardening P1 pasca-audit (error WAHA asli, dua root payload, burst coalescing). Bukti verifikasi ada di `docs/KNOWN_ISSUES.md` #365.
- **Issue terkait:** `docs/KNOWN_ISSUES.md` #365 (WAHA HTTP 500 `Message id be in format ...`).
- **Dasar:** Audit plan awal 2026-11-21 (baca kode aktual, test existing, registry, log lokal).

---

## 0. Ringkasan Perubahan dari Plan Awal

| Area | Plan awal | Revisi | Alasan |
|---|---|---|---|
| Validasi ID | 1 fungsi di `live-chat.service.ts`, menerima stanza mentah | Util leaf `src/utils/whatsapp-message-id.ts`, **provider-aware**, stanza mentah DITOLAK untuk `reply_to` | WAHA hanya menerima serialized `false_...@c.us_...`; menaruh validator di service memicu circular import |
| Fallback driver | `try/catch` lalu retry | Deteksi `{ success:false }` + `error` eksplisit dari client; fallback **hanya** untuk error format ID | `WahaClient` menelan error, tidak pernah `throw` |
| Metadata setelah fallback | Tetap tulis `reply_to` | Tulis `reply_to_status` + warning; `reply_to` hanya jika quote benar-benar terkirim | UI tidak boleh menampilkan quote yang tidak terkirim |
| Premis Fase 3 | Parser hanya baca snake_case | Parser sudah baca camelCase; yang hilang adalah **backend tidak menulis quote** + dukungan `contextInfo` | Fakta kode `types/livechat.ts:134-138` |
| Quote inbound | Hanya `extendedTextMessage` | Semua tipe pesan (`image/video/document/audio/sticker`) | Customer sering me-reply foto |
| WABA | Tambal satu jalur | Satu helper + `mergeWabaMedia` (5+ jalur logging) | Stale/bypass/blocked/human-handling juga tampil di Live Chat |
| WAHA inbound | Per-cabang | Cukup `mergeMediaIntoPayload()` | Seam kanonis sudah dipakai 7+ jalur |
| AI grounding | Prefix ke `incomingText` | Field terpisah `quotedContext`, hanya masuk grounding/prompt | `incomingText` dipakai tool masking, latches, RAG — tidak boleh dicemari |
| Test AI | "LLM mengenali paket" | Assert prompt/contextSummary + routing mock | Unit test tidak boleh bergantung model hidup |
| Gate | Satu gate di akhir | Gate per fase + gate akhir | Mandat repo |

---

## 1. Prinsip Desain & Seam yang Diuji

### 1.1 Seam (interface publik yang diuji)

1. `isValidReplyToForProvider(provider, id)` — fungsi murni, tanpa I/O.
2. `isReplyIdFormatError(message)` — fungsi murni.
3. `WhatsAppGateway.sendTextMessage/sendImageMessage` — kontrak driver (test pakai fake client).
4. `LiveChatService.sendAdminReply` — perilaku end-to-end pengiriman admin.
5. `parseCanonicalInboundMessage(payload, opts?)` — normalisasi quote inbound.
6. `extractQuotedMessage(msg)` — helper dashboard (dipakai Live Chat & PWA Staf).
7. `ContextGrounder.buildContextSummary(session, text, history, quotedContext?)` — grounding AI.

### 1.2 Aturan yang dipegang

- **Tidak ada dependensi runtime baru.**
- **Tidak menyentuh label WAHA** (mandat).
- **Tidak menambah halaman/dashboard baru**; hanya komponen/util yang sudah ada.
- **Tidak mengubah `incomingText`** untuk membawa quote.
- Semua kegagalan quote bersifat **fail-open**: pesan utama tetap terkirim.

---

## 2. Fase 0 — Bukti Payload Nyata (gate untuk Fase 2)

**Tujuan:** memastikan bentuk payload nyata, bukan asumsi. Tidak mengubah kode.

### Tugas 0.1 — Ambil 3 sample payload produksi

Simpan (redaksi nomor telepon/nama) ke `tests/fixtures/quoted/`:

1. `waha-noweb-inbound-text-reply.json` — customer membalas teks bot.
2. `waha-noweb-inbound-image-reply.json` — customer membalas foto.
3. `waba-inbound-context-reply.json` — WABA dengan `context.id`.
4. Opsional: `waha-noweb-outbound-hp-reply.json` — admin membalas dari HP.

**Cara aman:** ambil dari log webhook di server (bukan dari DB produksi), redaksi `phone`, `pushName`, isi medis sensitif. Jangan commit kredensial.

### Acceptance criteria

- [ ] 4 file fixture ada, valid JSON.
- [ ] Minimal satu fixture memiliki `message.*.contextInfo.stanzaId` + `quotedMessage`.
- [ ] Tidak ada nomor telepon/nama pasien asli.

**Gate:** jika fixture tidak tersedia, Fase 2 **tidak boleh dieksekusi** (boleh lanjut Fase 1).

---

## 3. Fase 1 — Jalur Kirim Aman (P0: hentikan error 500 & pesan hilang)

**Dependency:** tidak ada.
**Blast radius:** service live chat, driver WAHA, client WAHA, composer frontend.

### Tugas 1.1 — Util validasi ID (RED dulu)

**Test baru:** `tests/unit/whatsapp-message-id.test.ts`

Kasus wajib:

| Input | Provider | Harapan |
|---|---|---|
| `false_628123@c.us_3EB0ABC` | WAHA | `true` |
| `true_628123@c.us_3EB0ABC_628999@c.us` | WAHA | `true` |
| `temp_1795220000994` | WAHA | `false` |
| `9f1c...` UUID v4 | WAHA | `false` |
| `3EB0ABCDEF123456` (stanza mentah) | WAHA | `false` |
| `wamid.HBgMNTY4...` | WABA | `true` |
| `false_628123@c.us_3EB0ABC` | WABA | `false` |
| `null` / `''` / `'   '` | keduanya | `false` |

**File baru:** `src/utils/whatsapp-message-id.ts`

```ts
export type ReplyProvider = 'WAHA' | 'WABA';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// WAHA NOWEB/Baileys: false_<jid>@<server>_<stanza>[_<participant>]
const WAHA_SERIALIZED_RE = /^(true|false)_[^_@\s]+@[^_\s]+_.+$/;

// Meta Cloud API message id (base64-ish).
const WABA_WAMID_RE = /^wamid\.[A-Za-z0-9+/=_-]+$/;

export function isValidReplyToForProvider(
  provider: ReplyProvider,
  id?: string | null
): boolean {
  const value = (id ?? '').trim();
  if (!value) return false;
  if (value.startsWith('temp_')) return false;
  if (UUID_RE.test(value)) return false;
  return provider === 'WABA'
    ? WABA_WAMID_RE.test(value)
    : WAHA_SERIALIZED_RE.test(value);
}

/** True hanya untuk error format reply_to yang dilaporkan WAHA. */
export function isReplyIdFormatError(message?: string | null): boolean {
  return /message id be in format/i.test(message ?? '');
}
```

**Acceptance:** `npx vitest run tests/unit/whatsapp-message-id.test.ts` hijau.

---

### Tugas 1.2 — Client WAHA mengembalikan detail error

**Masalah:** `sendTextDetailed`/`sendImageDetailed` menangkap semua error dan mengembalikan `{ success:false }` tanpa pesan (`src/integrations/waha/client.ts:545-570`, `:587-...`).

**File:** `src/integrations/waha/client.ts`

1. Ubah tipe hasil (interface `IWahaClient` baris 58-61 dan implementasi):

```ts
export interface WahaSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  status?: number;
}
```

2. Di blok `catch` `sendTextDetailed`:

```ts
const status = error?.response?.status;
const detail =
  error?.response?.data?.message ||
  error?.response?.data?.error ||
  error?.message ||
  'sendText failed';
console.error(`[WAHA API ERROR] sendText failed for ${targetChatId}:`, error?.response?.data || error?.message);
return { success: false, error: String(detail), status };
```

3. Lakukan hal yang sama pada `sendImageDetailed`.

**Acceptance:** `npm run typecheck`; `npx vitest run tests/unit/waha-cutoff.test.ts` tetap hijau.

---

### Tugas 1.3 — Fallback driver WAHA (RED dulu)

**Test baru:** `tests/unit/waha-reply-fallback.test.ts`

Gunakan pola `tests/unit/waha-cutoff.test.ts` (fake client + `WahaGatewayDriver`).

Kasus:

1. Client mengembalikan `{ success:false, error:'Message id be in format ...' }` pada call pertama, `{ success:true, messageId:'m2' }` pada call kedua.
   - Harapan: call 1 dengan `replyTo`, call 2 **tanpa** `replyTo`; `result.success === true`; `result.replyToDropped === true`.
2. Client mengembalikan `{ success:false, error:'timeout' }`.
   - Harapan: **tidak ada** fallback (cegah pesan dobel); `result.success === false`.
3. Tanpa `replyToMessageId`: hanya 1 call.
4. `sendImageMessage` mengikuti perilaku yang sama.

**File:** `src/integrations/whatsapp/gateway.types.ts`

```ts
export interface SendResult {
  success: boolean;
  messageId?: string;
  provider: WhatsAppProvider;
  rawResponse?: unknown;
  /** True bila quote dibatalkan karena provider menolak ID, tetapi pesan utama terkirim. */
  replyToDropped?: boolean;
  error?: { code: string; message: string; isRateLimit?: boolean };
}
```

**File:** `src/integrations/whatsapp/waha.driver.ts`

Tambahkan helper privat:

```ts
private async sendWithReplyFallback<T extends { success: boolean; messageId?: string; error?: string }>(
  send: (replyTo?: string) => Promise<T>,
  replyTo?: string
): Promise<T & { replyToDropped?: boolean }> {
  if (!replyTo) return send();
  const first = await send(replyTo);
  if (first.success) return first;
  if (!isReplyIdFormatError(first.error)) return first;

  console.warn(
    `[WAHA DRIVER] replyToMessageId=${replyTo} ditolak (${first.error}). ` +
      'Fallback mengirim pesan tanpa quote agar pesan utama tetap terkirim.'
  );
  const fallback = await send();
  return { ...fallback, replyToDropped: fallback.success };
}
```

Gunakan di `sendTextMessage` dan `sendImageMessage`; petakan `replyToDropped` ke `SendResult`, dan isi `error` bila gagal.

**Acceptance:** test baru hijau; test cutoff hijau.

---

### Tugas 1.4 — Service: quote hanya jika valid & benar-benar terkirim

**Test:** tambah kasus di `tests/unit/live-chat.service.test.ts`.

1. Fixture existing `false_628201_WA_MSG_123` **diubah** menjadi format sah: `false_628201@c.us_WA_MSG_123` (baris 127, 142).
2. Kasus baru: pesan DB dengan `waMessageId: null` + `replyToMessageId` internal UUID → gateway dipanggil **tanpa** argumen ketiga; `payload_raw.reply_to` tidak ada; `payload_raw.quoted_message` tetap ada.
3. Kasus baru: `replyToMessageId = 'temp_...'` → tidak ada reply ke gateway, pengiriman teks tetap sukses.
4. Kasus baru: `replyToMessageId` milik percakapan lain → quote ditolak (cross-conversation guard).

**File:** `src/services/live-chat.service.ts` (blok 477-502)

```ts
import { isValidReplyToForProvider } from '../utils/whatsapp-message-id';

// ...
if (replyToMessageId) {
  try {
    const quotedMsg = await messageService.getMessageById(replyToMessageId, tenantId);
    if (!quotedMsg) {
      console.warn(`[Live Chat] Pesan kutipan tidak ditemukan: ${replyToMessageId} — quote dilewati.`);
    } else if (quotedMsg.conversation_id && quotedMsg.conversation_id !== conversationId) {
      console.warn(`[Live Chat] Tolak quote lintas percakapan: ${replyToMessageId} — quote dilewati.`);
    } else {
      quotedMeta = {
        id: quotedMsg.id,
        wa_message_id: quotedMsg.wa_message_id,
        direction: quotedMsg.direction,
        sender_name:
          quotedMsg.sender_name ||
          (quotedMsg.direction === 'INBOUND' ? customer.name || 'Customer' : 'Admin'),
        sender_type: quotedMsg.sender_type,
        content: quotedMsg.content,
        media: (quotedMsg as any).payload_raw?.media || undefined,
      };
      if (isValidReplyToForProvider(gateway.providerType, quotedMsg.wa_message_id)) {
        replyToWaMessageId = quotedMsg.wa_message_id;
      } else {
        console.warn(
          `[Live Chat] wa_message_id tidak valid untuk ${gateway.providerType}: ` +
            `${quotedMsg.wa_message_id ?? '(null)'} — quote dilewati, teks tetap dikirim.`
        );
      }
    }
  } catch (err: any) {
    console.warn('[Live Chat] Gagal mengambil detail quoted message:', err.message);
    // JANGAN fallback ke replyToMessageId.
  }
}
```

Setelah pengiriman sukses (blok 663-669):

```ts
if (quotedMeta) payloadRaw.quoted_message = quotedMeta;
if (replyToWaMessageId && !sendResult.replyToDropped) {
  payloadRaw.reply_to = replyToWaMessageId;
}
if (sendResult.replyToDropped) {
  payloadRaw.reply_to_status = 'dropped_after_provider_reject';
}
```

Tambahkan warning hasil ke return (baris 840):

```ts
const replyToWarning = sendResult.replyToDropped ? 'REPLY_TO_DROPPED' : undefined;
// ...
warning: persistenceWarning || dispatchWarning || replyToWarning,
```

**Acceptance:** seluruh `tests/unit/live-chat.service.test.ts` hijau.

---

### Tugas 1.5 — Guard composer frontend

**File:** `packages/admin-dashboard/src/hooks/useLiveChatComposerHandler.ts` (baris 476-478)

```ts
if (currentReplyingTo) {
  const candidate = currentReplyingTo.wa_message_id || currentReplyingTo.id;
  if (candidate && !candidate.startsWith('temp_')) {
    body.replyToMessageId = candidate;
  }
}
```

**Tambahan UX (opsional, kecil):** di handler warning (baris 516-529), tampilkan pesan khusus:

```ts
if (sendWarning === 'REPLY_TO_DROPPED') {
  toast('Pesan terkirim, tetapi kutipan tidak terkirim karena ID pesan tidak valid.', 'info');
}
```

**Acceptance:** `cd packages/admin-dashboard && npm run build` sukses.

---

### Gate Regresi Fase 1 (wajib sebelum Fase 2)

```powershell
npm run typecheck
npx vitest run tests/unit/whatsapp-message-id.test.ts
npx vitest run tests/unit/live-chat.service.test.ts
npx vitest run tests/unit/waha-reply-fallback.test.ts
npx vitest run tests/unit/waha-cutoff.test.ts
npm run check:reuse
```

Semua harus hijau. Tidak boleh lanjut bila ada failure.

---

## 4. Fase 2 — Normalisasi Quote Inbound (WAHA NOWEB/WEBJS + WABA)

**Dependency:** Fase 0 (fixture nyata) + Fase 1 (gate hijau).
**Blast radius:** normalizer, webhook WAHA, webhook WABA, payload DB, AI input.

### Tugas 2.1 — Tipe & ekstraktor quote di normalizer (RED dulu)

**Test baru:** `tests/unit/quoted-message-normalizer.test.ts`

Gunakan fixture Fase 0. Kasus minimal:

1. NOWEB teks: `message.extendedTextMessage.contextInfo` → `quoted.content` = teks asli, `quoted.wa_message_id` = `stanzaId`, `direction = 'OUTBOUND'` (participant = nomor bot).
2. NOWEB gambar: `contextInfo` di `imageMessage` → `quoted.content` mengandung `[IMAGE: ...]`.
3. NOWEB customer mengutip pesannya sendiri → `direction = 'INBOUND'`.
4. WEBJS: `_data.quotedMsg` → konten & ID benar.
5. Payload tanpa quote → `quoted` undefined (tidak ada regresi).
6. `temp_`/UUID tidak pernah menjadi `wa_message_id`.

**File:** `src/utils/canonical-message-normalizer.ts`

```ts
export interface NormalizedQuotedMessage {
  id?: string;
  wa_message_id?: string;
  sender_name?: string;
  sender_type?: 'CUSTOMER' | 'ADMIN' | 'BOT';
  direction?: 'INBOUND' | 'OUTBOUND';
  content: string;
  media?: NormalizedMedia;
}

export interface CanonicalParseOptions {
  /** Nomor customer pada percakapan ini — untuk menentukan arah quote. */
  customerPhone?: string;
}

export interface CanonicalInboundParseResult {
  type: CanonicalMessageType;
  content: string;
  location?: NormalizedLocation;
  media?: NormalizedMedia;
  contact?: NormalizedContact;
  rawText?: string;
  quoted?: NormalizedQuotedMessage;
}

export function parseCanonicalInboundMessage(
  payload: any,
  opts?: CanonicalParseOptions
): CanonicalInboundParseResult { /* ... */ }
```

**Aturan ekstraksi (wajib):**

- Pindai `contextInfo` di **semua** tipe: `extendedTextMessage`, `imageMessage`, `videoMessage`, `documentMessage`, `audioMessage`, `stickerMessage`, `contactMessage`, `locationMessage`.
- Sumber root: `payload.message`, `payload._data?.message`, `payload.contextInfo`, `payload._data?.contextInfo`.
- Fallback WEBJS: `payload.quotedMsg` / `payload._data?.quotedMsg`.
- `wa_message_id` = `contextInfo.stanzaId` (NOWEB) atau `quotedMsg.id._serialized || quotedMsg.id` (WEBJS).
- `content` adaptif: `conversation` → `extendedTextMessage.text` → `imageMessage.caption` (prefix `[IMAGE: ...]`) → `videoMessage.caption` → `documentMessage.caption || fileName` → `[AUDIO]` / `[STICKER]` / `[CONTACT]` / `[LOCATION]`.
- **Arah:** `quotedMsg.fromMe` bila ada; jika tidak, bandingkan digit `contextInfo.participant` dengan `opts.customerPhone` → sama = `INBOUND`, beda = `OUTBOUND`; jika tidak bisa ditentukan → `undefined` (jangan menebak).
- `sender_type`: `INBOUND` → `CUSTOMER`, `OUTBOUND` → `ADMIN` (heuristik; label BOT tidak dapat dipastikan dari payload quote).

**Acceptance:** test hijau.

---

### Tugas 2.2 — WAHA inbound: satu seam `mergeMediaIntoPayload`

**File:** `src/routes/webhook.route.ts`

1. Panggil normalizer dengan nomor customer:

```ts
const canonical = parseCanonicalInboundMessage(payload, { customerPhone: phone });
```

2. Di `mergeMediaIntoPayload` (baris 907-925), tambahkan:

```ts
if (canonical.quoted) {
  cleanedPayload.quoted_message = canonical.quoted;
}
```

3. Di objek `incomingMessage` utama (baris 1266+), tambahkan:

```ts
quoted: canonical.quoted,
```

**Dampak:** seluruh jalur `logInboundWithoutReply` (stale, bypass, blocked, scope-gate, normal) otomatis mendapat `quoted_message`, dan state machine menerima `incomingMessage.quoted`.

**Acceptance:**
- Test unit normalizer hijau.
- Tambah assertion di test webhook existing (jika ada) atau test baru `tests/unit/waha-inbound-quoted-payload.test.ts`: `mergeMediaIntoPayload` tidak menghapus media/location dan menambahkan quote.
- `grep -n "quoted_message" src/routes/webhook.route.ts` menunjukkan hanya 1 titik penulisan (seam).

---

### Tugas 2.3 — WABA: resolve `context.id` sekali per pesan

**File:** `src/routes/waba-webhook.route.ts`

Di dalam loop pesan, setelah `tenantId` diketahui dan sebelum `mergeWabaMedia` didefinisikan (sekitar baris 221), hitung:

```ts
const quoted = await (async (): Promise<NormalizedQuotedMessage | undefined> => {
  const contextId = (msg.rawPayload as any)?.context?.id;
  if (!contextId) return undefined;
  try {
    const original = await messageService.getMessageById(contextId, tenantId);
    if (!original?.content) return undefined; // fail-open
    return {
      id: original.id,
      wa_message_id: original.wa_message_id || contextId,
      direction: original.direction,
      sender_type: original.sender_type,
      sender_name: original.sender_name,
      content: original.content,
      media: (original as any).payload_raw?.media || undefined,
    };
  } catch {
    return undefined; // DB lambat/offline: quote dilewati, pesan tetap masuk
  }
})();
```

Lalu di `mergeWabaMedia` (baris 221-230):

```ts
if (quoted) res.quoted_message = quoted;
```

Dan di `incomingMessage` utama (baris 454-470):

```ts
quoted,
```

**Dampak:** semua jalur `logInboundWithoutReply` WABA (stale, bypass, blocked, scope-gate, human handling) memakai seam yang sama.

**Test baru:** `tests/integration/waba-webhook-quoted.test.ts` (ikuti pola `tests/integration/waba-webhook-route.test.ts`):

1. `context.id` ada + pesan ditemukan di memory store → `payload_raw.quoted_message.content` benar.
2. `context.id` ada + pesan tidak ditemukan → pesan tetap tersimpan, tanpa exception.
3. Tanpa `context` → tidak ada perubahan perilaku.

**Acceptance:** 3 kasus hijau.

---

### Tugas 2.4 — Outbound dari HP admin (WAHA)

**File:** `src/routes/webhook.route.ts` (baris 609-619)

```ts
const outboundPayloadRaw: Record<string, any> = outboundMedia
  ? { ...payload, media: outboundMedia }
  : { ...payload };

if (outCanonical.quoted) {
  outboundPayloadRaw.quoted_message = outCanonical.quoted;
}

void logOutboundMessageWithRetry({
  // ...
  payloadRaw: outboundPayloadRaw,
});
```

**Test:** tambah kasus di `tests/unit/waha-inbound-quoted-payload.test.ts` atau test webhook outbound existing: payload `fromMe` dengan `contextInfo` → `payload_raw.quoted_message` tersimpan; tanpa context → tidak ada field.

**Acceptance:** test hijau.

---

### Gate Regresi Fase 2

```powershell
npm run typecheck
npx vitest run tests/unit/quoted-message-normalizer.test.ts
npx vitest run tests/unit/waha-inbound-quoted-payload.test.ts
npx vitest run tests/integration/waba-webhook-quoted.test.ts
npx vitest run tests/integration/waba-webhook-route.test.ts
npm run check:reuse
```

---

## 5. Fase 3 — Tampilan Quote di Dashboard & PWA Staf

**Dependency:** Fase 2 (backend menulis `quoted_message`).
**Blast radius:** frontend saja.

### Tugas 3.1 — Satu helper quote (RED dulu)

**Test baru:** `tests/unit/quoted-message-dashboard.test.ts` (root Vitest; helper murni tanpa React).

Kasus:

1. `msg.quoted_message` normalized → terbaca.
2. SSE camelCase `msg.payloadRaw.quoted_message` → terbaca (regresi #365 realtime).
3. Legacy snake_case `msg.payload_raw.quoted_message` → terbaca.
4. Payload NOWEB mentah tanpa normalisasi (`message.extendedTextMessage.contextInfo`) → terbaca.
5. `temp_`/UUID tidak dijadikan `wa_message_id`.
6. Media quote tanpa URL tetap menghasilkan indikator `media` (mimeType/caption).

**File baru:** `packages/admin-dashboard/src/utils/quotedMessage.ts`

- Pindahkan `QuotedMessageData` + `extractQuotedMessage` dari `types/livechat.ts`.
- Dukung: `quoted_message`, `payload_raw`, `payloadRaw`, `quotedMsg`, `_data.quotedMsg`, `contextInfo` semua tipe pesan.
- `wa_message_id` hanya dari `stanzaId`/`quotedMsg.id` yang valid; jangan fallback ke `temp_`.

**File:** `packages/admin-dashboard/src/types/livechat.ts`

```ts
import type { QuotedMessageData } from '../utils/quotedMessage';
export type { QuotedMessageData } from '../utils/quotedMessage';
export { extractQuotedMessage } from '../utils/quotedMessage';
```

Hapus implementasi lokal (baris 133-154). `ChatMessage.quoted_message` tetap memakai tipe re-export.

**Acceptance:** test hijau; `grep extractQuotedMessage` hanya 1 implementasi.

---

### Tugas 3.2 — PWA Staf memakai helper yang sama

**File:** `packages/admin-dashboard/src/pages/staff/StaffChatBubble.tsx` (baris 54-91)

- Hapus `extractQuotedMessage` lokal.
- Import dari `../../utils/quotedMessage`.
- Pertahankan masking PII:

```ts
const quotedMsg = extractQuotedMessage(msg);
const maskedQuoted = quotedMsg && !isSupervisor
  ? {
      ...quotedMsg,
      content: maskPhoneInTextClient(quotedMsg.content || ''),
      sender_name: quotedMsg.sender_name ? maskPhoneInTextClient(quotedMsg.sender_name) : quotedMsg.sender_name,
      media: quotedMsg.media?.caption
        ? { ...quotedMsg.media, caption: maskPhoneInTextClient(quotedMsg.media.caption) }
        : quotedMsg.media,
    }
  : quotedMsg;
```

**File:** `packages/admin-dashboard/src/pages/staff/StaffToday.tsx` (baris 996-...) — ganti mapping manual dengan helper yang sama agar tidak ada parser ketiga.

**Acceptance:** `cd packages/admin-dashboard && npm run build`; `npm run check:ui-reuse` (jika relevan); grep memastikan tidak ada duplikasi parser.

---

### Gate Regresi Fase 3

```powershell
npx vitest run tests/unit/quoted-message-dashboard.test.ts
npm run typecheck
cd packages/admin-dashboard; npm run build
```

---

## 6. Fase 4 — Grounding AI (tanpa mencemari `incomingText`)

**Dependency:** Fase 2 (`incomingMessage.quoted` tersedia).
**Blast radius:** state machine, agent runner, context grounder, generation stage.

### Tugas 4.1 — Tambah `quotedContext` sebagai field terpisah

**File:** `src/v3/agent/agent-runner.ts` (interface baris 42-59)

```ts
import type { NormalizedQuotedMessage } from '../../utils/canonical-message-normalizer';

export interface AgentRunnerInput {
  // ...
  /** Konteks pesan yang dikutip customer — HANYA untuk grounding, bukan untuk gate deterministik. */
  quotedContext?: NormalizedQuotedMessage;
}
```

**File:** `src/state-machine/machine.ts` (baris 593-607)

```ts
const v3Result = await V3AgentRunner.processMessage({
  // ...
  incomingText: effectiveInboundText,
  quotedContext: (incomingMessage as any).quoted,
  // ...
});
```

**DILARANG** mengubah `effectiveInboundText` menjadi `[Membalas pesan: ...]`.

**Acceptance:** `grep -n "Membalas pesan" src/` tidak menemukan apa pun.

---

### Tugas 4.2 — Suntik quote ke `buildContextSummary`

**File:** `src/v3/agent/pipeline/context-grounder.ts` (baris 144-171)

```ts
private static buildQuotedBlock(q?: NormalizedQuotedMessage): string {
  const raw = (q?.content || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const snippet = raw.length > 140 ? `${raw.slice(0, 137)}...` : raw;
  return (
    `[PESAN YANG DIBALAS CUSTOMER]: "${snippet}"\n` +
    '(Respon dan pilihan customer di bawah ini merujuk langsung pada pesan yang dikutip tersebut.)\n'
  );
}

public static buildContextSummary(
  session: CustomerGoalSession,
  cleanIncomingText: string,
  conversationHistory: Array<{ role: string; content: string }>,
  quotedContext?: NormalizedQuotedMessage
): string {
  try {
    const summary = V3ConversationSummarizer.summarize(/* ... */);
    const quotedBlock = this.buildQuotedBlock(quotedContext);
    const body = quotedBlock ? `${quotedBlock}${summary}` : summary;
    const loc = (session as any)?.location;
    if (loc && (loc.kelurahan || loc.kecamatan || loc.kota || loc.rawText)) {
      const label = loc.kelurahan || loc.kecamatan || loc.kota || loc.rawText;
      const isPrecise = Boolean(loc.kelurahan || loc.kecamatan || loc.kota);
      const dist = (isPrecise && loc.distanceKm != null) ? ` (${loc.distanceKm} km, rute aktif)` : '';
      return `[LOKASI TERKUNCI]: ${label}${dist}\n${body}`;
    }
    return body;
  } catch {
    return '';
  }
}
```

**File:** `src/v3/agent/pipeline/generation-stage.ts` (baris 900-933)

- Tambah `quotedContext?: NormalizedQuotedMessage` ke tipe `opts`.
- Teruskan ke `ContextGrounder.buildContextSummary(session, cleanIncomingText, conversationHistory, quotedContext)`.

**File:** `src/v3/agent/agent-runner.ts` — dua call site:

- baris 488-492
- baris 541-545

Keduanya menambahkan `quotedContext: input.quotedContext`.

**File:** baris 178 — `buildContextSummary(..., input.quotedContext)`.

**Acceptance:** Call 1 (router) dan Call 2 (generation) sama-sama melihat blok quote.

---

### Tugas 4.3 — Test grounding (RED dulu)

**Test baru:** `tests/unit/v3-quoted-grounding.test.ts`

1. `buildContextSummary(session, 'Mau yang ini ya kak', [], { content: 'Paket 2: Pijat + ...', direction: 'OUTBOUND' })` mengandung snippet.
2. Cuplikan >140 karakter dipotong menjadi 140 + `...`.
3. Tanpa `quotedContext` → output identik dengan sebelum perubahan.
4. `quotedContext.content` kosong → tidak ada blok kosong.
5. **Bukan** test LLM: tidak memanggil model.

**Acceptance:** test hijau.

---

### Gate Regresi Fase 4

```powershell
npm run typecheck
npx vitest run tests/unit/v3-quoted-grounding.test.ts
npx vitest run tests/unit/reply-contract.test.ts
npm run check:reuse
```

---

## 7. Fase 5 — Gate Akhir & Dokumentasi

### Tugas 5.1 — Full verification

```powershell
npm run typecheck
npm run check:reuse
npm run build
cd packages/admin-dashboard; npm run build
cd ../..
npm test
```

**Acceptance:** tidak ada failure baru. Failure yang diklaim pre-existing wajib dibuktikan dengan revert-and-rerun.

### Tugas 5.2 — Dokumentasi wajib

1. `docs/KNOWN_ISSUES.md`
   - Update #365: status `FIXED` + tanggal + bukti test + catatan `replyToDropped`.
2. `docs/FEATURE_INVENTORY.md`
   - Tambah entri: "Quoted message (reply context) end-to-end: Live Chat, PWA Staf, WABA, WAHA, AI grounding."
3. `docs/MODULE_INDEX.md` + `scripts/module-registry.json`
   - Daftarkan `src/utils/whatsapp-message-id.ts` sebagai modul kanonis.
4. Tidak perlu ADR (tidak ada halaman baru).

### Tugas 5.3 — Manual smoke test (wajib, 1x)

1. Admin membalas pesan pasien dari dashboard → quote muncul di WhatsApp pasien.
2. Admin membalas bubble optimistik (`temp_`) → pesan teks tetap terkirim, tanpa error 500.
3. Customer membalas pesan bot → Live Chat menampilkan quote setelah reload **dan** real-time (SSE).
4. Customer membalas foto bot → quote menampilkan indikator foto/caption.
5. WABA: customer membalas pesan bot → quote tampil.
6. Admin membalas dari HP → quote tampil di dashboard.

---

## 8. Analisis Risiko & Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| ID WA berubah format di WAHA baru | Quote ditolak | Validator provider-aware + `replyToDropped` + fallback teks |
| Timeout ambigu (WAHA sudah kirim, response gagal) | Pesan dobel | Fallback HANYA untuk `Message id be in format`; bukan error generik |
| Payload Baileys berbeda dari fixture | Quote tidak terdeteksi | Fase 0 wajib; test memakai fixture nyata; fail-open |
| `incomingText` tercemar | Tool masking/RAG salah | `quotedContext` terpisah; acceptance grep |
| Prompt membengkak | Latensi naik | Maksimal 140 karakter |
| WABA DB lookup lambat/offline | Webhook lambat | Fail-open, `try/catch`, hanya saat `context.id` ada |
| Burst coalescing menghapus quote terakhir | Quote hilang pada pesan gabungan | Catat sebagai batasan; verifikasi di smoke test; bila perlu, simpan quote pesan terakhir di `burstCoalesceService` (di luar scope awal) |
| Cross-conversation quote | Kebocoran konteks | Guard `conversation_id` di service |
| Duplikasi parser dashboard | Reuse gate gagal | Satu helper `utils/quotedMessage.ts` |

---

## 9. Non-Goals

- Tidak mengunduh media quote (hanya caption/indikator).
- Tidak menambah dependency.
- Tidak mengubah label WAHA.
- Tidak membuat halaman/dashboard baru.
- Tidak mengubah alur bot di luar grounding quote.
- Tidak memperbaiki bug lama di `StaffToday`/`StaffChatBubble` yang tidak terkait quote.

---

## 10. Konfirmasi Sebelum Eksekusi

Plan ini **belum dieksekusi**. Sebelum Fase 1 dimulai, diperlukan konfirmasi eksplisit manusia:

- [ ] Setuju dengan pemindahan validator ke `src/utils/whatsapp-message-id.ts`.
- [ ] Setuju fallback driver hanya untuk error format ID (bukan semua error).
- [ ] Setuju `quotedContext` terpisah (tanpa prefix `incomingText`).
- [ ] Setuju penambahan `replyToDropped`/`reply_to_status` pada kontrak `SendResult`/payload.
- [ ] Fase 0 (fixture produksi) tersedia sebelum Fase 2.

Setelah checklist di atas disetujui, eksekusi dilakukan **fase demi fase** dengan gate regresi di setiap akhir fase.
