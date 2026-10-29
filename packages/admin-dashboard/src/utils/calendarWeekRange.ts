/**
 * calendarWeekRange.ts — satu sumber kebenaran "minggu ini" untuk kalender.
 *
 * Kenapa file ini ada (F-43):
 * Rentang minggu dihitung di **tiga tempat berbeda** dengan cara yang berbeda:
 *   1. `getCalendarDateRange()` di halaman → parameter API (`startDate`/`endDate`)
 *   2. `weekDays` di `WeekScheduleGrid` → kolom header grid
 *   3. label rentang di header
 * Ketiganya bisa menyimpang (awal minggu, batas tengah malam, DST/TZ perangkat).
 * Gejalanya halus tapi nyata: **jadwal hari Minggu hilang** atau kolom kosong di
 * ujung minggu, karena API diminta rentang yang tidak sama dengan yang digambar.
 *
 * Aturan yang dikunci di sini:
 * - Minggu dimulai **Senin** (kebiasaan klinik & tampilan grid).
 * - Tanggal acuan dibaca sebagai **tanggal WIB**, bukan tanggal lokal perangkat.
 * - 7 hari dibangun pada pukul 12:00 lokal (pola yang sama dengan
 *   `getTodayWibDate()`), supaya tidak ada pergeseran di batas tengah malam.
 *
 * Tanpa React & tanpa DOM → bisa diuji di node.
 */

import { getWibDateKey } from './dateWib';

export interface WeekRange {
  /** Kunci tanggal WIB hari Senin (YYYY-MM-DD). */
  startDate: string;
  /** Kunci tanggal WIB hari Minggu (YYYY-MM-DD). */
  endDate: string;
  /** 7 objek Date (Senin..Minggu), masing-masing pukul 12:00 lokal. */
  days: Date[];
  /** 7 kunci tanggal WIB yang sejajar dengan `days`. */
  keys: string[];
}

const DAYS_IN_WEEK = 7;

/** Bangun Date pukul 12:00 lokal dari kunci WIB; `null` bila kunci rusak. */
function dateFromWibKey(key: string): Date | null {
  if (!key) return null;
  const parts = key.split('-').map((p) => Number(p));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [y, m, d] = parts;
  const date = new Date(y, m - 1, d, 12, 0, 0, 0);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Rentang minggu (Senin–Minggu) yang memuat `date`.
 * Input rusak tidak melempar error: jatuh ke minggu berjalan.
 */
export function getWeekRange(date: Date): WeekRange {
  const anchor = dateFromWibKey(getWibDateKey(date)) ?? dateFromWibKey(getWibDateKey(new Date())) ?? new Date();

  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const d = anchor.getDate();

  // getDay(): 0 = Minggu. Jarak ke Senin = (day + 6) % 7.
  const distanceFromMonday = (anchor.getDay() + 6) % 7;

  const days: Date[] = [];
  for (let i = 0; i < DAYS_IN_WEEK; i++) {
    days.push(new Date(y, m, d - distanceFromMonday + i, 12, 0, 0, 0));
  }

  const keys = days.map((day) => getWibDateKey(day));

  return {
    startDate: keys[0] ?? '',
    endDate: keys[DAYS_IN_WEEK - 1] ?? '',
    days,
    keys,
  };
}

/** Rentang saja (tanpa objek Date) — untuk parameter API. */
export function getWeekDateRange(date: Date): { startDate: string; endDate: string } {
  const { startDate, endDate } = getWeekRange(date);
  return { startDate, endDate };
}
