import { describe, it, expect } from 'vitest';
import { reservationStatusToTone } from '../../packages/admin-dashboard/src/utils/statusTone';
import { TONE_STYLES, toneChipClass, toneRingClass } from '../../packages/admin-dashboard/src/lib/statusTones';
import type { StatusTone } from '../../packages/admin-dashboard/src/lib/statusTones';

const TONES: StatusTone[] = ['success', 'info', 'warning', 'caution', 'danger', 'neutral'];

/**
 * Kontrak statusTone — pemetaan status reservasi ke tone semantik.
 *
 * Fokus adversarial: variasi penulisan status dari DB/legacy, status kosong,
 * dan semantik `paid` yang hanya boleh mengubah status `completed`.
 */
describe('reservationStatusToTone', () => {
  it('memetakan status kanonik ke tone yang benar', () => {
    expect(reservationStatusToTone('confirmed')).toBe('success');
    expect(reservationStatusToTone('cancelled')).toBe('danger');
    expect(reservationStatusToTone('rejected')).toBe('danger');
    expect(reservationStatusToTone('hold')).toBe('warning');
    expect(reservationStatusToTone('pending')).toBe('warning');
    expect(reservationStatusToTone('en_route')).toBe('info');
  });

  it('tahan variasi penulisan & alias legacy (case, spasi, otw)', () => {
    expect(reservationStatusToTone('  CONFIRMED ')).toBe('success');
    expect(reservationStatusToTone('OTW')).toBe('info');
    expect(reservationStatusToTone('on_the_way')).toBe('info');
    expect(reservationStatusToTone('En_Route')).toBe('info');
  });

  it('status kosong/tak dikenal → neutral, tidak crash', () => {
    expect(reservationStatusToTone(undefined)).toBe('neutral');
    expect(reservationStatusToTone(null)).toBe('neutral');
    expect(reservationStatusToTone('')).toBe('neutral');
    expect(reservationStatusToTone('status_karangan')).toBe('neutral');
  });

  it('completed + lunas → success', () => {
    expect(reservationStatusToTone('completed', true)).toBe('success');
  });

  it('completed + belum lunas → caution (perlu penagihan)', () => {
    expect(reservationStatusToTone('completed', false)).toBe('caution');
  });

  it('completed tanpa info pembayaran → neutral (tidak mengklaim lunas/belum)', () => {
    expect(reservationStatusToTone('completed')).toBe('neutral');
    expect(reservationStatusToTone('completed', undefined)).toBe('neutral');
  });

  it('paid tidak boleh mengubah status selain completed', () => {
    for (const status of ['confirmed', 'cancelled', 'hold', 'pending', 'en_route', 'status_karangan']) {
      const withoutPaid = reservationStatusToTone(status);
      expect(reservationStatusToTone(status, true)).toBe(withoutPaid);
      expect(reservationStatusToTone(status, false)).toBe(withoutPaid);
    }
  });
});

describe('TONE_STYLES (sumber tunggal warna status)', () => {
  const HEX_RE = /#[0-9a-fA-F]{3,8}/;
  const RAW_PALETTE = /\b(?:bg|text|border|ring)-(?:emerald|green|teal|lime|amber|yellow|orange|rose|red|pink|sky|blue|indigo|cyan|violet|purple|fuchsia|slate|gray|zinc|neutral|stone)-\d{2,3}\b/;

  it('mencakup seluruh tone tanpa sisa', () => {
    for (const tone of TONES) {
      expect(TONE_STYLES[tone]).toBeDefined();
      expect(TONE_STYLES[tone].bg).toMatch(/^bg-/);
      expect(TONE_STYLES[tone].text).toMatch(/^text-/);
      expect(TONE_STYLES[tone].line).toMatch(/^border-/);
      expect(TONE_STYLES[tone].ring).toMatch(/^ring-/);
      expect(TONE_STYLES[tone].dot).toMatch(/^bg-/);
    }
  });

  it('tidak memakai hex maupun palet mentah (paritas dua mode terjaga)', () => {
    for (const tone of TONES) {
      for (const cls of Object.values(TONE_STYLES[tone])) {
        expect(cls).not.toMatch(HEX_RE);
        expect(cls).not.toMatch(RAW_PALETTE);
        expect(cls).not.toContain('dark:');
      }
    }
  });

  it('kelas chip & ring terbentuk lengkap untuk setiap tone', () => {
    for (const tone of TONES) {
      const chip = toneChipClass(tone);
      const ring = toneRingClass(tone);
      expect(chip).toContain(TONE_STYLES[tone].bg);
      expect(chip).toContain(TONE_STYLES[tone].text);
      expect(chip).toContain(TONE_STYLES[tone].line);
      expect(ring).toContain(TONE_STYLES[tone].ring);
      expect(ring).not.toContain('border-');
    }
  });
});
