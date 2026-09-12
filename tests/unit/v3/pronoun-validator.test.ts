import { describe, it, expect } from 'vitest';
import { detectFirstPersonSlip } from '../../../src/v3/guardrails/pronoun-validator';

/**
 * Sesi 834128 ("beritahu saya") — aturan emas 7 ditegakkan via DETEKSI +
 * reprompt, TANPA penggantian string tengah kalimat (Mandat Minimal-Regex).
 */
describe('Pronoun Validator (aturan emas 7)', () => {
  it('"beritahu saya ..." -> INVALID', () => {
    const r = detectFirstPersonSlip(
      'Bisa tolong beritahu saya kelurahan atau kecamatan tempat tinggal Bunda? 🤗',
      { isFollowUp: true }
    );
    expect(r.isValid).toBe(false);
    expect(r.violations.length).toBeGreaterThan(0);
  });

  it('"Ada yang bisa saya bantu" -> INVALID', () => {
    expect(detectFirstPersonSlip('Ada yang bisa saya bantu Bunda?', { isFollowUp: true }).isValid).toBe(false);
  });

  it('"kami bantu / Bidan kami" -> VALID', () => {
    const r = detectFirstPersonSlip(
      'Untuk jadwal hari ini, kami bantu cekkan ketersediaan jadwalnya dulu ya Bunda 😊 Nanti segera kami kabari ya bund 🤗',
      { isFollowUp: true }
    );
    expect(r.isValid).toBe(true);
  });

  it('perkenalan resmi Turn-0 ("Perkenalkan, saya Bidan Yusi") -> VALID', () => {
    const r = detectFirstPersonSlip(
      'Halo Bunda! Perkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa.',
      { isFollowUp: false }
    );
    expect(r.isValid).toBe(true);
  });

  it('tidak ada false-positive substring ("misalnya")', () => {
    const r = detectFirstPersonSlip('Misalnya untuk pijat bayi bisa kami sesuaikan ya Bunda', {
      isFollowUp: true,
    });
    expect(r.isValid).toBe(true);
  });
});
