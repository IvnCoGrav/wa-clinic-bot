import { describe, it, expect } from 'vitest';
import { extractScheduleFromMessages } from '../../packages/admin-dashboard/src/utils/chatScheduleExtractor';
import { parseTreatmentItemsFromRaw } from '../../packages/admin-dashboard/src/utils/treatmentStringParser';

// Katalog tenant-aware (DB-driven) — harga jujur dari DB, tanpa 60000 karangan
const CATALOG = [
  { id: 'baby-massage-ceria', name: 'Kala Baby – Pijat Ceria', price: 80000, promoPrice: 70000, category: 'BABY', min_age_months: 7, max_age_months: 24 },
  { id: 'baby-massage-ceria-newborn', name: 'Kala Baby – Pijat Ceria Newborn', price: 80000, promoPrice: 60000, category: 'BABY', min_age_months: 0, max_age_months: 6 },
  { id: 'kids-massage-2-4', name: 'Kala Kids – Pijat Ceria', price: 85000, promoPrice: 75000, category: 'KIDS', min_age_months: 24, max_age_months: 48 },
] as any;

describe('Fase 3 — Dynamic Catalog & Price Resolution (Anti-60000)', () => {
  it('Pijat Ceria untuk 15 bulan → harga 70000 dari katalog (usia-aware)', () => {
    const messages = [
      { direction: 'INBOUND', content: 'Treatment : Pijat Ceria\nUsia Bayi/Anak : 15 bulan\nHari dan tanggal : Kamis, 27 Agustus 2026 jam 16.30-17.00' },
    ];
    const customer = { children: [{ raw_age_text: '15 bulan' }] };
    const out = extractScheduleFromMessages(messages, customer, CATALOG);
    // Ekstraktor form mengembalikan nama mentah dari form; pencocokan katalog hanya untuk harga
    expect(out.treatmentName).toBe('Pijat Ceria');
    expect(out.treatmentPrice).toBe(70000);
  });

  it('tanpa katalog → harga 0 (jujur belum terpetakan, bukan 60000)', () => {
    const messages = [{ direction: 'INBOUND', content: 'Mau pijat ceria' }];
    const out = extractScheduleFromMessages(messages, {}, []);
    // Tanpa katalog tidak boleh mengarang 60000
    expect(out.treatmentPrice).toBe(0);
  });

  it('treatment tidak dikenal tanpa katalog → 0', () => {
    const messages = [{ direction: 'INBOUND', content: 'Treatment: xyz ajaib qwerty' }];
    const out = extractScheduleFromMessages(messages, {}, CATALOG);
    // Tidak cocok katalog → 0, bukan karangan
    expect(out.treatmentPrice).toBe(0);
    expect(out.treatmentName).toBe('xyz ajaib qwerty');
  });

  it('parser tanpa match → price 0 (bukan 60000)', () => {
    const items = parseTreatmentItemsFromRaw('Pijat Ajaib XYZ', []);
    expect(items.length).toBe(1);
    expect(items[0].price).toBe(0);
  });

  it('parser dengan katalog → harga DB', () => {
    const items = parseTreatmentItemsFromRaw('Kala Baby – Pijat Ceria', CATALOG);
    expect(items[0].price).toBe(70000);
    expect(items[0].name).toBe('Kala Baby – Pijat Ceria');
  });
});
