import axios from 'axios';
import crypto from 'crypto';
import { ParamBuilder, PII_DATA_TYPE } from 'capi-param-builder-nodejs';
import { CircuitBreaker } from '../utils/circuit-breaker';
import { GRAPH_API_VERSION, GRAPH_API_BASE_URL } from '../integrations/whatsapp/graph.constants';
import { decryptSecret } from '../utils/encryption';

// Inisialisasi Circuit Breaker untuk CAPI calls
export const capiBreaker = new CircuitBreaker(
  async (url: string, payload: any) => {
    return axios.post(url, payload, { timeout: 5000 });
  },
  async () => {
    return {
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
    const q = treatmentDetail.toLowerCase();
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
 * Format kata kunci funnel CAPI per tenant (format_checkout / format_purchase).
 * Tenant-aware: dibaca dari kolom tenant DB, fallback ke nilai default bila
 * tenant tidak punya config / DB offline (konsisten dengan pola credentials CAPI).
 */
export async function getTenantCapiFormats(tenantId?: string): Promise<{
  formatCheckout: string;
  formatPurchase: string;
}> {
  const defaults = {
    formatCheckout: 'list untuk reservasi :',
    formatPurchase: 'Payment',
  };
  if (!tenantId) return defaults;
  try {
    const { prisma } = await import('../db/client');
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    return {
      formatCheckout: tenant?.format_checkout?.trim() || defaults.formatCheckout,
      formatPurchase: tenant?.format_purchase?.trim() || defaults.formatPurchase,
    };
  } catch {
    return defaults;
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
  }): Promise<{ success: boolean; message?: string }> {
    const { eventName, customer, adClick, value, currency, tenantId, customData, eventTime } = params;

    const isPaid = !!adClick;

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
          else console.warn(`[CAPI WARNING] Token CAPI tenant ${tenantId} gagal didecrypt, pakai env fallback.`);
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
      const rawPhone = customer.phone || adClick?.phone || '';
      const normalizedPhone = normalizePhoneToE164(rawPhone);
      const hashedPhone = builder.getNormalizedAndHashedPII(normalizedPhone, PII_DATA_TYPE.PHONE);

      // Advanced Matching: Nama Depan & Nama Belakang dari Customer / AdClick
      let hashedFn: string | undefined;
      let hashedLn: string | undefined;
      const rawName = (customer.name || customer.pushName || adClick?.name || '').trim();
      if (rawName) {
        const parts = rawName.split(/\s+/);
        const firstName = parts[0];
        const lastName = parts.length > 1 ? parts.slice(1).join(' ') : firstName;
        if (firstName) {
          hashedFn = builder.getNormalizedAndHashedPII(firstName, PII_DATA_TYPE.FIRST_NAME) || undefined;
        }
        if (lastName) {
          hashedLn = builder.getNormalizedAndHashedPII(lastName, PII_DATA_TYPE.LAST_NAME) || undefined;
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
      if (adClick?.fbp) mockCookies._fbp = adClick.fbp;
      if (adClick?.fbc) mockCookies._fbc = adClick.fbc;
      if (adClick?.ipAddress) mockCookies._fbi = adClick.ipAddress;

      const mockQueries: Record<string, string> = {};
      if (adClick?.fbclid) mockQueries.fbclid = adClick.fbclid;

      let host = 'localhost';
      try {
        if (adClick?.landingUrl) {
          host = new URL(adClick.landingUrl).hostname;
        }
      } catch {}

      builder.processRequest(
        host,
        mockQueries,
        mockCookies,
        null, // referer
        adClick?.ipAddress || null, // xForwardedFor
        adClick?.ipAddress || null // remoteAddress
      );

      const fbc = builder.getFbc() || adClick?.fbc;
      const fbp = builder.getFbp() || adClick?.fbp;
      const clientIp = builder.getClientIpAddress() || adClick?.ipAddress;

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
      if (adClick?.userAgent) {
        userData.client_user_agent = adClick.userAgent;
      }
      if (fbc) {
        userData.fbc = fbc;
      }
      if (fbp) {
        userData.fbp = fbp;
      }

      // 4. CONSTRUCT EVENT DATA payload
      //    event_id = trackingCode ad click (auto-derive) atau synthetic ID untuk organic
      const eventData: any = {
        event_name: eventName,
        // eventTime opsional (Unix seconds) → dipakai moderator saat mengirim
        // event Purchase historis; default = waktu saat ini.
        event_time: eventTime ?? Math.floor(Date.now() / 1000),
        event_source_url: adClick?.landingUrl || undefined,
        action_source: 'chat',
        user_data: userData,
        custom_data: {
          ...(customData || {}),
          traffic_source: isPaid ? 'paid' : 'organic',
          ...(adClick?.utmSource ? { utm_source: adClick.utmSource } : {}),
          ...(adClick?.utmMedium ? { utm_medium: adClick.utmMedium } : {}),
          ...(adClick?.utmCampaign ? { utm_campaign: adClick.utmCampaign } : {}),
        },
      };
      if (adClick?.trackingCode) {
        eventData.event_id = adClick.trackingCode;
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
      const response = await capiBreaker.execute(url, payload);

      if (response && response.status === 200) {
        console.log(`[CAPI SUCCESS] Successfully sent event ${eventName} to Meta CAPI.`);
        return { success: true };
      } else {
        console.error(`[CAPI FAILURE] Meta responded with status ${response?.status || 'unknown'}:`, response?.data);
        return { success: false, message: `Status code ${response?.status || 'unknown'}` };
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
    const eventData: any = {
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: `capi_test_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      action_source: 'website',
      user_data: {
        client_ip_address: params.ipAddress || undefined,
        client_user_agent: params.userAgent || 'Admin CAPI Test',
      },
    };
    if (params.value !== undefined && params.value !== null && !Number.isNaN(Number(params.value))) {
      eventData.custom_data = {
        value: Number(params.value),
        currency: params.currency || 'IDR',
      };
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
