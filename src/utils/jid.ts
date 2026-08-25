import { getCachedLidPhone, setCachedLidPhone } from '../integrations/waha/label-cache';

/**
 * Normalisasi JID WhatsApp (baik @c.us maupun @lid multi-device) menjadi nomor telepon E.164 bersih (misal "628123456789")
 */
export function normalizeWahaJid(rawJid?: string | null): string {
  if (!rawJid) return '';
  // Hapus prefix +, karakter non-digit di luar suffix @
  let cleaned = rawJid.trim().replace(/^\+/, '');
  // Jika ada suffix @ (misal @c.us atau @lid), ambil bagian depannya
  if (cleaned.includes('@')) {
    cleaned = cleaned.split('@')[0];
  }
  // Hapus semua karakter non-digit
  cleaned = cleaned.replace(/\D/g, '');
  return cleaned;
}

/**
 * Ekstrak nomor HP asli (E.164) dari payload WAHA / Baileys.
 * Mendeteksi alternative JID (remoteJidAlt / participantAlt) saat WhatsApp menggunakan format @lid multi-device.
 */
export function extractRealPhoneFromWahaPayload(payload: any): { phone: string; resolvedJid: string } {
  if (!payload) return { phone: '', resolvedJid: '' };
  const pAny = payload as any;
  const rawJid = pAny.chatId || pAny.from || pAny.to || '';

  // 1. Cek explicit alt field di payload (WAHA / Baileys menyertakan remoteJidAlt / participantAlt saat chat menggunakan LID)
  const altJidCandidate = 
    pAny._data?.key?.remoteJidAlt ||
    pAny._data?.remoteJidAlt ||
    pAny.remoteJidAlt ||
    pAny._data?.key?.participantAlt ||
    pAny._data?.participantAlt ||
    pAny.participantAlt ||
    (pAny._data?.key?.participant && !pAny._data.key.participant.includes('@lid') ? pAny._data.key.participant : null) ||
    (pAny.participant && !pAny.participant.includes('@lid') ? pAny.participant : null);

  if (altJidCandidate && typeof altJidCandidate === 'string' && !altJidCandidate.includes('@lid')) {
    const cleaned = normalizeWahaJid(altJidCandidate);
    // Nomor HP valid Indonesia minimal 9 digit (mis. 6281230133633) dan bukan prefiks LID WhatsApp (2160..., 7990...)
    if (cleaned && cleaned.length >= 9 && !cleaned.startsWith('2160') && !cleaned.startsWith('7990')) {
      if (rawJid && rawJid.includes('@lid')) {
        setCachedLidPhone(rawJid, cleaned);
      }
      return { phone: cleaned, resolvedJid: `${cleaned}@c.us` };
    }
  }

  // 2. Jika rawJid adalah @lid, coba getCachedLidPhone
  if (rawJid.includes('@lid')) {
    const cached = getCachedLidPhone(rawJid);
    if (cached) {
      return { phone: cached, resolvedJid: `${cached}@c.us` };
    }
  }

  // 3. Normalisasi biasa jika bukan LID
  const cleanedRaw = normalizeWahaJid(rawJid);
  const primaryJid = (rawJid.includes('@c.us') || rawJid.includes('@s.whatsapp.net'))
    ? `${cleanedRaw}@c.us`
    : rawJid;

  return { phone: cleanedRaw, resolvedJid: primaryJid };
}
