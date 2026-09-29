import { describe, it, expect } from 'vitest';
import {
  lngToWorldX,
  latToWorldY,
  worldXToLng,
  worldYToLat,
  isValidLatLng,
  chooseZoom,
  computeMapView,
  tileUrl,
  shouldPulseTherapistMarker,
  ROUTE_DOT_RADIUS_PX,
  TILE_SIZE,
  MAX_ZOOM,
  type LatLng,
} from '../../packages/admin-dashboard/src/utils/dispatchMap';

/**
 * Uji adversarial proyeksi Web Mercator untuk peta dispatch (2 titik).
 * Murni fungsi — tanpa DOM; memvalidasi presisi & ketahanan input rusak.
 */
describe('dispatchMap projection (adversarial)', () => {
  it('titik pusat dunia (0,0) → 128,128 pada zoom 0', () => {
    expect(lngToWorldX(0, 0)).toBeCloseTo(TILE_SIZE / 2, 6);
    expect(latToWorldY(0, 0)).toBeCloseTo(TILE_SIZE / 2, 6);
  });

  it('invers proyeksi bolak-balik stabil', () => {
    const samples: LatLng[] = [
      { lat: -7.28, lng: 112.74 },
      { lat: -7.45, lng: 112.7 },
    ];
    for (const s of samples) {
      const x = lngToWorldX(s.lng, 15);
      const y = latToWorldY(s.lat, 15);
      expect(worldXToLng(x, 15)).toBeCloseTo(s.lng, 6);
      expect(worldYToLat(y, 15)).toBeCloseTo(s.lat, 5);
    }
  });

  it('isValidLatLng menolak NaN, Infinity, dan di luar rentang', () => {
    expect(isValidLatLng({ lat: -7.28, lng: 112.74 })).toBe(true);
    expect(isValidLatLng({ lat: NaN, lng: 112.74 })).toBe(false);
    expect(isValidLatLng({ lat: -7.28, lng: Infinity })).toBe(false);
    expect(isValidLatLng({ lat: 999, lng: 0 })).toBe(false);
    expect(isValidLatLng({ lat: 0, lng: 200 })).toBe(false);
    expect(isValidLatLng(null)).toBe(false);
  });

  it('chooseZoom: titik berbeda ~1km menghasilkan zoom wajar; titik identik → MAX_ZOOM', () => {
    const z = chooseZoom([{ lat: -7.345, lng: 112.74 }, { lat: -7.354, lng: 112.74 }], 600, 360);
    expect(z).toBeGreaterThanOrEqual(13);
    expect(z).toBeLessThanOrEqual(MAX_ZOOM);
    const same = chooseZoom([{ lat: -7.34, lng: 112.74 }, { lat: -7.34, lng: 112.74 }], 600, 360);
    expect(same).toBe(MAX_ZOOM);
    expect(chooseZoom([], 600, 360)).toBe(13);
  });

  it('computeMapView menempatkan kedua marker di dalam viewport + tiles menutupi', () => {
    const w = 600;
    const h = 360;
    const therapist: LatLng = { lat: -7.345, lng: 112.74 };
    const customer: LatLng = { lat: -7.354, lng: 112.741 };
    const view = computeMapView([therapist, customer], [
      { point: therapist, kind: 'therapist' },
      { point: customer, kind: 'customer' },
    ], w, h);

    expect(view.markers).toHaveLength(2);
    for (const m of view.markers) {
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.x).toBeLessThanOrEqual(w);
      expect(m.y).toBeGreaterThanOrEqual(0);
      expect(m.y).toBeLessThanOrEqual(h);
    }
    expect(view.tiles.length).toBeGreaterThan(0);
    // Semua tile berada di sekitar viewport (tidak NaN / tak terhingga)
    for (const t of view.tiles) {
      expect(Number.isFinite(t.left)).toBe(true);
      expect(Number.isFinite(t.top)).toBe(true);
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThan(Math.pow(2, t.z));
    }
    expect(tileUrl({ x: 1, y: 2, z: 3, left: 0, top: 0 })).toBe('https://tile.openstreetmap.org/3/1/2.png');
  });

  it('input rusak (tanpa titik / dimensi 0) tidak pernah throw + fallback center', () => {
    const empty = computeMapView([], [], 600, 360);
    expect(empty.markers).toHaveLength(0);
    expect(empty.tiles).toHaveLength(0);
    expect(Number.isFinite(empty.center.lat)).toBe(true);

    const zero = computeMapView([{ lat: -7.3, lng: 112.7 }], [], 0, 0);
    expect(zero.tiles).toHaveLength(0);

    // Titik invalid disaring, marker invalid dibuang
    const bad = computeMapView(
      [{ lat: NaN, lng: 112 } as any, { lat: -7.3, lng: 112.7 }],
      [{ point: { lat: NaN, lng: 112 } as any, kind: 'customer' }, { point: { lat: -7.3, lng: 112.7 }, kind: 'therapist' }],
      600,
      360
    );
    expect(bad.markers).toHaveLength(1);
    expect(bad.markers[0].kind).toBe('therapist');
  });
});

