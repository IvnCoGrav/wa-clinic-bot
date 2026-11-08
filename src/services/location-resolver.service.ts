import { resolveGoogleMapsUrl, extractGoogleMapsUrls, extractAddressQueryFromUrlString } from '../utils/google-maps-url-resolver';
import { geocodingService } from '../integrations/google-maps/geocoding';
import type { NearestSubdistrictHint } from '../utils/gazetteer';
import { deliveryService } from './delivery.service';
import { customerService } from './customer.service';

// Re-export for convenience
export { extractGoogleMapsUrls } from '../utils/google-maps-url-resolver';

export interface ResolveLocationResult {
  success: boolean;
  source?: 'url_coords' | 'url_text_geocoded' | 'db_coords' | 'geocoding';
  sourceLabel?: string;
  lat?: number;
  lng?: number;
  kelurahan?: string;
  kecamatan?: string;
  kota?: string;
  distanceKm?: number;
  ongkir?: number;
  isOutOfCoverage?: boolean;
  zipcode?: string;
  formattedAddress?: string;
  addressQueryUsed?: string;
  error?: string;
}

/**
 * Shared helper: resolve Google Maps shortlink/URL with transparent geocode fallback.
 * - Murni resolver: tidak memutuskan provenance pin GPS.
 * - Dipakai HANYA oleh 2 call-site: refreshCustomerLocationAndOngkir & enrichSync.
 * - Kembalikan `source` eksplisit agar tier/lock tidak korup.
 */
export async function resolveLocationFromUrl(
  url: string,
  tenantId: string = 'default-tenant',
  hint?: NearestSubdistrictHint
): Promise<ResolveLocationResult> {
  try {
    const resolved = await resolveGoogleMapsUrl(url);

    // Kasus 1: URL sudah bawa koordinat presisi
    if (resolved.success && resolved.lat != null && resolved.lng != null) {
      const geo = await geocodingService.reverseGeocode(resolved.lat, resolved.lng, hint);
      const delivery = await deliveryService.calculateDelivery(
        { lat: resolved.lat, lng: resolved.lng },
        undefined,
        tenantId
      );
      return {
        success: true,
        source: 'url_coords',
        sourceLabel: '📍 Shareloc Google Maps (URL)',
        lat: resolved.lat,
        lng: resolved.lng,
        kelurahan: geo.kelurahan,
        kecamatan: geo.kecamatan,
        kota: geo.kota,
        distanceKm: delivery.distanceKm,
        ongkir: delivery.ongkir,
        isOutOfCoverage: delivery.isOutOfCoverage,
        zipcode: geo.zipcode,
        formattedAddress: geo.formattedAddress,
      };
    }

    // Kasus 2: URL bawa teks tempat (?q=...) → geocode teks transparan
    if (resolved.addressQuery) {
      const geo = await geocodingService.geocodeText(resolved.addressQuery);
      if (geo.isPrecise && geo.lat != null && geo.lng != null) {
        const delivery = await deliveryService.calculateDelivery(
          { lat: geo.lat, lng: geo.lng },
          undefined,
          tenantId
        );
        return {
          success: true,
          source: 'url_text_geocoded',
          sourceLabel: '📍 Shareloc Google Maps (Teks → Geocode)',
          lat: geo.lat,
          lng: geo.lng,
          kelurahan: geo.kelurahan,
          kecamatan: geo.kecamatan,
          kota: geo.kota,
          distanceKm: delivery.distanceKm,
          ongkir: delivery.ongkir,
          isOutOfCoverage: delivery.isOutOfCoverage,
          zipcode: geo.zipcode,
          formattedAddress: geo.formattedAddress,
          addressQueryUsed: resolved.addressQuery,
        };
      }
      return { success: false, error: `Geocode teks dari URL tidak presisi: ${resolved.addressQuery}` };
    }

    return { success: false, error: 'URL tidak mengandung koordinat atau teks tempat yang valid' };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Gagal resolve URL Google Maps' };
  }
}

