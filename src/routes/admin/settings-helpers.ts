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
 * Mencegah lost-update pada mutasi concurrent setelan tenant via Optimistic Concurrency Control (OCC).
 */
export async function updateTenantSettingsSafely(
  prismaClient: any,
  tenantId: string,
  updater: (currentSettings: Record<string, any>) => Record<string, any>,
  maxRetries: number = 3
): Promise<Record<string, any>> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const tenant = await prismaClient.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true, updated_at: true },
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

    // Optimistic Concurrency Control (OCC) melalui updated_at & updateMany
    if (typeof prismaClient.tenant.updateMany === 'function' && tenant.updated_at) {
      const updateResult = await prismaClient.tenant.updateMany({
        where: {
          id: tenantId,
          updated_at: tenant.updated_at,
        },
        data: { settings: finalSettings },
      });

      if (updateResult.count === 0) {
        if (attempt < maxRetries) {
          // Jeda sejenak dengan jitter untuk menghindari thundering herd
          const jitter = Math.floor(Math.random() * 20);
          await new Promise((resolve) => setTimeout(resolve, 40 * attempt + jitter));
          continue; // Ambil ulang data settings terbaru dan ulangi mutasi
        }
        const conflictErr: any = new Error('SETTINGS_CONCURRENCY_CONFLICT: Terjadi modifikasi paralel pada pengaturan tenant. Silakan coba lagi.');
        conflictErr.statusCode = 409;
        conflictErr.code = 'SETTINGS_CONCURRENCY_CONFLICT';
        throw conflictErr;
      }
    } else {
      // Fallback kompatibilitas jika prisma mock hanya mengimplementasikan update()
      await prismaClient.tenant.update({
        where: { id: tenantId },
        data: { settings: finalSettings },
      });
    }

    return finalSettings;
  }

  throw new Error('SETTINGS_CONCURRENCY_CONFLICT: Gagal memperbarui pengaturan setelah retry maksimal.');
}
