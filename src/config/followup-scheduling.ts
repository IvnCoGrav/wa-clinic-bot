import { getWibDateKey } from './followup-templates';

export const DEFAULT_FOLLOWUP_MAX_PER_DAY = 40;
const DEFAULT_HOLIDAY_STALE_CAP_DAYS = 14;
const DEFAULT_RESCHEDULE_WINDOW = { startMinWib: 540, endMinWib: 990 } as const; // 09:00 - 16:30 WIB
const MANUAL_HOLIDAY_MAX_DAYS = 30;

/**
 * Batas migrasi skema repeat treatment 25/50/75 hari.
 * Hanya reservasi/antrean yang dibuat SETELAH epoch ini yang boleh dihitung
 * ulang dengan skema baru. Baris lama dibiarkan utuh (non-retroaktif).
 */
export const NEXT_TREATMENT_SCHEME_EPOCH: Date = (() => {
  const raw = process.env.NEXT_TREATMENT_SCHEME_EPOCH;
  const parsed = raw ? new Date(`${raw}T00:00:00+07:00`) : new Date('2026-11-19T00:00:00+07:00');
  return isNaN(parsed.getTime()) ? new Date('2026-11-19T00:00:00+07:00') : parsed;
})();

export function isRepeatSchemeEligible(date: Date | string | null | undefined): boolean {
  if (!date) return false;
  const d = new Date(date);
  if (isNaN(d.getTime())) return false;
  return d.getTime() >= NEXT_TREATMENT_SCHEME_EPOCH.getTime();
}

export interface FollowUpHolidayRescheduleSummary {
  rescheduledCount: number;
  staleCancelledCount?: number;
  daysCount: number;
  distribution: Record<string, number>;
  executedAt: string;
}

export interface FollowUpHolidayConfig {
  enabled: boolean;
  startDate: string | null;      // YYYY-MM-DD WIB
  endDate: string | null;        // YYYY-MM-DD WIB
  reason: string | null;
  autoRescheduleOnExit: boolean; // default true
  staleCapDays: number;          // default 14
  windowStartMinWib: number;     // default 540 (09:00)
  windowEndMinWib: number;       // default 990 (16:30)
  manualActivatedAt: string | null; // ISO string
  lastActivatedAt: string | null; // ISO string — bukti pernah diaktifkan admin
  lastRescheduledAt: string | null; // YYYY-MM-DD WIB
  lastRescheduleSummary: FollowUpHolidayRescheduleSummary | null;
}

export type FollowUpHolidayState =
  | { status: 'inactive' }
  | { status: 'active'; mode: 'manual' | 'range' }
  | { status: 'exit_pending'; exitEndDate: string }
  | { status: 'manual_expired' };

export type ParseHolidayInputResult =
  | { ok: true; value: Partial<FollowUpHolidayConfig> }
  | { ok: false; errors: string[] };

function isValidIsoDateOnly(str: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split('-').map((v) => parseInt(v, 10));
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dateObj = new Date(Date.UTC(y, m - 1, d));
  return dateObj.getUTCFullYear() === y && dateObj.getUTCMonth() === m - 1 && dateObj.getUTCDate() === d;
}

export function countWibDaysBetween(startKey: string, endKey: string): number {
  if (!isValidIsoDateOnly(startKey) || !isValidIsoDateOnly(endKey)) return 0;
  const tStart = Date.parse(`${startKey}T00:00:00.000Z`);
  const tEnd = Date.parse(`${endKey}T00:00:00.000Z`);
  return Math.round((tEnd - tStart) / (24 * 60 * 60 * 1000));
}

