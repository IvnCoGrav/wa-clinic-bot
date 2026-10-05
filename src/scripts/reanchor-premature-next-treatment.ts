/**
 * reanchor-premature-next-treatment.ts — Penyelarasan antrean NEXT_TREATMENT prematur.
 *
 * Akar masalah (terverifikasi): createNextTreatmentFollowUps dulu hanya skip baris
 * PENDING/QUEUED yang sudah ada (tanpa menggeser scheduled_at), sehingga antrean
 * warisan kunjungan lama tetap terjadwal terlalu cepat (mis. 5-16 hari, bukan ~30).
 *
 * Skrip ini menyelaraskan (re-anchor) baris PENDING/QUEUED ke tanggal anchor kunjungan
 * `completed` terakhir pasien pada jam 09:00 WIB. SENT bersifat terminal historis —
 * tidak pernah disentuh. Fondasional & idempoten: aman dijalankan berulang.
 *
 * Usage:
 *   npx tsx src/scripts/reanchor-premature-next-treatment.ts --dry-run [--tenant=default-tenant] [--pilot-phones=628...,628...]
 *   npx tsx src/scripts/reanchor-premature-next-treatment.ts --commit --admin-key=KEY [--admin-identity="Align Premature Follow-ups"] [--pilot-phones=...]
 *   npx tsx src/scripts/reanchor-premature-next-treatment.ts --verify-only [--tenant=...]
 *
 * Safety:
 *  - Default --dry-run (tidak menulis). Butuh --commit untuk tulis.
 *  - Hanya PENDING/QUEUED, target > now, skip bypass/sandbox/dummy/blocked.
 *  - Wajib backup tabel follow_ups + audit_logs sebelum --commit di produksi.
 */
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';

const isCommit = process.argv.includes('--commit');
const isDryRun = !isCommit || process.argv.includes('--dry-run');
const isVerifyOnly = process.argv.includes('--verify-only');
const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
const pilotArg = process.argv.find((a) => a.startsWith('--pilot-phones='));
const adminKeyArg = process.argv.find((a) => a.startsWith('--admin-key='));
const adminIdentityArg = process.argv.find((a) => a.startsWith('--admin-identity='));

const tenantFilter: string | null = tenantArg ? tenantArg.split('=')[1]!.trim() : null;
const pilotPhones: string[] | null = pilotArg
  ? pilotArg.split('=')[1]!.split(',').map((s) => s.trim().replace(/\D/g, '')).filter(Boolean)
  : null;
const adminKey: string | undefined = adminKeyArg ? adminKeyArg.split('=').slice(1).join('=').trim() : process.env.ADMIN_API_KEY;
const adminIdentity: string = adminIdentityArg
  ? adminIdentityArg.split('=').slice(1).join('=').trim()
  : 'Align Premature Follow-ups';

