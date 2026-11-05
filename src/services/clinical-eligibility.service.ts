/**
 * Fase 2 — Mesin Kelayakan Klinis Terpusat.
 *
 * Satu seam kebenaran untuk pertanyaan "layanan ini boleh untuk siapa",
 * dipakai oleh tool katalog DAN gerbang booking. Semua keputusan bersandar
 * pada STATE terstruktur (momStage, gestationalWeeks, feverContraindication)
 * dan metadata DB (`eligible_life_stages`, `min/max_gestational_weeks`,
 * `contraindications`, `requires_screening`) — bukan hafalan kalimat.
 *
 * Murni: tidak melakukan I/O. Resolver katalog di-inject untuk bundle.
 */
import type { ClinicServiceItem } from './treatment-catalog.service';
import { inferEligibleLifeStages, inferClinicalFamily, treatmentCatalogService } from './treatment-catalog.service';
import { canonicalMomStage } from './maternal-state.service';

export type EligibilityStatus = 'ELIGIBLE' | 'BLOCKED' | 'NEEDS_SCREENING';
export type EligibilityCode =
  | 'STAGE_MISMATCH'
  | 'STAGE_UNKNOWN'
  | 'GESTATIONAL_MIN'
  | 'GESTATIONAL_MAX'
  | 'CONTRAINDICATION'
  | 'SCREENING_REQUIRED';

export interface ClinicalContext {
  momStage?: string | null;
  gestationalWeeks?: number | null;
  childAgeMonths?: number | null;
  feverContraindication?: boolean;
  screeningConfirmed?: boolean;
}

export interface EligibilityDecision {
  status: EligibilityStatus;
  code?: EligibilityCode;
  reason?: string;
}

export type ServiceResolver = (id: string) => ClinicServiceItem | undefined;

const PREGNANCY_STAGES = ['PREGNANT', 'PREGNANT_ATERM'];

/** Ambang legacy = fallback bila kolom DB kosong (paritas perilaku). */
function effectiveMinWeeks(service: ClinicServiceItem, family: string | null): number | null {
  if (service.minGestationalWeeks != null) return service.minGestationalWeeks;
  if (family === 'INDUCTION') return 37;
  if (family === 'PERINEUM') return 34;
  return null;
}

function resolveStages(service: ClinicServiceItem): string[] {
  return (service.eligibleLifeStages && service.eligibleLifeStages.length > 0)
    ? service.eligibleLifeStages
    : inferEligibleLifeStages(service as any);
}

