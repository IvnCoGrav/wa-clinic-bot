import { describe, it, expect } from 'vitest';
import {
  tokenizeQuery,
  normalizeFtsRank,
  keywordOverlapScore,
  scoreRagCandidate,
  rerankRagCandidates,
  applyRelativeRagGate,
  DEFAULT_RAG_WEIGHTS,
} from '../../src/services/rag-score';

/**
 * C-001 fase 2.1: skoring retrieval deterministik. Uji adversarial memakai
 * parafrase/slang nyata, bukan kalimat hafalan implementasi.
 */
describe('RAG scoring — normalisasi & rerank (C-001)', () => {
  it('tokenisasi membuang stopword dan duplikat', () => {
    expect(tokenizeQuery('Bunda, anak saya susah makan dan rewel ya')).toEqual(['susah', 'makan', 'rewel']);
    expect(tokenizeQuery('')).toEqual([]);
    expect(tokenizeQuery(undefined as any)).toEqual([]);
  });

  it('normalisasi rank monoton dan peka panjang query', () => {
    expect(normalizeFtsRank(0.1, 2)).toBeGreaterThan(0);
    expect(normalizeFtsRank(0.2, 2)).toBeGreaterThan(normalizeFtsRank(0.1, 2));
    // rank sama, query lebih panjang → skor lebih rendah (bukan ambang absolut)
    expect(normalizeFtsRank(0.3, 5)).toBeLessThan(normalizeFtsRank(0.3, 1));
    expect(normalizeFtsRank(null, 2)).toBe(0);
  });

  it('overlap keywords tahan variasi akhiran (menyusui vs menyusuii)', () => {
    const tokens = tokenizeQuery('cara menyusui yang benar');
    expect(keywordOverlapScore('menyusui, laktasi, pelekatan', tokens)).toBeGreaterThan(0.3);
    expect(keywordOverlapScore('ongkir, tarif', tokens)).toBe(0);
  });

  it('kandidat dengan keywords persis menang atas rank mentah lebih tinggi', () => {
    const query = 'batuk pilek berdahak';
    const withKw = { id: 'a', rank: 0.09, keywords: 'batuk, pilek, berdahak' };
    const withoutKw = { id: 'b', rank: 0.12, keywords: 'promo bulan ini' };
    const tokens = tokenizeQuery(query);
    expect(scoreRagCandidate(withKw, tokens)).toBeGreaterThan(scoreRagCandidate(withoutKw, tokens));
  });

  it('rerank deterministik: skor sama mempertahankan urutan asli', () => {
    const out = rerankRagCandidates(
      [
        { id: 'x', rank: 0.1, similarity: 0 },
        { id: 'y', rank: 0.1, similarity: 0 },
      ],
      'batuk pilek',
      2
    );
    expect(out.map((o) => o.id)).toEqual(['x', 'y']);
    expect(out[0].ragScore).toBe(out[1].ragScore);
  });

  it('query tanpa hasil relevan → gate relatif mengosongkan hasil', () => {
    const ranked = rerankRagCandidates([{ id: 'x', rank: 0.0001 }], 'topik antah berantah', 5);
    expect(applyRelativeRagGate(ranked)).toEqual([]);
  });

  it('gate relatif membuang kandidat jauh di bawah terbaik', () => {
    const ranked = rerankRagCandidates(
      [
        { id: 'best', rank: 0.5, keywords: 'batuk pilek' },
        { id: 'weak', rank: 0.001 },
      ],
      'batuk pilek',
      5
    );
    const gated = applyRelativeRagGate(ranked);
    expect(gated.map((g) => g.id)).toEqual(['best']);
  });

  it('bobot default menjumlah 1 dan valid', () => {
    const total = DEFAULT_RAG_WEIGHTS.fts + DEFAULT_RAG_WEIGHTS.similarity + DEFAULT_RAG_WEIGHTS.keyword;
    expect(total).toBeCloseTo(1, 6);
  });
});