export function parseFollowUpHolidayConfig(raw: unknown): FollowUpHolidayConfig {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, any>) : {};

  const enabled = typeof obj.enabled === 'boolean'
    ? obj.enabled
    : typeof obj.enabled === 'string'
      ? obj.enabled.trim().toLowerCase() === 'true'
      : false;
  const startDate = typeof obj.startDate === 'string' && isValidIsoDateOnly(obj.startDate) ? obj.startDate : null;
  const endDate = typeof obj.endDate === 'string' && isValidIsoDateOnly(obj.endDate) ? obj.endDate : null;
  const reason = typeof obj.reason === 'string' ? obj.reason.slice(0, 200) : null;
  const autoRescheduleOnExit = obj.autoRescheduleOnExit !== false;

  const staleCapDays =
    typeof obj.staleCapDays === 'number' && Number.isInteger(obj.staleCapDays) && obj.staleCapDays >= 1 && obj.staleCapDays <= 60
      ? obj.staleCapDays
      : DEFAULT_HOLIDAY_STALE_CAP_DAYS;

  const windowStartMinWib =
    typeof obj.windowStartMinWib === 'number' && Number.isInteger(obj.windowStartMinWib) && obj.windowStartMinWib >= 0 && obj.windowStartMinWib < 1440
      ? obj.windowStartMinWib
      : DEFAULT_RESCHEDULE_WINDOW.startMinWib;

  const windowEndMinWib =
    typeof obj.windowEndMinWib === 'number' && Number.isInteger(obj.windowEndMinWib) && obj.windowEndMinWib > windowStartMinWib && obj.windowEndMinWib <= 1440
      ? obj.windowEndMinWib
      : DEFAULT_RESCHEDULE_WINDOW.endMinWib;

  const manualActivatedAt = (() => {
    if (typeof obj.manualActivatedAt !== 'string') return null;
    const parsed = new Date(obj.manualActivatedAt);
    return isNaN(parsed.getTime()) ? null : obj.manualActivatedAt;
  })();
  const lastActivatedAt = (() => {
    if (typeof obj.lastActivatedAt !== 'string') return null;
    const parsed = new Date(obj.lastActivatedAt);
    return isNaN(parsed.getTime()) ? null : obj.lastActivatedAt;
  })();
  const lastRescheduledAt = typeof obj.lastRescheduledAt === 'string' && isValidIsoDateOnly(obj.lastRescheduledAt) ? obj.lastRescheduledAt : null;
  const lastRescheduleSummary =
    obj.lastRescheduleSummary && typeof obj.lastRescheduleSummary === 'object' && !Array.isArray(obj.lastRescheduleSummary)
      ? (obj.lastRescheduleSummary as FollowUpHolidayRescheduleSummary)
      : null;

  return {
    enabled,
    startDate,
    endDate,
    reason,
    autoRescheduleOnExit,
    staleCapDays,
    windowStartMinWib,
    windowEndMinWib,
    manualActivatedAt,
    lastActivatedAt,
    lastRescheduledAt,
    lastRescheduleSummary,
  };
}

export function parseFollowUpHolidayInput(raw: unknown): ParseHolidayInputResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['Body permintaan harus berupa objek JSON.'] };
  }

  const errors: string[] = [];
  const obj = raw as Record<string, any>;
  const patch: Partial<FollowUpHolidayConfig> = {};

  if ('enabled' in obj) {
    if (typeof obj.enabled !== 'boolean') {
      errors.push('enabled harus bernilai boolean.');
    } else {
      patch.enabled = obj.enabled;
    }
  }

  const hasStart = 'startDate' in obj && obj.startDate !== null && obj.startDate !== undefined && obj.startDate !== '';
  const hasEnd = 'endDate' in obj && obj.endDate !== null && obj.endDate !== undefined && obj.endDate !== '';

  if (hasStart !== hasEnd) {
    errors.push('startDate dan endDate wajib diisi berpasangan (atau keduanya dikosongkan).');
  } else if (hasStart && hasEnd) {
    const s = String(obj.startDate).trim();
    const e = String(obj.endDate).trim();
    if (!isValidIsoDateOnly(s)) {
      errors.push(`startDate '${s}' tidak valid. Gunakan format YYYY-MM-DD kalender valid.`);
    }
    if (!isValidIsoDateOnly(e)) {
      errors.push(`endDate '${e}' tidak valid. Gunakan format YYYY-MM-DD kalender valid.`);
    }

    if (isValidIsoDateOnly(s) && isValidIsoDateOnly(e)) {
      if (s > e) {
        errors.push(`startDate (${s}) tidak boleh lebih besar dari endDate (${e}).`);
      } else {
        const days = countWibDaysBetween(s, e);
        if (days > 60) {
          errors.push(`Rentang libur maksimal 60 hari (ditemukan: ${days} hari).`);
        } else {
          patch.startDate = s;
          patch.endDate = e;
        }
      }
    }
  } else if ('startDate' in obj && (obj.startDate === null || obj.startDate === '')) {
    patch.startDate = null;
    patch.endDate = null;
  }

  if ('reason' in obj) {
    if (obj.reason === null || obj.reason === '') {
      patch.reason = null;
    } else if (typeof obj.reason === 'string') {
      if (obj.reason.length > 200) {
        errors.push('reason maksimal 200 karakter.');
      } else {
        patch.reason = obj.reason.trim();
      }
    } else {
      errors.push('reason harus berupa string atau null.');
    }
  }

  if ('autoRescheduleOnExit' in obj) {
    if (typeof obj.autoRescheduleOnExit !== 'boolean') {
      errors.push('autoRescheduleOnExit harus bernilai boolean.');
    } else {
      patch.autoRescheduleOnExit = obj.autoRescheduleOnExit;
    }
  }

  if ('staleCapDays' in obj) {
    const cap = Number(obj.staleCapDays);
    if (!Number.isInteger(cap) || cap < 1 || cap > 60) {
      errors.push('staleCapDays harus berupa integer antara 1 sampai 60 hari.');
    } else {
      patch.staleCapDays = cap;
    }
  }

  if ('windowStartMinWib' in obj || 'windowEndMinWib' in obj) {
    const start = 'windowStartMinWib' in obj ? Number(obj.windowStartMinWib) : DEFAULT_RESCHEDULE_WINDOW.startMinWib;
    const end = 'windowEndMinWib' in obj ? Number(obj.windowEndMinWib) : DEFAULT_RESCHEDULE_WINDOW.endMinWib;

    if (!Number.isInteger(start) || start < 0 || start >= 1440) {
      errors.push('windowStartMinWib harus antara 0 sampai 1439 menit.');
    }
    if (!Number.isInteger(end) || end <= 0 || end > 1440) {
      errors.push('windowEndMinWib harus antara 1 sampai 1440 menit.');
    }
    if (Number.isInteger(start) && Number.isInteger(end) && start >= end) {
      errors.push('windowStartMinWib harus lebih kecil dari windowEndMinWib.');
    }

    if (errors.length === 0) {
      if ('windowStartMinWib' in obj) patch.windowStartMinWib = start;
      if ('windowEndMinWib' in obj) patch.windowEndMinWib = end;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: patch };
}

