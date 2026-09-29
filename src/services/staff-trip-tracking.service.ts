/**
 * staff-trip-tracking.service.ts
 *
 * Pelacakan perjalanan terapis (internal CS, bukan bot customer).
 * Fondasional Fase 1: store transient in-memory + TTL, kontrak stabil untuk
 * wiring Redis (SETEX) di Fase 2 tanpa mengubah API.
 *
 * Catatan penamaan: sengaja BUKAN `telemetry-tracking` agar tidak tabrakan
 * dengan `telemetry.service.ts` (AI health).
 *
 * Prinsip:
 * - Tenant-scoped: semua method wajib `tenantId` non-kosong, tanpa default
 *   tersembunyi. Key isolasi: `trip:{tenantId}:{reservationId}`.
 * - Offline-safe: murni memori + `haversineKm`/`findNearestSubdistrict` lokal.
 *   Tanpa Prisma, tanpa fetch network, tanpa koneksi Redis wajib — sehingga
 *   `npm test` (DB offline, ORS blank) tetap hijau.
 * - Fail-safe: resolver nama area tidak pernah throw; koordinat invalid
 *   mengembalikan null / melempar error validasi yang jelas di seam tulis.
 */

import { haversineKm, findNearestSubdistrict } from '../utils/gazetteer';
import { POPULAR_LANDMARKS } from '../config/landmarks';

/** TTL sesi trip (detik). 10 menit — selaras dengan auto-expiry anti-lupa. */
export const TRIP_PING_TTL_SEC = 600;

/** #162e: grace setelah jadwal+durasi lewat sebelum sesi trip auto-close (1 jam). */
export const TRIP_AUTO_CLOSE_GRACE_MS = 60 * 60 * 1000;

/**
 * #162e: apakah sesi trip sudah melewati jadwal kunjungan + durasi + grace.
 * Murni deterministik (tanpa I/O). Fail-open: booking_date null/invalid → false
 * (jangan tutup sesi secara buta tanpa dasar jadwal).
 */
export function isTripScheduleExpired(
  bookingDate: Date | null | undefined,
  durationMinutes: number | null | undefined,
  now: Date = new Date()
): boolean {
  if (!bookingDate) return false;
  const startMs = bookingDate instanceof Date ? bookingDate.getTime() : NaN;
  if (!Number.isFinite(startMs)) return false;
  const durMin =
    typeof durationMinutes === 'number' && Number.isFinite(durationMinutes) && durationMinutes > 0
      ? durationMinutes
      : 60;
  const endMs = startMs + durMin * 60 * 1000 + TRIP_AUTO_CLOSE_GRACE_MS;
  return now.getTime() > endMs;
}

/** Batas geofence anti-lost (global operasional, bukan data bisnis per-tenant). */
// TODO(tenant-aware): pindahkan ke ClinicPolicy bila tiap tenant butuh ambang beda.
export const GEOFENCE_STALLED_SEC = 180;
export const GEOFENCE_MIN_DIST_M = 300;
export const GEOFENCE_MAX_DIST_M = 1500;
/** Akurasi GPS di atas ini dianggap drift indoor — disimpan tapi tidak memicu alert. */
export const GPS_LOW_ACCURACY_M = 100;

export interface TripPing {
  lat: number;
  lng: number;
  speed?: number | null;
  heading?: number | null;
  accuracy?: number | null;
}

export interface TripRecord extends TripPing {
  tenantId: string;
  reservationId: string;
  staffId: string;
  areaName: string;
  createdAt: number;
  updatedAt: number;
  /** Timestamp gerak terakhir (perpindahan > 30m). Dasar deteksi stalled. */
  movedAt: number;
}

export interface TripProgress {
  remainingKm: number;
  etaMinutes: number;
}

export interface GeofenceResult {
  isStalledOutsideTarget: boolean;
  distanceM: number | null;
  reason: string;
}

function tripKey(tenantId: string, reservationId: string): string {
  return `trip:${tenantId}:${reservationId}`;
}

function assertTenant(tenantId: string): void {
  if (!tenantId || typeof tenantId !== 'string' || !tenantId.trim()) {
    throw new Error('TRIP_TENANT_REQUIRED: tenantId wajib diisi eksplisit.');
  }
}

