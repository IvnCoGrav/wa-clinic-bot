/**
 * backfill-visit-evidence.ts â€” backfill bukti kedatangan (default DRY RUN).
 *
 * Contoh:
 *   npx tsx src/scripts/backfill-visit-evidence.ts --from=2026-11-01 --to=2026-11-19
 *   npx tsx src/scripts/backfill-visit-evidence.ts --from=2026-11-01 --to=2026-11-19 --commit
 *
 * Jaminan: skrip ini tidak pernah mengubah `reservations.arrived_at`.
 */

import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import {
  DEFAULT_VISIT_EVIDENCE_POLICY,
  VisitEvidenceService,
} from '../services/visit-evidence.service';

const evidenceService = new VisitEvidenceService();

function readArg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function wibDateStart(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00+07:00`);
}

function formatWibDate(value: Date | null | undefined): string {
  if (!value) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
  }).format(new Date(value));
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

async function main(): Promise<void> {
  const fromStr = readArg('from', '2026-11-01');
  const toStr = readArg('to', '2026-11-19');
  const tenantId = readArg('tenant', DEFAULT_TENANT_ID);
  const commit = process.argv.includes('--commit');

  const from = wibDateStart(fromStr);
  const to = wibDateStart(toStr);

  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) {
    throw new Error('Rentang tanggal tidak valid. Contoh: --from=2026-11-01 --to=2026-11-19');
  }

  console.log('=== BACKFILL BUKTI KEDATANGAN ===');
  console.log(`Mode    : ${commit ? 'COMMIT (menulis)' : 'DRY RUN (tidak menulis)'}`);
  console.log(`Periode : ${fromStr} s/d ${toStr} (WIB)`);
  console.log(`Tenant  : ${tenantId}`);
  console.log('');

  const reservations = await prisma.reservation.findMany({
    where: {
      tenant_id: tenantId,
      status: 'completed',
      booking_date: { gte: from, lt: to },
    },
    select: {
      id: true,
      booking_date: true,
      assigned_staff: { select: { name: true } },
      customer: { select: { name: true } },
    },
    orderBy: { booking_date: 'asc' },
  });

  type Row = {
    staff: string;
    total: number;
    measured: number;
    chat: number;
    unknown: number;
  };

  const rows = new Map<string, Row>();
  const chatCandidates: Array<{
    name: string;
    date: Date | null;
    minutes: number;
    messageId: string;
  }> = [];

  let persisted = 0;
  let skippedReviewed = 0;

  for (const reservation of reservations) {
    const staff = reservation.assigned_staff?.name || '(tanpa bidan)';
    const row =
      rows.get(staff) || { staff, total: 0, measured: 0, chat: 0, unknown: 0 };

    const result = await evidenceService.collectForReservation(
      reservation.id,
      tenantId,
      DEFAULT_VISIT_EVIDENCE_POLICY
    );

    if (!result) continue;

    row.total += 1;
    if (result.status === 'MEASURED') row.measured += 1;
    else if (result.status === 'CHAT_CANDIDATE') row.chat += 1;
    else row.unknown += 1;

    if (result.chatCandidate) {
      chatCandidates.push({
        name: reservation.customer?.name || '(tanpa nama)',
        date: reservation.booking_date,
        minutes: result.chatCandidate.observedMinutes,
        messageId: result.chatCandidate.messageId,
      });
    }

    if (commit && result.drafts.length > 0) {
      const write = await evidenceService.persistDrafts(
        reservation.id,
        tenantId,
        result.drafts
      );
      persisted += write.persisted;
      skippedReviewed += write.skippedReviewed;
    }

    rows.set(staff, row);
  }

  const totals = [...rows.values()].reduce(
    (acc, row) => ({
      total: acc.total + row.total,
      measured: acc.measured + row.measured,
      chat: acc.chat + row.chat,
      unknown: acc.unknown + row.unknown,
    }),
    { total: 0, measured: 0, chat: 0, unknown: 0 }
  );

  console.log(
    `${pad('bidan', 20)} | total | terukur | chat | tanpa bukti`
  );
  console.log('-'.repeat(20) + '-+-------+---------+------+-------------');
  for (const row of [...rows.values()].sort((a, b) => b.total - a.total)) {
    console.log(
      `${pad(row.staff, 20)} | ${String(row.total).padStart(5)} | ${String(row.measured).padStart(7)} | ${String(row.chat).padStart(4)} | ${String(row.unknown).padStart(11)}`
    );
  }
  console.log('-'.repeat(20) + '-+-------+---------+------+-------------');
  console.log(
    `${pad('TOTAL', 20)} | ${String(totals.total).padStart(5)} | ${String(totals.measured).padStart(7)} | ${String(totals.chat).padStart(4)} | ${String(totals.unknown).padStart(11)}`
  );

  const withEvidence = totals.measured + totals.chat;
  const coverage = totals.total > 0 ? (withEvidence / totals.total) * 100 : 0;
  console.log('');
  console.log(
    `Cakupan bukti: ${withEvidence}/${totals.total} (${coverage.toFixed(1)}%)`
  );
  console.log(`Kandidat chat perlu review admin: ${chatCandidates.length}`);

  for (const candidate of chatCandidates) {
    console.log(
      `  - ${candidate.name} Â· ${formatWibDate(candidate.date)} Â· +${candidate.minutes} mnt Â· ${candidate.messageId}`
    );
  }

  if (commit) {
    console.log('');
    console.log(`Ditulis: ${persisted} bukti Â· Dilewati (sudah direview): ${skippedReviewed}`);
  } else {
    console.log('');
    console.log('DRY RUN selesai. Jalankan dengan --commit untuk menyimpan.');
  }
}

main()
  .catch((error) => {
    console.error('[BACKFILL EVIDENCE] Gagal:', error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
