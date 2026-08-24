/**
 * clinic-location-checker.ts
 * Mendeteksi pesan customer yang menanyakan lokasi / asal / homebase klinik atau bidan.
 *
 * Contoh:
 * - "Saya dari surabaya timur kak. Kalo boleh tau kakaknya darimana kak?"
 * - "kakaknya darimana ya"
 * - "lokasi kliniknya dimana?"
 * - "posisi kliniknya dimana?"
 * - "homebase nya dimana?"
 * - "bidan yusi dari mana?"
 * - "alamat kantornya dimana?"
 * - "klinik kala di daerah mana?"
 */

export function isAskingClinicLocation(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase().trim();

  // Guard: "mana yang cocok", "treatment mana yang bagus" adalah pemilihan treatment, BUKAN tanya lokasi klinik!
  if (/\b(mana\s+yang\s+(cocok|bagus|bisa|pas|direkomendasikan|enak|dipilih))\b/i.test(lower) ||
      /\b(paket|treatment|perawatan)\s+mana\b/i.test(lower)) {
    return false;
  }

  // Pertanyaan langsung tentang lokasi klinik/spa/kantor
  const directClinicLocationQuestion =
    /\b(lokasi|alamat|posisi|tempat|kantor|homebase|basecamp)\s+(klinik|kala|spa|homecare|praktek|praktik|cabang)\b/i.test(lower) ||
    /\b(klinik|kala|spa|homecare|praktek|praktik|cabang)\s+(lokasi|alamat|posisi|tempat|kantor|di\s+mana|dimana|daerah\s+mana|daerah\s+apa)\b/i.test(lower) ||
    /\b(homebase|basecamp|kantor(nya)?|lokasi\s+kantor|alamat\s+kantor)\s+(nya\s+)?(di\s*mana|dimana|daerah\s+mana)\b/i.test(lower) ||
    /\b(kakak|kakaknya|mbak|mbaknya|bidan|bubid|yusi|admin)\s+(dari\s*mana|darimana|posisinya\s+di\s+mana|lokasinya\s+di\s+mana|tinggalnya\s+di\s+mana)\b/i.test(lower) ||
    /\b(kakak|kakaknya|mbak|mbaknya|bidan|bubid|admin)\s+darimana\b/i.test(lower) ||
    /\bdari\s+mana\s+(kakak|mbak|bidan|klinik)\b/i.test(lower) ||
    /\bdarimana\s+(kakak|mbak|bidan|klinik)\b/i.test(lower);

  if (directClinicLocationQuestion) return true;

  // Pertanyaan lokasi yang menargetkan pihak klinik/bidan
  const asksOriginOrLocation =
    /\b(darimana|dari\s+mana|dimana|di\s+mana|daerah\s+mana|posisi\s+mana|alamat(nya)?|lokasi(nya)?|kantor(nya)?|basecamp|homebase)\b/i.test(lower);

  const targetsClinicOrMidwife =
    /\b(kakak|kakaknya|mbak|mbaknya|bidan|bubid|bidannya|klinik|kliniknya|kala|kamu|admin|kalian|pihak\s+klinik)\b/i.test(lower);

  return Boolean(asksOriginOrLocation && targetsClinicOrMidwife);
}
