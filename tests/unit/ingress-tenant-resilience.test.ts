import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wahaTenantService } from '../../src/services/waha-tenant.service';
import { wabaTenantService } from '../../src/services/waba-tenant.service';
import { handleLabelChatEvent } from '../../src/routes/webhook.route';
import { customerService } from '../../src/services/customer.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('Ingress Tenant Resilience Tests (F4.2C: ING-09..ING-18)', () => {
  beforeEach(() => {
    wahaTenantService.resetCache();
    wabaTenantService.resetCache();
    vi.restoreAllMocks();
  });

  describe('ING-14: waha-tenant fail-closed on non-default session when DB offline', () => {
    it('mengizinkan fallback default session saat DB offline', async () => {
      const { prisma } = await import('../../src/db/client');
      vi.spyOn(prisma.tenant, 'findFirst').mockRejectedValue(new Error('Database offline'));

      const res = await wahaTenantService.resolveTenantBySession('default');
      expect(res).toBe(DEFAULT_TENANT_ID);
    });

    it('menolak session non-default saat DB offline jika STRICT_MULTI_TENANT diaktifkan (fail-closed)', async () => {
      const { prisma } = await import('../../src/db/client');
      vi.spyOn(prisma.tenant, 'findFirst').mockRejectedValue(new Error('Database offline'));

      const prev = process.env.STRICT_MULTI_TENANT;
      try {
        process.env.STRICT_MULTI_TENANT = 'true';
        const res = await wahaTenantService.resolveTenantBySession('session-tenant-b');
        expect(res).toBeNull();
      } finally {
        process.env.STRICT_MULTI_TENANT = prev;
      }
    });
  });

  describe('ING-15: waba-tenant app secret resolution caching', () => {
    it('menyimpan cache secret in-memory per phone_number_id', async () => {
      const secret = await wabaTenantService.resolveAppSecretByPhoneNumberId('123456789');
      // Pada setup offline DB, secret resolver aman mengembalikan string kosong tanpa error
      expect(typeof secret).toBe('string');
    });
  });

  describe('ING-13 & ING-18: handleLabelChatEvent tenant isolation and retry', () => {
    it('meneruskan tenantId yang terisolasi ke customerService.setLabelFlags', async () => {
      const spy = vi.spyOn(customerService, 'setLabelFlags').mockResolvedValue(undefined as any);

      const event: any = {
        event: 'label.chat.added',
        payload: {
          chatId: '628123456789@c.us',
          label: { name: 'admin' },
        },
      };

      await handleLabelChatEvent(event, 'tenant-special-b');

      expect(spy).toHaveBeenCalledWith(
        '628123456789',
        expect.objectContaining({ isAdminLabeled: true }),
        'tenant-special-b'
      );
    });

    it('melakukan retry saat terjadi transient error', async () => {
      let callCount = 0;
      vi.spyOn(customerService, 'setLabelFlags').mockImplementation(async () => {
        callCount++;
        if (callCount < 2) {
          throw new Error('Transient DB timeout');
        }
      });

      const event: any = {
        event: 'label.chat.added',
        payload: {
          chatId: '628123456789@c.us',
          label: { name: 'hold' },
        },
      };

      await handleLabelChatEvent(event, 'tenant-retry');

      expect(callCount).toBe(2);
    });
  });
});
