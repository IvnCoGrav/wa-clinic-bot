import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../src/v3/state/goal-tracker';

/**
 * Fase 2 (Cart Precision): pemilihan kandidat fuzzy DILARANG greedy nama
 * terpanjang. Skor relevansi: jumlah kata cocok → rasio cocok → penalti kata
 * ekstra yang TIDAK disebut customer → panjang hanya tie-breaker terakhir.
 */
const CATALOG_SELAPAN = [
  { id: 'baby-paket-selapan', name: 'Kala Bundle Selapan – Cukur + Pijat Ceria', promoPrice: 80000, originalPrice: 115000, category: 'BUNDLE', isAddon: false, bundleItemIds: ['baby-cukur', 'baby-massage-ceria'] },
  { id: 'baby-paket-selapan-full', name: 'Kala Bundle Selapan Full – Cukur + Ceria + Mandi', promoPrice: 100000, originalPrice: 155000, category: 'BUNDLE', isAddon: false, bundleItemIds: ['baby-cukur', 'baby-massage-ceria', 'baby-mandi'] },
  { id: 'baby-paket-selapan-terapi', name: 'Kala Bundle Selapan – Cukur + Pijat Pulih Ceria', promoPrice: 90000, originalPrice: 135000, category: 'BUNDLE', isAddon: false, bundleItemIds: ['baby-cukur', 'baby-massage-pulih-ceria'] },
  { id: 'baby-paket-selapan-terapi-full', name: 'Kala Bundle Selapan Full – Cukur + Pulih Ceria + Mandi', promoPrice: 110000, originalPrice: 175000, category: 'BUNDLE', isAddon: false, bundleItemIds: ['baby-cukur', 'baby-massage-pulih-ceria', 'baby-mandi'] },
];

const baseSession: any = { genderGreeting: 'Bunda' };
const msg = (content: string, role = 'user') => ({ role, content });

describe('v3 cart fuzzy ranking (anti-greedy)', () => {
  it('"bundle cukur+pijat ceria" → pilih paket 80rb, BUKAN Full+Mandi 100rb', () => {
    const cart = GoalTracker.syncCartItems(baseSession, [
      msg('mau bundle selapan cukur + pijat ceria ya'),
    ], CATALOG_SELAPAN as any);
    expect(cart).toHaveLength(1);
    expect(cart[0].name).toBe('Kala Bundle Selapan – Cukur + Pijat Ceria');
    expect(cart[0].promoPrice).toBe(80000);
  });

  it('adversarial 5 parafrasa → konsisten paket 80rb (bukan Full)', () => {
    const frasa = [
      'bundle selapan cukur pijat ceria',
      'paket selapan cukur + pijat ceria dong',
      'selapan yg cukur sama pijat ceria',
      'cukur+pijat ceria selapan',
      'mau yang selapan cukur pijat ceria',
    ];
    for (const f of frasa) {
      const cart = GoalTracker.syncCartItems(baseSession, [msg(f)], CATALOG_SELAPAN as any);
      expect(cart, f).toHaveLength(1);
      expect(cart[0].name, f).toBe('Kala Bundle Selapan – Cukur + Pijat Ceria');
    }
  });

  it('jika customer menyebut mandi → Full boleh menang (tidak over-block)', () => {
    const cart = GoalTracker.syncCartItems(baseSession, [
      msg('selapan full cukur ceria mandi'),
    ], CATALOG_SELAPAN as any);
    expect(cart).toHaveLength(1);
    expect(cart[0].name).toBe('Kala Bundle Selapan Full – Cukur + Ceria + Mandi');
  });
});
