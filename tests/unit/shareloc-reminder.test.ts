import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { sharelocReminderService } from '../../src/services/shareloc-reminder.service';
import * as factory from '../../src/integrations/whatsapp/factory';
import { auditService } from '../../src/services/audit.service';
import * as hubService from '../../src/services/live-chat-hub.service';
import * as signalService from '../../src/services/shareloc-signal.service';

describe('Shareloc Reminder Service — Sweep & Template Resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ENABLE_SHARELOC_REMINDER_SWEEP;
  });

  describe('resolveTemplate', () => {
    it('mengambil dari QuickReply jika tersedia dan menginterpolasi nama', async () => {
      vi.mocked((prisma as any).quickReply.findFirst).mockResolvedValueOnce({
        content: 'Halo Bunda {name}, mohon shareloc ya.',
      });

      const text = await sharelocReminderService.resolveTemplate('default-tenant', 'Siti');
      expect(text).toBe('Halo Bunda Siti, mohon shareloc ya.');
    });

    it('fallback ke ClinicPolicy jika QuickReply tidak ditemukan', async () => {
      vi.mocked((prisma as any).quickReply.findFirst).mockResolvedValueOnce(null);
      vi.mocked((prisma as any).clinicPolicy.findFirst).mockResolvedValueOnce({
        suggested_reply: 'Bunda {name}, mohon pin peta ya.',
      });

      const text = await sharelocReminderService.resolveTemplate('default-tenant', 'Dewi');
      expect(text).toBe('Bunda Dewi, mohon pin peta ya.');
    });

    it('fallback ke default jika QuickReply dan ClinicPolicy keduanya kosong', async () => {
      vi.mocked((prisma as any).quickReply.findFirst).mockResolvedValueOnce(null);
      vi.mocked((prisma as any).clinicPolicy.findFirst).mockResolvedValueOnce(null);

      const text = await sharelocReminderService.resolveTemplate('default-tenant', null);
      expect(text).toContain('Bunda Bunda');
      expect(text).toContain('shareloc WhatsApp');
    });
  });

  describe('sweep', () => {
    it('melewati sapuan jika env flag ENABLE_SHARELOC_REMINDER_SWEEP tidak aktif', async () => {
      process.env.ENABLE_SHARELOC_REMINDER_SWEEP = 'false';
      const res = await sharelocReminderService.sweep('default-tenant');
      expect(res.skipped).toBe(1);
      expect(res.reasons.flag_disabled).toBe(1);
      expect(res.sent).toBe(0);
    });

    it('melewati sapuan jika di luar jam ramah WIB', async () => {
      process.env.ENABLE_SHARELOC_REMINDER_SWEEP = 'true';
      vi.spyOn(signalService, 'isFriendlyHoursWib').mockReturnValue(false);

      const res = await sharelocReminderService.sweep('default-tenant');
      expect(res.skipped).toBe(1);
      expect(res.reasons.outside_friendly_hours).toBe(1);
      expect(res.sent).toBe(0);
    });

    it('melewati pengiriman jika percakapan sedang dipegang admin (human handling)', async () => {
      process.env.ENABLE_SHARELOC_REMINDER_SWEEP = 'true';
      vi.spyOn(signalService, 'isFriendlyHoursWib').mockReturnValue(true);

      const mockRes = [
        {
          id: 'res-1',
          status: 'confirmed',
          booking_date: new Date('2026-10-13T14:00:00+07:00'),
          created_at: new Date('2026-10-13T10:00:00+07:00'),
          customer: {
            id: 'c-1',
            phone: '62812345678',
            name: 'Bunda Ani',
            location_source: 'estimated_area',
            share_location_sent: false,
          },
        },
      ];

      vi.mocked((prisma as any).reservation.findMany).mockResolvedValueOnce(mockRes);
      vi.mocked((prisma as any).conversation.findFirst).mockResolvedValueOnce({
        id: 'conv-1',
        is_human_handling: true,
        session_data: {},
      });

      const res = await sharelocReminderService.sweep('default-tenant');
      expect(res.examined).toBe(1);
      expect(res.sent).toBe(0);
      expect(res.reasons.human_handling_active).toBe(1);
    });

    it('melewati pengiriman otomatis same-day jika booking baru dibuat < 60 menit lalu (gate G0-b)', async () => {
      process.env.ENABLE_SHARELOC_REMINDER_SWEEP = 'true';
      vi.spyOn(signalService, 'isFriendlyHoursWib').mockReturnValue(true);

      const now = new Date('2026-10-13T10:00:00+07:00');
      // Dibuat 15 menit lalu
      const createdAt = new Date(now.getTime() - 15 * 60 * 1000);

      const mockRes = [
        {
          id: 'res-1',
          status: 'confirmed',
          booking_date: now,
          created_at: createdAt,
          customer: {
            id: 'c-1',
            phone: '62812345678',
            name: 'Bunda Ani',
            location_source: 'estimated_area',
            share_location_sent: false,
          },
        },
      ];

      vi.mocked((prisma as any).reservation.findMany).mockResolvedValueOnce(mockRes);
      vi.mocked((prisma as any).conversation.findFirst).mockResolvedValueOnce({
        id: 'conv-1',
        is_human_handling: false,
        session_data: {},
      });

      const res = await sharelocReminderService.sweep('default-tenant', now);
      expect(res.examined).toBe(1);
      expect(res.needed).toBe(1);
      expect(res.sent).toBe(0);
      expect(res.reasons.same_day_bot_wait_1h).toBe(1);
    });

    it('berhasil mengirim pesan jika memenuhi syarat, mencatat sesi, audit, dan SSE', async () => {
      process.env.ENABLE_SHARELOC_REMINDER_SWEEP = 'true';
      vi.spyOn(signalService, 'isFriendlyHoursWib').mockReturnValue(true);

      const now = new Date('2026-10-13T12:00:00+07:00');
      // Dibuat 90 menit lalu (> 60 menit)
      const createdAt = new Date(now.getTime() - 90 * 60 * 1000);

      const mockRes = [
        {
          id: 'res-1',
          status: 'confirmed',
          booking_date: now,
          created_at: createdAt,
          customer: {
            id: 'c-1',
            phone: '62812345678',
            name: 'Ani',
            location_source: 'estimated_area',
            share_location_sent: false,
          },
        },
      ];

      vi.mocked((prisma as any).reservation.findMany).mockResolvedValueOnce(mockRes);
      vi.mocked((prisma as any).conversation.findFirst).mockResolvedValueOnce({
        id: 'conv-1',
        is_human_handling: false,
        session_data: {},
      });

      vi.mocked((prisma as any).adminNotificationLog.findUnique).mockResolvedValueOnce(null);
      vi.mocked((prisma as any).adminNotificationLog.create).mockResolvedValueOnce({ id: 'log-1' });

      vi.mocked((prisma as any).quickReply.findFirst).mockResolvedValueOnce({
        content: 'Bunda {name}, mohon shareloc ya 🙏',
      });

      const mockSendTextMessage = vi.fn().mockResolvedValue({ success: true, messageId: 'wa-123' });
      vi.spyOn(factory, 'resolveGatewayForTenant').mockResolvedValue({
        sendTextMessage: mockSendTextMessage,
      } as any);

      vi.mocked((prisma as any).conversation.update).mockResolvedValueOnce({ id: 'conv-1' });
      vi.mocked((prisma as any).customer.update).mockResolvedValueOnce({ id: 'c-1' });
      vi.mocked((prisma as any).adminNotificationLog.update).mockResolvedValueOnce({ id: 'log-1' });

      const auditSpy = vi.spyOn(auditService, 'logAdminAction').mockResolvedValueOnce();

      const mockPublish = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(hubService, 'getLiveChatHub').mockReturnValue({
        publish: mockPublish,
      } as any);

      vi.mocked((prisma as any).conversation.findUnique).mockResolvedValueOnce({
        id: 'conv-1',
        customer: { id: 'c-1', is_sandbox_test: false },
      });

      const res = await sharelocReminderService.sweep('default-tenant', now);
      expect(res.examined).toBe(1);
      expect(res.needed).toBe(1);
      expect(res.sent).toBe(1);

      expect(mockSendTextMessage).toHaveBeenCalledWith('62812345678', 'Bunda Ani, mohon shareloc ya 🙏');
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SHARELOC_REMINDER_SENT',
          targetId: 'c-1',
        })
      );
      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'conversation.updated',
          tenantId: 'default-tenant',
        })
      );
    });
  });
});
