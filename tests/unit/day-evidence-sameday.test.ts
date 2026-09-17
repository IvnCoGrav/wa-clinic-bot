import { describe, it, expect } from 'vitest';
import { verifyDayMentioned } from '../../src/v3/tools/save-reservation.tool';

/**
 * Sesi 138207 — Frasa waktu same-day ("kalau siang ini bisa?") adalah jejak
 * hari INI yang sah (alias mapping lestari). Sesi 337880: jejak alias TIDAK
 * lagi meloloskan interogatif '?' — slot inquiry same-day diblokir seperti
 * hari lain; pencatatan menunggu verba komitmen.
 */
describe('Day Evidence Same-Day Alias (sesi 138207 + 337880)', () => {
  it('"Hari ini" via interogatif alias saja -> DITOLAK (slot inquiry, 337880)', () => {
    expect(verifyDayMentioned('Hari ini', ['kalau siang ini bisa ?', 'siap bund'])).not.toBeNull();
  });

  it('"Hari ini" via komitmen berverba (+ alias) -> lolos (null)', () => {
    expect(verifyDayMentioned('Hari ini', ['kalau siang ini bisa ?', 'Oke fix siang ini ya'])).toBeNull();
  });

  it('varian same-day lain (pagi/sore/malam/nanti): interogatif ditolak, verba lolos', () => {
    expect(verifyDayMentioned('Hari ini', ['kalau pagi ini bisa?'])).not.toBeNull();
    expect(verifyDayMentioned('Hari ini', ['Oke fix pagi ini ya'])).toBeNull();
    expect(verifyDayMentioned('Hari ini', ['nanti sore bisa kah?'])).not.toBeNull();
    expect(verifyDayMentioned('Hari ini', ['hari ini juga bisa?'])).not.toBeNull();
  });

  it('tanpa jejak hari tetap ditolak — dengan arahan hangat, bukan bentakan', () => {
    const err = verifyDayMentioned('Besok', ['tidak ada, saya ambil treatment nya']);
    expect(err).not.toBeNull();
    expect(err as string).toContain('tahap pengecekan');
    expect(err as string).not.toContain('Gagal:');
  });
});
