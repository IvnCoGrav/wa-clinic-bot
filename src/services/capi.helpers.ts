import crypto from 'crypto';
import { decryptSecret } from '../utils/encryption';
import { escapeRegex } from '../utils/regex-escape';

/**
 * capi.helpers.ts — Helper MURNI Meta Conversions API (tanpa I/O DB/jaringan).
 *
 * Dipisahkan dari `capi.service.ts` agar orkestrasi pengiriman event tidak
 * bercampur dengan fungsi transformasi nilai/URL/hash yang deterministik.
 * `capi.service.ts` me-re-export simbol di sini supaya pemanggil lama tetap valid.
 */

/**
 * Memvalidasi apakah alamat IP merupakan IP publik yang valid.
 * Menolak localhost (127.0.0.1, ::1), rentang privat RFC 1918 (10.*, 172.16-31.*, 192.168.*),
 * link-local (169.254.*), CGNAT (100.64-127.*), dan IPv6 privat/ULA.
 */
export function isPublicIp(ip?: string | null): boolean {
  if (!ip || typeof ip !== 'string') return false;
  const clean = ip.trim();
  if (!clean || clean === '127.0.0.1' || clean === '::1' || clean === 'localhost') return false;
  // RFC 1918 / Private IPv4
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.|100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.)/.test(clean)) {
    return false;
  }
  // IPv6 ULA / link-local / loopback
  if (/^(fc00|fd00|fe80)/i.test(clean)) return false;
  return true;
}

/**
 * Mask nama untuk privasi log.
 * Menyamarkan huruf tengah setiap kata. Misal: "Siti Aminah" -> "S**i A****h"
 */
export function maskName(name?: string | null): string {
  if (!name || !name.trim()) return '(no-name)';
  return name
    .trim()
    .split(/\s+/)
    .map((word) => {
      if (word.length <= 2) return word.slice(0, 1) + '*';
      return word.slice(0, 1) + '*'.repeat(Math.max(1, word.length - 2)) + word.slice(-1);
    })
    .join(' ');
}

/**
 * Memvalidasi dan menormalisasi nominal CAPI (Fase 2.1):
 * - Tolak null/undefined/''/NaN/Infinity/negatif
 * - Format ribuan Indonesia "90.000" diubah menjadi 90000
 * - Nilai 0 hanya diizinkan bila allowZero = true
 */
export function parseCapiValue(v: unknown, allowZero: boolean = false): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  let parsed: number;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (!trimmed) return undefined;
    if (/^\d{1,3}(\.\d{3})+$/.test(trimmed)) {
      parsed = Number(trimmed.replace(/\./g, ''));
    } else {
      parsed = Number(trimmed);
    }
  } else if (typeof v === 'number') {
    parsed = v;
  } else {
    return undefined;
  }

  if (!Number.isFinite(parsed) || parsed < 0) {
    console.warn(`[CAPI VALUE SKIP] Nilai invalid atau negatif diabaikan: ${v}`);
    return undefined;
  }

  if (parsed === 0 && !allowZero) {
    console.warn(`[CAPI VALUE SKIP] Nilai 0 tanpa flag allowZero diabaikan: ${v}`);
    return undefined;
  }

  return parsed;
}

/**
 * Format string _fbc sesuai standar resmi Meta Conversions API:
 * fb.1.<creationTimeInMs>.<fbclid>
 */
export function formatMetaFbc(fbclidOrFbc: string | null | undefined, creationTimeMs: number = Date.now()): string | undefined {
  if (!fbclidOrFbc || !fbclidOrFbc.trim()) return undefined;
  const trimmed = fbclidOrFbc.trim();
  if (trimmed.startsWith('fb.1.')) {
    const parts = trimmed.split('.');
    if (parts.length >= 4 && Number.isFinite(Number(parts[2]))) {
      return trimmed;
    }
  }
  const ts = Math.floor(creationTimeMs);
  const cleanId = trimmed.replace(/^fb\.\d+\.[^.]+\./, '');
  return `fb.1.${ts}.${cleanId}`;
}

