/**
 * pin-coordinates.ts — Ekstraksi koordinat pin/GPS dari teks (murni, non-semantik).
 *
 * Modul BEBAS DEPENDENSI (tanpa impor apa pun) agar dapat dipakai bersama oleh
 * `tool-masker` (membuka calculate_delivery) DAN `calculate-delivery.tool`
 * (Phase 0b) TANPA circular import (`tool-masker` → `tool-registry` →
 * `calculate-delivery.tool`). Format yang dikenali:
 *   - Kanonis WhatsApp: "[LOCATION: Lat -7.33..., Lng 112.68...]"
 *   - Live location:    "[LIVE_LOCATION: Lat ..., Lng ...]"
 *   - Pin V3 machine:   "[Shared Location: -7.331..., 112.686...]"
 *   - Koordinat telanjang berdesimal.
 * DILARANG salah-tembak pasangan bilangan bulat/harga ("jam 10, 11",
 * "75.000, 100.000").
 */
export function extractPinCoordinates(text: string | undefined): { lat: number; lng: number } | null {
  const t = text || '';
  // A. Label teknis mesin Lat/Lng (format kanonis normalizer).
  const labelled = t.match(/lat\s*[:\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(?:lng\s*[:\s]*)?(-?\d{1,3}(?:\.\d+)?)/i);
  if (labelled) {
    const lat = parseFloat(labelled[1]);
    const lng = parseFloat(labelled[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }
  // B. Koordinat telanjang HANYA bila KEDUA angka berdesimal DAN tanpa sinyal
  //    harga/rupiah — mencegah "75.000, 100.000" atau "jam 10, 11".
  const hasPriceSignal = /\b(rp|rupiah|ribu|rb\b|juta|jt|total|bayar|harga|tarif)\b/i.test(t);
  const bare = t.match(/(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
  if (bare && !hasPriceSignal) {
    const lat = parseFloat(bare[1]);
    const lng = parseFloat(bare[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  return null;
}
