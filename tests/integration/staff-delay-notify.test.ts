import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { StaffAuthService } from '../../src/services/staff-auth.service';
import { queueService } from '../../src/services/queue.service';
import { staffDepartureWatchdogService } from '../../src/services/staff-departure-watchdog.service';
import { StaffReservationService } from '../../src/services/staff-reservation.service';

const ADMIN_KEY = 'test_admin_key_delay_notify';

describe('Staff Delay Template & Notify Integration', () => {
  let app: FastifyInstance;

  const mockStaffSession = {
    id: 'session-123',
    staff_id: 'staff-thabita',
    token_hash: 'mock_token_hash',
    created_at: new Date(),
    expires_at: new Date(Date.now() + 86400000),
    staff: {
      id: 'staff-thabita',
      name: 'Bidan Thabita',
      phone: '083172360876',
      role: 'THERAPIST' as any,
      active: true,
      tenant_id: 'default-tenant',
      created_at: new Date(),
      updated_at: new Date(),
    },
  };

  beforeAll(async () => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await queueService.close();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue(mockStaffSession);
  });

  describe('GET /api/staff/delay-template', () => {
    it('mengembalikan draf pesan keterlambatan tanpa nomor HP', async () => {
      vi.spyOn(prisma.reservation, 'findUnique').mockResolvedValue({
        id: 'res-abc',
        tenant_id: 'default-tenant',
        assigned_staff_id: 'staff-thabita',
        status: 'confirmed',
        customer: { id: 'c1', name: 'Rina', lat: -7.25, lng: 112.75 },
        assigned_staff: { name: 'Bidan Thabita' },
      } as any);

      vi.spyOn(StaffReservationService, 'getTripDelayMessageText').mockResolvedValue(
        'Halo Bunda Rina, mohon maaf Bidan Thabita sedang dalam perjalanan dan mengalami sedikit keterlambatan.'
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/staff/delay-template?reservationId=res-abc&delayMinutes=25',
        headers: { cookie: 'staff_session=valid_token' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.text).toContain('Bunda Rina');
      expect(body.text).toContain('Bidan Thabita');
      // SOP no-HP: respons tidak boleh memuat pola nomor HP
      expect(res.body).not.toMatch(/628\d{8,12}|08\d{8,12}/);
    });

    it('menolak 400 jika reservationId tidak disertakan', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/staff/delay-template',
        headers: { cookie: 'staff_session=valid_token' },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
      expect(body.error).toContain('reservationId');
    });
  });

  describe('POST /api/staff/reservations/:id/notify-delay', () => {
    it('berhasil memanggil notifyDelayToAdmin dan hanya mengembalikan recipientCount', async () => {
      vi.spyOn(staffDepartureWatchdogService, 'notifyDelayToAdmin').mockResolvedValue({
        success: true,
        recipientCount: 2,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/staff/reservations/res-abc/notify-delay',
        headers: { cookie: 'staff_session=valid_token' },
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.recipientCount).toBe(2);
      // Tidak ada nomor HP yang bocor
      expect(res.body).not.toMatch(/628\d{8,12}|08\d{8,12}/);
    });

    it('mengembalikan 400 dengan kode error jika notifyDelayToAdmin gagal', async () => {
      vi.spyOn(staffDepartureWatchdogService, 'notifyDelayToAdmin').mockResolvedValue({
        success: false,
        code: 'ADMIN_RECIPIENTS_EMPTY',
        error: 'Nomor WhatsApp admin belum dikonfigurasi di Setelan Klinik.',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/staff/reservations/res-abc/notify-delay',
        headers: { cookie: 'staff_session=valid_token' },
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
      expect(body.code).toBe('ADMIN_RECIPIENTS_EMPTY');
    });
  });

  describe('GET /api/admin/live-chat/delay-alerts', () => {
    it('mengembalikan daftar delay alerts untuk admin CS tanpa 403', async () => {
      vi.spyOn(staffDepartureWatchdogService, 'listTodayDelayAlerts').mockResolvedValue([
        {
          reservationId: 'res-abc',
          staffId: 'staff-thabita',
          staffName: 'Bidan Thabita',
          patientName: 'Bunda Rina',
          bookingDate: new Date(),
          etaMinutes: 45,
          delayMinutes: 30,
          level: 'warning',
          estimatedArrivalWib: '11:30',
          missedDeparture: true,
          originSource: 'staff_base',
          originName: 'Demak Surabaya',
          delayText: 'Estimasi tiba 11:30',
        },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/live-chat/delay-alerts',
        headers: { 'x-api-key': ADMIN_KEY },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].staffName).toBe('Bidan Thabita');
      expect(body.data[0].level).toBe('warning');
    });
  });
});
