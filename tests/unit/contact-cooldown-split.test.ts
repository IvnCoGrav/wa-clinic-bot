import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { capiService } from '../../src/services/capi.service';
import axios from 'axios';

vi.mock('axios');

describe('Fase 1.1: Contact Cooldown Separation (Organic vs Paid)', () => {
  beforeEach(() => {
    vi.stubEnv('FB_PIXEL_ID', 'test_pixel_123');
    vi.stubEnv('FB_CAPI_ACCESS_TOKEN', 'test_token_123');
    (capiService as any).__clearCooldowns();
    vi.mocked(axios.post).mockResolvedValue({
      status: 200,
      data: { events_received: 1, fbtrace_id: 'test_trace' },
    } as any);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    (capiService as any).__clearCooldowns();
  });

  it('should send first organic Contact, block second organic Contact within 24h, but allow paid Contact', async () => {
    const customer = { id: 'cust-1', phone: '081234567890', name: 'Siti Aminah' };

    // 1. Organic contact chat at 09:00
    const res1 = await capiService.sendCapiEvent({
      eventName: 'Contact',
      customer,
      tenantId: 'default-tenant',
    });
    expect(res1.success).toBe(true);

    // 2. Second organic contact chat at 09:30 -> BLOCKED by organic cooldown
    const res2 = await capiService.sendCapiEvent({
      eventName: 'Contact',
      customer,
      tenantId: 'default-tenant',
    });
    expect(res2.success).toBe(false);
    expect(res2.message).toContain('Organic Contact event 24h cooldown active');

    // 3. Paid ad click at 11:00 with CTWA clid -> MUST PENETRATE organic cooldown
    const res3 = await capiService.sendCapiEvent({
      eventName: 'Contact',
      customer,
      adClick: { ctwa_clid: 'CTWA_CLICK_99', utmCampaign: 'PROMO_BABY_SPA' },
      tenantId: 'default-tenant',
    });
    expect(res3.success).toBe(true);

    // 4. Repeat paid ad click with SAME campaign within 24h -> BLOCKED by paid cooldown
    const res4 = await capiService.sendCapiEvent({
      eventName: 'Contact',
      customer,
      adClick: { ctwa_clid: 'CTWA_CLICK_99_REPEAT', utmCampaign: 'PROMO_BABY_SPA' },
      tenantId: 'default-tenant',
    });
    expect(res4.success).toBe(false);
    expect(res4.message).toContain('Paid Contact event 24h cooldown active');

    // 5. Paid click with DIFFERENT campaign -> ALLOWED
    const res5 = await capiService.sendCapiEvent({
      eventName: 'Contact',
      customer,
      adClick: { ctwa_clid: 'CTWA_CLICK_100', utmCampaign: 'PROMO_MOMS_MASSAGE' },
      tenantId: 'default-tenant',
    });
    expect(res5.success).toBe(true);
  });
});
