import { describe, it, expect } from 'vitest';
import { buildMonthlyCohorts } from '../../src/services/meta-performance-analytics.service';

describe('Meta Performance per-tenant Settings (A-001)', () => {
  const c1 = { id: 'c1', phone: '08123456789' };
  const c2 = { id: 'c2', phone: '08987654321' };

  const r2025_08 = {
    id: 'r_aug',
    tenant_id: 'tenant-a',
    customer_id: 'c1',
    created_at: '2025-08-10T03:00:00.000Z',
    booking_date: '2025-08-10T03:00:00.000Z',
    status: 'completed',
    purchase_value: 100000,
    treatment_detail: 'Pijat Bayi',
    delivery_fee: 0,
    customer: c1,
  };

  const r2026_02 = {
    id: 'r_feb',
    tenant_id: 'tenant-a',
    customer_id: 'c2',
    created_at: '2026-02-10T03:00:00.000Z',
    booking_date: '2026-02-10T03:00:00.000Z',
    status: 'completed',
    purchase_value: 120000,
    treatment_detail: 'Pijat Bayi',
    delivery_fee: 0,
    customer: c2,
  };

  it('Isolasi konfigurasi: Tenant A mengecualikan 2025-08, Tenant B tidak mengecualikan', async () => {
    // Tenant A: mengecualikan 2025-08
    const resA = await buildMonthlyCohorts({
      tenantId: 'tenant-a',
      historyReservations: [r2025_08, r2026_02],
      rangeReservations: [],
      matchedAds: [],
      now: new Date('2026-10-26T09:00:00.000Z'),
      treatmentFeeOf: async (r) => r.purchase_value,
      excludedCohortMonths: ['2025-08'],
    });

    const monthsA = resA.monthlyCohorts.map((row) => row.cohortMonth);
    expect(monthsA).not.toContain('2025-08');
    expect(monthsA).toContain('2026-02');

    // Tenant B: tanpa filter pengecualian
    const resB = await buildMonthlyCohorts({
      tenantId: 'tenant-b',
      historyReservations: [
        { ...r2025_08, tenant_id: 'tenant-b' },
        { ...r2026_02, tenant_id: 'tenant-b' },
      ],
      rangeReservations: [],
      matchedAds: [],
      now: new Date('2026-10-26T09:00:00.000Z'),
      treatmentFeeOf: async (r) => r.purchase_value,
      excludedCohortMonths: [],
    });

    const monthsB = resB.monthlyCohorts.map((row) => row.cohortMonth);
    expect(monthsB).toContain('2025-08');
    expect(monthsB).toContain('2026-02');
  });

  it('Filter batas awal cohortStartMonth memotong bulan sebelum batas', async () => {
    const res = await buildMonthlyCohorts({
      tenantId: 'tenant-a',
      historyReservations: [r2025_08, r2026_02],
      rangeReservations: [],
      matchedAds: [],
      now: new Date('2026-10-26T09:00:00.000Z'),
      treatmentFeeOf: async (r) => r.purchase_value,
      cohortStartMonth: '2026-01',
    });

    const months = res.monthlyCohorts.map((row) => row.cohortMonth);
    expect(months).not.toContain('2025-08');
    expect(months).toContain('2026-02');
  });
});
