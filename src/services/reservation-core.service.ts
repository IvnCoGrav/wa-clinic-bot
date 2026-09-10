import { prisma } from '../db/client';
import { TreatmentCategory } from '@prisma/client';
import type { BabyDetail } from '../utils/reservation-text-parser';

/**
 * Canonical Reservation Domain Service — Single Source of Truth untuk SEMUA
 * mutasi reservasi (Admin Manual, Quick Hold, Bot State Machine, Webhook,
 * Agent Tool). Menggantikan 6 titik masuk yang sebelumnya langsung
 * `prisma.reservation.create` / deduplikasi sendiri-sendiri.
 *
 * Aturan kanal (channel-aware):
 * - ADMIN_PANEL: strict check → lempar ReservationConflictError (HTTP 409)
 *   kecuali `force: true` (override disengaja, wajib dicatat di audit_logs).
 * - BOT / WEBHOOK / AGENT: idempotent upsert & auto-konsolidasi duplikat.
 */

export type ReservationSource = 'ADMIN_PANEL' | 'BOT' | 'WEBHOOK' | 'AGENT';

export interface ReservationMutationParams {
  tenantId: string;
  customerId: string;
  chatId?: string;
  bookingDate?: Date | null;
  treatmentCategory?: TreatmentCategory | string | null;
  treatmentDetail?: string | null;
  durationMinutes?: number | null;
  assignedStaffId?: string | null;
  purchaseValue?: number | null;
  rawText?: string;
  babies?: BabyDetail[];
  customerName?: string;
  kecamatan?: string;
  kota?: string;
  kelurahan?: string;
  address?: string;
  source: ReservationSource;
  /** Override disengaja dari admin (dashboard mengirim { force: true }). */
  force?: boolean;
  /** Status awal untuk jalur admin (default 'confirmed' / terjadwal). */
  status?: 'pending' | 'confirmed' | 'hold';
}

export interface ReservationResult {
  reservation: any;
  isNew: boolean;
  isUpdate: boolean;
  consolidatedCount?: number;
}

export class ReservationConflictError extends Error {
  statusCode = 409;
  code: 'DUPLICATE_BOOKING' | 'STAFF_COLLISION';
  existingReservation: any;
  constructor(code: 'DUPLICATE_BOOKING' | 'STAFF_COLLISION', existingReservation: any) {
    super(code === 'DUPLICATE_BOOKING' ? 'DUPLICATE_BOOKING' : 'STAFF_COLLISION');
    this.code = code;
    this.existingReservation = existingReservation;
  }
}

const ACTIVE_STATUSES = ['confirmed', 'hold'];
const STAFF_BUFFER_MINUTES = 20;

function effectiveDuration(v: unknown, fallback = 60): number {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return fallback;
  return Math.min(480, Math.max(15, Math.round(n)));
}

function intervalsOverlap(aStart: Date, aMins: number, bStart: Date, bMins: number): boolean {
  const aEnd = aStart.getTime() + aMins * 60000;
  const bEnd = bStart.getTime() + bMins * 60000;
  return aStart.getTime() < bEnd && aStart.getTime() + aMins * 60000 > bStart.getTime() && aEnd > bStart.getTime() && bStart.getTime() < aEnd;
}

async function findOverlappingCustomerReservations(params: {
  tenantId: string;
  customerId: string;
  bookingDate: Date;
  durationMinutes: number;
  excludeId?: string;
}): Promise<any[]> {
  const { tenantId, customerId, bookingDate, durationMinutes } = params;
  const windowStart = new Date(bookingDate.getTime() - durationMinutes * 60000);
  const windowEnd = new Date(bookingDate.getTime() + durationMinutes * 60000);
  let candidates: any[] = [];
  try {
    candidates = await prisma.reservation.findMany({
      where: {
        tenant_id: tenantId,
        customer_id: customerId,
        status: { in: ACTIVE_STATUSES },
        booking_date: { gte: windowStart, lte: windowEnd },
      },
      orderBy: { booking_date: 'asc' },
    });
  } catch {
    // DB offline / lookup gagal → anggap tidak ada konflik di sini; kegagalan
    // tulis (create/update) di bawah akan diputuskan oleh pemanggil (fallback memory).
    return [];
  }
  return (candidates || []).filter((r: any) => {
    if (!r.booking_date) return false;
    if (params.excludeId && r.id === params.excludeId) return false;
    const existingStart = new Date(r.booking_date);
    const existingDur = effectiveDuration((r as any).duration_minutes, 60);
    return intervalsOverlap(bookingDate, durationMinutes, existingStart, existingDur);
  });
}

