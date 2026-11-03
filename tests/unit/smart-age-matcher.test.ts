import { describe, it, expect } from 'vitest';
import { parseAgeTextToBirthDate, parseAgeTextToMonths, monthsBetween } from '../../src/utils/age-calculator';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';

describe('Smart Age Matcher Unit Tests', () => {
  it.each([
    new Date('2026-11-02T10:00:00+07:00'),
    new Date('2026-11-01T10:00:00+07:00'),
    new Date('2026-11-30T10:00:00+07:00'),
    new Date('2026-03-31T10:00:00+07:00'),
  ])('round-trip "anak 8 bulan" tepat 8 bulan pada referensi %s', (ref) => {
    const birthDate = parseAgeTextToBirthDate('Kalo untuk anak 8 bulan', ref);
    expect(birthDate).not.toBeNull();
    expect(monthsBetween(birthDate!, ref)).toBe(8);
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
