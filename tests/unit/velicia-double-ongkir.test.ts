import { describe, it, expect } from 'vitest';
import { ALL_V3_TOOLS } from '../../src/v3/tools/tool-registry';
import {
  evaluateToolMasking,
  getDetectedLocationEntities,
  isRedundantLocationRepeat,
} from '../../src/v3/tools/tool-masker';
import { CustomerGoalSession } from '../../src/v3/domain/types';

/**
 * Regresi fondasional kasus Velicia lovitasari (628980297189) — double ongkir.
 *
 * Akar masalah: 2 bubble alamat beruntun ("Taman wisata Regency" + "Gadung")
 * diproses sebagai 2 job terpisah. Pada job ke-2, `hasNewLocationEntity("Gadung")`
 * bernilai true (Gadung ada di gazetteer) sehingga calculate_delivery bocor dan
 * dihitung ULANG walau lokasi sudah tersimpan & ongkir sudah QUOTED.
 *
 * Guard deterministik: bila seluruh entitas lokasi pada pesan customer sudah
 * tercakup di session.location yang sudah ter-resolve + QUOTED, calculate_delivery
 * DICABUT SECARA FISIK. Bukan hafalan kalimat — murni perbandingan state.
 *
 * Catatan adversarial: seluruh varian parafrase/typo/urutan kata diuji, bukan
 * hanya meniru verbatim kalimat penguji.
 */

function quotedSession(kelurahan: string, rawText: string): CustomerGoalSession {
  return {
    genderGreeting: 'Bunda',
    cartItems: [],
    location: { rawText, kelurahan, distanceKm: 17.9, ongkirNormal: 30000, ongkirPromo: 20000 },
    ongkirStatus: 'QUOTED',
  };
}

function hasDelivery(result: { availableTools: any[] }): boolean {
  return result.availableTools.some((t) => t.function?.name === 'calculate_delivery');
}
function isDeliveryMasked(result: { maskedToolNames: string[] }): boolean {
  return result.maskedToolNames.includes('calculate_delivery');
}

