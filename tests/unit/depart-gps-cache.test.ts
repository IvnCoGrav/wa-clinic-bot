import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Uji adversarial Silent Depart-Capture (plan 2026-10-04) — cache GPS keberangkatan.
 *
 * Fokus: memastikan saat klik "Navigasi" titik awal Bidan bisa didapat TANPA
 * tembakan GPS dingin yang memblokir aktivasi klik, serta fail-open total bila
 * izin ditolak / sinyal buruk (JANGAN pernah throw → WA OTW tidak boleh macet).
 *
 * State ada di level modul → tiap test me-`resetModules` lalu memuat ulang modul
 * agar tidak bocor antar-test.
 */

const MODULE_PATH = '../../packages/admin-dashboard/src/utils/geoUtils';

const GEO_ERR = { PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };

function makeNavigator() {
  const geolocation = {
    getCurrentPosition: vi.fn(),
    watchPosition: vi.fn(() => 42),
    clearWatch: vi.fn(),
  };
  vi.stubGlobal('navigator', { geolocation });
  return geolocation;
}

function makePos(lat: number, lng: number, accuracy: number) {
  return { coords: { latitude: lat, longitude: lng, accuracy } };
}

let clock = 10_000_000;

beforeEach(() => {
  clock = 10_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('departGps cache — jalur bahagia', () => {
  it('cache segar (≤60 dtk) dipakai tanpa tembakan one-shot (0 dtk)', async () => {
    const geo = makeNavigator();
    const mod = await import(MODULE_PATH);
    mod.startDepartGpsWarmup();
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);

    // Fix GPS baik dari watch memanaskan cache.
    const onWatch = geo.watchPosition.mock.calls[0][0] as (p: unknown) => void;
    onWatch(makePos(-7.34, 112.74, 15));

    clock += 5_000; // masih segar
    const pos = await mod.getDepartPositionFast();
    expect(pos).toEqual({ lat: -7.34, lng: 112.74, accuracy: 15 });
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('cache basi (>60 dtk) → fallback one-shot 2 dtk lalu cache diperbarui', async () => {
    const geo = makeNavigator();
    const mod = await import(MODULE_PATH);
    mod.startDepartGpsWarmup();
    const onWatch = geo.watchPosition.mock.calls[0][0] as (p: unknown) => void;
    onWatch(makePos(-7.34, 112.74, 15));

    clock += 61_000; // basi
    geo.getCurrentPosition.mockImplementation((succ: (p: unknown) => void) =>
      succ(makePos(-7.35, 112.75, 20))
    );

    const pos = await mod.getDepartPositionFast();
    expect(pos).toEqual({ lat: -7.35, lng: 112.75, accuracy: 20 });
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    // Batas balapan pendek (2 dtk) — bukan 10 dtk tembakan dingin lama.
    expect(geo.getCurrentPosition.mock.calls[0][2]).toMatchObject({ timeout: 2000 });

    // Panggilan kedua langsung pakai cache baru (tanpa one-shot lagi).
    const pos2 = await mod.getDepartPositionFast();
    expect(pos2).toEqual({ lat: -7.35, lng: 112.75, accuracy: 20 });
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
  });
});

describe('departGps cache — ketahanan & fail-open', () => {
  it('izin ditolak (PERMISSION_DENIED) → null tanpa throw', async () => {
    const geo = makeNavigator();
    const mod = await import(MODULE_PATH);
    geo.getCurrentPosition.mockImplementation((_s: unknown, err: (e: unknown) => void) =>
      err({ code: 1, ...GEO_ERR })
    );
    await expect(mod.getDepartPositionFast()).resolves.toBeNull();
  });

  it('time-out sinyal → null tanpa throw', async () => {
    const geo = makeNavigator();
    const mod = await import(MODULE_PATH);
    geo.getCurrentPosition.mockImplementation((_s: unknown, err: (e: unknown) => void) =>
      err({ code: 3, ...GEO_ERR })
    );
    await expect(mod.getDepartPositionFast()).resolves.toBeNull();
  });

  it('akurasi one-shot >100 m (drift indoor) ditolak → null', async () => {
    const geo = makeNavigator();
    const mod = await import(MODULE_PATH);
    geo.getCurrentPosition.mockImplementation((succ: (p: unknown) => void) =>
      succ(makePos(-7.34, 112.74, 250))
    );
    await expect(mod.getDepartPositionFast()).resolves.toBeNull();
  });

  it('warmup mengabaikan fix akurasi buruk; lalu jatuh ke one-shot', async () => {
    const geo = makeNavigator();
    const mod = await import(MODULE_PATH);
    mod.startDepartGpsWarmup();
    const onWatch = geo.watchPosition.mock.calls[0][0] as (p: unknown) => void;
    onWatch(makePos(-7.3, 112.7, 400)); // drift → cache tetap kosong

    geo.getCurrentPosition.mockImplementation((_s: unknown, err: (e: unknown) => void) =>
      err({ code: 3, ...GEO_ERR })
    );
    expect(await mod.getDepartPositionFast()).toBeNull();
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('tanpa geolocation → start no-op & hasil null (fail-open)', async () => {
    vi.stubGlobal('navigator', {});
    const mod = await import(MODULE_PATH);
    expect(() => mod.startDepartGpsWarmup()).not.toThrow();
    await expect(mod.getDepartPositionFast()).resolves.toBeNull();
  });
});

describe('departGps warmup — lifecycle', () => {
  it('start idempoten (1 watch) & stop melepas watch, aman dipanggil ulang', async () => {
    const geo = makeNavigator();
    const mod = await import(MODULE_PATH);
    mod.startDepartGpsWarmup();
    mod.startDepartGpsWarmup();
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);

    mod.stopDepartGpsWarmup();
    expect(geo.clearWatch).toHaveBeenCalledWith(42);
    expect(() => mod.stopDepartGpsWarmup()).not.toThrow();
  });
});
