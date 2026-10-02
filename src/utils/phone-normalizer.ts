/** Normalizer HP Indonesia tunggal: 08xx/8xx/62xx -> 62xx, strip non-digit. Murni. */
export function normalizePhoneID(raw: string | null | undefined): string {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('62')) return d;
  if (d.startsWith('0')) return '62' + d.slice(1);
  if (/^8\d{7,13}$/.test(d)) return '62' + d;
  return d;
}