describe('Velicia Double-Ongkir — Anti-Redundant Location Guard', () => {
  describe('1. getDetectedLocationEntities (data-driven, word-boundary)', () => {
    it('mendeteksi entitas gazetteer nyata (Gadung/Taman/Sedati/Krian)', () => {
      expect(getDetectedLocationEntities('Gadung')).toContain('Gadung');
      expect(getDetectedLocationEntities('Taman wisata Regency')).toContain('Taman');
      expect(getDetectedLocationEntities('Kalau ke Sedati berapa ya?')).toContain('Sedati');
      expect(getDetectedLocationEntities('pindah ke Krian')).toContain('Krian');
    });

    it('TIDAK mendeteksi kata berimbuhan/umum (tertarik/kuota/pricelist)', () => {
      expect(getDetectedLocationEntities('saya tertarik kak')).toEqual([]);
      expect(getDetectedLocationEntities('masih ada kuota?')).toEqual([]);
      expect(getDetectedLocationEntities('kirim pricelist dong')).toEqual([]);
    });

    it('tahan typo 1-huruf untuk token panjang (sedti → Sedati)', () => {
      expect(getDetectedLocationEntities('sedti')).toContain('Sedati');
    });
  });

  describe('2. isRedundantLocationRepeat (state-based, tanpa hafalan kalimat)', () => {
    it('repeat entitas yang sudah tercatat + QUOTED → redundant', () => {
      const s = quotedSession('Gadung', 'Gadung, Sidoarjo');
      expect(isRedundantLocationRepeat('Gadung', s)).toBe(true);
      expect(isRedundantLocationRepeat('gadung', s)).toBe(true);
      expect(isRedundantLocationRepeat('  Gadung  ', s)).toBe(true);
      expect(isRedundantLocationRepeat('gadung berapa kak', s)).toBe(true);
    });

    it('fragmen perumahan yang katanya bagian dari rawText lama → redundant', () => {
      const s = quotedSession('Taman', 'Taman Wisata Regency, Taman');
      expect(isRedundantLocationRepeat('Taman wisata Regency', s)).toBe(true);
      expect(isRedundantLocationRepeat('Regency', s)).toBe(true);
    });

    it('entitas BARU yang berbeda → BUKAN redundant (tool tetap tersedia)', () => {
      const s = quotedSession('Gadung', 'Gadung, Sidoarjo');
      expect(isRedundantLocationRepeat('Kalau ke Sedati berapa ya?', s)).toBe(false);
      expect(isRedundantLocationRepeat('Bukan di situ kak, pindah ke Krian', s)).toBe(false);
      expect(isRedundantLocationRepeat('pindah ya kak', s)).toBe(false);
      expect(isRedundantLocationRepeat('rumah mertua saya', s)).toBe(false);
    });

    it('Google Maps / koordinat GPS = pinpoint baru → BUKAN redundant', () => {
      const s = quotedSession('Gadung', 'Gadung, Sidoarjo');
      expect(isRedundantLocationRepeat('ini mapsnya kak https://maps.app.goo.gl/AbCdEf', s)).toBe(false);
      expect(isRedundantLocationRepeat('https://maps.google.com/?q=-7.34,112.75', s)).toBe(false);
      expect(isRedundantLocationRepeat('-7.3456, 112.7523', s)).toBe(false);
    });

    it('sesi belum resolusi / ongkir belum QUOTED → BUKAN redundant (jangan over-mask)', () => {
      expect(isRedundantLocationRepeat('Gadung', null)).toBe(false);
      expect(isRedundantLocationRepeat('Gadung', undefined)).toBe(false);
      const unresolved: CustomerGoalSession = { genderGreeting: 'Bunda', cartItems: [] };
      expect(isRedundantLocationRepeat('Gadung', unresolved)).toBe(false);
      const resolvedButUnquoted: CustomerGoalSession = {
        genderGreeting: 'Bunda',
        cartItems: [],
        location: { rawText: 'Gadung', kelurahan: 'Gadung' },
        ongkirStatus: 'UNQUOTED',
      };
      expect(isRedundantLocationRepeat('Gadung', resolvedButUnquoted)).toBe(false);
    });

    it('repeat lokasi di luar cakupan yang sudah di-verdict → redundant', () => {
      const s: CustomerGoalSession = {
        genderGreeting: 'Bunda',
        cartItems: [],
        location: { rawText: 'Tuban', isOutOfCoverage: true, distanceKm: 99 },
        ongkirStatus: 'QUOTED',
      };
      expect(isRedundantLocationRepeat('Tuban', s)).toBe(true);
    });
  });

  describe('3. Integrasi evaluateToolMasking (masking fisik calculate_delivery)', () => {
    it('repeat "Gadung"/"Taman wisata Regency" pasca-QUOTED → calculate_delivery MASKED', () => {
      const s = quotedSession('Gadung', 'Gadung, Sidoarjo');
      expect(isDeliveryMasked(evaluateToolMasking(ALL_V3_TOOLS, s, 'Gadung'))).toBe(true);
      expect(hasDelivery(evaluateToolMasking(ALL_V3_TOOLS, s, 'Gadung'))).toBe(false);

      const t = quotedSession('Taman', 'Taman Wisata Regency, Taman');
      expect(isDeliveryMasked(evaluateToolMasking(ALL_V3_TOOLS, t, 'Taman wisata Regency'))).toBe(true);
    });

    it('alamat BARU → calculate_delivery TETAP TERSEDIA', () => {
      const s = quotedSession('Gadung', 'Gadung, Sidoarjo');
      expect(hasDelivery(evaluateToolMasking(ALL_V3_TOOLS, s, 'Kalau ke Sedati berapa ya?'))).toBe(true);
      expect(hasDelivery(evaluateToolMasking(ALL_V3_TOOLS, s, 'Bukan di situ kak, pindah ke Krian'))).toBe(true);
      expect(hasDelivery(evaluateToolMasking(ALL_V3_TOOLS, s, 'Maaf keliru, di Rungkut Menanggal Surabaya'))).toBe(true);
    });

    it('Google Maps link → calculate_delivery TETAP TERSEDIA', () => {
      const s = quotedSession('Gadung', 'Gadung, Sidoarjo');
      expect(hasDelivery(evaluateToolMasking(ALL_V3_TOOLS, s, 'ini mapsnya kak https://maps.app.goo.gl/AbCdEf'))).toBe(true);
    });

    it('sesi awal tanpa lokasi → calculate_delivery TETAP TERSEDIA saat sebut lokasi', () => {
      const s: CustomerGoalSession = { genderGreeting: 'Bunda', cartItems: [] };
      expect(hasDelivery(evaluateToolMasking(ALL_V3_TOOLS, s, 'Gadung'))).toBe(true);
    });
  });
});
