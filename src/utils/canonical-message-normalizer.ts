/**
 * canonical-message-normalizer.ts
 *
 * Single Source of Truth untuk penentuan tipe pesan, resolusi konten kanonis,
 * dan normalisasi metadata (lokasi, media, kontak) dari berbagai platform (WAHA & WABA).
 *
 * Mandat Arsitektural:
 * 1. Zero Message Loss: Seluruh tipe pesan (teks, lokasi pin, live loc, audio/PTT,
 *    dokumen, video, stiker, kontak) memiliki representasi string dan objek terstruktur yang deterministik.
 * 2. Anti-Hollow Bubble: Menjamin `content` tidak pernah kosong atau jatuh ke string buta '[LOCATION/MEDIA]'.
 * 3. Normalisasi Koordinat: Koordinat GPS dari Baileys (degreesLatitude) dinormalisasikan
 *    ke objek root `location: { latitude, longitude }`.
 */

import { extractWahaLocation } from './waha-location-parser';
import { isValidReplyToForProvider } from './whatsapp-message-id';

export interface NormalizedLocation {
  latitude: number;
  longitude: number;
  isLive?: boolean;
  address?: string;
  name?: string;
}

export interface NormalizedMedia {
  url?: string;
  hdUrl?: string;
  thumbUrl?: string;
  mimeType?: string;
  fileName?: string;
  caption?: string | null;
  fileSize?: number;
  isPtt?: boolean;
  isSticker?: boolean;
}

export interface NormalizedContact {
  name: string;
  phone?: string;
  vcard?: string;
}

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

export type CanonicalMessageType =
  | 'text'
  | 'location'
  | 'live_location'
  | 'image'
  | 'audio'
  | 'voice_note'
  | 'document'
  | 'video'
  | 'sticker'
  | 'contact'
  | 'unknown';

export interface CanonicalInboundParseResult {
  type: CanonicalMessageType;
  content: string;
  location?: NormalizedLocation;
  media?: NormalizedMedia;
  contact?: NormalizedContact;
  rawText?: string;
  quoted?: NormalizedQuotedMessage;
}

/**
 * Ekstraksi nomor telepon dari vCard text
 */
function extractPhoneFromVcard(vcard: string): string | undefined {
  if (!vcard) return undefined;
  const match = vcard.match(/waid=(\d+)/i) || vcard.match(/TEL(?:;[^:]+)?:([+\d\s-]+)/i);
  if (match && match[1]) {
    return match[1].replace(/[^\d+]/g, '');
  }
  return undefined;
}

/**
 * Ekstraksi nama dari vCard text
 */
function extractNameFromVcard(vcard: string): string | undefined {
  if (!vcard) return undefined;
  const match = vcard.match(/FN:([^\r\n]+)/i);
  return match ? match[1].trim() : undefined;
}

// Sanitasi ID quote memakai kontrak provider yang sama dengan jalur kirim:
// hanya serialized WAHA atau wamid WABA. Stanza mentah / temp_ / UUID internal
// tidak boleh dipalsukan sebagai wa_message_id (tombol jump-to-message akan gagal).
function sanitizeWaMessageId(id?: string): string | undefined {
  if (!id) return undefined;
  const s = String(id).trim();
  if (!s) return undefined;
  return isValidReplyToForProvider('WAHA', s) || isValidReplyToForProvider('WABA', s)
    ? s
    : undefined;
}

/**
 * Tipe pesan Baileys yang bisa membawa `contextInfo` (quote reply).
 * Harus dipindai di SEMUA root payload: `message` dan `_data.message`.
 */
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
 * Ekstraksi informasi quoted message (balasan/kutipan pesan) dari payload WhatsApp (NOWEB & WEBJS).
 */
