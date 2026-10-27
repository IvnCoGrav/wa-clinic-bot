import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { responseCacheService } from '../../src/services/response-cache.service';

const ADMIN_KEY = 'test-admin-key';
const TENANT_ID = 'test-tenant';

describe('GET /api/admin/reservations/count — Date Filtering & Cache Bypass', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    responseCacheService.clear();
  });

  it('rejects invalid date format with 400', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/reservations/count?date=invalid-date',
      headers: {
        'x-api-key': ADMIN_KEY,
        'x-tenant-id': TENANT_ID,
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/YYYY-MM-DD/);
  });

  it('filters reservations by created_at range when date is provided', async () => {
    const countSpy = vi.spyOn(prisma.reservation, 'count').mockResolvedValueOnce(5);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/reservations/count?date=2026-10-27',
      headers: {
        'x-api-key': ADMIN_KEY,
        'x-tenant-id': TENANT_ID,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.count).toBe(5);
    expect(body.scope).toBe('2026-10-27');
    expect(countSpy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenant_id: TENANT_ID,
        created_at: expect.objectContaining({
          gte: expect.any(Date),
          lte: expect.any(Date),
        }),
      }),
    }));
  });

  it('bypasses cache when refresh=1 is passed', async () => {
    // Populate cache with 10
    responseCacheService.set(`reservations:count:${TENANT_ID}:2026-10-27`, 10, 60);

    const countSpy = vi.spyOn(prisma.reservation, 'count').mockResolvedValueOnce(15);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/reservations/count?date=2026-10-27&refresh=1',
      headers: {
        'x-api-key': ADMIN_KEY,
        'x-tenant-id': TENANT_ID,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.count).toBe(15);
    expect(countSpy).toHaveBeenCalled();
  });
});
