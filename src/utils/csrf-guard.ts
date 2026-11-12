/**
 * csrf-guard.ts — Gerbang anti-CSRF untuk endpoint state-changing berbasis cookie.
 *
 * S-008: endpoint `restore` menulis cookie sesi (state-changing) sehingga wajib:
 * 1. Header AJAX `X-Requested-With: XMLHttpRequest` (form lintas situs tidak bisa
 *    mengirim header ini tanpa CORS preflight yang akan ditolak).
 * 2. Origin/Referer (bila dikirim browser) harus sehost dengan request, atau
 *    terdaftar di `ADMIN_ALLOWED_ORIGINS` (dipisah koma) untuk deployment
 *    dashboard terpisah.
 *
 * Tanpa Origin/Referer (klien non-browser, mis. skrip operasional) request tetap
 * butuh header AJAX — tidak ada jalur form lintas situs.
 */

export interface CsrfGuardResult {
  ok: boolean;
  code?: 'CSRF_HEADER_REQUIRED' | 'CSRF_ORIGIN_MISMATCH';
  reason?: string;
}

type HeaderBag = Record<string, string | string[] | undefined>;

function firstHeader(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

/** Normalisasi host:port (lowercase, tanpa default port 80/443). */
export function normalizeHost(raw: string): string {
  let host = raw.trim().toLowerCase();
  if (!host) return '';
  // Jika berupa URL penuh, ambil host-nya.
  if (host.includes('://')) {
    try {
      host = new URL(host).host.toLowerCase();
    } catch {
      return '';
    }
  }
  host = host.replace(/:\d+$/, (m) => {
    return m === ':80' || m === ':443' ? '' : m;
  });
  return host;
}

function allowedOrigins(): string[] {
  return String(process.env.ADMIN_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => normalizeHost(s))
    .filter(Boolean);
}

/**
 * Memeriksa header AJAX + kesamaan origin. `headers` adalah `request.headers`.
 */
export function checkStateChangingCsrf(headers: HeaderBag): CsrfGuardResult {
  const ajaxHeader = firstHeader(headers['x-requested-with']).trim();
  if (ajaxHeader.toLowerCase() !== 'xmlhttprequest') {
    return {
      ok: false,
      code: 'CSRF_HEADER_REQUIRED',
      reason: 'Permintaan ini wajib dikirim melalui AJAX (header X-Requested-With).',
    };
  }

  const requestHost = normalizeHost(
    firstHeader(headers['x-forwarded-host']) || firstHeader(headers['host'])
  );
  if (!requestHost) {
    // Tanpa host (rare, mis. inject test) — header AJAX sudah cukup.
    return { ok: true };
  }

  const originHeader = firstHeader(headers['origin']);
  const refererHeader = firstHeader(headers['referer']);
  const candidates = [originHeader, refererHeader].filter(Boolean);
  if (candidates.length === 0) return { ok: true };

  const allowlist = allowedOrigins();
  for (const candidate of candidates) {
    const candidateHost = normalizeHost(candidate);
    if (!candidateHost) continue;
    if (candidateHost === requestHost) continue;
    if (allowlist.includes(candidateHost)) continue;
    return {
      ok: false,
      code: 'CSRF_ORIGIN_MISMATCH',
      reason: 'Origin permintaan tidak cocok dengan host server.',
    };
  }

  return { ok: true };
}
