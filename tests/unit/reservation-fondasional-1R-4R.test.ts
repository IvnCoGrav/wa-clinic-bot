import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Suite verifikasi fondasional Fase 1R–4R (rencana perbaikan sistemik reservasi).
 * Prinsip adversarial: setiap grup menguji happy path + parafrase nyata + edge case,
 * bukan satu kalimat verbatim. Seam yang diuji:
 *  - A: POST /api/admin/reservation (kontrak purchase_value murni vs ongkir terpisah)
 *  - B: applyBookingTimeToDate + executeSaveReservation (time engine WIB→UTC)
 *  - C: TreatmentCatalogService.matchCatalogItem (data-driven nama+deskripsi DB)
 *  - D: resolveCanonicalDuration + parseTreatmentsFromDetail (anti-snowball buffer)
 *  - E: isContaminatedPurchaseValue (invarian rekonsiliasi Fase 5R)
 */

vi.mock('../../src/services/reservation-core.service', () => ({
  reservationCoreService: {
    saveReservation: vi.fn(async (params: any) => ({
      reservation: { id: 'res-fondasional-1' },
      isNew: true,
      isUpdate: false,
      __captured: params,
    })),
  },
  ReservationConflictError: class ReservationConflictError extends Error {},
}));

import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { customerService } from '../../src/services/customer.service';
import { auditService } from '../../src/services/audit.service';
import { reservationCoreService } from '../../src/services/reservation-core.service';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';
import { applyBookingTimeToDate, parseIndonesianDate } from '../../src/utils/indonesian-date-parser';
import { executeSaveReservation } from '../../src/v3/tools/save-reservation.tool';
import { isContaminatedPurchaseValue } from '../../scripts/reconcile-reservations-purchase-value';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

const ADMIN_KEY = 'test_admin_key_fondasional';

/** Tanggal ISO masa depan agar lolos temporal gate. */
function futureDate(daysAhead = 7): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Jam WIB dari sebuah Date (UTC) — asersi zona-independen. */
function wibParts(d: Date): { h: number; m: number } {
  const w = new Date(d.getTime() + 7 * 3600 * 1000);
  return { h: w.getUTCHours(), m: w.getUTCMinutes() };
}

// ─── SEAM A: kontrak keuangan POST ────────────────────────────────────────────
describe('SEAM A — POST /api/admin/reservation memisahkan purchase_value & ongkir', () => {
  const customer = {
    id: 'cust-fond-1', tenant_id: DEFAULT_TENANT_ID, phone: '6289900112233',
    name: 'Bunda Sari', status: 'active',
  };

  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    vi.clearAllMocks();
    vi.spyOn(customerService, 'getCustomerById').mockResolvedValue(customer as any);
    vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined);
    vi.mocked(reservationCoreService.saveReservation).mockResolvedValue({
      reservation: { id: 'res-fondasional-1' }, isNew: true, isUpdate: false,
    } as any);
  });

  it('purchaseValue murni diteruskan ke core + ongkir disinkron ke Customer (tanpa double-ongkir)', async () => {
    vi.mocked(prisma.customer.update).mockResolvedValue({} as any);
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: {
        customerId: customer.id,
        treatmentCategory: 'BABY',
        treatmentDetail: 'Pijat Bayi Pulih Ceria',
        purchaseValue: 75000,
        ongkir: 20000,
      },
    });
    expect(res.statusCode).toBe(201);
    const coreArgs = vi.mocked(reservationCoreService.saveReservation).mock.calls[0][0] as any;
    expect(coreArgs.purchaseValue).toBe(75000);
    expect(vi.mocked(prisma.customer.update)).toHaveBeenCalledWith(
      expect.objectContaining({ data: { ongkir: 20000 } })
    );
  });

  it('tanpa ongkir → Customer.ongkir tidak disentuh', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: {
        customerId: customer.id,
        treatmentCategory: 'BABY',
        treatmentDetail: 'Pijat Bayi Ceria',
        purchaseValue: 60000,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(vi.mocked(prisma.customer.update)).not.toHaveBeenCalled();
    const coreArgs = vi.mocked(reservationCoreService.saveReservation).mock.calls[0][0] as any;
    expect(coreArgs.purchaseValue).toBe(60000);
  });

  it('edge: ongkir negatif / NaN diabaikan (tidak merusak Customer)', async () => {
    const app = buildApp();
    for (const bad of [-5000, 'abc']) {
      vi.clearAllMocks();
      vi.spyOn(customerService, 'getCustomerById').mockResolvedValue(customer as any);
      vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined);
      vi.mocked(reservationCoreService.saveReservation).mockResolvedValue({
        reservation: { id: 'res-fondasional-1' }, isNew: true, isUpdate: false,
      } as any);
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/reservation',
        headers: { 'x-api-key': ADMIN_KEY },
        payload: {
          customerId: customer.id,
          treatmentCategory: 'BABY',
          treatmentDetail: 'Pijat Bayi Ceria',
          purchaseValue: 60000,
          ongkir: bad,
        },
      });
      expect(res.statusCode).toBe(201);
      expect(vi.mocked(prisma.customer.update)).not.toHaveBeenCalled();
    }
  });

  it('edge: DB Customer.ongkir offline → reservasi tetap tersimpan (degradasi lunak)', async () => {
    vi.mocked(prisma.customer.update).mockRejectedValue(new Error('Database offline'));
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: {
        customerId: customer.id,
        treatmentCategory: 'BABY',
        treatmentDetail: 'Pijat Bayi Ceria',
        purchaseValue: 60000,
        ongkir: 15000,
      },
    });
    expect(res.statusCode).toBe(201);
  });
});

