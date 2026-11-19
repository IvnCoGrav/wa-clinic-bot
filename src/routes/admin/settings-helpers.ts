import { FastifyRequest } from 'fastify';
import { resolveSessionTenantId } from './route-helpers';

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
  return resolveSessionTenantId(request);
}

export { deepMergeSettings, updateTenantSettingsSafely } from '../../services/tenant-settings.store';

