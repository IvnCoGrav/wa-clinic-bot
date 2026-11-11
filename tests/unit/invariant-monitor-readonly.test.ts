import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { autoRepairLtvDrift, isInvariantAutoRepairEnabled } from '../../src/services/daily-invariant-monitor.service';
import { customerService } from '../../src/services/customer.service';

/**
 * K-008: invariant monitor default READ-ONLY. Auto-repair hanya berjalan bila
 * INVARIANT_MONITOR_AUTOREPAIR=true; kegagalan audit/alert tidak boleh senyap.
 */
describe('Invariant monitor — read-only default (K-008)', () => {
  const original = process.env.INVARIANT_MONITOR_AUTOREPAIR;

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.INVARIANT_MONITOR_AUTOREPAIR;
    (prisma as any).$queryRawUnsafe = vi.fn().mockResolvedValue([
      { id: 'c1', phone: '6281', name: 'Bunda A', ltv_cache: 1000, sum_val: 5000 },
    ]);
    (prisma as any).auditLog = { create: vi.fn().mockResolvedValue({}) };
  });

  afterEach(() => {
    if (original === undefined) delete process.env.INVARIANT_MONITOR_AUTOREPAIR;
    else process.env.INVARIANT_MONITOR_AUTOREPAIR = original;
  });

  it('default (env kosong) → read-only, tidak menulis/menghitung ulang', async () => {
    const recalc = vi.spyOn(customerService, 'recalculateCustomerLtv').mockResolvedValue(5000);
    expect(isInvariantAutoRepairEnabled()).toBe(false);

    const res = await autoRepairLtvDrift('tenant-k');

    expect(res.readOnly).toBe(true);
    expect(res.repaired).toBe(0);
    expect(res.flaggedForReview).toBe(1);
    expect(recalc).not.toHaveBeenCalled();
    expect((prisma as any).auditLog.create).not.toHaveBeenCalled();
  });

  it('env=true → auto-repair berjalan (recalc + audit)', async () => {
    process.env.INVARIANT_MONITOR_AUTOREPAIR = 'true';
    const recalc = vi.spyOn(customerService, 'recalculateCustomerLtv').mockResolvedValue(5000);
    expect(isInvariantAutoRepairEnabled()).toBe(true);

    const res = await autoRepairLtvDrift('tenant-k');

    expect(res.readOnly).toBe(false);
    expect(res.repaired).toBe(1);
    expect(recalc).toHaveBeenCalledWith('c1', 'tenant-k');
    expect((prisma as any).auditLog.create).toHaveBeenCalled();
  });
});
