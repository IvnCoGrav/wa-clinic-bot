import { describe, it, expect } from 'vitest';
import { validateNumericFacts } from '../../src/v3/guardrails/numeric-fact-validator';

/**
 * Sesi 138207 — Ongkir promo sesi (Rp 20.000) adalah angka resmi mandiri dan
 * DILARANG dituduh halusinasi. Akar: ongkir session hanya masuk komposit
 * (layanan+ongkir) tanpa pernah diotorisasi sebagai angka mandiri, sehingga
 * rincian biaya "Rp 75.000 + ongkir Rp 20.000 = Rp 95.000" memicu
 * NUMERIC_HALLUCINATION_DETECTED false-positive + fallback keranjang kaku.
 */
const session138207 = {
  totalPrice: 95000,
  cartItems: [
    { name: 'Pijat Lahap Juara (< 2 thn)', price: 95000, promoPrice: 75000 },
  ],
  location: { ongkirPromo: 20000, ongkirNormal: 25000 },
};

describe('Numeric Validator Session Ongkir (sesi 138207)', () => {
  it('rincian treatment + ongkir promo sesi + total komposit -> VALID', () => {
    const r = validateNumericFacts(
      'Untuk *Pijat Lahap Juara* promonya *Rp 75.000* ya Bunda. Ditambah ongkir promo ke Trosobo (*Rp 20.000*), total keseluruhannya menjadi *Rp 95.000* ya Bunda.',
      [],
      { tenantId: 'default-tenant', session: session138207 } as any
    );
    expect(r.violations).toEqual([]);
    expect(r.isValid).toBe(true);
  });

  it('ongkir promo sesi disebut mandiri (tanpa total) -> VALID', () => {
    const r = validateNumericFacts(
      'Ongkir ke Trosobo promonya Rp 20.000 ya Bunda',
      [],
      { tenantId: 'default-tenant', session: session138207 } as any
    );
    expect(r.isValid).toBe(true);
  });

  it('nominal karangan tetap dicegat (Rp 999.000) -> INVALID', () => {
    const r = validateNumericFacts(
      'Totalnya Rp 999.000 ya Bunda',
      [],
      { tenantId: 'default-tenant', session: session138207 } as any
    );
    expect(r.isValid).toBe(false);
  });
});
