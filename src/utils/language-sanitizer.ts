/**
 * language-sanitizer.ts
 * Membersihkan teks hasil LLM dari aksara bahasa asing yang bocor (terutama karakter
 * CJK Mandarin/Kanji dan Cyrillic Rusia). DeepSeek & model lain kadang menyelipkan
 * karakter Mandarin/Rusia di tengah kalimat Indonesia. Ini lapisan post-processing
 * terakhir agar customer tidak pernah melihat teks asing.
 *
 * CATATAN ARSITEKTUR (Pilar 6 — Sanitizer Pruning, varian aman):
 * Fungsi-fungsi di modul ini TIDAK terpasang di jalur outbound aktif V3
 * (agent-runner hanya memakai OutputSanitizer + normalizeWhatsAppFormat).
 * Ekspor dipertahankan untuk kompatibilitas impor historis & cakupan unit test
 * (language-sanitizer.test.ts, language-sanitizer-fixes.test.ts,
 * lead-greeting-preservation.test.ts); penghapusan total akan mematahkan test
 * tanpa manfaat runtime. Kendali perilaku LLM diselesaikan di level
 * Prompt/Grounding/Few-Shot sesuai mandat AGENTS.md.
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
 * Guardrail Anti-Monolog & Anti-AI Leakage
 * Menghapus reasoning CoT yang bocor ke customer.
 */
