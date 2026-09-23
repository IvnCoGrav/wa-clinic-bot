import axios from 'axios';
import crypto from 'crypto';
import { ParamBuilder, PII_DATA_TYPE } from 'capi-param-builder-nodejs';
import { CircuitBreaker } from '../utils/circuit-breaker';
import { GRAPH_API_VERSION, GRAPH_API_BASE_URL } from '../integrations/whatsapp/graph.constants';
import { decryptSecret } from '../utils/encryption';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { isDummyOrTestContact } from '../utils/dummy-filter';
import { hasBypassLabel, checkCustomerBypass } from '../utils/customer-bypass';
import { prisma } from '../db/client';

// Inisialisasi Circuit Breaker untuk CAPI calls
export const capiBreaker = new CircuitBreaker(
  async (url: string, payload: any) => {
    return axios.post(url, payload, { timeout: 5000 });
  },
  async () => {
    // PENTING: fallback ini TIDAK boleh dianggap sukses oleh caller — ditandai
    // `isFallback: true` supaya sendCapiEvent tidak mencatat [CAPI SUCCESS] palsu.
    return {
      isFallback: true,
      data: { success: false, note: 'Circuit Breaker Active Fallback (CAPI)' },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {} as any,
    };
  },

  {
    name: 'Meta CAPI',
    failureThreshold: 0.5,
    slidingWindowSize: 10,
    cooldownPeriodMs: 30000, // 30 seconds
  }
);

/**
 * Melakukan normalisasi nomor HP ke format E.164 (hanya angka, diawali dengan kode negara, misal 62)
 */
export function normalizePhoneToE164(phone: string): string {
  if (!phone) return '';
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.substring(1);
  } else if (cleaned.startsWith('8')) {
    cleaned = '62' + cleaned;
  }
  return cleaned;
}

/**
 * Menghasilkan hash SHA-256 lowercase dari string input
 */
export function sha256Hash(text: string): string {
  if (!text) return '';
  return crypto.createHash('sha256').update(text.trim().toLowerCase()).digest('hex');
}

/**
 * Mencari harga (promoPrice ?? originalPrice) treatment di katalog berdasarkan
 * treatment_detail / raw text reservasi. Best-effort: tak ditemukan → undefined
 * (event dikirim tanpa value). Dipakai event Purchase CAPI.
 */
/**
 * Helpers data-driven katalog — tanpa hardcode harga/nama layanan.
 * Pencocokan berbasis katalog aktif per-tenant (treatmentCatalogService).
 */
function normalizeForMatch(s: string): string {
  return (s || '').toLowerCase().replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
}

function findCatalogPrice(term: string, catalogServices: any[]): number | undefined {
  if (!term || !term.trim()) return undefined;
  const q = term.trim().toLowerCase();
  const qNorm = normalizeForMatch(q);
  if (!catalogServices || catalogServices.length === 0) return undefined;
  const sorted = [...catalogServices].sort((a, b) => (b.name?.length || 0) - (a.name?.length || 0));
  for (const s of sorted) {
    const raw = (s.name || '').toLowerCase().trim();
    const norm = normalizeForMatch(s.name || '');
    const desc = (s.description || '').toLowerCase();
    if (raw && (q === raw || qNorm === norm)) return s.promoPrice ?? s.originalPrice;
    if (norm && norm.length >= 5 && (q.includes(norm) || qNorm.includes(norm))) return s.promoPrice ?? s.originalPrice;
    if (raw && raw.length >= 5 && (q.includes(raw) || raw === q)) return s.promoPrice ?? s.originalPrice;
    if (desc && q.length >= 4 && desc.includes(q)) return s.promoPrice ?? s.originalPrice;
  }
  // Token-overlap fallback untuk alias informal — pilih layanan dengan skor kecocokan token tertinggi
  const qTokens = q.split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
  const genericStop = new Set(['perawatan','misterius','tidak','dikenal','treatment','homecare']);
  const filteredTokens = qTokens.filter((t) => !genericStop.has(t));
  if (filteredTokens.length > 0) {
    let best: any = null;
    let bestScore = -1;
    let bestLen = Infinity;
    for (const s of catalogServices) {
      const nameTokens = (s.name || '').toLowerCase().split(/[^a-z0-9]+/).filter((t: string) => t.length >= 3);
      let score = 0;
      for (const tok of filteredTokens) {
        if (nameTokens.includes(tok) || (s.name || '').toLowerCase().includes(tok)) score++;
      }
      if (score > 0) {
        const nameLen = (s.name || '').length;
        if (score > bestScore || (score === bestScore && nameLen < bestLen)) {
          best = s;
          bestScore = score;
          bestLen = nameLen;
        }
      }
    }
    if (best) return best.promoPrice ?? best.originalPrice;
  }
  return undefined;
}

/**
 * Mencari harga (promoPrice ?? originalPrice) treatment di katalog berdasarkan
 * treatment_detail / raw text reservasi.
 * Mendukung pencocokan alias, bundle kombinasi, multi-item compounding, dan kategori fallback.
 */
