import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { parseAgeTextToMonths } from '../../utils/age-calculator';
import { canonicalMomStage } from '../maternal-state.service';
import { checkMedicalKeywords } from '../../config/medical-keywords';
import {
  CHILD_CATEGORY_AGE_THRESHOLD_MONTHS,
  PatientProfileExtractor,
} from '../../v3/state/patient-extractor';
import {
  ClinicServiceItem,
  TreatmentCategoryType,
  ServiceAudience,
  resolveServiceAudience,
  inferEligibleLifeStages,
} from './types';
import { getTenantCatalog } from './catalog-store';

export let getAllServicesDelegate: ((onlyActive?: boolean, tenantId?: string) => ClinicServiceItem[]) | null = null;

export function setGetAllServicesDelegate(fn: ((onlyActive?: boolean, tenantId?: string) => ClinicServiceItem[]) | null) {
  getAllServicesDelegate = fn;
}

export function getAllServicesFromStore(onlyActive = true, tenantId = DEFAULT_TENANT_ID): ClinicServiceItem[] {
  if (getAllServicesDelegate) {
    return getAllServicesDelegate(onlyActive, tenantId);
  }
  const catalog = getTenantCatalog(tenantId);
  const list = Array.from(catalog.values());
  return onlyActive ? list.filter((s) => s.isActive) : list;
}

export function getServicesByAgeFromStore(ageMonths: number, onlyActive = true, tenantId = DEFAULT_TENANT_ID): ClinicServiceItem[] {
  return getAllServicesFromStore(onlyActive, tenantId).filter((s) => {
    const min = s.ageTier.minAgeMonths;
    const max = s.ageTier.maxAgeMonths;
    if (ageMonths < min) return false;
    if (max !== null && ageMonths > max) return false;
    return true;
  });
}

/**
 * Filter layanan secara ketat berdasarkan target audiens (BABY, KIDS, MOMS) dan rentang usia.
 */
export function filterServicesByAudience(
  services: ClinicServiceItem[],
  context: {
    ageMonths?: number | null;
    audienceIntent?: 'BABY' | 'KIDS' | 'MOMS' | 'BOTH' | 'GENERAL';
    isMaternalKeyword?: boolean;
  }
): ClinicServiceItem[] {
  const { ageMonths, audienceIntent, isMaternalKeyword } = context;
  const byId = new Map((services || []).map((s) => [(s?.id || '').toLowerCase(), s]));
  const audienceOf = (s: ClinicServiceItem): ServiceAudience =>
    resolveServiceAudience(s, (id) => byId.get(id));
  const isMomBundle = (s: ClinicServiceItem): boolean => audienceOf(s) === 'MOMS';

  if (audienceIntent === 'MOMS' || isMaternalKeyword) {
    return services.filter(
      (s) => s.category === 'MOMS' || s.category === 'BOTH' || (s.category === 'BUNDLE' && isMomBundle(s))
    );
  }

  if (ageMonths != null && ageMonths > 0) {
    return services.filter((s) => {
      if (s.category === 'MOMS') return false;
      if (s.category === 'BUNDLE' && isMomBundle(s)) return false;

      const minAge = s.ageTier?.minAgeMonths ?? 0;
      const maxAge = s.ageTier?.maxAgeMonths ?? null;

      if (ageMonths < minAge) return false;
      if (maxAge !== null && ageMonths > maxAge) return false;

      if (ageMonths >= CHILD_CATEGORY_AGE_THRESHOLD_MONTHS) {
        return s.category === 'KIDS' || s.category === 'BOTH' || (s.category === 'BUNDLE' && !isMomBundle(s)) || (s.category === 'BABY' && (maxAge === null || maxAge >= ageMonths));
      } else {
        return s.category === 'BABY' || s.category === 'BOTH' || (s.category === 'BUNDLE' && !isMomBundle(s));
      }
    });
  }

  if (audienceIntent === 'KIDS') {
    return services.filter((s) => s.category === 'KIDS' || s.category === 'BOTH' || (s.category === 'BUNDLE' && !isMomBundle(s)));
  }

  if (audienceIntent === 'BABY') {
    return services.filter(
      (s) => s.category === 'BABY' || s.category === 'BOTH' || s.category === 'ADD_ON' || (s.category === 'BUNDLE' && !isMomBundle(s))
    );
  }

  if (audienceIntent === 'BOTH') {
    return services.filter(
      (s) => s.category === 'BABY' || s.category === 'KIDS' || s.category === 'MOMS' || s.category === 'BOTH' || s.category === 'BUNDLE' || s.category === 'ADD_ON'
    );
  }

  return services;
}

