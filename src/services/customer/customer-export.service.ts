import { prisma } from '../../db/client';
import { responseCacheService } from '../response-cache.service';
import { staffOwnershipService, StaffOwnershipView } from '../staff-ownership.service';
import { resolveLocationSource } from '../staff-reservation.service';
import { memoryCustomers } from './shared';

/**
 * Mengambil daftar customer dengan perhitungan LTV dan tracking code adClick
 */
export async function listCustomersWithLtvAndAdClick(
  tenantId: string,
  options?: {
    search?: string;
    page?: number;
    pageSize?: number;
    mqlOnly?: boolean;
    segment?: 'all' | 'purchased' | 'mql' | 'prospect';
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }
): Promise<{
  customers: Array<{
    id: string;
    phone: string;
    name: string | null;
    status: string;
    isMql: boolean;
    mqlBubbleCount: number;
    mqlTriggeredAt: Date | null;
    trackingCode: string;
    adClick: any;
    ltv: number;
    reservationCount: number;
    createdAt: Date;
    updatedAt: Date;
    aiOverride: string | null;
    isAdminLabeled: boolean;
    isHoldLabeled: boolean;
    kecamatan: string | null;
    kota: string | null;
    kelurahan: string | null;
    distanceKm: number | null;
    ongkir: number | null;
    staffOwnership?: StaffOwnershipView | null;
    location_source?: any;
    effective_location_source?: any;
    location_source_label?: string | null;
  }>;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  stats?: {
    totalCustomers: number;
    totalPurchasers: number;
    totalMql: number;
    totalProspects: number;
    totalRevenue: number;
  };
}> {
  const page = Math.max(1, options?.page || 1);
  const pageSize = Math.max(1, Math.min(100, options?.pageSize || 20));
  const search = options?.search?.trim();
  const mqlOnly = options?.mqlOnly;
  const segment = options?.segment || 'all';
  const sortBy = options?.sortBy || 'created_at';
  const sortOrder: 'asc' | 'desc' = options?.sortOrder === 'asc' ? 'asc' : 'desc';

  try {
    const where: any = { tenant_id: tenantId, is_sandbox_test: false, deleted_at: null };
    if (mqlOnly || segment === 'mql') {
      where.is_mql = true;
    }
    if (segment === 'purchased') {
      where.reservations = { some: { status: { notIn: ['cancelled', 'rejected'] } } };
    } else if (segment === 'prospect') {
      where.reservations = { none: { status: { notIn: ['cancelled', 'rejected'] } } };
    }
    if (search) {
      const rawSearch = String(search || '').trim();
      const digitsOnly = rawSearch.replace(/[^0-9]/g, '');
      let normalized = digitsOnly;
      if (normalized.startsWith('0')) normalized = '62' + normalized.slice(1);
      else if (normalized.startsWith('8')) normalized = '62' + normalized;
      const phoneVariants: any[] = [{ phone: { contains: rawSearch } }];
      if (normalized && normalized !== rawSearch) phoneVariants.push({ phone: { contains: normalized } });
      if (digitsOnly && digitsOnly !== rawSearch && digitsOnly !== normalized) phoneVariants.push({ phone: { contains: digitsOnly } });
      const isShortQuery = rawSearch.length < 4;
      where.OR = isShortQuery
        ? [
            { name: { contains: rawSearch, mode: 'insensitive' } },
            ...phoneVariants,
            { adClick: { trackingCode: { contains: rawSearch, mode: 'insensitive' } } },
          ]
        : [
            { name: { contains: rawSearch, mode: 'insensitive' } },
            ...phoneVariants,
            { kecamatan: { contains: rawSearch, mode: 'insensitive' } },
            { kota: { contains: rawSearch, mode: 'insensitive' } },
            { kelurahan: { contains: rawSearch, mode: 'insensitive' } },
            { adClick: { trackingCode: { contains: rawSearch, mode: 'insensitive' } } },
          ];
    }

    let orderBy: any = { created_at: sortOrder };
    if (sortBy === 'name') orderBy = { name: sortOrder };
    else if (sortBy === 'phone') orderBy = { phone: sortOrder };
    else if (sortBy === 'kecamatan') orderBy = { kecamatan: sortOrder };
    else if (sortBy === 'kota') orderBy = { kota: sortOrder };
    else if (sortBy === 'mqlBubbleCount') orderBy = { mql_bubble_count: sortOrder };
    else if (sortBy === 'created_at') orderBy = { created_at: sortOrder };
    else if (sortBy === 'ltv') orderBy = { ltv_cache: sortOrder };
    else if (sortBy === 'reservations' || sortBy === 'reservationCount') {
      orderBy = { reservations: { _count: sortOrder } };
    }

    const isLtvSort = sortBy === 'ltv';

    const t0 = Date.now();
    const [rawCustomers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        include: {
          adClick: true,
          reservations: {
            where: { status: { notIn: ['cancelled', 'rejected'] } },
          },
        },
        orderBy: isLtvSort ? { ltv_cache: sortOrder } : orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.customer.count({ where }),
    ]);
    const findManyMs = Date.now() - t0;

    const cacheKeyStats = `customers:stats:${tenantId}`;
    let stats = responseCacheService.get<any>(cacheKeyStats);

    if (!stats) {
      try {
        const [totalCustomersCount, totalPurchasersCount, totalMqlCount, totalRevAgg] = await Promise.all([
          prisma.customer.count({ where: { tenant_id: tenantId, is_sandbox_test: false } }),
          prisma.customer.count({
            where: { tenant_id: tenantId, is_sandbox_test: false, reservations: { some: { status: { notIn: ['cancelled', 'rejected'] } } } },
          }),
          prisma.customer.count({
            where: { tenant_id: tenantId, is_sandbox_test: false, is_mql: true },
          }),
          prisma.reservation.aggregate({
            where: { tenant_id: tenantId, status: { notIn: ['cancelled', 'rejected'] }, customer: { is_sandbox_test: false } },
            _sum: { purchase_value: true },
          }),
        ]);
        stats = {
          totalCustomers: totalCustomersCount,
          totalPurchasers: totalPurchasersCount,
          totalMql: totalMqlCount,
          totalProspects: Math.max(0, totalCustomersCount - totalPurchasersCount),
          totalRevenue: totalRevAgg?._sum?.purchase_value || 0,
        };
        responseCacheService.set(cacheKeyStats, stats, 15);
      } catch {
        stats = {
          totalCustomers: total,
          totalPurchasers: 0,
          totalMql: 0,
          totalProspects: total,
          totalRevenue: 0,
        };
      }
    }

    const { resolveTreatmentValue } = await import('../capi.service');

    const tResolve = Date.now();
    const uniqueTexts = new Set<string>();
    for (const c of rawCustomers) {
      if (c.reservations) {
        for (const r of c.reservations) {
          if ((r.purchase_value === null || r.purchase_value === undefined || r.purchase_value === 0) && (r.treatment_detail || r.raw_text)) {
            uniqueTexts.add((r.treatment_detail || r.raw_text) as string);
          }
        }
      }
    }
    const treatmentMemoMap = new Map<string, number>();
    if (uniqueTexts.size > 0) {
      const textArr = Array.from(uniqueTexts);
      const results = await Promise.all(textArr.map(async (t) => [t, (await resolveTreatmentValue(t, tenantId)) ?? 0] as const));
      for (const [t, v] of results) treatmentMemoMap.set(t, v);
    }
    const resolveMs = Date.now() - tResolve;

    const ownershipMap = await staffOwnershipService.getByCustomerIds(
      tenantId,
      rawCustomers.map((c) => c.id)
    );

    const customers = rawCustomers.map((c) => {
      let ltv = 0;
      if (c.reservations && c.reservations.length > 0) {
        for (const r of c.reservations) {
          let val = r.purchase_value;
          if (val === null || val === undefined || val === 0) {
            if (r.status === 'hold' || (r.treatment_detail && r.treatment_detail.startsWith('[HOLD]'))) {
              val = 0;
            } else {
              const text = r.treatment_detail || r.raw_text;
              if (text) {
                val = treatmentMemoMap.get(text) ?? 0;
              } else {
                val = 0;
              }
            }
          }
          ltv += val;
        }
      }

      const trackingCode = c.adClick?.trackingCode || `TC-${c.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

      return {
        id: c.id,
        phone: c.phone,
        name: c.name || null,
        status: c.status,
        isMql: c.is_mql,
        mqlBubbleCount: c.mql_bubble_count || 0,
        mqlTriggeredAt: c.mql_triggered_at || null,
        trackingCode,
        adClick: c.adClick || null,
        ltv,
        reservationCount: c.reservations.length,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        aiOverride: c.ai_override || null,
        isAdminLabeled: !!c.is_admin_labeled,
        isHoldLabeled: !!c.is_hold_labeled,
        kecamatan: c.kecamatan || c.pending_kecamatan || null,
        kota: c.kota || c.pending_kota || null,
        kelurahan: c.kelurahan || c.pending_kelurahan || null,
        distanceKm: c.distance_km ?? null,
        ongkir: c.ongkir ?? null,
        staffOwnership: ownershipMap.get(c.id) ?? null,
        location_source: c.location_source || null,
        effective_location_source: resolveLocationSource(c),
        location_source_label: (c.preferences as any)?.location_source_label || null,
      };
    });

    const elapsed = Date.now() - t0;
    console.log(JSON.stringify({ route: 'listCustomers', elapsed, findManyMs, resolveMs, page, sortBy, total, customersReturned: customers.length }));
    if (elapsed > 500) {
      console.warn(JSON.stringify({ route: 'listCustomers', elapsed, slow: true, findManyMs, resolveMs }));
    }

    return {
      customers,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      stats,
    };
  } catch (error) {
    let list = Array.from(memoryCustomers.values()).filter((c) => c.tenant_id === tenantId);
    if (search) {
      list = list.filter((c) => (c.name || '').includes(search) || (c.phone || '').includes(search));
    }
    if (mqlOnly) {
      list = list.filter((c) => !!c.is_mql);
    }

    if (sortBy === 'name') {
      list.sort((a, b) => (sortOrder === 'asc' ? (a.name || '').localeCompare(b.name || '') : (b.name || '').localeCompare(a.name || '')));
    } else if (sortBy === 'phone') {
      list.sort((a, b) => (sortOrder === 'asc' ? (a.phone || '').localeCompare(b.phone || '') : (b.phone || '').localeCompare(a.phone || '')));
    }

    return {
      customers: list.slice((page - 1) * pageSize, page * pageSize).map((c) => ({
        id: c.id,
        phone: c.phone,
        name: c.name || null,
        status: c.status || 'active',
        isMql: !!c.is_mql,
        mqlBubbleCount: c.mql_bubble_count || 0,
        mqlTriggeredAt: c.mql_triggered_at || null,
        trackingCode: `TC-${c.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
        adClick: null,
        ltv: 0,
        reservationCount: 0,
        createdAt: c.created_at || new Date(),
        updatedAt: c.updated_at || new Date(),
        aiOverride: c.ai_override || null,
        isAdminLabeled: !!c.is_admin_labeled,
        isHoldLabeled: !!c.is_hold_labeled,
        kecamatan: c.kecamatan || c.pending_kecamatan || null,
        kota: c.kota || c.pending_kota || null,
        kelurahan: c.kelurahan || c.pending_kelurahan || null,
        distanceKm: c.distance_km ?? null,
        ongkir: c.ongkir ?? null,
      })),
      total: list.length,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(list.length / pageSize)),
    };
  }
}
