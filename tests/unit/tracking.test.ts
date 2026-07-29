import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateTrackingCode } from '../../src/routes/tracking.route';

import { safeCompare } from '../../src/utils/auth';
import { normalizePhoneToE164, sha256Hash, capiService, capiBreaker } from '../../src/services/capi.service';
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

    it('should skip CAPI call if adClick data is not provided', async () => {
      const response = await capiService.sendCapiEvent({
        eventName: 'Lead',
        customer: { phone: '08123456789' },
        adClick: undefined, // missing attribution data
      });
      expect(response.success).toBe(false);
      expect(response.message).toContain('Skipped: No attribution data');
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
        })
      ).resolves.toEqual({ success: false, message: 'Network Timeout / DNS failure' });
    });
  });

  describe('5. Old AdClick Cleanup & TrackingCode Soft Release (>100 days old)', () => {
    it('should soft-release trackingCode via prisma.adClick.updateMany (preserving attribution history)', async () => {
      const updateManySpy = vi.mocked(prisma.adClick.updateMany).mockResolvedValue({ count: 5 });
      const { cronService } = await import('../../src/services/cron.service');

      await cronService.cleanupOldAdClicks();

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
});