/**
 * Rekomendasi dinamis berdasarkan gejala/keluhan
 */
export function recommendServiceBySymptoms(
  symptoms: string[],
  ageMonths?: number | null,
  category?: TreatmentCategoryType,
  tenantId: string = DEFAULT_TENANT_ID,
  momStage?: string | null,
  gestationalWeeks?: number | null,
  matcherFallback?: (q: string, tid?: string) => ClinicServiceItem | undefined
): (ClinicServiceItem & { askStage?: boolean; blockedByStage?: boolean }) | undefined {
  const rawText = (symptoms || []).join(' ').toLowerCase();
  const tokens = rawText
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
  if (tokens.length === 0) return undefined;
  let pool = getAllServicesFromStore(true, tenantId);
  if (category) {
    if (category === 'BOTH') {
      pool = pool.filter((s) => s.category === 'BABY' || s.category === 'KIDS' || s.category === 'MOMS' || s.category === 'BUNDLE' || s.category === 'BOTH');
    } else {
      pool = pool.filter((s) => s.category === category || s.category === 'BOTH');
    }
  }
  if (ageMonths != null && ageMonths > 0) {
    pool = filterServicesByAudience(pool, { ageMonths });
  }
  pool = pool.filter((s) => s.isActive);
  if (pool.length === 0) return undefined;

  const effectiveMomStage = canonicalMomStage(momStage)
    ?? (momStage || (category === 'MOMS' ? 'UNKNOWN' : undefined));
  const stageSpecificBlocked: ClinicServiceItem[] = [];

  if (effectiveMomStage) {
    const activeFiltered: ClinicServiceItem[] = [];
    for (const item of pool) {
      if (item.category !== 'MOMS' && resolveServiceAudience(item as any) !== 'MOMS') {
        activeFiltered.push(item);
        continue;
      }

      const stages = (item.eligibleLifeStages && item.eligibleLifeStages.length > 0)
        ? item.eligibleLifeStages
        : inferEligibleLifeStages(item);

      const isStageSpecific = !stages.includes('GENERAL') && !stages.includes('UNKNOWN');

      if (effectiveMomStage === 'UNKNOWN') {
        if (isStageSpecific) {
          stageSpecificBlocked.push(item);
        } else {
          activeFiltered.push(item);
        }
      } else if (effectiveMomStage === 'PREGNANT') {
        const isLactationOrPostpartum = stages.some((st) => st === 'POSTPARTUM' || st === 'LACTATING') && !stages.includes('PREGNANT');
        const isInduksi = stages.includes('PREGNANT_ATERM');
        const isPreterm = typeof gestationalWeeks === 'number' && gestationalWeeks < 37;

        if (isLactationOrPostpartum || (isInduksi && isPreterm)) {
          stageSpecificBlocked.push(item);
        } else {
          activeFiltered.push(item);
        }
      } else if (effectiveMomStage === 'POSTPARTUM' || effectiveMomStage === 'LACTATING') {
        const isPregnantOnly = stages.some((st) => st === 'PREGNANT' || st === 'PREGNANT_ATERM') && !stages.includes('POSTPARTUM') && !stages.includes('LACTATING');
        if (isPregnantOnly) {
          stageSpecificBlocked.push(item);
        } else {
          activeFiltered.push(item);
        }
      } else {
        activeFiltered.push(item);
      }
    }
    pool = activeFiltered;
  }

  const byId = new Map(pool.map((s) => [(s?.id || '').toLowerCase(), s]));
  const audienceOf = (s: ClinicServiceItem): ServiceAudience =>
    resolveServiceAudience(s, (id) => byId.get(id));

  let best: ClinicServiceItem | undefined;
  let bestScore = 0;

  for (const s of pool) {
    let score = 0;
    const nameLower = s.name.toLowerCase();
    const descLower = s.description.toLowerCase();
    for (const t of tokens) {
      if (nameLower.includes(t)) score += 4;
      if (descLower.includes(t)) score += 2;
    }
    if (rawText.includes('batuk') || rawText.includes('pilek') || rawText.includes('flu') || rawText.includes('grok')) {
      if (nameLower.includes('pulih')) score += 5;
    }
    if (rawText.includes('nafsu') || rawText.includes('gtm') || rawText.includes('makan')) {
      if (nameLower.includes('lahap')) score += 5;
    }
    if (rawText.includes('laktasi') || rawText.includes('asi') || rawText.includes('oksitosin')) {
      if (s.category === 'MOMS' || audienceOf(s) === 'MOMS') score += 5;
    }
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }

  if (effectiveMomStage === 'UNKNOWN' && stageSpecificBlocked.length > 0) {
    let blockedBest: ClinicServiceItem | undefined;
    let blockedBestScore = 0;
    for (const s of stageSpecificBlocked) {
      let score = 0;
      const nameLower = s.name.toLowerCase();
      const descLower = s.description.toLowerCase();
      for (const t of tokens) {
        if (nameLower.includes(t)) score += 4;
        if (descLower.includes(t)) score += 2;
      }
      if (score > blockedBestScore) {
        blockedBestScore = score;
        blockedBest = s;
      }
    }

    if (blockedBest && blockedBestScore > bestScore) {
      return {
        ...blockedBest,
        askStage: true,
        blockedByStage: true,
      };
    }
  }

  return bestScore > 0 ? best : undefined;
}

