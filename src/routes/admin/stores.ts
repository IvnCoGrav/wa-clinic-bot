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
