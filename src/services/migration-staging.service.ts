import { prisma } from '../db/client';

/**
 * migration-staging.service.ts — Akses data staging migrasi/FAQ (tenant-scoped).
 *
 * Dipindah dari `routes/admin/migration.subroute.ts` agar route hanya mengurus
 * HTTP (parsing query, audit, reply) dan tidak lagi memegang query Prisma.
 * Seluruh query WAJIB memfilter `tenant_id` milik pemanggil.
 */

export type LegacyStagingStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMMITTED';
export type FaqStagingKind = 'medical' | 'general';

const LEGACY_SORT_FIELDS = [
  'leadCreatedAt',
  'firstPurchaseAt',
  'name',
  'phoneNumber',
  'rawMessagesCount',
  'createdAt',
  'updatedAt',
];

export interface LegacyStagingListParams {
  tenantId: string;
  status?: string;
  page?: number;
  limit?: number;
  hasReservation?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
}

export interface LegacyStagingListResult {
  items: any[];
  total: number;
  page: number;
  limit: number;
  statusCounts: {
    PENDING: number;
    APPROVED: number;
    COMMITTED: number;
    REJECTED: number;
    PENDING_WITH_RESERVATION: number;
  };
  localStats: { conversationCount: number; messageCount: number };
}

/** Daftar staging migrasi + agregat status + LTV customer (satu round-trip paralel). */
export async function listLegacyStaging(params: LegacyStagingListParams): Promise<LegacyStagingListResult> {
  const { tenantId, status = 'PENDING', hasReservation, sortBy = 'leadCreatedAt', sortOrder = 'desc', search } = params;
  const pageNum = Math.max(1, params.page ?? 1);
  const limitNum = Math.min(200, Math.max(1, params.limit ?? 20));
  const orderDir: 'asc' | 'desc' = sortOrder === 'asc' ? 'asc' : 'desc';

  const where: any = { tenantId, status: status as any };
  if (hasReservation === 'true') {
    where.firstPurchaseAt = { not: null };
  } else if (hasReservation === 'false') {
    where.firstPurchaseAt = null;
  }

  if (search && search.trim()) {
    const q = search.trim();
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { phoneNumber: { contains: q } },
      { extractedLocation: { contains: q, mode: 'insensitive' } },
    ];
  }

  let orderBy: any = { leadCreatedAt: 'desc' };
  if (sortBy && LEGACY_SORT_FIELDS.includes(sortBy)) {
    orderBy = { [sortBy]: orderDir };
  }
  const isLtvSort = sortBy === 'ltv';

  const [
    rawItems,
    total,
    pendingCount,
    approvedCount,
    committedCount,
    rejectedCount,
    pendingWithResCount,
    localConversationCount,
    localMessageCount,
  ] = await Promise.all([
    prisma.legacyStaging.findMany({
      where,
      orderBy: isLtvSort ? { leadCreatedAt: 'desc' } : orderBy,
      skip: isLtvSort ? 0 : (pageNum - 1) * limitNum,
      take: isLtvSort ? Math.min(1000, limitNum * 20) : limitNum,
    }),
    prisma.legacyStaging.count({ where }),
    prisma.legacyStaging.count({ where: { tenantId, status: 'PENDING' } }),
    prisma.legacyStaging.count({ where: { tenantId, status: 'APPROVED' } }),
    prisma.legacyStaging.count({ where: { tenantId, status: 'COMMITTED' } }),
    prisma.legacyStaging.count({ where: { tenantId, status: 'REJECTED' } }),
    prisma.legacyStaging.count({
      where: { tenantId, status: 'PENDING', firstPurchaseAt: { not: null } },
    }),
    prisma.conversation.count({ where: { tenant_id: tenantId } }),
    prisma.message.count({ where: { tenant_id: tenantId } }),
  ]);

  // LTV real dari Customer (tenant-scoped: nomor sama di tenant lain tidak boleh bocor).
  const phones = rawItems.map((i) => i.phoneNumber);
  const ltvMap = new Map<string, number>();
  try {
    const customersWithLtv = await prisma.customer.findMany({
      where: { phone: { in: phones }, tenant_id: tenantId },
      select: {
        phone: true,
        reservations: {
          where: { status: { in: ['confirmed', 'completed'] } },
          select: { purchase_value: true },
        },
      },
    });
    for (const c of customersWithLtv) {
      const sum = c.reservations.reduce((acc, r) => acc + (r.purchase_value || 0), 0);
      ltvMap.set(c.phone, sum);
    }
  } catch (_) {}

  let enrichedItems = rawItems.map((item) => {
    const json: any = item.extractedReservationJson;
    const ltv = ltvMap.get(item.phoneNumber) ?? json?.payment?.totalPrice ?? (item.firstPurchaseAt ? 70000 : 0);
    return { ...item, ltv };
  });

  if (isLtvSort) {
    enrichedItems.sort((a, b) => (orderDir === 'asc' ? a.ltv - b.ltv : b.ltv - a.ltv));
    enrichedItems = enrichedItems.slice((pageNum - 1) * limitNum, pageNum * limitNum);
  }

  return {
    items: enrichedItems,
    total,
    page: pageNum,
    limit: limitNum,
    statusCounts: {
      PENDING: pendingCount,
      APPROVED: approvedCount,
      COMMITTED: committedCount,
      REJECTED: rejectedCount,
      PENDING_WITH_RESERVATION: pendingWithResCount,
    },
    localStats: { conversationCount: localConversationCount, messageCount: localMessageCount },
  };
}

