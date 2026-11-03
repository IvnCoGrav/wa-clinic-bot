import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryRevenue } from '../../src/services/copilot/copilot-tools';
import { prisma } from '../../src/db/client';

describe('query_revenue tool (Fase 4 — rekap pendapatan & omzet)', () => {
  const tenantId = 'test-tenant';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mengembalikan komponen terpisah (purchaseValue, deliveryFee, discount, receiptAmount) tanpa dijumlahkan paksa', async () => {
    vi.spyOn(prisma.reservation, 'findMany').mockResolvedValueOnce([
      {
        booking_date: new Date('2026-11-03T03:00:00Z'),
        purchase_value: 150_000,
        delivery_fee: 25_000,
        discount_amount: 10_000,
        receipt_amount: 165_000,
        treatment_detail: 'Pijat Bayi Sehat',
        treatment_category: 'BABY',
        assigned_staff: { id: 's1', name: 'Bidan Rina' },
      } as any,
      {
        booking_date: new Date('2026-11-03T06:00:00Z'),
        purchase_value: 200_000,
        delivery_fee: 30_000,
        discount_amount: 0,
        receipt_amount: 230_000,
        treatment_detail: 'Pijat Bayi Sehat',
        treatment_category: 'BABY',
        assigned_staff: { id: 's1', name: 'Bidan Rina' },
      } as any,
    ]);

    const result = await queryRevenue.run(tenantId, { dateFrom: '2026-11-03', groupBy: 'day' });

    expect(result.tool).toBe('query_revenue');
    expect(result.count).toBe(1);
    const row = result.rows[0];
    expect(row.bucket).toBe('2026-11-03');
    expect(row.reservations).toBe(2);
    expect(row.purchaseValue).toBe(350_000);
    expect(row.deliveryFee).toBe(55_000);
    expect(row.discount).toBe(10_000);
    expect(row.receiptAmount).toBe(395_000);
  });

  it('mengelompokkan per treatment saat groupBy === "treatment"', async () => {
    vi.spyOn(prisma.reservation, 'findMany').mockResolvedValueOnce([
      {
        booking_date: new Date('2026-11-03T03:00:00Z'),
        purchase_value: 150_000,
        delivery_fee: 20_000,
        discount_amount: 0,
        receipt_amount: 170_000,
        treatment_detail: 'Pijat Bayi Batuk Pilek',
        treatment_category: 'BABY',
        assigned_staff: null,
      } as any,
      {
        booking_date: new Date('2026-11-03T05:00:00Z'),
        purchase_value: 250_000,
        delivery_fee: 20_000,
        discount_amount: 0,
        receipt_amount: 270_000,
        treatment_detail: 'Pijat Laktasi',
        treatment_category: 'MOMS',
        assigned_staff: null,
      } as any,
    ]);

    const result = await queryRevenue.run(tenantId, { groupBy: 'treatment' });

    expect(result.count).toBe(2);
    const bapil = result.rows.find((r) => r.bucket.includes('Batuk Pilek'));
    const laktasi = result.rows.find((r) => r.bucket.includes('Laktasi'));

    expect(bapil?.purchaseValue).toBe(150_000);
    expect(laktasi?.purchaseValue).toBe(250_000);
  });

  it('mengelompokkan per staff saat groupBy === "staff"', async () => {
    vi.spyOn(prisma.reservation, 'findMany').mockResolvedValueOnce([
      {
        booking_date: new Date('2026-11-03T03:00:00Z'),
        purchase_value: 180_000,
        delivery_fee: 0,
        discount_amount: 0,
        receipt_amount: 180_000,
        treatment_detail: 'Baby Spa',
        treatment_category: 'BABY',
        assigned_staff: { id: 's2', name: 'Bidan Siti' },
      } as any,
    ]);

    const result = await queryRevenue.run(tenantId, { groupBy: 'staff' });

    expect(result.count).toBe(1);
    expect(result.rows[0].bucket).toBe('Bidan Siti');
    expect(result.rows[0].purchaseValue).toBe(180_000);
  });
});
