/**
 * audit-payment-proof-gaps.ts
 *
 * Skrip AUDIT READ-ONLY untuk memetakan celah bukti pembayaran reservasi.
 * TIDAK menulis ke database. Satu-satunya output yang ditulis adalah berkas
 * laporan di `docs/audit/<tanggal>/` (JSON + Markdown).
 *
 * Usage:
 *   npx tsx src/scripts/audit-payment-proof-gaps.ts
 *   npx tsx src/scripts/audit-payment-proof-gaps.ts --tenant=default-tenant
 *   npx tsx src/scripts/audit-payment-proof-gaps.ts --days=30 --limit=1000
 *   npx tsx src/scripts/audit-payment-proof-gaps.ts --out=docs/audit/2026-11-19
 *
 * Hasil dipakai sebagai Gerbang 0 sebelum remediasi data (Fase 5) dijalankan.
 */
import fs from 'fs';
import path from 'path';
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { resolveReservationBilling } from '../services/reservation-billing.service';
import {
  classifyReservationForAudit,
  summarizeAuditFindings,
  type AuditSeverity,
  type PaymentProofFindingCode,
} from '../domain/payment-proof-audit';

function argValue(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=').trim() : null;
}

function intArg(name: string, fallback: number): number {
  const raw = argValue(name);
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const tenantId = argValue('tenant') || DEFAULT_TENANT_ID;
const dayWindow = intArg('days', 30);
const limit = intArg('limit', 1000);
const now = new Date();
const dateStamp = now.toISOString().slice(0, 10);
const outDir = argValue('out') || path.join('docs', 'audit', dateStamp);

interface AuditRow {
  reservationId: string;
  customerId: string;
  customerName: string | null;
  customerPhone: string | null;
  status: string;
  bookingDate: string | null;
  proofUrl: string | null;
  proofFileExists: boolean | null;
  purchaseOccurredAt: string | null;
  receiptAmount: number | null;
  expectedTotal: number;
  paymentMethod: string | null;
  severity: AuditSeverity;
  codes: PaymentProofFindingCode[];
  notes: string[];
}

async function checkProofFile(proofUrl: string | null): Promise<boolean | null> {
  if (!proofUrl) return null;
  try {
    const { mediaService } = await import('../services/media.service');
    const abs = mediaService.filePathFromRelativeUrl(proofUrl);
    if (!abs) return false;
    return fs.existsSync(abs) && fs.statSync(abs).isFile();
  } catch {
    return null;
  }
}

function writeReports(rows: AuditRow[]): { jsonPath: string; mdPath: string } {
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'payment-proof-gaps.json');
  const mdPath = path.join(outDir, 'payment-proof-gaps.md');
  const summary = summarizeAuditFindings(rows);

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: now.toISOString(),
        tenantId,
        windowDays: dayWindow,
        limit,
        summary,
        rows,
      },
      null,
      2
    ),
    'utf8'
  );

  const high = rows.filter((r) => r.severity === 'HIGH');
  const medium = rows.filter((r) => r.severity === 'MEDIUM');

  const lines: string[] = [];
  lines.push(`# Audit Bukti Pembayaran — ${dateStamp}`);
  lines.push('');
  lines.push(`- Tenant: \`${tenantId}\``);
  lines.push(`- Jendela audit: ±${dayWindow} hari`);
  lines.push(`- Total baris diperiksa: **${summary.total}**`);
  lines.push(
    `- Severity: HIGH **${summary.bySeverity.HIGH}**, MEDIUM **${summary.bySeverity.MEDIUM}**, LOW **${summary.bySeverity.LOW}**`
  );
  lines.push('');
  lines.push('## Ringkasan per kode temuan');
  lines.push('');
  lines.push('| Kode | Jumlah |');
  lines.push('|---|---|');
  for (const [code, count] of Object.entries(summary.byCode).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${code} | ${count} |`);
  }
  lines.push('');
  lines.push('## Temuan HIGH');
  lines.push('');
  if (high.length === 0) {
    lines.push('_Tidak ada temuan HIGH._');
  } else {
    lines.push('| Reservasi | Customer | Jadwal | Kode | Catatan |');
    lines.push('|---|---|---|---|---|');
    for (const row of high) {
      lines.push(
        `| \`${row.reservationId}\` | ${row.customerName || '-'} (${row.customerPhone || '-'}) | ${
          row.bookingDate || '-'
        } | ${row.codes.join(', ')} | ${row.notes.join(' ')} |`
      );
    }
  }
  lines.push('');
  lines.push('## Temuan MEDIUM');
  lines.push('');
  if (medium.length === 0) {
    lines.push('_Tidak ada temuan MEDIUM._');
  } else {
    lines.push('| Reservasi | Customer | Jadwal | Kode | Catatan |');
    lines.push('|---|---|---|---|---|');
    for (const row of medium) {
      lines.push(
        `| \`${row.reservationId}\` | ${row.customerName || '-'} (${row.customerPhone || '-'}) | ${
          row.bookingDate || '-'
        } | ${row.codes.join(', ')} | ${row.notes.join(' ')} |`
      );
    }
  }
  lines.push('');
  lines.push('> Skrip ini read-only. Tidak ada baris database yang diubah.');
  lines.push('');

  fs.writeFileSync(mdPath, lines.join('\n'), 'utf8');
  return { jsonPath, mdPath };
}

