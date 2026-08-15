import { describe, it, expect } from 'vitest';
import { geocodingService } from '../../src/integrations/google-maps/geocoding';

describe('Sedati & Pabean Geocoding Resolution (Anti-Hijacking)', () => {
  it('Sedati matches Kecamatan Sedati with ambiguity options', async () => {
    const res = await geocodingService.geocodeText('Alamat saya di Jl Kyai Husein no 57, sedati, sidoarjo');
    expect(res.isPrecise).toBe(false);
    expect(res.ambiguityResults).toBeDefined();
    expect(res.ambiguityResults!.length).toBeGreaterThan(1);
    expect(res.ambiguityResults![0].Kecamatan).toBe('Sedati');
    
    // Pastikan Kelurahan Pabean ada di opsi Sedati
    const hasPabean = res.ambiguityResults!.some((d: any) => d.Kelurahan_Desa.toLowerCase() === 'pabean');
    expect(hasPabean).toBe(true);
  });

  it('"pabean kak" resolves precisely to Kelurahan Pabean, Sedati, Sidoarjo (NOT Kecamatan Pabean Cantian)', async () => {
    const res = await geocodingService.geocodeText('pabean kak');
    expect(res.isPrecise).toBe(true);
    expect(res.kelurahan).toBe('Pabean');
    expect(res.kecamatan).toBe('Sedati');
    expect(res.kota).toBe('Kabupaten Sidoarjo');
    expect(res.lat).toBeCloseTo(-7.3682, 3);
    expect(res.lng).toBeCloseTo(112.7554, 3);
  });

  it('"pabean cantian" resolves to Kecamatan Pabean Cantian ambiguity options', async () => {
    const res = await geocodingService.geocodeText('pabean cantian');
    expect(res.isPrecise).toBe(false);
    expect(res.ambiguityResults).toBeDefined();
    expect(res.ambiguityResults![0].Kecamatan).toBe('Pabean Cantian');
  });

  it('"ganti ke Rumdis TNI al wonosari A132 mbak" does NOT match Kelurahan Ganting Gedangan', async () => {
    const res = await geocodingService.geocodeText('ganti ke Rumdis TNI al wonosari A132 mbak');
    // Pastikan tidak pernah menebak Ganting Gedangan
    expect(res.kelurahan).not.toBe('Ganting');
    expect(res.kecamatan).not.toBe('Gedangan');
    expect(res.matchedSpan).not.toBe('Ganting');
  });

  it('"Bungurasih tengah sidoarjo" resolves precisely to Kelurahan Bungurasih, Waru, Sidoarjo (NOT Kecamatan Sidoarjo)', async () => {
    const res = await geocodingService.geocodeText('Bungurasih tengah sidoarjo');
    expect(res.isPrecise).toBe(true);
    expect(res.kelurahan).toBe('Bungurasih');
    expect(res.kecamatan).toBe('Waru');
    expect(res.kota).toBe('Kabupaten Sidoarjo');
    expect(res.lat).toBeCloseTo(-7.352, 2);
    expect(res.lng).toBeCloseTo(112.723, 2);
  });
});