/**
 * Menghasilkan hash SHA-256 lowercase dari string input
 */
export function sha256Hash(text: string): string {
  if (!text) return '';
  return crypto.createHash('sha256').update(text.trim().toLowerCase()).digest('hex');
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
    const cleanDomain = domain.startsWith('http://') || domain.startsWith('https://')
      ? domain
      : `https://${domain}`;
    if (cleanPath.startsWith('/cta')) {
      try {
        const parsedDomain = new URL(cleanDomain);
        const targetPath = (parsedDomain.pathname && parsedDomain.pathname !== '/') ? parsedDomain.pathname : '/reservasionline';
        const qIdx = cleanPath.indexOf('?');
        const query = qIdx !== -1 ? cleanPath.slice(qIdx) : '';
        return `${parsedDomain.origin}${targetPath}${query}`;
      } catch {}
    }
    return `${cleanDomain}${cleanPath}`;
  }
  // Anti-hardcode domain bisnis: tanpa domain tenant ATAU fallback di
  // `Tenant.settings.capiFallbackLandingDomain`, JANGAN mengarang-nomor domain.
  // Caller memutuskan sendiri (event_source_url dihilangkan bila tidak ada sumber).
  return undefined;
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

export interface CapiMatchingGeo {
  state: string;
  country: string;
}

export const DEFAULT_CAPI_MATCHING_GEO: CapiMatchingGeo = { state: 'jawa timur', country: 'id' };

export function normalizeCapiMatchingGeo(raw: any): CapiMatchingGeo {
  const state = typeof raw?.state === 'string' ? raw.state.trim().toLowerCase() : '';
  const country = typeof raw?.country === 'string' ? raw.country.trim().toLowerCase() : '';
  return {
    state: state || DEFAULT_CAPI_MATCHING_GEO.state,
    country: country || DEFAULT_CAPI_MATCHING_GEO.country,
  };
}

/**
 * event_id Purchase deterministik dari kunci bisnis imutabel.
 * Retry / force-resend / perubahan purchase_occurred_at TIDAK mengubah id,
 * sehingga dedupe Meta benar-benar idempoten.
 */
export function buildDeterministicPurchaseEventId(tenantId: string | undefined, reservationId: string): string {
  return `pur_${tenantId || 'org'}_${reservationId}`;
}

/**
 * Format event_id LAMA (belum dimigrasi): {trackingCode}_pur_{res|cus}_{eventTime}.
 * Dipakai dispatch untuk reservasi yang sudah pernah terkirim SEBELUM pembaruan ini,
 * agar force-resend memakai ulang event_id pengiriman pertama (bukan membuat id baru).
 */
export function buildLegacyPurchaseEventId(params: {
  trackingCode?: string | null;
  reservationId?: string | null;
  customerId: string;
  eventTimeSec: number;
}): string {
  const subject = params.reservationId || params.customerId;
  return `${params.trackingCode || 'org'}_pur_${subject}_${params.eventTimeSec}`;
}

/**
 * Kontrak Structured Log [CAPI EVENT] (Task 0.3)
 * Wajib bebas PII (tanpa nomor HP, nama, alamat, IP, atau user agent).
 */
export interface StructuredCapiEventLog {
  event: string;
  event_id: string;
  tenant: string;
  status: number | null;
  events_received: number;
  fbtrace_id: string | null;
  source: string;
  skipped: boolean;
  degraded: boolean;
  reason?: string;
}

export function formatStructuredCapiEventLog(entry: StructuredCapiEventLog): string {
  return `[CAPI EVENT] ${JSON.stringify(entry)}`;
}

export function parseStructuredCapiEventLog(line: string): StructuredCapiEventLog | null {
  const prefix = '[CAPI EVENT] ';
  const idx = line.indexOf(prefix);
  if (idx === -1) return null;
  try {
    return JSON.parse(line.slice(idx + prefix.length));
  } catch {
    return null;
  }
}

