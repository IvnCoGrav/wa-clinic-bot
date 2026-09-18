import { describe, it, expect } from 'vitest';
import { validateNumericFacts } from '../../src/v3/guardrails/numeric-fact-validator';

/**
 * Plan regresi Fase 4 — whitelist data-driven targetPrice.
 * Nominal tawar customer (args.targetPrice terstruktur router Call 1) yang
 * dikutip LLM untuk klarifikasi/penolakan DILARANG dicap halusinasi dan
 * DILARANG memicu reprompt penimpaan ke total keranjang.
 */
describe('numeric-fact-validator — whitelist targetPrice (Fase 4)', () => {
  const catalogTools = [{ name: 'get_catalog_and_price', args: {}, result: { treatments: [] } }];

  it('kutipan targetPrice 900k lolos (kasus "Kalau 900k apakah boleh kak?")', () => {
    const tools = [{ name: 'get_catalog_and_price', args: { targetPrice: 900000 }, result: { treatments: [] } }];
    const res = validateNumericFacts(
      'Untuk nominal Rp 900.000 belum ada paket yang sesuai ya Bunda.',
      tools
    );
    expect(res.isValid).toBe(true);
    expect(res.violations).toHaveLength(0);
  });

  it('KONTROL NEGATIF: Rp 900.000 tanpa args targetPrice tetap violation', () => {
    const res = validateNumericFacts(
      'Untuk nominal Rp 900.000 belum ada paket yang sesuai ya Bunda.',
      catalogTools
    );
    expect(res.isValid).toBe(false);
    expect(res.violations.length).toBeGreaterThan(0);
  });

  it('angka liar Rp 999.999 dengan targetPrice lain tetap violation', () => {
    const tools = [{ name: 'get_catalog_and_price', args: { targetPrice: 900000 }, result: { treatments: [] } }];
    const res = validateNumericFacts('Totalnya Rp 999.999 ya Bunda.', tools);
    expect(res.isValid).toBe(false);
  });

  it('targetPrice non-angka/diabaikan aman (tanpa throw)', () => {
    const tools = [{ name: 'get_catalog_and_price', args: { targetPrice: 'sembilan ratus' }, result: { treatments: [] } }];
    const res = validateNumericFacts('Halo Bunda, ada yang bisa kami bantu?', tools);
    expect(res.isValid).toBe(true);
  });

  it('angka resmi katalog tetap lolos tanpa args', () => {
    const tools = [{
      name: 'get_catalog_and_price',
      args: {},
      result: { treatments: [{ promoPrice: 155000, originalPrice: 200000 }] },
    }];
    const res = validateNumericFacts('Paketnya Rp 155.000 ya Bunda.', tools);
    expect(res.isValid).toBe(true);
  });
});
