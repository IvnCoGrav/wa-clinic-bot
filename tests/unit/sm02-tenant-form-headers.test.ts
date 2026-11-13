import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import {
  isReservationFormMessage,
  getTenantFormHeaders,
  clearTenantFormHeadersCacheForTest,
} from '../../src/utils/reservation-text-parser';

/**
 * SM-02 — header form tenant dari DB benar-benar dipakai (bukan inert).
 * Cache diisi di latar pada cache-miss; panggilan berikutnya data-driven.
 */
describe('SM-02 header form tenant data-driven', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTenantFormHeadersCacheForTest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearTenantFormHeadersCacheForTest();
  });

  it('memuat formHeaders tenant dari DB dan memakainya setelah warm-up', async () => {
    const findUnique = vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({
      settings: { formHeaders: ['registrasi khusus klinik zeta'] },
    } as any);

    const first = getTenantFormHeaders('tenant-z');
    expect(first).not.toContain('registrasi khusus klinik zeta');

    // Selesaikan warm-up latar.
    await new Promise((r) => setTimeout(r, 0));

    const second = getTenantFormHeaders('tenant-z');
    expect(second).toContain('registrasi khusus klinik zeta');
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('isReservationFormMessage mengenali header tenant setelah warm-up', async () => {
    vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({
      settings: { formHeaders: ['registrasi khusus klinik zeta'] },
    } as any);

    const text = 'registrasi khusus klinik zeta\nNama Bunda: Sari\nUsia: 30';
    // Panggilan pertama memicu warm-up; hasil mungkin belum memuat header tenant.
    isReservationFormMessage(text, { tenantId: 'tenant-z' });
    await new Promise((r) => setTimeout(r, 0));

    expect(isReservationFormMessage(text, { tenantId: 'tenant-z' })).toBe(true);
  });

  it('DB offline tetap memakai default (fail-open)', async () => {
    vi.spyOn(prisma.tenant, 'findUnique').mockRejectedValue(new Error('Database offline'));

    expect(getTenantFormHeaders('tenant-offline')).toEqual(
      expect.arrayContaining(['list untuk reservasi', 'format reservasi'])
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(getTenantFormHeaders('tenant-offline')).toEqual(
      expect.arrayContaining(['list untuk reservasi', 'format reservasi'])
    );
  });
});
