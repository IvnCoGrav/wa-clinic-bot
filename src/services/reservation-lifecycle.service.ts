import { prisma } from '../db/client';
import { wahaClient } from '../integrations/waha/client';
import { BabyDetail } from '../utils/reservation-text-parser';
import { TreatmentCategory } from '@prisma/client';

/**
 * ReservationLifecycleService — fungsi sentral untuk side-effect pasca-create reservasi.
 *
 * Mengumpulkan SEMUA aksi yang harus terjadi setelah sebuah reservasi berhasil dibuat
 * (dari chat customer, parse admin, maupun create manual admin):
 *   1. followUpService.onReservationCreated — scheduling/penjadwalan follow-up
 *   2. childService.upsertChildrenFromBabies — persist entitas bayi/anak
 *   3. Label lifecycle (Task 4) — 'pending payment' / 'repeat' / hapus 'new customer'
 *
 * Setiap efek bersifat best-effort: kegagalan salah satu tidak membatalkan yang lain,
 * dan tidak pernah melempar error ke pemanggil (agar operasi inti tetap sukses).
 */
export interface OnReservationCreatedParams {
  customerId: string;
  reservationId: string;
  tenantId: string;
  chatId: string; // format phone@c.us
  babies?: BabyDetail[];
  customerName?: string;
  kecamatan?: string;
  kota?: string;
  kelurahan?: string;
  address?: string;
}

export class ReservationLifecycleService {
  public async onReservationCreated(params: OnReservationCreatedParams): Promise<void> {
    const { customerId, reservationId, tenantId, chatId, babies = [], customerName, kecamatan, kota, kelurahan, address } = params;

    // 0. Update nama customer & alamat dari form reservasi ke database (agar sinkron ke Google Contacts & CAPI)
    try {
      const { customerService } = await import('./customer.service');
      const targetName = (customerName || '').trim();
      if (targetName && targetName.length > 1) {
        const cleanName = targetName.replace(/^(?:bunda|ibu|mama|mom|mbak|mas|kak|kakak|ny|ny\.)\s+/i, '').trim();
        if (cleanName && !['bunda', 'ibu', 'mama', 'mom', 'mbak', 'mas', 'kak', 'kakak', 'pasien', 'customer', '-'].includes(cleanName.toLowerCase())) {
          const effectiveKec = (kecamatan || '').trim();
          const contactFormattedName = `Bunda ${cleanName}${effectiveKec ? ` ${effectiveKec}` : ''}`.trim();
          await customerService.updateCustomerName(customerId, contactFormattedName, tenantId).catch(() => {});
        }
      }

      if (kecamatan || kota || kelurahan || address) {
        await customerService.updateCustomerLocation(customerId, {
          kecamatan: kecamatan?.trim() || undefined,
          kota: kota?.trim() || undefined,
          kelurahan: kelurahan?.trim() || undefined,
        }, tenantId).catch(() => {});

        // Background Auto-Distance Calculation jika customer belum memiliki distance_km
        const currentCust = await customerService.getCustomerById(customerId, tenantId);
        if (currentCust && (currentCust.distance_km == null || currentCust.lat == null)) {
          void (async () => {
            try {
              const fullAddressStr = [kelurahan, address, kecamatan, kota].filter(Boolean).join(', ');
              const { extractGoogleMapsUrls, resolveGoogleMapsUrl } = await import('../utils/google-maps-url-resolver');
              const mapsUrls = extractGoogleMapsUrls(fullAddressStr);
              let resolvedLat: number | undefined;
              let resolvedLng: number | undefined;
              let resolvedKel = kelurahan?.trim();
              let resolvedKec = kecamatan?.trim();
              let resolvedKota = kota?.trim();

              if (mapsUrls.length > 0) {
                const mapsRes = await resolveGoogleMapsUrl(mapsUrls[0]);
                if (mapsRes.success && mapsRes.lat && mapsRes.lng) {
                  resolvedLat = mapsRes.lat;
                  resolvedLng = mapsRes.lng;
                }
              }

              if (!resolvedLat || !resolvedLng) {
                const { geocodingService } = await import('../integrations/google-maps/geocoding');
                const geo = await geocodingService.geocodeText(fullAddressStr);
                if (geo.isPrecise && geo.lat != null && geo.lng != null) {
                  resolvedLat = geo.lat;
                  resolvedLng = geo.lng;
                  resolvedKel = resolvedKel || geo.kelurahan;
                  resolvedKec = resolvedKec || geo.kecamatan;
                  resolvedKota = resolvedKota || geo.kota;
                }
              }

              if (resolvedLat && resolvedLng) {
                const { deliveryService } = await import('./delivery.service');
                const delivery = await deliveryService.calculateDelivery({ lat: resolvedLat, lng: resolvedLng }, undefined, tenantId);
                await customerService.updateCustomerLocation(customerId, {
                  kelurahan: resolvedKel,
                  kecamatan: resolvedKec,
                  kota: resolvedKota,
                  lat: resolvedLat,
                  lng: resolvedLng,
                  distanceKm: delivery.distanceKm,
                  ongkir: delivery.ongkir,
                  isOutOfCoverage: delivery.isOutOfCoverage,
                }, tenantId);
                console.log(`[RESERVATION LIFECYCLE] Auto-resolved distance for customer ${customerId}: ${delivery.distanceKm} km, ongkir: ${delivery.ongkir}`);
              }
            } catch (err: any) {
              console.warn('[RESERVATION LIFECYCLE] Distance resolution failed:', err?.message || err);
            }
          })();
        }
      }
    } catch (err: any) {
      console.warn('[RESERVATION LIFECYCLE] updateCustomerName/Location failed:', err.message);
    }

    // 1. Follow-Up scheduling
    try {
      const { followUpService } = await import('./follow-up.service');
      await followUpService.onReservationCreated(customerId, reservationId, tenantId);
    } catch (err: any) {
      console.warn('[RESERVATION LIFECYCLE] followUp.onReservationCreated failed:', err.message);
    }

    // Phase 4: Sync ltv_cache on new reservation
    try {
      const { customerService } = await import('./customer.service');
      await customerService.recalculateCustomerLtv(customerId, tenantId);
    } catch (err: any) {
      console.warn('[RESERVATION LIFECYCLE] recalculateCustomerLtv failed:', err.message);
    }

    // 2. Persist child/baby entities (best-effort)
    try {
      const { childService } = await import('./child.service');
      await childService.upsertChildrenFromBabies({
        customerId,
        reservationId,
        tenantId,
        babies,
      });
    } catch (err: any) {
      console.warn('[RESERVATION LIFECYCLE] childService.upsertChildrenFromBabies failed:', err.message);
    }

    // 3. Label lifecycle (Task 4) — hanya jika flag aktif
    if (process.env.ENABLE_LIFECYCLE_LABELS === 'true' && chatId) {
      await this.applyLifecycleLabels({ customerId, tenantId, chatId });
    }

    // 4. Google Contacts auto-sync (best-effort, berjalan setelah nama dan anak diperbarui)
    try {
      const { googleContactsService } = await import('./google-contacts.service');
      googleContactsService.syncCustomer(tenantId, customerId, { trigger: 'reservation' }).catch(() => {});
    } catch (err: any) {
      console.warn('[RESERVATION LIFECYCLE] googleContactsService.syncCustomer failed:', err?.message);
    }
  }

