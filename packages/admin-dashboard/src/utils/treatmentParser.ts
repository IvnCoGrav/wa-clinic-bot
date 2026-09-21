import { ClinicServiceItem } from '../components/calendar/types';

export interface SelectedTreatmentItem {
  instanceId: string;
  serviceId: string;
  name: string;
  category: 'BABY' | 'MOMS' | 'BOTH' | 'KIDS' | 'BUNDLE' | 'ADD_ON';
  durationMinutes: number;
  price: number;
  isAddon?: boolean;
  assignedChildIndex?: number;
}

export const DEFAULT_CLINIC_SERVICES_FALLBACK: ClinicServiceItem[] = [
  { id: 'baby-massage-ceria', name: 'Pijat Bayi Ceria (Rileksasi)', category: 'BABY', durationMinutes: 40, originalPrice: 80000, promoPrice: 60000, description: 'Pijat relaksasi bayi', isActive: true },
  { id: 'baby-massage-pulih-ceria', name: 'Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)', category: 'BABY', durationMinutes: 40, originalPrice: 90000, promoPrice: 70000, description: 'Pijat terapi bapil', isActive: true },
  { id: 'baby-massage-lahap-juara', name: 'Pijat Lahap Juara (Nafsu Makan)', category: 'BABY', durationMinutes: 40, originalPrice: 95000, promoPrice: 75000, description: 'Pijat nafsu makan', isActive: true },
  { id: 'baby-cukur', name: 'Cukur Rambut Bayi', category: 'BABY', durationMinutes: 15, originalPrice: 30000, promoPrice: 25000, description: 'Cukur rambut bayi', isActive: true },
  { id: 'baby-tindik', name: 'Tindik Telinga Bayi', category: 'BABY', durationMinutes: 15, originalPrice: 70000, promoPrice: 50000, description: 'Tindik telinga bayi', isActive: true },
  { id: 'baby-paket-selapan', name: 'Paket Selapan (Cukur + Pijat Ceria)', category: 'BUNDLE', durationMinutes: 55, originalPrice: 85000, promoPrice: 80000, description: 'Paket selapan', isActive: true },
  { id: 'baby-cukur-pijat-terapi', name: 'Cukur + Pijat Terapi', category: 'BUNDLE', durationMinutes: 55, originalPrice: 95000, promoPrice: 85000, description: 'Cukur + Pijat Terapi', isActive: true },
  { id: 'moms-prenatal-massage', name: 'Prenatal Massage (Pijat Hamil)', category: 'MOMS', durationMinutes: 60, originalPrice: 125000, promoPrice: 100000, description: 'Pijat hamil', isActive: true },
  { id: 'moms-prenatal-yoga', name: 'Prenatal Yoga', category: 'MOMS', durationMinutes: 45, originalPrice: 70000, promoPrice: 50000, description: 'Yoga hamil', isActive: true },
  { id: 'moms-laktasi-oksitosin', name: 'Paket Laktasi (Breast + Oksitosin)', category: 'MOMS', durationMinutes: 75, originalPrice: 100000, promoPrice: 80000, description: 'Paket laktasi', isActive: true },
  { id: 'moms-laktasi-breast', name: 'Paket Laktasi (Breast Massage)', category: 'MOMS', durationMinutes: 40, originalPrice: 70000, promoPrice: 50000, description: 'Breast massage', isActive: true },
  { id: 'moms-oksitosin-fullbody', name: 'Oksitosin Massage Fullbody', category: 'MOMS', durationMinutes: 60, originalPrice: 130000, promoPrice: 105000, description: 'Oksitosin fullbody', isActive: true },
  { id: 'moms-oksitosin-non-fullbody', name: 'Oksitosin Massage Non-Fullbody', category: 'MOMS', durationMinutes: 40, originalPrice: 70000, promoPrice: 50000, description: 'Oksitosin non-fullbody', isActive: true },
  { id: 'moms-perineum', name: 'Perineum Massage', category: 'MOMS', durationMinutes: 30, originalPrice: 60000, promoPrice: 45000, description: 'Perineum massage', isActive: true },
  { id: 'moms-laktasi-oksitosin-full', name: 'Breast + Oksitoksin Fullbody Massage', category: 'MOMS', durationMinutes: 75, originalPrice: 200000, promoPrice: 155000, description: 'Breast + Oksitosin Fullbody', isActive: true },
  { id: 'moms-bundle-pra-kelahiran', name: 'Paket Pra Kelahiran Lengkap (Perineum + Yoga + Breast)', category: 'MOMS', durationMinutes: 105, originalPrice: 185000, promoPrice: 135000, description: 'Paket pra kelahiran lengkap', isActive: true },
  { id: 'kids-massage-2-4', name: 'Pijat Kids Ceria (Usia 2-4 th)', category: 'KIDS', durationMinutes: 45, originalPrice: 90000, promoPrice: 70000, description: 'Pijat kids 2-4 tahun', isActive: true },
  { id: 'kids-massage-4-6', name: 'Pijat Kids Ceria (Usia >4-6 th)', category: 'KIDS', durationMinutes: 45, originalPrice: 100000, promoPrice: 80000, description: 'Pijat kids 4-6 tahun', isActive: true },
  { id: 'kids-massage-6-8', name: 'Pijat Kids Ceria (Usia >6-8 th)', category: 'KIDS', durationMinutes: 45, originalPrice: 110000, promoPrice: 90000, description: 'Pijat kids 6-8 tahun', isActive: true },
  { id: 'addon-moksa', name: 'Sinar Moksa (Add-on)', category: 'ADD_ON', durationMinutes: 15, originalPrice: 15000, promoPrice: 10000, isAddon: true, description: 'Sinar moksa', isActive: true },
  { id: 'addon-nebulizer', name: 'Nebulizer (Terapi Uap Add-on)', category: 'ADD_ON', durationMinutes: 20, originalPrice: 50000, promoPrice: 35000, isAddon: true, description: 'Nebulizer add-on', isActive: true },
  { id: 'addon-nebulizer-obat', name: 'Nebulizer + Obat (Terapi Uap Lengkap)', category: 'ADD_ON', durationMinutes: 20, originalPrice: 85000, promoPrice: 65000, isAddon: true, description: 'Nebulizer lengkap', isActive: true },
  { id: 'baby-newborn-treatment', name: 'Newborn Treatment', category: 'BABY', durationMinutes: 120, originalPrice: 700000, promoPrice: 500000, description: 'Newborn treatment', isActive: true },
];

