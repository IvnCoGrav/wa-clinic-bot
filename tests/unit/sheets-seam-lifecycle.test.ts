import { describe, it, expect, beforeEach, vi } from 'vitest';
import { reservationLifecycleService } from '../../src/services/reservation-lifecycle.service';
import { sheetsSyncService } from '../../src/services/sheets/sheets-sync.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';

const ADMIN_KEY = 'test_admin_key_sheets_seam';

describe('Sheets Seam Lifecycle & Route Guards', () => {
  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  it('SEAM: onReservationCreated TIDAK memanggil sheetsSyncService.enqueue', async () => {
    const enqueueSpy = vi.spyOn(sheetsSyncService, 'enqueue').mockResolvedValue(undefined as any);

    await reservationLifecycleService.onReservationCreated({
      reservationId: 'res-new-1',
      tenantId: DEFAULT_TENANT_ID,
      customerId: 'cust-1',
      bookingDate: new Date('2026-10-15T02:00:00Z'),
    });

    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('SEAM: onReservationCompleted MEMANGGIL sheetsSyncService.enqueue tepat sekali', async () => {
    const enqueueSpy = vi.spyOn(sheetsSyncService, 'enqueue').mockResolvedValue(undefined as any);

    await reservationLifecycleService.onReservationCompleted({
      customerId: 'cust-1',
      reservationId: 'res-comp-1',
      bookingDate: new Date('2026-10-15T02:00:00Z'),
      tenantId: DEFAULT_TENANT_ID,
    });

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledWith('res-comp-1', DEFAULT_TENANT_ID);
  });

  it('ROUTE ADMIN EDIT: non-completed (confirmed) TIDAK enqueue sheets', async () => {
    const enqueueSpy = vi.spyOn(sheetsSyncService, 'enqueue').mockResolvedValue(undefined as any);

    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: 'res-edit-1',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-1',
      status: 'confirmed',
      booking_date: new Date('2026-10-15T02:00:00Z'),
    } as any);

    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({
      id: 'res-edit-1',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-1',
      status: 'confirmed',
      treatment_detail: 'Update Detail',
    } as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/reservation/res-edit-1',
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      payload: { treatment_detail: 'Update Detail' },
    });

    expect(res.statusCode).toBe(200);
    // Tunggu microtask fire-and-forget
    await new Promise((r) => setTimeout(r, 50));
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('ROUTE ADMIN EDIT: status completed MEMANGGIL enqueue sheets', async () => {
    const enqueueSpy = vi.spyOn(sheetsSyncService, 'enqueue').mockResolvedValue(undefined as any);

    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: 'res-edit-2',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-1',
      status: 'completed',
      booking_date: new Date('2026-10-15T02:00:00Z'),
    } as any);

    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({
      id: 'res-edit-2',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-1',
      status: 'completed',
      treatment_detail: 'Update Catatan',
    } as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/reservation/res-edit-2',
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      payload: { treatment_detail: 'Update Catatan' },
    });

    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(enqueueSpy).toHaveBeenCalledWith('res-edit-2', DEFAULT_TENANT_ID);
  });

  it('ROUTE ADMIN ASSIGN: status non-completed TIDAK enqueue sheets', async () => {
    const enqueueSpy = vi.spyOn(sheetsSyncService, 'enqueue').mockResolvedValue(undefined as any);

    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: 'res-assign-1',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-1',
      status: 'scheduled',
      booking_date: new Date('2026-10-15T02:00:00Z'),
    } as any);

    vi.mocked(prisma.staff.findFirst).mockResolvedValueOnce({
      id: 'staff-1',
      tenant_id: DEFAULT_TENANT_ID,
      name: 'Bidan Siti',
    } as any);

    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({
      id: 'res-assign-1',
      tenant_id: DEFAULT_TENANT_ID,
      status: 'scheduled',
      assigned_staff_id: 'staff-1',
    } as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/reservation/res-assign-1/assign-staff',
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      payload: { assigned_staff_id: 'staff-1' },
    });

    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('STAFF RECORD PAYMENT: review sudah SENT tetap memicu sheetsSyncService.enqueue', async () => {
    const enqueueSpy = vi.spyOn(sheetsSyncService, 'enqueue').mockResolvedValue(undefined as any);
    const { StaffReservationService } = await import('../../src/services/staff-reservation.service');

    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      id: 'res-pay-1',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-1',
      status: 'confirmed',
      booking_date: new Date('2026-10-15T02:00:00Z'),
      treatment_detail: 'Pijat Laktasi',
      treatment_category: 'MOMS',
      purchase_value: 150000,
      delivery_fee: 15000,
      customer: { id: 'cust-1', name: 'Bunda A', conversations: [] },
    } as any);

    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({
      id: 'res-pay-1',
      status: 'completed',
    } as any);

    // Mock followUp.findFirst agar mengembalikan follow-up yang sudah SENT
    (prisma as any).followUp = {
      findFirst: vi.fn().mockResolvedValueOnce({ id: 'fu-sent-1', status: 'SENT' }),
    };

    const res = await StaffReservationService.recordPayment({
      reservationId: 'res-pay-1',
      tenantId: DEFAULT_TENANT_ID,
      staffId: 'staff-1',
      staffName: 'Bidan Siti',
      isSupervisor: true,
      amount: 165000,
      paymentMethod: 'CASH',
    });

    expect(res.success).toBe(true);
    expect(enqueueSpy).toHaveBeenCalledWith('res-pay-1', DEFAULT_TENANT_ID);
  });
});
