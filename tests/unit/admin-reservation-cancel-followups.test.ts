import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { auditService } from '../../src/services/audit.service';
import { customerService } from '../../src/services/customer.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Audit P1-14 — DELETE/cancel reservasi WAJIB membatalkan follow-up terkait
 * (pengingat H-1 / review H+1). Sebelumnya hanya membuat NO_PURCHASE baru
 * tanpa membatalkan follow-up reservation → reminder tetap terkirim.
 */
const ADMIN_KEY = 'test_admin_key_p1_14';

describe('Admin cancel/delete reservasi membatalkan follow-up (P1-14)', () => {
  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    vi.restoreAllMocks();
  });

  it('soft cancel (status=cancelled) membatalkan follow-up reservation', async () => {
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: 'res-cancel-1',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-1',
      status: 'confirmed',
      google_calendar_event_id: null,
      customer: { id: 'cust-1', phone: '628111', tenant_id: DEFAULT_TENANT_ID },
    } as any);
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({ id: 'res-cancel-1', status: 'cancelled' } as any);
    vi.mocked(prisma.followUp.findFirst).mockResolvedValueOnce(null as any);
    vi.mocked(prisma.followUp.createMany).mockResolvedValueOnce({ count: 3 } as any);
    vi.spyOn(customerService, 'recalculateCustomerLtv').mockResolvedValue(undefined as any);
    const followUpUpdate = vi.mocked(prisma.followUp.updateMany).mockResolvedValue({ count: 2 } as any);
    vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/reservation/res-cancel-1',
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(200);
    expect(followUpUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ reservation_id: 'res-cancel-1' }),
        data: expect.objectContaining({ status: 'CANCELLED' }),
      })
    );
  });
});