export function stripAiReasoningAndMonologue(text: string): string {
  if (!text) return '';
  let cleaned = text;
  // Hapus blok <think>...</think> dan [THINKING]...[/THINKING] (global, multiline)
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
  cleaned = cleaned.replace(/\[THINKING\][\s\S]*?\[\/THINKING\]/gi, '');
  // Hapus pola monolog internal di awal baris/kalimat
  const monologueLinePatterns = [
    /^(?:Kita|Saya|Mari\s+kita)\s+perlu\s+(?:menyusun|merespons|menjawab|memperhatikan|mempertimbangkan|membuat|mengirim)\b.*$/gim,
    /^(?:Konteks|Analisis|Instruksi|Aturan|Perhatikan\s+aturan):.*$/gim,
    /^(?:Lihat\s+contoh\s+di\s+prompt|Dalam\s+peran\s+sebagai|Etika\s+roleplay)\b.*$/gim,
  ];
  for (const re of monologueLinePatterns) {
    cleaned = cleaned.replace(re, '');
  }
  // Hapus frasa monolog yang terselip di tengah kalimat (tanpa anchor ^)
  cleaned = cleaned.replace(/Kita\s+perlu\s+menyusun\s+balasan\s+dari\s+Bidan\s+Yusi[^.!?\n]*[.!?\n]*/gi, '');
  cleaned = cleaned.replace(/Lihat\s+contoh\s+di\s+prompt[^.!?\n]*[.!?\n]*/gi, '');
  cleaned = cleaned.replace(/Dalam\s+peran\s+sebagai\s+Bidan[^.!?\n]*[.!?\n]*/gi, '');
  cleaned = cleaned.trim().replace(/\n{3,}/g, '\n\n');
  // Jika setelah dibersihkan kosong atau <5 char (mis. "S"), kembalikan kosong agar ditolak
  if (!cleaned || cleaned.trim().length < 5) {
    return '';
  }
  return cleaned;
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
    .replace(/(?<!\b(?:Kala\s+)?Moms?\s+(?:and|&)\s+)baby(?:-nya|nya)?\b/gi, 'bayi')
    .replace(/\bmommy(?:-nya|nya)?\b/gi, 'Bunda')
    .replace(/\bschedule\b/gi, 'jadwal')
    .replace(/\bappointment(?:-nya|nya)?\b/gi, 'jadwal reservasi')
    .replace(/\bKala\s+Moms?\s+(?:and|&)\s+bayi\s+Spa\b/gi, 'Kala Moms and Baby Spa')
    .replace(/\bKala\s+Mom's\s+(?:and|&)\s+bayi\s+Spa\b/gi, 'Kala Moms and Baby Spa');
}

/**
 * Membersihkan istilah halusinasi penerjemahan LLM yang aneh
 * (seperti "antimeminjamkan", "biaya pinjam" alih-alih "ongkir",
 * serta halusinasi nama panggilan anak seperti "Bunny").
 *
 * @deprecated Tidak dipasang di jalur outbound V3 — dipertahankan hanya untuk
 * kompatibilitas test/impor historis. Kendali istilah diselesaikan di level prompt.
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
    // Perbaiki preposisi dan konjungsi kaku "maupun/dan/untuk bund/bun" -> "Bunda"
    .replace(/\b(maupun|dan|serta|untuk|ke|dari|pada|bagi|buat|oleh)\s+(?:bund|bun)\b/gi, '$1 Bunda')
    .replace(/\b(untuk|buat|pada|bagi|terkait)\s+bunny\b/gi, '$1 si kecil')
    .replace(/\bsi\s+bunny\b/gi, 'si kecil')
    .replace(/\b(ya|kan|nih|deh),?\s+(?:bund|bun)\b/gi, '$1, Bunda')
    .replace(/,\s*(?:bund|bun)\b/gi, ', Bunda')
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
 * AKTIF via normalizeWhatsAppFormat (whatsapp-format.ts) — satu-satunya sanitizer
 * modul ini yang tetap terpasang di jalur produksi. TIDAK dihapus / TIDAK dipindah
 * agar tidak mengaduk impor produksi & cakupan test.
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
 *
 * @deprecated Tidak dipasang di jalur outbound V3 — dipertahankan hanya untuk
 * kompatibilitas test/impor historis (sanitasi teknis murni bila dibutuhkan).
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

/**
 * Membersihkan kata ganti non-standar (saya/aku -> kami) dan singkatan slang (Bund -> Bunda).
 */
export function sanitizePronounsAndSlang(text: string): string {
  if (!text) return text;
  return text
    // Perbaiki singkatan slang "Bund" / "bund" / "Bun" / "bun" menjadi "Bunda" (case-insensitive)
    .replace(/\b(?:bund|bun)\b/gi, 'Bunda')
    // Perbaiki typo awalan kata "Baak," / "baak" -> "Baik,"
    .replace(/\bBaak\b/g, 'Baik')
    .replace(/\bbaak\b/g, 'baik')
    // Perbaiki kata ganti orang pertama tunggal menjadi jamak tim "kami"
    .replace(/\b(biar|agar|akan|mau|nanti|bisa|boleh|jika|apakah|supaya)\s+saya\b/gi, '$1 kami')
    .replace(/\b(?:bantuan|arahan)\s+saya\b/gi, '$1 kami')
    .replace(/\bsaya\s+(tahu|ketahui|bantu|sarankan|siapkan|cekkan|arahkan|jadwalkan|dampingi|lihat|rekomendasikan|minta)\b/gi, 'kami $1')
    .replace(/\bsaya\s+pribadi\b/gi, 'kami')
    .replace(/\baku\s+(cek|bantu|jadwalkan|sarankan|siapkan|tahu)\b/gi, 'kami $1')
    // Perbaiki spasi partikel imbuhan -kan yang terpisah
    .replace(/\binfo\s+kan\b/gi, 'infokan')
    .replace(/\bcek\s+kan\b/gi, 'cekkan')
    // Normalisasi QRIS e-wallet spesifik ke QRIS Universal
    .replace(/\bQRIS\s+(?:ShopeePay|GoPay|OVO|Dana|BCA)\b/gi, 'QRIS')
    .replace(/\bShopeePay\b/gi, 'QRIS')
    // Anti-overclaim medis
    .replace(/\bmenyembuhkan\b/gi, 'membantu meredakan')
    .replace(/\bpasti\s+sembuh\b/gi, 'membantu proses pemulihan')
    .replace(/\bmenghilangkan\s+(batuk|pilek|grok-grok|lendir)\b/gi, 'membantu melegakan $1')
    .replace(/\bmembuat\s+(si\s+kecil|adik|bayi|anak)\s+tidur\s+(?:lebih\s+)?pulas\b/gi, 'membantu $1 tidur lebih nyaman')
    .trim();
}

/**
 * Memangkas sapaan pembuka ganda (Halo Bunda! / Selamat siang Bunda!) jika percakapan sedang berlangsung aktif.
 * Termasuk varian perkenalan diri Turn-0 agar chat lanjutan langsung ke inti jawaban.
 */
export function sanitizeGreetingRepetitionForFollowUp(text: string, isFollowUp: boolean = false): string {
  if (!text || !isFollowUp) return text;
  return text
    .replace(/^(?:halo|hai|hei|hey)\s+(?:bunda|bun|kak|min)\s*[!✨🥰🌸\.,\s]*/i, '')
    .replace(/^Selamat\s+(?:pagi|siang|sore|malam)\s*[!✨🥰🌸\.,\s]*(?:Bunda\s*[!✨🥰🌸\.,\s]*)?/i, '')
    .replace(/^(?:Terima\s+kasih\s+sudah\s+menghubungi\s+kami[.,\s✨🌸]*)(?:Perkenalkan,\s+saya\s+Bidan\s+Yusi[^.!?\n]*[.!?\n]*)?/i, '')
    .replace(/^Perkenalkan,\s+saya\s+Bidan\s+Yusi[^.!?\n]*[.!?\n]*/i, '')
    .trim();
}

/**
 * Memangkas sapaan pembuka redundan pada body balasan sebelum digabungkan dengan greeting header resmi Turn-0.
 */
export function stripDuplicateTurn0Greeting(text: string): string {
  if (!text) return '';
  return text
    .replace(/^(?:(?:halo|hai|waalaikumsalam|assalamualaikum|selamat\s+(?:pagi|siang|sore|malam))\s+(?:bunda|kak|min)[!.,✨🌸\s]*)+/i, '')
    .replace(/^(?:terima\s+kasih\s+(?:sudah|telah|banyak)\s+menghubungi\s+(?:kala\s+moms\s+(?:and|&)\s+baby\s+spa|kami)[!.,✨🌸\s]*)+/i, '')
    .replace(/^(?:(?:halo|hai|waalaikumsalam|assalamualaikum|selamat\s+(?:pagi|siang|sore|malam))\s+(?:bunda|kak|min)[!.,✨🌸\s]*)+/i, '')
    .trim();
}

/**
 * Memberikan baris baru / pemisah paragraf (\n\n) setelah emoticon penutup klausa/kalimat
 * jika langsung disambung kalimat baru berawalan huruf kapital atau tanda formatting (*),
 * agar pesan WhatsApp tidak menumpuk menjadi satu paragraf panjang (wall of text).
 */
export function formatParagraphsAfterEmoji(text: string): string {
  if (!text) return '';
  return text
    // 1. Emoticon diikuti spasi dan kalimat baru (huruf kapital atau tanda bintang *)
    // Contoh: "...tersedia setiap hari ya 😊 Untuk ketersediaan..." -> "...tersedia setiap hari ya 😊\n\nUntuk ketersediaan..."
    .replace(/([\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}😊☺️🥰🌸✨🤗🙏🤍])\s+(?=[A-Z\*(])/gu, '$1\n\n')
    // 2. Normalisasi jika ada lebih dari 2 baris baru
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Membersihkan pertanyaan ganda yang menumpuk di kalimat penutup jika LLM menanyakan jam SEKALIGUS kelurahan rumah.
 *
 * @deprecated Tidak dipasang di jalur outbound V3 — dipertahankan hanya untuk
 * kompatibilitas test/impor historis. Kontrol pertanyaan penutup hidup di prompt persona §6.
 * Contoh: "Boleh tahu preferensi jam kunjungannya range pagi/siang/sore? Serta daerah atau kelurahan rumah Bunda agar kami bisa sekaligus bantu cek ongkirnya? 😊"
 * -> "Kalau boleh tahu, rumah Bunda di daerah atau kelurahan mana yaa agar bisa sekalian kami bantu cekkan ketersediaan jadwal Bidan & ongkirnya? 😊"
 */
export function sanitizeDoubleQuestions(text: string): string {
  if (!text) return '';
  return text.replace(
    /(?:Boleh\s+tahu\s+)?preferensi\s+jam\s*(?:kunjungannya)?\s*(?:range\s*)?(?:pagi\/siang\/sore|\(pagi\/siang\/sore\))\s*\??\s*(?:Serta|Dan|dan|serta|sekaligus)\s*(?:daerah\s+atau\s+)?kelurahan\s+rumah\s+Bunda\s*(?:di\s+mana\s+ya|agar\s+kami\s+bisa\s+sekaligus\s+bantu\s+cek\s+ongkirnya)?\s*\??/gi,
    'Kalau boleh tahu, rumah Bunda di daerah atau kelurahan mana yaa agar bisa sekalian kami bantu cekkan ketersediaan jadwal Bidan & ongkirnya?'
  );
}
