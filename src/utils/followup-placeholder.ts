/**
 * Kontrak kanonis placeholder follow-up (Fase 3).
 *
 * Dua gerbang deterministik:
 *  1. VARIABEL TERLARANG per keluarga template — ditolak saat admin menyimpan
 *     template (bukan auto-hapus, agar kalimat buatan admin tidak dimutilasi).
 *  2. PLACEHOLDER MENTAH — bila setelah substitusi masih ada `{apapun}` di teks
 *     yang akan dikirim, pengiriman DIBATALKAN (jangan pernah kirim placeholder
 *     mentah ke WhatsApp customer).
 *
 * Murni deterministik (zero I/O, zero side-effect).
 */

/** Keluarga template khusus perawatan IBU (MOMS): narasi/varian bayi dilarang. */
export function isMomsFollowUpTemplateType(type: string | null | undefined): boolean {
  const t = String(type || '').toUpperCase().trim();
  if (!t) return false;
  return t === 'REVIEW_H1_MOMS' || t.startsWith('NEXT_TREATMENT_MOMS_');
}

/** Placeholder yang DILARANG muncul pada template keluarga MOMS. */
export const MOMS_FORBIDDEN_PLACEHOLDERS: readonly string[] = ['{babyName}'];

/** Placeholder yang ditemukan di teks (dinormalisasi ke huruf asli penulisan). */
const PLACEHOLDER_PATTERN = /\{[a-zA-Z][a-zA-Z0-9_]*\}/g;

/** Daftar placeholder mentah yang belum tersubstitusi (unik, urutan kemunculan). */
export function findUnresolvedPlaceholders(text: string | null | undefined): string[] {
  const src = String(text || '');
  const found = src.match(PLACEHOLDER_PATTERN) || [];
  return Array.from(new Set(found));
}

/** Daftar variabel terlarang yang benar-benar muncul pada teks template. */
export function findForbiddenPlaceholders(
  type: string | null | undefined,
  text: string | null | undefined
): string[] {
  if (!isMomsFollowUpTemplateType(type)) return [];
  const src = String(text || '');
  return MOMS_FORBIDDEN_PLACEHOLDERS.filter((p) =>
    new RegExp(p.replace(/[{}]/g, '\\$&'), 'i').test(src)
  );
}
