import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { auditService } from '../../src/services/audit.service';
import { reservationLifecycleService } from '../../src/services/reservation-lifecycle.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Fase 0 (characterization) — Kunci perilaku endpoint satuan
 * `PATCH /api/admin/reservation/:id/complete` SEBELUM menambahkan bulk-complete.
 *
 * Tujuan: memastikan refaktor "ekstraksi seam" (Fase 1) TIDAK mengubah perilaku
 * endpoint lama: guard prematur tetap menolak, jalur sukses tetap memanggil
 * lifecycle (efek samping follow-up/Sheets/reset sesi) + audit.
 */
const ADMIN_KEY = 'test_admin_key_bulk_complete';
const PAST_ISO = '2026-10-01T03:00:00.000Z';

describe('Characterization — PATCH /api/admin/reservation/:id/complete (satuan)', () => {
  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    vi.restoreAllMocks();
  });

  it('sukses: set completed + panggil lifecycle + tulis audit', async () => {
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: 'res-ok-1',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-ok-1',
      status: 'confirmed',
      booking_date: new Date(PAST_ISO),
      treatment_category: 'BABY',
    } as any);
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({
      id: 'res-ok-1',
      status: 'completed',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-ok-1',
    } as any);
    const lifecycle = vi
      .spyOn(reservationLifecycleService, 'onReservationCompleted')
      .mockResolvedValue(undefined as any);
    const audit = vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/reservation/res-ok-1/complete',
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.status).toBe('completed');
    expect(lifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: 'res-ok-1', customerId: 'cust-ok-1', tenantId: DEFAULT_TENANT_ID })
    );
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'COMPLETE_RESERVATION', targetId: 'res-ok-1' }));
  });

  it('prematur: booking_date > 24 jam ke depan DITOLAK, tanpa update/lifecycle', async () => {
    const farFuture = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: 'res-future-1',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-future-1',
      status: 'confirmed',
      booking_date: new Date(farFuture),
      treatment_category: 'BABY',
    } as any);
    const update = vi.mocked(prisma.reservation.update);
    const lifecycle = vi.spyOn(reservationLifecycleService, 'onReservationCompleted').mockResolvedValue(undefined as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/reservation/res-future-1/complete',
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('PREMATURE_COMPLETION_BLOCKED');
    expect(update).not.toHaveBeenCalled();
    expect(lifecycle).not.toHaveBeenCalled();
  });
});
