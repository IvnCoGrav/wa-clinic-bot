import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../../src/v3/state/goal-tracker';

const CATALOG = [
  { name: 'Pijat Bayi Ceria', promoPrice: 60000, originalPrice: 80000, category: 'BABY', isAddon: false },
  { name: 'Pijat Kids Ceria (Usia 2-4 th)', promoPrice: 70000, originalPrice: 90000, category: 'KIDS', isAddon: false },
  { name: 'Pijat Kids Pulih Ceria (Usia 2-4 th)', promoPrice: 75000, originalPrice: 95000, category: 'KIDS', isAddon: false },
];

const baseSession: any = { genderGreeting: 'Bunda' };
const msg = (content: string, role = 'user') => ({ role, content });

/**
 * Fase 3' — Anti-kunci sepihak (Turn 6): asisten menawarkan 2 opsi, customer
 * membalas kalimat generik kategori ("mau janjian pijat balita usia 2 tahun")
 * TANPA menyebut salah satu opsi → keranjang WAJIB tetap kosong hingga
 * customer benar-benar memilih.
 */
describe('Cart anti-kunci sepihak atas kalimat generik (Fase 3)', () => {
  it('Turn 6: kalimat generik kategori tidak mengunci salah satu opsi', () => {
    const cart = GoalTracker.syncCartItems(baseSession, [
      msg('Ada Pijat Kids Ceria dan Pijat Kids Pulih Ceria untuk usia 2 tahun, Bunda mau yang mana?', 'assistant'),
      msg('Saya mau janjian pijat balita usia 2 tahun'),
    ], CATALOG as any);
    expect(cart).toHaveLength(0);
  });

  it('kontrol: penyebutan eksplisit tetap mengunci', () => {
    const cart = GoalTracker.syncCartItems(baseSession, [
      msg('Ada Pijat Kids Ceria dan Pijat Kids Pulih Ceria untuk usia 2 tahun, Bunda mau yang mana?', 'assistant'),
      msg('Ambil yang Pijat Kids Ceria ya'),
    ], CATALOG as any);
    expect(cart).toHaveLength(1);
    expect(cart[0].name).toBe('Pijat Kids Ceria (Usia 2-4 th)');
  });
});
