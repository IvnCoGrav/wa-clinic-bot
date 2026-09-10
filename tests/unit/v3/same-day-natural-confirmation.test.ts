import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/services/reservation-core.service', () => ({
  reservationCoreService: {
    saveReservation: vi.fn(async (params: any) => ({
      reservation: { id: 'res-sameday-1' },
      isNew: true,
      isUpdate: false,
      __captured: params,
    })),
  },
  ReservationConflictError: class ReservationConflictError extends Error {},
}));

import { executeSaveReservation } from '../../../src/v3/tools/save-reservation.tool';
import { reservationCoreService } from '../../../src/services/reservation-core.service';

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Phase 4+5 (audit 337101 Turn 6) — same-day TANPA janji OTW: copy alami
 * pilihan User + status pending + flag [SAME_DAY_REQUEST] untuk admin.
 */
describe('Same-Day Natural Confirmation', () => {
  it('"sekarang bund" -> copy alami + pending + isSameDay', async () => {
    const out = await executeSaveReservation({
      customerId: 'cust-test',
      chatId: '628123@c.us',
      treatmentName: 'Pijat Bayi Ceria (Rileksasi)',
      bookingDate: 'sekarang bund',
      tenantId: 'default-tenant',
    });
    expect(out.success).toBe(true);
    expect(out.isSameDay).toBe(true);
    expect(out.message).toContain('Kalau hari ini kemungkinan jadwal kami penuh bunda');
    expect(out.message).not.toMatch(/OTW|meluncur|dalam perjalanan|terapis.*datang/i);
    const called = vi.mocked(reservationCoreService.saveReservation).mock.calls[0][0] as any;
    expect(called.status).toBe('pending');
    expect(String(called.rawText)).toContain('[SAME_DAY_REQUEST]');
  });

  it('booking tanggal esok hari -> copy konfirmasi biasa + confirmed', async () => {
    const besok = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const iso = `${besok.getFullYear()}-${String(besok.getMonth() + 1).padStart(2, '0')}-${String(besok.getDate()).padStart(2, '0')}`;
    const out = await executeSaveReservation({
      customerId: 'cust-test',
      chatId: '628123@c.us',
      treatmentName: 'Pijat Bayi Ceria (Rileksasi)',
      bookingDate: iso,
      tenantId: 'default-tenant',
    });
    expect(out.success).toBe(true);
    expect(out.isSameDay).toBe(false);
    expect(out.message).toContain('kami bantu cekkan');
    const called = vi.mocked(reservationCoreService.saveReservation).mock.calls[0][0] as any;
    expect(called.status).toBe('confirmed');
  });
});
