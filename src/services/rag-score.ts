/**
 * rag-score.ts — skoring retrieval RAG deterministik (C-001 fase 2.1).
 *
 * Masalah: retrieval lama hanya `ORDER BY ts_rank` (leksikal) + ambang absolut
 * 0.25. `ts_rank` tidak sebanding antar-query (panjang query beda), dan artikel
 * yang `keywords`-nya persis cocok bisa kalah dari artikel panjang yang
 * kebetulan memuat banyak token umum.
 *
 * Solusi: gabungkan tiga sinyal yang sudah tersedia tanpa dependency baru:
 *  1. rank FTS yang dinormalisasi (monoton, 0..1),
 *  2. similarity trigram/in-memory (0..1),
 *  3. irisan token query dengan `keywords` artikel (query expansion ringan).
 *
 * Murni & deterministik: tanpa I/O, bisa diuji offline.
 */

export interface RagScoreCandidate {
  id?: string;
  rank?: number | null;
  similarity?: number | null;
  keywords?: string | null;
  title?: string | null;
  content?: string | null;
  [key: string]: any;
}

export interface RagScoreWeights {
  fts: number;
  similarity: number;
  keyword: number;
}

export const DEFAULT_RAG_WEIGHTS: RagScoreWeights = {
  fts: 0.5,
  similarity: 0.35,
  keyword: 0.15,
};

const STOPWORDS = new Set([
  'yang', 'dan', 'atau', 'untuk', 'dengan', 'pada', 'dari', 'ke', 'di', 'ini', 'itu',
  'apa', 'apakah', 'bagaimana', 'berapa', 'bisa', 'boleh', 'kah', 'ya', 'bunda', 'saya',
  'anak', 'bayi', 'si', 'kecil', 'nya', 'adalah', 'akan', 'tidak', 'juga', 'sudah',
]);

/** Token alfanumerik lowercase, tanpa stopword, minimal 3 karakter. */
export function tokenizeQuery(query: string | null | undefined): string[] {
  if (typeof query !== 'string' || !query.trim()) return [];
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
    )
  );
}

/**
 * Normalisasi `ts_rank` ke 0..1 secara monoton: rank / (rank + tokenCount).
 * Query pendek tidak lagi dihukum ambang absolut yang sama dengan query panjang.
 */
export function normalizeFtsRank(rank: number | null | undefined, tokenCount = 1): number {
  const r = Number(rank);
  if (!Number.isFinite(r) || r <= 0) return 0;
  const t = Math.max(1, Math.min(20, Math.floor(Number(tokenCount) || 1)));
  return r / (r + t);
}

/** Skor irisan token query vs kata kunci artikel (0..1). */
export function keywordOverlapScore(
  keywords: string | null | undefined,
  queryTokens: string[]
): number {
  const kw = tokenizeQuery(keywords || '');
  if (kw.length === 0 || queryTokens.length === 0) return 0;
  let hits = 0;
  for (const q of queryTokens) {
    if (kw.some((k) => k === q || (q.length >= 4 && (k.startsWith(q) || q.startsWith(k))))) {
      hits++;
    }
  }
  return hits / queryTokens.length;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Skor gabungan satu kandidat (0..1). */
export function scoreRagCandidate(
  candidate: RagScoreCandidate,
  queryTokens: string[],
  weights: RagScoreWeights = DEFAULT_RAG_WEIGHTS,
  rankScale = 1
): number {
  const fts = normalizeFtsRank(candidate.rank, rankScale);
  const sim = clamp01(Number(candidate.similarity) || 0);
  const kw = keywordOverlapScore(candidate.keywords, queryTokens);
  const total = weights.fts + weights.similarity + weights.keyword;
  if (total <= 0) return 0;
  return clamp01((weights.fts * fts + weights.similarity * sim + weights.keyword * kw) / total);
}

/**
 * Rerank kandidat. Urutan asli dipertahankan sebagai tie-break agar perilaku
 * deterministik dan tidak "melompat" saat skor sama.
 */
export function rerankRagCandidates<T extends RagScoreCandidate>(
  candidates: T[],
  query: string,
  limit = candidates.length,
  weights: RagScoreWeights = DEFAULT_RAG_WEIGHTS
): Array<T & { ragScore: number }> {
  const tokens = tokenizeQuery(query);
  const rankScale = tokens.length;
  return candidates
    .map((c, idx) => ({
      candidate: c,
      idx,
      score: scoreRagCandidate(c, tokens, weights, rankScale),
    }))
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .slice(0, Math.max(0, limit))
    .map(({ candidate, score }) => ({ ...candidate, ragScore: score }));
}

/**
 * Ambang relatif: buang kandidat jauh di bawah kandidat terbaik.
 * Bila semua skor rendah (query tidak relevan), hasil tetap kosong.
 */
export function applyRelativeRagGate<T extends { ragScore?: number }>(
  candidates: T[],
  options: { absoluteFloor?: number; relativeFloor?: number } = {}
): T[] {
  const absoluteFloor = options.absoluteFloor ?? 0.05;
  const relativeFloor = options.relativeFloor ?? 0.4;
  const best = candidates.reduce((max, c) => Math.max(max, Number(c.ragScore) || 0), 0);
  if (best < absoluteFloor) return [];
  return candidates.filter((c) => (Number(c.ragScore) || 0) >= best * relativeFloor);
}
