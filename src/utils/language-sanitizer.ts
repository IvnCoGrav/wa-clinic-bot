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
 * (seperti "antimeminjamkan", "biaya pinjam" alih-alih "ongkir",
 * serta halusinasi nama panggilan anak seperti "Bunny").
 */
export function sanitizeHallucinatedTerms(text: string): string {
  if (!text) return text;
  return text
    .replace(/\b(?:biaya\s+)?antimeminjamkan(?:nya)?\b/gi, 'ongkirnya')
    .replace(/\banti\s*meminjamkan(?:nya)?\b/gi, 'ongkirnya')
    .replace(/\bbiaya\s+peminjaman(?:nya)?\b/gi, 'ongkos kirimnya')
    // Perbaiki kesalahan penerjemahan nama brand "Kala Moms and bayi Spa"
    .replace(/\bKala\s+Moms?\s+(?:and|&)\s+bayi\s+Spa\b/gi, 'Kala Moms and Baby Spa')
    .replace(/\bKala\s+Mom's\s+(?:and|&)\s+bayi\s+Spa\b/gi, 'Kala Moms and Baby Spa')
    // Perbaiki preposisi dan konjungsi kaku "maupun/dan/untuk bund" -> "Bunda"
    .replace(/\b(maupun|dan|serta|untuk|ke|dari|pada|bagi|buat|oleh)\s+bund\b/gi, '$1 Bunda')
    .replace(/\b(maupun|dan|serta|untuk|ke|dari|pada|bagi|buat|oleh)\s+Bund\b/g, '$1 Bunda')
    .replace(/\b(untuk|buat|pada|bagi|terkait)\s+bunny\b/gi, '$1 si kecil')
    .replace(/\bsi\s+bunny\b/gi, 'si kecil')
    .replace(/\b(ya|kan|nih|deh),?\s+bund\b/gi, '$1, Bunda')
    .replace(/,\s*bund\b/gi, ', Bunda')
    .replace(/\bsyukur\s+sekali\b/gi, 'Wah senang sekali')
    .replace(/\bpuji\s+syukur\b/gi, 'Wah senang sekali');
}

/**
 * Mengurangi penggunaan kata sapaan "Bunda" yang berulang-ulang secara berlebihan (anti-overuse)
 * dalam satu klausa/kalimat penutup agar kalimat mengalir alami seperti manusia (CS/Bidan asli).
 */
export function sanitizeRepetitiveGreetings(text: string): string {
  if (!text) return text;
  
  let cleaned = text
    // 1. Perbaiki frasa dobel sapaan yang menumpuk di kalimat penutup
    .replace(/rumah(?:nya)?\s+di\s+mana\s+ya\s+Bunda\?\s*Biar\s+sekalian\s+kami\s+bantu\s+cekkan\s+ketersediaan\s+bidan\s+&\s+ongkir\s+ke\s+tempat\s+Bunda\s*😊?/gi, 
      'Kalau boleh tahu rumahnya di mana ya Bunda? Biar sekalian kami bantu cekkan ketersediaan bidan & ongkirnya 😊')
    .replace(/ongkir\s+ke\s+tempat\s+Bunda\b/gi, 'ongkirnya')
    .replace(/ongkirnya\s+ke\s+tempat\s+Bunda\b/gi, 'ongkirnya')
    .replace(/ketersediaan\s+bidan\s+ke\s+tempat\s+Bunda\b/gi, 'ketersediaan bidan')
    // 2. Hilangkan sapaan jeda yang menumpuk dalam kalimat yang sama (contoh: "ya, Bunda. Sudah terlatih ... maupun Bunda" -> "ya. Sudah terlatih ... maupun Bunda")
    .replace(/,\s*ya,?\s*Bunda\b(?=[^.!?\n]*\bBunda\b)/gi, ', ya')
    .replace(/,\s*Bunda\b(?=[^.!?\n]*\bBunda\b)/gi, '');

  return cleaned;
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

/**
 * Membersihkan backslash liar (\) dan typo JSON escaping yang menempel di kata,
 * seperti "\Bundlebih" -> "Bunda lebih", "\Bund" -> "Bunda", "\n" mentah, dll.
 */
export function sanitizeStrayBackslashes(text: string): string {
  if (!text) return text;
  return text
    // Perbaiki pola "\Bundlebih" atau "\Bund lebih" -> "Bunda lebih"
    .replace(/\\(?:Bundlebih|Bund\s*lebih)\b/gi, 'Bunda lebih')
    .replace(/\\Bund\b/gi, 'Bunda')
    // Buang backslash liar sebelum karakter alfabet (\Bunda -> Bunda, \text -> text)
    .replace(/\\([a-zA-Z])/g, '$1')
    // Buang backslash ganda atau menggantung di akhir/tengah kata
    .replace(/\\\\+/g, '')
    .trim();
}


