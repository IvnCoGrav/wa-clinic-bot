import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { buildApp } from '../../src/app';
import { reservationArchiveService } from '../../src/services/reservation-archive.service';
import { followUpService } from '../../src/services/follow-up.service';
import { memoryReservations } from '../../src/routes/admin/stores';

const ADMIN_KEY = 'test_admin_key_delete_contract';

describe('DELETE /api/admin/reservation/:id — Kontrak & Resiliensi Error (#300)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memoryReservations.clear();
    process.env.ADMIN_API_KEY = ADMIN_KEY;
  });

  it('1. DELETE tanpa query -> 200 ARSIP (archiveId ada, reservation.update TIDAK dipanggil)', async () => {
    const mockRes = {
      id: 'res-arc-1',
      tenant_id: 'default-tenant',
      customer_id: 'cust-1',
      status: 'confirmed',
      customer: { id: 'cust-1', name: 'Bunda Test', phone: '62811' },
      google_calendar_event_id: null,
    };

    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(mockRes as any);
    const updateSpy = vi.mocked(prisma.reservation.update);
    const archiveSpy = vi.spyOn(reservationArchiveService, 'archiveReservation').mockResolvedValue({
      archiveId: 'arc-123',
      restoreUntil: new Date('2026-12-31'),
    } as any);

    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/reservation/res-arc-1',
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.archiveId).toBe('arc-123');
    expect(archiveSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it('2. DELETE ?soft=true -> 200 SOFT-CANCEL (status cancelled, onReservationCancelled dipanggil)', async () => {
    const mockRes = {
      id: 'res-soft-1',
      tenant_id: 'default-tenant',
      customer_id: 'cust-soft-1',
      status: 'confirmed',
      customer: { id: 'cust-soft-1', name: 'Bunda Soft', phone: '62822' },
      google_calendar_event_id: null,
    };

    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(mockRes as any);
    const updateSpy = vi.mocked(prisma.reservation.update).mockResolvedValue({
      ...mockRes,
      status: 'cancelled',
    } as any);
    vi.mocked(prisma.followUp.findFirst).mockResolvedValue({ id: 'existing-f' } as any);
    const cancelFUSpy = vi.spyOn(followUpService, 'onReservationCancelled').mockResolvedValue(undefined as any);
    const archiveSpy = vi.spyOn(reservationArchiveService, 'archiveReservation');

    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/reservation/res-soft-1?soft=true',
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'res-soft-1' },
        data: { status: 'cancelled' },
      })
    );
    expect(cancelFUSpy).toHaveBeenCalledWith('res-soft-1', 'default-tenant');
    expect(archiveSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it('3. DELETE id tidak ada di DB & memory -> 404 Reservation not found', async () => {
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null);

    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/reservation/res-not-found',
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Reservation not found');
    await app.close();
  });

  it('4. DELETE saat DB reject & memory kosong -> 503 DB_UNAVAILABLE (bukan 404)', async () => {
    vi.mocked(prisma.reservation.findFirst).mockRejectedValue(new Error('Database offline'));

    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/reservation/res-db-down',
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.code).toBe('DB_UNAVAILABLE');
    expect(body.error).toMatch(/Basis data tidak dapat diakses/i);
    await app.close();
  });

  it('5. DELETE saat DB reject tetapi memory punya data -> 200 memory fallback', async () => {
    vi.mocked(prisma.reservation.findFirst).mockRejectedValue(new Error('Database offline'));
    memoryReservations.set('res-mem-1', {
      id: 'res-mem-1',
      tenant_id: 'default-tenant',
      customer_id: 'cust-mem',
      status: 'confirmed',
    });

    const app = buildApp();
    await app.ready();

    // Skenario arsip di memory
    const resArchive = await app.inject({
      method: 'DELETE',
      url: '/api/admin/reservation/res-mem-1',
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(resArchive.statusCode).toBe(200);
    expect(memoryReservations.has('res-mem-1')).toBe(false);

    // Skenario cancel di memory
    memoryReservations.set('res-mem-2', {
      id: 'res-mem-2',
      tenant_id: 'default-tenant',
      customer_id: 'cust-mem-2',
      status: 'confirmed',
    });

    const resCancel = await app.inject({
      method: 'DELETE',
      url: '/api/admin/reservation/res-mem-2?soft=true',
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(resCancel.statusCode).toBe(200);
    expect(memoryReservations.get('res-mem-2')?.status).toBe('cancelled');
    await app.close();
  });
});
