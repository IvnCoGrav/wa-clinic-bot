import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../src/v3/state/goal-tracker';

const CATALOG = [
  { name: 'Pijat Bayi Ceria', promoPrice: 60000, originalPrice: 80000, category: 'BABY', isAddon: false },
  { name: 'Pijat Bayi Pulih Ceria', promoPrice: 70000, originalPrice: 90000, category: 'BABY', isAddon: false },
  { name: 'Pijat Kids Ceria (Usia 2-4 th)', promoPrice: 70000, originalPrice: 90000, category: 'KIDS', isAddon: false },
  { name: 'Oksitosin Massage Fullbody', promoPrice: 105000, originalPrice: 130000, category: 'MOMS', isAddon: false },
  { name: 'Sinar Moksa', promoPrice: 10000, originalPrice: 15000, category: 'ADD_ON', isAddon: true },
  { name: 'Cukur Rambut Bayi', promoPrice: 25000, originalPrice: 30000, category: 'BABY', isAddon: false },
];

const baseSession: any = { genderGreeting: 'Bunda' };
const msg = (content: string, role = 'user') => ({ role, content });

describe('V3 multi-recipient cart (multi-anak & Mom+Baby)', () => {
  it('Uji 1: PRIMARY satu anak saling menggantikan (Ceria → Pulih Ceria = Rp 70.000)', () => {
    const cart = GoalTracker.syncCartItems(baseSession, [
      msg('Mau Pijat Bayi Ceria untuk si kecil'),
      msg('Si kecil pilek, ganti ke Pijat Bayi Pulih Ceria ya'),
    ], CATALOG as any);
    expect(cart).toHaveLength(1);
    expect(cart[0].name).toBe('Pijat Bayi Pulih Ceria');
    expect(GoalTracker.calcCartTotal({ ...baseSession, cartItems: cart } as any)).toBe(70000);
  });

  it('Uji 2: dua anak terakumulasi terpisah (Adik Pulih + Kakak Kids = Rp 140.000)', () => {
    const cart = GoalTracker.syncCartItems(baseSession, [
      msg('Anak saya umur 2 bulan lagi pilek'),
      msg('Untuk Adik yang lagi pilek kami sarankan Pijat Bayi Pulih Ceria', 'assistant'),
      msg('Kakaknya yang umur 3 tahun juga mau Pijat Kids Ceria (Usia 2-4 th)'),
    ], CATALOG as any);
    expect(cart).toHaveLength(2);
    const adik = cart.find((c) => c.recipientScope === 'CHILD_1');
    const kakak = cart.find((c) => c.recipientScope === 'CHILD_2');
    expect(adik?.name).toBe('Pijat Bayi Pulih Ceria');
    expect(kakak?.name).toBe('Pijat Kids Ceria (Usia 2-4 th)');
    expect(GoalTracker.calcCartTotal({ ...baseSession, cartItems: cart } as any)).toBe(140000);
  });

  it('Uji 3: Mom + Baby terakumulasi (Oksitosin 105k + Pulih 70k = Rp 175.000)', () => {
    const cart = GoalTracker.syncCartItems(baseSession, [
      msg('Pijat Bayi Pulih Ceria untuk si kecil'),
      msg('Sekalian saya mau pijat oksitosin', 'user'),
    ], CATALOG as any);
    const moms = cart.find((c) => c.recipientScope === 'MOMS');
    expect(moms?.name).toBe('Oksitosin Massage Fullbody');
    expect(moms?.recipientLabel).toBe('Bunda');
    expect(GoalTracker.calcCartTotal({ ...baseSession, cartItems: cart } as any)).toBe(175000);
  });

  it('Uji 4: ekstraksi usia & keluhan otomatis (termasuk multi-anak)', () => {
    let kids = GoalTracker.syncChildrenProfiles(baseSession, 'Anak saya umur 2 bulan lagi pilek, treatment apa ya?');
    expect(kids[0].ageMonths).toBe(2);
    expect(kids[0].symptoms).toContain('pilek');
    kids = GoalTracker.syncChildrenProfiles({ ...baseSession, children: kids }, 'Kakaknya yang umur 3 tahun juga mau dipijat');
    expect(kids).toHaveLength(2);
    expect(kids[1].ageMonths).toBe(36);
    expect(kids[1].roleLabel).toBe('Kakak');
  });

  it('Uji 5: grounding memuat label penerima + status anti-ulang ongkir', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      ...baseSession,
      priceDiscussed: true,
      location: { rawText: '', kelurahan: 'Pelemwatu', kecamatan: 'Menganti', kota: 'Kabupaten Gresik', distanceKm: 28.5, ongkirPromo: 30000, ongkirNormal: 35000 },
      ongkirStatus: 'QUOTED',
      children: [
        { roleLabel: 'Adik', ageMonths: 2, symptoms: ['pilek'] },
        { roleLabel: 'Kakak', ageMonths: 36, symptoms: [] },
      ],
      childProfile: { ageMonths: 2, symptoms: ['pilek'] },
      cartItems: [
        { name: 'Pijat Bayi Pulih Ceria', price: 90000, promoPrice: 70000, type: 'PRIMARY', recipientLabel: 'Adik (2 bln)', recipientScope: 'CHILD_1' },
        { name: 'Oksitosin Massage Fullbody', price: 130000, promoPrice: 105000, type: 'PRIMARY', recipientLabel: 'Bunda', recipientScope: 'MOMS' },
      ],
    } as any);
    expect(text).toContain('[Untuk Adik (2 bln)]');
    expect(text).toContain('[Untuk Bunda]');
    expect(text).toContain('Adik: Usia 2 bulan, Keluhan: pilek');
    expect(text).toContain('DILARANG ULANG HITUNGAN KM/ONGKIR!');
    expect(text).toContain('Rp 175.000');
  });

  it('Filter durasi: "pijat bayi berapa menit" tidak masuk keranjang', () => {
    const cart = GoalTracker.syncCartItems(baseSession, [msg('pijat bayi berapa menit')], CATALOG as any);
    expect(cart).toHaveLength(0);
  });

  it('Anti-phantom: sapaan bot "Treatment moms & Baby" tidak memasukkan Newborn Treatment', () => {
    const catalogWithNewborn = [
      ...CATALOG,
      { name: 'Newborn Treatment', promoPrice: 500000, originalPrice: 500000, category: 'BABY', isAddon: false },
    ];
    const cart = GoalTracker.syncCartItems(baseSession, [
      msg('Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby langsung ke rumah', 'assistant'),
    ], catalogWithNewborn as any);
    expect(cart).toHaveLength(0);
  });

  it('Pesan durasi slang "brp menit" bukan sinyal beli & tidak masuk keranjang', () => {
    expect(GoalTracker.isDurationOnlyQuestion('Untuk pijat bayi biasanya brp menit kak')).toBe(true);
    const cart = GoalTracker.syncCartItems(baseSession, [msg('Untuk pijat bayi biasanya brp menit kak')], CATALOG as any);
    expect(cart).toHaveLength(0);
  });

  it('Treatment terpilih: keranjang hanya berisi item yang benar (Pijat Bayi Ceria Rp 60.000)', () => {
    const catalogWithNewborn = [
      ...CATALOG,
      { name: 'Newborn Treatment', promoPrice: 500000, originalPrice: 500000, category: 'BABY', isAddon: false },
    ];
    const cart = GoalTracker.syncCartItems(baseSession, [
      msg('Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby langsung ke rumah', 'assistant'),
      msg('Untuk pijat bayi biasanya brp menit kak'),
      msg('Mau Pijat Bayi Ceria untuk si kecil'),
    ], catalogWithNewborn as any);
    expect(cart).toHaveLength(1);
    expect(cart[0].name).toBe('Pijat Bayi Ceria');
    expect(GoalTracker.calcCartTotal({ ...baseSession, cartItems: cart } as any)).toBe(60000);
  });
});
