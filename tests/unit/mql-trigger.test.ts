import { describe, it, expect, beforeEach, vi } from 'vitest';
import { customerService } from '../../src/services/customer.service';
import { capiService } from '../../src/services/capi.service';
import { prisma } from '../../src/db/client';

describe('MQL Automation & Lead Event Trigger', () => {
  const tenantId = 'default-tenant';
  const customerId = 'cust-mql-test-id';
  const customerPhone = '6281234567890';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('dapat mengambil dan meng-update MQL settings per tenant', async () => {
    vi.mocked(prisma.tenant.findFirst).mockResolvedValueOnce({
      id: tenantId,
      mql_threshold_bubbles: 5,
      mql_auto_lead_enabled: true,
    } as any);

    const settings = await customerService.getMqlSettings(tenantId);
    expect(settings).toEqual({
      mqlThresholdBubbles: 5,
      mqlAutoLeadEnabled: true,
    });

    vi.mocked(prisma.tenant.findFirst).mockResolvedValueOnce({ id: tenantId } as any);
    vi.mocked(prisma.tenant.update).mockResolvedValueOnce({
      id: tenantId,
      mql_threshold_bubbles: 3,
      mql_auto_lead_enabled: false,
    } as any);

    const updated = await customerService.updateMqlSettings(tenantId, {
      mqlThresholdBubbles: 3,
      mqlAutoLeadEnabled: false,
    });

    expect(updated).toEqual({
      mqlThresholdBubbles: 3,
      mqlAutoLeadEnabled: false,
    });
  });

  it('mengiterasi mql_bubble_count dan belum memicu MQL jika di bawah threshold', async () => {
    vi.mocked(prisma.tenant.findFirst).mockResolvedValue({
      id: tenantId,
      mql_threshold_bubbles: 5,
      mql_auto_lead_enabled: true,
    } as any);

    vi.mocked(prisma.customer.findUnique).mockResolvedValueOnce({
      id: customerId,
      phone: customerPhone,
      is_mql: false,
      mql_bubble_count: 3,
    } as any);

    vi.mocked(prisma.customer.update).mockResolvedValueOnce({
      id: customerId,
      phone: customerPhone,
      is_mql: false,
      mql_bubble_count: 4,
      mql_triggered_at: null,
    } as any);

    const capiSpy = vi.spyOn(capiService, 'sendCapiEvent').mockResolvedValue(true);

    const result = await customerService.incrementCustomerMessageCount(customerId, tenantId);

    expect(result.newlyTriggeredMql).toBe(false);
    expect(result.customer.mql_bubble_count).toBe(4);
    expect(result.customer.is_mql).toBe(false);
    expect(capiSpy).not.toHaveBeenCalled();
  });

  it('mengubah status menjadi MQL dan memicu event CAPI Lead saat mencapai threshold (bubble ke-5)', async () => {
    vi.mocked(prisma.tenant.findFirst).mockResolvedValue({
      id: tenantId,
      mql_threshold_bubbles: 5,
      mql_auto_lead_enabled: true,
    } as any);

    vi.mocked(prisma.customer.findUnique).mockResolvedValueOnce({
      id: customerId,
      phone: customerPhone,
      is_mql: false,
      mql_bubble_count: 4,
    } as any);

    const now = new Date();
    vi.mocked(prisma.customer.update).mockResolvedValueOnce({
      id: customerId,
      phone: customerPhone,
      is_mql: true,
      mql_bubble_count: 5,
      mql_triggered_at: now,
    } as any);

    const capiSpy = vi.spyOn(capiService, 'sendCapiEvent').mockResolvedValue(true);

    const result = await customerService.incrementCustomerMessageCount(customerId, tenantId);

    expect(result.newlyTriggeredMql).toBe(true);
    expect(result.customer.mql_bubble_count).toBe(5);
    expect(result.customer.is_mql).toBe(true);
    expect(capiSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'Lead',
        tenantId,
        customData: expect.objectContaining({
          mql_bubble_count: 5,
          mql_threshold: 5,
          triggered_reason: 'MQL_BUBBLE_THRESHOLD_REACHED',
        }),
      })
    );
  });

  it('idempotent: pesan ke-6 untuk customer yang sudah MQL tidak memicu event CAPI Lead ulang', async () => {
    vi.mocked(prisma.tenant.findFirst).mockResolvedValue({
      id: tenantId,
      mql_threshold_bubbles: 5,
      mql_auto_lead_enabled: true,
    } as any);

    const initialTriggerAt = new Date('2026-08-01');
    vi.mocked(prisma.customer.findUnique).mockResolvedValueOnce({
      id: customerId,
      phone: customerPhone,
      is_mql: true,
      mql_bubble_count: 5,
      mql_triggered_at: initialTriggerAt,
    } as any);

    vi.mocked(prisma.customer.update).mockResolvedValueOnce({
      id: customerId,
      phone: customerPhone,
      is_mql: true,
      mql_bubble_count: 6,
      mql_triggered_at: initialTriggerAt,
    } as any);

    const capiSpy = vi.spyOn(capiService, 'sendCapiEvent').mockResolvedValue(true);

    const result = await customerService.incrementCustomerMessageCount(customerId, tenantId);

    expect(result.newlyTriggeredMql).toBe(false);
    expect(result.customer.mql_bubble_count).toBe(6);
    expect(result.customer.is_mql).toBe(true);
    expect(capiSpy).not.toHaveBeenCalled();
  });
});
