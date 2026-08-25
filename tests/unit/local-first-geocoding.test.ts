import { describe, it, expect } from 'vitest';
import { GeocodingService } from '../../src/integrations/google-maps/geocoding';

describe('Local-First Geocoding Engine', () => {
  const geocodingService = new GeocodingService();

  it('should resolve Kebonsari Candi via local gazetteer to Sidoarjo (~18 km) instead of Surabaya', async () => {
    const result = await geocodingService.geocodeText('kebonsari candi');
    expect(result.isPrecise).toBe(true);
    expect(result.lat).toBeCloseTo(-7.4860556, 4);
    expect(result.lng).toBeCloseTo(112.7226611, 4);
    expect(result.kota?.toLowerCase()).toContain('sidoarjo');
  });

  it('should resolve Medokan Ayu via local gazetteer to Surabaya', async () => {
    const result = await geocodingService.geocodeText('medokan ayu');
    expect(result.isPrecise).toBe(true);
    expect(result.lat).toBeCloseTo(-7.3260971, 4);
    expect(result.lng).toBeCloseTo(112.8135304, 4);
    expect(result.kota?.toLowerCase()).toContain('surabaya');
  });

  it('should resolve Kureksari Waru via local gazetteer to Sidoarjo (Klinik Home Base area)', async () => {
    const result = await geocodingService.geocodeText('Kureksari Waru');
    expect(result.isPrecise).toBe(true);
    expect(result.lat).toBeDefined();
    expect(result.lng).toBeDefined();
    expect(result.kota?.toLowerCase()).toContain('sidoarjo');
  });
});
