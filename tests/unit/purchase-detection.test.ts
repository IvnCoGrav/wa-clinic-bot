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

    const mockTenantAutoSend = (autoSend: boolean) => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({ auto_send_purchase_capi: autoSend } as any);
    };

    it('tidak fire event jika pesan tanpa keyword format_purchase', async () => {
      const fired = await maybeFirePurchaseEvent({
        customer: baseCustomer,
        conversation: {},
        text: 'sudah bayar 250000 ya bund',
        tenantId: 'default-tenant',
      });
      expect(fired).toBe(false);
    });

    it('fire Purchase & set status approved saat auto_send_purchase_capi = true', async () => {
      mockTenantAutoSend(true);
      vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
        id: 'r1',
        customer_id: 'c1',
        tenant_id: 'default-tenant',
        status: 'pending',
        treatment_detail: 'Pijat Bayi',
        treatment_category: 'BABY',
        purchase_event_sent_at: null,
        purchase_occurred_at: null,
        purchase_review_status: 'pending',
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
        data: {
          purchase_occurred_at: expect.any(Date),
          purchase_event_sent_at: expect.any(Date),
          purchase_review_status: 'approved',
          purchase_value: 250000,
        },
      });
    });

    it('TIDAK fire CAPI & set pending saat moderasi manual aktif (default false)', async () => {
      mockTenantAutoSend(false);
      vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
        id: 'r2',
        customer_id: 'c1',
        tenant_id: 'default-tenant',
        status: 'pending',
        treatment_detail: 'Pijat Bayi',
        treatment_category: 'BABY',
        purchase_event_sent_at: null,
        purchase_occurred_at: null,
        purchase_review_status: 'pending',
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
      expect(fireSpy).not.toHaveBeenCalled();
      expect(prisma.reservation.update).toHaveBeenCalledWith({
        where: { id: 'r2' },
        data: {
          purchase_occurred_at: expect.any(Date),
          purchase_review_status: 'pending',
          purchase_value: 250000,
        },
      });
    });

    it('skip re-queue jika reservasi sudah ditahan pending review (purchase_occurred_at ter-set)', async () => {
      mockTenantAutoSend(true);
      vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
        id: 'r3',
        customer_id: 'c1',
        tenant_id: 'default-tenant',
        status: 'pending',
        treatment_detail: 'Pijat Bayi',
        treatment_category: 'BABY',
        purchase_event_sent_at: null,
        purchase_occurred_at: new Date(),
        purchase_review_status: 'pending',
        purchase_value: 250000,
        customer: { id: 'c1', adClick: { trackingCode: 'TC1' } },
      } as any);

      const fireSpy = vi.spyOn(capi, 'fireCapiEvent').mockImplementation(() => {});

      const fired = await maybeFirePurchaseEvent({
        customer: baseCustomer,
        conversation: {},
        text: 'Payment 250000',
        tenantId: 'default-tenant',
      });

      expect(fired).toBe(false);
      expect(fireSpy).not.toHaveBeenCalled();
      expect(prisma.reservation.update).not.toHaveBeenCalled();
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

    it('mendukung ekstraksi nominal murni dari financial equation (Total = 70rb + ongkir 15rb = 85rb)', async () => {
      mockTenantAutoSend(false);
      vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
        id: 'r_eq',
        customer_id: 'c1',
        tenant_id: 'default-tenant',
        status: 'pending',
        treatment_detail: 'Pijat Bayi',
        treatment_category: 'BABY',
        purchase_event_sent_at: null,
        purchase_occurred_at: null,
        purchase_review_status: 'pending',
        customer: { id: 'c1', adClick: { trackingCode: 'TC1' } },
      } as any);
      vi.mocked(prisma.reservation.update).mockResolvedValue({} as any);

      const fired = await maybeFirePurchaseEvent({
        customer: baseCustomer,
        conversation: {},
        text: 'Payment\nTotal = 70.000 + ongkir 15.000 = 85.000',
        tenantId: 'default-tenant',
      });

      expect(fired).toBe(true);
      expect(prisma.reservation.update).toHaveBeenCalledWith({
        where: { id: 'r_eq' },
        data: {
          purchase_occurred_at: expect.any(Date),
          purchase_review_status: 'pending',
          purchase_value: 70000,
        },
      });
    });
  });

  describe('resolveTreatmentValue — Alias & Multi-Service Compounding', () => {
    it('mampu mencocokkan alias bahasa Indonesia (Pijat Hamil, Terapi Bapil, Laktasi, dsb)', async () => {
      expect(await capi.resolveTreatmentValue('Pijat Hamil')).toBe(100000);
      expect(await capi.resolveTreatmentValue('Moms: Pijat Hamil')).toBe(100000);
      expect(await capi.resolveTreatmentValue('Pijat Terapi')).toBe(70000);
      expect(await capi.resolveTreatmentValue('Pijat Bapil')).toBe(70000);
      expect(await capi.resolveTreatmentValue('Pijat Batuk Pilek')).toBe(70000);
      expect(await capi.resolveTreatmentValue('Breast Massage')).toBe(50000);
      expect(await capi.resolveTreatmentValue('Pijat Oksitosin')).toBe(50000);
      expect(await capi.resolveTreatmentValue('Cukur Bayi')).toBe(25000);
      expect(await capi.resolveTreatmentValue('Pijat Kids Ceria')).toBe(70000);
    });

    it('mampu menjumlahkan multi-treatment dengan add-on (compounding)', async () => {
      expect(await capi.resolveTreatmentValue('Baby: Pijat Bayi Ceria + Sinar Moksa')).toBe(70000);
      expect(await capi.resolveTreatmentValue('Baby: Pijat Bayi Pulih Ceria + Terapi Uap Nebulizer')).toBe(105000);
      expect(await capi.resolveTreatmentValue('Baby: Pijat Bayi Ceria | Moms: Prenatal Massage')).toBe(160000);
    });

    it('mampu mencocokkan paket bundle kombinasi', async () => {
      expect(await capi.resolveTreatmentValue('Cukur + Pijat Terapi')).toBe(85000);
      expect(await capi.resolveTreatmentValue('Paket Selapan')).toBe(80000);
      expect(await capi.resolveTreatmentValue('Moms: Breast + Oksitosin')).toBe(80000);
      expect(await capi.resolveTreatmentValue('Paket Pra Kelahiran Lengkap')).toBe(135000);
    });

    it('fallback ke default kategori untuk nama layanan generik', async () => {
      expect(await capi.resolveTreatmentValue('Baby: Pijat / Treatment Homecare')).toBe(60000);
      expect(await capi.resolveTreatmentValue('Baby: Pijat Bayi')).toBe(60000);
      expect(await capi.resolveTreatmentValue('Moms: Treatment Homecare')).toBe(100000);
    });
  });
});