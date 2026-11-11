/**
 * C-007: `specificTreatmentName` dari argumen tool hanya sah bila nama itu
 * benar-benar muncul di pesan user TURN INI. Riwayat chat sering memuat nama
 * layanan dari asisten/rekomendasi lama — itu BUKAN pilihan customer.
 *
 * Murni & deterministik (tanpa regex kalimat bisnis; hanya normalisasi token).
 */
const GENERIC_TREATMENT_WORDS = new Set([
  'pijat', 'massage', 'spa', 'terapi', 'treatment', 'layanan', 'paket',
  'bayi', 'baby', 'anak', 'kids', 'moms', 'ibu', 'bund', 'bunda',
]);

function normalize(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isSpecificTreatmentNameGrounded(
  name: string | undefined | null,
  incomingText: string | undefined | null
): boolean {
  const trimmed = String(name || '').trim();
  if (!trimmed) return false;
  const hay = normalize(incomingText || '');
  if (!hay) return false;

  const needle = normalize(trimmed);
  if (!needle) return false;
  const sigTokens = needle
    .split(' ')
    .filter((t) => t.length >= 3 && !GENERIC_TREATMENT_WORDS.has(t));
  // Nama generik murni ("Pijat", "Paket Bayi") tidak boleh mengunci katalog.
  if (sigTokens.length === 0) return false;
  return hay.includes(needle) || sigTokens.every((tok) => hay.includes(tok));
}
