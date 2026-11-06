import { describe, it, expect } from 'vitest';
import { validateInvoiceReadiness } from '../../packages/admin-dashboard/src/utils/invoiceReadiness';

/**
 * Regresi AUDIT LIVE CHAT #316 / K-02.
 * Invoice dari chat sebelumnya memakai fallback fiktif: jarak 3,0 km, ongkir 0,
 * treatment "Pijat Ceria", jam "12.00-12.30". Test ini mengunci kontrak:
 * data tidak lengkap = BLOKIR, bukan dikarang.
 */
describe('validateInvoiceReadiness — gerbang anti-invoice-fiktif', () => {
  const base = {
    bookingDate: '2026-11-06T09:00:00+07:00',
    treatmentName: 'Pijat Bayi Pulih Ceria',
    distanceKm: 5.2,
    ongkir: 15000,
  };

  it('menerima data lengkap dan mengembalikan nilai terparse', () => {
    const r = validateInvoiceReadiness(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.treatmentName).toBe('Pijat Bayi Pulih Ceria');
    expect(r.distanceKm).toBe(5.2);
    expect(r.ongkir).toBe(15000);
    expect(r.bookingDate.toISOString()).toBe(new Date(base.bookingDate).toISOString());
  });

  it('0 km / 0 ongkir adalah nilai SAH (ambil sendiri / gratis), bukan dianggap kosong', () => {
    const r = validateInvoiceReadiness({ ...base, distanceKm: 0, ongkir: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.distanceKm).toBe(0);
    expect(r.ongkir).toBe(0);
  });

  it('memblokir jadwal kosong/tidak valid (tidak memakai jam default 12.00)', () => {
    expect(validateInvoiceReadiness({ ...base, bookingDate: null })).toEqual({ ok: false, reason: 'INVALID_SCHEDULE' });
    expect(validateInvoiceReadiness({ ...base, bookingDate: undefined })).toEqual({ ok: false, reason: 'INVALID_SCHEDULE' });
    expect(validateInvoiceReadiness({ ...base, bookingDate: 'bukan-tanggal' })).toEqual({ ok: false, reason: 'INVALID_SCHEDULE' });
  });

  it('memblokir nama layanan kosong (tidak memakai "Pijat Ceria")', () => {
    expect(validateInvoiceReadiness({ ...base, treatmentName: '' })).toEqual({ ok: false, reason: 'MISSING_TREATMENT' });
    expect(validateInvoiceReadiness({ ...base, treatmentName: '   ' })).toEqual({ ok: false, reason: 'MISSING_TREATMENT' });
    expect(validateInvoiceReadiness({ ...base, treatmentName: null })).toEqual({ ok: false, reason: 'MISSING_TREATMENT' });
  });

  it('memblokir jarak/ongkir kosong (tidak memakai 3,0 km / 0)', () => {
    expect(validateInvoiceReadiness({ ...base, distanceKm: null })).toEqual({ ok: false, reason: 'MISSING_DISTANCE' });
    expect(validateInvoiceReadiness({ ...base, distanceKm: undefined })).toEqual({ ok: false, reason: 'MISSING_DISTANCE' });
    expect(validateInvoiceReadiness({ ...base, ongkir: null })).toEqual({ ok: false, reason: 'MISSING_DISTANCE' });
    expect(validateInvoiceReadiness({ ...base, ongkir: '' })).toEqual({ ok: false, reason: 'MISSING_DISTANCE' });
  });

  it('memblokir angka tidak valid/negatif', () => {
    expect(validateInvoiceReadiness({ ...base, distanceKm: 'abc' })).toEqual({ ok: false, reason: 'INVALID_NUMBER' });
    expect(validateInvoiceReadiness({ ...base, ongkir: 'abc' })).toEqual({ ok: false, reason: 'INVALID_NUMBER' });
    expect(validateInvoiceReadiness({ ...base, distanceKm: -1 })).toEqual({ ok: false, reason: 'INVALID_NUMBER' });
    expect(validateInvoiceReadiness({ ...base, ongkir: -1 })).toEqual({ ok: false, reason: 'INVALID_NUMBER' });
    expect(validateInvoiceReadiness({ ...base, distanceKm: Number.NaN })).toEqual({ ok: false, reason: 'INVALID_NUMBER' });
  });
});
