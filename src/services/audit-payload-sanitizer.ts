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
 * Sanitasi rekursif untuk objek payload audit log.
 * - Menggunakan ancestor-stack WeakSet (add sebelum rekursi, delete di finally)
 *   agar objek yang dipakai berulang non-circular tidak salah ditandai [CIRCULAR].
 * - Mengonversi BigInt -> string, Date -> ISO string, Error -> { name, code } tanpa message PII.
 * - Parsing JSON string hanya berlaku di level atas (top-level) dan mengembalikan objek tersanitasi
 *   supaya AuditService tidak melakukan double-encode JSON.stringify.
 */
function sanitizeNode(action: string, payload: any, ancestors: WeakSet<object>): any {
  if (payload === null || payload === undefined) {
    return payload;
  }

  if (typeof payload === 'bigint') {
    return payload.toString();
  }

  if (payload instanceof Date) {
    return Number.isNaN(payload.getTime()) ? '[INVALID_DATE]' : payload.toISOString();
  }

  if (payload instanceof Error) {
    const code = (payload as any).code;
    return code !== undefined ? { name: payload.name, code } : { name: payload.name };
  }

  if (typeof payload !== 'object') {
    return payload;
  }

  if (ancestors.has(payload)) {
    return '[CIRCULAR]';
  }

  ancestors.add(payload);
  try {
    if (Array.isArray(payload)) {
      return payload.map((item) => sanitizeNode(action, item, ancestors));
    }

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
        result[key] = typeof val === 'string' ? maskPhoneWithTenantSuffix(val) : sanitizeNode(action, val, ancestors);
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
        result[key] = typeof val === 'string' ? maskName(val) : sanitizeNode(action, val, ancestors);
        continue;
      }

      // 6. Rekursi penuh (termasuk BigInt, Date, Error, Array, child object; string bersarang tetap string)
      result[key] = sanitizeNode(action, val, ancestors);
    }

    return result;
  } finally {
    ancestors.delete(payload);
  }
}

export function sanitizeAuditPayload(action: string, payload: any): any {
  if (payload === null || payload === undefined) {
    return payload;
  }

  // Parsing string JSON hanya di level atas (A-011 / N-8) agar audit tidak double-encode
  // dan string bersarang di dalam objek tidak berubah tipe secara diam-diam.
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      if (parsed !== null && typeof parsed === 'object') {
        return sanitizeNode(action, parsed, new WeakSet<object>());
      }
      return payload;
    } catch {
      return payload;
    }
  }

  return sanitizeNode(action, payload, new WeakSet<object>());
}