/** Paket relaksasi umum untuk bayi sehat (tanpa keluhan) */
export function getDefaultRelaxationService(
  category?: TreatmentCategoryType,
  ageMonthsOrTenantId?: number | string | null,
  tenantId: string = DEFAULT_TENANT_ID
): ClinicServiceItem | undefined {
  let ageMonths: number | null = null;
  let resolvedTenantId = tenantId;
  if (typeof ageMonthsOrTenantId === 'string') {
    resolvedTenantId = ageMonthsOrTenantId;
  } else if (typeof ageMonthsOrTenantId === 'number' && Number.isFinite(ageMonthsOrTenantId)) {
    ageMonths = ageMonthsOrTenantId;
  }
  if (typeof tenantId === 'string' && tenantId !== DEFAULT_TENANT_ID && typeof ageMonthsOrTenantId === 'number') {
    resolvedTenantId = tenantId;
  }
  let pool = getAllServicesFromStore(true, resolvedTenantId).filter((s) => s.isActive);
  if (category === 'MOMS') {
    pool = pool.filter((s) => s.category === 'MOMS' || s.category === 'BOTH');
  } else if (category === 'KIDS') {
    pool = pool.filter((s) => s.category === 'KIDS' || s.category === 'BOTH');
  } else if (category === 'BABY') {
    pool = pool.filter((s) => s.category === 'BABY' || s.category === 'BOTH');
  } else if (category === 'BOTH') {
    pool = pool.filter((s) => s.category === 'BABY' || s.category === 'KIDS' || s.category === 'MOMS' || s.category === 'BUNDLE' || s.category === 'BOTH');
  }
  if (ageMonths != null && Number.isFinite(ageMonths)) {
    const filtered = pool.filter((s) => {
      const min = s.ageTier?.minAgeMonths ?? 0;
      const max = s.ageTier?.maxAgeMonths;
      if (ageMonths! < min) return false;
      if (max != null && ageMonths! > max) return false;
      return true;
    });
    if (filtered.length > 0) pool = filtered;
  }
  return pool.find((s) => s.name.toLowerCase().includes('relaks') && !s.name.toLowerCase().includes('pulih'))
    || pool.find((s) => s.name.toLowerCase().includes('prenatal massage'))
    || pool.find((s) => s.name.toLowerCase().includes('ceria') && !s.name.toLowerCase().includes('pulih'))
    || pool[0];
}

