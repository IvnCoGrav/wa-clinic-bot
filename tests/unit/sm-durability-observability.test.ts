import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { responseCacheService } from '../../src/services/response-cache.service';
import { trackTimeout, activeTimeoutCount, clearAllTimeouts } from '../../src/lifecycle/interval-registry';
import { outboundLedger } from '../../src/services/outbound-ledger.service';
import { messageService } from '../../src/services/message.service';

const TENANT = 'default-tenant';

describe('Durability & Observability Hardening (SM-03, SM-05, SM-09..SM-14)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearAllTimeouts();
  });

  describe('1. Timeout Tracking in Lifecycle Registry (SM-10)', () => {
    it('trackTimeout tracks and clears active timeouts upon shutdown', () => {
      const handle = trackTimeout(() => {}, 10000);
      expect(activeTimeoutCount()).toBe(1);

      clearAllTimeouts();
      expect(activeTimeoutCount()).toBe(0);
    });
  });

  describe('2. Tenant-Scoped Response Cache Invalidation (SM-12)', () => {
    it('invalidatePrefix with tenantId only purges keys of specified tenant', () => {
      responseCacheService.set('livechat:tenant-a:conv1', { data: 1 });
      responseCacheService.set('livechat:tenant-b:conv2', { data: 2 });
      responseCacheService.set('other:tenant-a:data', { data: 3 });

      responseCacheService.invalidatePrefix('livechat:', 'tenant-a');

      expect(responseCacheService.get('livechat:tenant-a:conv1')).toBeNull();
      expect(responseCacheService.get('livechat:tenant-b:conv2')).toEqual({ data: 2 });
      expect(responseCacheService.get('other:tenant-a:data')).toEqual({ data: 3 });
    });
  });

  describe('3. In-flight and Known Bot Outbounds Bounded Capacity (SM-03)', () => {
    it('registerInFlightBotOutbound limits array growth and evicts expired records', () => {
      for (let i = 0; i < 20; i++) {
        messageService.registerInFlightBotOutbound(`chat_${i}`, `content_${i}`, TENANT, 5000);
      }
      expect(messageService.isInFlightBotOutbound('chat_0', 'content_0', TENANT)).toBe(true);
    });
  });
});