// ─── SEAM B: time engine ──────────────────────────────────────────────────────
describe('SEAM B — applyBookingTimeToDate (WIB→UTC terpusat)', () => {
  const base = new Date('2026-09-18T02:00:00.000Z'); // 09:00 WIB

  it('format titik & kolon: "14.00" dan "14:00" → 14:00 WIB', () => {
    for (const t of ['14.00', '14:00', 'pukul 14.00 WIB', 'jam 14:00']) {
      const out = applyBookingTimeToDate(base, t);
      expect(wibParts(out)).toEqual({ h: 14, m: 0 });
    }
  });

  it('range "14.30-15.30" memakai jam mulai', () => {
    const out = applyBookingTimeToDate(base, '14.30-15.30');
    expect(wibParts(out)).toEqual({ h: 14, m: 30 });
  });

  it('edge adversarial: kosong/null/invalid/batas → base tidak berubah', () => {
    for (const bad of ['', '   ', 'abc', 'nanti sore', '25:00', '14.60', null, undefined]) {
      expect(applyBookingTimeToDate(base, bad as any).getTime()).toBe(base.getTime());
    }
  });

  it('edge batas valid: "00:00" dan "23:59" diterima', () => {
    expect(wibParts(applyBookingTimeToDate(base, '00:00'))).toEqual({ h: 0, m: 0 });
    expect(wibParts(applyBookingTimeToDate(base, '23:59'))).toEqual({ h: 23, m: 59 });
  });

  it('executeSaveReservation menerapkan bookingTime ke bookingDate (bukan 09:00 silent)', async () => {
    vi.clearAllMocks();
    vi.mocked(reservationCoreService.saveReservation).mockResolvedValue({
      reservation: { id: 'res-time-1' }, isNew: true, isUpdate: false,
    } as any);
    const res = await executeSaveReservation({
      customerId: 'cust-1', chatId: '6281@c.us',
      treatmentName: 'Pijat Bayi Ceria',
      bookingDate: futureDate(), bookingTime: '14.00',
    } as any);
    expect(res.success).toBe(true);
    const called = vi.mocked(reservationCoreService.saveReservation).mock.calls[0][0] as any;
    expect(wibParts(called.bookingDate)).toEqual({ h: 14, m: 0 });
  });

  it('tanpa bookingTime → fallback parser (09:00 WIB) tetap berlaku', async () => {
    vi.clearAllMocks();
    vi.mocked(reservationCoreService.saveReservation).mockResolvedValue({
      reservation: { id: 'res-time-2' }, isNew: true, isUpdate: false,
    } as any);
    await executeSaveReservation({
      customerId: 'cust-1', chatId: '6281@c.us',
      treatmentName: 'Pijat Bayi Ceria', bookingDate: futureDate(),
    } as any);
    const called = vi.mocked(reservationCoreService.saveReservation).mock.calls[0][0] as any;
    expect(wibParts(called.bookingDate)).toEqual({ h: 9, m: 0 });
    // Parser absolut tetap dikenali
    expect(parseIndonesianDate(futureDate()).isRecognized).toBe(true);
  });
});