export function evaluateServiceEligibility(
  service: ClinicServiceItem,
  ctx: ClinicalContext,
  resolveService?: ServiceResolver
): EligibilityDecision {
  // Bundle diwarisi kelayakan anak-anaknya (mis. bundle Perineum+Yoga).
  if (Array.isArray(service.bundleItemIds) && service.bundleItemIds.length > 0 && resolveService) {
    for (const childId of service.bundleItemIds) {
      const child = resolveService(childId);
      if (!child) continue;
      const childDecision = evaluateServiceEligibility(child, ctx, resolveService);
      if (childDecision.status === 'BLOCKED') {
        return { ...childDecision, reason: `${child.name}: ${childDecision.reason || ''}`.trim() };
      }
    }
    return { status: 'ELIGIBLE' };
  }

  // 1. Kontraindikasi deterministik dari fakta klinis terstruktur.
  if (ctx.feverContraindication && (service.contraindications || []).includes('FEVER')) {
    return { status: 'BLOCKED', code: 'CONTRAINDICATION', reason: 'suhu tubuh terindikasi demam' };
  }

  const stages = resolveStages(service);
  const isMomsService = service.category === 'MOMS'
    || service.category === 'BOTH'
    || stages.some((s) => PREGNANCY_STAGES.includes(s) || s === 'POSTPARTUM' || s === 'LACTATING');

  if (isMomsService) {
    const family = service.clinicalFamily ?? inferClinicalFamily(service as any);
    // Usia kehamilan eksplisit = bukti state PREGNANT (tanpa menebak).
    const effectiveStage = ctx.momStage
      ?? (typeof ctx.gestationalWeeks === 'number' && Number.isFinite(ctx.gestationalWeeks) ? 'PREGNANT' : null);
    const momStage = canonicalMomStage(effectiveStage);
    const isStageSpecific = !stages.includes('GENERAL') && !stages.includes('UNKNOWN');

    if (momStage === 'PREGNANT') {
      const isLactationOrPostpartum = stages.some((s) => s === 'POSTPARTUM' || s === 'LACTATING')
        && !stages.includes('PREGNANT') && !stages.includes('PREGNANT_ATERM');
      if (isLactationOrPostpartum) {
        return { status: 'BLOCKED', code: 'STAGE_MISMATCH', reason: 'layanan untuk fase nifas/menyusui' };
      }
      const minWeeks = effectiveMinWeeks(service, family);
      const maxWeeks = service.maxGestationalWeeks ?? null;
      const weeks = typeof ctx.gestationalWeeks === 'number' && Number.isFinite(ctx.gestationalWeeks)
        ? ctx.gestationalWeeks
        : null;
      if (minWeeks != null && (weeks == null || weeks < minWeeks)) {
        return { status: 'BLOCKED', code: 'GESTATIONAL_MIN', reason: `minimal ${minWeeks} minggu kehamilan` };
      }
      if (maxWeeks != null && weeks != null && weeks > maxWeeks) {
        return { status: 'BLOCKED', code: 'GESTATIONAL_MAX', reason: `maksimal ${maxWeeks} minggu kehamilan` };
      }
    } else if (momStage === 'POSTPARTUM' || momStage === 'LACTATING') {
      const isPregnantOnly = stages.some((s) => PREGNANCY_STAGES.includes(s))
        && !stages.includes('POSTPARTUM') && !stages.includes('LACTATING');
      if (isPregnantOnly) {
        return { status: 'BLOCKED', code: 'STAGE_MISMATCH', reason: 'layanan untuk fase kehamilan' };
      }
    } else if (momStage === 'GENERAL') {
      if (isStageSpecific) {
        return { status: 'BLOCKED', code: 'STAGE_MISMATCH', reason: 'perlu konfirmasi tahap hidup' };
      }
    } else if (isStageSpecific) {
      // Tidak ada state / UNKNOWN: DILARANG menebak layanan stage-spesifik.
      return { status: 'BLOCKED', code: 'STAGE_UNKNOWN', reason: 'tahap hidup belum diketahui' };
    }
  }

  if (service.requiresScreening && !ctx.screeningConfirmed) {
    return { status: 'NEEDS_SCREENING', code: 'SCREENING_REQUIRED', reason: 'wajib skrining bidan' };
  }

  return { status: 'ELIGIBLE' };
}

/**
 * Gerbang booking: evaluasi semua layanan yang akan disimpan.
 * Satu layanan terblokir = seluruh reservasi ditolak (atomik).
 */
export function evaluateReservationEligibility(params: {
  tenantId: string;
  treatmentNames: string[];
  context: ClinicalContext;
}): { allowed: boolean; code?: EligibilityCode; message?: string } {
  const resolver: ServiceResolver = (id) => {
    try {
      return treatmentCatalogService.getServiceById(id, params.tenantId) as ClinicServiceItem | undefined;
    } catch {
      return undefined;
    }
  };

  const decisions = (params.treatmentNames || [])
    .map((name) => treatmentCatalogService.matchCatalogItem(name, params.tenantId))
    .filter(Boolean)
    .map((matched) => {
      const service = matched as ClinicServiceItem;
      return { service, decision: evaluateServiceEligibility(service, params.context, resolver) };
    });

  // STAGE_UNKNOWN bukan bukti kontraindikasi — pada jalur booking, state yang
  // belum diketahui tidak boleh menolak layanan Moms yang sah (katalog sudah
  // menanyakan tahap hidup saat konsultasi). Yang DIBLOKIR hanya konflik nyata.
  const blocked = decisions.find(
    (x) => x.decision.status === 'BLOCKED' && x.decision.code !== 'STAGE_UNKNOWN'
  );
  if (blocked) {
    return {
      allowed: false,
      code: blocked.decision.code,
      message: `Untuk keamanan Bunda, layanan *${blocked.service.name}* belum dapat dijadwalkan saat ini (${blocked.decision.reason}). Bidan kami akan membantu menentukan layanan yang sesuai.`,
    };
  }

  const screening = decisions.find((x) => x.decision.status === 'NEEDS_SCREENING');
  if (screening) {
    return {
      allowed: false,
      code: 'SCREENING_REQUIRED',
      message: `Sebelum menjadwalkan *${screening.service.name}*, Bidan kami perlu melakukan skrining singkat terlebih dahulu ya Bunda.`,
    };
  }

  return { allowed: true };
}
