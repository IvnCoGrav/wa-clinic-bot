import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../../src/v3/state/goal-tracker';
import { treatmentCatalogService } from '../../../src/services/treatment-catalog.service';

/**
 * Audit Sesi 173235 — Asisten menyebut nama add-on (Sinar Moksa) pada penjelasan
 * persiapan treatment ("Jika ada alat bantu yang diperlukan, seperti Sinar Moksa, kami juga akan membawanya").
 * ADDON DILARANG disuntikkan ke keranjang jika HANYA disebut oleh asisten tanpa ada
 * permintaan atau konfirmasi eksplisit dari user (anti-phantom basket injection).
 */
describe('Cart Add-on Assistant Isolation (anti-phantom basket)', () => {
  const catalog = treatmentCatalogService.getAllServices(true).map((s) => ({
    id: (s as any).id,
    name: s.name,
    promoPrice: s.promoPrice,
    originalPrice: s.originalPrice,
    category: s.category,
    isAddon: (treatmentCatalogService as any).isAddonService(s),
  }));

  it('asisten menyebut "seperti Sinar Moksa kami bawa" pada T3 -> Sinar Moksa TIDAK masuk keranjang', () => {
    const history = [
      { role: 'user', content: 'halo kak' },
      { role: 'assistant', content: 'Halo Bunda! Perkenalkan saya Bidan Yusi. Ada yang bisa kami bantu?' },
      { role: 'user', content: 'yg untuk kembung apa kak' },
      { role: 'assistant', content: 'Untuk keluhan kembung kami sarankan *Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)* ya Bunda.' },
      { role: 'user', content: 'Ada yg perlu saya persiapkan gak kak buat tretmentnya?' },
      { role: 'assistant', content: 'Untuk treatmentnya Bunda tidak perlu menyiapkan apa-apa. Cukup siapkan alas tidur. Jika ada alat bantu yang diperlukan, seperti Sinar Moksa, kami juga akan membawanya.' },
    ];

    const cart = GoalTracker.syncCartItems(
      { cartItems: [] } as any,
      history,
      catalog
    );

    // Keranjang hanya boleh berisi Pijat Bayi Pulih Ceria dari T2
    expect(cart.length).toBe(1);
    expect(cart[0].name.toLowerCase()).toContain('pulih ceria');
    expect(cart.some((c) => c.name.toLowerCase().includes('moksa'))).toBe(false);
  });

  it('user eksplisit meminta tambah sinar moksa -> Sinar Moksa MASUK keranjang', () => {
    const history = [
      { role: 'user', content: 'saya mau ambil pulih ceria ya kak' },
      { role: 'assistant', content: 'Baik Bunda, kami catat untuk Pijat Bayi Pulih Ceria ya.' },
      { role: 'user', content: 'sekalian tambah sinar moksa ya' },
    ];

    const cart = GoalTracker.syncCartItems(
      { cartItems: [] } as any,
      history,
      catalog
    );

    expect(cart.length).toBe(2);
    expect(cart.some((c) => c.name.toLowerCase().includes('pulih ceria'))).toBe(true);
    expect(cart.some((c) => c.name.toLowerCase().includes('moksa'))).toBe(true);
  });

  it('asisten menawarkan sinar moksa tapi user belum mengiyakan -> Sinar Moksa TIDAK masuk keranjang', () => {
    const history = [
      { role: 'user', content: 'anak saya batuk pilek' },
      { role: 'assistant', content: 'Bisa dengan Pijat Bayi Pulih Ceria Bunda. Kalau mau lebih maksimal bisa sekalian terapi hangat Sinar Moksa yaa.' },
      { role: 'user', content: 'lokasi kliniknya dimana ya?' },
    ];

    const cart = GoalTracker.syncCartItems(
      { cartItems: [] } as any,
      history,
      catalog
    );

    expect(cart.length).toBe(1);
    expect(cart[0].name.toLowerCase()).toContain('pulih ceria');
    expect(cart.some((c) => c.name.toLowerCase().includes('moksa'))).toBe(false);
  });
});
