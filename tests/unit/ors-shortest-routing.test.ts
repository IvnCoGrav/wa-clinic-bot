import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { OrsClient, resolveOrsPreference } from '../../src/integrations/ors/client';

vi.mock('axios');
const mockedAxios = axios as unknown as { post: ReturnType<typeof vi.fn> };

const OK_RESPONSE = { data: { routes: [{ summary: { distance: 13070, duration: 900 } }] } };
const FROM = { lat: -7.34886, lng: 112.751677 };
const TO = { lat: -7.2729567, lng: 112.7607616 };

describe('OrsClient preference: shortest (fondasional)', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of ['ORS_API_KEY', 'ORS_PREFERENCE', 'ORS_PROFILE', 'ORS_AVOID_FEATURES']) {
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

  it('default tanpa env ORS_PREFERENCE mengirim preference shortest', async () => {
    delete process.env.ORS_PREFERENCE;
    mockedAxios.post = vi.fn().mockResolvedValue(OK_RESPONSE);
    await new OrsClient().calculateRoute(FROM.lat, FROM.lng, TO.lat, TO.lng);
    const payload = mockedAxios.post.mock.calls[0][1] as Record<string, any>;
    expect(payload.preference).toBe('shortest');
  });

  it('ORS_PREFERENCE=fastest dihormati', async () => {
    process.env.ORS_PREFERENCE = 'fastest';
    mockedAxios.post = vi.fn().mockResolvedValue(OK_RESPONSE);
    await new OrsClient().calculateRoute(FROM.lat, FROM.lng, TO.lat, TO.lng);
    const payload = mockedAxios.post.mock.calls[0][1] as Record<string, any>;
    expect(payload.preference).toBe('fastest');
  });

  it('ORS_PREFERENCE=recommended dihormati', async () => {
    process.env.ORS_PREFERENCE = 'recommended';
    mockedAxios.post = vi.fn().mockResolvedValue(OK_RESPONSE);
    await new OrsClient().calculateRoute(FROM.lat, FROM.lng, TO.lat, TO.lng);
    const payload = mockedAxios.post.mock.calls[0][1] as Record<string, any>;
    expect(payload.preference).toBe('recommended');
  });

  it('ORS_PREFERENCE invalid fallback ke shortest + warn (whitelist)', async () => {
    process.env.ORS_PREFERENCE = 'shortes';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedAxios.post = vi.fn().mockResolvedValue(OK_RESPONSE);
    await new OrsClient().calculateRoute(FROM.lat, FROM.lng, TO.lat, TO.lng);
    const payload = mockedAxios.post.mock.calls[0][1] as Record<string, any>;
    expect(payload.preference).toBe('shortest');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid ORS_PREFERENCE'));
    warnSpy.mockRestore();
  });

  it('preference case-insensitive dan trim', async () => {
    process.env.ORS_PREFERENCE = '  SHORTEST  ';
    mockedAxios.post = vi.fn().mockResolvedValue(OK_RESPONSE);
    await new OrsClient().calculateRoute(FROM.lat, FROM.lng, TO.lat, TO.lng);
    const payload = mockedAxios.post.mock.calls[0][1] as Record<string, any>;
    expect(payload.preference).toBe('shortest');
  });

  it('resolveOrsPreference helper murni', () => {
    expect(resolveOrsPreference(undefined)).toBe('shortest');
    expect(resolveOrsPreference('')).toBe('shortest');
    expect(resolveOrsPreference('fastest')).toBe('fastest');
    expect(resolveOrsPreference('RECOMMENDED')).toBe('recommended');
  });

  it('payload tetap membawa avoid_features tollways bersama preference', async () => {
    delete process.env.ORS_PREFERENCE;
    process.env.ORS_PROFILE = 'driving-car';
    delete process.env.ORS_AVOID_FEATURES;
    mockedAxios.post = vi.fn().mockResolvedValue(OK_RESPONSE);
    await new OrsClient().calculateRoute(FROM.lat, FROM.lng, TO.lat, TO.lng);
    const payload = mockedAxios.post.mock.calls[0][1] as Record<string, any>;
    expect(payload.preference).toBe('shortest');
    expect(payload.options).toEqual({ avoid_features: ['tollways'] });
  });
});
