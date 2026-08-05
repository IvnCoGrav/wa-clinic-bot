import { describe, it, expect } from 'vitest';
import { AiCustomerScope, AiOverride } from '@prisma/client';
import { resolveAiEligibility } from '../../src/services/ai-eligibility.service';

/**
 * Test AI Rollout Scope — gate eligibility AI per customer.
 *
 * Precedence (lihat JSDoc di ai-eligibility.service.ts):
 *   1. ai_override FORCE_ON  -> true  (nangis ANY scope)
 *   2. ai_override FORCE_OFF -> false (nangis ANY scope)
 *   3. scope ALL             -> true
 *   4. scope NEW_ONLY        -> created_at >= cutoff
 *   5. fail-closed           -> false
 *
 * CATATAN khusus: kasus `scope=ALL` + `override=FORCE_OFF` WAJIB `false`
 * (bukan `true`) — kalau ini kelewat, precedence diam-diam balik ke urutan lama.
 * Fail-closed di langkah 4 (cutoff/created_at null) dipisah dari fail-closed di
 * langkah 5 (scope tak dikenal) supaya coverage-nya jelas mana yang ketrigger.
 *
 * Nama field memakai snake_case sesuai Prisma model project ini.
 */

const CUTOFF = new Date('2026-08-01T00:00:00Z');

// created_at SEBELUM cutoff = "legacy" customer (BLOCK di NEW_ONLY)
function legacyCustomer(override: AiOverride | null = null) {
  return { ai_override: override, created_at: new Date('2026-07-20T00:00:00Z') };
}

// created_at SESUDAH cutoff = "new" customer (ALLOWED di NEW_ONLY)
function newCustomer(override: AiOverride | null = null) {
  return { ai_override: override, created_at: new Date('2026-08-03T00:00:00Z') };
}

function scope(scope: AiCustomerScope, cutoff: Date | null = CUTOFF) {
  return { ai_customer_scope: scope, ai_scope_cutoff_at: cutoff };
}

describe('resolveAiEligibility — override precedence (ANY scope)', () => {
  it('FORCE_ON selalu true walau customer legacy di scope NEW_ONLY', () => {
    expect(resolveAiEligibility(legacyCustomer(AiOverride.FORCE_ON), scope(AiCustomerScope.NEW_ONLY))).toBe(true);
  });

  it('FORCE_ON selalu true di scope ALL', () => {
    expect(resolveAiEligibility(newCustomer(AiOverride.FORCE_ON), scope(AiCustomerScope.ALL))).toBe(true);
  });

  // KASUS KRITIS: kalau ini lolos jadi true, precedence-nya diam-diam balik.
  it('FORCE_OFF di scope ALL tetap false — override menang walau rollout full', () => {
    expect(resolveAiEligibility(newCustomer(AiOverride.FORCE_OFF), scope(AiCustomerScope.ALL))).toBe(false);
  });

  it('FORCE_OFF di scope NEW_ONLY (customer baru) tetap false', () => {
    expect(resolveAiEligibility(newCustomer(AiOverride.FORCE_OFF), scope(AiCustomerScope.NEW_ONLY))).toBe(false);
  });
});

describe('resolveAiEligibility — scope ALL', () => {
  it('ALL menang tanpa override: customer legacy jadi true', () => {
    expect(resolveAiEligibility(legacyCustomer(null), scope(AiCustomerScope.ALL))).toBe(true);
  });

  it('ALL menang tanpa override: customer baru jadi true', () => {
    expect(resolveAiEligibility(newCustomer(null), scope(AiCustomerScope.ALL))).toBe(true);
  });
});

describe('resolveAiEligibility — scope NEW_ONLY', () => {
  it('customer baru (created_at >= cutoff) tanpa override -> true', () => {
    expect(resolveAiEligibility(newCustomer(null), scope(AiCustomerScope.NEW_ONLY))).toBe(true);
  });

  it('customer legacy (created_at < cutoff) tanpa override -> false', () => {
    expect(resolveAiEligibility(legacyCustomer(null), scope(AiCustomerScope.NEW_ONLY))).toBe(false);
  });

  it('boundary: created_at tepat = cutoff -> true (>= bukan >)', () => {
    const c = { ai_override: null as AiOverride | null, created_at: new Date(CUTOFF) };
    expect(resolveAiEligibility(c, scope(AiCustomerScope.NEW_ONLY))).toBe(true);
  });
});

describe('resolveAiEligibility — fail-closed (field null/undefined)', () => {
  it('cutoff null di NEW_ONLY -> false (fail-closed langkah 4)', () => {
    expect(resolveAiEligibility(newCustomer(null), scope(AiCustomerScope.NEW_ONLY, null))).toBe(false);
  });

  it('created_at null di NEW_ONLY -> false (fail-closed langkah 4)', () => {
    const c = { ai_override: null as AiOverride | null, created_at: null as unknown as Date };
    expect(resolveAiEligibility(c, scope(AiCustomerScope.NEW_ONLY))).toBe(false);
  });

  it('cutoff null di ALL -> tetap true (fail-closed tidak relevan, scope menang)', () => {
    expect(resolveAiEligibility(newCustomer(null), scope(AiCustomerScope.ALL, null))).toBe(true);
  });

  it('scope tak dikenal (null/bukan enum, row korup) -> false (fail-closed langkah 5)', () => {
    const bad = { ai_customer_scope: null as unknown as AiCustomerScope, ai_scope_cutoff_at: CUTOFF };
    expect(resolveAiEligibility(newCustomer(null), bad)).toBe(false);
  });
});