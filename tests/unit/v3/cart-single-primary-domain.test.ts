import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../../src/v3/state/goal-tracker';
import { treatmentCatalogService } from '../../../src/services/treatment-catalog.service';

describe('Cart Single Primary Domain (no regex)', () => {
  const catalog = treatmentCatalogService.getAllServices(true).map(s => ({
    name: s.name,
    promoPrice: s.promoPrice,
    originalPrice: s.originalPrice,
    category: s.category,
    isAddon: (treatmentCatalogService as any).isAddonService(s),
  }));

  it('saya pulih ceria saja -> hanya 1 PRIMARY (Pulih) menggantikan Lahap', () => {
    const history = [
      { role: 'assistant', content: 'Untuk si kecil kami tawarkan Pijat Lahap Juara (Nafsu Makan) ya Bunda' },
      { role: 'assistant', content: 'Untuk si kecil juga ada Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung) ya Bunda' },
      { role: 'user', content: 'saya mau pulih ceria saja untuk si kecil bunda' },
    ];
    const session: any = { cartItems: [], children: [], childProfile: { symptoms: [] } };
    const cart = GoalTracker.syncCartItems(session, history, catalog);
    // Hanya Pulih Ceria yang tersisa
    expect(cart.length).toBe(1);
    expect(cart[0].name).toContain('Pulih Ceria');
    expect(cart[0].type).toBe('PRIMARY');
    const subtotal = cart.reduce((s, it) => s + (it.promoPrice || it.price), 0);
    expect(subtotal).toBe(75000);
  });

  it('Pulih Ceria + Sinar Moksa -> keduanya masuk (PRIMARY + ADDON)', () => {
    const history = [{ role: 'user', content: 'mau pulih ceria plus sinar moksa untuk si kecil' }];
    const cart = GoalTracker.syncCartItems({ cartItems: [], children: [] } as any, history, catalog);
    // Pulih Ceria (PRIMARY) + Sinar Moksa (ADDON)
    const names = cart.map(c => c.name);
    expect(names.some(n => n.includes('Pulih Ceria'))).toBe(true);
    expect(names.some(n => n.includes('Sinar Moksa'))).toBe(true);
    expect(cart.length).toBe(2);
    const hasAddon = cart.some(c => c.type === 'ADDON');
    expect(hasAddon).toBe(true);
  });

  it('2 anak: Adik Pulih Ceria, Kakak Lahap Juara -> keduanya masuk dengan label', () => {
    const history = [
      { role: 'user', content: 'adik mau pulih ceria' },
      { role: 'user', content: 'kakak mau lahap juara' },
    ];
    const session: any = { cartItems: [], children: [{ roleLabel: 'Adik', symptoms: [] }, { roleLabel: 'Kakak', symptoms: [] }] };
    const cart = GoalTracker.syncCartItems(session, history, catalog);
    // Dua PRIMARY beda scope
    expect(cart.length).toBe(2);
    const scopes = cart.map(c => c.recipientScope);
    expect(scopes).toContain('CHILD_1');
    expect(scopes).toContain('CHILD_2');
  });

  it('geocoding bratang gede 3H -> Ngagelrejo Wonokromo', async () => {
    const { executeCalculateDelivery } = await import('../../../src/v3/tools/calculate-delivery.tool');
    const res: any = await executeCalculateDelivery({ locationText: 'bratang gede 3H' });
    expect(res.success).toBe(true);
    expect(res.kelurahan).toBe('Ngagelrejo');
    expect(res.kecamatan).toBe('Wonokromo');
    expect([10000, 15000, 20000]).toContain(res.ongkirPromo);
    expect(res.distanceKm).toBeGreaterThan(0);
    expect(res.distanceKm).toBeLessThan(20);
  });
});
