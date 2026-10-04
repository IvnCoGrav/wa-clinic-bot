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

/**
 * TTL sesi trip (detik). 2 jam (plan 2026-10-02 — sebelumnya 10 menit).
 *
 * Catatan penting: TTL panjang HANYA mengamankan agar ping terakhir tidak hilang
 * saat perjalanan >10 menit. Kontrak "live" tetap dibaca dari `lastUpdateSec`
 * (lihat `LiveChatDispatchWidget.isFresh`), bukan dari ada-tidaknya record.
 * Sesi in-memory hilang saat restart/multi-instans — calon Redis `SETEX`
 * (lihat `redisKey`). Dicatat di docs/KNOWN_ISSUES.md.
 */
export const TRIP_PING_TTL_SEC = 7200;

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

/**
 * Ambang dispatch operasional (auto-stop kedatangan, jendela pre-trip, warning telat).
 *
 * TODO(tenant-aware): saat ini konstanta global. Idealnya dibaca dari `ClinicPolicy`
 * per-tenant (radius, window, ambang telat) — ditunda sesuai Confirmation Gate,
 * dicatat di docs/KNOWN_ISSUES.md #166 & docs/SAAS_READINESS_AUDIT.md.
 */
/** Radius kedatangan (meter). Murni indikator; TIDAK mengubah status kedatangan resmi. */
export const ARRIVAL_RADIUS_M = 50;
/** Jumlah ping berturut-turut dalam radius sebelum auto-stop (anti false-stop 1 ping). */
export const ARRIVAL_CONSECUTIVE_PING = 2;
/** Ambang akurasi GPS maksimum (meter) agar geofence dipercaya. Di atas ini fail-closed. */
export const GPS_ACCURACY_MAX_M = 100;
/** Jendela auto-start telemetry sebelum jadwal (menit). */
export const PRE_TRIP_WINDOW_MIN = 30;
/** Ambang keterlambatan: warning (menit). */
export const DELAY_WARN_MIN = 20;
/** Ambang keterlambatan: critical (menit). */
export const DELAY_CRITICAL_MIN = 30;

export type DelayLevel = 'none' | 'warning' | 'critical';

export interface ArrivalGeofenceResult {
  isArrived: boolean;
  /** Jumlah ping berturut-turut di dalam radius (dwell). */
  consecutiveCount: number;
  distanceM: number | null;
  reason:
    | 'ARRIVED'
    | 'IN_RADIUS'
    | 'OUT_OF_RANGE'
    | 'LOW_ACCURACY'
    | 'NO_CUSTOMER_COORDS'
    | 'INVALID_COORDS';
}

export interface DelayStatusResult {
  isDelayed: boolean;
  level: DelayLevel;
  /** Estimasi tiba (menit) relatif terhadap jadwal. Positif = terlambat. */
  delayMinutes: number;
  estimatedArrivalIso: string;
  formattedArrivalWib: string;
  reason: 'OK' | 'NO_SCHEDULE' | 'NO_ETA';
}

const WIB_TIME_FORMATTER = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * Deteksi kedatangan terapis dalam radius pasien. Murni deterministik (tanpa I/O).
 *
 * Kontrak penting: hasil `isArrived` HANYA dipakai untuk menghentikan pemancar
 * pelacakan (privasi). Status kedatangan RESMI (`arrived_at`) tetap ditentukan
 * tombol manual bidan + pesan WA — jangan disamakan.
 *
 * - Fail-closed: akurasi GPS null/NaN/>100m → tidak pernah dianggap tiba.
 * - Dwell: butuh `ARRIVAL_CONSECUTIVE_PING` ping berturut-turut dalam radius;
 *   satu ping keluar radius me-reset hitungan (mencegah lewat depan rumah).
 */
export function evaluateArrivalGeofence(
  therapistLat: number,
  therapistLng: number,
  customerLat: number | null | undefined,
  customerLng: number | null | undefined,
  accuracyM: number | null | undefined,
  previousStreak = 0,
  arrivalRadiusM: number = ARRIVAL_RADIUS_M
): ArrivalGeofenceResult {
  if (!isValidCoord(therapistLat, therapistLng)) {
    return { isArrived: false, consecutiveCount: 0, distanceM: null, reason: 'INVALID_COORDS' };
  }
  if (
    customerLat == null ||
    customerLng == null ||
    !isValidCoord(Number(customerLat), Number(customerLng))
  ) {
    return { isArrived: false, consecutiveCount: 0, distanceM: null, reason: 'NO_CUSTOMER_COORDS' };
  }
  const distanceM = Math.round(
    haversineKm(therapistLat, therapistLng, Number(customerLat), Number(customerLng)) * 1000
  );
  // Fail-closed: akurasi tak diketahui / buruk → tidak boleh memicu auto-stop.
  if (accuracyM == null || !Number.isFinite(accuracyM) || accuracyM > GPS_ACCURACY_MAX_M) {
    return { isArrived: false, consecutiveCount: 0, distanceM, reason: 'LOW_ACCURACY' };
  }
  const radius = Number.isFinite(arrivalRadiusM) && arrivalRadiusM > 0 ? arrivalRadiusM : ARRIVAL_RADIUS_M;
  if (distanceM > radius) {
    return { isArrived: false, consecutiveCount: 0, distanceM, reason: 'OUT_OF_RANGE' };
  }
  const streak = Math.max(0, Math.floor(Number(previousStreak) || 0)) + 1;
  if (streak >= ARRIVAL_CONSECUTIVE_PING) {
    return { isArrived: true, consecutiveCount: streak, distanceM, reason: 'ARRIVED' };
  }
  return { isArrived: false, consecutiveCount: streak, distanceM, reason: 'IN_RADIUS' };
}

