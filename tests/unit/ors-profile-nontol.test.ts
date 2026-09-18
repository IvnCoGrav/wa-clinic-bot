import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { OrsClient } from '../../src/integrations/ors/client';

vi.mock('axios');
const mockedAxios = axios as unknown as { post: ReturnType<typeof vi.fn> };

const OK_RESPONSE = {
  data: { routes: [{ summary: { distance: 5200, duration: 640 } }] },
};

const FROM = { lat: -7.34886, lng: 112.751677 };
const TO = { lat: -7.35886, lng: 112.761677 };

/**
 * Kontrak profil ORS mobil non-tol.
 * Seam: payload HTTP keluar OrsClient.calculateRoute (axios.post).
 * Nilai ekspektasi berupa literal independen (URL + payload), bukan
 * hasil hitungan ulang dari kode produksi.
 */
describe('OrsClient profil mobil non-tol (driving-car + avoid tollways)', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of ['ORS_API_KEY', 'ORS_PROFILE', 'ORS_AVOID_FEATURES', 'ORS_BASE_URL']) {
      saved[k] = process.env[k];
    }
    process.env.ORS_API_KEY = 'test_valid_key_123';
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('1. ORS_PROFILE=driving-car tanpa override → /driving-car + avoid_features tollways', async () => {
    process.env.ORS_PROFILE = 'driving-car';
    delete process.env.ORS_AVOID_FEATURES;
    mockedAxios.post = vi.fn().mockResolvedValue(OK_RESPONSE);

    const res = await new OrsClient().calculateRoute(FROM.lat, FROM.lng, TO.lat, TO.lng);

    expect(res?.distanceMeters).toBe(5200);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://api.heigit.org/openrouteservice/v2/directions/driving-car',
      {
        coordinates: [
          [FROM.lng, FROM.lat],
          [TO.lng, TO.lat],
        ],
        options: { avoid_features: ['tollways'] },
      },
      expect.anything()
    );
  });

  it('2. ORS_AVOID_FEATURES eksplisit dihormati apa adanya (override operator)', async () => {
    process.env.ORS_PROFILE = 'driving-car';
    process.env.ORS_AVOID_FEATURES = 'tollways,highways';
    mockedAxios.post = vi.fn().mockResolvedValue(OK_RESPONSE);

    await new OrsClient().calculateRoute(FROM.lat, FROM.lng, TO.lat, TO.lng);

    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('/v2/directions/driving-car'),
      expect.objectContaining({ options: { avoid_features: ['tollways', 'highways'] } }),
      expect.anything()
    );
  });

  it('3. ORS_AVOID_FEATURES="" eksplisit → tanpa blok options (kontrak opt-out sadar)', async () => {
    process.env.ORS_PROFILE = 'driving-car';
    process.env.ORS_AVOID_FEATURES = '';
    mockedAxios.post = vi.fn().mockResolvedValue(OK_RESPONSE);

    await new OrsClient().calculateRoute(FROM.lat, FROM.lng, TO.lat, TO.lng);

    const payload = mockedAxios.post.mock.calls[0][1] as Record<string, any>;
    expect(payload).not.toHaveProperty('options');
  });

  it('4. profil non-driving (warisan cycling-electric) → URL profil tsb tanpa default tollways', async () => {
    process.env.ORS_PROFILE = 'cycling-electric';
    delete process.env.ORS_AVOID_FEATURES;
    mockedAxios.post = vi.fn().mockResolvedValue(OK_RESPONSE);

    await new OrsClient().calculateRoute(FROM.lat, FROM.lng, TO.lat, TO.lng);

    const [url, payload] = mockedAxios.post.mock.calls[0] as [string, Record<string, any>];
    expect(url).toBe('https://api.heigit.org/openrouteservice/v2/directions/cycling-electric');
    expect(payload).not.toHaveProperty('options');
  });
});
