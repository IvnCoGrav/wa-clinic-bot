import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { memoryAdClicks } from '../../src/routes/tracking.route';
import { memoryReservations } from '../../src/routes/admin.route';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { capiService } from '../../src/services/capi.service';
import { conversationService } from '../../src/services/conversation.service';
import { customerService } from '../../src/services/customer.service';
import { messageService } from '../../src/services/message.service';
import { wahaClient } from '../../src/integrations/waha/client';
import { ConversationState } from '@prisma/client';
import { seedAiScopeAll } from '../helpers/seed-ai-scope';

// Mock DB client
vi.mock('../../src/db/client', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    auditLog: { create: vi.fn() },
    adClick: {
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    conversation: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    customer: {
      update: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    message: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    reservation: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe('Ad Click Attribution & Meta CAPI Integration Tests', () => {
  const mockApp = buildApp();

  beforeEach(async () => {
    vi.clearAllMocks();
    memoryAdClicks.clear();
    memoryReservations.clear();
    customerService.clearCustomerMemory('62899998888');
    customerService.clearCustomerMemory('62899990000');
    vi.stubEnv('TRACKING_API_KEY', 'valid_track_key');
    vi.stubEnv('ADMIN_API_KEY', 'valid_admin_key');
    await seedAiScopeAll();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('1. Click Catcher Endpoint (POST /api/tracking/click)', () => {
    it('should reject requests with 401 when X-Tracking-Api-Key is missing or invalid', async () => {
      const responseMissing = await mockApp.inject({
        method: 'POST',
        url: '/api/tracking/click',
        payload: { fbclid: 'fb_123' },
      });
      expect(responseMissing.statusCode).toBe(401);

      const responseInvalid = await mockApp.inject({
        method: 'POST',
        url: '/api/tracking/click',
        headers: { 'x-tracking-api-key': 'wrong_key' },
        payload: { fbclid: 'fb_123' },
      });
      expect(responseInvalid.statusCode).toBe(401);
    });

    it('should successfully generate trackingCode and ignore IP/UA spoofed in request body', async () => {
      const dbCreateSpy = vi.mocked(prisma.adClick.create).mockResolvedValue({
        id: 'cuid_1',
        trackingCode: 'abc123',
      } as any);

      const response = await mockApp.inject({
        method: 'POST',
        url: '/api/tracking/click',
        headers: {
          'x-tracking-api-key': 'valid_track_key',
          'user-agent': 'MyRealUA',
        },
        payload: {
          fbclid: 'fb_999',
          landingUrl: 'https://klinik.com/promo',
          ipAddress: '1.2.3.4', // Attempted spoof in body
          userAgent: 'MySpoofedUA', // Attempted spoof in body
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.trackingCode).toBeDefined();

      // Check that IP and UA are taken from request/headers, not the payload body
      expect(dbCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fbclid: 'fb_999',
            landingUrl: 'https://klinik.com/promo',
            ipAddress: '127.0.0.1', // Fastify default test inject IP
            userAgent: 'MyRealUA',  // Headers user-agent
          }),
        })
      );
    });
  });

  describe('2. Webhook Interception & In-Memory Rewriting', () => {
    it('should link AdClick for a new customer sending Promo[CODE], log original Promo[CODE] to DB, and process as Halo greeting', async () => {
      // Mock trackingCode entry in memory fallback
      const trackingCode = 'pr22';
      const adClickData = {
        id: 'cuid_pr22',
        trackingCode,
        fbclid: 'fb_click_22',
        matchedAt: null,
        customerId: null,
      };
      memoryAdClicks.set(trackingCode, adClickData);
      vi.spyOn(customerService, 'getCustomerByPhone').mockResolvedValueOnce(null);

      const dbLogMsgSpy = vi.spyOn(messageService, 'logMessage').mockResolvedValue({} as any);

      // Mock state machine reply simulation to avoid typing delays
      const { typingService } = await import('../../src/services/typing.service');
      vi.spyOn(typingService, 'simulateHumanReply').mockResolvedValue({ success: true, bubblesSent: 1 });

      const wahaSeenSpy = vi.spyOn(wahaClient, 'sendSeen').mockResolvedValue({} as any);

      // Inject the webhook payload
      const response = await mockApp.inject({
        method: 'POST',
        url: '/webhook',
        payload: {
          event: 'message',
          session: 'default',
          payload: {
            id: 'msg_9988',
            from: '62899998888@c.us',
            body: 'Promo[pr22]',
            fromMe: false,
            timestamp: Math.floor(Date.now() / 1000),
          },
        },
      });

      expect(response.statusCode).toBe(200);

      // 1. Verify AdClick is matched/linked in memory
      expect(adClickData.matchedAt).toBeDefined();
      const customer = await customerService.getCustomerByPhone('62899998888', DEFAULT_TENANT_ID);
      expect(customer).toBeDefined();
      expect(adClickData.customerId).toBe(customer.id);

      // 2. Verify that the message logged is the STRIPPED body (not raw Promo[CODE]).
      // The message-rewrite strips Promo[XX] before state machine and logging.
      // "Promo[promo22]" (standalone) → stripped body = "" → fallback → "Halo"
      // Pesan diproses oleh queue worker secara async — tunggu sejenak sebelum assert.
      await new Promise((r) => setTimeout(r, 400));
      expect(dbLogMsgSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: 'INBOUND',
        })
      );

    });
  });

  describe('3. Meta CAPI Event Integration', () => {
    it('should fire Purchase (not Lead) event to CAPI Service on reservation confirmation', async () => {
      const capiSpy = vi.spyOn(capiService, 'sendCapiEvent').mockResolvedValue({ success: true });

      // Setup a mock reservation in memory fallback
      const resId = 'res_capi_test_123';
      const mockCustomer = {
        id: 'cust_capi',
        phone: '62812345678',
        adClick: {
          id: 'click_capi',
          fbclid: 'fbc_998877',
        },
      };
      const mockReservation = {
        id: resId,
        tenant_id: DEFAULT_TENANT_ID,
        customer_id: 'cust_capi',
        customer: mockCustomer,
        treatment_category: 'Baby Spa',
        treatment_detail: 'Selapan Ceria',
        status: 'pending',
      };
      memoryReservations.set(resId, mockReservation);

      // Call the PATCH confirmation API endpoint
      const response = await mockApp.inject({
        method: 'PATCH',
        url: `/api/admin/reservation/${resId}/confirm`,
        headers: {
          'x-api-key': 'valid_admin_key',
        },
      });

      expect(response.statusCode).toBe(200);
      await new Promise((r) => setTimeout(r, 50));

      // Confirm HANYA memicu Purchase (Lead dihapus dari sini — Lead hanya di MQL,
      // InitiateCheckout di momen form reservasi dikirim).
      const purchaseCall = capiSpy.mock.calls.find((c: any) => c[0]?.eventName === 'Purchase');
      expect(purchaseCall).toBeDefined();
      expect(purchaseCall[0]).toEqual(expect.objectContaining({
        customer: mockCustomer,
        adClick: mockCustomer.adClick,
        customData: { source: 'ADMIN_CONFIRM' },
      }));

      const leadCall = capiSpy.mock.calls.find((c: any) => c[0]?.eventName === 'Lead');
      expect(leadCall).toBeUndefined();
    });

    it('should also fire Purchase event with value on reservation confirmation', async () => {
      const capiSpy = vi.spyOn(capiService, 'sendCapiEvent').mockResolvedValue({ success: true });

      const resId = 'res_capi_purchase';
      const mockCustomer = {
        id: 'cust_capi_pur',
        phone: '62812345679',
        adClick: {
          id: 'click_capi_pur',
          fbclid: 'fbc_purchase',
        },
      };
      const mockReservation = {
        id: resId,
        tenant_id: DEFAULT_TENANT_ID,
        customer_id: 'cust_capi_pur',
        customer: mockCustomer,
        treatment_category: 'BABY',
        treatment_detail: 'Pijat Bayi Ceria (Rileksasi)',
        status: 'pending',
      };
      memoryReservations.set(resId, mockReservation);

      const response = await mockApp.inject({
        method: 'PATCH',
        url: `/api/admin/reservation/${resId}/confirm`,
        headers: { 'x-api-key': 'valid_admin_key' },
      });

      expect(response.statusCode).toBe(200);

      // Purchase event terkirim (fire-and-forget, tunggu microtask)
      await new Promise((r) => setTimeout(r, 50));

      // `.some()` bukan `.find()` — async Purchase dari test Lead sebelumnya bisa
      // nyangkut di spy; kita cari call yg benar-benar value 60000.
      const hasPurchaseWithValue = capiSpy.mock.calls.some(
        (c: any) => c[0]?.eventName === 'Purchase' && c[0]?.value === 60000
      );
      expect(hasPurchaseWithValue).toBe(true);
    });

    it('should send Purchase without value when treatment is unknown', async () => {
      const capiSpy = vi.spyOn(capiService, 'sendCapiEvent').mockResolvedValue({ success: true });

      const resId = 'res_capi_purchase_novalue';
      const mockCustomer = {
        id: 'cust_capi_pur_nv',
        phone: '62812345670',
        adClick: { id: 'click_capi_pur_nv', fbclid: 'fbc_novalue' },
      };
      const mockReservation = {
        id: resId,
        tenant_id: DEFAULT_TENANT_ID,
        customer_id: 'cust_capi_pur_nv',
        customer: mockCustomer,
        treatment_category: 'UNKNOWN_CAT',
        treatment_detail: 'Treatment misterius tidak dikenal',
        status: 'pending',
      };
      memoryReservations.set(resId, mockReservation);

      const response = await mockApp.inject({
        method: 'PATCH',
        url: `/api/admin/reservation/${resId}/confirm`,
        headers: { 'x-api-key': 'valid_admin_key' },
      });

      expect(response.statusCode).toBe(200);
      await new Promise((r) => setTimeout(r, 50));

      const purchaseCall = capiSpy.mock.calls.find((c: any) => c[0]?.eventName === 'Purchase');
      expect(purchaseCall).toBeDefined();
      expect(purchaseCall[0].value).toBeUndefined();
    });
  });
});
