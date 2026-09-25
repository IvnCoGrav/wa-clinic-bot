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

export interface ScopeDecision {
  /** true bila request cocok dengan salah satu scope role. */
  allowed: boolean;
  /** true bila role dikelola tabel (punya baris) atau DB tak bisa dibaca (fail-closed). */
  managed: boolean;
}

/**
 * SEC-AUDIT-04: keputusan otorisasi berbasis data (tabel `role_api_scopes`).
 * - Role tanpa baris → unmanaged → perilaku legacy (existing guards berlaku).
 * - Role berbaris → default-deny kecuali (prefix, method) cocok.
 * - DB error → deny (fail-closed, konsisten dengan StaffAuthService).
 */
export async function isApiScopeAllowed(
  tenantId: string = DEFAULT_TENANT_ID,
  roleKey: string,
  urlPath: string,
  method: string,
): Promise<ScopeDecision> {
  const cacheKey = `${tenantId}::${roleKey}`;
  const now = Date.now();
  const cached = scopeCache.get(cacheKey);

  let rows: ScopeRow[];
  if (cached && now - cached.at < SCOPE_CACHE_TTL_MS) {
    rows = cached.rows;
  } else {
    try {
      const found = await prisma.roleApiScope.findMany({
        where: { tenant_id: tenantId, role_key: roleKey },
        select: { api_prefix: true, methods: true },
      });
      rows = (found as any[]).map((r) => ({ api_prefix: r.api_prefix, methods: r.methods || '*' }));
      scopeCache.set(cacheKey, { at: now, rows });
    } catch (err: any) {
      console.warn(`[RBAC SCOPE GUARD] DB unreachable for role '${roleKey}', denying by default:`, err?.message);
      return { allowed: false, managed: true };
    }
  }

  if (rows.length === 0) {
    return { allowed: true, managed: false };
  }

  const m = String(method || 'GET').toUpperCase();
  const allowed = rows.some((r) => {
    const prefix = r.api_prefix;
    const pathOk = urlPath === prefix || urlPath.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
    if (!pathOk) return false;
    const methods = String(r.methods || '*')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    return methods.includes('*') || methods.includes(m);
  });
  return { allowed, managed: true };
}

/** Test-only: reset cache antar-test. */
export function clearScopeCache(): void {
  scopeCache.clear();
}