/**
 * Cari treatment yang relevan dengan pertanyaan customer dan kembalikan array item terstruktur.
 */
export function searchCatalogItems(userText: string, tenantId: string = DEFAULT_TENANT_ID): ClinicServiceItem[] {
  const rawQ = userText.toLowerCase();
  const q = rawQ
    .replace(/\b(?:maksud\s*(?:saya|ku|e|kami|sy)|bukan(?:\s+yang\s+itu)?[,\s]+(?:maksud(?:ku|saya)?\s+)?)\s*(?:yang\s+)?/i, '')
    .trim() || rawQ;
  const allServices = getAllServicesFromStore(true, tenantId);

  const ageMonths = parseAgeTextToMonths(userText);
  const isMaternal = /\b(hamil|bumil|prenatal|pregnant|pregnancy|nifas|laktasi|menyusui|trimester|oksitosin|induksi|postpartum|payudara|breast)\b/i.test(userText);
  const isKidKeyword = /\b(anak|kids|balita|paud|tk|bocah)\b/i.test(userText);
  const isBabyKeyword = /\b(bayi|baby|newborn|selapan|infant)\b/i.test(userText);

  let audienceIntent: 'BABY' | 'KIDS' | 'MOMS' | 'GENERAL' = 'GENERAL';
  if (isMaternal) {
    audienceIntent = 'MOMS';
  } else if (ageMonths !== null) {
    audienceIntent = PatientProfileExtractor.resolveChildAgeCategory(ageMonths) ?? 'GENERAL';
  } else if (isKidKeyword) {
    audienceIntent = 'KIDS';
  } else if (isBabyKeyword) {
    audienceIntent = 'BABY';
  }

  const services = filterServicesByAudience(allServices, {
    ageMonths,
    audienceIntent,
    isMaternalKeyword: isMaternal,
  });

  const exactMatches: ClinicServiceItem[] = [];
  const partialMatches: ClinicServiceItem[] = [];

  for (const s of services) {
    if (!s.isActive) continue;
    const cleanName = s.name.toLowerCase().replace(/\s*\([^)]*\)/g, '').trim();
    const unbrandedName = cleanName.replace(/^kala\s+(?:baby|kids|mom|bundle|terapi)\s*[–-]\s*/i, '').trim();
    const fullName = s.name.toLowerCase();
    const parenMatch = s.name.match(/\(([^)]+)\)/);
    const parenAlias = parenMatch ? parenMatch[1].toLowerCase().trim() : '';
    const nameParts = cleanName.split(/\s+/);
    const unbrandedParts = unbrandedName.split(/\s+/);

    if (
      q.includes(cleanName) ||
      fullName.includes(q.trim()) ||
      (q.length >= 4 && cleanName.includes(q.trim())) ||
      (unbrandedName.length >= 4 && (q.includes(unbrandedName) || unbrandedName.includes(q.trim()))) ||
      (parenAlias.length >= 4 && (q.includes(parenAlias) || parenAlias.includes(q.trim()))) ||
      (q.includes('newborn') && cleanName.includes('selapan'))
    ) {
      exactMatches.push(s);
    } else if (nameParts.length >= 2 || unbrandedParts.length >= 2) {
      const twoWordPhrase = nameParts.length >= 2 ? `${nameParts[0]} ${nameParts[1]}` : '';
      const unbrandedTwoWord = unbrandedParts.length >= 2 ? `${unbrandedParts[0]} ${unbrandedParts[1]}` : '';
      if ((twoWordPhrase.length >= 5 && q.includes(twoWordPhrase)) || (unbrandedTwoWord.length >= 5 && q.includes(unbrandedTwoWord))) {
        partialMatches.push(s);
      }
    }
  }

  if (exactMatches.length > 0) {
    return exactMatches.sort((a, b) => b.name.length - a.name.length);
  }

  if (partialMatches.length > 0) {
    return partialMatches;
  }

  const hasMedical = checkMedicalKeywords(userText).isMedical;
  if (ageMonths !== null && !hasMedical) {
    const isMassage = /\b(pijat|mijat|pijet|urut|massage)\b/i.test(q);
    const isSpa = /\b(spa|bubble|mandi|berendam)\b/i.test(q);
    const ageServices = getServicesByAgeFromStore(ageMonths, true, tenantId);

    if (isMassage && !isSpa) {
      let massageServices = ageServices.filter((s) => s.name.toLowerCase().includes('pijat') || s.name.toLowerCase().includes('massage'));
      if (ageMonths >= CHILD_CATEGORY_AGE_THRESHOLD_MONTHS) {
        massageServices.sort((a, b) => (b.category === 'KIDS' ? 1 : 0) - (a.category === 'KIDS' ? 1 : 0));
      } else {
        massageServices.sort((a, b) => (b.category === 'BABY' ? 1 : 0) - (a.category === 'BABY' ? 1 : 0));
      }
      if (massageServices.length > 0) {
        return [massageServices[0]];
      }
    } else if (isSpa) {
      const spaServices = ageServices.filter((s) => s.name.toLowerCase().includes('spa') || s.name.toLowerCase().includes('bubble'));
      if (spaServices.length > 0) {
        return [spaServices[0]];
      }
    } else if (ageServices.length > 0) {
      return [ageServices[0]];
    }
  }

  const SYNONYMS: Record<string, string> = {
    'bumil': 'hamil',
    'bapil': 'batuk pilek',
    'asi': 'laktasi',
    'menyusui': 'laktasi',
    'hamil': 'hamil',
    'prenatal': 'hamil',
    'pregnant': 'hamil',
    'pregnancy': 'hamil',
    'oksitosin': 'oksitosin',
    'nifas': 'pasca melahirkan',
    'bayi': 'bayi',
    'kids': 'anak',
    'balita': 'anak',
    'kembung': 'kembung',
    'kolik': 'kembung',
    'newborn': 'selapan newborn',
    'selapan': 'selapan newborn',
  };

  const stopwords = new Set([
    'ini', 'itu', 'sini', 'situ', 'mana', 'gimana', 'siapa',
    'yang', 'apa', 'berapa', 'bung', 'bund', 'bunda', 'bun', 'ya', 'dong', 'kak', 'min', 'mbak', 'mas',
    'saya', 'untuk', 'buat', 'bikin', 'bagi', 'guna', 'dengan', 'dan', 'atau', 'dari', 'ke', 'di', 'ada', 'bisa', 'mau', 'ingin', 'bagaimana',
    'kenapa', 'apakah', 'treatment', 'perawatan', 'tentang', 'info', 'informasi', 'detail', 'tolong',
    'ciri', 'cirinya', 'khasiat', 'manfaat', 'fungsi', 'fungsinya', 'sih', 'nih', 'lho', 'kan',
    'juga', 'saja', 'aja', 'semua', 'daftar', 'list', 'please',
    'pijat',
    'kala',
  ]);
  
  const rawKeywords = q
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/gi, ''))
    .filter((w) => w.length >= 3 && !stopwords.has(w));

  const expandedKeywords = new Set<string>();
  for (const kw of rawKeywords) {
    expandedKeywords.add(kw);
    const synonym = SYNONYMS[kw];
    if (synonym) {
      for (const part of synonym.split(/\s+/)) {
        if (part.length >= 3) {
          expandedKeywords.add(part);
        }
      }
    }
  }

  const keywords = Array.from(expandedKeywords);
  if (keywords.length === 0) return [];

  const df = new Map<string, number>();
  for (const k of keywords) {
    const count = services.filter((s) =>
      s.name.toLowerCase().includes(k) || s.description.toLowerCase().includes(k)
    ).length;
    df.set(k, count > 0 ? count : 1);
  }

  const scored = services
    .map((s) => {
      const nameLower = s.name.toLowerCase();
      const descLower = s.description.toLowerCase();
      const ageLower = s.ageTier.label.toLowerCase();
      let rawScore = 0;
      for (const k of keywords) {
        if (nameLower.includes(k)) rawScore += 3;
        if (descLower.includes(k)) rawScore += 1;
        if (ageLower.includes(k)) rawScore += 0.5;
      }
      let idfScore = 0;
      for (const k of keywords) {
        if (nameLower.includes(k)) idfScore += 3 / (df.get(k) || 1);
        if (descLower.includes(k)) idfScore += 1 / (df.get(k) || 1);
        if (ageLower.includes(k)) idfScore += 0.5 / (df.get(k) || 1);
      }
      return { s, score: idfScore > 0 ? idfScore : rawScore };
    })
    .filter((c) => c.score > 0);

  if (scored.length === 0) return [];

  const maxScore = Math.max(...scored.map((c) => c.score));
  return scored
    .filter((c) => c.score >= maxScore * 0.85)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((c) => c.s);
}

