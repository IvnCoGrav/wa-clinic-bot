#!/usr/bin/env tsx
/**
 * Backfill: Rewrite customer.preferences.house_photo_url from HD (.jpg) to thumbnail (_thumb.jpg)
 * Jalankan: npx tsx scripts/backfill-house-photo-thumb-urls.ts --dry-run
 * Apply:     npx tsx scripts/backfill-house-photo-thumb-urls.ts --apply
 */

import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

const MEDIA_ROOT = path.join(__dirname, '..', 'storage', 'media');

function withThumbName(filename: string): string {
  return filename.replace(/(\.\w+)$/, '_thumb$1');
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || !args.includes('--apply');
  const tenantId = args.find(a => a.startsWith('--tenant='))?.split('=')[1] || 'default-tenant';

  console.log(`[BACKFILL] Mode: ${dryRun ? 'DRY-RUN' : 'APPLY'}`);
  console.log(`[BACKFILL] Tenant: ${tenantId}`);
  console.log(`[BACKFILL] MEDIA_ROOT: ${MEDIA_ROOT}`);

  const customers = await prisma.customer.findMany({
    where: {
      tenant_id: tenantId,
      preferences: {
        path: ['house_photo_url'],
        string_contains: '/media/',
      },
    },
    select: {
      id: true,
      phone: true,
      name: true,
      preferences: true,
    },
  });

  console.log(`[BACKFILL] Total customers with house_photo_url: ${customers.length}`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const cust of customers) {
    const prefs = (cust.preferences as any) || {};
    const url = prefs.house_photo_url;
    if (!url || !url.startsWith('/media/')) continue;

    // Sudah thumbnail? skip
    if (url.includes('_thumb.')) {
      skipped++;
      continue;
    }

    // Parse URL
    const match = url.match(/^\/media\/(outbound|inbound)\/([^/]+)\/([^/]+)$/);
    if (!match) {
      console.warn(`[BACKFILL] Invalid URL format: ${cust.phone} ${url}`);
      errors++;
      continue;
    }

    const [, scope, , file] = match;
    const thumbFile = withThumbName(file);
    const thumbUrl = `/media/${scope}/${tenantId}/${thumbFile}`;
    const thumbPath = path.join(MEDIA_ROOT, scope, tenantId, thumbFile);

    // Cek thumb ada di disk
    if (!fs.existsSync(thumbPath) || !fs.statSync(thumbPath).isFile()) {
      console.warn(`[BACKFILL] Thumb NOT FOUND on disk: ${cust.phone} ${thumbUrl}`);
      errors++;
      continue;
    }

    console.log(`[BACKFILL] ${cust.phone} (${cust.name}): ${url} -> ${thumbUrl}`);

    if (!dryRun) {
      try {
        // Merge preferences, preserve other keys
        const newPrefs = { ...prefs, house_photo_url: thumbUrl };
        await prisma.customer.update({
          where: { id: cust.id },
          data: { preferences: newPrefs },
        });
        updated++;
      } catch (e: any) {
        console.error(`[BACKFILL] Update failed for ${cust.phone}:`, e.message);
        errors++;
      }
    } else {
      updated++;
    }
  }

  console.log(`[BACKFILL] Summary: ${updated} ${dryRun ? 'would update' : 'updated'}, ${skipped} already thumb, ${errors} errors`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('[BACKFILL] Fatal:', e);
  process.exit(1);
});