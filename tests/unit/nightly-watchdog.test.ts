import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  reservationFindMany: vi.fn(),
  conversationFindMany: vi.fn(),
  messageFindFirst: vi.fn(),
}));

vi.mock('../../src/db/client', () => ({
  prisma: {
    reservation: { findMany: h.reservationFindMany },
    conversation: { findMany: h.conversationFindMany },
    message: { findFirst: h.messageFindFirst },
  },
}));

import { nightlyWatchdogService } from '../../src/services/nightly-watchdog.service';

describe('NightlyWatchdogService (Fase 2r)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.reservationFindMany.mockResolvedValue([]);
    h.conversationFindMany.mockResolvedValue([]);
    h.messageFindFirst.mockResolvedValue(null);
  });

  it('agregasi confirmed besok (state-based, bukan keyword)', async () => {
    h.reservationFindMany.mockResolvedValue([
      {
        booking_date: new Date(Date.now() + 20 * 60 * 60 * 1000),
        treatment_detail: 'Baby Massage',
        treatment_category: 'BABY',
        customer: { name: 'Bunda Alin' },
        assigned_staff: { name: 'Bidan Yusi' },
      },
    ]);
    const data = await nightlyWatchdogService.generate('tenant-a');
    expect(data.confirmedTomorrow.length).toBe(1);
    expect(data.confirmedTomorrow[0].name).toBe('Bunda Alin');
    expect(data.confirmedTomorrow[0].staff).toBe('Bidan Yusi');
  });

  it('unreplied hanya bila pesan NYATA terakhir INBOUND (INTERNAL_NOTE diabaikan)', async () => {
    h.conversationFindMany.mockResolvedValue([
      { id: 'c1', customer: { name: 'Bunda Rina', phone: '628123456789' }, session_data: {} },
    ]);
    h.messageFindFirst.mockResolvedValue({
      direction: 'INBOUND',
      created_at: new Date(Date.now() - 30 * 60 * 1000),
      sender_type: 'CUSTOMER',
    });
    const data = await nightlyWatchdogService.generate('tenant-a');
    expect(data.unreplied.length).toBe(1);
    expect(data.unreplied[0].waitingMinutes).toBeGreaterThanOrEqual(29);
  });

  it('unreplied KOSONG bila pesan terakhir OUTBOUND (sudah dibalas)', async () => {
    h.conversationFindMany.mockResolvedValue([
      { id: 'c1', customer: { name: 'Bunda Rina', phone: '628123456789' }, session_data: {} },
    ]);
    h.messageFindFirst.mockResolvedValue({
      direction: 'OUTBOUND',
      created_at: new Date(),
      sender_type: 'ADMIN',
    });
    const data = await nightlyWatchdogService.generate('tenant-a');
    expect(data.unreplied.length).toBe(0);
  });

  it('stalled: customer dengan reservasi confirmed DIKECUALIKAN', async () => {
    h.conversationFindMany.mockResolvedValue([
      {
        id: 'c1',
        last_discussed_treatment: 'Baby Massage',
        session_data: {},
        customer: { name: 'Bunda Dewi', phone: '6281', reservations: [{ status: 'confirmed' }] },
      },
    ]);
    const data = await nightlyWatchdogService.generate('tenant-a');
    expect(data.stalledInquiries.length).toBe(0);
  });

  it('stalled: customer dengan bukti minat slot (session_data) & tanpa confirmed → masuk', async () => {
    h.conversationFindMany.mockResolvedValue([
      {
        id: 'c1',
        last_discussed_treatment: null,
        session_data: { inquiryDate: '2026-09-28' },
        customer: { name: 'Bunda Dewi', phone: '6281', reservations: [] },
      },
    ]);
    const data = await nightlyWatchdogService.generate('tenant-a');
    expect(data.stalledInquiries.length).toBe(1);
  });

  it('DB offline → kategori kosong, tidak melempar', async () => {
    h.reservationFindMany.mockRejectedValue(new Error('Database offline'));
    h.conversationFindMany.mockRejectedValue(new Error('Database offline'));
    const data = await nightlyWatchdogService.generate('tenant-a');
    expect(data.unreplied).toEqual([]);
    expect(data.stalledInquiries).toEqual([]);
    expect(data.confirmedTomorrow).toEqual([]);
  });

  it('formatMessage mem-mask nomor HP (privasi) & menyertakan link live-chat', () => {
    const msg = nightlyWatchdogService.formatMessage(
      'Klinik A',
      {
        reportDateStr: '2026-09-27',
        unreplied: [{ name: 'Bunda Rina', phone: '628123456789', conversationId: 'c1', lastInboundAt: new Date(), waitingMinutes: 12 }],
        stalledInquiries: [],
        confirmedTomorrow: [],
        summary: '',
      },
      'https://klinik.example.com'
    );
    expect(msg).not.toContain('628123456789');
    expect(msg).toContain('6281-2345-6789');
    expect(msg).toContain('/admin/live-chat?conversationId=c1');
  });
});