// Selisih dianggap prematur bila baris terjadwal lebih awal dari anchor (toleransi 1 hari).
const PREMATURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

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
  console.log(
    `[REANCHOR NEXT] Mode: ${isVerifyOnly ? 'VERIFY-ONLY' : isDryRun ? 'DRY-RUN' : 'COMMIT'} | tenant=${tenantFilter || 'ALL'} | pilot=${pilotPhones ? pilotPhones.join(',') : '-'}`
  );
  if (!isDryRun && !isVerifyOnly) {
    if (!adminKey) {
      console.error('[REANCHOR NEXT] FATAL: --commit butuh --admin-key atau env ADMIN_API_KEY (untuk audit_logs).');
      process.exit(1);
    }
    console.log('[REANCHOR NEXT] Pastikan backup follow_ups + audit_logs sudah dibuat sebelum commit.');
  }

  const tenantIds = await getTenantIds();
  const now = new Date();
  let totalPremature = 0;
  let totalReanchored = 0;
  let totalRemaining = 0;

  for (const tenantId of tenantIds) {
    console.log(`\n[REANCHOR NEXT] Tenant: ${tenantId}`);

    // 1. Anchor = completed terakhir dalam 90 hari per customer.
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    let completed: Array<{ customer_id: string; booking_date: Date | null }> = [];
    try {
      completed = (await prisma.reservation.findMany({
        where: { tenant_id: tenantId, status: 'completed', booking_date: { gte: ninetyDaysAgo, lte: now } },
        select: { customer_id: true, booking_date: true },
        orderBy: { booking_date: 'desc' },
        take: 5000,
      })) as any;
    } catch (e: any) {
      console.warn(`[REANCHOR NEXT] Gagal baca reservation tenant ${tenantId}: ${e.message}`);
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

    // Guard Fase 2: customer yang punya reservasi belum-selesai LEBIH BARU dari
    // completed terakhir (termasuk booking lampau) DIKECUALIKAN — anchor mereka tidak sah.
    const newerUncompleted = new Set<string>();
    try {
      const unc = (await prisma.reservation.findMany({
        where: {
          tenant_id: tenantId,
          customer_id: { in: Array.from(maxByCustomer.keys()) },
          status: { in: ['pending', 'confirmed', 'en_route', 'hold'] },
        },
        select: { customer_id: true, booking_date: true },
      }).catch(() => [] as any)) as any[];
      for (const r of unc) {
        if (!r.customer_id || !r.booking_date) continue;
        const d = new Date(r.booking_date);
        const anchor = maxByCustomer.get(r.customer_id);
        if (anchor && d.getTime() > anchor.getTime()) newerUncompleted.add(r.customer_id);
      }
    } catch {}

    let cids = Array.from(maxByCustomer.keys());
    if (pilotPhones && pilotPhones.length > 0) {
      const pilotSet = new Set(
        pilotPhones.map((p) => (p.startsWith('62') ? p : p.startsWith('0') ? '62' + p.slice(1) : p))
      );
      const pilotCustomers = await prisma.customer
        .findMany({ where: { phone: { in: Array.from(pilotSet) }, tenant_id: tenantId } as any, select: { id: true, phone: true, name: true } })
        .catch(() => [] as any);
      const pilotIds = new Set((pilotCustomers as any[]).map((c) => c.id));
      cids = cids.filter((id) => pilotIds.has(id));
      // Laporkan pilot yang tidak punya completed 90d (audit, jangan diam).
      for (const pc of (pilotCustomers as any[])) {
        if (!pilotIds.size || !maxByCustomer.has(pc.id)) {
          console.log(`  pilot ${pc.phone} (${pc.name || '-'}) id=${pc.id} — TIDAK punya completed 90d (skip)`);
        }
      }
      if (cids.length === 0) {
        console.log(`[REANCHOR NEXT] Tidak ada pilot dengan completed 90d di tenant ${tenantId}.`);
        continue;
      }
    }

    // 2. Filter bypass/sandbox/dummy/blocked (tenant-scoped).
    try {
      const withLabels = (await prisma.customer
        .findMany({ where: { id: { in: cids }, tenant_id: tenantId } as any, include: { labels: { include: { label: true } } } })
        .catch(() => [] as any)) as any[];
      const { hasBypassLabel } = await import('../utils/customer-bypass');
      const { isDummyOrTestContact } = await import('../utils/dummy-filter');
      const filtered: string[] = [];
      for (const c of withLabels || []) {
        if (!c) continue;
        if (c.status === 'blocked' || c.is_sandbox_test || c.is_admin_labeled) continue;
        if (hasBypassLabel(c)) continue;
        if (isDummyOrTestContact(c.phone, c.name)) continue;
        filtered.push(c.id);
      }
      if ((withLabels || []).length > 0) cids = filtered;
    } catch {}

    // 3. Proses per customer.
    for (const cid of cids) {
      if (newerUncompleted.has(cid)) {
        const cust0 = (await prisma.customer
          .findUnique({ where: { id: cid }, select: { phone: true, name: true } } as any)
          .catch(() => null)) as any;
        console.log(`  SKIP ${cust0?.phone || cid} (${cust0?.name || '-'}) — punya reservasi belum-selesai lebih baru dari completed (anchor tak sah, Fase 2).`);
        continue;
      }
      const anchor = maxByCustomer.get(cid)!;
      const cust = (await prisma.customer
        .findUnique({ where: { id: cid }, select: { phone: true, name: true } } as any)
        .catch(() => null)) as any;

      for (const stage of [1, 2, 3] as const) {
        const target = wib0900(anchor, stage);
        if (target.getTime() <= now.getTime()) continue;

        const row = (await prisma.followUp
          .findFirst({
            where: {
              tenant_id: tenantId,
              customer_id: cid,
              type: 'NEXT_TREATMENT',
              stage,
              status: { in: ['PENDING', 'QUEUED'] as any },
            },
            orderBy: { created_at: 'asc' },
          })
          .catch(() => null)) as any;
        if (!row) continue;

        const oldAt = new Date(row.scheduled_at);
        // Scope A: HANYA baris terlalu cepat (prematur) yang digeser. Baris yang
        // sudah benar / terlalu lambat TIDAK disentuh (hindari regresi tanggal).
        const isPremature = isNaN(oldAt.getTime()) || oldAt.getTime() < target.getTime() - PREMATURE_TOLERANCE_MS;
        if (!isPremature) continue;

        totalPremature++;
        const gapDays = isNaN(oldAt.getTime()) ? 'n/a' : Math.round((target.getTime() - oldAt.getTime()) / (24 * 60 * 60 * 1000));
        console.log(
          `  - ${cust?.phone || cid} (${cust?.name || '-'}) stage ${stage} [${row.status}]: ${isNaN(oldAt.getTime()) ? 'INVALID' : oldAt.toISOString()} → ${target.toISOString()} (+${gapDays}h)`
        );

        if (isVerifyOnly) continue;

        if (!isDryRun) {
          try {
            await prisma.followUp.update({ where: { id: row.id }, data: { scheduled_at: target } });
            totalReanchored++;
            try {
              await prisma.auditLog.create({
                data: {
                  tenant_id: tenantId,
                  admin_key: adminKey!,
                  admin_identity: adminIdentity,
                  action: 'FOLLOWUP_REANCHOR_PREMATURE',
                  target_id: row.id,
                  payload: JSON.stringify({
                    customerId: cid,
                    phone: cust?.phone || null,
                    stage,
                    from: isNaN(oldAt.getTime()) ? null : oldAt.toISOString(),
                    to: target.toISOString(),
                    anchor: anchor.toISOString(),
                  }),
                },
              });
            } catch (auditErr: any) {
              console.warn(`[REANCHOR NEXT] audit_log gagal (update tetap tersimpan) ${row.id}: ${auditErr?.message}`);
            }
          } catch (updErr: any) {
            console.warn(`[REANCHOR NEXT] update gagal ${row.id}: ${updErr?.message}`);
          }
        }
      }
    }
  }

  // 4. Verifikasi akhir: hitung baris prematur yang tersisa (< 21 hari dari anchor).
  if (isVerifyOnly || !isDryRun) {
    for (const tenantId of tenantIds) {
      try {
        const rows = (await prisma.followUp.findMany({
          where: { tenant_id: tenantId, type: 'NEXT_TREATMENT', status: { in: ['PENDING', 'QUEUED'] as any } },
          select: { scheduled_at: true, customer_id: true },
        })) as any[];
        const customers = (await prisma.customer
          .findMany({ where: { id: { in: Array.from(new Set(rows.map((r) => r.customer_id))) } }, select: { id: true } })
          .catch(() => [] as any)) as any[];
        void customers;
        // Bandingkan dengan completed terakhir (baca ulang).
        const comp = (await prisma.reservation.findMany({
          where: { tenant_id: tenantId, status: 'completed', booking_date: { lte: now } },
          select: { customer_id: true, booking_date: true },
        }).catch(() => [] as any)) as any[];
        const anchorByCustomer = new Map<string, Date>();
        for (const r of comp) {
          if (!r.customer_id || !r.booking_date) continue;
          const d = new Date(r.booking_date);
          const cur = anchorByCustomer.get(r.customer_id);
          if (!cur || d.getTime() > cur.getTime()) anchorByCustomer.set(r.customer_id, d);
        }
        for (const r of rows) {
          const a = anchorByCustomer.get(r.customer_id);
          if (!a) continue;
          const at = new Date(r.scheduled_at);
          const gapDays = (at.getTime() - a.getTime()) / (24 * 60 * 60 * 1000);
          if (gapDays >= 0 && gapDays < 21) totalRemaining++;
        }
      } catch {}
    }
  }

  console.log(
    `\n[REANCHOR DONE] premature_found=${totalPremature} reanchored=${isVerifyOnly ? 'n/a' : isDryRun ? '(dry-run)' : totalReanchored} remaining(<21d)=${totalRemaining} mode=${isVerifyOnly ? 'verify-only' : isDryRun ? 'dry-run' : 'commit'}`
  );
  if (isDryRun && !isVerifyOnly) console.log('[REANCHOR NEXT] Verifikasi output di atas, lalu jalankan dengan --commit --admin-key=... (disarankan --pilot-phones dulu).');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
