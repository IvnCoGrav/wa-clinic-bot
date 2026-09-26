#!/usr/bin/env tsx
/**
 * @deprecated SINCE 2026-09-26 (Fase 4, issue #136).
 * Script ini menyuntik PageView SYNTHETIC (fbclid/fbp/fbc=null, jam acak, tidak idempoten).
 * DIGANTIKAN OLEH: `src/scripts/reconcile-meta-pageviews.ts` — rekonsiliasi Meta Ads Insights API / CSV.
 *
 * Penggunaan LEGACY (hanya dry-run, --execute DITOLAK):
 *   npx tsx src/scripts/backfill-pageviews-from-meta.ts --count 679 --start 2026-09-01 --end 2026-09-23 --dry-run
 *
 * MIGRASI KE SCRIPT BARU:
 *   npx tsx src/scripts/reconcile-meta-pageviews.ts --start 2026-09-01 --end 2026-09-23 --tenantId tenant-x --dry-run
 *   npx tsx src/scripts/reconcile-meta-pageviews.ts --file meta-insights.csv --execute
 */
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';

function parseArgs() {
  const args = process.argv.slice(2);
  const out: any = { dryRun: true, tenantId: DEFAULT_TENANT_ID };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--execute') { console.error('[DEPRECATED] --execute DITOLAK. Gunakan script baru: reconcile-meta-pageviews.ts'); process.exit(1); }
    else if (a === '--count') out.count = parseInt(args[++i], 10);
    else if (a === '--start') out.start = args[++i];
    else if (a === '--end') out.end = args[++i];
    else if (a === '--landingUrl') out.landingUrl = args[++i];
    else if (a === '--utmCampaign') out.utmCampaign = args[++i];
    else if (a === '--utmSource') out.utmSource = args[++i];
    else if (a === '--utmMedium') out.utmMedium = args[++i];
    else if (a === '--tenantId') out.tenantId = args[++i];
    else if (a === '--file') out.file = args[++i];
    else if (a === '--allow-synthetic') { console.error('[DEPRECATED] --allow-synthetic DITOLAK. Data synthetic tidak valid untuk produksi.'); process.exit(1); }
  }
  return out;
}

function randomHour() {
  // Jam kerja 08-20 WIB → 01-13 UTC (WIB+7)
  return 8 + Math.floor(Math.random() * 12);
}
function randomMinute() { return Math.floor(Math.random() * 60); }

