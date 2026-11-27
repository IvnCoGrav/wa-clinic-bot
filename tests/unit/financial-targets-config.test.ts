import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import {
  getFinancialTargets,
  clearFinancialTargetsCache,
  DEFAULT_FINANCIAL_TARGETS,
} from '../../src/config/financial-targets';

describe('financial-targets.config', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearFinancialTargetsCache();
  });

  it('mengembalikan default saat DB offline atau tenant settings belum diset', async () => {
    vi.spyOn(prisma.tenant, 'findUnique').mockRejectedValue(new Error('Database offline'));

    const targets = await getFinancialTargets('tenant-123');
    expect(targets).toEqual(DEFAULT_FINANCIAL_TARGETS);
    expect(targets.monthlyRevenueTarget).toBeNull();
    expect(targets.monthlyBookingTarget).toBeNull();
  });

  it('membaca target dari Tenant.settings.financialTargets', async () => {
    vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({
      settings: {
        financialTargets: {
          monthlyRevenueTarget: 75000000,
          monthlyBookingTarget: 200,
        },
      },
    } as any);

    const targets = await getFinancialTargets('tenant-abc');
    expect(targets.monthlyRevenueTarget).toBe(75000000);
    expect(targets.monthlyBookingTarget).toBe(200);
  });

  it('menggunakan cache 5 menit dan clearFinancialTargetsCache bekerja', async () => {
    const spy = vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({
      settings: {
        financialTargets: {
          monthlyRevenueTarget: 50000000,
          monthlyBookingTarget: 150,
        },
      },
    } as any);

    const first = await getFinancialTargets('tenant-cached');
    expect(first.monthlyRevenueTarget).toBe(50000000);
    expect(spy).toHaveBeenCalledTimes(1);

    // Call kedua harus dari cache
    const second = await getFinancialTargets('tenant-cached');
    expect(second.monthlyRevenueTarget).toBe(50000000);
    expect(spy).toHaveBeenCalledTimes(1);

    // Setelah clear cache, query DB lagi
    clearFinancialTargetsCache('tenant-cached');
    const third = await getFinancialTargets('tenant-cached');
    expect(third.monthlyRevenueTarget).toBe(50000000);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
