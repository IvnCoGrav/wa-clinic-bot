#!/usr/bin/env tsx
/**
 * Backfill: pulihkan `customers.preferences.house_photo_url` yang rusak akibat
 * operasi JSON Prisma yang tidak sah (`{ path, set }` disimpan sebagai nilai
 * literal sehingga seluruh `preferences` tertimpa).
 *
 * Sumber kebenaran URL thumbnail: `preferences.set` (berisi thumb URL valid).
 *
 * Jalankan: npx tsx scripts/backfill-house-photo-from-corrupt-pref.ts --dry-run
 * Apply:     npx tsx scripts/backfill-house-photo-from-corrupt-pref.ts --apply
 */

import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();
const MEDIA_ROOT = path.join(process.cwd(), 'storage', 'media');

interface CorruptRow {
  id: string;
  phone: string | null;
  name: string | null;
  preferences: any;
}

function fileExistsForUrl(url: string): boolean {
  const m = url.match(/^\/media\/(outbound|inbound)\/([^/]+)\/([^/]+)$/);
  if (!m) return false;
  return fs.existsSync(path.join(MEDIA_ROOT, m[1], m[2], m[3]));
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const tenantId = args.find((a) => a.startsWith('--tenant='))?.split('=')[1] || 'default-tenant';

  console.log(`[BACKFILL-PREF] Mode: ${dryRun ? 'DRY-RUN' : 'APPLY'} | tenant=${tenantId}`);

  const rows = await prisma.$queryRaw<CorruptRow[]>`
    SELECT id, phone, name, preferences
    FROM customers
    WHERE tenant_id = ${tenantId} AND preferences->'path' IS NOT NULL
    ORDER BY id
  `;

  console.log(`[BACKFILL-PREF] Baris rusak: ${rows.length}`);

  let ok = 0;
  let skipped = 0;
  const csv: string[] = ['customer_id,phone,name,thumb_url,file_exists,status'];

  for (const row of rows) {
    const pref = (row.preferences && typeof row.preferences === 'object') ? row.preferences : {};
    const thumbUrl = typeof pref.set === 'string' ? pref.set : null;
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;

    if (!thumbUrl || !thumbUrl.startsWith('/media/')) {
      skipped++;
      csv.push([row.id, row.phone, row.name, thumbUrl, '', 'SKIP_NO_THUMB'].map(esc).join(','));
      continue;
    }

    const exists = fileExistsForUrl(thumbUrl);
    const next: Record<string, any> = { ...pref, house_photo_url: thumbUrl };
    delete next.path;
    delete next.set;

    csv.push([row.id, row.phone, row.name, thumbUrl, String(exists), exists ? 'READY' : 'THUMB_MISSING'].map(esc).join(','));

    if (!exists) {
      skipped++;
      continue;
    }
    if (dryRun) {
      ok++;
      continue;
    }

    await prisma.customer.updateMany({
      where: { id: row.id, tenant_id: tenantId },
      data: { preferences: next },
    });
    ok++;
  }

  const outDir = path.join(process.cwd(), 'logs');
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `backfill-pref-${Date.now()}.csv`);
    fs.writeFileSync(outFile, csv.join('\n'), 'utf8');
    console.log(`[BACKFILL-PREF] CSV: ${outFile}`);
  } catch (e: any) {
    console.warn(`[BACKFILL-PREF] Gagal menulis CSV: ${e?.message || e}`);
  }

  console.log(`[BACKFILL-PREF] ${dryRun ? 'Siap dipulihkan' : 'Dipulihkan'}: ${ok} | dilewati: ${skipped}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[BACKFILL-PREF] FATAL:', e?.message || e);
  await prisma.$disconnect();
  process.exit(1);
});
