import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { StaffAuthService } from '../../src/services/staff-auth.service';
import { backupService } from '../../src/services/backup.service';

describe('F2 — otoritas tenant di route', () => {
  const app = buildApp();
  const ADMIN_KEY = 'test_admin_key_f2_routes';

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    process.env.WABA_APP_SECRET = '';
    process.env.WABA_ALLOW_UNSIGNED_WEBHOOK = 'false';
  });

  it('staf tidak dapat memindahkan tenant lewat header x-tenant-id', async () => {
    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue({
      token: 't',
      staff: { id: 'staff-1', name: 'Terapis', role: 'THERAPIST', tenant_id: 'tenant-a' },
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
    } as any);
    const findMany = vi.mocked((prisma as any).quickReply.findMany);
    findMany.mockResolvedValue([]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/staff/quick-replies',
      headers: { cookie: 'staff_session=staff-token', 'x-tenant-id': 'tenant-b' },
    });

    expect(res.statusCode).toBe(200);
    const where = findMany.mock.calls.at(-1)?.[0]?.where;
    expect(where).toEqual({ tenant_id: 'tenant-a' });
  });

  it('moderasi lead menolak customer tenant lain (404, tanpa audit)', async () => {
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation/lead_cust-tenant-b/reject-purchase',
      headers: { 'x-api-key': ADMIN_KEY, 'x-tenant-id': 'tenant-a' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('WABA menolak payload dengan lebih dari satu phone_number_id pada mode secret per tenant', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/waba',
      headers: { 'content-type': 'application/json' },
      payload: {
        object: 'whatsapp_business_account',
        entry: [
          { id: 'a', changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'PN_A' } } }] },
          { id: 'b', changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'PN_B' } } }] },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('backup/create mengabaikan tenantId dari body dan memakai tenant sesi', async () => {
    const dumpSpy = vi.spyOn(backupService, 'createDatabaseDump').mockResolvedValue({
      filePath: '/tmp/x.sql.gz',
      fileName: 'x.sql.gz',
      sizeBytes: 1,
    } as any);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/backup/create',
      headers: { 'x-api-key': ADMIN_KEY, 'x-tenant-id': 'tenant-a' },
      payload: { tenantId: 'tenant-b' },
    });

    expect(res.statusCode).toBe(200);
    expect(dumpSpy).toHaveBeenCalledWith('tenant-a', { scope: 'tenant' });
  });

  it('GET landing :id difilter tenant sesi', async () => {
    const findFirst = vi.mocked(prisma.landingPage.findFirst);
    findFirst.mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/landings/lp-tenant-b',
      headers: { 'x-api-key': ADMIN_KEY, 'x-tenant-id': 'tenant-a' },
    });

    expect(res.statusCode).toBe(404);
    const where = findFirst.mock.calls.at(-1)?.[0]?.where;
    expect(where).toEqual({ id: 'lp-tenant-b', tenant_id: 'tenant-a' });
  });

  it('GET /api/admin/services membaca katalog tenant sesi', async () => {
    const { treatmentCatalogService } = await import('../../src/services/treatment-catalog.service');
    const spy = vi.spyOn(treatmentCatalogService, 'getAllServices').mockReturnValue([]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/services',
      headers: { 'x-api-key': ADMIN_KEY, 'x-tenant-id': 'tenant-a' },
    });

    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledWith(false, 'tenant-a');
  });
});