export function isAddonService(t: { name: string; category?: string; serviceType?: string; isAddon?: boolean }): boolean {
  if (t.isAddon === true || t.category === 'ADD_ON' || t.serviceType === 'ADD_ON') {
    return true;
  }
  if (t.isAddon === false || (t.category && t.category !== 'ADD_ON')) {
    return false;
  }
  const name = (t.name || '').toLowerCase();
  return (
    name.includes('(add-on)') ||
    name.includes('(addon)') ||
    name.includes('[addon]') ||
    name.startsWith('add-on') ||
    name.startsWith('addon') ||
    name.includes('moksa') ||
    name.includes('moxa') ||
    name.includes('nebulizer')
  );
}

const stripParenthetical = (name: string | null | undefined): string =>
  (name || '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

const ALIAS_MAP: Record<string, string> = {
  rileksasi: 'relaksasi',
  rileks: 'relaksasi',
  pijet: 'pijat',
  moxa: 'moksa',
  kidz: 'kids',
  baby: 'bayi',
  oksitoksin: 'oksitosin',
  oksifull: 'oksitosin',
  therapist: 'terapi',
};

const STOP_WORDS = new Set(['addon', 'add', 'on', 'dan', 'the', 'paket', 'spa', 'treatment', 'layanan']);

function getMeaningfulTokens(name: string): Set<string> {
  const cleaned = stripParenthetical(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return new Set(
    cleaned
      .split(' ')
      .map((w) => ALIAS_MAP[w] || w)
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w))
  );
}

const normKey = (s: string) =>
  s.toLowerCase().replace(/\(add-?on\)|\[add-?on\]/g, '').replace(/[^a-z0-9]/g, '').replace(/addon/g, '');

interface MatchCandidate {
  service: ClinicServiceItem;
  isNamedSubset: boolean;
  surplus: number;
  bundlePenalty: number;
}

function matchCatalogItem(itemText: string, cat: ClinicServiceItem[]): ClinicServiceItem | undefined {
  const itemTokens = getMeaningfulTokens(itemText);
  if (itemTokens.size < 2) return undefined;

  const normItemKey = normKey(itemText);
  let best: MatchCandidate | undefined;

  for (const s of cat) {
    const svcTokens = getMeaningfulTokens(s.name);
    if (svcTokens.size < itemTokens.size) continue;

    let containsAll = true;
    for (const t of itemTokens) {
      if (!svcTokens.has(t)) {
        containsAll = false;
        break;
      }
    }
    if (!containsAll) continue;

    const normSvcBase = normKey(stripParenthetical(s.name));
    const isNamedSubset = normItemKey.length >= 4 && normSvcBase.includes(normItemKey);
    const surplus = svcTokens.size - itemTokens.size;
    const bundlePenalty = s.category === 'BUNDLE' ? 1 : 0;

    const candidate: MatchCandidate = { service: s, isNamedSubset, surplus, bundlePenalty };

    if (!best) {
      best = candidate;
    } else {
      if (candidate.isNamedSubset !== best.isNamedSubset) {
        if (candidate.isNamedSubset) best = candidate;
      } else if (candidate.surplus !== best.surplus) {
        if (candidate.surplus < best.surplus) best = candidate;
      } else if (candidate.bundlePenalty !== best.bundlePenalty) {
        if (candidate.bundlePenalty < best.bundlePenalty) best = candidate;
      }
    }
  }

  return best?.service;
}

