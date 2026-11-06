import { describe, it, expect } from 'vitest';
import { hasShareLocationSolicitation } from '../../src/domain/shareloc-solicitation';

describe('shareloc-solicitation — lint teks keluar (Aturan Emas 21)', () => {
  const violations = [
    'Oh ya boleh izin kirim sharelock nya bund untuk titik pastinya 🙏😊',
    'Atau mungkin bisa shareloct bund, Nanti kami bantu cek kan ongkirnya 🤗',
    'Boleh juga kirim titik lokasinya agar lebih akurat 🙏',
    'Mohon kirim share location ya Bunda',
    'Bunda, minta shareloc-nya ya',
    'Boleh bantu kirimkan titik lokasi (shareloc WhatsApp) atau seret pin peta di rumah Bunda',
    'Boleh minta tolong kirimkan shareloc WhatsApp terkini dan patokan rumahnya ya Bun',
    'silakan share lock rumahnya bund',
  ];

  const safe = [
    'Kalau boleh tau rumahnya kelurahan mana ya Bunda?',
    'Boleh sebutkan nama perumahan atau patokan terdekatnya ya Bunda',
    'Basecamp kami di Waru, perbatasan Surabaya–Sidoarjo',
    'DILARANG menanyakan shareloc kepada customer saat menjadwalkan kunjungan',
    'tanpa menanyakan share location, cukup tanyakan kelurahan',
    'Silakan share postingan treatmentnya dan tag @kala.babyspa ya Bunda',
    'Bunda bisa share treatmentnya ke media sosial untuk diskon 10%',
    'Hari dan tanggal : Senin 9 November 2026',
  ];

  for (const text of violations) {
    it(`menolak: ${text.slice(0, 48)}...`, () => {
      expect(hasShareLocationSolicitation(text)).toBe(true);
    });
  }

  for (const text of safe) {
    it(`meloloskan: ${text.slice(0, 48)}...`, () => {
      expect(hasShareLocationSolicitation(text)).toBe(false);
    });
  }

  it('teks kosong / null aman', () => {
    expect(hasShareLocationSolicitation('')).toBe(false);
    expect(hasShareLocationSolicitation(null as any)).toBe(false);
  });
});
