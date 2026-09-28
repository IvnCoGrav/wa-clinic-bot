/**
 * reconcile-customer-locations-and-reservations.ts
 *
 * Skrip rekonsiliasi data produksi untuk:
 * 1. Memulihkan 5 customer Sidoarjo/Waru yang terjebak di sentroid Suko akibat city-homonym bug lama.
 * 2. Menyelesaikan jarak & ongkir untuk customer yang memiliki distance_km NULL.
 * 3. Memperbaiki duration_minutes NULL pada reservasi aktif.
 *
 * Usage:
 *   npx tsx src/scripts/reconcile-customer-locations-and-reservations.ts --dry-run
 *   npx tsx src/scripts/reconcile-customer-locations-and-reservations.ts --commit
 */
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { customerService } from '../services/customer.service';
import { treatmentCatalogService } from '../services/treatment-catalog.service';

const isCommit = process.argv.includes('--commit');
const isDryRun = !isCommit;
const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
const tenantId = tenantArg ? tenantArg.split('=')[1]!.trim() : DEFAULT_TENANT_ID;

// Target customer yang teridentifikasi anomali di basis data
const TARGET_CUSTOMER_IDS = [
  // 5 Customer sentroid Suko (-7.44615, 112.678558)
  '05628f5a-6eaf-494c-a073-38511df8737f', // Bunda Ella, Damarsih
  '35771e6b-fb29-4501-8d1d-e80a5a3a4248', // Bunda Windy Ariesta waru
  '6ac8d887-6cc8-40c6-98d5-82ce46da5eba', // Bunda riskaamana Waru
  'c8497a43-e6e6-4ccf-b67b-dd920864e8a9', // Bunda Nara Little Ummaya Daycare Waru
  '0886a60b-5438-466c-a308-b0948f8b1541', // Bunda Ayu Bulusidokare

  // 4 Customer dengan distance_km = null pada reservasi aktif
  'f7e9857f-65de-4430-9e44-15e60c549213', // Bunda Fitriana Waru
  'fa1ec752-7855-4048-8c62-bd2545e46bdc', // Bunda Briella
  'dd4a31c9-04cf-4685-a2a3-07a4988650cc', // Bunda Christine Citraland Wiyung
  '3567c739-4919-4945-8eae-551783e40a14', // Bunda Fierda Wiyung, Apart CBD
];

// Target reservasi dengan durasi null
const TARGET_NULL_DURATION_RESERVATIONS = [
  '0b2ed8ca-d9e1-44bf-ba1d-1cb0c8c0c333', // Bunda Irlandia Sahara ("Pijat lahap juara")
];

async function main() {
  console.log(`\n======================================================`);
  console.log(`[RECONCILIATION] Mode: ${isDryRun ? 'DRY-RUN (READ-ONLY)' : 'COMMIT (MENULIS KE DB)'}`);
  console.log(`[RECONCILIATION] Tenant: ${tenantId}`);
  console.log(`======================================================\n`);

  // 1. Rekonsiliasi Lokasi Customer
  console.log(`--- [1/2] Rekonsiliasi Lokasi Customer (${TARGET_CUSTOMER_IDS.length} target) ---`);
  let successCount = 0;
  let failCount = 0;

  for (const custId of TARGET_CUSTOMER_IDS) {
    try {
      const cust = await prisma.customer.findFirst({
        where: { id: custId, tenant_id: tenantId },
      });
      if (!cust) {
        console.warn(`[WARN] Customer id=${custId} tidak ditemukan di database.`);
        continue;
      }

      console.log(`\nCustomer: "${cust.name}" (${cust.phone})`);
      console.log(`  Kondisi saat ini: kelurahan=${cust.kelurahan || '-'}, kec=${cust.kecamatan || '-'}, kota=${cust.kota || '-'}, lat=${cust.lat}, lng=${cust.lng}, dist=${cust.distance_km} km, ongkir=Rp ${cust.ongkir}`);

      if (isDryRun) {
        console.log(`  [DRY-RUN] Akan menjalankan refreshCustomerLocation via Gazetteer & DeliveryService...`);
        successCount++;
      } else {
        const res = await customerService.refreshCustomerLocationAndOngkir(custId, tenantId, 'system_reconciliation');
        if (res.success && res.data) {
          console.log(`  [UPDATED] Berhasil direkonsiliasi:`);
          console.log(`    -> Kel: ${res.data.kelurahan || '-'}, Kec: ${res.data.kecamatan || '-'}, Kota: ${res.data.kota || '-'}`);
          console.log(`    -> Lat/Lng: ${res.data.lat}, ${res.data.lng}`);
          console.log(`    -> Jarak: ${res.data.distanceKm} km, Ongkir: Rp ${res.data.ongkir}`);
          successCount++;
        } else {
          console.error(`  [FAILED] Gagal refresh: ${res.error || 'Unknown error'}`);
          failCount++;
        }
      }
    } catch (err: any) {
      console.error(`  [ERROR] Exception saat memproses customer ${custId}:`, err.message);
      failCount++;
    }
  }

  // 2. Rekonsiliasi Durasi Reservasi
  console.log(`\n--- [2/2] Rekonsiliasi Durasi Reservasi (${TARGET_NULL_DURATION_RESERVATIONS.length} target) ---`);
  for (const resId of TARGET_NULL_DURATION_RESERVATIONS) {
    try {
      const resv = await prisma.reservation.findFirst({
        where: { id: resId, tenant_id: tenantId },
      });
      if (!resv) {
        console.warn(`[WARN] Reservasi id=${resId} tidak ditemukan.`);
        continue;
      }

      console.log(`Reservasi: id=${resv.id} | treatment="${resv.treatment_detail}" | durasi saat ini: ${resv.duration_minutes ?? 'NULL'}`);
      if (resv.duration_minutes == null) {
        // Data-driven: durasi diresolusi dari katalog kanonis (Single Source of
        // Truth), BUKAN angka mati 60. Bila teks layanan tak dikenali katalog,
        // breakdown.confident=false → JANGAN tulis tebakan (anti-fabrikasi data).
        const breakdown = treatmentCatalogService.resolveDurationBreakdown(resv.treatment_detail, tenantId);
        if (!breakdown.confident && !breakdown.usedExplicitTag) {
          console.warn(`  [SKIP] Teks layanan "${resv.treatment_detail}" tidak dikenali katalog — durasi TIDAK diisi (anti-fabrikasi).`);
          failCount++;
          continue;
        }
        const resolvedDuration = breakdown.totalMinutes;
        if (isDryRun) {
          console.log(`  [DRY-RUN] Akan mengupdate duration_minutes -> ${resolvedDuration} (dari katalog kanonis).`);
        } else {
          await prisma.reservation.update({
            where: { id: resId, tenant_id: tenantId },
            data: { duration_minutes: resolvedDuration },
          });
          console.log(`  [UPDATED] duration_minutes berhasil diset ke ${resolvedDuration} menit (katalog kanonis).`);
        }
      } else {
        console.log(`  [OK] Durasi sudah terisi (${resv.duration_minutes}m).`);
      }
    } catch (err: any) {
      console.error(`  [ERROR] Exception pada reservasi ${resId}:`, err.message);
    }
  }

  console.log(`\n======================================================`);
  console.log(`[RECONCILIATION SELESAI] Sukses: ${successCount}, Gagal: ${failCount}`);
  if (isDryRun) {
    console.log(`Catatan: Ini adalah DRY-RUN. Jalankan dengan --commit untuk menerapkan ke database.`);
  }
  console.log(`======================================================\n`);
}

main()
  .catch((e) => {
    console.error('Fatal reconciliation error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
