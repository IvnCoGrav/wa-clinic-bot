import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { buildApp } from '../../src/app';
import { StaffReservationService } from '../../src/services/staff-reservation.service';
import { memoryReservations } from '../../src/routes/admin/stores';
import { followUpService } from '../../src/services/follow-up.service';

const ADMIN_KEY = 'test_admin_key_status_transition';

describe('Reservation Status Transition Guard Tests (Fase 0 - A-001 & A-002)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memoryReservations.clear();
    process.env.ADMIN_API_KEY = ADMIN_KEY;
  });

  it('0.1: DELETE ?soft=true pada reservasi completed HARUS ditolak dengan 409 (ILLEGAL_TRANSITION)', async () => {
    const mockRes = {
      id: 'res-completed-1',
      tenant_id: 'default-tenant',
      customer_id: 'cust-1',
      status: 'completed',
      booking_date: new Date('2026-11-01T10:00:00Z'),
      customer: { id: 'cust-1', name: 'Bunda Test', phone: '62811' },
      google_calendar_event_id: null,
    };

    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(mockRes as any);
    vi.mocked(prisma.reservation.update).mockResolvedValue({
      ...mockRes,
      status: 'cancelled',
    } as any);
    vi.mocked(prisma.followUp.findFirst).mockResolvedValue({ id: 'existing-f' } as any);
    vi.spyOn(followUpService, 'onReservationCancelled').mockResolvedValue(undefined as any);

    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/reservation/res-completed-1?soft=true',
      headers: { 'x-api-key': ADMIN_KEY },
    });

    // Pada kode saat ini (A-001), soft-cancel pada completed berhasil (200).
    // Seharusnya ditolak 409 (ILLEGAL_TRANSITION).
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.code || body.error).toMatch(/ILLEGAL_TRANSITION|Transisi.*ditolak/i);

    await app.close();
  });

  it('0.2a: staff completeTask pada reservasi status hold HARUS ditolak', async () => {
    const mockHoldRes = {
      id: 'res-hold-1',
      tenant_id: 'default-tenant',
      customer_id: 'cust-hold-1',
      status: 'hold',
      booking_date: new Date(),
      assigned_staff_id: 'staff-1',
      purchase_occurred_at: new Date(),
    };

    vi.mocked(prisma.reservation.findUnique).mockResolvedValue(mockHoldRes as any);
    vi.mocked(prisma.reservation.update).mockResolvedValue({
      ...mockHoldRes,
      status: 'completed',
    } as any);

    const result = await StaffReservationService.completeTask({
      reservationId: 'res-hold-1',
      staffId: 'staff-1',
      tenantId: 'default-tenant',
      staffName: 'Bidan Test',
      isSupervisor: false,
      forceUnpaid: false,
    });

    // Pada kode saat ini (A-002), completeTask mengizinkan hold diselesaikan (success: true).
    // Seharusnya ditolak (success: false).
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/transisi|tidak dapat diselesaikan|status/i);
  });

  it('0.2b: staff completeTask pada booking H+7 (masa depan) HARUS ditolak (premature guard)', async () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const mockFutureRes = {
      id: 'res-future-1',
      tenant_id: 'default-tenant',
      customer_id: 'cust-future-1',
      status: 'confirmed',
      booking_date: futureDate,
      assigned_staff_id: 'staff-1',
      purchase_occurred_at: new Date(),
    };

    vi.mocked(prisma.reservation.findUnique).mockResolvedValue(mockFutureRes as any);
    vi.mocked(prisma.reservation.update).mockResolvedValue({
      ...mockFutureRes,
      status: 'completed',
    } as any);

    const result = await StaffReservationService.completeTask({
      reservationId: 'res-future-1',
      staffId: 'staff-1',
      tenantId: 'default-tenant',
      staffName: 'Bidan Test',
      isSupervisor: false,
      forceUnpaid: false,
    });

    // Pada kode saat ini (A-002), booking masa depan diselesaikan tanpa guard prematur.
    // Seharusnya ditolak (success: false).
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/masa depan|premature|sebelum tanggal/i);
  });
  it('0.3: PATCH /api/admin/reservation/:id dengan transisi ilegal (completed -> confirmed) ditolak 409 ILLEGAL_TRANSITION (P8)', async () => {
    const mockCompletedRes = {
      id: 'res-completed-edit',
      tenant_id: 'default-tenant',
      customer_id: 'cust-1',
      status: 'completed',
      booking_date: new Date('2026-11-01T10:00:00Z'),
      customer: { id: 'cust-1', name: 'Bunda Test', phone: '62811' },
      assigned_staff_id: 'staff-1',
    };

    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(mockCompletedRes as any);

    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/reservation/res-completed-edit',
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      payload: {
        status: 'confirmed',
      },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('ILLEGAL_TRANSITION');
    expect(body.error).toMatch(/Transisi completed → confirmed ditolak/i);

    await app.close();
  });
});
