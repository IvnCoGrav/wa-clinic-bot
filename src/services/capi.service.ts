import axios from 'axios';
import crypto from 'crypto';
import { CircuitBreaker } from '../utils/circuit-breaker';

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

export class CapiService {
  /**
   * Mengirimkan server-side event ke Meta Conversions API (CAPI)
   */
  public async sendCapiEvent(params: {
    eventName: string;
    customer: any;
    adClick?: any;
    value?: number;
    currency?: string;
  }): Promise<{ success: boolean; message?: string }> {
    const { eventName, customer, adClick, value, currency } = params;

    // 1. GUARD CLAUSE: Jika tidak ada data adClick, lewatkan pemanggilan (CAPI tidak dikirim tanpa data attribution)
    if (!adClick) {
      console.log(`[CAPI] Skipping event ${eventName} for customer ${customer.phone}: No adClick attribution data available.`);
      return { success: false, message: 'Skipped: No attribution data' };
    }

    const pixelId = process.env.FB_PIXEL_ID;
    const accessToken = process.env.FB_CAPI_ACCESS_TOKEN;

    if (!pixelId || !accessToken) {
      console.warn(`[CAPI WARNING] CAPI credentials missing: FB_PIXEL_ID=${pixelId ? 'configured' : 'missing'}, FB_CAPI_ACCESS_TOKEN=${accessToken ? 'configured' : 'missing'}`);
      return { success: false, message: 'Skipped: Credentials missing' };
    }

    try {
      // 2. NORMALIZE & HASH PII (Nomor HP)
      const rawPhone = customer.phone || adClick.phone || '';
      const normalizedPhone = normalizePhoneToE164(rawPhone);
      const hashedPhone = sha256Hash(normalizedPhone);

      // 3. CONSTRUCT USER DATA (Meta specs: hash phone, keep IP/UA/Cookies clean)
      const userData: any = {};
      if (hashedPhone) {
        userData.ph = [hashedPhone];
      }
      if (adClick.ipAddress) {
        userData.client_ip_address = adClick.ipAddress;
      }
      if (adClick.userAgent) {
        userData.client_user_agent = adClick.userAgent;
      }
      if (adClick.fbc) {
        userData.fbc = adClick.fbc;
      }
      if (adClick.fbp) {
        userData.fbp = adClick.fbp;
      }

      // 4. CONSTRUCT EVENT DATA payload
      const eventData: any = {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_source_url: adClick.landingUrl || undefined,
        action_source: 'chat',
        user_data: userData,
      };

      if (value !== undefined) {
        eventData.custom_data = {
          value: Number(value),
          currency: currency || 'IDR',
        };
      }

      const payload = {
        data: [eventData],
      };

      const url = `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${accessToken}`;

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
