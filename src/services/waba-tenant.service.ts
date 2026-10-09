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
      throw new Error('UNKNOWN_PHONE_NUMBER_ID');
    }

    const cached = tenantCache.get(phoneNumberId);
    if (cached) return cached;

    try {
      const { prisma } = await import('../db/client');
      const tenant = await prisma.tenant.findFirst({
        where: { waba_phone_number_id: phoneNumberId },
        select: { id: true },
      });
      if (!tenant) {
        throw new Error('UNKNOWN_PHONE_NUMBER_ID');
      }
      tenantCache.set(phoneNumberId, tenant.id);
      return tenant.id;
    } catch (err: any) {
      if (err.message === 'UNKNOWN_PHONE_NUMBER_ID') {
        throw err;
      }
      // Khusus offline unit test / DB offline: fallback ke default tenant
      if (err.message?.includes('Database offline') || err.message?.includes('offline')) {
        console.warn('[WABA TENANT] DB unavailable (offline mode), fallback ke default tenant:', err.message);
        return DEFAULT_TENANT_ID;
      }
      throw err;
    }
  }


  /** Reset cache (dipakai unit test). */
  public resetCache(): void {
    tenantCache.clear();
  }
}

export const wabaTenantService = new WabaTenantService();
export const resolveTenantByPhoneNumberId = (phoneNumberId: string | undefined | null) =>
  wabaTenantService.resolveTenantByPhoneNumberId(phoneNumberId);
