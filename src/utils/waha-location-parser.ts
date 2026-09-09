/**
 * waha-location-parser.ts — Normalisasi koordinat lokasi inbound WAHA.
 *
 * Latar belakang (kasus Bunda Retno): WAHA NOWEB (engine Baileys) mengirim
 * lokasi WhatsApp asli di `payload._data.message.locationMessage`
 * (`degreesLatitude` / `degreesLongitude`), BUKAN di `payload.location`.
 * Parser lama hanya membaca `payload.location.latitude` sehingga shareloc
 * asli menghasilkan NaN dan dianggap pesan teks biasa — koordinat GPS tidak
 * pernah tersimpan dan `share_location_sent` tetap FALSE (invarian sticky
 * GPS tidak pernah menyala).
 *
 * Fungsi murni (tanpa I/O) agar deterministik & unit-testable. Struktur yang
 * didukung (prioritas berurutan):
 *  1. `payload.location` / `_data.location` (`latitude` / `longitude`)
 *  2. Baileys `locationMessage` (`latitude`/`longitude` ATAU
 *     `degreesLatitude`/`degreesLongitude`) di `_data.message` / `message`
 *  3. `liveLocationMessage` (format sama, di kedua path di atas)
 */

export interface WahaLocationParseResult {
  rawLat: number;
  rawLng: number;
  /** Tipe pesan bertanda lokasi (field `type` ATAU ada locationMessage). */
  isLocationMsgType: boolean;
  /**
   * Lokasi GPS riil: koordinat valid non-nol, ATAU bertipe lokasi dengan
   * latitude terbaca. NaN murni (tanpa koordinat sama sekali) → false agar
   * tidak bocor sebagai `[LOCATION: Lat NaN...]` ke pipeline.
   */
  hasRealLocation: boolean;
}

function toNumberOrNaN(value: unknown): number {
  if (value === null || value === undefined) return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

export function extractWahaLocation(payload: any): WahaLocationParseResult {
  const pAny = (payload || {}) as any;

  const locMsg =
    pAny._data?.message?.locationMessage ||
    pAny.message?.locationMessage ||
    pAny._data?.message?.liveLocationMessage ||
    pAny.message?.liveLocationMessage ||
    null;

  const rawLoc =
    pAny.location ||
    pAny._data?.location ||
    locMsg ||
    null;

  const rawLat =
    rawLoc?.latitude != null
      ? toNumberOrNaN(rawLoc.latitude)
      : rawLoc?.degreesLatitude != null
        ? toNumberOrNaN(rawLoc.degreesLatitude)
        : NaN;

  const rawLng =
    rawLoc?.longitude != null
      ? toNumberOrNaN(rawLoc.longitude)
      : rawLoc?.degreesLongitude != null
        ? toNumberOrNaN(rawLoc.degreesLongitude)
        : NaN;

  const isLocationMsgType =
    pAny.type === 'location' ||
    pAny._data?.type === 'location' ||
    !!locMsg;

  // Koordinat EXIF/WA Web image (0,0) DIBUANG — bukan lokasi riil.
  const hasValidCoords =
    !isNaN(rawLat) && !isNaN(rawLng) && rawLat !== 0 && rawLng !== 0;
  const hasRealLocation =
    hasValidCoords || (isLocationMsgType && !isNaN(rawLat));

  return { rawLat, rawLng, hasRealLocation, isLocationMsgType };
}
