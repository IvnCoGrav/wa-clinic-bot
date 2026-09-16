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

/**
 * Menafsirkan payload inbound WhatsApp (WAHA / WABA) menjadi objek kanonis seragam.
 */
export function parseCanonicalInboundMessage(payload: any): CanonicalInboundParseResult {
  const pAny = (payload || {}) as any;
  const msgObj = pAny.message || {};

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
  };
}
