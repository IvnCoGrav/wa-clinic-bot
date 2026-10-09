import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tenantOf } from '../../src/routes/admin/route-helpers';
import { resolveTenantByPhoneNumberId } from '../../src/services/waba-tenant.service';
import { matchAdClickAndFireContact } from '../../src/services/ad-attribution.service';
import { memoryAdClicks } from '../../src/routes/tracking.route';
import { prisma } from '../../src/db/client';

describe('Tenant Fail-Closed & Multi-Tenant Isolation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    memoryAdClicks.clear();
  });

  describe('1. tenantOf helper', () => {
    it('should throw 401 if tenantId is missing from both request object and headers', () => {
      const mockReq: any = {
        headers: {},
      };
      expect(() => tenantOf(mockReq)).toThrowError(/tenantId wajib/);
    });

    it('should throw 401 if tenantId is an empty or whitespace string', () => {
      const mockReq: any = {
        tenantId: '   ',
        headers: { 'x-tenant-id': '' },
      };
      expect(() => tenantOf(mockReq)).toThrowError(/tenantId wajib/);
    });

    it('should return request.tenantId if present', () => {
      const mockReq: any = {
        tenantId: 'tenant-alpha',
        headers: { 'x-tenant-id': 'tenant-beta' },
      };
      expect(tenantOf(mockReq)).toBe('tenant-alpha');
    });

    it('should return trimmed x-tenant-id from headers if request.tenantId is absent', () => {
      const mockReq: any = {
        headers: { 'x-tenant-id': 'tenant-gamma' },
      };
      expect(tenantOf(mockReq)).toBe('tenant-gamma');
    });
  });

  describe('2. resolveTenantByPhoneNumberId', () => {
    it('should throw UNKNOWN_PHONE_NUMBER_ID when phone number is unknown and DB finds nothing', async () => {
      vi.mocked(prisma.tenant.findFirst).mockResolvedValueOnce(null as any);
      await expect(resolveTenantByPhoneNumberId('999999999999999')).rejects.toThrow('UNKNOWN_PHONE_NUMBER_ID');
    });
  });

  describe('3. matchAdClickAndFireContact cross-tenant isolation', () => {
    it('should reject linking memory click when tracking code belongs to another tenant', async () => {
      const code = 'code_owner';
      memoryAdClicks.set(code, {
        id: 'click-123',
        trackingCode: code,
        tenant_id: 'tenant-owner',
        createdAt: new Date(),
        matchedAt: null,
      });

      // Tenant "intruder" tries to match code_owner
      const result = await matchAdClickAndFireContact({
        bodyText: `Halo admin [${code}]`,
        customer: { id: 'cust-intruder', phone: '08123456789' },
        tenantId: 'tenant-intruder',
      });

      expect(result.matched).toBe(false);
      expect(result.adClick).toBeNull();
    });

    it('should accept linking memory click when tracking code matches same tenant', async () => {
      const code = 'code_valid';
      memoryAdClicks.set(code, {
        id: 'click-456',
        trackingCode: code,
        tenant_id: 'tenant-owner',
        createdAt: new Date(),
        matchedAt: null,
      });

      const result = await matchAdClickAndFireContact({
        bodyText: `Halo admin [${code}]`,
        customer: { id: 'cust-owner', phone: '08123456789' },
        tenantId: 'tenant-owner',
      });

      expect(result.matched).toBe(true);
      expect(result.adClick?.id).toBe('click-456');
    });
  });
});
