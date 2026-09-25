import type { ChatMediaData } from '../components/common/MediaImage';

export type { ChatMediaData };

export interface ChatLocationData {
  lat: number;
  lng: number;
  latitude: number;
  longitude: number;
  isLive?: boolean;
  address?: string;
  name?: string;
  url?: string;
}

export interface ChatAudioData {
  url?: string;
  mimeType?: string;
  isPtt?: boolean;
  fileName?: string;
}

export interface ChatDocumentData {
  url?: string;
  fileName: string;
  mimeType?: string;
  fileSize?: string | number;
}

export interface ChatContactData {
  name: string;
  phone?: string;
  displayName?: string;
  phoneNumber?: string;
}

export interface ChatVideoData {
  url?: string;
  caption?: string;
  mimeType?: string;
}

/**
 * mediaExtractor.ts — ekstraktor media chat terpusat (Anti-Spaghetti & Zero Message Loss).
 *
 * Single source of truth hasil konsolidasi implementasi ekstraksi untuk:
 * 1. Gambar (extractMedia)
 * 2. Lokasi GPS / Live Location (extractLocation)
 * 3. Audio / Voice Note PTT (extractAudio)
 * 4. Dokumen PDF/Office (extractDocument)
 * 5. Video (extractVideo)
 * 6. Kontak vCard (extractContact)
 */

const MEDIA_PLACEHOLDER_REGEX = /^\[(IMAGE|MEDIA|AUDIO|VOICE|PTT|DOCUMENT|VIDEO|STICKER|LOCATION|CONTACT)\]?$/i;

/**
 * maskPhoneInTextClient — mirror frontend dari src/utils/pii-masker.ts maskPhoneInText.
 * Defense-in-depth untuk optimistic update & SSE race sebelum backend sanitasi tiba.
 * Parity dijaga via vektor uji identik di tests/unit/staff-chat-pii-masker.test.ts.
 * Standar: sensor 5 digit terakhir (prefix + *****), preservasi separator prefix.
 */
export function maskPhoneInTextClient(text: string): string {
  if (!text || typeof text !== 'string') return text ?? '';
  let out = text;
  const maskSegment = (segment: string): string => {
    let prefixLiteral = '';
    let numericPart = segment;
    const waPrefix = segment.match(/^wa\.me\//i);
    if (waPrefix) {
      prefixLiteral = waPrefix[0];
      numericPart = segment.slice(prefixLiteral.length);
    }
    let domain = '';
    const atIdx = numericPart.indexOf('@');
    if (atIdx !== -1) {
      domain = numericPart.slice(atIdx);
      numericPart = numericPart.slice(0, atIdx);
    }
    numericPart = numericPart.replace(/^\/+/, '');
    const digitsOnly = numericPart.replace(/\D/g, '');
    if (digitsOnly.length < 10 || digitsOnly.length > 15) return segment;
    if (digitsOnly.startsWith('0')) {
      if (digitsOnly[1] !== '8') return segment;
    } else if (digitsOnly.startsWith('62')) {
      if (digitsOnly[2] !== '8') return segment;
    } else {
      return segment;
    }
    const keepDigits = digitsOnly.length - 5;
    let digitCount = 0;
    let prefixStr = '';
    let plusIncluded = false;
    for (let i = 0; i < numericPart.length; i++) {
      const ch = numericPart[i];
      if (ch === '+' && digitCount === 0 && !plusIncluded) {
        prefixStr += ch;
        plusIncluded = true;
        continue;
      }
      if (/\d/.test(ch)) {
        digitCount++;
        if (digitCount <= keepDigits) prefixStr += ch;
        else break;
      } else {
        if (digitCount < keepDigits) prefixStr += ch;
      }
    }
    if (numericPart.trim().startsWith('+') && !prefixStr.startsWith('+')) prefixStr = '+' + prefixStr;
    return prefixLiteral + prefixStr + '*****' + domain;
  };
  out = out.replace(/\+?\d[\d\s\-\.\(\)]*\d@(?:c\.us|s\.whatsapp\.net|lid)/gi, (m) => maskSegment(m));
  out = out.replace(/(?:https?:\/\/)?wa\.me\/\+?[\d\s\-\.\(\)]{7,}\d/gi, (m) => {
    const schemeMatch = m.match(/^(https?:\/\/)/i);
    const scheme = schemeMatch ? schemeMatch[1] : '';
    const rest = scheme ? m.slice(scheme.length) : m;
    return scheme + maskSegment(rest);
  });
  out = out.replace(/(?:\+62|62|0)[\d\s\-\.\(\)]{7,}\d/g, (m) => {
    const digits = m.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) return m;
    if (digits.startsWith('0') && digits[1] !== '8') return m;
    if (digits.startsWith('62') && digits[2] !== '8') return m;
    if (!digits.startsWith('0') && !digits.startsWith('62')) return m;
    return maskSegment(m);
  });
  return out;
}

