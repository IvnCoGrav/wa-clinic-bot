import { describe, it, expect } from 'vitest';
import {
  isShortAcknowledgement,
  resolvePostReservationAck,
  POST_RESERVATION_CLOSING,
} from '../../../src/v3/agent/pipeline/context-grounder';

/**
 * Sesi 462651 — acknowledgement pasca-reservasi ("oke kak" → "siap" → ...)
 * memicu 1x closing + handoff, BUKAN loop LLM 100x.
 */
describe('Post-Reservation Handoff (sesi 462651)', () => {
  const booked = {
    preferredDate: 'Hari ini',
    reservationId: 'res-123',
    isConfirmed: false,
    needsStaffVerification: true,
  } as any;

  it('ack pendek terdeteksi: oke/siap/baik/makasih/emoji', () => {
    for (const t of ['oke kak', 'siap', 'baik', 'makasih ya bund', 'terima kasih', 'sip', '👍', 'siap bund']) {
      expect(isShortAcknowledgement(t), t).toBe(true);
    }
  });

  it('bukan ack: pertanyaan baru, jam, kalimat panjang', () => {
    for (const t of ['bayar pake apa', 'jam 16?', 'oke, kalau bayar transfer ya', 'persiapan apa saja bund', '']) {
      expect(isShortAcknowledgement(t), t).toBe(false);
    }
  });

  it('ack pertama -> closing (handoff menyusul via machine)', () => {
    expect(
      resolvePostReservationAck({ booking: booked } as any, 'oke kak')
    ).toBe('closing');
  });

  it('ack kedua+ (closing terkirim) -> silent', () => {
    expect(
      resolvePostReservationAck(
        { booking: { ...booked, handoffClosingSent: true } } as any,
        'siap'
      )
    ).toBe('silent');
  });

  it('tanpa reservasi / tanpa flag verifikasi / bukan ack -> null (alur normal)', () => {
    expect(resolvePostReservationAck({} as any, 'oke kak')).toBeNull();
    expect(
      resolvePostReservationAck({ booking: { reservationId: 'x', isConfirmed: false } } as any, 'siap')
    ).toBeNull();
    expect(resolvePostReservationAck({ booking: booked } as any, 'bayar pake apa')).toBeNull();
  });

  it('closing hangat, first-person, tanpa janji jadwal/jam/nominal', () => {
    expect(POST_RESERVATION_CLOSING).toContain('Bunda');
    expect(POST_RESERVATION_CLOSING).toContain('kami');
    expect(POST_RESERVATION_CLOSING).not.toMatch(/\bsaya\b/i);
    expect(POST_RESERVATION_CLOSING).not.toMatch(/jam \d|menit|Rp|hari apa/i);
  });
});
