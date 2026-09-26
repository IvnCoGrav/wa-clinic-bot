import { prisma } from '../db/client';
import { resolveViewTenantId } from '../routes/tracking.route';

export interface MetaInsightRow {
  date: string;              // YYYY-MM-DD
  campaign_name: string;
  landing_page_views: number;
}

export interface ReconcileOptions {
  tenantId?: string;
  dryRun?: boolean;
}

export interface ReconcileResult {
  inserted: number;
  wouldInsert?: number;
  skippedCampaigns: string[];
  errors: string[];
}

/**
 * Rekonsiliasi Meta Ads Insights → landing_page_views.
 * Match key deterministik: tenant_id + date + utm_campaign (campaign_name Meta).
 * Source baris: 'meta-reconciliation' (eventId=null, referrer=null).
 */
export async function reconcileMetaPageViews(
  metaData: MetaInsightRow[] | { csv: string },
  options: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const dryRun = options.dryRun ?? true;
  const result: ReconcileResult = { inserted: 0, skippedCampaigns: [], errors: [] };

  // Parse input: array atau CSV string
  const rows: MetaInsightRow[] = Array.isArray(metaData) ? metaData : parseCsv(metaData.csv);
  if (rows.length === 0) return result;

  // Ambil semua tenant dengan landing_domain (untuk resolusi campaign → tenant)
  const tenants = await prisma.tenant.findMany({
    where: { landing_domain: { not: null } },
    select: { id: true, slug: true, landing_domain: true },
  });
  const campaignToTenant = new Map<string, string>();
  for (const t of tenants as any[]) {
    if (t.slug) campaignToTenant.set(t.slug, t.id);
    if (t.landing_domain) {
      try {
        const host = new URL(t.landing_domain.includes('://') ? t.landing_domain : `https://${t.landing_domain}`).hostname;
        campaignToTenant.set(host, t.id);
      } catch {}
    }
  }

  // Group by date + campaign untuk efisiensi query
  const byKey = new Map<string, MetaInsightRow>();
  for (const r of rows) {
    const key = `${r.date}|${r.campaign_name}`;
    if (!byKey.has(key) || byKey.get(key)!.landing_page_views < r.landing_page_views) {
      byKey.set(key, r);
    }
  }

  // Ambil view lokal yang relevan (bulk query)
  const dates = [...new Set(rows.map(r => r.date))];
  const campaigns = [...new Set(rows.map(r => r.campaign_name))];
  const localViews = await (prisma as any).landingPageView.findMany({
    where: {
      createdAt: {
        gte: new Date(`${dates[0]}T00:00:00`),
        lte: new Date(`${dates[dates.length - 1]}T23:59:59`),
      },
      utmCampaign: { in: campaigns },
    },
    select: {
      createdAt: true,
      utmCampaign: true,
    },
  });

  // Hitung existing per (date, campaign)
  const localCounts = new Map<string, number>();
  for (const v of localViews as any[]) {
    const d = v.createdAt.toISOString().split('T')[0];
    const key = `${d}|${v.utmCampaign}`;
    localCounts.set(key, (localCounts.get(key) || 0) + 1);
  }

  let toInsert: any[] = [];

  for (const [, row] of byKey) {
    const tenantId = campaignToTenant.get(row.campaign_name) || campaignToTenant.get(row.campaign_name?.toLowerCase?.()) || options.tenantId || 'default-tenant';
    if (!tenantId || tenantId === 'default-tenant') {
      result.skippedCampaigns.push(row.campaign_name);
      continue;
    }

    const localKey = `${row.date}|${row.campaign_name}`;
    const existing = localCounts.get(localKey) || 0;
    const missing = row.landing_page_views - existing;
    if (missing <= 0) continue;

    if (dryRun) {
      result.wouldInsert = (result.wouldInsert || 0) + missing;
      continue;
    }

    // Generate missing rows
    for (let i = 0; i < missing; i++) {
      const hour = 8 + Math.floor(Math.random() * 12); // 08-20 WIB
      const minute = Math.floor(Math.random() * 60);
      const createdAt = new Date(`${row.date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`);
      toInsert.push({
        tenant_id: tenantId,
        landingUrl: null, // unknown from Meta aggregate
        fbclid: null,
        fbp: null,
        fbc: null,
        ipAddress: null,
        userAgent: 'Meta Ads Insights Reconciliation',
        utmSource: 'meta',
        utmMedium: 'cpc',
        utmCampaign: row.campaign_name,
        utmContent: null,
        utmTerm: null,
        utmId: null,
        eventId: null,
        referrer: null,
        source: 'meta-reconciliation',
        createdAt,
      });
    }
  }

  if (!dryRun && toInsert.length > 0) {
    const res = await (prisma as any).landingPageView.createMany({
      data: toInsert,
      skipDuplicates: true,
    });
    result.inserted = res.count ?? toInsert.length;
  }

  return result;
}

function parseCsv(csv: string): MetaInsightRow[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  const idxDate = headers.indexOf('date');
  const idxCampaign = headers.indexOf('campaign_name');
  const idxViews = headers.indexOf('landing_page_views');
  if (idxDate === -1 || idxCampaign === -1 || idxViews === -1) return [];
  return lines.slice(1).map(l => {
    const cols = l.split(',').map(c => c.trim());
    return {
      date: cols[idxDate],
      campaign_name: cols[idxCampaign],
      landing_page_views: parseInt(cols[idxViews], 10) || 0,
    };
  }).filter(r => r.landing_page_views > 0);
}