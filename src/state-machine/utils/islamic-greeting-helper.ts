/**
 * islamic-greeting-helper.ts
 * Helper untuk mendeteksi salam Islami (Assalamualaikum dsb) dari customer
 * dan memastikan bot WAJIB menjawab dengan "Waalaikumsalam Bunda" di awal respon.
 */

// Pola variasi salam Islami
const ISLAMIC_GREETING_RE = /\b(assalamu'?alaikum|assalamu\s*alaikum|as-salamu\s*alaykum|assalamu'alaikum\s*wr\.?\s*wb\.?|assalamualaikum\s*wr\.?\s*wb\.?|ass\.?\s*wr\.?\s*wb\.?|asslm|aslm|mikum)\b/i;

/**
 * Cek apakah teks pesan customer mengandung sapaan Assalamualaikum / variasi salam Islami.
 */
export function hasIslamicGreeting(text?: string | null): boolean {
  if (!text || typeof text !== 'string') return false;
  return ISLAMIC_GREETING_RE.test(text.trim());
}

/**
 * Memastikan jika customer mengucapkan Assalamualaikum, balasan bot WAJIB diawali Waalaikumsalam.
 */
export function formatIslamicReply(replyText: string, userText?: string | null): string {
  if (!replyText || !hasIslamicGreeting(userText)) {
    return replyText;
  }

  const trimmed = replyText.trim();

  // Jika balasan sudah diawali dengan Waalaikumsalam, pertahankan
  if (/^wa'?alaikum\s*salam/i.test(trimmed)) {
    return replyText;
  }

  // Jika balasan diawali dengan "Halo Bunda", ganti menjadi "Waalaikumsalam Bunda"
  if (/^(halo|hai|hallo)\s+(bunda|bund)\b/i.test(trimmed)) {
    return trimmed.replace(/^(halo|hai|hallo)\s+(bunda|bund)\b/i, 'Waalaikumsalam Bunda');
  }

  // Jika balasan diawali dengan "Halo Bunda !" atau variasi tanda baca
  if (/^(halo|hai|hallo)\s+(bunda|bund)\s*[!.,✨]*/i.test(trimmed)) {
    return trimmed.replace(/^(halo|hai|hallo)\s+(bunda|bund)\s*[!.,✨]*/i, 'Waalaikumsalam Bunda ! ✨');
  }

  // Jika balasan diawali dengan "Halo!", ganti jadi "Waalaikumsalam Bunda!"
  if (/^(halo|hai|hallo)\s*[!.,✨]*/i.test(trimmed)) {
    return trimmed.replace(/^(halo|hai|hallo)\s*[!.,✨]*/i, 'Waalaikumsalam Bunda ! ✨\n\n');
  }

  // Default: letakkan "Waalaikumsalam Bunda ! ✨\n\n" di paling awal
  return `Waalaikumsalam Bunda ! ✨\n\n${trimmed}`;
}
