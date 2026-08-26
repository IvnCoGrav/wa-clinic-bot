import { AiCustomerScope } from '@prisma/client';
import { DEFAULT_TENANT_ID } from './tenant';

/**
 * AI Eligibility Scope Config per tenant (SaaS-ready).
 * Sumber kebenaran: kolom tenants.ai_customer_scope / ai_scope_cutoff_at.
 *
 * FAIL-CLOSED DEFAULT saat cache kosong / DB tidak tersedia:
 * `NEW_ONLY` + `cutoff = saat fallback dievaluasi (now)` → resolveAiEligibility
 * hanya true untuk customer yang dibuat SETELAH momen fallback, semua customer
 * existing terhitung legacy → di-senyapkan sampai config berhasil di-load.
 * JANGAN ubah ini jadi fail-open (ALL) tanpa persetujuan product owner.
 */

export interface AiEligibilityConfig {
  ai_customer_scope: AiCustomerScope;
  ai_scope_cutoff_at: Date;
  legacy_bypass_bot: boolean;
  repeat_patient_bypass_bot: boolean;
}

// Kolom DB NOT NULL (default now()). Default fail-closed: scope NEW_ONLY + cutoff
// dievaluasi LAZY (setiap kali fallback dipakai), bukan konstanta module-level —
// kalau di-cache saat boot, cutoff yang beku tidak representatif untuk keputusan
// fail-closed yang konsisten sepanjang uptime server.
function buildFailClosedConfig(): AiEligibilityConfig {
  const envScope = process.env.AI_CUSTOMER_SCOPE === 'ALL' ? AiCustomerScope.ALL : AiCustomerScope.NEW_ONLY;
  const legacyBypass = process.env.LEGACY_BYPASS_BOT !== 'false';
  const repeatBypass = process.env.REPEAT_PATIENT_BYPASS_BOT !== 'false';
  return {
    ai_customer_scope: envScope,
    ai_scope_cutoff_at: new Date(),
    legacy_bypass_bot: legacyBypass,
    repeat_patient_bypass_bot: repeatBypass,
  };
}

/**
 * TRADE-OFF YANG DISENGAJA: fail-closed, bukan fail-open.
 *
 * Saat config tenant tidak bisa dibaca (DB offline, cache miss, race condition
 * saat boot), sistem default ke NEW_ONLY + cutoff=now(), BUKAN ALL. Konsekuensinya:
 * customer BARU yang seharusnya dapat AI bisa ikut silence sementara selama
 * config-service gangguan (fallback ke human handling, bukan gagal total).
 *
 * Ini dipilih karena fitur AI Rollout Scope sendiri dibuat atas dasar kehati-hatian
 * pemilik bisnis terhadap AI — kondisi config tidak pasti HARUS default ke opsi
 * paling konservatif (AI mati), bukan paling permisif (AI nyala ke semua termasuk
 * legacy customer yang belum di-approve pemilik bisnis). Jangan ubah ini jadi
 * fail-open tanpa persetujuan eksplisit dari product owner.
 */

// Cache in-memory per tenant — diisi saat boot (loadConfigsFromDb) & saat admin update.
const configCache = new Map<string, AiEligibilityConfig>();

export class AiEligibilityConfigService {
  /**
   * Load konfigurasi scope AI dari DB per tenant ke cache in-memory.
   * Jika DB offline, biarkan cache kosong (default fail-closed tetap berlaku).
   * Return true jika config berhasil di-load dari DB.
   */
  static async loadConfigsFromDb(tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> {
    try {
      const { prisma } = await import('../db/client');
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (tenant) {
        const legacyBypass = process.env.LEGACY_BYPASS_BOT !== 'false';
        const repeatBypass = process.env.REPEAT_PATIENT_BYPASS_BOT !== 'false';
        configCache.set(tenantId, {
          ai_customer_scope: tenant.ai_customer_scope,
          ai_scope_cutoff_at: tenant.ai_scope_cutoff_at,
          legacy_bypass_bot: legacyBypass,
          repeat_patient_bypass_bot: repeatBypass,
        });
        return true;
      }
      return false;
    } catch (err) {
      console.warn('[AI ELIGIBILITY CONFIG] DB unavailable, defaulting to fail-closed (NEW_ONLY, cutoff=now):', (err as Error).message);
      return false;
    }
  }

  /**
   * Konfigurasi efektif, prioritas:
   *   1. cache DB (sumber kebenaran — di-load saat boot & saat admin update),
   *   2. default fail-closed NEW_ONLY + cutoff=now (lazy, aman: tidak pernah
   *      mengaktifkan AI ke customer yang belum di-approve saat DB/cache bermasalah).
   */
  static getConfig(tenantId: string = DEFAULT_TENANT_ID): AiEligibilityConfig {
    const cached = configCache.get(tenantId);
    if (cached) return { ...cached };
    return buildFailClosedConfig();
  }

  /** Simpan config ke DB + cache. Jika DB offline, cukup in-memory (fallback). */
  static async saveConfig(tenantId: string, patch: Partial<AiEligibilityConfig>): Promise<AiEligibilityConfig> {
    const current = this.getConfig(tenantId);
    const next: AiEligibilityConfig = { ...current, ...patch };
    configCache.set(tenantId, next);
    try {
      const { prisma } = await import('../db/client');
      const existing = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (existing) {
        await prisma.tenant.update({
          where: { id: tenantId },
          data: {
            ai_customer_scope: next.ai_customer_scope,
            ai_scope_cutoff_at: next.ai_scope_cutoff_at,
          },
        });
      } else {
        await prisma.tenant.create({
          data: {
            id: tenantId,
            slug: tenantId,
            name: `Tenant ${tenantId}`,
            ai_customer_scope: next.ai_customer_scope,
            ai_scope_cutoff_at: next.ai_scope_cutoff_at,
          },
        });
      }
    } catch (err) {
      console.warn('[AI ELIGIBILITY CONFIG] DB save failed (in-memory only):', (err as Error).message);
    }
    return next;
  }

  /** Hapus cache per tenant (utk simulasi boot tanpa config / test isolation). */
  static clearCache(tenantId?: string): void {
    if (tenantId) {
      configCache.delete(tenantId);
    } else {
      configCache.clear();
    }
  }
}