// ─── SEAM C: data-driven symptom matching ─────────────────────────────────────
describe('SEAM C — matchCatalogItem memakai deskripsi klinis DB (tanpa hafalan gejala)', () => {
  it.each([
    'pijet bapil',
    'Pijat Bapil',
    'pijat bayi bapil',
    'batuk pilek',
    'pilek batuk',
    'bayi kembung',
    'pijat bayi batuk pilek kembung',
  ])('keluhan "%s" → layanan STANDARD Pulih (bukan add-on/bundle)', (teks) => {
    const hit = treatmentCatalogService.matchCatalogItem(teks);
    expect(hit).toBeDefined();
    expect(hit!.serviceType).toBe('STANDARD');
    expect(hit!.category === 'BABY' || hit!.category === 'KIDS').toBe(true);
    expect(hit!.name.toLowerCase()).toContain('pulih');
  });

  it.each([
    'Sinar Moksa',
    'sinar moxa',
    'uap nebulizer',
    'nebulizer obat',
    'terapi uap',
  ])('add-on "%s" tetap terkunci ke add-on (anti-pembajakan parameter)', (teks) => {
    const hit = treatmentCatalogService.matchCatalogItem(teks);
    expect(hit).toBeDefined();
    expect(treatmentCatalogService.isAddonService(hit!)).toBe(true);
  });

  it('edge: token tunggal ("moksa"/"nebulizer") TIDAK mengunci via matchCatalogItem (single-token guard)', () => {
    // Kontrak disengaja: kata tunggal generik tidak boleh me-lock layanan.
    // Jalur durasi/add-on menanganinya via isAddonKeyword / substring fallback di pemanggil.
    expect(treatmentCatalogService.matchCatalogItem('moksa')).toBeUndefined();
    expect(treatmentCatalogService.matchCatalogItem('Nebulizer')).toBeUndefined();
  });

  it('urutan kata dibalik tetap cocok ("Pijat Ceria Bayi" → Ceria)', () => {
    const hit = treatmentCatalogService.matchCatalogItem('Pijat Ceria Bayi');
    expect(hit?.name).toContain('Ceria');
  });

  it('edge: token tunggal generik tidak mengunci layanan ("breast" → undefined)', () => {
    expect(treatmentCatalogService.matchCatalogItem('breast')).toBeUndefined();
  });

  it('edge: typo alias linguistik ("pijet", "moxa", "rileksasi") dinormalisasi', () => {
    expect(treatmentCatalogService.matchCatalogItem('pijet bayi ceria')?.name).toContain('Ceria');
  });
});

// ─── SEAM D: durasi kanonis & anti-snowball ───────────────────────────────────
describe('SEAM D — durasi kanonis: satu buffer per kunjungan, anti-snowball', () => {
  it('Pulih Ceria + Moksa = 40m + 15m + 20m buffer = 75m (data-driven dari katalog)', () => {
    const pulih = treatmentCatalogService.matchCatalogItem('Pijat Bayi Pulih Ceria')!;
    const moksa = treatmentCatalogService.matchCatalogItem('Sinar Moksa')!;
    const expected = pulih.durationMinutes + moksa.durationMinutes + 20;
    expect(treatmentCatalogService.resolveCanonicalDuration('Pijat Bayi Pulih Ceria + Sinar Moksa')).toBe(expected);
    expect(expected).toBe(75);
  });

  it('tag [Total 75m] idempoten: parse ulang tidak membengkak', () => {
    const once = treatmentCatalogService.resolveCanonicalDuration('Pijat Bayi Pulih Ceria + Sinar Moksa [Total 75m]');
    expect(once).toBe(75);
    const breakdown = treatmentCatalogService.resolveDurationBreakdown('Pijat Bayi Pulih Ceria + Sinar Moksa [Total 75m]');
    expect(breakdown.usedExplicitTag).toBe(true);
    expect(breakdown.confident).toBe(true);
  });

  it('tiga item (main + 2 add-on) hanya satu buffer kunjungan', () => {
    const total = treatmentCatalogService.resolveCanonicalDuration('Pijat Bayi Pulih Ceria + Sinar Moksa + Cukur Rambut Bayi');
    const pulih = treatmentCatalogService.matchCatalogItem('Pijat Bayi Pulih Ceria')!.durationMinutes;
    const moksa = treatmentCatalogService.matchCatalogItem('Sinar Moksa')!.durationMinutes;
    const cukur = treatmentCatalogService.matchCatalogItem('Cukur Rambut Bayi')!.durationMinutes;
    expect(total).toBe(pulih + moksa + cukur + 20);
  });

  it('edge: teks tak dikenal → confident=false (anti-fabrikasi durasi)', () => {
    const r = treatmentCatalogService.resolveDurationBreakdown('Layanan Misterius Tanpa Katalog');
    expect(r.confident).toBe(false);
  });
});

// ─── SEAM E: invarian rekonsiliasi ────────────────────────────────────────────
describe('SEAM E — isContaminatedPurchaseValue (invarian Fase 5R)', () => {
  it('pv == murni + ongkir → terkontaminasi (contoh live: 95000 = 75000 + 20000)', () => {
    expect(isContaminatedPurchaseValue(95000, 75000, 20000)).toBe(true);
    expect(isContaminatedPurchaseValue(100000, 80000, 20000)).toBe(true);
  });

  it('sudah murni → bersih', () => {
    expect(isContaminatedPurchaseValue(75000, 75000, 20000)).toBe(false);
    expect(isContaminatedPurchaseValue(90000, 90000, 20000)).toBe(false);
  });

  it('edge: downside (pv < murni) tidak disentuh guard', () => {
    expect(isContaminatedPurchaseValue(70000, 75000, 20000)).toBe(false);
  });

  it('edge: ongkir nol / murni nol / pv nol → false (tanpa false-positive)', () => {
    expect(isContaminatedPurchaseValue(75000, 75000, 0)).toBe(false);
    expect(isContaminatedPurchaseValue(0, 75000, 20000)).toBe(false);
    expect(isContaminatedPurchaseValue(75000, null, 20000)).toBe(false);
    expect(isContaminatedPurchaseValue(null, null, null)).toBe(false);
  });
});
