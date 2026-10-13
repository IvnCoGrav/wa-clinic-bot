import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { FastifyInstance } from 'fastify';
import { StaffAuthService } from '../../src/services/staff-auth.service';
import { prisma } from '../../src/db/client';
import { queueService } from '../../src/services/queue.service';
import { liveChatService } from '../../src/services/live-chat.service';
import { StaffReservationService } from '../../src/services/staff-reservation.service';
import { staffTripTrackingService } from '../../src/services/staff-trip-tracking.service';
import { auditService } from '../../src/services/audit.service';

const ADMIN_KEY = 'test_admin_key_guard';
const TENANT = 'default-tenant';
const STAFF_ID = 'staff-guard-1';
const RES_ID = 'res-guard-1';

describe('Staff Treatment Time Guard & Anti-Spam Arrival', () => {
  let app: FastifyInstance;

  const staffSession = {
    id: 'session-guard-1',
    staff_id: STAFF_ID,
    token_hash: 'hash',
    created_at: new Date(),
    expires_at: new Date(Date.now() + 3600000),
    revoked_at: null,
    staff: {
      id: STAFF_ID,
      name: 'Bidan Uli',
      phone: '08123456789',
      password_hash: 'hash',
      role: 'THERAPIST' as any,
      active: true,
      tenant_id: TENANT,
      created_at: new Date(),
      updated_at: new Date(),
    },
  };

  const supervisorSession = {
    ...staffSession,
    id: 'session-supervisor-1',
    staff_id: 'staff-supervisor-1',
    staff: {
      ...staffSession.staff,
      id: 'staff-supervisor-1',
      name: 'Supervisor Maya',
      role: 'spv_cs' as any,
    },
  };

  const baseReservation = {
    id: RES_ID,
    tenant_id: TENANT,
    status: 'confirmed',
    assigned_staff_id: STAFF_ID,
    otw_sent_at: null,
    arrived_at: null,
    booking_date: new Date(Date.now() + 30 * 60 * 1000),
    customer: {
      id: 'cust-guard-1',
      name: 'Bunda Narita',
      lat: -7.28,
      lng: 112.74,
      conversations: [{ id: 'conv-guard-1', tenant_id: TENANT }],
    },
    assigned_staff: { name: 'Bidan Uli' },
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
    vi.spyOn(liveChatService, 'sendAdminReply').mockResolvedValue({ success: true } as any);
    vi.mocked(prisma.reservation.update).mockResolvedValue({ id: RES_ID, status: 'en_route' } as any);
  });

  const staffHeaders = { cookie: 'staff_session=valid_token' };

  it('Kasus 1: OTW H-30 mnt -> lolos (200)', async () => {
    const bookingDate = new Date(Date.now() + 30 * 60 * 1000);
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      ...baseReservation,
      booking_date: bookingDate,
    } as any);

    const res = await app.inject({
      method: 'POST',
      url: `/api/staff/reservations/${RES_ID}/otw`,
      headers: staffHeaders,
      payload: { customText: '' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });

  it('Kasus 2: OTW H-3 jam -> tolak "Pesan OTW hanya dapat dikirim maksimal 2 jam sebelum jam reservasi."', async () => {
    const bookingDate = new Date(Date.now() + 180 * 60 * 1000); // 3 jam lagi
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      ...baseReservation,
      booking_date: bookingDate,
    } as any);

    const res = await app.inject({
      method: 'POST',
      url: `/api/staff/reservations/${RES_ID}/otw`,
      headers: staffHeaders,
      payload: { customText: '' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Pesan OTW hanya dapat dikirim maksimal 2 jam sebelum jam reservasi');
  });

  it('Kasus 3: OTW janji + 20 mnt (lewat batas toleransi 15 mnt) -> tolak "Jadwal treatment sudah masuk jam pelaksanaan"', async () => {
    const bookingDate = new Date(Date.now() - 20 * 60 * 1000); // 20 mnt yang lalu
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      ...baseReservation,
      booking_date: bookingDate,
    } as any);

    const res = await app.inject({
      method: 'POST',
      url: `/api/staff/reservations/${RES_ID}/otw`,
      headers: staffHeaders,
      payload: { customText: '' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Jadwal treatment sudah masuk jam pelaksanaan / telah lewat');
  });

  it('Kasus 3b: OTW janji + 20 mnt oleh Supervisor -> lolos bypass (200)', async () => {
    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValueOnce(supervisorSession as any);
    const bookingDate = new Date(Date.now() - 20 * 60 * 1000);
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      ...baseReservation,
      booking_date: bookingDate,
    } as any);

    const res = await app.inject({
      method: 'POST',
      url: `/api/staff/reservations/${RES_ID}/otw`,
      headers: staffHeaders,
      payload: { customText: '' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });

  it('Kasus 4: Tiba 10 detik setelah OTW -> DB update tapi WA kedua ditahan (anti-spam rapid arrival)', async () => {
    const otwSentAt = new Date(Date.now() - 10 * 1000); // 10 detik lalu
    const auditSpy = vi.spyOn(auditService, 'logAdminAction').mockResolvedValue({} as any);
    const sendReplySpy = vi.spyOn(liveChatService, 'sendAdminReply');

    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      ...baseReservation,
      otw_sent_at: otwSentAt,
    } as any);
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({
      ...baseReservation,
      otw_sent_at: otwSentAt,
      arrived_at: new Date(),
    } as any);

    const result = await StaffReservationService.recordArrival({
      reservationId: RES_ID,
      staffId: STAFF_ID,
      tenantId: TENANT,
      staffName: 'Bidan Uli',
    });

    expect(result.success).toBe(true);
    expect(result.data?.arrivalWaSuppressed).toBe(true);
    expect(result.data?.waResult).toBeNull();
    // WA tidak dikirim
    expect(sendReplySpy).not.toHaveBeenCalled();
    // Database tetap diupdate
    expect(prisma.reservation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: RES_ID },
        data: expect.objectContaining({ arrived_at: expect.any(Date) }),
      })
    );
    // Audit payload mencatat suppressed
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'STAFF_ARRIVED',
        payload: expect.objectContaining({
          arrivalWaSuppressed: true,
        }),
      })
    );
  });

  it('Kasus 5: Tiba langsung saat jam janji tanpa OTW -> lolos jadi arrived + kirim WA', async () => {
    const auditSpy = vi.spyOn(auditService, 'logAdminAction').mockResolvedValue({} as any);
    const sendReplySpy = vi.spyOn(liveChatService, 'sendAdminReply').mockResolvedValueOnce({ success: true, messageId: 'msg-1' } as any);

    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      ...baseReservation,
      otw_sent_at: null,
    } as any);
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({
      ...baseReservation,
      arrived_at: new Date(),
    } as any);

    const result = await StaffReservationService.recordArrival({
      reservationId: RES_ID,
      staffId: STAFF_ID,
      tenantId: TENANT,
      staffName: 'Bidan Uli',
    });

    expect(result.success).toBe(true);
    expect(result.data?.arrivalWaSuppressed).toBe(false);
    expect(result.data?.waResult).toEqual({ success: true, messageId: 'msg-1' });
    expect(sendReplySpy).toHaveBeenCalledTimes(1);
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'STAFF_ARRIVED',
        payload: expect.objectContaining({
          arrivalWaSuppressed: false,
        }),
      })
    );
  });
});
