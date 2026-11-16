/**
 * Query baca-only untuk panel admin atribusi Meta Ads.
 *
 * Diekstrak dari `src/routes/admin/meta-attribution.subroute.ts` (Sprint 1 /
 * S1-4) supaya route tidak lagi memanggil Prisma langsung (batas arsitektur:
 * route = HTTP/validasi, service = akses data). Bentuk query, `include`, filter,
 * dan urutan hasil dipertahankan persis — modul ini bukan refaktor semantik.
 */
import { prisma } from '../db/client';

export interface AdClickListParams {
  where: any;
  page: number;
  pageSize: number;
}

export interface AttributionCountParams {
  tenantId: string;
  adClickWhere: any;
  mqlWhere: any;
  approvedWhere: any;
}

export interface AttributionCounts {
  clicks: number;
  matched: number;
  mqlCount: number;
  mqlAllCount: number;
  approvedCount: number;
  approvedAllCount: number;
  pendingCount: number;
  rejectedCount: number;
}

/** Daftar klik iklan (pagination) + total untuk header tabel. */
export async function listAdClicks(params: AdClickListParams): Promise<{ total: number; rows: any[] }> {
  const { where, page, pageSize } = params;
  const [total, rows] = await Promise.all([
    prisma.adClick.count({ where }),
    prisma.adClick.findMany({
      where,
      include: { customer: { select: { id: true, name: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { total, rows };
}

/**
 * Delapan hitungan ringkasan atribusi.
 *
 * Aturan kontrak (jangan diubah tanpa ADR):
 * - Hitungan berbasis event (MQL, approved) WAJIB terikat rentang tanggal.
 * - `pending`/`ignored_outlier` adalah antrian point-in-time: sengaja all-time.
 */
export async function getAttributionCounts(params: AttributionCountParams): Promise<AttributionCounts> {
  const { tenantId, adClickWhere, mqlWhere, approvedWhere } = params;
  const [
    clicks,
    matched,
    mqlCount,
    mqlAllCount,
    approvedCount,
    approvedAllCount,
    pendingCount,
    rejectedCount,
  ] = await Promise.all([
    prisma.adClick.count({ where: adClickWhere }),
    prisma.adClick.count({ where: { ...adClickWhere, matchedAt: { not: null } } }),
    prisma.customer.count({ where: mqlWhere }),
    prisma.customer.count({ where: { tenant_id: tenantId, is_mql: true } }),
    prisma.reservation.count({ where: approvedWhere }),
    prisma.reservation.count({ where: { tenant_id: tenantId, purchase_review_status: 'approved' } }),
    prisma.reservation.count({ where: { tenant_id: tenantId, purchase_review_status: 'pending' } }),
    prisma.reservation.count({ where: { tenant_id: tenantId, purchase_review_status: 'ignored_outlier' } }),
  ]);
  return {
    clicks,
    matched,
    mqlCount,
    mqlAllCount,
    approvedCount,
    approvedAllCount,
    pendingCount,
    rejectedCount,
  };
}

/**
 * Ringkasan LandingPageView untuk panel atribusi.
 *
 * `landingPageView` diakses lewat `any` + guard `typeof` karena DB live lama bisa
 * belum punya model/kolom `source`; kegagalan per-query tidak boleh menggagalkan
 * seluruh ringkasan (perilaku lama dipertahankan).
 */
export async function getPageViewSummary(
  pageViewWhere: any
): Promise<{ views: number; bySourceRows: any[] | null }> {
  const lpv: any = (prisma as any).landingPageView;
  const [views, bySourceRows] = await Promise.all([
    lpv.count({ where: pageViewWhere }).catch(() => 0),
    typeof lpv?.groupBy === 'function'
      ? lpv
          .groupBy({
            by: ['source'],
            where: pageViewWhere,
            _count: { _all: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  return { views, bySourceRows };
}

/** Data tenant untuk panel kesehatan CAPI. `null` bila DB gagal/kosong. */
export async function getTenantForCapiHealth(tenantId: string): Promise<any | null> {
  try {
    return await prisma.tenant.findUnique({ where: { id: tenantId } });
  } catch {
    return null;
  }
}

/**
 * Cari customer untuk pengiriman event CAPI manual berdasarkan 9 digit terakhir
 * nomor. `include.adClick` dibutuhkan untuk atribusi event.
 */
export async function findCustomerByPhoneSuffix(
  cleanPhone: string,
  tenantId: string | null | undefined
): Promise<any | null> {
  return prisma.customer.findFirst({
    where: {
      phone: { contains: cleanPhone.slice(-9) },
      ...(tenantId ? { tenant_id: tenantId } : {}),
    },
    include: { adClick: true },
  });
}

export interface ManualSendHistory {
  logs: any[];
  customers: any[];
  reservations: any[];
}

/** Riwayat 30 pengiriman event manual terakhir + entitas target untuk resolusi nama/HP. */
export async function getManualSendHistory(
  tenantId: string | null | undefined,
  limit = 30
): Promise<ManualSendHistory> {
  const logs = await prisma.auditLog.findMany({
    where: {
      tenant_id: tenantId as any,
      action: { in: ['MANUAL_SEND_META_EVENT', 'TEST_SEND_CAPI_EVENT', 'APPROVE_PURCHASE_EVENT'] },
    },
    orderBy: { created_at: 'desc' },
    take: limit,
  });

  const targetIds = logs.map((l: any) => l.target_id).filter(Boolean);
  const [customers, reservations] = await Promise.all([
    prisma.customer.findMany({
      where: { id: { in: targetIds } },
      include: { adClick: true },
    }),
    prisma.reservation.findMany({
      where: { id: { in: targetIds } },
      include: { customer: { include: { adClick: true } } },
    }),
  ]);

  return { logs, customers, reservations };
}
