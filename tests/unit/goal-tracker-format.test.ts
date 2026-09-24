import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../src/v3/state/goal-tracker';

describe('GoalTracker.formatGoalSessionForPrompt — grounding bulletproof', () => {
  const baseSession: any = {
    genderGreeting: 'Bunda',
    customerName: 'Sandbox Customer',
  };

  it('lokasi terisi → baris status eksplisit DILARANG TANYA ALAMAT LAGI', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      ...baseSession,
      location: {
        kelurahan: 'Pelemwatu',
        kecamatan: 'Menganti',
        kota: 'Kabupaten Gresik',
        distanceKm: 28.51,
        ongkirPromo: 30000,
        ongkirNormal: 35000,
      },
    } as any);
    expect(text).toContain('Pelemwatu');
    expect(text).toContain('[STATUS: SUDAH DIKETAHUI - DILARANG TANYA ALAMAT LAGI!]');
  });

  it('lokasi kosong → instruksi tanya kelurahan tetap muncul (tidak ada status larangan)', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({ ...baseSession } as any);
    expect(text).toContain('Belum diketahui');
    expect(text).not.toContain('DILARANG TANYA ALAMAT LAGI');
  });

  // Rule 2 — Strict Information Hiding (state-gated prompt pruning).
  it('lokasi ada + priceDiscussed BUKAN true → nominal ongkir TIDAK disuntik ke prompt', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      ...baseSession,
      location: {
        kelurahan: 'Tenggilis Mejoyo',
        kecamatan: 'Tenggilis Mejoyo',
        kota: 'Surabaya',
        distanceKm: 12.3,
        ongkirPromo: 15000,
        ongkirNormal: 25000,
      },
    } as any);
    expect(text).not.toMatch(/Rp\s*15\.000/);
    expect(text).not.toMatch(/Rp\s*25\.000/);
    expect(text).not.toContain('• Ongkir:');
  });

  it('lokasi ada + priceDiscussed true → nominal ongkir boleh disuntik (mode transaksional)', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      ...baseSession,
      priceDiscussed: true,
      location: {
        kelurahan: 'Tenggilis Mejoyo',
        kecamatan: 'Tenggilis Mejoyo',
        kota: 'Surabaya',
        distanceKm: 12.3,
        ongkirPromo: 15000,
        ongkirNormal: 25000,
      },
    } as any);
    expect(text).toContain('• Ongkir: Rp 15.000');
  });

  // I4 — Aturan Emas harga: rekomendasi keluhan tanpa priceDiscussed = tanpa nominal.
  it('keluhan tanpa priceDiscussed → rekomendasi tanpa nominal promo', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      ...baseSession,
      children: [{ ageMonths: 6, symptoms: ['batuk', 'pilek'] }],
    } as any);
    if (text.includes('Rekomendasi Sesuai Keluhan')) {
      expect(text).not.toMatch(/Promo Rp/);
    }
  });

  it('keluhan + priceDiscussed true → rekomendasi boleh memuat nominal promo', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      ...baseSession,
      priceDiscussed: true,
      children: [{ ageMonths: 6, symptoms: ['batuk', 'pilek'] }],
    } as any);
    if (text.includes('Rekomendasi Sesuai Keluhan')) {
      expect(text).toMatch(/Promo Rp/);
    }
  });

  // I4b — baris keranjang tanpa priceDiscussed = tanpa nominal apa pun.
  it('keranjang tanpa priceDiscussed → tanpa nominal per-item', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      ...baseSession,
      cartItems: [{ name: 'Pijat Bayi Pulih Ceria', price: 95000, promoPrice: 75000 }],
    } as any);
    expect(text).toContain('Pijat Bayi Pulih Ceria');
    expect(text).not.toMatch(/Rp\s*[\d.]+/);
  });

  it('keranjang + priceDiscussed true → nominal per-item + total resmi', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      ...baseSession,
      priceDiscussed: true,
      cartItems: [{ name: 'Pijat Bayi Pulih Ceria', price: 95000, promoPrice: 75000 }],
    } as any);
    expect(text).toMatch(/Rp\s*75\.000/);
    expect(text).toContain('Total Akumulasi Biaya');
  });

  // I6 — pin deterministik anafora.
  it('nama terkonsultasi dirender bila belum ada treatment terpilih', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      ...baseSession,
      discussedTreatments: ['Pijat Bayi Pulih Ceria'],
    } as any);
    expect(text).toContain('Treatment Dikonsultasikan: Pijat Bayi Pulih Ceria');
  });

  it('nama terkonsultasi tidak duplikat bila treatment sudah terpilih', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      ...baseSession,
      selectedTreatment: 'Pijat Bayi Pulih Ceria',
      discussedTreatments: ['Pijat Bayi Pulih Ceria'],
    } as any);
    expect(text).toContain('Treatment Terpilih: Pijat Bayi Pulih Ceria');
    expect(text).not.toContain('Treatment Dikonsultasikan');
  });

  it('keluhan tanpa rekomendasi tetap di-pin (rec null)', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      ...baseSession,
      children: [{ ageMonths: 6, symptoms: ['zzqzx'] }],
    } as any);
    expect(text).toContain('Keluhan Tercatat: zzqzx');
  });
});
