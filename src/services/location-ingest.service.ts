import { DEFAULT_TENANT_ID } from '../config/tenant';
import { type GpsCandidate, pickGpsTier } from '../domain/gps-tier';
import { distanceMeters, hasValidCoords, SAME_PLACE_TOLERANCE_M } from '../domain/location-adequacy';

export type { GpsCandidate };
export { pickGpsTier };

const COORD_EPSILON = 1e-6;

export type IngestResult = { status: 'saved' | 'skipped' | 'error'; reason: string };

/**
 * Satu-satunya penyusun `incomingMessage.location` untuk choke point GPS.
 * Dipakai webhook WAHA & WABA (anti duplikasi + menjaga route tetap ramping).
 */
export function buildPinIncomingMessage(loc: {
  latitude: number | string | null | undefined;
  longitude: number | string | null | undefined;
  address?: string | null;
  name?: string | null;
}): { type: 'location'; location: { latitude: number; longitude: number; address?: string; name?: string } } {
  const address = typeof loc.address === 'string' && loc.address.trim() ? loc.address.trim() : undefined;
  const name = typeof loc.name === 'string' && loc.name.trim() ? loc.name.trim() : undefined;
  return {
    type: 'location',
    location: {
      latitude: Number(loc.latitude),
      longitude: Number(loc.longitude),
      ...(address ? { address } : {}),
      ...(name ? { name } : {}),
    },
  };
}

/**
 * Kontrak TUNGGAL untuk semua penulis koordinat GPS pin WhatsApp.
 *
 * Kasus nyata (Bunda Agatha, 25 Sep 2026 13:39:36 UTC — KNOWN_ISSUES #138):
 *   GPS pin masuk saat chat sedang dipegang admin; sinkronisasi GPS hanya ada di
 *   cabang human-handling dan kegagalan `updateCustomerLocation` ditelan console.warn
 *   diam-diam → koordinat basi sampai admin menekan "Refresh & Hitung Ulang".
 *
 * Invarian:
 *   1. GPS pin BARU selalu menimpa koordinat lama (isNativePin), walau
 *      share_location_sent=true (bukan hanya saat refresh).
 *   2. Kegagalan tulis TIDAK pernah diam: audit persisten LOCATION_INGEST_FAILED.
 *   3. Idempoten: koordinat identik + jarak/ongkir + share_location_sent terpenuhi
 *      → skip tanpa memanggil API eksternal (aman untuk retry / choke point ganda).
 */
export class LocationIngestService {
  /**
   * Deteksi GPS pin tidak bergantung pada bentuk payload tunggal:
   * type === 'location'/'live_location' ATAU field location.latitude/longitude terisi.
   */
  public isIncomingGpsPin(incomingMessage: any): boolean {
    if (!incomingMessage) return false;
    const t = incomingMessage.type;
    if (t === 'location' || t === 'live_location') return true;
    const loc = incomingMessage.location;
    return !!loc && loc.latitude != null && loc.longitude != null;
  }

  public async ingestGpsPin(params: {
    customer: any;
    incomingMessage: any;
    tenantId?: string;
  }): Promise<IngestResult> {
    const { customer, incomingMessage } = params;
    const tenantId: string = params.tenantId || customer?.tenant_id || DEFAULT_TENANT_ID;

    if (!this.isIncomingGpsPin(incomingMessage)) {
      return { status: 'skipped', reason: 'not_gps_pin' };
    }

    const loc = incomingMessage.location || {};
    const lat = Number(loc.latitude);
    const lng = Number(loc.longitude);
    const rawLandmark = typeof loc.name === 'string' && loc.name.trim() ? loc.name.trim() : undefined;
    const rawAddress = typeof loc.address === 'string' && loc.address.trim() ? loc.address.trim() : undefined;
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      (lat === 0 && lng === 0) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      return { status: 'skipped', reason: 'invalid_coords' };
    }

    // F6.3 (A-003): bila pin baru >150m dari titik tersimpan, simpan address_candidate
    // dan jangan timpa alamat/landmark teks kartu utama secara diam-diam.
    const existingCoords = {
      lat: customer?.lat != null ? Number(customer.lat) : null,
      lng: customer?.lng != null ? Number(customer.lng) : null,
    };
    const newCoords = { lat, lng };
    const sameHouse =
      !hasValidCoords(existingCoords) ||
      !hasValidCoords(newCoords) ||
      distanceMeters(existingCoords, newCoords) <= SAME_PLACE_TOLERANCE_M;
    const allowAddressWrite = sameHouse;
    const candidateAddress = !allowAddressWrite ? (rawAddress || rawLandmark || null) : null;

