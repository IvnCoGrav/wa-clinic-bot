import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/reservation-core.service', () => ({
  reservationCoreService: {
    saveReservation: vi.fn(async (params: any) => ({
      reservation: { id: 'res-multi-1' },
      isNew: true,
      isUpdate: false,
      __captured: params,
    })),
  },
  ReservationConflictError: class ReservationConflictError extends Error {},
}));

import { executeSaveReservation } from '../../src/v3/tools/save-reservation.tool';
import { reservationCoreService } from '../../src/services/reservation-core.service';

describe('save_reservation multi-treatment & multi-pasien', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reservationCoreService.saveReservation).mockResolvedValue({
      reservation: { id: 'res-multi-1' }, isNew: true, isUpdate: false,
    } as any);
  });

  it('multi Mom+Baby → kategori BOTH + detail gabungan + babies per anak', async () => {
    const res = await executeSaveReservation({
      customerId: 'cust-1',
      chatId: '6281@c.us',
      treatmentName: 'Pijat Bayi Pulih Ceria',
      additionalTreatments: ['Oksitosin Massage Fullbody'],
      bookingDate: '2026-09-10',
      children: [{ ageMonths: 2 }, { name: 'Kakak', ageMonths: 36 }],
    } as any);

    expect(res.success).toBe(true);
    expect(res.reservationId).toBe('res-multi-1');
    const called = vi.mocked(reservationCoreService.saveReservation).mock.calls[0][0] as any;
    expect(called.treatmentCategory).toBe('BOTH');
    expect(called.treatmentDetail).toContain('Pijat Bayi Pulih Ceria');
    expect(called.treatmentDetail).toContain('Oksitosin Massage Fullbody');
    expect(called.babies).toHaveLength(2);
    expect(called.babies[1].name).toBe('Kakak');
    expect(called.source).toBe('AGENT');
  });

  it('single treatment → kategori BABY + kompatibel mundur (childName legacy)', async () => {
    const res = await executeSaveReservation({
      customerId: 'cust-1',
      chatId: '6281@c.us',
      treatmentName: 'Pijat Bayi Ceria',
      bookingDate: '2026-09-10',
      childName: 'Adek',
      childAgeMonths: 3,
    } as any);

    expect(res.success).toBe(true);
    const called = vi.mocked(reservationCoreService.saveReservation).mock.calls[0][0] as any;
    expect(called.treatmentCategory).toBe('BABY');
    expect(called.babies).toHaveLength(1);
    expect(called.babies[0].name).toBe('Adek');
  });
});