/**
 * Format string teks hasil pencarian katalog untuk respon
 */
export function searchCatalog(
  userText: string,
  includePrice = false,
  tenantId: string = DEFAULT_TENANT_ID,
  matcherFallback?: (q: string, tid?: string) => ClinicServiceItem | undefined
): string {
  const q = userText.toLowerCase();
  const services = getAllServicesFromStore(true, tenantId);

  const strippedQ = q.replace(/\b(ini|itu|sini|situ|mana|gimana|apa|ya|bund|bunda|bun|berapa|dong|kak|min|mbak|mas)\b/gi, '').replace(/[^a-z0-9\s]/gi, '').trim();

  let exactNameMatch = services.find((s) => {
    const cleanName = s.name.toLowerCase().replace(/\s*\([^)]*\)/g, '').trim();
    const unbrandedName = cleanName.replace(/^kala\s+(?:baby|kids|mom|bundle|terapi)\s*[–-]\s*/i, '').trim();
    return (
      (cleanName.length >= 4 && q.includes(cleanName)) ||
      (strippedQ.length >= 4 && cleanName.includes(strippedQ)) ||
      (unbrandedName.length >= 4 && q.includes(unbrandedName)) ||
      (strippedQ.length >= 4 && unbrandedName.includes(strippedQ))
    );
  });

  if (!exactNameMatch && matcherFallback) {
    exactNameMatch = matcherFallback(strippedQ || q, tenantId);
  }

  if (exactNameMatch) {
    const priceLine = includePrice
      ? `  Harga Normal: Rp${exactNameMatch.originalPrice.toLocaleString('id-ID')} | Promo: Rp${exactNameMatch.promoPrice.toLocaleString('id-ID')}\n`
      : '';
    return `• *${exactNameMatch.name}*\n  Usia: ${exactNameMatch.ageTier.label}\n  Durasi: ${exactNameMatch.durationMinutes} menit\n${priceLine}  Deskripsi: ${exactNameMatch.description}`;
  }

  const stopwords = new Set([
    'ini', 'itu', 'sini', 'situ', 'mana', 'gimana', 'siapa',
    'yang', 'apa', 'berapa', 'bung', 'bund', 'bunda', 'bun', 'ya', 'dong', 'kak', 'min', 'mbak', 'mas',
    'saya', 'untuk', 'buat', 'bikin', 'bagi', 'guna', 'dengan', 'dan', 'atau', 'dari', 'ke', 'di', 'ada', 'bisa', 'mau', 'ingin', 'bagaimana',
    'kenapa', 'apakah', 'treatment', 'perawatan', 'tentang', 'info', 'informasi', 'detail', 'tolong',
    'ciri', 'cirinya', 'khasiat', 'manfaat', 'fungsi', 'fungsinya', 'sih', 'nih', 'lho', 'kan',
    'juga', 'saja', 'aja', 'semua', 'daftar', 'list', 'please',
    'pijat',
    'kala',
    'hari', 'bulan', 'bln', 'tahun', 'thn', 'minggu', 'mgg', 'jam', 'menit', 'usia', 'umur',
  ]);
  const keywords = q
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/gi, ''))
    .filter((w) => w.length >= 3 && !stopwords.has(w));

  if (keywords.length === 0) {
    return '';
  }

  const df = new Map<string, number>();
  for (const k of keywords) {
    const count = services.filter((s) =>
      s.name.toLowerCase().includes(k) || s.description.toLowerCase().includes(k)
    ).length;
    df.set(k, count > 0 ? count : 1);
  }

  const scored = services
    .map((s) => {
      const nameLower = s.name.toLowerCase();
      const descLower = s.description.toLowerCase();
      const ageLower = s.ageTier.label.toLowerCase();
      let rawScore = 0;
      for (const k of keywords) {
        if (nameLower.includes(k)) rawScore += 3;
        if (descLower.includes(k)) rawScore += 1;
        if (ageLower.includes(k)) rawScore += 0.5;
      }
      let idfScore = 0;
      for (const k of keywords) {
        if (nameLower.includes(k)) idfScore += 3 / (df.get(k) || 1);
        if (descLower.includes(k)) idfScore += 1 / (df.get(k) || 1);
        if (ageLower.includes(k)) idfScore += 0.5 / (df.get(k) || 1);
      }
      return { s, score: idfScore > 0 ? idfScore : rawScore };
    })
    .filter((c) => c.score > 0);

  if (scored.length === 0) {
    return '';
  }

  const maxScore = Math.max(...scored.map((c) => c.score));
  const top = scored
    .filter((c) => c.score >= maxScore * 0.85)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);

  return top
    .map(({ s }) => {
      const priceLine = includePrice
        ? `  Harga Normal: Rp${s.originalPrice.toLocaleString('id-ID')} | Promo: Rp${s.promoPrice.toLocaleString('id-ID')}\n`
        : '';
      return `• *${s.name}*\n  Usia: ${s.ageTier.label}\n  Durasi: ${s.durationMinutes} menit\n${priceLine}  Deskripsi: ${s.description}`;
    })
    .join('\n\n');
}

