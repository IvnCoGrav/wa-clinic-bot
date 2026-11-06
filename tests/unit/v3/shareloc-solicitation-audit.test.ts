import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FEW_SHOT_EXEMPLARS,
} from '../../../src/v3/agent/few-shot-exemplars';
import { GOLD_FEW_SHOT_EXEMPLARS } from '../../../src/v3/agent/gold-few-shot-exemplars';
import { TEMPLATES } from '../../../src/config/persona';
import { hasShareLocationSolicitation } from '../../../src/domain/shareloc-solicitation';

/**
 * Audit exemplar & template (temuan C-008): contoh prompt dan template bisnis
 * TIDAK boleh mengajarkan/mengajak shareloc. `askShareLocation` sengaja
 * dikecualikan karena jalur pasca-booking (lihat persona-shareloc-anti-solicitation).
 */
describe('Audit shareloc — few-shot exemplars & template reservasi', () => {
  it('seluruh few-shot exemplar (default + gold) bebas ajakan shareloc', () => {
    const violations: string[] = [];
    for (const ex of [...DEFAULT_FEW_SHOT_EXEMPLARS, ...GOLD_FEW_SHOT_EXEMPLARS]) {
      if (hasShareLocationSolicitation(ex.idealResponse)) {
        violations.push(`${ex.id || ex.scenario}: ${ex.idealResponse}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('template form reservasi tidak memakai label "Shareloc"', () => {
    const form = TEMPLATES.reservationFormRequest({});
    expect(form).not.toMatch(/share\s*loc/i);
    expect(form).toContain('Alamat Lengkap & Patokan');
  });

  it('template konfirmasi reservasi tidak memakai label "Shareloc"', () => {
    const confirmed = TEMPLATES.reservationConfirmed({
      date: 'Senin 9 November 2026 jam 10.00-10.30',
      name: 'Bunda Lutfiah',
      address: 'Rungkut kidul gang 2',
      kec: 'Rungkut',
      kota: 'Surabaya',
      phone: '6285168615559',
      treatmentDetail: 'Pijat Ceria',
      treatmentPrice: 80000,
      ongkir: 0,
      promoDiscount: 0,
      total: 80000,
    } as any);
    expect(confirmed).not.toMatch(/share\s*loc/i);
    expect(confirmed).toContain('Alamat Lengkap & Patokan');
  });

  it('askShareLocation pasca-booking tetap disengaja (tidak ikut dihapus)', () => {
    expect(TEMPLATES.askShareLocation()).toMatch(/share location/i);
  });
});
