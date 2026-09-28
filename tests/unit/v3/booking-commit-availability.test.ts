import { describe, it, expect } from 'vitest';
import {
  isAvailabilityInquiryText,
  hasBookingRetreatSignal,
  verifyDayMentioned,
  hasBookingCommitSignal,
} from '../../../src/utils/date-confirmation';

/**
 * FASE 2.2 — Pertanyaan ketersediaan slot TANPA '?' DILARANG dianggap komitmen
 * booking. Uji adversarial multi-parafrase (mandat anti-overfitting): bukan
 * menghafal kalimat penguji, tapi menguji konstruksi gramatikal tanya.
 */
describe('FASE 2.2 — isAvailabilityInquiryText (adversarial multi-parafrase)', () => {
  const inquiries = [
    'mau booking sabtu jam 10 kosong gak',
    'sabtu jam 10 ada slot min',
    'bisa gak sabtu jam 10',
    'sabtu jam 10 tersedia kah',
    'ada jadwal kosong hari sabtu',
    'masih ada slot untuk sabtu pagi',
    'sabtu bisa ga',
    'slot sabtu masih ada',
    'kosong gak sabtu jam 10',
    'apakah sabtu jam 10 bisa',
    'sabtu jam 10 kosong?',
    'ready kah jadwal besok',
    'ada lowong buat besok',
  ];
  for (const q of inquiries) {
    it(`TANYA SLOT: "${q}" → true`, () => {
      expect(isAvailabilityInquiryText(q)).toBe(true);
    });
  }

  const commits = [
    'mau booking sabtu jam 10',
    'fix sabtu jam 10 ya',
    'ambil yang pijat ceria',
    'jadwalkan besok pagi',
    'iya saya pesan sabtu jam 10',
    'sabtu jam 10 bisa ambil',
  ];
  for (const c of commits) {
    it(`KOMITMEN: "${c}" → false`, () => {
      expect(isAvailabilityInquiryText(c)).toBe(false);
    });
  }
});

describe('FASE 2.2 — verifyDayMentioned: tanya slot tanpa ? DIBLOKIR', () => {
  it('"mau booking sabtu jam 10 kosong gak" → ditolak (bukan booking final)', () => {
    const err = verifyDayMentioned('sabtu', ['mau booking sabtu jam 10 kosong gak']);
    expect(err).not.toBeNull();
  });
  it('kontrol: "mau booking sabtu jam 10" → lolos (komitmen)', () => {
    const err = verifyDayMentioned('sabtu', ['mau booking sabtu jam 10']);
    expect(err).toBeNull();
  });
});

describe('FASE 2.1 — hasBookingRetreatSignal (unlatch sinyal mundur)', () => {
  const retreats = ['tunggu dulu mba', 'batal', 'nanti dulu', 'belum, saya pikir dulu', 'sabtu jam 10 kosong gak'];
  for (const r of retreats) {
    it(`MUNDUR: "${r}" → true`, () => {
      expect(hasBookingRetreatSignal(r)).toBe(true);
    });
  }
  it('KOMITMEN BARU: "iya fix ambil sabtu" → false', () => {
    expect(hasBookingRetreatSignal('iya fix ambil sabtu')).toBe(false);
  });
});