function findBySubstringFallback(itemText: string, cat: ClinicServiceItem[]): ClinicServiceItem | undefined {
  const targetBase = normKey(stripParenthetical(itemText));
  if (targetBase.length < 5) return undefined;

  return cat.find((s) => {
    if ((s.category as any) === 'BUNDLE') return false;
    const sBase = normKey(stripParenthetical(s.name));
    return sBase.length >= 5 && (targetBase.includes(sBase) || sBase.includes(targetBase));
  });
}

export function parseTreatmentsFromDetail(
  detail: string | null | undefined,
  catalog: ClinicServiceItem[] = [],
  initialPurchaseValue?: number | null,
  babiesForChildMatch?: Array<{ name: string }> | null
): SelectedTreatmentItem[] {
  if (!detail) return [];
  const effectiveCatalog = catalog && catalog.length > 0 ? catalog : DEFAULT_CLINIC_SERVICES_FALLBACK;
  const cleanSummary = detail
    .replace(/\[\s*Total\s+.*?\]/gi, '')
    .trim();

  const parts = cleanSummary.split(/\s*[\+,]\s*/).map((p) => p.trim()).filter(Boolean);
  const items: SelectedTreatmentItem[] = [];

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const durationMatch = p.match(/\[\s*(\d+)\s*m.*?\s*\]/i);
    const explicitDuration = durationMatch ? parseInt(durationMatch[1], 10) : undefined;

    const childNameInParenMatch = p.match(/\(\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*\)\s*$/);
    const childNameInParen = childNameInParenMatch ? childNameInParenMatch[1].trim() : null;

    let cleanName = p.replace(/\[.*?\]/g, '').trim();
    cleanName = cleanName.replace(/\(\s*(?:Anak\s*#?\d+|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*\)$/i, '').trim();

    if (!cleanName) continue;

    if (/^\[?hold\]?\s*slot\s*ditawarkan|slot\s*ditawarkan/i.test(cleanName)) {
      continue;
    }

    let matchedService = matchCatalogItem(cleanName, effectiveCatalog);
    if (!matchedService) {
      matchedService = findBySubstringFallback(cleanName, effectiveCatalog);
    }
    if (!matchedService) {
      matchedService = matchCatalogItem(cleanName, DEFAULT_CLINIC_SERVICES_FALLBACK);
    }
    if (!matchedService) {
      matchedService = findBySubstringFallback(cleanName, DEFAULT_CLINIC_SERVICES_FALLBACK);
    }

    let price = matchedService ? (matchedService.promoPrice || matchedService.originalPrice || 0) : 0;

    if (parts.length === 1 && typeof initialPurchaseValue === 'number' && initialPurchaseValue > 0) {
      price = initialPurchaseValue;
    } else if (price === 0 && typeof initialPurchaseValue === 'number' && initialPurchaseValue > 0 && i === 0) {
      price = initialPurchaseValue;
    }

    const category = matchedService ? matchedService.category : 'BABY';
    const isAddon = matchedService ? (matchedService.isAddon || isAddonService(matchedService)) : isAddonService({ name: cleanName });

    let assignedChildIndex = 0;
    if (childNameInParen && babiesForChildMatch && babiesForChildMatch.length > 0) {
      const idx = babiesForChildMatch.findIndex((b) => b.name.trim().toLowerCase() === childNameInParen.toLowerCase());
      if (idx >= 0) assignedChildIndex = idx;
    }

    items.push({
      instanceId: `edit-treatment-${i + 1}-${Math.random().toString(36).substring(2, 7)}`,
      serviceId: matchedService?.id || `custom-${i + 1}`,
      name: matchedService?.name || cleanName,
      category: (category as any) || 'BABY',
      durationMinutes: explicitDuration ?? matchedService?.durationMinutes ?? (isAddon ? 15 : 60),
      price: price || 0,
      isAddon: isAddon,
      assignedChildIndex,
    });
  }

  return items;
}