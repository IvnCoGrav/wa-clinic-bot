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
