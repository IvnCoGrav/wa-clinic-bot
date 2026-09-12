import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../../src/v3/state/goal-tracker';
import { treatmentCatalogService } from '../../../src/services/treatment-catalog.service';

/**
 * Sesi 188034 — add-on pendamping (Sinar Moksa/Nebulizer, isAddon) DILARANG
 * menjadi pesanan mandiri: tanpa paket pijat utama, keranjang wajib kosong
 * (SOP klinis: tidak ada homecare hanya untuk moksa).
 * Harga/nominal TIDAK di-hardcode — ekspektasi dihitung dari katalog aktif.
 */
describe('Cart Orphan Add-on Protection (sesi 188034)', () => {
  const catalog = treatmentCatalogService.getAllServices(true).map((s) => ({
    id: (s as any).id,
    name: s.name,
    promoPrice: s.promoPrice,
    originalPrice: s.originalPrice,
    category: s.category,
    isAddon: (treatmentCatalogService as any).isAddonService(s),
  }));
  const promoOf = (id: string): number => {
    const s = treatmentCatalogService.getAllServices(true).find((x) => (x as any).id === id);
    if (!s) throw new Error(`katalog test tidak memuat ${id}`);
    return s.promoPrice;
  };
  const PULIH = 'baby-massage-pulih-ceria';
  const MOKSA = 'add-on-sinar-moksa';

  it('tanya moksa mandiri ("pijat dengan sinar moksa apa bisa homecare ya?") -> keranjang KOSONG', () => {
    const cart = GoalTracker.syncCartItems(
      { cartItems: [] } as any,
      [{ role: 'user', content: 'pijat dengan sinar moksa apa bisa homecare ya?' }],
      catalog
    );
    expect(cart).toEqual([]);
  });

  it('konsultasi moksa (T1) + pilih ceria (T3) -> HANYA Ceria, tanpa phantom moksa', () => {
    const cart = GoalTracker.syncCartItems(
      { cartItems: [] } as any,
      [
        { role: 'user', content: 'apa itu sinar moksa?' },
        { role: 'user', content: 'saya mau ambil pijat bayi ceria' },
      ],
      catalog
    );
    expect(cart.length).toBe(1);
    expect(cart[0].name.toLowerCase()).toContain('ceria');
    expect(cart.every((c) => c.type !== 'ADDON')).toBe(true);
  });

  it('"pulih ceria + sinar moksa" se-turn -> KEDUANYA (PRIMARY + ADDON), total = promo katalog', () => {
    const cart = GoalTracker.syncCartItems(
      { cartItems: [] } as any,
      [{ role: 'user', content: 'Pijat bayi pulih ceria + sinar moksa' }],
      catalog
    );
    expect(cart.some((c) => c.type === 'PRIMARY' && c.name.toLowerCase().includes('pulih ceria'))).toBe(true);
    expect(cart.some((c) => c.type === 'ADDON' && c.name.toLowerCase().includes('moksa'))).toBe(true);
    const total = cart.reduce((s, it) => s + (it.promoPrice ?? it.price), 0);
    expect(total).toBe(promoOf(PULIH) + promoOf(MOKSA));
  });

  it('utama (T1) + "tambah moksa" (T2) -> akumulasi KEDUANYA via keranjang berjalan', () => {
    const cart = GoalTracker.syncCartItems(
      { cartItems: [] } as any,
      [
        { role: 'user', content: 'mau pulih ceria' },
        { role: 'user', content: 'tambah sinar moksa sekalian' },
      ],
      catalog
    );
    expect(cart.some((c) => c.type !== 'ADDON')).toBe(true);
    expect(cart.some((c) => c.type === 'ADDON' && c.name.toLowerCase().includes('moksa'))).toBe(true);
  });

  it('ngotot moksa mandiri ("mau sinar moksa aja bisa?") -> tetap KOSONG (SOP patuh)', () => {
    const cart = GoalTracker.syncCartItems(
      { cartItems: [] } as any,
      [{ role: 'user', content: 'mau sinar moksa aja bisa?' }],
      catalog
    );
    expect(cart).toEqual([]);
  });

});
