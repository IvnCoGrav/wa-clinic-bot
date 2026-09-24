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
  { id: 'baby-massage-ceria', name: 'Kala Baby – Pijat Ceria', category: 'BABY', durationMinutes: 40, originalPrice: 80000, promoPrice: 70000, description: 'Pijat relaksasi tubuh bayi', isActive: true },
  { id: 'baby-massage-ceria-newborn', name: 'Kala Baby – Pijat Ceria Newborn', category: 'BABY', durationMinutes: 40, originalPrice: 80000, promoPrice: 60000, description: 'Pijat relaksasi bayi newborn', isActive: true },
  { id: 'baby-massage-pulih-ceria', name: 'Kala Baby – Pijat Pulih Ceria', category: 'BABY', durationMinutes: 40, originalPrice: 100000, promoPrice: 75000, description: 'Terapi bapil dan kembung', isActive: true },
  { id: 'baby-massage-lahap-juara', name: 'Kala Baby – Pijat Lahap', category: 'BABY', durationMinutes: 40, originalPrice: 100000, promoPrice: 75000, description: 'Pijat nafsu makan', isActive: true },
  { id: 'baby-cukur', name: 'Kala Baby – Cukur Rambut', category: 'BABY', durationMinutes: 15, originalPrice: 35000, promoPrice: 25000, description: 'Cukur rambut bayi', isActive: true },
  { id: 'baby-mandi', name: 'Kala Baby – Memandikan Bayi', category: 'BABY', durationMinutes: 25, originalPrice: 40000, promoPrice: 30000, description: 'Memandikan bayi higienis', isActive: true },
  { id: 'baby-tindik', name: 'Kala Baby – Tindik Telinga', category: 'BABY', durationMinutes: 15, originalPrice: 70000, promoPrice: 50000, description: 'Tindik telinga bayi steril', isActive: true },
  { id: 'baby-paket-selapan', name: 'Kala Bundle Selapan – Cukur + Pijat Ceria', category: 'BUNDLE', durationMinutes: 55, originalPrice: 115000, promoPrice: 80000, description: 'Paket selapanan hemat', isActive: true },
  { id: 'baby-paket-selapan-terapi', name: 'Kala Bundle Selapan – Cukur + Pijat Pulih Ceria', category: 'BUNDLE', durationMinutes: 55, originalPrice: 135000, promoPrice: 90000, description: 'Paket selapanan terapi bapil', isActive: true },
  { id: 'moms-prenatal-massage', name: 'Kala Mom – Prenatal Massage', category: 'MOMS', durationMinutes: 60, originalPrice: 120000, promoPrice: 90000, description: 'Pijat ibu hamil aman', isActive: true },
  { id: 'moms-prenatal-yoga', name: 'Kala Mom – Prenatal Gentle Yoga', category: 'MOMS', durationMinutes: 30, originalPrice: 70000, promoPrice: 50000, description: 'Gentle yoga hamil', isActive: true },
  { id: 'moms-perineum-massage', name: 'Kala Mom – Perineum Massage', category: 'MOMS', durationMinutes: 30, originalPrice: 70000, promoPrice: 50000, description: 'Pijat elastisitas perineum', isActive: true },
  { id: 'moms-paket-laktasi', name: 'Kala Mom – Laktasi & Breast Care', category: 'MOMS', durationMinutes: 40, originalPrice: 110000, promoPrice: 85000, description: 'Perawatan laktasi dan payudara', isActive: true },
  { id: 'moms-oksitosin-fullbody', name: 'Kala Mom – Oksitosin Massage (Full Body)', category: 'MOMS', durationMinutes: 60, originalPrice: 140000, promoPrice: 105000, description: 'Oksitosin massage full body', isActive: true },
  { id: 'moms-oksitosin', name: 'Kala Mom – Oksitosin Massage (Punggung)', category: 'MOMS', durationMinutes: 40, originalPrice: 90000, promoPrice: 75000, description: 'Oksitosin massage punggung', isActive: true },
  { id: 'moms-postpartum-massage', name: 'Kala Mom – Postpartum Recovery Massage', category: 'MOMS', durationMinutes: 60, originalPrice: 130000, promoPrice: 100000, description: 'Pijat pemulihan pasca salin', isActive: true },
  { id: 'kids-massage-2-4th', name: 'Kala Kids – Pijat Ceria', category: 'KIDS', durationMinutes: 40, originalPrice: 85000, promoPrice: 75000, description: 'Pijat kids 2-4 tahun', isActive: true },
  { id: 'kids-massage-4-6th', name: 'Kala Kids – Pijat Ceria', category: 'KIDS', durationMinutes: 40, originalPrice: 90000, promoPrice: 80000, description: 'Pijat kids 4-6 tahun', isActive: true },
  { id: 'kids-massage-6-8th', name: 'Kala Kids – Pijat Ceria', category: 'KIDS', durationMinutes: 40, originalPrice: 100000, promoPrice: 90000, description: 'Pijat kids 6-8 tahun', isActive: true },
  { id: 'baby-massage-lahap-juara-gt2', name: 'Kala Kids – Pijat Lahap', category: 'KIDS', durationMinutes: 40, originalPrice: 110000, promoPrice: 80000, description: 'Pijat nafsu makan anak 2-8 tahun', isActive: true },
  { id: 'kids-pulih-2-4th', name: 'Kala Kids – Pijat Pulih Ceria', category: 'KIDS', durationMinutes: 40, originalPrice: 100000, promoPrice: 85000, description: 'Terapi bapil kids 2-4 tahun', isActive: true },
  { id: 'kids-pulih-4-6th', name: 'Kala Kids – Pijat Pulih Ceria', category: 'KIDS', durationMinutes: 40, originalPrice: 110000, promoPrice: 90000, description: 'Terapi bapil kids 4-6 tahun', isActive: true },
  { id: 'kids-pulih-6-8th', name: 'Kala Kids – Pijat Pulih Ceria', category: 'KIDS', durationMinutes: 40, originalPrice: 120000, promoPrice: 100000, description: 'Terapi bapil kids 6-8 tahun', isActive: true },
  { id: 'add-on-sinar-moksa', name: 'Kala Terapi – Infrared (Sinar Moksa)', category: 'ADD_ON', durationMinutes: 15, originalPrice: 25000, promoPrice: 15000, isAddon: true, description: 'Terapi sinar moksa', isActive: true },
  { id: 'add-on-nebulizer', name: 'Kala Terapi – Nebulizer Saline', category: 'ADD_ON', durationMinutes: 20, originalPrice: 45000, promoPrice: 35000, isAddon: true, description: 'Nebulizer saline steril', isActive: true },
  { id: 'add-on-nebulizer-obat', name: 'Kala Terapi – Nebulizer + Obat', category: 'ADD_ON', durationMinutes: 20, originalPrice: 60000, promoPrice: 50000, isAddon: true, description: 'Nebulizer lengkap obat', isActive: true },
  { id: 'NewBorn', name: 'Kala Newborn – Paket Pendampingan 14 Sesi', category: 'BABY', durationMinutes: 120, originalPrice: 700000, promoPrice: 600000, description: 'Newborn treatment 14 sesi', isActive: true },
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

