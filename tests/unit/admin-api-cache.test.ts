import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Regression tests for the admin-dashboard SWR cache (audit 2026-09-17).
 *
 * Root cause of the "duplicated / stale Delivery Tier" report: `apiRequest`
 * caches GET responses for 15s (memory + sessionStorage) and there was no
 * primitive for a manual "Reload" to bypass it. Additionally
 * `getCachedApiResponse` ignored TTL entirely, so pages could hydrate from
 * arbitrarily old entries.
 *
 * These tests pin the contract:
 *  - stale entries are NOT returned for normal hydration,
 *  - stale entries ARE returned only as explicit network-failure fallback,
 *  - `refreshApi` clears the cached entry and forces a network fetch.
 *
 * The module keeps state at module scope, so we import it fresh per test via
 * `vi.resetModules()` and install lightweight globals (node env has no
 * sessionStorage / fetch).
 */

class MemoryStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

function installGlobals() {
  (globalThis as any).sessionStorage = new MemoryStorage();
  (globalThis as any).localStorage = new MemoryStorage();
}

function jsonResponse(body: any, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as any;
}

async function freshModule() {
  vi.resetModules();
  return import('../../packages/admin-dashboard/src/services/api');
}

describe('admin-dashboard API cache — TTL & hard refresh (audit 2026-09-17)', () => {
  beforeEach(() => {
    installGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getCachedApiResponse returns a fresh entry within TTL', async () => {
    const { getCachedApiResponse } = await freshModule();
    (globalThis as any).sessionStorage.setItem(
      'apiCache:/api/admin/delivery-tiers',
      JSON.stringify({ data: { success: true, data: [{ id: 1 }] }, timestamp: Date.now(), ttlMs: 15000 })
    );
    const got = getCachedApiResponse('/api/admin/delivery-tiers');
    expect(got).toEqual({ success: true, data: [{ id: 1 }] });
  });

  it('getCachedApiResponse does NOT return an expired entry for hydration', async () => {
    const { getCachedApiResponse } = await freshModule();
    (globalThis as any).sessionStorage.setItem(
      'apiCache:/api/admin/delivery-tiers',
      JSON.stringify({ data: { success: true, data: [] }, timestamp: Date.now() - 60000, ttlMs: 15000 })
    );
    expect(getCachedApiResponse('/api/admin/delivery-tiers')).toBeNull();
  });

  it('getCachedApiResponse CAN return an expired entry when allowStale (network fallback)', async () => {
    const { getCachedApiResponse } = await freshModule();
    (globalThis as any).sessionStorage.setItem(
      'apiCache:/api/admin/delivery-tiers',
      JSON.stringify({ data: { success: true, data: [{ id: 9 }] }, timestamp: Date.now() - 60000, ttlMs: 15000 })
    );
    const got = getCachedApiResponse('/api/admin/delivery-tiers', { allowStale: true });
    expect(got).toEqual({ success: true, data: [{ id: 9 }] });
  });

  it('apiRequest serves the cached entry without hitting the network', async () => {
    const { apiRequest } = await freshModule();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: 'net' }));
    (globalThis as any).fetch = fetchMock;
    (globalThis as any).sessionStorage.setItem(
      'apiCache:/api/admin/delivery-tiers',
      JSON.stringify({ data: { ok: 'cache' }, timestamp: Date.now(), ttlMs: 15000 })
    );
    const res = await apiRequest('/api/admin/delivery-tiers');
    expect(res).toEqual({ ok: 'cache' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshApi bypasses the cache and fetches fresh data (delivery-tier regression)', async () => {
    const { apiRequest, refreshApi } = await freshModule();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: 'net', data: [1, 2, 3, 4, 5, 6, 7] }));
    (globalThis as any).fetch = fetchMock;
    // seed a STALE cached payload that would otherwise be served
    (globalThis as any).sessionStorage.setItem(
      'apiCache:/api/admin/delivery-tiers',
      JSON.stringify({ data: { ok: 'cache', data: 'stale' }, timestamp: Date.now(), ttlMs: 15000 })
    );

    // sanity: plain request returns cache
    expect((await apiRequest('/api/admin/delivery-tiers') as any).ok).toBe('cache');

    // hard refresh must ignore the 15s window
    const fresh = await refreshApi('/api/admin/delivery-tiers');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fresh as any).ok).toBe('net');
    // the previously-stale entry must have been REPLACED by the fresh payload
    const cachedNow = JSON.parse((globalThis as any).sessionStorage.getItem('apiCache:/api/admin/delivery-tiers'));
    expect(cachedNow.data.ok).toBe('net');
  });

  it('adversarial: two sequential refreshApi calls always hit the network (no self-caching)', async () => {
    const { refreshApi } = await freshModule();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ n: 1 }))
      .mockResolvedValueOnce(jsonResponse({ n: 2 }));
    (globalThis as any).fetch = fetchMock;

    const a = await refreshApi('/api/admin/delivery-tiers');
    const b = await refreshApi('/api/admin/delivery-tiers');
    expect((a as any).n).toBe(1);
    expect((b as any).n).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('adversarial: refreshApi normalizes bare endpoint to /api/admin/*', async () => {
    const { refreshApi } = await freshModule();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    (globalThis as any).fetch = fetchMock;
    await refreshApi('delivery-tiers');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/delivery-tiers');
  });
});

describe('Admin API responses must be non-cacheable (browser/proxy stale-data guard)', () => {
  // Root cause of the "Delivery Fee Tiering 14 tier" report: `/api/admin/*` GETs
  // sent NO Cache-Control, so a browser may heuristically cache the JSON and
  // re-serve it on direct navigation / reload — showing stale or duplicated data
  // even though the server (and DB) are correct.
  it('GET /api/admin/delivery-tiers sends Cache-Control: no-store', async () => {
    const { buildApp } = await import('../../src/app');
    process.env.ADMIN_API_KEY = 'test-key-cache';
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/delivery-tiers',
        headers: { 'x-api-key': 'test-key-cache' },
      });
      expect(res.statusCode).toBe(200);
      const cc = String(res.headers['cache-control'] || '');
      expect(cc).toContain('no-store');
      expect(String(res.headers['pragma'] || '')).toContain('no-cache');
    } finally {
      await app.close();
    }
  });

  it('even an unauthenticated admin API 401 carries no-store (header set before auth)', async () => {
    const { buildApp } = await import('../../src/app');
    process.env.ADMIN_API_KEY = 'test-key-cache-2';
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/admin/delivery-tiers' });
      expect(res.statusCode).toBe(401);
      expect(String(res.headers['cache-control'] || '')).toContain('no-store');
    } finally {
      await app.close();
    }
  });
});
