import { DEFAULT_TENANT_ID } from './tenant';

/**
 * Idle Greeting Config per tenant (SaaS-ready).
 * Sumber kebenaran: kolom tenants.idle_greeting_enabled / idle_greeting_min_hours.
 * Mengontrol fitur "warm reopening greeting": jika customer kembali chat setelah idle
 * >= min_hours dan pesan adalah sapaan murni (tanpa intent spesifik), bot membalas
 * sapaan hangat open-ended (bukan pitch reservasi).
 * Fallback ke env vars IDLE_GREETING_ENABLED / IDLE_GREETING_MIN_HOURS saat DB tidak
 * tersedia (offline/testing) — meniru pola AiRouterConfigService.
 */

export interface IdleGreetingConfig {
  enabled: boolean;
  minHours: number;
}

const DEFAULTS: IdleGreetingConfig = { enabled: true, minHours: 36 };

// Cache in-memory per tenant — diisi saat boot (loadConfigsFromDb) & saat admin update.
const configCache = new Map<string, IdleGreetingConfig>();

function envFallback(): Partial<IdleGreetingConfig> {
  const out: Partial<IdleGreetingConfig> = {};
  if (process.env.IDLE_GREETING_ENABLED !== undefined) {
    out.enabled = process.env.IDLE_GREETING_ENABLED === 'true';
  }
  if (process.env.IDLE_GREETING_MIN_HOURS !== undefined) {
    const parsed = parseInt(process.env.IDLE_GREETING_MIN_HOURS, 10);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      out.minHours = parsed;
    }
  }
  return out;
}

export class IdleGreetingConfigService {
  /**
   * Load konfigurasi idle greeting dari DB per tenant ke cache in-memory.
   * Jika DB offline, biarkan cache kosong (fallback env/default tetap berlaku).
   */
  static async loadConfigsFromDb(tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    try {
      const { prisma } = await import('../db/client');
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (tenant) {
        configCache.set(tenantId, {
          enabled: tenant.idle_greeting_enabled,
          minHours: tenant.idle_greeting_min_hours,
        });
      }
    } catch (err) {
      console.warn('[IDLE GREETING CONFIG] DB unavailable, using env/default fallback:', (err as Error).message);
    }
  }

  /**
   * Konfigurasi efektif, prioritas:
   *   1. cache DB (sumber kebenaran — di-load saat boot & saat admin update),
   *   2. env fallback (hanya saat DB tidak tersedia / cache kosong),
   *   3. default ON + 36 jam.
   */
  static getConfig(tenantId: string = DEFAULT_TENANT_ID): IdleGreetingConfig {
    const cached = configCache.get(tenantId);
    if (cached) return { ...cached };
    return { ...DEFAULTS, ...envFallback() };
  }

  static isEnabled(tenantId: string = DEFAULT_TENANT_ID): boolean {
    return this.getConfig(tenantId).enabled;
  }

  static getMinHours(tenantId: string = DEFAULT_TENANT_ID): number {
    return this.getConfig(tenantId).minHours;
  }

  /** Bersihkan cache (dipakai test agar state antar-test tidak bocor). */
  static clearCache(): void {
    configCache.clear();
  }

  /** Simpan config ke DB + cache. Jika DB offline, cukup in-memory (fallback). */
  static async saveConfig(tenantId: string, patch: Partial<IdleGreetingConfig>): Promise<IdleGreetingConfig> {
    const current = this.getConfig(tenantId);
    const next: IdleGreetingConfig = { ...current, ...patch };
    configCache.set(tenantId, next);
    try {
      const { prisma } = await import('../db/client');
      const existing = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (existing) {
        await prisma.tenant.update({
          where: { id: tenantId },
          data: {
            idle_greeting_enabled: next.enabled,
            idle_greeting_min_hours: next.minHours,
          },
        });
      } else {
        await prisma.tenant.create({
          data: {
            id: tenantId,
            slug: tenantId,
            name: `Tenant ${tenantId}`,
            idle_greeting_enabled: next.enabled,
            idle_greeting_min_hours: next.minHours,
          },
        });
      }
    } catch (err) {
      console.warn('[IDLE GREETING CONFIG] DB save failed (in-memory only):', (err as Error).message);
    }
    return next;
  }
}
