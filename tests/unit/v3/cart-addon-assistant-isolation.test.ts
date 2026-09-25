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
    // Tahan rebrand Kala: rekomendasi T2 WAJIB nama katalog kini agar ter-resolve (mekanisme yang diuji: isolasi add-on, bukan ejaan).
    const pulihName = treatmentCatalogService.getServiceById('baby-massage-pulih-ceria')?.name
      ?? 'Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)';
    const session: any = { cartItems: [] };
    const history = [
      { role: 'user', content: 'halo kak' },
      { role: 'assistant', content: 'Halo Bunda! Perkenalkan saya Bidan Yusi. Ada yang bisa kami bantu?' },
      { role: 'user', content: 'yg untuk kembung apa kak' },
      { role: 'assistant', content: `Untuk keluhan kembung kami sarankan *${pulihName}* ya Bunda.` },
      { role: 'user', content: 'Ada yg perlu saya persiapkan gak kak buat tretmentnya?' },
      { role: 'assistant', content: 'Untuk treatmentnya Bunda tidak perlu menyiapkan apa-apa. Cukup siapkan alas tidur. Jika ada alat bantu yang diperlukan, seperti Sinar Moksa, kami juga akan membawanya.' },
    ];

    const cart = GoalTracker.syncCartItems(
      session,
      history,
      catalog
    );

    // Active User Commitment (mandat AGENTS.md): pertanyaan persiapan TANPA komitmen user
    // DILARANG mengunci cart — Pulih T2 tercatat sebagai bahan konsultasi (discussed), moksa phantom dilarang.
    expect(cart.length).toBe(0);
    expect(session.discussedTreatments || []).toContain(pulihName);
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

    // Sesi 337880 + mandat Active User Commitment (AGENTS.md): rekomendasi
    // asisten BUKAN komitmen user. 'batuk pilek' tak memetakan token unik ke
    // layanan mana pun, sehingga keranjang tetap KOSONG (bukan Pulih sepihak).
    expect(cart.length).toBe(0);
    expect(cart.some((c) => c.name.toLowerCase().includes('moksa'))).toBe(false);
  });
});
