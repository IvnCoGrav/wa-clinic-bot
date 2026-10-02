import { ClinicServiceItem } from '../components/calendar/types';
import clinicServicesFallback from '../data/clinicServicesFallback.json';

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

/**
 * #128-FaseA (A2) — Fallback katalog DASHBOARD (offline-safe).
 *
 * Sumber: `src/data/clinicServicesFallback.json`, di-generate dari SATU sumber
 * kebenaran backend (`DEFAULT_CLINIC_SERVICES` via `npm run catalog:seed`).
 * DILARANG menyunting array manual di sini lagi (dulu drift: 11 layanan aktif
 * backend hilang). Guard: `tests/unit/catalog-seed-drift.test.ts`.
 */
export const DEFAULT_CLINIC_SERVICES_FALLBACK: ClinicServiceItem[] =
  clinicServicesFallback as ClinicServiceItem[];

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

    let price = matchedService ? (matchedService.promoPrice ?? (matchedService as any).price ?? matchedService.originalPrice ?? 0) : 0;

    // initialPurchaseValue hanya fallback bila katalog belum ready / tidak cocok (anti-race harga 0),
    // bukan menimpa promo katalog yang valid.
    const catalogIsLive = catalog && catalog.length > 0;
    if (!matchedService || !catalogIsLive) {
      if (typeof initialPurchaseValue === 'number' && initialPurchaseValue > 0 && (i === 0 || parts.length === 1)) {
        price = initialPurchaseValue;
      }
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