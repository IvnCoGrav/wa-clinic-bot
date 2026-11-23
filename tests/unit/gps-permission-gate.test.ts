import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Gerbang izin lokasi untuk warm-up GPS (S-06 revisi 2026-11-23).
 *
 * Banner consent in-app sudah dihapus. Kontrak baru: warm-up latar hanya boleh
 * berjalan bila browser SUDAH memberi izin (`granted`). Aplikasi tidak boleh
 * memicu prompt native sendiri — jadi semua status lain wajib fail-closed.
 */

const MODULE_PATH = '../../packages/admin-dashboard/src/utils/geoUtils';

function makeNavigator(query: () => Promise<{ state: string }>) {
  const geolocation = {
    getCurrentPosition: vi.fn(),
    watchPosition: vi.fn(() => 7),
    clearWatch: vi.fn(),
  };
  vi.stubGlobal('navigator', { geolocation, permissions: { query: vi.fn(query) } });
  return geolocation;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('isGeolocationPermissionGranted', () => {
  it('true hanya bila status izin browser "granted"', async () => {
    const geo = makeNavigator(async () => ({ state: 'granted' }));
    const mod = await import(MODULE_PATH);
    await expect(mod.isGeolocationPermissionGranted()).resolves.toBe(true);
    // Tidak boleh menyalakan GPS hanya untuk mengecek izin.
    expect(geo.watchPosition).not.toHaveBeenCalled();
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('false saat status "prompt" (jangan pernah memicu modal native sendiri)', async () => {
    makeNavigator(async () => ({ state: 'prompt' }));
    const mod = await import(MODULE_PATH);
    await expect(mod.isGeolocationPermissionGranted()).resolves.toBe(false);
  });

  it('false saat status "denied"', async () => {
    makeNavigator(async () => ({ state: 'denied' }));
    const mod = await import(MODULE_PATH);
    await expect(mod.isGeolocationPermissionGranted()).resolves.toBe(false);
  });

  it('fail-closed saat Permissions API melempar (browser lama/rusak)', async () => {
    makeNavigator(async () => {
      throw new Error('Permissions API unavailable');
    });
    const mod = await import(MODULE_PATH);
    await expect(mod.isGeolocationPermissionGranted()).resolves.toBe(false);
  });

  it('fail-closed saat Permissions API tidak tersedia', async () => {
    vi.stubGlobal('navigator', {
      geolocation: { watchPosition: vi.fn(), clearWatch: vi.fn(), getCurrentPosition: vi.fn() },
    });
    const mod = await import(MODULE_PATH);
    await expect(mod.isGeolocationPermissionGranted()).resolves.toBe(false);
  });

  it('fail-closed saat navigator tidak ada (SSR/uji tanpa DOM)', async () => {
    vi.stubGlobal('navigator', undefined);
    const mod = await import(MODULE_PATH);
    await expect(mod.isGeolocationPermissionGranted()).resolves.toBe(false);
  });
});
