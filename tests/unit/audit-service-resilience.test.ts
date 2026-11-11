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

  it('memberi warning bila tenantId tidak diberikan dan memakai default', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const create = vi.spyOn(prisma.auditLog, 'create').mockResolvedValue({ id: 'a' } as any);
    await auditService.logAdminAction({ ...base });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('tenantId tidak diberikan'));
    expect((create.mock.calls[0][0] as any).data.tenant_id).toBe('default-tenant');
  });
});
