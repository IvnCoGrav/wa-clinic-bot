import { describe, it, expect } from 'vitest';
import { resolveExpectedPayment } from '../../src/domain/payment-expected';

describe('resolveExpectedPayment (Single Source of Truth Tagihan Reservasi)', () => {
  it('1. Tanpa diskon: 230.000 + 20.000 = 250.000, struk 250.000 → EXACT, isMismatch=false', () => {
    const res = resolveExpectedPayment({
      purchaseValue: 230000,
      deliveryFee: 20000,
      receiptAmount: 250000,
    });
    expect(res.gross).toBe(230000);
    expect(res.discount).toBe(0);
    expect(res.net).toBe(230000);
    expect(res.deliveryFee).toBe(20000);
    expect(res.expected).toBe(250000);
    expect(res.status).toBe('EXACT');
    expect(res.isMismatch).toBe(false);
    expect(res.isUnderpaid).toBe(false);
    expect(res.isOverpaid).toBe(false);
    expect(res.difference).toBe(0);
  });

  it('2. Diskon 50.000: gross 300.000, ongkir 20.000 → expected 270.000; struk 270.000 → EXACT', () => {
    const res = resolveExpectedPayment({
      purchaseValue: 300000,
      discountAmount: 50000,
      deliveryFee: 20000,
      receiptAmount: 270000,
    });
    expect(res.gross).toBe(300000);
    expect(res.discount).toBe(50000);
    expect(res.net).toBe(250000);
    expect(res.deliveryFee).toBe(20000);
    expect(res.expected).toBe(270000);
    expect(res.status).toBe('EXACT');
    expect(res.isMismatch).toBe(false);
  });

  it('3. Diskon > gross → discount = gross, expected = ongkir (tidak pernah negatif)', () => {
    const res = resolveExpectedPayment({
      purchaseValue: 100000,
      discountAmount: 150000,
      deliveryFee: 20000,
      receiptAmount: 20000,
    });
    expect(res.discount).toBe(100000);
    expect(res.net).toBe(0);
    expect(res.expected).toBe(20000);
    expect(res.status).toBe('EXACT');
    expect(res.isMismatch).toBe(false);
  });

  it('4. Diskon negatif / null → discount = 0', () => {
    const res = resolveExpectedPayment({
      purchaseValue: 100000,
      discountAmount: -20000,
      deliveryFee: 15000,
      receiptAmount: 115000,
    });
    expect(res.discount).toBe(0);
    expect(res.expected).toBe(115000);
    expect(res.status).toBe('EXACT');
  });

  it('5. purchase_value negatif / non-numeric → 0', () => {
    const res = resolveExpectedPayment({
      purchaseValue: -50000 as any,
      deliveryFee: 20000,
      receiptAmount: 20000,
    });
    expect(res.gross).toBe(0);
    expect(res.expected).toBe(20000);
    // Jika gross = 0 (harga layanan belum diketahui), status = UNVERIFIED
    expect(res.status).toBe('UNVERIFIED');
  });

  it('6. Ongkir null / undefined → 0', () => {
    const res = resolveExpectedPayment({
      purchaseValue: 150000,
      deliveryFee: null,
      receiptAmount: 150000,
    });
    expect(res.deliveryFee).toBe(0);
    expect(res.expected).toBe(150000);
    expect(res.status).toBe('EXACT');
  });

  it('7. Struk null → UNVERIFIED, isMismatch=false', () => {
    const res = resolveExpectedPayment({
      purchaseValue: 200000,
      deliveryFee: 20000,
      receiptAmount: null,
    });
    expect(res.receiptAmount).toBeNull();
    expect(res.status).toBe('UNVERIFIED');
    expect(res.isMismatch).toBe(false);
  });

  it('8. Struk 0 → UNVERIFIED', () => {
    const res = resolveExpectedPayment({
      purchaseValue: 200000,
      deliveryFee: 20000,
      receiptAmount: 0,
    });
    expect(res.receiptAmount).toBeNull();
    expect(res.status).toBe('UNVERIFIED');
    expect(res.isMismatch).toBe(false);
  });

  it('9. Kurang bayar 150.000 dari 250.000 → UNDERPAID, difference=-100.000', () => {
    const res = resolveExpectedPayment({
      purchaseValue: 230000,
      deliveryFee: 20000,
      receiptAmount: 150000,
    });
    expect(res.expected).toBe(250000);
    expect(res.status).toBe('UNDERPAID');
    expect(res.isMismatch).toBe(true);
    expect(res.isUnderpaid).toBe(true);
    expect(res.isOverpaid).toBe(false);
    expect(res.difference).toBe(-100000);
  });

  it('10. Lebih bayar 300.000 dari 250.000 → OVERPAID, difference=+50.000', () => {
    const res = resolveExpectedPayment({
      purchaseValue: 230000,
      deliveryFee: 20000,
      receiptAmount: 300000,
    });
    expect(res.expected).toBe(250000);
    expect(res.status).toBe('OVERPAID');
    expect(res.isMismatch).toBe(true);
    expect(res.isUnderpaid).toBe(false);
    expect(res.isOverpaid).toBe(true);
    expect(res.difference).toBe(50000);
  });

  it('11. Toleransi 3: expected 250.000, struk 250.003 → EXACT (tolerance 3)', () => {
    const res = resolveExpectedPayment(
      {
        purchaseValue: 230000,
        deliveryFee: 20000,
        receiptAmount: 250003,
      },
      { tolerance: 3 }
    );
    expect(res.status).toBe('EXACT');
    expect(res.isMismatch).toBe(false);
  });

  it('12. Expected 0 (layanan 0 & ongkir 0) + struk 100.000 → UNVERIFIED (bukan overpaid)', () => {
    const res = resolveExpectedPayment({
      purchaseValue: 0,
      deliveryFee: 0,
      receiptAmount: 100000,
    });
    expect(res.status).toBe('UNVERIFIED');
    expect(res.isMismatch).toBe(false);
  });

  it('13. Harga layanan 0 + ongkir 20.000 + struk 10.000 → UNVERIFIED (harga layanan belum diketahui)', () => {
    const res = resolveExpectedPayment({
      purchaseValue: 0,
      deliveryFee: 20000,
      receiptAmount: 10000,
    });
    expect(res.status).toBe('UNVERIFIED');
    expect(res.isMismatch).toBe(false);
  });

  it('14. Pembulatan desimal 250000.6 → 250001', () => {
    const res = resolveExpectedPayment({
      purchaseValue: 250000.6,
      deliveryFee: 0,
    });
    expect(res.gross).toBe(250001);
    expect(res.expected).toBe(250001);
  });
});
