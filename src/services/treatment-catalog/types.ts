import { parseAgeTextToMonths } from '../../utils/age-calculator';
import { canonicalMomStage } from '../maternal-state.service';
import { checkMedicalKeywords } from '../../config/medical-keywords';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import {
  CHILD_CATEGORY_AGE_THRESHOLD_MONTHS,
  PatientProfileExtractor,
} from '../../v3/state/patient-extractor';

export type TreatmentCategoryType = 'BABY' | 'KIDS' | 'MOMS' | 'BOTH' | 'BUNDLE' | 'ADD_ON';

export type ClinicServiceType = 'STANDARD' | 'BUNDLE' | 'ADD_ON';

/** Audiens kanonis layanan (plan regresi Fase 2, data-driven). */
export type ServiceAudience = 'MOMS' | 'BABY' | 'KIDS' | 'BOTH' | 'GENERAL';

/**
 * Resolusi audiens layanan dari METADATA katalog (plan regresi Fase 2).
 * - Kategori langsung (MOMS/BABY/KIDS/BOTH/ADD_ON) dipetakan 1:1.
 * - BUNDLE diderivasi dari KOMPOSISI komponennya (bundleItemIds → kategori
 *   komponen via lookup): semua-MOMS → MOMS, semua-BABY → BABY, dst.;
 *   campuran ibu+anak → BOTH. Tanpa lookup → GENERAL (netral, aman).
 * DILARANG menghafal substring ID/nama ('moms'/'laktasi'/'kelahiran') —
 * layanan baru (ID apa pun) otomatis terklasifikasi dari komposisinya.
 */
export function resolveServiceAudience(
  service: { category?: string | null; bundleItemIds?: string[] | null },
  lookup?: (id: string) => { category?: string | null } | undefined,
): ServiceAudience {
  const cat = (service?.category || '').toUpperCase();
  if (cat === 'MOMS') return 'MOMS';
  if (cat === 'BABY') return 'BABY';
  if (cat === 'KIDS') return 'KIDS';
  if (cat === 'BOTH') return 'BOTH';
  if (cat === 'ADD_ON' || cat === 'ADDON') return 'GENERAL';
  if (cat === 'BUNDLE' || ((service?.bundleItemIds || []).length > 0)) {
    const compCats = new Set<string>();
    if (lookup) {
      for (const cid of service?.bundleItemIds || []) {
        const c = lookup((cid || '').toLowerCase());
        const cc = (c?.category || '').toUpperCase();
        if (cc === 'MOMS' || cc === 'BABY' || cc === 'KIDS' || cc === 'BOTH') compCats.add(cc);
      }
    }
    if (compCats.size === 0) return 'GENERAL';
    const hasMoms = compCats.has('MOMS') || compCats.has('BOTH');
    const hasBaby = compCats.has('BABY') || compCats.has('BOTH');
    const hasKids = compCats.has('KIDS') || compCats.has('BOTH');
    if (hasMoms && !hasBaby && !hasKids) return 'MOMS';
    if (hasBaby && !hasMoms && !hasKids) return 'BABY';
    if (hasKids && !hasMoms && !hasBaby) return 'KIDS';
    return 'BOTH';
  }
  return 'GENERAL';
}

export interface AgeTier {
  minAgeMonths: number;        // Batas minimal usia (dalam bulan), misal 0
  maxAgeMonths: number | null; // Batas maksimal usia (dalam bulan), null jika tidak ada batas (misal > 24 bulan atau dewasa)
  label: string;               // Label deskriptif kelompok usia (misal: "0 - 6 Bulan", "> 24 Bulan", "Ibu Hamil / Nifas")
}

