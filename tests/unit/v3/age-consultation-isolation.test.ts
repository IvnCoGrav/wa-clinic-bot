import { describe, it, expect } from 'vitest';
import { executeGetCatalog } from '../../../src/v3/tools/get-catalog.tool';

describe('Clinical Age Consultation Isolation (Plan 7)', () => {
  it('konsultasi usia 17 bulan tanpa keluhan: paket relaksasi & nutrisi mendahului paket terapi sakit', async () => {
    const result = await executeGetCatalog({
      childAgeMonths: 17,
      category: 'BABY',
      symptoms: [],
      inquirePrice: false,
      asksDuration: false,
    });

    expect(result.success).toBe(true);
    expect(result.treatments.length).toBeGreaterThan(0);
    console.log('Treatments for age 17:', result.treatments.map(t => t.name));

    // Layanan teratas harus Ceria (relaksasi) atau Lahap (nutrisi) — tahan rebrand Kala.
    const topTreatment = result.treatments[0];
    expect(topTreatment.name).not.toContain('Pulih Ceria');
    expect(topTreatment.name.includes('Ceria') || topTreatment.name.includes('Lahap')).toBe(true);

    // Pulih Ceria (terapi bapil/kembung) tidak boleh menempati posisi teratas bila tanpa keluhan sakit
    const pulihIndex = result.treatments.findIndex((t) => t.name.includes('Pulih Ceria'));
    expect(pulihIndex).not.toBe(0);
    const ceriaIndex = result.treatments.findIndex((t) => t.name.includes('Ceria') && !t.name.includes('Pulih'));
    expect(ceriaIndex).toBeGreaterThanOrEqual(0);
    if (pulihIndex !== -1) {
      expect(ceriaIndex).toBeLessThan(pulihIndex);
    }
  });

  it('konsultasi keluhan sakit batuk pilek: paket Pulih Ceria tetap direkomendasikan', async () => {
    const result = await executeGetCatalog({
      childAgeMonths: 17,
      category: 'BABY',
      symptoms: ['batuk', 'pilek'],
      inquirePrice: true,
      asksDuration: false,
    });

    expect(result.success).toBe(true);
    const topTreatment = result.treatments[0];
    expect(topTreatment.name).toContain('Pulih Ceria');
    expect(topTreatment.isRecommendedForSymptoms).toBe(true);
  });
});
