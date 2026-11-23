/**
 * delay-watchdog.ts
 * Domain murni (tanpa I/O) untuk Departure Watchdog & prediksi keterlambatan staf.
 *
 * Menggunakan rumus ETA kanonis dari `calculateTripProgress` dan evaluasi level
 * dari `calculateDelayStatus`. Tidak menduplikasi rumus matematika / konstanta.
 */

import {
  calculateDelayStatus,
  calculateTripProgress,
  WIB_TIME_FORMATTER,
  type DelayLevel,
} from '../utils/trip-progress';

export type OriginSource = 'staff_base' | 'clinic' | 'prev_patient' | 'unknown';

export interface LegOriginResult {
  lat: number;
  lng: number;
  originSource: OriginSource;
  originName: string;
}

export interface StaffBaseInput {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
}

export interface ClinicLocationInput {
  lat?: number | null;
  lng?: number | null;
  name?: string | null;
}

export interface PreviousTaskInput {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  patientName?: string | null;
  status?: string | null;
  arrived_at?: Date | string | null;
  duration_minutes?: number | null;
  booking_date?: Date | string | null;
}

export interface ResolveLegOriginInput {
  staffBase?: StaffBaseInput | null;
  clinicLocation?: ClinicLocationInput | null;
  previousTask?: PreviousTaskInput | null;
  now?: Date;
  maxPrevOriginGapHours?: number; // default 3 jam
  treatmentBufferMinutes?: number; // default 15 menit
}

export interface PredictTaskDelayInput {
  bookingDate: Date | string | null | undefined;
  etaMinutes: number | null | undefined;
  now?: Date;
  toleranceMinutes?: number; // default 30
  criticalExtraMinutes?: number; // default 15
  bufferMinutes?: number;
  hasDeparted?: boolean;
  hasArrived?: boolean;
}

export interface TaskDelayPrediction {
  delayMinutes: number;
  level: DelayLevel;
  estimatedArrivalIso: string;
  formattedArrivalWib: string;
  missedDeparture: boolean;
  departureDeadline: Date | null;
  departureDeadlineWib: string;
}

/** Input ternormalisasi satu tugas untuk perhitungan itinerary berantai. */
export interface ItineraryTaskInput {
  id: string;
  staffId?: string | null;
  staffBase?: StaffBaseInput | null;
  customerLat?: number | null;
  customerLng?: number | null;
  address?: string | null;
  patientName?: string | null;
  bookingDate: Date | string | null;
  durationMinutes?: number | null;
  status?: string | null;
  arrivedAt?: Date | string | null;
  hasDeparted?: boolean;
  hasArrived?: boolean;
}

export interface ItineraryDelaySnapshot {
  delayMinutes: number;
  level: DelayLevel;
  estimatedArrivalWib: string;
  missedDeparture: boolean;
  originSource: OriginSource;
  originName: string;
  etaMinutes: number | null;
}

export interface ComputeItineraryDelaysParams {
  tasks: ItineraryTaskInput[];
  clinicLocation?: ClinicLocationInput | null;
  now?: Date;
  toleranceMinutes?: number;
  criticalExtraMinutes?: number;
  maxPrevOriginGapHours?: number;
}

/**
 * Satu-satunya seam perhitungan delay itinerary per-bidan.
 *
 * Dipakai oleh kartu tugas staf (`getTodayTasks`) dan service watchdog agar
 * angka di HP bidan dan banner admin tidak pernah menyimpang.
 */
