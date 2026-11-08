import { prisma } from '../../db/client';
import { responseCacheService } from '../response-cache.service';
import { resolveTreatmentValue } from '../capi.service';
import { resolveDeliveryFeeSnapshot } from '../reservation-core.service';
import { computeFunnelMetrics } from '../ad-funnel-metrics.service';
import { buildMonthlyCohorts } from './monthly-cohorts';
import {
  MetaPerformanceQueryOptions,
  MetaPerformanceQuerySchema,
  MetaPerformanceReport,
  META_BOT_EXCLUDE_CLAUSE,
  SANDBOX_EXCLUDE,
  EXCLUDED_REVENUE_STATUSES,
  MAX_ROWS,
  MS_PER_DAY,
  CACHE_TTL_SECONDS,
  WIB_OFFSET_MS,
  wibTodayStr,
  wibDayStart,
  wibDayEnd,
  wibDateKey,
  sanitizeUtmCampaign,
  sanitizeUtmSource,
  isQualifyingStatus,
  isSandboxed,
  capacityBandFor,
  mean,
  median,
  round2,
  JOURNEY_BRACKETS,
  LEADTIME_BRACKETS,
  NO_DATE_KEY,
} from './types';

export async function getMetaPerformanceReport(
  options: MetaPerformanceQueryOptions,
): Promise<MetaPerformanceReport> {
  const q = MetaPerformanceQuerySchema.parse(options);
  const tenantId = q.tenantId;

  const endStr = q.endDate || wibTodayStr();
  const startStr = q.startDate || new Date(wibDayStart(endStr).getTime() - 29 * MS_PER_DAY + WIB_OFFSET_MS).toISOString().slice(0, 10);
  const start = wibDayStart(startStr);
  const end = wibDayEnd(endStr);

  const cacheKey = `meta-perf:${tenantId}:${startStr}:${endStr}:${q.adSpend ?? 'na'}`;
  const cached = responseCacheService.get<MetaPerformanceReport>(cacheKey);
  if (cached) return cached;

  const errors: string[] = [];
  let truncated = false;

  const safeArr = async <T>(label: string, p: Promise<T[]> | null): Promise<T[]> => {
    if (!p) return [];
    try {
      return await p;
    } catch (e: any) {
      errors.push(`${label}: ${String(e?.message || e).slice(0, 120)}`);
      return [];
    }
  };

  const pvModel = (prisma as any).landingPageView;
  const convoModel = (prisma as any).conversation;
  const followUpModel = (prisma as any).followUp;

  const baseWhere = { tenant_id: tenantId, ...META_BOT_EXCLUDE_CLAUSE };

  const dateWhere = { createdAt: { gte: start, lte: end } };

  const [rangeClicks, matchedAds, rangeReservations, historyReservations, convoRows, followUpRows, cohortCustomers] =
    await Promise.all([
      safeArr(
        'adClick',
        prisma.adClick.findMany({
          where: { ...baseWhere, ...dateWhere },
          select: { customerId: true, matchedAt: true, utmCampaign: true, utmSource: true, utmMedium: true, ctwa_clid: true, createdAt: true },
          take: MAX_ROWS,
        }) as unknown as Promise<any[]>,
      ),
      safeArr(
        'adClick(matched)',
        prisma.adClick.findMany({
          where: { ...baseWhere, matchedAt: { not: null } },
          select: { customerId: true, matchedAt: true, utmCampaign: true, utmSource: true, utmMedium: true, ctwa_clid: true, createdAt: true, customer: { select: { id: true, created_at: true, is_mql: true, kecamatan: true, kota: true, is_out_of_coverage: true } } },
          take: MAX_ROWS,
        }) as unknown as Promise<any[]>,
      ),
      safeArr(
        'reservation(range)',
        prisma.reservation.findMany({
          where: { tenant_id: tenantId, created_at: { gte: start, lte: end } },
          select: {
            id: true, customer_id: true, created_at: true, booking_date: true, status: true, purchase_value: true,
            treatment_detail: true, treatment_category: true, delivery_fee: true, assigned_staff_id: true,
            customer: { select: { id: true, phone: true, created_at: true, ongkir: true, is_mql: true, mql_triggered_at: true, is_sandbox_test: true, is_internal_staff: true, kecamatan: true, kota: true, is_out_of_coverage: true } },
          },
          orderBy: { created_at: 'asc' },
          take: MAX_ROWS + 1,
        }) as unknown as Promise<any[]>,
      ),
      safeArr(
        'reservation(history)',
        prisma.reservation.findMany({
          where: { tenant_id: tenantId },
          select: {
            id: true, customer_id: true, created_at: true, booking_date: true, status: true, purchase_value: true, treatment_detail: true,
            treatment_category: true, delivery_fee: true,
            customer: { select: { id: true, phone: true, created_at: true, ongkir: true, is_sandbox_test: true, is_internal_staff: true } },
          },
          orderBy: { created_at: 'asc' },
          take: MAX_ROWS + 1,
        }) as unknown as Promise<any[]>,
      ),
      safeArr(
        'conversation',
        convoModel && typeof convoModel.findMany === 'function'
          ? (convoModel.findMany({
              where: { tenant_id: tenantId },
              select: { customer_id: true, current_state: true, is_human_handling: true },
              take: MAX_ROWS + 1,
            }) as Promise<any[]>)
          : null,
      ),
      safeArr(
        'followUp',
        followUpModel && typeof followUpModel.findMany === 'function'
          ? (followUpModel.findMany({
              where: { tenant_id: tenantId, type: 'NO_PURCHASE' },
              select: { customer_id: true, status: true },
              take: MAX_ROWS + 1,
            }) as Promise<any[]>)
          : null,
      ),
      safeArr(
        'customer(cohort)',
        prisma.customer.findMany({
          where: { tenant_id: tenantId, ...SANDBOX_EXCLUDE, adClick: { isNot: null } },
          select: { id: true, created_at: true, is_mql: true, mql_triggered_at: true, kecamatan: true, kota: true, is_out_of_coverage: true },
          take: MAX_ROWS + 1,
        }) as unknown as Promise<any[]>,
      ),
    ]);

  if (rangeReservations.length > MAX_ROWS || matchedAds.length > MAX_ROWS || historyReservations.length > MAX_ROWS) {
    truncated = true;
  }
  if (rangeReservations.length > MAX_ROWS) rangeReservations.length = MAX_ROWS;
  if (historyReservations.length > MAX_ROWS) historyReservations.length = MAX_ROWS;
  if (matchedAds.length > MAX_ROWS) matchedAds.length = MAX_ROWS;

  const dbNote = errors.length ? `Sebagian query gagal: ${errors.slice(0, 3).join(' | ')}` : undefined;

  let tenantSettings: any = {};
  try {
    const t = await (prisma.tenant as any).findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    tenantSettings = (t?.settings as any)?.metaPerformanceSettings || {};
  } catch {
    tenantSettings = {};
  }

  // ── Kanal & kohort iklan ──────────────────────────────────────────────────
  const channelOf = (a: any): 'CTWA_NATIVE' | 'CTWA_FUZZY' | 'PROMO_CTA' =>
    a?.ctwa_clid ? 'CTWA_NATIVE' : a?.utmMedium === 'ctwa_fuzzy' ? 'CTWA_FUZZY' : 'PROMO_CTA';
  const cohortCustomerIds = new Set<string>();
  const firstTouchByCustomer = new Map<string, number>();
  for (const a of matchedAds) {
    if (!a.customerId) continue;
    cohortCustomerIds.add(a.customerId);
    const t = a.matchedAt ? new Date(a.matchedAt).getTime() : (a.customer?.created_at ? new Date(a.customer.created_at).getTime() : NaN);
    if (Number.isFinite(t)) {
      const prev = firstTouchByCustomer.get(a.customerId);
      if (prev === undefined || t < prev) firstTouchByCustomer.set(a.customerId, t);
    }
  }

  const customerMap = new Map<string, any>();
  for (const c of cohortCustomers) customerMap.set(c.id, c);
  for (const a of matchedAds) {
    if (a.customerId && !customerMap.has(a.customerId)) customerMap.set(a.customerId, a.customer);
  }

  // ── Revenue seam ──────────────────────────────────────────────────────────
  const catalogCache = new Map<string, number>();
  const treatmentFeeOf = async (r: any): Promise<number> => {
    const pv = Number(r?.purchase_value);
    if (Number.isFinite(pv) && pv > 0) return pv;
    const detail = r?.treatment_detail;
    if (!detail) return 0;
    const key = String(detail);
    if (catalogCache.has(key)) return catalogCache.get(key) || 0;
    let resolved = 0;
    try {
      const v = await resolveTreatmentValue(detail, tenantId);
      resolved = v && v > 0 ? v : 0;
    } catch {
      resolved = 0;
    }
    catalogCache.set(key, resolved);
    return resolved;
  };
  const totalFeeOf = (r: any, treatmentFee: number): number => treatmentFee + resolveDeliveryFeeSnapshot(r);

  const isQualifying = (r: any): boolean => isQualifyingStatus(r?.status) && !isSandboxed(r?.customer);

  // First-ever qualifying reservation per cohort customer.
  const firstEverByCustomer = new Map<string, any>();
  for (const r of historyReservations) {
    if (!r.customer_id || !cohortCustomerIds.has(r.customer_id)) continue;
    if (!isQualifying(r)) continue;
    if (!firstEverByCustomer.has(r.customer_id)) firstEverByCustomer.set(r.customer_id, r);
  }

  // ── Funnel (Seam kanonik ad-funnel-metrics.service.ts) ──────────────────────
  const funnelMetrics = await computeFunnelMetrics(
    tenantId,
    { start, end },
    {
      provider: {
        countViews: async () => (pvModel && typeof pvModel.count === 'function' ? (pvModel.count({ where: { ...baseWhere, ...dateWhere } }) as Promise<number>).catch(() => 0) : 0),
        listPaidClicks: async () => rangeClicks,
      },
    }
  );

  const totalClicks = funnelMetrics ? funnelMetrics.uniquePaidClicks : rangeClicks.length;
  const matchedChats = funnelMetrics ? funnelMetrics.matchedChats : rangeClicks.filter((a) => a.matchedAt).length;
  const unmatchedDrain = Math.max(0, totalClicks - matchedChats);
  const pageViews = funnelMetrics ? funnelMetrics.paidViews : 0;

  // Pelanggan aktif pada rentang tanggal ini (chat matched atau konversi first-ever)
  const rangeMatchedCustomerIds = new Set<string>();
  for (const a of rangeClicks) {
    if (a.customerId) {
      rangeMatchedCustomerIds.add(a.customerId);
    }
  }
  for (const [cid, firstEver] of firstEverByCustomer.entries()) {
    const t = new Date(firstEver.created_at).getTime();
    if (t >= start.getTime() && t <= end.getTime()) {
      rangeMatchedCustomerIds.add(cid);
    }
  }

  const isMqlInPeriod = (c: any): boolean => {
    if (!c?.is_mql) return false;
    if (c.mql_triggered_at) {
      const mt = new Date(c.mql_triggered_at).getTime();
      if (mt >= start.getTime() && mt <= end.getTime()) return true;
    }
    return rangeMatchedCustomerIds.has(c.id);
  };

  const mqlCohort = cohortCustomers.filter((c) => isMqlInPeriod(c));
  const mqlLeads = mqlCohort.length;

  // ── KPI CAC / LTV ─────────────────────────────────────────────────────────
  let initialRevenue = 0;
  let newCustomers = 0;
  let totalClinicRevenue = 0;
  const journeyDaysList: number[] = [];
  const channelAgg = new Map<string, { leads: Set<string>; mql: number; buyers: number; initialRevenue: number; journey: number[] }>();
  const campaignAgg = new Map<string, { source: string | null; clicks: number; chats: number }>();

  for (const a of rangeClicks) {
    const key = sanitizeUtmCampaign(a.utmCampaign);
    const src = sanitizeUtmSource(a.utmSource) ?? sanitizeUtmSource(a.utmMedium);
    const entry = campaignAgg.get(key) || { source: src, clicks: 0, chats: 0 };
    entry.clicks += 1;
    if (a.matchedAt) entry.chats += 1;
    campaignAgg.set(key, entry);
  }

  // Earliest matched ad per customer → atribusi kanal & campaign deterministik.
  const earliestAdByCustomer = new Map<string, any>();
  for (const a of matchedAds) {
    if (!a.customerId) continue;
    const t = new Date(a.matchedAt || a.createdAt).getTime();
    const prev = earliestAdByCustomer.get(a.customerId);
    if (!prev || t < new Date(prev.matchedAt || prev.createdAt).getTime()) earliestAdByCustomer.set(a.customerId, a);
  }

  const campaignDetail = new Map<string, { mql: number; buyers: number; initialRevenue: number }>();

  for (const customerId of rangeMatchedCustomerIds) {
    const ad = earliestAdByCustomer.get(customerId);
    const ch = ad ? channelOf(ad) : 'PROMO_CTA';
    const camp = sanitizeUtmCampaign(ad?.utmCampaign);
    const cust = customerMap.get(customerId);

    const ce = channelAgg.get(ch) || { leads: new Set<string>(), mql: 0, buyers: 0, initialRevenue: 0, journey: [] as number[] };
    ce.leads.add(customerId);
    if (cust?.is_mql) ce.mql += 1;
    channelAgg.set(ch, ce);

    const cd = campaignDetail.get(camp) || { mql: 0, buyers: 0, initialRevenue: 0 };
    if (cust?.is_mql) cd.mql += 1;

    const firstEver = firstEverByCustomer.get(customerId);
    if (firstEver) {
      const createdAt = new Date(firstEver.created_at).getTime();
      if (createdAt >= start.getTime() && createdAt <= end.getTime()) {
        newCustomers += 1;
        const fee = await treatmentFeeOf(firstEver);
        const total = totalFeeOf(firstEver, fee);
        initialRevenue += total;
        ce.buyers += 1;
        ce.initialRevenue += total;
        cd.buyers += 1;
        cd.initialRevenue += total;
        const touch = firstTouchByCustomer.get(customerId);
        if (touch !== undefined) {
          const jd = Math.max(0, Math.floor((createdAt - touch) / MS_PER_DAY));
          ce.journey.push(jd);
          journeyDaysList.push(jd);
        }
      }
    }
    campaignDetail.set(camp, cd);
  }

  // Repeat revenue: qualifying cohort reservations in range that are NOT the first-ever reservation.
  let repeatRevenue = 0;
  const repeatCustomerSet = new Set<string>();
  const leadTimeBuckets = new Map<string, number>();
  for (const b of LEADTIME_BRACKETS) leadTimeBuckets.set(b.key, 0);
  leadTimeBuckets.set(NO_DATE_KEY.key, 0);

  const treatmentAgg = new Map<string, { category: string; name: string; orders: number; revenue: number }>();
  let leadTimeTotal = 0;

  for (const r of rangeReservations) {
    if (!r.customer_id) continue;
    const qualifies = isQualifying(r);
    const fee = qualifies ? await treatmentFeeOf(r) : 0;
    const total = qualifies ? totalFeeOf(r, fee) : 0;
    if (qualifies) totalClinicRevenue += total;

    const firstEver = firstEverByCustomer.get(r.customer_id);
    const isFirstEverRow = firstEver && firstEver.id === r.id;

    if (qualifies && cohortCustomerIds.has(r.customer_id)) {
      if (!isFirstEverRow) {
        repeatRevenue += total;
        repeatCustomerSet.add(r.customer_id);
      }
      // lead time (all qualifying cohort bookings with date)
      if (r.booking_date) {
        const lt = Math.floor((new Date(r.booking_date).getTime() - new Date(r.created_at).getTime()) / MS_PER_DAY);
        const bucket = LEADTIME_BRACKETS.find((b) => b.test(lt));
        if (bucket) leadTimeBuckets.set(bucket.key, (leadTimeBuckets.get(bucket.key) || 0) + 1);
        leadTimeTotal += 1;
      } else {
        leadTimeBuckets.set(NO_DATE_KEY.key, (leadTimeBuckets.get(NO_DATE_KEY.key) || 0) + 1);
      }
      // treatment preferences
      if (r.treatment_detail) {
        const name = String(r.treatment_detail).split(/\r?\n|,|;/)[0].trim();
        if (name) {
          const key = `${r.treatment_category || 'OTHER'}::${name}`;
          const t = treatmentAgg.get(key) || { category: r.treatment_category || 'OTHER', name, orders: 0, revenue: 0 };
          t.orders += 1;
          t.revenue += total;
          treatmentAgg.set(key, t);
        }
      }
    }
  }

  const initialAov = newCustomers > 0 ? Math.round(initialRevenue / newCustomers) : 0;
  const totalAdRevenue = initialRevenue + repeatRevenue;
  const adRevenueSharePct = totalClinicRevenue > 0 ? round2((totalAdRevenue / totalClinicRevenue) * 100) : 0;
  const adSpend = q.adSpend;
  const kpiSummary = {
    newCustomersAcquired: newCustomers,
    initialRevenue,
    initialAov,
    repeatCustomersCount: repeatCustomerSet.size,
    repeatRevenue,
    totalAdRevenue,
    totalClinicRevenue,
    adRevenueSharePct,
    realCac: adSpend !== undefined && newCustomers > 0 ? Math.round(adSpend / newCustomers) : undefined,
    costPerLead: adSpend !== undefined && matchedChats > 0 ? Math.round(adSpend / matchedChats) : undefined,
    costPerMql: adSpend !== undefined && mqlLeads > 0 ? Math.round(adSpend / mqlLeads) : undefined,
    initialRoas: adSpend !== undefined && adSpend > 0 ? round2(initialRevenue / adSpend) : undefined,
    lifetimeRoas: adSpend !== undefined && adSpend > 0 ? round2(totalAdRevenue / adSpend) : undefined,
  };

  const journeySorted = [...journeyDaysList].sort((a, b) => a - b);
  const journeyBrackets = JOURNEY_BRACKETS.map((b) => {
    const count = journeyDaysList.filter((d) => b.test(d)).length;
    return { key: b.key, label: b.label, count, pct: journeyDaysList.length > 0 ? round2((count / journeyDaysList.length) * 100) : 0 };
  });

  const leadTimeArr = [...LEADTIME_BRACKETS, NO_DATE_KEY].map((b) => {
    const count = leadTimeBuckets.get(b.key) || 0;
    return { key: b.key, label: b.label, count, pct: leadTimeTotal > 0 && b.key !== NO_DATE_KEY.key ? round2((count / leadTimeTotal) * 100) : 0 };
  });

  const channelComparison: MetaPerformanceReport['channelComparison'] = (['CTWA_NATIVE', 'CTWA_FUZZY', 'PROMO_CTA'] as const).map((channel) => {
    const ce = channelAgg.get(channel) || { leads: new Set<string>(), mql: 0, buyers: 0, initialRevenue: 0, journey: [] as number[] };
    return {
      channel,
      leads: ce.leads.size,
      mql: ce.mql,
      firstTimeBuyers: ce.buyers,
      initialRevenue: ce.initialRevenue,
      aov: ce.buyers > 0 ? Math.round(ce.initialRevenue / ce.buyers) : 0,
      meanJourneyDays: mean(ce.journey),
    };
  });

  const allCampaigns = new Set<string>([...campaignAgg.keys(), ...campaignDetail.keys()]);
  const campaignBreakdown = Array.from(allCampaigns)
    .map((utmCampaign) => {
      const v = campaignAgg.get(utmCampaign) || { source: null as string | null, clicks: 0, chats: 0 };
      const cd = campaignDetail.get(utmCampaign) || { mql: 0, buyers: 0, initialRevenue: 0 };
      return {
        utmCampaign,
        source: v.source,
        clicks: v.clicks,
        chats: v.chats,
        mql: cd.mql,
        buyers: cd.buyers,
        initialRevenue: cd.initialRevenue,
        status: (v.chats > 0 ? 'MATCHED' : 'PENDING') as 'MATCHED' | 'PENDING',
      };
    })
    .sort((a, b) => b.clicks - a.clicks || b.buyers - a.buyers);

  const treatmentPreferences = Array.from(treatmentAgg.values()).sort((a, b) => b.orders - a.orders).slice(0, 10);

  // ── Leakage diagnostics ───────────────────────────────────────────────────
  const closingCustomerIds = new Set<string>();
  for (const r of rangeReservations) {
    if (r.customer_id && isQualifying(r) && cohortCustomerIds.has(r.customer_id)) closingCustomerIds.add(r.customer_id);
  }
  const stateAgg = new Map<string, number>();
  for (const c of convoRows) {
    if (!c.customer_id || !cohortCustomerIds.has(c.customer_id)) continue;
    if (closingCustomerIds.has(c.customer_id)) continue;
    const label = c.is_human_handling ? `${c.current_state || 'UNKNOWN'} (Human Handling)` : (c.current_state || 'UNKNOWN');
    stateAgg.set(label, (stateAgg.get(label) || 0) + 1);
  }
  const topDropOffStates = Array.from(stateAgg.entries()).map(([state, count]) => ({ state, count })).sort((a, b) => b.count - a.count).slice(0, 5);

  const regionAgg = new Map<string, number>();
  let outOfCoverageCount = 0;
  for (const c of customerMap.values()) {
    if (c?.is_out_of_coverage) outOfCoverageCount += 1;
    const region = c?.kecamatan || c?.kota;
    if (region) regionAgg.set(region, (regionAgg.get(region) || 0) + 1);
  }
  const topRegions = Array.from(regionAgg.entries()).map(([region, count]) => ({ region, count })).sort((a, b) => b.count - a.count).slice(0, 10);

  const followUpByStatus: Record<string, number> = {};
  let followUpSent = 0;
  for (const f of followUpRows) {
    if (!f.customer_id || !cohortCustomerIds.has(f.customer_id)) continue;
    const st = f.status || 'UNKNOWN';
    followUpByStatus[st] = (followUpByStatus[st] || 0) + 1;
    if (st === 'SENT') followUpSent += 1;
  }

  // Skala persen 0-100 (konsisten dengan adRevenueSharePct & fmtPct di dashboard).
  const conversionRates = {
    lpToClick: pageViews > 0 ? round2((totalClicks / pageViews) * 100) : 0,
    clickToChat: totalClicks > 0 ? round2((matchedChats / totalClicks) * 100) : 0,
    chatToMql: matchedChats > 0 ? round2((mqlLeads / matchedChats) * 100) : 0,
    mqlToBuyer: mqlLeads > 0 ? round2((newCustomers / mqlLeads) * 100) : 0,
  };

  // ── Kohort retensi repeat order (window 30/60/90 hari sejak anchor) ────────
  // `returnedN` = null bila jendela belum matang (anchor terlalu dekat dgn `now`)
  // agar UI tidak menampilkan 0% menyesatkan. Return memakai tanggal kalender WIB.
  const nowMs = Date.now();
  const retentionCustomerIds = new Set<string>([...cohortCustomerIds, ...customerMap.keys()]);
  const todayKey = wibDateKey(new Date(nowMs));
  const retentionResByCustomer = new Map<string, any[]>();
  for (const r of [...historyReservations, ...rangeReservations]) {
    if (!r.customer_id || !retentionCustomerIds.has(r.customer_id)) continue;
    const arr = retentionResByCustomer.get(r.customer_id) || [];
    arr.push(r);
    retentionResByCustomer.set(r.customer_id, arr);
  }
  const retentionAgg = new Map<string, { size: number; r30: number; r60: number; r90: number }>();
  for (const [customerId, anchorRow] of firstEverByCustomer) {
    const anchorKey = wibDateKey(new Date(anchorRow.created_at));
    const anchorDayMs = Date.parse(`${anchorKey}T00:00:00Z`);
    const bucket = retentionAgg.get(anchorKey) || { size: 0, r30: 0, r60: 0, r90: 0 };
    bucket.size += 1;
    for (const r of retentionResByCustomer.get(customerId) || []) {
      if (!isQualifying(r)) continue;
      const ordKey = wibDateKey(new Date(r.created_at));
      if (ordKey <= anchorKey) continue; // repeat = SETELAH anchor (WIB)
      const delta = Math.round((Date.parse(`${ordKey}T00:00:00Z`) - anchorDayMs) / MS_PER_DAY);
      if (delta <= 30) bucket.r30 += 1;
      if (delta <= 60) bucket.r60 += 1;
      if (delta <= 90) bucket.r90 += 1;
    }
    retentionAgg.set(anchorKey, bucket);
  }
  const maturity = (window: number) => {
    const cutoff = wibDateKey(new Date(nowMs - window * MS_PER_DAY));
    return { mature: (k: string) => k <= cutoff, todayKey };
  };
  const m30 = maturity(30);
  const m60 = maturity(60);
  const m90 = maturity(90);
  const retentionCohorts = Array.from(retentionAgg.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([cohort, v]) => ({
      cohort,
      size: v.size,
      returned30: m30.mature(cohort) ? v.r30 : null,
      returned60: m60.mature(cohort) ? v.r60 : null,
      returned90: m90.mature(cohort) ? v.r90 : null,
    }));

  const monthlySpends = tenantSettings?.monthlySpends || {};
  const grossMarginPct = typeof tenantSettings?.grossMarginPct === 'number' ? tenantSettings.grossMarginPct : 40;
  const minSampleThreshold = typeof tenantSettings?.minSampleThreshold === 'number' ? tenantSettings.minSampleThreshold : 20;

  const { monthlyCohorts, rolling3MonthCohorts, planning: cohortPlanning } = await buildMonthlyCohorts({
    tenantId,
    historyReservations,
    rangeReservations,
    matchedAds,
    monthlySpends,
    defaultSpend: adSpend,
    grossMarginPct,
    minSampleThreshold,
    now: new Date(),
    treatmentFeeOf,
    cohortStartMonth: typeof tenantSettings?.cohortStartMonth === 'string' ? tenantSettings.cohortStartMonth : null,
    excludedCohortMonths: Array.isArray(tenantSettings?.excludedCohortMonths)
      ? tenantSettings.excludedCohortMonths.filter((m: unknown) => typeof m === 'string')
      : [],
  });

  // ── Kapasitas & utilisasi terapis (DB-driven: jumlah Staff aktif/hari) ─────
  let therapistCapacity: MetaPerformanceReport['therapistCapacity'] = null;
  let activeTherapists: number | null = null;
  try {
    const staffModel = (prisma as any).staff;
    if (staffModel && typeof staffModel.count === 'function') {
      const n = await staffModel.count({ where: { tenant_id: tenantId, active: true } });
      if (typeof n === 'number') activeTherapists = n;
    }
  } catch {
    // Enrichment opsional — DB offline → kapasitas tidak ditampilkan (bukan error kritis).
    activeTherapists = null;
  }
  const rangeDayKeys = new Set<string>();
  for (let t = start.getTime(); t <= end.getTime(); t += MS_PER_DAY) {
    rangeDayKeys.add(wibDateKey(new Date(t)));
  }
  const bookingCount = rangeReservations.filter(
    (r) => isQualifying(r) && r.booking_date && rangeDayKeys.has(wibDateKey(new Date(r.booking_date))),
  ).length;
  if (activeTherapists !== null) {
    const configuredSlots =
      typeof tenantSettings?.dailySlotsPerTherapist === 'number' && tenantSettings.dailySlotsPerTherapist > 0
        ? Math.round(tenantSettings.dailySlotsPerTherapist)
        : null;

    const totalSlotsCapacity =
      configuredSlots === null ? null : activeTherapists * configuredSlots * rangeDayKeys.size;
    const utilizationPct =
      totalSlotsCapacity && totalSlotsCapacity > 0 ? round2((bookingCount / totalSlotsCapacity) * 100) : null;
    therapistCapacity = {
      activeTherapists,
      dailySlotsPerTherapist: configuredSlots,
      totalSlotsCapacity,
      bookingCount,
      utilizationPct,
      band: capacityBandFor(utilizationPct),
    };
  }
  const coverageNote = pageViews === 0 && totalClicks > 0
    ? 'Belum ada PageView terinstrumentasi pada rentang ini (LP belum pasang tracker/beacon). Klik CTA = superset.'
    : pageViews > 0 && totalClicks > pageViews
      ? 'CTR parsial — sebagian klik dari link langsung / LP tanpa tracker (coverage gap).'
      : 'PageView = LP terinstrumentasi (subset); Klik CTA = superset (termasuk direct/cta). Data sebelum beacon tidak di-backfill.';
  const ctrNote = pageViews > 0 && totalClicks > pageViews ? 'CTR parsial (klik > view).' : undefined;

  // ── Drop-off MQL (state/DB-derived) ────────────────────────────────────────
  const allQualifyingResByCustomer = new Map<string, any[]>();
  for (const r of [...historyReservations, ...rangeReservations]) {
    if (!r.customer_id) continue;
    const arr = allQualifyingResByCustomer.get(r.customer_id) || [];
    arr.push(r);
    allQualifyingResByCustomer.set(r.customer_id, arr);
  }
  const mqlCustomerIds = new Set<string>();
  for (const c of cohortCustomers) if (c.is_mql) mqlCustomerIds.add(c.id);
  for (const a of matchedAds) {
    const c = customerMap.get(a.customerId);
    if (a.customerId && c?.is_mql) mqlCustomerIds.add(a.customerId);
  }
  let converted = 0;
  let convertedFirstTime = 0;
  let convertedRepeat = 0;
  let outOfCoverage = 0;
  let cancelled = 0;
  let noReservation = 0;
  for (const cid of mqlCustomerIds) {
    const res = (allQualifyingResByCustomer.get(cid) || []).filter((r) => !isSandboxed(r.customer));
    if (res.some((r) => isQualifyingStatus(r.status))) {
      converted += 1;
      const firstEver = firstEverByCustomer.get(cid);
      if (firstEver) {
        const createdAt = new Date(firstEver.created_at).getTime();
        if (createdAt >= start.getTime() && createdAt <= end.getTime()) {
          convertedFirstTime += 1;
        } else {
          convertedRepeat += 1;
        }
      } else {
        convertedRepeat += 1;
      }
    } else if (res.some((r) => String(r.status).toLowerCase() === 'cancelled')) {
      cancelled += 1;
    } else if (customerMap.get(cid)?.is_out_of_coverage) {
      outOfCoverage += 1;
    } else {
      noReservation += 1;
    }
  }
  const mqlTotal = mqlCustomerIds.size;
  const mqlDropOff = {
    mqlTotal,
    converted,
    convertedFirstTime,
    convertedRepeat,
    dropped: mqlTotal - converted,
    outOfCoverage,
    cancelled,
    noReservation,
  };

  const report: MetaPerformanceReport = {
    meta: {
      tenantId,
      startDate: startStr,
      endDate: endStr,
      adSpend,
      revenueBasis: {
        treatmentSource: 'purchase_value+catalog_fallback',
        deliverySource: 'snapshot+fallback',
        excludedStatuses: EXCLUDED_REVENUE_STATUSES,
        pendingHoldIncluded: false,
        truncated,
        errors,
      },
      dbNote,
    },
    kpiSummary,
    funnel: {
      pageViews,
      totalClicks,
      matchedChats,
      unmatchedDrain,
      mqlLeads,
      newCustomers,
      conversionRates,
      coverageNote,
      ctrNote,
    },
    channelComparison,
    campaignBreakdown,
    journeyVelocity: {
      meanDays: mean(journeyDaysList),
      medianDays: median(journeySorted),
      brackets: journeyBrackets,
    },
    bookingLeadTime: leadTimeArr,
    treatmentPreferences,
    leakageDiagnostics: {
      topDropOffStates,
      outOfCoverageCount,
      topRegions,
      followUpRecovery: { sent: followUpSent, byStatus: followUpByStatus },
      mqlDropOff,
    },
    retentionCohorts,
    monthlyCohorts,
    rolling3MonthCohorts,
    cohortPlanning,
    therapistCapacity,
  };

  if (errors.length === 0) {
    responseCacheService.set(cacheKey, report, CACHE_TTL_SECONDS);
  }
  return report;
}
