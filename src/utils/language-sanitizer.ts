/**
 * language-sanitizer.ts
 * Membersihkan teks hasil LLM dari aksara bahasa asing yang bocor (terutama karakter
 * CJK Mandarin/Kanji dan Cyrillic Rusia), backslash liar, serta em-dash.
 *
 * Sesuai Audit & Cleanup Plan 2026-11-08 (D1 Opsi A):
 * - stripNonIndonesianScripts: AKTIF di OutputSanitizer.cleanOutboundReply
 * - sanitizeStrayBackslashes: AKTIF di OutputSanitizer.cleanOutboundReply
 * - sanitizeEmDash: AKTIF di normalizeWhatsAppFormat
 * 11 fungsi mati lainnya (pengganti kata semantik / duplikat) telah dibersihkan.
 */

// Blok aksara yang dianggap asing & harus dibuang dari jawaban LLM:
// - Han (Mandarin/Kanji/Hanja): \u4E00-\u9FFF, \u3400-\u4DBF, \uF900-\uFAFF
// - Hiragana/Katakana (Jepang): \u3040-\u30FF
// - Hangul (Korea): \uAC00-\uD7AF, \u1100-\u11FF
// - Cyrillic (Rusia/Bulgaria): \u0400-\u04FF
const FOREIGN_SCRIPT_RE =
  /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF\u1100-\u11FF\u0400-\u04FF]/g;

/**
 * Buang semua karakter aksara asing (CJK/Kanji, Jepang, Korea, Rusia) dari teks.
 * Hanya karakter tersebut yang dihapus; huruf latin, angka, dan emoji tetap utuh.
 */
export function stripNonIndonesianScripts(text: string): string {
  if (!text) return text;
  return text.replace(FOREIGN_SCRIPT_RE, '');
}

/**
 * Menghilangkan karakter em-dash (—) sesuai pedoman anti-slop (design.md §9 EM-DASH BAN).
 * AKTIF via normalizeWhatsAppFormat (whatsapp-format.ts).
 * Penggantian kontekstual:
 * - Rentang angka ("jam 9—11")  -> hyphen "-"   ("jam 9-11")
 * - Bullet list di awal baris   -> "- "         ("- Gratis ongkir")
 * - Pemisah antar klausa        -> koma ", "    ("Halo—mau tanya" -> "Halo, mau tanya")
 */
export function sanitizeEmDash(text: string): string {
  if (!text) return text;
  return text
    .replace(/(\d)—(\d)/g, '$1-$2')
    .replace(/^—\s*/gm, '- ')
    .replace(/\s*—\s*/g, ', ');
}

/**
 * Membersihkan backslash liar (\) dan typo JSON escaping yang menempel di kata,
 * seperti "\Bundlebih" -> "Bunda lebih", "\Bund" -> "Bunda", "\n" mentah, dll.
 * AKTIF di OutputSanitizer.cleanOutboundReply.
 */
export function sanitizeStrayBackslashes(text: string): string {
  if (!text) return text;
  return text
    .replace(/\\(?:Bundlebih|Bund\s*lebih)\b/gi, 'Bunda lebih')
    .replace(/\\Bund\b/gi, 'Bunda')
    .replace(/\\([a-zA-Z])/g, '$1')
    .replace(/\\\\+/g, '')
    .trim();
}
