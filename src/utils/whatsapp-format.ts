/**
 * whatsapp-format.ts — Normalisasi format teks agar sesuai formatting WhatsApp.
 *
 * WhatsApp hanya mengenal SATU tanda per gaya, sedangkan model LLM cenderung
 * meniru Markdown GANDA (`**tebal**`) karena prompt/internal default memakainya.
 * Normalizer ini mengonversi sintaks Markdown menjadi formatting WhatsApp:
 *   **teks**  -> *teks*   (bold)
 *   __teks__  -> _teks_   (italic)
 *   ~~teks~~  -> ~teks~   (strikethrough)
 *
 * Tidak menyentuh teks yang sudah pakai format WA tunggal (*teks*), angka,
 * URL, atau emoji.
 */

const DOUBLE_TO_SINGLE: Array<[RegExp, string]> = [
  // **bold** -> *bold*  (hindari mengubah **/ yang merupakan bagian kata, mis. "d**c**")
  [/\*\*([^*]+?)\*\*/g, '*$1*'],
  // __italic__ -> _italic_
  [/__([^_]+?)__/g, '_$1_'],
  // ~~strike~~ -> ~strike~
  [/~~([^~]+?)~~/g, '~$1~'],
];

export function normalizeWhatsAppFormat(text: string): string {
  if (!text) return text;
  let out = text;
  for (const [re, replacement] of DOUBLE_TO_SINGLE) {
    out = out.replace(re, replacement);
  }
  return out;
}
