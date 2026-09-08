/**
 * Koreksi data Bunda Gita (6282232833258) ke titik GPS Shareloc asli.
 * Menjalankan: npx tsx src/scripts/fix-bunda-gita.ts --apply
 * Dry-run (default): npx tsx src/scripts/fix-bunda-gita.ts
 */
import { prisma } from '../db/client';
import { deliveryService } from '../services/delivery.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';

const CUSTOMER_ID = '58bb55d3-6508-4db6-b240-2eb853ce8046';
const CUSTOMER_PHONE = '6282232833258';
const TARGET_LAT = -7.469139575958252;
const TARGET_LNG = 112.71034240722656;
const EXPECTED_DISTANCE = 21.67;
const EXPECTED_ONGKIR = 25000;

async function main() {
  const isApply = process.argv.includes('--apply');
  console.log(`[FIX BUNDA GITA] mode=${isApply ? 'APPLY' : 'DRY-RUN'} customer=${CUSTOMER_PHONE} id=${CUSTOMER_ID}`);

  let customer: any = null;
  try {
    customer = await prisma.customer.findFirst({ where: { OR: [{ id: CUSTOMER_ID }, { phone: CUSTOMER_PHONE }] } });
  } catch (e: any) {
    console.warn('[FIX] DB offline, simulasi perhitungan jarak via deliveryService');
  }

  // Kalkulasi jarak via deliveryService (ORS -> Google -> Haversine) untuk verifikasi tier
  let calc: any = null;
  try {
    calc = await deliveryService.calculateDelivery({ lat: TARGET_LAT, lng: TARGET_LNG }, undefined, DEFAULT_TENANT_ID);
    console.log(`[CALC] distance=${calc.distanceKm}km ongkir=${calc.ongkir} (normal ${calc.normalPrice} promo ${calc.promoDiscount}) tier=${calc.isOutOfCoverage ? 'OOC' : 'OK'}`);
  } catch (e: any) {
    console.warn('[CALC] gagal kalkulasi:', e.message);
    calc = { distanceKm: EXPECTED_DISTANCE, ongkir: EXPECTED_ONGKIR, normalPrice: 30000, promoDiscount: 5000 };
  }

  const finalDistance = calc ? calc.distanceKm : EXPECTED_DISTANCE;
  const finalOngkir = calc ? calc.ongkir : EXPECTED_ONGKIR;

  console.log(`[TARGET] lat=${TARGET_LAT} lng=${TARGET_LNG} distance=${finalDistance} ongkir=${finalOngkir}`);
  if (customer) {
    console.log(`[EXISTING] lat=${customer.lat} lng=${customer.lng} distance=${customer.distance_km} ongkir=${customer.ongkir} shareloc=${customer.share_location_sent}`);
  }

  if (!isApply) {
    console.log('[DRY-RUN] Tambahkan --apply untuk menulis ke DB. Contoh: npx tsx src/scripts/fix-bunda-gita.ts --apply');
    return;
  }

  try {
    const updated = await prisma.customer.update({
      where: { id: CUSTOMER_ID },
      data: {
        lat: TARGET_LAT,
        lng: TARGET_LNG,
        distance_km: finalDistance,
        ongkir: finalOngkir,
        is_out_of_coverage: false,
        share_location_sent: true,
      },
    });
    console.log(`[APPLIED] Customer ${updated.phone} disinkron ke GPS pin asli: ${updated.lat}, ${updated.lng} distance=${updated.distance_km} ongkir=${updated.ongkir}`);

    // Opsional: sinkronkan alamat teks jika perlu via reverseGeocode
    try {
      const { geocodingService } = await import('../integrations/google-maps/geocoding');
      const rev = await geocodingService.reverseGeocode(TARGET_LAT, TARGET_LNG);
      if (rev.kelurahan || rev.kecamatan) {
        await prisma.customer.update({
          where: { id: CUSTOMER_ID },
          data: {
            kelurahan: rev.kelurahan || undefined,
            kecamatan: rev.kecamatan || undefined,
            kota: rev.kota || undefined,
            zipcode: rev.zipcode || undefined,
          },
        });
        console.log(`[REV GEOCODE] kelurahan=${rev.kelurahan} kec=${rev.kecamatan} kota=${rev.kota}`);
      }
    } catch {}
  } catch (e: any) {
    console.error('[APPLY FAILED]', e.message);
    console.log(`[MANUAL SQL FALLBACK] Jalankan di psql:\nUPDATE customers SET lat=${TARGET_LAT}, lng=${TARGET_LNG}, distance_km=${finalDistance}, ongkir=${finalOngkir}, share_location_sent=true, is_out_of_coverage=false WHERE id='${CUSTOMER_ID}' OR phone='${CUSTOMER_PHONE}';`);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
