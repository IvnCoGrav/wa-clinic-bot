import { describe, it, expect } from 'vitest';
import { withPaymentEvaluation } from '../../src/routes/admin/shared/reservation-response';

describe('withPaymentEvaluation Response Wrapper (Fase 4-5)', () => {
  it('mengembalikan input falsy (null / undefined) apa adanya tanpa melempar error', () => {
    expect(withPaymentEvaluation(null)).toBeNull();
    expect(withPaymentEvaluation(undefined)).toBeUndefined();
  });

  it('menyematkan paymentEvaluation pada objek reservasi valid', () => {
    const reservation = {
      id: 'res-1',
      purchase_value: 100000,
      delivery_fee: 20000,
      discount_amount: 10000,
      receipt_amount: 110000,
    };

    const result = withPaymentEvaluation(reservation);
    expect(result).toBeDefined();
    expect(result?.id).toBe('res-1');
    expect(result?.paymentEvaluation).toBeDefined();
    expect(result?.paymentEvaluation.expected).toBe(110000);
    expect(result?.paymentEvaluation.isMismatch).toBe(false);
  });

  it('menghitung ulang paymentEvaluation jika properti lama sudah ada (spread order precedence)', () => {
    const reservationWithOldEval = {
      id: 'res-2',
      purchase_value: 100000,
      delivery_fee: 20000,
      discount_amount: 0,
      receipt_amount: 50000,
      paymentEvaluation: { dummy: 'old-value', isMismatch: false } as any,
    };

    const result = withPaymentEvaluation(reservationWithOldEval);
    expect(result).toBeDefined();
    expect(result?.paymentEvaluation.expected).toBe(120000);
    expect(result?.paymentEvaluation.isMismatch).toBe(true);
    expect((result?.paymentEvaluation as any).dummy).toBeUndefined();
  });

  it('tidak memutasi objek asli secara in-place (immutability)', () => {
    const original = { id: 'res-3', purchase_value: 50000 };
    const result = withPaymentEvaluation(original);
    expect(result).not.toBe(original);
    expect((original as any).paymentEvaluation).toBeUndefined();
  });
});
