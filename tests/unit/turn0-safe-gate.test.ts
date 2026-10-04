import { describe, it, expect } from 'vitest';
import {
  isPureLeadGreeting,
  isSafeForStaticTurn0Reply,
  hasSpecificTurn0Question,
  hasTurn0LocationEntity,
} from '../../src/utils/lead-greeting-detector';

/**
 * Fase 1 (Revisi Turn-0): gerbang aman untuk balasan statis.
 * - Perluasan tata bahasa fungsional (bingkai tanya prosedural), BUKAN hafalan kalimat.
 * - Filter bahaya re-use guard lokasi + pertanyaan spesifik yang sudah ada.
 */
describe('Turn-0 safe static gate (revisi)', () => {
  it('contoh lapangan: booking + "Bagaimana Caranya?" → sapaan statis', () => {
    const r = isPureLeadGreeting('Hallo Bu Bidan, Saya mau booking home service. Bagaimana Caranya ?');
    expect(r.isLeadGreeting).toBe(true);
  });

  it('ragam bingkai tanya prosedural → sapaan statis', () => {
    for (const t of [
      'halo bu bidan mau booking home service bagaimana caranya',
      'assalamualaikum gimana cara booking ya',
      'permisi kak cara order',
      'halo mau reservasi gimana caranya',
    ]) {
      expect(isPureLeadGreeting(t).isLeadGreeting, t).toBe(true);
    }
  });

  it('filter bahaya: keluhan medis → BUKAN statis', () => {
    expect(isSafeForStaticTurn0Reply('Halo bu bidan anak saya batuk pilek 3 hari')).toBe(false);
    expect(isPureLeadGreeting('Halo bu bidan anak saya batuk pilek 3 hari').isLeadGreeting).toBe(false);
  });

  it('filter bahaya: lokasi presisi → BUKAN statis', () => {
    expect(isSafeForStaticTurn0Reply('Halo mau booking untuk daerah Tropodo Waru')).toBe(false);
    expect(hasTurn0LocationEntity('Halo mau booking untuk daerah Tropodo Waru')).toBe(true);
  });

  it('filter bahaya: harga spesifik → BUKAN statis', () => {
    expect(isSafeForStaticTurn0Reply('Halo berapa harga paket selapan?')).toBe(false);
    expect(hasSpecificTurn0Question('Halo berapa harga paket selapan?')).toBe(true);
  });

  it('filter bahaya: jadwal spesifik → BUKAN statis', () => {
    expect(isSafeForStaticTurn0Reply('Halo besok sabtu jam 10 pagi bisa homecare?')).toBe(false);
  });

  it('sapaan murni umum tetap lolos', () => {
    expect(isSafeForStaticTurn0Reply('Halo Bu Bidan')).toBe(true);
    expect(isSafeForStaticTurn0Reply('Assalamualaikum')).toBe(true);
    expect(isSafeForStaticTurn0Reply('')).toBe(false);
  });
});
