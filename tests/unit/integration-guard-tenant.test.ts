import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import { prisma } from '../../src/db/client';
import { DistributedKv } from '../../src/utils/distributed-kv';
import {
  IntegrationGuard,
  parseIntegrationGuardConfig,
  clearIntegrationGuardCache,
} from '../../src/services/integration-guard.service';
import { OrsClient } from '../../src/integrations/ors/client';
import { GoogleDistanceMatrixClient } from '../../src/integrations/google-maps/distance-matrix.client';

/**
 * I-011 — kuota harian + circuit breaker + kunci API PER TENANT.
 *
 * Kontrak yang dijaga:
 * 1. Kuota dihitung terpisah per tenant (tenant A boros tidak memutus tenant B).
 * 2. Circuit breaker terpisah per tenant (kegagalan A tidak membuka circuit B).
 * 3. Kunci API dapat dioverride per tenant dari DB; tanpa override → env.
 * 4. Layanan bisa dinonaktifkan per tenant tanpa menyentuh tenant lain.
 * 5. DB offline → perilaku lama (env, tanpa batas) supaya layanan tidak mati.
 * 6. Klien nyata (ORS, Google Distance) TIDAK memanggil axios saat kuota habis
 *    atau circuit OPEN — hemat biaya dan tidak menambah latensi.
 */

type SettingsMap = Record<string, any>;

function mockTenantSettings(map: SettingsMap) {
  vi.spyOn(prisma.tenant, 'findUnique').mockImplementation((async (args: any) => {
    const id = args?.where?.id;
    return { settings: map[id] ?? {} } as any;
  }) as any);
}

function newGuard(): IntegrationGuard {
  return new IntegrationGuard(new DistributedKv({ forceMemory: true }));
}

const oldOrsKey = process.env.ORS_API_KEY;
const oldGmapsKey = process.env.GOOGLE_MAPS_API_KEY;

