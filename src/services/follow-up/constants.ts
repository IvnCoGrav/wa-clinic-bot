import { parsePositiveInt } from '../../utils/env-numeric';

// Parameter batch/throttle follow-up — env-drivable (Fase 4.3 docs/HARDCODED_FIX_PLAN.md)
export const FOLLOWUP_BATCH_LIMIT = parsePositiveInt(process.env.FOLLOWUP_BATCH_LIMIT, 20);
export const FOLLOWUP_THROTTLE_BASE_MS = parsePositiveInt(process.env.FOLLOWUP_THROTTLE_BASE_MS, 1500);
export const LOST_CUSTOMER_GRACE_DAYS = parsePositiveInt(process.env.LOST_CUSTOMER_GRACE_DAYS, 3);
// M3/H8: jendela wajar pasca-treatment sebelum pasien loyal dicap 'lost' (bukan 3 hari).
export const LOST_CUSTOMER_NEXT_TREATMENT_GRACE_DAYS = parsePositiveInt(process.env.LOST_CUSTOMER_NEXT_TREATMENT_GRACE_DAYS, 60);
// H8: grace lead dingin NO_PURCHASE Stage 3 tanpa respons sebelum dicap 'lost'.
export const NO_PURCHASE_LOST_GRACE_DAYS = parsePositiveInt(process.env.NO_PURCHASE_LOST_GRACE_DAYS, 7);
export const FOLLOWUP_RECENT_CHAT_COOLDOWN_HOURS = parsePositiveInt(process.env.FOLLOWUP_RECENT_CHAT_COOLDOWN_HOURS, 72);

// Recent/Upcoming-Visit Guard (fondasional, kasus Bunda Rina 2026-10-05):
export const FOLLOWUP_RECENT_VISIT_SUPPRESS_DAYS = parsePositiveInt(process.env.FOLLOWUP_RECENT_VISIT_SUPPRESS_DAYS, 14);

// WINBACK_60D (re-engagement pelanggan dormant).
export const WINBACK_DORMANT_DAYS = parsePositiveInt(process.env.WINBACK_DORMANT_DAYS, 60);
export const WINBACK_ENQUEUE_LIMIT = parsePositiveInt(process.env.WINBACK_ENQUEUE_LIMIT, 10);
export const WINBACK_LOST_GRACE_DAYS = parsePositiveInt(process.env.WINBACK_LOST_GRACE_DAYS, 7);

// Offset hari jadwal NO_PURCHASE per stage (stage 1, 2, 3 → +3, +7, +14 hari).
export const NO_PURCHASE_STAGE_DAYS: readonly number[] = [3, 7, 14];

// Alasan pembatalan kanonis (cancel_reason) — single source of truth agar konsisten lintas titik lifecycle.
export const CANCEL_REASON = {
  MANUAL_ADMIN: 'Dibatalkan manual oleh Admin',
  BULK_ADMIN: 'Dibatalkan massal oleh Admin',
  RESERVATION_CREATED: 'Customer membuat reservasi baru',
  RESERVATION_CANCELLED: 'Reservasi terkait dibatalkan',
  HAS_ACTIVE_RESERVATION: 'Customer sudah memiliki reservasi aktif',
  INBOUND_HAS_RESERVATION: 'Customer sudah memiliki reservasi',
  INBOUND_CHAT: 'Customer membalas chat (pelanggan aktif kembali)',
  OVERDUE_48H: 'Jadwal kadaluarsa (>48 jam)',
  BYPASS_LABEL: 'Nomor berlabel Skip/Admin CS',
  WABA_TEMPLATE_NOT_APPROVED: 'Template WABA belum disetujui',
  WABA_NO_MARKETING_CONSENT: 'Customer belum opt-in marketing',
  EXPIRED_PENDING: 'Antrean PENDING kadaluarsa (tidak disetujui sebelum akhir hari jadwal)',
  NON_SERIOUS_STAGE3: 'Pengingat hari ke-14 hanya untuk kontak serius (MQL/legacy)',
  UNRESOLVED_PLACEHOLDER: 'Placeholder pesan belum tersubstitusi (dibatalkan gerbang pengiriman)',
} as const;

// Prioritas Tipe Follow-Up: NEXT_TREATMENT (Prioritas 1) lebih diutamakan daripada NO_PURCHASE (Prioritas 2)
export const FOLLOWUP_TYPE_PRIORITY: Record<string, number> = {
  NEXT_TREATMENT: 1, // Prioritas #1: Pasien pasca treatment / repeat order bernilai tinggi LTV
  NO_PURCHASE: 2,    // Prioritas #2: Lead baru yang belum pernah purchase
  WINBACK_60D: 3,    // Prioritas #3: Re-engagement kontak dormant MQL/legacy (>60 hari)
  REMINDER_H1: 4,
  REVIEW_H1_BABY: 5,
  REVIEW_H1_MOMS: 6,
};

export interface ScheduledAtRange {
  gte?: Date;
  lte?: Date;
  lt?: Date;
}

/**
 * Membangun batas waktu pencarian jadwal follow-up (WIB = UTC+7).
 * Fungsi murni (pure function) yang deterministik dan mudah diuji unit test.
 */
export function buildScheduledAtRange(
  dateFilter?: string,
  referenceDate: Date = new Date()
): ScheduledAtRange | null {
  if (!dateFilter || dateFilter === 'all') return null;

  const nowWib = new Date(referenceDate.getTime() + 7 * 60 * 60 * 1000);
  const year = nowWib.getUTCFullYear();
  const month = nowWib.getUTCMonth();
  const date = nowWib.getUTCDate();
  const dayOfWeek = nowWib.getUTCDay(); // 0 = Minggu, 1 = Senin, ..., 6 = Sabtu

  // Start of today in WIB (00:00:00 WIB)
  const startOfTodayUtc = new Date(Date.UTC(year, month, date, 0, 0, 0) - 7 * 60 * 60 * 1000);
  // End of today in WIB (23:59:59.999 WIB)
  const endOfTodayUtc = new Date(Date.UTC(year, month, date, 23, 59, 59, 999) - 7 * 60 * 60 * 1000);

  if (dateFilter === 'upcoming') {
    return { gte: startOfTodayUtc };
  }
  if (dateFilter === 'today') {
    return { gte: startOfTodayUtc, lte: endOfTodayUtc };
  }
  if (dateFilter === 'this_week') {
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const startOfWeekUtc = new Date(Date.UTC(year, month, date - daysFromMonday, 0, 0, 0) - 7 * 60 * 60 * 1000);
    const daysToSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
    const endOfWeekUtc = new Date(Date.UTC(year, month, date + daysToSunday, 23, 59, 59, 999) - 7 * 60 * 60 * 1000);
    return { gte: startOfWeekUtc, lte: endOfWeekUtc };
  }
  if (dateFilter === 'this_month') {
    const startOfMonthUtc = new Date(Date.UTC(year, month, 1, 0, 0, 0) - 7 * 60 * 60 * 1000);
    const endOfMonthUtc = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999) - 7 * 60 * 60 * 1000);
    return { gte: startOfMonthUtc, lte: endOfMonthUtc };
  }
  if (dateFilter === 'overdue') {
    return { lt: startOfTodayUtc };
  }
  return null;
}

export function isWithinFollowUpWorkingHours(now: Date): boolean {
  const nowWib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const hour = nowWib.getUTCHours();
  return hour >= 9 && hour < 17;
}
