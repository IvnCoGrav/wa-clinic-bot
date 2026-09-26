import { DEFAULT_TENANT_ID } from '../config/tenant';

/**
 * Kandidat koordinat untuk pemilihan tier GPS.
 * Sumber: pesan shareloc customer, shareloc bidan, koordinat tersimpan di DB, hasil geocoding.
 */
export interface GpsCandidate {
  source: string;
  lat: number;
  lng: number;
  at: string; // ISO timestamp sumber diperoleh
}

/**
 * Hierarki tier koordinat (angka makin kecil = makin tinggi kepentingannya).
 * Invarian dari refresh (customer.service:1757-1789):
 *   bidan_shareloc > customer_shareloc > db_coords > geocoding
 */
const TIER_RANK: Record<string, number> = {
  bidan_shareloc: 0,
  customer_shareloc: 1,
  db_coords: 2,
  geocoding: 3,
};

const UNKNOWN_TIER_RANK = 99;
const COORD_EPSILON = 1e-6;

/**
 * Pemilih kandidat koordinat berbasis tier tegas:
 *   1. Tier lebih tinggi selalu menang, tanpa peduli timestamp.
 *   2. Di dalam tier yang sama, kandidat TERBARU yang menang.
 *   3. Daftar kosong / semua kandidat tidak valid → null (tanpa halusinasi).
 */
export function pickGpsTier(candidates: GpsCandidate[]): GpsCandidate | null {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const valid = candidates.filter(
    (c) =>
      c &&
      Number.isFinite(Number(c.lat)) &&
      Number.isFinite(Number(c.lng)) &&
      !(Number(c.lat) === 0 && Number(c.lng) === 0) &&
      Math.abs(Number(c.lat)) <= 90 &&
      Math.abs(Number(c.lng)) <= 180
  );
  if (valid.length === 0) return null;

  const rankOf = (c: GpsCandidate) => TIER_RANK[c.source] ?? UNKNOWN_TIER_RANK;
  const timeOf = (c: GpsCandidate) => {
    const t = Date.parse(c.at);
    return Number.isFinite(t) ? t : 0;
  };

  let best = valid[0];
  let bestRank = rankOf(best);
  let bestTime = timeOf(best);
  for (const c of valid.slice(1)) {
    const r = rankOf(c);
    const t = timeOf(c);
    if (r < bestRank || (r === bestRank && t > bestTime)) {
      best = c;
      bestRank = r;
      bestTime = t;
    }
  }
  return best;
}

export type IngestResult = { status: 'saved' | 'skipped' | 'error'; reason: string };

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
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      (lat === 0 && lng === 0) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      return { status: 'skipped', reason: 'invalid_coords' };
    }

    // Idempoten: GPS identik dengan yang sudah tersimpan + jarak/ongkir lengkap +
    // share_location_sent → tidak perlu API eksternal ulang (retry aman).
    const alreadyCurrent =
      customer?.lat != null &&
      customer?.lng != null &&
      Math.abs(Number(customer.lat) - lat) < COORD_EPSILON &&
      Math.abs(Number(customer.lng) - lng) < COORD_EPSILON &&
      customer?.distance_km != null &&
      customer?.ongkir != null &&
      customer?.share_location_sent === true;
    if (alreadyCurrent) {
      return { status: 'skipped', reason: 'already_current' };
    }

    let phase: 'reverse_geocode' | 'calculate_delivery' | 'update' = 'reverse_geocode';
    try {
      const { geocodingService } = await import('../integrations/google-maps/geocoding');
      const { deliveryService } = await import('./delivery.service');
      const { customerService } = await import('./customer.service');

      const resolved = await geocodingService.reverseGeocode(lat, lng);
      phase = 'calculate_delivery';
      const delivery = await deliveryService.calculateDelivery({ lat, lng }, undefined, tenantId);
      phase = 'update';
      await customerService.updateCustomerLocation(
        customer.id,
        {
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
        },
        tenantId
      );
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
