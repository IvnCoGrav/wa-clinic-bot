/**
 * Backfill Script: Customer Address (Fase 3B)
 *
 * Mengonversi data alamat historis Customer (kolom root & preferences.saved_addresses)
 * ke tabel relasional `customer_addresses`, serta menautkan `reservations.customer_address_id`.
 *
 * Penggunaan:
 *   npx tsx src/scripts/backfill-customer-addresses.ts [--dry-run]
 */

import { randomUUID } from 'crypto';
import { prisma } from '../db/client';
import { ensureSinglePrimary, addressesMatch, UpsertSavedAddressInput } from '../domain/customer-address';
import { extractAddressFromRawText } from '../utils/reservation-address';

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  console.log(`[BACKFILL ADDRESSES] Starting... ${isDryRun ? '(DRY-RUN MODE)' : '(LIVE MODE)'}`);

  const customers = await prisma.customer.findMany({
    select: {
      id: true,
      tenant_id: true,
      kelurahan: true,
      kecamatan: true,
      kota: true,
      lat: true,
      lng: true,
      distance_km: true,
      ongkir: true,
      share_location_sent: true,
      preferences: true,
      created_at: true,
      updated_at: true,
    },
  });

  console.log(`[BACKFILL ADDRESSES] Found ${customers.length} total customers.`);

  let createdAddressesCount = 0;
  let linkedReservationsCount = 0;
  let skippedCustomersCount = 0;

  for (const customer of customers) {
    // 1. Cek apakah customer sudah memiliki entri di customer_addresses
    const existing = await prisma.customerAddress.findMany({
      where: { customer_id: customer.id },
    });

    if (existing.length > 0) {
      skippedCustomersCount++;
      continue;
    }

    const prefs = (customer.preferences as any) || {};
    const rawSavedList = Array.isArray(prefs.saved_addresses) ? prefs.saved_addresses : [];
    let savedList = rawSavedList;

    let primaryAddressId: string | null = null;
    let primaryAddressEntity: UpsertSavedAddressInput | null = null;

    if (savedList.length > 0) {
      // Pastikan tepat 1 primary (bila tidak ada isPrimary → tetapkan dari lastUsedAt terbaru)
      savedList = ensureSinglePrimary(savedList);
      const primaryEntry = savedList.find((a: any) => a.isPrimary) || savedList[0];
      primaryAddressId = primaryEntry.id;
      primaryAddressEntity = {
        address: primaryEntry.address || '',
        kelurahan: primaryEntry.kelurahan || null,
        kecamatan: primaryEntry.kecamatan || null,
        kota: primaryEntry.kota || null,
        lat: typeof primaryEntry.lat === 'number' ? primaryEntry.lat : null,
        lng: typeof primaryEntry.lng === 'number' ? primaryEntry.lng : null,
      };

      // Migrasikan entri dari buku alamat JSON
      for (const item of savedList) {
        const addrId = item.id || randomUUID();
        const isPrimary = item.id === primaryAddressId;

        if (!isDryRun) {
          await prisma.customerAddress.create({
            data: {
              id: addrId,
              tenant_id: customer.tenant_id,
              customer_id: customer.id,
              label: item.label || 'Rumah',
              address: item.address || '',
              kelurahan: item.kelurahan || null,
              kecamatan: item.kecamatan || null,
              kota: item.kota || null,
              lat: typeof item.lat === 'number' ? item.lat : null,
              lng: typeof item.lng === 'number' ? item.lng : null,
              distance_km: typeof item.distanceKm === 'number' ? item.distanceKm : null,
              ongkir: typeof item.ongkir === 'number' ? Math.round(item.ongkir) : null,
              landmark: item.landmark || null,
              location_source: item.locationSource || null,
              is_primary: isPrimary,
              created_at: item.createdAt ? new Date(item.createdAt) : new Date(),
              last_used_at: item.lastUsedAt ? new Date(item.lastUsedAt) : new Date(),
            },
          });
        }
        createdAddressesCount++;
      }
    } else {
      // Migrasikan dari kolom root bila ada salah satu penanda lokasi
      const hasLocation =
        Boolean(customer.kelurahan) ||
        Boolean(customer.kecamatan) ||
        Boolean(customer.kota) ||
        Boolean(customer.lat) ||
        Boolean(prefs.address);

      if (hasLocation) {
        const addrId = randomUUID();
        primaryAddressId = addrId;
        primaryAddressEntity = {
          address: prefs.address || '',
          kelurahan: customer.kelurahan || null,
          kecamatan: customer.kecamatan || null,
          kota: customer.kota || null,
          lat: customer.lat || null,
          lng: customer.lng || null,
        };

        if (!isDryRun) {
          await prisma.customerAddress.create({
            data: {
              id: addrId,
              tenant_id: customer.tenant_id,
              customer_id: customer.id,
              label: 'Rumah Utama',
              address: prefs.address || '',
              kelurahan: customer.kelurahan || null,
              kecamatan: customer.kecamatan || null,
              kota: customer.kota || null,
              lat: customer.lat || null,
              lng: customer.lng || null,
              distance_km: customer.distance_km || null,
              ongkir: customer.ongkir || null,
              landmark: prefs.landmark || null,
              location_source: customer.share_location_sent
                ? 'gps_pin'
                : customer.lat
                ? 'estimated_area'
                : null,
              is_primary: true,
              created_at: customer.created_at,
              last_used_at: customer.updated_at,
            },
          });
        }
        createdAddressesCount++;
      }
    }

    // Tautkan reservasi yang belum punya alamat ke primary address HANYA jika cocok via addressesMatch
    if (primaryAddressId && primaryAddressEntity) {
      const unlinkedReservations = await prisma.reservation.findMany({
        where: {
          customer_id: customer.id,
          customer_address_id: null,
        },
        select: {
          id: true,
          raw_text: true,
        },
      });

      for (const res of unlinkedReservations) {
        const extractedAddr = extractAddressFromRawText(res.raw_text);
        let matches = false;

        if (extractedAddr) {
          // Bandingkan teks alamat di reservasi dengan primary address via addressesMatch
          matches = addressesMatch(primaryAddressEntity, {
            address: extractedAddr,
            kelurahan: primaryAddressEntity.kelurahan,
            kecamatan: primaryAddressEntity.kecamatan,
            kota: primaryAddressEntity.kota,
          });
        } else if (savedList.length <= 1) {
          // Pelanggan hanya punya 1 alamat dan reservasi tidak memiliki alamat alternatif di teks
          matches = true;
        }

        if (matches) {
          linkedReservationsCount++;
          if (!isDryRun) {
            await prisma.reservation.update({
              where: { id: res.id },
              data: { customer_address_id: primaryAddressId },
            });
          }
        }
      }
    }
  }

  console.log(`[BACKFILL ADDRESSES] Completed:
  - Created Addresses: ${createdAddressesCount}
  - Linked Reservations: ${linkedReservationsCount}
  - Skipped Customers (Already Had Addresses): ${skippedCustomersCount}`);
}

main()
  .catch((e) => {
    console.error('[BACKFILL ADDRESSES ERROR]', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
