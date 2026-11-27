import { describe, it, expect } from 'vitest';
import {
  resolveRevenueAmounts,
  createRevenueAccumulator,
  addRevenueAmounts,
} from '../../src/services/revenue-analytics.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('Revenue Analytics Service (Fase 1)', () => {
  describe('resolveRevenueAmounts', () => {
    it('menghitung booking value, diskon, dan ongkir untuk reservasi lunas', async () => {
      const reservation = {
        purchase_value: 200000,
        discount_amount: 25000,
        delivery_fee: 15000,
        purchase_occurred_at: new Date('2026-11-20T10:00:00Z'),
      };

      const result = await resolveRevenueAmounts(reservation, DEFAULT_TENANT_ID, {
        includeDeliveryFee: true,
      });

      expect(result.treatmentGross).toBe(200000);
      expect(result.discount).toBe(25000);
      expect(result.treatmentNet).toBe(175000);
      expect(result.deliveryFee).toBe(15000);
      expect(result.bookingValue).toBe(190000); // 175000 + 15000
      expect(result.isPaid).toBe(true);
      expect(result.paidAmount).toBe(190000);
      expect(result.pendingAmount).toBe(0);
    });

    it('menghitung pending amount untuk reservasi yang belum lunas (purchase_occurred_at null)', async () => {
      const reservation = {
        purchase_value: 150000,
        discount_amount: 0,
        delivery_fee: 10000,
        purchase_occurred_at: null,
      };

      const result = await resolveRevenueAmounts(reservation, DEFAULT_TENANT_ID, {
        includeDeliveryFee: true,
      });

      expect(result.treatmentGross).toBe(150000);
      expect(result.discount).toBe(0);
      expect(result.treatmentNet).toBe(150000);
      expect(result.deliveryFee).toBe(10000);
      expect(result.bookingValue).toBe(160000);
      expect(result.isPaid).toBe(false);
      expect(result.paidAmount).toBe(0);
      expect(result.pendingAmount).toBe(160000);
    });

    it('dapat mengecualikan ongkir bila includeDeliveryFee: false', async () => {
      const reservation = {
        purchase_value: 100000,
        discount_amount: 10000,
        delivery_fee: 20000,
        purchase_occurred_at: new Date('2026-11-20T10:00:00Z'),
      };

      const result = await resolveRevenueAmounts(reservation, DEFAULT_TENANT_ID, {
        includeDeliveryFee: false,
      });

      expect(result.deliveryFee).toBe(0);
      expect(result.treatmentNet).toBe(90000);
      expect(result.bookingValue).toBe(90000);
      expect(result.paidAmount).toBe(90000);
      expect(result.pendingAmount).toBe(0);
    });

    it('mendukung fallback items bila purchase_value tidak ada', async () => {
      const reservation = {
        purchase_value: 0,
        items: [{ price: 60000 }, { price: 40000 }],
        discount_amount: 5000,
        delivery_fee: 10000,
        purchase_occurred_at: null,
      };

      const result = await resolveRevenueAmounts(reservation, DEFAULT_TENANT_ID);

      expect(result.treatmentGross).toBe(100000);
      expect(result.discount).toBe(5000);
      expect(result.treatmentNet).toBe(95000);
      expect(result.deliveryFee).toBe(10000);
      expect(result.bookingValue).toBe(105000);
      expect(result.pendingAmount).toBe(105000);
      expect(result.paidAmount).toBe(0);
    });
  });

  describe('createRevenueAccumulator & addRevenueAmounts', () => {
    it('mengakumulasi beberapa transaksi dengan tepat', () => {
      const accumulator = createRevenueAccumulator();

      expect(accumulator).toEqual({
        treatmentGross: 0,
        discount: 0,
        treatmentNet: 0,
        deliveryFee: 0,
        bookingValue: 0,
        paidAmount: 0,
        pendingAmount: 0,
        isPaid: false,
      });

      const item1 = {
        treatmentGross: 100000,
        discount: 10000,
        treatmentNet: 90000,
        deliveryFee: 10000,
        bookingValue: 100000,
        paidAmount: 100000,
        pendingAmount: 0,
        isPaid: true,
      };

      const item2 = {
        treatmentGross: 200000,
        discount: 0,
        treatmentNet: 200000,
        deliveryFee: 15000,
        bookingValue: 215000,
        paidAmount: 0,
        pendingAmount: 215000,
        isPaid: false,
      };

      addRevenueAmounts(accumulator, item1);
      expect(accumulator.bookingValue).toBe(100000);
      expect(accumulator.paidAmount).toBe(100000);
      expect(accumulator.pendingAmount).toBe(0);
      expect(accumulator.isPaid).toBe(true);

      addRevenueAmounts(accumulator, item2);
      expect(accumulator.treatmentGross).toBe(300000);
      expect(accumulator.discount).toBe(10000);
      expect(accumulator.treatmentNet).toBe(290000);
      expect(accumulator.deliveryFee).toBe(25000);
      expect(accumulator.bookingValue).toBe(315000);
      expect(accumulator.paidAmount).toBe(100000);
      expect(accumulator.pendingAmount).toBe(215000);
      expect(accumulator.isPaid).toBe(false); // Karena masih ada pendingAmount
    });
  });
});
