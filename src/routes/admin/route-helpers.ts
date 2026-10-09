import { FastifyRequest } from 'fastify';
import { DEFAULT_TENANT_ID } from '../../config/tenant';

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
