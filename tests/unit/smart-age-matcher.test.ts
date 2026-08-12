import { describe, it, expect } from 'vitest';
import { parseAgeTextToBirthDate, parseAgeTextToMonths, monthsBetween } from '../../src/utils/age-calculator';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';

describe('Smart Age Matcher Unit Tests', () => {
  it('should parse "Kalo untuk anak 8 bulan" to 8 months age', () => {
    const birthDate = parseAgeTextToBirthDate('Kalo untuk anak 8 bulan');
    expect(birthDate).not.toBeNull();
    const months = monthsBetween(birthDate!, new Date());
    expect(months).toBe(8);
  });

  it('should retrieve age-appropriate services for an 8-month old baby', () => {
    const services = treatmentCatalogService.getServicesByAge(8);
    expect(services.length).toBeGreaterThan(0);
    // Pastikan seluruh service yang diambil memiliki minAgeMonths <= 8 dan (maxAgeMonths >= 8 atau null)
    for (const s of services) {
      expect(s.ageTier.minAgeMonths).toBeLessThanOrEqual(8);
      if (s.ageTier.maxAgeMonths !== null) {
        expect(s.ageTier.maxAgeMonths).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it('should parse "bayi 2 bulan" correctly to 2 months', () => {
    const months = parseAgeTextToMonths('bayi 2 bulan');
    expect(months).toBe(2);
  });

  it('should parse "anak 1 tahun" correctly to 12 months', () => {
    const months = parseAgeTextToMonths('anak 1 tahun');
    expect(months).toBe(12);
  });
});
