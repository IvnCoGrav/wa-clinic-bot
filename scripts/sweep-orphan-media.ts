#!/usr/bin/env tsx
/**
 * Sapu file media yatim (tidak direferensikan pesan/customer/pricelist).
 *
 * Jalankan: npx tsx scripts/sweep-orphan-media.ts --dry-run
 * Apply:     npx tsx scripts/sweep-orphan-media.ts --apply
 *
 * GERBANG: menolak berjalan selama masih ada pesan ber-payload rusak (`unset`).
 * Jalankan `backfill-media-refs-from-orphan-thumbs.ts` lebih dulu.
 */

import { PrismaClient } from '@prisma/client';
import { MediaService } from '../src/services/media.service';

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const force = args.includes('--force');
  const tenantId = args.find((a) => a.startsWith('--tenant='))?.split('=')[1] || 'default-tenant';
  const minAgeHours = Number(args.find((a) => a.startsWith('--min-age-hours='))?.split('=')[1] || 1);

  console.log(`[SWEEP-ORPHAN] Mode: ${dryRun ? 'DRY-RUN' : 'APPLY'} | tenant=${tenantId} | minAgeHours=${minAgeHours}`);

  const mediaService = new MediaService();
  const res = await mediaService.sweepOrphanMedia(tenantId, { dryRun, minAgeHours, force });

  console.log(`[SWEEP-ORPHAN] Hasil: ${JSON.stringify(res)}`);
  if (res.aborted) {
    console.error('[SWEEP-ORPHAN] DIBATALKAN — selesaikan backfill media lebih dulu.');
    process.exitCode = 2;
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[SWEEP-ORPHAN] FATAL:', e?.message || e);
  await prisma.$disconnect();
  process.exit(1);
});