export function extractQuotedMessageFromPayload(
  payload: any,
  opts?: CanonicalParseOptions
): NormalizedQuotedMessage | undefined {
  const pAny = (payload || {}) as any;

  // Pindai SEMUA root payload (bukan hanya salah satu), karena WAHA bisa mengirim
  // `message` versi ringkas sekaligus `_data.message` versi Baileys lengkap.
  const payloadRoots = [pAny, pAny.message, pAny._data?.message].filter(Boolean);
  const contextInfos: any[] = [];
  for (const root of payloadRoots) {
    if (root.contextInfo) contextInfos.push(root.contextInfo);
    for (const key of MESSAGE_CONTEXT_KEYS) {
      const info = root?.[key]?.contextInfo;
      if (info) contextInfos.push(info);
    }
  }

  // contextInfo pertama belum tentu quote (mis. externalAdReply / stanzaId saja).
  // Prioritaskan yang benar-benar membawa quotedMessage; stanzaId hanya fallback.
  const contextInfo =
    contextInfos.find((info) => info?.quotedMessage) ||
    contextInfos.find((info) => info?.stanzaId);

  // Objek quotedMsg untuk WEBJS
  const quotedMsg = pAny.quotedMsg || pAny._data?.quotedMsg;

  if (!contextInfo && !quotedMsg) {
    return undefined;
  }

  let content = '';
  let media: NormalizedMedia | undefined = undefined;

  const quotedMessage = contextInfo?.quotedMessage;
  if (quotedMessage) {
    if (typeof quotedMessage.conversation === 'string') {
      content = quotedMessage.conversation;
    } else if (quotedMessage.extendedTextMessage?.text) {
      content = quotedMessage.extendedTextMessage.text;
    } else if (quotedMessage.imageMessage) {
      const caption = quotedMessage.imageMessage.caption || '';
      content = caption ? `[IMAGE: ${caption}]` : '[IMAGE]';
      media = {
        url: quotedMessage.imageMessage.url,
        mimeType: quotedMessage.imageMessage.mimetype || 'image/jpeg',
        caption: caption || null,
      };
    } else if (quotedMessage.videoMessage) {
      const caption = quotedMessage.videoMessage.caption || '';
      content = caption ? `[VIDEO: ${caption}]` : '[VIDEO]';
      media = {
        url: quotedMessage.videoMessage.url,
        mimeType: quotedMessage.videoMessage.mimetype || 'video/mp4',
        caption: caption || null,
      };
    } else if (quotedMessage.documentMessage) {
      const doc = quotedMessage.documentMessage;
      const fileName = doc.fileName || doc.title || doc.caption || 'Dokumen';
      content = `[DOCUMENT: ${fileName}]`;
      media = {
        url: doc.url,
        mimeType: doc.mimetype || 'application/pdf',
        fileName,
        caption: doc.caption || null,
      };
    } else if (quotedMessage.audioMessage) {
      const audio = quotedMessage.audioMessage;
      const isPtt = Boolean(audio.ptt);
      content = isPtt ? '[VOICE_NOTE]' : '[AUDIO]';
      media = {
        url: audio.url,
        mimeType: audio.mimetype || (isPtt ? 'audio/ogg; codecs=opus' : 'audio/mp3'),
        isPtt,
      };
    } else if (quotedMessage.stickerMessage) {
      const stk = quotedMessage.stickerMessage;
      content = '[STICKER]';
      media = {
        url: stk.url,
        mimeType: stk.mimetype || 'image/webp',
        isSticker: true,
      };
    } else if (quotedMessage.contactMessage) {
      const cm = quotedMessage.contactMessage;
      const name = cm.displayName || 'Kontak';
      content = `[CONTACT: ${name}]`;
    } else if (quotedMessage.contactsArrayMessage) {
      content = '[CONTACT]';
    } else if (quotedMessage.locationMessage) {
      const loc = quotedMessage.locationMessage;
      content = loc.address ? `[LOCATION: ${loc.address}]` : '[LOCATION]';
    } else if (quotedMessage.liveLocationMessage) {
      content = '[LIVE_LOCATION]';
    }
  }

  // Fallback WEBJS jika content belum terisi
  if (!content && quotedMsg) {
    if (quotedMsg.type === 'image') {
      const caption = quotedMsg.caption || quotedMsg.body || '';
      content = caption ? `[IMAGE: ${caption}]` : '[IMAGE]';
      media = {
        mimeType: quotedMsg.mimetype || 'image/jpeg',
        caption: caption || null,
      };
    } else if (quotedMsg.type === 'video') {
      const caption = quotedMsg.caption || quotedMsg.body || '';
      content = caption ? `[VIDEO: ${caption}]` : '[VIDEO]';
      media = {
        mimeType: quotedMsg.mimetype || 'video/mp4',
        caption: caption || null,
      };
    } else if (quotedMsg.type === 'document') {
      const fileName = quotedMsg.fileName || quotedMsg.filename || quotedMsg.caption || 'Dokumen';
      content = `[DOCUMENT: ${fileName}]`;
      media = {
        mimeType: quotedMsg.mimetype || 'application/pdf',
        fileName,
        caption: quotedMsg.caption || null,
      };
    } else if (quotedMsg.type === 'ptt' || quotedMsg.type === 'audio') {
      const isPtt = quotedMsg.type === 'ptt' || quotedMsg.ptt === true;
      content = isPtt ? '[VOICE_NOTE]' : '[AUDIO]';
      media = {
        mimeType: quotedMsg.mimetype || (isPtt ? 'audio/ogg; codecs=opus' : 'audio/mp3'),
        isPtt,
      };
    } else if (quotedMsg.type === 'sticker') {
      content = '[STICKER]';
      media = {
        mimeType: quotedMsg.mimetype || 'image/webp',
        isSticker: true,
      };
    } else if (quotedMsg.type === 'location' || quotedMsg.type === 'live_location') {
      content = '[LOCATION]';
    } else if (quotedMsg.body) {
      content = String(quotedMsg.body);
    }
  }

  if (!content && !media) {
    return undefined;
  }

  let rawId: string | undefined = undefined;
  if (contextInfo?.stanzaId) {
    rawId = String(contextInfo.stanzaId);
  } else if (quotedMsg?.id) {
    rawId =
      typeof quotedMsg.id === 'object'
        ? quotedMsg.id._serialized || quotedMsg.id.id
        : String(quotedMsg.id);
  }

  const wa_message_id = sanitizeWaMessageId(rawId);

  // Arah pesan (direction) & tipe pengirim (sender_type)
  let direction: 'INBOUND' | 'OUTBOUND' | undefined = undefined;
  const participant = contextInfo?.participant;

  if (quotedMsg?.fromMe !== undefined) {
    direction = quotedMsg.fromMe ? 'OUTBOUND' : 'INBOUND';
  } else if (participant) {
    const pDigits = String(participant).replace(/\D/g, '');
    const targetCustomerPhone =
      opts?.customerPhone || (pAny.fromMe ? pAny.to || pAny.chatId : pAny.from);
    const cDigits = targetCustomerPhone ? String(targetCustomerPhone).replace(/\D/g, '') : '';
    if (pDigits && cDigits) {
      direction = pDigits === cDigits ? 'INBOUND' : 'OUTBOUND';
    }
  }

  let sender_type: 'CUSTOMER' | 'ADMIN' | 'BOT' | undefined = undefined;
  if (direction === 'INBOUND') {
    sender_type = 'CUSTOMER';
  } else if (direction === 'OUTBOUND') {
    sender_type = 'ADMIN';
  }

  return {
    wa_message_id,
    content: content || '[MEDIA]',
    ...(media ? { media } : {}),
    ...(direction ? { direction } : {}),
    ...(sender_type ? { sender_type } : {}),
  };
}

