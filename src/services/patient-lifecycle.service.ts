import { prisma } from '../db/client';

/**
 * Canonical Patient Lifecycle Domain Service — Single Source of Truth untuk
 * status klinis (riwayat treatment) dan operasional (jadwal aktif) pasien.
 *
 * Latar belakang (insiden Bunda Retno 6282132249740): gate kelayakan AI hanya
 * mencari reservasi `confirmed`, sehingga pasien yang treatment pertamanya
 * sudah `completed` diklasifikasikan sebagai "Pasien Baru" dan bot AI tetap
 * membalas. Service ini menjadi satu-satunya tempat yang mendefinisikan:
 * - riwayat treatment = status `confirmed` ATAU `completed` (plus fallback
 *   `ltv_cache > 0` / flag eksplisit objek customer),
 * - jadwal aktif = status `pending`/`confirmed`/`hold` dalam jendela
 *   [sekarang - 12 jam, sekarang + 24 jam].
 *
 * Semua kueri tenant-aware (wajib `tenantId`). Semua kegagalan DB ditangani
 * best-effort dengan default aman (false / 0) agar tidak pernah menggagalkan
 * pipeline webhook — keputusan fail-closed vs fail-open ada di pemanggil
 * (ai-scope-gate), bukan di sini.
 */

/** Status reservasi yang dihitung sebagai riwayat treatment (pernah dilayani). */
export const TREATMENT_HISTORY_STATUSES = ['confirmed', 'completed'] as const;

/** Status reservasi yang dihitung sebagai jadwal aktif (operasional berjalan). */
export const ACTIVE_APPOINTMENT_STATUSES = ['pending', 'confirmed', 'hold'] as const;

/** Jendela default jadwal aktif: 12 jam ke belakang, 24 jam ke depan. */
export const ACTIVE_APPOINTMENT_WINDOW_BEFORE_HOURS = 12;
export const ACTIVE_APPOINTMENT_WINDOW_AFTER_HOURS = 24;

export interface ActiveAppointmentResult {
  hasActive: boolean;
  reservation?: any;
}

export interface PatientClinicalProfile {
  isNewLead: boolean;
  isExistingPatient: boolean;
  hasActiveAppointment: boolean;
  totalVisits: number;
  activeReservation?: any;
}

/**
 * Snapshot offline dari objek customer (tanpa query tambahan).
 * Flag eksplisit `true` selalu dihormati (short-circuit, tanpa DB);
 * flag `false`/null tetap diverifikasi ke DB + `ltv_cache` (DB menang).
 */
export interface PatientSnapshot {
  ltv_cache?: number | null;
  has_treatment_history?: boolean | null;
  has_active_appointment?: boolean | null;
}

function ltvOf(snapshot?: PatientSnapshot): number {
  const v = Number(snapshot?.ltv_cache);
  return Number.isFinite(v) ? v : 0;
}

class PatientLifecycleService {
  /**
   * Jumlah kunjungan treatment (reservasi `confirmed` ATAU `completed`).
   * DB gagal → 0 (best-effort).
   */
  async countTreatmentVisits(customerId: string, tenantId: string): Promise<number> {
    if (!customerId) return 0;
    try {
      return await prisma.reservation.count({
        where: {
          customer_id: customerId,
          tenant_id: tenantId,
          status: { in: [...TREATMENT_HISTORY_STATUSES] },
        },
      });
    } catch {
      return 0;
    }
  }

  /**
   * Apakah pasien punya riwayat treatment (pasien lama / repeat).
   * Urutan: flag eksplisit `true` → hitungan DB → `ltv_cache > 0` (snapshot,
   * lalu best-effort baca DB bila snapshot tidak membawa nilai).
   */
  async hasTreatmentHistory(
    customerId: string,
    tenantId: string,
    snapshot?: PatientSnapshot,
  ): Promise<boolean> {
    if (snapshot?.has_treatment_history === true) return true;
    const visits = await this.countTreatmentVisits(customerId, tenantId);
    if (visits > 0) return true;
    if (ltvOf(snapshot) > 0) return true;
    // Snapshot tidak membawa ltv (undefined) → cek DB best-effort sekali.
    if (snapshot && snapshot.ltv_cache !== undefined && snapshot.ltv_cache !== null) return false;
    try {
      const cust = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { ltv_cache: true },
      });
      if (cust && Number((cust as any).ltv_cache) > 0) return true;
    } catch {
      // abaikan — default false di bawah
    }
    return false;
  }

  /**
   * Jadwal aktif operasional: reservasi `pending`/`confirmed`/`hold` dengan
   * `booking_date` dalam jendela [now - beforeHours, now + afterHours].
   * DB gagal → { hasActive: false } (best-effort; fail-open di level ini).
   */
  async getActiveAppointment(
    customerId: string,
    tenantId: string,
    opts?: { beforeHours?: number; afterHours?: number; now?: Date },
  ): Promise<ActiveAppointmentResult> {
    if (!customerId) return { hasActive: false };
    const now = opts?.now ?? new Date();
    const before = opts?.beforeHours ?? ACTIVE_APPOINTMENT_WINDOW_BEFORE_HOURS;
    const after = opts?.afterHours ?? ACTIVE_APPOINTMENT_WINDOW_AFTER_HOURS;
    try {
      const reservation = await prisma.reservation.findFirst({
        where: {
          customer_id: customerId,
          tenant_id: tenantId,
          status: { in: [...ACTIVE_APPOINTMENT_STATUSES] },
          booking_date: {
            gte: new Date(now.getTime() - before * 3600 * 1000),
            lte: new Date(now.getTime() + after * 3600 * 1000),
          },
        },
        orderBy: { booking_date: 'asc' },
      });
      if (!reservation) return { hasActive: false };
      return { hasActive: true, reservation };
    } catch {
      return { hasActive: false };
    }
  }

  /**
   * Profil klinis lengkap pasien untuk gate kelayakan AI.
   * Flag snapshot `true` selalu menang; selain itu DB + `ltv_cache` menang
   * atas flag `false`/null (data persist menang atas snapshot basi).
   */
  async getPatientClinicalProfile(
    customerId: string,
    tenantId: string,
    snapshot?: PatientSnapshot,
  ): Promise<PatientClinicalProfile> {
    const [visits, active] = await Promise.all([
      this.countTreatmentVisits(customerId, tenantId),
      this.getActiveAppointment(customerId, tenantId),
    ]);
    const hasActiveAppointment =
      snapshot?.has_active_appointment === true || active.hasActive;
    // DB menang atas snapshot basi, kecuali flag eksplisit `true` (sudah pasti).
    // `ltv_cache > 0` (snapshot, lalu DB) juga menandakan pasien lama.
    let isExistingPatient = snapshot?.has_treatment_history === true || visits > 0;
    if (!isExistingPatient) {
      if (ltvOf(snapshot) > 0) {
        isExistingPatient = true;
      } else if (!snapshot || snapshot.ltv_cache === undefined || snapshot.ltv_cache === null) {
        try {
          const cust = await prisma.customer.findUnique({
            where: { id: customerId },
            select: { ltv_cache: true },
          });
          if (cust && Number((cust as any).ltv_cache) > 0) isExistingPatient = true;
        } catch {
          // abaikan — default false
        }
      }
    }
    return {
      isNewLead: !isExistingPatient && !hasActiveAppointment,
      isExistingPatient,
      hasActiveAppointment,
      totalVisits: visits,
      activeReservation: active.reservation,
    };
  }
}

export const patientLifecycleService = new PatientLifecycleService();