export function resolveFollowUpHolidayState(cfg: FollowUpHolidayConfig, now: Date): FollowUpHolidayState {
  const todayWib = getWibDateKey(now);
  if (!todayWib) return { status: 'inactive' };

  if (cfg.enabled) {
    if (cfg.startDate && cfg.endDate) {
      if (todayWib >= cfg.startDate && todayWib <= cfg.endDate) {
        return { status: 'active', mode: 'range' };
      }
      if (todayWib > cfg.endDate) {
        if (cfg.autoRescheduleOnExit && cfg.lastRescheduledAt !== cfg.endDate) {
          return { status: 'exit_pending', exitEndDate: cfg.endDate };
        }
        return { status: 'inactive' };
      }
      return { status: 'inactive' };
    }

    // Mode manual tanpa tanggal
    if (cfg.manualActivatedAt) {
      const activatedKey = getWibDateKey(cfg.manualActivatedAt);
      if (activatedKey && countWibDaysBetween(activatedKey, todayWib) >= MANUAL_HOLIDAY_MAX_DAYS) {
        return { status: 'manual_expired' };
      }
    }
    return { status: 'active', mode: 'manual' };
  }

  // Cleanup pasca-libur HANYA jika admin pernah mengaktifkan mode libur.
  // Tanpa `lastActivatedAt`, mengisi tanggal saja tidak boleh memicu aksi apa pun.
  if (cfg.lastActivatedAt && cfg.endDate && cfg.autoRescheduleOnExit && cfg.lastRescheduledAt !== cfg.endDate && todayWib > cfg.endDate) {
    return { status: 'exit_pending', exitEndDate: cfg.endDate };
  }

  return { status: 'inactive' };
}

export function clampScheduledAtToPostHoliday(scheduledAt: Date, cfg: FollowUpHolidayConfig): Date {
  const state = resolveFollowUpHolidayState(cfg, scheduledAt);
  if (state.status !== 'active') {
    return scheduledAt;
  }

  const windowStartMin = cfg.windowStartMinWib ?? DEFAULT_RESCHEDULE_WINDOW.startMinWib;
  const startHour = Math.floor(windowStartMin / 60);
  const startMin = windowStartMin % 60;

  if (state.mode === 'range' && cfg.endDate) {
    // Geser ke hari pertama setelah endDate pada windowStartMinWib
    const [y, m, d] = cfg.endDate.split('-').map((v) => parseInt(v, 10));
    // WIB = UTC+7, jadi jam WIB dikurangi 7 untuk UTC
    const targetUtc = new Date(Date.UTC(y, m - 1, d + 1, startHour - 7, startMin, 0, 0));
    return targetUtc;
  }

  // Mode manual: jika dijadwalkan saat manual active, clamp ke hari esok pada jam buka
  const schedWib = new Date(scheduledAt.getTime() + 7 * 60 * 60 * 1000);
  const y = schedWib.getUTCFullYear();
  const m = schedWib.getUTCMonth();
  const d = schedWib.getUTCDate();
  return new Date(Date.UTC(y, m, d + 1, startHour - 7, startMin, 0, 0));
}
