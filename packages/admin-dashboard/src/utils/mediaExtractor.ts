import type { ChatMediaData } from '../components/common/MediaImage';

export type { ChatMediaData };

/**
 * mediaExtractor.ts — ekstraktor media chat terpusat (Anti-Spaghetti).
 *
 * Single source of truth hasil konsolidasi implementasi identik yang sebelumnya
 * diduplikasi di LiveChatMonitor.tsx dan StaffToday.tsx. ChatHistoryModal juga
 * memakai fungsi ini agar seluruh dashboard menafsirkan media dengan konsisten.
 *
 * Catatan: cabang regex di bawah HANYA deteksi teknis ekstensi file
 * (jpg/png/webp/gif) untuk render media — bukan parsing semantik bahasa alami,
 * sehingga diizinkan mandat Minimalisasi Regex.
 */
export function extractMedia(msg: any): ChatMediaData | undefined {
  const m = msg?.payload_raw?.media ?? msg?.payloadRaw?.media ?? msg?.media;
  if (m && (m.url || m.hdUrl)) {
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
