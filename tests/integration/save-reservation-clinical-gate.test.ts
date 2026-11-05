/**
 * Fase 2 — Gerbang kelayakan klinis pada `save_reservation`.
 *
 * Kontrak: DILARANG menulis reservasi yang melanggar ambang gestasional /
 * kontraindikasi, MESKIPUN LLM memanggil tool. Katalog tetap boleh menyebut
 * layanan untuk edukasi; booking yang diblokir.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/reservation-core.service', () => ({
  reservationCoreService: {
    saveReservation: vi.fn(async (params: any) => ({
      reservation: { id: 'res-clinical-1' },
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

function futureDate(daysAhead = 7): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const INDUKSI = treatmentCatalogService.getServiceById('moms-induksi-massage')?.name || 'Kala Mom – Induksi Massage';
const PRENATAL = treatmentCatalogService.getServiceById('moms-prenatal-massage')?.name || 'Kala Mom – Pregnant Massage';

describe('Fase 2 — save_reservation clinical gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reservationCoreService.saveReservation).mockResolvedValue({
      reservation: { id: 'res-clinical-1' }, isNew: true, isUpdate: false,
    } as any);
  });

  it('hamil 30 minggu + Induksi → DITOLAK, DB tidak disentuh', async () => {
    const res = await executeSaveReservation({
      customerId: 'cust-clin-1',
      chatId: '6281@c.us',
      treatmentName: INDUKSI,
      bookingDate: futureDate(),
      gestationalWeeks: 30,
      momStage: 'PREGNANT',
    } as any);

    expect(res.success).toBe(false);
    expect(res.message).toContain('Induksi');
    expect(vi.mocked(reservationCoreService.saveReservation)).not.toHaveBeenCalled();
  });

  it('hamil 38 minggu + Induksi → DITERIMA', async () => {
    const res = await executeSaveReservation({
      customerId: 'cust-clin-1',
      chatId: '6281@c.us',
      treatmentName: INDUKSI,
      bookingDate: futureDate(),
      gestationalWeeks: 38,
      momStage: 'PREGNANT',
    } as any);

    expect(res.success).toBe(true);
    expect(vi.mocked(reservationCoreService.saveReservation)).toHaveBeenCalledTimes(1);
  });

  it('hamil 20 minggu + Pregnant Massage → DITERIMA', async () => {
    const res = await executeSaveReservation({
      customerId: 'cust-clin-1',
      chatId: '6281@c.us',
      treatmentName: PRENATAL,
      bookingDate: futureDate(),
      gestationalWeeks: 20,
      momStage: 'PREGNANT',
    } as any);

    expect(res.success).toBe(true);
    expect(vi.mocked(reservationCoreService.saveReservation)).toHaveBeenCalledTimes(1);
  });

  it('nifas + Pregnant Massage → DITOLAK (stage mismatch)', async () => {
    const res = await executeSaveReservation({
      customerId: 'cust-clin-1',
      chatId: '6281@c.us',
      treatmentName: PRENATAL,
      bookingDate: futureDate(),
      momStage: 'POSTPARTUM',
    } as any);

    expect(res.success).toBe(false);
    expect(vi.mocked(reservationCoreService.saveReservation)).not.toHaveBeenCalled();
  });

  it('state maternal diteruskan ke seam kanonis saat lolos gerbang', async () => {
    await executeSaveReservation({
      customerId: 'cust-clin-1',
      chatId: '6281@c.us',
      treatmentName: PRENATAL,
      bookingDate: futureDate(),
      gestationalWeeks: 20,
      momStage: 'PREGNANT',
    } as any);

    const called = vi.mocked(reservationCoreService.saveReservation).mock.calls[0][0] as any;
    expect(called.gestationalWeeks).toBe(20);
    expect(called.momStage).toBe('PREGNANT');
  });
});
