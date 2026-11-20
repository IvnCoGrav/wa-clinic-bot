#!/usr/bin/env node
/**
 * Sapu file media yatim (tidak direferensikan pesan/customer/pricelist).
 * Memakai MediaService hasil build (`dist/`), bukan salinan logika.
 *
 * Jalankan (di container produksi):
 *   docker cp scripts/sweep-orphan-media.js wa-clinic-bot-app-1:/app/sweep-orphan.js
 *   docker exec wa-clinic-bot-app-1 node /app/sweep-orphan.js --dry-run
 *   docker exec wa-clinic-bot-app-1 node /app/sweep-orphan.js --apply
 *
 * GERBANG: menolak berjalan selama masih ada pesan ber-payload rusak (`unset`).
 * Jalankan backfill media lebih dulu.
 */
'use strict';

const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const force = args.includes('--force');
  const tenantArg = args.find((a) => a.startsWith('--tenant='));
  const tenantId = tenantArg ? tenantArg.split('=')[1] : 'default-tenant';
  const ageArg = args.find((a) => a.startsWith('--min-age-hours='));
  const minAgeHours = ageArg ? Number(ageArg.split('=')[1]) || 1 : 1;

  console.log(`[SWEEP-ORPHAN] Mode: ${dryRun ? 'DRY-RUN' : 'APPLY'} | tenant=${tenantId} | minAgeHours=${minAgeHours}`);

  const { MediaService } = require(path.join(process.cwd(), 'dist', 'services', 'media.service.js'));
  const mediaService = new MediaService();

  const res = await mediaService.sweepOrphanMedia(tenantId, { dryRun, minAgeHours, force });
  console.log(`[SWEEP-ORPHAN] Hasil: ${JSON.stringify(res, (_k, v) => (typeof v === 'bigint' ? Number(v) : v))}`);

  if (res.aborted) {
    console.error('[SWEEP-ORPHAN] DIBATALKAN — selesaikan backfill media lebih dulu.');
    process.exitCode = 2;
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[SWEEP-ORPHAN] FATAL:', (e && e.message) || e);
  await prisma.$disconnect();
  process.exit(1);
});