export async function resolveTreatmentValue(treatmentDetail: string | null | undefined, tenantId: string = DEFAULT_TENANT_ID): Promise<number | undefined> {
  if (!treatmentDetail || !treatmentDetail.trim()) return undefined;
  try {
    let catalogServices: any[] = [];
    try {
      const { treatmentCatalogService } = await import('./treatment-catalog.service');
      catalogServices = treatmentCatalogService.getAllServices(false, tenantId);
    } catch {}

    // Bersihkan durasi [xxm], kurung bayi/usia/kehamilan, dan template placeholder
    const cleanStr = treatmentDetail
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\((?:bayi|anak|kehamilan|usia|umur)[^)]*\)/gi, ' ')
      .replace(/\((?:mohon|jika|opsional|optional)[^)]*\)/gi, ' ')
      .trim();

    const cleanLower = cleanStr.toLowerCase();

    // 1. Direct bundle match data-driven: bila cleanStr cocok nama bundle katalog → pakai harga bundle
    const bundlePool = catalogServices.filter((s: any) => s.category === 'BUNDLE' || s.serviceType === 'BUNDLE' || s.bundleItemIds);
    const bundlePrice = findCatalogPrice(cleanStr, bundlePool);
    if (bundlePrice !== undefined) return bundlePrice;
    // Juga cek cleanLower mengandung nama bundle panjang (mis. "paket selapan")
    for (const b of [...bundlePool].sort((a: any, c: any) => (c.name?.length || 0) - (a.name?.length || 0))) {
      const bNorm = normalizeForMatch(b.name || '');
      if (bNorm.length >= 5 && cleanLower.includes(bNorm)) return b.promoPrice ?? b.originalPrice;
    }

    // 2. Pecah multi-treatment (berdasarkan '|', '\n', '+', '&', 'dan', atau koma)
    const segments = cleanStr
      .split(/[|\n]/g)
      .map((s) => s.trim())
      .filter(Boolean);

    let totalCalculated = 0;
    let matchedAny = false;

    for (const segment of segments) {
      // Hapus prefix seperti "Baby:", "Moms:", "Kids:", "Treatment:", "Pilihan treatment (Baby & Kids) :"
      const cleanedSegment = segment
        .replace(/^(?:Baby|Moms|Kids|Treatment|Pilihan treatment\s*(?:\([^)]*\))?)\s*:\s*/i, '')
        .trim();

      if (!cleanedSegment) continue;

      // Cek apakah segment ini memiliki sub-item dengan '+' atau 'dan' atau '&'
      const subItems = cleanedSegment
        .split(/\s*(?:\+|\bdan\b|\&)\s*/i)
        .map((x) => x.trim())
        .filter((x) => x.length >= 2 && !x.startsWith('('));

      // Jika ada subItems (misal: "Pijat Bayi Pulih Ceria + Sinar Moksa")
      if (subItems.length > 1) {
        // Guard: hanya anggap subItems bila pemisah '+', '&' eksplisit — hindari split kata 'dan' di dalam nama tunggal
        const hasExplicitSeparator = /\+|\&/.test(cleanedSegment);
        // Jika hanya 'dan' tanpa '+'/'&', verifikasi tiap sub adalah nama katalog valid sebelum sum
        let subSum = 0;
        let subMatched = false;
        let allSubValid = true;
        for (const sub of subItems) {
          const p = findCatalogPrice(sub, catalogServices);
          if (p !== undefined && p > 0) {
            subSum += p;
            subMatched = true;
          } else {
            allSubValid = false;
          }
        }
        if (subMatched && subSum > 0 && (hasExplicitSeparator || allSubValid)) {
          totalCalculated += subSum;
          matchedAny = true;
          continue;
        }
      }

      // Single item match pada segment — longest-match katalog
      const price = findCatalogPrice(cleanedSegment, catalogServices);
      if (price !== undefined && price > 0) {
        totalCalculated += price;
        matchedAny = true;
      }
    }

    if (matchedAny && totalCalculated > 0) {
      return totalCalculated;
    }

    // 3. Fallback pencocokan langsung pada seluruh teks
    const directPrice = findCatalogPrice(cleanStr, catalogServices);
    if (directPrice !== undefined && directPrice > 0) {
      return directPrice;
    }

    // 4. Fallback berbasis Kategori — data-driven: prefer layanan "Ceria"/generik, baru min
    const pickCategoryFallback = (cat: string): number | undefined => {
      const pool = catalogServices.filter((s: any) => (s.category || '').toUpperCase() === cat && s.serviceType !== 'ADD_ON' && s.category !== 'ADD_ON');
      if (pool.length === 0) return undefined;
      // Prefer ceria/relaksasi untuk BABY/KIDS, prenatal untuk MOMS
      const preferKeywords: Record<string, string[]> = { BABY: ['ceria', 'newborn'], KIDS: ['ceria'], MOMS: ['hamil', 'prenatal', 'laktasi'] };
      const kws = preferKeywords[cat] || [];
      for (const kw of kws) {
        const hit = pool.find((s: any) => (s.name || '').toLowerCase().includes(kw));
        if (hit) return hit.promoPrice ?? hit.originalPrice;
      }
      const vals = pool.map((s: any) => s.promoPrice ?? s.originalPrice).filter((v: any) => typeof v === 'number' && v > 0);
      if (vals.length === 0) return undefined;
      return Math.min(...vals);
    };
    if (cleanLower.includes('moms') || cleanLower.includes('ibu') || cleanLower.includes('hamil') || cleanLower.includes('nifas') || cleanLower.includes('laktasi')) {
      const v = pickCategoryFallback('MOMS');
      if (v !== undefined) return v;
      return 100000;
    }
    if (cleanLower.includes('kids') || cleanLower.includes('anak')) {
      const v = pickCategoryFallback('KIDS');
      if (v !== undefined) return v;
      return 70000;
    }
    if (cleanLower.includes('baby') || cleanLower.includes('bayi') || cleanLower.includes('pijat') || cleanLower.includes('homecare')) {
      const v = pickCategoryFallback('BABY');
      if (v !== undefined) return v;
      return 60000;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Decrypt token CAPI yang disimpan encrypted (AES-256-GCM via encryptSecret).
 * Backward-compat: data lama mungkin plaintext — kalau decrypt gagal & terlihat
 * seperti token Meta (EAA...), anggap legacy dan pakai apa adanya.
 */
export function decryptCapiToken(raw: string): string | null {
  if (!raw) return null;
  try {
    return decryptSecret(raw);
  } catch {
    // Legacy plaintext atau format tak dikenal — pakai asli kalau terlihat token.
    return raw.startsWith('EAA') ? raw : null;
  }
}

export interface TenantCapiCredentials {
  pixelId?: string;
  accessToken?: string;
  source: 'db' | 'env' | 'none';
}

/**
 * Resolusi kredensial Meta CAPI/Pixel per-tenant — SATU-SATUNYA sumber kebenaran.
 * Dipakai oleh sendCapiEvent maupun testCapiConnection agar tidak ada drift.
 *
 * Kebijakan isolasi multi-tenant (fail-closed, anti-leakage):
 * - Kredensial DB tenant (meta_pixel_id / meta_capi_access_token) SELALU menang bila valid.
 * - Fallback ke process.env (FB_PIXEL_ID / FB_CAPI_ACCESS_TOKEN) HANYA bila
 *   tenantId === DEFAULT_TENANT_ID secara eksplisit (backward compat klinik sendiri).
 * - Tenant non-default tanpa kredensial DB valid → source 'none' (caller WAJIB skip,
 *   tidak boleh menyentuh env) — mencegah event bocor ke akun iklan pemilik bot.
 * - tenantId kosong/undefined → source 'none' (seluruh caller produksi wajib mengirim tenantId).
 * - DB error / token gagal decrypt pada tenant non-default → 'none' (fail-closed),
 *   bukan fallback env.
 */
export async function resolveTenantCapiCredentials(tenantId?: string): Promise<TenantCapiCredentials> {
  const isDefaultTenant = tenantId === DEFAULT_TENANT_ID;

  if (tenantId && !isDefaultTenant) {
    try {
      const { prisma } = await import('../db/client');
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      let pixelId: string | undefined;
      let accessToken: string | undefined;
      if (tenant?.meta_pixel_id) pixelId = tenant.meta_pixel_id;
      if (tenant?.meta_capi_access_token) {
        const decrypted = decryptCapiToken(tenant.meta_capi_access_token);
        if (decrypted) {
          accessToken = decrypted;
        } else {
          const token = tenant.meta_capi_access_token;
          const mask = token.length > 10 ? `${token.substring(0, 4)}…${token.slice(-4)}` : '(token sangat pendek)';
          console.warn(`[CAPI ISOLATION] Token CAPI tenant ${tenantId} gagal didecrypt (${mask}) — event di-skip, TIDAK fallback ke env.`);
        }
      }
      if (pixelId && accessToken) return { pixelId, accessToken, source: 'db' };
      console.warn(`[CAPI ISOLATION] Kredensial CAPI tenant ${tenantId} tidak lengkap di DB — event di-skip, TIDAK fallback ke env.`);
      return { source: 'none' };
    } catch (err) {
      console.warn(`[CAPI ISOLATION] Gagal baca config CAPI tenant ${tenantId} — event di-skip (fail-closed):`, (err as Error).message);
      return { source: 'none' };
    }
  }

  if (!isDefaultTenant) {
    console.warn('[CAPI ISOLATION] Permintaan CAPI tanpa tenantId — event di-skip (fail-closed). Seluruh caller wajib mengirim tenantId.');
    return { source: 'none' };
  }

  // default-tenant: DB menang, env fallback (backward compat).
  let pixelId = process.env.FB_PIXEL_ID;
  let accessToken = process.env.FB_CAPI_ACCESS_TOKEN;
  let source: 'db' | 'env' | 'none' = 'none';
  try {
    const { prisma } = await import('../db/client');
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (tenant?.meta_pixel_id) pixelId = tenant.meta_pixel_id;
    if (tenant?.meta_capi_access_token) {
      const decrypted = decryptCapiToken(tenant.meta_capi_access_token);
      if (decrypted) {
        accessToken = decrypted;
      } else {
        const token = tenant.meta_capi_access_token;
        const mask = token.length > 10 ? `${token.substring(0, 4)}…${token.slice(-4)}` : '(token sangat pendek)';
        console.warn(`[CAPI WARNING] Token CAPI tenant ${tenantId} gagal didecrypt (${mask}), pakai env fallback.`);
      }
    }
    if (tenant?.meta_pixel_id || tenant?.meta_capi_access_token) source = 'db';
  } catch (err) {
    console.warn(`[CAPI WARNING] Gagal baca config CAPI tenant ${tenantId}, pakai env fallback:`, (err as Error).message);
  }
  if (source === 'none' && pixelId && accessToken) source = 'env';
  return { pixelId, accessToken, source };
}

/**
 * Menormalkan landingUrl agar merefleksikan URL landing page asli (First-Touch URL)
 * dengan mengekstrak nested query `landing_url` bila ada atau memetakan domain backend /cta
 * ke domain landing page tenant yang aktif di database secara dinamis.
 */
export function resolveCanonicalLandingUrl(
  rawLandingUrl?: string | null,
  tenantLandingDomain?: string | null
): string | undefined {
  if (!rawLandingUrl || typeof rawLandingUrl !== 'string') {
    return undefined;
  }

  let url = rawLandingUrl.trim();
  if (!url) return undefined;

  // 1. Jika di dalam URL terdapat parameter `landing_url` (contoh: https://app.../cta?landing_url=https%3A%2F%2F...), ekstrak landing_url aslinya
  try {
    if (url.includes('landing_url=')) {
      const parsed = new URL(url.startsWith('http') ? url : `https://localhost${url.startsWith('/') ? '' : '/'}${url}`);
      const nested = parsed.searchParams.get('landing_url');
      if (nested && (nested.startsWith('http://') || nested.startsWith('https://'))) {
        return nested;
      }
    }
  } catch {}

  const domain = (tenantLandingDomain || '').trim().replace(/\/+$/, '');

  // 2. Jika URL adalah URL absolut (atau diawali http)
  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      const parsed = new URL(url);

      // Jika URL mengarah ke endpoint backend /cta
      if (parsed.pathname === '/cta' || parsed.pathname.endsWith('/cta')) {
        let targetProtocol = parsed.protocol;
        let targetHost = parsed.host.replace(/^app\./i, ''); // Strip subdomain 'app.' backend bot
        let targetPath = '/reservasionline';

        if (domain) {
          try {
            const parsedDomain = new URL(domain.startsWith('http') ? domain : `https://${domain}`);
            targetProtocol = parsedDomain.protocol;
            targetHost = parsedDomain.host;
            if (parsedDomain.pathname && parsedDomain.pathname !== '/') {
              targetPath = parsedDomain.pathname;
            }
          } catch {}
        }

        // Ambil slug dari query parameter bila ada
        const explicitSlug = parsed.searchParams.get('slug') || parsed.searchParams.get('p');
        if (explicitSlug && explicitSlug !== 'cta') {
          targetPath = `/${explicitSlug.replace(/^\/+/, '')}`;
        }

        // Hapus query internal bot yang tidak relevan dengan Meta (slug, p, msg, greetings, divisi internal bot)
        parsed.searchParams.delete('landing_url');
        parsed.searchParams.delete('slug');
        parsed.searchParams.delete('p');
        parsed.searchParams.delete('msg');
        parsed.searchParams.delete('greetings');
        parsed.searchParams.delete('divisi');

        const queryStr = parsed.searchParams.toString();
        return `${targetProtocol}//${targetHost}${targetPath}${queryStr ? `?${queryStr}` : ''}`;
      }
    } catch {}

    return url;
  }

  // 3. Jika URL adalah path relatif (misal: /reservasionline atau /cta?fbclid=...)
  if (domain) {
    const cleanPath = url.startsWith('/') ? url : `/${url}`;
    if (cleanPath.startsWith('/cta')) {
      try {
        const parsedDomain = new URL(domain.startsWith('http') ? domain : `https://${domain}`);
        const targetPath = (parsedDomain.pathname && parsedDomain.pathname !== '/') ? parsedDomain.pathname : '/reservasionline';
        const qIdx = cleanPath.indexOf('?');
        const query = qIdx !== -1 ? cleanPath.slice(qIdx) : '';
        return `${parsedDomain.origin}${targetPath}${query}`;
      } catch {}
    }
    return `${domain}${cleanPath}`;
  } else if (url.startsWith('/cta')) {
    const qIdx = url.indexOf('?');
    const query = qIdx !== -1 ? url.slice(qIdx) : '';
    return `https://kalababyspa.online/reservasionline${query}`;
  }

  return url;
}

