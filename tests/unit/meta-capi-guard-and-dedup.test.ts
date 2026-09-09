import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { matchAdClickAndFireContact } from '../../src/services/ad-attribution.service';
import { capiService } from '../../src/services/capi.service';
import { upsertReservationForm } from '../../src/services/reservation-lifecycle.service';
import { prisma } from '../../src/db/client';

describe('Meta CAPI Guard & Reservation Auto-Deduplication Tests', () => {
  const testPhone = '6282199887766';
  const tenantId = 'default-tenant';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. matchAdClickAndFireContact: first touchpoint fires Contact, but concurrent burst is blocked', async () => {
    const sendSpy = vi.spyOn(capiService, 'sendCapiEvent').mockResolvedValue({ success: true } as any);
    vi.mocked(prisma.adClick.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.adClick.findFirst).mockResolvedValue({ id: 'ac1', trackingCode: 'IG-TEST-1', customerId: 'cust_test_1' } as any);

    const customer = {
      id: 'cust_test_1',
      phone: testPhone,
      name: 'Bunda Test',
    };

    // First call (New touchpoint)
    const res1 = await matchAdClickAndFireContact({
      bodyText: 'Promo[IG-TEST-1] Halo Bunda',
      isNewCustomerRecord: false,
      customer,
      tenantId,
    });

    expect(res1.strippedText).toBe('Halo Bunda');
    expect(sendSpy).toHaveBeenCalledTimes(1);

    // Second call within 10s (Burst message)
    const res2 = await matchAdClickAndFireContact({
      bodyText: 'Promo[IG-TEST-1] Saya mau tanya jadwal',
      isNewCustomerRecord: false,
      customer,
      tenantId,
    });

    expect(res2.strippedText).toBe('Saya mau tanya jadwal');
    // Spy should still be 1 (second call dropped by burst lock)
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('2. Centralized sendCapiEvent: InitiateCheckout is throttled by 1h cooldown', async () => {
    const customer = {
      id: 'cust_checkout_test',
      phone: '6282199887755',
      name: 'Bunda Checkout',
    };

    // Mock successful execution in breaker so it doesn't try network
    const { capiBreaker } = await import('../../src/services/capi.service');
    vi.spyOn(capiBreaker, 'execute').mockResolvedValue({
      status: 200,
      data: { events_received: 1, fbtrace_id: 'test_trace' },
    } as any);

    const res1 = await capiService.sendCapiEvent({
      eventName: 'InitiateCheckout',
      customer,
      tenantId,
    });

    const res2 = await capiService.sendCapiEvent({
      eventName: 'InitiateCheckout',
      customer,
      tenantId,
    });

    expect(res2.success).toBe(false);
    expect(res2.message).toContain('1h cooldown active');
  });

  it('3. upsertReservationForm: updates existing pending reservation instead of creating duplicate', async () => {
    const customerId = 'cust_dedup_test_' + Date.now();
    const chatId = `${testPhone}@c.us`;

    const pendingRecord: any = {
      id: 'res_123',
      tenant_id: tenantId,
      customer_id: customerId,
      treatment_category: 'BABY',
      treatment_detail: 'Pulih Ceria',
      purchase_value: 70000,
      purchase_review_status: 'pending',
      purchase_event_sent_at: null,
      status: 'pending',
      created_at: new Date(),
    };

    // Form 1: no existing pending record -> create new
    // (Kanal kanonis: 1x findFirst recentPending + 1x create; tanpa findMany bila tanpa bookingDate.)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.reservation.create).mockResolvedValueOnce(pendingRecord);

    const r1 = await upsertReservationForm({
      tenantId,
      customerId,
      chatId,
      treatmentCategory: 'BABY',
      treatmentDetail: 'Pulih Ceria',
      rawText: 'Form Reservasi 1: Pulih Ceria',
      purchaseValue: 70000,
      customerName: 'Bunda Retno Test',
      source: 'TEST_FORM_1',
    });

    expect(r1.isNew).toBe(true);
    expect(r1.isUpdate).toBe(false);
    expect(r1.reservation.purchase_value).toBe(70000);

    // Form 2: existing pending record found -> update
    const updatedRecord = {
      ...pendingRecord,
      treatment_category: 'BOTH',
      treatment_detail: 'Pulih Ceria | Paket Laktasi',
      purchase_value: 140000,
      raw_text: 'Form Reservasi 2: Pulih Ceria + Paket Laktasi',
    };
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(pendingRecord);
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce(updatedRecord);

    const r2 = await upsertReservationForm({
      tenantId,
      customerId,
      chatId,
      treatmentCategory: 'BOTH',
      treatmentDetail: 'Pulih Ceria | Paket Laktasi',
      rawText: 'Form Reservasi 2: Pulih Ceria + Paket Laktasi (Payment: 140000)',
      purchaseValue: 140000,
      customerName: 'Bunda Retno Test',
      source: 'TEST_FORM_2',
    });

    expect(r2.isUpdate).toBe(true);
    expect(r2.isNew).toBe(false);
    expect(r2.reservation.id).toBe(r1.reservation.id);
    expect(r2.reservation.purchase_value).toBe(140000);
    expect(r2.reservation.treatment_detail).toBe('Pulih Ceria | Paket Laktasi');
  });

  it('4. Temporal Guard: event >7 hari dijepit ke waktu sekarang', async () => {
    const customer = {
      id: 'cust_temporal_test',
      phone: '6282199887700',
      name: 'Bunda Temporal',
    };

    // Mock successful execution in breaker
    const { capiBreaker } = await import('../../src/services/capi.service');
    let capturedPayload: any = null;
    vi.spyOn(capiBreaker, 'execute').mockImplementation(async (url: string, payload: any) => {
      capturedPayload = payload;
      return {
        status: 200,
        data: { events_received: 1, fbtrace_id: 'test_trace' },
      } as any;
    });

    // Event 10 hari yang lalu (melebihi batas 7 hari)
    const tenDaysAgo = Math.floor(Date.now() / 1000) - (10 * 24 * 60 * 60);

    const result = await capiService.sendCapiEvent({
      eventName: 'Purchase',
      customer,
      tenantId,
      eventTime: tenDaysAgo,
      value: 100000,
    });

    expect(result.success).toBe(true);

    // Verifikasi event_time dijepit ke waktu sekarang (±2 detik toleransi)
    const nowSec = Math.floor(Date.now() / 1000);
    expect(capturedPayload.data[0].event_time).toBeGreaterThanOrEqual(nowSec - 2);
    expect(capturedPayload.data[0].event_time).toBeLessThanOrEqual(nowSec + 2);

    // Verifikasi original_event_time tersimpan di custom_data
    expect(capturedPayload.data[0].custom_data.original_event_time).toBe(tenDaysAgo);
  });

  it('5. Temporal Guard: event <7 hari tidak dijepit', async () => {
    const customer = {
      id: 'cust_temporal_ok',
      phone: '6282199887701',
      name: 'Bunda Recent',
    };

    const { capiBreaker } = await import('../../src/services/capi.service');
    let capturedPayload: any = null;
    vi.spyOn(capiBreaker, 'execute').mockImplementation(async (url: string, payload: any) => {
      capturedPayload = payload;
      return {
        status: 200,
        data: { events_received: 1, fbtrace_id: 'test_trace' },
      } as any;
    });

    // Event 3 hari yang lalu (dalam batas 7 hari)
    const threeDaysAgo = Math.floor(Date.now() / 1000) - (3 * 24 * 60 * 60);

    const result = await capiService.sendCapiEvent({
      eventName: 'Purchase',
      customer,
      tenantId,
      eventTime: threeDaysAgo,
      value: 100000,
    });

    expect(result.success).toBe(true);

    // Verifikasi event_time tetap sama (tidak dijepit)
    expect(capturedPayload.data[0].event_time).toBe(threeDaysAgo);

    // Verifikasi original_event_time TIDAK ada di custom_data
    expect(capturedPayload.data[0].custom_data.original_event_time).toBeUndefined();
  });
});