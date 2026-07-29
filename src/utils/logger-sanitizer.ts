import crypto from 'crypto';

/**
 * Utilitas sanitasi log untuk me-redact / hash data PII (Personally Identifiable Information)
 * seperti nomor telepon customer, nama, dan alamat agar log produksi tidak menyimpan PII mentah.
 */
export function hashPiiPhone(phone?: string | null): string {
  if (!phone) return '[NO_PHONE]';
  // Ambil 3 digit awal (country code) + hash sisanya
  const prefix = phone.substring(0, 3);
  const hash = crypto.createHash('sha256').update(phone).digest('hex').substring(0, 8);
  return `${prefix}***${hash}`;
}

export function sanitizeLogPayload(data: any): any {
  if (!data || typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(sanitizeLogPayload);
  }

  const sanitized: any = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('phone') || lowerKey.includes('wa_id') || lowerKey.includes('chatid')) {
      sanitized[key] = typeof value === 'string' ? hashPiiPhone(value) : value;
    } else if (lowerKey.includes('apikey') || lowerKey.includes('secret') || lowerKey.includes('password') || lowerKey.includes('token')) {
      sanitized[key] = '[REDACTED_SECRET]';
    } else if (typeof value === 'object') {
      sanitized[key] = sanitizeLogPayload(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
