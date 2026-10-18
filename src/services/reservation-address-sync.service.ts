/**
 * reservation-address-sync.service.ts — SEAM KANONIS sinkronisasi alamat jadwal aktif.
 *
 * Akar masalah (Audit Holistik v2, A-001): ada TIGA rezim penulis lokasi pelanggan
 * (customerService.updateCustomerLocation, chat V3 goal-tracker, portal staf
 * StaffReservationService.updateCustomerLocation). Tanpa seam tunggal, tiket
 * kunjungan aktif bisa tertinggal di alamat lama (ghost address) meski lokasi
 * pelanggan sudah dikoreksi.
 *
 * Fungsi ini dipanggil best-effort dari ketiga rezim (dynamic import) SETELAH
 * lokasi pelanggan berubah. Semua penulisan buku alamat lewat seam kanonis
 * customerService.upsertSavedAddress / resolveCustomerAddressId (JSON + tabel
 * customer_addresses) — DILARANG tulis tabel langsung (anti split-brain A-002).
 *
 * Deterministik & idempoten: hanya mengubah reservasi aktif yang tautannya /
 * snapshot ongkirnya benar-benar berbeda. Tidak pernah menggagalkan pemanggil.
 */
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { ACTIVE_RESERVATION_STATUSES, isActiveReservation } from '../domain/reservation-status';

export interface SyncActiveReservationResult {
  synced: number;
}

export async function syncActiveReservationsForCustomer(params: {
  tenantId?: string;
  customerId: string;
}): Promise<SyncActiveReservationResult> {
  const tenantId = params.tenantId || DEFAULT_TENANT_ID;
  const customerId = params.customerId;
  if (!customerId) return { synced: 0 };

  try {
    const { customerService } = await import('./customer.service');
    const customer: any = await customerService.getCustomerById(customerId, tenantId);
    if (!customer) return { synced: 0 };

    // Ambil reservasi aktif pelanggan (status kanon; jendela waktu difilter isActiveReservation).
    let rows: any[] = [];
    try {
      rows = await prisma.reservation.findMany({
        where: {
          tenant_id: tenantId,
          customer_id: customerId,
          status: { in: ACTIVE_RESERVATION_STATUSES },
        },
      });
    } catch {
      return { synced: 0 };
    }

    const active = (rows || []).filter((r) => isActiveReservation(r));
    if (!active.length) return { synced: 0 };

    const { resolveCustomerAddressId } = await import('./reservation-core.service');
    const prefs = (customer.preferences as any) || {};
    const candidate = {
      address: (customer as any).address || prefs.address || null,
      kelurahan: customer.kelurahan ?? null,
      kecamatan: customer.kecamatan ?? null,
      kota: customer.kota ?? null,
      lat: typeof customer.lat === 'number' ? customer.lat : null,
      lng: typeof customer.lng === 'number' ? customer.lng : null,
      distanceKm: typeof customer.distance_km === 'number' ? customer.distance_km : null,
      ongkir: typeof customer.ongkir === 'number' ? customer.ongkir : null,
      locationSource: (customer as any).location_source ?? null,
    };

    const targetId = await resolveCustomerAddressId({ tenantId, customerId, candidate });
    if (!targetId) return { synced: 0 };

    const feeSnapshot = typeof candidate.ongkir === 'number' ? candidate.ongkir : null;

    let synced = 0;
    for (const r of active) {
      const linkChanged = (r.customer_address_id || null) !== targetId;
      const feeChanged = feeSnapshot != null && r.delivery_fee !== feeSnapshot;
      if (!linkChanged && !feeChanged) continue;
      try {
        await prisma.reservation.update({
          where: { id: r.id },
          data: {
            customer_address_id: targetId,
            ...(feeSnapshot != null ? { delivery_fee: feeSnapshot } : {}),
          },
        });
        synced++;
      } catch (e: any) {
        // A-016 (audit): bila dual-write customer_addresses gagal, FK disini
        // ikut gagal — DILARANG hanya warn generik. Event terstruktur yang
        // menyertakan id reservasi agar kegagalan bisa dianalisa dari logs/.
        console.warn(JSON.stringify({
          event: 'ADDR_SYNC_RESERVATION_FAILED',
          tenantId,
          customerId,
          reservationId: r.id,
          targetAddressId: targetId,
          error: e?.message || String(e),
          timestamp: new Date().toISOString(),
        }));
      }
    }

    if (synced > 0) {
      try {
        const { auditService } = await import('./audit.service');
        await auditService
          .logAdminAction({
            apiKey: 'SYSTEM',
            adminIdentity: 'SYSTEM_ADDR_SYNC',
            action: 'ACTIVE_RESERVATION_LOCATION_SYNCED',
            targetId: customerId,
            payload: { customerId, targetAddressId: targetId, synced },
            tenantId,
          } as any)
          .catch(() => {});
      } catch {}
    }

    return { synced };
  } catch (e: any) {
    console.warn('[ADDR SYNC] skipped:', e?.message);
    return { synced: 0 };
  }
}
