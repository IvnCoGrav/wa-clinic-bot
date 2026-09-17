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

/** Tanggal ISO masa depan (audit 310995: gate temporal menolak tanggal lampau). */
function futureDate(daysAhead = 7): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
      bookingDate: futureDate(),
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
      bookingDate: futureDate(),
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
