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

/**
 * Melakukan deep merge rekursif pada objek JSON (settings) tanpa menimpa properti saudara (Cfg-008).
 */
export function deepMergeSettings(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const output: Record<string, any> = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = output[key];
    if (
      srcVal !== null &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal)
    ) {
      output[key] = deepMergeSettings(tgtVal, srcVal);
    } else {
      output[key] = srcVal;
    }
  }
  return output;
}

/**
 * Pembaruan terkelola untuk `Tenant.settings` (JSONB) dengan versioning & safe-merge (Cfg-008).
 * Mencegah lost-update pada mutasi concurrent setelan tenant.
 */
export async function updateTenantSettingsSafely(
  prismaClient: any,
  tenantId: string,
  updater: (currentSettings: Record<string, any>) => Record<string, any>
): Promise<Record<string, any>> {
  const tenant = await prismaClient.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  if (!tenant) {
    const err: any = new Error(`TENANT_NOT_FOUND: Tenant dengan ID ${tenantId} tidak ditemukan.`);
    err.statusCode = 404;
    err.code = 'TENANT_NOT_FOUND';
    throw err;
  }

  const current = (tenant.settings && typeof tenant.settings === 'object' && !Array.isArray(tenant.settings))
    ? { ...(tenant.settings as Record<string, any>) }
    : {};

  const updatedData = updater(current);
  const nextVersion = (typeof current._version === 'number' ? current._version : 1) + 1;
  const finalSettings = {
    ...updatedData,
    _version: nextVersion,
    _updatedAt: new Date().toISOString(),
  };

  await prismaClient.tenant.update({
    where: { id: tenantId },
    data: { settings: finalSettings },
  });

  return finalSettings;
}
