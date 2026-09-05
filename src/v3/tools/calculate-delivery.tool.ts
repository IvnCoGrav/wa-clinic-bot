import { geocodingService } from '../../integrations/google-maps/geocoding';
import { deliveryService } from '../../services/delivery.service';
import { clinicConfig } from '../../config/clinic';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { TEMPLATES } from '../../config/persona';

export interface CalculateDeliveryInput {
  locationText: string;
  streetDetail?: string;
  tenantId?: string;
  candidateTreatmentName?: string;
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
  suggestedTemplateReply?: string;
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
          description: 'Nama kelurahan, desa, perumahan, patokan, atau alamat lengkap customer (misal: "Sedati Pepe", "Bulusidokare", "Perumahan Safira Juanda").'
        },
        streetDetail: {
          type: 'string',
          description: 'Detail nomor rumah atau RT/RW jika ada.'
        }
      },
      required: ['locationText']
    }
  }
};

const OUTSIDE_CITIES_RE = /\b(malang|jakarta|bandung|semarang|yogyakarta|jogja|bali|denpasar|kediri|blitar|madiun|probolinggo|pasuruan|jember|banyuwangi|bojonegoro|tuban|lamongan|ngawi|magetan|ponorogo|pacitan|trenggalek|tulungagung|lumajang|bondowoso|situbondo)\b/i;

const BROAD_REGION_RE = /^(?:rumah\s+d\s+|rumah\s+di\s+|di\s+|daerah\s+|wilayah\s+)?(?:surabaya\s+(?:barat|timur|selatan|utara|pusat)|surabaya|sidoarjo|gresik)$/i;

export async function executeCalculateDelivery(input: CalculateDeliveryInput): Promise<CalculateDeliveryOutput> {
  const { locationText, streetDetail, tenantId = DEFAULT_TENANT_ID, candidateTreatmentName } = input;
  const compositeQuery = streetDetail ? `${locationText} ${streetDetail}` : locationText;

  // Fast check: Jika customer secara sadar menyebut kota di luar jangkauan (misal Malang, Jakarta)
  const isExplicitOutsideCity = OUTSIDE_CITIES_RE.test(locationText);
  
  if (!locationText || locationText.trim().length < 2) {
    return {
      success: false,
      isPrecise: false,
      isOutOfCoverage: false,
      message: 'Lokasi terlalu singkat atau kosong. Mohon tanyakan nama daerah/kelurahan yang lebih jelas.'
    };
  }

  // 1. Cek Wilayah Terlalu Luas (Surabaya Barat, Surabaya Timur, Sidoarjo, dll.)
  if (BROAD_REGION_RE.test(compositeQuery.trim()) || BROAD_REGION_RE.test(locationText.trim())) {
    return {
      success: false,
      isPrecise: false,
      isOutOfCoverage: false,
      message: `Area "${locationText}" masih terlalu luas untuk menghitung jarak dan tarif ongkir pasti. Mohon sampaikan dengan ramah bahwa area ${locationText} cukup luas, lalu tanyakan nama kelurahan, perumahan, atau patokan terdekatnya agar bisa kami bantu cekkan jarak pasti dan ketersediaan Bidan.`
    };
  }

  try {
    let resolved = await geocodingService.geocodeText(compositeQuery);
    
    if (!resolved.isPrecise && compositeQuery !== locationText) {
      const locResolved = await geocodingService.geocodeText(locationText);
      if (locResolved.isPrecise) {
        resolved = locResolved;
      }
    }

    const ambiguityList = (resolved as any).ambiguityResults;
    if (ambiguityList && ambiguityList.length > 1 && !streetDetail) {
      const kecName = ambiguityList[0]?.Kecamatan || locationText;
      const kotaName = ambiguityList[0]?.Kabupaten_Kota || resolved.kota || 'Surabaya/Sidoarjo';
      return {
        success: false,
        isPrecise: false,
        kecamatan: kecName,
        kota: kotaName,
        isOutOfCoverage: false,
        message: `Area "${compositeQuery}" adalah nama kecamatan (${kecName}) yang masih luas dan membawahi ${ambiguityList.length} kelurahan/desa. Karena beda kelurahan bisa berbeda jarak dan tarif ongkir, mohon sampaikan dengan ramah bahwa area kecamatan tersebut masih luas, lalu tanyakan nama kelurahan, desa, atau perumahan spesifiknya Bunda (atau tawarkan opsi kirim share location agar titiknya presisi). DILARANG mengeluarkan nominal jarak km atau tarif ongkir!`
      };
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
        message: `Lokasi "${compositeQuery}" belum dapat ditemukan secara presisi. Mohon sampaikan dengan ramah dan tanyakan nama kelurahan, perumahan, atau patokan terdekatnya (atau tawarkan kirim share location). DILARANG mengeluarkan nominal km atau tarif ongkir!`
      };
    }

    if (!resolved.isPrecise && !resolved.kelurahan && !streetDetail) {
      return {
        success: false,
        isPrecise: false,
        isOutOfCoverage: false,
        message: `Lokasi "${compositeQuery}" masih terlalu umum (belum ada nama kelurahan/perumahan spesifik). Mohon tanyakan nama kelurahan atau perumahan terdekatnya (atau share location). DILARANG mengeluarkan nominal km atau tarif ongkir!`
      };
    }

    const deliveryResult = await deliveryService.calculateDelivery(
      { lat: resolved.lat, lng: resolved.lng },
      { lat: clinicConfig.lat, lng: clinicConfig.lng },
      tenantId
    );

    const distanceKm = deliveryResult.distanceKm;
    const ongkirNormal = deliveryResult.normalPrice;
    const ongkirPromo = deliveryResult.ongkir;
    const isOutOfCoverage = deliveryResult.isOutOfCoverage || distanceKm > 30 || isExplicitOutsideCity;

    const suggestedTemplateReply = isOutOfCoverage
      ? TEMPLATES.outOfCoverage({ distanceKm, maxCoverageKm: 30 })
      : TEMPLATES.ongkirInfo({
          distanceKm,
          normalPrice: ongkirNormal,
          promoPrice: ongkirPromo,
          freeTierKm: 5,
          candidateTreatmentName,
        });

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
      suggestedTemplateReply,
      message: isOutOfCoverage
        ? `Jarak ${distanceKm} km melebihi batas jangkauan layanan klinik (maks 30 km). Template penolakan resmi:\n"${suggestedTemplateReply}"`
        : `Jarak ${distanceKm} km (${resolved.kelurahan || '-'}, ${resolved.kecamatan || '-'}). Ongkir normal Rp ${ongkirNormal.toLocaleString('id-ID')}, promo Rp ${ongkirPromo.toLocaleString('id-ID')}.${candidateTreatmentName ? `\nTreatment yang sedang dibahas: ${candidateTreatmentName}. Hitungkan total biaya (treatment + ongkir promo) dan tanyakan hari kunjungan.` : ''}\n\nFormat penyampaian yang disarankan:\n"${suggestedTemplateReply}"`
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
