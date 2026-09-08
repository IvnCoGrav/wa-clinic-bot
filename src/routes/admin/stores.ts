// Shared memory stores and helper utilities for admin routes

export const memoryReservations = new Map<string, any>();
export const memoryLandings = new Map<string, any>();

export const RESERVED_LANDING_SLUGS = new Set([
  'go',
  'promo',
  'health',
  'api',
  'admin',
  'public',
  'assets',
  'favicon.ico',
  'default',
]);

export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateLandingSlug(slug: string): string | null {
  if (!slug || typeof slug !== 'string') return 'Slug wajib diisi.';
  if (!SLUG_REGEX.test(slug)) return 'Slug hanya boleh huruf kecil, angka, dan tanda hubung (mis. promo-baby).';
  if (RESERVED_LANDING_SLUGS.has(slug)) return `Slug '${slug}' adalah kata cadangan sistem.`;
  return null;
}

export const VALID_LANDING_EVENTS = [
  'PageView',
  'ViewContent',
  'Search',
  'Lead',
  'Purchase',
  'InitiateCheckout',
  'AddToCart',
  'CompleteRegistration',
  'Contact',
  'StartTrial',
  'Subscribe',
  'CustomizeProduct',
];

export async function purgeLandingCache(slugOrId: string): Promise<void> {
  try {
    const { purgeLandingContentCache } = await import('../../services/landing-content.service');
    purgeLandingContentCache(slugOrId);
  } catch (err: any) {
    console.warn(`[LANDING CACHE PURGE] Skipped cache purge for ${slugOrId}: ${err.message}`);
  }
}

export function getAdminDomain(): string {
  return process.env.ADMIN_DOMAIN || '';
}

export function getAdminEmail(): string {
  return process.env.ADMIN_EMAIL || '';
}

export const loginAttemptsMap = new Map<string, { count: number; resetAt: number }>();

// ── Bounded + TTL eviction untuk loginAttemptsMap (anti memory-leak brute-force) ──
export const LOGIN_ATTEMPTS_TTL_MS = 15 * 60 * 1000; // 15 menit sejak percobaan terakhir
export const LOGIN_ATTEMPTS_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // sapu tiap 5 menit
export const LOGIN_ATTEMPTS_MAX_ENTRIES = 1000; // hard cap FIFO

/** Hapus entri login yang sudah kadaluarsa (>TTL) dan evict jika melebihi max. Diekspor untuk testing. */
export function pruneLoginAttempts(
  map: Map<string, { count: number; resetAt: number }> = loginAttemptsMap,
  maxEntries = LOGIN_ATTEMPTS_MAX_ENTRIES,
  ttlMs = LOGIN_ATTEMPTS_TTL_MS
): number {
  const now = Date.now();
  let removed = 0;
  for (const [key, entry] of map.entries()) {
    // resetAt = waktu percobaan terakhir + 60 detik window; TTL dihitung dari percobaan terakhir
    const lastAttemptMs = entry.resetAt - 60 * 1000;
    if (now - lastAttemptMs > ttlMs) {
      map.delete(key);
      removed++;
    }
  }
  // FIFO hard-cap: hapus tertua hingga di bawah batas
  while (map.size > maxEntries) {
    const oldestKey = map.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
    removed++;
  }
  return removed;
}

// Periodic cleanup tiap 5 menit (unref agar tidak menghalangi exit proses / test)
const loginAttemptsCleanupTimer: NodeJS.Timeout = setInterval(() => {
  try {
    pruneLoginAttempts();
  } catch (_) {}
}, LOGIN_ATTEMPTS_CLEANUP_INTERVAL_MS);
if ((loginAttemptsCleanupTimer as any)?.unref) (loginAttemptsCleanupTimer as any).unref();

/** Untuk testing / graceful shutdown: hentikan timer periodik loginAttempts. */
export function stopLoginAttemptsCleanupTimer(): void {
  clearInterval(loginAttemptsCleanupTimer);
}
