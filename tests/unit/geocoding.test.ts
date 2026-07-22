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
});
