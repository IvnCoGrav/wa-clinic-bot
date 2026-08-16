import { describe, it, expect, beforeEach, vi } from 'vitest';
import { staffNotificationService } from '../../src/services/staff-notification.service';
import { prisma } from '../../src/db/client';
import { telegramService } from '../../src/services/telegram.service';

describe('StaffNotificationService — Therapist Telegram Assignment Dispatch & Privacy', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('getStaffPairingInfo should generate staff_PAIR_ token and correct deep link', async () => {
    vi.mocked(prisma.staff.findUnique).mockResolvedValue({
      id: 'staff-rina-1',
      name: 'Bidan Rina',
      telegram_pairing_token: 'staff_PAIR_RINA123',
      telegram_chat_id: '99887766',
    } as any);

    const info = await staffNotificationService.getStaffPairingInfo('staff-rina-1');

    expect(info).not.toBeNull();
    expect(info?.staffId).toBe('staff-rina-1');
    expect(info?.pairingToken).toBe('staff_PAIR_RINA123');
    expect(info?.directLink).toContain('start=staff_PAIR_RINA123');
    expect(info?.isConnected).toBe(true);
    expect(info?.telegramChatId).toBe('99887766');
  });

  it('sendReservationAssignmentNotification: should dispatch rich task data with NO raw phone leak', async () => {
    const sendSpy = vi.spyOn(telegramService, 'sendMessage').mockResolvedValue({ ok: true });

    vi.mocked(prisma.staff.findUnique).mockResolvedValue({
      id: 'staff-rina-1',
      name: 'Bidan Rina',
      telegram_chat_id: '99887766',
      tenant_id: 'default-tenant',
    } as any);

    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      id: 'res-101',
      treatment_detail: 'Baby Hydrotherapy + Full Massage',
      treatment_category: 'Baby Spa',
      booking_date: new Date('2026-08-22T10:00:00.000+07:00'),
      status: 'CONFIRMED',
      purchase_value: 185000,
      customer: {
        id: 'cust-1',
        name: 'Bunda Sarah',
        phone: '6281234567890',
        kelurahan: 'Rungkut Menanggal',
        kecamatan: 'Gunung Anyar',
        kota: 'Surabaya',
        lat: -7.332,
        lng: 112.788,
        distance_km: 4.5,
        ongkir: 15000,
        preferences: {
          landmark: 'Pagar hitam samping pos satpam',
          allergies: 'Alergi minyak telon beraroma tajam',
        },
        children: [
          {
            id: 'child-1',
            name: 'Baby Dylan',
            raw_age_text: '6 Bulan',
            birth_date: null,
          },
        ],
      },
      children: [],
    } as any);

    const result = await staffNotificationService.sendReservationAssignmentNotification('res-101', 'staff-rina-1');

    expect(result.sent).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const sentCall = sendSpy.mock.calls[0][0];
    expect(sentCall.chatId).toBe('99887766');

    const text = sentCall.text;
    // 1. Must contain essential task info
    expect(text).toContain('Bidan Rina');
    expect(text).toContain('Bunda Sarah');
    expect(text).toContain('Baby Dylan (6 Bulan)');
    expect(text).toContain('Baby Hydrotherapy + Full Massage');
    expect(text).toContain('Rungkut Menanggal');
    expect(text).toContain('Pagar hitam samping pos satpam');
    expect(text).toContain('travelmode=two-wheeler');
    expect(text).toContain('Rp 185.000');
    expect(text).toContain('LUNAS (Transfer)');
    expect(text).toContain('Alergi minyak telon beraroma tajam');
    expect(text).toContain('#staff-today');

    // 2. MUST NOT leak raw customer phone number (Privacy rule)
    expect(text).not.toContain('6281234567890');
    expect(text).not.toContain('081234567890');
    expect(text).not.toContain('wa.me');
  });

  it('sendReservationAssignmentNotification: should skip gracefully if staff has not paired Telegram', async () => {
    const sendSpy = vi.spyOn(telegramService, 'sendMessage').mockResolvedValue({ ok: true });

    vi.mocked(prisma.staff.findUnique).mockResolvedValue({
      id: 'staff-unpaired',
      name: 'Bidan Siti',
      telegram_chat_id: null,
    } as any);

    const result = await staffNotificationService.sendReservationAssignmentNotification('res-102', 'staff-unpaired');

    expect(result.sent).toBe(false);
    expect(result.reason).toContain('belum menghubungkan');
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
