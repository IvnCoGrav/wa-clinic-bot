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
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';

// Nama katalog dinamis (tahan rebrand): kategori BOTH diresolusi dari komposisi
// katalog — fixture WAJIB memakai nama kini, bukan nama lama pra-rebrand.
const BABY_PULIH = treatmentCatalogService.getServiceById('baby-massage-pulih-ceria')?.name || 'Pijat Bayi Pulih Ceria';
const MOMS_OKSI = treatmentCatalogService.getServiceById('moms-oksitosin-fullbody')?.name || 'Oksitosin Massage Fullbody';
const BABY_CERIA = treatmentCatalogService.getServiceById('baby-massage-ceria')?.name || 'Pijat Bayi Ceria';

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
      treatmentName: BABY_PULIH,
      additionalTreatments: [MOMS_OKSI],
      bookingDate: futureDate(),
      children: [{ ageMonths: 2 }, { name: 'Kakak', ageMonths: 36 }],
    } as any);

    expect(res.success).toBe(true);
    expect(res.reservationId).toBe('res-multi-1');
    const called = vi.mocked(reservationCoreService.saveReservation).mock.calls[0][0] as any;
    expect(called.treatmentCategory).toBe('BOTH');
    expect(called.treatmentDetail).toContain(BABY_PULIH);
    expect(called.treatmentDetail).toContain(MOMS_OKSI);
    expect(called.babies).toHaveLength(2);
    expect(called.babies[1].name).toBe('Kakak');
    expect(called.source).toBe('AGENT');
  });

  it('single treatment → kategori BABY + kompatibel mundur (childName legacy)', async () => {
    const res = await executeSaveReservation({
      customerId: 'cust-1',
      chatId: '6281@c.us',
      treatmentName: BABY_CERIA,
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
