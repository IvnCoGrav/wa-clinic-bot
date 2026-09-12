import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PersonaPromptBuilder } from '../../../src/v3/agent/persona';
import { TenantPromptConfigService } from '../../../src/services/tenant-prompt-config.service';
import { __clearBrandCacheForTest, DEFAULT_BRAND_IDENTITY } from '../../../src/config/brand';
import { prisma } from '../../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../../src/config/tenant';

/**
 * Plan 4 Phase 1 — Call 1 Router Prompt tenant-aware (data-driven).
 * - DB offline / tanpa baris config → output async IDENTIK dengan varian sinkron
 *   (fallback pin, zero behavior change).
 * - Ada TenantPromptConfig aktif → 4 section dashboard disuntik sebagai blok overlay.
 * - Ada Tenant.settings.brand → nama bisnis default diganti brand tenant.
 */
describe('Dynamic Router Prompt (Plan 4 Phase 1)', () => {
  beforeEach(() => {
    TenantPromptConfigService.__clearCacheForTest(DEFAULT_TENANT_ID);
    TenantPromptConfigService.__clearCacheForTest('tenant-brand-test');
    __clearBrandCacheForTest();
    vi.restoreAllMocks();
  });

  it('fallback: DB offline → async identik dengan sync', async () => {
    const session = { genderGreeting: 'Bunda' } as any;
    const [asyncOut, syncOut] = await Promise.all([
      PersonaPromptBuilder.buildRouterPromptAsync(session, false, { tenantId: DEFAULT_TENANT_ID }),
      Promise.resolve(PersonaPromptBuilder.buildRouterPrompt(session, false)),
    ]);
    expect(asyncOut).toBe(syncOut);
    expect(asyncOut).toContain(DEFAULT_BRAND_IDENTITY.businessName);
    expect(asyncOut).not.toContain('KONFIGURASI PERSONA TENANT');
  });

  it('menyerap 4 section TenantPromptConfig dari DB', async () => {
    const spy = vi
      .spyOn(TenantPromptConfigService, 'getActivePromptConfig')
      .mockResolvedValue({
        personalityTone: 'MARKER-TONE-UNIK-123',
        answeringHierarchy: 'MARKER-HIERARKI-UNIK-123',
        negativeConstraints: 'MARKER-NEGATIF-UNIK-123',
        medicalOverclaimRules: 'MARKER-OVERCLAIM-UNIK-123',
      });
    try {
      const out = await PersonaPromptBuilder.buildRouterPromptAsync({ genderGreeting: 'Bunda' } as any, true, {
        tenantId: DEFAULT_TENANT_ID,
      });
      expect(out).toContain('KONFIGURASI PERSONA TENANT');
      expect(out).toContain('MARKER-TONE-UNIK-123');
      expect(out).toContain('MARKER-HIERARKI-UNIK-123');
      expect(out).toContain('MARKER-NEGATIF-UNIK-123');
      expect(out).toContain('MARKER-OVERCLAIM-UNIK-123');
      // Base statis tetap dipertahankan (bukan diganti)
      expect(out).toContain('CALL 1 - TOOL ROUTING');
    } finally {
      spy.mockRestore();
      TenantPromptConfigService.__clearCacheForTest(DEFAULT_TENANT_ID);
    }
  });

  it('overlay brand tenant dari Tenant.settings.brand', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      settings: { brand: { businessName: 'Klinik Tes Maju' } },
    } as any);
    const out = await PersonaPromptBuilder.buildRouterPromptAsync({ genderGreeting: 'Bunda' } as any, false, {
      tenantId: 'tenant-brand-test',
    });
    expect(out).toContain('Klinik Tes Maju');
    expect(out).not.toContain(DEFAULT_BRAND_IDENTITY.businessName);
  });
});
