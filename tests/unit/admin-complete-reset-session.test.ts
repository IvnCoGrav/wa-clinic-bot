import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { auditService } from '../../src/services/audit.service';
import { GoalTracker } from '../../src/v3/state/goal-tracker';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * CG-02 (pemicu closing): PATCH /api/admin/reservation/:id/complete
 * WAJIB membersihkan sesi V3 episodik customer setelah booking ditandai selesai.
 */
const ADMIN_KEY = 'test_admin_key_cg02_complete';

describe('Admin complete reservasi membersihkan sesi V3 (CG-02)', () => {
  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    vi.restoreAllMocks();
  });

  it('complete → updateGoalSession dipanggil dengan cartItems kosong', async () => {
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: 'res-complete-1',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-complete-1',
      status: 'confirmed',
    } as any);
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({ id: 'res-complete-1', status: 'completed' } as any);
    vi.mocked(prisma.conversation.findFirst).mockResolvedValueOnce({ id: 'conv-complete-1' } as any);
    vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined as any);
    const goalSpy = vi.spyOn(GoalTracker, 'updateGoalSession').mockResolvedValue({} as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/reservation/res-complete-1/complete',
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(200);
    const cleared = goalSpy.mock.calls.find(
      (c) => c[0] === 'conv-complete-1' && Array.isArray((c[1] as any).cartItems) && (c[1] as any).cartItems.length === 0
    );
    expect(cleared).toBeTruthy();
  });
});
