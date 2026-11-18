#!/usr/bin/env node
/**
 * scripts/backfill-purchase-occurred-at.mjs
 * Task 2.6 (A-014b): Mengisi nilai purchase_occurred_at yang bernilai NULL
 * pada reservasi yang sudah diapprove / dikirimkan event CAPI.
 *
 * Penggunaan:
 *   node scripts/backfill-purchase-occurred-at.mjs            # Dry-run (default, tanpa mengubah DB)
 *   node scripts/backfill-purchase-occurred-at.mjs --apply   # Terapkan perubahan ke DB
 */

import { PrismaClient } from '@prisma/client';

const isApply = process.argv.includes('--apply');
const prisma = new PrismaClient();

async function run() {
  const result = {
    timestamp: new Date().toISOString(),
    dryRun: !isApply,
    dbAvailable: true,
    totalCandidates: 0,
    resolvedCount: 0,
    appliedCount: 0,
    samples: [],
    note: '',
  };

  try {
    const candidates = await prisma.reservation.findMany({
      where: {
        purchase_occurred_at: null,
        OR: [
          { purchase_event_sent_at: { not: null } },
          { purchase_review_status: 'approved' },
        ],
      },
      select: {
        id: true,
        tenant_id: true,
        booking_date: true,
        created_at: true,
        purchase_event_sent_at: true,
      },
      take: 500,
    });

    result.totalCandidates = candidates.length;

    for (const res of candidates) {
      let resolvedDate = null;
      let source = 'none';

      // 1. Cari dari audit_logs APPROVE_PURCHASE_EVENT
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          action: 'APPROVE_PURCHASE_EVENT',
          target_id: res.id,
        },
        orderBy: { created_at: 'desc' },
        select: { payload: true, created_at: true },
      });

      if (auditLog) {
        let payloadObj = null;
        try {
          payloadObj = typeof auditLog.payload === 'string' ? JSON.parse(auditLog.payload) : auditLog.payload;
        } catch {}

        if (payloadObj?.purchase_occurred_at) {
          const parsed = new Date(payloadObj.purchase_occurred_at);
          if (!isNaN(parsed.getTime())) {
            resolvedDate = parsed;
            source = 'audit_log.payload.purchase_occurred_at';
          }
        }

        if (!resolvedDate && auditLog.created_at) {
          resolvedDate = auditLog.created_at;
          source = 'audit_log.created_at';
        }
      }

      // 2. Fallback ke purchase_event_sent_at atau booking_date
      if (!resolvedDate && res.purchase_event_sent_at) {
        resolvedDate = res.purchase_event_sent_at;
        source = 'reservation.purchase_event_sent_at';
      } else if (!resolvedDate && res.booking_date) {
        resolvedDate = res.booking_date;
        source = 'reservation.booking_date';
      }

      if (resolvedDate) {
        result.resolvedCount++;
        if (result.samples.length < 5) {
          result.samples.push({
            id: res.id,
            resolvedDate: resolvedDate.toISOString(),
            source,
          });
        }

        if (isApply) {
          await prisma.reservation.update({
            where: { id: res.id },
            data: { purchase_occurred_at: resolvedDate },
          });
          result.appliedCount++;
        }
      }
    }
  } catch (err) {
    result.dbAvailable = false;
    result.note = `Database offline / error: ${err.message}`;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }

  console.log(JSON.stringify(result, null, 2));
}

run().catch((err) => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
