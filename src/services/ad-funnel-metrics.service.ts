import { prisma } from '../db/client';
import { getWibNow, WIB_OFFSET_MS } from '../utils/wib-time';

export interface FunnelWindow {
  start: Date;
  end: Date;
}

export interface FunnelMetrics {
  paidViews: number;
  uniquePaidClicks: number;
  paidAgedClicks: number;
  paidMatchedLeads: number;
  matchedChats: number;
  inboundChats: number;
  mqlCount: number;
  ctr: number;
}

export interface ClickRecord {
  id: string;
  trackingCode?: string | null;
  fbclid?: string | null;
  matchedAt?: Date | null;
  createdAt: Date;
  customerId?: string | null;
  utmMedium?: string | null;
}

export interface MetricsProvider {
  countViews?: (tenantId: string, window: FunnelWindow, paidMediums: string[]) => Promise<number>;
  listPaidClicks?: (tenantId: string, window: FunnelWindow, paidMediums: string[]) => Promise<ClickRecord[]>;
  countInboundChats?: (tenantId: string, window: FunnelWindow) => Promise<number>;
  countMql?: (tenantId: string, window: FunnelWindow) => Promise<number>;
}

export interface ComputeFunnelOptions {
  paidMediums?: string[];
  graceMinutes?: number;
  now?: Date;
  provider?: MetricsProvider;
}

export const DEFAULT_PAID_MEDIUMS = ['cpc', 'paid', 'ctwa', 'ctwa_fuzzy'];
export const DEFAULT_GRACE_MINUTES = 20;

/**
 * Seam Kanonik Perhitungan Metrik Corong Iklan (Funnel Metrics).
 * Single Source of Truth untuk Watchdog & Meta Performance.
 *
 * Seluruh akses model dibungkus guard dan fail-open jika database offline.
 */
export async function computeFunnelMetrics(
  tenantId: string,
  window: FunnelWindow,
  opts: ComputeFunnelOptions = {}
): Promise<FunnelMetrics | null> {
  const paidMediums = opts.paidMediums && opts.paidMediums.length > 0 ? opts.paidMediums : DEFAULT_PAID_MEDIUMS;
  const graceMinutes = typeof opts.graceMinutes === 'number' ? opts.graceMinutes : DEFAULT_GRACE_MINUTES;
  const now = opts.now || new Date();
  const provider = opts.provider;

  try {
    // 1. Paid Views (LandingPageViews: beacon | cta-fallback)
    let paidViews = 0;
    if (provider?.countViews) {
      paidViews = await provider.countViews(tenantId, window, paidMediums);
    } else {
      const pvModel = (prisma as any).landingPageView;
      if (pvModel && typeof pvModel.count === 'function') {
        paidViews = await pvModel.count({
          where: {
            tenant_id: tenantId,
            createdAt: { gte: window.start, lte: window.end },
            source: { in: ['beacon', 'cta-fallback'] },
            OR: [
              { fbclid: { not: null } },
              { utmMedium: { in: paidMediums } },
            ],
          },
        });
      }
    }

    // 2. Paid Clicks & Deduplikasi
    let rawClicks: ClickRecord[] = [];
    if (provider?.listPaidClicks) {
      rawClicks = await provider.listPaidClicks(tenantId, window, paidMediums);
    } else {
      const clickModel = (prisma as any).adClick;
      if (clickModel && typeof clickModel.findMany === 'function') {
        rawClicks = await clickModel.findMany({
          where: {
            tenant_id: tenantId,
            createdAt: { gte: window.start, lte: window.end },
            OR: [
              { fbclid: { not: null } },
              { utmMedium: { in: paidMediums } },
            ],
          },
          select: {
            id: true,
            trackingCode: true,
            fbclid: true,
            matchedAt: true,
            createdAt: true,
            customerId: true,
            utmMedium: true,
          },
          take: 1000,
        });
      }
    }

    // Deduplikasi distinct by coalesce(fbclid, id)
    const seenClickKeys = new Set<string>();
    const uniqueClicks: ClickRecord[] = [];
    for (let i = 0; i < rawClicks.length; i++) {
      const c = rawClicks[i];
      const key = c.fbclid && c.fbclid.trim()
        ? `fbclid:${c.fbclid.trim()}`
        : (c.id ? `id:${c.id}` : `idx:${i}_${c.trackingCode || ''}_${c.createdAt}`);
      if (!seenClickKeys.has(key)) {
        seenClickKeys.add(key);
        uniqueClicks.push(c);
      }
    }

    const uniquePaidClicks = uniqueClicks.length;

    // Aged Unmatched Clicks (berusia >= graceMinutes dan matchedAt IS NULL)
    const graceCutoff = new Date(now.getTime() - graceMinutes * 60 * 1000);
    const paidAgedClicks = uniqueClicks.filter((c) => {
      const isAged = new Date(c.createdAt).getTime() <= graceCutoff.getTime();
      return !c.matchedAt && isAged;
    }).length;

    // Paid Matched Leads (distinct customerId) & Matched Chats
    const matchedCustomerIds = new Set<string>();
    let matchedChats = 0;
    for (const c of uniqueClicks) {
      if (c.matchedAt) {
        matchedChats++;
        if (c.customerId) {
          matchedCustomerIds.add(c.customerId);
        }
      }
    }
    const paidMatchedLeads = matchedCustomerIds.size > 0 ? matchedCustomerIds.size : matchedChats;

    // 3. Inbound Chats (ground truth: pesan masuk non-internal dari customer non-sandbox/staff)
    let inboundChats = 0;
    try {
      if (provider?.countInboundChats) {
        inboundChats = await provider.countInboundChats(tenantId, window);
      } else {
        const msgModel = (prisma as any).message;
        if (msgModel && typeof msgModel.findMany === 'function') {
          const inboundMsgs = await msgModel.findMany({
            where: {
              tenant_id: tenantId,
              created_at: { gte: window.start, lte: window.end },
              direction: 'INBOUND',
              sender_type: { not: 'INTERNAL_NOTE' },
            },
            select: {
              conversation: {
                select: {
                  customer_id: true,
                  customer: {
                    select: {
                      is_sandbox_test: true,
                      is_internal_staff: true,
                    },
                  },
                },
              },
            },
            take: 2000,
          }).catch(() => []);

          const uniqueChatCustomers = new Set<string>();
          if (Array.isArray(inboundMsgs)) {
            for (const m of inboundMsgs) {
              const cid = m.conversation?.customer_id;
              const cust = m.conversation?.customer;
              if (cid && !cust?.is_sandbox_test && !cust?.is_internal_staff) {
                uniqueChatCustomers.add(cid);
              }
            }
          }
          inboundChats = uniqueChatCustomers.size;
        }
      }
    } catch {
      inboundChats = 0;
    }

    // 4. MQL Count
    let mqlCount = 0;
    try {
      if (provider?.countMql) {
        mqlCount = await provider.countMql(tenantId, window);
      } else {
        const custModel = (prisma as any).customer;
        if (custModel && typeof custModel.count === 'function') {
          mqlCount = await custModel.count({
            where: {
              tenant_id: tenantId,
              is_mql: true,
              mql_triggered_at: { gte: window.start, lte: window.end },
              is_sandbox_test: false,
              is_internal_staff: false,
            },
          }).catch(() => 0);
        }
      }
    } catch {
      mqlCount = 0;
    }

    // 5. CTR (uniquePaidClicks / paidViews)
    const ctr = paidViews > 0 ? Number((uniquePaidClicks / paidViews).toFixed(4)) : 0;

    return {
      paidViews,
      uniquePaidClicks,
      paidAgedClicks,
      paidMatchedLeads,
      matchedChats,
      inboundChats,
      mqlCount,
      ctr,
    };
  } catch {
    // Fail-open: DB offline returns null, never throws
    return null;
  }
}

