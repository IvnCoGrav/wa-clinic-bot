/**
 * src/scripts/ad-watchdog-backtest.ts
 *
 * Skrip CLI untuk melakukan backtest evaluasi Ad Watchdog terhadap data historis
 * (LandingPageView, AdClick, Inbound Messages) selama N hari terakhir.
 *
 * Contoh pemakaian:
 *   npx tsx src/scripts/ad-watchdog-backtest.ts --tenant=default-tenant --days=14
 */

import { prisma } from '../db/client';
import { adFunnelMetricsService } from '../services/ad-funnel-metrics.service';
import {
  loadAdWatchdogSettings,
  evaluate,
  DEFAULT_AD_WATCHDOG_SETTINGS,
} from '../services/ad-watchdog.service';
import {
  wibDayBoundsUtc,
  formatWibDateYYYYMMDD,
} from '../utils/wib-time';

function parseArgs() {
  const args = process.argv.slice(2);
  const options: Record<string, string> = {};

  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, val] = arg.slice(2).split('=');
      if (val !== undefined) {
        options[key] = val;
      }
    }
  }

  return {
    tenantId: options.tenant || 'default-tenant',
    days: options.days ? Math.max(1, parseInt(options.days, 10)) : 14,
    endDateStr: options['end-date'] || null,
  };
}

async function runBacktest() {
  const params = parseArgs();
  console.log('='.repeat(80));
  console.log(`[AD WATCHDOG BACKTEST] Tenant: ${params.tenantId} | Horizon: ${params.days} hari`);
  console.log('='.repeat(80));

  const cfg = await loadAdWatchdogSettings(params.tenantId).catch(() => DEFAULT_AD_WATCHDOG_SETTINGS);

  const now = new Date();
  const endRefDate = params.endDateStr
    ? new Date(`${params.endDateStr}T14:00:00.000Z`) // 21:00 WIB
    : now;

  console.log(`Konfigurasi Watchdog: MinViews=${cfg.minViews}, MinCTR=${cfg.minCtr * 100}%, MinAgedClicks=${cfg.minAgedClicks}`);
  console.log(`Jam Operasional: ${cfg.activeStartHourWib}:00 - ${cfg.activeEndHourWib}:00 WIB\n`);

  interface DayReport {
    dateStr: string;
    views: number;
    clicks: number;
    ctr: string;
    matched: number;
    aged: number;
    inbound: number;
    baseline: number;
    status: string;
    primarySignal: string;
    allSignals: string;
  }

  const results: DayReport[] = [];

  for (let i = params.days - 1; i >= 0; i--) {
    const targetDate = new Date(endRefDate.getTime() - i * 24 * 60 * 60 * 1000);
    const dateStr = formatWibDateYYYYMMDD(targetDate);
    const bounds = wibDayBoundsUtc(0, targetDate);

    // Batasi jam aktif hari tersebut: 08:00 WIB s/d 21:00 WIB (atau sekarang jika hari ini)
    const windowStart = new Date(bounds.start.getTime() + cfg.activeStartHourWib * 60 * 60 * 1000);
    let windowEnd = new Date(bounds.start.getTime() + cfg.activeEndHourWib * 60 * 60 * 1000);
    if (windowEnd.getTime() > now.getTime()) {
      windowEnd = now;
    }

    try {
      const metrics = await adFunnelMetricsService.computeFunnelMetrics(
        params.tenantId,
        { start: windowStart, end: windowEnd },
        {
          now: windowEnd,
          graceMinutes: cfg.graceMinutes,
          paidMediums: cfg.paidMediums,
        }
      );

      if (!metrics) {
        continue;
      }

      const baseline = await adFunnelMetricsService.computeBaselineWindow(
        params.tenantId,
        cfg.activeStartHourWib,
        windowEnd,
        cfg.baselineDays
      );

      const evaluation = evaluate(metrics, baseline, cfg, windowEnd);

      results.push({
        dateStr,
        views: metrics.paidViews,
        clicks: metrics.uniquePaidClicks,
        ctr: `${(metrics.ctr * 100).toFixed(1)}%`,
        matched: metrics.paidMatchedLeads,
        aged: metrics.paidAgedClicks,
        inbound: metrics.inboundChats,
        baseline,
        status: evaluation.status,
        primarySignal: evaluation.primarySignal,
        allSignals: evaluation.allSignals.join(', ') || '-',
      });
    } catch (err: any) {
      console.warn(`[BACKTEST] Gagal menghitung tanggal ${dateStr}:`, err?.message || err);
    }
  }

  if (results.length === 0) {
    console.log('Tidak ada data atau koneksi database offline.');
    try { await prisma.$disconnect(); } catch {}
    return;
  }

  console.log('| Tanggal    | Views | Clicks | CTR   | Matched | Aged (>20m) | Inbound | Baseline | Status | Primary Signal           |');
  console.log('|------------|-------|--------|-------|---------|-------------|---------|----------|--------|--------------------------|');
  for (const r of results) {
    const pad = (s: any, len: number) => String(s).padEnd(len);
    console.log(
      `| ${pad(r.dateStr, 10)} | ${pad(r.views, 5)} | ${pad(r.clicks, 6)} | ${pad(r.ctr, 5)} | ${pad(r.matched, 7)} | ${pad(r.aged, 11)} | ${pad(r.inbound, 7)} | ${pad(r.baseline, 8)} | ${pad(r.status, 6)} | ${pad(r.primarySignal, 24)} |`
    );
  }

  const alertDays = results.filter((r) => r.status === 'ALERT');
  console.log('\n' + '='.repeat(80));
  console.log(`Total Hari Dianalisa : ${results.length}`);
  console.log(`Hari Normal (OK)     : ${results.length - alertDays.length}`);
  console.log(`Hari Alert           : ${alertDays.length}`);
  if (alertDays.length > 0) {
    console.log('\nRincian Sinyal Alert:');
    for (const r of alertDays) {
      console.log(`• ${r.dateStr}: ${r.primarySignal} (Semua Sinyal: ${r.allSignals})`);
    }
  }
  console.log('='.repeat(80));

  try { await prisma.$disconnect(); } catch {}
}

runBacktest().catch((err) => {
  console.error('[BACKTEST ERROR]', err);
  process.exit(1);
});
