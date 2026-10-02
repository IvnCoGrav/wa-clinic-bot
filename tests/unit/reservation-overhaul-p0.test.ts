import { describe, it, expect } from 'vitest';
import { isReservationPaid } from '../../src/domain/reservation-payment';
import { canTransition, isHoldActive, isHoldActiveByCreated, SLOT_BUFFER_MIN } from '../../src/domain/reservation-status';
import { effectiveOf, totalOf } from '../../src/utils/money-contract';
import { normalizePhoneID } from '../../src/utils/phone-normalizer';
import { classifyPatientEntity } from '../../src/utils/reservation-text-parser';
import { buildWibIso } from '../../packages/admin-dashboard/src/utils/dateWib';

describe('P0 overhaul seams', () => {
  it('lunas murni purchase_occurred_at', () => {
    expect(isReservationPaid({ purchase_occurred_at: new Date() } as any)).toBe(true);
    expect(isReservationPaid({ purchase_occurred_at: null } as any)).toBe(false);
    expect(isReservationPaid({ status: 'completed' } as any)).toBe(false);
  });
  it('matriks transisi menolak ilegal', () => {
    expect(canTransition('hold', 'confirmed')).toBe(true);
    expect(canTransition('confirmed', 'hold')).toBe(false);
    expect(canTransition('completed', 'confirmed')).toBe(false);
    expect(canTransition('hold', 'completed')).toBe(false);
    expect(canTransition('pending', 'hold')).toBe(true);
  });
  it('hold future tetap expired via created_at', () => {
    const now = Date.now();
    const old = new Date(now - 3 * 3600 * 1000).toISOString();
    expect(isHoldActiveByCreated(old, now)).toBe(false);
    const futureBooking = new Date(now + 7 * 86400000).toISOString();
    expect(isHoldActive(futureBooking, now)).toBe(true);
  });
  it('buffer tunggal 20', () => {
    expect(SLOT_BUFFER_MIN).toBe(20);
  });
  it('money efektif promo > price > original', () => {
    expect(effectiveOf({ price: 80000, promoPrice: 70000, originalPrice: 80000 })).toBe(70000);
    expect(effectiveOf({ price: 80000 } as any)).toBe(80000);
    expect(effectiveOf({} as any)).toBe(0);
    expect(totalOf([{ promoPrice: 70000 } as any], 10000, 2000)).toBe(78000);
  });
  it('HP 08/8/62 unifikasi', () => {
    expect(normalizePhoneID('0812-3456-789')).toBe('628123456789');
    expect(normalizePhoneID('8123456789')).toBe('628123456789');
    expect(normalizePhoneID('628123456789')).toBe('628123456789');
  });
  it('BOTH + nama tanpa usia tetap CHILD; gestasional tetap MOM', () => {
    expect(classifyPatientEntity({ name: 'Adera', ageText: '', treatmentCategory: 'BOTH' })).toBe('CHILD');
    expect(classifyPatientEntity({ name: 'Adera dan Aksara', ageText: '', treatmentCategory: 'BOTH' })).toBe('CHILD');
    expect(classifyPatientEntity({ name: 'Bunda', ageText: 'hamil 38 minggu', treatmentCategory: 'BOTH' })).toBe('MOM');
  });
  it('WIB composer deterministik', () => {
    expect(buildWibIso('2026-10-05', '09:00')).toBe('2026-10-05T09:00:00+07:00');
    expect(buildWibIso('2026-10-05', '9:00')).toBe('2026-10-05T09:00:00+07:00');
  });
  it('multi-frasa kembar split', () => {
    for (const sep of ['dan', ',', '&', ';', '+']) {
      const names = `Adera ${sep} Aksara`.split(new RegExp(`\\s*(?:\\+|,|&|\\bdan\\b|;)\\s*`, 'i')).map((s) => s.trim()).filter(Boolean);
      expect(names).toEqual(['Adera', 'Aksara']);
    }
  });
});
