import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { CronService } from '../../src/services/cron.service';

vi.mock('../../src/services/media.service', () => ({
  getAllTenantIds: vi.fn().mockResolvedValue(['default-tenant']),
}));

/**
 * FASE 4.2 — Auto-expire reservasi hold yang tanggal kunjungannya sudah lewat.
 * Tenant-scoped, hanya menyentuh status 'hold', tidak menyentuh masa depan.
 */
describe('FASE 4.2 — runExpiredHoldSweep', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('memanggil updateMany dengan filter tenant + status hold + booking_date lampau', async () => {
    vi.mocked((prisma.reservation as any).updateMany).mockResolvedValueOnce({ count: 2 } as any);

    const cron = new CronService();
    await cron.runExpiredHoldSweep();

    const calls = vi.mocked((prisma.reservation as any).updateMany).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const arg = calls[0][0] as any;
    expect(arg.where.tenant_id).toBe('default-tenant');
    expect(arg.where.status).toBe('hold');
    expect(arg.where.booking_date.lt).toBeInstanceOf(Date);
    expect(arg.data.status).toBe('cancelled');
  });

  it('DB offline → tidak melempar (best-effort)', async () => {
    vi.mocked((prisma.reservation as any).updateMany).mockRejectedValueOnce(new Error('Database offline'));
    const cron = new CronService();
    await expect(cron.runExpiredHoldSweep()).resolves.toBeUndefined();
  });
});
