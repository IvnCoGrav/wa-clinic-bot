/**
 * backfill-orphaned-followups.ts — Pemulihan antrean NEXT_TREATMENT yang telantar (orphaned).
 * Fondasional: hanya jadwalkan stage masa depan (scheduled_at >= NOW()) status PENDING,
 * per-stage SENT-aware, idempoten, tenant-aware, pilot-first.
 *
 * Klaim asal 160/205 UNVERIFIED — skrip ini melakukan audit read-only dulu sebelum commit.
 *
 * Usage:
 *   npx tsx src/scripts/backfill-orphaned-followups.ts --dry-run [--tenant=default-tenant] [--limit=500] [--pilot-phones=6288994572210,6285850166929]
 *   npx tsx src/scripts/backfill-orphaned-followups.ts --commit [--tenant=...] [--pilot-phones=...]   # butuh --commit eksplisit
 *
 * Safety:
 *  - Default --dry-run (tidak menulis). Butuh --commit untuk tulis.
 *  - Hanya PENDING, WIB 09:00, scheduled_at > now, skip bypass/sandbox/dummy/blocked.
 *  - Pilot: bila --pilot-phones diisi, hanya phone tersebut yang diproses (untuk D1: 10 pilot termasuk Mutia & Devia).
 */
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';

const isCommit = process.argv.includes('--commit');
const isDryRun = !isCommit || process.argv.includes('--dry-run');
const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const pilotArg = process.argv.find((a) => a.startsWith('--pilot-phones='));

const tenantFilter: string | null = tenantArg ? tenantArg.split('=')[1]!.trim() : null;
const limit = limitArg ? Math.max(1, parseInt(limitArg.split('=')[1] || '500', 10)) : 500;
const pilotPhones: string[] | null = pilotArg
  ? pilotArg.split('=')[1]!.split(',').map((s) => s.trim().replace(/\D/g, '')).filter(Boolean)
  : null;

function wib0900(anchor: Date, monthOffset: number): Date {
  const w = new Date(anchor.getTime() + 7 * 60 * 60 * 1000);
  return new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth() + monthOffset, w.getUTCDate(), 2, 0, 0, 0));
}

async function getTenantIds(): Promise<string[]> {
  if (tenantFilter) return [tenantFilter];
  try {
    const { getAllTenantIds } = await import('../services/media.service');
    return await getAllTenantIds();
  } catch {
    return [DEFAULT_TENANT_ID];
  }
}

