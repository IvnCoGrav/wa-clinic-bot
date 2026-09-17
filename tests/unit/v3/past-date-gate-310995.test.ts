import { describe, it, expect } from 'vitest';
import { isPastBookingDateText } from '../../../src/utils/date-confirmation';

/**
 * Sesi 310995: booking "18 Agustus 2026" diterima padahal kalender sistem
 * September 2026. parseIndonesianDate menggulir masa lalu → masa depan SENYAP;
 * gate temporal ini menandai tanggal lampau eksplisit agar ditolak.
 */
describe('Temporal Gate — tanggal masa lalu (sesi 310995)', () => {
  const now = new Date(2026, 8, 17, 10, 0, 0); // 17 September 2026

  it('deteksi bulan lampau pada tahun yang sama ("18 Agustus 2026")', () => {
    expect(isPastBookingDateText('Selasa, 18 Agustus 2026', now)).toBe(true);
    expect(isPastBookingDateText('18 agu 2026', now)).toBe(true);
  });

  it('deteksi ISO lampau ("2026-08-18")', () => {
    expect(isPastBookingDateText('2026-08-18', now)).toBe(true);
  });

  it('tahun lampau pasti terdeteksi ("2023-01-01")', () => {
    expect(isPastBookingDateText('2023-01-01', now)).toBe(true);
  });

  it('tanggal depan TIDAK ditandai ("besok", "20 September 2026", ISO depan)', () => {
    expect(isPastBookingDateText('besok', now)).toBe(false);
    expect(isPastBookingDateText('sabtu', now)).toBe(false);
    expect(isPastBookingDateText('20 September 2026', now)).toBe(false);
    expect(isPastBookingDateText('2026-09-20', now)).toBe(false);
  });

  it('tanggal tanpa tahun tidak dianggap lampau (digulir ke tahun berjalan)', () => {
    expect(isPastBookingDateText('18 agustus', now)).toBe(false);
  });

  it('hari ini tidak dianggap lampau', () => {
    expect(isPastBookingDateText('2026-09-17', now)).toBe(false);
  });

  it('input kosong aman', () => {
    expect(isPastBookingDateText('', now)).toBe(false);
    expect(isPastBookingDateText(undefined, now)).toBe(false);
  });
});
