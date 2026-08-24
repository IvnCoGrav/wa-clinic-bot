/**
 * need-time-checker.ts
 * Mendeteksi pesan customer yang meminta jeda waktu, izin berdiskusi dengan suami/keluarga,
 * atau berjanji akan mengabari lagi nanti (Hold / Need Time / Discussing).
 *
 * Contoh pesan:
 * - "Oke sbntr sy coba tnykan ya"
 * - "sebentar ya tanya suami dulu"
 * - "nanti saya kabari lagi ya"
 * - "rembukan dulu sama keluarga"
 * - "pikir-pikir dulu ya mbak"
 * - "sbntr ya bund"
 */

export function isNeedTimeOrDiscussionMessage(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase().trim();

  // Pola 1: Minta waktu / tunggu / nanti dikabari / tanyakan dulu (termasuk slang & singkatan)
  // Contoh: "Oke sbntr sy coba tnykan ya", "sbntr ya tanya dulu", "sebentar ya bunda", "ntar dlu ya", "nnti ak kbrin lg"
  if (/\b(sbntr|sebentar|bntr|bentar|tunggu|nanti|ntar|nnti)\b.*\b(tnykan|tanyakan|tanya|tny|diskusi|rembuk|kabari|kabarin|kbrin|info|infokan|infoin|cek|lihat|liat|pikir|mikir|pikirkan|dulu|dl|dlu|lg|lagi)\b/i.test(lower)) {
    return true;
  }

  // Pola 2: Mau tanya/ngomong ke orang lain (suami, keluarga, dll)
  // Contoh: "tanya suami dulu ya", "mau rembukan sama ayah", "sy tny paksu dl", "rembukan dl sm keluarga"
  if (/\b(tanya|tanyakan|tny|ngomong|bicara|diskusi|rembuk|rembukan|musyawarah|izin|runding)\s+(dulu\s+|dl\s+|dlu\s+)?(ke\s+|sama\s+|dgn\s+|dengan\s+|sm\s+)?(suami|ayah|papa|bapak|keluarga|ortu|orang\s*tua|mertua|istri|ibu|nenek|paksu)\b/i.test(lower)) {
    return true;
  }

  // Pola 3: Janji mengabari nanti
  // Contoh: "nanti saya kabari lagi ya", "ntar dikabarin lg", "nanti saya info lagi ya", "nnti ak kbrin lg y"
  if (/\b(nanti|ntar|nnti|besok|kapan-kapan|nanti\s+lagi)\s+(saya|sy|aku|ak|kami)?\s*(kabari|kabarin|kbrin|infoin|infokan|hubungi|chat|wa|kasih\s+tau|kabari\s+lagi|info\s+lagi)\b/i.test(lower)) {
    return true;
  }

  // Pola 4: Masih mempertimbangkan / cek jadwal / hold / mikir
  // Contoh: "pikir-pikir dulu ya", "pikir2 dulu", "pertimbangkan dulu", "cek jadwal dulu", "lihat jadwal dulu", "hold dulu ya", "masih mikir"
  if (/\b(pikir[-2\s]*pikir|pikir2|mikir|pertimbangkan|pertimbangin|cek\s+jadwal|lihat\s+jadwal|liat\s+jadwal|tanya\s+dulu|diskusi\s+dulu|rembukan\s+dulu|hold\s+(dulu|dlu|dl)|pending\s+(dulu|dlu|dl))\b/i.test(lower)) {
    return true;
  }

  // Pola 5: Frasa singkat jeda
  // Contoh: "sbntr ya", "sebentar ya kak", "tunggu sebentar ya bund", "oke sebentar ya", "bentar ya mikir", "bntr ya bund", "ntar dlu"
  if (/^(oke\s+|ya\s+|baik\s+|ok\s+)?(sbntr|sebentar|bentar|bntr|tunggu|nanti|ntar|nnti)(\s+(dulu|dlu|dl|ya|yaa|bund|bunda|kak|mbak|min|deh|y|[.!?]))*$/i.test(lower) ||
      /\b(bentar|bntr|sebentar)\s+ya\s+(masih\s+)?mikir\b/i.test(lower)) {
    return true;
  }

  return false;
}
