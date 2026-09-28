import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../../src/v3/state/goal-tracker';

/**
 * FASE 0.2 — REPRODUKSI (TDD): sapaan pembuka bot yang memuat TEPAT SATU nama
 * layanan katalog, lalu customer hanya membalas salam pendek ("Iya mbak" /
 * "Oke"), DILARANG mengunci layanan ke keranjang.
 *
 * Akar yang diuji: `lastUserBareAffirm` (cart-manager.ts:358-370) menganggap
 * balasan pendek sebagai afirmasi + `singleExactOffer` (cart-manager.ts:508-509)
 * menganggap pesan asisten sebagai satu tawaran aktif → pushService (baris 540-544).
 *
 * Catatan: test ini MURNI REPRODUKSI. Bila perilaku aktual = cart terisi,
 * bug VALID dan perbaikan (Fase 2) harus mengecualikan pesan pembuka/sapaan
 * dari `singleExactOffer` — TANPA daftar frasa hafalan.
 */
const CATALOG = [
  { name: 'Pijat Bayi Ceria', promoPrice: 60000, originalPrice: 80000, category: 'BABY', isAddon: false },
];

const msg = (content: string, role: 'user' | 'assistant' = 'user') => ({ role, content });

describe('FASE 0.2 — Sapaan bot mengunci keranjang (reproduksi)', () => {
  it('sapaan pembuka (1 layanan) + "Iya mbak" -> keranjang WAJIB kosong', () => {
    const history = [
      msg(
        'Halo Bunda! ✨ Perkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa. ' +
          'Kami melayani Pijat Bayi Ceria untuk si kecil di rumah ya Bunda.',
        'assistant'
      ),
      msg('Iya mbak'),
    ];
    const cart = GoalTracker.syncCartItems({ cartItems: [] } as any, history, CATALOG as any);
    expect(cart).toHaveLength(0);
  });

  it('sapaan pembuka (1 layanan) + "Oke" -> keranjang WAJIB kosong', () => {
    const history = [
      msg(
        'Selamat datang di Kala Moms and Baby Spa! Layanan unggulan kami Pijat Bayi Ceria.',
        'assistant'
      ),
      msg('Oke'),
    ];
    const cart = GoalTracker.syncCartItems({ cartItems: [] } as any, history, CATALOG as any);
    expect(cart).toHaveLength(0);
  });

  it('kontrol positif: tawaran setelah konsultasi + afirmasi tetap mengunci', () => {
    const history = [
      msg('anak saya rewel dan susah tidur, treatment apa ya?'),
      msg('Bisa dibantu dengan Pijat Bayi Ceria ya Bunda', 'assistant'),
      msg('Iya boleh'),
    ];
    const cart = GoalTracker.syncCartItems({ cartItems: [] } as any, history, CATALOG as any);
    expect(cart).toHaveLength(1);
    expect(cart[0].name).toBe('Pijat Bayi Ceria');
  });
});