export function computeItineraryDelays(
  params: ComputeItineraryDelaysParams
): Map<string, ItineraryDelaySnapshot> {
  const now = params.now ?? new Date();
  const toleranceMinutes = params.toleranceMinutes ?? 30;
  const criticalExtraMinutes = params.criticalExtraMinutes ?? 15;
  const maxPrevOriginGapHours = params.maxPrevOriginGapHours ?? 3;
  const out = new Map<string, ItineraryDelaySnapshot>();

  const byStaff = new Map<string, ItineraryTaskInput[]>();
  for (const task of params.tasks) {
    const key = task.staffId || 'unassigned';
    if (!byStaff.has(key)) byStaff.set(key, []);
    byStaff.get(key)!.push(task);
  }

  for (const [, tasks] of byStaff.entries()) {
    let previousTask: PreviousTaskInput | null = null;
    for (const task of tasks) {
      const origin = resolveLegOrigin({
        staffBase: task.staffBase ?? null,
        clinicLocation: params.clinicLocation ?? null,
        previousTask,
        now,
        maxPrevOriginGapHours,
      });

      const progress =
        origin && task.customerLat != null && task.customerLng != null
          ? etaMinutesTo(origin, { lat: task.customerLat, lng: task.customerLng })
          : null;

      const prediction = predictTaskDelay({
        bookingDate: task.bookingDate,
        etaMinutes: progress?.etaMinutes ?? null,
        now,
        toleranceMinutes,
        criticalExtraMinutes,
        hasDeparted: task.hasDeparted === true,
        hasArrived: task.hasArrived === true,
      });

      out.set(task.id, {
        delayMinutes: prediction.delayMinutes,
        level: prediction.level,
        estimatedArrivalWib: prediction.formattedArrivalWib,
        missedDeparture: prediction.missedDeparture,
        originSource: origin?.originSource ?? 'unknown',
        originName: origin?.originName ?? 'Lokasi tidak diketahui',
        etaMinutes: progress?.etaMinutes ?? null,
      });

      previousTask = {
        lat: task.customerLat ?? null,
        lng: task.customerLng ?? null,
        address: task.address ?? null,
        patientName: task.patientName ?? null,
        status: task.status ?? null,
        arrived_at: task.arrivedAt ?? null,
        duration_minutes: task.durationMinutes ?? null,
        booking_date: task.bookingDate,
      };
    }
  }

  return out;
}

function hasValidCoordinates<T extends { lat?: number | null; lng?: number | null }>(
  target: T | null | undefined
): target is T & { lat: number; lng: number } {
  return (
    Boolean(target) &&
    typeof target?.lat === 'number' &&
    Number.isFinite(target.lat) &&
    target.lat >= -90 &&
    target.lat <= 90 &&
    typeof target?.lng === 'number' &&
    Number.isFinite(target.lng) &&
    target.lng >= -180 &&
    target.lng <= 180
  );
}

function getBaseOrClinic(
  staffBase?: StaffBaseInput | null,
  clinicLocation?: ClinicLocationInput | null
): LegOriginResult | null {
  if (hasValidCoordinates(staffBase)) {
    return {
      lat: staffBase.lat,
      lng: staffBase.lng,
      originSource: 'staff_base',
      originName: staffBase.address?.trim() || 'Base Bidan',
    };
  }
  if (hasValidCoordinates(clinicLocation)) {
    return {
      lat: clinicLocation.lat,
      lng: clinicLocation.lng,
      originSource: 'clinic',
      originName: clinicLocation.name?.trim() || 'Klinik',
    };
  }
  return null;
}

/**
 * Resolusi titik awal per leg perjalanan (murni deterministik).
 *
 * Presedensi:
 * - Leg pertama: base bidan -> klinik -> null.
 * - Leg lanjutan (ada previousTask berkoordinat valid):
 *   alamat pasien sebelumnya HANYA JIKA treatment sebelumnya sudah selesai
 *   (status 'completed' ATAU estimasi selesai <= now) DAN jeda waktu dari
 *   estimasi selesai <= maxPrevOriginGapHours.
 *   Bila treatment 1 belum selesai atau sudah lewat max gap -> kembali ke base bidan -> klinik.
 */