/**
 * Menafsirkan payload inbound WhatsApp (WAHA / WABA) menjadi objek kanonis seragam.
 */
export function parseCanonicalInboundMessage(
  payload: any,
  opts?: CanonicalParseOptions
): CanonicalInboundParseResult {
  const pAny = (payload || {}) as any;
  const msgObj = pAny.message || {};
  const quoted = extractQuotedMessageFromPayload(pAny, opts);

  // 1. Lokasi GPS (Pin atau Live)
  const locResult = extractWahaLocation(pAny);
  if (locResult.hasRealLocation) {
    const isLive = Boolean(
      pAny._data?.message?.liveLocationMessage ||
      msgObj?.liveLocationMessage ||
      pAny.type === 'live_location'
    );
    const locMsg = pAny._data?.message?.locationMessage || msgObj?.locationMessage || pAny._data?.message?.liveLocationMessage || msgObj?.liveLocationMessage;
    const address = pAny.location?.address || locMsg?.address || undefined;
    const name = pAny.location?.name || locMsg?.name || undefined;

    const prefix = isLive ? 'LIVE_LOCATION' : 'LOCATION';
    const content = `[${prefix}: Lat ${locResult.rawLat}, Lng ${locResult.rawLng}${address ? ` | ${address}` : ''}]`;

    return {
      type: isLive ? 'live_location' : 'location',
      content,
      location: {
        latitude: locResult.rawLat,
        longitude: locResult.rawLng,
        isLive,
        address,
        name,
      },
      ...(quoted ? { quoted } : {}),
    };
  }

  // 2. Voice Note (PTT) / Audio
  const isPtt = Boolean(
    pAny.type === 'ptt' ||
    pAny._data?.type === 'ptt' ||
    msgObj?.audioMessage?.ptt ||
    pAny.ptt === true
  );
  const isAudio = Boolean(
    isPtt ||
    pAny.type === 'audio' ||
    pAny._data?.type === 'audio' ||
    !!msgObj?.audioMessage ||
    !!(pAny.hasMedia && (pAny.media?.mimetype?.startsWith('audio/') || pAny.media?.mime_type?.startsWith('audio/')))
  );

  if (isAudio) {
    const audioObj = msgObj?.audioMessage || {};
    const mimeType = audioObj?.mimetype || pAny.media?.mimetype || pAny.media?.mime_type || (isPtt ? 'audio/ogg; codecs=opus' : 'audio/mp3');
    const url = audioObj?.url || pAny.media?.url || pAny.mediaUrl || undefined;
    const fileName = audioObj?.fileName || pAny.fileName || (isPtt ? 'Voice Note' : 'Audio');

    return {
      type: isPtt ? 'voice_note' : 'audio',
      content: isPtt ? '[VOICE_NOTE]' : `[AUDIO: ${fileName}]`,
      media: {
        url,
        mimeType,
        fileName,
        isPtt,
      },
      ...(quoted ? { quoted } : {}),
    };
  }

  // 3. Dokumen (PDF, Word, dll.)
  const isDocument = Boolean(
    pAny.type === 'document' ||
    pAny._data?.type === 'document' ||
    !!msgObj?.documentMessage ||
    !!(pAny.hasMedia && (pAny.media?.mimetype?.startsWith('application/') || pAny.media?.mime_type?.startsWith('application/')))
  );

  if (isDocument) {
    const docObj = msgObj?.documentMessage || {};
    const fileName = docObj?.fileName || docObj?.title || pAny.fileName || pAny.media?.fileName || pAny.media?.filename || 'Dokumen';
    const mimeType = docObj?.mimetype || pAny.media?.mimetype || pAny.media?.mime_type || 'application/pdf';
    const url = docObj?.url || pAny.media?.url || pAny.mediaUrl || undefined;
    const fileSize = docObj?.fileLength ? Number(docObj.fileLength) : undefined;

    return {
      type: 'document',
      content: `[DOCUMENT: ${fileName}]`,
      media: {
        url,
        mimeType,
        fileName,
        fileSize,
      },
      ...(quoted ? { quoted } : {}),
    };
  }

  // 4. Video
  const isVideo = Boolean(
    pAny.type === 'video' ||
    pAny._data?.type === 'video' ||
    !!msgObj?.videoMessage ||
    !!(pAny.hasMedia && (pAny.media?.mimetype?.startsWith('video/') || pAny.media?.mime_type?.startsWith('video/')))
  );

  if (isVideo) {
    const vidObj = msgObj?.videoMessage || {};
    const caption = vidObj?.caption || pAny.caption || pAny._data?.caption || '';
    const mimeType = vidObj?.mimetype || pAny.media?.mimetype || pAny.media?.mime_type || 'video/mp4';
    const url = vidObj?.url || pAny.media?.url || pAny.mediaUrl || undefined;

    return {
      type: 'video',
      content: caption ? `[VIDEO: ${caption}]` : '[VIDEO]',
      media: {
        url,
        mimeType,
        caption: caption || null,
      },
      ...(quoted ? { quoted } : {}),
    };
  }

  // 5. Stiker
  const isSticker = Boolean(
    pAny.type === 'sticker' ||
    pAny._data?.type === 'sticker' ||
    !!msgObj?.stickerMessage
  );

  if (isSticker) {
    const stkObj = msgObj?.stickerMessage || {};
    const mimeType = stkObj?.mimetype || 'image/webp';
    const url = stkObj?.url || pAny.media?.url || undefined;

    return {
      type: 'sticker',
      content: '[STICKER]',
      media: {
        url,
        mimeType,
        isSticker: true,
      },
      ...(quoted ? { quoted } : {}),
    };
  }

  // 6. Kontak (vCard)
  const isContact = Boolean(
    pAny.type === 'contact' ||
    pAny.type === 'contacts' ||
    pAny.type === 'vcard' ||
    pAny._data?.type === 'contact' ||
    pAny._data?.type === 'contacts' ||
    pAny._data?.type === 'vcard' ||
    !!pAny.vcard ||
    !!msgObj?.contactMessage ||
    !!msgObj?.contactsArrayMessage
  );

  if (isContact) {
    const cMsg = msgObj?.contactMessage;
    const cArr = msgObj?.contactsArrayMessage?.contacts?.[0];
    const vcard = cMsg?.vcard || cArr?.vcard || pAny.vcard || '';
    const name = cMsg?.displayName || cArr?.displayName || pAny.contactName || pAny.displayName || extractNameFromVcard(vcard) || 'Kontak';
    const phone = extractPhoneFromVcard(vcard);

    return {
      type: 'contact',
      content: `[CONTACT: ${name}${phone ? ` | ${phone}` : ''}]`,
      contact: {
        name,
        phone,
        vcard: vcard || undefined,
      },
      ...(quoted ? { quoted } : {}),
    };
  }

  // 7. Gambar (Image)
  const isImage = Boolean(
    pAny.type === 'image' ||
    pAny._data?.type === 'image' ||
    !!msgObj?.imageMessage ||
    !!(pAny.hasMedia && (pAny.media?.mimetype?.startsWith('image/') || pAny.media?.mime_type?.startsWith('image/'))) ||
    !!(pAny._data?.mimetype?.startsWith('image/')) ||
    !!(pAny.mimetype?.startsWith('image/')) ||
    (pAny.hasMedia && !isAudio && !isDocument && !isVideo && !isSticker)
  );

  if (isImage) {
    const imgObj = msgObj?.imageMessage || {};
    const caption = imgObj?.caption || pAny.caption || pAny._data?.caption || (pAny.body && !pAny.body.startsWith('[') ? pAny.body : '') || '';
    const mimeType = imgObj?.mimetype || pAny.media?.mimetype || pAny.media?.mime_type || pAny._data?.mimetype || pAny.mimetype || 'image/jpeg';
    const url = pAny.media?.url || pAny.mediaUrl || pAny._data?.mediaUrl || undefined;

    return {
      type: 'image',
      content: caption ? `[IMAGE: ${caption}]` : '[IMAGE]',
      media: {
        url,
        mimeType,
        caption: caption || null,
      },
      ...(quoted ? { quoted } : {}),
    };
  }

  // 8. Teks Biasa (Default Fallback)
  const rawBody =
    pAny.body ||
    msgObj?.conversation ||
    msgObj?.extendedTextMessage?.text ||
    pAny.text?.body ||
    pAny.text ||
    '';

  return {
    type: 'text',
    content: rawBody,
    rawText: rawBody,
    ...(quoted ? { quoted } : {}),
  };
}
