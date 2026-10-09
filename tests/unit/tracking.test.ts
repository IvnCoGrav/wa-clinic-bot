import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateTrackingCode, isBotOrCrawler } from '../../src/routes/tracking.route';
import { ParamBuilder, PII_DATA_TYPE } from 'capi-param-builder-nodejs';

import { safeCompare } from '../../src/utils/auth';
import { normalizePhoneToE164, sha256Hash, capiService, capiBreaker } from '../../src/services/capi.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { prisma } from '../../src/db/client';

describe('Ad Click Attribution & Meta CAPI Unit Tests', () => {
  describe('1. Tracking Code Generation', () => {
  it('should generate unique alphanumeric codes of length 2 using clean alphabet (no ambiguous chars)', async () => {
    // Mock DB sukses untuk generateTrackingCode
    vi.mocked(prisma.adClick.create)
      .mockResolvedValueOnce({ id: 'c1', trackingCode: 'ab', createdAt: new Date() } as any)
      .mockResolvedValueOnce({ id: 'c2', trackingCode: 'cd', createdAt: new Date() } as any);

    const { trackingCode: code1 } = await generateTrackingCode({ tenant_id: 'default-tenant' }, prisma);
    const { trackingCode: code2 } = await generateTrackingCode({ tenant_id: 'default-tenant' }, prisma);

    expect(code1).toHaveLength(2);
    expect(code2).toHaveLength(2);
    // Alphabet bersih: tanpa 0,1,i,l,o
    expect(/^[abcdefghjkmnpqrstuvwxyz23456789]+$/i.test(code1)).toBe(true);
  });

  });

  describe('2. Timing-Safe Auth Helper (safeCompare)', () => {
    beforeEach(() => {
      vi.stubEnv('TRACKING_API_KEY', 'secret_track_123');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('should pass matching keys and fail invalid keys', () => {
      const secret = process.env.TRACKING_API_KEY!;
      expect(safeCompare(secret, 'secret_track_123')).toBe(true);
      expect(safeCompare(secret, 'wrong_key')).toBe(false);
      expect(safeCompare(secret, '')).toBe(false);
    });

    it('should protect against timing-attacks on variable length keys', () => {
      const secret = process.env.TRACKING_API_KEY!;
      // safeCompare uses SHA-256 internally on unequal lengths to prevent timing leakage
      expect(safeCompare(secret, 'short')).toBe(false);
      expect(safeCompare(secret, 'much_longer_key_than_the_original')).toBe(false);
    });
  });

  describe('3. Meta CAPI Formatting & Hashing', () => {
    it('should normalize Indonesian phone numbers to E.164 format', () => {
      expect(normalizePhoneToE164('08123456789')).toBe('628123456789');
      expect(normalizePhoneToE164('+62 812-3456-789')).toBe('628123456789');
      expect(normalizePhoneToE164('8123456789')).toBe('628123456789');
      expect(normalizePhoneToE164('628123456789')).toBe('628123456789');
    });

    it('should generate correct lowercase SHA-256 hash', () => {
      const rawText = ' 628123456789 ';
      const hash = sha256Hash(rawText);
      // SHA-256 for '628123456789' is '4ae87a9fd91110f0288ac5bea87a099ca5ee72e032908dbf5ee56f9512bbff43'
      expect(hash).toBe('4ae87a9fd91110f0288ac5bea87a099ca5ee72e032908dbf5ee56f9512bbff43');
    });
  });

  describe('4. CAPI Silent Failures & Circuit Breaker', () => {
    beforeEach(() => {
      vi.stubEnv('FB_PIXEL_ID', 'mock_pixel_123');
      vi.stubEnv('FB_CAPI_ACCESS_TOKEN', 'mock_token_123');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.clearAllMocks();
    });

    it('should process organic CAPI call with organic traffic_source if adClick data is not provided', async () => {
      const executeSpy = vi.spyOn(capiBreaker, 'execute').mockResolvedValue({
        status: 200,
        data: { events_received: 1 },
      } as any);

      const response = await capiService.sendCapiEvent({
        eventName: 'Lead',
        customer: { id: 'cust-organic-123', phone: '08123456789' },
        adClick: undefined, // missing attribution data -> Organic traffic
        tenantId: DEFAULT_TENANT_ID,
      });
      expect(response.success).toBe(true);

      const payload = executeSpy.mock.calls[0][1];
      expect(payload.data[0].custom_data.traffic_source).toBe('organic');
    });

    it('breaker fallback (error/400) TIDAK boleh dicatat sebagai sukses', async () => {
      // Fallback circuit breaker mengembalikan fake status 200 dengan penanda isFallback.
      vi.spyOn(capiBreaker, 'execute').mockResolvedValue({
        isFallback: true,
        status: 200,
        data: { success: false, note: 'Circuit Breaker Active Fallback (CAPI)' },
      } as any);

      const response = await capiService.sendCapiEvent({
        eventName: 'Contact',
        customer: { id: 'cust-fallback-1', phone: '08123456789' },
      });

      expect(response.success).toBe(false);
    });

    it('should handle API errors silently without throwing exceptions', async () => {
      // Mock circuit breaker to simulate a crash/failure
      vi.spyOn(capiBreaker, 'execute').mockRejectedValue(new Error('Network Timeout / DNS failure'));

      const adClick = {
        fbclid: 'fb_123',
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
      };

      // Execution should resolve to success: false and log instead of crashing
      await expect(
        capiService.sendCapiEvent({
          eventName: 'Lead',
          customer: { phone: '08123456789' },
          adClick,
          tenantId: DEFAULT_TENANT_ID,
        })
      ).resolves.toEqual({ success: false, message: 'Network Timeout / DNS failure' });
    });
  });

  describe('5. Old AdClick Cleanup & TrackingCode Soft Release (>100 days old)', () => {
    it('should soft-release trackingCode via prisma.adClick.updateMany (preserving attribution history)', async () => {
      const deleteManySpy = vi.mocked(prisma.adClick.deleteMany).mockResolvedValue({ count: 2 });
      const updateManySpy = vi.mocked(prisma.adClick.updateMany).mockResolvedValue({ count: 5 });
      const { cronService } = await import('../../src/services/cron.service');

      await cronService.cleanupOldAdClicks();

      expect(deleteManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            matchedAt: null,
            customerId: null,
          }),
        })
      );

      expect(updateManySpy).toHaveBeenCalledTimes(2);
      expect(updateManySpy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: expect.objectContaining({
            matchedAt: null,
            createdAt: expect.any(Object),
          }),
          data: { trackingCode: null },
        })
      );
      expect(updateManySpy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({
            matchedAt: { not: null },
            customer: expect.any(Object),
          }),
          data: { trackingCode: null },
        })
      );
    });
  });

  describe('4b. CAPI Parameter Builder Integration', () => {
    beforeEach(() => {
      vi.stubEnv('FB_PIXEL_ID', 'mock_pixel_123');
      vi.stubEnv('FB_CAPI_ACCESS_TOKEN', 'mock_token_123');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.clearAllMocks();
    });

    it('should format fbp, fbc, and phone using Meta ParamBuilder with appendix', async () => {
      const executeSpy = vi.spyOn(capiBreaker, 'execute').mockResolvedValue({
        status: 200,
        data: { success: true },
      } as any);

      const adClick = {
        fbclid: 'click_12345',
        fbp: 'fb.1.1596403881668.1116446470',
        fbc: 'fb.1.1554763741205.AbCdEfGhIjKlMnOpQrStUvWxYz1234567890',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        landingUrl: 'https://example.com/page',
      };

      const res = await capiService.sendCapiEvent({
        eventName: 'Lead',
        customer: { id: 'cust_12345', phone: '08123456789', name: 'Bunda Jane Doe' },
        adClick,
        tenantId: DEFAULT_TENANT_ID,
      });

      expect(res.success).toBe(true);
      expect(executeSpy).toHaveBeenCalledTimes(1);
      
      const payload = executeSpy.mock.calls[0][1];
      const userData = payload.data[0].user_data;

      // Hashed phone must have the 8-character NodeJS CAPI Parameter Builder appendix (.ABcDEFGh or similar)
      expect(userData.ph[0]).toMatch(/^[a-f0-9]{64}\.[a-zA-Z0-9]{8}$/);

      // Advanced Matching: fn, ln, external_id must have appendix
      expect(userData.fn[0]).toMatch(/^[a-f0-9]{64}\.[a-zA-Z0-9]{8}$/);
      expect(userData.ln[0]).toMatch(/^[a-f0-9]{64}\.[a-zA-Z0-9]{8}$/);
      expect(userData.external_id[0]).toMatch(/^[a-f0-9]{64}\.[a-zA-Z0-9]{8}$/);
      
      // fbc and fbp must have the 8-character appendix
      expect(userData.fbc).toMatch(/^fb\.\d+\.\d+\..*?\.[a-zA-Z0-9]{8}$/);
      expect(userData.fbp).toMatch(/^fb\.\d+\.\d+\..*?\.[a-zA-Z0-9]{8}$/);
    });

    it('should sanitize emojis and parentheticals from customer name before PII hashing', async () => {
      const executeSpy = vi.spyOn(capiBreaker, 'execute').mockResolvedValue({
        status: 200,
        data: { success: true },
      } as any);

      await capiService.sendCapiEvent({
        eventName: 'Lead',
        customer: { id: 'cust_emoji', phone: '08123456788', name: 'Humaira 🌹 (Homecare)' },
        tenantId: DEFAULT_TENANT_ID,
      });

      const payload = executeSpy.mock.calls[0][1];
      const userData = payload.data[0].user_data;

      const builder = new ParamBuilder();
      const expectedFn = builder.getNormalizedAndHashedPII('humaira', PII_DATA_TYPE.FIRST_NAME);
      expect(userData.fn[0].split('.')[0]).toBe(expectedFn.split('.')[0]);
      expect(userData.ln).toBeUndefined();
    });

    it('should include raw (unhashed) ctwa_clid in user_data when AdClick is a CTWA touchpoint', async () => {
      const executeSpy = vi.spyOn(capiBreaker, 'execute').mockResolvedValue({
        status: 200,
        data: { success: true },
      } as any);

      const rawClid = 'AfjcTHNKDctClrnb-m9NkJrBspOBQ-z1mmhIDkvokHSICaCZmqmDoz93';
      const res = await capiService.sendCapiEvent({
        eventName: 'Contact',
        customer: { id: 'cust_ctwa', phone: '6289667285350', name: 'Bunda CTWA' },
        adClick: { trackingCode: 'ctwa_abc', ctwa_clid: rawClid, utmSource: 'instagram' },
        tenantId: DEFAULT_TENANT_ID,
      });

      expect(res.success).toBe(true);
      const userData = executeSpy.mock.calls[0][1].data[0].user_data;
      // WAJIB mentah: CTWA CLID bukan PII sehingga tidak melalui ParamBuilder/hashing.
      expect(userData.ctwa_clid).toBe(rawClid);
    });

    it('should NOT set ctwa_clid when AdClick has no CTWA clid (organic / web CTA)', async () => {
      const executeSpy = vi.spyOn(capiBreaker, 'execute').mockResolvedValue({
        status: 200,
        data: { success: true },
      } as any);

      await capiService.sendCapiEvent({
        eventName: 'Contact',
        customer: { id: 'cust_web', phone: '628123456790', name: 'Bunda Web' },
        adClick: { trackingCode: 'ck', utmSource: 'ig' },
        tenantId: DEFAULT_TENANT_ID,
      });

      const userData = executeSpy.mock.calls[0][1].data[0].user_data;
      expect(userData.ctwa_clid).toBeUndefined();
    });

    it('should use Meta Business Messaging envelope (action_source + top-level messaging_channel + WABA id) when tenant has WABA config', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        id: DEFAULT_TENANT_ID,
        waba_business_account_id: 'WABA_ACCT_123',
      } as any);

      const executeSpy = vi.spyOn(capiBreaker, 'execute').mockResolvedValue({
        status: 200,
        data: { success: true },
      } as any);

      const rawClid = 'ARM_a8rmlFeiCktEJQ-QTwRiyYHAFDLMNDBH0CD3qpjd0HR4irJ6LEkR7JwFF4XvnO2E4N';
      await capiService.sendCapiEvent({
        eventName: 'Purchase',
        customer: { id: 'cust_ctwa_bm', phone: '6289667285350', name: 'Bunda BM' },
        adClick: { trackingCode: 'ctwa_bm', ctwa_clid: rawClid },
        value: 100000,
        currency: 'IDR',
        tenantId: DEFAULT_TENANT_ID,
      });

      const event = executeSpy.mock.calls[0][1].data[0];
      expect(event.action_source).toBe('business_messaging');
      expect(event.messaging_channel).toBe('whatsapp');
      expect(event.user_data.ctwa_clid).toBe(rawClid);
      expect(event.user_data.whatsapp_business_account_id).toBe('WABA_ACCT_123');
      // messaging_channel HARUS top-level, bukan di custom_data
      expect(event.custom_data.messaging_channel).toBeUndefined();
    });

    it('should fail-open to action_source "chat" when ctwa_clid exists but tenant has no WABA id', async () => {
      vi.mocked(prisma.tenant.findUnique).mockRejectedValue(new Error('Database offline'));

      const executeSpy = vi.spyOn(capiBreaker, 'execute').mockResolvedValue({
        status: 200,
        data: { success: true },
      } as any);

      await capiService.sendCapiEvent({
        eventName: 'Contact',
        customer: { id: 'cust_ctwa_noid', phone: '6289667285351', name: 'Bunda NoId' },
        adClick: { trackingCode: 'ctwa_noid', ctwa_clid: 'RAW_CLID_NO_WABA' },
        tenantId: DEFAULT_TENANT_ID,
      });

      const event = executeSpy.mock.calls[0][1].data[0];
      expect(event.action_source).toBe('chat');
      expect(event.messaging_channel).toBeUndefined();
      expect(event.user_data.ctwa_clid).toBe('RAW_CLID_NO_WABA');
      expect(event.user_data.whatsapp_business_account_id).toBeUndefined();
    });

    it('should clamp future event_time to current time to avoid Meta 400 rejection', async () => {
      const executeSpy = vi.spyOn(capiBreaker, 'execute').mockResolvedValue({
        status: 200,
        data: { success: true },
      } as any);

      const futureTime = Math.floor(Date.now() / 1000) + 3600; // 1 jam di masa depan
      await capiService.sendCapiEvent({
        eventName: 'Lead',
        customer: { id: 'cust_future', phone: '6289667285399', name: 'Bunda Future' },
        eventTime: futureTime,
        tenantId: DEFAULT_TENANT_ID,
      });

      const event = executeSpy.mock.calls[0][1].data[0];
      expect(event.event_time).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    });

    it('should not include value when value is NaN or infinite', async () => {
      const executeSpy = vi.spyOn(capiBreaker, 'execute').mockResolvedValue({
        status: 200,
        data: { success: true },
      } as any);

      await capiService.sendCapiEvent({
        eventName: 'Purchase',
        customer: { id: 'cust_nan', phone: '6289667285398', name: 'Bunda NaN' },
        value: NaN as any,
        tenantId: DEFAULT_TENANT_ID,
      });

      const event = executeSpy.mock.calls[0][1].data[0];
      expect(event.custom_data.value).toBeUndefined();
    });
  });

  describe('6. Landing Page View Tracking & External Tracker Beacon', () => {
    it('should detect bot crawlers and ignore them', () => {
      expect(isBotOrCrawler('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)')).toBe(true);
      expect(isBotOrCrawler('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
      expect(isBotOrCrawler('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Instagram')).toBe(false);
      expect(isBotOrCrawler('Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile Safari/537.36')).toBe(false);
    });
  });
});

