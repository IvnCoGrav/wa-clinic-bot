import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { CronService } from '../../src/services/cron.service';

vi.mock('../../src/services/media.service', () => ({
  getAllTenantIds: vi.fn().mockResolvedValue(['default-tenant']),
}));

/**
 * KB-1 & A-003 — Auto-expire reservasi hold berbasis jendela 2 jam (ACTIVE_HOLD_WINDOW_MS).
 * Tenant-scoped, best-effort.
 */
describe('A-003 — runExpiredHoldSweep (created_at, jendela 2 jam)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('memanggil findMany + updateMany dengan filter tenant + status hold + cutoff ~2 jam', async () => {
    vi.mocked((prisma.reservation as any).findMany).mockResolvedValueOnce([
      { id: 'res-1', customer_id: 'cust-1' },
      { id: 'res-2', customer_id: 'cust-2' },
    ] as any);
    vi.mocked((prisma.reservation as any).updateMany).mockResolvedValueOnce({ count: 2 } as any);

    const cron = new CronService();
    await cron.runExpiredHoldSweep();

    const findCalls = vi.mocked((prisma.reservation as any).findMany).mock.calls;
    expect(findCalls.length).toBeGreaterThanOrEqual(1);
    const arg = findCalls[0][0] as any;
    expect(arg.where.tenant_id).toBe('default-tenant');
    expect(arg.where.status).toBe('hold');
    expect(arg.where.created_at.lt).toBeInstanceOf(Date);
    expect(arg.where.booking_date).toBeUndefined();

    const diffHours = (Date.now() - (arg.where.created_at.lt as Date).getTime()) / (1000 * 60 * 60);
    expect(diffHours).toBeGreaterThanOrEqual(1.9);
    expect(diffHours).toBeLessThanOrEqual(2.1);
  });

  it('hold yang masih dalam jendela 2 jam (misal 1 jam lalu) tidak masuk cutoff', async () => {
    const cron = new CronService();
    // Jika tidak ada row yang lt cutoff, updateMany tidak dipanggil
    vi.mocked((prisma.reservation as any).findMany).mockResolvedValueOnce([]);

    await cron.runExpiredHoldSweep();

    const updateCalls = vi.mocked((prisma.reservation as any).updateMany).mock.calls;
    expect(updateCalls.length).toBe(0);
  });

  it('DB offline → tidak melempar (best-effort)', async () => {
    vi.mocked((prisma.reservation as any).findMany).mockRejectedValueOnce(new Error('Database offline'));
    const cron = new CronService();
    await expect(cron.runExpiredHoldSweep()).resolves.toBeUndefined();
  });
});
