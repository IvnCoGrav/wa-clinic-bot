import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { resolveSessionTenantId, tenantOf } from '../../src/routes/admin/route-helpers';
import { mediaService } from '../../src/services/media.service';
import { customerService } from '../../src/services/customer.service';
import { sanitizeStaffHubPayload } from '../../src/utils/pii-masker';

describe('F2 — tenant id & cache isolation', () => {
  describe('route-helpers tenant validation', () => {
    it('menolak tenant id traversal dari header/query', () => {
      for (const bad of ['../x', 'a/b', '..', 'a b', 'tenant%2f..']) {
        const req: any = { headers: { 'x-tenant-id': bad }, query: {} };
        expect(() => resolveSessionTenantId(req)).toThrow(/tenantId tidak valid/);
        expect(() => tenantOf(req)).toThrow(/tenantId tidak valid/);
      }
    });

    it('menerima tenant kanonik', () => {
      const req: any = { headers: { 'x-tenant-id': 'tenant-a' }, query: {} };
      expect(resolveSessionTenantId(req)).toBe('tenant-a');
      expect(tenantOf(req)).toBe('tenant-a');
    });
  });

  describe('media path traversal', () => {
    beforeEach(() => {
      process.env.ADMIN_API_KEY = 'test_admin_key_f2';
    });

    it('menolak write media dengan tenantId traversal', async () => {
      const probe = path.join(process.cwd(), 'storage', 'probe-f2');
      if (fs.existsSync(probe)) fs.rmSync(probe, { recursive: true, force: true });

      await expect(
        mediaService.saveOutboundMedia({
          tenantId: '../../probe-f2',
          imageB64: Buffer.from('x').toString('base64'),
          mimeType: 'image/jpeg',
        })
      ).rejects.toThrow(/tenantId tidak valid/);

      expect(fs.existsSync(probe)).toBe(false);
    });
  });

  describe('customer memory cache ber-tenant', () => {
    const phone = '628999000111';

    beforeEach(() => {
      customerService.getMemoryCustomers().clear();
      customerService.getMemoryCustomers().set(phone, {
        id: 'cust-tenant-a',
        phone,
        tenant_id: 'tenant-a',
        name: 'A',
      });
    });

    it('tenant B tidak menerima objek cache tenant A', async () => {
      const result = await customerService.getCustomerByPhone(phone, 'tenant-b');
      expect(result).toBeNull();
    });

    it('tenant A tetap menerima cache-nya sendiri', async () => {
      const result = await customerService.getCustomerByPhone(phone, 'tenant-a');
      expect(result?.id).toBe('cust-tenant-a');
    });
  });

  describe('masking status_updated', () => {
    it('menyamarkan waMessageId ber-JID pada event status', () => {
      const masked = sanitizeStaffHubPayload(
        { waMessageId: 'false_6281234567890@c.us_ABC123', messageId: 'm1', status: 'delivered' },
        'message.status_updated',
        { maskPhone: true }
      );
      expect(masked.waMessageId).not.toContain('6281234567890');
      expect(masked.waMessageId).toContain('***');
    });

    it('supervisor (maskPhone false) melihat nilai apa adanya', () => {
      const payload = { waMessageId: 'false_6281234567890@c.us_ABC123' };
      const out = sanitizeStaffHubPayload(payload, 'message.status_updated', { maskPhone: false });
      expect(out.waMessageId).toBe(payload.waMessageId);
    });
  });
});
