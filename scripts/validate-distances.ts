/**
 * Script Validasi & Re-kalkulasi Jarak/Ongkir via ORS
 * Scope: 55 data — Grup A (kelurahan+distance kosong) + Grup B (kelurahan+distance ada tapi shareloc false + lat ada)
 *Instruksi user: yang belum ada koordinat gunakan DB yang sudah ada koordinatnya untuk selanjutnya dihitung ORS
 *
 * Usage:
 *   npx tsx src/scripts/validate-distances.ts --dry-run            # audit only, tidak tulis DB
 *   npx tsx src/scripts/validate-distances.ts --apply               # tulis DB
 *   npx tsx src/scripts/validate-distances.ts --dry-run --limit=5   # sample
 *   npx tsx src/scripts/validate-distances.ts --apply --only-missing # hanya Grup A
 */
import dotenv from 'dotenv';
dotenv.config();

import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { clinicConfig } from '../config/clinic';
import { deliveryService } from '../services/delivery.service';
import { calculateHaversineDistance } from '../utils/haversine';
import { geocodingService } from '../integrations/google-maps/geocoding';

const args = process.argv.slice(2);
const isDryRun = !args.includes('--apply');
const onlyMissing = args.includes('--only-missing');
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 0;

async function findCoordsFromDbByKelurahan(kelurahan: string, kecamatan?: string | null): Promise<{ lat: number; lng: number } | null> {
  // Cari di DB customers yang sudah punya koordinat untuk kelurahan yang sama
  const where: any = {
    tenant_id: DEFAULT_TENANT_ID,
    kelurahan: { equals: kelurahan, mode: 'insensitive' },
    lat: { not: null },
    lng: { not: null },
  };
  if (kecamatan) where.kecamatan = { equals: kecamatan, mode: 'insensitive' };
  const donor = await prisma.customer.findFirst({
    where,
    select: { lat: true, lng: true, kelurahan: true, kecamatan: true },
    orderBy: { updated_at: 'desc' },
  });
  if (donor?.lat != null && donor?.lng != null) return { lat: donor.lat, lng: donor.lng };
  // Fallback tanpa kecamatan
  if (kecamatan) {
    const donor2 = await prisma.customer.findFirst({
      where: {
        tenant_id: DEFAULT_TENANT_ID,
        kelurahan: { equals: kelurahan, mode: 'insensitive' },
        lat: { not: null },
        lng: { not: null },
      },
      select: { lat: true, lng: true },
      orderBy: { updated_at: 'desc' },
    });
    if (donor2?.lat != null && donor2?.lng != null) return { lat: donor2.lat, lng: donor2.lng };
  }
  return null;
}

async function resolveCoordsForCustomer(c: any): Promise<{ lat: number; lng: number; source: string } | null> {
  if (c.lat != null && c.lng != null) return { lat: c.lat, lng: c.lng, source: 'existing_latlng' };

  // 1) Coba donor dari DB customers yang sudah ada koordinat untuk kelurahan yang sama
  const donor = await findCoordsFromDbByKelurahan(c.kelurahan, c.kecamatan);
  if (donor) return { lat: donor.lat, lng: donor.lng, source: 'db_donor_kelurahan' };

  // 2) Fallback gazetteer via geocodingService (surabaya_sidoarjo_subdistricts.json)
  const query = [c.kelurahan, c.kecamatan, c.kota].filter(Boolean).join(', ');
  if (query) {
    try {
      const geo = await geocodingService.geocodeText(query);
      if (geo.isPrecise && geo.lat != null && geo.lng != null) {
        return { lat: geo.lat, lng: geo.lng, source: `gazetteer:${geo.kelurahan}` };
      }
      // Coba hanya kelurahan
      const geo2 = await geocodingService.geocodeText(c.kelurahan);
      if (geo2.isPrecise && geo2.lat != null && geo2.lng != null) {
        return { lat: geo2.lat, lng: geo2.lng, source: `gazetteer:kelurahan_only:${geo2.kelurahan}` };
      }
    } catch (e: any) {
      console.warn(`[GEOCODE] gagal untuk ${c.phone} query "${query}": ${e.message}`);
    }
  }
  return null;
}

