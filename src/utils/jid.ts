import { getCachedLidPhone, setCachedLidPhone } from '../integrations/waha/label-cache';

export type WhatsAppJidType = 'phone' | 'lid' | 'group' | 'broadcast' | 'newsletter' | 'unknown';

/**
 * Mengklasifikasikan tipe domain JID WhatsApp berdasarkan kontrak protokol resmi.
 * Tidak menggunakan regex angka/panjang digit yang rapuh.
 */
export function parseJidType(jid?: string | null): WhatsAppJidType {
  if (!jid) return 'unknown';
  const trimmed = jid.trim();
  if (trimmed.endsWith('@c.us') || trimmed.endsWith('@s.whatsapp.net')) return 'phone';
  if (trimmed.endsWith('@lid')) return 'lid';
  if (trimmed.endsWith('@g.us')) return 'group';
  if (trimmed.includes('@broadcast') || trimmed.startsWith('status@')) return 'broadcast';
  if (trimmed.endsWith('@newsletter')) return 'newsletter';
  return 'unknown';
}

/**
 * Normalisasi JID WhatsApp (baik @c.us maupun format nomor lainnya) menjadi nomor telepon E.164 bersih (misal "628123456789")
 */
export function normalizeWahaJid(rawJid?: string | null): string {
  if (!rawJid) return '';
  // Hapus prefix +, karakter non-digit di luar suffix @
  let cleaned = rawJid.trim().replace(/^\+/, '');
  // Jika ada suffix @, ambil bagian depannya
  if (cleaned.includes('@')) {
    cleaned = cleaned.split('@')[0];
  }
  // Hapus semua karakter non-digit
  cleaned = cleaned.replace(/\D/g, '');
  return cleaned;
}

/**
 * Ekstrak nomor HP asli (E.164) dari payload WAHA / Baileys.
 * Invarian Mutlak (Matt Pocock Standard):
 * - Jika JID bertipe 'lid', bagian numerik internal LID TIDAK BOLEH dikembalikan sebagai nomor telepon.
 * - Nomor telepon hanya dikembalikan jika berhasil ditemukan di alternative metadata (remoteJidAlt/participantAlt)
 *   atau di cache LID.
 * - Jika tidak teresolusi, kembalikan phone: '' agar pemanggil tidak membuat entitas pelanggan palsu.
 */
export function extractRealPhoneFromWahaPayload(payload: any): { phone: string; resolvedJid: string } {
  if (!payload) return { phone: '', resolvedJid: '' };
  const pAny = payload as any;
  const rawJid: string = pAny.chatId || pAny.from || pAny.to || '';
  const jidType = parseJidType(rawJid);

  // 1. Cek explicit alt field di payload (WAHA / Baileys menyertakan remoteJidAlt / participantAlt saat chat menggunakan LID)
  const altJidCandidate: string | null =
    pAny._data?.key?.remoteJidAlt ||
    pAny._data?.remoteJidAlt ||
    pAny.remoteJidAlt ||
    pAny._data?.key?.participantAlt ||
    pAny._data?.participantAlt ||
    pAny.participantAlt ||
    (pAny._data?.key?.participant && parseJidType(pAny._data.key.participant) === 'phone' ? pAny._data.key.participant : null) ||
    (pAny.participant && parseJidType(pAny.participant) === 'phone' ? pAny.participant : null);

  if (altJidCandidate && typeof altJidCandidate === 'string' && parseJidType(altJidCandidate) === 'phone') {
    const cleaned = normalizeWahaJid(altJidCandidate);
    if (cleaned && cleaned.length >= 8) {
      if (jidType === 'lid') {
        setCachedLidPhone(rawJid, cleaned);
      }
      return { phone: cleaned, resolvedJid: `${cleaned}@c.us` };
    }
  }

  // 2. Jika rawJid adalah @lid, coba getCachedLidPhone
  if (jidType === 'lid') {
    const cached = getCachedLidPhone(rawJid);
    if (cached && cached.length >= 8) {
      return { phone: cached, resolvedJid: `${cached}@c.us` };
    }
    // Jika tidak ditemukan di metadata maupun cache, KEMBALIKAN KOSONG.
    // DILARANG KERAS mengembalikan string digit LID sebagai nomor HP!
    return { phone: '', resolvedJid: rawJid };
  }

  // 3. Normalisasi biasa jika memang bertipe 'phone'
  if (jidType === 'phone') {
    const cleanedRaw = normalizeWahaJid(rawJid);
    return { phone: cleanedRaw, resolvedJid: `${cleanedRaw}@c.us` };
  }

  // 4. Tipe lainnya (group, broadcast, newsletter, unknown)
  return { phone: '', resolvedJid: rawJid };
}
