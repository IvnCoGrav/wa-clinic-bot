import { describe, it, expect } from 'vitest';
import { CartManager } from '../../../src/v3/state/cart-manager';
import type { CartItem } from '../../../src/v3/state/cart-manager';

/**
 * Fondasi 3 — Pediatric Taxonomy Adaptation (audit 983902).
 * adaptCartToAudienceAge: jika usia anak ≥24 bulan, item BABY di keranjang
 * otomatis diselaraskan ke padanan KIDS via token overlap (≥2 token non-generik).
 * Mencegah bidan menerima SOP bayi kecil untuk balita.
 */

/**
 * Token overlap ≥2 non-generic: "lahap" + "juara" overlap antara BABY & KIDS.
 * GENERIC_CLINIC_TOKENS = {pijat, bayi, baby, ...} → kedua "pijat" & "bayi"
 * difilter, jadi overlap murni dari nama treatment non-generik.
 */
const MOCK_CATALOG = [
  { name: 'Bayi Lahap Juara', category: 'BABY', promoPrice: 60000, originalPrice: 75000, id: 'baby-lahap-juara' },
  { name: 'Bayi Ceria', category: 'BABY', promoPrice: 55000, originalPrice: 70000, id: 'baby-ceria' },
  { name: 'Kids Lahap Juara', category: 'KIDS', promoPrice: 70000, originalPrice: 85000, id: 'kids-lahap-juara' },
  { name: 'Kids Ceria', category: 'KIDS', promoPrice: 65000, originalPrice: 80000, id: 'kids-ceria' },
  { name: 'Pijat Ibu Hamil', category: 'MOMS', promoPrice: 100000, originalPrice: 120000, id: 'moms-prenatal' },
] as const;

const BABY_CART_ITEM: CartItem = {
  name: 'Bayi Lahap Juara',
  price: 75000,
  promoPrice: 60000,
  type: 'PRIMARY',
  category: 'BABY',
};

describe('Pediatric Taxonomy Adaptation (Fondasi 3)', () => {
  it('usia ≥24 bulan → BABY item diadaptasi ke KIDS', () => {
    const result = CartManager.adaptCartToAudienceAge(
      [{ ...BABY_CART_ITEM }],
      30,
      MOCK_CATALOG as any
    );
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('KIDS');
    expect(result[0].name).toBe('Kids Lahap Juara');
  });

  it('usia <24 bulan → BABY tetap BABY (tidak adaptasi)', () => {
    const result = CartManager.adaptCartToAudienceAge(
      [{ ...BABY_CART_ITEM }],
      17,
      MOCK_CATALOG as any
    );
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('BABY');
    expect(result[0].name).toBe('Bayi Lahap Juara');
  });

  it('usia null/undefined → tidak adaptasi', () => {
    const result = CartManager.adaptCartToAudienceAge(
      [{ ...BABY_CART_ITEM }],
      null,
      MOCK_CATALOG as any
    );
    expect(result[0].category).toBe('BABY');

    const result2 = CartManager.adaptCartToAudienceAge(
      [{ ...BABY_CART_ITEM }],
      undefined,
      MOCK_CATALOG as any
    );
    expect(result2[0].category).toBe('BABY');
  });

  it('item KIDS/MOMS tidak disentuh', () => {
    const kidsItem: CartItem = { ...BABY_CART_ITEM, name: 'Kids Lahap Juara', category: 'KIDS' };
    const result = CartManager.adaptCartToAudienceAge([kidsItem], 30, MOCK_CATALOG as any);
    expect(result[0].name).toBe('Kids Lahap Juara');
    expect(result[0].category).toBe('KIDS');
  });

  it('cart kosong / undefined → return kosong', () => {
    expect(CartManager.adaptCartToAudienceAge([], 30, MOCK_CATALOG as any)).toEqual([]);
    expect(CartManager.adaptCartToAudienceAge(undefined, 30, MOCK_CATALOG as any)).toEqual([]);
  });

  it('adaptasi mempertahankan harga promo dari KIDS katalog', () => {
    const result = CartManager.adaptCartToAudienceAge(
      [{ ...BABY_CART_ITEM }],
      36,
      MOCK_CATALOG as any
    );
    // Kids Lahap Juara: promoPrice 70000, originalPrice 85000
    expect(result[0].promoPrice).toBe(70000);
    expect(result[0].price).toBe(85000);
  });

  it('usia tepat 24 bulan → adaptasi (boundary)', () => {
    const result = CartManager.adaptCartToAudienceAge(
      [{ ...BABY_CART_ITEM }],
      24,
      MOCK_CATALOG as any
    );
    expect(result[0].category).toBe('KIDS');
  });
});
