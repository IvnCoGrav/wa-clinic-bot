import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { buildApp } from '../../src/app';
import { CircuitBreaker } from '../../src/utils/circuit-breaker';
import { contextStorage, initializeConsoleWrapper } from '../../src/utils/context';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { ConversationState } from '@prisma/client';
import { wahaClient } from '../../src/integrations/waha/client';

// Mock DB client
vi.mock('../../src/db/client', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    auditLog: {
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
      clearPendingLocation: vi.fn(),
    },
  },
}));

describe('Robustness & Hardening Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('ADMIN_API_KEY', 'secure_admin_key');
    initializeConsoleWrapper();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('1. Health Checks (/health & /ready)', () => {
    it('/health should return 200 OK', async () => {
      const app = buildApp();
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('OK');
    });

    it('/ready should return 200 OK when DB and WAHA are WORKING', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValue([1] as any);
      vi.spyOn(wahaClient, 'getSessionStatus').mockResolvedValue('WORKING');

      const app = buildApp();
      const response = await app.inject({
        method: 'GET',
        url: '/ready',
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('READY');
      expect(body.checks.database).toBe('CONNECTED');
      expect(body.checks.waha).toBe('WORKING');
    });

    it('/ready should return 503 Service Unavailable when DB is down', async () => {
      vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error('Connection lost'));
      vi.spyOn(wahaClient, 'getSessionStatus').mockResolvedValue('WORKING');

      const app = buildApp();
      const response = await app.inject({
        method: 'GET',
        url: '/ready',
      });
      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('NOT_READY');
      expect(body.checks.database).toContain('FAILED');
    });
  });

  describe('2. Audit Logging & Rate Limiting', () => {
    it('Admin endpoints should log audit logs to database including identity', async () => {
      const { knowledgeBaseService } = await import('../../src/services/knowledge.service');
      vi.spyOn(knowledgeBaseService, 'importFaqs').mockResolvedValue(5);

      const auditCreateSpy = vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any);

      const app = buildApp();
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/knowledge/faq',
        headers: {
          'x-api-key': 'secure_admin_key',
          'x-admin-identity': 'admin-yusi@kalaspa.com',
        },
        payload: {
          faqs: [{ question: 'Jam buka?', answer: '09:00 - 18:00' }],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(auditCreateSpy).toHaveBeenCalledTimes(1);
      expect(auditCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'IMPORT_FAQS',
            admin_identity: 'admin-yusi@kalaspa.com',
            admin_key: expect.any(String),
          }),
        })
      );
    });

    it('Admin endpoints should limit request flooding (Rate Limit)', async () => {
      const app = buildApp();
      // Send 305 requests quickly to exceed rate limit (300 req/min)
      const requests = Array.from({ length: 305 }).map(() =>
        app.inject({
          method: 'GET',
          url: '/api/admin/human-handling-conversations',
          headers: {
            'x-api-key': 'secure_admin_key',
          },
        })
      );

      const responses = await Promise.all(requests);
      const rateLimited = responses.filter(r => r.statusCode === 429);
      expect(rateLimited.length).toBeGreaterThan(0);
      expect(rateLimited[0].statusCode).toBe(429);
      const body = JSON.parse(rateLimited[0].body);
      expect(body.error).toBe('Too Many Requests');
    });
  });

  describe('3. Circuit Breaker (CLOSED ⇋ OPEN ⇌ HALF_OPEN)', () => {
    it('should trip to OPEN after failure threshold met, then allow HALF_OPEN probe', async () => {
      let fail = true;
      const requestFn = vi.fn().mockImplementation(async () => {
        if (fail) throw new Error('API Timeout');
        return 'success';
      });
      const fallbackFn = vi.fn().mockResolvedValue('fallback');

      const breaker = new CircuitBreaker(requestFn, fallbackFn, {
        failureThreshold: 0.5,
        slidingWindowSize: 10,
        cooldownPeriodMs: 100,
      });

      // Send 10 failing requests
      for (let i = 0; i < 10; i++) {
        const res = await breaker.execute();
        expect(res).toBe('fallback');
      }

      // Circuit should be OPEN
      expect(breaker.getState()).toBe('OPEN');

      // Immediate execute should call fallback without requesting API
      requestFn.mockClear();
      const resAfterTrip = await breaker.execute();
      expect(resAfterTrip).toBe('fallback');
      expect(requestFn).not.toHaveBeenCalled();

      // Wait for cooldown to end
      await new Promise(resolve => setTimeout(resolve, 110));

      // Cooldown ended -> State should transition to HALF_OPEN upon execution check
      expect(breaker.getState()).toBe('HALF_OPEN');

      // Probe success -> State CLOSED
      fail = false;
      const resProbe = await breaker.execute();
      expect(resProbe).toBe('success');
      expect(breaker.getState()).toBe('CLOSED');
    });
  });

  describe('4. 5-Minute Passive Confirmation Timeout', () => {
    it('State Machine should reset LOCATION_CONFIRMED to INITIAL if last interaction > 5 minutes ago', async () => {
      const { stateMachine } = await import('../../src/state-machine/machine');
      const { customerService } = await import('../../src/services/customer.service');
      const { typingService } = await import('../../src/services/typing.service');
      
      const clearSpy = vi.spyOn(customerService, 'clearPendingLocation').mockResolvedValue({} as any);
      const typingSpy = vi.spyOn(typingService, 'simulateHumanReply').mockResolvedValue({ success: true, bubblesSent: 1 });

      // Last interaction 6 minutes ago
      const lastMsgAt = new Date();
      lastMsgAt.setMinutes(lastMsgAt.getMinutes() - 6);

      const ctx: any = {
        customer: {
          id: 'cust-id',
          phone: '628111222333',
          status: 'active',
          pending_kelurahan: 'Taman',
        },
        conversation: {
          id: 'conv-id',
          current_state: ConversationState.LOCATION_CONFIRMED,
          last_message_at: lastMsgAt,
          created_at: new Date(),
        },
        incomingMessage: {
          id: 'msg-id',
          from: '628111222333',
          type: 'text',
          text: { body: 'iya' },
        },
      };

      const result = await stateMachine.processMessage(ctx);

      // Should bypass handleLocationConfirmationState and reset to INITIAL
      expect(result.nextState).toBe(ConversationState.AWAITING_LOCATION);
      expect(clearSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('5. Logging Correlation ID via AsyncLocalStorage', () => {
    it('console.log output should include CorrelationID if executed within contextStorage', () => {
      const originalLog = (console.log as any).original || console.log;
      const mockLog = vi.fn();
      (console.log as any).original = mockLog;

      contextStorage.run({ correlationId: 'test-uuid-123' }, () => {
        console.log('Testing context log message');
      });

      // Restore original
      (console.log as any).original = originalLog;

      expect(mockLog).toHaveBeenCalledWith('[CorrelationID: test-uuid-123]', 'Testing context log message');
    });
  });
});
