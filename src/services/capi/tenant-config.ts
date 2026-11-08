import { decryptSecret } from '../../utils/encryption';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { TenantCapiCredentials, MetaPurchasePolicy, CapiMatchingGeo } from './types';

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

/**
 * Resolusi kredensial Meta CAPI/Pixel per-tenant — SATU-SATUNYA sumber kebenaran.
 * Dipakai oleh sendCapiEvent maupun testCapiConnection agar tidak ada drift.
 */
export async function resolveTenantCapiCredentials(tenantId?: string): Promise<TenantCapiCredentials> {
  const isDefaultTenant = tenantId === DEFAULT_TENANT_ID;

  if (tenantId && !isDefaultTenant) {
    try {
      const { prisma } = await import('../../db/client');
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
    const { prisma } = await import('../../db/client');
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

  // 1. Jika di dalam URL terdapat parameter `landing_url`
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

        const explicitSlug = parsed.searchParams.get('slug') || parsed.searchParams.get('p');
        if (explicitSlug && explicitSlug !== 'cta') {
          targetPath = `/${explicitSlug.replace(/^\/+/, '')}`;
        }

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

  // 3. Jika URL adalah path relatif
  if (domain) {
    const cleanPath = url.startsWith('/') ? url : `/${url}`;
    if (cleanPath.startsWith('/cta')) {
      try {
        const parsedDomain = new URL(domain.startsWith('http') ? domain : `https://${domain}`);
        const targetPath = parsedDomain.pathname && parsedDomain.pathname !== '/' ? parsedDomain.pathname : '/reservasionline';
        const qIdx = cleanPath.indexOf('?');
        const query = qIdx !== -1 ? cleanPath.slice(qIdx) : '';
        return `${parsedDomain.origin}${targetPath}${query}`;
      } catch {}
    }
    return `${domain}${cleanPath}`;
  }

  return undefined;
}

/**
 * Format kata kunci funnel CAPI per tenant (format_checkout / format_purchase).
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
    const { prisma } = await import('../../db/client');
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
 * Pola salam otomatis HP untuk deteksi echo (tenant-aware).
 */
export async function getTenantEchoPatterns(tenantId?: string): Promise<string[]> {
  if (!tenantId) return [];
  try {
    const { prisma } = await import('../../db/client');
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return [];
    const patterns: string[] = [];
    if (tenant.greetings_text?.trim()) patterns.push(tenant.greetings_text.trim());
    if (tenant.format_visit?.trim()) patterns.push(tenant.format_visit.trim());
    if (tenant.name?.trim()) patterns.push(tenant.name.trim());
    return patterns.filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Ekstrak nominal rupiah murni dari teks berdasarkan template formatValue tenant.
 */
export function extractValueByFormat(text: string, formatValueTemplate?: string): number | undefined {
  if (!text) return undefined;
  const template =
    formatValueTemplate && formatValueTemplate.includes('%VALUE%')
      ? formatValueTemplate.trim()
      : 'Treatment = %VALUE%';

  const parts = template.split('%VALUE%');
  const rawPrefix = parts[0] || '';
  const rawSuffix = parts[1] || '';

  const escapeRegex = (s: string) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

  const flexiblePrefix = escapeRegex(rawPrefix.trim())
    .replace(/\s+/g, '\\s*')
    .replace(/\\:|\\=/g, '[:=]?');

  const flexibleSuffix = escapeRegex(rawSuffix.trim()).replace(/\s+/g, '\\s*');

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
 * Resolusi konteks New vs Repeat untuk event `Purchase`.
 */
export async function resolveNewVsRepeatContext(params: {
  customerId?: string | null;
  tenantId?: string | null;
  reservationId?: string | null;
}): Promise<{ priorCount: number; isRepeat: boolean; orderNumber: number }> {
  const { customerId, tenantId, reservationId } = params;
  if (!customerId) return { priorCount: 0, isRepeat: false, orderNumber: 1 };
  try {
    const { prisma } = await import('../../db/client');
    const priorCount = await prisma.reservation.count({
      where: {
        customer_id: customerId,
        ...(tenantId ? { tenant_id: tenantId } : {}),
        status: { in: ['confirmed', 'en_route', 'completed'] },
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
 * Membaca kebijakan perutean event Purchase CAPI Meta untuk pelanggan repeat.
 */
export async function getTenantMetaPurchasePolicy(tenantId?: string): Promise<MetaPurchasePolicy> {
  const envPolicy = process.env.DEFAULT_META_PURCHASE_POLICY as MetaPurchasePolicy | undefined;
  const defaultPolicy: MetaPurchasePolicy =
    envPolicy === 'DUAL_EVENT' || envPolicy === 'ALL_WITH_TAG' || envPolicy === 'SUPPRESS_REPEAT'
      ? envPolicy
      : 'DUAL_EVENT';

  if (!tenantId) return defaultPolicy;
  try {
    const { prisma } = await import('../../db/client');
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    const settings = (tenant?.settings as any) || {};
    const policy = settings.metaPurchasePolicy;
    if (policy === 'DUAL_EVENT' || policy === 'ALL_WITH_TAG' || policy === 'SUPPRESS_REPEAT') {
      return policy;
    }
    return defaultPolicy;
  } catch {
    return defaultPolicy;
  }
}

const DEFAULT_CAPI_MATCHING_GEO: CapiMatchingGeo = { state: 'jawa timur', country: 'id' };

export function normalizeCapiMatchingGeo(raw: any): CapiMatchingGeo {
  const state = typeof raw?.state === 'string' ? raw.state.trim().toLowerCase() : '';
  const country = typeof raw?.country === 'string' ? raw.country.trim().toLowerCase() : '';
  return {
    state: state || DEFAULT_CAPI_MATCHING_GEO.state,
    country: country || DEFAULT_CAPI_MATCHING_GEO.country,
  };
}

/**
 * Params ADVANCED MATCHING geografis per tenant (state/provinsi & negara).
 */
export async function getTenantCapiMatchingGeo(tenantId?: string): Promise<CapiMatchingGeo> {
  if (!tenantId) return DEFAULT_CAPI_MATCHING_GEO;
  try {
    const { prisma } = await import('../../db/client');
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    return normalizeCapiMatchingGeo((tenant?.settings as any)?.capiMatchingGeo);
  } catch {
    return DEFAULT_CAPI_MATCHING_GEO;
  }
}
