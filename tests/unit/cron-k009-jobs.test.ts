import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '../../src/db/client';
import {
  cleanupSandboxCustomers,
  sandboxCleanupWhere,
} from '../../src/services/sandbox-cleanup.service';
import { StaffRetentionService } from '../../src/services/staff-retention.service';

/** K-009: cleanup sandbox & snapshot retensi bulanan harus jalan sebagai cron. */
describe('Cron K-009 — sandbox cleanup', () => {
  const customerModel = prisma.customer as any;

  beforeEach(() => {
    customerModel.deleteMany = vi.fn();
  });

  afterEach(() => {
    delete customerModel.deleteMany;
  });

  it('where clause menargetkan data sandbox & nomor dummy, bukan data nyata', () => {
    const where = sandboxCleanupWhere();
    expect(where.OR).toEqual([
      { is_sandbox_test: true },
      { phone: { startsWith: '6289999' } },
    ]);
  });

  it('mengembalikan jumlah baris yang dihapus', async () => {
    customerModel.deleteMany.mockResolvedValue({ count: 7 });
    await expect(cleanupSandboxCustomers()).resolves.toEqual({ deletedCount: 7 });
    expect(customerModel.deleteMany).toHaveBeenCalledWith({ where: sandboxCleanupWhere() });
  });

  it('kegagalan DB dilempar (tidak dilaporkan sukses palsu)', async () => {
    customerModel.deleteMany.mockRejectedValue(new Error('Database offline'));
    await expect(cleanupSandboxCustomers()).rejects.toThrow(/Database offline/);
  });
});

describe('Cron K-009 — snapshot retensi bulanan', () => {
  type FakePrisma = {
    staffRetentionSnapshot: { findFirst: ReturnType<typeof vi.fn> };
  };

  function makeService(finalExists: boolean) {
    const fakePrisma: FakePrisma = {
      staffRetentionSnapshot: {
        findFirst: vi.fn().mockResolvedValue(finalExists ? { id: 'snap-final' } : null),
      },
    };
    const service = new StaffRetentionService(fakePrisma as any);
    const compute = vi
      .spyOn(service, 'computeForPeriod')
      .mockResolvedValue({ report: { items: [{ staffId: 's1' }, { staffId: 's2' }] }, cohort: [] } as any);
    return { service, fakePrisma, compute };
  }

  afterEach(() => {
    delete process.env.STAFF_RETENTION_SNAPSHOT_STATUS;
  });

  it('memakai periode bulan sebelumnya menurut WIB', async () => {
    const { service, compute } = makeService(false);
    // 2026-11-12 02:00Z = 09:00 WIB tanggal 12 November → periode Oktober 2026.
    const res = await service.runScheduledMonthlySnapshot('tenant-a', {
      now: new Date('2026-11-12T02:00:00.000Z'),
    });
    expect(res).toMatchObject({ periodYear: 2026, periodMonth: 10, skipped: false, itemCount: 2 });
    expect(compute).toHaveBeenCalledWith('tenant-a', 2026, 10, {
      persist: true,
      status: 'PREVIEW',
      actor: 'cron',
    });
  });

  it('Januari memakai Desember tahun sebelumnya', async () => {
    const { service } = makeService(false);
    const res = await service.runScheduledMonthlySnapshot('tenant-a', {
      now: new Date('2027-01-02T01:00:00.000Z'),
    });
    expect(res.periodYear).toBe(2026);
    expect(res.periodMonth).toBe(12);
  });

  it('tidak menimpa snapshot FINAL yang sudah dibekukan', async () => {
    const { service, fakePrisma, compute } = makeService(true);
    const res = await service.runScheduledMonthlySnapshot('tenant-a', {
      now: new Date('2026-11-12T02:00:00.000Z'),
    });
    expect(res.skipped).toBe(true);
    expect(res.skipReason).toBe('FINAL_ALREADY_FROZEN');
    expect(fakePrisma.staffRetentionSnapshot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenant_id: 'tenant-a', status: 'FINAL' }),
      })
    );
    expect(compute).not.toHaveBeenCalled();
  });

  it('policy belum dikonfigurasi → skipped, bukan melempar', async () => {
    const { service, compute } = makeService(false);
    const err: any = new Error('policy belum ada');
    err.code = 'RETENTION_POLICY_NOT_CONFIGURED';
    compute.mockRejectedValue(err);
    const res = await service.runScheduledMonthlySnapshot('tenant-a', {
      now: new Date('2026-11-12T02:00:00.000Z'),
    });
    expect(res).toMatchObject({ skipped: true, skipReason: 'POLICY_NOT_CONFIGURED' });
  });

  it('error lain tetap dilempar agar status cron gagal & alert', async () => {
    const { service, compute } = makeService(false);
    compute.mockRejectedValue(new Error('DB mati'));
    await expect(
      service.runScheduledMonthlySnapshot('tenant-a', { now: new Date('2026-11-12T02:00:00.000Z') })
    ).rejects.toThrow(/DB mati/);
  });

  it('env STAFF_RETENTION_SNAPSHOT_STATUS=FINAL dipakai untuk pembekuan otomatis', async () => {
    process.env.STAFF_RETENTION_SNAPSHOT_STATUS = 'FINAL';
    const { service, compute } = makeService(false);
    await service.runScheduledMonthlySnapshot('tenant-a', {
      now: new Date('2026-11-12T02:00:00.000Z'),
    });
    expect(compute).toHaveBeenCalledWith(
      'tenant-a',
      2026,
      10,
      expect.objectContaining({ status: 'FINAL' })
    );
  });
});
