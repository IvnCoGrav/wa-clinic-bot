import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { staffDepartureWatchdogService } from '../../src/services/staff-departure-watchdog.service';
import { StaffReservationService } from '../../src/services/staff-reservation.service';
import { auditService } from '../../src/services/audit.service';
import * as delayWatchdogConfig from '../../src/config/delay-watchdog-config';
import * as whatsappModule from '../../src/integrations/whatsapp';

describe('StaffDepartureWatchdogService', () => {
  const tenantId = 'test-tenant-watchdog';
  const staffId = 'staff-thabita';
  const reservationId = 'res-101';

  const baseReservation = (overrides: Record<string, any> = {}) => ({
    id: reservationId,
    tenant_id: tenantId,
    assigned_staff_id: staffId,
    status: 'confirmed',
    booking_date: new Date(),
    delay_notified_at: null,
    otw_sent_at: null,
    arrived_at: null,
    customer: { id: 'c1', name: 'Bunda Ani', lat: -7.24, lng: 112.74 },
    customer_address: { lat: -7.24, lng: 112.74 },
    assigned_staff: {
      id: staffId,
      name: 'Bidan Thabita',
      role: 'THERAPIST',
      base_lat: -7.2496988,
      base_lng: 112.7201362,
      base_address: 'Demak Jaya, Surabaya',
    },
    ...overrides,
  });

  const settings = {
    toleranceMinutes: 30,
    criticalExtraMinutes: 15,
    maxPrevOriginGapHours: 3,
    adminRecipients: ['081234567890'],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('notifyDelayToAdmin', () => {
    it('menolak bila reservasi tidak ditemukan', async () => {
      vi.spyOn(prisma.reservation, 'findUnique').mockResolvedValue(null);

      const res = await staffDepartureWatchdogService.notifyDelayToAdmin({
        reservationId: 'unknown',
        staffId,
        tenantId,
      });

      expect(res.success).toBe(false);
      expect(res.code).toBe('RESERVATION_NOT_FOUND');
    });

    it('menolak bila staf bukan pemilik reservasi dan bukan supervisor', async () => {
      vi.spyOn(prisma.reservation, 'findUnique').mockResolvedValue(
        baseReservation({ assigned_staff_id: 'other-staff' }) as any
      );

      const res = await staffDepartureWatchdogService.notifyDelayToAdmin({
        reservationId,
        staffId,
        tenantId,
        isSupervisor: false,
      });

      expect(res.success).toBe(false);
      expect(res.code).toBe('FORBIDDEN');
    });

    it('menolak jadwal yang sudah selesai/batal (RESERVATION_CLOSED)', async () => {
      const auditSpy = vi.spyOn(auditService, 'logAdminAction').mockResolvedValue();
      vi.spyOn(prisma.reservation, 'findUnique').mockResolvedValue(
        baseReservation({ status: 'completed' }) as any
      );

      const res = await staffDepartureWatchdogService.notifyDelayToAdmin({
        reservationId,
        staffId,
        tenantId,
      });

      expect(res.success).toBe(false);
      expect(res.code).toBe('RESERVATION_CLOSED');
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'STAFF_DELAY_NOTIFY_FAILED',
          payload: expect.objectContaining({ code: 'RESERVATION_CLOSED' }),
        })
      );
    });

    it('menolak jadwal bukan hari ini (NOT_TODAY)', async () => {
      vi.spyOn(auditService, 'logAdminAction').mockResolvedValue();
      const yesterday = new Date(Date.now() - 26 * 60 * 60 * 1000);
      vi.spyOn(prisma.reservation, 'findUnique').mockResolvedValue(
        baseReservation({ booking_date: yesterday }) as any
      );

      const res = await staffDepartureWatchdogService.notifyDelayToAdmin({
        reservationId,
        staffId,
        tenantId,
      });

      expect(res.success).toBe(false);
      expect(res.code).toBe('NOT_TODAY');
    });

    it('menolak (idempoten) jika delay_notified_at kurang dari 10 menit yang lalu tanpa flag force', async () => {
      vi.spyOn(prisma.reservation, 'findUnique').mockResolvedValue(
        baseReservation({ delay_notified_at: new Date(Date.now() - 5 * 60 * 1000) }) as any
      );

      const res = await staffDepartureWatchdogService.notifyDelayToAdmin({
        reservationId,
        staffId,
        tenantId,
        isSupervisor: false,
        force: false,
      });

      expect(res.success).toBe(false);
      expect(res.code).toBe('ALREADY_NOTIFIED');
    });

    it('menolak bila nomor admin belum dikonfigurasi & mencatat audit gagal', async () => {
      const auditSpy = vi.spyOn(auditService, 'logAdminAction').mockResolvedValue();
      vi.spyOn(prisma.reservation, 'findUnique').mockResolvedValue(baseReservation() as any);
      vi.spyOn(delayWatchdogConfig, 'getDelayWatchdogSettings').mockResolvedValue({
        ...settings,
        adminRecipients: [],
      });

      const res = await staffDepartureWatchdogService.notifyDelayToAdmin({
        reservationId,
        staffId,
        tenantId,
      });

      expect(res.success).toBe(false);
      expect(res.code).toBe('ADMIN_RECIPIENTS_EMPTY');
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'STAFF_DELAY_NOTIFY_FAILED',
          payload: expect.objectContaining({ code: 'ADMIN_RECIPIENTS_EMPTY' }),
        })
      );
    });

    it('mengembalikan WA_TEMPLATE_REQUIRED untuk kode Meta 131047 (jendela 24 jam WABA)', async () => {
      vi.spyOn(auditService, 'logAdminAction').mockResolvedValue();
      vi.spyOn(prisma.reservation, 'findUnique').mockResolvedValue(baseReservation() as any);
      vi.spyOn(delayWatchdogConfig, 'getDelayWatchdogSettings').mockResolvedValue(settings);

      const mockGateway = {
        providerType: 'WABA',
        supportsRevoke: false,
        supportsEdit: false,
        supportsReaction: false,
        sendTextMessage: vi.fn().mockResolvedValue({
          success: false,
          provider: 'WABA',
          error: { code: '131047', message: 'Re-engagement message' },
        }),
      };
      vi.spyOn(whatsappModule, 'getGateway').mockReturnValue(mockGateway as any);

      const res = await staffDepartureWatchdogService.notifyDelayToAdmin({
        reservationId,
        staffId,
        tenantId,
      });

      expect(res.success).toBe(false);
      expect(res.code).toBe('WA_TEMPLATE_REQUIRED');
    });

    it('mengembalikan SEND_FAILED & audit gagal bila gateway menolak', async () => {
      const auditSpy = vi.spyOn(auditService, 'logAdminAction').mockResolvedValue();
      vi.spyOn(prisma.reservation, 'findUnique').mockResolvedValue(baseReservation() as any);
      vi.spyOn(delayWatchdogConfig, 'getDelayWatchdogSettings').mockResolvedValue(settings);

      const mockGateway = {
        providerType: 'WAHA',
        supportsRevoke: true,
        supportsEdit: false,
        supportsReaction: true,
        sendTextMessage: vi
          .fn()
          .mockResolvedValue({ success: false, provider: 'WAHA', error: { code: 'WAHA_DOWN' } }),
      };
      vi.spyOn(whatsappModule, 'getGateway').mockReturnValue(mockGateway as any);

      const res = await staffDepartureWatchdogService.notifyDelayToAdmin({
        reservationId,
        staffId,
        tenantId,
      });

      expect(res.success).toBe(false);
      expect(res.code).toBe('SEND_FAILED');
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'STAFF_DELAY_NOTIFY_FAILED',
          payload: expect.objectContaining({ code: 'SEND_FAILED' }),
        })
      );
    });

    it('sukses mengirim ke admin: draf memakai menit telat nyata, update DB, audit tanpa nomor HP', async () => {
      // Jadwal hari ini yang sudah lewat (aman walau test jalan sesaat setelah 00:00 WIB)
      // → prediksi telat > 0 sehingga draf memuat angka.
      const { startOfDay } = StaffReservationService.getWibDateRange('today');
      const bookingDate = new Date(
        Math.max(startOfDay.getTime() + 60_000, Date.now() - 45 * 60 * 1000)
      );
      vi.spyOn(prisma.reservation, 'findUnique').mockResolvedValue(
        baseReservation({ booking_date: bookingDate }) as any
      );

      const updateSpy = vi.spyOn(prisma.reservation, 'update').mockResolvedValue({} as any);
      vi.spyOn(delayWatchdogConfig, 'getDelayWatchdogSettings').mockResolvedValue({
        ...settings,
        adminRecipients: ['081234567890', '089876543210'],
      });

      const delayTextSpy = vi
        .spyOn(StaffReservationService, 'getTripDelayMessageText')
        .mockResolvedValue('Maaf Bunda, Bidan telat 45 menit dan tiba 10:45 WIB.');

      const mockGateway = {
        providerType: 'WAHA',
        supportsRevoke: true,
        supportsEdit: false,
        supportsReaction: true,
        sendTextMessage: vi.fn().mockResolvedValue({ success: true, provider: 'WAHA' }),
      };
      vi.spyOn(whatsappModule, 'getGateway').mockReturnValue(mockGateway as any);

      const auditSpy = vi.spyOn(auditService, 'logAdminAction').mockResolvedValue();

      const res = await staffDepartureWatchdogService.notifyDelayToAdmin({
        reservationId,
        staffId,
        tenantId,
      });

      expect(res.success).toBe(true);
      expect(res.recipientCount).toBe(2);
      expect(delayTextSpy).toHaveBeenCalledWith(
        tenantId,
        expect.objectContaining({
          delayMinutes: expect.any(Number),
          arrivalTime: expect.any(String),
        })
      );
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: reservationId },
          data: expect.objectContaining({ delay_notified_at: expect.any(Date) }),
        })
      );

      // Verifikasi payload audit: TIDAK memuat nomor HP admin/pasien!
      expect(auditSpy).toHaveBeenCalledWith({
        action: 'STAFF_DELAY_NOTIFY',
        adminIdentity: `staff:${staffId}`,
        tenantId,
        payload: {
          reservationId,
          recipientCount: 2,
        },
      });
    });

    it('menolak bila staf yang ditugaskan bukan peran terapis (NOT_A_THERAPIST)', async () => {
      const auditSpy = vi.spyOn(auditService, 'logAdminAction').mockResolvedValue();
      vi.spyOn(prisma.reservation, 'findUnique').mockResolvedValue(
        baseReservation({
          assigned_staff: {
            id: staffId,
            name: 'Admin Maya',
            role: 'ADMIN_CS',
            base_lat: -7.24,
            base_lng: 112.72,
            base_address: 'Surabaya',
          },
        }) as any
      );

      const res = await staffDepartureWatchdogService.notifyDelayToAdmin({
        reservationId,
        staffId,
        tenantId,
      });

      expect(res.success).toBe(false);
      expect(res.code).toBe('NOT_A_THERAPIST');
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'STAFF_DELAY_NOTIFY_FAILED',
          payload: expect.objectContaining({ code: 'NOT_A_THERAPIST' }),
        })
      );
    });
  });

  describe('listTodayDelayAlerts', () => {
    it('hanya memproses reservasi staf terapis dan mengabaikan non-terapis serta unassigned', async () => {
      vi.spyOn(delayWatchdogConfig, 'getDelayWatchdogSettings').mockResolvedValue(settings);

      const { startOfDay } = StaffReservationService.getWibDateRange('today');
      // Deterministic time: jam 12:00 WIB, dengan booking jam 08:00 WIB (4 jam lalu -> pasti telat)
      const deterministicNow = new Date(startOfDay.getTime() + 12 * 3600 * 1000);
      const pastBooking = new Date(startOfDay.getTime() + 8 * 3600 * 1000);

      vi.spyOn(prisma.reservation, 'findMany').mockResolvedValue([
        // 1. Staf terapis (wajib diproses)
        baseReservation({
          id: 'res-therapist',
          booking_date: pastBooking,
          assigned_staff: {
            id: 'staff-1',
            name: 'Bidan Thabita',
            role: 'THERAPIST',
            base_lat: -7.24,
            base_lng: 112.72,
            base_address: 'Demak Surabaya',
          },
        }),
        // 2. Staf admin CS (wajib diabaikan)
        baseReservation({
          id: 'res-admin',
          booking_date: pastBooking,
          assigned_staff: {
            id: 'staff-2',
            name: 'Admin Doni',
            role: 'ADMIN_CS',
            base_lat: -7.24,
            base_lng: 112.72,
            base_address: 'Kantor',
          },
        }),
        // 3. Staf tanpa role terapis (wajib diabaikan)
        baseReservation({
          id: 'res-unassigned',
          booking_date: pastBooking,
          assigned_staff: null,
          assigned_staff_id: null,
        }),
      ] as any);

      vi.spyOn(StaffReservationService, 'getTripDelayMessageText').mockResolvedValue('Bidan terlambat');

      const alerts = await staffDepartureWatchdogService.listTodayDelayAlerts(tenantId, deterministicNow);

      // Hanya res-therapist yang boleh muncul di alerts
      const resIds = alerts.map((a) => a.reservationId);
      expect(resIds).toContain('res-therapist');
      expect(resIds).not.toContain('res-admin');
      expect(resIds).not.toContain('res-unassigned');
    });
  });
});
