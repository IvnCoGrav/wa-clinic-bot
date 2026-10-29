import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { metaAttributionAdminRoutes } from '../../src/routes/admin/meta-attribution.subroute';
import * as analyticsModule from '../../src/services/meta-performance-analytics.service';

describe('GET /api/admin/meta-performance - Tenant Isolation (Temuan D)', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.restoreAllMocks();
    app = Fastify();
    await app.register(metaAttributionAdminRoutes);
  });

  it('gagal fail-closed (401) jika tenantId tidak ada pada request', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/meta-performance?startDate=2026-10-01&endDate=2026-10-25',
    });

    expect(res.statusCode).toBe(401);
  });

  it('menggunakan tenantId dari tenantOf(request) dan meneruskannya ke service', async () => {
    const mockReport = {
      window: { startDate: '2026-10-01', endDate: '2026-10-25' },
      roasSummary: {},
      monthlyCohorts: [],
      therapistCapacities: [],
      metaCostValidation: { ok: true },
    };

    vi.spyOn(analyticsModule, 'getMetaPerformanceReport').mockResolvedValueOnce(mockReport as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/meta-performance?startDate=2026-10-01&endDate=2026-10-25',
      headers: {
        'x-tenant-id': 'tenant-custom-99',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(analyticsModule.getMetaPerformanceReport).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-custom-99',
      })
    );
  });
});
