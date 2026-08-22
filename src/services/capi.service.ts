import axios from 'axios';
import crypto from 'crypto';
import { ParamBuilder, PII_DATA_TYPE } from 'capi-param-builder-nodejs';
import { CircuitBreaker } from '../utils/circuit-breaker';
import { GRAPH_API_VERSION, GRAPH_API_BASE_URL } from '../integrations/whatsapp/graph.constants';
import { decryptSecret } from '../utils/encryption';
import { isDummyOrTestContact } from '../utils/dummy-filter';
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
export async function resolveTreatmentValue(treatmentDetail: string | null | undefined): Promise<number | undefined> {
  if (!treatmentDetail || !treatmentDetail.trim()) return undefined;
  try {
    const { treatmentCatalogService } = await import('./treatment-catalog.service');
    // Filter out template placeholder phrases (misal: "Mohon bisa diisi Bunda 😊")
    let cleanDetail = treatmentDetail
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\([^)]*\)/g, '')
      .split('|')
      .map(p => p.trim())
      .filter(p => {
        const lower = p.toLowerCase();
        return (
          !lower.includes('mohon bisa diisi') &&
          !lower.includes('bisa diisi bunda') &&
          !lower.includes('jika ada') &&
          !lower.includes('jika hamil') &&
          !lower.includes('opsional')
        );
      })
      .join(' ');

    const q = (cleanDetail || treatmentDetail).toLowerCase();
    const services = treatmentCatalogService.getAllServices();
    const exact = services.find((s) => {
      const cleanName = s.name.toLowerCase().replace(/\s*\([^)]*\)/g, '').trim();
      return cleanName && (q.includes(cleanName) || cleanName.includes(q));
    });
    const target = exact || services.find((s) => q.includes(s.name.toLowerCase()));
    if (target) {
      return target.promoPrice ?? target.originalPrice;
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
  /**
   * Mengirimkan server-side event ke Meta Conversions API (CAPI).
   * Tenant-aware: pixelId & accessToken diambil dari kolom tenant DB
   * (meta_pixel_id / meta_capi_access_token), fallback env FB_PIXEL_ID /
   * FB_CAPI_ACCESS_TOKEN saat tenant tidak punya config.
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
    const { eventName, customer, adClick, value, currency, tenantId, customData, eventTime } = params;

    // 1. Meta CAPI Sandbox / Dummy Test Guard (Pencegahan pencemaran data conversion pixel)
    if (customer?.is_sandbox_test || isDummyOrTestContact(customer?.phone, customer?.name, customer?.is_sandbox_test)) {
      console.log(`[CAPI GUARD] Skipped sending ${eventName} to Meta CAPI for sandbox/dummy contact: ${customer?.phone}`);
      return { success: false, message: 'Skipped: Sandbox or dummy test contact' };
    }

    let effectiveAdClick = adClick || (customer as any)?.adClick;
    if (!effectiveAdClick && customer?.id) {
      try {
        const { prisma } = await import('../db/client');
        effectiveAdClick = await prisma.adClick.findFirst({
          where: { customerId: customer.id },
          orderBy: { matchedAt: 'desc' },
        });
      } catch {}
    }

    const isPaid = !!effectiveAdClick;

    // 2. Tenant-aware credentials (DB menang, env fallback)
    let pixelId = process.env.FB_PIXEL_ID;
    let accessToken = process.env.FB_CAPI_ACCESS_TOKEN;
    if (tenantId) {
      try {
        const { prisma } = await import('../db/client');
        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
        if (tenant?.meta_pixel_id) pixelId = tenant.meta_pixel_id;
        if (tenant?.meta_capi_access_token) {
          const decrypted = decryptCapiToken(tenant.meta_capi_access_token);
          if (decrypted) accessToken = decrypted;
          else {
            // Tampilkan prefix termask (mis. "EAA…abcd") supaya ops tahu apakah
            // token DB plaintext legacy valid atau korup/salah format.
            const token = tenant.meta_capi_access_token;
            const mask = token.length > 10 ? `${token.substring(0, 4)}…${token.slice(-4)}` : '(token sangat pendek)';
            console.warn(`[CAPI WARNING] Token CAPI tenant ${tenantId} gagal didecrypt (${mask}), pakai env fallback.`);
          }
        }
      } catch (err) {
        console.warn(`[CAPI WARNING] Gagal baca config CAPI tenant ${tenantId}, pakai env fallback:`, (err as Error).message);
      }
    }

    if (!pixelId || !accessToken) {
      console.warn(`[CAPI WARNING] CAPI credentials missing: FB_PIXEL_ID=${pixelId ? 'configured' : 'missing'}, FB_CAPI_ACCESS_TOKEN=${accessToken ? 'configured' : 'missing'}`);
      return { success: false, message: 'Skipped: Credentials missing' };
    }

    try {
      // 2. NORMALIZE & HASH PII (Nomor HP, Nama, External ID, Kota, Zipcode, Country) menggunakan Meta ParamBuilder
      const builder = new ParamBuilder();
      const rawPhone = customer.phone || effectiveAdClick?.phone || '';
      const normalizedPhone = normalizePhoneToE164(rawPhone);
      const hashedPhone = builder.getNormalizedAndHashedPII(normalizedPhone, PII_DATA_TYPE.PHONE);

      // Advanced Matching: Nama Depan & Nama Belakang dari Customer / AdClick
      let hashedFn: string | undefined;
      let hashedLn: string | undefined;
      const rawName = (customer.name || customer.pushName || effectiveAdClick?.name || '').trim();
      if (rawName) {
        // Strip honorifics seperti "Bunda", "Ibu", "Mama", "Mom" di awal nama
        const cleanedName = rawName.replace(/^(?:bunda|ibu|mama|mom|ny|ny\.|mrs|mrs\.)\s+/i, '').trim();
        const lowerClean = cleanedName.toLowerCase();
        const isGenericAlone = ['bunda', 'ibu', 'mama', 'mom', 'pasien', 'customer', '-'].includes(lowerClean);
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
      const rawExternalId = customer.id ? String(customer.id) : undefined;
      if (rawExternalId) {
        hashedExternalId = builder.getNormalizedAndHashedPII(rawExternalId, PII_DATA_TYPE.EXTERNAL_ID) || undefined;
      }

      // Advanced Matching: City (Kota), Zipcode (Kode Pos), & Country (Negara)
      let hashedCity: string | undefined;
      let hashedZip: string | undefined;
      let hashedCountry: string | undefined;
      const rawCity = (customer.kota || customer.pending_kota || '').trim();
      if (rawCity) {
        hashedCity = builder.getNormalizedAndHashedPII(rawCity, PII_DATA_TYPE.CITY) || undefined;
      }
      const rawZip = (customer.zipcode || customer.pending_zipcode || '').trim();
      if (rawZip) {
        hashedZip = builder.getNormalizedAndHashedPII(rawZip, PII_DATA_TYPE.ZIP_CODE) || undefined;
      }
      hashedCountry = builder.getNormalizedAndHashedPII('id', PII_DATA_TYPE.COUNTRY) || undefined;

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

      const fbc = builder.getFbc() || effectiveAdClick?.fbc;
      const fbp = builder.getFbp() || effectiveAdClick?.fbp;
      const clientIp = builder.getClientIpAddress() || effectiveAdClick?.ipAddress;

      // 3. CONSTRUCT USER DATA (Meta specs: hash phone/name/external_id/city/zip/country, keep IP/UA/Cookies clean)
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
      if (hashedZip) {
        userData.zp = [hashedZip];
      }
      if (hashedCountry) {
        userData.country = [hashedCountry];
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

      const eventData: any = {
        event_name: eventName,
        // eventTime opsional (Unix seconds) → dipakai moderator saat mengirim
        // event Purchase historis; default = waktu saat ini.
        event_time: eventTime ?? Math.floor(Date.now() / 1000),
        event_source_url: eventSourceUrl,
        action_source: 'chat',
        user_data: userData,
        custom_data: {
          ...(customData || {}),
          traffic_source: isPaid ? 'paid' : 'organic',
          ...(effectiveAdClick?.utmSource ? { utm_source: effectiveAdClick.utmSource } : {}),
          ...(effectiveAdClick?.utmMedium ? { utm_medium: effectiveAdClick.utmMedium } : {}),
          ...(effectiveAdClick?.utmCampaign ? { utm_campaign: effectiveAdClick.utmCampaign } : {}),
        },
      };
      if (effectiveAdClick?.trackingCode) {
        eventData.event_id = effectiveAdClick.trackingCode;
      } else {
        eventData.event_id = `org_${customer.id}_${eventName.toLowerCase()}_${Math.floor(Date.now() / 1000)}`;
      }

      if (value !== undefined) {
        eventData.custom_data.value = Number(value);
        eventData.custom_data.currency = currency || 'IDR';
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
   * @param params.tenantId    Tenant-aware: fallback env FB_PIXEL_ID / FB_CAPI_ACCESS_TOKEN
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
    // 1. Resolve credentials tenant-aware (DB menang, env fallback) — sama dengan sendCapiEvent
    let pixelId = process.env.FB_PIXEL_ID;
    let accessToken = process.env.FB_CAPI_ACCESS_TOKEN;
    let source: 'db' | 'env' | 'none' = 'none';

    if (params.tenantId) {
      try {
        const { prisma } = await import('../db/client');
        const tenant = await prisma.tenant.findUnique({ where: { id: params.tenantId } });
        if (tenant?.meta_pixel_id) pixelId = tenant.meta_pixel_id;
        if (tenant?.meta_capi_access_token) {
          const decrypted = decryptCapiToken(tenant.meta_capi_access_token);
          if (decrypted) accessToken = decrypted;
        }
        if (tenant?.meta_pixel_id || tenant?.meta_capi_access_token) source = 'db';
      } catch (err) {
        console.warn(`[CAPI TEST WARNING] Gagal baca config CAPI tenant ${params.tenantId}, pakai env fallback:`, (err as Error).message);
      }
    }
    if (source === 'none' && process.env.FB_PIXEL_ID && process.env.FB_CAPI_ACCESS_TOKEN) {
      source = 'env';
    }

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
