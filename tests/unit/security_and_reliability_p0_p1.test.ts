import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyMetaSignature } from '../../src/integrations/whatsapp/signature';
import { CircuitBreaker } from '../../src/utils/circuit-breaker';
import { installLogBuffer, getLogBuffer } from '../../src/utils/log-buffer';
import { queueService } from '../../src/services/queue.service';
import { faqCacheService } from '../../src/services/faq-cache.service';
import crypto from 'crypto';

describe('Security & Reliability P0/P1 Fixes', () => {
  describe('P0-3: WABA Signature Verification (strictMode)', () => {
    const rawBody = Buffer.from(JSON.stringify({ test: true }));
    const secret = 'my_waba_app_secret_123';

    it('should return true for valid HMAC signature', () => {
      const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      const signature = `sha256=${hmac}`;

      expect(verifyMetaSignature(rawBody, signature, secret, false)).toBe(true);
      expect(verifyMetaSignature(rawBody, signature, secret, true)).toBe(true);
    });

    it('should return false for invalid HMAC signature', () => {
      const signature = 'sha256=invalid_hash_1234567890abcdef';

      expect(verifyMetaSignature(rawBody, signature, secret, false)).toBe(false);
      expect(verifyMetaSignature(rawBody, signature, secret, true)).toBe(false);
    });

    it('should bypass verification in dev mode (strictMode = false) when secret is empty', () => {
      expect(verifyMetaSignature(rawBody, undefined, '', false)).toBe(true);
    });

    it('should fail-closed (return false) in production mode (strictMode = true) when secret is empty', () => {
      expect(verifyMetaSignature(rawBody, undefined, '', true)).toBe(false);
      expect(verifyMetaSignature(rawBody, 'sha256=123', '', true)).toBe(false);
    });
  });

  describe('P1-3: Circuit Breaker HALF_OPEN Probe Gating', () => {
    it('should allow only 1 request probe during HALF_OPEN and route concurrent requests to fallback', async () => {
      let callCount = 0;
      const requestFn = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          throw new Error('Provider down');
        }
        // Delayed resolution for probe
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'PROBE_SUCCESS';
      });

      const fallbackFn = vi.fn().mockResolvedValue('FALLBACK');

      const breaker = new CircuitBreaker(requestFn, fallbackFn, {
        failureThreshold: 0.5,
        slidingWindowSize: 2,
        cooldownPeriodMs: 20,
      });

      // Execute 2 failures to trip circuit OPEN
      await breaker.execute();
      await breaker.execute();
      expect(breaker.getState()).toBe('OPEN');

      // Wait for cooldown to transition to HALF_OPEN
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(breaker.getState()).toBe('HALF_OPEN');

      // Launch 3 concurrent requests while HALF_OPEN
      const p1 = breaker.execute(); // Should be the probe
      const p2 = breaker.execute(); // Should hit probe lock -> fallback
      const p3 = breaker.execute(); // Should hit probe lock -> fallback

      const [res1, res2, res3] = await Promise.all([p1, p2, p3]);

      expect(res1).toBe('PROBE_SUCCESS');
      expect(res2).toBe('FALLBACK');
      expect(res3).toBe('FALLBACK');
      expect(requestFn).toHaveBeenCalledTimes(3); // 2 initial fails + 1 probe
    });
  });

  describe('P0-4: PII Auto Sanitization in Log Buffer', () => {
    beforeEach(() => {
      installLogBuffer();
    });

    it('should sanitize raw Indonesian phone numbers logged via console.log', () => {
      console.log('User phone number is 6287751148065 and alt 08123456789');

      const logs = getLogBuffer(5);
      const latest = logs[0];
      expect(latest.msg).not.toContain('6287751148065');
      expect(latest.msg).not.toContain('08123456789');
      expect(latest.msg).toContain('628***');
    });
  });

  describe('P0-1: Redis Lifecycle Recovery', () => {
    it('should maintain redisEnabled status query methods', () => {
      expect(typeof queueService.isRedisEnabled).toBe('function');
      expect(typeof faqCacheService.isRedisEnabled).toBe('function');
    });
  });
});
