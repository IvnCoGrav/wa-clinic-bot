/**
 * Fase 3 — Metadata kelayakan klinis pada katalog.
 *
 * Kontrak: field klinis yang dikirim admin (eligibleLifeStages, contraindications,
 * requiresScreening, ambang gestasional, clinicalFamily) tersimpan & terbaca
 * kembali oleh layer katalog yang dipakai tool AI.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  treatmentCatalogService,
  inferClinicalFamily,
} from '../../src/services/treatment-catalog.service';

describe('Fase 3 — katalog layanan menyimpan metadata klinis', () => {
  const createdIds: string[] = [];

  afterEach(() => {
    for (const id of createdIds.splice(0)) {
      try { treatmentCatalogService.deleteService(id); } catch {}
    }
  });

  it('inferClinicalFamily mengenali keluarga klinis dari data katalog', () => {
    expect(inferClinicalFamily({ id: 'x', name: 'Kala Mom – Induksi Massage' })).toBe('INDUCTION');
    expect(inferClinicalFamily({ id: 'x', name: 'Kala Mom – Perineum Massage' })).toBe('PERINEUM');
    expect(inferClinicalFamily({ id: 'x', name: 'Kala Mom – Pregnant Massage' })).toBe('PRENATAL');
    expect(inferClinicalFamily({ id: 'x', name: 'Kala Mom – Oksitosin Massage' })).toBe('LACTATION');
    expect(inferClinicalFamily({ id: 'x', name: 'Kala Mom – Postpartum Recovery' })).toBe('POSTPARTUM');
  });

  it('upsert menyimpan & mengembalikan field klinis apa adanya', () => {
    const id = 'test-clinical-moms-1';
    createdIds.push(id);

    treatmentCatalogService.upsertService({
      id,
      name: 'Test Pregnant Massage',
      category: 'MOMS',
      ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Trimester 2-3' },
      durationMinutes: 60,
      originalPrice: 120000,
      promoPrice: 100000,
      description: 'Pijat ibu hamil',
      isActive: true,
      eligibleLifeStages: ['PREGNANT'],
      contraindications: ['FEVER'],
      requiresScreening: true,
      minGestationalWeeks: 20,
      maxGestationalWeeks: 36,
      clinicalFamily: 'PRENATAL',
    });

    const got = treatmentCatalogService.getServiceById(id);
    expect(got).toBeDefined();
    expect(got?.eligibleLifeStages).toEqual(['PREGNANT']);
    expect(got?.contraindications).toEqual(['FEVER']);
    expect(got?.requiresScreening).toBe(true);
    expect(got?.minGestationalWeeks).toBe(20);
    expect(got?.maxGestationalWeeks).toBe(36);
    expect(got?.clinicalFamily).toBe('PRENATAL');
  });
});
