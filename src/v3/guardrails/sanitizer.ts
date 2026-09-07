export class OutputSanitizer {
  /**
   * Membersihkan tag thinking, monolog internal, dan artefak AI dari balasan sebelum dikirim ke WhatsApp.
   */
  public static cleanOutboundReply(rawText: string, customerInput?: string, isFollowUp: boolean = false): string {
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

    // 6. Normalisasi spasi dan baris baru berlebih
    text = text.replace(/\n{3,}/g, '\n\n').trim();

    // 7. Guardrail aturan emas klinik (deterministik, tanpa LLM).
    // AI-FIRST: tidak ada pemotongan nominal/kata di tengah kalimat di sini
    // (lihat Minimal-Regex Mandate). Kendali harga hidup di hulu: prompt
    // persona + grounding tool get_catalog_and_price (inquirePrice).
    text = OutputSanitizer.stripEnglishLeakage(text);
    text = OutputSanitizer.sanitizeFirstPersonPronoun(text);
    text = OutputSanitizer.sanitizeUnpromptedStrMention(text, customerInput);
    text = OutputSanitizer.sanitizeFollowUpGreetingRepetition(text, isFollowUp);
    text = OutputSanitizer.truncateToMaxChars(text, 500);
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
   * Memotong teks secara elegan di batas kalimat terakhir sebelum maxChars (default 500).
   */
  public static truncateToMaxChars(text: string, maxChars: number = 500): string {
    if (!text || text.length <= maxChars) return text;
    const rawSlice = text.slice(0, maxChars);
    // Cari akhir kalimat yang valid: titik WAJIB didahului huruf kata (bukan angka —
    // titik pada nomor daftar "3." atau desimal "70.000" BUKAN akhir kalimat) dan
    // diikuti spasi/newline/akhir teks. Tanda ! dan ? selalu valid.
    let lastSentenceEnd = -1;
    const punctRe = /[.!?]/g;
    let m: RegExpExecArray | null;
    while ((m = punctRe.exec(rawSlice)) !== null) {
      const idx = m.index;
      const ch = m[0];
      if (ch === '.' ) {
        const prev = idx > 0 ? rawSlice[idx - 1] : '';
        const next = idx + 1 < rawSlice.length ? rawSlice[idx + 1] : '';
        const prevIsLetter = /[a-zA-Z\u00C0-\u024F]/.test(prev);
        const nextIsBoundary = next === '' || next === ' ' || next === '\n' || next === '\r' || next === '\t';
        if (!prevIsLetter || !nextIsBoundary) continue;
      }
      lastSentenceEnd = idx;
    }
    if (lastSentenceEnd > 0) {
      return rawSlice.slice(0, lastSentenceEnd + 1).trimEnd();
    }
    // Fallback: potong di spasi terakhir agar tidak memutus kata di tengah
    const lastSpace = rawSlice.lastIndexOf(' ');
    if (lastSpace > 0) {
      return rawSlice.slice(0, lastSpace).trimEnd();
    }
    return rawSlice.trimEnd();
  }

  /**
   * Menghilangkan sisa-sisa istilah bahasa Inggris.
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
   * Multi-turn anti-repetition guardrail: pada chat lanjutan (isFollowUp=true),
   * potong deterministik seluruh varian sapaan pembuka & perkenalan diri Turn-0
   * agar bot langsung menjawab inti pesan tanpa mengulang "Halo Bunda" /
   * "Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi...".
   */
  public static sanitizeFollowUpGreetingRepetition(text: string, isFollowUp: boolean = false): string {
    if (!text || !isFollowUp) return text;
    let cleaned = text;
    // Varian pembuka formal di awal balasan
    cleaned = cleaned.replace(/^(?:halo|hai|hei|hey)\s+(?:bunda|bun|kak|min)\s*[!✨🥰🌸\.,\s]*/i, '');
    cleaned = cleaned.replace(/^selamat\s+(?:pagi|siang|sore|malam)(?:\s+(?:bunda|bun|kak|min))?\s*[!✨🥰🌸\.,\s]*/i, '');
    // Varian perkenalan diri redundan (terima kasih + perkenalkan)
    cleaned = cleaned.replace(/^(?:terima\s+kasih\s+sudah\s+menghubungi\s+kami[.,\s✨🌸]*)(?:perkenalkan,\s+saya\s+bidan\s+yusi[^.!?\n]*[.!?\n]*)?/i, '');
    // Varian perkenalan langsung
    cleaned = cleaned.replace(/^perkenalkan,\s+saya\s+bidan\s+yusi[^.!?\n]*[.!?\n]*/i, '');
    // Sisa sapaan "Halo Bunda" yang terselip tepat di awal setelah strip pertama
    cleaned = cleaned.replace(/^(?:halo|hai)\s*[!✨🥰🌸\.,\s]*/i, '');
    return cleaned.trim();
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
