import { describe, it, expect } from 'vitest';
import { verifyDayMentioned } from '../../src/v3/tools/save-reservation.tool';

/**
 * Sesi 138207 — Frasa waktu same-day ("kalau siang ini bisa?") adalah jejak
 * hari INI yang sah. Akar: gate hanya mengakui kata harfiah "hari ini" di
 * evidence sehingga bookingDate "Hari ini" ditolak padahal customer sudah
 * menyebut "siang ini", dan pesan penolakan yang kaku bocor ke customer.
 */
describe('Day Evidence Same-Day Alias (sesi 138207)', () => {
  it('"Hari ini" terbukti oleh "kalau siang ini bisa ?" + "siap bund" -> lolos (null)', () => {
    expect(verifyDayMentioned('Hari ini', ['kalau siang ini bisa ?', 'siap bund'])).toBeNull();
  });

  it('varian same-day lain (pagi/sore/malam/nanti) juga lolos untuk booking hari ini', () => {
    expect(verifyDayMentioned('Hari ini', ['kalau pagi ini bisa?'])).toBeNull();
    expect(verifyDayMentioned('Hari ini', ['nanti sore bisa kah?'])).toBeNull();
    expect(verifyDayMentioned('Hari ini', ['hari ini juga bisa?'])).toBeNull();
  });

  it('tanpa jejak hari tetap ditolak — dengan arahan hangat, bukan bentakan', () => {
    const err = verifyDayMentioned('Besok', ['tidak ada, saya ambil treatment nya']);
    expect(err).not.toBeNull();
    expect(err as string).toContain('tahap pengecekan');
    expect(err as string).not.toContain('Gagal:');
  });
});
