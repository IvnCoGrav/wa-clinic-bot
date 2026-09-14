import { describe, it, expect } from 'vitest';
import { extractScheduleFromMessages } from '../../packages/admin-dashboard/src/utils/chatScheduleExtractor';
import { parseTreatmentItemsFromRaw } from '../../packages/admin-dashboard/src/utils/treatmentStringParser';

// Katalog tenant-aware (DB-driven) — harga jujur dari DB, tanpa 60000 karangan
const CATALOG = [
  { id: 'baby-massage-ceria', name: 'Pijat Bayi Ceria (Rileksasi)', price: 80000, promoPrice: 70000, category: 'BABY', min_age_months: 0, max_age_months: 24 },
  { id: 'kids-massage-2-4', name: 'Pijat Kids Ceria (Usia 2-4 th)', price: 90000, promoPrice: 70000, category: 'KIDS', min_age_months: 24, max_age_months: 48 },
] as any;

describe('Fase 3 — Dynamic Catalog & Price Resolution (Anti-60000)', () => {
  it('Pijat Rileksasi untuk 15 bulan → Pijat Bayi Ceria 70000 (usia-aware)', () => {
    const messages = [
      { direction: 'INBOUND', content: 'Mau Pijat Rileksasi untuk anak 15 bulan' },
    ];
    const customer = { children: [{ raw_age_text: '15 bulan' }] };
    const out = extractScheduleFromMessages(messages, customer, CATALOG);
    expect(out.treatmentName).toBe('Pijat Bayi Ceria (Rileksasi)');
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
    const items = parseTreatmentItemsFromRaw('Pijat Bayi Ceria (Rileksasi)', CATALOG);
    expect(items[0].price).toBe(70000);
    expect(items[0].name).toBe('Pijat Bayi Ceria (Rileksasi)');
  });
});
