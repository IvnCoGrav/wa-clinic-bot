/**
 * staff-signature.ts
 * Satu sumber kebenaran (single source of truth) untuk penyematan tanda tangan
 * identitas terapis (`~ Bidan [Nama]`) di baris paling bawah pesan WhatsApp
 * lapangan: OTW, konfirmasi tiba di lokasi, dan balasan manual terapis.
 *
 * Idempoten: aman dipanggil berulang tanpa menggandakan tanda tangan.
 * Tahan terhadap nama yang mengandung karakter regex (mis. `Bidan (Ayu)`).
 */

/** Escape karakter khusus regex agar nama terapis aman dipakai dalam RegExp. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True bila teks sudah diakhiri tanda tangan `~ [Nama Terapis]`. */
export function hasStaffSignature(text: string, staffName?: string | null): boolean {
  const name = (staffName || '').trim();
  if (!name) return false;
  const pattern = new RegExp(`~\\s*${escapeRegex(name)}$`, 'i');
  return pattern.test((text || '').trim());
}

/**
 * Memastikan teks berakhir dengan tanda tangan `~ [Nama Terapis]`.
 * - Teks kosong → string kosong (tidak menyematkan tanda tangan ke pesan kosong).
 * - Sudah bertanda tangan (case-insensitive, spasi fleksibel) → tidak digandakan.
 * - Nama terapis kosong → teks dikembalikan apa adanya (trimmed).
 */
export function ensureStaffSignature(text: string, staffName?: string | null): string {
  const name = (staffName || '').trim();
  const trimmed = (text || '').trim();
  if (!trimmed) return '';
  if (!name) return trimmed;
  if (hasStaffSignature(trimmed, name)) return trimmed;
  return `${trimmed}\n\n~ ${name}`;
}