/**
 * Prediksi keterlambatan terapis vs jadwal reservasi. Murni deterministik (tanpa I/O).
 *
 * `delayMinutes` = estimasiTiba − jadwal (BUKAN minus toleransi). `level`:
 * `none` (< warn), `warning` (>= warn), `critical` (>= critical).
 * Fail-open: jadwal/ETA tidak diketahui → `none` (jangan menuduh telat tanpa dasar).
 */
export function calculateDelayStatus(
  bookingDate: Date | null | undefined,
  etaMinutes: number | null | undefined,
  now: Date = new Date(),
  opts?: { warnMin?: number; criticalMin?: number }
): DelayStatusResult {
  const empty = (reason: DelayStatusResult['reason']): DelayStatusResult => ({
    isDelayed: false,
    level: 'none',
    delayMinutes: 0,
    estimatedArrivalIso: '',
    formattedArrivalWib: '',
    reason,
  });

  const bookingMs = bookingDate instanceof Date ? bookingDate.getTime() : NaN;
  if (!Number.isFinite(bookingMs)) return empty('NO_SCHEDULE');
  if (etaMinutes == null || !Number.isFinite(Number(etaMinutes))) return empty('NO_ETA');

  const eta = Math.max(0, Number(etaMinutes));
  const nowMs = now instanceof Date && Number.isFinite(now.getTime()) ? now.getTime() : Date.now();
  const arrivalMs = nowMs + eta * 60 * 1000;
  const delayMinutes = Math.round((arrivalMs - bookingMs) / 60000);

  const warnMin = opts?.warnMin != null && Number.isFinite(opts.warnMin) ? opts.warnMin : DELAY_WARN_MIN;
  const criticalMin =
    opts?.criticalMin != null && Number.isFinite(opts.criticalMin) ? opts.criticalMin : DELAY_CRITICAL_MIN;

  let level: DelayLevel = 'none';
  if (delayMinutes >= criticalMin) level = 'critical';
  else if (delayMinutes >= warnMin) level = 'warning';

  const arrivalDate = new Date(arrivalMs);
  return {
    isDelayed: level !== 'none',
    level,
    delayMinutes,
    estimatedArrivalIso: arrivalDate.toISOString(),
    formattedArrivalWib: WIB_TIME_FORMATTER.format(arrivalDate),
    reason: 'OK',
  };
}

/**
 * Apakah jadwal berada di dalam jendela auto-start telemetry (default H-30 menit).
 * Fail-closed: jadwal null/invalid → false.
 */
export function isWithinPreTripWindow(
  bookingDate: Date | null | undefined,
  now: Date = new Date(),
  windowMin: number = PRE_TRIP_WINDOW_MIN
): boolean {
  const bookingMs = bookingDate instanceof Date ? bookingDate.getTime() : NaN;
  if (!Number.isFinite(bookingMs)) return false;
  const nowMs = now instanceof Date && Number.isFinite(now.getTime()) ? now.getTime() : Date.now();
  const windowMs = Math.max(0, Number(windowMin) || PRE_TRIP_WINDOW_MIN) * 60 * 1000;
  const diffMs = bookingMs - nowMs;
  return diffMs <= windowMs && diffMs >= -windowMs;
}

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
  /** Ping berturut-turut dalam radius kedatangan (dwell anti false-stop). */
  arrivalStreak: number;
  /** Level keterlambatan terakhir (untuk anti-spam transisi event delay). */
  delayLevel: DelayLevel;
  /**
   * Provenance titik awal perjalanan (plan 2026-10-04). `gps` = koordinat asli
   * Bidan; `prev_patient` = estimasi dari rumah pasien sebelumnya (beruntun);
   * `unknown` = tak ada dasar. Dipakai CS agar tidak salah anggap estimasi
   * sebagai posisi presisi.
   */
  originSource: 'gps' | 'prev_patient' | 'clinic' | 'unknown';
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
    ping: TripPing,
    state?: {
      arrivalStreak?: number;
      delayLevel?: DelayLevel;
      originSource?: 'gps' | 'prev_patient' | 'clinic' | 'unknown';
    }
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
      arrivalStreak: state?.arrivalStreak ?? (prev ? prev.record.arrivalStreak : 0),
      delayLevel: state?.delayLevel ?? (prev ? prev.record.delayLevel : 'none'),
      // Default 'gps': pemanggil tak-menentukan (mis. /telemetry) selalu kirim
      // koordinat asli Bidan. Titik estimasi WAJIB menandai originSource eksplisit.
      originSource: state?.originSource ?? 'gps',
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
