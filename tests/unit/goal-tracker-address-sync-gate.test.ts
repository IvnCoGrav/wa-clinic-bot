import { describe, it, expect, vi, beforeEach } from 'vitest';

// A-013: gate seam sinkronisasi jadwal aktif pada goal-tracker.
// Sebelum fix: seam dipanggil SETIAP turn yang punya lokasi walau tak berubah
// (prisma.reservation.findMany per-turn). Setelah fix: hanya bila `locationChanged`.

const syncMock = vi.fn().mockResolvedValue({ synced: 0 });

vi.mock('../../src/services/reservation-address-sync.service', () => ({
  syncActiveReservationsForCustomer: (...a: any[]) => syncMock(...a),
}));

import { prisma } from '../../src/db/client';
import { GoalTracker } from '../../src/v3/state/goal-tracker';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

const LOC_BARU = { kelurahan: 'Gebang Putih', kecamatan: 'Sukolilo', kota: 'Kota Surabaya' };

function makeConv(conversationId: string) {
  return { id: conversationId, tenant_id: DEFAULT_TENANT_ID, customer_id: 'cust-gate', session_data: null, customer: null };
}

function prevCust(over: any = {}) {
  return {
    preferences: {},
    kelurahan: 'Gebang Putih',
    kecamatan: 'Sukolilo',
    kota: 'Kota Surabaya',
    distance_km: null,
    ongkir: null,
    ...over,
  };
}

beforeEach(() => {
  syncMock.mockClear();
  vi.mocked(prisma.conversation.findFirst).mockReset().mockResolvedValue(makeConv('conv-gate') as any);
  vi.mocked(prisma.conversation.updateMany).mockReset().mockResolvedValue({ count: 1 } as any);
  vi.mocked(prisma.customer.findFirst).mockReset().mockResolvedValue(prevCust() as any);
  vi.mocked(prisma.customer.updateMany).mockReset().mockResolvedValue({ count: 1 } as any);
});

describe('GoalTracker.updateGoalSession — gate seam alamat jadwal aktif (A-013)', () => {
  it('lokasi BERUBAH vs DB → seam dipanggil (relink jadwal aktif setelah perubahan)', async () => {
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(prevCust({ kelurahan: 'Semolowaru' }) as any);
    await GoalTracker.updateGoalSession('conv-gate-1', { location: { ...LOC_BARU } }, DEFAULT_TENANT_ID);
    expect(syncMock).toHaveBeenCalledTimes(1);
    expect(syncMock).toHaveBeenCalledWith({ tenantId: DEFAULT_TENANT_ID, customerId: 'cust-gate' });
  });

  it('lokasi SAMA (turn lanjutan) → seam TIDAK dipanggil (anti overhead per-turn)', async () => {
    await GoalTracker.updateGoalSession('conv-gate-2', { location: { ...LOC_BARU } }, DEFAULT_TENANT_ID);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('prevCust null (lokasi pertama kali tercatat) → seam TIDAK dipanggil', async () => {
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(null as any);
    await GoalTracker.updateGoalSession('conv-gate-3', { location: { ...LOC_BARU } }, DEFAULT_TENANT_ID);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('tanpa lokasi di update → seam TIDAK dipanggil', async () => {
    await GoalTracker.updateGoalSession('conv-gate-4', { customerName: 'Bunda Jawir' }, DEFAULT_TENANT_ID);
    expect(syncMock).not.toHaveBeenCalled();
  });
});
