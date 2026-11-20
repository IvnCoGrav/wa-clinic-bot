/**
 * scripts/backfill-purchase-occurred-at.mjs
 * Task 2.6 (A-014b) + keputusan owner D2 (2026-11-19): mengisi `purchase_occurred_at`
 * yang masih NULL pada reservasi yang sudah dikirim/diapprove event CAPI.
 *
 * Prioritas sumber (deterministik, urutan tetap):
 *   1. `audit_logs.payload.purchase_occurred_at` (APPROVE_PURCHASE_EVENT)
 *   2. `audit_logs.created_at` (waktu approve sebenarnya)
 *   3. `reservations.purchase_event_sent_at`
 *   4. `reservations.booking_date` (fallback terakhir, disetujui D2)
 * Setiap baris yang diubah WAJIB menulis audit log `BACKFILL_PURCHASE_OCCURRED_AT`
 * berisi sumber nilai, sehingga asal data dapat diaudit ulang.
 *
 * Penggunaan:
 *   node scripts/backfill-purchase-occurred-at.mjs                                  # Dry-run
 *   node scripts/backfill-purchase-occurred-at.mjs --apply --backup-ref=<file>     # Terapkan
 */

import { PrismaClient } from '@prisma/client';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BACKFILL_ACTION = 'BACKFILL_PURCHASE_OCCURRED_AT';
export const BACKFILL_ADMIN_KEY = 'SYSTEM_BACKFILL';
export const BACKFILL_ADMIN_IDENTITY = 'system:backfill-purchase-occurred-at';

export const SOURCE_AUDIT_PAYLOAD = 'audit_log.payload.purchase_occurred_at';
export const SOURCE_AUDIT_CREATED_AT = 'audit_log.created_at';
export const SOURCE_EVENT_SENT_AT = 'reservation.purchase_event_sent_at';
export const SOURCE_BOOKING_DATE = 'reservation.booking_date';

function toValidDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/**
 * Menentukan tanggal terjadinya pembelian beserta sumbernya (murni, mudah diuji).
 * Urutan prioritas tidak boleh berubah tanpa persetujuan owner (D2).
 */
export function resolvePurchaseOccurredAt({
  auditPayload = null,
  auditCreatedAt = null,
  purchaseEventSentAt = null,
  bookingDate = null,
} = {}) {
  if (auditPayload && typeof auditPayload === 'object') {
    const fromPayload = toValidDate(auditPayload.purchase_occurred_at);
    if (fromPayload) return { date: fromPayload, source: SOURCE_AUDIT_PAYLOAD };
  }

  const fromAuditCreatedAt = toValidDate(auditCreatedAt);
  if (fromAuditCreatedAt) return { date: fromAuditCreatedAt, source: SOURCE_AUDIT_CREATED_AT };

  const fromSentAt = toValidDate(purchaseEventSentAt);
  if (fromSentAt) return { date: fromSentAt, source: SOURCE_EVENT_SENT_AT };

  const fromBookingDate = toValidDate(bookingDate);
  if (fromBookingDate) return { date: fromBookingDate, source: SOURCE_BOOKING_DATE };

  return { date: null, source: 'none' };
}

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const backupArg = argv.find((a) => a.startsWith('--backup-ref='));
  return {
    apply,
    limit: limitArg ? Number(limitArg.split('=')[1]) : undefined,
    backupRef: backupArg ? backupArg.split('=')[1] : undefined,
  };
}

function parsePayload(payload) {
  if (payload === null || payload === undefined) return null;
  if (typeof payload === 'object') return payload;
  if (typeof payload !== 'string') return null;
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export async function runBackfill({ prisma, apply = false, limit, backupRef = null, logger = console } = {}) {
  const result = {
    timestamp: new Date().toISOString(),
    dryRun: !apply,
    dbAvailable: true,
    backupRef,
    limit: limit ?? null,
    totalCandidates: 0,
    resolvedCount: 0,
    unresolvedCount: 0,
    appliedCount: 0,
    alreadyCorrectCount: 0,
    sourceDistribution: {},
    samples: [],
    note: '',
  };

  try {
    const candidates = await prisma.reservation.findMany({
      where: {
        purchase_occurred_at: null,
        OR: [{ purchase_event_sent_at: { not: null } }, { purchase_review_status: 'approved' }],
      },
      select: {
        id: true,
        tenant_id: true,
        booking_date: true,
        created_at: true,
        purchase_event_sent_at: true,
      },
      orderBy: { created_at: 'asc' },
      ...(limit ? { take: limit } : {}),
    });

    result.totalCandidates = candidates.length;

    for (const reservation of candidates) {
      const auditLog = await prisma.auditLog.findFirst({
        where: { action: 'APPROVE_PURCHASE_EVENT', target_id: reservation.id },
        orderBy: { created_at: 'desc' },
        select: { payload: true, created_at: true },
      });

      const { date, source } = resolvePurchaseOccurredAt({
        auditPayload: parsePayload(auditLog?.payload),
        auditCreatedAt: auditLog?.created_at ?? null,
        purchaseEventSentAt: reservation.purchase_event_sent_at ?? null,
        bookingDate: reservation.booking_date ?? null,
      });

      result.sourceDistribution[source] = (result.sourceDistribution[source] || 0) + 1;

      if (!date) {
        result.unresolvedCount += 1;
        continue;
      }

      result.resolvedCount += 1;
      if (result.samples.length < 10) {
        result.samples.push({ id: reservation.id, resolvedDate: date.toISOString(), source });
      }

      if (!apply) continue;

      await prisma.$transaction(async (tx) => {
        const updated = await tx.reservation.updateMany({
          where: { id: reservation.id, purchase_occurred_at: null },
          data: { purchase_occurred_at: date },
        });
        if (updated.count === 0) {
          result.alreadyCorrectCount += 1;
          return;
        }
        await tx.auditLog.create({
          data: {
            tenant_id: reservation.tenant_id ?? 'default-tenant',
            admin_key: BACKFILL_ADMIN_KEY,
            admin_identity: BACKFILL_ADMIN_IDENTITY,
            action: BACKFILL_ACTION,
            target_id: reservation.id,
            payload: JSON.stringify({
              source,
              purchase_occurred_at: date.toISOString(),
              previous_value: null,
            }),
          },
        });
        result.appliedCount += 1;
      });
    }
  } catch (err) {
    result.dbAvailable = false;
    result.note = `Database offline / error: ${err.message}`;
  }

  logger.log(JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const { apply, limit, backupRef } = parseArgs(process.argv);
  if (apply && !backupRef) {
    console.error('REFUSED: --apply wajib menyertakan --backup-ref=<nama file backup> sebagai bukti backup sudah dibuat.');
    process.exit(2);
  }

  const prisma = new PrismaClient();
  try {
    const result = await runBackfill({ prisma, apply, limit, backupRef });
    process.exit(result.dbAvailable ? 0 : 1);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

const invokedDirectly =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((err) => {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  });
}