function tokenizeRaw(text: string | null | undefined): Set<string> {
  const cleaned = (text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return new Set(
    cleaned
      .split(' ')
      .map((w) => ALIAS_MAP[w] || w)
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w))
  );
}

function getServiceCombinedTokens(s: ClinicServiceItem): Set<string> {
  const nameTokens = tokenizeRaw(s.name);
  const descTokens = tokenizeRaw(s.description || '');
  return new Set([...nameTokens, ...descTokens]);
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
    // Fase 3R: data-driven matching — gabungkan token nama + deskripsi klinis DB (clinical dominance)
    const svcTokens = getServiceCombinedTokens(s);
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
    const addonPenalty = (s as any).isAddon || (s.category as any) === 'ADD_ON' ? 1 : 0;

    const candidate: MatchCandidate = { service: s as any, isNamedSubset, surplus: surplus + addonPenalty * 100, bundlePenalty } as any;

    if (!best) {
      best = candidate;
    } else {
      // Prioritas: namedSubset > non-bundle > surplus terkecil (bundle dipenalti sebelum ukuran)
      if (candidate.isNamedSubset !== best.isNamedSubset) {
        if (candidate.isNamedSubset) best = candidate;
      } else if (candidate.bundlePenalty !== best.bundlePenalty) {
        if (candidate.bundlePenalty < best.bundlePenalty) best = candidate;
      } else if (candidate.surplus !== best.surplus) {
        if (candidate.surplus < best.surplus) best = candidate;
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
  // Fase 4R: bersihkan semua variasi tag total durasi sebelum split (anti-snowball)
  const cleanSummary = detail
    .replace(/\[\s*Total[^]]*\]/gi, '')
    .replace(/\[\s*\d+\s*m[^]]*\]/gi, '')
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