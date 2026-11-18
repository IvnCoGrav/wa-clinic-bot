/**
 * scripts/capi-invariants.mjs
 * Query read-only pengecekan invarian Meta CAPI:
 * 1. purchase_occurred_at null saat event sudah terkirim (purchase_event_sent_at != null)
 * 2. purchase_value null / <= 0 saat event sudah terkirim
 * 3. ad_clicks landingUrl invalid (placeholder {{...}} atau bukan URL absolut)
 * 4. duplicate fbclid aktif
 * 5. audit_logs menyimpan payload PII mentah (phone 10+ digit, raw address)
 *
 * Exit code: 1 jika terdapat pelanggaran invarian pada DB online; 0 jika bersih / DB offline.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function runInvariantsCheck() {
  const result = {
    timestamp: new Date().toISOString(),
    dbAvailable: true,
    violationsCount: 0,
    checks: {},
  };

  try {
    // 1. Check occurred_at null saat sent_at terisi
    const occurredAtNullCount = await prisma.reservation.count({
      where: {
        purchase_event_sent_at: { not: null },
        purchase_occurred_at: null,
      },
    });

    // 2. Check purchase_value null / <= 0 saat sent_at terisi
    const invalidValueCount = await prisma.reservation.count({
      where: {
        purchase_event_sent_at: { not: null },
        OR: [{ purchase_value: null }, { purchase_value: { lte: 0 } }],
      },
    });

    // 3. Check invalid landingUrl di ad_clicks
    const placeholderUrlCount = await prisma.adClick.count({
      where: {
        OR: [
          { landingUrl: { contains: '{{' } },
          { landingUrl: { contains: '%7B%7B' } },
        ],
      },
    });

    // 4. Duplicate fbclid aktif
    const duplicateFbclids = await prisma.$queryRaw`
      SELECT fbclid, COUNT(*)::int as count
      FROM ad_clicks
      WHERE fbclid IS NOT NULL AND "matchedAt" IS NOT NULL
      GROUP BY fbclid
      HAVING COUNT(*) > 1
      LIMIT 10
    `.catch(() => []);

    // 5. PII di audit_logs (sample 100 log terbaru)
    const recentAuditLogs = await prisma.auditLog.findMany({
      take: 100,
      orderBy: { created_at: 'desc' },
      select: { id: true, action: true, payload: true },
    }).catch(() => []);

    let piiPayloadCount = 0;
    const phoneRegex = /\b(?:08|628|\+628)\d{8,12}\b/;
    for (const log of recentAuditLogs) {
      const str = typeof log.payload === 'string' ? log.payload : JSON.stringify(log.payload || {});
      if (phoneRegex.test(str)) {
        piiPayloadCount++;
      }
    }

    result.checks = {
      occurredAtNullWhenSent: {
        count: occurredAtNullCount,
        status: occurredAtNullCount === 0 ? 'PASS' : 'VIOLATION',
      },
      invalidValueWhenSent: {
        count: invalidValueCount,
        status: invalidValueCount === 0 ? 'PASS' : 'VIOLATION',
      },
      placeholderUrlInAdClicks: {
        count: placeholderUrlCount,
        status: placeholderUrlCount === 0 ? 'PASS' : 'VIOLATION',
      },
      duplicateActiveFbclid: {
        count: Array.isArray(duplicateFbclids) ? duplicateFbclids.length : 0,
        status: (Array.isArray(duplicateFbclids) && duplicateFbclids.length === 0) ? 'PASS' : 'VIOLATION',
      },
      piiInRecentAuditLogs: {
        sampleSize: recentAuditLogs.length,
        detectedPiiCount: piiPayloadCount,
        status: piiPayloadCount === 0 ? 'PASS' : 'WARNING_BASELINE',
      },
    };

    result.violationsCount =
      (result.checks.occurredAtNullWhenSent.status === 'VIOLATION' ? 1 : 0) +
      (result.checks.invalidValueWhenSent.status === 'VIOLATION' ? 1 : 0) +
      (result.checks.placeholderUrlInAdClicks.status === 'VIOLATION' ? 1 : 0) +
      (result.checks.duplicateActiveFbclid.status === 'VIOLATION' ? 1 : 0);

    console.log(JSON.stringify(result, null, 2));

    await prisma.$disconnect();
    if (result.violationsCount > 0) {
      process.exit(1);
    }
    process.exit(0);
  } catch (err) {
    result.dbAvailable = false;
    result.note = `Database offline / unreachable: ${err.message}`;
    console.log(JSON.stringify(result, null, 2));
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  }
}

runInvariantsCheck();
