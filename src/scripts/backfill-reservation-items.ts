/**
 * Backfill Script: Reservation Items (Fase 3B)
 *
 * Mengonversi kolom `treatment_detail` pada tabel `reservations` ke baris-baris
 * relasional di tabel `reservation_items`, serta menautkan `service_id` dari katalog
 * `clinic_services`.
 *
 * Penggunaan:
 *   npx tsx src/scripts/backfill-reservation-items.ts [--dry-run]
 */

import { randomUUID } from 'crypto';
import { prisma } from '../db/client';
import { resolveTreatmentValue } from '../services/capi.service';

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  console.log(`[BACKFILL ITEMS] Starting... ${isDryRun ? '(DRY-RUN MODE)' : '(LIVE MODE)'}`);

  // Ambil katalog ClinicService untuk pencocokan service_id
  const catalogServices = await prisma.clinicService.findMany({
    select: {
      id: true,
      service_id: true,
      name: true,
      promo_price: true,
      original_price: true,
      duration_minutes: true,
      tenant_id: true,
    },
  });

  console.log(`[BACKFILL ITEMS] Loaded ${catalogServices.length} clinic services from catalog.`);

  const reservations = await prisma.reservation.findMany({
    select: {
      id: true,
      tenant_id: true,
      treatment_category: true,
      treatment_detail: true,
      duration_minutes: true,
      purchase_value: true,
      created_at: true,
      items: {
        select: { id: true },
      },
    },
  });

  console.log(`[BACKFILL ITEMS] Found ${reservations.length} total reservations.`);

  let createdItemsCount = 0;
  let skippedReservationsCount = 0;

  for (const res of reservations) {
    if (res.items && res.items.length > 0) {
      skippedReservationsCount++;
      continue;
    }

    const detailText = res.treatment_detail?.trim() || '';
    const rawNames = detailText
      ? detailText.split(/[,;\n+]/).map((s) => s.trim()).filter((s) => s.length > 0)
      : [res.treatment_category || 'Layanan Klinik'];

    const itemsToCreate = [];
    for (const name of rawNames) {
      // Cari padanan di katalog
      const matched = catalogServices.find(
        (s) =>
          s.tenant_id === res.tenant_id &&
          (s.name.toLowerCase() === name.toLowerCase() ||
            s.service_id.toLowerCase() === name.toLowerCase() ||
            name.toLowerCase().includes(s.name.toLowerCase()))
      );

      let price = 0;
      let duration = res.duration_minutes || 60;
      let serviceId: string | null = null;
      let finalName = name;

      if (matched) {
        serviceId = matched.id;
        price = matched.promo_price ?? matched.original_price ?? 0;
        duration = matched.duration_minutes ?? duration;
        finalName = matched.name;
      } else {
        // Fallback hitung harga dari CAPI resolver bila nama kustom
        const resolved = await resolveTreatmentValue(name, res.tenant_id);
        price = (resolved && resolved > 0) ? resolved : (res.purchase_value ? Math.round(res.purchase_value / rawNames.length) : 0);
      }

      itemsToCreate.push({
        id: randomUUID(),
        tenant_id: res.tenant_id,
        reservation_id: res.id,
        service_id: serviceId,
        custom_name: finalName,
        price: price,
        duration_minutes: duration,
        created_at: res.created_at,
      });
    }

    if (!isDryRun && itemsToCreate.length > 0) {
      await prisma.reservationItem.createMany({
        data: itemsToCreate,
      });
    }

    createdItemsCount += itemsToCreate.length;
  }

  console.log(`[BACKFILL ITEMS] Completed:
  - Created Reservation Items: ${createdItemsCount}
  - Skipped Reservations (Already Had Items): ${skippedReservationsCount}`);
}

main()
  .catch((e) => {
    console.error('[BACKFILL ITEMS ERROR]', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
