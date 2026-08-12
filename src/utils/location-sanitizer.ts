/**
 * location-sanitizer.ts
 * Helper untuk membersihkan teks lokasi dari kata-kata sapaan, pertanyaan, dan inquiry harga/ongkir
 * sebelum dikirimkan ke layanan Geocoding (Google Maps / ORS).
 */

export function sanitizeLocationTextForGeocoding(text: string): string {
  if (!text) return '';

  let cleaned = text.trim();

  // 1. Buang kata pembuka/awalan lokasi
  cleaned = cleaned.replace(/^(saya\s+)?(di|ke|alamat\s*(saya|sy)?\s*di|rumah\s*(saya|sy)?\s*di|daerah|posisi\s*(saya|sy)?\s*di)\s+/i, '');

  // 2. Buang frasa pertanyaan harga/ongkir yang sering menyatu dengan nama lokasi
  // Contoh: "Food junction tandes sby berapa ongkir bubid" -> "Food junction tandes sby"
  cleaned = cleaned
    .replace(/\b(berapa\s+ongkir(nya)?|berapa\s+harganya|berapa\s+biayanya|berapa\s+tarifnya|berapa\s+ongkosnya|berapa\s+harganya\s+ya|berapa\s+ongkirnya\s+ya)\b/gi, '')
    .replace(/\b(ongkirnya|ongkir|harganya|tarifnya|biayanya|ongkosnya|pricelists?|promos?)\b/gi, '')
    .replace(/\b(berapa|brp|apakah|gimana|bagaimana)\b/gi, '');

  // 3. Buang kata sapaan/sebutan panggilan (callwords) dan instruksi di awal/akhir
  cleaned = cleaned
    .replace(/\b(bubid|bu\s*bidan|bidan|yusi|kak|min|bund|bunda|gan|sis|ya|kah|dong|tolong|cek|cekkan|tanyakan|tanya)\b/gi, '');

  // 4. Bersihkan spasi ganda dan karakter penyambung sisa
  cleaned = cleaned.replace(/\s+/g, ' ').replace(/^[,.\s-]+|[,.\s-]+$/g, '').trim();

  return cleaned;
}
