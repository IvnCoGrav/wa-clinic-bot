import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  reservationFindUnique: vi.fn(),
  reservationFindFirst: vi.fn(),
  reservationFindMany: vi.fn(),
  reservationUpdate: vi.fn(),
  staffFindUnique: vi.fn(),
  sendMessage: vi.fn(),
  sendPushToStaff: vi.fn(),
}));

vi.mock('../../src/db/client', () => ({
  prisma: {
    reservation: {
      findUnique: h.reservationFindUnique,
      findFirst: h.reservationFindFirst,
      findMany: h.reservationFindMany,
      update: h.reservationUpdate,
    },
    staff: { findUnique: h.staffFindUnique },
  },
}));

vi.mock('../../src/services/telegram.service', () => ({
  telegramService: { sendMessage: (...a: any[]) => h.sendMessage(...a) },
}));

vi.mock('../../src/services/web-push.service', () => ({
  webPushService: { sendPushToStaff: (...a: any[]) => h.sendPushToStaff(...a) },
}));

import { StaffNotificationService } from '../../src/services/staff-notification.service';

const svc = new StaffNotificationService();

function baseReservation(overrides: any = {}) {
  return {
    id: 'res-1',
    tenant_id: 'tenant-a',
    status: 'confirmed',
    booking_date: new Date(Date.now() + 25 * 60 * 1000),
    pre_visit_brief_sent_at: null,
    customer_id: 'cust-1',
    assigned_staff_id: 'staff-1',
    treatment_detail: 'Baby Massage',
    treatment_category: 'BABY',
    assigned_staff: { id: 'staff-1', name: 'Bidan Yusi', telegram_chat_id: '12345' },
    customer: {
      id: 'cust-1',
      name: 'Bunda Alin',
      phone: '6285712345678',
      is_sandbox_test: false,
      admin_notes: 'Anak takut air, dampingi',
      preferences: { landmark: 'Pagar hitam' },
      children: [{ id: 'child-1', name: 'Kenzo', raw_age_text: '5 bulan' }],
    },
    children: [{ id: 'child-1', name: 'Kenzo', raw_age_text: '5 bulan' }],
    ...overrides,
  };
}

describe('StaffNotificationService.sendPreVisitBrief (Fase 5r)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.sendPushToStaff.mockResolvedValue(undefined);
    h.sendMessage.mockResolvedValue({ ok: true });
    h.reservationUpdate.mockResolvedValue({});
    h.reservationFindFirst.mockResolvedValue(null);
  });

  it('mengirim brief ke Telegram bidan + menandai terkirim (idempoten)', async () => {
    h.reservationFindUnique.mockResolvedValue(baseReservation());
    const res = await svc.sendPreVisitBrief('res-1', 'tenant-a');
    expect(res.sent).toBe(true);
    expect(h.sendMessage).toHaveBeenCalledTimes(1);
    const text = h.sendMessage.mock.calls[0][0].text;
    expect(text).toContain('RINGKASAN PASIEN');
    expect(text).toContain('Bunda Alin');
    expect(text).toContain('Baby Massage');
    expect(text).toContain('Catatan');
    expect(h.reservationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pre_visit_brief_sent_at: expect.any(Date) }) })
    );
  });

  it('TIDAK membocorkan nomor HP pasien (privasi G2=B)', async () => {
    h.reservationFindUnique.mockResolvedValue(baseReservation());
    await svc.sendPreVisitBrief('res-1', 'tenant-a');
    const text = h.sendMessage.mock.calls[0][0].text;
    expect(text).not.toContain('6285712345678');
    expect(text).not.toContain('0812');
  });

  it('idempoten: sudah pernah dikirim → tidak kirim ulang', async () => {
    h.reservationFindUnique.mockResolvedValue(baseReservation({ pre_visit_brief_sent_at: new Date() }));
    const res = await svc.sendPreVisitBrief('res-1', 'tenant-a');
    expect(res.sent).toBe(false);
    expect(res.alreadySent).toBe(true);
    expect(h.sendMessage).not.toHaveBeenCalled();
  });

  it('tanpa bidan ditugaskan → tidak kirim', async () => {
    h.reservationFindUnique.mockResolvedValue(baseReservation({ assigned_staff: null }));
    const res = await svc.sendPreVisitBrief('res-1', 'tenant-a');
    expect(res.sent).toBe(false);
    expect(h.sendMessage).not.toHaveBeenCalled();
  });

  it('sandbox test → diblokir', async () => {
    h.reservationFindUnique.mockResolvedValue(
      baseReservation({ customer: { ...baseReservation().customer, is_sandbox_test: true } })
    );
    const res = await svc.sendPreVisitBrief('res-1', 'tenant-a');
    expect(res.sent).toBe(false);
    expect(h.sendMessage).not.toHaveBeenCalled();
  });

  it('anak tanpa birth_date → tidak crash, tampil fallback usia', async () => {
    h.reservationFindUnique.mockResolvedValue(
      baseReservation({
        customer: {
          ...baseReservation().customer,
          children: [{ id: 'child-1', name: 'Kenzo', raw_age_text: null }],
        },
        children: [{ id: 'child-1', name: 'Kenzo', raw_age_text: null }],
      })
    );
    const res = await svc.sendPreVisitBrief('res-1', 'tenant-a');
    expect(res.sent).toBe(true);
    const text = h.sendMessage.mock.calls[0][0].text;
    expect(text).toContain('Kenzo');
  });
});

describe('StaffNotificationService.sweepPreVisitBriefs (Fase 5r)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.sendPushToStaff.mockResolvedValue(undefined);
    h.sendMessage.mockResolvedValue({ ok: true });
    h.reservationUpdate.mockResolvedValue({});
    h.reservationFindFirst.mockResolvedValue(null);
  });

  it('hanya memproses reservasi dalam jendela waktu + belum terkirim', async () => {
    h.reservationFindMany.mockResolvedValue([{ id: 'res-1' }]);
    h.reservationFindUnique.mockResolvedValue(baseReservation());
    const count = await svc.sweepPreVisitBriefs('tenant-a');
    expect(count).toBe(1);
    // query filter memuat status confirmed + window + pre_visit_brief_sent_at null
    expect(h.reservationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'confirmed', pre_visit_brief_sent_at: null }),
      })
    );
  });
});

describe('StaffNotificationService.triggerPreVisitBriefIfImminent (Fase 5r)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.sendPushToStaff.mockResolvedValue(undefined);
    h.sendMessage.mockResolvedValue({ ok: true });
    h.reservationUpdate.mockResolvedValue({});
    h.reservationFindFirst.mockResolvedValue(null);
  });

  it('booking dalam <=35 menit → kirim brief segera (same-day)', async () => {
    h.reservationFindUnique.mockResolvedValue(baseReservation());
    svc.triggerPreVisitBriefIfImminent('res-1', 'tenant-a');
    // fire-and-forget: tunggu microtask
    await new Promise((r) => setTimeout(r, 20));
    expect(h.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('booking jauh (>35 menit) → tidak kirim (tunggu cron)', async () => {
    h.reservationFindUnique.mockResolvedValue(
      baseReservation({ booking_date: new Date(Date.now() + 120 * 60 * 1000) })
    );
    svc.triggerPreVisitBriefIfImminent('res-1', 'tenant-a');
    await new Promise((r) => setTimeout(r, 20));
    expect(h.sendMessage).not.toHaveBeenCalled();
  });
});
