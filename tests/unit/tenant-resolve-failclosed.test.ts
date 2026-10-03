import { describe, it, expect, vi, afterEach } from 'vitest';
import { wahaTenantService } from '../../src/services/waha-tenant.service';
import { prisma } from '../../src/db/client';

/**
 * P0-1 (audit #199) — Resolusi tenant WAHA WAJIB fail-closed.
 * Sesi tak dikenal / DB offline DILARANG diam-diam jatuh ke DEFAULT_TENANT_ID.
 */
describe('WahaTenantService — fail-closed (anti lintas-tenant)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    wahaTenantService.resetCache();
  });

  it('session dikenal → kembalikan tenant id pemilik', async () => {
    vi.mocked(prisma.tenant.findFirst).mockResolvedValueOnce({ id: 'tenant-a' } as any);
    expect(await wahaTenantService.resolveTenantBySession('sess-a')).toBe('tenant-a');
  });

  it('session TIDAK dikenal → null (BUKAN default-tenant)', async () => {
    vi.mocked(prisma.tenant.findFirst).mockResolvedValueOnce(null);
    expect(await wahaTenantService.resolveTenantBySession('sess-unknown')).toBeNull();
  });

  it('DB offline → fallback DEFAULT_TENANT_ID + alert (availability saat single-tenant)', async () => {
    vi.mocked(prisma.tenant.findFirst).mockRejectedValueOnce(new Error('Database offline'));
    expect(await wahaTenantService.resolveTenantBySession('sess-a')).toBe('default-tenant');
  });

  it('session kosong/undefined → null', async () => {
    expect(await wahaTenantService.resolveTenantBySession(undefined)).toBeNull();
    expect(await wahaTenantService.resolveTenantBySession('')).toBeNull();
  });
});
