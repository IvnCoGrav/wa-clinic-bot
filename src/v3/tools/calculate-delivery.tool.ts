import { geocodingService } from '../../integrations/google-maps/geocoding';
import { deliveryService } from '../../services/delivery.service';
import { clinicConfig } from '../../config/clinic';
import { DEFAULT_TENANT_ID } from '../../config/tenant';

export interface CalculateDeliveryInput {
  locationText: string;
  streetDetail?: string;
  tenantId?: string;
}

export interface CalculateDeliveryOutput {
  success: boolean;
  isPrecise: boolean;
  kelurahan?: string;
  kecamatan?: string;
  kota?: string;
  formattedAddress?: string;
  distanceKm?: number;
  ongkirNormal?: number;
  ongkirPromo?: number;
  isOutOfCoverage: boolean;
  message: string;
}

export const CALCULATE_DELIVERY_TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'calculate_delivery',
    description: 'Menghitung jarak rute jalan dan tarif ongkos kirim (ongkir normal & promo) dari klinik ke lokasi/rumah customer.',
    parameters: {
      type: 'object',
      properties: {
        locationText: {
          type: 'string',
          description: 'Nama kelurahan, kecamatan, perumahan, atau daerah tempat tinggal customer (misal: "Trosobo Sidoarjo", "Manukan Surabaya", "Waru", "Gedangan").'
        },
        streetDetail: {
          type: 'string',
          description: 'Detail nama jalan, nomor rumah, atau blok perumahan jika disebutkan (opsional).'
        }
      },
      required: ['locationText']
    }
  }
};

const OUTSIDE_CITIES_RE = /\b(malang|jakarta|bandung|semarang|yogyakarta|jogja|bali|denpasar|kediri|blitar|madiun|probolinggo|pasuruan|jember|banyuwangi|bojonegoro|tuban|lamongan|ngawi|magetan|ponorogo|pacitan|trenggalek|tulungagung|lumajang|bondowoso|situbondo)\b/i;

export async function executeCalculateDelivery(input: CalculateDeliveryInput): Promise<CalculateDeliveryOutput> {
  const { locationText, streetDetail, tenantId = DEFAULT_TENANT_ID } = input;
  
  if (!locationText || locationText.trim().length < 2) {
    return {
      success: false,
      isPrecise: false,
      isOutOfCoverage: false,
      message: 'Lokasi terlalu singkat atau kosong. Mohon tanyakan nama daerah/kelurahan yang lebih jelas.'
    };
  }

  // Fast check: Jika customer secara sadar menyebut kota di luar jangkauan (misal Malang, Jakarta)
  const isExplicitOutsideCity = OUTSIDE_CITIES_RE.test(locationText);

  try {
    const compositeQuery = streetDetail
      ? `${streetDetail} ${locationText}`.trim()
      : locationText.trim();

    // 1. Geocode via local gazetteer & Google Maps (dengan bias Surabaya/Sidoarjo)
    let resolved = await geocodingService.geocodeText(compositeQuery);
    
    // Second-pass jika belum presisi dan ada teks asli
    if (!resolved.isPrecise && compositeQuery !== locationText) {
      const locResolved = await geocodingService.geocodeText(locationText);
      if (locResolved.isPrecise) {
        resolved = locResolved;
      }
    }

    // Jika ambigu tetapi ada ambiguityResults dengan koordinat yang sama / satu cluster kecamatan
    if ((!resolved.lat || !resolved.lng) && (resolved as any).ambiguityResults && (resolved as any).ambiguityResults.length > 0) {
      const firstCand = (resolved as any).ambiguityResults[0];
      if (firstCand.Koordinat) {
        const parts = firstCand.Koordinat.split(',').map((p: string) => parseFloat(p.trim()));
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          resolved.lat = parts[0];
          resolved.lng = parts[1];
          resolved.kelurahan = resolved.kelurahan || firstCand.Kelurahan_Desa;
          resolved.kecamatan = resolved.kecamatan || firstCand.Kecamatan;
          resolved.kota = resolved.kota || firstCand.Kota;
        }
      }
    }

    if (!resolved.lat || !resolved.lng) {
      if (isExplicitOutsideCity) {
        return {
          success: true,
          isPrecise: false,
          isOutOfCoverage: true,
          distanceKm: 99,
          message: `Lokasi "${compositeQuery}" berada di luar jangkauan area layanan klinik Kala Spa (maksimal 30 km dari Surabaya & Sidoarjo).`
        };
      }

      return {
        success: false,
        isPrecise: false,
        isOutOfCoverage: false,
        message: `Lokasi "${compositeQuery}" belum dapat ditemukan secara presisi. Mohon tanyakan kelurahan atau patokan terdekat.`
      };
    }

    // 2. Hitung jarak dan ongkir
    const deliveryResult = await deliveryService.calculateDelivery(
      { lat: resolved.lat, lng: resolved.lng },
      { lat: clinicConfig.lat, lng: clinicConfig.lng },
      tenantId
    );

    const distanceKm = deliveryResult.distanceKm;
    const ongkirNormal = deliveryResult.normalPrice;
    const ongkirPromo = deliveryResult.ongkir;
    const isOutOfCoverage = deliveryResult.isOutOfCoverage || distanceKm > 30 || isExplicitOutsideCity;

    return {
      success: true,
      isPrecise: resolved.isPrecise || Boolean(resolved.kelurahan),
      kelurahan: resolved.kelurahan,
      kecamatan: resolved.kecamatan,
      kota: resolved.kota,
      formattedAddress: resolved.formattedAddress,
      distanceKm,
      ongkirNormal,
      ongkirPromo,
      isOutOfCoverage,
      message: isOutOfCoverage
        ? `Jarak ${distanceKm} km melebihi batas jangkauan layanan klinik (maks 30 km).`
        : `Jarak ${distanceKm} km (${resolved.kelurahan || '-'}, ${resolved.kecamatan || '-'}). Ongkir normal Rp ${ongkirNormal.toLocaleString('id-ID')}, promo menjadi Rp ${ongkirPromo.toLocaleString('id-ID')}.`
    };
  } catch (error: any) {
    console.error('[V3 TOOL DELIVERY ERROR]', error);
    return {
      success: false,
      isPrecise: false,
      isOutOfCoverage: false,
      message: `Gagal menghitung ongkir: ${error.message}`
    };
  }
}
