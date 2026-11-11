import { FastifyRequest } from 'fastify';
import { DEFAULT_TENANT_ID } from '../../config/tenant';

/**
 * Ar-003/Cfg-012: mode multi-tenant. Saat AKTIF, tenant WAJIB eksplisit —
 * tidak boleh jatuh diam-diam ke `default-tenant`. Saat NONAKTIF (default),
 * perilaku single-tenant lama dipertahankan agar deploy tidak berubah.
 */
export function isMultiTenantEnabled(): boolean {
  return String(process.env.MULTI_TENANT_ENABLED ?? '').trim().toLowerCase() === 'true';
}

/**
 * Resolusi tenant untuk sesi admin (API key / admin_session / staff_session).
 * Prioritas: tenant yang sudah di-set sesi (staf dari DB) > header > query.
 * Multi-tenant ON tanpa tenant eksplisit → fail-closed 401 TENANT_REQUIRED.
 */
export function resolveSessionTenantId(request: FastifyRequest): string {
  const raw =
    (request as any).tenantId ||
    (request as any).headers?.['x-tenant-id'] ||
    (request as any).query?.tenant_id;
  const tenantId = typeof raw === 'string' ? raw.trim() : '';
  if (tenantId) return tenantId;
  if (isMultiTenantEnabled()) {
    const err = new Error('tenantId wajib pada mode multi-tenant') as any;
    err.statusCode = 401;
    err.code = 'TENANT_REQUIRED';
    throw err;
  }
  return DEFAULT_TENANT_ID;
}

/** SEC-AUDIT-07: resolusi tenant dari sesi terautentikasi (fail-closed). */
export function tenantOf(request: FastifyRequest): string {
  const raw = (request as any).tenantId || (request.headers['x-tenant-id'] as string) || (request.query as any)?.tenant_id;
  const tenantId = typeof raw === 'string' ? raw.trim() : '';
  if (!tenantId) {
    const err = new Error('tenantId wajib') as any;
    err.statusCode = 401;
    err.code = 'TENANT_REQUIRED';
    throw err;
  }
  return tenantId;
}


/** Sanitasi durasi reservasi (menit): integer, clamp 15–480, null bila invalid. */
export function sanitizeDurationMinutes(value: unknown): number | null {
  const n = Number(value);
  if (!isFinite(n) || n <= 0) return null;
  return Math.min(480, Math.max(15, Math.round(n)));
}
