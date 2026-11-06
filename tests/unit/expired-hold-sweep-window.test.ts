import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { CronService } from '../../src/services/cron.service';
import { ACTIVE_HOLD_WINDOW_MS } from '../../src/domain/reservation-status';

vi.mock('../../src/services/media.service', () => ({
  getAllTenantIds: vi.fn().mockResolvedValue(['default-tenant']),
}));

describe('A-003: Expired Hold Sweep Window (2 Jam vs Tengah Malam)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cutoff pembatalan hold harus 2 jam (ACTIVE_HOLD_WINDOW_MS), bukan tengah malam', async () => {
    // Di kode baru (Fase 2), prisma.reservation.findMany dipanggil dengan created_at: { lt: cutoff }
    // Di kode lama, prisma.reservation.updateMany dipanggil langsung dengan created_at: { lt: startOfTodayWibUtc }
    vi.mocked((prisma.reservation as any).findMany).mockResolvedValueOnce([
      { id: 'res-hold-expired', customer_id: 'cust-1' },
    ] as any);
    vi.mocked((prisma.reservation as any).updateMany).mockResolvedValueOnce({ count: 1 } as any);

    const cron = new CronService();
    await cron.runExpiredHoldSweep();

    // Verifikasi pemanggilan findMany (Fase 2) atau updateMany (kode lama)
    const findCalls = vi.mocked((prisma.reservation as any).findMany).mock.calls;
    const updateCalls = vi.mocked((prisma.reservation as any).updateMany).mock.calls;

    // Kode baru wajib memanggil findMany terlebih dahulu untuk mendapatkan ID dan customer_id
    expect(findCalls.length).toBeGreaterThanOrEqual(1);

    const arg = findCalls[0][0] as any;
    expect(arg.where.status).toBe('hold');
    const cutoff = arg.where.created_at.lt as Date;
    expect(cutoff).toBeInstanceOf(Date);

    const diffHours = (Date.now() - cutoff.getTime()) / (1000 * 60 * 60);
    // Cutoff harus ~2 jam (1.9 - 2.1 jam), selaras dengan ACTIVE_HOLD_WINDOW_MS
    expect(diffHours).toBeGreaterThanOrEqual(1.9);
    expect(diffHours).toBeLessThanOrEqual(2.1);
  });
});