export interface ClinicServiceItem {
  id: string;                  // Identifier unik treatment, misal: "baby-massage-0-6"
  name: string;                // Nama layanan/treatment
  category: TreatmentCategoryType;
  serviceType?: ClinicServiceType; // STANDARD | BUNDLE | ADD_ON
  bundleItemIds?: string[];    // Daftar ID layanan eksisting yang digabungkan (minimal 2 untuk bundle)
  isAddon?: boolean;           // Menandakan bahwa layanan ini add-on (tidak bisa berdiri sendiri)
  ageTier: AgeTier;
  durationMinutes: number;     // Durasi pengerjaan treatment (dalam menit)
  originalPrice: number;       // Harga Asli (Rp)
  promoPrice: number;          // Harga Promo / Khusus (Rp)
  description: string;         // Deskripsi detail & manfaat treatment
  isActive: boolean;           // Status keaktifan layanan
  totalSessions?: number;      // null = single visit, 14 = paket 14 sesi
  sessionScheduleType?: string; // "manual" = admin atur jam per sesi
  eligibleLifeStages?: string[]; // PREGNANT, PREGNANT_ATERM, POSTPARTUM, LACTATING, GENERAL, BABY, KIDS
  contraindications?: string[];
  requiresScreening?: boolean;
  /** Fase 2: ambang gestasional (minggu). Null = tidak dibatasi. */
  minGestationalWeeks?: number | null;
  maxGestationalWeeks?: number | null;
  /** Fase 2: keluarga klinis data-driven (INDUCTION/PERINEUM/PRENATAL/...). */
  clinicalFamily?: string | null;
}

/**
 * Inferensi kelayakan tahap hidup maternal/anak (Fase 4 data-driven fallback).
 * Dipakai saat metadata DB/JSON belum terisi penuh agar tidak hardcode di prompt.
 */
export function inferEligibleLifeStages(item: {
  category?: string | null;
  name?: string;
  description?: string;
  ageTier?: { label?: string };
}): string[] {
  const cat = (item.category || '').toUpperCase();
  const text = `${item.name || ''} ${item.description || ''} ${item.ageTier?.label || ''}`.toLowerCase();

  if (cat === 'BABY') return ['BABY'];
  if (cat === 'KIDS') return ['KIDS'];
  if (cat === 'BOTH') return ['BABY', 'KIDS', 'MOMS'];
  if (cat === 'MOMS') {
    if (text.includes('induksi')) {
      return ['PREGNANT_ATERM'];
    }
    if (text.includes('prenatal') || text.includes('pregnant') || text.includes('perineum') || text.includes('hamil') || text.includes('trimester')) {
      return ['PREGNANT'];
    }
    if (text.includes('laktasi') || text.includes('breast care') || text.includes('oksitosin')) {
      return ['POSTPARTUM', 'LACTATING'];
    }
    if (text.includes('postpartum') || text.includes('nifas') || text.includes('pasca persalinan')) {
      return ['POSTPARTUM'];
    }
    return ['GENERAL', 'PREGNANT', 'POSTPARTUM', 'LACTATING'];
  }
  return ['GENERAL'];
}

/**
 * Fase 2 — inferensi keluarga klinis dari data katalog.
 * HANYA fallback saat kolom DB `clinical_family` kosong (data lama).
 * Prioritas kata kunci: induksi > perineum > prenatal > laktasi > postpartum.
 */
export function inferClinicalFamily(item: {
  id?: string;
  name?: string;
  description?: string;
  eligibleLifeStages?: string[];
}): string | null {
  const text = `${item.id || ''} ${item.name || ''} ${item.description || ''}`.toLowerCase();
  if (text.includes('induksi')) return 'INDUCTION';
  if (text.includes('perineum')) return 'PERINEUM';
  if (text.includes('prenatal') || text.includes('pregnant') || text.includes('hamil')) return 'PRENATAL';
  if (text.includes('laktasi') || text.includes('oksitosin') || text.includes('breast care')) return 'LACTATION';
  if (text.includes('postpartum') || text.includes('nifas')) return 'POSTPARTUM';
  if ((item.eligibleLifeStages || []).includes('GENERAL')) return 'GENERAL';
  return null;
}
