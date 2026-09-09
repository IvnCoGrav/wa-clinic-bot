import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../src/v3/state/goal-tracker';

/**
 * Masalah 3 sesi 435731: nama resmi katalog berkurung
 * ('Pijat Bayi Ceria (Rileksasi)') tidak cocok dengan sebutan chat
 * ('Pijat Bayi Ceria') sehingga item hilang dari cartItems.
 */
const CATALOG_PARENS = [
  { name: 'Pijat Bayi Ceria (Rileksasi)', promoPrice: 60000, originalPrice: 80000, category: 'BABY', isAddon: false },
  { name: 'Induksi Massage Fullbody', promoPrice: 105000, originalPrice: 130000, category: 'MOMS', isAddon: false },
  { name: 'Pijat Bayi Pulih Ceria', promoPrice: 70000, originalPrice: 90000, category: 'BABY', isAddon: false },
];

const baseSession: any = { genderGreeting: 'Bunda' };
const msg = (content: string, role = 'user') => ({ role, content });

describe('Cart sync nama katalog berkurung (Masalah 3 sesi 435731)', () => {
  it('sebutan tanpa kurung cocok ke nama resmi berkurung', () => {
    const cart = GoalTracker.syncCartItems(baseSession, [
      msg('kalau sama pijet anak saya bisa nggak ya, Pijat Bayi Ceria'),
    ], CATALOG_PARENS as any);
    expect(cart).toHaveLength(1);
    expect(cart[0].name).toBe('Pijat Bayi Ceria (Rileksasi)');
    expect(cart[0].promoPrice).toBe(60000);
  });

  it('multi-pasien Mom+Baby: kedua layanan masuk keranjang (105k + 60k)', () => {
    const cart = GoalTracker.syncCartItems(baseSession, [
      msg('Saya uk 38 weeks, mau induksi massage fullbody'),
      msg('kalau sama pijet anak saya bisa nggak ya, Pijat Bayi Ceria'),
    ], CATALOG_PARENS as any);
    expect(cart).toHaveLength(2);
    const moms = cart.find((c) => c.recipientScope === 'MOMS');
    expect(moms?.name).toBe('Induksi Massage Fullbody');
    const babyNames = cart.map((c) => c.name);
    expect(babyNames).toContain('Pijat Bayi Ceria (Rileksasi)');
    const subtotal = cart.reduce((s, it) => s + (it.promoPrice ?? it.price), 0);
    expect(subtotal).toBe(165000);
  });

  it('total akumulasi + ongkir promo 25k = Rp 190.000', () => {
    const cart = GoalTracker.syncCartItems(baseSession, [
      msg('Saya uk 38 weeks, mau induksi massage fullbody'),
      msg('kalau sama pijet anak saya bisa nggak ya, Pijat Bayi Ceria'),
    ], CATALOG_PARENS as any);
    const total = GoalTracker.calcCartTotal({
      ...baseSession,
      cartItems: cart,
      location: { rawText: 'Kedungkendo', ongkirPromo: 25000 },
    } as any);
    expect(total).toBe(190000);
  });

  it('filter overlap tetap menang yang spesifik (Pulih Ceria vs Ceria)', () => {
    const cart = GoalTracker.syncCartItems(baseSession, [
      msg('Anak batuk pilek, mau Pijat Bayi Pulih Ceria'),
    ], CATALOG_PARENS as any);
    expect(cart).toHaveLength(1);
    expect(cart[0].name).toBe('Pijat Bayi Pulih Ceria');
  });

  it('pesan asisten tanpa nama resmi utuh tetap tidak memicu phantom item', () => {
    const cart = GoalTracker.syncCartItems(baseSession, [
      msg('Kami melayani Treatment moms & Baby langsung ke rumah ya Bunda', 'assistant'),
    ], CATALOG_PARENS as any);
    expect(cart).toHaveLength(0);
  });
});