async function main() {
  console.log(`[BACKFILL FOLLOWUP] Mode: ${isDryRun ? 'DRY-RUN' : 'COMMIT'} | tenant=${tenantFilter || 'ALL'} | limit=${limit} | pilot=${pilotPhones ? pilotPhones.join(',') : '-'}`);
  if (isDryRun) console.log('[BACKFILL FOLLOWUP] Tidak menulis DB — tambah --commit untuk eksekusi.');

  const tenantIds = await getTenantIds();
  let totalOrphaned = 0;
  let totalPlanned = 0;
  let totalCreated = 0;

  for (const tenantId of tenantIds) {
    console.log(`\n[BACKFILL FOLLOWUP] Tenant: ${tenantId}`);

    // 1. Kandidat completed 90 hari (konsisten reconciler)
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    let completed: Array<{ customer_id: string; booking_date: Date | null; customer?: any }> = [];
    try {
      completed = (await prisma.reservation.findMany({
        where: { tenant_id: tenantId, status: 'completed', booking_date: { gte: ninetyDaysAgo, lte: now } },
        select: { customer_id: true, booking_date: true },
        orderBy: { booking_date: 'desc' },
        take: 5000,
      })) as any;
    } catch (e: any) {
      console.warn(`[BACKFILL] Gagal baca reservation tenant ${tenantId}: ${e.message}`);
      continue;
    }

    const maxByCustomer = new Map<string, Date>();
    for (const r of completed) {
      if (!r.customer_id || !r.booking_date) continue;
      const d = new Date(r.booking_date);
      if (isNaN(d.getTime())) continue;
      const cur = maxByCustomer.get(r.customer_id);
      if (!cur || d.getTime() > cur.getTime()) maxByCustomer.set(r.customer_id, d);
    }

    let cids = Array.from(maxByCustomer.keys());
    if (pilotPhones && pilotPhones.length > 0) {
      // Filter ke pilot phones saja — lookup phone
      const pilotSet = new Set(pilotPhones.map((p) => (p.startsWith('62') ? p : p.startsWith('0') ? '62' + p.slice(1) : p)));
      const pilotCustomers = await prisma.customer.findMany({
        where: { phone: { in: Array.from(pilotSet) }, tenant_id: tenantId } as any,
        select: { id: true, phone: true },
      }).catch(() => [] as any);
      const pilotIds = new Set((pilotCustomers as any[]).map((c) => c.id));
      cids = cids.filter((id) => pilotIds.has(id));
      if (cids.length === 0) {
        // Jika pilot belum punya completed (mis. data sample), tetap tampilkan kandidat pilot untuk audit
        console.log(`[BACKFILL] Pilot phones tidak punya completed 90d di tenant ${tenantId} — menampilkan kandidat pilot tanpa filter maxByCustomer:`);
        for (const pc of (pilotCustomers as any[])) {
          console.log(`  pilot ${pc.phone} id=${pc.id} — no completed in 90d (skip)`);
        }
        continue;
      }
    }

    cids = cids.slice(0, limit);

    // Filter aktif masa depan & sudah punya NEXT PENDING/QUEUED (seperti reconciler)
    const nowForFilter = new Date();
    const activeFuture = await prisma.reservation.findMany({
      where: { tenant_id: tenantId, customer_id: { in: cids }, status: { in: ['pending', 'confirmed', 'hold'] }, booking_date: { gte: nowForFilter } },
      select: { customer_id: true },
    }).catch(() => [] as any);
    const hasActive = new Set((activeFuture as any[]).map((r) => r.customer_id));
    let candidates = cids.filter((id) => !hasActive.has(id));

    const hasNext = await prisma.followUp.findMany({
      where: { tenant_id: tenantId, customer_id: { in: candidates }, type: 'NEXT_TREATMENT', status: { in: ['PENDING', 'QUEUED'] as any } },
      select: { customer_id: true },
    }).catch(() => [] as any);
    const hasNextSet = new Set((hasNext as any[]).map((r) => r.customer_id));
    let orphaned = candidates.filter((id) => !hasNextSet.has(id));

    // Filter bypass/sandbox/dummy/blocked
    try {
      const customers = await prisma.customer.findMany({
        where: { id: { in: orphaned } },
        select: { id: true, phone: true, name: true, status: true, is_sandbox_test: true, is_admin_labeled: true },
      }).catch(() => [] as any);
      const withLabels = await prisma.customer.findMany({
        where: { id: { in: orphaned } },
        include: { labels: { include: { label: true } } },
      }).catch(() => [] as any);
      const { hasBypassLabel } = await import('../utils/customer-bypass');
      const { isDummyOrTestContact } = await import('../utils/dummy-filter');
      const labelMap = new Map<string, any>();
      for (const c of (withLabels as any[]) || []) labelMap.set(c.id, c);
      const filtered: string[] = [];
      for (const c of (customers as any[]) || []) {
        if (c.status === 'blocked' || c.is_sandbox_test || c.is_admin_labeled) continue;
        const wl = labelMap.get(c.id);
        if (wl && hasBypassLabel(wl)) continue;
        if (isDummyOrTestContact(c.phone, c.name)) continue;
        filtered.push(c.id);
      }
      if ((customers as any[]).length > 0) orphaned = filtered;
    } catch {}

    console.log(`[BACKFILL] completed customers 90d: ${maxByCustomer.size} | candidates after active/next filter: ${orphaned.length} (activeFuture excluded ${cids.length - candidates.length}, hasNext excluded ${candidates.length - orphaned.length})`);
    totalOrphaned += orphaned.length;

    // Rencana per customer: 1-3 stage masa depan WIB 09:00, per-stage SENT-aware
    for (const cid of orphaned.slice(0, limit)) {
      const bDate = maxByCustomer.get(cid)!;
      const stages: Array<{ stage: number; at: Date; willCreate: boolean; reason?: string }> = [];
      for (const stage of [1, 2, 3] as const) {
        const at = wib0900(bDate, stage);
        if (at.getTime() <= now.getTime()) {
          stages.push({ stage, at, willCreate: false, reason: 'past' });
          continue;
        }
        const exists = await prisma.followUp.findFirst({
          where: { tenant_id: tenantId, customer_id: cid, type: 'NEXT_TREATMENT', stage, status: { in: ['PENDING', 'QUEUED', 'SENT'] as any } },
        }).catch(() => null);
        if (exists) {
          stages.push({ stage, at, willCreate: false, reason: 'exists/SENT' });
        } else {
          stages.push({ stage, at, willCreate: true });
        }
      }
      const toCreate = stages.filter((s) => s.willCreate);
      if (toCreate.length === 0) continue;
      totalPlanned += toCreate.length;

      // Lookup display
      const cust = await prisma.customer.findUnique({ where: { id: cid }, select: { phone: true, name: true } } as any).catch(() => null) as any;
      console.log(`  - ${cust?.phone || cid} (${cust?.name || '-'}) booking=${bDate.toISOString().slice(0,10)} → ${toCreate.map((s) => `S${s.stage}@${s.at.toISOString()}`).join(', ')} ${toCreate.length < 3 ? `(skip ${stages.filter((s) => !s.willCreate).map((s) => `S${s.stage}:${s.reason}`).join(', ')})` : ''}`);

      if (!isDryRun) {
        const { followUpService } = await import('../services/follow-up.service');
        try {
          await followUpService.createNextTreatmentFollowUps(cid, bDate, tenantId);
          totalCreated += toCreate.length;
        } catch (e: any) {
          console.warn(`[BACKFILL] create failed ${cid}: ${e.message}`);
        }
      }
    }
  }

  console.log(`\n[BACKFILL DONE] orphaned=${totalOrphaned} planned_next_rows=${totalPlanned} ${isDryRun ? '(dry-run, no writes)' : `created≈${totalCreated}`} mode=${isDryRun ? 'dry-run' : 'commit'}`);
  if (isDryRun) console.log('[BACKFILL] Verifikasi output di atas, lalu jalankan dengan --commit (disarankan --pilot-phones untuk D1).');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
