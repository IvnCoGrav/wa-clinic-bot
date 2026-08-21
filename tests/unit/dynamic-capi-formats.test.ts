import { describe, it, expect, vi } from 'vitest';
import { extractValueByFormat, getTenantCapiFormats } from '../../src/services/capi.service';
import { extractRupiahAmount } from '../../src/services/purchase-detection.service';

describe('Dynamic Meta CAPI Funnel & Value Extraction (Zero-Hardcode)', () => {
  describe('extractValueByFormat', () => {
    it('should extract pure treatment value from default "Treatment = %VALUE%" template ignoring shipping total', () => {
      const invoiceText = `Payment :
Treatment = 70.000
Ongkir 13km = 25.000
Promo ongkir = - 10.000
*Total = 85.000*`;

      const result = extractValueByFormat(invoiceText, 'Treatment = %VALUE%');
      expect(result).toBe(70000);
    });

    it('should extract pure multi-treatment combined value from invoice', () => {
      const invoiceText = `Payment : 
Treatment = 190.000
Ongkir 14 km = 25.000
Promo ongkir = - 10.000
*Total = 205.000*`;

      const result = extractValueByFormat(invoiceText, 'Treatment = %VALUE%');
      expect(result).toBe(190000);
    });

    it('should support custom tenant format_value e.g. "Biaya Layanan : %VALUE%"', () => {
      const customInvoice = `Rincian Pembayaran:
Biaya Layanan : 150.000
Biaya Transport : 30.000
Total Akhir = 180.000`;

      const result = extractValueByFormat(customInvoice, 'Biaya Layanan : %VALUE%');
      expect(result).toBe(150000);
    });

    it('should support suffix shorthand e.g. "rb" / "ribu"', () => {
      const shorthandInvoice = `Payment :
Treatment = 85 rb
Ongkir = 15 rb
Total = 100 rb`;

      const result = extractValueByFormat(shorthandInvoice, 'Treatment = %VALUE%');
      expect(result).toBe(85000);
    });

    it('should fallback to generic treatment pattern if format_value prefix is slightly different', () => {
      const text = `Layanan = 120.000\nTotal = 140.000`;
      const result = extractValueByFormat(text, 'Treatment = %VALUE%');
      expect(result).toBe(120000);
    });

    it('should return undefined if no treatment pattern or valid number is found', () => {
      const text = `Halo Bunda, terima kasih atas pesannya`;
      const result = extractValueByFormat(text, 'Treatment = %VALUE%');
      expect(result).toBeUndefined();
    });
  });

  describe('extractRupiahAmount with formatValue priority', () => {
    it('should prioritize formatValue over maximum number (total)', () => {
      const invoiceText = `Payment :
Treatment = 80.000
Ongkir 10km = 15.000
Promo ongkir = -5.000
*Total = 90.000*`;

      const withFormat = extractRupiahAmount(invoiceText, 'Treatment = %VALUE%');
      expect(withFormat).toBe(80000);

      // Without formatValue template, legacy behavior takes maximum number
      const withoutFormat = extractRupiahAmount(invoiceText);
      expect(withoutFormat).toBe(90000);
    });
  });

  describe('cleanTreatmentList', () => {
    // Import cleanTreatmentList helper logic
    const cleanTreatmentList = (detail: string): string[] => {
      if (!detail || detail === '—') return [];
      let cleaned = detail.replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, '');
      const parts = cleaned.split(/\|/g);
      const items: string[] = [];
      for (const part of parts) {
        let p = part.trim();
        if (!p) continue;
        p = p.replace(/^(?:Baby|Moms|Kids|Pilihan treatment\s*(?:\([^)]*\))?)\s*:\s*/i, '');
        const subParts = p.split(/\s*\+\s*/g);
        for (const sub of subParts) {
          let cleanSub = sub.replace(/\s+/g, ' ').trim();
          cleanSub = cleanSub.replace(/^(?:treatment\s*:\s*)/i, '');
          if (cleanSub && cleanSub.length > 2 && !cleanSub.toLowerCase().startsWith('usia')) {
            const formatted = cleanSub
              .toLowerCase()
              .replace(/(?:^|\s)\S/g, (a) => a.toUpperCase());
            if (!items.includes(formatted)) {
              items.push(formatted);
            }
          }
        }
      }
      return items.length > 0 ? items : [detail.replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, '').trim()];
    };

    it('should clean bracketed durations and baby details into clean list', () => {
      const raw = 'Baby: Cukur & Pijat (Bayi: Reyshaka, Usia: 1 bln | Anak: Racheline, Usia: 6th) [90m]';
      const result = cleanTreatmentList(raw);
      expect(result).toEqual(['Cukur & Pijat']);
    });

    it('should split multi-treatment into numbered clean array', () => {
      const raw = 'Baby: selapan+pijat therapy (Bayi: Althaf Zayyan Putra Maliki, Usia: 1bln 7hari) | Moms: massage full body (Kehamilan: -)';
      const result = cleanTreatmentList(raw);
      expect(result).toEqual(['Selapan', 'Pijat Therapy', 'Massage Full Body']);
    });

    it('should clean add-on treatments with duration details', () => {
      const raw = 'Sinar Moksa (Add-on) (Naira) [15m Addon] + Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung) (Naira) [40m] [Total 55m + Buffer 20m = 75m]';
      const result = cleanTreatmentList(raw);
      expect(result).toEqual(['Sinar Moksa', 'Pijat Bayi Pulih Ceria']);
    });
  });
});

