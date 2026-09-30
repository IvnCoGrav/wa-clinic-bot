import { describe, it, expect } from 'vitest';
import {
  isSameWibCalendarDay,
  isSameDayBooking,
  buildCustomerReservationIntake,
  SAME_DAY_REQUEST_TAG,
} from '../../src/services/reservation-intake';

/**
 * #157a — Kontrak intake kanal customer (form WA + V3 tool) dalam SATU seam.
 *
 * Akar masalah: jalur form WA (`machine.ts`) memanggil `saveReservation` dengan
 * `status:'confirmed'` tanpa requestId → same-day lolos jadi confirmed (tanpa
 * awareness admin) dan double-submit menghasilkan baris duplikat. V3 tool
 * (`save-reservation.tool.ts`) punya kontrak yang benar (same-day→pending +
 * [SAME_DAY_REQUEST] + requestId ber-jam). Test ini mengunci kontrak tunggal.
 */
describe('#157a — reservation-intake: isSameWibCalendarDay (murni)', () => {
  it('dua waktu pada hari WIB yang sama → true', () => {
    const pagi = new Date('2026-10-15T02:00:00.000Z'); // 09:00 WIB
    const sore = new Date('2026-10-15T08:00:00.000Z'); // 15:00 WIB
    expect(isSameWibCalendarDay(pagi, sore)).toBe(true);
  });

  it('hari WIB berbeda (23:30 WIB vs 00:30 WIB besok) → false', () => {
    const malamIni = new Date('2026-10-15T16:30:00.000Z'); // 23:30 WIB 15 Okt
    const besokPagi = new Date('2026-10-15T17:30:00.000Z'); // 00:30 WIB 16 Okt
    expect(isSameWibCalendarDay(malamIni, besokPagi)).toBe(false);
  });

  it('tanggal invalid → false (tanpa crash)', () => {
    expect(isSameWibCalendarDay(new Date('bukan-tanggal'), new Date())).toBe(false);
  });
});

describe('#157a — reservation-intake: isSameDayBooking', () => {
  it('tanggal = sekarang → true', () => {
    expect(isSameDayBooking(new Date())).toBe(true);
  });

  it('besok → false', () => {
    const besok = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expect(isSameDayBooking(besok)).toBe(false);
  });

  it('sinyal teks same-day eksplisit menang walau tanggal jauh', () => {
    const jauh = new Date('2027-01-01T02:00:00.000Z');
    expect(isSameDayBooking(jauh, { sameDayText: true })).toBe(true);
  });

  it('tanggal null/undefined → false', () => {
    expect(isSameDayBooking(null)).toBe(false);
    expect(isSameDayBooking(undefined)).toBe(false);
  });
});

describe('#157a — reservation-intake: buildCustomerReservationIntake', () => {
  const base = {
    tenantId: 'default-tenant',
    customerId: 'cust-intake-1',
    treatmentDetail: 'Pijat Bayi Ceria',
  };

  it('same-day → status pending + tag [SAME_DAY_REQUEST] + isSameDay true', () => {
    const meta = buildCustomerReservationIntake({ ...base, bookingDate: new Date() });
    expect(meta.isSameDay).toBe(true);
    expect(meta.status).toBe('pending');
    expect(meta.sameDayTag).toBe(SAME_DAY_REQUEST_TAG);
  });

  it('beda hari → status confirmed + tanpa tag', () => {
    const meta = buildCustomerReservationIntake({
      ...base,
      bookingDate: new Date('2026-11-20T02:00:00.000Z'),
    });
    expect(meta.isSameDay).toBe(false);
    expect(meta.status).toBe('confirmed');
    expect(meta.sameDayTag).toBe('');
  });

  it('requestId deterministik + memuat tanggal & jam WIB + treatment', () => {
    const bookingDate = new Date('2026-11-20T02:30:00.000Z'); // 09:30 WIB
    const a = buildCustomerReservationIntake({ ...base, bookingDate });
    const b = buildCustomerReservationIntake({ ...base, bookingDate });
    expect(a.requestId).toBe(b.requestId);
    expect(a.requestId).toBe('default-tenant:cust-intake-1:2026-11-20:09:30:Pijat Bayi Ceria');
  });

  it('173f — dua slot BERBEDA (pagi & sore) pada hari sama → requestId BEDA', () => {
    const pagi = buildCustomerReservationIntake({
      ...base,
      bookingDate: new Date('2026-11-20T02:00:00.000Z'), // 09:00 WIB
    });
    const sore = buildCustomerReservationIntake({
      ...base,
      bookingDate: new Date('2026-11-20T08:00:00.000Z'), // 15:00 WIB
    });
    expect(pagi.requestId).not.toBe(sore.requestId);
  });

  it('tenant/customer/treatment berbeda → requestId beda (kunci terisolasi)', () => {
    const bookingDate = new Date('2026-11-20T02:00:00.000Z');
    const a = buildCustomerReservationIntake({ ...base, bookingDate });
    const b = buildCustomerReservationIntake({ ...base, tenantId: 'tenant-lain', bookingDate });
    const c = buildCustomerReservationIntake({ ...base, treatmentDetail: 'Pijat Ibu Hamil', bookingDate });
    expect(a.requestId).not.toBe(b.requestId);
    expect(a.requestId).not.toBe(c.requestId);
  });

  it('tanggal invalid → tidak same-day & tetap menghasilkan requestId (tanpa crash)', () => {
    const meta = buildCustomerReservationIntake({ ...base, bookingDate: new Date('bukan-tanggal') });
    expect(meta.isSameDay).toBe(false);
    expect(meta.status).toBe('confirmed');
    expect(typeof meta.requestId).toBe('string');
  });

  it('sinyal teks same-day memaksa pending walau tanggal parsed beda hari', () => {
    const meta = buildCustomerReservationIntake({
      ...base,
      bookingDate: new Date('2027-01-01T02:00:00.000Z'),
      sameDayText: true,
    });
    expect(meta.status).toBe('pending');
    expect(meta.sameDayTag).toBe(SAME_DAY_REQUEST_TAG);
  });
});
