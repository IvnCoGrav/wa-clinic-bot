import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { auditService } from '../../src/services/audit.service';

/** Cfg-009: audit retry 1x, tenant eksplisit, dan warning saat tenant kosong. */
describe('Audit service — ketahanan & tenant (Cfg-009)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const base = { apiKey: 'admin-key', adminIdentity: 'Admin', action: 'TEST_ACTION' };

  it('retry 1x saat create gagal sesaat, lalu sukses', async () => {
    const create = vi
      .spyOn(prisma.auditLog, 'create')
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({ id: 'audit-1' } as any);

    await auditService.logAdminAction({ ...base, tenantId: 'tenant-a' });

    expect(create).toHaveBeenCalledTimes(2);
    expect((create.mock.calls[1][0] as any).data.tenant_id).toBe('tenant-a');
  });

  it('tidak melempar walau gagal dua kali (operasional tetap jalan) tetapi log error', async () => {
    vi.spyOn(prisma.auditLog, 'create').mockRejectedValue(new Error('db down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(auditService.logAdminAction({ ...base, tenantId: 'tenant-a' })).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });

  it('fail-soft ke default-tenant + log error bila caller untyped mengirim tenantId kosong (tidak pernah menjatuhkan route jadi 500)', async () => {
    const create = vi.spyOn(prisma.auditLog, 'create').mockResolvedValueOnce({ id: 'audit-fallback' } as any);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(auditService.logAdminAction({ ...base, tenantId: '' })).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/tenantId kosong/i));
    expect(create).toHaveBeenCalledTimes(1);
    expect((create.mock.calls[0][0] as any).data.tenant_id).toBe('default-tenant');
  });

  it('ADVERSARIAL: payload circular + shared object + BigInt bersarang + Error tetap tersimpan aman tanpa throw', async () => {
    const create = vi.spyOn(prisma.auditLog, 'create').mockResolvedValueOnce({ id: 'audit-adv' } as any);
    const shared = { tag: 'x' };
    const cyclic: Record<string, any> = { sharedA: shared, sharedB: shared, total: BigInt('9007199254740995') };
    cyclic.self = cyclic;

    await expect(
      auditService.logAdminAction({
        ...base,
        tenantId: 'tenant-a',
        payload: {
          cyclic,
          err: new Error('phone 081299991111 leaked'),
        },
      })
    ).resolves.toBeUndefined();

    expect(create).toHaveBeenCalledTimes(1);
    const stored = JSON.parse((create.mock.calls[0][0] as any).data.payload);
    expect(stored.cyclic.sharedA).toEqual({ tag: 'x' });
    expect(stored.cyclic.sharedB).toEqual({ tag: 'x' });
    expect(stored.cyclic.self).toBe('[CIRCULAR]');
    expect(stored.cyclic.total).toBe('9007199254740995');
    expect(stored.err).toEqual({ name: 'Error' });
  });

  it('ADVERSARIAL: apiKey non-string (mis. array header) dan reject(null) tidak pernah melempar exception', async () => {
    const create = vi.spyOn(prisma.auditLog, 'create').mockRejectedValue(null);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      auditService.logAdminAction({
        ...(base as any),
        apiKey: ['key-1', 'key-2'] as any,
        tenantId: 'tenant-a',
      })
    ).resolves.toBeUndefined();

    expect(create).toHaveBeenCalledTimes(2);
    expect(errSpy).toHaveBeenCalled();
  });

  it('top-level JSON string payload tidak di-double-encode saat disimpan ke DB (A-011)', async () => {
    const create = vi.spyOn(prisma.auditLog, 'create').mockResolvedValueOnce({ id: 'audit-json' } as any);

    await auditService.logAdminAction({
      ...base,
      tenantId: 'tenant-a',
      payload: '{"phone":"081234567890","value":250000}',
    });

    const rawStored = (create.mock.calls[0][0] as any).data.payload;
    const parsed = JSON.parse(rawStored);
    expect(typeof parsed).toBe('object');
    expect(parsed.value).toBe(250000);
    expect(parsed.phone).toMatch(/^0812\*{4}7890$/);
  });
});
