import { geocodingService } from '../../integrations/google-maps/geocoding';
import { deliveryService } from '../../services/delivery.service';
import { clinicConfig } from '../../config/clinic';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { TEMPLATES } from '../../config/persona';
import { extractGoogleMapsUrls, resolveGoogleMapsUrl } from '../../utils/google-maps-url-resolver';

export interface CartSnapshotItem {
  name: string;
  price: number;
  promoPrice?: number | null;
}

export interface CalculateDeliveryInput {
  locationText: string;
  streetDetail?: string;
  tenantId?: string;
  candidateTreatmentName?: string;
  /**
   * Phase 2 (audit 315036): snapshot keranjang aktif (dari session, via
   * tool-registry). Bila terisi, output WAJIB memuat rekap subtotal + ongkir
   * + grand total agar Call 2 tidak "kehilangan" total biaya.
   */
  cartSnapshot?: CartSnapshotItem[];
  /**
   * Audit 337101 (anti CTA-looping): waktu yang sudah diminta/disepakati
   * customer ("sekarang"/"hari ini"/nama hari). Bila terisi, template DILARANG
   * menanyakan "di hari apa" lagi — langsung respon pengecekan waktu tsb.
   */
  preferredDate?: string;
}

/**
 * Audit 337101: pilih CTA jadwal context-aware (pure function, testable).
 * Ada waktu yang diminta → akui + cekkan (tanpa tanya hari ulang).
 * Belum ada → tanya hari santai (perilaku lama).
 */
export function buildScheduleCta(preferredDate?: string): string {
  if (preferredDate && preferredDate.trim()) {
    const when = preferredDate.trim();
    return `Untuk ketersediaan jadwal ${when}nya, akan kami bantu cekkan ketersediaan jadwal terlebih dahulu ya Bunda 🙏😊`;
  }
  return 'Untuk layanannya, rencana mau kami bantu jadwalkan di hari apa ya Bunda? 🙏😊';
}

/**
 * Phase 2 (audit 315036): susun blok rekap keranjang + grand total dari
 * snapshot deterministik (harga promo per item + ongkir promo). Pure function.
 */
