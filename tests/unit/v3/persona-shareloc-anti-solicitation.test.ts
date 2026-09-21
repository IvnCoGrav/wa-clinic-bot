import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../../../src/config/persona';

/**
 * Sesi 662917 / Issue #77 — residu anjuran share location di template persona.
 * Fase 1: seluruh template yang bocor ke LLM WAJIB bebas solicitation shareloc
 * (Aturan Emas 21: cukup tanya kelurahan/desa/perumahan/patokan terdekat).
 * GUARD SCOPE: askShareLocation (jalur pasca-booking via machine.ts) SENGAJA
 * dipertahankan — jangan jadikan test ini alat cleanup yang menembaknya.
 */
describe('persona templates — anti-solicitation share location', () => {
  const noShareloc = (s: string) => {
    expect(s).not.toMatch(/share\s*loc(?:ation|k)?|sharelock/i);
  };

  it('askKelurahanAmbiguous bebas shareloc di semua cabang (kecamatan / kota / fallback)', () => {
    const kec = TEMPLATES.askKelurahanAmbiguous({ kecamatanName: 'Wonokromo' });
    const city = TEMPLATES.askKelurahanAmbiguous({ isCity: true, cityName: 'Surabaya' });
    const fb = TEMPLATES.askKelurahanAmbiguous({ kelurahanName: 'Sawunggaling' });
    noShareloc(kec);
    noShareloc(city);
    noShareloc(fb);
    expect(kec).toMatch(/kelurahan mana ya\?/i);
    expect(kec).not.toMatch(/Atau jika berkenan/i);
  });

  it('askKelurahanDetail bebas shareloc', () => {
    const t = TEMPLATES.askKelurahanDetail();
    noShareloc(t);
    expect(t).toMatch(/kelurahan|desa/i);
    expect(t).not.toMatch(/Atau kalau berkenan/i);
  });

  it('askKelurahanRetry bebas shareloc', () => {
    const t = TEMPLATES.askKelurahanRetry({ textLocation: 'Wonokromo', currentAttempts: 1 });
    noShareloc(t);
    expect(t).toMatch(/kelurahan|desa/i);
    expect(t).not.toMatch(/Atau jika berkenan/i);
  });

  it('ongkirInclusionPolicy bebas shareloc (cabang nominal & tanpa nominal)', () => {
    noShareloc(TEMPLATES.ongkirInclusionPolicy());
    noShareloc(TEMPLATES.ongkirInclusionPolicy({ kelurahan: 'Sawunggaling', ongkir: 15000 }));
  });

  it('coverageAreaPolicy bebas shareloc', () => {
    noShareloc(TEMPLATES.coverageAreaPolicy());
  });

  it('ongkirInfo bebas shareloc, "Jadi bisa ya", dan sapaan dobel (semua cabang CTA)', () => {
    const base = { distanceKm: 5.5, normalPrice: 15000, promoPrice: 5000 };
    const cta = 'Rencana mau ambil perawatan apa untuk si kecil atau Bunda? 🤗';
    const variants = [
      TEMPLATES.ongkirInfo({ ...base }),
      TEMPLATES.ongkirInfo({ ...base, scheduleCta: cta }),
      TEMPLATES.ongkirInfo({ ...base, scheduleCta: cta, promoPrice: 0, freeTierKm: 5 }),
      TEMPLATES.ongkirInfo({ ...base, candidateTreatmentName: 'Pijat Bayi Ceria (Rileksasi)', preferredDate: 'Sabtu' }),
      TEMPLATES.ongkirInfo({ ...base, candidateTreatmentName: 'Pijat Bayi Ceria (Rileksasi)' }),
      TEMPLATES.ongkirInfo({ ...base, preferredDate: 'Sabtu' }),
      TEMPLATES.ongkirInfo({ ...base, promoPrice: 0, freeTierKm: 5 }),
    ];
    for (const v of variants) {
      noShareloc(v);
      expect(v).not.toMatch(/Jadi bisa ya/i);
      // Reformat: promo → "saja ya Bunda ☺️" (bukan "saja bunda ... Jadi bisa ya").
      expect(v).not.toMatch(/saja bunda[^.,!?\n]/i);
      // Tidak ada sapaan "bunda" dobel dalam jendela kalimat pendek.
      expect(v).not.toMatch(/\bbunda\b[^,.!?\n]{0,25}?\bbunda\b/i);
    }
  });

  it('GUARD SCOPE: askShareLocation (jalur pasca-booking) SENGAJA dipertahankan', () => {
    // machine.ts:396 memilih template ini hanya setelah form reservasi valid &
    // isHumanHandling=true (bypass validator). Jika asersi ini gagal, cleanup
    // masa depan TELAH menembak template legitim pasca-form.
    expect(TEMPLATES.askShareLocation()).toMatch(/share location/i);
  });
});