/**
 * Garis rute (therapist → customer) & predikat pulse marker.
 * Garis = LURUS (Haversine/proyeksi), BUKAN rute jalan — 0 call ORS.
 */
describe('dispatchMap route & pulse (adversarial)', () => {
  const w = 600;
  const h = 360;

  it('route menghubungkan dua marker (anchor di pusat dot)', () => {
    const therapist: LatLng = { lat: -7.345, lng: 112.74 };
    const customer: LatLng = { lat: -7.354, lng: 112.741 };
    const view = computeMapView([therapist, customer], [
      { point: therapist, kind: 'therapist' },
      { point: customer, kind: 'customer' },
    ], w, h);

    expect(view.route).not.toBeNull();
    const t = view.markers.find((m) => m.kind === 'therapist')!;
    const c = view.markers.find((m) => m.kind === 'customer')!;
    expect(view.route!.x1).toBeCloseTo(t.x, 6);
    expect(view.route!.y1).toBeCloseTo(t.y - ROUTE_DOT_RADIUS_PX, 6);
    expect(view.route!.x2).toBeCloseTo(c.x, 6);
    expect(view.route!.y2).toBeCloseTo(c.y - ROUTE_DOT_RADIUS_PX, 6);
  });

  it('route null bila hanya 1 marker', () => {
    const therapist: LatLng = { lat: -7.345, lng: 112.74 };
    const view = computeMapView([therapist], [{ point: therapist, kind: 'therapist' }], w, h);
    expect(view.route).toBeNull();
    expect(view.markers).toHaveLength(1);
  });

  it('route null bila dua titik identik (degenerate)', () => {
    const p: LatLng = { lat: -7.345, lng: 112.74 };
    const view = computeMapView([p, { ...p }], [
      { point: p, kind: 'therapist' },
      { point: { ...p }, kind: 'customer' },
    ], w, h);
    expect(view.route).toBeNull();
  });

  it('route null bila input kosong / dimensi 0', () => {
    expect(computeMapView([], [], w, h).route).toBeNull();
    const zero = computeMapView([{ lat: -7.3, lng: 112.7 }, { lat: -7.31, lng: 112.71 }], [], 0, 0);
    expect(zero.route).toBeNull();
  });

  it('input rusak (NaN / lat di luar rentang) tidak throw, route null', () => {
    const bad = computeMapView(
      [{ lat: NaN, lng: 112 } as any, { lat: -7.3, lng: 112.7 }],
      [
        { point: { lat: NaN, lng: 112 } as any, kind: 'customer' },
        { point: { lat: -7.3, lng: 112.7 }, kind: 'therapist' },
      ],
      w,
      h
    );
    expect(bad.route).toBeNull();
    expect(bad.markers).toHaveLength(1);
  });

  it('shouldPulseTherapistMarker: hanya saat marker ada DAN data live', () => {
    expect(shouldPulseTherapistMarker(true, true)).toBe(true);
    expect(shouldPulseTherapistMarker(true, false)).toBe(false);
    expect(shouldPulseTherapistMarker(false, true)).toBe(false);
    expect(shouldPulseTherapistMarker(false, false)).toBe(false);
  });
});
