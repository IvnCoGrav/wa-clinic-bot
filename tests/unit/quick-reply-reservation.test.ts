import { describe, it, expect } from 'vitest';
import { selectQuickReplyReservation } from '../../packages/admin-dashboard/src/utils/quickReplyReservation';

/**
 * Regresi AUDIT LIVE CHAT #316: interpolasi Balasan Cepat tidak boleh memakai
 * reservasi lama hanya karena statusnya `confirmed`.
 */
describe('selectQuickReplyReservation', () => {
  const now = new Date('2026-11-06T10:00:00+07:00').getTime();
  const iso = (daysFromNow: number, hour = 9) => {
    const d = new Date(now + daysFromNow * 24 * 60 * 60 * 1000);
    d.setUTCHours(hour - 7, 0, 0, 0); // WIB → UTC
    return d.toISOString();
  };

  it('memilih jadwal terdekat yang akan datang, bukan yang pertama di array', () => {
    const picked = selectQuickReplyReservation(
      [
        { id: 'far', status: 'confirmed', booking_date: iso(7) },
        { id: 'near', status: 'confirmed', booking_date: iso(1) },
        { id: 'mid', status: 'confirmed', booking_date: iso(3) },
      ],
      now
    );
    expect(picked?.id).toBe('near');
  });

  it('ADVERSARIAL: reservasi confirmed 2 bulan lalu TIDAK dipakai', () => {
    const picked = selectQuickReplyReservation(
      [{ id: 'stale', status: 'confirmed', booking_date: iso(-60) }],
      now
    );
    expect(picked).toBeNull();
  });

  it('sesi yang sedang berjalan (mulai 1 jam lalu) masih boleh dipakai', () => {
    const picked = selectQuickReplyReservation(
      [{ id: 'ongoing', status: 'en_route', booking_date: new Date(now - 60 * 60 * 1000).toISOString() }],
      now
    );
    expect(picked?.id).toBe('ongoing');
  });

  it('fallback: sesi paling akhir dalam 24 jam terakhir', () => {
    const picked = selectQuickReplyReservation(
      [
        { id: 'older', status: 'confirmed', booking_date: new Date(now - 20 * 60 * 60 * 1000).toISOString() },
        { id: 'latest', status: 'hold', booking_date: new Date(now - 3 * 60 * 60 * 1000).toISOString() },
      ],
      now
    );
    expect(picked?.id).toBe('latest');
  });

  it('mengabaikan status non-aktif (completed/cancelled) dan tanggal invalid', () => {
    const picked = selectQuickReplyReservation(
      [
        { id: 'done', status: 'completed', booking_date: iso(1) },
        { id: 'cancelled', status: 'cancelled', booking_date: iso(1) },
        { id: 'bad-date', status: 'confirmed', booking_date: 'bukan-tanggal' },
        { id: 'valid', status: 'pending', booking_date: iso(2) },
      ],
      now
    );
    expect(picked?.id).toBe('valid');
  });

  it('null bila daftar kosong / bukan array', () => {
    expect(selectQuickReplyReservation([], now)).toBeNull();
    expect(selectQuickReplyReservation(null, now)).toBeNull();
    expect(selectQuickReplyReservation(undefined, now)).toBeNull();
  });
});