/**
 * Format kata kunci funnel CAPI per tenant (format_checkout / format_purchase).
 * Tenant-aware: dibaca dari kolom tenant DB, fallback ke nilai default bila
 * tenant tidak punya config / DB offline (konsisten dengan pola credentials CAPI).
 */
export async function getTenantCapiFormats(tenantId?: string): Promise<{
  formatCheckout: string;
  formatPurchase: string;
  formatVisit: string;
  greetingsText: string;
  formatValue: string;
}> {
  const defaults = {
    formatCheckout: 'list untuk reservasi :',
    formatPurchase: 'Payment',
    formatVisit: 'Promo[%ID%]',
    greetingsText: 'Promo [%ID%]',
    formatValue: 'Treatment = %VALUE%',
  };
  if (!tenantId) return defaults;
  try {
    const { prisma } = await import('../db/client');
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    return {
      formatCheckout: tenant?.format_checkout?.trim() || defaults.formatCheckout,
      formatPurchase: tenant?.format_purchase?.trim() || defaults.formatPurchase,
      formatVisit: tenant?.format_visit?.trim() || defaults.formatVisit,
      greetingsText: (tenant as any)?.greetings_text?.trim() || tenant?.format_visit?.trim() || defaults.greetingsText,
      formatValue: (tenant as any)?.format_value?.trim() || defaults.formatValue,
    };
  } catch {
    return defaults;
  }
}