/**
 * Menghitung baseline median paidViews pada jam yang sama selama `days` hari terakhir (default 7 hari).
 * Mencegah alarm palsu di jam sepi dengan membandingkan terhadap pola historis.
 */
export async function computeBaselineWindow(
  tenantId: string,
  activeStartHourWib: number,
  now: Date = new Date(),
  days = 7,
  provider?: MetricsProvider
): Promise<number> {
  const wibNow = getWibNow(now);
  const currentWibHour = wibNow.getUTCHours();
  const currentWibMinute = wibNow.getUTCMinutes();
  const currentWibSecond = wibNow.getUTCSeconds();

  const dailyViews: number[] = [];

  for (let offset = 1; offset <= days; offset++) {
    // Bangun rentang WIB untuk hari H - offset
    const dayWib = new Date(wibNow.getTime() - offset * 24 * 60 * 60 * 1000);
    const y = dayWib.getUTCFullYear();
    const m = dayWib.getUTCMonth();
    const d = dayWib.getUTCDate();

    const startWibAsUtc = Date.UTC(y, m, d, activeStartHourWib, 0, 0, 0);
    const endWibAsUtc = Date.UTC(y, m, d, currentWibHour, currentWibMinute, currentWibSecond, 999);

    const windowStart = new Date(startWibAsUtc - WIB_OFFSET_MS);
    const windowEnd = new Date(endWibAsUtc - WIB_OFFSET_MS);

    // Pastikan window valid
    if (windowEnd.getTime() < windowStart.getTime()) {
      continue;
    }

    const metrics = await computeFunnelMetrics(
      tenantId,
      { start: windowStart, end: windowEnd },
      { now: windowEnd, provider }
    );

    if (metrics) {
      dailyViews.push(metrics.paidViews);
    }
  }

  if (dailyViews.length === 0) return 0;

  dailyViews.sort((a, b) => a - b);
  const mid = Math.floor(dailyViews.length / 2);
  if (dailyViews.length % 2 !== 0) {
    return dailyViews[mid];
  }
  return Math.round((dailyViews[mid - 1] + dailyViews[mid]) / 2);
}

export const adFunnelMetricsService = {
  computeFunnelMetrics,
  computeBaselineWindow,
};
