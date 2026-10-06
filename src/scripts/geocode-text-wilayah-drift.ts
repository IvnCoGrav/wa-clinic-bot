/**
 * geocode-text-wilayah-drift.ts
 *
 * Rekonsiliasi IDEMPOTEN untuk pelanggan yang KOLOM TEKS wilayahnya sudah benar
 * (mis. kelurahan="Berbek", kecamatan="Waru") tetapi KOORDINAT tersimpan masih
 * tersangkut di wilayah lain (mis. sentroid Suko — insiden Bunda Chris
 * 6281390541340, sisa bug hijack toponimi). Koordinat dimaksud dihitung ULANG
 * dari teks resmi via geocoding (bukan angka hardcode), lalu jarak/ongkir
 * dihitung via DeliveryService (tenant-aware, tier DB).
 *
 * Sifat:
 * - DEFAULT = DRY-RUN (read-only, TIDAK menulis apa pun).
 * - Hanya menulis dengan flag eksplisit `--commit`.
 * - TIDAK menyentuh pin PRESISI (`location_source='gps_pin'` atau
 *   `share_location_sent=true`) — otoritas GPS di atas teks.
 * - Hanya menulis bila drift >= `--min-drift-km` (default 0.5) agar idempoten.
 *
 * Usage:
 *   npx tsx src/scripts/geocode-text-wilayah-drift.ts --phone=6281390541340
 *   npx tsx src/scripts/geocode-text-wilayah-drift.ts --phone=6281390541340 --commit
 *   npx tsx src/scripts/geocode-text-wilayah-drift.ts --tenant=default-tenant [--commit]
 */
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { geocodingService } from '../integrations/google-maps/geocoding';
import { deliveryService } from '../services/delivery.service';
import { haversineKm } from '../utils/gazetteer';
import { LocationSource } from '@prisma/client';

const isCommit = process.argv.includes('--commit');
const phoneArg = process.argv.find((a) => a.startsWith('--phone='));
const phone = phoneArg ? phoneArg.split('=')[1]!.trim() : undefined;
const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
const tenantId = tenantArg ? tenantArg.split('=')[1]!.trim() : DEFAULT_TENANT_ID;
const minDriftArg = process.argv.find((a) => a.startsWith('--min-drift-km='));
const minDriftKm = minDriftArg ? Math.max(0, parseFloat(minDriftArg.split('=')[1]!) || 0) : 0.5;

async function main() {
  console.log(`\n======================================================`);
  console.log(`[GEOCODE-TEXT-WILAYAH-DRIFT] Mode: ${isCommit ? 'COMMIT (MENULIS DB)' : 'DRY-RUN (READ-ONLY)'}`);
  console.log(`[GEOCODE-TEXT-WILAYAH-DRIFT] tenant=${tenantId} phone=${phone || '(semua)'} minDrift=${minDriftKm}km`);
  console.log(`======================================================\n`);

  const rows = await prisma.customer.findMany({
    where: { tenant_id: tenantId, deleted_at: null, ...(phone ? { phone } : {}) },
    select: {
      id: true, phone: true, name: true, kelurahan: true, kecamatan: true, kota: true,
      lat: true, lng: true, distance_km: true, ongkir: true,
      location_source: true, share_location_sent: true,
    },
  });

  let checked = 0;
  let candidates = 0;
  let updated = 0;
  let skippedPrecise = 0;

  for (const c of rows) {
    checked++;
    const isPrecise =
      c.location_source === LocationSource.gps_pin || c.share_location_sent === true;
    if (isPrecise) {
      skippedPrecise++;
      continue;
    }

    const query = [c.kelurahan, c.kecamatan, c.kota].filter(Boolean).join(', ').trim();
    if (!query) continue;

    const geo = await geocodingService.geocodeText(query);
    if (!geo.isPrecise || geo.lat == null || geo.lng == null) {
      console.log(`[SKIP geocode tak presisi] ${c.phone} "${query}"`);
      continue;
    }

    const drift =
      c.lat != null && c.lng != null ? haversineKm(c.lat, c.lng, geo.lat, geo.lng) : Infinity;

    if (drift < minDriftKm) continue; // sudah sinkron (idempoten)

    const delivery = await deliveryService.calculateDelivery({ lat: geo.lat, lng: geo.lng }, undefined, tenantId);
    candidates++;
    console.log(`[DRIFT ${drift === Infinity ? '?' : drift.toFixed(2)}km] ${c.name} (${c.phone})`);
    console.log(`  teks    : ${query}`);
    console.log(`  koord lama: ${c.lat},${c.lng} | ${c.distance_km}km Rp${c.ongkir}`);
    console.log(`  koord baru: ${geo.lat},${geo.lng} | ${delivery.distanceKm}km Rp${delivery.ongkir}`);

    if (isCommit) {
      await prisma.customer.update({
        where: { id: c.id },
        data: {
          lat: geo.lat,
          lng: geo.lng,
          distance_km: delivery.distanceKm,
          ongkir: delivery.ongkir,
          is_out_of_coverage: delivery.isOutOfCoverage,
          location_source: LocationSource.manual_staff,
        },
      });
      updated++;
      console.log(`  [UPDATED]`);
    }
  }

  console.log(`\n======================================================`);
  console.log(`[RINGKASAN] diperiksa=${checked} | kandidat drift=${candidates} | diperbarui=${updated} | skip presisi=${skippedPrecise}`);
  if (!isCommit) console.log(`[DRY-RUN] Tidak ada perubahan ditulis. Jalankan ulang dengan --commit.`);
  console.log(`======================================================\n`);
}

main()
  .catch((e) => { console.error('Fatal error:', e?.message || e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect().catch(() => {}); });