/**
 * Ekstrak nominal rupiah murni dari teks berdasarkan template formatValue tenant (misal: "Treatment = %VALUE%").
 * Mengubah formatValue menjadi regex dinamis yang menangkap angka di sekitar %VALUE%.
 */
export function extractValueByFormat(text: string, formatValueTemplate?: string): number | undefined {
  if (!text) return undefined;
  const template = (formatValueTemplate && formatValueTemplate.includes('%VALUE%'))
    ? formatValueTemplate.trim()
    : 'Treatment = %VALUE%';

  // Pisahkan prefix dan suffix di sekitar %VALUE%
  const parts = template.split('%VALUE%');
  const rawPrefix = parts[0] || '';
  const rawSuffix = parts[1] || '';

  // Escape karakter khusus regex
  const escapeRegex = (s: string) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

  // Buat pola prefix fleksibel
  const flexiblePrefix = escapeRegex(rawPrefix.trim())
    .replace(/\s+/g, '\\s*')
    .replace(/\\:|\\=/g, '[:=]?');

  const flexibleSuffix = escapeRegex(rawSuffix.trim()).replace(/\s+/g, '\\s*');

  // Pola penangkapan angka rupiah di posisi %VALUE%
  const regexStr = `${flexiblePrefix ? flexiblePrefix + '\\s*' : ''}(?:Rp[\\s.]?)?([\\d.,]+(?:\\s*(?:rb|ribu))?)${flexibleSuffix ? '\\s*' + flexibleSuffix : ''}`;
  const regex = new RegExp(regexStr, 'i');

  const match = text.match(regex);
  if (match && match[1]) {
    const rawVal = match[1];
    let numStr = rawVal.replace(/[^\d]/g, '');
    if (!numStr) return undefined;
    let val = parseInt(numStr, 10);
    const lower = rawVal.toLowerCase();
    if (lower.includes('rb') || lower.includes('ribu')) {
      val = val * 1000;
    }
    if (val >= 5000 && val <= 100_000_000) {
      return val;
    }
  }

  // Fallback: cari pola umum "Treatment = 70.000" atau "Layanan = 70.000"
  const genericMatch = text.match(/(?:Treatment|Layanan|Paket)\s*[:=]?\s*(?:Rp[\s.]?)?([\d.,]+(?:\s*(?:rb|ribu))?)/i);
  if (genericMatch && genericMatch[1]) {
    const rawVal = genericMatch[1];
    let numStr = rawVal.replace(/[^\d]/g, '');
    if (!numStr) return undefined;
    let val = parseInt(numStr, 10);
    const lower = rawVal.toLowerCase();
    if (lower.includes('rb') || lower.includes('ribu')) {
      val = val * 1000;
    }
    if (val >= 5000 && val <= 100_000_000) {
      return val;
    }
  }

  return undefined;
}

/**
 * Resolusi konteks New vs Repeat untuk event `Purchase` (standar Meta: event_name
 * tetap `Purchase`; pembeda disematkan ke `custom_data` agar Value-Based Bidding
 * & ROAS tidak terganggu). Basis: jumlah reservasi confirmed/completed MILIK
 * customer DI LUAR reservasi yang sedang dikirim — bukan berdasarkan follow-up
 * pending (semantik lama yang rapuh). Fail-safe DB offline → new (0).
 *
 * `order_number` = urutan transaksi ke-(priorCount + 1).
 */
async function resolveNewVsRepeatContext(params: {
  customerId?: string | null;
  tenantId?: string | null;
  reservationId?: string | null;
}): Promise<{ priorCount: number; isRepeat: boolean; orderNumber: number }> {
  const { customerId, tenantId, reservationId } = params;
  if (!customerId) return { priorCount: 0, isRepeat: false, orderNumber: 1 };
  try {
    const { prisma } = await import('../db/client');
    const priorCount = await prisma.reservation.count({
      where: {
        customer_id: customerId,
        ...(tenantId ? { tenant_id: tenantId } : {}),
        status: { in: ['confirmed', 'completed'] },
        ...(reservationId ? { id: { not: reservationId } } : {}),
      },
    });
    return {
      priorCount,
      isRepeat: priorCount > 0,
      orderNumber: priorCount + 1,
    };
  } catch {
    return { priorCount: 0, isRepeat: false, orderNumber: 1 };
  }
}

/**
 * Kebijakan moderasi Purchase CAPI per tenant (auto_send_purchase_capi).
 * Default false = moderasi manual aktif (event ditahan ke queue admin review).
 * Tenant-aware: dibaca dari kolom tenant DB; fallback false bila DB offline.
 */
export async function getTenantAutoSendPurchaseCapi(tenantId?: string): Promise<boolean> {
  if (!tenantId) return false;
  try {
    const { prisma } = await import('../db/client');
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    return tenant?.auto_send_purchase_capi ?? false;
  } catch {
    return false;
  }
}

/**
 * Fire-and-forget helper: kirim event CAPI jika customer punya atribusi adClick,
 * log error via console tanpa melempar exception (tidak merusak critical path).
 */
export function fireCapiEvent(params: {
  eventName: string;
  customer: any;
  adClick?: any;
  value?: number;
  currency?: string;
  tenantId?: string;
  customData?: Record<string, any>;
  eventTime?: number;
}): void {
  capiService.sendCapiEvent(params).catch((err) => {
    console.error(`[CAPI ERROR] Failed to send ${params.eventName} event:`, err.message);
  });
}


