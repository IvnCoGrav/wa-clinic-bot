import { DEFAULT_TENANT_ID } from '../config/tenant';

/**
 * Resolve tenant dari phone_number_id WABA yang tertera di webhook Meta.
 * Sumber kebenaran: kolom tenants.waba_phone_number_id (provider WABA).
 * Cache in-memory per phoneNumberId agar tidak query DB berulang per pesan.
 */
const tenantCache = new Map<string, string>();

export class WabaTenantService {
  /**
   * Mencari tenant_id pemilik phone_number_id tertentu.
   * Jika tidak ditemukan (atau DB offline), fallback ke DEFAULT_TENANT_ID.
   */
  public async resolveTenantByPhoneNumberId(phoneNumberId: string | undefined | null): Promise<string> {
    if (!phoneNumberId) {
      return DEFAULT_TENANT_ID;
    }

    const cached = tenantCache.get(phoneNumberId);
    if (cached) return cached;

    try {
      const { prisma } = await import('../db/client');
      const tenant = await prisma.tenant.findFirst({
        where: { waba_phone_number_id: phoneNumberId },
        select: { id: true },
      });
      const tenantId = tenant?.id || DEFAULT_TENANT_ID;
      tenantCache.set(phoneNumberId, tenantId);
      if (!tenant) {
        console.warn(`[WABA TENANT] phone_number_id ${phoneNumberId} tidak ditemukan. Fallback ke ${DEFAULT_TENANT_ID}.`);
      }
      return tenantId;
    } catch (err) {
      console.warn('[WABA TENANT] DB unavailable, fallback ke default tenant:', (err as Error).message);
      return DEFAULT_TENANT_ID;
    }
  }

  /** Reset cache (dipakai unit test). */
  public resetCache(): void {
    tenantCache.clear();
  }
}

export const wabaTenantService = new WabaTenantService();
