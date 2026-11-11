import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { StaffReservationService } from '../../src/services/staff-reservation.service';

/**
 * S-07: nominal pembayaran lapangan TIDAK boleh dipercaya dari klien.
 * Server menghitung total resmi = item reservasi (atau purchase_value) + ongkir.
 */
describe('recordPayment — verifikasi nominal server (S-07)', () => {
  const base = {
    reservationId: 'res-s07',
    staffId: 'staff-1',
    staffName: 'Bidan A',
    tenantId: 'default-tenant',
    paymentMethod: 'CASH' as const,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockReservation = (overrides: any = {}) => {
    (prisma.reservation.findUnique as any).mockResolvedValue({
      id: 'res-s07',
      tenant_id: 'default-tenant',
      assigned_staff_id: 'staff-1',
      status: 'completed',
      booking_date: new Date('2026-11-10T03:00:00Z'),
      treatment_category: 'MOMS',
      purchase_value: null,
      delivery_fee: 20000,
      items: [{ price: 100000 }],
      customer: { id: 'cust-1', name: 'Bunda', conversations: [] },
      ...overrides,
    });
    (prisma.reservation.update as any).mockResolvedValue({
      id: 'res-s07',
      status: 'completed',
      purchase_value: 100000,
    });
  };

  it('nominal kurang dari tagihan resmi → ditolak, tidak menyimpan pembayaran', async () => {
    mockReservation();
    const res = await StaffReservationService.recordPayment({ ...base, amount: 100000 });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/tidak sesuai tagihan resmi/i);
    expect(prisma.reservation.update).not.toHaveBeenCalled();
  });

  it('nominal sesuai (item + ongkir) → diterima', async () => {
    mockReservation();
    const res = await StaffReservationService.recordPayment({ ...base, amount: 120000 });
    expect(res.success).toBe(true);
  });

  it('tanpa item: purchase_value + ongkir jadi acuan; nominal lama → ditolak', async () => {
    mockReservation({ purchase_value: 150000, items: [], delivery_fee: 15000 });
    const res = await StaffReservationService.recordPayment({ ...base, amount: 150000 });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/seharusnya: 165000/);
  });
});
