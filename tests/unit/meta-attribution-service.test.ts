import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: {
    adClick: { count: vi.fn(), findMany: vi.fn() },
    customer: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    reservation: { count: vi.fn(), findMany: vi.fn() },
    auditLog: { findMany: vi.fn() },
    tenant: { findUnique: vi.fn() },
    landingPageView: undefined as any,
  },
}));

vi.mock('../../src/db/client', () => ({ prisma: db }));

import {
  findCustomerByPhoneSuffix,
  getAttributionCounts,
  getManualSendHistory,
  getPageViewSummary,
  getTenantForCapiHealth,
  listAdClicks,
} from '../../src/services/meta-attribution.service';

/**
 * Uji kontrak service atribusi Meta (S1-4).
 *
 * Fokus adversarial: filter yang WAJIB tetap date-bounded vs all-time, pemakaian
 * 9 digit terakhir nomor, dan degradasi aman saat DB/model tidak tersedia.
 */
describe('meta-attribution.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.landingPageView = undefined;
  });

  it('listAdClicks meneruskan where/pagination apa adanya dan mengembalikan total+rows', async () => {
    db.adClick.count.mockResolvedValue(42);
    db.adClick.findMany.mockResolvedValue([{ id: 'a1' }]);

    const result = await listAdClicks({ where: { tenant_id: 't1' }, page: 3, pageSize: 25 });

    expect(result.total).toBe(42);
    expect(result.rows).toEqual([{ id: 'a1' }]);
    expect(db.adClick.count).toHaveBeenCalledWith({ where: { tenant_id: 't1' } });
    expect(db.adClick.findMany).toHaveBeenCalledWith({
      where: { tenant_id: 't1' },
      include: { customer: { select: { id: true, name: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
      skip: 50,
      take: 25,
    });
  });

  it('getAttributionCounts menjaga kontrak: event date-bounded, pending/ignored all-time', async () => {
    db.adClick.count.mockResolvedValueOnce(90).mockResolvedValueOnce(70);
    db.customer.count.mockResolvedValueOnce(10).mockResolvedValueOnce(30);
    db.reservation.count
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(20)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(2);

    const counts = await getAttributionCounts({
      tenantId: 't1',
      adClickWhere: { tenant_id: 't1', createdAt: { gte: 'X' } },
      mqlWhere: { tenant_id: 't1', is_mql: true, mql_triggered_at: { gte: 'X' } },
      approvedWhere: { tenant_id: 't1', purchase_review_status: 'approved', purchase_event_sent_at: { gte: 'X' } },
    });

    expect(counts).toEqual({
      clicks: 90,
      matched: 70,
      mqlCount: 10,
      mqlAllCount: 30,
      approvedCount: 5,
      approvedAllCount: 20,
      pendingCount: 7,
      rejectedCount: 2,
    });

    // matched menambah filter matchedAt != null tanpa menghapus filter tanggal
    expect(db.adClick.count).toHaveBeenNthCalledWith(2, {
      where: { tenant_id: 't1', createdAt: { gte: 'X' }, matchedAt: { not: null } },
    });
    // MQL all-time tetap tenant-scoped
    expect(db.customer.count).toHaveBeenNthCalledWith(2, { where: { tenant_id: 't1', is_mql: true } });
    // pending & ignored_outlier sengaja tanpa dateRange
    expect(db.reservation.count).toHaveBeenNthCalledWith(3, {
      where: { tenant_id: 't1', purchase_review_status: 'pending' },
    });
    expect(db.reservation.count).toHaveBeenNthCalledWith(4, {
      where: { tenant_id: 't1', purchase_review_status: 'ignored_outlier' },
    });
  });

  it('getTenantForCapiHealth menelan error DB menjadi null (bukan melempar)', async () => {
    db.tenant.findUnique.mockRejectedValue(new Error('Database offline'));
    await expect(getTenantForCapiHealth('t1')).resolves.toBeNull();

    db.tenant.findUnique.mockResolvedValue({ id: 't1', meta_pixel_id: 'px' });
    await expect(getTenantForCapiHealth('t1')).resolves.toEqual({ id: 't1', meta_pixel_id: 'px' });
  });

  it('findCustomerByPhoneSuffix memakai 9 digit terakhir dan filter tenant', async () => {
    db.customer.findFirst.mockResolvedValue({ id: 'c1' });

    // Pemanggil WAJIB mengirim digit saja (route sudah men-strip non-digit).
    await findCustomerByPhoneSuffix('6281234567890', 't1');
    expect(db.customer.findFirst).toHaveBeenCalledWith({
      where: { phone: { contains: '234567890' }, tenant_id: 't1' },
      include: { adClick: true },
    });

    // Tanpa tenant: filter tenant tidak dikirim (perilaku lama)
    await findCustomerByPhoneSuffix('081234567890', null);
    expect(db.customer.findFirst).toHaveBeenLastCalledWith({
      where: { phone: { contains: '234567890' } },
      include: { adClick: true },
    });
  });

  it('getManualSendHistory membatasi 30 log dan meresolusi target_id ke customer/reservasi', async () => {
    db.auditLog.findMany.mockResolvedValue([
      { id: 1, target_id: 'c1' },
      { id: 2, target_id: null },
      { id: 3, target_id: 'r1' },
    ]);
    db.customer.findMany.mockResolvedValue([{ id: 'c1' }]);
    db.reservation.findMany.mockResolvedValue([{ id: 'r1' }]);

    const history = await getManualSendHistory('t1');

    expect(db.auditLog.findMany).toHaveBeenCalledWith({
      where: {
        tenant_id: 't1',
        action: { in: ['MANUAL_SEND_META_EVENT', 'TEST_SEND_CAPI_EVENT', 'APPROVE_PURCHASE_EVENT'] },
      },
      orderBy: { created_at: 'desc' },
      take: 30,
    });
    // target_id null dibuang, tidak menghasilkan query id: null
    expect(db.customer.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['c1', 'r1'] } },
      include: { adClick: true },
    });
    expect(history.logs).toHaveLength(3);
    expect(history.customers).toEqual([{ id: 'c1' }]);
    expect(history.reservations).toEqual([{ id: 'r1' }]);
  });

  it('getPageViewSummary aman saat model/groupBy tidak ada di DB lama', async () => {
    db.landingPageView = { count: vi.fn().mockResolvedValue(12) };
    await expect(getPageViewSummary({ tenant_id: 't1' })).resolves.toEqual({ views: 12, bySourceRows: null });
  });

  it('getPageViewSummary tidak menggagalkan ringkasan saat count/groupBy menolak', async () => {
    db.landingPageView = {
      count: vi.fn().mockRejectedValue(new Error('kolom source belum ada')),
      groupBy: vi.fn().mockRejectedValue(new Error('kolom source belum ada')),
    };
    await expect(getPageViewSummary({ tenant_id: 't1' })).resolves.toEqual({ views: 0, bySourceRows: null });
  });
});
