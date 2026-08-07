import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { followUpService } from '../../src/services/follow-up.service';
import { prisma } from '../../src/db/client';

vi.mock('../../src/db/client', () => ({
  prisma: {
    followUp: {
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    followUpTemplate: {
      findFirst: vi.fn(),
    },
    reservation: {
      update: vi.fn(),
      findFirst: vi.fn(),
    },
    customer: {
      update: vi.fn(),
    },
    wabaTemplate: {
      findUnique: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
    },
  },
}));

function makeFollowUp(overrides: any = {}) {
  return {
    id: 'fu_1',
    tenant_id: 'tenant_default',
    customer_id: 'cust_1',
    type: 'NEXT_TREATMENT',
    stage: 1,
    status: 'PENDING',
    customer: {
      id: 'cust_1',
      phone: '6287751148065',
      name: 'Sari',
      status: 'active',
      tenant_id: 'tenant_default',
      children: [],
    },
    ...overrides,
  };
}

const threeMonthsAgo = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d;
};

describe('Follow-Up Milestone Hijack (Tahap 1)', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    delete process.env.MILESTONE_WINDOW_DAYS;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for NO_PURCHASE follow-ups', async () => {
    const fu = makeFollowUp({ type: 'NO_PURCHASE', stage: 1 });
    const result = await followUpService.resolveMilestoneType(fu, 'tenant_default');
    expect(result).toBeNull();
    // tidak perlu query reservation
    expect(prisma.reservation.findFirst).not.toHaveBeenCalled();
  });

  it('returns MILESTONE_3M when baby ~3 months + last reservation is BABY', async () => {
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: 'r1',
      treatment_category: 'BABY',
    } as any);

    const fu = makeFollowUp({
      customer: {
        id: 'cust_1',
        phone: '6287751148065',
        name: 'Sari',
        status: 'active',
        tenant_id: 'tenant_default',
        children: [
          { id: 'c1', name: 'Lala', birth_date: threeMonthsAgo(), customer_id: 'cust_1' },
        ],
      },
    });

    const result = await followUpService.resolveMilestoneType(fu, 'tenant_default');
    expect(result).toBe('MILESTONE_3M');
  });

  it('returns null when last reservation category is MOMS', async () => {
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: 'r1',
      treatment_category: 'MOMS',
    } as any);

    const fu = makeFollowUp({
      customer: {
        id: 'cust_1',
        phone: '6287751148065',
        name: 'Sari',
        status: 'active',
        tenant_id: 'tenant_default',
        children: [
          { id: 'c1', name: 'Lala', birth_date: threeMonthsAgo(), customer_id: 'cust_1' },
        ],
      },
    });

    const result = await followUpService.resolveMilestoneType(fu, 'tenant_default');
    expect(result).toBeNull();
  });

  it('returns null when no children with birth_date', async () => {
    const fu = makeFollowUp();
    const result = await followUpService.resolveMilestoneType(fu, 'tenant_default');
    expect(result).toBeNull();
    expect(prisma.reservation.findFirst).not.toHaveBeenCalled();
  });

  it('does not throw and returns null when DB is offline (reservation query rejects)', async () => {
    vi.mocked(prisma.reservation.findFirst).mockRejectedValueOnce(new Error('Database offline'));

    const fu = makeFollowUp({
      customer: {
        id: 'cust_1',
        phone: '6287751148065',
        name: 'Sari',
        status: 'active',
        tenant_id: 'tenant_default',
        children: [
          { id: 'c1', name: 'Lala', birth_date: threeMonthsAgo(), customer_id: 'cust_1' },
        ],
      },
    });

    const result = await followUpService.resolveMilestoneType(fu, 'tenant_default');
    expect(result).toBeNull();
  });

  it('returns null when baby age is far from any milestone', async () => {
    const d = new Date();
    d.setDate(d.getDate() - 180); // ~6 bulan
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: 'r1',
      treatment_category: 'BABY',
    } as any);

    // window kecil -> 6 bulan tidak masuk milestons
    process.env.MILESTONE_WINDOW_DAYS = '10';

    const fu = makeFollowUp({
      customer: {
        id: 'cust_1',
        phone: '6287751148065',
        name: 'Sari',
        status: 'active',
        tenant_id: 'tenant_default',
        children: [
          { id: 'c1', name: 'Lala', birth_date: d, customer_id: 'cust_1' },
        ],
      },
    });

    const result = await followUpService.resolveMilestoneType(fu, 'tenant_default');
    expect(result).toBeNull();
  });
});