/**
 * Ekstraksi caption gambar dari konten teks kanonis `[IMAGE: caption]` (WAHA/WA inbound).
 * Mengembalikan `null` bila konten bukan caption gambar.
 */
export function extractImageCaption(content?: string | null): string | null {
  if (!content || typeof content !== 'string') return null;
  const trimmed = content.trim();
  const m = trimmed.match(/^\[IMAGE:\s*([\s\S]*?)\]$/i);
  if (m && m[1] && m[1].trim()) return m[1].trim();
  if (trimmed.startsWith('[IMAGE:')) return trimmed.replace(/^\[IMAGE:\s*/i, '').replace(/\]$/, '').trim() || null;
  return null;
}

/**
 * resolveMessageDisplayText — otoritas tunggal teks tampilan gelembung chat.
 *
 * Mencegah duplikasi caption gambar 3x yang disebabkan tiga renderer independen
 * (atribut alt MediaImage, caption inline MediaImage, dan konten teks bubble).
 * Semua antarmuka chat (LiveChatMonitor, StaffToday, ChatHistoryModal) WAJIB
 * memakai resolver ini agar caption dirender tepat satu kali oleh kontainer teks.
 *
 * Aturan resolusi (deterministik, berbasis state data — bukan hafalan kalimat):
 * 1. `[IMAGE: caption]` → buang tag bracket teknis, tampilkan caption murni.
 * 2. Placeholder murni (`[IMAGE]`, `[MEDIA]`, ...) → pakai `media.caption` bila ada.
 * 3. Teks mentah yang identik dengan `media.caption` → tampil sekali (prioritas caption).
 * 4. Tidak ada teks & tidak ada caption → `null` (jangan render paragraf kosong).
 */
export function resolveMessageDisplayText(msg: { content?: string | null; media?: ChatMediaData | null }): string | null {
  const raw = (msg?.content || '').trim();
  const caption = (msg?.media?.caption || '').trim();
  const extracted = extractImageCaption(raw);
  if (extracted) return maskPhoneInTextClient(extracted);
  if (MEDIA_PLACEHOLDER_REGEX.test(raw)) return caption ? maskPhoneInTextClient(caption) : null;
  if (raw && caption && raw === caption) return maskPhoneInTextClient(caption);
  const combined = raw || caption || null;
  return combined ? maskPhoneInTextClient(combined) : null;
}

