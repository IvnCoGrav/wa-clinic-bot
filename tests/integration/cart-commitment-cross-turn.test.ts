import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../src/v3/state/goal-tracker';
import { CartManager } from '../../src/v3/state/cart-manager';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';

/**
 * ST6 (RC-05) — kontrak komitmen lintas-turn.
 *
 * Mengunci perilaku gerbang `lastCommitment` di `syncCartItems`:
 * - verdict Call 1 EXPLORING (tersimpan) → penyebutan layanan pada turn
 *   berikutnya DILARANG mengisi cart (item ke discussedTreatments).
 * - verdict COMMITTED/absen + sinyal komitmen/hari → cart tetap terisi.
 *
 * Determinstik (tanpa LLM): meniru kondisi `session.lastCommitment` yang sudah
 * tersimpan dari turn sebelumnya. Pengujian pipeline LLM nyata dilakukan
 * terpisah lewat sandbox.
 */
describe('Cart commitment lintas-turn (ST6 / RC-05)', () => {
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
  const OKSITOSIN_NAME = all.find((s) => s.id === 'moms-laktasi-oksitosin-full')?.name
    ?? 'Breast + Oksitosin Fullbody Massage';

  it('verdict EXPLORING tersimpan → penyebutan layanan turn ini TIDAK masuk cart', () => {
    const session: any = { cartItems: [], children: [], lastCommitment: 'EXPLORING' };
    const history = [
      { role: 'user', content: `${OKSITOSIN_NAME} itu untuk ibu melahirkan ya` },
    ];
    const cart = GoalTracker.syncCartItems(session, history, catalog);
    expect(cart.length).toBe(0);
    expect(session.discussedTreatments || []).toContain(OKSITOSIN_NAME);
  });

  it('verdict EXPLORING + sinyal komitmen eksplisit ("ambil") → cart tetap terisi', () => {
    const session: any = { cartItems: [], children: [], lastCommitment: 'EXPLORING' };
    const history = [
      { role: 'user', content: `saya ambil ${OKSITOSIN_NAME} ya` },
    ];
    const cart = GoalTracker.syncCartItems(session, history, catalog);
    expect(cart.length).toBe(1);
    expect(cart[0].name).toBe(OKSITOSIN_NAME);
  });

  it('verdict COMMITTED → penyebutan layanan masuk cart', () => {
    const session: any = { cartItems: [], children: [], lastCommitment: 'COMMITTED' };
    const history = [
      { role: 'user', content: `${OKSITOSIN_NAME} untuk saya` },
    ];
    const cart = GoalTracker.syncCartItems(session, history, catalog);
    expect(cart.length).toBe(1);
    expect(cart[0].name).toBe(OKSITOSIN_NAME);
  });

  it('tanpa verdict (direct-reply) → perilaku lama (tanda tanya = konsultasi)', () => {
    const session: any = { cartItems: [], children: [] };
    const history = [
      { role: 'user', content: `Apakah ${OKSITOSIN_NAME} bisa untuk memperbanyak asi?` },
    ];
    const cart = GoalTracker.syncCartItems(session, history, catalog);
    expect(cart.length).toBe(0);
  });

  it('applyCommitmentVeto EXPLORING mengosongkan cart & memindah ke discussed', () => {
    const session: any = { cartItems: [{ name: OKSITOSIN_NAME, price: 100000, type: 'PRIMARY' }], children: [] };
    const vetoed = CartManager.applyCommitmentVeto(session, 'EXPLORING');
    expect(vetoed.cartItems?.length || 0).toBe(0);
    expect(vetoed.discussedTreatments || []).toContain(OKSITOSIN_NAME);
  });

  it('applyCommitmentVeto COMMITTED tidak mengubah cart', () => {
    const session: any = { cartItems: [{ name: OKSITOSIN_NAME, price: 100000, type: 'PRIMARY' }], children: [] };
    const vetoed = CartManager.applyCommitmentVeto(session, 'COMMITTED');
    expect(vetoed.cartItems?.length || 0).toBe(1);
  });

  it('EXPLORING: tawaran ASISTEN pun DILARANG mengisi cart (bocor turn berikutnya)', () => {
    // Reproduksi bug sandbox nyata: turn 1 konsultasi (verdict EXPLORING),
    // turn 2 user menyebut layanan + asisten menawarkannya → TIDAK boleh cart.
    const session: any = { cartItems: [], children: [], lastCommitment: 'EXPLORING' };
    const history = [
      { role: 'user', content: 'kak bapil pakai treatment apa' },
      { role: 'assistant', content: 'Untuk keluhan bapil, kami sarankan *Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)* ya Bunda' },
      { role: 'user', content: 'pijat pulih ceria itu aman ya' },
    ];
    const cart = GoalTracker.syncCartItems(session, history, catalog);
    expect(cart.length).toBe(0);
  });

  it('EXPLORING lalu user komit eksplisit → cart terisi (tidak over-block)', () => {
    const session: any = { cartItems: [], children: [], lastCommitment: 'EXPLORING' };
    const history = [
      { role: 'user', content: 'kak bapil pakai treatment apa' },
      { role: 'assistant', content: `Kami sarankan ${OKSITOSIN_NAME} ya Bunda` },
      { role: 'user', content: `saya ambil ${OKSITOSIN_NAME} ya` },
    ];
    const cart = GoalTracker.syncCartItems(session, history, catalog);
    expect(cart.length).toBe(1);
  });
});
