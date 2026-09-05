/**
 * Utilitas untuk mendeteksi apakah pesan merupakan pertanyaan tentang lokasi klinik
 * (bukan pemberian alamat tempat tinggal customer).
 * Dipisahkan dari slot-engine agar dapat digunakan secara independen oleh Geocoding
 * dan Human Background Enrichment Service.
 */

const QUESTION_LEAD_RE = /^(?:dimana|di\s*mana|dmana|mana|mna|mn|apa|apakah|yg\s+mana|yang\s+mana|sebelah\s+mana)\b/i;
const CLINIC_LOCATION_QUESTION_RE = /\b(?:tanya|mau\s+tanya|pengen\s+tanya|nanya|mau\s+nanya)\b.*?\b(?:lokasi|alamat|klinik|tempat)(?:nya|ku|mu)?\b/i;
const LOCATION_QUESTION_PHRASE_RE = /\b(?:lokasi|alamat|klinik|tempat)(?:nya)?\s*(?:di\s*)?(?:mana|mn|mna|dmana|dimana)\b/i;

/**
 * True jika teks adalah pertanyaan tentang lokasi klinik (bukan pemberian alamat).
 */
export function isClinicLocationQuestion(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase().trim();
  if (!lower) return false;
  if (QUESTION_LEAD_RE.test(lower)) return true;
  if (CLINIC_LOCATION_QUESTION_RE.test(lower)) return true;
  if (LOCATION_QUESTION_PHRASE_RE.test(lower)) return true;
  return false;
}
