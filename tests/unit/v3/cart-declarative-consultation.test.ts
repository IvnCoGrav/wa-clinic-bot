import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../../src/v3/state/goal-tracker';
import { CartManager } from '../../../src/v3/state/cart-manager';
import { treatmentCatalogService } from '../../../src/services/treatment-catalog.service';

/**
 * Audit V3 A-BUG-P1-10 — konsultasi deklaratif (tanpa tanda '?') yang menyebut
 * nama layanan DILARANG masuk cartItems.
 *
 * Test ini bersifat REPRODUKSI (TDD): menguji perilaku AKTUAL `syncCartItems`
 * terhadap kalimat nyata customer (contoh dari user) yang BUKAN komitmen beli.
 * Tidak mengubah kode produksi.
 *
 * Kontrak yang ingin dijaga (sesuai user):
 *  - "kak bapil pakai treatment apa"          → konsultasi (cart kosong)
 *  - "pijat pulih ceria buat adek ... bisa nggak" → konsultasi (cart kosong)
 *  - "boleh bund" atas tawaran tunggal        → KOMITMEN (cart terisi)
 *  - "boleh deh bunda, pijat ceria buat adek" → KOMITMEN (cart terisi)
 */
describe('Cart declarative-consultation gate (A-BUG-P1-10)', () => {
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
  const PULIH_NAME = 'Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)';
  const CERIA_NAME = 'Pijat Bayi Ceria (Rileksasi)';

  // --- Kasus yang HARUS tetap konsultasi (cart kosong setelah veto EXPLORING) ---
  it('cerita keluhan + sebut layanan (EXPLORING) → cart kosong setelah veto', () => {
    const session: any = { cartItems: [], children: [] };
    const history = [
      { role: 'user', content: `${PULIH_NAME} buat adek umur 3 bulan bisa nggak` },
    ];
    const rawCart = GoalTracker.syncCartItems(session, history, catalog);
    const vetoed = CartManager.applyCommitmentVeto(
      { ...session, cartItems: rawCart },
      'EXPLORING'
    );
    expect(vetoed.cartItems?.length || 0).toBe(0);
    expect(vetoed.discussedTreatments || []).toContain(PULIH_NAME);
  });

  it('deklarasi keunggulan layanan (EXPLORING) → cart kosong setelah veto', () => {
    const session: any = { cartItems: [], children: [] };
    const history = [
      { role: 'user', content: 'pijat oksitosin itu untuk ibu melahirkan ya' },
    ];
    const rawCart = GoalTracker.syncCartItems(session, history, catalog);
    const vetoed = CartManager.applyCommitmentVeto(
      { ...session, cartItems: rawCart },
      'EXPLORING'
    );
    expect(vetoed.cartItems?.length || 0).toBe(0);
  });

  // --- Kasus yang HARUS tetap masuk cart (anti-regresi) ---
  it('afirmasi "boleh" atas tawaran tunggal → KOMITMEN (cart terisi)', () => {
    const session: any = { cartItems: [], children: [] };
    const history = [
      { role: 'assistant', content: `Kami sarankan ${CERIA_NAME} ya Bunda` },
      { role: 'user', content: 'boleh bund' },
    ];
    const cart = GoalTracker.syncCartItems(session, history, catalog);
    expect(cart.length).toBe(1);
    expect(cart[0].name).toContain('Pijat Bayi Ceria');
  });

  it('afirmasi + nama layanan + penerima ("boleh deh bunda, pijat ceria buat adek") → KOMITMEN', () => {
    const session: any = { cartItems: [], children: [] };
    const history = [
      { role: 'assistant', content: `Kami sarankan ${CERIA_NAME} ya Bunda` },
      { role: 'user', content: 'boleh deh bunda, pijat ceria buat adek' },
    ];
    const cart = GoalTracker.syncCartItems(session, history, catalog);
    expect(cart.length).toBe(1);
    expect(cart[0].name).toContain('Pijat Bayi Ceria');
  });
});
