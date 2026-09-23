import { prisma } from '../db/client';
import { BabyDetail } from '../utils/reservation-text-parser';
import { TreatmentCategory } from '@prisma/client';

/**
 * Kanonis nama label lifecycle di DB internal (tabel `Label`, tenant-scoped).
 * Dipetakan dari nama label WAHA historis: 'new customer' → 'New Customer',
 * 'pending payment' → 'Pending Payment', 'repeat' → 'Repeat Order'.
 * Sesuai DEFAULT_SYSTEM_LABELS di labels.subroute (seed-defaults); upsert di
 * bawah memakai update:{} agar kustomisasi warna/deskripsi oleh admin (via
 * /api/admin/labels) TIDAK pernah tertimpa.
 */
const LIFECYCLE_LABEL_NEW_CUSTOMER = 'New Customer';
const LIFECYCLE_LABEL_PENDING_PAYMENT = 'Pending Payment';
const LIFECYCLE_LABEL_REPEAT_ORDER = 'Repeat Order';

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
      await this.applyLifecycleLabels({ customerId, tenantId, chatId, reservationId });
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
   * Dipanggil saat reservasi berstatus completed (treatment selesai).
   * Deep seam terpusat — SEMUA transisi completed WAJIB lewat sini (anti-spray).
   * Best-effort: tidak pernah throw ke pemanggil; setiap efek guarded try/catch.
   * Efek:
   *  1. Jadwalkan reminder/review H-1/H+1 dengan guard backdate (skip REVIEW lampau)
   *  2. Jadwalkan NEXT_TREATMENT +1/+2/+3 bulan per-stage (skip lampau, SENT-aware, PENDING)
   *  3. Reset sesi V3 episodik (cart/booking/komitmen) agar percakapan berikut bersih
   */
  public async onReservationCompleted(params: {
    customerId: string;
    reservationId: string;
    bookingDate: Date;
    treatmentCategory?: string | null;
    tenantId: string;
  }): Promise<void> {
    const { customerId, reservationId, bookingDate, treatmentCategory, tenantId } = params;
    if (!customerId || !reservationId || !bookingDate) return;

    // 1. Review/Reminder (guard backdate ada di follow-up.service)
    try {
      const { followUpService } = await import('./follow-up.service');
      await followUpService.createReservationFollowUps({
        reservationId,
        customerId,
        bookingDate,
        treatmentCategory: treatmentCategory || null,
        tenantId,
      });
    } catch (err: any) {
      console.warn('[RESERVATION LIFECYCLE] onReservationCompleted createReservationFollowUps failed:', err?.message || err);
    }

    // 2. NEXT_TREATMENT (per-stage guard + WIB + SENT-aware ada di follow-up.service)
    try {
      const { followUpService } = await import('./follow-up.service');
      await followUpService.createNextTreatmentFollowUps(customerId, bookingDate, tenantId);
    } catch (err: any) {
      console.warn('[RESERVATION LIFECYCLE] onReservationCompleted createNextTreatmentFollowUps failed:', err?.message || err);
    }

    // 3. Reset sesi V3 episodik (CG-02 closing)
    try {
      const activeConv = await prisma.conversation.findFirst({
        where: { customer_id: customerId, tenant_id: tenantId },
        orderBy: { updated_at: 'desc' },
        select: { id: true },
      });
      if (activeConv?.id) {
        const { GoalTracker } = await import('../v3/state/goal-tracker');
        await GoalTracker.updateGoalSession(
          activeConv.id,
          {
            cartItems: [],
            selectedTreatment: undefined,
            booking: undefined,
            discussedTreatments: [],
            priceDiscussed: undefined,
            bookingCommitConfirmed: undefined,
            lastCommitment: undefined,
            ongkirStatus: undefined,
            totalPrice: undefined,
          } as any,
          tenantId
        );
      }
    } catch (err: any) {
      console.warn('[RESERVATION LIFECYCLE] onReservationCompleted reset V3 session failed:', err?.message || err);
    }
  }

  /**
   * Terapkan label lifecycle pada customer — DB-ONLY (Mandat Mutlak Anti-Label WAHA).
   * - priorConfirmedCount > 0  → tambah 'Repeat Order', hapus 'New Customer' + 'Pending Payment'
   * - priorConfirmedCount === 0 → tambah 'Pending Payment', hapus 'New Customer'
   * - TIDAK pernah menyentuh label lain (mis. 'legacy') — hanya 3 nama kanonis di atas
   *   yang di-upsert/di-delete via tabel `Label` + `CustomerLabel` (tenant-scoped).
   * - Zero pemanggilan WAHA (dulu: wahaClient.batchUpdateLabels). Best-effort:
   *   DB offline → warn & lanjut, operasi inti reservasi tidak pernah gagal.
   *
   * Riwayat = `confirmed` ATAU `completed` (kanonis patient-lifecycle):
   * pasien yang reservasi sebelumnya sudah `completed` tetap 'Repeat Order'.
   *
   * Sumber otoritatif repeat: kolom `Reservation.is_repeat_order` yang dipersist
   * oleh reservation-core (single source of truth). Fallback ke count DB hanya
   * bila reservasi tak terbaca — mencegah double-count & drift semantik.
   */
  private async applyLifecycleLabels(params: { customerId: string; tenantId: string; chatId: string; reservationId?: string }): Promise<void> {
    const { customerId, tenantId, reservationId } = params;
    // chatId dipertahankan di signature untuk kompatibilitas pemanggil
    // (reservation-core, webhook, script) — tidak dipakai: zero WAHA.

    let priorConfirmedCount = 0;
    let resolvedFromReservation = false;
    if (reservationId) {
      try {
        const res = await prisma.reservation.findUnique({
          where: { id: reservationId },
          select: { is_repeat_order: true },
        });
        if (res && typeof res.is_repeat_order === 'boolean') {
          priorConfirmedCount = res.is_repeat_order ? 1 : 0;
          resolvedFromReservation = true;
        }
      } catch {
        // fallback ke count di bawah
      }
    }

    // Fallback (reservasi tak terbaca / non-core path seperti update status webhook).
    if (!resolvedFromReservation) {
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
    }

    const add: string[] =
      priorConfirmedCount > 0 ? [LIFECYCLE_LABEL_REPEAT_ORDER] : [LIFECYCLE_LABEL_PENDING_PAYMENT];
    const remove: string[] =
      priorConfirmedCount > 0
        ? [LIFECYCLE_LABEL_NEW_CUSTOMER, LIFECYCLE_LABEL_PENDING_PAYMENT]
        : [LIFECYCLE_LABEL_NEW_CUSTOMER];

    try {
      const labelIds = new Map<string, string>();
      for (const name of [...add, ...remove]) {
        const label = await prisma.label.upsert({
          where: { tenant_id_name: { tenant_id: tenantId, name } },
          update: {},
          create: { tenant_id: tenantId, name },
        });
        labelIds.set(name, label.id);
      }
      for (const name of add) {
        const labelId = labelIds.get(name);
        if (!labelId) continue;
        await prisma.customerLabel.upsert({
          where: { customer_id_label_id: { customer_id: customerId, label_id: labelId } },
          update: {},
          create: { customer_id: customerId, label_id: labelId },
        });
      }
      const removeIds = remove
        .map((name) => labelIds.get(name))
        .filter((id): id is string => !!id);
      if (removeIds.length > 0) {
        await prisma.customerLabel.deleteMany({
          where: { customer_id: customerId, label_id: { in: removeIds } },
        });
      }
      console.log(
        `[LIFECYCLE LABEL] DB-only lifecycle applied for customer ${customerId}: +[${add.join(', ')}] -[${remove.join(', ')}]`
      );
    } catch (err: any) {
      console.warn('[LIFECYCLE LABEL] DB-only lifecycle tagging failed:', err?.message || err);
    }
    // Catatan: label lain (mis. 'legacy') dibiarkan tak tersentuh.
  }
}

export const reservationLifecycleService = new ReservationLifecycleService();

export interface UpsertReservationFormParams {
  tenantId: string;
  customerId: string;
  chatId: string;
  treatmentCategory?: TreatmentCategory | string | null;
  treatmentDetail?: string | null;
  durationMinutes?: number | null;
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
  // Auto-capture webhook membawa durasi resmi katalog bila pemanggil tak mengisinya
  // (hanya bila seluruh item dikenali katalog — anti-fabrikasi data).
  if ((rest.durationMinutes == null) && rest.treatmentDetail && rest.treatmentDetail.trim()) {
    try {
      const { treatmentCatalogService } = await import('./treatment-catalog.service');
      const breakdown = treatmentCatalogService.resolveDurationBreakdown(rest.treatmentDetail, rest.tenantId);
      if (breakdown.confident || breakdown.usedExplicitTag) {
        rest.durationMinutes = breakdown.totalMinutes;
      }
    } catch {}
  }
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
    status: 'confirmed',
  });
  return { reservation: result.reservation, isNew: result.isNew, isUpdate: result.isUpdate };
}