/**
 * Ringkasan durasi
 */
export function getServiceDurationSummary(tenantId: string = DEFAULT_TENANT_ID): string {
  const services = getAllServicesFromStore(true, tenantId).filter((s) => s.isActive && !s.isAddon);
  return services
    .map((s) => `  * ${s.name} (${s.ageTier.label}): ~${s.durationMinutes} menit`)
    .join('\n');
}

/**
 * Cari layanan berdasarkan nominal harga
 */
export function findServicesByPrice(
  targetPrice: number,
  tolerance = 0,
  tenantId: string = DEFAULT_TENANT_ID
): ClinicServiceItem[] {
  if (!Number.isFinite(targetPrice) || targetPrice <= 0) return [];
  const tol = Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : 0;
  return getAllServicesFromStore(true, tenantId).filter((s) => {
    const promoHit = typeof s.promoPrice === 'number'
      && Math.abs(s.promoPrice - targetPrice) <= tol;
    const normalHit = typeof s.originalPrice === 'number'
      && Math.abs(s.originalPrice - targetPrice) <= tol;
    return promoHit || normalHit;
  });
}

/**
 * Mencocokkan keluhan gejala customer ke layanan
 */
export function matchServicesBySymptoms(symptoms: string[], tenantId: string = DEFAULT_TENANT_ID): ClinicServiceItem[] {
  if (!symptoms || symptoms.length === 0) return [];
  const all = getAllServicesFromStore(true, tenantId).filter((s) => s.isActive && !s.isAddon);
  const symLower = symptoms.map((s) => s.toLowerCase());
  const byIdSym = new Map(all.map((s) => [(s?.id || '').toLowerCase(), s]));
  const audienceOfSym = (s: ClinicServiceItem): ServiceAudience =>
    resolveServiceAudience(s, (id) => byIdSym.get(id));

  const scored = all.map((service) => {
    let score = 0;
    const text = `${service.name} ${service.description}`.toLowerCase();
    for (const sym of symLower) {
      if (text.includes(sym)) score += 2;
      if (sym.includes('batuk') || sym.includes('pilek') || sym.includes('flu') || sym.includes('grok')) {
        if (service.name.toLowerCase().includes('pulih')) score += 3;
      }
      if (sym.includes('nafsu') || sym.includes('gtm') || sym.includes('makan')) {
        if (service.name.toLowerCase().includes('lahap')) score += 3;
      }
      if (sym.includes('laktasi') || sym.includes('asi') || sym.includes('oksitosin')) {
        if (service.category === 'MOMS' || audienceOfSym(service) === 'MOMS') score += 3;
      }
    }
    return { service, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.service);
}
