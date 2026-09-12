import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateNumericFacts } from '../../src/v3/guardrails/numeric-fact-validator';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';

/**
 * Plan 6 FASE 1 (Issue #26) — Kombo aritmatika multi-treatment ad-hoc.
 * Turn konsultasi ("Pijat Ceria 75rb + Nafsu Makan 60rb = ?"): total cerdas
 * LLM atas subset layanan resmi DILARANG dituduh halusinasi.
 * Hermetik: katalog global di-mock (hanya 1 add-on) agar angka turn terisolasi.
 */
const ADDON_ONLY_CATALOG = [
  { name: 'Sinar Moksa', category: 'ADD_ON', promoPrice: 25000, originalPrice: 30000 },
] as any;

const CONSULT_TOOLS = [
  {
    name: 'get_catalog_and_price',
    result: {
      treatments: [
        { name: 'Pijat Ceria', promoPrice: 75000, originalPrice: 80000 },
        { name: 'Pijat Nafsu Makan', promoPrice: 60000, originalPrice: 65000 },
      ],
    },
  },
];

const DELIVERY_TOOL = {
  name: 'calculate_delivery',
  result: { success: true, ongkirPromo: 10000, ongkirNormal: 15000 },
};

describe('Multi-Treatment Combo Validator (Issue #26)', () => {
  beforeEach(() => {
    vi.spyOn(treatmentCatalogService, 'getAllServices').mockReturnValue(ADDON_ONLY_CATALOG);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('kombo 2 layanan utama (75k + 60k = 135k) -> VALID', () => {
    const r = validateNumericFacts(
      'Kalau ambil Pijat Ceria (Rp 75.000) + Pijat Nafsu Makan (Rp 60.000) totalnya Rp 135.000 ya Bunda',
      CONSULT_TOOLS as any,
      { tenantId: 'default-tenant' } as any
    );
    expect(r.isValid).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it('kombo 2 layanan + 1 add-on (75k + 60k + 25k = 160k) -> VALID', () => {
    const r = validateNumericFacts(
      'Pijat Ceria Rp 75.000 + Nafsu Makan Rp 60.000 + Sinar Moksa Rp 25.000 jadi Rp 160.000 ya Bunda',
      CONSULT_TOOLS as any,
      { tenantId: 'default-tenant' } as any
    );
    expect(r.isValid).toBe(true);
  });

  it('kombo 2 layanan + add-on + ongkir (170k) -> VALID', () => {
    const r = validateNumericFacts(
      'Rinciannya Rp 75.000 + Rp 60.000 + Rp 25.000 + ongkir Rp 10.000 = Rp 170.000 ya Bunda',
      [...CONSULT_TOOLS, DELIVERY_TOOL] as any,
      { tenantId: 'default-tenant' } as any
    );
    expect(r.isValid).toBe(true);
  });

  it('angka fiktif (142k) tetap dicegat -> INVALID', () => {
    const r = validateNumericFacts(
      'Total kombonya Rp 142.000 ya Bunda',
      [...CONSULT_TOOLS, DELIVERY_TOOL] as any,
      { tenantId: 'default-tenant' } as any
    );
    expect(r.isValid).toBe(false);
    expect(r.violations.length).toBeGreaterThan(0);
  });

  it('mode strict (keranjang >=2): total penuh keranjang tetap sah', () => {
    const r = validateNumericFacts(
      'Total kedua treatment Rp 135.000 ya Bunda',
      [] as any,
      {
        tenantId: 'default-tenant',
        session: {
          cartItems: [
            { name: 'Pijat Ceria', price: 75000, promoPrice: 75000 },
            { name: 'Pijat Nafsu Makan', price: 60000, promoPrice: 60000 },
          ],
        },
      } as any
    );
    expect(r.isValid).toBe(true);
  });
});
