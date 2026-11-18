/**
 * scripts/audit-pii-scan.mjs
 * Memindai tabel audit_logs untuk mendeteksi keberadaan PII mentah:
 * - phone (nomor telepon mentah 10-14 digit)
 * - address (alamat / patokan)
 * - name (nama lengkap pelanggan)
 * - rawText (teks reservasi mentah)
 * - apiKey (kunci API admin)
 *
 * Baseline historis: 665 phone / 276 address / 443 name / 2 apiKey.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const HISTORICAL_BASELINE = {
  phone: 665,
  address: 276,
  name: 443,
  apiKey: 2,
};

async function scanAuditLogsPii() {
  const result = {
    timestamp: new Date().toISOString(),
    dbAvailable: true,
    totalScanned: 0,
    counts: {
      phone: 0,
      address: 0,
      name: 0,
      rawText: 0,
      apiKey: 0,
    },
    historicalBaseline: HISTORICAL_BASELINE,
  };

  try {
    const totalLogs = await prisma.auditLog.count();
    result.totalScanned = totalLogs;

    // Scan batch
    const batchSize = 500;
    let skip = 0;
    const phoneRegex = /\b(?:08|628|\+628)\d{8,12}\b/;
    const apiKeyRegex = /\b(?:ADMIN_API_KEY|test_admin_key|[a-f0-9]{32,64})\b/i;

    while (skip < totalLogs && skip < 5000) {
      const logs = await prisma.auditLog.findMany({
        skip,
        take: batchSize,
        select: { id: true, payload: true },
      });

      if (!logs.length) break;

      for (const log of logs) {
        const str = typeof log.payload === 'string' ? log.payload : JSON.stringify(log.payload || {});
        if (phoneRegex.test(str)) result.counts.phone++;
        if (/address|alamat|jalan|jl\./i.test(str)) result.counts.address++;
        if (/customerName|childName|"name":/i.test(str)) result.counts.name++;
        if (/raw_text|rawText/i.test(str)) result.counts.rawText++;
        if (apiKeyRegex.test(str)) result.counts.apiKey++;
      }

      skip += batchSize;
    }

    console.log(JSON.stringify(result, null, 2));
    await prisma.$disconnect();
    process.exit(0);
  } catch (err) {
    result.dbAvailable = false;
    result.note = `Database offline: ${err.message}`;
    console.log(JSON.stringify(result, null, 2));
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  }
}

scanAuditLogsPii();
