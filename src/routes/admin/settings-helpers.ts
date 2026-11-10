import { FastifyRequest } from 'fastify';
import { DEFAULT_TENANT_ID } from '../../config/tenant';

export function requireTenantId(request: FastifyRequest): string {
  const tenantId = (request as any).tenantId;
  if (!tenantId || typeof tenantId !== 'string' || !tenantId.trim()) {
    const err: any = new Error('TENANT_REQUIRED: tenantId wajib disertakan pada mutasi settings');
    err.statusCode = 400;
    err.code = 'TENANT_REQUIRED';
    throw err;
  }
  return tenantId.trim();
}

export function resolveTenantId(request: FastifyRequest): string {
  const tenantId = (request as any).tenantId;
  return (typeof tenantId === 'string' && tenantId.trim()) ? tenantId.trim() : DEFAULT_TENANT_ID;
}
