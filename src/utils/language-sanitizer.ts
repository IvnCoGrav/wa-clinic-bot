/**
 * language-sanitizer.ts
 * Membersihkan teks hasil LLM dari aksara bahasa asing yang bocor (terutama karakter
 * CJK Mandarin/Kanji dan Cyrillic Rusia). DeepSeek & model lain kadang menyelipkan
 * karakter Mandarin/Rusia di tengah kalimat Indonesia. Ini lapisan post-processing
 * terakhir agar customer tidak pernah melihat teks asing.
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
 * True jika teks mengandung aksara asing (CJK/Kanji/Jepang/Korea/Rusia).
 * Dipakai untuk deteksi dini / logging sebelum sanitasi.
 */
export function containsForeignScripts(text: string): boolean {
  if (!text) return false;
  return FOREIGN_SCRIPT_RE.test(text);
}

/**
 * Membersihkan frasa bocor dari RAG Knowledge Base atau typo tokenization
 * seperti "Bun.etails info di sini", "details info", "info di sini", dll.
 */
export function sanitizeRagLeakage(text: string): string {
  if (!text) return text;
  return text
    .replace(/(?:Bun\s*[\.,]\s*)?d?\.?etails?\s+info(?:\s+di\s+sini|\s+ini)?\s*/gi, '')
    .replace(/\binfo\s+di\s+sini\s*/gi, '')
    .replace(/\bberdasarkan\s+(?:referensi\s+dokumen|referensi|data|dokumen)\s+(?:di\s+atas|kami)\s*,?\s*/gi, '')
    .trim();
}

/**
 * Membersihkan kata-kata bahasa Inggris yang dilarang bocor ke customer
 * (seperti "little one", "little one-nya", "baby", "mommy", "schedule", "appointment").
 */
export function sanitizeForbiddenEnglishWords(text: string): string {
  if (!text) return text;
  return text
    .replace(/\blittle\s+one(?:-nya|nya)?\b/gi, 'si kecil')
    .replace(/\bbaby(?:-nya|nya)?\b/gi, 'bayi')
    .replace(/\bmommy(?:-nya|nya)?\b/gi, 'Bunda')
    .replace(/\bschedule\b/gi, 'jadwal')
    .replace(/\bappointment(?:-nya|nya)?\b/gi, 'jadwal reservasi');
}

/**
 * Membersihkan istilah halusinasi penerjemahan LLM yang aneh
 * (seperti "antimeminjamkan", "biaya pinjam" alih-alih "ongkir").
 */
export function sanitizeHallucinatedTerms(text: string): string {
  if (!text) return text;
  return text
    .replace(/\b(?:biaya\s+)?antimeminjamkan(?:nya)?\b/gi, 'ongkirnya')
    .replace(/\banti\s*meminjamkan(?:nya)?\b/gi, 'ongkirnya')
    .replace(/\bbiaya\s+peminjaman(?:nya)?\b/gi, 'ongkos kirimnya')
    .replace(/\b(untuk|ke|dari|pada|bagi|buat|oleh)\s+bund\b/gi, '$1 Bunda')
    .replace(/\bsyukur\s+sekali\b/gi, 'Wah senang sekali')
    .replace(/\bpuji\s+syukur\b/gi, 'Wah senang sekali');
}

/**
 * Menghilangkan karakter em-dash (—) sesuai pedoman anti-slop (design.md §9 EM-DASH BAN).
 * LLM sering menyelipkan em-dash di tengah jawaban; WhatsApp & gaya chat santai
 * persona tidak memakainya. Penggantian kontekstual:
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