export function buildCartTotalRecap(
  cart: CartSnapshotItem[] | undefined,
  ongkirPromo: number
): { block: string; grandTotal: number; subtotal: number } | null {
  if (!cart || cart.length === 0) return null;
  const fmtRp = (n: number): string => `Rp ${n.toLocaleString('id-ID')}`;
  const lines = cart.map((it) => {
    const p = typeof it.promoPrice === 'number' ? it.promoPrice : it.price;
    return `- ${it.name}: ${fmtRp(p)}`;
  });
  const subtotal = cart.reduce(
    (s, it) => s + (typeof it.promoPrice === 'number' ? it.promoPrice : it.price), 0
  );
  const grandTotal = subtotal + ongkirPromo;
  const block = `Rincian layanan yang Bunda pilih:\n${lines.join('\n')}\n+ Ongkir promo: ${fmtRp(ongkirPromo)}\nTotal keseluruhan: *${fmtRp(grandTotal)}*`;
  return { block, grandTotal, subtotal };
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
    description: 'Wajib dipanggil setiap kali customer menyebutkan nama lokasi/rumah/daerah/kelurahan/desa/kecamatan/kota (termasuk Surabaya, Sidoarjo, Gresik, Menganti, atau daerah sekitar lainnya) untuk memverifikasi apakah jarak rute jalan masih dalam jangkauan homecare (<= 30 km) serta menghitung tarif ongkir resmi (normal & promo). DILARANG menanyakan jarak km kepada customer.',
    parameters: {
      type: 'object',
      properties: {
        locationText: {
          type: 'string',
          description: 'Nama kelurahan, desa, perumahan, patokan, kecamatan, kota, alamat lengkap customer (misal: "Pelemwatu Menganti Gresik"), ATAU tautan lokasi Google Maps yang dikirim customer (share.google, maps.app.goo.gl, goo.gl/maps — kirim URL apa adanya, tool akan meresolve koordinatnya otomatis).'
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

// ---------------------------------------------------------------------------
// Validasi batas & wilayah luas — data-driven tanpa regex hafalan (Pilar 5):
// - Daftar kota luar sebagai DATA (bukan regex); keputusan final tetap berbasis
//   jarak koordinat riil (distanceKm > 30) + kota hasil geocoding hierarkis.
// - Wilayah luas dicek via pencocokan token includes terhadap gazetteer/kota,
//   bukan regex kaku.
// ---------------------------------------------------------------------------
const OUTSIDE_CITY_NAMES = [
  'malang', 'jakarta', 'bandung', 'semarang', 'yogyakarta', 'jogja', 'bali', 'denpasar',
  'kediri', 'blitar', 'madiun', 'probolinggo', 'pasuruan', 'jember', 'banyuwangi',
  'bojonegoro', 'tuban', 'lamongan', 'ngawi', 'magetan', 'ponorogo', 'pacitan',
  'trenggalek', 'tulungagung', 'lumajang', 'bondowoso', 'situbondo', 'medan',
];

/** Sinyal awal kota luar via includes data-driven (bukan regex). */
function textMentionsOutsideCity(text: string): boolean {
  const lower = (text || '').toLowerCase();
  if (!lower) return false;
  return OUTSIDE_CITY_NAMES.some((c) => lower.includes(c));
}

/** Kota hasil geocoding di luar hierarki cakupan homecare (Surabaya/Sidoarjo/Gresik). */
function isOutsideCoverageKota(kota: string | undefined): boolean {
  const lower = (kota || '').toLowerCase();
  if (!lower) return false;
  const inside = ['surabaya', 'sidoarjo', 'gresik', 'sby', 'sda', 'jawa timur'];
  if (inside.some((k) => lower.includes(k))) return false;
  return textMentionsOutsideCity(lower);
}

const COVERAGE_CITY_NAMES = ['surabaya', 'sidoarjo', 'gresik', 'sby', 'sda'];
const CITY_DIRECTION_WORDS = ['barat', 'timur', 'selatan', 'utara', 'pusat'];
const BROAD_PREFIXES = ['rumah d ', 'rumah di ', 'daerah ', 'wilayah ', 'di ', 'ke ', 'kecamatan ', 'kec ', 'kota '];

/** Normalisasi ringan tanpa regex: lowercase + trim + rapikan spasi ganda. */
function normalizeRegionQuery(text: string): string {
  let s = (text || '').toLowerCase().trim();
  let collapsed = '';
  let prevSpace = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const isSpace = ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
    if (isSpace) {
      if (!prevSpace) collapsed += ' ';
      prevSpace = true;
    } else {
      collapsed += ch;
      prevSpace = false;
    }
  }
  return collapsed.trim();
}

/**
 * Deteksi wilayah terlalu luas secara data-driven (pengganti BROAD_REGION_RE):
 * query yang setelah dikupas prefix-nya hanya tersisa nama kota/kabupaten besar
 * ("surabaya", "sidoarjo", "gresik") atau kota + arah ("surabaya barat").
 */
function isBroadRegionQuery(text: string): boolean {
  let s = normalizeRegionQuery(text);
  if (!s) return false;
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const p of BROAD_PREFIXES) {
      if (s.startsWith(p)) {
        s = s.slice(p.length).trim();
        stripped = true;
        break;
      }
    }
  }
  if (COVERAGE_CITY_NAMES.includes(s)) return true;
  const parts = s.split(' ').filter((t) => t.length > 0);
  if (parts.length === 2 && COVERAGE_CITY_NAMES.includes(parts[0]) && CITY_DIRECTION_WORDS.includes(parts[1])) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Data-driven kecamatan matcher (toleran typo ringan, tanpa regex patchwork):
// mengenali nama kecamatan resmi dari database gazetteer di dalam query,
// termasuk varian salah ketik 1 huruf (misal "memganti" → "Menganti").
// Delegates to central gazetteer service (Single Source of Truth) — no direct fs I/O.
// ---------------------------------------------------------------------------
import { getGazetteerKecamatanEntries } from '../../utils/gazetteer';

function getKecamatanNames(): Array<{ lower: string; orig: string }> {
  // Filter len >=4 to match previous behavior (skip short kecamatan names)
  return getGazetteerKecamatanEntries().filter((e) => e.lower.length >= 4);
}

export function initKecamatanGazetteerSync(): void {
  // Eagerly warm central cache — no-op if already initialized
  getKecamatanNames();
}
initKecamatanGazetteerSync();

function levenshteinAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    edits++;
    if (edits > 1) return false;
    if (la === lb) { i++; j++; } else if (la > lb) { i++; } else { j++; }
  }
  return edits + (la - i) + (lb - j) <= 1;
}

