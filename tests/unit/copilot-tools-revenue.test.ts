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

    expect(result.count).toBe(3); // 2 treatment + 1 baris TOTAL
    const bapil = result.rows.find((r) => r.bucket.includes('Batuk Pilek'));
    const laktasi = result.rows.find((r) => r.bucket.includes('Laktasi'));
    const total = result.rows.find((r) => r.bucket === 'TOTAL');

    expect(bapil?.purchaseValue).toBe(150_000);
    expect(laktasi?.purchaseValue).toBe(250_000);
    expect(total?.purchaseValue).toBe(400_000);
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

  it('Fase 3: menyertakan bookingValue, grossRevenue, paid/pending, basis, dan statusFilter kanonis', async () => {
    vi.spyOn(prisma.reservation, 'findMany').mockResolvedValueOnce([
      {
        booking_date: new Date('2026-11-04T03:00:00Z'),
        purchase_value: 200_000,
        discount_amount: 25_000,
        delivery_fee: 15_000,
        purchase_occurred_at: new Date('2026-11-04T04:00:00Z'), // Lunas
        treatment_detail: 'Pijat Bayi',
        assigned_staff: { id: 's1', name: 'Bidan Rina' },
      } as any,
      {
        booking_date: new Date('2026-11-04T05:00:00Z'),
        purchase_value: 150_000,
        discount_amount: 0,
        delivery_fee: 10_000,
        purchase_occurred_at: null, // Pending
        treatment_detail: 'Baby Spa',
        assigned_staff: { id: 's2', name: 'Bidan Siti' },
      } as any,
    ]);

    const result = await queryRevenue.run(tenantId, { dateFrom: '2026-11-04', groupBy: 'day' });

    expect(result.summaryFacts).toBeDefined();
    // Res 1: gross 200k, diskon 25k, net 175k + ongkir 15k = 190k (lunas)
    // Res 2: gross 150k, diskon 0, net 150k + ongkir 10k = 160k (pending)
    // Total gross = 350k
    // Total discount = 25k
    // Total bookingValue = 190k + 160k = 350k
    // Total paid = 190k, total pending = 160k
    expect(result.summaryFacts.grossRevenue).toBe(350_000);
    expect(result.summaryFacts.totalDiscount).toBe(25_000);
    expect(result.summaryFacts.bookingValue).toBe(350_000);
    expect(result.summaryFacts.totalRevenue).toBe(350_000);
    expect(result.summaryFacts.paidAmount).toBe(190_000);
    expect(result.summaryFacts.pendingAmount).toBe(160_000);
    expect(result.summaryFacts.paidAmount + result.summaryFacts.pendingAmount).toBe(result.summaryFacts.bookingValue);
    expect(result.summaryFacts.basis).toBe('booking_date');
    expect(result.summaryFacts.statusFilter).toBe('all_non_cancelled');

    const row = result.rows[0];
    expect(row.bookingValue).toBe(350_000);
    expect(row.grossRevenue).toBe(350_000);
    expect(row.discount).toBe(25_000);
    expect(row.paidAmount).toBe(190_000);
    expect(row.pendingAmount).toBe(160_000);
    expect(row.basis).toBe('booking_date');
    expect(row.statusFilter).toBe('all_non_cancelled');
  });
});