export function extractMedia(msg: any): ChatMediaData | undefined {
  const m = msg?.payload_raw?.media ?? msg?.payloadRaw?.media ?? msg?.media;
  if (m && (m.url || m.hdUrl)) {
    // Pastikan bukan audio/video/dokumen
    const mime = (m.mimeType || '').toLowerCase();
    if (mime.startsWith('audio/') || mime.startsWith('video/') || mime.startsWith('application/')) {
      return undefined;
    }
    const hdUrlStr = m.hdUrl || m.url;
    const standardUrlStr = (m.url && !m.url.includes('_thumb.')) ? m.url : (m.hdUrl || m.url);
    const thumbStr = m.thumbUrl || (m.url && m.url.includes('_thumb.') ? m.url : undefined);
    const cleanUrl = standardUrlStr.replace(/^https?:\/\/[^/]+/, '');
    const cleanHdUrl = hdUrlStr.replace(/^https?:\/\/[^/]+/, '');
    const cleanThumb = thumbStr ? thumbStr.replace(/^https?:\/\/[^/]+/, '') : undefined;
    return {
      ...m,
      url: cleanUrl.startsWith('/') ? cleanUrl : `/${cleanUrl}`,
      hdUrl: cleanHdUrl.startsWith('/') ? cleanHdUrl : `/${cleanHdUrl}`,
      thumbUrl: cleanThumb ? (cleanThumb.startsWith('/') ? cleanThumb : `/${cleanThumb}`) : undefined,
    };
  }
  const directMediaUrl = msg?.media_url ?? msg?.mediaUrl ?? msg?.media_hd_url ?? msg?.mediaHdUrl;
  if (directMediaUrl && typeof directMediaUrl === 'string') {
    const rawHdUrl = msg?.media_hd_url ?? msg?.mediaHdUrl ?? directMediaUrl;
    const rawUrl = (!directMediaUrl.includes('_thumb.')) ? directMediaUrl : rawHdUrl;
    const cleanUrl = rawUrl.replace(/^https?:\/\/[^/]+/, '');
    const cleanHdUrl = rawHdUrl.replace(/^https?:\/\/[^/]+/, '');
    return {
      url: cleanUrl.startsWith('/') ? cleanUrl : `/${cleanUrl}`,
      hdUrl: cleanHdUrl.startsWith('/') ? cleanHdUrl : `/${cleanHdUrl}`,
      thumbUrl: (msg?.media_thumb_url ?? msg?.mediaThumbUrl)?.replace(/^https?:\/\/[^/]+/, ''),
      mimeType: msg?.media_mime_type ?? msg?.mediaMimeType ?? 'image/jpeg',
      caption: msg?.media_caption ?? msg?.mediaCaption ?? undefined,
    };
  }
  if (msg?.payload_raw?.imageUrl) return { url: msg.payload_raw.imageUrl, hdUrl: msg.payload_raw.imageUrl };
  if (typeof msg?.content === 'string' && (msg.content.startsWith('/media/') || msg.content.startsWith('/api/files/') || msg.content.startsWith('http://') || msg.content.startsWith('https://')) && /\.(jpg|jpeg|png|webp|gif)$/i.test(msg.content)) {
    const clean = msg.content.replace(/^https?:\/\/[^/]+/, '');
    return { url: clean.startsWith('/') ? clean : `/${clean}`, hdUrl: clean.startsWith('/') ? clean : `/${clean}` };
  }
  return undefined;
}

/**
 * Ekstraksi koordinat lokasi GPS secara deterministik & komprehensif.
 * Memeriksa `msg.location`, `payload_raw.location`, Baileys `locationMessage`,
 * teks kanonis `[LOCATION: Lat ..., Lng ...]`, dan URL Google Maps.
 */
