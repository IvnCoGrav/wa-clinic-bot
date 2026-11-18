/**
 * audit-payload-sanitizer.ts
 * Task 3.1 (A-015a): Sanitizer kanonis untuk payload AuditLog.
 * Meredaksi PII (nomor HP, alamat fisik, raw text/prompt, API key)
 * tanpa merusak data komersial (value, currency, event_id, status, trace_id).
 */

import { maskPhoneWithTenantSuffix } from '../utils/pii-masker';
import { maskName } from './capi.helpers';

const PII_REDACTED_TEXT = '[REDACTED]';

/**
 * Sanitasi rekursif untuk objek payload audit log
 */
export function sanitizeAuditPayload(action: string, payload: any): any {
  if (payload === null || payload === undefined) {
    return payload;
  }

  // Jika payload adalah string, coba parse sebagai JSON
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      const sanitized = sanitizeAuditPayload(action, parsed);
      return JSON.stringify(sanitized);
    } catch {
      // Jika string biasa bukan JSON
      return payload;
    }
  }

  if (Array.isArray(payload)) {
    return payload.map(item => sanitizeAuditPayload(action, item));
  }

  if (typeof payload === 'object') {
    const result: Record<string, any> = {};

    for (const [key, val] of Object.entries(payload)) {
      const lowerKey = key.toLowerCase();

      // 1. Redaksi Phone
      if (
        lowerKey === 'phone' ||
        lowerKey === 'targetphone' ||
        lowerKey === 'phonenumber' ||
        lowerKey === 'customerphone'
      ) {
        result[key] = typeof val === 'string' ? maskPhoneWithTenantSuffix(val) : val;
        continue;
      }

      // 2. Redaksi Alamat
      if (
        lowerKey === 'address' ||
        lowerKey === 'customeraddress' ||
        lowerKey === 'alamat' ||
        lowerKey === 'address_text'
      ) {
        result[key] = val ? PII_REDACTED_TEXT : val;
        continue;
      }

      // 3. Redaksi Raw Text / Prompt / WAHA raw payload
      if (
        lowerKey === 'rawtext' ||
        lowerKey === 'raw_text' ||
        lowerKey === 'prompt' ||
        lowerKey === 'rawprompt' ||
        lowerKey === 'wahapayload' ||
        lowerKey === 'rawpayload'
      ) {
        result[key] = val ? PII_REDACTED_TEXT : val;
        continue;
      }

      // 4. Redaksi API Key / Secret / Token
      if (
        lowerKey === 'apikey' ||
        lowerKey === 'api_key' ||
        lowerKey === 'secret' ||
        lowerKey === 'token' ||
        lowerKey === 'accesstoken'
      ) {
        result[key] = val ? PII_REDACTED_TEXT : val;
        continue;
      }

      // 5. Mask Name jika relevan
      if (
        lowerKey === 'name' ||
        lowerKey === 'customername' ||
        lowerKey === 'patientname'
      ) {
        result[key] = typeof val === 'string' ? maskName(val) : val;
        continue;
      }

      // 6. Rekursi untuk child objects
      if (val !== null && typeof val === 'object') {
        result[key] = sanitizeAuditPayload(action, val);
      } else {
        // Pertahankan field asli (termasuk nilai komersial: value, price, currency, event_id, dll)
        result[key] = val;
      }
    }

    return result;
  }

  return payload;
}
