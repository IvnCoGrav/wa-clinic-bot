import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { OrsClient } from '../../src/integrations/ors/client';

vi.mock('axios');
const mockedAxios = axios as unknown as { post: ReturnType<typeof vi.fn> };

describe('OrsClient Directions API Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when API key is missing or mock', async () => {
    const origEnv = process.env.ORS_API_KEY;
    process.env.ORS_API_KEY = '';
    const client = new OrsClient();
    const res = await client.calculateRoute(-7.34886, 112.751677, -7.46886, 112.71372);
    expect(res).toBeNull();
    process.env.ORS_API_KEY = origEnv;
  });

  it('sends driving-car profile and avoid_features: ["tollways"] by default', async () => {
    const origEnvKey = process.env.ORS_API_KEY;
    const origEnvProfile = process.env.ORS_PROFILE;
    process.env.ORS_API_KEY = 'test_valid_key_123';
    delete process.env.ORS_PROFILE;

    mockedAxios.post = vi.fn().mockResolvedValue({
      data: {
        routes: [
          {
            summary: {
              distance: 16660,
              duration: 1128,
            },
          },
        ],
      },
    });

    const client = new OrsClient();
    const res = await client.calculateRoute(-7.34886, 112.751677, -7.4688613, 112.7137227);

    expect(res).not.toBeNull();
    expect(res?.distanceMeters).toBe(16660);
    expect(res?.durationSeconds).toBe(1128);

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://api.heigit.org/openrouteservice/v2/directions/driving-car',
      {
        coordinates: [
          [112.751677, -7.34886],
          [112.7137227, -7.4688613],
        ],
        options: {
          avoid_features: ['tollways'],
        },
      },
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'test_valid_key_123',
        }),
      })
    );

    process.env.ORS_API_KEY = origEnvKey;
    if (origEnvProfile) process.env.ORS_PROFILE = origEnvProfile;
  });
});
