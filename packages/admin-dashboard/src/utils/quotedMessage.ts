import type { ChatMediaData } from '../components/common/MediaImage';
import { extractMedia } from './mediaExtractor';

export interface QuotedMessageData {
  id?: string;
  wa_message_id?: string | null;
  direction?: 'INBOUND' | 'OUTBOUND';
  sender_name?: string | null;
  sender_type?: string | null;
  content?: string;
  media?: ChatMediaData;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WAHA_SERIALIZED_RE = /^(true|false)_[^_@\s]+@[^_\s]+_.+$/;
const WABA_WAMID_RE = /^wamid\.[A-Za-z0-9+/=._-]+$/;

const MESSAGE_CONTEXT_KEYS = [
  'extendedTextMessage',
  'imageMessage',
  'videoMessage',
  'documentMessage',
  'audioMessage',
  'stickerMessage',
  'contactMessage',
  'locationMessage',
  'liveLocationMessage',
] as const;

/**
 * Sanitasi wa_message_id agar ID sementara (temp_*) atau UUID internal DB
 * tidak dianggap sebagai WhatsApp message ID resmi provider.
 */
function sanitizeDashboardWaMessageId(id?: any): string | null {
  if (!id) return null;
  const s = String(id).trim();
  if (!s || s.startsWith('temp_') || UUID_REGEX.test(s)) {
    return null;
  }
  // Hanya ID provider yang sah untuk jump-to-message. Stanza mentah Baileys
  // tidak akan pernah cocok dengan wa_message_id yang tersimpan di DB.
  return WAHA_SERIALIZED_RE.test(s) || WABA_WAMID_RE.test(s) ? s : null;
}

/**
 * Ekstraktor tunggal kanonis quoted_message di frontend Dashboard & PWA Staf.
 * Mendukung:
 * 1. msg.quoted_message (hasil normalizer backend)
 * 2. msg.payloadRaw.quoted_message (SSE realtime camelCase)
 * 3. msg.payload_raw.quoted_message (DB storage snake_case)
 * 4. msg.payload_raw.quotedMsg / _data.quotedMsg (WEBJS)
 * 5. contextInfo Baileys/NOWEB pada berbagai tipe pesan
 */
export function extractQuotedMessage(msg: any): QuotedMessageData | undefined {
  if (!msg) return undefined;

  const directQuoted =
    msg.quoted_message ??
    msg.quotedMessage ??
    msg.payloadRaw?.quoted_message ??
    msg.payloadRaw?.quotedMessage ??
    msg.payload_raw?.quoted_message ??
    msg.payload_raw?.quotedMessage ??
    msg.payload_raw?.quotedMsg ??
    msg.payload_raw?._data?.quotedMsg ??
    msg.payloadRaw?.quotedMsg ??
    msg.payloadRaw?._data?.quotedMsg ??
    msg.quotedMsg ??
    msg._data?.quotedMsg;

  // Jika quote objek terstruktur ditemukan
  if (directQuoted) {
    const q = directQuoted;
    let content =
      q.content ??
      q.body ??
      q.text ??
      (q.message?.conversation || q.message?.extendedTextMessage?.text) ??
      '';

    let media: ChatMediaData | undefined = undefined;
    if (q.media && typeof q.media === 'object') {
      media = { ...q.media };
    } else {
      media = extractMedia(q);
    }

    // Ekstraksi teks dari pesan media jika content kosong
    if (!content && q.message) {
      if (q.message.imageMessage) {
        const caption = q.message.imageMessage.caption || '';
        content = caption ? `[IMAGE: ${caption}]` : '[IMAGE]';
        if (!media) {
          media = { mimeType: q.message.imageMessage.mimetype || 'image/jpeg', caption: caption || undefined };
        }
      } else if (q.message.videoMessage) {
        const caption = q.message.videoMessage.caption || '';
        content = caption ? `[VIDEO: ${caption}]` : '[VIDEO]';
        if (!media) {
          media = { mimeType: q.message.videoMessage.mimetype || 'video/mp4', caption: caption || undefined };
        }
      } else if (q.message.documentMessage) {
        const doc = q.message.documentMessage;
        const fn = doc.fileName || doc.title || 'Dokumen';
        content = `[DOCUMENT: ${fn}]`;
        if (!media) {
          media = { mimeType: doc.mimetype || 'application/pdf', caption: fn };
        }
      } else if (q.message.audioMessage) {
        content = q.message.audioMessage.ptt ? '[VOICE_NOTE]' : '[AUDIO]';
      }
    }

    const rawWaId =
      q.wa_message_id ??
      q.waMessageId ??
      (typeof q.id === 'object' ? q.id?._serialized || q.id?.id : q.id) ??
      q.key?.id;

    const wa_message_id = sanitizeDashboardWaMessageId(rawWaId);
    const id = q.id && typeof q.id === 'string' ? q.id : (rawWaId ? String(rawWaId) : undefined);

    const senderName =
      q.sender_name ??
      q.senderName ??
      q.sender ??
      q.pushName ??
      (q.fromMe ? 'Bidan / CS' : undefined);

    const senderType =
      q.sender_type ??
      q.senderType ??
      (q.fromMe ? 'ADMIN' : (q.direction === 'INBOUND' ? 'CUSTOMER' : null));

    const direction = q.direction ?? (q.fromMe ? 'OUTBOUND' : undefined);

    return {
      id,
      wa_message_id,
      direction,
      sender_name: senderName || null,
      sender_type: senderType,
      content,
      media,
    };
  }

  // Fallback: pindai contextInfo mentah dari Baileys / WAHA NOWEB.
  // WAHA bisa mengirim `message` ringkas DAN `_data.message` lengkap sekaligus;
  // jangan berhenti pada root pertama atau contextInfo non-quote (externalAdReply).
  const rawPayload = msg.payloadRaw ?? msg.payload_raw ?? msg;
  const payloadRoots = [rawPayload, rawPayload?.message, rawPayload?._data?.message].filter(Boolean);
  const contextInfos: any[] = [];
  for (const root of payloadRoots) {
    if (root.contextInfo) contextInfos.push(root.contextInfo);
    for (const key of MESSAGE_CONTEXT_KEYS) {
      const info = root?.[key]?.contextInfo;
      if (info) contextInfos.push(info);
    }
  }
  const contextInfo =
    contextInfos.find((info) => info?.quotedMessage) ||
    contextInfos.find((info) => info?.stanzaId);

  if (contextInfo) {
    let content = '';
    let media: ChatMediaData | undefined = undefined;

    const qm = contextInfo.quotedMessage;
    if (qm) {
      if (typeof qm.conversation === 'string') {
        content = qm.conversation;
      } else if (qm.extendedTextMessage?.text) {
        content = qm.extendedTextMessage.text;
      } else if (qm.imageMessage) {
        const caption = qm.imageMessage.caption || '';
        content = caption ? `[IMAGE: ${caption}]` : '[IMAGE]';
        media = { mimeType: qm.imageMessage.mimetype || 'image/jpeg', caption: caption || undefined };
      } else if (qm.videoMessage) {
        const caption = qm.videoMessage.caption || '';
        content = caption ? `[VIDEO: ${caption}]` : '[VIDEO]';
        media = { mimeType: qm.videoMessage.mimetype || 'video/mp4', caption: caption || undefined };
      } else if (qm.documentMessage) {
        const fn = qm.documentMessage.fileName || qm.documentMessage.title || 'Dokumen';
        content = `[DOCUMENT: ${fn}]`;
        media = { mimeType: qm.documentMessage.mimetype || 'application/pdf', caption: fn };
      } else if (qm.audioMessage) {
        content = qm.audioMessage.ptt ? '[VOICE_NOTE]' : '[AUDIO]';
      }
    }

    if (content || media) {
      return {
        wa_message_id: sanitizeDashboardWaMessageId(contextInfo.stanzaId),
        content,
        media,
      };
    }
  }

  return undefined;
}
