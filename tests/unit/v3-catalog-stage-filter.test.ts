import { describe, it, expect } from 'vitest';
import {
  treatmentCatalogService,
  inferEligibleLifeStages,
} from '../../src/services/treatment-catalog.service';
import { executeGetCatalog } from '../../src/v3/tools/get-catalog.tool';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('Fase 4 — Track 2C: Metadata Kelayakan Katalog & Stage Filter (deterministik)', () => {
  describe('inferEligibleLifeStages fallback data-driven', () => {
    it('mengklasifikasikan Induksi Massage sebagai PREGNANT_ATERM', () => {
      const stages = inferEligibleLifeStages({
        category: 'MOMS',
        name: 'Kala Mom – Induksi Massage',
        description: 'Pijat stimulasi titik induksi alami aterm',
      });
      expect(stages).toEqual(['PREGNANT_ATERM']);
    });

    it('mengklasifikasikan Prenatal Massage sebagai PREGNANT', () => {
      const stages = inferEligibleLifeStages({
        category: 'MOMS',
        name: 'Kala Mom – Pregnant Massage',
        description: 'Pijat khusus ibu hamil trimester 2 dan 3',
      });
      expect(stages).toEqual(['PREGNANT']);
    });

    it('mengklasifikasikan Laktasi & Oksitosin sebagai POSTPARTUM & LACTATING', () => {
      const stages = inferEligibleLifeStages({
        category: 'MOMS',
        name: 'Kala Mom – Laktasi & Breast Care',
        description: 'Perawatan payudara melancarkan sumbatan ASI',
      });
      expect(stages).toEqual(['POSTPARTUM', 'LACTATING']);
    });
  });

  describe('recommendServiceBySymptoms stage filtering', () => {
    it('keluhan maternal dengan momStage UNKNOWN -> return askStage: true (deterministik)', () => {
      const rec = treatmentCatalogService.recommendServiceBySymptoms(
        ['kaki', 'bengkak'],
        null,
        'MOMS',
        DEFAULT_TENANT_ID,
        'UNKNOWN'
      );
      expect(rec).toBeDefined();
      expect(rec?.askStage).toBe(true);
      expect(rec?.blockedByStage).toBe(true);
    });

    it('keluhan kaki bengkak bumil (PREGNANT) 28 minggu -> merekomendasikan Pregnant/Prenatal Massage', () => {
      const rec = treatmentCatalogService.recommendServiceBySymptoms(
        ['kaki', 'bengkak'],
        null,
        'MOMS',
        DEFAULT_TENANT_ID,
        'PREGNANT',
        28
      );
      expect(rec).toBeDefined();
      expect(rec?.askStage).toBeFalsy();
      expect(rec?.name.toLowerCase()).toContain('pregnant');
    });

    it('ibu aterm 38 minggu minta induksi -> merekomendasikan Induksi Massage', () => {
      const rec = treatmentCatalogService.recommendServiceBySymptoms(
        ['induksi', 'massage'],
        null,
        'MOMS',
        DEFAULT_TENANT_ID,
        'PREGNANT',
        38
      );
      expect(rec).toBeDefined();
      expect(rec?.askStage).toBeFalsy();
      expect(rec?.name.toLowerCase()).toContain('induksi');
    });

    it('ibu preterm 32 minggu minta induksi -> paket induksi diblokir dari pool aktif', () => {
      const rec = treatmentCatalogService.recommendServiceBySymptoms(
        ['induksi', 'massage'],
        null,
        'MOMS',
        DEFAULT_TENANT_ID,
        'PREGNANT',
        32
      );
      // Preterm 32 minggu: induksi diblokir (tidak boleh direkomendasikan secara aktif)
      expect(rec?.name.toLowerCase().includes('induksi') ? rec?.blockedByStage : true).toBeTruthy();
    });

    it('ibu nifas minta laktasi/oksitosin -> merekomendasikan Laktasi atau Oksitosin Massage', () => {
      const rec = treatmentCatalogService.recommendServiceBySymptoms(
        ['laktasi', 'asi'],
        null,
        'MOMS',
        DEFAULT_TENANT_ID,
        'POSTPARTUM'
      );
      expect(rec).toBeDefined();
      expect(rec?.askStage).toBeFalsy();
      const name = rec?.name.toLowerCase() || '';
      expect(name.includes('laktasi') || name.includes('oksitosin')).toBe(true);
    });
  });

  describe('executeGetCatalog dengan momStage UNKNOWN', () => {
    it('keluhan maternal saat momStage UNKNOWN mengembalikan askStage true & closingIntent ASK_STAGE', async () => {
      const output = await executeGetCatalog(
        {
          category: 'MOMS',
          symptoms: ['kaki', 'bengkak'],
          momStage: 'UNKNOWN' as any,
        },
        DEFAULT_TENANT_ID
      );
      expect(output.success).toBe(true);
      expect(output.askStage).toBe(true);
      expect(output.closingIntent).toBe('ASK_STAGE');
    });
  });
});
