import { DEFAULT_TENANT_ID } from '../../config/tenant';
import {
  ClinicServiceItem,
  TreatmentCategoryType,
  ClinicServiceType,
  ServiceAudience,
  AgeTier,
  resolveServiceAudience,
  inferEligibleLifeStages,
  inferClinicalFamily,
} from './types';
import { DEFAULT_CLINIC_SERVICES } from './default-services';
import {
  SERVICES_FILE,
  tenantServiceCatalog,
  serviceCatalog,
  sanitizeCatalogItem,
  getTenantCatalog,
  loadServices,
  saveServices,
  loadServicesFromDb,
  saveServicesToDb,
} from './catalog-store';
import * as matching from './treatment-matching.service';

export * from './types';
export * from './default-services';
export * from './catalog-store';
export * from './treatment-matching.service';

export class TreatmentCatalogService {
  constructor() {
    matching.setGetAllServicesDelegate((onlyActive, tenantId) => this.getAllServices(onlyActive, tenantId));
  }

  public getAllServices(onlyActive = true, tenantId: string = DEFAULT_TENANT_ID): ClinicServiceItem[] {
    const catalog = getTenantCatalog(tenantId);
    const list = Array.from(catalog.values());
    if (onlyActive) {
      return list.filter((s) => s.isActive);
    }
    return list;
  }

  public getServiceById(id: string, tenantId: string = DEFAULT_TENANT_ID): ClinicServiceItem | undefined {
    return getTenantCatalog(tenantId).get(id);
  }

  public isAddonService(serviceOrId: ClinicServiceItem | string): boolean {
    const s = typeof serviceOrId === 'string' ? this.getServiceById(serviceOrId) : serviceOrId;
    if (!s) {
      if (typeof serviceOrId === 'string') {
        const idLower = serviceOrId.toLowerCase();
        if (idLower.startsWith('add-on') || idLower.startsWith('addon')) return true;
        const matched = this.matchCatalogItem(serviceOrId);
        return matched ? this.isAddonService(matched) : false;
      }
      return false;
    }
    if (s.isAddon === true || s.category === 'ADD_ON' || s.serviceType === 'ADD_ON') {
      return true;
    }
    const nameLower = (s.name || '').toLowerCase();
    const idLower = (s.id || '').toLowerCase();
    return (
      idLower.startsWith('add-on') ||
      idLower.startsWith('addon') ||
      nameLower.includes('(add-on)') ||
      nameLower.includes('(addon)') ||
      nameLower.includes('add-on') ||
      nameLower.includes('addon')
    );
  }

  public resolveCanonicalDuration(treatmentDetail: string | null | undefined, tenantId: string = DEFAULT_TENANT_ID): number {
    return this.resolveDurationBreakdown(treatmentDetail, tenantId).totalMinutes;
  }

