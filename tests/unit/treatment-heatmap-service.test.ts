import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { TreatmentHeatmapService } from '../../src/services/treatment-heatmap.service';
import { responseCacheService } from '../../src/services/response-cache.service';

describe('TreatmentHeatmapService — kontrak query & pemetaan', () => {
  beforeEach(() => {
    // clearAllMocks (bukan restoreAllMocks): implementation default "Database
    // offline" dari tests/setup.ts harus tetap hidup antar-test.
    vi.clearAllMocks();
    responseCacheService.clear();
  });

  it('hanya menarik reservasi completed pada tenant & rentang bulan WIB', async () => {
    const findMany = vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([
      {
        id: 'r1',
        booking_date: new Date(Date.UTC(2026, 10, 2, 3, 0, 0)), // 2026-11-02 10:00 WIB
        status: 'completed',
        purchase_value: 150_000,
        delivery_fee: 20_000,
        treatment_detail: 'Baby Spa',
        customer: { ongkir: 99_000 },
        items: [{ price: 150_000 }],
      },
    ] as any);
    vi.mocked(prisma.reservation.count).mockResolvedValueOnce(4);

    const res = await TreatmentHeatmapService.getHeatmap('tenant-svc-a', 2026, 11, 'monthly', 3);

    const where = (findMany.mock.calls[0][0] as any).where;
    expect(where.tenant_id).toBe('tenant-svc-a');
    expect(where.status).toBe('completed');
    expect(where.booking_date.gte.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(where.booking_date.lte.toISOString()).toBe('2026-11-30T16:59:59.999Z');

    expect(res.totals.count).toBe(1);
    expect(res.totals.revenue).toBe(170_000); // purchase_value + snapshot ongkir
    expect(res.totals.itemCount).toBe(1);
    expect(res.quality.excludedNonCompleted).toBe(4);
    expect(res.monthName).toBe('November');
  });

  it('scope multi memperlebar jendela query ke N bulan ke belakang', async () => {
    const findMany = vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([] as any);
    vi.mocked(prisma.reservation.count).mockResolvedValueOnce(0);

    const res = await TreatmentHeatmapService.getHeatmap('tenant-svc-b', 2026, 11, 'multi', 4);

    const where = (findMany.mock.calls[0][0] as any).where;
    // 4 bulan berakhir November 2026 → mulai 1 Agustus 2026 00:00 WIB.
    expect(where.booking_date.gte.toISOString()).toBe('2026-07-31T17:00:00.000Z');
    expect(where.booking_date.lte.toISOString()).toBe('2026-11-30T16:59:59.999Z');
    expect(res.months).toHaveLength(4);
    expect(res.scope).toBe('multi');
  });

  it('tenant berbeda memakai cache berbeda (tidak bocor lintas tenant)', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.reservation.count).mockResolvedValue(0);
    const findMany = vi.mocked(prisma.reservation.findMany);

    await TreatmentHeatmapService.getHeatmap('tenant-cache-a', 2026, 11, 'weekly');
    await TreatmentHeatmapService.getHeatmap('tenant-cache-b', 2026, 11, 'weekly');

    expect(findMany).toHaveBeenCalledTimes(2);
    expect((findMany.mock.calls[0][0] as any).where.tenant_id).toBe('tenant-cache-a');
    expect((findMany.mock.calls[1][0] as any).where.tenant_id).toBe('tenant-cache-b');
  });

  it('permintaan identik dilayani cache (query DB sekali)', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.reservation.count).mockResolvedValue(0);
    const findMany = vi.mocked(prisma.reservation.findMany);

    await TreatmentHeatmapService.getHeatmap('tenant-cache-c', 2026, 11, 'weekly');
    const second = await TreatmentHeatmapService.getHeatmap('tenant-cache-c', 2026, 11, 'weekly');

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(second.scope).toBe('weekly');
  });

  it('DB offline → respons kosong yang aman, bukan error 500', async () => {
    // Default mock global menolak semua query.
    const res = await TreatmentHeatmapService.getHeatmap('tenant-offline', 2026, 11, 'monthly');

    expect(res.totals.count).toBe(0);
    expect(res.days).toHaveLength(30);
    expect(res.quality.excludedNonCompleted).toBe(0);
  });

  it('menolak bulan tidak valid', async () => {
    await expect(TreatmentHeatmapService.getHeatmap('tenant-x', 2026, 13, 'weekly')).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('menolak scope tidak valid', async () => {
    await expect(
      TreatmentHeatmapService.getHeatmap('tenant-y', 2026, 11, 'yearly' as any)
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