export class CapiService {
  private contactCooldown = new Map<string, number>();
  private checkoutCooldown = new Map<string, number>();

  /**
   * Mengirimkan server-side event ke Meta Conversions API (CAPI).
   */
  public async sendCapiEvent(params: {
    eventName: string;
    customer: any;
    adClick?: any;
    value?: number;
    currency?: string;
    tenantId?: string;
    customData?: Record<string, any>;
    eventTime?: number;
    eventId?: string;
    customUserData?: Record<string, any>;
    customEventId?: string;
    reservationId?: string;
  }): Promise<{
    success: boolean;
    message?: string;
    status?: number;
    fbtrace_id?: string;
    events_received?: number;
    metaResponse?: any;
    sentPayload?: any;
    pixelId?: string;
  }> {
    const { eventName, customer, adClick, value, currency, tenantId, customData, eventTime, eventId, customUserData, customEventId, reservationId } = params;

    // 1. Meta CAPI Sandbox / Dummy Test Guard & Non-Customer Bypass Guard (Skip / Admin CS)
    if (
      customer?.is_sandbox_test ||
      isDummyOrTestContact(customer?.phone, customer?.name, customer?.is_sandbox_test) ||
      customer?.is_admin_labeled === true ||
      hasBypassLabel(customer) ||
      (await checkCustomerBypass({ customerId: customer?.id, phone: customer?.phone, tenantId }))
    ) {
      console.log(`[CAPI GUARD] Skipped sending ${eventName} to Meta CAPI for sandbox/dummy/bypass contact (skip/admin cs): ${customer?.phone}`);
      return { success: false, message: 'Skipped: Sandbox, dummy test, or non-customer bypass contact (skip/admin cs)' };
    }

    // 1b. Centralized Event Cooldown Guard (Anti-Burst & Idempotency)
    const phoneKey = (customer?.phone || '').replace(/\D/g, '');
    if (phoneKey) {
      const now = Date.now();
      if (eventName === 'Contact') {
        const lastSent = this.contactCooldown.get(phoneKey);
        if (lastSent && now - lastSent < 24 * 60 * 60 * 1000) {
          console.log(`[CAPI GUARD] Skipped Contact event for ${phoneKey}: Centralized 24h cooldown active.`);
          return { success: false, message: 'Skipped: Contact event 24h cooldown active' };
        }
        this.contactCooldown.set(phoneKey, now);
      } else if (eventName === 'InitiateCheckout') {
        const lastSent = this.checkoutCooldown.get(phoneKey);
        if (lastSent && now - lastSent < 60 * 60 * 1000) {
          console.log(`[CAPI GUARD] Skipped InitiateCheckout event for ${phoneKey}: Centralized 1h cooldown active.`);
          return { success: false, message: 'Skipped: InitiateCheckout event 1h cooldown active' };
        }
        this.checkoutCooldown.set(phoneKey, now);
      }
    }

    let effectiveAdClick = adClick || (customer as any)?.adClick;
    let fullCustomer = customer;
    if (customer?.id || customer?.phone) {
      try {
        const { prisma } = await import('../db/client');
        const dbCust = await prisma.customer.findFirst({
          where: customer.id ? { id: customer.id } : { phone: customer.phone },
        });
        if (dbCust) {
          fullCustomer = { ...dbCust, ...customer };
        }
        if (!effectiveAdClick && (fullCustomer?.id || fullCustomer?.phone)) {
          effectiveAdClick = await prisma.adClick.findFirst({
            where: {
              OR: [
                ...(fullCustomer?.id ? [{ customerId: fullCustomer.id }] : []),
                ...(fullCustomer?.phone ? [{ phone: fullCustomer.phone }] : []),
              ],
            },
            orderBy: [{ matchedAt: 'desc' }, { createdAt: 'desc' }],
          });
        }
      } catch {}
    }

    const isPaid = !!effectiveAdClick;

    // 2. Tenant-aware credentials — SATU pintu via resolveTenantCapiCredentials (fail-closed, anti-leakage).
    const { pixelId, accessToken } = await resolveTenantCapiCredentials(tenantId);

    if (!pixelId || !accessToken) {
      console.warn(`[CAPI WARNING] CAPI credentials missing for tenant ${tenantId || '(tanpa tenantId)'}: FB_PIXEL_ID=${pixelId ? 'configured' : 'missing'}, FB_CAPI_ACCESS_TOKEN=${accessToken ? 'configured' : 'missing'}`);
      return { success: false, message: `Skipped: Credentials missing for tenant ${tenantId || 'unknown'}` };
    }

    try {
      // 2. NORMALIZE & HASH PII (Nomor HP, Nama, External ID, Kota, Zipcode, Country) menggunakan Meta ParamBuilder
      const builder = new ParamBuilder();
      const rawPhone = fullCustomer?.phone || effectiveAdClick?.phone || '';
      const normalizedPhone = normalizePhoneToE164(rawPhone);
      const hashedPhone = builder.getNormalizedAndHashedPII(normalizedPhone, PII_DATA_TYPE.PHONE);

      // Advanced Matching: Nama Depan & Nama Belakang dari Customer / AdClick
      let hashedFn: string | undefined;
      let hashedLn: string | undefined;
      let rawName = (fullCustomer?.name || fullCustomer?.pushName || effectiveAdClick?.name || '').trim();

      // Self-heal: jika rawName kosong atau hanya honorific/generic (misal "Mbak", "Bunda", "Pasien")
      const lowerRaw = rawName.toLowerCase();
      const isRawGeneric = !rawName || ['bunda', 'ibu', 'mama', 'mom', 'mbak', 'mas', 'kak', 'kakak', 'ny', 'pasien', 'customer', '-'].includes(lowerRaw);
      if (isRawGeneric && fullCustomer?.id) {
        try {
          const { prisma } = await import('../db/client');
          const latestRes = await prisma.reservation.findFirst({
            where: { customer_id: fullCustomer.id, status: { not: 'cancelled' } },
            orderBy: { created_at: 'desc' },
          });
          if (latestRes?.raw_text) {
            const { parseReservationText } = await import('../utils/reservation-text-parser');
            const pr = parseReservationText(latestRes.raw_text);
            if (pr.success && pr.reservation?.name) {
              rawName = pr.reservation.name;
            }
          }
        } catch {}
      }

      if (rawName) {
        // Strip honorifics seperti "Bunda", "Ibu", "Mama", "Mom", "Mbak", "Mas", "Kak", "Kakak" di awal nama
        const cleanedName = rawName.replace(/^(?:bunda|ibu|mama|mom|mbak|mas|kak|kakak|ny|ny\.|mrs|mrs\.)\s+/i, '').trim();
        const lowerClean = cleanedName.toLowerCase();
        const isGenericAlone = ['bunda', 'ibu', 'mama', 'mom', 'mbak', 'mas', 'kak', 'kakak', 'pasien', 'customer', '-'].includes(lowerClean);
        if (cleanedName && !isGenericAlone && cleanedName.length > 1) {
          const parts = cleanedName.split(/\s+/);
          const firstName = parts[0];
          if (firstName && firstName.length > 1) {
            hashedFn = builder.getNormalizedAndHashedPII(firstName, PII_DATA_TYPE.FIRST_NAME) || undefined;
            const lastName = parts.length > 1 ? parts.slice(1).join(' ') : undefined;
            if (lastName) {
              hashedLn = builder.getNormalizedAndHashedPII(lastName, PII_DATA_TYPE.LAST_NAME) || undefined;
            }
          }
        }
      }

      // Advanced Matching: External ID (hashed customer.id / phone ID)
      let hashedExternalId: string | undefined;
      const rawExternalId = fullCustomer?.id ? String(fullCustomer.id) : undefined;
      if (rawExternalId) {
        hashedExternalId = builder.getNormalizedAndHashedPII(rawExternalId, PII_DATA_TYPE.EXTERNAL_ID) || undefined;
      }

      // Advanced Matching: City (Kota), State (Provinsi), Zipcode (Kode Pos), Country (Negara), & Gender
      let hashedCity: string | undefined;
      let hashedState: string | undefined;
      let hashedZip: string | undefined;
      let hashedCountry: string | undefined;
      let hashedGender: string | undefined;

      const rawCity = (fullCustomer?.kota || fullCustomer?.pending_kota || '').trim();
      if (rawCity) {
        hashedCity = builder.getNormalizedAndHashedPII(rawCity, PII_DATA_TYPE.CITY) || undefined;
      }
      hashedState = builder.getNormalizedAndHashedPII('jawa timur', PII_DATA_TYPE.STATE) || undefined;
      let rawZip = (fullCustomer?.zipcode || fullCustomer?.pending_zipcode || '').trim();
      let gazetteerZip: string | null = null;
      if (!rawZip) {
        try {
          const { resolveZipcode } = await import('../utils/gazetteer-zipcode-resolver');
          const prefs = (fullCustomer as any)?.preferences || {};
          const addrText = (prefs.address || prefs.full_address || (fullCustomer as any)?.address || '').trim();
          const nameText = (fullCustomer?.name || '').trim();
          const gazInput = {
            kelurahan: (fullCustomer?.kelurahan || fullCustomer?.pending_kelurahan || '') as string,
            kecamatan: (fullCustomer?.kecamatan || fullCustomer?.pending_kecamatan || '') as string,
            kota: (fullCustomer?.kota || fullCustomer?.pending_kota || '') as string,
            text: `${nameText} ${addrText}`.trim(),
          };
          gazetteerZip = resolveZipcode(gazInput);
          if (gazetteerZip) {
            rawZip = gazetteerZip;
            // Non-blocking async persist (non-destruktif: hanya jika zipcode IS NULL)
            const custId = fullCustomer?.id;
            if (custId) {
              void (async () => {
                try {
                  const { prisma: p } = await import('../db/client');
                  const existing = await p.customer.findUnique({ where: { id: custId }, select: { zipcode: true } });
                  if (existing && !existing.zipcode) {
                    await p.customer.update({ where: { id: custId }, data: { zipcode: gazetteerZip } });
                    console.log(`[CAPI ZIP ENRICH] Persisted gazetteer zip ${gazetteerZip} for customer ${custId}`);
                  }
                } catch (e: any) {
                  // Fallback memory store when DB offline (tests)
                  try {
                    const { customerService } = await import('./customer.service');
                    const mem = (customerService as any).getMemoryCustomers?.();
                    if (mem) {
                      for (const [, c] of mem.entries()) {
                        if (c.id === custId && !c.zipcode) { c.zipcode = gazetteerZip; break; }
                      }
                    }
                  } catch {}
                }
              })();
            }
            console.log(`[CAPI] zp enriched via Gazetteer: ${gazetteerZip} (kec=${gazInput.kecamatan || '-'}, text="${gazInput.text.slice(0, 40)}")`);
          }
        } catch (e) {
          // gazetteer resolver unavailable — silent
        }
      }
      if (rawZip) {
        hashedZip = builder.getNormalizedAndHashedPII(rawZip, PII_DATA_TYPE.ZIP_CODE) || undefined;
      }
      hashedCountry = builder.getNormalizedAndHashedPII('id', PII_DATA_TYPE.COUNTRY) || undefined;

      // Gender: kirim 'f' (female) jika treatment berkaitan dengan Moms / Ibu Hamil / Postpartum
      const treatmentText = (
        (customData?.treatment || '') + ' ' +
        (customData?.content_name || '') + ' ' +
        (fullCustomer?.last_discussed_treatment || '')
      ).toLowerCase();
      const isMomsTreatment =
        customData?.treatmentCategory === 'MOMS' ||
        customData?.treatmentCategory === 'BOTH' ||
        treatmentText.includes('moms') ||
        treatmentText.includes('ibu') ||
        treatmentText.includes('hamil') ||
        treatmentText.includes('laktasi') ||
        treatmentText.includes('nifas') ||
        treatmentText.includes('postpartum');

      if (isMomsTreatment) {
        hashedGender = builder.getNormalizedAndHashedPII('f', PII_DATA_TYPE.GENDER) || undefined;
      }

      // Gunakan server-side ParamBuilder untuk memproses parameter browser/IP & menambahkan appendix
      const mockCookies: Record<string, string> = {};
      if (effectiveAdClick?.fbp) mockCookies._fbp = effectiveAdClick.fbp;
      if (effectiveAdClick?.fbc) mockCookies._fbc = effectiveAdClick.fbc;
      if (effectiveAdClick?.ipAddress) mockCookies._fbi = effectiveAdClick.ipAddress;

      const mockQueries: Record<string, string> = {};
      if (effectiveAdClick?.fbclid) mockQueries.fbclid = effectiveAdClick.fbclid;

      let host = 'localhost';
      try {
        if (effectiveAdClick?.landingUrl) {
          host = new URL(effectiveAdClick.landingUrl).hostname;
        }
      } catch {}

      builder.processRequest(
        host,
        mockQueries,
        mockCookies,
        null, // referer
        effectiveAdClick?.ipAddress || null, // xForwardedFor
        effectiveAdClick?.ipAddress || null // remoteAddress
      );

      let fbc = builder.getFbc() || effectiveAdClick?.fbc;
      if (!fbc && effectiveAdClick?.fbclid) {
        const ts = effectiveAdClick.createdAt ? new Date(effectiveAdClick.createdAt).getTime() : Date.now();
        fbc = effectiveAdClick.fbclid.startsWith('fb.1.') ? effectiveAdClick.fbclid : `fb.1.${ts}.${effectiveAdClick.fbclid}`;
      }
      const fbp = builder.getFbp() || effectiveAdClick?.fbp;
      const clientIp = builder.getClientIpAddress() || effectiveAdClick?.ipAddress;

      // 3. CONSTRUCT USER DATA (Meta specs: hash phone/name/external_id/city/state/zip/country/gender, keep IP/UA/Cookies clean)
      const userData: any = {};
      if (hashedPhone) {
        userData.ph = [hashedPhone];
      }
      if (hashedFn) {
        userData.fn = [hashedFn];
      }
      if (hashedLn) {
        userData.ln = [hashedLn];
      }
      if (hashedExternalId) {
        userData.external_id = [hashedExternalId];
      }
      if (hashedCity) {
        userData.ct = [hashedCity];
      }
      if (hashedState) {
        userData.st = [hashedState];
      }
      if (hashedZip) {
        userData.zp = [hashedZip];
      }
      if (hashedCountry) {
        userData.country = [hashedCountry];
      }
      if (hashedGender) {
        userData.ge = [hashedGender];
      }
      if (clientIp) {
        userData.client_ip_address = clientIp;
      }
      if (effectiveAdClick?.userAgent) {
        userData.client_user_agent = effectiveAdClick.userAgent;
      }
      if (fbc) {
        userData.fbc = fbc;
      }
      if (fbp) {
        userData.fbp = fbp;
      }

      // 4. CONSTRUCT EVENT DATA payload
      //    event_id = trackingCode ad click (auto-derive) atau synthetic ID untuk organic
      let tenantDomain = '';
      if (tenantId) {
        try {
          const { prisma } = await import('../db/client');
          const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
          if ((tenant as any)?.landing_domain) {
            tenantDomain = (tenant as any).landing_domain.trim();
          }
        } catch {}
      }

      const eventSourceUrl = resolveCanonicalLandingUrl(effectiveAdClick?.landingUrl, tenantDomain);

      // 4a. TEMPORAL GUARD — Meta CAPI menolak event_time >7 hari (HTTP 400 subcode 2804003).
      //     Jika eventTime lebih tua dari 6.9 hari (596.160 detik), jepit ke waktu sekarang
      //     agar konversi tetap diterima Meta. Simpan waktu asli di custom_data.
      const META_7DAY_LIMIT_SEC = 596160; // 6.9 hari dalam detik
      const nowSec = Math.floor(Date.now() / 1000);
      let effectiveEventTime = eventTime ?? nowSec;
      const originalEventTime = effectiveEventTime;
      const eventAgeSec = nowSec - effectiveEventTime;

      if (eventAgeSec > META_7DAY_LIMIT_SEC) {
        console.warn(
          `[CAPI TEMPORAL GUARD] event_time ${effectiveEventTime} melampaui batas 7 hari Meta ` +
          `(usia ${Math.floor(eventAgeSec / 86400)} hari). Dijepit ke waktu sekarang agar konversi tetap diterima Meta.`
        );
        effectiveEventTime = nowSec;
      }

      const eventData: any = {
        event_name: eventName,
        event_time: effectiveEventTime,
        event_source_url: eventSourceUrl,
        action_source: 'chat',
        user_data: userData,
        custom_data: {
          ...(customData || {}),
          delivery_category: 'home_delivery',
          traffic_source: isPaid ? 'paid' : 'organic',
          // Simpan waktu asli jika dijepit agar jejak audit tetap ada
          ...(effectiveEventTime !== originalEventTime
            ? { original_event_time: originalEventTime }
            : {}),
          ...(effectiveAdClick?.utmSource ? { utm_source: effectiveAdClick.utmSource } : {}),
          ...(effectiveAdClick?.utmMedium ? { utm_medium: effectiveAdClick.utmMedium } : {}),
          ...(effectiveAdClick?.utmCampaign ? { utm_campaign: effectiveAdClick.utmCampaign } : {}),
        },
      };
      if (customEventId) {
        eventData.event_id = customEventId;
      } else if (eventId) {
        eventData.event_id = eventId;
      } else if (eventName === 'Purchase') {
        eventData.event_id = `${effectiveAdClick?.trackingCode || 'org'}_pur_${reservationId || customer.id}_${effectiveEventTime}`;
      } else if (effectiveAdClick?.trackingCode) {
        eventData.event_id = effectiveAdClick.trackingCode;
      } else {
        eventData.event_id = `org_${customer.id}_${eventName.toLowerCase()}_${Math.floor(Date.now() / 1000)}`;
      }
      // Merge customUserData dari editan admin modal JSON (prioritas admin)
      if (customUserData && typeof customUserData === 'object') {
        Object.assign(userData, customUserData);
      }

      if (value !== undefined) {
        eventData.custom_data.value = Number(value);
        eventData.custom_data.currency = currency || 'IDR';
      }

      // Resolusi New vs Repeat HANYA untuk Purchase: standard event name dipertahankan,
      // pembeda disematkan ke custom_data (advertiser dapat membuat Custom Conversion).
      if (eventName === 'Purchase') {
        const explicitRepeat = customData?.is_repeat_order;
        const explicitOrderNumber = customData?.order_number;
        const newVsRepeat = await resolveNewVsRepeatContext({
          customerId: fullCustomer?.id || customer?.id,
          tenantId,
          reservationId,
        });
        const isRepeat = typeof explicitRepeat === 'boolean' ? explicitRepeat : newVsRepeat.isRepeat;
        eventData.custom_data.is_repeat_order = isRepeat;
        eventData.custom_data.customer_type = isRepeat ? 'repeat' : 'new';
        eventData.custom_data.order_number =
          typeof explicitOrderNumber === 'number' ? explicitOrderNumber : newVsRepeat.orderNumber;
        eventData.custom_data.prior_orders_count = newVsRepeat.priorCount;
      }

      const payload = {
        data: [eventData],
      };

      const url = `${GRAPH_API_BASE_URL}/${GRAPH_API_VERSION}/${pixelId}/events?access_token=${accessToken}`;

      console.log(`[CAPI] Sending event ${eventName} to Meta for customer ${customer.phone}`);

      // 5. EXECUTE VIA CIRCUIT BREAKER
      const response: any = await capiBreaker.execute(url, payload);

      // Fallback breaker aktif (error/400/500) → event TIDAK terkirim. Jangan
      // mencatat SUCCESS palsu: fallback mengembalikan fake status 200.
      if (response?.isFallback) {
        console.error(`[CAPI FALLBACK] Event ${eventName} untuk customer ${customer.phone} TIDAK terkirim ke Meta (circuit breaker fallback aktif).`);
        return { success: false, message: 'Circuit breaker fallback: event tidak terkirim' };
      }

      if (response && response.status === 200) {
        console.log(`[CAPI SUCCESS] Successfully sent event ${eventName} to Meta CAPI.`);
        return {
          success: true,
          status: response.status,
          fbtrace_id: response.data?.fbtrace_id,
          events_received: response.data?.events_received,
          metaResponse: response.data,
          sentPayload: payload,
          pixelId,
        };
      } else {
        console.error(`[CAPI FAILURE] Meta responded with status ${response?.status || 'unknown'}:`, response?.data);
        return {
          success: false,
          status: response?.status,
          message: `Status code ${response?.status || 'unknown'}`,
          metaResponse: response?.data,
          sentPayload: payload,
          pixelId,
        };
      }
    } catch (error: any) {
      // 6. SILENT FAIL: Log error tetapi jangan throw Exception agar tidak merusak critical path caller
      console.error(`[CAPI ERROR] Conversions API failed silently:`, error.message);
      return { success: false, message: error.message };
    }
  }

