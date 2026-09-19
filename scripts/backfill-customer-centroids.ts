#!/usr/bin/env tsx
/**
 * Backfill koordinat sentroid untuk customer yang lat/lng-nya NULL namun
 * memiliki nama kelurahan/kecamatan. Koordinat diambil dari gazetteer lokal
 * (Surabaya & Sidoarjo). Non-destruktif: hanya mengisi yang lat IS NULL.
 *
 * Catatan cakupan: gazetteer TIDAK mencakup Gresik, sehingga customer Gresik
 * akan dilewati (skipped-no-gazetteer) — lihat docs/KNOWN_ISSUES.md.
 *
 * Usage:
 *   npx tsx scripts/backfill-customer-centroids.ts           # live update
 *   npx tsx scripts/backfill-customer-centroids.ts --dry-run # simulasi only
 *   npx tsx scripts/backfill-customer-centroids.ts --tenant=default-tenant
 */

import { prisma } from '../src/db/client';
import { DEFAULT_TENANT_ID } from '../src/config/tenant';
import { getGazetteerCoordinates } from '../src/utils/gazetteer';
import { isValidAreaName, normalizeWilayahText } from '../src/utils/wilayah-normalizer';
import { customerService } from '../src/services/customer.service';
import { deliveryService } from '../src/services/delivery.service';
import { getClinicLocationAsync } from '../src/config/clinic-location';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const tenantArg = args.find((a) => a.startsWith('--tenant='));
  const tenantId = tenantArg ? tenantArg.split('=')[1] : DEFAULT_TENANT_ID;
  const batchSize = 200;

  console.log(`[BACKFILL CENTROID] Start — dryRun=${dryRun} tenant=${tenantId}`);

  const clinic = await getClinicLocationAsync(tenantId);

  const where: any = { tenant_id: tenantId, is_sandbox_test: false, lat: null, lng: null };
  let total: number;
  try {
    total = await prisma.customer.count({ where });
  } catch (e: any) {
    console.error('[BACKFILL CENTROID] DB offline / query gagal:', e.message);
    process.exit(1);
  }
  console.log(`[BACKFILL CENTROID] Customer lat NULL: ${total}`);

  if (total === 0) {
    console.log('[BACKFILL CENTROID] Tidak ada yang perlu diproses.');
    await prisma.$disconnect();
    return;
  }

  let scanned = 0;
  let matched = 0;
  let updated = 0;
  let skippedInvalidArea = 0;
  let skippedNoGazetteer = 0;

  // Cursor-based pagination: `where` menyaring lat NULL, sehingga record yang
  // baru di-update keluar dari hasil query. Memakai skip/offset akan melewati
  // record. Gunakan `id > lastId` agar stabil terhadap mutasi selama iterasi.
  let lastId = '';
  while (true) {
    const batch = await prisma.customer.findMany({
      where: { ...where, id: { gt: lastId } },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true, kelurahan: true, kecamatan: true, kota: true, name: true },
    });
    if (batch.length === 0) break;
    lastId = batch[batch.length - 1].id;

    for (const c of batch) {
      scanned++;
      const kelurahan = isValidAreaName(c.kelurahan) ? normalizeWilayahText(c.kelurahan) : null;
      const kecamatan = isValidAreaName(c.kecamatan) ? normalizeWilayahText(c.kecamatan) : null;
      if (!kelurahan && !kecamatan) {
        skippedInvalidArea++;
        continue;
      }

      const gaz = getGazetteerCoordinates(kelurahan || kecamatan || '');
      if (!gaz || !Number.isFinite(gaz.lat) || !Number.isFinite(gaz.lng)) {
        skippedNoGazetteer++;
        continue;
      }
      matched++;

      const delivery = await deliveryService.calculateDelivery(
        { lat: gaz.lat, lng: gaz.lng },
        { lat: clinic.lat, lng: clinic.lng },
        tenantId
      );

      if (dryRun) {
        console.log(
          `  [DRY] ${c.id} "${c.name || '-'}" → ${kelurahan || kecamatan} (${gaz.lat.toFixed(5)},${gaz.lng.toFixed(5)}) ${delivery.distanceKm}km`
        );
        continue;
      }

      try {
        await customerService.updateCustomerLocation(
          c.id,
          {
            lat: gaz.lat,
            lng: gaz.lng,
            distanceKm: delivery.distanceKm,
            ongkir: delivery.ongkir,
            isOutOfCoverage: delivery.isOutOfCoverage,
          },
          tenantId
        );
        updated++;
      } catch (e: any) {
        console.warn(`  [WARN] gagal update ${c.id}: ${e.message}`);
      }
    }
  }

  console.log('[BACKFILL CENTROID] Selesai:');
  console.log(`  scanned            : ${scanned}`);
  console.log(`  matched gazetteer  : ${matched}`);
  console.log(`  updated            : ${dryRun ? 0 : updated}`);
  console.log(`  skipped (area invalid): ${skippedInvalidArea}`);
  console.log(`  skipped (no gazetteer / di luar Sby-Sda): ${skippedNoGazetteer}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('[BACKFILL CENTROID] Fatal:', e);
  process.exit(1);
});