async function findOverlappingStaffReservations(params: {
  tenantId: string;
  staffId: string;
  bookingDate: Date;
  durationMinutes: number;
  excludeId?: string;
}): Promise<any[]> {
  const { tenantId, staffId, bookingDate, durationMinutes } = params;
  const windowStart = new Date(bookingDate.getTime() - (durationMinutes + STAFF_BUFFER_MINUTES) * 60000);
  const windowEnd = new Date(bookingDate.getTime() + (durationMinutes + STAFF_BUFFER_MINUTES) * 60000);
  let candidates: any[] = [];
  try {
    candidates = await prisma.reservation.findMany({
      where: {
        tenant_id: tenantId,
        assigned_staff_id: staffId,
        status: { in: ACTIVE_STATUSES },
        booking_date: { gte: windowStart, lte: windowEnd },
      },
      orderBy: { booking_date: 'asc' },
    });
  } catch {
    return [];
  }
  return (candidates || []).filter((r: any) => {
    if (!r.booking_date) return false;
    if (params.excludeId && r.id === params.excludeId) return false;
    const existingStart = new Date(r.booking_date);
    const existingDur = effectiveDuration((r as any).duration_minutes, 60) + STAFF_BUFFER_MINUTES;
    return intervalsOverlap(bookingDate, durationMinutes + STAFF_BUFFER_MINUTES, existingStart, existingDur);
  });
}

