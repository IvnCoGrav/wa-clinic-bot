import { describe, it, expect, beforeEach, vi } from 'vitest';
import { customerService } from '../../src/services/customer.service';
import { capiService } from '../../src/services/capi.service';
import { prisma } from '../../src/db/client';

describe('Customer Database API & LTV Calculation', () => {
  const tenantId = 'default-tenant';
  const customerId = 'cust-ltv-test-id';
  const customerPhone = '628999888777';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('menghitung LTV dan menghasilkan tracking code untuk customer', async () => {
    vi.mocked(prisma.customer.findMany).mockResolvedValueOnce([
      {
        id: customerId,
        tenant_id: tenantId,
        phone: customerPhone,
        name: 'Bunda Rini',
        status: 'active',
        is_mql: true,
        mql_bubble_count: 5,
        mql_triggered_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
        adClick: {
          trackingCode: 'TC-PROMO-123',
          utmCampaign: 'promo-baby-spa',
        },
        reservations: [
          { treatment_detail: 'Baby Massage Ceria', raw_text: 'Baby Massage', status: 'confirmed' },
          { treatment_detail: 'Spa Mom Relaxing', raw_text: 'Spa Mom', status: 'completed' },
        ],
      },
    ] as any);

    vi.mocked(prisma.customer.count).mockResolvedValueOnce(1);

    const result = await customerService.listCustomersWithLtvAndAdClick(tenantId, { page: 1, pageSize: 10 });

    expect(result.total).toBe(1);
    expect(result.customers.length).toBe(1);

    const cust = result.customers[0];
    expect(cust.phone).toBe(customerPhone);
    expect(cust.trackingCode).toBe('TC-PROMO-123');
    expect(cust.isMql).toBe(true);
    expect(cust.reservationCount).toBe(2);
  });

  it('fallback tracking code TC-XXXXX saat adClick tidak ditemukan', async () => {
    vi.mocked(prisma.customer.findMany).mockResolvedValueOnce([
      {
        id: 'cust-abc-123-xyz',
        tenant_id: tenantId,
        phone: customerPhone,
        name: null,
        status: 'active',
        is_mql: false,
        mql_bubble_count: 2,
        mql_triggered_at: null,
        created_at: new Date(),
        updated_at: new Date(),
        adClick: null,
        reservations: [],
      },
    ] as any);

    vi.mocked(prisma.customer.count).mockResolvedValueOnce(1);

    const result = await customerService.listCustomersWithLtvAndAdClick(tenantId);
    expect(result.customers[0].trackingCode).toBe('TC-CUSTABC1');
    expect(result.customers[0].ltv).toBe(0);
  });

  it('manual send event Meta CAPI memanggil sendCapiEvent dengan data customer', async () => {
    const mockCustomer = {
      id: customerId,
      phone: customerPhone,
      name: 'Bunda Rini',
      tenant_id: tenantId,
      adClick: {
        fbclid: 'fb.1.123456789',
        fbp: 'fb.1.987654321',
        fbc: 'fb.1.111111111',
      },
    };

    vi.mocked(prisma.customer.findFirst).mockResolvedValueOnce(mockCustomer as any);
    const capiSpy = vi.spyOn(capiService, 'sendCapiEvent').mockResolvedValueOnce({ success: true });

    const capiRes = await capiService.sendCapiEvent({
      eventName: 'Purchase',
      customer: mockCustomer,
      adClick: mockCustomer.adClick,
      value: 150000,
      currency: 'IDR',
      tenantId,
      customData: { manual_trigger: true },
    });

    expect(capiRes.success).toBe(true);
    expect(capiSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'Purchase',
        value: 150000,
        currency: 'IDR',
        tenantId,
      })
    );
  });
});
