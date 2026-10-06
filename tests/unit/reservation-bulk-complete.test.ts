import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { auditService } from '../../src/services/audit.service';
import { reservationLifecycleService } from '../../src/services/reservation-lifecycle.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Fase 1 — Endpoint bulk-complete (`POST /api/admin/reservations/bulk-complete`).
 *
 * Kontrak yang dikunci:
 *  - hanya status confirmed/en_route yang boleh diselesaikan massal (ketat);
 *  - tiap id WAJIB milik tenant pemanggil (id tenant lain = NOT_FOUND, tanpa mutasi);
 *  - reservasi masa depan (prematur) dilewati, tanpa forceComplete;
 *  - id duplikat di-dedupe; >50 id atau body invalid = 400;
 *  - DB offline saat preflight = 503 eksplisit (batal total, bukan setengah jalan);
 *  - sukses memanggil lifecycle (efek samping) + SATU audit BULK_COMPLETE_RESERVATIONS.
 */
const ADMIN_KEY = 'test_admin_key_bulk_complete';
const URL = '/api/admin/reservations/bulk-complete';
const PAST = new Date('2026-10-01T03:00:00.000Z');

function row(over: Record<string, any> = {}) {
  return {
    id: 'res-1',
    tenant_id: DEFAULT_TENANT_ID,
    customer_id: 'cust-1',
    status: 'confirmed',
    booking_date: PAST,
    treatment_category: 'BABY',
    ...over,
  } as any;
}

describe('Bulk complete reservasi (Fase 1)', () => {
  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    vi.restoreAllMocks();
  });

  it('confirmed eligible → completed + lifecycle + 1 audit bulk', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([{ id: 'res-1' }] as any);
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(row({ id: 'res-1' }));
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce(row({ id: 'res-1', status: 'completed' }));
    const lifecycle = vi.spyOn(reservationLifecycleService, 'onReservationCompleted').mockResolvedValue(undefined as any);
    const audit = vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      payload: { ids: ['res-1'] },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.completed).toEqual(['res-1']);
    expect(body.skipped).toEqual([]);
    expect(lifecycle).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'BULK_COMPLETE_RESERVATIONS', payload: expect.objectContaining({ completed: ['res-1'] }) })
    );
  });

  it('campuran: eligible selesai, hold & future & missing dilewati dengan alasan', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }, { id: 'c' }] as any);
    vi.mocked(prisma.reservation.findFirst)
      .mockResolvedValueOnce(row({ id: 'a' })) // confirmed past → ok
      .mockResolvedValueOnce(row({ id: 'b', status: 'hold' })) // NOT_ELIGIBLE
      .mockResolvedValueOnce(row({ id: 'c', booking_date: new Date(Date.now() + 72 * 3600 * 1000) })) // PREMATURE
      .mockResolvedValueOnce(null as any); // d (missing) → NOT_FOUND
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce(row({ id: 'a', status: 'completed' }));
    const lifecycle = vi.spyOn(reservationLifecycleService, 'onReservationCompleted').mockResolvedValue(undefined as any);
    vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      payload: { ids: ['a', 'b', 'c', 'd'] },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.completed).toEqual(['a']);
    const reasons = Object.fromEntries(body.skipped.map((s: any) => [s.id, s.reason]));
    expect(reasons).toEqual({ b: 'NOT_ELIGIBLE', c: 'PREMATURE', d: 'NOT_FOUND' });
    expect(lifecycle).toHaveBeenCalledTimes(1);
  });

  it('id milik tenant lain → NOT_FOUND tanpa mutasi (anti kebocoran lintas-tenant)', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([] as any);
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(null as any); // scoped tenant → null
    const update = vi.mocked(prisma.reservation.update);
    const lifecycle = vi.spyOn(reservationLifecycleService, 'onReservationCompleted').mockResolvedValue(undefined as any);
    const audit = vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      payload: { ids: ['milik-tenant-lain'] },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.completed).toEqual([]);
    expect(body.skipped[0]).toMatchObject({ id: 'milik-tenant-lain', reason: 'NOT_FOUND' });
    expect(update).not.toHaveBeenCalled();
    expect(lifecycle).not.toHaveBeenCalled();
    // audit bulk tetap dicatat (jejak usaha admin), walau 0 berhasil.
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'BULK_COMPLETE_RESERVATIONS' }));
  });

  it('id duplikat di-dedupe (hanya 1 pemrosesan)', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([{ id: 'res-1' }] as any);
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(row({ id: 'res-1' }));
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce(row({ id: 'res-1', status: 'completed' }));
    vi.spyOn(reservationLifecycleService, 'onReservationCompleted').mockResolvedValue(undefined as any);
    vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      payload: { ids: ['res-1', 'res-1', ' res-1 '] },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).completed).toEqual(['res-1']);
  });

  it('lebih dari 50 id → 400 TOO_MANY', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `id-${i}`);
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      payload: { ids },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('TOO_MANY_IDS');
  });

  it('body invalid (ids bukan array / kosong) → 400', async () => {
    const app = buildApp();
    for (const payload of [{}, { ids: 'x' }, { ids: [] }, { ids: [123, null] }]) {
      const res = await app.inject({
        method: 'POST',
        url: URL,
        headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('DB offline saat preflight → 503 eksplisit, tanpa mutasi', async () => {
    vi.mocked(prisma.reservation.findMany).mockRejectedValueOnce(new Error('Database offline'));
    const update = vi.mocked(prisma.reservation.update);
    const lifecycle = vi.spyOn(reservationLifecycleService, 'onReservationCompleted').mockResolvedValue(undefined as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      payload: { ids: ['res-1'] },
    });

    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).code).toBe('DB_OFFLINE');
    expect(update).not.toHaveBeenCalled();
    expect(lifecycle).not.toHaveBeenCalled();
  });
});