export function extractLocation(msg: any): ChatLocationData | null {
  if (!msg) return null;

  const buildResult = (lat: number, lng: number, isLive?: boolean, address?: string, name?: string, url?: string): ChatLocationData => ({
    lat,
    lng,
    latitude: lat,
    longitude: lng,
    isLive: !!isLive,
    address,
    name,
    url: url || `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
  });

  // 1. Dari field location langsung (SSE payload / normalizer)
  const locDirect = msg.location;
  if (locDirect) {
    const lat = typeof locDirect.latitude === 'number' ? locDirect.latitude : typeof locDirect.lat === 'number' ? locDirect.lat : null;
    const lng = typeof locDirect.longitude === 'number' ? locDirect.longitude : typeof locDirect.lng === 'number' ? locDirect.lng : null;
    if (lat !== null && lng !== null && !(lat === 0 && lng === 0) && !isNaN(lat) && !isNaN(lng)) {
      return buildResult(lat, lng, !!locDirect.isLive, locDirect.address, locDirect.name, locDirect.url);
    }
  }

  // 2. Dari payload_raw / payloadRaw
  const pr = msg.payload_raw || msg.payloadRaw;
  if (pr) {
    const prLoc = pr.location;
    if (prLoc) {
      const lat = typeof prLoc.latitude === 'number' ? prLoc.latitude : typeof prLoc.lat === 'number' ? prLoc.lat : typeof prLoc.degreesLatitude === 'number' ? prLoc.degreesLatitude : null;
      const lng = typeof prLoc.longitude === 'number' ? prLoc.longitude : typeof prLoc.lng === 'number' ? prLoc.lng : typeof prLoc.degreesLongitude === 'number' ? prLoc.degreesLongitude : null;
      if (lat !== null && lng !== null && !(lat === 0 && lng === 0) && !isNaN(lat) && !isNaN(lng)) {
        return buildResult(lat, lng, !!prLoc.isLive, prLoc.address, prLoc.name, prLoc.url);
      }
    }

    // Baileys NOWEB format: _data.message.locationMessage atau message.locationMessage
    const locMsg =
      pr._data?.message?.locationMessage ||
      pr.message?.locationMessage ||
      pr._data?.message?.liveLocationMessage ||
      pr.message?.liveLocationMessage;
    if (locMsg) {
      const lat = typeof locMsg.degreesLatitude === 'number' ? locMsg.degreesLatitude : typeof locMsg.latitude === 'number' ? locMsg.latitude : null;
      const lng = typeof locMsg.degreesLongitude === 'number' ? locMsg.degreesLongitude : typeof locMsg.longitude === 'number' ? locMsg.longitude : null;
      if (lat !== null && lng !== null && !(lat === 0 && lng === 0) && !isNaN(lat) && !isNaN(lng)) {
        const isLive = !!(pr._data?.message?.liveLocationMessage || pr.message?.liveLocationMessage);
        return buildResult(lat, lng, isLive, locMsg.address, locMsg.name, locMsg.url);
      }
    }
  }

  // 3. Dari teks konten kanonis: [LOCATION: Lat -7.xxx, Lng 112.xxx] atau [LIVE_LOCATION: Lat ...]
  const c = typeof msg.content === 'string' ? msg.content.trim() : '';
  const isLiveTeks = c.startsWith('[LIVE_LOCATION');
  const locMatch = c.match(/Lat\s*[:\-]?\s*(-?\d+\.\d+)\s*[,\s]+\s*Lng\s*[:\-]?\s*(-?\d+\.\d+)/i);
  if (locMatch) {
    const lat = parseFloat(locMatch[1]);
    const lng = parseFloat(locMatch[2]);
    if (!isNaN(lat) && !isNaN(lng) && !(lat === 0 && lng === 0)) {
      return buildResult(lat, lng, isLiveTeks);
    }
  }

  // 4. Fallback Google Maps URL di dalam teks
  const urlMatch = c.match(/https?:\/\/[^\s]+/g);
  if (urlMatch) {
    for (const u of urlMatch) {
      try {
        const urlObj = new URL(u);
        const q = urlObj.searchParams.get('q') || urlObj.searchParams.get('query') || urlObj.searchParams.get('destination');
        if (q) {
          const parts = q.split(',');
          if (parts.length >= 2) {
            const lat = parseFloat(parts[0]);
            const lng = parseFloat(parts[1]);
            if (!isNaN(lat) && !isNaN(lng) && !(lat === 0 && lng === 0)) {
              return buildResult(lat, lng, false, undefined, undefined, u);
            }
          }
        }
      } catch {}
    }
  }

  return null;
}

/**
 * Ekstraksi audio / voice note
 */
export function extractAudio(msg: any): ChatAudioData | null {
  if (!msg) return null;
  const pr = msg.payload_raw || msg.payloadRaw;
  const m = pr?.media || msg.media;
  const c = typeof msg.content === 'string' ? msg.content.trim() : '';

  const isVoicePlaceholder = c === '[VOICE_NOTE]' || c.startsWith('[VOICE_NOTE:');
  const isAudioPlaceholder = c.startsWith('[AUDIO');

  const mime = ((m as any)?.mimeType || pr?.media_mime_type || '').toLowerCase();
  const isAudioMime = mime.startsWith('audio/');

  const rawUrl = (m?.url || m?.hdUrl || pr?.audio?.url || pr?.ptt?.url || pr?.voice?.url || '') as string;
  const cleanUrl = rawUrl ? (rawUrl.replace(/^https?:\/\/[^/]+/, '')) : undefined;
  const url = cleanUrl ? (cleanUrl.startsWith('/') ? cleanUrl : `/${cleanUrl}`) : undefined;

  if (isVoicePlaceholder || pr?.type === 'ptt' || pr?.isPtt || (m as any)?.isPtt) {
    return {
      url,
      mimeType: mime || 'audio/ogg; codecs=opus',
      isPtt: true,
      fileName: 'Voice Note',
    };
  }

  if (isAudioPlaceholder || isAudioMime || (url && /\.(ogg|opus|mp3|m4a|wav|aac)$/i.test(url))) {
    const matchName = c.match(/^\[AUDIO:\s*(.+?)\]$/);
    return {
      url,
      mimeType: mime || 'audio/mp3',
      isPtt: false,
      fileName: matchName ? matchName[1] : (m?.fileName || 'Audio'),
    };
  }

  return null;
}

/**
 * Ekstraksi dokumen berkas
 */
export function extractDocument(msg: any): ChatDocumentData | null {
  if (!msg) return null;
  const pr = msg.payload_raw || msg.payloadRaw;
  const m = pr?.media || msg.media;
  const c = typeof msg.content === 'string' ? msg.content.trim() : '';

  const isDocPlaceholder = c.startsWith('[DOCUMENT');
  const mime = ((m as any)?.mimeType || '').toLowerCase();
  const isDocMime = mime.startsWith('application/') || mime.startsWith('text/');

  const matchName = c.match(/^\[DOCUMENT:\s*(.+?)\]$/);
  const fileName = matchName ? matchName[1] : (m?.fileName || pr?.message?.documentMessage?.fileName || 'Dokumen');

  const rawUrl = (m?.url || m?.hdUrl || pr?.document?.url || '') as string;
  const cleanUrl = rawUrl ? (rawUrl.replace(/^https?:\/\/[^/]+/, '')) : undefined;
  const url = cleanUrl ? (cleanUrl.startsWith('/') ? cleanUrl : `/${cleanUrl}`) : undefined;

  if (isDocPlaceholder || isDocMime || pr?.type === 'document' || pr?.canonicalType === 'document') {
    return {
      url,
      fileName,
      mimeType: mime || 'application/pdf',
      fileSize: m?.fileSize || pr?.message?.documentMessage?.fileLength,
    };
  }

  return null;
}

/**
 * Ekstraksi kontak vCard
 */
export function extractContact(msg: any): ChatContactData | null {
  if (!msg) return null;
  const pr = msg.payload_raw || msg.payloadRaw;
  const c = typeof msg.content === 'string' ? msg.content.trim() : '';

  if (msg.contact) {
    const name = msg.contact.name || msg.contact.displayName || 'Kontak';
    const rawPhone = msg.contact.phone || msg.contact.phoneNumber;
    const phone = rawPhone ? maskPhoneInTextClient(String(rawPhone)) : rawPhone;
    const phoneNumber = msg.contact.phoneNumber ? maskPhoneInTextClient(String(msg.contact.phoneNumber)) : phone;
    return { name, phone, displayName: name, phoneNumber };
  }
  if (pr?.contact) {
    const name = pr.contact.name || pr.contact.displayName || 'Kontak';
    const rawPhone = pr.contact.phone || pr.contact.phoneNumber;
    const phone = rawPhone ? maskPhoneInTextClient(String(rawPhone)) : rawPhone;
    const phoneNumber = pr.contact.phoneNumber ? maskPhoneInTextClient(String(pr.contact.phoneNumber)) : phone;
    return { name, phone, displayName: name, phoneNumber };
  }

  const match = c.match(/^\[CONTACT:\s*([^|\]]+)(?:\s*\|\s*([^\]]+))?\]$/);
  if (match) {
    const name = match[1].trim();
    const rawPhone = match[2] ? match[2].trim() : undefined;
    const phone = rawPhone ? maskPhoneInTextClient(rawPhone) : undefined;
    return {
      name,
      phone,
      displayName: name,
      phoneNumber: phone,
    };
  }

  return null;
}

/**
 * Ekstraksi video
 */
export function extractVideo(msg: any): ChatVideoData | null {
  if (!msg) return null;
  const pr = msg.payload_raw || msg.payloadRaw;
  const m = pr?.media || msg.media;
  const c = typeof msg.content === 'string' ? msg.content.trim() : '';

  const isVideoPlaceholder = c.startsWith('[VIDEO');
  const mime = ((m as any)?.mimeType || '').toLowerCase();
  const isVideoMime = mime.startsWith('video/');

  const rawUrl = (m?.url || m?.hdUrl || pr?.video?.url || '') as string;
  const cleanUrl = rawUrl ? (rawUrl.replace(/^https?:\/\/[^/]+/, '')) : undefined;
  const url = cleanUrl ? (cleanUrl.startsWith('/') ? cleanUrl : `/${cleanUrl}`) : undefined;

  if (isVideoPlaceholder || isVideoMime || pr?.type === 'video' || pr?.canonicalType === 'video') {
    const matchCap = c.match(/^\[VIDEO:\s*(.+?)\]$/);
    return {
      url,
      caption: matchCap ? matchCap[1] : m?.caption,
      mimeType: mime || 'video/mp4',
    };
  }

  return null;
}
