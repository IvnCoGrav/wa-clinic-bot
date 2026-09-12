import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../../src/v3/state/goal-tracker';
import { treatmentCatalogService } from '../../../src/services/treatment-catalog.service';
import {
  executeCalculateDelivery,
  buildCartTotalRecap,
} from '../../../src/v3/tools/calculate-delivery.tool';

/**
 * Phase 2 (audit 315036) — adversarial cart: bundle menyerap parsial &
 * se-famili (data-driven via bundleItemIds), total agregat di output ongkir.
 */
const catalog = () =>
  treatmentCatalogService.getAllServices(true).map((s) => ({
    id: (s as any).id,
    name: s.name,
    promoPrice: s.promoPrice,
    originalPrice: s.originalPrice,
    category: s.category,
    bundleItemIds: (s as any).bundleItemIds || [],
    isAddon: (treatmentCatalogService as any).isAddonService(s),
  }));

describe('Cart Bundle Dedup (audit 315036)', () => {
  it('bundle laktasi+oksitosin menyerap breast-massage parsial (MOMS)', () => {
    const history = [
      { role: 'user', content: 'saya mau paket laktasi breast massage buat saya bunda' },
      { role: 'user', content: 'jadi ambil paket laktasi breast + oksitosin buat saya' },
    ];
    const cart = GoalTracker.syncCartItems({ cartItems: [] } as any, history, catalog());
    const names = cart.map((c) => c.name);
    expect(names.some((n) => n.includes('Breast + Oksitosin'))).toBe(true);
    expect(names.some((n) => n === 'Paket Laktasi (Breast Massage)')).toBe(false);
  });

  it('inflasi warisan DB ikut bersih saat seed (bundle + parsial tersimpan)', () => {
    const cart = GoalTracker.syncCartItems(
      {
        cartItems: [
          { name: 'Pijat Laktasi / Breast Care Massage', price: 110000, promoPrice: 85000, type: 'PRIMARY', category: 'MOMS', recipientScope: 'MOMS' },
          { name: 'Breast + Oksitosin Fullbody Massage', price: 250000, promoPrice: 155000, type: 'SERVICE', category: 'BUNDLE', recipientScope: 'GENERAL' },
        ],
      } as any,
      [],
      catalog()
    );
    expect(cart.length).toBe(1);
    expect(cart[0].name).toContain('Breast + Oksitosin');
  });

  it('cukur+terapi bundle menyerap ceria se-famili (jalur anak), moksa tetap ikut', () => {
    const history = [
      { role: 'user', content: 'pijat bayi ceria untuk si kecil' },
      { role: 'user', content: 'tambah sinar moksa juga' },
      { role: 'user', content: 'jadi ambil cukur + pijat terapi saja untuk si kecil' },
    ];
    const cart = GoalTracker.syncCartItems({ cartItems: [] } as any, history, catalog());
    const names = cart.map((c) => c.name);
    expect(names.some((n) => n.includes('Cukur + Pijat Terapi'))).toBe(true);
    expect(names.some((n) => n === 'Pijat Bayi Ceria (Rileksasi)')).toBe(false);
    // Add-on moksa tidak terserap (akumulatif)
    expect(names.some((n) => n.toLowerCase().includes('moksa'))).toBe(true);
  });

  it('jalur ibu terpisah: bundle bayi TIDAK menyerap oksitosin MOMS', () => {
    const history = [
      { role: 'user', content: 'oksitosin massage buat saya bunda sendiri' },
      { role: 'user', content: 'cukur + pijat terapi untuk si kecil' },
    ];
    const cart = GoalTracker.syncCartItems({ cartItems: [] } as any, history, catalog());
    const names = cart.map((c) => c.name);
    expect(names.some((n) => n.toLowerCase().includes('oksitosin'))).toBe(true);
    expect(names.some((n) => n.includes('Cukur + Pijat Terapi'))).toBe(true);
  });
});

describe('Cart Total Recap (mandat total otomatis)', () => {
  it('buildCartTotalRecap: subtotal + ongkir = grand total', () => {
    const r = buildCartTotalRecap(
      [
        { name: 'Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)', price: 90000, promoPrice: 70000 },
        { name: 'Cukur Rambut Bayi', price: 30000, promoPrice: 25000 },
      ],
      15000
    );
    expect(r).not.toBeNull();
    expect(r!.subtotal).toBe(95000);
    expect(r!.grandTotal).toBe(110000);
    expect(r!.block).toContain('Total keseluruhan');
    expect(r!.block).toContain('110.000');
  });

  it('keranjang kosong -> null (tanpa rekap)', () => {
    expect(buildCartTotalRecap([], 15000)).toBeNull();
    expect(buildCartTotalRecap(undefined, 15000)).toBeNull();
  });

  it('delivery tool + cartSnapshot -> message & template memuat grand total', async () => {
    const out = await executeCalculateDelivery({
      locationText: 'https://www.google.com/maps/@-7.340000,112.720000,17z',
      priceDiscussed: true,
      cartSnapshot: [
        { name: 'Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)', price: 90000, promoPrice: 70000 },
      ],
    });
    expect(out.success).toBe(true);
    expect(out.message).toContain('Total keseluruhan');
    expect(out.suggestedTemplateReply).toContain('Total keseluruhan');
  });
});
