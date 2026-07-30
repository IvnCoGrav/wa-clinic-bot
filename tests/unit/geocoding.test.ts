import { describe, it, expect, beforeEach } from 'vitest';
import { geocodingService } from '../../src/integrations/google-maps/geocoding';

describe('Geocoding Service Local Database & Ambiguity Unit Tests', () => {
  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = 'mock_google_maps_key';
  });

  it('1. should reject imprecise cities with suffix particles as imprecise', async () => {
    const res = await geocodingService.geocodeText('saya di sidoarjo bund');
    expect(res.isPrecise).toBe(false);
  });

  it('2. should detect ambiguity for Wedi and return options', async () => {
    const res = await geocodingService.geocodeText('saya di wedi');
    expect(res.isPrecise).toBe(false);
    expect(res.ambiguityResults).toBeDefined();
    expect(res.ambiguityResults!.length).toBe(2);
    expect(res.ambiguityResults![0].Kecamatan).toBe('Gedangan');
    expect(res.ambiguityResults![1].Kecamatan).toBe('Candi');
  });

  it('3. should resolve Wedi Gedangan precisely using the context filter', async () => {
    const res = await geocodingService.geocodeText('wedi gedangan');
    expect(res.isPrecise).toBe(true);
    expect(res.kelurahan).toBe('Wedi');
    expect(res.kecamatan).toBe('Gedangan');
    expect(res.lat).toBeCloseTo(-7.38636, 4);
  });

  it('4. should reject unknown/unregistered locations', async () => {
    const res = await geocodingService.geocodeText('lokasi ngawur');
    expect(res.isPrecise).toBe(false);
  });

  it('5. should reject broad Kecamatan names as imprecise when Kelurahan is not specified', async () => {
    const resCandi = await geocodingService.geocodeText('saya di candi');
    expect(resCandi.isPrecise).toBe(false);

    const resWaru = await geocodingService.geocodeText('waru');
    expect(resWaru.isPrecise).toBe(false);
  });

  it('6. should resolve Kecamatan names as precise Kelurahan when explicitly prefixed with kelurahan/desa', async () => {
    const resCandi = await geocodingService.geocodeText('saya di kelurahan candi');
    expect(resCandi.isPrecise).toBe(true);
    expect(resCandi.kelurahan).toBe('Candi');
    expect(resCandi.kecamatan).toBe('Candi');

    const resWaru = await geocodingService.geocodeText('kelurahan waru');
    expect(resWaru.isPrecise).toBe(true);
    expect(resWaru.kelurahan).toBe('Waru');
    expect(resWaru.kecamatan).toBe('Waru');
  });

  it('7. should resolve fuzzy subdistrict from text with suffix prices ("saya di kenjern bund, kena berapa ya")', async () => {
    const res = await geocodingService.geocodeText('saya di kenjern bund, kena berapa ya');
    expect(res.isPrecise).toBe(false);
    expect(res.matchedSpan?.toLowerCase()).toBe('kenjern');
  });

  it('8. should resolve fuzzy subdistrict from text with prefix prices ("kena berapa ya kalau di kenjern")', async () => {
    const res = await geocodingService.geocodeText('kena berapa ya kalau di kenjern');
    expect(res.isPrecise).toBe(false);
    expect(res.matchedSpan?.toLowerCase()).toBe('kenjern');
  });

  it('9. should resolve fuzzy subdistrict with complex new suffix/prefix price variations', async () => {
    const res1 = await geocodingService.geocodeText('gayungan ongkirnya berapaan ya');
    expect(res1.isPrecise).toBe(false);
    expect(res1.matchedSpan?.toLowerCase()).toBe('gayungan');

    const res2 = await geocodingService.geocodeText('min itung ongkir dong gayungan');
    expect(res2.isPrecise).toBe(false);
    expect(res2.matchedSpan?.toLowerCase()).toBe('gayungan');

    const res3 = await geocodingService.geocodeText('berapa harganya kalau ke gayungan');
    expect(res3.isPrecise).toBe(false);
    expect(res3.matchedSpan?.toLowerCase()).toBe('gayungan');
  });

  it('10. should resolve precisely to Kelurahan Kenjeran if prefix is explicit', async () => {
    const res = await geocodingService.geocodeText('saya di kelurahan kenjern bund, kena berapa ya');
    expect(res.kelurahan).toBe('Kenjeran');
    expect(res.matchedSpan?.toLowerCase()).toBe('kenjern');
  });

  it('11. should NOT generate or match fake combined spans for separated locations ("kalau dari wedi ongkirnya berapa ya ke krembung")', async () => {
    // Generate candidate spans
    const spans = geocodingService['generateCandidateSpans']('kalau dari wedi ongkirnya berapa ya ke krembung');
    
    // Wedi and Krembung should exist in spans as separate entities
    expect(spans).toContain('wedi');
    expect(spans).toContain('krembung');
    
    // But there should be NO combined span "wedi krembung"
    expect(spans).not.toContain('wedi krembung');
    
    const res = await geocodingService.geocodeText('kalau dari wedi ongkirnya berapa ya ke krembung');
    expect(res.matchedSpan).not.toBe('wedi krembung');
  });

  it('12. should verify comparator isBetterMatch tie-breaking rules', () => {
    const isBetter = (cand: any, curr: any) => geocodingService['isBetterMatch'](cand, curr);

    // Rule 1: candidate wins if current is null
    expect(isBetter({ score: 0.5, level: 'kelurahan', matchedSpan: 'wedi' }, null)).toBe(true);

    // Rule 2: higher score wins
    expect(isBetter(
      { score: 0.9, level: 'kelurahan', matchedSpan: 'wedi' },
      { score: 0.8, level: 'kelurahan', matchedSpan: 'wedi' }
    )).toBe(true);
    expect(isBetter(
      { score: 0.7, level: 'kelurahan', matchedSpan: 'wedi' },
      { score: 0.8, level: 'kelurahan', matchedSpan: 'wedi' }
    )).toBe(false);

    // Rule 3: same score, kelurahan level wins over kecamatan
    expect(isBetter(
      { score: 1.0, level: 'kelurahan', matchedSpan: 'wedi' },
      { score: 1.0, level: 'kecamatan', matchedSpan: 'wedi' }
    )).toBe(true);
    expect(isBetter(
      { score: 1.0, level: 'kecamatan', matchedSpan: 'wedi' },
      { score: 1.0, level: 'kelurahan', matchedSpan: 'wedi' }
    )).toBe(false);

    // Rule 4: same score & level, longer matchedSpan word count wins
    expect(isBetter(
      { score: 1.0, level: 'kelurahan', matchedSpan: 'wedi gedangan' },
      { score: 1.0, level: 'kelurahan', matchedSpan: 'wedi' }
    )).toBe(true);
    expect(isBetter(
      { score: 1.0, level: 'kelurahan', matchedSpan: 'wedi' },
      { score: 1.0, level: 'kelurahan', matchedSpan: 'wedi gedangan' }
    )).toBe(false);

    // Rule 5: same score & level & word count, longer matchedSpan character length wins
    expect(isBetter(
      { score: 0.8, level: 'kelurahan', matchedSpan: 'krembungs' },
      { score: 0.8, level: 'kelurahan', matchedSpan: 'krembun' }
    )).toBe(true);
    expect(isBetter(
      { score: 0.8, level: 'kelurahan', matchedSpan: 'krembun' },
      { score: 0.8, level: 'kelurahan', matchedSpan: 'krembungs' }
    )).toBe(false);
  });
});
