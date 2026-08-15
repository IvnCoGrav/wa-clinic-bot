import { DEFAULT_TENANT_ID } from './tenant';

/**
 * AI Router Config per tenant (SaaS-ready).
 * Sumber kebenaran: kolom tenants.ai_router_enabled / ai_router_shadow_mode.
 * Default: ON + shadow ON (aman). Fallback ke env vars AI_ROUTER_ENABLED /
 * AI_ROUTER_SHADOW_MODE saat DB tidak tersedia (offline/testing).
 */

export interface AiRouterConfig {
  enabled: boolean;
  shadowMode: boolean;
}

const DEFAULTS: AiRouterConfig = { enabled: true, shadowMode: false };

// Cache in-memory per tenant — diisi saat boot (loadConfigsFromDb) & saat admin update.
const configCache = new Map<string, AiRouterConfig>();

function envFallback(): Partial<AiRouterConfig> {
  const out: Partial<AiRouterConfig> = {};
  if (process.env.AI_ROUTER_ENABLED !== undefined) {
    out.enabled = process.env.AI_ROUTER_ENABLED === 'true';
  }
  if (process.env.AI_ROUTER_SHADOW_MODE !== undefined) {
    out.shadowMode = process.env.AI_ROUTER_SHADOW_MODE === 'true';
  }
  return out;
}

export class AiRouterConfigService {
  /**
   * Load konfigurasi router dari DB per tenant ke cache in-memory.
   * Jika DB offline, biarkan cache kosong (fallback env/default tetap berlaku).
   */
  static async loadConfigsFromDb(tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    try {
      const { prisma } = await import('../db/client');
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (tenant) {
        configCache.set(tenantId, {
          enabled: tenant.ai_router_enabled,
          shadowMode: tenant.ai_router_shadow_mode,
        });
      }
    } catch (err) {
      console.warn('[AI ROUTER CONFIG] DB unavailable, using env/default fallback:', (err as Error).message);
    }
  }

  /**
   * Konfigurasi efektif, prioritas:
   *   1. cache DB (sumber kebenaran — di-load saat boot & saat admin update),
   *   2. env fallback (hanya saat DB tidak tersedia / cache kosong),
   *   3. default ON + shadow ON.
   */
  static getConfig(tenantId: string = DEFAULT_TENANT_ID): AiRouterConfig {
    const cached = configCache.get(tenantId);
    if (cached) return { ...cached };
    return { ...DEFAULTS, ...envFallback() };
  }

  static isEnabled(tenantId: string = DEFAULT_TENANT_ID): boolean {
    return this.getConfig(tenantId).enabled;
  }

  static isShadowMode(tenantId: string = DEFAULT_TENANT_ID): boolean {
    return this.getConfig(tenantId).shadowMode;
  }

  /** Simpan config ke DB + cache. Jika DB offline, cukup in-memory (fallback). */
  static async saveConfig(tenantId: string, patch: Partial<AiRouterConfig>): Promise<AiRouterConfig> {
    const current = this.getConfig(tenantId);
    const next: AiRouterConfig = { ...current, ...patch };
    configCache.set(tenantId, next);
    try {
      const { prisma } = await import('../db/client');
      const existing = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (existing) {
        await prisma.tenant.update({
          where: { id: tenantId },
          data: {
            ai_router_enabled: next.enabled,
            ai_router_shadow_mode: next.shadowMode,
          },
        });
      } else {
        await prisma.tenant.create({
          data: {
            id: tenantId,
            slug: tenantId,
            name: `Tenant ${tenantId}`,
            ai_router_enabled: next.enabled,
            ai_router_shadow_mode: next.shadowMode,
          },
        });
      }
    } catch (err) {
      console.warn('[AI ROUTER CONFIG] DB save failed (in-memory only):', (err as Error).message);
    }
    return next;
  }
}
