import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractRupiahAmount, maybeFirePurchaseEvent } from '../../src/services/purchase-detection.service';
import * as capi from '../../src/services/capi.service';
import { prisma } from '../../src/db/client';

describe('purchase-detection.service', () => {
  describe('extractRupiahAmount', () => {
    it('mengambil nominal dari "Payment 250000"', () => {
      expect(extractRupiahAmount('Payment 250000')).toBe(250000);
    });
    it('mengambil nominal dari "Payment : Rp 150.000"', () => {
      expect(extractRupiahAmount('Payment : Rp 150.000')).toBe(150000);
    });
    it('mengambil nominal dari "payment Rp250000 bunda"', () => {
      expect(extractRupiahAmount('payment Rp250000 bunda')).toBe(250000);
    });
    it('mengambil nilai terbesar dari "Payment 250000 dan Rp 350000"', () => {
      expect(extractRupiahAmount('Payment 250000 dan Rp 350000')).toBe(350000);
    });
    it('mengambil ribu dari "payment 50 rb"', () => {
      expect(extractRupiahAmount('payment 50 rb')).toBe(50000);
    });
    it('tidak mengenal nilai absurd (terlalu kecil)', () => {
      expect(extractRupiahAmount('Payment 100')).toBeUndefined();
    });
    it('returns undefined tanpa nominal', () => {
      expect(extractRupiahAmount('Payment sudah ya')).toBeUndefined();
    });
  });

  describe('maybeFirePurchaseEvent', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    const baseCustomer = { id: 'c1', phone: '628123', adClick: undefined };

    it('tidak fire event jika pesan tanpa keyword format_purchase', async () => {
      const fired = await maybeFirePurchaseEvent({
        customer: baseCustomer,
        conversation: {},
        text: 'sudah bayar 250000 ya bund',
        tenantId: 'default-tenant',
      });
      expect(fired).toBe(false);
    });

    it('fire Purchase & set purchase_event_sent_at saat keyword + nominal', async () => {
      vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
        id: 'r1',
        customer_id: 'c1',
        tenant_id: 'default-tenant',
        status: 'pending',
        treatment_detail: 'Pijat Bayi',
        treatment_category: 'BABY',
        purchase_event_sent_at: null,
        customer: { id: 'c1', adClick: { trackingCode: 'TC1' } },
      } as any);
      vi.mocked(prisma.reservation.update).mockResolvedValue({} as any);

      const fireSpy = vi.spyOn(capi, 'fireCapiEvent').mockImplementation(() => {});

      const fired = await maybeFirePurchaseEvent({
        customer: baseCustomer,
        conversation: {},
        text: 'Payment 250000',
        tenantId: 'default-tenant',
      });

      expect(fired).toBe(true);
      expect(fireSpy).toHaveBeenCalledWith(expect.objectContaining({
        eventName: 'Purchase',
        value: 250000,
        currency: 'IDR',
      }));
      expect(prisma.reservation.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { purchase_event_sent_at: expect.any(Date) },
      });
    });

    it('tidak fire jika keyword ada tapi tanpa nominal (anti false-positive)', async () => {
      const fired = await maybeFirePurchaseEvent({
        customer: baseCustomer,
        conversation: {},
        text: 'Payment ya bunda',
        tenantId: 'default-tenant',
      });
      expect(fired).toBe(false);
      expect(prisma.reservation.update).not.toHaveBeenCalled();
    });
  });
});