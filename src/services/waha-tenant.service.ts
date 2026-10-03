import { DEFAULT_TENANT_ID } from '../config/tenant';

/**
 * Resolve tenant dari WAHA session id yang tertera di payload webhook.
 * Sumber kebenaran: kolom tenants.waha_session_id (provider WAHA).
 *
 * Cache TTL 5 menit agar perubahan/penghapusan tenant ter-invalidate tanpa restart.
 *
 * P0-1 (audit #199): FAIL-CLOSED untuk session TAK DIKENAL.
 * - Session ditemukan  → id tenant pemilik (normal).
 * - Session TIDAK ketemu (DB hidup) → null. Pemanggil WAJIB tolak + alert;
 *   DILARANG memproses di bawah DEFAULT_TENANT_ID (vektor kebocoran lintas-tenant).
 * - DB offline → fallback DEFAULT_TENANT_ID + alert CRITICAL. Keputusan sadar:
 *   menjaga ketersediaan ingress (jangan drop SEMUA pesan saat DB blip) karena
 *   saat ini hanya ada satu tenant (default-tenant) yang terdaftar; risiko
 *   lintas-tenant = nol sampai multi-tenant benar-benar aktif. Mode strict
 *   multi-tenant (tolak saat DB offline) menunggu infrastruktur karantina —
 *   lihat docs/KNOWN_ISSUES.md.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  tenantId: string;
  expiresAt: number;
}

const tenantCache = new Map<string, CacheEntry>();

export class WahaTenantService {
  public async resolveTenantBySession(session: string | undefined | null): Promise<string | null> {
    if (!session || session.trim().length === 0) {
      return null;
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
      if (!tenant?.id) {
        console.warn(`[WAHA TENANT] session ${session} tidak ditemukan. FAIL-CLOSED (tidak fallback ke ${DEFAULT_TENANT_ID}).`);
        await this.raiseAlert('session tidak dikenal', session);
        return null;
      }
      tenantCache.set(session, { tenantId: tenant.id, expiresAt: Date.now() + CACHE_TTL_MS });
      return tenant.id;
    } catch (err) {
      console.warn('[WAHA TENANT] DB unavailable saat resolusi tenant. Fallback default (availability) + alert:', (err as Error).message);
      await this.raiseAlert('DB offline — fallback availability', session);
      return DEFAULT_TENANT_ID;
    }
  }

  /** Alert non-blocking (best-effort) untuk anomali resolusi tenant. */
  private async raiseAlert(reason: string, session: string): Promise<void> {
    try {
      const { alertService, AlertType, AlertSeverity } = await import('./alert.service');
      await alertService.notifyAlert({
        type: AlertType.SECURITY_BREACH_ATTEMPT,
        severity: AlertSeverity.CRITICAL,
        message: `[WAHA TENANT] ${reason}: ${session}.`,
        metadata: { provider: 'WAHA', reason, session },
      });
    } catch { /* alert best-effort — jangan menggagalkan ingress */ }
  }

  /** Reset cache (dipakai unit test). */
  public resetCache(): void {
    tenantCache.clear();
  }
}

export const wahaTenantService = new WahaTenantService();
