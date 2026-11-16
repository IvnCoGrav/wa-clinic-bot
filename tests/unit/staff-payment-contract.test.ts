import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { StaffReservationService } from '../../src/services/staff-reservation.service';

describe('recordPayment — kontrak status (F1)', () => {
  const base = {
    reservationId: 'res-f1',
    staffId: 'staff-1',
    staffName: 'Bidan Thabita',
    tenantId: 'default-tenant',
    paymentMethod: 'TRANSFER' as const,
    amount: 120000,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockReservation = (overrides: any = {}) => {
    (prisma.reservation.findUnique as any).mockResolvedValue({
      id: 'res-f1',
      tenant_id: 'default-tenant',
      assigned_staff_id: 'staff-1',
      status: 'confirmed',
      booking_date: new Date('2026-11-10T03:00:00Z'),
      treatment_category: 'MOMS',
      purchase_value: 100000,
      delivery_fee: 20000,
      items: [{ price: 100000 }],
      customer: { id: 'cust-1', name: 'Bunda', conversations: [] },
      ...overrides,
    });
    (prisma.reservation.update as any).mockImplementation((args: any) =>
      Promise.resolve({
        id: 'res-f1',
        status: args.data?.status ?? overrides.status ?? 'confirmed',
        purchase_value: args.data?.purchase_value ?? 100000,
        purchase_occurred_at: args.data?.purchase_occurred_at ?? new Date(),
      })
    );
  };

  it('reservasi confirmed + bayar -> data.status PAID, reservationStatus completed & completed true', async () => {
    mockReservation({ status: 'confirmed' });
    const res = await StaffReservationService.recordPayment({
      ...base,
      proofImageB64: 'data:image/jpeg;base64,xxxx',
    });

    expect(res.success).toBe(true);
    expect(res.data).toBeDefined();
    expect(res.data.status).toBe('PAID');
    expect(res.data.reservationStatus).toBe('completed');
    expect(res.data.completed).toBe(true);
    expect(res.data.alreadyPaid).toBe(false);
  });

  it('reservasi hold + bayar -> data.completed false dan reservationStatus tetap hold', async () => {
    mockReservation({ status: 'hold' });
    const res = await StaffReservationService.recordPayment({
      ...base,
      proofImageB64: 'data:image/jpeg;base64,xxxx',
    });

    expect(res.success).toBe(true);
    expect(res.data).toBeDefined();
    expect(res.data.status).toBe('PAID');
    expect(res.data.reservationStatus).toBe('hold');
    expect(res.data.completed).toBe(false);
    expect(res.data.alreadyPaid).toBe(false);
  });

  it('respons selalu memuat field status (bukan undefined)', async () => {
    mockReservation({ status: 'confirmed' });
    const res = await StaffReservationService.recordPayment({
      ...base,
      proofImageB64: 'data:image/jpeg;base64,xxxx',
    });

    expect(res.success).toBe(true);
    expect(res.data.status).toBeDefined();
    expect(typeof res.data.status).toBe('string');
  });
});
