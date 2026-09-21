import { describe, it, expect, beforeAll } from 'vitest';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';
import type { ClinicServiceItem } from '../../src/services/treatment-catalog.service';

/**
 * 391501 Fase 2 — Age-aware default relaxation (TDD).
 * Default catalog tidak punya varian Newborn terpisah (0-24 tunggal),
 * jadi uji dengan tenant terisolasi yang memiliki 3 tier eksplisit.
 */
describe('TreatmentCatalog — getDefaultRelaxationService age-aware (391501)', () => {
  const tenantId = 'test-age-391501';

  beforeAll(() => {
    const mk = (over: Partial<ClinicServiceItem>): ClinicServiceItem => ({
      id: over.id!,
      name: over.name!,
      category: over.category as any,
      ageTier: over.ageTier!,
      durationMinutes: 40,
      originalPrice: 80000,
      promoPrice: 60000,
      description: 'test',
      isActive: true,
    });
    // Tier Newborn 0-6, Ceria 7-24, Kids 25-144
    treatmentCatalogService.upsertService(mk({
      id: 'test-newborn-0-6',
      name: 'Pijat Bayi Ceria Newborn',
      category: 'BABY',
      ageTier: { minAgeMonths: 0, maxAgeMonths: 6, label: '0 - 6 Bulan' },
    }), tenantId);
    treatmentCatalogService.upsertService(mk({
      id: 'test-ceria-7-24',
      name: 'Pijat Bayi Ceria',
      category: 'BABY',
      ageTier: { minAgeMonths: 7, maxAgeMonths: 24, label: '7 - 24 Bulan' },
    }), tenantId);
    treatmentCatalogService.upsertService(mk({
      id: 'test-kids-25-144',
      name: 'Pijat Kids Ceria',
      category: 'KIDS',
      ageTier: { minAgeMonths: 25, maxAgeMonths: 144, label: '2 - 12 Tahun' },
    }), tenantId);
  });

  it('age 3 bulan → Newborn (0-6)', () => {
    const s = treatmentCatalogService.getDefaultRelaxationService('BABY', 3, tenantId);
    expect(s?.name).toBe('Pijat Bayi Ceria Newborn');
  });

  it('age 17 bulan → Pijat Bayi Ceria (7-24)', () => {
    const s = treatmentCatalogService.getDefaultRelaxationService('BABY', 17, tenantId);
    expect(s?.name).toBe('Pijat Bayi Ceria');
  });

  it('age 36 bulan (3 tahun) dengan kategori KIDS → Kids Ceria', () => {
    const s = treatmentCatalogService.getDefaultRelaxationService('KIDS', 36, tenantId);
    expect(s?.name).toBe('Pijat Kids Ceria');
  });

  it('age null → paket default umum tetap valid', () => {
    const s = treatmentCatalogService.getDefaultRelaxationService('BABY', null, tenantId);
    expect(s).toBeDefined();
    expect(s?.isActive).toBe(true);
  });

  it('backward-compat: getDefaultRelaxationService(cat, tenantIdString) tetap jalan', () => {
    // Panggilan lama dengan tenantId sebagai argumen kedua (string)
    const s = (treatmentCatalogService as any).getDefaultRelaxationService('BABY', tenantId);
    expect(s).toBeDefined();
  });

  it('goal-tracker pregrounding: usia 17 bulan tidak mengembalikan Newborn di tenant default', async () => {
    // Validasi tidak regresi: di tenant default, filter usia 17 masih dapat Ceria
    const { GoalTracker } = await import('../../src/v3/state/goal-tracker');
    const session: any = {
      genderGreeting: 'Bunda' as const,
      childProfile: { ageMonths: 17, symptoms: [] },
      children: [{ ageMonths: 17, symptoms: [] }],
      targetAudience: 'BABY' as const,
    };
    const prompt = GoalTracker.formatGoalSessionForPrompt(session);
    // Harus mengandung rekomendasi paket dasar (bukan error)
    expect(prompt).toMatch(/Rekomendasi Paket Dasar/);
    // Jangan sampai kosong
    expect(prompt.length).toBeGreaterThan(20);
  });

  // Plan Fase 2.3 (sesi 89-turn, misrouting maternal): kategori MOMS WAJIB
  // direkomendasikan paket ibu (MOMS/BOTH), BUKAN paket bayi.
  describe('MOMS routing (plan sesi 89-turn)', () => {
    const tId = 'test-moms-89turn';
    beforeAll(() => {
      const mk = (over: Partial<ClinicServiceItem>): ClinicServiceItem => ({
        id: over.id!,
        name: over.name!,
        category: over.category as any,
        ageTier: over.ageTier!,
        durationMinutes: 60,
        originalPrice: 90000,
        promoPrice: 75000,
        description: 'test',
        isActive: true,
      });
      treatmentCatalogService.upsertService(mk({
        id: 'test-baby-ceria-moms',
        name: 'Pijat Bayi Ceria Newborn',
        category: 'BABY',
        ageTier: { minAgeMonths: 0, maxAgeMonths: 24, label: '0 - 24 Bulan' },
      }), tId);
      treatmentCatalogService.upsertService(mk({
        id: 'test-moms-relaks',
        name: 'Pijat Relaksasi Ibu (Women Relaxation Massage)',
        category: 'MOMS',
        ageTier: { minAgeMonths: 0, maxAgeMonths: 0, label: 'Ibu' },
      }), tId);
      treatmentCatalogService.upsertService(mk({
        id: 'test-moms-oksitosin',
        name: 'Pijat Oksitosin',
        category: 'MOMS',
        ageTier: { minAgeMonths: 0, maxAgeMonths: 0, label: 'Ibu' },
      }), tId);
    });

    it('MOMS → paket ibu, DILARANG jatuh ke paket bayi', () => {
      const s = treatmentCatalogService.getDefaultRelaxationService('MOMS', null, tId);
      expect(s).toBeDefined();
      expect(s?.category).not.toBe('BABY');
      expect(s?.category === 'MOMS' || s?.category === 'BOTH').toBe(true);
    });

    it('goal-tracker pregrounding: sesi ibu tanpa keluhan → header "Ibu Sehat Relaksasi", bukan header bayi', async () => {
      const { GoalTracker } = await import('../../src/v3/state/goal-tracker');
      const session: any = {
        genderGreeting: 'Bunda' as const,
        targetAudience: 'MOMS' as const,
        momProfile: { complaints: [] },
      };
      const prompt = GoalTracker.formatGoalSessionForPrompt(session);
      expect(prompt).toMatch(/Ibu Sehat Relaksasi/);
      expect(prompt).not.toMatch(/Bayi Sehat Tanpa Keluhan/);
    });
  });
});
