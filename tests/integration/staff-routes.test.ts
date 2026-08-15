import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { StaffAuthService } from '../../src/services/staff-auth.service';
import { StaffReservationService } from '../../src/services/staff-reservation.service';
import { liveChatService } from '../../src/services/live-chat.service';
import { auditService } from '../../src/services/audit.service';
import { prisma } from '../../src/db/client';

describe('Staff Routes Integration Tests (/api/staff/*)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = 'test_admin_key_999';
  });

  describe('Staff Auth Endpoints', () => {
    it('POST /api/staff/auth/login requires phone and password', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/staff/auth/login',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toContain('wajib diisi');
    });

    it('POST /api/staff/auth/login returns 401 for invalid credentials', async () => {
      vi.spyOn(StaffAuthService, 'login').mockResolvedValue(null);

      const res = await app.inject({
        method: 'POST',
        url: '/api/staff/auth/login',
        payload: { phone: '08123456789', password: 'wrong' },
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error).toContain('salah');
    });

    it('POST /api/staff/auth/login returns 200 and sets staff_session cookie on success', async () => {
      vi.spyOn(StaffAuthService, 'login').mockResolvedValue({
        token: 'mock_token_abc',
        staff: {
          id: 'staff-1',
          name: 'Bidan Dewi',
          phone: '08123456789',
          password_hash: 'hash',
          role: 'THERAPIST' as any,
          active: true,
          tenant_id: 'default-tenant',
          created_at: new Date(),
          updated_at: new Date(),
        },
        expiresAt: new Date(Date.now() + 3600000),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/staff/auth/login',
        payload: { phone: '08123456789', password: 'correct' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.staff.name).toBe('Bidan Dewi');
      expect(body.token).toBe('mock_token_abc');
      expect(res.headers['set-cookie']).toBeDefined();
      expect(res.headers['set-cookie']).toContain('staff_session=mock_token_abc');
    });

    it('POST /api/staff/auth/restore re-issues staff_session cookie from stored token', async () => {
      vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue({
        id: 'session-1',
        token_hash: 'hash',
        staff_id: 'staff-1',
        expires_at: new Date(Date.now() + 3600000),
        revoked_at: null,
        created_at: new Date(),
        staff: {
          id: 'staff-1',
          name: 'Bidan Dewi',
          phone: '08123456789',
          role: 'THERAPIST',
          active: true,
        } as any,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/staff/auth/restore',
        payload: { token: 'stored_token_abc' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(res.headers['set-cookie']).toContain('staff_session=stored_token_abc');
    });

    it('POST /api/staff/auth/restore returns 401 for invalid token', async () => {
      vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue(null);

      const res = await app.inject({
        method: 'POST',
        url: '/api/staff/auth/restore',
        payload: { token: 'invalid_token' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('GET /api/staff/auth/me returns 401 when no session', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/staff/auth/me',
      });

      expect(res.statusCode).toBe(401);
    });

    it('GET /api/staff/auth/me returns active staff identity with valid session', async () => {
      vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue({
        id: 'session-1',
        staff_id: 'staff-1',
        token_hash: 'hash',
        created_at: new Date(),
        expires_at: new Date(Date.now() + 3600000),
        revoked_at: null,
        staff: {
          id: 'staff-1',
          name: 'Bidan Dewi',
          phone: '08123456789',
          password_hash: 'hash',
          role: 'THERAPIST' as any,
          active: true,
          tenant_id: 'default-tenant',
          created_at: new Date(),
          updated_at: new Date(),
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/staff/auth/me',
        headers: {
          cookie: 'staff_session=valid_token',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.authenticated).toBe(true);
      expect(body.staff.name).toBe('Bidan Dewi');
    });

    it('POST /api/staff/auth/logout clears staff_session cookie', async () => {
      vi.spyOn(StaffAuthService, 'logout').mockResolvedValue(true);

      const res = await app.inject({
        method: 'POST',
        url: '/api/staff/auth/logout',
        headers: {
          cookie: 'staff_session=token_to_logout',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['set-cookie']).toContain('staff_session=;');
      expect(StaffAuthService.logout).toHaveBeenCalledWith('token_to_logout');
    });
  });

  describe('Staff Today & Live Chat Endpoints', () => {
    const mockStaffSession = {
      id: 'session-1',
      staff_id: 'staff-1',
      token_hash: 'hash',
      created_at: new Date(),
      expires_at: new Date(Date.now() + 3600000),
      revoked_at: null,
      staff: {
        id: 'staff-1',
        name: 'Bidan Dewi',
        phone: '08123456789',
        password_hash: 'hash',
        role: 'THERAPIST' as any,
        active: true,
        tenant_id: 'default-tenant',
        created_at: new Date(),
        updated_at: new Date(),
      },
    };

    beforeEach(() => {
      vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue(mockStaffSession);
    });

    it('GET /api/staff/today-tasks returns today tasks for authenticated staff', async () => {
      vi.spyOn(StaffReservationService, 'getTodayTasks').mockResolvedValue([
        {
          reservationId: 'res-1',
          customerName: 'Bunda Rina',
          treatmentDetail: 'Pijat Bayi',
          bookingDate: new Date(),
          status: 'confirmed',
          conversationId: 'conv-101',
          mapsUrl: 'https://maps.google.com/?q=-7.2,112.7',
        },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/staff/today-tasks',
        headers: { cookie: 'staff_session=valid_token' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].customerName).toBe('Bunda Rina');
    });

    it('GET /api/staff/conversations/:id/messages returns 403 when conversation is not owned', async () => {
      vi.spyOn(StaffReservationService, 'assertConversationOwnedByStaffToday').mockResolvedValue(false);

      const res = await app.inject({
        method: 'GET',
        url: '/api/staff/conversations/conv-unowned/messages',
        headers: { cookie: 'staff_session=valid_token' },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error).toContain('tidak memiliki akses');
    });

    it('GET /api/staff/conversations/:id/messages returns messages when conversation is owned', async () => {
      vi.spyOn(StaffReservationService, 'assertConversationOwnedByStaffToday').mockResolvedValue(true);
      vi.spyOn(liveChatService, 'getConversationMessages').mockResolvedValue([
        { id: 'msg-1', content: 'Halo bidan' },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/staff/conversations/conv-owned/messages',
        headers: { cookie: 'staff_session=valid_token' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
    });

    it('GET /api/staff/upcoming-schedule returns future reservations', async () => {
      vi.spyOn(StaffReservationService, 'getUpcomingSchedule').mockResolvedValue([
        {
          reservationId: 'res-future-1',
          customerName: 'Bunda Riska',
          treatmentDetail: 'Terapi Bapil',
          bookingDate: new Date(Date.now() + 86400000),
          status: 'confirmed',
          conversationId: null,
          mapsUrl: 'https://maps.google.com/?q=-7.2,112.7',
        } as any,
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/staff/upcoming-schedule',
        headers: { cookie: 'staff_session=valid_token' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].customerName).toBe('Bunda Riska');
      expect(body.data[0].conversationId).toBeNull();
    });

    it('GET /api/staff/conversations/:id/messages caps returned messages to maximum 10 bubbles', async () => {
      vi.spyOn(StaffReservationService, 'assertConversationOwnedByStaffToday').mockResolvedValue(true);
      const fakeMessages = Array.from({ length: 25 }, (_, i) => ({
        id: `msg-${i + 1}`,
        content: `Pesan ${i + 1}`,
      }));
      vi.spyOn(liveChatService, 'getConversationMessages').mockResolvedValue(fakeMessages as any);

      const res = await app.inject({
        method: 'GET',
        url: '/api/staff/conversations/conv-owned/messages',
        headers: { cookie: 'staff_session=valid_token' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(10);
      expect(body.data[0].content).toBe('Pesan 16');
      expect(body.data[9].content).toBe('Pesan 25');
    });

    it('POST /api/staff/conversations/:id/reply blocks unowned conversation with 403', async () => {
      vi.spyOn(StaffReservationService, 'assertConversationOwnedByStaffToday').mockResolvedValue(false);

      const res = await app.inject({
        method: 'POST',
        url: '/api/staff/conversations/conv-unowned/reply',
        headers: { cookie: 'staff_session=valid_token' },
        payload: { text: 'Halo bunda' },
      });

      expect(res.statusCode).toBe(403);
    });

    it('POST /api/staff/conversations/:id/reply sends message and logs audit when owned', async () => {
      vi.spyOn(StaffReservationService, 'assertConversationOwnedByStaffToday').mockResolvedValue(true);
      vi.spyOn(liveChatService, 'sendAdminReply').mockResolvedValue({
        success: true,
        messageId: 'msg-out-1',
      } as any);
      const auditSpy = vi.spyOn(auditService, 'logAdminAction').mockResolvedValue();

      const res = await app.inject({
        method: 'POST',
        url: '/api/staff/conversations/conv-owned/reply',
        headers: { cookie: 'staff_session=valid_token' },
        payload: { text: 'Selamat pagi Bunda' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(liveChatService.sendAdminReply).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-owned',
          text: "Selamat pagi Bunda\n\n~ Bidan Dewi",
          adminName: 'Bidan Dewi',
        })
      );
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'STAFF_SESSION',
          adminIdentity: 'Bidan Dewi',
          action: 'STAFF_REPLY',
          targetId: 'conv-owned',
        })
      );
    });

    it('GET /api/staff/otw-template returns dynamic OTW text for patient', async () => {
      vi.spyOn(StaffReservationService, 'getOtwMessageText').mockResolvedValue(
        'Halo Bunda Aurel, saya Bidan Dewi dari Kala Spa sudah bersiap dan sedang dalam perjalanan menuju ke lokasi Bunda ya. Mohon ditunggu ya Bunda 🙏🛵'
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/staff/otw-template?patientName=Bunda%20Aurel',
        headers: { cookie: 'staff_session=valid_token' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.text).toContain('Bunda Aurel');
      expect(body.text).toContain('Bidan Dewi');
    });

    it('POST /api/staff/reservations/:id/payment records cash and non-cash payments', async () => {
      vi.spyOn(StaffReservationService, 'recordPayment').mockResolvedValue({
        success: true,
        data: {
          reservationId: 'res-101',
          purchaseValue: 200000,
          purchaseOccurredAt: new Date(),
          paymentMethod: 'TRANSFER',
          proofUrl: '/media/outbound/default-tenant/proof-res-101.jpg',
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/staff/reservations/res-101/payment',
        headers: { cookie: 'staff_session=valid_token' },
        payload: {
          paymentMethod: 'TRANSFER',
          amount: 200000,
          proofImageB64: 'data:image/jpeg;base64,samplebase64==',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.reservationId).toBe('res-101');
      expect(body.data.paymentMethod).toBe('TRANSFER');
    });

    it('GET /api/staff/gateway-capability returns gateway support info', async () => {
      vi.spyOn(liveChatService, 'getGatewayCapability').mockResolvedValue({
        provider: 'WAHA',
        supportsRevoke: true,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/staff/gateway-capability',
        headers: { cookie: 'staff_session=valid_token' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.provider).toBe('WAHA');
      expect(body.data.supportsRevoke).toBe(true);
    });

    it('DELETE /api/staff/conversations/:id/messages/:messageId revokes message for owned conversation', async () => {
      vi.spyOn(StaffReservationService, 'assertConversationOwnedByStaffToday').mockResolvedValue(true);
      vi.spyOn(liveChatService, 'revokeMessage').mockResolvedValue({ success: true });

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/staff/conversations/conv-owned/messages/msg-123',
        headers: { cookie: 'staff_session=valid_token' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.message).toContain('Pesan berhasil ditarik');
    });

    it('DELETE /api/staff/conversations/:id/messages/:messageId returns 403 for unowned conversation', async () => {
      vi.spyOn(StaffReservationService, 'assertConversationOwnedByStaffToday').mockResolvedValue(false);

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/staff/conversations/conv-unowned/messages/msg-123',
        headers: { cookie: 'staff_session=valid_token' },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error).toContain('tidak memiliki akses');
    });
  });
});
