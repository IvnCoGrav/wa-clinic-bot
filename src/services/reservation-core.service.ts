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
const WIB_OFFSET_MS = 7 * 3600000;

function getWibCalendarDayBounds(date: Date): { dayStart: Date; dayEnd: Date } {
  const utcTime = date.getTime();
  const wibTime = new Date(utcTime + WIB_OFFSET_MS);
  const year = wibTime.getUTCFullYear();
  const month = wibTime.getUTCMonth();
  const day = wibTime.getUTCDate();
  const dayStart = new Date(Date.UTC(year, month, day, 0, 0, 0, 0) - WIB_OFFSET_MS);
  const dayEnd = new Date(Date.UTC(year, month, day, 23, 59, 59, 999) - WIB_OFFSET_MS);
  return { dayStart, dayEnd };
}

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
}): Promise<{ exactConflicts: any[]; sameDayReservations: any[] }> {
  const { tenantId, customerId, bookingDate, durationMinutes } = params;
  const { dayStart, dayEnd } = getWibCalendarDayBounds(bookingDate);
  const windowStart = new Date(bookingDate.getTime() - durationMinutes * 60000);
  const windowEnd = new Date(bookingDate.getTime() + durationMinutes * 60000);
  let candidates: any[] = [];
  try {
    candidates = await prisma.reservation.findMany({
      where: {
        tenant_id: tenantId,
        customer_id: customerId,
        status: { in: ACTIVE_STATUSES },
        booking_date: { gte: dayStart, lte: dayEnd },
      },
      orderBy: { booking_date: 'asc' },
    });
  } catch {
    return { exactConflicts: [], sameDayReservations: [] };
  }
  const activeCandidates = (candidates || []).filter((r: any) => {
    if (!r.booking_date) return false;
    if (params.excludeId && r.id === params.excludeId) return false;
    return true;
  });
  const exactConflicts = activeCandidates.filter((r: any) => {
    const existingStart = new Date(r.booking_date);
    const existingDur = effectiveDuration((r as any).duration_minutes, 60);
    return intervalsOverlap(bookingDate, durationMinutes, existingStart, existingDur);
  });
  return { exactConflicts, sameDayReservations: activeCandidates };
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

    // Single Source of Truth: durasi NULL diresolve via katalog kanonis agar DB
    // tidak menyimpan NULL saat nama layanan valid. Anti-fabrikasi: angka hasil
    // resolve HANYA dipersist bila seluruh item dikenali katalog / tag eksplisit —
    // teks tak dikenali dibiarkan null (UI memakai estimasi tampilan).
    let duration = durationMinutes != null ? effectiveDuration(durationMinutes, 60) : null;
    if (duration == null && treatmentDetail && treatmentDetail.trim()) {
      try {
        const { treatmentCatalogService } = await import('./treatment-catalog.service');
        const breakdown = treatmentCatalogService.resolveDurationBreakdown(treatmentDetail, tenantId);
        if (breakdown.confident || breakdown.usedExplicitTag) {
          duration = effectiveDuration(breakdown.totalMinutes, 60);
        }
      } catch {
        duration = null;
      }
    }
    const validCategory = ((treatmentCategory as TreatmentCategory) || TreatmentCategory.BABY) as TreatmentCategory;
    const effectiveRawText =
      rawText ||
      `[RESERVATION:${source}] ${treatmentDetail || '-'} | ${bookingDate ? bookingDate.toISOString().slice(0, 10) : '-'} | ${customerName || '-'}`;

    // --- Validasi 1 & 2: hanya bermakna bila ada bookingDate ---
    if (bookingDate && !isNaN(bookingDate.getTime())) {
      const durForCheck = duration ?? 60;

       const { exactConflicts, sameDayReservations } = await findOverlappingCustomerReservations({
         tenantId,
         customerId,
         bookingDate,
         durationMinutes: durForCheck,
       });

       const confirmedSameDay = sameDayReservations.filter((r: any) => r.status !== 'hold');
       const holdSameDay = sameDayReservations.filter((r: any) => r.status === 'hold');
       const customerSameDayActive = sameDayReservations.length > 0;

       // Kasus 1: Konflik Nyata ADMIN_PANEL — customer SUDAH memiliki reservasi 'confirmed' hari ini
       if (source === 'ADMIN_PANEL' && !force && confirmedSameDay.length > 0) {
         throw new ReservationConflictError('DUPLICATE_BOOKING', exactConflicts.find((r: any) => r.status === 'confirmed') || confirmedSameDay[0]);
       }

       // Validasi bentrok terapis (jika ada assignedStaffId)
       if (assignedStaffId) {
         const staffConflicts = await findOverlappingStaffReservations({
           tenantId,
           staffId: assignedStaffId,
           bookingDate,
           durationMinutes: durForCheck,
           excludeId: sameDayReservations[0]?.id,
         });
         if (staffConflicts.length > 0 && source === 'ADMIN_PANEL' && !force) {
           throw new ReservationConflictError('STAFF_COLLISION', staffConflicts[0]);
         }
         if (staffConflicts.length > 0 && source !== 'ADMIN_PANEL') {
           console.warn(`[RESERVATION CORE] Staff collision tolerated on ${source} path (staff=${assignedStaffId}, kept new/merged record).`);
         }
       }

       if (exactConflicts.length > 0 || customerSameDayActive) {
         if (source === 'ADMIN_PANEL' && force) {
           console.log(
             `[RESERVATION CORE] Force override: admin membuat reservasi baru meski ${exactConflicts.length} konflik menit & ${sameDayReservations.length} same-day active.`,
             `customer=${customerId} date=${bookingDate.toISOString()}`
           );
         } else {
           // Berlaku untuk:
           // a) ADMIN_PANEL saat customer HANYA punya hold (confirmedSameDay.length === 0 & holdSameDay.length > 0)
           //    -> Auto-upgrade slot hold milik customer tersebut menjadi confirmed!
           // b) BOT / WEBHOOK / AGENT -> Idempotent merge ke reservasi pertama hari ini
           const primary = sameDayReservations[0];
           const duplicates = sameDayReservations.slice(1);
           const targetStatus = status || 'confirmed';

           const updated = await prisma.reservation.update({
             where: { id: primary.id },
             data: {
               status: targetStatus,
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

           // Follow-up otomatis untuk reservasi yang dikonfirmasi
           if (targetStatus === 'confirmed' && bookingDate) {
             try {
               const { followUpService } = await import('./follow-up.service');
               await followUpService.createReservationFollowUps({
                 reservationId: updated.id,
                 customerId,
                 bookingDate,
                 treatmentCategory: validCategory,
                 tenantId,
               });
             } catch (fuErr: any) {
               console.warn('[RESERVATION CORE] Failed to create follow-ups for upgraded reservation:', fuErr.message);
             }
           }

           return { reservation: updated, isNew: false, isUpdate: true, consolidatedCount };
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