export function resolveLegOrigin(input: ResolveLegOriginInput): LegOriginResult | null {
  const {
    staffBase,
    clinicLocation,
    previousTask,
    now = new Date(),
    maxPrevOriginGapHours = 3,
    treatmentBufferMinutes = 15,
  } = input;

  if (!hasValidCoordinates(previousTask)) {
    return getBaseOrClinic(staffBase, clinicLocation);
  }

  const nowMs = now instanceof Date && Number.isFinite(now.getTime()) ? now.getTime() : Date.now();

  let estimatedCompletionMs: number | null = null;
  if (previousTask.booking_date) {
    const startMs =
      previousTask.booking_date instanceof Date
        ? previousTask.booking_date.getTime()
        : new Date(previousTask.booking_date).getTime();
    if (Number.isFinite(startMs)) {
      const durationMin =
        typeof previousTask.duration_minutes === 'number' && previousTask.duration_minutes > 0
          ? previousTask.duration_minutes
          : 60;
      const bufferMin =
        typeof treatmentBufferMinutes === 'number' && treatmentBufferMinutes >= 0
          ? treatmentBufferMinutes
          : 15;
      estimatedCompletionMs = startMs + (durationMin + bufferMin) * 60000;
    }
  }

  const isCompletedStatus = previousTask.status === 'completed';
  const isEstimatedFinished = estimatedCompletionMs != null && estimatedCompletionMs <= nowMs;
  const isFinished = isCompletedStatus || isEstimatedFinished;

  const maxGapMs = Math.max(1, maxPrevOriginGapHours) * 3600000;
  const isWithinGap =
    estimatedCompletionMs == null || nowMs - estimatedCompletionMs <= maxGapMs;

  if (isFinished && isWithinGap) {
    const formattedPatientName = previousTask.patientName
      ? previousTask.patientName.toLowerCase().startsWith('bunda')
        ? previousTask.patientName
        : `Bunda ${previousTask.patientName}`
      : previousTask.address?.trim() || 'Pasien Sebelumnya';

    return {
      lat: previousTask.lat,
      lng: previousTask.lng,
      originSource: 'prev_patient',
      originName: formattedPatientName,
    };
  }

  return getBaseOrClinic(staffBase, clinicLocation);
}

/**
 * Menghitung batas waktu paling lambat berangkat (departure deadline).
 * deadline = bookingDate - (etaMinutes + bufferMinutes) * 60000.
 */
export function computeDepartureDeadline(
  bookingDate: Date | string | null | undefined,
  etaMinutes: number | null | undefined,
  bufferMinutes: number = 0
): Date | null {
  if (!bookingDate) return null;
  const bookingMs =
    bookingDate instanceof Date ? bookingDate.getTime() : new Date(bookingDate).getTime();
  if (!Number.isFinite(bookingMs)) return null;
  if (etaMinutes == null || !Number.isFinite(Number(etaMinutes))) return null;

  const totalMin = Math.max(0, Number(etaMinutes)) + Math.max(0, bufferMinutes);
  return new Date(bookingMs - totalMin * 60000);
}

/**
 * Menghitung jarak dan ETA dari origin ke destination memakai rumus kanonis `calculateTripProgress`.
 */
export function etaMinutesTo(
  origin: { lat: number; lng: number } | null | undefined,
  destination: { lat: number; lng: number } | null | undefined
): { remainingKm: number; etaMinutes: number } | null {
  if (!origin || !destination) return null;
  const progress = calculateTripProgress(origin.lat, origin.lng, destination.lat, destination.lng);
  if (!progress) return null;
  return progress;
}

/**
 * Prediksi keterlambatan tugas hari ini dan pengecekan missed departure.
 */
export function predictTaskDelay(params: PredictTaskDelayInput): TaskDelayPrediction {
  const {
    bookingDate,
    etaMinutes,
    now = new Date(),
    toleranceMinutes = 30,
    criticalExtraMinutes = 15,
    bufferMinutes = 0,
    hasDeparted = false,
    hasArrived = false,
  } = params;

  const bookingDateObj =
    bookingDate instanceof Date
      ? bookingDate
      : bookingDate
      ? new Date(bookingDate)
      : null;

  const warnMin = toleranceMinutes;
  const criticalMin = toleranceMinutes + criticalExtraMinutes;

  const delayResult = calculateDelayStatus(bookingDateObj, etaMinutes, now, {
    warnMin,
    criticalMin,
  });

  const deadline = computeDepartureDeadline(bookingDateObj, etaMinutes, bufferMinutes);

  let missedDeparture = false;
  if (!hasDeparted && !hasArrived && deadline) {
    const nowMs = now instanceof Date && Number.isFinite(now.getTime()) ? now.getTime() : Date.now();
    if (nowMs > deadline.getTime()) {
      missedDeparture = true;
    }
  }

  let formattedDeadlineWib = '';
  if (deadline) {
    try {
      formattedDeadlineWib = WIB_TIME_FORMATTER.format(deadline);
    } catch {
      formattedDeadlineWib = '';
    }
  }

  return {
    delayMinutes: delayResult.delayMinutes,
    level: delayResult.level,
    estimatedArrivalIso: delayResult.estimatedArrivalIso,
    formattedArrivalWib: delayResult.formattedArrivalWib,
    missedDeparture,
    departureDeadline: deadline,
    departureDeadlineWib: formattedDeadlineWib,
  };
}