  public resolveDurationBreakdown(
    treatmentDetail: string | null | undefined,
    tenantId: string = DEFAULT_TENANT_ID
  ): { totalMinutes: number; matchedItemIds: string[]; unmatchedItems: string[]; usedExplicitTag: boolean; confident: boolean } {
    const fallback = { totalMinutes: 60, matchedItemIds: [] as string[], unmatchedItems: [] as string[], usedExplicitTag: false, confident: false };
    if (!treatmentDetail || typeof treatmentDetail !== 'string' || !treatmentDetail.trim()) return fallback;
    const raw = treatmentDetail.trim();
    const text = this.stripStructuredMetadata(raw);

    const equalsMatch = text.match(/=\s*(\d+)\s*(?:m|menit|mins?)\b/i);
    if (equalsMatch && equalsMatch[1]) {
      const num = parseInt(equalsMatch[1], 10);
      if (!isNaN(num) && num > 0) return { totalMinutes: Math.min(480, num), matchedItemIds: [], unmatchedItems: [], usedExplicitTag: true, confident: true };
    }
    const totalBufferMatch = text.match(/Total\s*(\d+)\s*m?\s*\+\s*Buffer\s*(\d+)\s*m?/i);
    if (totalBufferMatch && totalBufferMatch[1] && totalBufferMatch[2]) {
      const pure = parseInt(totalBufferMatch[1], 10);
      const buf = parseInt(totalBufferMatch[2], 10);
      if (!isNaN(pure) && !isNaN(buf) && pure + buf > 0) return { totalMinutes: Math.min(480, pure + buf), matchedItemIds: [], unmatchedItems: [], usedExplicitTag: true, confident: true };
    }
    const totalMatch = text.match(/\[\s*Total\s*(\d+)\s*(?:m|menit|mins?)\b/i);
    if (totalMatch && totalMatch[1]) {
      const num = parseInt(totalMatch[1], 10);
      if (!isNaN(num) && num > 0) return { totalMinutes: Math.min(480, num), matchedItemIds: [], unmatchedItems: [], usedExplicitTag: true, confident: true };
    }
    const bracketMatches = text.match(/\[\s*(\d+)\s*(?:m|menit|mins?)\b/gi);
    if (bracketMatches && bracketMatches.length > 0) {
      let sum = 0;
      for (const b of bracketMatches) {
        const num = parseInt(b.replace(/\D/g, ''), 10);
        if (num > 0 && num <= 360) sum += num;
      }
      if (sum > 0) return { totalMinutes: Math.min(480, sum), matchedItemIds: [], unmatchedItems: [], usedExplicitTag: true, confident: true };
    }
    const minMatches = text.match(/(\d+)\s*(?:menit|mins?|m\b)/gi);
    if (minMatches && minMatches.length > 0) {
      let sum = 0;
      for (const m of minMatches) {
        const num = parseInt(m.replace(/\D/g, ''), 10);
        if (num > 0 && num <= 360) sum += num;
      }
      if (sum > 0) return { totalMinutes: Math.min(480, sum), matchedItemIds: [], unmatchedItems: [], usedExplicitTag: true, confident: true };
    }

    const items = this.splitTopLevelItems(text);
    if (items.length === 0) return { ...fallback, totalMinutes: 60 };

    const VISIT_BUFFER_MINUTES = 20;
    interface ResolvedItem { id: string; durationMinutes: number; isAddon: boolean; isBundle: boolean; componentIds: string[] }
    const matchedServices: ResolvedItem[] = [];
    const unmatchedItems: string[] = [];

    for (const item of items) {
      const matched = this.matchCatalogItem(item, tenantId);
      if (matched) {
        matchedServices.push({
          id: matched.id,
          durationMinutes: matched.durationMinutes,
          isAddon: this.isAddonService(matched),
          isBundle: this.isBundleService(matched),
          componentIds: matched.bundleItemIds || [],
        });
      } else if (this.isAddonKeyword(item)) {
        matchedServices.push({
          id: item.toLowerCase().includes('nebulizer') ? '__addon_nebulizer__' : '__addon_generic__',
          durationMinutes: item.toLowerCase().includes('nebulizer') ? 20 : 15,
          isAddon: true,
          isBundle: false,
          componentIds: [],
        });
      } else {
        unmatchedItems.push(item);
      }
    }

    const unique: ResolvedItem[] = [];
    const seenIds = new Set<string>();
    for (const s of matchedServices) {
      if (seenIds.has(s.id)) continue;
      seenIds.add(s.id);
      unique.push(s);
    }
    const bundleComponentIds = new Set<string>();
    for (const s of unique) {
      if (s.isBundle) for (const cid of s.componentIds) bundleComponentIds.add(cid);
    }
    const resolved = unique.filter((s) => !bundleComponentIds.has(s.id));

    let sum = 0;
    let hasMain = false;
    let hasBundle = false;
    for (const s of resolved) {
      sum += s.durationMinutes;
      if (s.isBundle) hasBundle = true;
      else if (!s.isAddon) hasMain = true;
    }
    if (unmatchedItems.length > 0) {
      sum += unmatchedItems.length * 60;
      hasMain = true;
    }

    if (hasMain && !hasBundle) sum += VISIT_BUFFER_MINUTES;
    const totalMinutes = Math.min(480, Math.max(15, sum));
    return {
      totalMinutes,
      matchedItemIds: resolved.map((s) => s.id),
      unmatchedItems,
      usedExplicitTag: false,
      confident: resolved.length > 0 && unmatchedItems.length === 0,
    };
  }

  public stripStructuredMetadata(text: string): string {
    let s = text;
    for (let i = 0; i < 3; i++) {
      s = s.replace(/\(\s*(?:bayi|anak|pasien|kehamilan|usia)\s*:[^()]*\)/gi, ' ');
    }
    s = s.replace(/\b(?:baby|moms|kids|combination|pasien|bayi|anak|balita)\s*:/gi, ' ');
    s = s.replace(/\|/g, ' + ');
    return s.replace(/\s+/g, ' ').trim();
  }

  public splitTopLevelItems(text: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let current = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      if (depth === 0) {
        if (ch === '+' || ch === ',' || ch === '&') {
          out.push(current);
          current = '';
          continue;
        }
        if (ch === ' ') {
          const rest = text.slice(i).toLowerCase();
          if (/^ dan\s/.test(rest)) {
            out.push(current);
            current = '';
            i += 3;
            continue;
          }
        }
      }
      current += ch;
    }
    out.push(current);
    return out.map((s) => s.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim()).filter((s) => s.length > 2);
  }

  private catalogWordTokensRaw(text: string | null | undefined): Set<string> {
    const cleaned = (text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    const alias: Record<string, string> = {
      rileksasi: 'relaksasi', rileks: 'relaksasi', pijet: 'pijat', moxa: 'moksa',
      kidz: 'kids', baby: 'bayi', oksitoksin: 'oksitosin', oksifull: 'oksitosin', therapist: 'terapi',
    };
    const stop = new Set(['addon', 'add', 'on', 'dan', 'the', 'paket', 'spa', 'treatment', 'layanan']);
    return new Set(cleaned.split(' ').map((w) => alias[w] || w).filter((w) => w.length >= 3 && !stop.has(w) && !/^\d+$/.test(w)));
  }

  private getServiceCombinedTokens(s: ClinicServiceItem): Set<string> {
    const nameTokens = this.catalogWordTokensRaw(s.name);
    const descTokens = this.catalogWordTokensRaw(s.description || '');
    return new Set([...nameTokens, ...descTokens]);
  }

  public matchCatalogItem(itemText: string, tenantId: string = DEFAULT_TENANT_ID): ClinicServiceItem | undefined {
    const itemTokens = this.catalogWordTokens(itemText);
    if (itemTokens.size < 2) return undefined;
    const normItemKey = this.normalizeCatalogKey(itemText);
    let best: ClinicServiceItem | undefined;
    let bestKey: [number, number, number] | undefined;
    for (const s of this.getAllServices(true, tenantId)) {
      const svcTokens = this.getServiceCombinedTokens(s);
      if (svcTokens.size < itemTokens.size) continue;
      let containsAll = true;
      for (const t of itemTokens) {
        if (!svcTokens.has(t)) { containsAll = false; break; }
      }
      if (!containsAll) continue;
      const normSvc = this.normalizeCatalogKey(this.stripParenthetical(s.name));
      const isNamedSubset = normItemKey.length >= 4 && normSvc.includes(normItemKey);
      const isAddon = (s as any).isAddon || s.category === 'ADD_ON';
      const surplus = svcTokens.size - itemTokens.size + (isAddon ? 100 : 0);
      const bundlePenalty = s.category === 'BUNDLE' ? 1 : 0;
      const key: [number, number, number] = [isNamedSubset ? 0 : 1, bundlePenalty, surplus];
      if (!bestKey || key[0] < bestKey[0] ||
          (key[0] === bestKey[0] && key[1] < bestKey[1]) ||
          (key[0] === bestKey[0] && key[1] === bestKey[1] && key[2] < bestKey[2])) {
        bestKey = key;
        best = s;
      }
    }
    return best;
  }

  private stripParenthetical(name: string | null | undefined): string {
    return (name || '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private catalogWordTokens(name: string | null | undefined): Set<string> {
    const cleaned = (name || '')
      .toLowerCase()
      .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ');
    const alias: Record<string, string> = {
      rileksasi: 'relaksasi',
      rileks: 'relaksasi',
      pijet: 'pijat',
      moxa: 'moksa',
      kidz: 'kids',
      baby: 'bayi',
      oksitoksin: 'oksitosin',
      oksifull: 'oksitosin',
      therapist: 'terapi',
      prenatal: 'pregnant',
    };
    const stop = new Set(['addon', 'add', 'on', 'dan', 'the', 'paket', 'spa', 'treatment', 'layanan', 'kala']);

    return new Set(
      cleaned
        .split(' ')
        .map((w) => alias[w] || w)
        .filter((w) => w.length >= 3 && !stop.has(w) && !/^\d+$/.test(w))
    );
  }

  private normalizeCatalogKey(name: string | null | undefined): string {
    return (name || '')
      .toLowerCase()
      .replace(/^kala\s+(?:baby|kids|mom|bundle|terapi)?\s*[–-]?\s*/gi, '')
      .replace(/\(add-?on\)|\[add-?on\]/g, '')
      .replace(/[^a-z0-9]/g, '')
      .replace(/addon/g, '')
      .replace(/kala/g, '');
  }

  private isAddonKeyword(itemText: string): boolean {
    const lower = (itemText || '').toLowerCase();
    return lower.includes('moksa') || lower.includes('moxa') || lower.includes('cukur') ||
      lower.includes('tindik') || lower.includes('nebulizer') || lower.includes('add-on') ||
      lower.includes('addon');
  }

  public isBundleService(serviceOrId: ClinicServiceItem | string): boolean {
    const s = typeof serviceOrId === 'string' ? this.getServiceById(serviceOrId) : serviceOrId;
    if (!s) return false;
    return (
      s.category === 'BUNDLE' ||
      s.serviceType === 'BUNDLE' ||
      (Array.isArray(s.bundleItemIds) && s.bundleItemIds.length >= 2)
    );
  }

  public getBundleComponents(bundleOrId: ClinicServiceItem | string): ClinicServiceItem[] {
    const s = typeof bundleOrId === 'string' ? this.getServiceById(bundleOrId) : bundleOrId;
    if (!s || !Array.isArray(s.bundleItemIds) || s.bundleItemIds.length === 0) {
      return [];
    }
    return s.bundleItemIds
      .map((id) => this.getServiceById(id))
      .filter((item): item is ClinicServiceItem => item !== undefined);
  }

  public validateBundle(bundleData: Partial<ClinicServiceItem>): {
    valid: boolean;
    error?: string;
    calculatedOriginalPrice?: number;
    calculatedDuration?: number;
    componentNames?: string[];
  } {
    const bundleItemIds = bundleData.bundleItemIds || [];
    if (!Array.isArray(bundleItemIds) || bundleItemIds.length < 2) {
      return {
        valid: false,
        error: 'Paket Bundle wajib menggabungkan minimal 2 layanan eksisting.',
      };
    }

    const uniqueIds = Array.from(new Set(bundleItemIds));
    if (uniqueIds.length !== bundleItemIds.length) {
      return {
        valid: false,
        error: 'Layanan penyusun bundle tidak boleh duplikat.',
      };
    }

    const components: ClinicServiceItem[] = [];
    for (const id of bundleItemIds) {
      if (bundleData.id && id === bundleData.id) {
        return {
          valid: false,
          error: 'Bundle tidak boleh mereferensikan dirinya sendiri.',
        };
      }
      const item = this.getServiceById(id);
      if (!item) {
        return {
          valid: false,
          error: `Layanan penyusun dengan ID "${id}" tidak ditemukan dalam katalog.`,
        };
      }
      if (this.isBundleService(item)) {
        return {
          valid: false,
          error: `Layanan "${item.name}" adalah sebuah bundle. Bundle tidak boleh disusun dari bundle lain.`,
        };
      }
      components.push(item);
    }

    const calculatedOriginalPrice = components.reduce((sum, c) => sum + (c.originalPrice || 0), 0);
    const calculatedDuration = components.reduce((sum, c) => sum + (c.durationMinutes || 0), 0);
    const componentNames = components.map((c) => c.name);

    const bundleEffectivePrice = bundleData.promoPrice !== undefined ? bundleData.promoPrice : bundleData.originalPrice;

    if (bundleEffectivePrice !== undefined && bundleEffectivePrice >= calculatedOriginalPrice) {
      return {
        valid: false,
        error: `Harga Bundle (Rp ${bundleEffectivePrice.toLocaleString('id-ID')}) harus lebih murah dari total harga normal layanan penyusunnya (Rp ${calculatedOriginalPrice.toLocaleString('id-ID')}).`,
        calculatedOriginalPrice,
        calculatedDuration,
        componentNames,
      };
    }

    return {
      valid: true,
      calculatedOriginalPrice,
      calculatedDuration,
      componentNames,
    };
  }

  public validateReservationTreatments(treatmentIdsOrNames: string[]): {
    valid: boolean;
    error?: string;
  } {
    if (!treatmentIdsOrNames || treatmentIdsOrNames.length === 0) {
      return { valid: true };
    }

    let hasMainService = false;
    let hasAddonService = false;

    for (const idOrName of treatmentIdsOrNames) {
      const trimmed = idOrName.trim();
      if (!trimmed) continue;
      const s = this.getServiceById(trimmed) || 
        this.getAllServices(false).find((item) => item.name.toLowerCase() === trimmed.toLowerCase());

      const isAddon = s ? this.isAddonService(s) : this.isAddonService(trimmed);
      if (isAddon) {
        hasAddonService = true;
      } else {
        hasMainService = true;
      }
    }

    if (hasAddonService && !hasMainService) {
      return {
        valid: false,
        error: 'Layanan add-on tidak bisa berdiri sendiri. Harap sertakan minimal satu layanan utama.',
      };
    }

    return { valid: true };
  }

  public getServicesByCategory(category: TreatmentCategoryType): ClinicServiceItem[] {
    if (category === 'BUNDLE') {
      return this.getAllServices().filter((s) => this.isBundleService(s));
    }
    if (category === 'ADD_ON') {
      return this.getAllServices().filter((s) => this.isAddonService(s));
    }
    if (category === 'BOTH') {
      return this.getAllServices().filter((s) => s.category === 'BABY' || s.category === 'KIDS' || s.category === 'MOMS' || s.category === 'BUNDLE' || s.category === 'BOTH');
    }
    return this.getAllServices().filter((s) => s.category === category || s.category === 'BOTH');
  }

  public getServicesByAge(ageInMonths: number, onlyGeneral = false): ClinicServiceItem[] {
    return this.getAllServices().filter((s) => {
      if (s.category === 'MOMS') return false;
      const { minAgeMonths, maxAgeMonths } = s.ageTier;
      if (ageInMonths < minAgeMonths) return false;
      if (maxAgeMonths !== null && ageInMonths > maxAgeMonths) return false;

      if (onlyGeneral) {
        const lowerName = s.name.toLowerCase();
        const isTherapyOrAddon = lowerName.includes('terapi') || 
                                 lowerName.includes('pulih') || 
                                 lowerName.includes('nebulizer') || 
                                 lowerName.includes('moksa') ||
                                 lowerName.includes('add-on') ||
                                 lowerName.includes('tindik') ||
                                 lowerName.includes('cukur');
        if (isTherapyOrAddon) return false;
      }

      return true;
    });
  }

  public upsertService(service: ClinicServiceItem, tenantId: string = 'default-tenant'): ClinicServiceItem {
    getTenantCatalog(tenantId).set(service.id, service);
    if (tenantId === DEFAULT_TENANT_ID) serviceCatalog.set(service.id, service);
    saveServices();
    saveServicesToDb(tenantId).catch((e) => console.warn('[TREATMENT CATALOG] upsert DB sync failed:', (e as Error).message));
    return service;
  }

  public deleteService(id: string, tenantId: string = 'default-tenant'): boolean {
    const deleted = getTenantCatalog(tenantId).delete(id);
    if (tenantId === DEFAULT_TENANT_ID) serviceCatalog.delete(id);
    if (deleted) {
      saveServices();
      saveServicesToDb(tenantId).catch((e) => console.warn('[TREATMENT CATALOG] delete DB sync failed:', (e as Error).message));
    }
    return deleted;
  }

  public formatCatalogText(includePrice = true): string {
    const services = this.getAllServices();
    return services
      .map((s) => {
        const isBundle = this.isBundleService(s);
        const isAddon = this.isAddonService(s);
        const bundleComponents = isBundle ? this.getBundleComponents(s) : [];
        const bundleInfo = bundleComponents.length > 0
          ? `  Termasuk Layanan: ${bundleComponents.map((c) => c.name).join(' + ')}\n`
          : '';
        const addonInfo = isAddon ? `  Tipe: Layanan Tambahan (Add-on - Wajib digabung layanan utama)\n` : '';

        const priceLine = includePrice
          ? `  Harga Normal: Rp${s.originalPrice.toLocaleString('id-ID')} | Promo: Rp${s.promoPrice.toLocaleString('id-ID')}\n`
          : '';
        return `• *${s.name}*${isBundle ? ' [Paket Bundle Hemat]' : isAddon ? ' [Add-on]' : ''}\n${bundleInfo}${addonInfo}  Usia: ${s.ageTier.label}\n  Durasi: ${s.durationMinutes} menit\n${priceLine}  Deskripsi: ${s.description}`;
      })
      .join('\n\n');
  }

  public formatCatalogData(services: ClinicServiceItem[]): string {
    return services
      .filter((s) => s.isActive)
      .map((s) =>
        `[DATA TREATMENT]\n` +
        `Nama: ${s.name}\n` +
        `Kategori: ${s.category}\n` +
        `Usia/Target: ${s.ageTier.label}\n` +
        `Durasi: ${s.durationMinutes} menit\n` +
        `Deskripsi: ${s.description}`
      )
      .join('\n\n');
  }

  public filterServicesByAudience(
    services: ClinicServiceItem[],
    context: {
      ageMonths?: number | null;
      audienceIntent?: 'BABY' | 'KIDS' | 'MOMS' | 'BOTH' | 'GENERAL';
      isMaternalKeyword?: boolean;
    }
  ): ClinicServiceItem[] {
    return matching.filterServicesByAudience(services, context);
  }

  public recommendServiceBySymptoms(
    symptoms: string[],
    ageMonths?: number | null,
    category?: TreatmentCategoryType,
    tenantId: string = DEFAULT_TENANT_ID,
    momStage?: string | null,
    gestationalWeeks?: number | null
  ): (ClinicServiceItem & { askStage?: boolean; blockedByStage?: boolean }) | undefined {
    return matching.recommendServiceBySymptoms(
      symptoms,
      ageMonths,
      category,
      tenantId,
      momStage,
      gestationalWeeks,
      this.matchCatalogItem.bind(this)
    );
  }

  public getDefaultRelaxationService(
    category?: TreatmentCategoryType,
    ageMonthsOrTenantId?: number | string | null,
    tenantId: string = DEFAULT_TENANT_ID
  ): ClinicServiceItem | undefined {
    return matching.getDefaultRelaxationService(category, ageMonthsOrTenantId, tenantId);
  }

  public searchCatalogItems(userText: string): ClinicServiceItem[] {
    return matching.searchCatalogItems(userText);
  }

  public searchCatalog(userText: string, includePrice = false): string {
    return matching.searchCatalog(userText, includePrice, DEFAULT_TENANT_ID, this.matchCatalogItem.bind(this));
  }

  public getServiceDurationSummary(): string {
    return matching.getServiceDurationSummary();
  }

  public findServicesByPrice(
    targetPrice: number,
    tolerance = 0,
    tenantId: string = DEFAULT_TENANT_ID
  ): ClinicServiceItem[] {
    return matching.findServicesByPrice(targetPrice, tolerance, tenantId);
  }

  public matchServicesBySymptoms(symptoms: string[]): ClinicServiceItem[] {
    return matching.matchServicesBySymptoms(symptoms);
  }
}

export const treatmentCatalogService = new TreatmentCatalogService();
export default treatmentCatalogService;
