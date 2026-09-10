import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../../src/v3/state/goal-tracker';
import { treatmentCatalogService } from '../../../src/services/treatment-catalog.service';

/**
 * Phase 2+6 (audit 854065 Turn 5-6) — afirmasi "iya bu saya ambil" atas
 * tawaran tukar asisten men-swap keranjang (Lahap 75k -> Pulih 70k).
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

const LAHAP = 'Pijat Lahap Juara (Nafsu Makan)';
const PULIH = 'Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)';

describe('Affirmative Treatment Swap (audit 854065)', () => {
  it('tawaran tukar + "iya bu saya ambil" -> Lahap terswap Pulih (70k)', () => {
    const history = [
      { role: 'user', content: 'boleh kak pijat lahap juara' },
      { role: 'assistant', content: `Karena Bunda sudah memilih Pijat Lahap Juara, kami bisa menggantinya dengan ${PULIH} yang lebih cocok untuk pilek. Apakah Bunda ingin melanjutkan?` },
      { role: 'user', content: 'iya bu saya ambil treatment nya' },
    ];
    const cart = GoalTracker.syncCartItems(
      { cartItems: [{ name: LAHAP, price: 95000, promoPrice: 75000, type: 'PRIMARY', recipientScope: 'CHILD_1' }] } as any,
      history,
      catalog()
    );
    const names = cart.map((c) => c.name);
    expect(names).toContain(PULIH);
    expect(names).not.toContain(LAHAP);
    const pulih = cart.find((c) => c.name === PULIH)!;
    expect(pulih.promoPrice).toBe(70000);
    expect(pulih.recipientScope).toBe('CHILD_1');
  });

  it('resolver murni: tawaran parafrasa "Pulih Ceria" tetap terpetakan', () => {
    const swap = GoalTracker.resolveAffirmativeSwap(
      { cartItems: [{ name: LAHAP, price: 95000, promoPrice: 75000, type: 'PRIMARY', recipientScope: 'CHILD_1' }] } as any,
      [
        { role: 'assistant', content: 'Bagaimana kalau diganti Pulih Ceria saja, apakah Bunda setuju?' },
        { role: 'user', content: 'iya boleh' },
      ],
      catalog()
    );
    expect(swap).not.toBeNull();
    expect(swap!.oldName).toBe(LAHAP);
    expect(swap!.newName).toBe(PULIH);
  });

  it('negasi / pertanyaan / penundaan DILARANG memicu swap', () => {
    const mkHist = (userText: string) => [
      { role: 'assistant', content: `Kami bisa menggantinya dengan ${PULIH}. Apakah Bunda ingin melanjutkan?` },
      { role: 'user', content: userText },
    ];
    const sess = { cartItems: [{ name: LAHAP, price: 95000, promoPrice: 75000, type: 'PRIMARY', recipientScope: 'CHILD_1' }] } as any;
    expect(GoalTracker.resolveAffirmativeSwap(sess, mkHist('tidak, lahap aja'), catalog())).toBeNull();
    expect(GoalTracker.resolveAffirmativeSwap(sess, mkHist('iya atau pulih berapa?'), catalog())).toBeNull();
    expect(GoalTracker.resolveAffirmativeSwap(sess, mkHist('iya nanti saya kabari'), catalog())).toBeNull();
  });

  it('afirmasi tanpa tawaran (B sudah di cart) -> null (tanpa swap ganda)', () => {
    const swap = GoalTracker.resolveAffirmativeSwap(
      { cartItems: [{ name: PULIH, price: 90000, promoPrice: 70000, type: 'PRIMARY', recipientScope: 'CHILD_1' }] } as any,
      [
        { role: 'assistant', content: `Baik, ${PULIH} ya Bunda. Rencana hari apa?` },
        { role: 'user', content: 'iya' },
      ],
      catalog()
    );
    expect(swap).toBeNull();
  });
});
