import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * FASE 2a — WAHA tenant seam (PLAN 8).
 * Menguji resolver tenant dari WAHA session id: fallback graceful, cache ber-TTL,
 * dan ketahanan adversarial (DB offline, session kosong, tenant tidak ditemukan).
 */

const findFirst = vi.fn();

vi.mock('../../src/db/client', () => ({
  prisma: {
    tenant: {
      findFirst: (...args: any[]) => findFirst(...args),
    },
  },
}));

async function loadService() {
  vi.resetModules();
  const mod = await import('../../src/services/waha-tenant.service');
  return mod.wahaTenantService;
}

describe('FASE 2a — WAHA tenant resolution', () => {
  beforeEach(() => {
    findFirst.mockReset();
  });

  it('session undefined → DEFAULT_TENANT_ID tanpa query DB', async () => {
    const svc = await loadService();
    const result = await svc.resolveTenantBySession(undefined);
    expect(result).toBe(DEFAULT_TENANT_ID);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('session string kosong → DEFAULT_TENANT_ID (adversarial)', async () => {
    const svc = await loadService();
    expect(await svc.resolveTenantBySession('')).toBe(DEFAULT_TENANT_ID);
    expect(await svc.resolveTenantBySession('   ')).toBe(DEFAULT_TENANT_ID);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('DB offline (query reject) → DEFAULT_TENANT_ID, tidak throw', async () => {
    findFirst.mockRejectedValue(new Error('Database offline'));
    const svc = await loadService();
    await expect(svc.resolveTenantBySession('sess-1')).resolves.toBe(DEFAULT_TENANT_ID);
  });

  it('DB mengembalikan tenant → id tenant yang benar', async () => {
    findFirst.mockResolvedValue({ id: 'tenant-kala-2' });
    const svc = await loadService();
    expect(await svc.resolveTenantBySession('sess-2')).toBe('tenant-kala-2');
  });

  it('session tidak ditemukan di DB → DEFAULT_TENANT_ID', async () => {
    findFirst.mockResolvedValue(null);
    const svc = await loadService();
    expect(await svc.resolveTenantBySession('sess-unknown')).toBe(DEFAULT_TENANT_ID);
  });

  it('cache: query kedua untuk session sama tidak memanggil Prisma lagi', async () => {
    findFirst.mockResolvedValue({ id: 'tenant-cached' });
    const svc = await loadService();
    await svc.resolveTenantBySession('sess-cache');
    await svc.resolveTenantBySession('sess-cache');
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('cache expired setelah TTL → query ulang', async () => {
    findFirst.mockResolvedValue({ id: 'tenant-ttl' });
    const svc = await loadService();
    await svc.resolveTenantBySession('sess-ttl');
    expect(findFirst).toHaveBeenCalledTimes(1);

    // Maju 5 menit + 1 detik
    const realNow = Date.now;
    Date.now = () => realNow() + 5 * 60 * 1000 + 1000;
    try {
      await svc.resolveTenantBySession('sess-ttl');
      expect(findFirst).toHaveBeenCalledTimes(2);
    } finally {
      Date.now = realNow;
    }
  });

  it('resetCache memaksa query ulang', async () => {
    findFirst.mockResolvedValue({ id: 'tenant-reset' });
    const svc = await loadService();
    await svc.resolveTenantBySession('sess-reset');
    svc.resetCache();
    await svc.resolveTenantBySession('sess-reset');
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('adversarial: query throw → tidak meng-cache hasil fallback (retry berikutnya tetap mencoba DB)', async () => {
    findFirst.mockRejectedValueOnce(new Error('boom'));
    const svc = await loadService();
    await svc.resolveTenantBySession('sess-flaky');
    // DB pulih
    findFirst.mockResolvedValue({ id: 'tenant-recovered' });
    expect(await svc.resolveTenantBySession('sess-flaky')).toBe('tenant-recovered');
  });
});
