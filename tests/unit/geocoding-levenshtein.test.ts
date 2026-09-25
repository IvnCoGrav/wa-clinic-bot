import { describe, it, expect } from 'vitest';
import { GeocodingService } from '../../src/integrations/google-maps/geocoding';

/**
 * wdoro → Wedoro (typo 1 huruf hilang 'e') harus tertangani lokal 0ms
 * tanpa LLM, via isTypoAtMostOne terpusat (≥5). Skor 0.85 → fuzzy
 * di geocoding (isPrecise:false, kelurahan ada), dipromosikan precise
 * di calculate-delivery tool (resolvedIsPrecise = isPrecise || kelurahan).
 */

describe('Geocoding Levenshtein 1-edit (wdoro/bngurasih/sedti)', () => {
  const svc = new GeocodingService();

  it('wdoro → Wedoro, Waru (fuzzy lokal, tanpa LLM)', async () => {
    const r = await svc.geocodeText('wdoro');
    expect(r.kelurahan).toBe('Wedoro');
    expect(r.kecamatan).toBe('Waru');
    // geocoding level: fuzzy (isPrecise false, isFuzzyMatch true)
    expect(r.isPrecise).toBe(false);
    expect((r as any).isFuzzyMatch).toBe(true);
    expect(r.lat).toBeCloseTo(-7.348395, 2);
  });

  it('bngurasih → Bungurasih, Waru (typo hilang u)', async () => {
    const r = await svc.geocodeText('bngurasih');
    expect(r.kelurahan).toBe('Bungurasih');
    expect(r.kecamatan).toBe('Waru');
    expect(r.isPrecise).toBe(false);
  });

  it('sedti → Sedati (kecamatan typo 1 huruf, ambiguous kelurahan)', async () => {
    const r = await svc.geocodeText('sedti');
    // Sedati adalah kecamatan luas → isPrecise false dengan ambiguityResults
    expect(r.isPrecise).toBe(false);
    expect((r as any).ambiguityResults?.some((x: any) => x.Kecamatan === 'Sedati')).toBe(true);
  });

  it('kenjern → Kenjeran (kontrol Dice sudah lolos, ambiguous)', async () => {
    const r = await svc.geocodeText('kenjern');
    expect(r.isPrecise).toBe(false);
    expect((r as any).ambiguityResults?.some((x: any) => x.Kecamatan === 'Kenjeran')).toBe(true);
  });

  it('wdoro kak (dengan suffix) → Wedoro (span tunggal)', async () => {
    const r = await svc.geocodeText('wdoro kak');
    expect(r.kelurahan).toBe('Wedoro');
  });

  it('waru (4 huruf) tetap bukan typo-bruteforce — harus exact/ambiguity', async () => {
    const r = await svc.geocodeText('waru');
    // Waru adalah kecamatan luas dengan banyak kelurahan → isPrecise false (ambiguity)
    // Yang penting bukan typo-bruteforce ke lain, dan ada indikasi Waru
    expect(r.isPrecise).toBe(false);
    expect(r.kecamatan === 'Waru' || r.kota === 'waru' || (r as any).ambiguityResults?.some((x: any) => x.Kecamatan === 'Waru')).toBe(true);
  });
});
