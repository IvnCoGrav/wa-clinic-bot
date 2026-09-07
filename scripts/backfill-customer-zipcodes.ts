#!/usr/bin/env tsx
/**
 * Backfill zipcode untuk customer yang zipcode IS NULL via Gazetteer.
 * Non-destruktif: tidak pernah menimpa zipcode yang sudah terisi.
 *
 * Usage:
 *   npx tsx scripts/backfill-customer-zipcodes.ts           # live update
 *   npx tsx scripts/backfill-customer-zipcodes.ts --dry-run # simulasi only
 *   npx tsx scripts/backfill-customer-zipcodes.ts --tenant=default-tenant
 */

import { prisma } from '../src/db/client';
import { resolveZipcode } from '../src/utils/gazetteer-zipcode-resolver';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const tenantArg = args.find((a) => a.startsWith('--tenant='));
  const tenantFilter = tenantArg ? tenantArg.split('=')[1] : undefined;
  const batchSize = 200;

  console.log(`[BACKFILL ZIP] Starting — dryRun=${dryRun}${tenantFilter ? ` tenant=${tenantFilter}` : ''}`);

  // Hitung total yang perlu di-backfill
  const where: any = { zipcode: null };
  if (tenantFilter) where.tenant_id = tenantFilter;
  // Juga include pending_zipcode null? Spec: zipcode IS NULL saja, tidak peduli pending; tapi agar tidak duplikat, filter zipcode null saja
  let totalNull: number;
  try {
    totalNull = await prisma.customer.count({ where });
  } catch (e: any) {
    console.error('[BACKFILL ZIP] DB offline or query failed:', e.message);
    process.exit(1);
  }
  console.log(`[BACKFILL ZIP] Customers with zipcode IS NULL: ${totalNull}`);

  if (totalNull === 0) {
    console.log('[BACKFILL ZIP] Nothing to do.');
    await prisma.$disconnect();
    return;
  }

  let offset = 0;
  let processed = 0;
  let matched = 0;
  let updated = 0;
  let skippedNoMatch = 0;

  while (offset < totalNull) {
    const batch = await prisma.customer.findMany({
      where,
      orderBy: { created_at: 'asc' },
      skip: offset,
      take: batchSize,
      select: {
        id: true,
        tenant_id: true,
        phone: true,
        name: true,
        kelurahan: true,
        kecamatan: true,
        kota: true,
        pending_kelurahan: true,
        pending_kecamatan: true,
        pending_kota: true,
        zipcode: true,
        pending_zipcode: true,
        preferences: true,
      },
    });

    if (batch.length === 0) break;

    for (const c of batch) {
      processed++;
      // Non-destruktif guard (double-check)
      if (c.zipcode) { skippedNoMatch++; continue; }

      const prefs: any = (c as any).preferences || {};
      const addr = (prefs.address || prefs.full_address || '') as string;
      const zip = resolveZipcode({
        kelurahan: (c.kelurahan || c.pending_kelurahan || '') as string,
        kecamatan: (c.kecamatan || c.pending_kecamatan || '') as string,
        kota: (c.kota || c.pending_kota || '') as string,
        text: `${c.name || ''} ${addr}`.trim(),
      });

      if (zip) {
        matched++;
        if (!dryRun) {
          try {
            // Non-destruktif: hanya update jika masih null (race-safe)
            const existing = await prisma.customer.findUnique({ where: { id: c.id }, select: { zipcode: true } });
            if (existing && !existing.zipcode) {
              await prisma.customer.update({ where: { id: c.id }, data: { zipcode: zip } });
              updated++;
            }
          } catch (e: any) {
            console.warn(`[BACKFILL ZIP] update failed for ${c.phone} (${c.id}):`, e.message);
          }
        } else {
          updated++; // count as would-update in dry-run
        }
        if (matched % 20 === 0) {
          console.log(`[BACKFILL ZIP] ... matched ${matched}/${processed} (last: ${c.phone} -> ${zip})`);
        }
      } else {
        skippedNoMatch++;
      }
    }

    offset += batchSize;
    // Progress log per batch
    console.log(`[BACKFILL ZIP] Batch ${Math.ceil(offset / batchSize)} done: processed=${processed} matched=${matched} updated=${updated} skipped=${skippedNoMatch}`);
  }

  console.log(`[BACKFILL ZIP] Selesai. TotalNull=${totalNull} processed=${processed} matched=${matched} updated=${updated} skipped=${skippedNoMatch} dryRun=${dryRun}`);
  if (dryRun) console.log('[BACKFILL ZIP] Dry-run mode — tidak ada data yang diubah. Jalankan tanpa --dry-run untuk apply.');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[BACKFILL ZIP] Fatal:', e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
