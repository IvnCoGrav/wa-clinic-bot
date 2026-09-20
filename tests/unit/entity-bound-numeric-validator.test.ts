import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateNumericFacts } from '../../src/v3/guardrails/numeric-fact-validator';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';

/**
 * Stage 6-CLM (RC-07) — entity-bound pricing.
 * Harga layanan B TIDAK BOLEH mengesahkan harga yang diklaim untuk layanan A
 * pada turn yang punya konteks entity (tool katalog turn ini).
 */
const CATALOG = [
  { name: 'Pijat A', category: 'BABY', promoPrice: 75000, originalPrice: 90000 },
  { name: 'Pijat B', category: 'BABY', promoPrice: 150000, originalPrice: 180000 },
] as any;

const TURN_TOOL = [
  { name: 'get_catalog_and_price', result: { treatments: [{ name: 'Pijat A', promoPrice: 75000, originalPrice: 90000 }] } },
];

describe('Entity-bound numeric validation (RC-07)', () => {
  beforeEach(() => { vi.spyOn(treatmentCatalogService, 'getAllServices').mockReturnValue(CATALOG); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('harga entity-bound BENAR (Pijat A = 75k) → VALID', () => {
    const r = validateNumericFacts('Untuk *Pijat A* promonya Rp 75.000 ya Bunda', TURN_TOOL as any, { tenantId: 'default-tenant' } as any);
    expect(r.isValid).toBe(true);
  });

  it('harga layanan LAIN (Pijat B = 150k) dipakai untuk turn ini → INVALID', () => {
    const r = validateNumericFacts('Totalnya *Rp 150.000* ya Bunda', TURN_TOOL as any, { tenantId: 'default-tenant' } as any);
    expect(r.isValid).toBe(false);
  });

  it('fallback: tanpa sumber entity-bound, harga katalog masih sah', () => {
    const r = validateNumericFacts('Promo *Pijat B* Rp 150.000 ya', [] as any, { tenantId: 'default-tenant' } as any);
    expect(r.isValid).toBe(true);
  });
});
