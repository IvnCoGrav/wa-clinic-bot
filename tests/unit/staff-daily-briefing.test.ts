import { describe, it, expect, vi, beforeEach } from 'vitest';
import { staffNotificationService } from '../../src/services/staff-notification.service';
import { telegramService } from '../../src/services/telegram.service';
import { prisma } from '../../src/db/client';

describe('Staff Daily Morning Briefing Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateDailyBriefingText', () => {
    it('should format briefing text exactly matching the desired structure', () => {
      const staffName = 'Bidan Siti';
      const formattedDate = 'Rabu, 27 Agustus 2026';
      const reservations = [
        {
          id: 'res-1',
          booking_date: new Date('2026-08-27T02:00:00.000Z'), // 09:00 WIB
          treatment_category: 'BABY_SPA',
          treatment_detail: 'Baby Massage & Gym',
          purchase_value: 200000,
          customer: {
            name: 'Bunda Rani',
            kelurahan: 'Sukajadi',
            kecamatan: 'Sukasari',
            kota: 'Bandung',
            lat: -6.89,
            lng: 107.60,
            ongkir: 0,
            children: [{ name: 'Dedek Arka', raw_age_text: '6 bln' }],
          },
          children: [{ name: 'Dedek Arka', raw_age_text: '6 bln' }],
        },
        {
          id: 'res-2',
          booking_date: new Date('2026-08-27T06:00:00.000Z'), // 13:00 WIB
          treatment_category: 'BABY_CARE',
          treatment_detail: 'Pijat Batuk Pilek',
          purchase_value: 150000,
          customer: {
            name: 'Bunda Maya',
            kelurahan: 'Pasirkaliki',
            ongkir: 0,
            children: [{ name: 'Baby Twins', raw_age_text: '3 bln' }],
          },
          children: [{ name: 'Baby Twins', raw_age_text: '3 bln' }],
        },
        {
          id: 'res-3',
          booking_date: new Date('2026-08-27T09:00:00.000Z'), // 16:00 WIB
          treatment_category: 'PREGNANCY',
          treatment_detail: 'Prenatal Gentle Yoga',
          purchase_value: 180000,
          customer: {
            name: 'Bunda Dina',
            kelurahan: 'Cidadap',
            ongkir: 0,
            children: [],
          },
          children: [],
        },
      ];

      const text = staffNotificationService.generateDailyBriefingText(
        staffName,
        formattedDate,
        reservations
      );

      // Verify Header
      expect(text).toContain('🌅 *BRIEFING JADWAL HARI INI — Bidan Siti*');
      expect(text).toContain('📅 *Rabu, 27 Agustus 2026*');
      expect(text).toContain('Halo Bidan Siti, hari ini Anda memiliki *3 Jadwal Kunjungan*:');

      // Verify Items
      expect(text).toContain('1️⃣ *09:00 WIB* — *Bunda Rani* (👶 Dedek Arka, 6 bln)');
      expect(text).toContain('• *Layanan:* Baby Massage & Gym');
      expect(text).toContain('• *Alamat:* Kel. Sukajadi, Kec. Sukasari, Bandung ([Buka Maps]');
      expect(text).toContain('• *Total :* 200k');

      expect(text).toContain('2️⃣ *13:00 WIB* — *Bunda Maya* (👶 Baby Twins, 3 bln)');
      expect(text).toContain('• *Layanan:* Pijat Batuk Pilek');
      expect(text).toContain('• *Total :* 150k');

      expect(text).toContain('3️⃣ *16:00 WIB* — *Bunda Dina* (Ibu Hamil)');
      expect(text).toContain('• *Layanan:* Prenatal Gentle Yoga');
      expect(text).toContain('• *Total :* 180k');

      // Verify Footer
      expect(text).toContain('🔗 [Buka Detail di Portal Petugas]');
      expect(text).toContain('_Semangat melayani Bunda & Buah Hati hari ini! ✨_');
    });

    it('should sanitize dangerous markdown characters from names and notes', () => {
      const reservations = [
        {
          id: 'res-1',
          booking_date: new Date('2026-08-27T03:00:00.000Z'),
          treatment_detail: 'Treatment [Promo] *Spesial*',
          purchase_value: 100000,
          customer: {
            name: 'Bunda *Ani* _Test_',
            kelurahan: 'Test [Area]',
            children: [{ name: 'Baby *Cahyo*' }],
          },
        },
      ];

      const text = staffNotificationService.generateDailyBriefingText(
        'Bidan *Dewi*',
        'Kamis, 28 Agustus 2026',
        reservations
      );

      expect(text).toContain('Bidan  Dewi');
      expect(text).toContain('Bunda  Ani   Test');
      expect(text).not.toContain('*Ani*');
    });
  });

  describe('getWibDayRange', () => {
    it('should calculate accurate UTC day bounds for WIB timezone', () => {
      const targetDate = new Date('2026-08-27T10:00:00.000Z');
      const { startOfDay, endOfDay, dateStr, formattedDate } = staffNotificationService.getWibDayRange(targetDate);

      expect(dateStr).toBe('2026-08-27');
      expect(startOfDay.toISOString()).toBe('2026-08-26T17:00:00.000Z'); // 00:00 WIB
      expect(endOfDay.toISOString()).toBe('2026-08-27T16:59:59.999Z'); // 23:59:59 WIB
      expect(formattedDate).toBeDefined();
    });
  });

  describe('sendStaffDailyBriefing', () => {
    it('should return sent: false if staff has no telegram_chat_id', async () => {
      (prisma.staff.findUnique as any).mockResolvedValue({
        id: 'staff-1',
        name: 'Bidan Siti',
        telegram_chat_id: null,
        active: true,
      });

      const res = await staffNotificationService.sendStaffDailyBriefing('staff-1');
      expect(res.sent).toBe(false);
      expect(res.reason).toContain('belum menghubungkan');
    });

    it('should return sent: false if staff is inactive', async () => {
      (prisma.staff.findUnique as any).mockResolvedValue({
        id: 'staff-1',
        name: 'Bidan Siti',
        telegram_chat_id: '123456',
        active: false,
      });

      const res = await staffNotificationService.sendStaffDailyBriefing('staff-1');
      expect(res.sent).toBe(false);
      expect(res.reason).toContain('nonaktif');
    });

    it('should return sent: false if no reservations for the target date', async () => {
      (prisma.staff.findUnique as any).mockResolvedValue({
        id: 'staff-1',
        name: 'Bidan Siti',
        telegram_chat_id: '123456',
        tenant_id: 'default-tenant',
        active: true,
      });
      (prisma.reservation.findMany as any).mockResolvedValue([]);

      const res = await staffNotificationService.sendStaffDailyBriefing('staff-1');
      expect(res.sent).toBe(false);
      expect(res.reason).toContain('Tidak ada jadwal kunjungan');
    });

    it('should send telegram message when reservations exist', async () => {
      (prisma.staff.findUnique as any).mockResolvedValue({
        id: 'staff-1',
        name: 'Bidan Siti',
        telegram_chat_id: '123456',
        tenant_id: 'default-tenant',
        active: true,
      });
      (prisma.reservation.findMany as any).mockResolvedValue([
        {
          id: 'res-1',
          booking_date: new Date('2026-08-27T02:00:00.000Z'),
          treatment_detail: 'Baby Massage',
          purchase_value: 120000,
          customer: {
            name: 'Bunda Lisa',
            kelurahan: 'Sukajadi',
            children: [{ name: 'Baby Ken', raw_age_text: '4 bln' }],
          },
          children: [{ name: 'Baby Ken', raw_age_text: '4 bln' }],
        },
      ]);

      const sendMessageSpy = vi.spyOn(telegramService, 'sendMessage').mockResolvedValue({
        ok: true,
        messageId: 999,
      });

      const res = await staffNotificationService.sendStaffDailyBriefing('staff-1');
      expect(res.sent).toBe(true);
      expect(res.count).toBe(1);
      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: '123456',
          parseMode: 'Markdown',
        })
      );
    });
  });

  describe('sendAllStaffMorningBriefings', () => {
    it('should send briefings to all active staff with telegram_chat_id', async () => {
      (prisma.staff.findMany as any).mockResolvedValue([
        { id: 'staff-1', name: 'Bidan Siti' },
        { id: 'staff-2', name: 'Bidan Dewi' },
      ]);

      vi.spyOn(staffNotificationService, 'sendStaffDailyBriefing')
        .mockResolvedValueOnce({ sent: true, count: 2 })
        .mockResolvedValueOnce({ sent: false, count: 0, reason: 'Tidak ada jadwal' });

      const stats = await staffNotificationService.sendAllStaffMorningBriefings('default-tenant');
      expect(stats.totalStaff).toBe(2);
      expect(stats.briefedStaff).toBe(1);
      expect(stats.totalReservations).toBe(2);
    });
  });
});
