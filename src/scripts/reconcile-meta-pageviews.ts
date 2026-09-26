#!/usr/bin/env tsx
/**
 * Rekonsiliasi Meta Ads Insights → landing_page_views (Fase 4, issue #136).
 * Menggantikan inject synthetic `backfill-pageviews-from-meta.ts`.
 *
 * Penggunaan:
 *   # Via Meta Ads Insights API (butuh kredensial CAPI di tenant DB)
 *   npx tsx src/scripts/reconcile-meta-pageviews.ts --start 2026-09-01 --end 2026-09-23 --tenantId tenant-x --dry-run
 *   npx tsx src/scripts/reconcile-meta-pageviews.ts --start 2026-09-01 --end 2026-09-23 --tenantId tenant-x --execute
 *
 *   # Via CSV export dari Meta Ads Manager
 *   npx tsx src/scripts/reconcile-meta-pageviews.ts --file meta-insights.csv --dry-run
 *   npx tsx src/scripts/reconcile-meta-pageviews.ts --file meta-insights.csv --execute
 *
 * Format CSV: date,campaign_name,landing_page_views
 * Contoh:
 * date,campaign_name,landing_page_views
 * 2026-09-20,promo-a,100
 * 2026-09-21,promo-b,50
 */
import { prisma } from '../db/client';
import { resolveTenantCapiCredentials } from '../services/capi.service';
import { reconcileMetaPageViews, MetaInsightRow } from '../services/meta-ads-insights.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';

interface CliOptions {
  start?: string;
  end?: string;
  tenantId?: string;
  file?: string;
  dryRun: boolean;
  execute: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const out: CliOptions = { dryRun: true, execute: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--execute') { out.dryRun = false; out.execute = true; }
    else if (a === '--start') out.start = args[++i];
    else if (a === '--end') out.end = args[++i];
    else if (a === '--tenantId') out.tenantId = args[++i];
    else if (a === '--file') out.file = args[++i];
  }
  return out;
}

async function fetchMetaInsights(accessToken: string, adAccountId: string, start: string, end: string): Promise<any[]> {
  const fields = 'date,campaign_name,landing_page_views';
  const url = `https://graph.facebook.com/v19.0/${adAccountId}/insights?fields=${fields}&time_range={'since':'${start}','until':'${end}'}&level=ad&limit=1000&access_token=${accessToken}`;

  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Meta API error ${res.status}: ${err.error?.message || 'Unknown error'}`);
  }
  const data = await res.json();
  return data.data || [];
}

async function main() {
  const opts = parseArgs();

  if (!opts.start || !opts.end) {
    console.error('Wajib --start YYYY-MM-DD dan --end YYYY-MM-DD');
    process.exit(1);
  }

  if (!opts.file && !opts.tenantId) {
    console.error('Wajib salah satu: --tenantId (untuk API) atau --file (untuk CSV)');
    process.exit(1);
  }

  if (opts.execute && !opts.dryRun) {
    console.log('[EXECUTE MODE] Akan menyisipkan view ke database.');
  } else {
    console.log('[DRY-RUN] Tidak menyisipkan ke database.');
  }

  let metaRows: any[] = [];

  if (opts.file) {
    // Baca CSV
    const fs = await import('fs');
    const csv = fs.readFileSync(opts.file, 'utf-8');
    metaRows = csv.trim().split('\n').slice(1).map(line => {
      const [date, campaign_name, views] = line.split(',').map(s => s.trim());
      return { date, campaign_name, landing_page_views: parseInt(views, 10) };
    }).filter(r => r.landing_page_views > 0);
    console.log(`[CSV] Dibaca ${metaRows.length} baris dari ${opts.file}`);
  } else {
    // Fetch dari Meta Ads Insights API
    const tenantId = opts.tenantId || DEFAULT_TENANT_ID;
    const creds = await resolveTenantCapiCredentials(tenantId);
    if (creds.source === 'none' || !creds.accessToken) {
      console.error('[ERROR] Kredensial CAPI tidak valid/tersedia untuk tenant:', tenantId);
      console.error('Pastikan tenant punya meta_capi_access_token dan meta_pixel_id di DB, atau set FB_CAPI_ACCESS_TOKEN/FB_PIXEL_ID untuk default-tenant.');
      process.exit(1);
    }

    // Ambil ad_account_id dari pixel ID (format: act_XXXXXXXX)
    const adAccountId = creds.pixelId?.startsWith('act_') ? creds.pixelId : `act_${creds.pixelId}`;
    if (!adAccountId) {
      console.error('[ERROR] Pixel ID tidak valid untuk menentukan ad_account_id');
      process.exit(1);
    }

    console.log(`[API] Fetching insights untuk ad_account ${adAccountId} rentang ${opts.start}..${opts.end}`);
    try {
      metaRows = await fetchMetaInsights(creds.accessToken, adAccountId, opts.start, opts.end);
      console.log(`[API] Diterima ${metaRows.length} baris insight`);
    } catch (err: any) {
      console.error('[ERROR] Gagal fetch Meta Ads Insights:', err.message);
      process.exit(1);
    }
  }

  if (metaRows.length === 0) {
    console.log('[INFO] Tidak ada data insight untuk direkonsiliasi');
    return;
  }

  // Normalisasi field nama (Meta API bisa pakai 'campaign_name' atau 'campaign.name')
  const normalized = metaRows.map(r => ({
    date: r.date || r.date_start,
    campaign_name: r.campaign_name || r.campaign?.name || r.adset_name || 'unknown',
    landing_page_views: r.landing_page_views || r['landing_page_view'] || r.actions?.find((a: any) => a.action_type === 'landing_page_view')?.value || 0,
  })).filter(r => r.landing_page_views > 0);

  console.log(`[NORMALIZED] ${normalized.length} baris valid untuk rekonsiliasi`);

  const { reconcileMetaPageViews } = await import('../services/meta-ads-insights.service');
  const result = await reconcileMetaPageViews(normalized, {
    tenantId: opts.tenantId,
    dryRun: opts.dryRun,
  });

  console.log('\n=== HASIL REKONSILIASI ===');
  console.log(`Ditambahkan: ${result.inserted} view`);
  if (result.wouldInsert !== undefined) console.log(`Akan ditambahkan (dry-run): ${result.wouldInsert}`);
  if (result.skippedCampaigns.length) console.log(`Campaign dilewati (tidak punya tenant): ${result.skippedCampaigns.join(', ')}`);
  if (result.errors.length) console.log(`Error: ${result.errors.join('; ')}`);

  if (!opts.dryRun) {
    console.log('\nSelesai. Verifikasi:');
    console.log('  npx prisma studio # atau query manual landing_page_views WHERE source="meta-reconciliation"');
  }
}

main().catch((e) => { console.error('[FATAL]', e); process.exit(1); });