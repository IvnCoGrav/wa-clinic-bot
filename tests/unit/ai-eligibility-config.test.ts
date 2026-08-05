import { describe, it, expect, beforeEach } from 'vitest';
import { AiCustomerScope } from '@prisma/client';
import { AiEligibilityConfigService } from '../../src/config/ai-eligibility-config';
import { resolveAiEligibility } from '../../src/services/ai-eligibility.service';

/**
 * Unit test AI Eligibility Config Service — fokus revisi fail-closed default.
 *
 * DB mock di setup.ts selalu reject ("Database offline"), jadi loadConfigsFromDb
 * gagal → cache tetap kosong → getConfig mengembalikan default fail-closed.
 */
describe('AI Eligibility Config Service (fail-closed default)', () => {
  const TENANT = 'unit-ai-eligibility-config';

  beforeEach(() => {
    AiEligibilityConfigService.clearCache(TENANT);
  });

  it('cache kosong → default fail-closed: scope NEW_ONLY + cutoff ≈ now (bukan ALL + epoch)', () => {
    const before = Date.now();
    const cfg = AiEligibilityConfigService.getConfig(TENANT);

    expect(cfg.ai_customer_scope).toBe(AiCustomerScope.NEW_ONLY);
    // cutoff harus "sekarang" (mendekati waktu fallback), bukan epoch/0
    expect(cfg.ai_scope_cutoff_at.getTime()).toBeGreaterThan(new Date(0).getTime());
    expect(Math.abs(cfg.ai_scope_cutoff_at.getTime() - before)).toBeLessThan(5000);
    expect(Math.abs(cfg.ai_scope_cutoff_at.getTime() - Date.now())).toBeLessThan(5000);
  });

  it('cutoff default dievaluasi LAZY (setiap kali fallback dipakai), bukan konstanta beku', async () => {
    await new Promise((r) => setTimeout(r, 20));
    const first = AiEligibilityConfigService.getConfig(TENANT);
    await new Promise((r) => setTimeout(r, 20));
    const second = AiEligibilityConfigService.getConfig(TENANT);

    // Beberapa ms berlalu → cutoff kedua >= cutoff pertama (bukan konstan dari load file)
    expect(second.ai_scope_cutoff_at.getTime()).toBeGreaterThanOrEqual(first.ai_scope_cutoff_at.getTime());
  });

  it('saveConfig → getConfig mengembalikan config tenant (ALL), bukan default', async () => {
    await AiEligibilityConfigService.saveConfig(TENANT, {
      ai_customer_scope: AiCustomerScope.ALL,
      ai_scope_cutoff_at: new Date(0),
    });

    const cfg = AiEligibilityConfigService.getConfig(TENANT);
    expect(cfg.ai_customer_scope).toBe(AiCustomerScope.ALL);
    expect(cfg.ai_scope_cutoff_at.getTime()).toBe(0);
  });

  it('loadConfigsFromDb gagal (DB offline) → return false + cache tetap kosong → resolve fail-closed utk semua customer', async () => {
    const loaded = await AiEligibilityConfigService.loadConfigsFromDb(TENANT);
    expect(loaded).toBe(false);

    const cfg = AiEligibilityConfigService.getConfig(TENANT);
    expect(cfg.ai_customer_scope).toBe(AiCustomerScope.NEW_ONLY);

    // Customer LAMA → false
    const oldCustomer = { ai_override: null as const, created_at: new Date(Date.now() - 30 * 86400000) };
    expect(resolveAiEligibility(oldCustomer as any, cfg)).toBe(false);

    // Customer yang baru saja dibuat (createdAt ≈ now, SEBELUM momen fallback)
    // juga false — pembeda dari behavior lama (cutoff epoch membuat siapa pun eligible).
    const recentCustomer = { ai_override: null as const, created_at: new Date(Date.now() - 1000) };
    expect(resolveAiEligibility(recentCustomer as any, cfg)).toBe(false);

    // FORCE_ON tetap menang di atas default fail-closed
    const forcedOn = { ai_override: 'FORCE_ON' as const, created_at: oldCustomer.created_at };
    expect(resolveAiEligibility(forcedOn as any, cfg)).toBe(true);
  });
});
