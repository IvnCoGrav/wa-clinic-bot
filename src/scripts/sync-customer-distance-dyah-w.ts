/**
 * sync-customer-distance-dyah-w.ts — Sinkronisasi jarak/ongkir Bunda Dyah W (6285736637725).
 * Menggunakan DeliveryService (ORS shortest + circuity cap) agar hasil selaras dengan engine.
 *
 * Usage:
 *   npx tsx src/scripts/sync-customer-distance-dyah-w.ts --dry-run [--tenant=default-tenant] [--phone=6285736637725]
 *   npx tsx src/scripts/sync-customer-distance-dyah-w.ts --commit  [--tenant=...] [--phone=...]
 *
 * Safety: default --dry-run (read-only). Butuh --commit eksplisit untuk tulis DB.
 * Idempoten: run kedua tanpa perubahan → 0 updated bila sudah sesuai.
 */
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { DeliveryService } from '../services/delivery.service';
import { clinicConfig } from '../config/clinic';

const isCommit = process.argv.includes('--commit');
const isDryRun = !isCommit;
const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
const phoneArg = process.argv.find((a) => a.startsWith('--phone='));
const tenantId = tenantArg ? tenantArg.split('=')[1]!.trim() : DEFAULT_TENANT_ID;
const targetPhoneDigits = (phoneArg ? phoneArg.split('=')[1] : '6285736637725').replace(/\D/g, '');

// Fallback bila customer lat/lng null di DB (jangan hardcode jarak, hitung ulang via deliveryService)
const FALLBACK_AIRLANGGA = { lat: -7.2729567, lng: 112.7607616 };

function normalizePhone(p: string): string {
  return p.replace(/\D/g, '');
}

async function main() {
  console.log(`[SYNC DYAH W] Mode: ${isDryRun ? 'DRY-RUN' : 'COMMIT'} | tenant=${tenantId} | phone=${targetPhoneDigits}`);
  if (isDryRun) console.log('[SYNC DYAH W] Read-only — tambah --commit untuk tulis DB.');

  // Cari customer by phone (tenant-aware, normalize digit)
  const candidates = await prisma.customer.findMany({
    where: { tenant_id: tenantId } as any,
  });
  const customer: any = candidates.find((c: any) => normalizePhone(c.phone) === targetPhoneDigits)
    || await prisma.customer.findFirst({ where: { phone: targetPhoneDigits } as any });

  if (!customer) {
    console.error(`[SYNC DYAH W] Customer phone ${targetPhoneDigits} tidak ditemukan (tenant ${tenantId}).`);
    console.log('[SYNC DYAH W] Daftar phone kandidat (5 pertama):', candidates.slice(0, 5).map((c: any) => c.phone));
    process.exit(1);
  }

  console.log(`[SYNC DYAH W] Customer: ${customer.name || '-'} | id=${customer.id} | phone=${customer.phone}`);
  console.log(`[SYNC DYAH W] DB sebelum: distance_km=${customer.distance_km} ongkir=${customer.ongkir} is_out_of_coverage=${customer.is_out_of_coverage} lat=${customer.lat} lng=${customer.lng}`);

  let custCoords: { lat: number; lng: number };
  let coordsSource = 'db';
  if (customer.lat != null && customer.lng != null && !isNaN(Number(customer.lat)) && !isNaN(Number(customer.lng))) {
    custCoords = { lat: Number(customer.lat), lng: Number(customer.lng) };
  } else {
    custCoords = FALLBACK_AIRLANGGA;
    coordsSource = 'fallback_airlangga';
    console.warn(`[SYNC DYAH W] Customer lat/lng kosong → pakai fallback Airlangga ${FALLBACK_AIRLANGGA.lat},${FALLBACK_AIRLANGGA.lng}`);
  }

  const clinicCoords = { lat: clinicConfig.lat, lng: clinicConfig.lng };
  const deliveryService = new DeliveryService();
  const result = await deliveryService.calculateDelivery(custCoords, clinicCoords, tenantId);

  console.log(`[SYNC DYAH W] DeliveryService result: distanceKm=${result.distanceKm} normalPrice=${result.normalPrice} promoPrice=${result.promoPrice} ongkir=${result.ongkir} isOutOfCoverage=${result.isOutOfCoverage} isEstimated=${result.isEstimated}`);
  console.log(`[SYNC DYAH W] Coords source: ${coordsSource} | Clinic [${clinicCoords.lat},${clinicCoords.lng}] -> Cust [${custCoords.lat},${custCoords.lng}]`);

  const expectedDistanceKm = result.distanceKm;
  const expectedOngkir = result.promoPrice;
  const expectedNormal = result.normalPrice;

  const alreadySynced =
    customer.distance_km === expectedDistanceKm &&
    customer.ongkir === expectedOngkir &&
    customer.is_out_of_coverage === result.isOutOfCoverage;

  if (alreadySynced) {
    console.log('[SYNC DYAH W] Sudah sinkron — tidak ada perubahan (idempoten).');
    return;
  }

  console.log(`[SYNC DYAH W] Diff: distance_km ${customer.distance_km} -> ${expectedDistanceKm} | ongkir ${customer.ongkir} -> ${expectedOngkir} (normal ${expectedNormal}) | out_of_coverage ${customer.is_out_of_coverage} -> ${result.isOutOfCoverage}`);
  // Bukti hemat tier: 16.85 (Tier5 Rp20000) vs 14.38/13.60 capped (Tier4 Rp15000)

  if (isDryRun) {
    console.log('[SYNC DYAH W] DRY-RUN selesai — jalankan ulang dengan --commit untuk tulis.');
    console.log(`[SYNC DYAH W] Perintah commit: npx tsx src/scripts/sync-customer-distance-dyah-w.ts --commit --tenant=${tenantId} --phone=${targetPhoneDigits}`);
    return;
  }

  const prevPrefs = (customer.preferences as Record<string, any>) || {};
  const mergedPrefs = {
    ...prevPrefs,
    distance_source: 'ORS-shortest+capped',
    distance_source_detail: `ORS preference=shortest, ORS_MAX_CIRCUITY_RATIO=${process.env.ORS_MAX_CIRCUITY_RATIO || process.env.HAVERSINE_CIRCUITY_FACTOR || '1.60'}, buffered=${expectedDistanceKm}`,
    distance_validated_at: new Date().toISOString(),
    distance_haversine_raw: custCoords ? undefined : undefined,
  };

  const updated = await prisma.customer.update({
    where: { id: customer.id },
    data: {
      distance_km: expectedDistanceKm,
      ongkir: expectedOngkir,
      is_out_of_coverage: result.isOutOfCoverage,
      preferences: mergedPrefs as any,
    } as any,
  });

  console.log(`[SYNC DYAH W] COMMIT OK: customer ${updated.id} distance_km=${(updated as any).distance_km} ongkir=${(updated as any).ongkir}`);
  console.log('[SYNC DYAH W] Rollback manual (jika perlu):', `distance_km=${customer.distance_km}, ongkir=${customer.ongkir}, is_out_of_coverage=${customer.is_out_of_coverage}`);
}

main().catch((e) => {
  console.error('[SYNC DYAH W] ERROR:', e?.message || e);
  process.exit(1);
});
