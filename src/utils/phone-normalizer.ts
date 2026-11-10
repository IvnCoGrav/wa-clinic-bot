/** Normalizer HP Indonesia tunggal: 08xx/8xx/62xx -> 62xx, strip non-digit. Murni.
 * Mendukung pembersihan suffix WhatsApp (@c.us, @s.whatsapp.net, :device).
 */
export function normalizePhoneID(raw: string | null | undefined): string {
  if (!raw) return '';
  let cleaned = String(raw).split('@')[0].trim();
  if (cleaned.includes(':')) {
    const parts = cleaned.split(':');
    cleaned = parts[0];
  }
  const d = cleaned.replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('62')) return d;
  if (d.startsWith('0')) return '62' + d.slice(1);
  if (/^8\d{7,13}$/.test(d)) return '62' + d;
  return d;
}

export const normalizePhoneToE164 = normalizePhoneID;
