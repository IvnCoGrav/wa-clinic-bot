/**
 * dispatchMap.ts — proyeksi Web Mercator + komposisi tile OSM tanpa dependency.
 *
 * Murni fungsi (tanpa DOM/React) agar dapat diuji adversarial. Dipakai oleh
 * `DispatchMapModal` untuk menggambar 2 titik (motor Bidan vs rumah pasien)
 * secara presisi menggunakan raster tile OpenStreetMap (tanpa API key/Leaflet).
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface TileRef {
  x: number;
  y: number;
  z: number;
  left: number;
  top: number;
}

export interface MapMarker {
  x: number;
  y: number;
  kind: 'therapist' | 'customer';
}

/** Segmen garis lurus Bidan→pasien dalam koordinat pixel viewport (garis LURUS, bukan rute jalan). */
export interface MapRouteSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Setengah diameter dot marker px (w-3.5 = 14px) — anchor garis ke pusat dot. */
export const ROUTE_DOT_RADIUS_PX = 7;

export interface MapView {
  zoom: number;
  width: number;
  height: number;
  center: LatLng;
  tiles: TileRef[];
  markers: MapMarker[];
  /** Garis lurus Bidan→pasien; null bila salah satu titik absen atau titik identik. */
  route: MapRouteSegment | null;
}

export const TILE_SIZE = 256;
/** Pusat default bila tidak ada titik valid (Surabaya). */
export const DEFAULT_CENTER: LatLng = { lat: -7.2575, lng: 112.7521 };
export const MIN_ZOOM = 3;
export const MAX_ZOOM = 18;

export function isValidLatLng(p: LatLng | null | undefined): p is LatLng {
  return (
    !!p &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lng >= -180 &&
    p.lng <= 180
  );
}

export function lngToWorldX(lng: number, zoom: number): number {
  return ((lng + 180) / 360) * TILE_SIZE * Math.pow(2, zoom);
}

export function latToWorldY(lat: number, zoom: number): number {
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
  const rad = (clamped * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
    TILE_SIZE *
    Math.pow(2, zoom)
  );
}

export function worldXToLng(x: number, zoom: number): number {
  return (x / (TILE_SIZE * Math.pow(2, zoom))) * 360 - 180;
}

export function worldYToLat(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / (TILE_SIZE * Math.pow(2, zoom));
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * Pilih zoom tertinggi sehingga semua titik masuk dalam `fitRatio` area viewport.
 * Titik tunggal → MAX_ZOOM (peta sedekat mungkin).
 */
export function chooseZoom(
  points: LatLng[],
  width: number,
  height: number,
  fitRatio = 0.6,
  minZoom = MIN_ZOOM,
  maxZoom = MAX_ZOOM
): number {
  const pts = points.filter(isValidLatLng);
  if (pts.length === 0 || width <= 0 || height <= 0) return 13;
  for (let z = maxZoom; z >= minZoom; z--) {
    const xs = pts.map((p) => lngToWorldX(p.lng, z));
    const ys = pts.map((p) => latToWorldY(p.lat, z));
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    if (w <= width * fitRatio && h <= height * fitRatio) return z;
  }
  return minZoom;
}

export function computeMapView(
  points: LatLng[],
  markers: Array<{ point: LatLng; kind: MapMarker['kind'] }>,
  width: number,
  height: number
): MapView {
  const valid = points.filter(isValidLatLng);
  if (valid.length === 0 || width <= 0 || height <= 0) {
    return { zoom: 13, width, height, center: DEFAULT_CENTER, tiles: [], markers: [], route: null };
  }

  const zoom = chooseZoom(valid, width, height);
  const xs = valid.map((p) => lngToWorldX(p.lng, zoom));
  const ys = valid.map((p) => latToWorldY(p.lat, zoom));
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const left = centerX - width / 2;
  const top = centerY - height / 2;

  const maxIndex = Math.pow(2, zoom) - 1;
  const minTx = Math.floor(left / TILE_SIZE);
  const maxTx = Math.floor((left + width) / TILE_SIZE);
  const minTy = Math.floor(top / TILE_SIZE);
  const maxTy = Math.floor((top + height) / TILE_SIZE);

  const tiles: TileRef[] = [];
  for (let ty = minTy; ty <= maxTy; ty++) {
    if (ty < 0 || ty > maxIndex) continue;
    for (let tx = minTx; tx <= maxTx; tx++) {
      const wrappedX = ((tx % (maxIndex + 1)) + (maxIndex + 1)) % (maxIndex + 1);
      tiles.push({
        x: wrappedX,
        y: ty,
        z: zoom,
        left: tx * TILE_SIZE - left,
        top: ty * TILE_SIZE - top,
      });
    }
  }

  const outMarkers: MapMarker[] = markers
    .filter((m) => isValidLatLng(m.point))
    .map((m) => ({
      x: lngToWorldX(m.point.lng, zoom) - left,
      y: latToWorldY(m.point.lat, zoom) - top,
      kind: m.kind,
    }));

  // Garis lurus Bidan→pasien (Haversine/proyeksi, 0 call ORS). Anchor ke pusat
  // dot marker (transform translate(-50%,-100%) → titik = pusat dot di y-7px).
  const therapistMark = outMarkers.find((m) => m.kind === 'therapist');
  const customerMark = outMarkers.find((m) => m.kind === 'customer');
  let route: MapRouteSegment | null = null;
  if (therapistMark && customerMark) {
    const dx = therapistMark.x - customerMark.x;
    const dy = therapistMark.y - customerMark.y;
    if (dx * dx + dy * dy >= 1) {
      route = {
        x1: therapistMark.x,
        y1: therapistMark.y - ROUTE_DOT_RADIUS_PX,
        x2: customerMark.x,
        y2: customerMark.y - ROUTE_DOT_RADIUS_PX,
      };
    }
  }

  return {
    zoom,
    width,
    height,
    center: { lat: worldYToLat(centerY, zoom), lng: worldXToLng(centerX, zoom) },
    tiles,
    markers: outMarkers,
    route,
  };
}

/** URL tile OSM untuk sebuah TileRef. */
export function tileUrl(t: TileRef): string {
  return `https://tile.openstreetmap.org/${t.z}/${t.x}/${t.y}.png`;
}

/**
 * Marker Bidan boleh berdenyut hanya bila titik Bidan ADA dan data live (segar).
 * Data basi → titik diam (konsisten dengan dot status widget).
 */
export function shouldPulseTherapistMarker(hasTherapist: boolean, isLive: boolean): boolean {
  return hasTherapist && isLive;
}
