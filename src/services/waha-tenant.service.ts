import { DEFAULT_TENANT_ID } from '../config/tenant';

/**
 * Resolve tenant dari WAHA session id yang tertera di payload webhook.
 * Sumber kebenaran: kolom tenants.waha_session_id (provider WAHA).
 *
 * Berbeda dari WabaTenantService (yang memakai cache tanpa TTL), resolver ini
 * memakai TTL 5 menit agar perubahan/penghapusan tenant di DB ter-invalidate
 * tanpa perlu restart proses (temuan audit PLAN 8 FASE 2a).
 *
 * Sifat FASE 2a: ADITIF — bila session tidak ditemukan atau DB offline,
 * kembalikan DEFAULT_TENANT_ID. Perilaku single-tenant tidak berubah.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  tenantId: string;
  expiresAt: number;
}

const tenantCache = new Map<string, CacheEntry>();

export class WahaTenantService {
  /**
   * Mencari tenant_id pemilik WAHA session tertentu.
   * Jika tidak ditemukan (atau DB offline), fallback ke DEFAULT_TENANT_ID.
   *
   * CATATAN (CG-01 / R1): fail-closed DITUNDA — mengubah ini menjadi tolak
   * di titik awal ingress berdampak luas (ACK/label/typing ikut ter-drop) dan
   * butuh infrastruktur quarantine + penanganan per jenis event. Lihat
   * docs/KNOWN_ISSUES.md #103.
   */
  public async resolveTenantBySession(session: string | undefined | null): Promise<string> {
    if (!session || session.trim().length === 0) {
      return DEFAULT_TENANT_ID;
    }

    const cached = tenantCache.get(session);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.tenantId;
    }

    try {
      const { prisma } = await import('../db/client');
      const tenant = await prisma.tenant.findFirst({
        where: { waha_session_id: session },
        select: { id: true },
      });
      const tenantId = tenant?.id || DEFAULT_TENANT_ID;
      tenantCache.set(session, { tenantId, expiresAt: Date.now() + CACHE_TTL_MS });
      if (!tenant) {
        console.warn(`[WAHA TENANT] session ${session} tidak ditemukan. Fallback ke ${DEFAULT_TENANT_ID}.`);
      }
      return tenantId;
    } catch (err) {
      console.warn('[WAHA TENANT] DB unavailable, fallback ke default tenant:', (err as Error).message);
      return DEFAULT_TENANT_ID;
    }
  }

  /** Reset cache (dipakai unit test). */
  public resetCache(): void {
    tenantCache.clear();
  }
}

export const wahaTenantService = new WahaTenantService();
