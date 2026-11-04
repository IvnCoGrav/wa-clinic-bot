import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { queryReservationsByFilter } from '../../src/services/copilot/copilot-tools';

describe('Copilot unpaid reservations (Fase 8 - Menutup V9)', () => {
  const tenantId = 'tenant-test';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mengambil daftar pasien yang belum bayar dan menghitung totalUnpaidAmount secara deterministik', async () => {
    vi.spyOn(prisma.reservation, 'findMany').mockResolvedValueOnce([
      {
        id: 'res-1',
        booking_date: new Date('2026-11-03T03:00:00Z'),
        status: 'completed',
        treatment_detail: 'Baby Spa',
        purchase_value: 150000,
        delivery_fee: 25000,
        purchase_occurred_at: null, // belum bayar -> SELESAI_BELUM_VERIFIKASI
        customer: { id: 'c1', name: 'Bunda Sarah', phone: '6281234567801', conversations: [] },
        assigned_staff: { name: 'Thabita' },
      },
      {
        id: 'res-2',
        booking_date: new Date('2026-11-03T07:00:00Z'),
        status: 'confirmed',
        treatment_detail: 'Mom Massage',
        purchase_value: 200000,
        delivery_fee: 30000,
        purchase_occurred_at: null, // belum bayar -> TAGIH_DI_TEMPAT
        customer: { id: 'c2', name: 'Bunda Dewi', phone: '6281234567802', conversations: [] },
        assigned_staff: { name: 'Yusi' },
      },
      {
        id: 'res-3',
        booking_date: new Date('2026-11-03T09:00:00Z'),
        status: 'completed',
        treatment_detail: 'Kids Spa',
        purchase_value: 120000,
        delivery_fee: 20000,
        purchase_occurred_at: new Date('2026-11-03T10:00:00Z'), // LUNAS
        customer: { id: 'c3', name: 'Bunda Rini', phone: '6281234567803', conversations: [] },
        assigned_staff: { name: 'Thabita' },
      },
    ] as any);

    const result = await queryReservationsByFilter.run(tenantId, {
      date: '2026-11-03',
      paymentStatus: 'unpaid',
    });

    expect(result.summaryFacts).toBeDefined();
    expect(result.summaryFacts.totalUnpaidReservations).toBe(2);
    expect(result.summaryFacts.totalUnpaidAmount).toBe(175000 + 230000); // 405000

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].customerName).toBe('Bunda Sarah');
    expect(result.rows[0].paymentStatus).toBe('SELESAI_BELUM_VERIFIKASI');
    expect(result.rows[0].unpaidAmount).toBe(175000);
    expect(result.rows[0].isPaid).toBe(false);

    expect(result.rows[1].customerName).toBe('Bunda Dewi');
    expect(result.rows[1].paymentStatus).toBe('TAGIH_DI_TEMPAT');
    expect(result.rows[1].unpaidAmount).toBe(230000);
    expect(result.rows[1].isPaid).toBe(false);

    // Pasien res-3 (lunas) tidak masuk dalam filter 'unpaid'
    const res3 = result.rows.find((r: any) => r.id === 'res-3');
    expect(res3).toBeUndefined();
  });

  it('filter paymentStatus "paid" hanya mengembalikan reservasi yang sudah lunas', async () => {
    vi.spyOn(prisma.reservation, 'findMany').mockResolvedValueOnce([
      {
        id: 'res-paid',
        booking_date: new Date('2026-11-03T09:00:00Z'),
        status: 'completed',
        treatment_detail: 'Kids Spa',
        purchase_value: 120000,
        delivery_fee: 20000,
        purchase_occurred_at: new Date('2026-11-03T10:00:00Z'),
        customer: { id: 'c3', name: 'Bunda Rini', phone: '6281234567803', conversations: [] },
        assigned_staff: { name: 'Thabita' },
      },
    ] as any);

    const result = await queryReservationsByFilter.run(tenantId, {
      date: '2026-11-03',
      paymentStatus: 'paid',
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].isPaid).toBe(true);
    expect(result.rows[0].paymentStatus).toBe('LUNAS');
    expect(result.rows[0].unpaidAmount).toBe(0);
  });
});
