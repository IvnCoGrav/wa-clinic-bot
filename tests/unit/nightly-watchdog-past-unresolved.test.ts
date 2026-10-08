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

describe('NightlyWatchdogService — Past Unresolved Category (MT-1.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.reservationFindMany.mockResolvedValue([]);
    h.conversationFindMany.mockResolvedValue([]);
    h.messageFindFirst.mockResolvedValue(null);
  });

  it('jadwal kemarin berstatus confirmed masuk ke laporan pastUnresolved', async () => {
    // Panggilan 1 = confirmedTomorrow ([]), Panggilan 2 = pastUnresolved ([1 item])
    h.reservationFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'res-yesterday-1',
          booking_date: new Date(Date.now() - 36 * 60 * 60 * 1000), // Kemarin
          treatment_detail: 'Kala Baby – Pijat Ceria',
          treatment_category: 'BABY',
          status: 'confirmed',
          customer: { name: 'Bunda Dina' },
        },
      ]);

    const data = await nightlyWatchdogService.generate('default-tenant');
    expect(data.pastUnresolved).toBeDefined();
    expect(data.pastUnresolved.length).toBe(1);
    expect(data.pastUnresolved[0].name).toBe('Bunda Dina');
    expect(data.pastUnresolved[0].treatment).toBe('Kala Baby – Pijat Ceria');
    expect(data.pastUnresolved[0].status).toBe('confirmed');
    expect(data.summary).toContain('Reservasi lampau belum selesai: 1');
  });

  it('jadwal besok tidak masuk ke pastUnresolved (hanya masuk confirmedTomorrow)', async () => {
    // Panggilan 1 = confirmedTomorrow ([1 item]), Panggilan 2 = pastUnresolved ([])
    h.reservationFindMany
      .mockResolvedValueOnce([
        {
          id: 'res-tomorrow-1',
          booking_date: new Date(Date.now() + 24 * 60 * 60 * 1000),
          treatment_detail: 'Kala Baby – Pijat Ceria',
          treatment_category: 'BABY',
          status: 'confirmed',
          customer: { name: 'Bunda Sarah' },
          assigned_staff: { name: 'Bidan Nisa' },
        },
      ])
      .mockResolvedValueOnce([]);

    const data = await nightlyWatchdogService.generate('default-tenant');
    expect(data.confirmedTomorrow.length).toBe(1);
    expect(data.pastUnresolved.length).toBe(0);
    expect(data.summary).not.toContain('Reservasi lampau belum selesai');
  });

  it('DB offline → laporan tetap berhasil digenerate tanpa crash (pastUnresolved kosong)', async () => {
    h.reservationFindMany.mockRejectedValue(new Error('Database offline'));
    h.conversationFindMany.mockRejectedValue(new Error('Database offline'));

    const data = await nightlyWatchdogService.generate('default-tenant');
    expect(data.pastUnresolved).toEqual([]);
    expect(data.unreplied).toEqual([]);
    expect(data.confirmedTomorrow).toEqual([]);
    expect(data.stalledInquiries).toEqual([]);
  });

  it('formatMessage menyertakan blok peringatan reservasi lampau jika ada', () => {
    const formatted = nightlyWatchdogService.formatMessage(
      'Kala Baby Spa',
      {
        reportDateStr: '2026-10-08',
        unreplied: [],
        stalledInquiries: [],
        confirmedTomorrow: [],
        pastUnresolved: [
          {
            id: 'res-1',
            name: 'Bunda Karina',
            date: '2026-10-04',
            treatment: 'Kala Baby – Pijat Ceria',
            status: 'confirmed',
          },
        ],
        summary: 'Reservasi lampau belum selesai: 1.',
      },
      'https://admin.example.com'
    );

    expect(formatted).toContain('RESERVASI LAMPAU BELUM SELESAI (1 Reservasi)');
    expect(formatted).toContain('Bunda Karina (Kala Baby – Pijat Ceria) — Status: confirmed');
    expect(formatted).toContain('https://admin.example.com/admin/reservations');
  });
});
