import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/services/reservation-core.service', () => ({
  reservationCoreService: {
    saveReservation: vi.fn(async () => ({
      reservation: { id: 'res-copy-1' },
      isNew: true,
      isUpdate: false,
    })),
  },
  ReservationConflictError: class ReservationConflictError extends Error {},
}));

import { executeSaveReservation } from '../../../src/v3/tools/save-reservation.tool';

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Audit 694493 — Copy reservasi anti-dissonance: tampung + cekkan,
 * tanpa klaim "berhasil dicatat" yang kontradiktif.
 */
describe('save_reservation response copy (audit 694493)', () => {
  const base = {
    customerId: 'cust-copy',
    chatId: '628123@c.us',
    treatmentName: 'Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)',
    bookingDate: 'Jumat',
    dayMentionEvidence: ['untuk jumat besok apakah bisa?'],
    tenantId: 'default-tenant',
  } as any;

  it('non-same-day -> "sudah kami tampung" + cekkan slot, tanpa "berhasil dicatat"', async () => {
    const out = await executeSaveReservation(base);
    expect(out.success).toBe(true);
    expect(out.message).toMatch(/sudah kami tampung/i);
    expect(out.message).toMatch(/cekkan ketersediaan jadwal/i);
    expect(out.message).not.toMatch(/berhasil dicatat/i);
  });
});
