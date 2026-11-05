/**
 * Fase 2 — Mesin kelayakan klinis terpusat.
 *
 * Kontrak:
 *  1. Hamil < ambang induksi/perineum DIBLOKIR (bukan sekadar diurutkan).
 *  2. Hamil cukup bulan → ELIGIBLE.
 *  3. Nifas/menyusui tidak ditawari layanan kehamilan.
 *  4. Kontraindikasi demam & requires_screening ditegakkan dari state.
 *  5. Data DB kosong → fallback ambang legacy (paritas perilaku).
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateServiceEligibility,
  evaluateReservationEligibility,
} from '../../src/services/clinical-eligibility.service';
import type { ClinicServiceItem } from '../../src/services/treatment-catalog.service';

function svc(overrides: Partial<ClinicServiceItem>): ClinicServiceItem {
  return {
    id: 'test-service',
    name: 'Test Service',
    category: 'MOMS',
    ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Moms' },
    durationMinutes: 60,
    originalPrice: 100000,
    promoPrice: 80000,
    description: '',
    isActive: true,
    ...overrides,
  };
}

const induksi = svc({
  id: 'moms-induksi-massage',
  name: 'Kala Mom – Induksi Massage',
  eligibleLifeStages: ['PREGNANT_ATERM'],
  clinicalFamily: 'INDUCTION',
  minGestationalWeeks: 37,
});

const perineum = svc({
  id: 'moms-perineum-massage',
  name: 'Kala Mom – Perineum Massage',
  eligibleLifeStages: ['PREGNANT'],
  clinicalFamily: 'PERINEUM',
  minGestationalWeeks: 34,
});

const prenatal = svc({
  id: 'moms-prenatal-massage',
  name: 'Kala Mom – Pregnant Massage',
  eligibleLifeStages: ['PREGNANT'],
  clinicalFamily: 'PRENATAL',
});

const laktasi = svc({
  id: 'moms-paket-laktasi',
  name: 'Kala Mom – Laktasi & Breast Care',
  eligibleLifeStages: ['POSTPARTUM', 'LACTATING'],
  clinicalFamily: 'LACTATION',
});

describe('Fase 2 — evaluateServiceEligibility', () => {
  it('hamil 30 minggu + Induksi → BLOCKED/GESTATIONAL_MIN', () => {
    const d = evaluateServiceEligibility(induksi, { momStage: 'PREGNANT', gestationalWeeks: 30 });
    expect(d.status).toBe('BLOCKED');
    expect(d.code).toBe('GESTATIONAL_MIN');
  });

  it('hamil 38 minggu + Induksi → ELIGIBLE', () => {
    const d = evaluateServiceEligibility(induksi, { momStage: 'PREGNANT', gestationalWeeks: 38 });
    expect(d.status).toBe('ELIGIBLE');
  });

  it('hamil tanpa usia + Induksi → BLOCKED (konservatif)', () => {
    const d = evaluateServiceEligibility(induksi, { momStage: 'PREGNANT' });
    expect(d.status).toBe('BLOCKED');
  });

  it('hamil 30 minggu + Perineum → BLOCKED', () => {
    const d = evaluateServiceEligibility(perineum, { momStage: 'PREGNANT', gestationalWeeks: 30 });
    expect(d.status).toBe('BLOCKED');
  });

  it('hamil 35 minggu + Perineum → ELIGIBLE', () => {
    const d = evaluateServiceEligibility(perineum, { momStage: 'PREGNANT', gestationalWeeks: 35 });
    expect(d.status).toBe('ELIGIBLE');
  });

  it('hamil 20 minggu + Pregnant Massage → ELIGIBLE', () => {
    const d = evaluateServiceEligibility(prenatal, { momStage: 'PREGNANT', gestationalWeeks: 20 });
    expect(d.status).toBe('ELIGIBLE');
  });

  it('nifas + Pregnant Massage → BLOCKED/STAGE_MISMATCH', () => {
    const d = evaluateServiceEligibility(prenatal, { momStage: 'POSTPARTUM' });
    expect(d.status).toBe('BLOCKED');
    expect(d.code).toBe('STAGE_MISMATCH');
  });

  it('menyusui (BREASTFEEDING) + Laktasi → ELIGIBLE', () => {
    const d = evaluateServiceEligibility(laktasi, { momStage: 'BREASTFEEDING' });
    expect(d.status).toBe('ELIGIBLE');
  });

  it('tahap belum diketahui + layanan stage-spesifik → BLOCKED/STAGE_UNKNOWN', () => {
    const d = evaluateServiceEligibility(prenatal, { momStage: 'UNKNOWN' });
    expect(d.status).toBe('BLOCKED');
    expect(d.code).toBe('STAGE_UNKNOWN');
  });

  it('kontraindikasi FEVER aktif → BLOCKED/CONTRAINDICATION', () => {
    const feverSvc = svc({ contraindications: ['FEVER'], eligibleLifeStages: ['GENERAL'] });
    const d = evaluateServiceEligibility(feverSvc, { feverContraindication: true });
    expect(d.status).toBe('BLOCKED');
    expect(d.code).toBe('CONTRAINDICATION');
  });

  it('requires_screening belum dikonfirmasi → NEEDS_SCREENING', () => {
    const screenSvc = svc({ requiresScreening: true, eligibleLifeStages: ['GENERAL'] });
    const d = evaluateServiceEligibility(screenSvc, {});
    expect(d.status).toBe('NEEDS_SCREENING');
    expect(d.code).toBe('SCREENING_REQUIRED');
  });

  it('requires_screening sudah dikonfirmasi → ELIGIBLE', () => {
    const screenSvc = svc({ requiresScreening: true, eligibleLifeStages: ['GENERAL'] });
    const d = evaluateServiceEligibility(screenSvc, { screeningConfirmed: true });
    expect(d.status).toBe('ELIGIBLE');
  });

  it('kolom DB kosong + nama Induksi → fallback ambang 37 minggu', () => {
    const legacyInduksi = svc({
      id: 'moms-induksi-massage',
      name: 'Kala Mom – Induksi Massage',
      eligibleLifeStages: ['PREGNANT_ATERM'],
    });
    const blocked = evaluateServiceEligibility(legacyInduksi, { momStage: 'PREGNANT', gestationalWeeks: 30 });
    const allowed = evaluateServiceEligibility(legacyInduksi, { momStage: 'PREGNANT', gestationalWeeks: 38 });
    expect(blocked.code).toBe('GESTATIONAL_MIN');
    expect(allowed.status).toBe('ELIGIBLE');
  });
});

describe('Fase 2 — evaluateReservationEligibility', () => {
  it('menolak reservasi induksi preterm dan menyebut nama layanan', () => {
    const out = evaluateReservationEligibility({
      tenantId: 'default-tenant',
      treatmentNames: ['Induksi Massage'],
      context: { momStage: 'PREGNANT', gestationalWeeks: 30 },
    });
    expect(out.allowed).toBe(false);
    expect(out.code).toBe('GESTATIONAL_MIN');
    expect(out.message).toContain('Induksi');
  });

  it('menerima reservasi Pregnant Massage untuk hamil 20 minggu', () => {
    const out = evaluateReservationEligibility({
      tenantId: 'default-tenant',
      treatmentNames: ['Prenatal Massage'],
      context: { momStage: 'PREGNANT', gestationalWeeks: 20 },
    });
    expect(out.allowed).toBe(true);
  });
});
