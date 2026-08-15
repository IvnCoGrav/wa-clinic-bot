/**
 * transport-policy-checker.ts
 * Deteksi apakah customer sedang menanyakan kebijakan biaya transport/ongkir
 * untuk multi-anak, multi-orang, atau per kedatangan/kunjungan.
 */

export function isMultiChildTransportQuestion(userText: string): boolean {
  if (!userText || typeof userText !== 'string') return false;
  const lower = userText.toLowerCase().trim();

  // Kata kunci terkait transport / ongkir / biaya jalan
  const hasTransportKeyword = /\b(transport|transportnya|ongkir|ongkirnya|ongkos|ongkosnya|biaya\s+transport|biaya\s+ongkir|tarif\s+transport|tarif\s+ongkir)\b/i.test(lower);
  if (!hasTransportKeyword) return false;

  // Kata kunci multi-anak / multi-orang / per kunjungan / per sesi / konfirmasi 1 kali
  const hasMultiOrVisitContext =
    /\b(2|dua|3|tiga|beberapa|kedua|keduanya|dua-duanya|sekaligus|bareng|bersama)\s+(anak|bayi|si\s+kecil|balita|treatment|orang|paket)\b/i.test(lower) ||
    /\b(anak|bayi|treatment)\s+(ke\s*2|kedua|dua)\b/i.test(lower) ||
    /\b(per\s+(anak|orang|kepala|kunjungan|kedatangan|alamat|sesi|visit))\b/i.test(lower) ||
    /\b(transport(nya)?|ongkir(nya)?)\s*(dihitung|kena|bayar)?\s*(1|satu|1x|sekali|2x|dua\s*kali)?\s*kan\b/i.test(lower) ||
    /\b(bunda\s*(dan|sama|\+)\s*(anak|bayi|si\s+kecil))\b/i.test(lower) ||
    /\b(untuk|buat|kalo|kalau)\s+(2|dua)\s+(anak|bayi)\b/i.test(lower);

  return hasMultiOrVisitContext;
}