function assertIds(reservationId: string, staffId: string): void {
  if (!reservationId || typeof reservationId !== 'string' || !reservationId.trim()) {
    throw new Error('TRIP_RESERVATION_REQUIRED: reservationId wajib diisi.');
  }
  if (!staffId || typeof staffId !== 'string' || !staffId.trim()) {
    throw new Error('TRIP_STAFF_REQUIRED: staffId wajib diisi.');
  }
}

function isValidCoord(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function toFiniteOrNull(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Ubah koordinat menjadi nama area manusiawi untuk CS.
 * Otoritas: landmark berkoordinat terdekat (<=2km) > gazetteer desa terdekat
 * > fallback generik. Tidak pernah throw, tidak pernah string kosong.
 * Catatan: ARTERY_CORRIDORS (landmarks.ts) adalah text-match, BUKAN
 * reverse-geocode — sehingga TIDAK dipakai di sini.
 */
export function resolveHumanAreaName(lat: number, lng: number): string {
  try {
    if (!isValidCoord(lat, lng)) return 'Area perjalanan';
    let bestName: string | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const lm of POPULAR_LANDMARKS) {
      if (typeof lm.lat !== 'number' || typeof lm.lng !== 'number') continue;
      const d = haversineKm(lat, lng, lm.lat, lm.lng);
      if (d < bestDist) {
        bestDist = d;
        bestName = lm.name;
      }
    }
    if (bestName && bestDist <= 2) return bestName;
    const near = findNearestSubdistrict(lat, lng);
    if (near) {
      const kec = (near.kecamatan || '').trim();
      const kota = (near.kota || '').trim();
      if (kec && kota) return `Area ${kec}, ${kota}`;
      if (kec) return `Area ${kec}`;
      if (kota) return `Area ${kota}`;
    }
    return 'Area perjalanan';
  } catch {
    return 'Area perjalanan';
  }
}

/**
 * Sisa jarak + ETA motor. Faktor 1.25x untuk rute jalan vs garis lurus,
 * kecepatan rerata 25 km/jam urban. Clamp 1–120 menit.
 */
export function calculateTripProgress(
  therapistLat: number,
  therapistLng: number,
  customerLat: number,
  customerLng: number
): TripProgress | null {
  if (!isValidCoord(therapistLat, therapistLng)) return null;
  if (!isValidCoord(customerLat, customerLng)) return null;
  try {
    const raw = haversineKm(therapistLat, therapistLng, customerLat, customerLng);
    if (!Number.isFinite(raw) || raw < 0) return null;
    const remainingKm = Math.round(raw * 1.25 * 10) / 10;
    const etaMinutes = Math.min(120, Math.max(1, Math.round((remainingKm / 25) * 60)));
    return { remainingKm, etaMinutes };
  } catch {
    return null;
  }
}

/**
 * Deteksi terapis tertahan di luar komplek (kemungkinan salah belok /
 * tertahan tembok perumahan). Murni fungsi — tanpa I/O, deterministik.
 */
export function evaluateGeofenceAlert(
  therapistLat: number,
  therapistLng: number,
  customerLat: number,
  customerLng: number,
  speedMps?: number | null,
  accuracyM?: number | null,
  stalledSec?: number | null
): GeofenceResult {
  if (!isValidCoord(therapistLat, therapistLng) || !isValidCoord(customerLat, customerLng)) {
    return { isStalledOutsideTarget: false, distanceM: null, reason: 'INVALID_COORDS' };
  }
  if (accuracyM != null && Number.isFinite(accuracyM) && accuracyM > GPS_LOW_ACCURACY_M) {
    const d = haversineKm(therapistLat, therapistLng, customerLat, customerLng);
    return { isStalledOutsideTarget: false, distanceM: Math.round(d * 1000), reason: 'LOW_ACCURACY' };
  }
  const distanceM = Math.round(haversineKm(therapistLat, therapistLng, customerLat, customerLng) * 1000);
  if (distanceM < GEOFENCE_MIN_DIST_M) {
    return { isStalledOutsideTarget: false, distanceM, reason: 'INSIDE_TARGET' };
  }
  if (distanceM > GEOFENCE_MAX_DIST_M) {
    return { isStalledOutsideTarget: false, distanceM, reason: 'EN_ROUTE' };
  }
  if (speedMps != null && Number.isFinite(speedMps) && speedMps > 3) {
    return { isStalledOutsideTarget: false, distanceM, reason: 'MOVING' };
  }
  const stalled = stalledSec == null ? 0 : Number(stalledSec);
  if (!Number.isFinite(stalled) || stalled < GEOFENCE_STALLED_SEC) {
    return { isStalledOutsideTarget: false, distanceM, reason: 'NOT_STALLED_YET' };
  }
  return { isStalledOutsideTarget: true, distanceM, reason: 'STALLED_OUTSIDE_TARGET' };
}

class StaffTripTrackingService {
  private readonly store = new Map<string, { record: TripRecord; timer: ReturnType<typeof setTimeout> }>();

  /** Key Redis masa depan — diekspos agar Fase 2 memakai format identik. */
  public redisKey(tenantId: string, reservationId: string): string {
    assertTenant(tenantId);
    assertIds(reservationId, 'x');
    return `staff:trip:${tenantId}:${reservationId}`;
  }

  public recordTripPing(
    tenantId: string,
    reservationId: string,
    staffId: string,
    ping: TripPing
  ): TripRecord {
    assertTenant(tenantId);
    assertIds(reservationId, staffId);
    if (!ping || !isValidCoord(ping.lat, ping.lng)) {
      throw new Error('TRIP_INVALID_COORDS: lat/lng tidak valid.');
    }
    const accuracy = toFiniteOrNull(ping.accuracy);
    if (accuracy != null && (accuracy < 0 || accuracy > 500)) {
      throw new Error('TRIP_INVALID_ACCURACY: accuracy 0–500 meter.');
    }
    const speed = toFiniteOrNull(ping.speed);
    const heading = toFiniteOrNull(ping.heading);
    const now = Date.now();
    const key = tripKey(tenantId, reservationId);
    const prev = this.store.get(key);
    if (prev) clearTimeout(prev.timer);
    // Gerak nyata = perpindahan > 30m; noise GPS diam tidak mereset timer stalled.
    let movedAt = prev ? prev.record.movedAt : now;
    if (prev) {
      const moved = haversineKm(prev.record.lat, prev.record.lng, ping.lat, ping.lng) * 1000;
      if (moved > 30) movedAt = now;
    }
    const record: TripRecord = {
      tenantId,
      reservationId,
      staffId,
      lat: ping.lat,
      lng: ping.lng,
      speed,
      heading,
      accuracy,
      areaName: resolveHumanAreaName(ping.lat, ping.lng),
      createdAt: prev ? prev.record.createdAt : now,
      updatedAt: now,
      movedAt,
    };
    const timer = setTimeout(() => {
      this.store.delete(key);
    }, TRIP_PING_TTL_SEC * 1000);
    if ((timer as any).unref) (timer as any).unref();
    this.store.set(key, { record, timer });
    return record;
  }

  public getTrip(tenantId: string, reservationId: string): TripRecord | null {
    assertTenant(tenantId);
    if (!reservationId || typeof reservationId !== 'string' || !reservationId.trim()) return null;
    const hit = this.store.get(tripKey(tenantId, reservationId));
    return hit ? hit.record : null;
  }

  /**
   * #162e: daftar sesi trip aktif (untuk sweep auto-close). Tenant-scoped bila
   * `tenantId` diberikan; tanpa argumen mengembalikan seluruh tenant (sweep cron).
   */
  public listActiveTrips(tenantId?: string): TripRecord[] {
    const out: TripRecord[] = [];
    for (const [, v] of this.store) {
      if (!tenantId || v.record.tenantId === tenantId) out.push(v.record);
    }
    return out;
  }

  public clearTrip(tenantId: string, reservationId: string): boolean {
    assertTenant(tenantId);
    if (!reservationId || typeof reservationId !== 'string' || !reservationId.trim()) return false;
    const key = tripKey(tenantId, reservationId);
    const hit = this.store.get(key);
    if (!hit) return false;
    clearTimeout(hit.timer);
    this.store.delete(key);
    return true;
  }

  /** Reset seluruh store — untuk test agar tidak bocor antar-test. */
  public clearAll(): void {
    for (const [, v] of this.store) clearTimeout(v.timer);
    this.store.clear();
  }
}

export const staffTripTrackingService = new StaffTripTrackingService();
