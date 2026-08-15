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

  // Pola 1: Minta waktu / tunggu / nanti dikabari / tanyakan dulu
  // Contoh: "Oke sbntr sy coba tnykan ya", "sbntr ya tanya dulu", "sebentar ya bunda"
  if (/\b(sbntr|sebentar|tunggu|nanti|ntar)\b.*\b(tnykan|tanyakan|tanya|diskusi|rembuk|kabari|kabarin|info|infokan|cek|lihat|liat|pikir|pikirkan|dulu|dl)\b/i.test(lower)) {
    return true;
  }

  // Pola 2: Mau tanya/ngomong ke orang lain (suami, keluarga, dll)
  // Contoh: "tanya suami dulu ya", "mau rembukan sama ayah", "diskusi sama keluarga dulu"
  if (/\b(tanya|tanyakan|ngomong|bicara|diskusi|rembuk|musyawarah|izin|runding)\s+(ke\s+|sama\s+|dgn\s+|dengan\s+)?(suami|ayah|papa|bapak|keluarga|ortu|orang\s*tua|mertua|istri|ibu|nenek|paksu)\b/i.test(lower)) {
    return true;
  }

  // Pola 3: Janji mengabari nanti
  // Contoh: "nanti saya kabari lagi ya", "ntar dikabarin lg", "nanti saya info lagi ya"
  if (/\b(nanti|ntar|besok|kapan-kapan|nanti\s+lagi)\s+(saya|sy|aku|kami)?\s*(kabari|kabarin|infoin|infokan|hubungi|chat|wa|kasih\s+tau|kabari\s+lagi|info\s+lagi)\b/i.test(lower)) {
    return true;
  }

  // Pola 4: Masih mempertimbangkan / cek jadwal
  // Contoh: "pikir-pikir dulu ya", "pikir2 dulu", "pertimbangkan dulu", "cek jadwal dulu", "lihat jadwal dulu"
  if (/\b(pikir[-2\s]*pikir|pikir2|pertimbangkan|pertimbangin|cek\s+jadwal|lihat\s+jadwal|liat\s+jadwal|tanya\s+dulu|diskusi\s+dulu|rembukan\s+dulu)\b/i.test(lower)) {
    return true;
  }

  // Pola 5: Frasa singkat jeda
  // Contoh: "sbntr ya", "sebentar ya kak", "tunggu sebentar ya bund", "oke sebentar ya"
  if (/^(oke\s+|ya\s+|baik\s+)?(sbntr|sebentar|tunggu|nanti|ntar)\s+(ya|yaa|dulu|bund|bunda|kak|mbak|min)?[.!]?$/i.test(lower)) {
    return true;
  }

  return false;
}
