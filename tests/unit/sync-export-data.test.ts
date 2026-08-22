import { describe, it, expect } from 'vitest';
import {
  normalizePhone,
  cleanCustomerName,
  parsePatientAgeAndName,
  parseBookingDateTime,
  mapPatientTypeToCategory,
} from '../../src/scripts/enrich-export-helpers';
import { RAW_EXPORT_DATA } from '../../src/scripts/sync-export-data';
import { TreatmentCategory } from '@prisma/client';

describe('Export Data Normalization & Enrichment Unit Tests', () => {
  it('should have exactly 126 export records (excluding contact 57 duplicate)', () => {
    expect(RAW_EXPORT_DATA.length).toBe(126);
    const hasContact57 = RAW_EXPORT_DATA.some(i => i.contact_id === '57');
    expect(hasContact57).toBe(false);
  });

  it('should normalize phone numbers to Indonesian international 62 format', () => {
    expect(normalizePhone('08113099991')).toBe('628113099991');
    expect(normalizePhone('628113099991')).toBe('628113099991');
    expect(normalizePhone('+62 812-3328-5194')).toBe('6281233285194');
  });

  it('should clean customer names from prefixes and location suffixes', () => {
    expect(cleanCustomerName('Leliy Jambangan')).toBe('Leliy');
    expect(cleanCustomerName('Bunda Fierda, Wiyung Apart CBD')).toBe('Fierda');
    expect(cleanCustomerName('~Ivon')).toBe('Ivon');
    expect(cleanCustomerName('Bunda MUTIA A, Gunung Anyar')).toBe('MUTIA A');
    expect(cleanCustomerName('Bunda Rosita, Manukan')).toBe('Rosita');
  });

  it('should extract patient names and ages correctly', () => {
    const single = parsePatientAgeAndName('Dhafi (11 bulan)');
    expect(single).toEqual([
      { name: 'Dhafi', ageText: '11 bulan', ageMonths: 11 }
    ]);

    const multiple = parsePatientAgeAndName('Owen (2 bulan) & Briell (3 tahun)');
    expect(multiple).toEqual([
      { name: 'Owen', ageText: '2 bulan', ageMonths: 2 },
      { name: 'Briell', ageText: '3 tahun', ageMonths: 36 }
    ]);

    const days = parsePatientAgeAndName('Nami (32 hari)');
    expect(days).toEqual([
      { name: 'Nami', ageText: '32 hari', ageMonths: 1 }
    ]);
  });

  it('should correctly map patient type and treatments to TreatmentCategory', () => {
    expect(mapPatientTypeToCategory('Baby', ['Pijat Bayi'])).toBe(TreatmentCategory.BABY);
    expect(mapPatientTypeToCategory('Moms', ['Oksitosin Full Body Massage', 'Breast Massage'])).toBe(TreatmentCategory.MOMS);
    expect(mapPatientTypeToCategory('Combination', ['Pijat Bayi Kids Ceria'])).toBe(TreatmentCategory.BOTH);
    expect(mapPatientTypeToCategory('Baby', ['Pijat Bayi', 'Paket Laktasi'])).toBe(TreatmentCategory.BOTH);
  });

  it('should parse various booking date formats safely', () => {
    const d1 = parseBookingDateTime('Rabu, 08/07/2026', '2026-07-04');
    expect(d1.getFullYear()).toBe(2026);
    expect(d1.getMonth()).toBe(6); // July is 6

    const d2 = parseBookingDateTime('Senin, 10 Agustus 2026', '2026-08-17');
    expect(d2.getFullYear()).toBe(2026);
    expect(d2.getMonth()).toBe(7); // August is 7

    const d3 = parseBookingDateTime('2026-07-13', '2026-07-12');
    expect(d3.getFullYear()).toBe(2026);
  });
});
