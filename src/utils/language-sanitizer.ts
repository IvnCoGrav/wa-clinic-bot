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
 */
export function sanitizeGreetingRepetitionForFollowUp(text: string, isFollowUp: boolean = false): string {
  if (!text || !isFollowUp) return text;
  return text
    .replace(/^Halo\s+Bunda\s*[!✨🥰🌸\.,\s]*/i, '')
    .replace(/^Selamat\s+(?:pagi|siang|sore|malam)\s*[!✨🥰🌸\.,\s]*(?:Bunda\s*[!✨🥰🌸\.,\s]*)?/i, '')
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
 * Membersihkan afirmasi sepihak atas ketersediaan jadwal ("Tentu bisa...", "Pasti bisa...", "Bisa ya, Bun...")
 * saat bot merespons pengecekan jadwal/ketersediaan slot, sehingga bot menginfokan secara netral
 * bahwa jadwal akan dicekkan terlebih dahulu tanpa mengonfirmasi "bisa" di depan.
 */
export function sanitizeScheduleAffirmations(text: string): string {
  if (!text) return text;
  let cleaned = text;

  // 1. "Tentu bisa, kami bantu cekkan..." / "Tentu bisa Bunda, kami bantu cekkan..."
  //    -> "Kami bantu cekkan..."
  cleaned = cleaned.replace(
    /^(?:Tentu\s+bisa|Pasti\s+bisa|Bisa\s+kok|Bisa\s+banget)[,\s]+(?:(?:bunda|bun)[,\s]+)?(?:akan\s+)?kami\s+bantu\s+cekkan\b/i,
    'Kami bantu cekkan'
  );
  cleaned = cleaned.replace(
    /\b(?:Tentu\s+bisa|Pasti\s+bisa|Bisa\s+kok|Bisa\s+banget)[,\s]+(?:(?:bunda|bun)[,\s]+)?(?:akan\s+)?kami\s+bantu\s+cekkan\b/gi,
    'kami bantu cekkan'
  );

  // 2. "Tentu bisa, untuk jadwal..." / "Tentu bisa Bunda, untuk ketersediaan..."
  //    -> "Untuk jadwal..." / "Untuk ketersediaan..."
  cleaned = cleaned.replace(
    /^(?:Tentu\s+bisa|Pasti\s+bisa|Bisa\s+kok|Bisa\s+banget)[,\s]+(?:(?:bunda|bun)[,\s]+)?(?:untuk\s+)/i,
    'Untuk '
  );
  cleaned = cleaned.replace(
    /\b(?:Tentu\s+bisa|Pasti\s+bisa|Bisa\s+kok|Bisa\s+banget)[,\s]+(?:(?:bunda|bun)[,\s]+)?(?:untuk\s+)/gi,
    'untuk '
  );

  // 3. "Tentu bisa kami cekkan..." / "Tentu bisa kami jadwalkan..."
  cleaned = cleaned.replace(
    /^(?:Tentu\s+bisa|Pasti\s+bisa|Bisa\s+kok|Bisa\s+banget)[,\s]+(?:(?:bunda|bun)[,\s]+)?kami\s+(?:bantu\s+)?(?:jadwalkan|cekkan|aturkan)\b/i,
    'Kami bantu jadwalkan'
  );
  cleaned = cleaned.replace(
    /\b(?:Tentu\s+bisa|Pasti\s+bisa|Bisa\s+kok|Bisa\s+banget)[,\s]+(?:(?:bunda|bun)[,\s]+)?kami\s+(?:bantu\s+)?(?:jadwalkan|cekkan|aturkan)\b/gi,
    'kami bantu jadwalkan'
  );

  // 3b. "Bisa banget Bunda, kami melayani..." / "Tentu bisa Bunda, kami melayani..." -> "Kami melayani..."
  cleaned = cleaned.replace(
    /^(?:Tentu\s+bisa|Pasti\s+bisa|Bisa\s+kok|Bisa\s+banget)[,\s]+(?:(?:bunda|bun)[,\s]+)?(?:kami\s+melayani|layanan\s+kami\s+melayani)\b/i,
    'Kami melayani'
  );
  cleaned = cleaned.replace(
    /\b(?:Tentu\s+bisa|Pasti\s+bisa|Bisa\s+kok|Bisa\s+banget)[,\s]+(?:(?:bunda|bun)[,\s]+)?(?:kami\s+melayani|layanan\s+kami\s+melayani)\b/gi,
    'kami melayani'
  );

  // 4. "..., bisa ya, Bun / Bunda 😊 Untuk jam..." -> "..., ya Bunda 😊 Untuk jam..."
  cleaned = cleaned.replace(
    /,\s*(?:bisa\s+ya|bisa\s+kok)[,\s]+(?:bun|bunda)\b(?=\s*[😊☺️🥰🌸✨]*\s*(?:untuk|mau\s+jam|preferensi|pagi|siang|sore|apakah))/gi,
    ', Bunda'
  );
  cleaned = cleaned.replace(
    /\b(?:bisa\s+ya|bisa\s+kok)[,\s]+(?:bun|bunda)[,\s]*(?:😊|☺️)?\s*(?:untuk\s+jam|untuk\s+preferensi|untuk\s+ketersediaan|kami\s+bantu\s+cek)/gi,
    'kami bantu cek'
  );

  return cleaned;
}

/**
 * Membersihkan bocoran harga dan durasi waktu jika customer TIDAK menanyakan harga/biaya atau durasi.
 * Sesuai SOP: Harga & durasi tidak boleh dijelaskan secara proaktif kecuali customer menanyakan langsung.
 */
export function sanitizeUnsolicitedPriceAndDuration(text: string, customerInput?: string): string {
  if (!text || !customerInput) return text;

  const isAskingPriceOrDuration = /\b(berapa|harga|harganya|tarif|tarifnya|biaya|biayanya|ongkir|ongkirnya|ongkos|pricelist|durasi|menit|lama|lamanya|waktu|jam|bayar)\b/i.test(customerInput);
  if (isAskingPriceOrDuration) {
    return text;
  }

  let cleaned = text;
  // Hapus pola frasa harga & durasi yang menempel di rekomendasi treatment
  // Contoh: "dengan tarif promo Rp 70.000 durasi sekitar 40 menit"
  // Contoh: "seharga Rp 70.000 durasi 40 menit"
  // Contoh: "dengan biaya Rp 70.000"
  cleaned = cleaned
    .replace(/(?:,\s*|\s+)(?:dengan\s+)?(?:tarif|harga|biaya)?(?:\s+promo)?\s+Rp\s*[\d\.]+(?:rb|k|ribu)?(?:\s*,\s*|\s+)(?:durasi\s+(?:sekitar\s+)?\d+\s+menit)/gi, '')
    .replace(/(?:,\s*|\s+)(?:dengan\s+)?(?:tarif|harga|biaya)(?:\s+promo)?\s+Rp\s*[\d\.]+(?:rb|k|ribu)?/gi, '')
    .replace(/(?:,\s*|\s+)(?:seharga|seharganya)\s+Rp\s*[\d\.]+(?:rb|k|ribu)?/gi, '')
    .replace(/(?:,\s*|\s+)(?:durasi\s+(?:sekitar\s+)?\d+\s+menit)/gi, '')
    .replace(/[^\S\r\n]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+\./g, '.')
    .trim();

  return cleaned;
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

export interface UnifiedSanitizerOptions {
  isFollowUp?: boolean;
  historyCount?: number;
  preserveGreeting?: boolean;
  customerInput?: string;
}

/**
 * UnifiedResponseSanitizer
 * Satu gerbang sentral pembersihan untuk seluruh teks outbound bot ke WhatsApp.
 */
export class UnifiedResponseSanitizer {
  public static sanitize(text: string, options?: UnifiedSanitizerOptions): string {
    if (!text) return '';

    // 0. Guardrail Anti-Monolog & Anti-AI Leakage (blok <think>, monolog internal)
    const monologueStripped = stripAiReasoningAndMonologue(text);
    if (!monologueStripped || monologueStripped.trim().length < 5) {
      return '';
    }
    text = monologueStripped;

    const isFollowUp = !options?.preserveGreeting && Boolean(options?.isFollowUp || (options?.historyCount ?? 0) > 0);

    let cleaned = text;

    // 1. Aksara Asing & RAG Leakage
    cleaned = stripNonIndonesianScripts(cleaned);
    cleaned = sanitizeRagLeakage(cleaned);

    // 2. English Slop & Hallucinated Terms
    cleaned = sanitizeForbiddenEnglishWords(cleaned);
    cleaned = sanitizeHallucinatedTerms(cleaned);

    // 3. Pronouns ("saya" -> "kami") & Slang ("Bund" -> "Bunda")
    cleaned = sanitizePronounsAndSlang(cleaned);

    // 4. Repetitive Greetings & Typo & Anti-Affirmation Schedule Guard & Single Question Guard
    cleaned = sanitizeRepetitiveGreetings(cleaned);
    cleaned = sanitizeScheduleAffirmations(cleaned);
    cleaned = sanitizeDoubleQuestions(cleaned);
    cleaned = sanitizeUnsolicitedPriceAndDuration(cleaned, options?.customerInput);
    cleaned = sanitizeEmDash(cleaned);
    cleaned = sanitizeStrayBackslashes(cleaned);

    // 5. WhatsApp Format & Markdown
    cleaned = cleaned
      .replace(/\*\*([^*]+)\*\*/g, '*$1*') // Ubah **teks** menjadi *teks*
      .replace(/([a-zA-Z])(Rp\s*[\d.]+)/g, '$1 $2') // Spasi antara huruf dan Rp
      .replace(/Rp\s*(\d)/g, 'Rp $1') // Standar "Rp 25.000"
      .replace(/Rp\s*(\d{1,3})(\d{3})\b/g, 'Rp $1.$2') // Format ribuan Rp 25000 -> Rp 25.000
      .replace(/\bUntukjarak\b/gi, 'Untuk jarak')
      .replace(/\bDarijarak\b/gi, 'Dari jarak')
      .replace(/\bJadi\s+bisa\s+ya[,\s]+Bunda\s*[☺️😊]?\s*Jadi\s+/gi, 'Jadi ')
      .replace(/\b(?:Insya\s*Allah|Alhamdulillah|Bismillah|Puji\s*Tuhan)\b[,.\s]*/gi, '') // Netralitas agama
      .replace(/\b(?:Btw|btw)\b[,.\s]*/gi, 'Kalau boleh tahu, ')
      .replace(/\bBinti\b/g, 'Bunda')
      .replace(/\bdiformulasi\s+khusus\b/gi, 'khusus')
      .trim();

    // 6. Header Greeting Stripper jika percakapan lanjutan aktif
    cleaned = sanitizeGreetingRepetitionForFollowUp(cleaned, isFollowUp);

    // 7. Jamin setidaknya ada 1 emoji senyum hangat jika belum ada emoji sama sekali
    if (!/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[😊☺️🥰🌸]/u.test(cleaned)) {
      cleaned = `${cleaned} 😊`;
    }

    // 8. Pemisah Paragraf / Baris Baru setelah Emoticon (Anti-Wall of Text)
    cleaned = formatParagraphsAfterEmoji(cleaned);

    // 9. Anti-truncation guard: jika <5 char (mis. "S") tolak
    if (!cleaned || cleaned.trim().length < 5) {
      return '';
    }

    return cleaned;
  }
}