beforeEach(() => {
  vi.restoreAllMocks();
  clearIntegrationGuardCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearIntegrationGuardCache();
  if (oldOrsKey === undefined) delete process.env.ORS_API_KEY;
  else process.env.ORS_API_KEY = oldOrsKey;
  if (oldGmapsKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY = oldGmapsKey;
});

describe('parseIntegrationGuardConfig', () => {
  it('menolak bentuk salah tanpa melempar', () => {
    expect(parseIntegrationGuardConfig(null)).toEqual({ rules: {} });
    expect(parseIntegrationGuardConfig('bukan-objek')).toEqual({ rules: {} });
    expect(parseIntegrationGuardConfig({ ors: 'bukan-objek' })).toEqual({ rules: {} });
    expect(parseIntegrationGuardConfig({ layananAsing: { dailyLimit: 5 } })).toEqual({ rules: {} });
  });

  it('memvalidasi angka & membuang nilai di luar batas', () => {
    const cfg = parseIntegrationGuardConfig({
      ors: {
        dailyLimit: -3,
        failureThreshold: 1.5,
        slidingWindowSize: 0,
        cooldownMs: 10,
      },
      googleGeocode: {
        dailyLimit: 250,
        failureThreshold: 0.3,
        slidingWindowSize: 20,
        cooldownMs: 60_000,
      },
    });

    expect(cfg.rules.ors).toBeUndefined();
    expect(cfg.rules.googleGeocode).toEqual({
      dailyLimit: 250,
      failureThreshold: 0.3,
      slidingWindowSize: 20,
      cooldownMs: 60_000,
    });
  });

  it('menerima enabled=false dan apiKey wajar, menolak apiKey kepanjangan', () => {
    const cfg = parseIntegrationGuardConfig({
      ors: { enabled: false, apiKey: '  kunci-db  ' },
      googleDistanceMatrix: { apiKey: 'x'.repeat(201) },
    });
    expect(cfg.rules.ors).toEqual({ enabled: false, apiKey: 'kunci-db' });
    expect(cfg.rules.googleDistanceMatrix).toBeUndefined();
  });
});

describe('kuota harian per tenant', () => {
  it('tenant A yang menghabiskan kuota tidak memblokir tenant B', async () => {
    mockTenantSettings({
      'tenant-a': { integrationGuards: { ors: { dailyLimit: 2 } } },
      'tenant-b': { integrationGuards: { ors: { dailyLimit: 1 } } },
    });
    const guard = newGuard();
    const fnA = vi.fn(async () => 'a');
    const fnB = vi.fn(async () => 'b');

    await expect(guard.run('tenant-a', 'ors', fnA)).resolves.toBe('a');
    await expect(guard.run('tenant-a', 'ors', fnA)).resolves.toBe('a');
    // Kuota A habis (2/2): pemanggilan ketiga tidak menyentuh layanan.
    await expect(guard.run('tenant-a', 'ors', fnA)).resolves.toBeNull();
    expect(fnA).toHaveBeenCalledTimes(2);

    // Tenant B punya hitungan sendiri.
    await expect(guard.run('tenant-b', 'ors', fnB)).resolves.toBe('b');
    await expect(guard.run('tenant-b', 'ors', fnB)).resolves.toBeNull();
    expect(fnB).toHaveBeenCalledTimes(1);
  });

  it('kuota dicatat per layanan, bukan satu hitungan gabungan', async () => {
    mockTenantSettings({
      'tenant-a': {
        integrationGuards: {
          ors: { dailyLimit: 1 },
          googleGeocode: { dailyLimit: 1 },
        },
      },
    });
    const guard = newGuard();
    const orsFn = vi.fn(async () => 'ors');
    const geoFn = vi.fn(async () => 'geo');

    await expect(guard.run('tenant-a', 'ors', orsFn)).resolves.toBe('ors');
    await expect(guard.run('tenant-a', 'ors', orsFn)).resolves.toBeNull();
    // Layanan berbeda tetap boleh memakai kuotanya sendiri.
    await expect(guard.run('tenant-a', 'googleGeocode', geoFn)).resolves.toBe('geo');
    expect(geoFn).toHaveBeenCalledTimes(1);
  });
});

describe('circuit breaker per tenant', () => {
  it('circuit tenant A terbuka tanpa menutup circuit tenant B', async () => {
    mockTenantSettings({
      'tenant-a': {
        integrationGuards: {
          googleGeocode: { failureThreshold: 0.5, slidingWindowSize: 2, cooldownMs: 60_000 },
        },
      },
      'tenant-b': {
        integrationGuards: {
          googleGeocode: { failureThreshold: 0.5, slidingWindowSize: 2, cooldownMs: 60_000 },
        },
      },
    });
    const guard = newGuard();
    const infraError = () => Promise.reject(Object.assign(new Error('koneksi putus'), { code: 'ECONNREFUSED' }));

    await guard.run('tenant-a', 'googleGeocode', infraError);
    await guard.run('tenant-a', 'googleGeocode', infraError);
    expect(guard.getCircuitState('tenant-a', 'googleGeocode')).toBe('OPEN');

    // Circuit A terbuka: layanan tidak dipanggil sama sekali.
    const fnA = vi.fn(async () => 'a');
    await expect(guard.run('tenant-a', 'googleGeocode', fnA)).resolves.toBeNull();
    expect(fnA).not.toHaveBeenCalled();

    // Circuit B masih tertutup: layanan B tetap berjalan normal.
    expect(guard.getCircuitState('tenant-b', 'googleGeocode')).toBe('CLOSED');
    const fnB = vi.fn(async () => 'b');
    await expect(guard.run('tenant-b', 'googleGeocode', fnB)).resolves.toBe('b');
    expect(fnB).toHaveBeenCalledTimes(1);
  });

  it('reset(tenant) hanya membersihkan breaker tenant tersebut', async () => {
    mockTenantSettings({
      'tenant-a': { integrationGuards: { ors: { slidingWindowSize: 1, failureThreshold: 0, cooldownMs: 60_000 } } },
      'tenant-b': { integrationGuards: { ors: { slidingWindowSize: 1, failureThreshold: 0, cooldownMs: 60_000 } } },
    });
    const guard = newGuard();
    const infraError = () => Promise.reject(Object.assign(new Error('putus'), { code: 'ENOTFOUND' }));

    await guard.run('tenant-a', 'ors', infraError);
    await guard.run('tenant-b', 'ors', infraError);
    expect(guard.getCircuitState('tenant-a', 'ors')).toBe('OPEN');
    expect(guard.getCircuitState('tenant-b', 'ors')).toBe('OPEN');

    guard.reset('tenant-a');
    expect(guard.getCircuitState('tenant-a', 'ors')).toBe('CLOSED');
    expect(guard.getCircuitState('tenant-b', 'ors')).toBe('OPEN');
  });
});

describe('kunci API & status layanan per tenant', () => {
  it('apiKey dari DB mengalahkan env; tanpa konfigurasi memakai env', async () => {
    mockTenantSettings({
      'tenant-db': { integrationGuards: { ors: { apiKey: 'kunci-db' } } },
    });
    const guard = newGuard();

    await expect(guard.resolveApiKey('tenant-db', 'ors', 'kunci-env')).resolves.toBe('kunci-db');
    await expect(guard.resolveApiKey('tenant-tanpa-konfig', 'ors', 'kunci-env')).resolves.toBe('kunci-env');
    await expect(guard.resolveApiKey('tenant-tanpa-konfig', 'ors', '')).resolves.toBe('');
  });

  it('layanan dinonaktifkan per tenant tanpa mematikan tenant lain', async () => {
    mockTenantSettings({
      'tenant-mati': { integrationGuards: { ors: { enabled: false } } },
      'tenant-hidup': { integrationGuards: { ors: { enabled: true } } },
    });
    const guard = newGuard();
    const fnMati = vi.fn(async () => 'mati');
    const fnHidup = vi.fn(async () => 'hidup');

    await expect(guard.run('tenant-mati', 'ors', fnMati)).resolves.toBeNull();
    expect(fnMati).not.toHaveBeenCalled();
    await expect(guard.isEnabled('tenant-mati', 'ors')).resolves.toBe(false);

    await expect(guard.run('tenant-hidup', 'ors', fnHidup)).resolves.toBe('hidup');
    expect(fnHidup).toHaveBeenCalledTimes(1);
  });

  it('DB offline → perilaku lama: env tanpa batas harian (layanan tidak mati)', async () => {
    // tests/setup.ts membuat semua query Prisma reject "Database offline".
    const guard = newGuard();
    const fn = vi.fn(async () => 'ok');

    for (let i = 0; i < 5; i++) {
      await expect(guard.run('tenant-offline', 'ors', fn)).resolves.toBe('ok');
    }
    expect(fn).toHaveBeenCalledTimes(5);

    const quota = await guard.consume('tenant-offline', 'ors');
    expect(quota.allowed).toBe(true);
    expect(quota.limit).toBeNull();
  });

  it('penghitung KV bermasalah tidak memblokir layanan (fail-open)', async () => {
    mockTenantSettings({
      'tenant-kv-rusak': { integrationGuards: { ors: { dailyLimit: 1 } } },
    });
    const guard = newGuard();
    // @ts-expect-error — sengaja merusak KV untuk menguji fail-open.
    guard['kv'] = { incr: async () => Promise.reject(new Error('KV mati')) };
    const fn = vi.fn(async () => 'tetap-jalan');

    await expect(guard.run('tenant-kv-rusak', 'ors', fn)).resolves.toBe('tetap-jalan');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('klien nyata menghormati gerbang tenant', () => {
  it('ORS tidak memanggil axios saat kuota tenant habis', async () => {
    process.env.ORS_API_KEY = 'kunci-ors-nyata';
    mockTenantSettings({
      'tenant-habis': { integrationGuards: { ors: { dailyLimit: 1 } } },
    });
    const guard = newGuard();
    const client = new OrsClient(guard);
    const postSpy = vi
      .spyOn(axios, 'post')
      .mockResolvedValue({ data: { routes: [{ summary: { distance: 4200, duration: 900 } }] } } as any);

    await expect(client.calculateRoute(-7.2, 112.7, -7.3, 112.6, 'tenant-habis')).resolves.toEqual({
      distanceMeters: 4200,
      durationSeconds: 900,
    });
    expect(postSpy).toHaveBeenCalledTimes(1);

    // Kuota habis: fallback null tanpa panggilan network tambahan.
    await expect(client.calculateRoute(-7.2, 112.7, -7.3, 112.6, 'tenant-habis')).resolves.toBeNull();
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  it('Google Distance Matrix tidak memanggil axios saat circuit tenant OPEN', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'kunci-gmaps-nyata';
    mockTenantSettings({
      'tenant-circuit': {
        integrationGuards: {
          googleDistanceMatrix: { slidingWindowSize: 1, failureThreshold: 0, cooldownMs: 60_000 },
        },
      },
      'tenant-lain': {},
    });
    const guard = newGuard();
    const client = new GoogleDistanceMatrixClient(undefined, guard);

    const getSpy = vi
      .spyOn(axios, 'get')
      .mockRejectedValue(Object.assign(new Error('dns mati'), { code: 'ENOTFOUND' }));

    await expect(
      client.calculateDistance(-7.2, 112.7, -7.3, 112.6, 'tenant-circuit')
    ).resolves.toBeNull();
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(guard.getCircuitState('tenant-circuit', 'googleDistanceMatrix')).toBe('OPEN');

    // Circuit OPEN: tidak ada panggilan axios kedua.
    await expect(
      client.calculateDistance(-7.2, 112.7, -7.3, 112.6, 'tenant-circuit')
    ).resolves.toBeNull();
    expect(getSpy).toHaveBeenCalledTimes(1);

    // Tenant lain tidak terpengaruh circuit tenant-circuit.
    getSpy.mockResolvedValue({
      data: {
        status: 'OK',
        rows: [{ elements: [{ status: 'OK', distance: { value: 5000 }, duration: { value: 800 } }] }],
      },
    } as any);
    await expect(
      client.calculateDistance(-7.2, 112.7, -7.3, 112.6, 'tenant-lain')
    ).resolves.toEqual({ distanceMeters: 5000, durationSeconds: 800 });
    expect(getSpy).toHaveBeenCalledTimes(2);
  });
});
