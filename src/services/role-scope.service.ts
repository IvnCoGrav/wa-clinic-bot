import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';

const SCOPE_CACHE_TTL_MS = 60_000;

interface ScopeRow {
  api_prefix: string;
  methods: string;
}

const scopeCache = new Map<string, { at: number; rows: ScopeRow[] }>();

/**
 * Normalisasi kunci peran — cermin logika login (auth.subroute.ts):
 * THERAPIST → 'therapist', selain itu lowercase.
 */
export function normalizeRoleKey(staffRole?: string | null): string {
  const r = String(staffRole || '');
  return r === 'THERAPIST' ? 'therapist' : r.toLowerCase();
}

/**
 * Pencocokan path terhadap `api_prefix` dari tabel `role_api_scopes`:
 * - Prefix polos (`/api/admin/live-chat`): cocok persis atau sub-path (`/...`).
 * - Prefix berparameter segmen (`/api/admin/customers/:id/addresses`): setiap
 *   segmen `:param` cocok tepat SATU segmen non-kosong (`[^/]+`), lalu sub-path
 *   di bawahnya ikut diizinkan. Mencegah eskalasi ke parent path (mis. DELETE
 *   `/api/admin/customers/:id` tetap ditolak — KNOWN #358 CD-03).
 */
export function matchApiScopePrefix(urlPath: string, apiPrefix: string): boolean {
  const normalizedUrl = String(urlPath || '').split('?')[0];
  const normalizedPrefix = String(apiPrefix || '').replace(/\/+$/, '');
  if (!normalizedPrefix) return false;

  if (!normalizedPrefix.includes('/:')) {
    return (
      normalizedUrl === normalizedPrefix ||
      normalizedUrl.startsWith(`${normalizedPrefix}/`)
    );
  }

  const urlClean = normalizedUrl.replace(/\/+$/, '');
  const patSegs = normalizedPrefix.split('/').slice(1);
  const urlSegs = urlClean.split('/').slice(1);

  if (urlSegs.length < patSegs.length) return false;

  for (let i = 0; i < patSegs.length; i++) {
    const pat = patSegs[i];
    const seg = urlSegs[i];
    if (pat.startsWith(':')) {
      if (!seg || seg.length === 0) return false;
      continue;
    }
    if (seg !== pat) return false;
  }
  return true;
}

export interface ScopeDecision {
  /** true bila request cocok dengan salah satu scope role. */
  allowed: boolean;
  /** true bila role dikelola tabel (punya baris) atau DB tak bisa dibaca (fail-closed). */
  managed: boolean;
}

/**
 * SEC-AUDIT-04 & Fase 2: keputusan otorisasi berbasis data (tabel `role_api_scopes`).
 * - Super-admin: bypass eksplisit.
 * - Role tanpa baris → default-deny (fail-closed).
 * - Role berbaris → default-deny kecuali (prefix, method) cocok.
 * - DB error → deny (fail-closed, konsisten dengan StaffAuthService).
 */
export async function isApiScopeAllowed(
  tenantId: string = DEFAULT_TENANT_ID,
  roleKey: string,
  urlPath: string,
  method: string,
): Promise<ScopeDecision> {
  const normalizedRole = normalizeRoleKey(roleKey);

  // Super Admin memiliki hak akses penuh eksplisit
  if (normalizedRole === 'super_admin') {
    return { allowed: true, managed: true };
  }

  const cacheKey = `${tenantId}::${normalizedRole}`;
  const now = Date.now();
  const cached = scopeCache.get(cacheKey);

  let rows: ScopeRow[];
  if (cached && now - cached.at < SCOPE_CACHE_TTL_MS) {
    rows = cached.rows;
  } else {
    try {
      const found = await prisma.roleApiScope.findMany({
        where: { tenant_id: tenantId, role_key: normalizedRole },
        select: { api_prefix: true, methods: true },
      });
      rows = (found as any[]).map((r) => ({ api_prefix: r.api_prefix, methods: r.methods || '*' }));
      scopeCache.set(cacheKey, { at: now, rows });
    } catch (err: any) {
      console.warn(`[RBAC SCOPE GUARD] DB unreachable for role '${normalizedRole}', denying by default:`, err?.message);
      return { allowed: false, managed: true };
    }
  }

  // S-002 / Fase 2.1.1: Fail-closed — role tanpa baris terdaftar di role_api_scopes
  // ditolak secara default (allowed: false).
  if (rows.length === 0) {
    return { allowed: false, managed: false };
  }

  const m = String(method || 'GET').toUpperCase();
  const allowed = rows.some((r) => {
    const pathOk = matchApiScopePrefix(urlPath, r.api_prefix);
    if (!pathOk) return false;
    const methods = String(r.methods || '*')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    return methods.includes('*') || methods.includes(m);
  });
  return { allowed, managed: true };
}

/**
 * Invalidasi cache scope produksi saat role/scope diperbarui (KNOWN #358 V-07).
 * - tenantId + roleKey → hapus entri spesifik
 * - hanya tenantId     → hapus seluruh role pada tenant tersebut
 * - tanpa argumen      → bersihkan seluruh cache
 */
export function invalidateScopeCache(tenantId?: string, roleKey?: string): void {
  if (!tenantId) {
    scopeCache.clear();
    return;
  }
  if (roleKey) {
    scopeCache.delete(`${tenantId}::${normalizeRoleKey(roleKey)}`);
    return;
  }
  const prefix = `${tenantId}::`;
  for (const key of scopeCache.keys()) {
    if (key.startsWith(prefix)) {
      scopeCache.delete(key);
    }
  }
}

/** Test-only: reset cache antar-test. */
export function clearScopeCache(): void {
  scopeCache.clear();
}
