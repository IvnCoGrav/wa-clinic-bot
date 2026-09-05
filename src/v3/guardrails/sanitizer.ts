export class OutputSanitizer {
  /**
   * Membersihkan tag thinking, monolog internal, dan artefak AI dari balasan sebelum dikirim ke WhatsApp.
   */
  public static cleanOutboundReply(rawText: string, customerInput?: string): string {
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

    // 7. Guardrail aturan emas klinik (deterministik, tanpa LLM)
    text = OutputSanitizer.stripEnglishLeakage(text);
    text = OutputSanitizer.sanitizeUnsolicitedPriceAndDuration(text, customerInput);
    text = OutputSanitizer.sanitizeFirstPersonPronoun(text);
    text = OutputSanitizer.truncateToMaxChars(text, 500);
    text = text.replace(/[^\S\r\n]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

    return text;
  }

  /**
   * Menyapu nominal harga & durasi jika customer tidak bertanya harga/durasi.
   */
  public static sanitizeUnsolicitedPriceAndDuration(text: string, customerInput?: string): string {
    if (!text || !customerInput) return text;
    // Cek apakah customer menyertakan kata tanya harga / durasi
    const isAskingPriceOrDuration = /\b(berapa|harga|harganya|tarif|tarifnya|biaya|biayanya|ongkir|ongkirnya|ongkos|pricelist|durasi|menit|lama|lamanya|waktu|jam|bayar)\b/i.test(customerInput);
    if (isAskingPriceOrDuration) {
      return text;
    }
    let cleaned = text;
    // Hapus frasa durasi menit
    cleaned = cleaned.replace(/(?:,\s*|\s+)(?:durasinya|durasi)?\s*(?:sekitar\s+)?\d+\s+menit\s*(?:dan\s+saat\s+ini\s+ada\s+promo)?/gi, '');
    // Hapus nominal harga promo & normal
    cleaned = cleaned.replace(/(?:,\s*|\s+)(?:dengan\s+)?(?:tarif|harga|biaya)?(?:\s+promo)?\s*(?:jadi\s+)?\*?Rp\s*[\d\.]+\*?(?:\s*saja)?(?:\s*\(harga\s+normal\s*\*?Rp\s*[\d\.]+\*?\))?/gi, '');
    // Hapus frasa tambahan moksa jika bocor
    cleaned = cleaned.replace(/(?:Sebagai\s+opsi\s+tambahan|Total\s+paket)[^.!?\n]*\*Rp\s*[\d\.]+\*[^.!?\n]*[.!?\n]*/gi, '');
    // Normalisasi spasi dan baris baru
    cleaned = cleaned.replace(/[^\S\r\n]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    return cleaned;
  }

  /**
   * Memotong teks secara elegan di batas kalimat terakhir sebelum maxChars (default 500).
   */
  public static truncateToMaxChars(text: string, maxChars: number = 500): string {
    if (!text || text.length <= maxChars) return text;
    const rawSlice = text.slice(0, maxChars);
    // Cari tanda baca akhir kalimat (. ! ?) terakhir sebelum limit
    const lastSentenceEnd = Math.max(
      rawSlice.lastIndexOf('.'),
      rawSlice.lastIndexOf('!'),
      rawSlice.lastIndexOf('?')
    );
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
      .replace(/\s*\(full\s+body\s+massage\)/gi, '')
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