async function main(): Promise<number> {
  console.log('======================================================');
  console.log('[PAYMENT PROOF AUDIT] Mode: READ-ONLY (tanpa tulis DB)');
  console.log(`[PAYMENT PROOF AUDIT] Tenant: ${tenantId}`);
  console.log(`[PAYMENT PROOF AUDIT] Jendela: ±${dayWindow} hari, limit: ${limit}`);
  console.log('======================================================\n');

  const from = new Date(now.getTime() - dayWindow * 24 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + dayWindow * 24 * 60 * 60 * 1000);

  const reservations = await prisma.reservation.findMany({
    where: {
      tenant_id: tenantId,
      status: { notIn: ['cancelled', 'rejected'] },
      OR: [
        { booking_date: { gte: from, lte: to } },
        { booking_date: null, created_at: { gte: from } },
        { created_at: { gte: from } },
      ],
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      items: { select: { price: true } },
    },
    orderBy: [{ booking_date: 'asc' }, { created_at: 'asc' }],
    take: limit,
  });

  const rows: AuditRow[] = [];

  for (const reservation of reservations as any[]) {
    const billing = await resolveReservationBilling(reservation, tenantId).catch(() => null);
    const expectedTotal = billing ? billing.totalFee : 0;
    const proofFileExists = await checkProofFile(reservation.proof_url ?? null);

    const result = classifyReservationForAudit({
      status: reservation.status,
      bookingDate: reservation.booking_date ? new Date(reservation.booking_date) : null,
      proofUrl: reservation.proof_url ?? null,
      purchaseOccurredAt: reservation.purchase_occurred_at
        ? new Date(reservation.purchase_occurred_at)
        : null,
      receiptAmount: reservation.receipt_amount ?? null,
      expectedTotal,
      paymentMethod: reservation.payment_method ?? null,
      proofFileExists,
      windowBeforeDays: dayWindow,
      windowAfterDays: dayWindow,
      now,
    });

    if (result.severity === 'NONE') continue;

    rows.push({
      reservationId: reservation.id,
      customerId: reservation.customer_id,
      customerName: reservation.customer?.name ?? null,
      customerPhone: reservation.customer?.phone ?? null,
      status: reservation.status,
      bookingDate: reservation.booking_date
        ? new Date(reservation.booking_date).toISOString()
        : null,
      proofUrl: reservation.proof_url ?? null,
      proofFileExists,
      purchaseOccurredAt: reservation.purchase_occurred_at
        ? new Date(reservation.purchase_occurred_at).toISOString()
        : null,
      receiptAmount: reservation.receipt_amount ?? null,
      expectedTotal,
      paymentMethod: reservation.payment_method ?? null,
      severity: result.severity,
      codes: result.codes,
      notes: result.notes,
    });
  }

  const summary = summarizeAuditFindings(rows);
  const { jsonPath, mdPath } = writeReports(rows);

  console.log(`[PAYMENT PROOF AUDIT] Baris bermasalah: ${summary.total}`);
  console.log(
    `  HIGH=${summary.bySeverity.HIGH} MEDIUM=${summary.bySeverity.MEDIUM} LOW=${summary.bySeverity.LOW}`
  );
  for (const [code, count] of Object.entries(summary.byCode).sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${code}: ${count}`);
  }
  console.log(`\nLaporan JSON : ${jsonPath}`);
  console.log(`Laporan MD   : ${mdPath}`);
  console.log('\nCatatan: tidak ada perubahan data. Gunakan laporan ini sebagai Gerbang 0.');
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: any) => {
    const message = String(err?.message || err);
    const code = String(err?.code || err?.errorCode || '');
    const isDbUnreachable =
      message.includes('Database offline') ||
      message.includes("Can't reach database server") ||
      message.includes('Connection refused') ||
      err?.name === 'PrismaClientInitializationError' ||
      code === 'P1001' ||
      code === 'P1000';
    if (isDbUnreachable) {
      console.error(
        '[PAYMENT PROOF AUDIT] Database tidak dapat diakses. Jalankan skrip ini di environment yang memiliki DATABASE_URL aktif (server/staging).'
      );
      console.error('Tidak ada laporan yang ditulis agar tidak menyesatkan.');
      process.exitCode = 2;
      return;
    }
    console.error('[PAYMENT PROOF AUDIT] Gagal:', message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
