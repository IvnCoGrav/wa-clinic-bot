import { createHash } from 'crypto';

/**
 * Kuota admission Copilot per principal (bukan per API key bersama / IP).
 * 6 request/menit default; /chat dan /stream memakai bucket yang sama.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 6;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Cegah pertumbuhan map tanpa batas pada proses berumur panjang. */
function pruneExpired(now: number): void {
  if (buckets.size < 500) return;
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

export function copilotPrincipalKey(request: any): string {
  const staffId = request?.staffId;
  if (staffId) return `staff:${staffId}`;

  // `adminIdentity` hanya otoritatif bila berasal dari sesi cookie (divalidasi
  // server). Pada auth X-API-KEY nilainya label kiriman klien, sehingga tidak
  // boleh menjadi dasar bucket — kalau tidak, kuota bisa diputar dengan mengganti
  // header identitas.
  const authKind = request?.adminKeyUsed;
  if (authKind === 'COOKIE_SESSION') {
    const identity = request?.adminIdentity;
    if (identity) return `session:${identity}`;
  }

  const apiKey =
    typeof authKind === 'string' && authKind !== 'COOKIE_SESSION'
      ? authKind
      : request?.headers?.['x-api-key'];
  if (typeof apiKey === 'string' && apiKey) {
    return `key:${createHash('sha256').update(apiKey).digest('hex').slice(0, 12)}`;
  }
  return `ip:${request?.ip || 'unknown'}`;
}

export function checkCopilotQuota(
  principal: string,
  now: number = Date.now()
): { allowed: boolean; retryAfterSec: number; remaining: number } {
  pruneExpired(now);
  const bucket = buckets.get(principal);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(principal, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSec: 0, remaining: MAX_PER_WINDOW - 1 };
  }
  if (bucket.count >= MAX_PER_WINDOW) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      remaining: 0,
    };
  }
  bucket.count += 1;
  return { allowed: true, retryAfterSec: 0, remaining: MAX_PER_WINDOW - bucket.count };
}

/** Test helper. */
export function resetCopilotQuota(): void {
  buckets.clear();
}
