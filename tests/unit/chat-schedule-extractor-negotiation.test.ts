import { describe, it, expect } from 'vitest';
import { extractScheduleFromMessages } from '../../packages/admin-dashboard/src/utils/chatScheduleExtractor';
import { matchCatalogService } from '../../packages/admin-dashboard/src/utils/treatmentStringParser';

/**
 * Uji adversarial multi-frasa untuk perbaikan audit:
 * - Negosiasi jam reverse-chronological (bukan match pesan terlama).
 * - Matcher katalog anti-substring ("cukur rambut" ≠ paket Selapan).
 * - Otoritas bundle dari metadata DB (category/serviceType), bukan kata hafalan.
 */
describe('Chat Schedule Extractor — Negotiation & Catalog (adversarial)', () => {
  const catalog = [
    { id: 'cukur', name: 'Kala Baby – Cukur Rambut', promoPrice: 25000, originalPrice: 30000, category: 'BABY', durationMinutes: 15 },
    { id: 'ceria75', name: 'Kala Kids – Pijat Ceria', promoPrice: 75000, category: 'KIDS', durationMinutes: 40, ageTier: { minAgeMonths: 24, maxAgeMonths: 48, label: '2 - 4 Tahun' } },
    { id: 'ceria80', name: 'Kala Kids – Pijat Ceria', promoPrice: 80000, category: 'KIDS', durationMinutes: 40, ageTier: { minAgeMonths: 48, maxAgeMonths: 72, label: '4 - 6 Tahun' } },
    { id: 'selapan', name: 'Kala Bundle Selapan (Cukur + Pijat Ceria)', promoPrice: 80000, category: 'BUNDLE', durationMinutes: 75 },
  ];

  it('prioritaskan jam negosiasi TERKINI, bukan tawaran lama bot', () => {
    const messages = [
      { direction: 'OUTBOUND', content: 'Slot yang tersedia jam 09.00-09.30 ya Bunda' },
      { direction: 'INBOUND', content: 'klo jam 10 gmna kak?' },
      { direction: 'OUTBOUND', content: 'Bisa Bunda jam 10.00' },
    ];
    const extracted = extractScheduleFromMessages(messages, { name: 'Linda Nur', phone: '628111' }, catalog);
    expect(extracted.timeDisplay).toBe('10.00');
  });

  it('reverse scan tetap mengenali rentang jam terbaru', () => {
    const messages = [
      { direction: 'OUTBOUND', content: 'Ada slot jam 08.00-08.30' },
      { direction: 'INBOUND', content: 'mending jam 13.00-13.30 deh kak' },
    ];
    const extracted = extractScheduleFromMessages(messages, { name: 'Bunda' }, catalog);
    expect(extracted.timeDisplay).toBe('13.00-13.30');
  });

  it('reverse scan tetap mengenali jam + keterangan waktu (pagi/siang/sore)', () => {
    const messages = [
      { direction: 'OUTBOUND', content: 'Bisa jam 09.00 pagi bun' },
      { direction: 'INBOUND', content: 'boleh jam 4 sore?' },
    ];
    const extracted = extractScheduleFromMessages(messages, { name: 'Bunda' }, catalog);
    expect(extracted.timeDisplay).toBe('16.00');
  });

  it('"cukur rambut" → layanan satuan Cukur Rambut 25k, BUKAN Bundle Selapan 80k', () => {
    const matched = matchCatalogService('cukur rambut', catalog);
    expect(matched?.name).toBe('Kala Baby – Cukur Rambut');
    expect(matched?.promoPrice).toBe(25000);
  });

  it('"mau cukur aja" tetap tidak memicu bundle', () => {
    const matched = matchCatalogService('mau cukur aja', catalog);
    expect(matched?.name).not.toContain('Bundle');
  });

  it('"paket selapan" eksplisit tetap memilih bundle (otoritas marker eksplisit)', () => {
    const matched = matchCatalogService('paket selapan', catalog);
    expect(matched?.name).toContain('Bundle');
  });

  it('"pijat ceria" tidak salah cocok ke bundle', () => {
    const matched = matchCatalogService('pijat ceria', catalog);
    expect(matched?.name).not.toContain('Bundle');
    expect(matched?.name).toContain('Pijat Ceria');
  });
});
