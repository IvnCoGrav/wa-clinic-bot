#!/usr/bin/env node
/**
 * Backfill: pulihkan `customers.preferences.house_photo_url` yang rusak akibat
 * operasi JSON Prisma yang tidak sah (`{ path, set }` tersimpan sebagai nilai
 * literal sehingga seluruh `preferences` tertimpa).
 *
 * Sumber kebenaran URL thumbnail: `preferences.set`.
 *
 * Jalankan (di container produksi):
 *   docker cp scripts/backfill-house-photo-from-corrupt-pref.js wa-clinic-bot-app-1:/app/bf-pref.js
 *   docker exec wa-clinic-bot-app-1 node /app/bf-pref.js --dry-run
 *   docker exec wa-clinic-bot-app-1 node /app/bf-pref.js --apply
 */
'use strict';

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const MEDIA_ROOT = path.join(process.cwd(), 'storage', 'media');

function fileExistsForUrl(url) {
  const m = /^\/media\/(outbound|inbound)\/([^/]+)\/([^/]+)$/.exec(url || '');
  if (!m) return false;
  return fs.existsSync(path.join(MEDIA_ROOT, m[1], m[2], m[3]));
}

function esc(v) {
  return `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const tenantArg = args.find((a) => a.startsWith('--tenant='));
  const tenantId = tenantArg ? tenantArg.split('=')[1] : 'default-tenant';

  console.log(`[BACKFILL-PREF] Mode: ${dryRun ? 'DRY-RUN' : 'APPLY'} | tenant=${tenantId}`);

  const rows = await prisma.$queryRaw`
    SELECT id, phone, name, preferences
    FROM customers
    WHERE tenant_id = ${tenantId} AND preferences->'path' IS NOT NULL
    ORDER BY id
  `;

  console.log(`[BACKFILL-PREF] Baris rusak: ${rows.length}`);

  let ready = 0;
  let applied = 0;
  let skipped = 0;
  const csv = ['customer_id,phone,name,thumb_url,file_exists,status'];

  for (const row of rows) {
    const pref = row.preferences && typeof row.preferences === 'object' ? row.preferences : {};
    const thumbUrl = typeof pref.set === 'string' ? pref.set : null;

    if (!thumbUrl || !thumbUrl.startsWith('/media/')) {
      skipped++;
      csv.push([row.id, row.phone, row.name, thumbUrl, '', 'SKIP_NO_THUMB'].map(esc).join(','));
      continue;
    }

    const exists = fileExistsForUrl(thumbUrl);
    const next = { ...pref, house_photo_url: thumbUrl };
    delete next.path;
    delete next.set;

    csv.push([row.id, row.phone, row.name, thumbUrl, String(exists), exists ? 'READY' : 'THUMB_MISSING'].map(esc).join(','));

    if (!exists) {
      skipped++;
      continue;
    }
    ready++;
    if (dryRun) continue;

    await prisma.customer.updateMany({
      where: { id: row.id, tenant_id: tenantId },
      data: { preferences: next },
    });
    applied++;
  }

  try {
    fs.mkdirSync(path.join(process.cwd(), 'logs'), { recursive: true });
    const outFile = path.join(process.cwd(), 'logs', `backfill-pref-${Date.now()}.csv`);
    fs.writeFileSync(outFile, csv.join('\n'), 'utf8');
    console.log(`[BACKFILL-PREF] CSV: ${outFile}`);
  } catch (e) {
    console.warn(`[BACKFILL-PREF] Gagal menulis CSV: ${(e && e.message) || e}`);
  }

  console.log(`[BACKFILL-PREF] siap=${ready} | ${dryRun ? 'belum diterapkan' : `diterapkan=${applied}`} | dilewati=${skipped}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[BACKFILL-PREF] FATAL:', (e && e.message) || e);
  await prisma.$disconnect();
  process.exit(1);
});
