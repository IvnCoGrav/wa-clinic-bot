/**
 * Sorensen-Dice Coefficient untuk mengukur tingkat kemiripan dua buah string (0.0 s/d 1.0).
 * Sangat berguna untuk mendeteksi typo pada ejaan nama kelurahan/kecamatan.
 */
export function getStringSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().replace(/\s+/g, '').trim();
  const s2 = str2.toLowerCase().replace(/\s+/g, '').trim();

  if (s1 === s2) return 1.0;
  if (s1.length < 2 || s2.length < 2) return 0.0;

  const bigrams1 = new Map<string, number>();
  for (let i = 0; i < s1.length - 1; i++) {
    const bigram = s1.substring(i, i + 2);
    const count = bigrams1.get(bigram) || 0;
    bigrams1.set(bigram, count + 1);
  }

  let intersection = 0;
  for (let i = 0; i < s2.length - 1; i++) {
    const bigram = s2.substring(i, i + 2);
    const count = bigrams1.get(bigram) || 0;
    if (count > 0) {
      intersection++;
      bigrams1.set(bigram, count - 1);
    }
  }

  return (2.0 * intersection) / (s1.length + s2.length - 2);
}

/**
 * Normalisasi teks untuk pencocokan kemiripan (generik, murni mekanis).
 * TIDAK memakai kamus slang/abbreviation (anti-hafalan): hanya lowercase,
 * buang diakritik, tanda baca, dan emoji, lalu collapse whitespace.
 * Toleransi typo/slang diserahkan ke algoritma similarity, bukan lookup string.
 */
export function normalizeForMatch(input: string): string {
  if (!input) return '';
  return input
    .normalize('NFKD')
    // buang diakritik gabungan (mis. é -> e)
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // sisakan huruf/angka/spasi — buang emoji & tanda baca
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Jaccard similarity atas SET token hasil normalizeForMatch (0.0–1.0).
 * Tahan terhadap urutan kata & pengulangan; melengkapi bigram Dice.
 */
export function tokenJaccard(a: string, b: string): number {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (!na || !nb) return 0.0;
  if (na === nb) return 1.0;

  const setA = new Set(na.split(' ').filter(Boolean));
  const setB = new Set(nb.split(' ').filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0.0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0.0 : intersection / union;
}

/** Bobot gabungan bigram-Dice vs token-Jaccard (konstanta algoritmik, bukan data bisnis). */
export const COMBINED_DICE_WEIGHT = 0.6;
export const COMBINED_JACCARD_WEIGHT = 1 - COMBINED_DICE_WEIGHT;

/**
 * Kemiripan gabungan: 0.6 × bigram-Dice + 0.4 × token-Jaccard.
 * Dice unggul untuk typo karakter, Jaccard untuk variasi urutan/penghilangan kata.
 */
export function combinedSimilarity(a: string, b: string): number {
  const normA = normalizeForMatch(a);
  const normB = normalizeForMatch(b);
  if (!normA || !normB) return 0.0;
  if (normA === normB) return 1.0;
  return (
    COMBINED_DICE_WEIGHT * getStringSimilarity(normA, normB) +
    COMBINED_JACCARD_WEIGHT * tokenJaccard(normA, normB)
  );
}
