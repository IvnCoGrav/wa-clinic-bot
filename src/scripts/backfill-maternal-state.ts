/**
 * Fase 1 — Backfill state maternal terstruktur.
 *
 * Mengisi `reservations.gestational_weeks`, `mom_stage`, `hpl_date` dari
 * `raw_text` / `treatment_detail` untuk data lama. Idempoten: hanya menulis
 * bila hasil resolusi non-null, dan hanya menyentuh baris yang kolomnya kosong.
 *
 * Pemakaian:
 *   npx tsx src/scripts/backfill-maternal-state.ts            (dry-run)
 *   npx tsx src/scripts/backfill-maternal-state.ts --execute
 *   npx tsx src/scripts/backfill-maternal-state.ts --execute --tenant=default-tenant
 */
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { resolveMaternalState } from '../services/maternal-state.service';

const BATCH = 500;

async function main() {
  const execute = process.argv.includes('--execute');
  const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
  const tenantId = tenantArg ? tenantArg.split('=')[1] : DEFAULT_TENANT_ID;

  console.log(`[BACKFILL MATERNAL] mode=${execute ? 'EXECUTE' : 'DRY-RUN'} tenant=${tenantId}`);

  let scanned = 0;
  let matched = 0;
  let updated = 0;
  let offset = 0;

  for (;;) {
    const rows = await prisma.reservation.findMany({
      where: {
        tenant_id: tenantId,
        gestational_weeks: null,
        OR: [
          { raw_text: { contains: 'kehamilan', mode: 'insensitive' } },
          { raw_text: { contains: 'minggu', mode: 'insensitive' } },
          { treatment_category: { in: ['MOMS', 'BOTH'] as any } },
        ],
      },
      select: {
        id: true,
        raw_text: true,
        treatment_detail: true,
        treatment_category: true,
        created_at: true,
      },
      orderBy: { created_at: 'asc' },
      skip: offset,
      take: BATCH,
    });

    if (!rows.length) break;
    scanned += rows.length;
    offset += rows.length;

    for (const r of rows) {
      const state = resolveMaternalState({
        rawText: r.raw_text,
        treatmentDetail: r.treatment_detail,
        treatmentCategory: r.treatment_category,
        anchorAt: r.created_at,
      });
      if (state.gestationalWeeks == null && state.momStage == null) continue;
      matched++;

      if (execute) {
        try {
          await prisma.reservation.update({
            where: { id: r.id },
            data: {
              gestational_weeks: state.gestationalWeeks,
              mom_stage: state.momStage,
              hpl_date: state.hplDate,
            },
          });
          updated++;
        } catch (err: any) {
          console.warn(`[BACKFILL MATERNAL] gagal update ${r.id}: ${err?.message || err}`);
        }
      }
    }

    if (rows.length < BATCH) break;
  }

  console.log(`[BACKFILL MATERNAL] scanned=${scanned} matched=${matched} updated=${updated} (execute=${execute})`);
}

main()
  .catch((e) => {
    console.error('[BACKFILL MATERNAL] FATAL', e);
    process.exit(1);
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch {}
  });
