import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../src/v3/state/goal-tracker';

/**
 * Audit 983902 — false-positive "kakak" honorifik CS ("kakak sebutkan")
 * DILARANG menciptakan pasien anak fiktif Kakak; keranjang "pulih ceria"
 * untuk 1 anak DILARANG duplikasi Baby+Kids.
 */
describe('Multi-child honorific disambiguation (983902)', () => {
  const CATALOG = [
    { name: 'Pijat Bayi Pulih Ceria', promoPrice: 75000, originalPrice: 90000, category: 'BABY', isAddon: false, id: 'baby-pulih' },
    { name: 'Pijat Kids Pulih Ceria', promoPrice: 85000, originalPrice: 100000, category: 'KIDS', isAddon: false, id: 'kids-pulih' },
    { name: 'Sinar Moksa', promoPrice: 25000, originalPrice: 30000, category: 'ADDON', isAddon: true, id: 'moksa' },
  ];

  it('honorifik "yg kakak sebutkan" bukan pasien anak', () => {
    expect(GoalTracker.isKakakHonorific('kalau keluhan yg kakak sebutkan itu semua yg dirasain adek')).toBe(true);
    expect(GoalTracker.isKakakHonorific('kakak sebutkan keluhannya')).toBe(true);
    expect(GoalTracker.isKakakHonorific('makasih kakak infonya')).toBe(true);
  });

  it('real "kakaknya umur 3 tahun" bukan honorifik', () => {
    expect(GoalTracker.isKakakHonorific('kakaknya yang umur 3 tahun juga mau dipijat')).toBe(false);
  });

  it('kalimat honorifik hanya menghasilkan 1 anak (Adik), bukan 2', () => {
    const kids = GoalTracker.syncChildrenProfiles(
      { genderGreeting: 'Bunda' } as any,
      'kalau keluhan yg kakak sebutkan itu semua yg dirasain adek jd sy ambil yg pulih ceria'
    );
    expect(kids).toHaveLength(1);
    expect(kids[0].roleLabel).toBe('Adik');
  });

  it('kakak eksplisit tetap membuat 2 anak', () => {
    let kids = GoalTracker.syncChildrenProfiles({ genderGreeting: 'Bunda' } as any, 'bayi saya umur 2 bulan');
    kids = GoalTracker.syncChildrenProfiles({ genderGreeting: 'Bunda', children: kids } as any, 'kakaknya yang umur 3 tahun juga mau dipijat');
    expect(kids).toHaveLength(2);
  });

  it('keranjang "pulih ceria" untuk 1 bayi hanya berisi Baby Pulih (bukan Kids)', () => {
    const cart = GoalTracker.syncCartItems(
      { genderGreeting: 'Bunda' } as any,
      [{ role: 'user', content: 'kalau keluhan yg kakak sebutkan itu semua yg dirasain adek jd sy ambil yg pulih ceria' }],
      CATALOG as any
    );
    const names = cart.map((c) => c.name);
    expect(names).toContain('Pijat Bayi Pulih Ceria');
    expect(names).not.toContain('Pijat Kids Pulih Ceria');
  });

  it('total tidak memasukkan tarif Kakak fiktif (hanya Baby 75k, bukan 75+85)', () => {
    const cart = GoalTracker.syncCartItems(
      { genderGreeting: 'Bunda' } as any,
      [{ role: 'user', content: 'kalau keluhan yg kakak sebutkan itu semua yg dirasain adek jd sy ambil yg pulih ceria fokus keluhan atau pulih ceria sinar moksa?' }],
      CATALOG as any
    );
    // boleh ada Sinar Moksa tambahan, tapi DILARANG ada Kids Pulih
    expect(cart.map((c) => c.name)).not.toContain('Pijat Kids Pulih Ceria');
    const total = GoalTracker.calcCartTotal({ genderGreeting: 'Bunda', cartItems: cart } as any);
    // Baby 75k + Moksa 25k = 100k bila ada; tanpa moksa = 75k — keduanya < 160k (75+85)
    expect(total).toBeLessThan(160000);
  });

  it('detectRecipientScope honorifik tetap CHILD_1 untuk BABY', () => {
    expect(GoalTracker.detectRecipientScope('yg kakak sebutkan tadi', { category: 'BABY' } as any)).toBe('CHILD_1');
    expect(GoalTracker.detectRecipientScope('kakaknya umur 3 tahun', { category: 'KIDS' } as any)).toBe('CHILD_2');
  });
});
