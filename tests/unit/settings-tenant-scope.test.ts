import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import * as deliveryService from '../../src/services/delivery.service';
import { prisma } from '../../src/db/client';

describe('Settings Tenant Isolation & Scoping (Task 0.3)', () => {
  const app = buildApp();
  const adminKey = 'test_admin_key_tenant_scope';

  beforeEach(() => {
    process.env.ADMIN_API_KEY = adminKey;
    vi.clearAllMocks();
  });

  it('should save delivery tiers to caller tenant_id and NOT mutate DEFAULT_TENANT_ID', async () => {
    const saveSpy = vi.spyOn(deliveryService, 'saveDeliveryTiersToDb').mockResolvedValue(true);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/delivery-tiers',
      headers: {
        'x-api-key': adminKey,
        'x-tenant-id': 'tenant-b',
      },
      payload: {
        tiers: [
          { minKm: 0, maxKm: 5, price: 10000, description: 'Tier 1 Tenant B' },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    // Pada kode lama, saveDeliveryTiersToDb selalu dipanggil dengan DEFAULT_TENANT_ID ('default-tenant')
    // Pada model isolasi tenant, harus dipanggil dengan 'tenant-b'.
    expect(saveSpy).toHaveBeenCalledWith(expect.any(Array), 'tenant-b');
  });

  it('should scope clinic policy upsert to caller tenant_id and NOT mutate DEFAULT_TENANT_ID', async () => {
    (prisma as any).clinicPolicy = {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: 'pol-1',
        tenant_id: 'tenant-b',
        topic: 'jam_operasional',
        factual_summary: 'Buka jam 08:00 - 17:00',
        is_active: true,
      }),
    };

    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/settings/clinic-policies/jam_operasional',
      headers: {
        'x-api-key': adminKey,
        'x-tenant-id': 'tenant-b',
      },
      payload: {
        factual_summary: 'Buka jam 08:00 - 17:00',
      },
    });

    expect(res.statusCode).toBe(200);
    // Pada kode lama, prisma.clinicPolicy.findUnique & create hardcode { tenant_id: DEFAULT_TENANT_ID }
    // Pada model isolasi tenant, harus menggunakan 'tenant-b'.
    expect((prisma as any).clinicPolicy.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenant_id: 'tenant-b',
        }),
      })
    );
  });
});