  /**
   * Terapkan label lifecycle pada chat:
   * - priorConfirmedCount > 0  → 'repeat'          (bukan 'pending payment')
   * - priorConfirmedCount === 0 → 'pending payment'
   * - selalu hapus 'new customer'
   * - TIDAK pernah melepas label 'legacy'
   * Semua best-effort (opsi label WA tidak pernah menggagalkan operasi inti).
   *
   * Riwayat = `confirmed` ATAU `completed` (kanonis patient-lifecycle):
   * pasien yang reservasi sebelumnya sudah `completed` tetap 'repeat'.
   */
  private async applyLifecycleLabels(params: { customerId: string; tenantId: string; chatId: string }): Promise<void> {
    const { customerId, tenantId, chatId } = params;

    // Hitung reservasi confirmed/completed-sebelumnya milik customer (di luar reservasi barusan).
    let priorConfirmedCount = 0;
    try {
      priorConfirmedCount = await prisma.reservation.count({
        where: {
          customer_id: customerId,
          tenant_id: tenantId,
          status: { in: ['confirmed', 'completed'] },
        },
      });
    } catch (err: any) {
      // DB offline → default 0 (new customer path)
      console.warn('[LIFECYCLE LABEL] Could not count prior confirmed reservations:', err.message);
    }

    // Best-effort: satu operasi atomik (1x GET + 1x PUT) untuk semua perubahan label
    const remove: string[] = ['new customer'];
    const add: string[] = [];
    if (priorConfirmedCount > 0) {
      add.push('repeat');
      remove.push('pending payment');
    } else {
      add.push('pending payment');
    }
    wahaClient.batchUpdateLabels(chatId, { add, remove }).catch((err: any) =>
      console.warn('[LIFECYCLE LABEL] batchUpdateLabels failed:', err.message)
    );
    // Catatan: label 'legacy' dibiarkan tak tersentuh.
  }
}

export const reservationLifecycleService = new ReservationLifecycleService();

export interface UpsertReservationFormParams {
  tenantId: string;
  customerId: string;
  chatId: string;
  treatmentCategory?: TreatmentCategory | string | null;
  treatmentDetail?: string | null;
  bookingDate?: Date | null;
  rawText?: string;
  purchaseValue?: number;
  babies?: BabyDetail[];
  customerName?: string;
  kecamatan?: string;
  kota?: string;
  kelurahan?: string;
  address?: string;
  source?: string;
}

/**
 * Helper terstandarisasi (DEPRECATED — delegasi ke Canonical Reservation Core).
 * Dipertahankan agar 4 titik auto-capture webhook + tool lama tetap berfungsi
 * sambil mewarisi perbaikan fondasional: pencocokan booking_date (bukan
 * created_at 24 jam naif), idempotent merge, dan auto-konsolidasi duplikat.
 * Kode baru WAJIB memanggil `reservationCoreService.saveReservation()` langsung.
 */
export async function upsertReservationForm(params: UpsertReservationFormParams): Promise<{
  reservation: any;
  isNew: boolean;
  isUpdate: boolean;
}> {
  const { source, ...rest } = params;
  const { reservationCoreService } = await import('./reservation-core.service');
  // Petakan source lama ke kanal kanonis: admin-outbound & webhook-* → WEBHOOK,
  // V3 tool → AGENT, selain itu → WEBHOOK (idempoten, aman untuk bot).
  const upper = String(source || 'WEBHOOK').toUpperCase();
  const mappedSource = upper.includes('AGENT') || upper.includes('V3_NATIVE')
    ? 'AGENT'
    : upper.includes('ADMIN_PANEL')
      ? 'ADMIN_PANEL'
      : upper.includes('BOT')
        ? 'BOT'
        : 'WEBHOOK';
  const result = await reservationCoreService.saveReservation({
    ...rest,
    source: mappedSource as 'BOT' | 'WEBHOOK' | 'AGENT' | 'ADMIN_PANEL',
    status: 'pending',
  });
  return { reservation: result.reservation, isNew: result.isNew, isUpdate: result.isUpdate };
}