/** Kembalikan nama kecamatan resmi yang disebut (atau typo 1-huruf) di query, atau null. */
const KECAMATAN_TOKEN_SKIPLIST = new Set(['kota', 'desa', 'jawa', 'timur', 'kecamatan', 'kabupaten', 'surabaya', 'sidoarjo', 'gresik', 'sby', 'sda']);
function findKecamatanInQuery(query: string): string | null {
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !KECAMATAN_TOKEN_SKIPLIST.has(t));
  if (tokens.length === 0) return null;
  for (const { lower, orig } of getKecamatanNames()) {
    for (const t of tokens) {
      if (t === lower || t.includes(lower) || lower.includes(t)) return orig;
      if (lower.length >= 6 && levenshteinAtMostOne(t, lower)) return orig;
    }
  }
  return null;
}

export async function executeCalculateDelivery(input: CalculateDeliveryInput): Promise<CalculateDeliveryOutput> {
  const { locationText, streetDetail, tenantId = DEFAULT_TENANT_ID, candidateTreatmentName, cartSnapshot, preferredDate } = input;
  // `let` agar fallback addressQuery dari link Maps bisa menggantikan query
  // mentah secara transparan (Phase 0 audit 315036).
  let compositeQuery = streetDetail ? `${locationText} ${streetDetail}` : locationText;

  // Phase 0 — Resolusi shortlink Google Maps (share.google / maps.app.goo.gl /
  // goo.gl/maps): customer yang kirim link lokasi LANGSUNG dihitung jarak &
  // ongkirnya tanpa diminta shareloc ulang. Gagal resolve → jatuh ke jalur
  // geocoding teks biasa di bawah (tidak pernah melempar error ke customer).
  // Deviasi dari plan: deliveryService.calculateDeliveryByCoords() tidak ada —
  // dipakai calculateDelivery({lat, lng}, undefined, tenantId) sesuai API riil
  // (preseden: human-background-enrichment.service.ts).
  try {
    const mapsUrls = extractGoogleMapsUrls(compositeQuery);
    if (mapsUrls.length > 0) {
      const resolvedCoords = await resolveGoogleMapsUrl(mapsUrls[0]);
      if (resolvedCoords.success && resolvedCoords.lat != null && resolvedCoords.lng != null) {
        const lat = resolvedCoords.lat;
        const lng = resolvedCoords.lng;
        const reversed = await geocodingService.reverseGeocode(lat, lng).catch(() => null);
        const deliveryResult = await deliveryService.calculateDelivery({ lat, lng }, undefined, tenantId);
        const distanceKm = deliveryResult.distanceKm;
        const ongkirNormal = deliveryResult.normalPrice;
        const ongkirPromo = deliveryResult.ongkir;
        const isOutOfCoverage = deliveryResult.isOutOfCoverage || distanceKm > 30;
        const kelurahan = reversed?.kelurahan || 'Titik Lokasi Terpilih';
        const scheduleCta = !isOutOfCoverage ? buildScheduleCta(preferredDate) : undefined;
        const suggestedTemplateReply = isOutOfCoverage
          ? TEMPLATES.outOfCoverage({ distanceKm, maxCoverageKm: 30 })
          : TEMPLATES.ongkirInfo({
              distanceKm,
              normalPrice: ongkirNormal,
              promoPrice: ongkirPromo,
              freeTierKm: 5,
              candidateTreatmentName,
              // Audit 337101: override CTA di DALAM template (bukan append)
              // agar pertanyaan "hari apa" bawaan template ikut terganti.
              ...(scheduleCta && preferredDate ? { scheduleCta } : {}),
            });
        console.log(JSON.stringify({ event: 'V3_TOOL_DELIVERY_URL_RESOLVED', tenantId, lat, lng, distanceKm, timestamp: new Date().toISOString() }));
        // Phase 2: rekap keranjang + grand total (bila snapshot tersedia).
        const urlCartRecap = isOutOfCoverage ? null : buildCartTotalRecap(cartSnapshot, ongkirPromo);
        const urlTemplate = urlCartRecap
          ? `${suggestedTemplateReply}\n\n${urlCartRecap.block}${preferredDate ? '' : `\n\n${buildScheduleCta(undefined)}`}`
          : suggestedTemplateReply;
        return {
          success: true,
          isPrecise: true,
          kelurahan,
          kecamatan: reversed?.kecamatan,
          kota: reversed?.kota || 'Sidoarjo/Surabaya',
          formattedAddress: reversed?.formattedAddress,
          distanceKm,
          ongkirNormal,
          ongkirPromo,
          isOutOfCoverage,
          suggestedTemplateReply: urlTemplate,
          message: isOutOfCoverage
            ? `Titik share location berhasil diidentifikasi: jarak rute kurang lebih ${distanceKm} km, melebihi batas jangkauan layanan klinik (maks 30 km). Template penolakan resmi:\n"${urlTemplate}"`
            : `Titik share location berhasil diidentifikasi: Jarak rute kurang lebih ${distanceKm} km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp ${ongkirNormal.toLocaleString('id-ID')}, tetapi karena promo menjadi Rp ${ongkirPromo.toLocaleString('id-ID')}.${candidateTreatmentName ? `\nTreatment yang sedang dibahas: ${candidateTreatmentName}.` : ''}${urlCartRecap ? `\n\n${urlCartRecap.block}` : ''}\n\nFormat penyampaian yang disarankan:\n"${urlTemplate}"`
        };
      }
      // Fallback alamat (audit 315036): pin tempat tanpa koordinat tetapi
      // membawa teks alamat (?q=...) → gantikan query mentah dengan teks
      // alamatnya agar geocoding teks di bawah memprosesnya transparan.
      // Raw URL Maps DILARANG dilempar ke geocodingService.geocodeText().
      if (resolvedCoords.addressQuery) {
        compositeQuery = streetDetail
          ? `${resolvedCoords.addressQuery} ${streetDetail}`
          : resolvedCoords.addressQuery;
        console.log(JSON.stringify({ event: 'V3_TOOL_DELIVERY_URL_ADDRESS_FALLBACK', tenantId, addressQuery: resolvedCoords.addressQuery, timestamp: new Date().toISOString() }));
      }
    }
  } catch (urlErr: any) {
    console.warn(JSON.stringify({ event: 'V3_TOOL_DELIVERY_URL_FALLBACK', tenantId, error: urlErr?.message, timestamp: new Date().toISOString() }));
  }

  // Sinyal awal kota luar (data-driven includes, bukan regex hafalan).
  // Keputusan final tetap berbasis jarak koordinat riil + hierarki kota geocoding.
  const isExplicitOutsideCity = textMentionsOutsideCity(locationText);

  if (!locationText || locationText.trim().length < 2) {
    return {
      success: false,
      isPrecise: false,
      isOutOfCoverage: false,
      message: 'Lokasi terlalu singkat atau kosong. Mohon tanyakan nama daerah/kelurahan yang lebih jelas.'
    };
  }

  // 1. Cek Wilayah Terlalu Luas (Surabaya Barat, Surabaya Timur, Sidoarjo, dll.)
  // Data-driven via gazetteer level kota (pengganti BROAD_REGION_RE).
  if (isBroadRegionQuery(compositeQuery) || isBroadRegionQuery(locationText)) {
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

      // Query tanpa koordinat tapi memuat nama kecamatan (termasuk typo ringan) —
      // tetap intersepsi sebagai kecamatan luas, bukan generic "tidak ditemukan".
      const kecNoCoords = findKecamatanInQuery(compositeQuery);
      if (kecNoCoords) {
        return {
          success: false,
          isPrecise: false,
          kecamatan: kecNoCoords,
          kota: resolved.kota,
          isOutOfCoverage: false,
          message: `Area "${kecNoCoords}" adalah nama kecamatan yang masih cukup luas dan membawahi banyak kelurahan/desa. Mohon sampaikan dengan ramah bahwa area kecamatan tersebut masih luas, lalu tanyakan nama kelurahan, desa, atau perumahan spesifiknya Bunda (atau share location). DILARANG mengeluarkan nominal jarak km atau tarif ongkir!`
        };
      }

      return {
        success: false,
        isPrecise: false,
        isOutOfCoverage: false,
        message: `Lokasi "${compositeQuery}" belum dapat ditemukan secara presisi. Mohon sampaikan dengan ramah dan tanyakan nama kelurahan, perumahan, atau patokan terdekatnya (atau tawarkan kirim share location). DILARANG mengeluarkan nominal km atau tarif ongkir!`
      };
    }

    // Intersepsi KECAMATAN LUAS: hasil hanya setingkat kecamatan (tanpa kelurahan/desa),
    // baik via ambiguity gazetteer maupun komponen Google administrative_area_level_3 —
    // WAJIB minta kelurahan/desa, DILARANG mengeluarkan nominal jarak/ongkir.
    const kecAmbiguity = (resolved as any).ambiguityResults;
    const kecLevelName = (!resolved.kelurahan && resolved.kecamatan)
      ? resolved.kecamatan
      : (Array.isArray(kecAmbiguity) && kecAmbiguity.length > 0
        ? (kecAmbiguity[0]?.Kecamatan || (resolved as any).matchedSpan || null)
        : findKecamatanInQuery(compositeQuery));
    if (!resolved.isPrecise && !resolved.kelurahan && !streetDetail && kecLevelName) {
      return {
        success: false,
        isPrecise: false,
        kecamatan: typeof kecLevelName === 'string' ? kecLevelName : undefined,
        kota: resolved.kota,
        isOutOfCoverage: false,
        message: `Area "${kecLevelName}" adalah nama kecamatan yang masih cukup luas dan membawahi banyak kelurahan/desa. Mohon sampaikan dengan ramah bahwa area kecamatan tersebut masih luas, lalu tanyakan nama kelurahan, desa, atau perumahan spesifiknya Bunda (atau share location). DILARANG mengeluarkan nominal jarak km atau tarif ongkir!`
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
    // Hierarki batas jangkauan: jarak riil > 30 km ATAU kota administratif hasil
    // geocoding di luar Surabaya/Sidoarjo/Gresik. Sinyal mention kota luar hanya
    // dipakai bila geocoding tidak mengembalikan kota pembanding.
    const kotaOutside = isOutsideCoverageKota(resolved.kota);
    const isOutOfCoverage = deliveryResult.isOutOfCoverage || distanceKm > 30 || kotaOutside
      || (isExplicitOutsideCity && !resolved.kota);

    const baseTemplateReply = isOutOfCoverage
      ? TEMPLATES.outOfCoverage({ distanceKm, maxCoverageKm: 30 })
      : TEMPLATES.ongkirInfo({
          distanceKm,
          normalPrice: ongkirNormal,
          promoPrice: ongkirPromo,
          freeTierKm: 5,
          candidateTreatmentName,
          // Audit 337101: override CTA di DALAM template (bukan append)
          // agar pertanyaan "hari apa" bawaan template ikut terganti.
          ...(preferredDate ? { scheduleCta: buildScheduleCta(preferredDate) } : {}),
        });

    // Phase 2 (audit 315036) — Mandat Total Biaya Otomatis: bila keranjang
    // terisi, template + message WAJIB memuat rekap item + grand total agar
    // Call 2 tidak "kehilangan" total biaya (angka dari snapshot deterministik).
    const cartRecap = isOutOfCoverage ? null : buildCartTotalRecap(cartSnapshot, ongkirPromo);
    const suggestedTemplateReply = cartRecap
      ? `Jika dilihat dari jaraknya kurang lebih ${distanceKm} km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp ${ongkirNormal.toLocaleString('id-ID')}, tetapi karena promo menjadi Rp ${ongkirPromo.toLocaleString('id-ID')} saja ya Bunda ☺️\n\n${cartRecap.block}${preferredDate ? '' : `\n\n${buildScheduleCta(undefined)}`}`
      : baseTemplateReply;

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
        : `Jarak ${distanceKm} km (${resolved.kelurahan || '-'}, ${resolved.kecamatan || '-'}). Ongkir normal Rp ${ongkirNormal.toLocaleString('id-ID')}, promo Rp ${ongkirPromo.toLocaleString('id-ID')}.${candidateTreatmentName ? `\nTreatment yang sedang dibahas: ${candidateTreatmentName}. Hitungkan total biaya (treatment + ongkir promo) dan tanyakan hari kunjungan.` : ''}${cartRecap ? `\n\n${cartRecap.block}` : ''}\n\nFormat penyampaian yang disarankan:\n"${suggestedTemplateReply}"`
    };
  } catch (error: any) {
    console.error(JSON.stringify({ event: 'V3_TOOL_DELIVERY_ERROR', tenantId, error: error.message, timestamp: new Date().toISOString() }));
    return {
      success: false,
      isPrecise: false,
      isOutOfCoverage: false,
      message: `Gagal menghitung ongkir: ${error.message}`
    };
  }
}
