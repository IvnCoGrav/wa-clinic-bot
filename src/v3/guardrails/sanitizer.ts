export class OutputSanitizer {
  /**
   * Membersihkan tag thinking, monolog internal, dan artefak AI dari balasan sebelum dikirim ke WhatsApp.
   */
  public static cleanOutboundReply(rawText: string): string {
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
