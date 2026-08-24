import { describe, it, expect } from 'vitest';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';
import { buildPriceAnswer } from '../../src/services/price-answer.service';

describe('Age Category & Audience Isolation Tests', () => {
  it('Pencarian untuk anak usia 3 tahun WAJIB mengembalikan Pijat Kids Ceria dan MEMBLOKIR Prenatal Yoga', () => {
    const items = treatmentCatalogService.searchCatalogItems('Buat pijat anak usia 3 tahun harganya berapa ya');
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].name).toContain('Pijat Kids Ceria');
    expect(items[0].category).toBe('KIDS');
    
    // Pastikan tidak ada treatment kategori MOMS (seperti Prenatal Yoga) yang lolos
    const momsItems = items.filter((s) => s.category === 'MOMS');
    expect(momsItems.length).toBe(0);
  });

  it('buildPriceAnswer untuk anak 3 tahun memberikan harga Kids Ceria dan tidak menyebut Prenatal Yoga', () => {
    const res = buildPriceAnswer('Buat pijat anak usia 3 tahun harganya berapa ya', {
      hasLocation: true,
      pricelistAlreadySent: true,
    });
    expect(res.replyText).toContain('Pijat Kids Ceria');
    expect(res.replyText).toContain('Rp 70.000');
    expect(res.replyText).not.toContain('Prenatal');
    expect(res.replyText).not.toContain('Yoga');
  });

  it('Pencarian untuk ibu hamil WAJIB mengembalikan kategori MOMS (Prenatal Massage / Yoga) dan memblokir KIDS/BABY', () => {
    const items = treatmentCatalogService.searchCatalogItems('Untuk ibu hamil 7 bulan ada pijat apa ya');
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].category).toBe('MOMS');
    expect(items[0].name).toContain('Prenatal');
    
    const babyItems = items.filter((s) => s.category === 'BABY' || s.category === 'KIDS');
    expect(babyItems.length).toBe(0);
  });

  it('Pencarian untuk bayi 6 bulan WAJIB mengembalikan kategori BABY dan memblokir MOMS', () => {
    const items = treatmentCatalogService.searchCatalogItems('Pijat bayi usia 6 bulan berapa harganya');
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].category).toBe('BABY');
    
    const momsItems = items.filter((s) => s.category === 'MOMS');
    expect(momsItems.length).toBe(0);
  });
});