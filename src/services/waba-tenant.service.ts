import { DEFAULT_TENANT_ID } from '../config/tenant';
import { TtlCache, resolveTtlMs } from '../utils/ttl-cache';

/**
 * Resolve tenant dari phone_number_id WABA yang tertera di webhook Meta.
 * Sumber kebenaran: kolom tenants.waba_phone_number_id (provider WABA).
 *
 * Cache in-memory per phoneNumberId agar tidak query DB berulang per pesan.
 * Cache WAJIB ber-TTL (default 5 menit, env WABA_TENANT_CACHE_TTL_MS) supaya
 * reassignment nomor antar-tenant terbaca tanpa restart proses. Setiap mutasi
 * konfigurasi WABA di admin API juga memanggil invalidateWabaTenantCache().
 */
const CACHE_TTL_MS = resolveTtlMs(process.env.WABA_TENANT_CACHE_TTL_MS);
const tenantCache = new TtlCache<string, string>({ ttlMs: CACHE_TTL_MS });

export class WabaTenantService {
  private secretCache = new TtlCache<string, string>({ ttlMs: CACHE_TTL_MS });

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

  /**
   * Mengambil waba_app_secret terdekripsi untuk phone_number_id tertentu dengan
   * in-memory cache ber-TTL (ING-15). Rotasi secret di dashboard akan terbaca
   * maksimal dalam CACHE_TTL_MS.
   */
  public async resolveAppSecretByPhoneNumberId(phoneNumberId: string | undefined | null): Promise<string> {
    if (!phoneNumberId) return '';
    const cached = this.secretCache.get(phoneNumberId);
    if (cached !== undefined) return cached;

    try {
      const { prisma } = await import('../db/client');
      const tenant = await prisma.tenant.findFirst({
        where: { waba_phone_number_id: phoneNumberId },
        select: { id: true, waba_app_secret: true },
      });
      let secret = tenant?.waba_app_secret || '';
      if (secret) {
        try {
          const { decryptSecret } = await import('../utils/encryption');
          secret = decryptSecret(secret) || secret;
        } catch {
          // gunakan plaintext bila decrypt gagal
        }
      }
      this.secretCache.set(phoneNumberId, secret);
      return secret;
    } catch {
      return '';
    }
  }

  /** Buang cache tenant/secret untuk satu nomor (atau seluruhnya). */
  public invalidate(phoneNumberId?: string | null): void {
    if (phoneNumberId) {
      tenantCache.delete(phoneNumberId);
      this.secretCache.delete(phoneNumberId);
      return;
    }
    tenantCache.clear();
    this.secretCache.clear();
  }

  /** Reset cache (dipakai unit test). */
  public resetCache(): void {
    this.invalidate();
  }
}

export const wabaTenantService = new WabaTenantService();
export const resolveTenantByPhoneNumberId = (phoneNumberId: string | undefined | null) =>
  wabaTenantService.resolveTenantByPhoneNumberId(phoneNumberId);

/**
 * Invalidasi cache setelah konfigurasi WABA tenant berubah. Dipanggil dari
 * admin API (PATCH /api/admin/whatsapp-provider) untuk nomor lama DAN baru,
 * sehingga reassignment langsung berlaku tanpa menunggu TTL.
 */
export function invalidateWabaTenantCache(phoneNumberId?: string | null): void {
  wabaTenantService.invalidate(phoneNumberId);
}
