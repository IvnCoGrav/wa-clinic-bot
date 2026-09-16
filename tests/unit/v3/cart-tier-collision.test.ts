import { describe, it, expect } from 'vitest';
import { CartManager } from '../../../src/v3/state/cart-manager';

/**
 * Sesi 887216 (keranjang tertukar ke paket 6-8 tahun): saat nama bersih kembar
 * (multi-tier usia seperti "Pijat Kids Pulih Ceria (2 - 4 Th)", "(4 - 6 Th)",
 * "(6 - 8 Th)"), collision DILARANG menimpa liar ke tier tertinggi. Pilih tier
 * yang cocok dengan usia anak dari DATABASE (ageTier.min/maxAgeMonths); default
 * tier terendah bila usia tak diketahui.
 */
const CATALOG = [
  { name: 'Pijat Kids Pulih Ceria (2 - 4 Tahun)', promoPrice: 85000, category: 'KIDS', ageTier: { minAgeMonths: 24, maxAgeMonths: 48, label: '2 - 4 Tahun' } },
  { name: 'Pijat Kids Pulih Ceria (4 - 6 Tahun)', promoPrice: 85000, category: 'KIDS', ageTier: { minAgeMonths: 48, maxAgeMonths: 72, label: '4 - 6 Tahun' } },
  { name: 'Pijat Kids Pulih Ceria (6 - 8 Tahun)', promoPrice: 85000, category: 'KIDS', ageTier: { minAgeMonths: 72, maxAgeMonths: 96, label: '6 - 8 Tahun' } },
];

describe('Cart Multi-Tier Age Collision (sesi 887216)', () => {
  it('anak 26 bulan → tier (2 - 4 Tahun), BUKAN (6 - 8 Tahun)', () => {
    const cart = CartManager.syncCartItems(
      { genderGreeting: 'Bunda', targetAudience: 'KIDS', children: [{ ageMonths: 26, symptoms: [] }] } as any,
      [{ role: 'user', content: 'pijat kids pulih ceria' }],
      CATALOG
    );
    expect(cart.some((c) => c.name === 'Pijat Kids Pulih Ceria (2 - 4 Tahun)')).toBe(true);
    expect(cart.some((c) => c.name === 'Pijat Kids Pulih Ceria (6 - 8 Tahun)')).toBe(false);
  });

  it('anak 80 bulan → tier (6 - 8 Tahun)', () => {
    const cart = CartManager.syncCartItems(
      { genderGreeting: 'Bunda', targetAudience: 'KIDS', children: [{ ageMonths: 80, symptoms: [] }] } as any,
      [{ role: 'user', content: 'pijat kids pulih ceria' }],
      CATALOG
    );
    expect(cart.some((c) => c.name === 'Pijat Kids Pulih Ceria (6 - 8 Tahun)')).toBe(true);
  });

  it('usia tak diketahui → default tier terendah (2 - 4 Tahun)', () => {
    const cart = CartManager.syncCartItems(
      { genderGreeting: 'Bunda', targetAudience: 'KIDS' } as any,
      [{ role: 'user', content: 'pijat kids pulih ceria' }],
      CATALOG
    );
    expect(cart.some((c) => c.name === 'Pijat Kids Pulih Ceria (2 - 4 Tahun)')).toBe(true);
  });
});