    // Idempoten: GPS identik dengan yang sudah tersimpan + jarak/ongkir lengkap +
    // share_location_sent → tidak perlu API eksternal ulang (retry aman).
    const existingCandidate = (customer?.preferences as any)?.address_candidate;
    const candidateAlreadyStored =
      !candidateAddress ||
      (existingCandidate && String(existingCandidate.address || '') === String(candidateAddress));
    const alreadyCurrent =
      customer?.lat != null &&
      customer?.lng != null &&
      Math.abs(Number(customer.lat) - lat) < COORD_EPSILON &&
      Math.abs(Number(customer.lng) - lng) < COORD_EPSILON &&
      customer?.distance_km != null &&
      customer?.ongkir != null &&
      customer?.share_location_sent === true &&
      (!rawLandmark || (customer.preferences as any)?.landmark === rawLandmark || !allowAddressWrite) &&
      (allowAddressWrite ? (!rawAddress || (customer.preferences as any)?.address === rawAddress) : candidateAlreadyStored);
    if (alreadyCurrent) {
      return { status: 'skipped', reason: 'already_current' };
    }

    let phase: 'reverse_geocode' | 'calculate_delivery' | 'update' = 'reverse_geocode';
    try {
      const { geocodingService } = await import('../integrations/google-maps/geocoding');
      const { deliveryService } = await import('./delivery.service');
      const { customerService } = await import('./customer.service');

      const hint = {
        preferredKelurahan: customer?.kelurahan,
        preferredKecamatan: customer?.kecamatan,
        addressTextHint: (customer?.preferences as any)?.address || (customer?.preferences as any)?.full_address || '',
      };
      const resolved = await geocodingService.reverseGeocode(lat, lng, hint, tenantId);
      phase = 'calculate_delivery';
      const delivery = await deliveryService.calculateDelivery({ lat, lng }, undefined, tenantId);
      phase = 'update';
      await customerService.updateCustomerLocation(
        customer.id,
        {
          address: allowAddressWrite ? rawAddress : undefined,
          landmark: allowAddressWrite ? rawLandmark : undefined,
          kelurahan: resolved.kelurahan,
          kecamatan: resolved.kecamatan,
          kota: resolved.kota,
          lat,
          lng,
          distanceKm: delivery.distanceKm,
          ongkir: delivery.ongkir,
          isOutOfCoverage: delivery.isOutOfCoverage,
          zipcode: resolved.zipcode,
          isNativePin: true,
          isEstimatedCentroid: resolved.isEstimatedCentroid,
          labelSource: resolved.labelSource,
        },
        tenantId
      );
      if (candidateAddress) {
        try {
          const { prisma } = await import('../db/client');
          const fresh = await prisma.customer.findFirst({
            where: { id: customer.id, tenant_id: tenantId },
            select: { preferences: true },
          });
          const prefs = (fresh?.preferences as any) || {};
          await prisma.customer.updateMany({
            where: { id: customer.id, tenant_id: tenantId },
            data: {
              preferences: {
                ...prefs,
                address_candidate: {
                  address: rawAddress || null,
                  landmark: rawLandmark || null,
                  lat,
                  lng,
                  capturedAt: new Date().toISOString(),
                  reason: 'far_pin_conflict',
                },
              } as any,
            },
          });
        } catch (candErr: any) {
          console.warn('[LOCATION INGEST] gagal simpan address_candidate:', candErr?.message);
        }
      }
      await customerService.markShareLocationSent(customer.id, tenantId);
      console.log(
        `[LOCATION INGEST] GPS pin saved for ${customer.phone}: ${delivery.distanceKm}km ongkir ${delivery.ongkir}`
      );
      return { status: 'saved', reason: 'gps_pin' };
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.warn(
        `[LOCATION_INGEST_FAILED] ${JSON.stringify({
          customerId: customer?.id,
          phone: customer?.phone,
          lat,
          lng,
          tenantId,
          phase,
          error: msg,
        })}`
      );
      // Sinyal persisten (G2): kegagalan tulis lokasi tidak boleh hilang seperti
      // pada insiden #138 (console.warn saja, log container hangus saat recreate).
      try {
        const { auditService } = await import('./audit.service');
        await auditService.logAdminAction({
          apiKey: 'SYSTEM',
          adminIdentity: 'SYSTEM_LOCATION_INGEST',
          action: 'LOCATION_INGEST_FAILED',
          targetId: customer?.id,
          payload: { error: msg, lat, lng, phone: customer?.phone, phase },
          tenantId,
        } as any).catch(() => {});
      } catch (auditErr: any) {
        console.warn('[LOCATION_INGEST_FAILED] audit persisten gagal:', auditErr?.message);
      }
      return { status: 'error', reason: `${phase}_failed: ${msg}` };
    }
  }
}

export const locationIngestService = new LocationIngestService();