  /**
   * LIVE TEST CAPI — memverifikasi Pixel ID & Access Token Meta valid tanpa
   * menunggu transaksi riil. Berbeda dari sendCapiEvent: panggilan dibuat LANGSUNG
   * ke Graph API (tanpa Circuit Breaker) agar response body error Meta yang asli
   * (mis. OAuthException code 190 = token expired) bisa dilihat admin di dashboard.
   *
   * @param params.eventName   Nama event test (default 'Contact')
   * @param params.value       Nilai konversi opsional (untuk Purchase)
   * @param params.currency    Mata uang (default 'IDR')
   * @param params.testEventCode  Kode Test Events dari Meta Events Manager (opsional).
   *                              Bila diisi, event tidak akan dihitung di Ads Manager.
   * @param params.tenantId    Tenant-aware fail-closed: env fallback HANYA untuk
   *                              DEFAULT_TENANT_ID; tenant lain tanpa DB config → skip.
   * @param params.ipAddress   IP request admin (dipakai sebagai client_ip_address test)
   * @param params.userAgent   User-Agent request admin
   */
  public async testCapiConnection(params: {
    eventName?: string;
    value?: number;
    currency?: string;
    testEventCode?: string;
    tenantId?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{
    success: boolean;
    status: number | null;
    message: string;
    metaErrorCode?: number;
    metaErrorSubcode?: number;
    responseBody?: any;
    pixelIdConfigured: boolean;
    tokenConfigured: boolean;
    source: 'db' | 'env' | 'none';
  }> {
    // 1. Resolve credentials tenant-aware — SATU pintu via resolveTenantCapiCredentials (fail-closed).
    const { pixelId, accessToken, source } = await resolveTenantCapiCredentials(params.tenantId);

    const pixelIdConfigured = Boolean(pixelId);
    const tokenConfigured = Boolean(accessToken);

    if (!pixelId || !accessToken) {
      return {
        success: false,
        status: null,
        message: `Kredensial CAPI tidak lengkap (Pixel ID ${pixelIdConfigured ? 'OK' : 'MISSING'}, Access Token ${tokenConfigured ? 'OK' : 'MISSING'}). Konfigurasi dulu di Operational Settings.`,
        pixelIdConfigured,
        tokenConfigured,
        source,
      };
    }

    // 2. Bangun payload event test minimal (event_id unik agar tidak bertabrakan dengan event riil)
    const eventName = params.eventName || 'Contact';
    const builder = new ParamBuilder();
    const testNormalizedPhone = '6288888888888';
    const hashedPhone = builder.getNormalizedAndHashedPII(testNormalizedPhone, PII_DATA_TYPE.PHONE);
    const hashedFn = builder.getNormalizedAndHashedPII('Tester', PII_DATA_TYPE.FIRST_NAME);
    const hashedCountry = builder.getNormalizedAndHashedPII('id', PII_DATA_TYPE.COUNTRY);

    const eventData: any = {
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: `capi_test_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      action_source: 'chat',
      user_data: {
        ph: hashedPhone ? [hashedPhone] : undefined,
        fn: hashedFn ? [hashedFn] : undefined,
        country: hashedCountry ? [hashedCountry] : undefined,
        client_ip_address: params.ipAddress || '127.0.0.1',
        client_user_agent: params.userAgent || 'Admin CAPI Test Connection',
      },
      custom_data: {
        traffic_source: 'test',
      },
    };
    if (params.value !== undefined && params.value !== null && !Number.isNaN(Number(params.value))) {
      eventData.custom_data.value = Number(params.value);
      eventData.custom_data.currency = params.currency || 'IDR';
    }
    if (params.testEventCode && params.testEventCode.trim()) {
      eventData.test_event_code = params.testEventCode.trim();
    }

    const payload = { data: [eventData] };
    const url = `${GRAPH_API_BASE_URL}/${GRAPH_API_VERSION}/${pixelId}/events?access_token=${accessToken}`;

    console.log(`[CAPI TEST] Sending test ${eventName} event to Meta (pixel ${pixelId})...`);

    // 3. Kirim LANGSUNG (tanpa breaker) agar error asli Meta terbaca
    try {
      const response = await axios.post(url, payload, { timeout: 10000 });
      return {
        success: true,
        status: response.status,
        message: `Event test '${eventName}' diterima Meta (HTTP ${response.status}). Kredensial valid.`,
        responseBody: response.data,
        pixelIdConfigured,
        tokenConfigured,
        source,
      };
    } catch (err: any) {
      const status = err?.response?.status || null;
      const errorBody = err?.response?.data?.error || null;
      const metaErrorCode = errorBody?.code;
      const metaErrorSubcode = errorBody?.error_subcode;

      let hint = '';
      if (metaErrorCode === 190) {
        hint = ' → Access Token invalid/expired. Rotate token di Operational Settings.';
      } else if (metaErrorCode === 100) {
        hint = ' → Kemungkinan Pixel ID salah atau parameter tidak valid.';
      } else if (metaErrorCode === 10) {
        hint = ' → Access token tidak memiliki izin untuk pixel ini.';
      }

      return {
        success: false,
        status,
        message: `${errorBody?.message || err?.message || 'Gagal menghubungi Meta Graph API'}${hint}`,
        metaErrorCode,
        metaErrorSubcode,
        responseBody: errorBody,
        pixelIdConfigured,
        tokenConfigured,
        source,
      };
    }
  }
}

export const capiService = new CapiService();