async function main() {
  console.log(`=== Validate Distances — ${isDryRun ? 'DRY-RUN' : 'APPLY'} ===`);
  console.log(`Clinic: ${clinicConfig.lat}, ${clinicConfig.lng} (${clinicConfig.name})`);
  console.log(`Target: Grup A (kelurahan+distance kosong=23) + Grup B (kelurahan+distance ada+shareloc false+lat ada=32) = 55`);
  if (onlyMissing) console.log('Mode: --only-missing (hanya Grup A)');
  if (limit) console.log(`Limit: ${limit}`);

  // Grup A: kelurahan NOT NULL AND distance_km IS NULL
  const grupA = await prisma.customer.findMany({
    where: {
      tenant_id: DEFAULT_TENANT_ID,
      is_sandbox_test: false,
      kelurahan: { not: null },
      distance_km: null,
    },
    select: { id: true, phone: true, kelurahan: true, kecamatan: true, kota: true, lat: true, lng: true, distance_km: true, ongkir: true, share_location_sent: true, preferences: true },
  });
  // Filter kelurahan <> ''
  const grupAFiltered = grupA.filter(c => c.kelurahan && c.kelurahan.trim() !== '');
  console.log(`Grup A fetched: ${grupAFiltered.length} (raw ${grupA.length})`);

  let grupBFiltered: any[] = [];
  if (!onlyMissing) {
    const grupB = await prisma.customer.findMany({
      where: {
        tenant_id: DEFAULT_TENANT_ID,
        is_sandbox_test: false,
        kelurahan: { not: null },
        distance_km: { not: null },
        share_location_sent: false,
        lat: { not: null },
        lng: { not: null },
      },
      select: { id: true, phone: true, kelurahan: true, kecamatan: true, kota: true, lat: true, lng: true, distance_km: true, ongkir: true, share_location_sent: true, preferences: true },
    });
    grupBFiltered = grupB.filter(c => c.kelurahan && c.kelurahan.trim() !== '');
    console.log(`Grup B fetched: ${grupBFiltered.length} (raw ${grupB.length})`);
  }

  let targets = [...grupAFiltered, ...grupBFiltered];
  // Deduplicate by id
  const seen = new Set<string>();
  targets = targets.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });
  if (limit) targets = targets.slice(0, limit);
  console.log(`Total targets: ${targets.length}`);

  let updated = 0;
  let skippedNoCoords = 0;
  let skippedNoChange = 0;
  let skippedOngkirSameTier = 0;
  let errors = 0;

  for (let i = 0; i < targets.length; i++) {
    const c = targets[i];
    const isGrupA = c.distance_km == null;
    console.log(`\n[${i+1}/${targets.length}] ${c.phone} | ${c.kelurahan}, ${c.kecamatan || '-'} | lat=${c.lat} lng=${c.lng} | dist_db=${c.distance_km} ongkir_db=${c.ongkir} | grup=${isGrupA ? 'A' : 'B'}`);

    // Resolve coords
    let coords: { lat: number; lng: number; source: string } | null = null;
    if (c.lat != null && c.lng != null) {
      coords = { lat: c.lat, lng: c.lng, source: 'existing_latlng' };
    } else {
      coords = await resolveCoordsForCustomer(c);
      if (!coords) {
        console.log(`  -> SKIP: tidak bisa resolve koordinat (tidak ada donor DB/gazetteer)`);
        skippedNoCoords++;
        continue;
      }
      console.log(`  -> resolved coords via ${coords.source}: ${coords.lat}, ${coords.lng}`);
    }

    // Hitung via deliveryService (ORS -> Google -> Haversine)
    let result: any;
    try {
      result = await deliveryService.calculateDelivery({ lat: coords.lat, lng: coords.lng }, { lat: clinicConfig.lat, lng: clinicConfig.lng }, DEFAULT_TENANT_ID);
    } catch (e: any) {
      console.warn(`  -> ERROR deliveryService: ${e.message}`);
      errors++;
      continue;
    }

    const haversineRaw = calculateHaversineDistance({ lat: clinicConfig.lat, lng: clinicConfig.lng }, { lat: coords.lat, lng: coords.lng });
    const haversineEst = parseFloat((haversineRaw * 1.6).toFixed(2));
    const deltaVsHaversine = c.distance_km != null ? Math.abs(c.distance_km - haversineEst) : null;
    const likelyPrevHaversine = deltaVsHaversine != null ? deltaVsHaversine < 0.05 : false;

    console.log(`  -> ORS/Google/Haversine result: distance=${result.distanceKm}km (raw haversine ${haversineRaw} -> est ${haversineEst}), ongkir=${result.ongkir} (normal ${result.normalPrice}), isEstimated=${result.isEstimated}, likelyPrevHaversine=${likelyPrevHaversine} delta=${deltaVsHaversine}`);

    // Flag anomali: jarak baru >30km (OOC) tapi jarak lama <30km dengan delta >20km -> skip manual review (contoh Manukan Kalitidu Bojonegoro)
    if (c.distance_km != null && result.distanceKm > 30 && c.distance_km < 30 && Math.abs(result.distanceKm - c.distance_km) > 20) {
      console.log(`  -> SKIP ANOMALI: jarak baru ${result.distanceKm}km OOC tapi lama ${c.distance_km}km — delta >20km, perlu review manual, tidak auto-update`);
      skippedNoCoords++;
      continue;
    }

    // Untuk Grup B, hanya update jika beda tier (ongkir) atau delta >0.5km
    if (!isGrupA && c.distance_km != null) {
      const ongkirSame = c.ongkir === result.ongkir;
      const distDelta = Math.abs(c.distance_km - result.distanceKm);
      if (ongkirSame && distDelta < 0.5) {
        console.log(`  -> SKIP Grup B: ongkir sama (${c.ongkir}) dan delta jarak ${distDelta.toFixed(2)} <0.5km — tidak perlu update`);
        skippedOngkirSameTier++;
        continue;
      }
      console.log(`  -> Grup B perlu update: ongkir ${c.ongkir} -> ${result.ongkir}, delta ${distDelta.toFixed(2)}km`);
    }

    // Untuk Grup A, distance_null pasti update jika coords ada
    if (isDryRun) {
      console.log(`  -> DRY-RUN: would update ${c.phone} distance ${c.distance_km} -> ${result.distanceKm}, ongkir ${c.ongkir} -> ${result.ongkir}, lat ${c.lat} -> ${coords.lat} (source ${coords.source})`);
      updated++; // hitung sebagai would-update
    } else {
      try {
        const existingPrefs = (c.preferences as any) || {};
        const newPrefs = {
          ...existingPrefs,
          distance_source: result.isEstimated ? 'HAVERSINE' : 'ORS',
          distance_source_detail: coords.source,
          distance_validated_at: new Date().toISOString(),
          distance_haversine_raw: haversineRaw,
          distance_haversine_est: haversineEst,
        };
        await prisma.customer.update({
          where: { id: c.id },
          data: {
            // Jika coords dari donor/gazetteer dan DB kosong, isi lat/lng
            ...(c.lat == null && c.lng == null ? { lat: coords.lat, lng: coords.lng, kelurahan: c.kelurahan, kecamatan: c.kecamatan, kota: c.kota } : {}),
            distance_km: result.distanceKm,
            ongkir: result.ongkir,
            is_out_of_coverage: result.isOutOfCoverage,
            preferences: newPrefs,
          },
        });
        console.log(`  -> UPDATED DB: ${c.phone}`);
        updated++;
      } catch (e: any) {
        console.warn(`  -> UPDATE FAILED ${c.phone}: ${e.message}`);
        errors++;
      }
    }

    // Throttle untuk ORS 40 req/min -> 3s per 10 batch (hindari Rate Limit)
    if ((i + 1) % 10 === 0 && i < targets.length - 1) {
      console.log(`  ... throttling 3000ms after 10 requests (hindari ORS 40/min) ...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Targets: ${targets.length}`);
  console.log(`Would-update/Updated: ${updated}`);
  console.log(`Skipped no coords: ${skippedNoCoords}`);
  console.log(`Skipped Grup B same tier: ${skippedOngkirSameTier}`);
  console.log(`Errors: ${errors}`);
  console.log(`Mode: ${isDryRun ? 'DRY-RUN (tidak ada tulis DB). Jalankan dengan --apply untuk apply.' : 'APPLY (sudah tulis DB)'}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
