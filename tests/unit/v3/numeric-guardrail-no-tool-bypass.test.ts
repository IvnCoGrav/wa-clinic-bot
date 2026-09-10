import { describe, it, expect } from 'vitest';
import { validateNumericFacts } from '../../../src/v3/guardrails/numeric-fact-validator';

/**
 * Phase 4+6 (audit 854065 Turn 9-10) — omission detector: turn TANPA tool
 * yang mengklaim total parsial (layanan Bunda hilang) WAJIB dicegat bila
 * keranjang aktif, dengan rincian item untuk re-prompt koreksi.
 */
const cartSession = {
  totalPrice: 265000,
  cartItems: [
    { name: 'Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)', price: 90000, promoPrice: 70000 },
    { name: 'Pijat Bayi Ceria (Rileksasi)', price: 80000, promoPrice: 60000 },
    { name: 'Oksitosin Massage Fullbody', price: 130000, promoPrice: 105000 },
  ],
  location: { ongkirPromo: 30000, ongkirNormal: 35000 },
};

describe('Numeric Guardrail No-Tool Bypass (omission)', () => {
  it('total parsial tanpa Bunda (Rp 160.000) -> INVALID + sebut grand total resmi', () => {
    // Rincian parsial resmi disebut (70rb+60rb) tapi grand total (265rb)
    // hilang bersama layanan Bunda — pola Turn 9-10 audit 854065.
    const r = validateNumericFacts(
      'Rinciannya Adik Rp 70.000, Kakak Rp 60.000, jadi totalnya Rp 160.000 ya Bunda',
      [],
      { tenantId: 'default-tenant', session: cartSession } as any
    );
    expect(r.isValid).toBe(false);
    expect(r.violations.some((v) => v.includes('MENGHILANGKAN'))).toBe(true);
    expect(r.violations.some((v) => v.includes('Oksitosin'))).toBe(true);
  });

  it('grand total utuh disebut -> VALID (tanpa tool sekalipun)', () => {
    const r = validateNumericFacts(
      'Rinciannya Adik Rp 70.000 + Kakak Rp 60.000 + Bunda Rp 105.000 + ongkir Rp 30.000, total Rp 265.000 ya Bunda',
      [],
      { tenantId: 'default-tenant', session: cartSession } as any
    );
    expect(r.isValid).toBe(true);
  });

  it('konsultasi tanpa angka -> VALID (bukan klaim total)', () => {
    const r = validateNumericFacts(
      'Pijat Lahap Juara ini bagus untuk nafsu makan si kecil Bunda',
      [],
      { tenantId: 'default-tenant', session: cartSession } as any
    );
    expect(r.isValid).toBe(true);
  });

  it('nominal halusinasi murni tetap dicegat (cek nominal existing)', () => {
    const r = validateNumericFacts(
      'Totalnya Rp 999.000 ya Bunda',
      [],
      { tenantId: 'default-tenant', session: cartSession } as any
    );
    expect(r.isValid).toBe(false);
  });
});
