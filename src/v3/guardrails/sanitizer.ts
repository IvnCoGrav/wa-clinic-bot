import { getMaxCharsPerReply } from '../../config/persona';

export class OutputSanitizer {
  /** Plafon default tenant-aware (sesi 381894): umum 1200, konteks katalog/keranjang 1500. */
  public static readonly DEFAULT_MAX_CHARS = 1200;
  public static readonly CATALOG_MAX_CHARS = 1500;

  /**
   * Membersihkan tag thinking, monolog internal, dan artefak AI dari balasan sebelum dikirim ke WhatsApp.
   * Plafon karakter tenant-aware: opts.maxChars eksplisit > TenantPersona.max_chars_per_reply (DB)
   * > default konteks-sadar (1500 katalog / 1200 umum). Param ke-4 number tetap didukung
   * demi kompatibilitas pemanggil lama.
   */
  public static cleanOutboundReply(
    rawText: string,
    customerInput?: string,
    isFollowUp: boolean = false,
    maxCharsOrOpts?: number | { tenantId?: string; maxChars?: number; isCatalogContext?: boolean }
  ): string {
    if (!rawText || typeof rawText !== 'string') return '';

    let text = rawText;

    // 1. Hapus tag <think>...</think> dan [THINKING]...[/THINKING]
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
    text = text.replace(/\[THINKING\][\s\S]*?\[\/THINKING\]/gi, '');

    // 2. Hapus blok kode markdown jika model membungkus balasan dengan ```
    text = text.replace(/^```(?:markdown|text)?\s*/i, '').replace(/\s*```$/i, '');

    // 3. Hapus pola monolog internal bahasa Indonesia (AI self-talk)
    const monologuePatterns = [
      /^(?:Kita|Saya|Mari\s+kita)\s+perlu\s+(?:menyusun|merespons|menjawab|membalas|memperhatikan)[\s\S]*?(?=\n\n|Halo|Hai|Pagi|Siang|Sore|Malam|Bunda|Bapak|$)/i,
      /^(?:Konteks|Analisis|Instruksi|Aturan|Catatan|Perhatikan\s+aturan)\s*:[\s\S]*?(?=\n\n|Halo|Hai|Pagi|Siang|Sore|Malam|Bunda|Bapak|$)/i,
      /^(?:Lihat\s+contoh|Dalam\s+peran\s+sebagai|Etika\s+roleplay|Sebagai\s+Bidan\s+Yusi,\s*saya\s+akan\s+menjawab\s*:)[\s\S]*?(?=\n\n|Halo|Hai|Pagi|Siang|Sore|Malam|Bunda|Bapak|$)/i,
    ];

    for (const pattern of monologuePatterns) {
      text = text.replace(pattern, '').trim();
    }

    // 4. Aturan Enter Setelah Emot: Hapus titik setelah emot & sisipkan \n\n jika diikuti kalimat baru
    text = text.replace(/([\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+)\s*\./gu, '$1');
    text = text.replace(/(?<!^)(?<!\n)([\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+)\s+([A-Z*#0-9])/gu, '$1\n\n$2');

    // 5. Pastikan semua format nominal harga dibungkus bintang tunggal (*Rp 10.000*)
    text = text.replace(/(?<!\*)\b(Rp\s*\d{1,3}(?:\.\d{3})*(?:,\d+)?)\b(?!\*)/g, '*$1*');

    // 6. Normalisasi spasi dan baris baru berlebih (sesi 381894: blank-line
    // ber-spasi "\n   \n" diserap menjadi "\n\n" agar hitung batas paragraf benar)
    text = text.replace(/\n[ \t]+\n/g, '\n\n').replace(/\n{3,}/g, '\n\n').trim();

    // 7. Guardrail minimal (Mandat Minimal-Regex Phase 4):
    // - stripEnglishLeakage & sanitizeFirstPersonPronoun DIHAPUS — sudah ditangani
    //   via Positive Few-Shot Exemplars + prompt persona DB (Phase 1 & 3.2)
    // - Hanya pertahankan sanitizer non-mutilasi: STR mention & followUp greeting minimal
    text = OutputSanitizer.sanitizeUnpromptedStrMention(text, customerInput);
    text = OutputSanitizer.sanitizeFollowUpGreetingRepetition(text, isFollowUp);
    text = OutputSanitizer.truncateToMaxChars(text, OutputSanitizer.resolveMaxChars(maxCharsOrOpts));
    text = text.replace(/[^\S\r\n]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

    return text;
  }

  /**
   * Fallback deterministik: ubah sebutan "Bidan ber-STR aktif" menjadi
   * "Bidan kami", KECUALI customer eksplisit menanyakan kualifikasi bidan.
   */
  public static sanitizeUnpromptedStrMention(text: string, customerInput?: string): string {
    if (!text) return text;
    const isAskingQualification = !!customerInput && /(sertifikat|STR\b|legalitas|surat\s+tanda\s+registrasi|bidan\s+asli|terapis|yang\s+(menangani|mijat|mijit|nanganin|datang)|ditangani\s+(oleh\s+)?siapa|petugasnya)/i.test(customerInput);
    if (isAskingQualification) return text;
    return text
      .replace(/\boleh\s+Bidan\s+ber-STR\s+aktif\b/gi, 'oleh Bidan kami')
      .replace(/\bBidan\s+ber-STR\s+aktif\b/gi, 'Bidan kami');
  }

  /**
   * Resolusi plafon karakter tenant-aware (sesi 381894, keputusan user 1200/1500):
   * maxChars eksplisit > TenantPersona.max_chars_per_reply (DB, via getMaxCharsPerReply)
   * > default konteks-sadar (1500 katalog / 1200 umum). DB null/tak terbaca → default.
   */
  public static resolveMaxChars(
    maxCharsOrOpts?: number | { tenantId?: string; maxChars?: number; isCatalogContext?: boolean }
  ): number {
    if (typeof maxCharsOrOpts === 'number' && maxCharsOrOpts > 0) return maxCharsOrOpts;
    const opts = (typeof maxCharsOrOpts === 'object' && maxCharsOrOpts) ? maxCharsOrOpts : {};
    if (opts.maxChars && opts.maxChars > 0) return opts.maxChars;
    if (opts.tenantId) {
      try {
        const dbVal = getMaxCharsPerReply(opts.tenantId);
        if (typeof dbVal === 'number' && dbVal > 0) return dbVal;
      } catch (_) {
        // DB/cache belum termuat → jatuh ke default konteks-sadar di bawah.
      }
    }
    return opts.isCatalogContext ? OutputSanitizer.CATALOG_MAX_CHARS : OutputSanitizer.DEFAULT_MAX_CHARS;
  }

  /**
   * Hanging-header detector (sesi 381894): kandidat potongan yang berakhiran titik
   * dua, tanda hubung, kata sambung, atau frasa pengantar daftar DILARANG dipakai
   * sebagai titik potong (meninggalkan kalimat menggantung seperti
   * "Untuk treatment, ada beberapa pilihan menarik untuk si kecil:").
   */
  private static isHangingEnding(candidate: string): boolean {
    const t = (candidate || '').trimEnd();
    if (!t) return true;
    if (/[:\-–—]$/.test(t)) return true;
    if (/\b(dan|atau|yang|untuk|dengan|adalah|yaitu|yakni|seperti|antara)$/i.test(t)) return true;
    if (/(untuk si kecil|berikut rincian|pilihan treatment|pilihan menarik|pilihan (lainnya|paket)|daftar (harga|paket)|pricelist|rinciannya|pilihannya apa)\s*:?\s*$/i.test(t)) return true;
    return false;
  }

  /**
   * Akhir item daftar bernomor terakhir yang lengkap sebelum batas: cari start item
   * bernomor terakhir ("\n1. ", "\n2. ", ...) lalu kembalikan indeks akhir kalimat
   * (./!? atau emoji penutup) pertama setelahnya. Null bila tak ada.
   */
  private static findLastCompleteListItemEnd(rawSlice: string): number {
    const startRe = /\n\s*\d+\.\s/g;
    let m: RegExpExecArray | null;
    let lastStart = -1;
    while ((m = startRe.exec(rawSlice)) !== null) {
      lastStart = m.index;
    }
    if (lastStart < 0) return -1;
    const tail = rawSlice.slice(lastStart);
    const punctRe = /[.!?]/g;
    let pm: RegExpExecArray | null;
    let endRel = -1;
    while ((pm = punctRe.exec(tail)) !== null) {
      const idx = pm.index;
      const ch = pm[0];
      if (ch === '.') {
        const prev = idx > 0 ? tail[idx - 1] : '';
        const next = idx + 1 < tail.length ? tail[idx + 1] : '';
        const prevIsLetter = /[a-zA-Z\u00C0-\u024F]/.test(prev);
        const nextIsBoundary = next === '' || next === ' ' || next === '\n' || next === '\r' || next === '\t';
        if (!prevIsLetter || !nextIsBoundary) continue;
      }
      endRel = idx;
    }
    if (endRel > 0) return lastStart + endRel;
    const emojiRe = /[\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+(?=\s|\n|$)/gu;
    let em: RegExpExecArray | null;
    let emojiEnd = -1;
    while ((em = emojiRe.exec(tail)) !== null) {
      emojiEnd = lastStart + em.index + em[0].length - 1;
    }
    return emojiEnd;
  }

  /**
   * Memotong teks secara elegan di batas kalimat terakhir sebelum maxChars
   * (default 1200; konteks katalog 1500 — Tie-break tenant-aware via resolveMaxChars).
   * Prioritas: 1) batas paragraf (toleran blank-line ber-spasi, anti hanging-header),
   * 2) akhir item daftar bernomor lengkap, 3) akhir kalimat (./!? atau emoji), 4) spasi.
   */
  public static truncateToMaxChars(text: string, maxChars: number = 1200): string {
    if (!text || text.length <= maxChars) return text;
    const rawSlice = text.slice(0, maxChars);
    // 1. Prioritas Utama: pemisah paragraf ganda terdekat (toleran "\n   \n").
    // Kumpulkan semua break, iterasi dari terakhir; tolak yang hanging.
    const breakRe = /\n\s*\n/g;
    const breaks: number[] = [];
    let bm: RegExpExecArray | null;
    while ((bm = breakRe.exec(rawSlice)) !== null) {
      breaks.push(bm.index);
    }
    let hangingSeen = false;
    for (let i = breaks.length - 1; i >= 0; i--) {
      const idx = breaks[i];
      if (idx <= 100) continue;
      const candidate = rawSlice.slice(0, idx).trimEnd();
      if (OutputSanitizer.isHangingEnding(candidate)) {
        hangingSeen = true;
        continue;
      }
      return candidate;
    }
    // 1b. Bila break terakhir menggantung di kepala daftar bernomor (sesi 381894),
    // jangan mundur ke pra-header (membuang seluruh katalog) — potong di akhir
    // item bernomor lengkap terakhir sebagai gantinya.
    if (hangingSeen && /\n\s*\d+\.\s/.test(rawSlice)) {
      const itemEnd = OutputSanitizer.findLastCompleteListItemEnd(rawSlice);
      if (itemEnd > 100) {
        return rawSlice.slice(0, itemEnd + 1).trimEnd();
      }
    }
    // 2. Prioritas Kedua: cari akhir kalimat valid (./!? ATAU emoji penutup diikuti spasi/newline)
    let lastSentenceEnd = -1;
    const punctRe = /[.!?]/g;
    let m: RegExpExecArray | null;
    while ((m = punctRe.exec(rawSlice)) !== null) {
      const idx = m.index;
      const ch = m[0];
      if (ch === '.') {
        const prev = idx > 0 ? rawSlice[idx - 1] : '';
        const next = idx + 1 < rawSlice.length ? rawSlice[idx + 1] : '';
        const prevIsLetter = /[a-zA-Z\u00C0-\u024F]/.test(prev);
        const nextIsBoundary = next === '' || next === ' ' || next === '\n' || next === '\r' || next === '\t';
        if (!prevIsLetter || !nextIsBoundary) continue;
      }
      lastSentenceEnd = idx;
    }
    // Emoji penutup sebagai batas kalimat (mis. "Bunda 😊\n\nApakah...")
    const emojiRe = /[\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+(?=\s|\n|$)/gu;
    let em: RegExpExecArray | null;
    while ((em = emojiRe.exec(rawSlice)) !== null) {
      const endIdx = em.index + em[0].length - 1;
      if (endIdx > lastSentenceEnd) lastSentenceEnd = endIdx;
    }
    if (lastSentenceEnd > 0) {
      return rawSlice.slice(0, lastSentenceEnd + 1).trimEnd();
    }
    // 3. Fallback: potong di spasi terakhir agar tidak memutus kata di tengah
    const lastSpace = rawSlice.lastIndexOf(' ');
    if (lastSpace > 0) {
      return rawSlice.slice(0, lastSpace).trimEnd();
    }
    return rawSlice.trimEnd();
  }

  /**
   * Menghilangkan sisa-sisa istilah bahasa Inggris.
   *
   * @deprecated Dikeluarkan dari pipeline cleanOutboundReply (ditangani via
   * Few-Shot Exemplars + prompt persona). Dipertahankan sebagai wrapper publik
   * karena dicakup unit test (v3-persona-rules.test.ts) & impor historis.
   */
  public static stripEnglishLeakage(text: string): string {
    if (!text) return '';
    return text
      .replace(/\s*\(full\s+body\s+massage[^)]*\)/gi, '')
      .replace(/\bfull\s+body\s+massage(\s+bayi)?\b/gi, 'pijat seluruh badan')
      .replace(/\bhomecare\s+treatment\b/gi, 'layanan Homecare')
      .replace(/\bappointment(-nya)?\b/gi, 'jadwal reservasi')
      .replace(/\bschedule(-nya)?\b/gi, 'jadwal')
      .replace(/\blittle\s+one\b/gi, 'si kecil')
      .replace(/\bmommy\b/gi, 'Bunda');
  }

  /**
   * Mengoreksi penggunaan kata ganti klinik (saya/aku → kami).
   * Catatan: grup verba dibuat capturing agar 'kami $1' menyimpan kata kerja,
   * bukan literal "$1" (grup non-capturing tidak mengisi $1).
   *
   * @deprecated Dikeluarkan dari pipeline cleanOutboundReply (ditangani via
   * Few-Shot Exemplars + prompt persona). Dipertahankan sebagai wrapper publik
   * karena dicakup unit test (v3-persona-rules.test.ts) & impor historis.
   */
  public static sanitizeFirstPersonPronoun(text: string): string {
    if (!text) return '';
    // Ganti "Ada yang bisa saya bantu" -> "Ada yang bisa kami bantu"
    // Ganti "saya sarankan" -> "kami sarankan"
    return text
      .replace(/\bAda\s+yang\s+bisa\s+saya\s+bantu\b/gi, 'Ada yang bisa kami bantu')
      .replace(/\b(?:saya|aku)\s+(bantu|sarankan|cekkan|rekomendasikan)\b/gi, 'kami $1');
  }

  /**
   * Multi-turn anti-repetition guardrail (Phase 4 minimal):
   * HANYA memotong sapaan duplikat bila pesan terdiri dari >=2 paragraf
   * dan paragraf pertama murni sapaan pembuka Turn-0 (bukan regex global).
   * Menangani kasus emot memecah "Halo Bunda! ✨ Terima kasih..." menjadi 2 paragraf.
   */
  public static sanitizeFollowUpGreetingRepetition(text: string, isFollowUp: boolean = false): string {
    if (!text || !isFollowUp) return text;
    let paragraphs = text.split(/\n\s*\n/);
    if (paragraphs.length < 2) return text;
    const isGreetingPara = (p: string): boolean => {
      const t = p.trim().toLowerCase();
      return (
        /^(halo|hai|hei|hey)\s+(bunda|bun|kak|min)\b/.test(t) ||
        /^selamat\s+(pagi|siang|sore|malam)\b/.test(t) ||
        /^terima\s+kasih\s+sudah\s+menghubungi/.test(t) ||
        /^perkenalkan,\s+saya\s+bidan\s+yusi/.test(t)
      );
    };
    // Hapus berurutan semua paragraf awal yang murni sapaan (handle emot split)
    let cut = 0;
    while (cut < paragraphs.length - 1 && isGreetingPara(paragraphs[cut])) {
      cut++;
    }
    if (cut > 0) {
      return paragraphs.slice(cut).join('\n\n').trim();
    }
    return text;
  }

  /**
   * Validasi kelayakan balasan: apakah teks cukup panjang dan bermakna.
   */
  public static isValidReply(text: string): boolean {
    if (!text || text.trim().length < 5) return false;
    
    // Tolak jika balasan hanya berisi karakter tunggal atau artefak (misal: "S", ".", "ok")
    const cleaned = text.trim().toLowerCase();
    if (/^[a-z0-9.?!,\s]{1,4}$/i.test(cleaned)) return false;

    // Tolak jika teks masih mengandung kata-kata instruksi sistem
    if (/^(?:kita perlu menyusun|analisis konteks|instruksi prompt)/i.test(cleaned)) {
      return false;
    }

    return true;
  }
}
