import { FastifyRequest } from 'fastify';
import { DEFAULT_TENANT_ID } from '../../config/tenant';

/** SEC-AUDIT-07: resolusi tenant dari sesi terautentikasi. */
export function tenantOf(request: FastifyRequest): string {
  return (request as any).tenantId || DEFAULT_TENANT_ID;
}

/** Sanitasi durasi reservasi (menit): integer, clamp 15–480, null bila invalid. */
export function sanitizeDurationMinutes(value: unknown): number | null {
  const n = Number(value);
  if (!isFinite(n) || n <= 0) return null;
  return Math.min(480, Math.max(15, Math.round(n)));
}
