import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { staffNotificationService } from '../../src/services/staff-notification.service';
import { prisma } from '../../src/db/client';
import { webPushService } from '../../src/services/web-push.service';
import { telegramService } from '../../src/services/telegram.service';

/**
 * #157f — Pre-Visit Brief tanpa kanal notifikasi: sweep retry tiap siklus tanpa
 * jejak. Observabilitas deterministik (log terstruktur) + status hasil eksplisit
 * agar kondisi "no channel" bisa di-forensik, TANPA mengubah perilaku retry
 * (kanal bisa aktif beberapa menit kemudian).
 */
describe('Pre-Visit Brief — observabilitas kanal (#157f)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockReservation(telegramChatId: string | null) {
    vi.spyOn(prisma.reservation, 'findUnique').mockResolvedValue({
      id: 'res-157f',
      customer_id: 'cust-1',
      treatment_detail: 'Pijat Bayi Ceria',
      treatment_category: 'BABY',
      booking_date: new Date(Date.now() + 25 * 60 * 1000),
      pre_visit_brief_sent_at: null,
      assigned_staff: { id: 'staff-1', name: 'Bidan Dewi', telegram_chat_id: telegramChatId },
      customer: { id: 'cust-1', name: 'Bunda Rina', phone: '08123456789', admin_notes: null, children: [] },
      children: [],
    } as any);
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(null);
    vi.spyOn(prisma.reservation, 'update').mockResolvedValue({} as any);
  }

  it('tanpa kanal aktif → status no_channel + log terstruktur (sent_at TIDAK ditandai)', async () => {
    mockReservation(null);
    vi.spyOn(webPushService, 'sendPushToStaff').mockResolvedValue({ sent: 0, failed: 0 });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const updateSpy = prisma.reservation.update as any;

    const res = await staffNotificationService.sendPreVisitBrief('res-157f', 'default-tenant');

    expect(res.sent).toBe(false);
    expect(res.reason).toBe('no_channel');
    // sent_at TIDAK ditandai agar sweep retry saat kanal aktif.
    expect(updateSpy).not.toHaveBeenCalled();

    const all = [...warnSpy.mock.calls, ...logSpy.mock.calls].map((c) => c.map(String).join(' '));
    const structured = all.find((l) => l.includes('[PRE_VISIT_BRIEF_NO_CHANNEL]'));
    expect(structured).toBeDefined();
    expect(structured).toContain('res-157f');
  });

  it('kanal Telegram aktif & sukses → sent true + sent_at ditandai', async () => {
    mockReservation('123456');
    vi.spyOn(webPushService, 'sendPushToStaff').mockResolvedValue({ sent: 0, failed: 0 });
    vi.spyOn(telegramService, 'sendMessage').mockResolvedValue({ ok: true } as any);
    const updateSpy = prisma.reservation.update as any;

    const res = await staffNotificationService.sendPreVisitBrief('res-157f', 'default-tenant');

    expect(res.sent).toBe(true);
    expect(updateSpy).toHaveBeenCalled();
  });

  it('kanal Web Push aktif & sukses → sent true + sent_at ditandai', async () => {
    mockReservation(null);
    vi.spyOn(webPushService, 'sendPushToStaff').mockResolvedValue({ sent: 1, failed: 0 });
    const updateSpy = prisma.reservation.update as any;

    const res = await staffNotificationService.sendPreVisitBrief('res-157f', 'default-tenant');

    expect(res.sent).toBe(true);
    expect(updateSpy).toHaveBeenCalled();
  });
});