async function main() {
  const opts = parseArgs();
  const tenantId = opts.tenantId || DEFAULT_TENANT_ID;
  const landingUrl = opts.landingUrl || 'https://kalababyspa.online/reservasionline';
  const utmSource = opts.utmSource || 'meta';
  const utmMedium = opts.utmMedium || 'cpc';
  const utmCampaign = opts.utmCampaign || null;

  let rows: { date: string; count: number; landingUrl?: string; utmCampaign?: string; utmSource?: string; utmMedium?: string }[] = [];

  if (opts.file) {
    const fs = await import('fs');
    const raw = fs.readFileSync(opts.file, 'utf-8');
    const parsed = JSON.parse(raw);
    rows = Array.isArray(parsed) ? parsed : parsed.rows || [];
  } else if (opts.count) {
    const count = opts.count;
    function parseLocalDate(s: string) {
      const [y, m, d] = s.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    const start = opts.start ? parseLocalDate(opts.start) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const end = opts.end ? parseLocalDate(opts.end) : new Date();
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    const toLocalISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const days: string[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      days.push(toLocalISO(d));
    }
    if (days.length === 0) throw new Error('Rentang tanggal kosong');
    const perDay = Math.floor(count / days.length);
    let rem = count % days.length;
    rows = days.map((date) => {
      let c = perDay + (rem > 0 ? 1 : 0);
      if (rem > 0) rem--;
      return { date, count: c, landingUrl, utmCampaign: utmCampaign || undefined, utmSource, utmMedium };
    });
  } else {
    console.error('Wajib --count atau --file');
    process.exit(1);
  }

  const totalToInsert = rows.reduce((s, r) => s + r.count, 0);
  console.log(`[BACKFILL] Tenant=${tenantId} total=${totalToInsert} baris, dryRun=${opts.dryRun}`);
  console.table(rows.slice(0, 10));
  if (rows.length > 10) console.log(`... +${rows.length - 10} hari lagi`);

  // Cek existing agar idempoten: hitung existing per hari untuk cegah dobel
  function parseLocalDate2(s: string) { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
  const startDate = parseLocalDate2(rows[0].date);
  const endDate = parseLocalDate2(rows[rows.length - 1].date);
  endDate.setHours(23, 59, 59, 999);
  let existing = 0;
  try {
    existing = await (prisma as any).landingPageView.count({
      where: { tenant_id: tenantId, createdAt: { gte: startDate, lte: endDate } },
    });
  } catch (e: any) {
    console.warn('[WARN] Gagal hitung existing (DB offline?):', e.message);
  }
  console.log(`[BACKFILL] Existing landing_page_views di rentang ${rows[0].date}..${rows[rows.length - 1].date}: ${existing}`);

  if (opts.dryRun) {
    console.log('[DRY-RUN] Tidak insert. Jalankan dengan --execute untuk eksekusi.');
    // Simulasi payload pertama
    const sampleDate = rows[0].date;
    const sampleAt = new Date(sampleDate);
    sampleAt.setHours(randomHour(), randomMinute(), Math.floor(Math.random() * 60), 0);
    console.log('[SAMPLE]', {
      tenant_id: tenantId,
      landingUrl: rows[0].landingUrl || landingUrl,
      utmSource: rows[0].utmSource || utmSource,
      utmMedium: rows[0].utmMedium || utmMedium,
      utmCampaign: rows[0].utmCampaign || utmCampaign,
      createdAt: sampleAt.toISOString(),
    });
    return;
  }

  // Guard: baris synthetic (tanpa fbclid/fbp/fbc, jam acak, tidak idempoten per-event)
  // tidak boleh masuk tanpa consent eksplisit — jalur normal adalah Meta API/CSV (Fase 4).
  if (!opts.allowSynthetic) {
    console.error('[TOLAK] Script ini menyuntik PageView SYNTHETIC (identity null, jam acak, bukan event nyata).');
    console.error('Tambahkan flag --allow-synthetic bila memang ingin menyuntik data perkiraan;');
    console.error('jalur yang disarankan: rekonsiliasi Meta API/CSV (Fase 4, issue #136).');
    process.exit(1);
  }

  // Insert batch 500
  let inserted = 0;
  for (const r of rows) {
    if (r.count <= 0) continue;
    const batch: any[] = [];
    for (let i = 0; i < r.count; i++) {
      const d = new Date(r.date);
      d.setHours(randomHour(), randomMinute(), Math.floor(Math.random() * 60), Math.floor(Math.random() * 1000));
      batch.push({
        tenant_id: tenantId,
        landingUrl: r.landingUrl || landingUrl,
        utmSource: r.utmSource || utmSource,
        utmMedium: r.utmMedium || utmMedium,
        utmCampaign: r.utmCampaign || utmCampaign,
        utmContent: null,
        utmTerm: null,
        utmId: null,
        fbclid: null,
        fbp: null,
        fbc: null,
        ipAddress: null,
        userAgent: 'Mozilla/5.0 (backfill synthetic)',
        source: 'backfill-synthetic',
        referrer: null,
        createdAt: d,
      });
    }
    // createMany
    try {
      const res = await (prisma as any).landingPageView.createMany({ data: batch, skipDuplicates: true });
      inserted += res.count ?? batch.length;
      console.log(`[INSERT] ${r.date}: ${res.count ?? batch.length} baris`);
    } catch (e: any) {
      // Fallback per-row jika createMany tidak didukung
      console.warn(`[WARN] createMany gagal ${r.date}: ${e.message}, fallback per-row`);
      for (const row of batch) {
        await (prisma as any).landingPageView.create({ data: row }).catch(() => {});
        inserted++;
      }
    }
  }

  console.log(`[DONE] Inserted ${inserted}/${totalToInsert} baris. Verifikasi:`);
  try {
    const after = await (prisma as any).landingPageView.count({
      where: { tenant_id: tenantId, createdAt: { gte: startDate, lte: endDate } },
    });
    console.log(`  Total di rentang sekarang: ${after} (sebelum ${existing} + ${inserted} = ${existing + inserted})`);
  } catch {}
}

main().catch((e) => { console.error(e); process.exit(1); });
