import { describe, it, expect } from 'vitest';
import { findNearestSubdistrict, haversineKm } from '../../src/utils/gazetteer';
import { geocodingService } from '../../src/integrations/google-maps/geocoding';

// Kasus nyata 6282229353440: shareloc Sedati tertulis Gubeng/Surabaya oleh hardcode lama.
describe('Nearest-Neighbor Reverse Geocoding Lokal (Anti-Gubeng Fiktif)', () => {
  it('koordinat Perum Central Park Juanda ter-resolve ke Semampir/Sedati/Sidoarjo', () => {
    const match = findNearestSubdistrict(-7.36834955, 112.77448272);
    expect(match).not.toBeNull();
    expect(match!.kelurahan).toBe('Semampir');
    expect(match!.kecamatan).toBe('Sedati');
    expect(match!.kota).toBe('Kabupaten Sidoarjo');
    expect(match!.zipcode).toBe('61253');
    expect(match!.distanceKm).toBeLessThan(2);
  });

  it('koordinat Balai Pemuda ter-resolve ke wilayah Surabaya asli (bukan Gubeng hardcode)', async () => {
    const res = await geocodingService.reverseGeocode(-7.2597, 112.7391);
    expect(res.isPrecise).toBe(true);
    expect(res.kecamatan).toBe('Tegalsari');
    expect(res.kota).toBe('Kota Surabaya');
    expect(res.kelurahan).not.toBe('Gubeng');
    expect(res.lat).toBe(-7.2597);
    expect(res.lng).toBe(112.7391);
  });

  it('koordinat tengah Samudra Hindia tanpa kecamatan/kota palsu', async () => {
    expect(findNearestSubdistrict(-15.0, 110.0)).toBeNull();
    const res = await geocodingService.reverseGeocode(-15.0, 110.0);
    expect(res.isPrecise).toBe(true);
    expect(res.kecamatan).toBeUndefined();
    expect(res.kota).toBeUndefined();
    expect(res.kelurahan).toBeUndefined();
    expect(res.lat).toBe(-15.0);
    expect(res.lng).toBe(110.0);
  });

  it('input tidak valid dan radius sempit mengembalikan null (tidak mengarang)', () => {
    expect(findNearestSubdistrict(NaN, 112.7)).toBeNull();
    expect(findNearestSubdistrict(-7.3683, NaN)).toBeNull();
    // Radius 0,05 km terlalu sempit untuk titik yang berjarak ~0,2 km dari dataset
    expect(findNearestSubdistrict(-7.36834955, 112.77448272, 0.05)).toBeNull();
  });

  it('haversine akurat untuk jarak pendek Sedati (sanity 0,1–0,5 km)', () => {
    const d = haversineKm(-7.36834955, 112.77448272, -7.369803999999999, 112.7733106);
    expect(d).toBeGreaterThan(0.1);
    expect(d).toBeLessThan(0.5);
  });
});
