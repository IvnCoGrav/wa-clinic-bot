import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../src/v3/state/goal-tracker';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';
import { isConsultativeUserText, hasInterrogativeIntent } from '../../src/utils/date-confirmation';

/**
 * Audit 6285743192813 — Active User Commitment Mutlak.
 *
 * Akar: `isConsultativeUserText` mensyaratkan tanda '?' harfiah sehingga
 * pertanyaan WhatsApp tanpa '?' ("maaf untuk pulih ceria itu gmna ya")
 * salah diklasifikasi sebagai KOMITMEN dan mengunci layanan ke cartItems.
 * Fix: deteksi niat interogatif gramatikal (dengan/tanpa '?') reuse set
 * fungsi tanya yang sudah ada — bukan daftar kalimat bisnis hafalan.
 */
describe('isConsultativeUserText tanpa tanda tanya (audit 6285743192813)', () => {
  it('hasInterrogativeIntent menangkap ragam ejaan tanya', () => {
    for (const t of ['gmna', 'gimana', 'gmn', 'bgmn', 'kapan ya', 'buat apa', 'maksudnya', 'jelaskan dong']) {
      expect(hasInterrogativeIntent(t), t).toBe(true);
    }
    for (const t of ['saya ambil yang ceria', 'besok pagi bisa datang']) {
      expect(hasInterrogativeIntent(t), t).toBe(false);
    }
  });

  const all = treatmentCatalogService.getAllServices(true);
  const catalog = all.map((s) => ({
    id: s.id,
    name: s.name,
    promoPrice: s.promoPrice,
    originalPrice: s.originalPrice,
    category: s.category,
    isAddon: (treatmentCatalogService as any).isAddonService(s),
  }));
  const pulihName = all.find((s) => s.id === 'baby-massage-pulih-ceria')?.name
    ?? 'Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)';

  it('pertanyaan TANPA ? → cartItems KOSONG, hanya masuk discussedTreatments', () => {
    const session: any = { genderGreeting: 'Bunda', cartItems: [] };
    const history = [{ role: 'user', content: 'maaf untuk pulih ceria itu gmna ya' }];
    const cart = GoalTracker.syncCartItems(session, history, catalog as any);
    expect(cart).toHaveLength(0);
    expect(session.discussedTreatments || []).toContain(pulihName);
  });

  it('komitmen deklaratif → cartItems terisi (tidak over-block)', () => {
    const session: any = { genderGreeting: 'Bunda', cartItems: [] };
    const history = [{ role: 'user', content: 'saya mau ambil pulih ceria ya bund' }];
    const cart = GoalTracker.syncCartItems(session, history, catalog as any);
    expect(cart.length).toBeGreaterThan(0);
  });
});
