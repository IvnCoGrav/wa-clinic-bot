import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { StaffAuthService } from '../../src/services/staff-auth.service';
import { prisma } from '../../src/db/client';
import { customerService } from '../../src/services/customer.service';
import { clearScopeCache } from '../../src/services/role-scope.service';

describe('FASE 2: RBAC Matrix & Tenant Isolation Suite (Tasks 2.1 & 2.2)', () => {
  const app = buildApp();
  const adminKey = 'test_super_admin_key_fase2';

  beforeEach(() => {
    process.env.ADMIN_API_KEY = adminKey;
    clearScopeCache();
    vi.clearAllMocks();
  });

  describe('2.1 RBAC Matrix: Role x Endpoint Mutation Guards', () => {
    const rolesToTest = [
      { name: 'ADMIN_CS', token: 'token-admin-cs' },
      { name: 'SPV_CS', token: 'token-spv-cs' },
      { name: 'THERAPIST', token: 'token-therapist' },
    ];

    beforeEach(() => {
      vi.spyOn(StaffAuthService, 'validateSession').mockImplementation(async (token: string) => {
        const found = rolesToTest.find((r) => r.token === token);
        if (found) {
          return {
            id: `sess-${found.name}`,
            token_hash: `hash-${found.name}`,
            staff_id: `staff-${found.name}`,
            staff: {
              id: `staff-${found.name}`,
              name: `Staff ${found.name}`,
              role: found.name,
              tenant_id: 'tenant-a',
              is_active: true,
            },
          } as any;
        }
        return null;
      });

      // Default roleApiScope kosong untuk non-super-admin -> fail-closed
      (prisma as any).roleApiScope = {
        findMany: vi.fn().mockResolvedValue([]),
      };
    });

    for (const { name, token } of rolesToTest) {
      it(`[2.1.5] Role ${name} MUST be blocked (403) from mutating delivery tiers`, async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/admin/delivery-tiers',
          headers: {
            cookie: `staff_session=${token}`,
            'x-requested-with': 'XMLHttpRequest',
          },
          payload: { tiers: [] },
        });

        expect(res.statusCode).toBe(403);
        const body = JSON.parse(res.body);
        expect(['FORBIDDEN_STAFF_ROLE', 'FORBIDDEN_ROLE_SCOPE']).toContain(body.code);
      });

      it(`[2.1.5] Role ${name} MUST be blocked (403) from mutating few-shots`, async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/admin/few-shots',
          headers: {
            cookie: `staff_session=${token}`,
            'x-requested-with': 'XMLHttpRequest',
          },
          payload: {
            scenario: 'Test Scenario',
            customerMessage: 'Halo',
            idealResponse: 'Halo juga',
          },
        });

        expect(res.statusCode).toBe(403);
        const body = JSON.parse(res.body);
        expect(['FORBIDDEN_STAFF_ROLE', 'FORBIDDEN_ROLE_SCOPE']).toContain(body.code);
      });

      it(`[2.1.5] Role ${name} MUST be blocked (403) from mutating CAPI config`, async () => {
        const res = await app.inject({
          method: 'PATCH',
          url: '/api/admin/capi-config',
          headers: {
            cookie: `staff_session=${token}`,
            'x-requested-with': 'XMLHttpRequest',
          },
          payload: { metaPixelId: '123456789' },
        });

        expect(res.statusCode).toBe(403);
        const body = JSON.parse(res.body);
        expect(['FORBIDDEN_STAFF_ROLE', 'FORBIDDEN_ROLE_SCOPE']).toContain(body.code);
      });

      it(`[2.1.5] Role ${name} MUST be blocked (403) from accessing whatsapp-provider`, async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/api/admin/whatsapp-provider',
          headers: {
            cookie: `staff_session=${token}`,
            'x-requested-with': 'XMLHttpRequest',
          },
        });

        expect(res.statusCode).toBe(403);
        const body = JSON.parse(res.body);
        expect(['FORBIDDEN_STAFF_ROLE', 'FORBIDDEN_ROLE_SCOPE']).toContain(body.code);
      });
    }

    it('Super Admin with X-API-KEY MUST be allowed to access settings endpoints', async () => {
      (prisma as any).tenant = {
        findUnique: vi.fn().mockResolvedValue({
          id: 'tenant-a',
          meta_pixel_id: 'pixel-123',
        }),
      };

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/capi-config',
        headers: {
          'x-api-key': adminKey,
          'x-tenant-id': 'tenant-a',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).success).toBe(true);
    });
  });

  describe('2.2 Tenant Isolation: Session vs Body & Cross-Tenant Access', () => {
    beforeEach(() => {
      vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue({
        id: 'sess-staff-a',
        token_hash: 'hash-staff-a',
        staff_id: 'staff-a',
        staff: {
          id: 'staff-a',
          name: 'Staff CS Tenant A',
          role: 'ADMIN_CS',
          tenant_id: 'tenant-a',
          is_active: true,
        },
      } as any);

      // Izinkan scope untuk rute pengujian isolasi tenant ini
      (prisma as any).roleApiScope = {
        findMany: vi.fn().mockResolvedValue([
          { api_prefix: '/api/admin/staff', methods: 'POST,GET' },
          { api_prefix: '/api/admin/knowledge', methods: 'GET,PUT,DELETE,POST' },
        ]),
      };
    });

    it('[2.2.1] Request body with tenant_id: "tenant-b" MUST be overridden by staffSession tenant_id ("tenant-a")', async () => {
      const { knowledgeBaseService } = await import('../../src/services/knowledge.service');
      let targetTenant: string | undefined;
      vi.spyOn(knowledgeBaseService, 'importFaqs').mockImplementation(async (_faqs, tenantId) => {
        targetTenant = tenantId;
        return 1;
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/knowledge/faq',
        headers: {
          cookie: 'staff_session=token-valid-staff-a',
          'x-requested-with': 'XMLHttpRequest',
        },
        payload: {
          tenant_id: 'tenant-b', // Spoof attempt!
          faqs: [{ question: 'Jam buka?', answer: 'Jam 8-17' }],
        },
      });

      expect(res.statusCode).toBe(200);
      // Nilai tenant_id harus dipaksa menjadi 'tenant-a'
      expect(targetTenant).toBe('tenant-a');
    });

    it('[2.2.3] Cross-tenant knowledge chunk mutation MUST return 404 (BOLA Protection)', async () => {
      (prisma as any).knowledgeChunk = {
        findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
          // If query checks tenant_id === 'tenant-b', returns row; if tenant_id === 'tenant-a', returns null
          if (where.id === 'chunk-99' && where.tenant_id === 'tenant-b') {
            return {
              id: 'chunk-99',
              tenant_id: 'tenant-b',
              title: 'Private SOP B',
              content: 'Secret B',
            };
          }
          return null;
        }),
        update: vi.fn(),
      };

      // Staf dari tenant-a mencoba memodifikasi chunk milik tenant-b
      const res = await app.inject({
        method: 'PUT',
        url: '/api/admin/knowledge/chunks/chunk-99',
        headers: {
          cookie: 'staff_session=token-valid-staff-a',
          'x-requested-with': 'XMLHttpRequest',
        },
        payload: {
          title: 'Hacked Title',
          content: 'Hacked Content',
        },
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error).toMatch(/not found/i);
      expect((prisma as any).knowledgeChunk.update).not.toHaveBeenCalled();
    });

    it('[2.2.3] Cross-tenant knowledge chunk deletion MUST return 404 (BOLA Protection)', async () => {
      (prisma as any).knowledgeChunk = {
        findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
          if (where.id === 'chunk-88' && where.tenant_id === 'tenant-b') {
            return {
              id: 'chunk-88',
              tenant_id: 'tenant-b',
            };
          }
          return null;
        }),
        delete: vi.fn(),
      };

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/admin/knowledge/chunks/chunk-88',
        headers: {
          cookie: 'staff_session=token-valid-staff-a',
          'x-requested-with': 'XMLHttpRequest',
        },
      });

      expect(res.statusCode).toBe(404);
      expect((prisma as any).knowledgeChunk.delete).not.toHaveBeenCalled();
    });
  });

  describe('2.3 Multi-tenant Label & Webhook Isolation', () => {
    it('[2.3.1 & 2.3.2] setLabelFlags MUST be tenant-scoped and require explicit tenantId', async () => {
      const phone = '6281234567890';
      const repo = (await import('../../src/repositories/customer.repository')).getCustomerRepository();
      const updateSpy = vi.spyOn(repo, 'updateManyByPhoneTenant').mockResolvedValue(1);

      await customerService.setLabelFlags(phone, { isHoldLabeled: true }, 'tenant-a');

      expect(updateSpy).toHaveBeenCalledWith(
        phone,
        'tenant-a',
        expect.objectContaining({ is_hold_labeled: true })
      );

      // Buktikan tidak mencemari tenant-b
      expect(updateSpy).not.toHaveBeenCalledWith(
        phone,
        'tenant-b',
        expect.anything()
      );
    });
  });
});