export async function listLegacyStagingByStatus(tenantId: string, status: string): Promise<any[]> {
  return prisma.legacyStaging.findMany({
    where: { tenantId, status: status as any },
    orderBy: { leadCreatedAt: 'desc' },
  });
}

export async function updateLegacyStagingStatus(id: string, status: string): Promise<any> {
  return prisma.legacyStaging.update({
    where: { id },
    data: { status: status as any },
  });
}

export async function bulkApproveStagingPurchases(tenantId: string): Promise<number> {
  const updated = await prisma.legacyStaging.updateMany({
    where: { tenantId, status: 'PENDING', firstPurchaseAt: { not: null } },
    data: { status: 'APPROVED' },
  });
  return updated.count;
}

export async function countTenantConversations(tenantId: string): Promise<number> {
  return prisma.conversation.count({ where: { tenant_id: tenantId } });
}

export async function clearPendingFaqStaging(
  tenantId: string
): Promise<{ medicalCleared: number; generalCleared: number }> {
  const medRes = await prisma.medicalFaqStaging.deleteMany({ where: { tenant_id: tenantId, status: 'PENDING' } });
  const genRes = await prisma.generalFaqStaging.deleteMany({ where: { tenant_id: tenantId, status: 'PENDING' } });
  return { medicalCleared: medRes.count, generalCleared: genRes.count };
}

export async function deleteAllFaqStaging(tenantId: string): Promise<{ medicalDeleted: number; generalDeleted: number }> {
  const medRes = await prisma.medicalFaqStaging.deleteMany({ where: { tenant_id: tenantId } });
  const genRes = await prisma.generalFaqStaging.deleteMany({ where: { tenant_id: tenantId } });
  return { medicalDeleted: medRes.count, generalDeleted: genRes.count };
}

async function listFaqStagingByModel(
  model: { findMany: Function; count: Function },
  tenantId: string,
  status: string,
  pageNum: number,
  limitNum: number
): Promise<{ items: any[]; total: number }> {
  const where: any = { tenant_id: tenantId, status };
  const [items, total] = await Promise.all([
    model.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
    }),
    model.count({ where }),
  ]) as [any[], number];

  // Batch lookup chunk terlampir: 1 query untuk semua matched_chunk_id (anti N+1).
  const chunkIds = Array.from(
    new Set(items.filter((i) => i.matched_chunk_id).map((i) => i.matched_chunk_id as string))
  );
  const chunks = chunkIds.length
    ? await prisma.knowledgeChunk.findMany({ where: { id: { in: chunkIds } } })
    : [];
  const chunkMap = new Map(chunks.map((c) => [c.id, c]));

  const itemsWithChunks = items.map((item) =>
    item.matched_chunk_id ? { ...item, matchedChunk: chunkMap.get(item.matched_chunk_id) ?? null } : item
  );
  return { items: itemsWithChunks, total };
}

export async function listFaqStaging(
  kind: FaqStagingKind,
  params: { tenantId: string; status?: string; page?: number; limit?: number }
): Promise<{ items: any[]; total: number; page: number; limit: number }> {
  const pageNum = Math.max(1, params.page ?? 1);
  const limitNum = Math.min(200, Math.max(1, params.limit ?? 50));
  const status = params.status ?? 'PENDING';
  const model = kind === 'medical' ? prisma.medicalFaqStaging : prisma.generalFaqStaging;
  const { items, total } = await listFaqStagingByModel(model as any, params.tenantId, status, pageNum, limitNum);
  return { items, total, page: pageNum, limit: limitNum };
}

export async function reviewMedicalFaqStaging(id: string, data: Record<string, unknown>): Promise<any> {
  return prisma.medicalFaqStaging.update({ where: { id }, data: data as any });
}

export async function reviewGeneralFaqStaging(id: string, data: Record<string, unknown>): Promise<any> {
  return prisma.generalFaqStaging.update({ where: { id }, data: data as any });
}
