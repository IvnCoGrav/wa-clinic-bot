/**
 * Fase 1 — Deep module state maternal.
 *
 * Satu-satunya tempat:
 *  - normalisasi tahap ibu ke token kanonis (chat memakai `BREASTFEEDING`,
 *    data memakai `LACTATING`),
 *  - ekstraksi usia kehamilan dari `raw_text` (label-first, anti tertukar
 *    dengan usia anak),
 *  - perhitungan HPL.
 *
 * Murni & deterministik (zero I/O) agar mudah diuji dan dipakai lintas lapisan
 * (bot, webhook, admin, follow-up) tanpa duplikasi logika.
 */
import { extractGestationalWeeks } from '../utils/age-calculator';

export type CanonicalMomStage = 'PREGNANT' | 'POSTPARTUM' | 'LACTATING' | 'GENERAL';

/**
 * Kanoniskan token tahap ibu lintas lapisan.
 * `BREASTFEEDING` adalah kontrak tool LLM (jangan diubah di schema prompt);
 * data internal WAJIB memakai `LACTATING` agar filter kelayakan katalog konsisten.
 */
export function canonicalMomStage(value?: string | null): CanonicalMomStage | null {
  const v = String(value || '').toUpperCase().trim();
  if (!v) return null;
  if (v === 'LACTATING' || v === 'BREASTFEEDING' || v === 'MENYUSUI') return 'LACTATING';
  if (v === 'PREGNANT' || v === 'HAMIL') return 'PREGNANT';
  if (v === 'POSTPARTUM' || v === 'NIFAS' || v === 'PASCA_SALIN') return 'POSTPARTUM';
  if (v === 'GENERAL' || v === 'UMUM') return 'GENERAL';
  return null;
}

/**
 * Ekstraksi label-first: angka HARUS menempel pada label kehamilan/UK.
 * Ini menutup bug lama "hamil 38 minggu" terbaca sebagai usia anak 9 bulan.
 */
export function extractGestationalWeeksFromRawText(raw: string | null | undefined): number | null {
  const text = String(raw || '');
  const labelled = text.match(/(?:usia\s+kehamilan|\buk\b|kehamilan)\s*[:\-=]?\s*(\d{1,2})\s*(?:minggu|mgg|mg|week|w)?/i);
  if (labelled) {
    const w = Number(labelled[1]);
    if (Number.isFinite(w) && w >= 1 && w <= 45) return w;
  }
  return extractGestationalWeeks(text);
}

/** HPL = anchor + (40 minggu - usia kehamilan) x 7 hari. Null bila input invalid. */
export function computeHplDate(anchorAt: Date, gestationalWeeks: number): Date | null {
  if (!(anchorAt instanceof Date) || isNaN(anchorAt.getTime())) return null;
  if (!Number.isFinite(gestationalWeeks) || gestationalWeeks < 1 || gestationalWeeks > 45) return null;
  const remainingWeeks = Math.max(0, 40 - gestationalWeeks);
  return new Date(anchorAt.getTime() + remainingWeeks * 7 * 24 * 60 * 60 * 1000);
}

export interface MaternalState {
  gestationalWeeks: number | null;
  momStage: CanonicalMomStage | null;
  hplDate: Date | null;
}

export const EMPTY_MATERNAL_STATE: MaternalState = {
  gestationalWeeks: null,
  momStage: null,
  hplDate: null,
};

/**
 * Resolusi state maternal dari data eksplisit (state sesi/parser) dengan
 * fallback deterministik ke teks reservasi.
 */
export function resolveMaternalState(params: {
  rawText?: string | null;
  treatmentDetail?: string | null;
  treatmentCategory?: string | null;
  gestationalWeeks?: number | null;
  momStage?: string | null;
  anchorAt?: Date | null;
}): MaternalState {
  const cat = String(params.treatmentCategory || '').toUpperCase();
  const hasExplicit =
    (typeof params.gestationalWeeks === 'number' && Number.isFinite(params.gestationalWeeks))
    || Boolean(params.momStage);
  const isMomContext = cat === 'MOMS' || cat === 'BOTH';

  if (!isMomContext && !hasExplicit) return { ...EMPTY_MATERNAL_STATE };

  const weeks = typeof params.gestationalWeeks === 'number' && Number.isFinite(params.gestationalWeeks)
    ? params.gestationalWeeks
    : extractGestationalWeeksFromRawText(`${params.rawText || ''} ${params.treatmentDetail || ''}`);

  let stage = canonicalMomStage(params.momStage);
  if (!stage) {
    const text = `${params.rawText || ''} ${params.treatmentDetail || ''}`.toLowerCase();
    if (weeks != null) stage = 'PREGNANT';
    else if (/nifas|pasca\s*salin|postpartum/.test(text)) stage = 'POSTPARTUM';
    else if (/menyusui|laktasi|oksitosin|breast/.test(text)) stage = 'LACTATING';
    // Tanpa bukti eksplisit, tahap DIBIARKAN null — DILARANG menebak GENERAL.
  }

  const anchor = params.anchorAt instanceof Date && !isNaN(params.anchorAt.getTime())
    ? params.anchorAt
    : new Date();
  const hplDate = weeks != null ? computeHplDate(anchor, weeks) : null;

  return { gestationalWeeks: weeks ?? null, momStage: stage, hplDate };
}
