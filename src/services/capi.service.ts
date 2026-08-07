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
  }): Promise<{ success: boolean; message?: string }> {
    const { eventName, customer, adClick, value, currency, tenantId, customData } = params;

    // 1. GUARD CLAUSE: Jika tidak ada data adClick, lewatkan pemanggilan (CAPI tidak dikirim tanpa data attribution)
    if (!adClick) {
      console.log(`[CAPI] Skipping event ${eventName} for customer ${customer.phone}: No adClick attribution data available.`);
      return { success: false, message: 'Skipped: No attribution data' };
    }

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
      // 2. NORMALIZE & HASH PII (Nomor HP, Nama, External ID) menggunakan Meta ParamBuilder
      const builder = new ParamBuilder();
      const rawPhone = customer.phone || adClick.phone || '';
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

      // Gunakan server-side ParamBuilder untuk memproses parameter browser/IP & menambahkan appendix
      const mockCookies: Record<string, string> = {};
      if (adClick.fbp) mockCookies._fbp = adClick.fbp;
      if (adClick.fbc) mockCookies._fbc = adClick.fbc;
      if (adClick.ipAddress) mockCookies._fbi = adClick.ipAddress;

      const mockQueries: Record<string, string> = {};
      if (adClick.fbclid) mockQueries.fbclid = adClick.fbclid;

      let host = 'localhost';
      try {
        if (adClick.landingUrl) {
          host = new URL(adClick.landingUrl).hostname;
        }
      } catch {}

      builder.processRequest(
        host,
        mockQueries,
        mockCookies,
        null, // referer
        adClick.ipAddress, // xForwardedFor
        adClick.ipAddress // remoteAddress
      );

      const fbc = builder.getFbc() || adClick.fbc;
      const fbp = builder.getFbp() || adClick.fbp;
      const clientIp = builder.getClientIpAddress() || adClick.ipAddress;

      // 3. CONSTRUCT USER DATA (Meta specs: hash phone/name/external_id, keep IP/UA/Cookies clean)
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
      if (clientIp) {
        userData.client_ip_address = clientIp;
      }
      if (adClick.userAgent) {
        userData.client_user_agent = adClick.userAgent;
      }
      if (fbc) {
        userData.fbc = fbc;
      }
      if (fbp) {
        userData.fbp = fbp;
      }

      // 4. CONSTRUCT EVENT DATA payload
      //    event_id = trackingCode ad click (auto-derive). Meta menduplikasi event yang
      //    memiliki event_id sama, jadi event yang sama dikirim 2x (mis. Purchase dari
      //    keyword "Payment" + dari admin confirm) tidak akan double-count, dan Pixel
      //    server-side (eventID) ter-dedup dengan CAPI.
      const eventData: any = {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_source_url: adClick.landingUrl || undefined,
        action_source: 'chat',
        user_data: userData,
      };
      if (adClick.trackingCode) {
        eventData.event_id = adClick.trackingCode;
      }

      if (value !== undefined) {
        eventData.custom_data = {
          value: Number(value),
          currency: currency || 'IDR',
        };
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
}

export const capiService = new CapiService();
