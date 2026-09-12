import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../../src/v3/state/goal-tracker';
import { treatmentCatalogService } from '../../../src/services/treatment-catalog.service';

/**
 * Sesi 834128 — jawaban ambigu ("boleh deh yang itu") atas menu multi-opsi
 * DILARANG dikunci sepihak ke item pertama (Memandikan Bayi).
 * Akar: pesan asisten sendiri ikut di-exact-match ke keranjang + aturan
 * single-PRIMARY-replace menyisakan item terpendek. Fix: offer-confirmation
 * gate — tawaran ≥2 PRIMARY hanya masuk keranjang bila user pernah merujuk
 * itemnya (data-driven via matcher katalog, tanpa daftar frasa hafalan).
 */
describe('Ambiguous Choice Clarification (sesi 834128)', () => {
  const catalog = treatmentCatalogService.getAllServices(true).map((s) => ({
    id: (s as any).id,
    name: s.name,
    promoPrice: s.promoPrice,
    originalPrice: s.originalPrice,
    category: s.category,
    isAddon: (treatmentCatalogService as any).isAddonService(s),
  }));
  const menuOffer =
    'Bunda, saat ini kami memiliki beberapa promo menarik untuk layanan kami, antara lain:\n\n' +
    '- *Memandikan Bayi* hanya *Rp 30.000* (normal *Rp 40.000*), durasi 25 menit.\n' +
    '- *Cukur Rambut Bayi* hanya *Rp 25.000* (normal *Rp 35.000*), durasi 15 menit.\n' +
    '- *Tindik Telinga Bayi* hanya *Rp 50.000* (normal *Rp 70.000*), durasi 15 menit.\n' +
    '- *Pijat Bayi Ceria Newborn* hanya *Rp 60.000* (normal *Rp 80.000*), durasi 40 menit.';

  it('"boleh deh yang itu" tanpa rujukan nama -> keranjang TIDAK terkunci', () => {
    const history = [
      { role: 'user', content: 'apakah ada promo kak ?' },
      { role: 'assistant', content: menuOffer },
      { role: 'user', content: 'boleh deh yang itu' },
    ];
    const cart = GoalTracker.syncCartItems({ cartItems: [] } as any, history, catalog);
    // DILARANG terkunci ke Memandikan Bayi (item pertama/terpendek) maupun
    // item lain — belum ada pilihan, bot wajib klarifikasi dulu.
    expect(cart.length).toBe(0);
  });

  it('rujukan spesifik setelah menu ("mau yang newborn") -> hanya item itu yang terkunci', () => {
    const history = [
      { role: 'user', content: 'apakah ada promo kak ?' },
      { role: 'assistant', content: menuOffer },
      { role: 'user', content: 'saya mau yang pijat bayi ceria newborn bunda' },
    ];
    const cart = GoalTracker.syncCartItems({ cartItems: [] } as any, history, catalog);
    expect(cart.length).toBe(1);
    expect(cart[0].name).toContain('Newborn');
    expect(cart[0].type).toBe('PRIMARY');
  });

  it('tawaran tunggal + afirmasi ("boleh") -> perilaku lama dipertahankan', () => {
    const history = [
      { role: 'user', content: 'anak batuk pilek, treatment apa ya?' },
      { role: 'assistant', content: 'Bisa dibantu dengan *Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)* ya Bunda' },
      { role: 'user', content: 'boleh' },
    ];
    const cart = GoalTracker.syncCartItems({ cartItems: [] } as any, history, catalog);
    // Satu-satunya rekomendasi terapi tetap boleh tercatat (bukan menu ambigu).
    expect(cart.some((c) => c.name.includes('Pulih Ceria'))).toBe(true);
  });
});
