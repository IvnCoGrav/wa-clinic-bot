import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isMissingColumnError } from '../../src/utils/prisma-errors';
import { getBrandIdentityAsync, DEFAULT_BRAND_IDENTITY, __clearBrandCacheForTest } from '../../src/config/brand';
import { TenantPromptConfigService } from '../../src/services/tenant-prompt-config.service';
import { prisma } from '../../src/db/client';

/**
 * Plan 6 FASE 4 (Issue #30) — Resiliensi P2022 tenants.settings.
 * DB belum termigrasi penuh: pembaca kolom opsional kembali ke default
 * TANPA melempar dan TANPA membanjiri log; tidak ada unhandled error.
 */
function p2022(column: string): any {
  const err: any = new Error(
    `Invalid prisma.tenant.findUnique() invocation: The column \`tenants.${column}\` does not exist in the current database.`
  );
  err.code = 'P2022';
  return err;
}

describe('Tenant Settings Resilience (Issue #30)', () => {
  beforeEach(() => {
    __clearBrandCacheForTest();
    TenantPromptConfigService.__clearCacheForTest('tenant-p22-test');
    vi.restoreAllMocks();
  });

  it('isMissingColumnError: P2022/42703 terdeteksi; error generik tidak', () => {
    expect(isMissingColumnError(p2022('settings'))).toBe(true);
    expect(isMissingColumnError(p2022('settings'), 'settings')).toBe(true);
    // P2022 untuk kolom LAIN bukan urusan pemanggil settings -> false (jangan telan)
    expect(isMissingColumnError(p2022('other_col'), 'settings')).toBe(false);
    expect(isMissingColumnError({ code: '42703', message: 'column "settings" does not exist' })).toBe(true);
    expect(isMissingColumnError(new Error('Database offline'))).toBe(false);
    expect(isMissingColumnError(new Error('timeout'))).toBe(false);
  });

  it('getBrandIdentityAsync: P2022 -> default brand, tanpa throw', async () => {
    vi.mocked(prisma.tenant.findUnique).mockRejectedValueOnce(p2022('settings'));
    const brand = await getBrandIdentityAsync('tenant-p22-test');
    expect(brand).toEqual(DEFAULT_BRAND_IDENTITY);
  });

  it('getActivePromptConfig: P2022 -> null (fallback statis), tanpa throw', async () => {
    vi.mocked((prisma as any).tenantPromptConfig.findFirst).mockRejectedValueOnce(p2022('settings'));
    const cfg = await TenantPromptConfigService.getActivePromptConfig('tenant-p22-test');
    expect(cfg).toBeNull();
  });
});
