import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../../src/v3/state/goal-tracker';
import { treatmentCatalogService } from '../../../src/services/treatment-catalog.service';

/**
 * Plan regresi Fase 3 — pemisahan state konsultasi vs transaksi.
 * Pertanyaan konsultatif user (bertanda '?' tanpa verba komitmen/bukti hari)
 * yang merujuk layanan WAJIB dicatat ke session.discussedTreatments dan
 * DILARANG masuk session.cartItems (anti tagihan siluman).
 * Gerbang berbasis tanda baca + state komitmen — tanpa daftar kata khasiat.
 */
describe('Cart consultation gate (Fase 3)', () => {
  const all = treatmentCatalogService.getAllServices(true);
  const catalog = all.map((s) => ({
    id: s.id,
    name: s.name,
    promoPrice: s.promoPrice,
    originalPrice: s.originalPrice,
    category: s.category,
    bundleItemIds: (s as any).bundleItemIds,
    isAddon: (treatmentCatalogService as any).isAddonService(s),
  }));
  // Nama REAL dari katalog (anti-rapuh ejaan): bundle paket ibu.
  const OKSITOSIN_NAME = all.find((s) => s.id === 'moms-laktasi-oksitosin-full')?.name
    ?? 'Breast + Oksitosin Fullbody Massage';
  const PULIH_NAME = 'Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)';

  it('tanya khasiat oksitosin → cart kosong, tercatat di discussedTreatments', () => {
    const session: any = { cartItems: [], children: [] };
    const history = [
      { role: 'user', content: `Apakah ${OKSITOSIN_NAME} bisa untuk memperbanyak asi?` },
    ];
    const cart = GoalTracker.syncCartItems(session, history, catalog);
    expect(cart.length).toBe(0);
    expect(session.discussedTreatments || []).toContain(OKSITOSIN_NAME);
  });

  it('tanya harga ("berapa?") → cart kosong (mode konsultasi, anti total siluman)', () => {
    const session: any = { cartItems: [], children: [] };
    const history = [
      { role: 'user', content: `${PULIH_NAME} harganya berapa ya?` },
    ];
    const cart = GoalTracker.syncCartItems(session, history, catalog);
    expect(cart.length).toBe(0);
    expect(session.discussedTreatments || []).toContain(PULIH_NAME);
  });

  it('komitmen + hari ("ambil ... hari sabtu") → tetap masuk cart', () => {
    const session: any = { cartItems: [], children: [] };
    const history = [
      { role: 'user', content: `Saya ambil ${OKSITOSIN_NAME} untuk hari sabtu ya` },
    ];
    const cart = GoalTracker.syncCartItems(session, history, catalog);
    expect(cart.length).toBe(1);
    expect(cart[0].name).toBe(OKSITOSIN_NAME);
    // Item yang dibeli pasti tercatat pernah dibahas
    expect(session.discussedTreatments || []).toContain(OKSITOSIN_NAME);
  });

  it('tawaran sepihak asisten → tidak masuk cart, tercatat konsultasi', () => {
    const session: any = { cartItems: [], children: [] };
    const history = [
      { role: 'assistant', content: `Kami tawarkan ${OKSITOSIN_NAME} ya Bunda` },
    ];
    const cart = GoalTracker.syncCartItems(session, history, catalog);
    expect(cart.length).toBe(0);
    expect(session.discussedTreatments || []).toContain(OKSITOSIN_NAME);
  });

  it('afirmasi "boleh" atas tawaran tunggal → komitmen aktif, masuk cart', () => {
    const session: any = { cartItems: [], children: [] };
    const history = [
      { role: 'assistant', content: 'Kami tawarkan Pijat Bayi Ceria (Rileksasi) ya Bunda' },
      { role: 'user', content: 'boleh' },
    ];
    const cart = GoalTracker.syncCartItems(session, history, catalog);
    expect(cart.length).toBe(1);
    expect(cart[0].name).toContain('Pijat Bayi Ceria');
  });
});