export class ReservationCoreService {
  async saveReservation(params: ReservationMutationParams): Promise<ReservationResult> {
    const {
      tenantId,
      customerId,
      chatId = '',
      bookingDate = null,
      treatmentCategory,
      treatmentDetail,
      durationMinutes,
      assignedStaffId,
      purchaseValue,
      rawText,
      babies = [],
      customerName,
      kecamatan,
      kota,
      kelurahan,
      address,
      source,
      force = false,
      status = 'confirmed',
    } = params;

    const duration = durationMinutes != null ? effectiveDuration(durationMinutes, 60) : null;
    const validCategory = ((treatmentCategory as TreatmentCategory) || TreatmentCategory.BABY) as TreatmentCategory;
    const effectiveRawText =
      rawText ||
      `[RESERVATION:${source}] ${treatmentDetail || '-'} | ${bookingDate ? bookingDate.toISOString().slice(0, 10) : '-'} | ${customerName || '-'}`;

    // --- Validasi 1 & 2: hanya bermakna bila ada bookingDate ---
    if (bookingDate && !isNaN(bookingDate.getTime())) {
      const durForCheck = duration ?? 60;

      const customerConflicts = await findOverlappingCustomerReservations({
        tenantId,
        customerId,
        bookingDate,
        durationMinutes: durForCheck,
      });

      if (customerConflicts.length > 0) {
        if (source === 'ADMIN_PANEL' && !force) {
          throw new ReservationConflictError('DUPLICATE_BOOKING', customerConflicts[0]);
        }
        if (source === 'ADMIN_PANEL' && force) {
          // Override disengaja: lewati merge, lanjut ke pembuatan record baru
          // di bawah (sudah dicatat khusus di audit log oleh pemanggil).
          console.log(`[RESERVATION CORE] Force override: admin membuat reservasi baru meski ${customerConflicts.length} konflik customer.`);
        } else {
        // BOT / WEBHOOK / AGENT → idempotent merge ke reservasi pertama,
        // auto-consolidate sisanya (cancel) agar tak ada kartu hantu.
        const primary = customerConflicts[0];
        const duplicates = customerConflicts.slice(1);
        const updated = await prisma.reservation.update({
          where: { id: primary.id },
          data: {
            treatment_category: (treatmentCategory as TreatmentCategory) || primary.treatment_category,
            treatment_detail: treatmentDetail !== undefined ? treatmentDetail : primary.treatment_detail,
            booking_date: bookingDate,
            duration_minutes: duration ?? (primary as any).duration_minutes ?? null,
            assigned_staff_id: assignedStaffId !== undefined ? assignedStaffId || null : primary.assigned_staff_id,
            raw_text: effectiveRawText,
            purchase_value: purchaseValue !== undefined && purchaseValue !== null ? purchaseValue : primary.purchase_value,
          },
        });
        let consolidatedCount = 0;
        for (const dup of duplicates) {
          try {
            await prisma.reservation.update({ where: { id: dup.id }, data: { status: 'cancelled' } });
            consolidatedCount++;
          } catch {}
        }
        if (consolidatedCount > 0) {
          console.log(`[RESERVATION CORE] Auto-consolidated ${consolidatedCount} duplicate(s) for customer ${customerId} (kept ${primary.id}).`);
        }
        const { reservationLifecycleService } = await import('./reservation-lifecycle.service');
        await reservationLifecycleService.onReservationCreated({
          customerId, reservationId: updated.id, tenantId, chatId, babies,
          customerName, kecamatan, kota, kelurahan: kelurahan || address, address,
        });
        return { reservation: updated, isNew: false, isUpdate: true, consolidatedCount };
        } // akhir cabang idempotent merge BOT/WEBHOOK/AGENT
      }

      if (assignedStaffId) {
        const staffConflicts = await findOverlappingStaffReservations({
          tenantId,
          staffId: assignedStaffId,
          bookingDate,
          durationMinutes: durForCheck,
        });
        if (staffConflicts.length > 0 && source === 'ADMIN_PANEL' && !force) {
          throw new ReservationConflictError('STAFF_COLLISION', staffConflicts[0]);
        }
        // Jalur BOT/WEBHOOK/AGENT: staff collision tidak digagalkan (best-effort),
        // hanya dicatat agar admin bisa re-assign manual.
        if (staffConflicts.length > 0 && source !== 'ADMIN_PANEL') {
          console.warn(`[RESERVATION CORE] Staff collision tolerated on ${source} path (staff=${assignedStaffId}, kept new/merged record).`);
        }
      }
    }

    // --- Tidak ada konflik: buat baru (atau fallback upsert 24 jam bila tanpa tanggal) ---
    let reservation: any;
    let isNew = false;
    let isUpdate = false;

    if (!bookingDate) {
      // Jalur tanpa tanggal (fallback idempoten 24 jam seperti perilaku webhook lama).
      let recentPending: any = null;
      try {
        recentPending = await prisma.reservation.findFirst({
          where: {
            customer_id: customerId,
            tenant_id: tenantId,
            created_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
            purchase_event_sent_at: null,
            purchase_review_status: 'pending',
            status: { not: 'cancelled' },
          },
          orderBy: { created_at: 'desc' },
        });
      } catch {
        recentPending = null;
      }
      if (recentPending) {
        reservation = await prisma.reservation.update({
          where: { id: (recentPending as any).id },
          data: {
            treatment_category: (treatmentCategory as TreatmentCategory) || (recentPending as any).treatment_category,
            treatment_detail: treatmentDetail !== undefined ? treatmentDetail : (recentPending as any).treatment_detail,
            raw_text: effectiveRawText,
            purchase_value: purchaseValue !== undefined ? purchaseValue : (recentPending as any).purchase_value,
            duration_minutes: duration ?? (recentPending as any).duration_minutes ?? null,
            assigned_staff_id: assignedStaffId !== undefined ? assignedStaffId || null : (recentPending as any).assigned_staff_id,
          },
        });
        isUpdate = true;
      }
    }

    if (!reservation) {
      const createData: any = {
        tenant_id: tenantId,
        customer_id: customerId,
        treatment_category: validCategory,
        treatment_detail: treatmentDetail,
        booking_date: bookingDate,
        duration_minutes: duration,
        assigned_staff_id: assignedStaffId || null,
        raw_text: effectiveRawText,
        status,
        purchase_value: purchaseValue ?? null,
      };
      try {
        // Single-row create atomik secara inheren; $transaction interaktif
        // dihindari agar kompatibel dengan mock test & driver Accelerate.
        // (Efek samping anak/follow-up tetap best-effort via lifecycle di bawah.)
        reservation = await prisma.reservation.create({ data: createData });
      } catch (e) {
        // Biarkan pemanggil memutuskan fallback in-memory (admin routes punya fallback).
        throw e;
      }
      if (!reservation) throw new Error('Gagal membuat reservasi (hasil kosong).');
      isNew = true;
    }

    const { reservationLifecycleService } = await import('./reservation-lifecycle.service');
    await reservationLifecycleService.onReservationCreated({
      customerId, reservationId: reservation.id, tenantId, chatId, babies,
      customerName, kecamatan, kota, kelurahan: kelurahan || address, address,
    });

    // Follow-up otomatis untuk reservasi confirmed (efek samping terstandarisasi).
    if ((status === 'confirmed' || (reservation as any).status === 'confirmed') && bookingDate) {
      try {
        const { followUpService } = await import('./follow-up.service');
        await followUpService.createReservationFollowUps({
          reservationId: reservation.id,
          customerId,
          bookingDate,
          treatmentCategory: validCategory,
          tenantId,
        });
      } catch (fuErr: any) {
        console.warn('[RESERVATION CORE] Failed to create follow-ups:', fuErr.message);
      }
    }

    return { reservation, isNew, isUpdate };
  }
}

export const reservationCoreService = new ReservationCoreService();
