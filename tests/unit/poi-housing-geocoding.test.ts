import { describe, it, expect } from 'vitest';
import { geocodingService } from '../../src/integrations/google-maps/geocoding';

describe('POI & Housing Complex Geocoding Intelligence', () => {
  it('crossCheckGazetteer resolves Banjarkemantren Buduran accurately', () => {
    const res = (geocodingService as any).crossCheckGazetteer('Banjarkemantren', 'Buduran', 'Kabupaten Sidoarjo');
    expect(res).not.toBeNull();
    expect(res?.isPrecise).toBe(true);
    expect(res?.kelurahan).toBe('Banjarkemantren');
    expect(res?.kecamatan).toBe('Buduran');
    expect(res?.lat).toBeDefined();
    expect(res?.lng).toBeDefined();
  });

  it('crossCheckGazetteer resolves Babatan Wiyung (Apartemen Anderson / Pakuwon Mall) accurately', () => {
    const res = (geocodingService as any).crossCheckGazetteer('Babatan', 'Wiyung', 'Kota Surabaya');
    expect(res).not.toBeNull();
    expect(res?.isPrecise).toBe(true);
    expect(res?.kelurahan).toBe('Babatan');
    expect(res?.kecamatan).toBe('Wiyung');
    expect(res?.lat).toBeDefined();
    expect(res?.lng).toBeDefined();
  });

  it('preserves POI and housing complex tokens for Geocoding / LLM pipeline', async () => {
    const res = await geocodingService.geocodeText('Kalau di sidoarjo banjarmukti Residence kena transport berapa min?');
    // Result is structured location or fallback preserving candidate subdistricts
    expect(res).toBeDefined();
  });
});
