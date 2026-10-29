import { describe, it, expect } from 'vitest';
import { evaluatePaymentProof } from '../../packages/admin-dashboard/src/utils/paymentProof';

describe('Payment Proof Adapter (packages/admin-dashboard/src/utils/paymentProof.ts)', () => {
  it('1. Payload EXACT → match_green', () => {
    const res = evaluatePaymentProof({
      proof_url: 'https://example.com/proof.jpg',
      paymentEvaluation: {
        expected: 250000,
        receiptAmount: 250000,
        status: 'EXACT',
        isMismatch: false,
        isUnderpaid: false,
        isOverpaid: false,
        difference: 0,
      },
    });

    expect(res.badgeVariant).toBe('match_green');
    expect(res.badgeLabel).toBe('Nominal Sesuai');
    expect(res.isMismatch).toBe(false);
  });

  it('2. Payload UNDERPAID → mismatch_red + label Kurang Rp ...', () => {
    const res = evaluatePaymentProof({
      proof_url: 'https://example.com/proof.jpg',
      paymentEvaluation: {
        expected: 250000,
        receiptAmount: 150000,
        status: 'UNDERPAID',
        isMismatch: true,
        isUnderpaid: true,
        isOverpaid: false,
        difference: -100000,
      },
    });

    expect(res.badgeVariant).toBe('mismatch_red');
    expect(res.badgeLabel).toContain('Kurang');
    expect(res.badgeLabel).toContain('100.000');
    expect(res.isMismatch).toBe(true);
    expect(res.isUnderpaid).toBe(true);
  });

  it('3. Payload OVERPAID → mismatch_red + label Lebih Rp ...', () => {
    const res = evaluatePaymentProof({
      proof_url: 'https://example.com/proof.jpg',
      paymentEvaluation: {
        expected: 250000,
        receiptAmount: 300000,
        status: 'OVERPAID',
        isMismatch: true,
        isUnderpaid: false,
        isOverpaid: true,
        difference: 50000,
      },
    });

    expect(res.badgeVariant).toBe('mismatch_red');
    expect(res.badgeLabel).toContain('Lebih');
    expect(res.badgeLabel).toContain('50.000');
    expect(res.isMismatch).toBe(true);
    expect(res.isOverpaid).toBe(true);
  });

  it('4. Payload UNVERIFIED → unverified_gray', () => {
    const res = evaluatePaymentProof({
      proof_url: 'https://example.com/proof.jpg',
      paymentEvaluation: {
        expected: 250000,
        receiptAmount: null,
        status: 'UNVERIFIED',
        isMismatch: false,
        isUnderpaid: false,
        isOverpaid: false,
        difference: 0,
      },
    });

    expect(res.badgeVariant).toBe('unverified_gray');
    expect(res.badgeLabel).toBe('Nominal Struk Perlu Dicek');
  });

  it('5. paymentEvaluation tidak ada → unverified_gray, TIDAK menghitung dari purchase_value', () => {
    const res = evaluatePaymentProof({
      proof_url: 'https://example.com/proof.jpg',
      // Tidak ada paymentEvaluation
    } as any);

    expect(res.badgeVariant).toBe('unverified_gray');
    expect(res.badgeLabel).toBe('Evaluasi Belum Tersedia');
  });

  it('6. Reservation tanpa proof_url → Tidak Ada Bukti', () => {
    const res = evaluatePaymentProof({
      proof_url: null,
    });

    expect(res.hasProof).toBe(false);
    expect(res.badgeVariant).toBe('unverified_gray');
    expect(res.badgeLabel).toBe('Tidak Ada Bukti');
  });

  it('7. raw_text berisi [RECEIPT_AMOUNT:999999] tidak memengaruhi hasil (regresi anti-parsing)', () => {
    const res = evaluatePaymentProof({
      proof_url: 'https://example.com/proof.jpg',
      raw_text: 'Reservasi [RECEIPT_AMOUNT:999999]',
      paymentEvaluation: {
        expected: 200000,
        receiptAmount: 200000,
        status: 'EXACT',
        isMismatch: false,
        isUnderpaid: false,
        isOverpaid: false,
        difference: 0,
      },
    } as any);

    expect(res.badgeVariant).toBe('match_green');
    expect(res.receiptAmount).toBe(200000);
  });
});
