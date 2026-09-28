import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { FastifyInstance } from 'fastify';
import { StaffAuthService } from '../../src/services/staff-auth.service';
import { prisma } from '../../src/db/client';
import { queueService } from '../../src/services/queue.service';
import { staffTripTrackingService } from '../../src/services/staff-trip-tracking.service';

const ADMIN_KEY = 'test_admin_key_trip_dispatch';
const ADMIN_HEADERS = { 'x-api-key': ADMIN_KEY };

const TENANT = 'default-tenant';
const STAFF_ID = 'staff-trip-1';
const RES_ID = 'res-trip-1';

/**
 * Seam: HTTP response endpoint (public interface) untuk fitur dispatch trip.
 * Tujuan: CS dapat memantau posisi terapis realtime + teks jawaban siap kirim,
 * dengan isolasi tenant & anti-IDOR (bukan happy-path saja).
 */
describe('Staff Trip Telemetry & Admin Dispatch (Fase 2)', () => {
  let app: FastifyInstance;

  const staffSession = {
    id: 'session-trip-1',
    staff_id: STAFF_ID,
    token_hash: 'hash',
    created_at: new Date(),
    expires_at: new Date(Date.now() + 3600000),
    revoked_at: null,
    staff: {
      id: STAFF_ID,
      name: 'Bidan Dewi',
      phone: '08123456789',
      password_hash: 'hash',
      role: 'THERAPIST' as any,
      active: true,
      tenant_id: TENANT,
      created_at: new Date(),
      updated_at: new Date(),
    },
  };

  const reservationRow = {
    id: RES_ID,
    tenant_id: TENANT,
    status: 'confirmed',
    assigned_staff_id: STAFF_ID,
    otw_sent_at: new Date(),
    arrived_at: null,
    booking_date: new Date(),
    customer: { id: 'cust-1', name: 'Bunda Rina', lat: -7.28, lng: 112.74 },
  };

  beforeAll(async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    process.env.HUMANIZER_ENABLED = 'false';
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await queueService.close();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    staffTripTrackingService.clearAll();
    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue(staffSession as any);
  });

  const staffHeaders = { cookie: 'staff_session=valid_token' };

  it('POST /api/staff/telemetry menolak tanpa sesi (401 fail-closed)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/staff/telemetry',
      payload: { reservationId: RES_ID, lat: -7.28, lng: 112.74 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /api/staff/telemetry menolak koordinat invalid (400) tanpa menulis trip', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce(reservationRow as any);
    const res = await app.inject({
      method: 'POST',
      url: '/api/staff/telemetry',
      headers: staffHeaders,
      payload: { reservationId: RES_ID, lat: 999, lng: 112.74 },
    });
    expect(res.statusCode).toBe(400);
    expect(staffTripTrackingService.getTrip(TENANT, RES_ID)).toBeNull();
  });

  it('POST /api/staff/telemetry menolak lintas-tenant (404 anti-IDOR)', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      ...reservationRow,
      tenant_id: 'tenant-lain',
    } as any);
    const res = await app.inject({
      method: 'POST',
      url: '/api/staff/telemetry',
      headers: staffHeaders,
      payload: { reservationId: RES_ID, lat: -7.28, lng: 112.74 },
    });
    expect(res.statusCode).toBe(404);
    expect(staffTripTrackingService.getTrip(TENANT, RES_ID)).toBeNull();
  });

  it('POST /api/staff/telemetry menolak terapis bukan pemilik jadwal (403)', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      ...reservationRow,
      assigned_staff_id: 'staff-lain',
    } as any);
    const res = await app.inject({
      method: 'POST',
      url: '/api/staff/telemetry',
      headers: staffHeaders,
      payload: { reservationId: RES_ID, lat: -7.28, lng: 112.74 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST /api/staff/telemetry sukses menulis trip + kembalikan areaName', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce(reservationRow as any);
    const res = await app.inject({
      method: 'POST',
      url: '/api/staff/telemetry',
      headers: staffHeaders,
      payload: { reservationId: RES_ID, lat: -7.28, lng: 112.74, speed: 4, accuracy: 12 },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(typeof body.data.areaName).toBe('string');
    expect(staffTripTrackingService.getTrip(TENANT, RES_ID)?.staffId).toBe(STAFF_ID);
  });

  it('POST /api/staff/telemetry menolak jadwal yang sudah selesai (400)', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      ...reservationRow,
      status: 'completed',
    } as any);
    const res = await app.inject({
      method: 'POST',
      url: '/api/staff/telemetry',
      headers: staffHeaders,
      payload: { reservationId: RES_ID, lat: -7.28, lng: 112.74 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/staff/trip/stop menghapus trip (privasi mati saat tiba)', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce(reservationRow as any);
    await app.inject({
      method: 'POST',
      url: '/api/staff/telemetry',
      headers: staffHeaders,
      payload: { reservationId: RES_ID, lat: -7.28, lng: 112.74 },
    });
    expect(staffTripTrackingService.getTrip(TENANT, RES_ID)).not.toBeNull();

    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce(reservationRow as any);
    const stop = await app.inject({
      method: 'POST',
      url: '/api/staff/trip/stop',
      headers: staffHeaders,
      payload: { reservationId: RES_ID },
    });
    expect(stop.statusCode).toBe(200);
    expect(staffTripTrackingService.getTrip(TENANT, RES_ID)).toBeNull();
  });

  it('GET /api/admin/dispatch/trip/:id butuh autentikasi (401)', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/admin/dispatch/trip/${RES_ID}` });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/admin/dispatch/trip/:id 404 lintas-tenant', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      ...reservationRow,
      tenant_id: 'tenant-lain',
    } as any);
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/dispatch/trip/${RES_ID}`,
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/admin/dispatch/trip/:id mengembalikan progress + readyText DB-driven', async () => {
    staffTripTrackingService.recordTripPing(TENANT, RES_ID, STAFF_ID, {
      lat: -7.28,
      lng: 112.74,
      speed: 4,
      accuracy: 12,
    });
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce(reservationRow as any);
    // followUpTemplate DB offline (mock reject) → fallback rolling template tetap terisi.
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/dispatch/trip/${RES_ID}`,
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.trip).not.toBeNull();
    expect(body.data.trip.lastUpdateSec).toBeGreaterThanOrEqual(0);
    expect(body.data.remainingKm).toBeGreaterThanOrEqual(0);
    expect(body.data.etaMinutes).toBeGreaterThanOrEqual(1);
    expect(body.data.readyText.length).toBeGreaterThan(0);
    expect(body.data.readyText).toContain('Bunda Rina');
  });

  it('GET /api/admin/dispatch/trip/:id tanpa ping → trip null tapi tidak error', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce(reservationRow as any);
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/dispatch/trip/${RES_ID}`,
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.trip).toBeNull();
    expect(body.data.isStalledOutsideTarget).toBe(false);
    expect(body.data.readyText.length).toBeGreaterThan(0);
  });
});
