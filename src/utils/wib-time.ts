/**
 * wib-time.ts — Util terpusat waktu WIB (UTC+7).
 *
 * CFG-10: Konsolidasi modul utilitas waktu WIB. Menjadi single source of truth
 * untuk batas-hari WIB, konversi rentang hari ke UTC, format tanggal, nama hari,
 * dan label waktu sapaan AI.
 */

export const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

export const DAY_NAMES_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'] as const;

export interface WibTimeInfo {
  hourWib: number;
  timeOfDay: 'pagi' | 'siang' | 'sore' | 'malam';
  greetingRecommendation: string;
  wibTimeString: string;
}

/** Waktu "sekarang" yang digeser ke WIB (baca via getUTC* untuk field WIB). */
export function getWibNow(now: Date = new Date()): Date {
  return new Date(now.getTime() + WIB_OFFSET_MS);
}

/**
 * Batas hari WIB (00:00:00.000 – 23:59:59.999) sebagai Date UTC absolut,
 * untuk query Prisma. `offsetDays` menggeser hari (0 = hari ini WIB, 1 = besok).
 */
export function wibDayBoundsUtc(offsetDays = 0, now: Date = new Date()): { start: Date; end: Date } {
  const wibNow = getWibNow(now);
  const y = wibNow.getUTCFullYear();
  const m = wibNow.getUTCMonth();
  const d = wibNow.getUTCDate() + offsetDays;
  const startWibAsUtc = Date.UTC(y, m, d, 0, 0, 0, 0);
  const endWibAsUtc = Date.UTC(y, m, d, 23, 59, 59, 999);
  return { start: new Date(startWibAsUtc - WIB_OFFSET_MS), end: new Date(endWibAsUtc - WIB_OFFSET_MS) };
}

/** Awal hari ini WIB sebagai Date UTC absolut (untuk filter `gte`). */
export function startOfTodayWib(now: Date = new Date()): Date {
  return wibDayBoundsUtc(0, now).start;
}

/** Format tanggal WIB "YYYY-MM-DD". */
export function formatWibDateYYYYMMDD(date: Date = new Date()): string {
  const wib = getWibNow(date);
  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, '0');
  const d = String(wib.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Nama hari WIB dalam Bahasa Indonesia. */
export function getWibDayName(date: Date = new Date()): string {
  return DAY_NAMES_ID[getWibNow(date).getUTCDay()];
}

/** Format jam WIB "HH:MM". */
export function formatWibTime(date: Date): string {
  const wib = getWibNow(date);
  return `${String(wib.getUTCHours()).padStart(2, '0')}:${String(wib.getUTCMinutes()).padStart(2, '0')}`;
}

/** Pure: 00:00-23:59 WIB → UTC gte/lte untuk query Prisma (Asia/Jakarta UTC+7). */
export function wibDayRangeToUtc(dayStr: string): { start: Date; end: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayStr)) return null;
  const [y, m, d] = dayStr.split('-').map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - WIB_OFFSET_MS),
    end: new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) - WIB_OFFSET_MS),
  };
}

/**
 * Pure: rentang 1 bulan penuh WIB (00:00 tanggal 1 s.d. 23:59:59.999 tanggal
 * terakhir) sebagai Date UTC absolut, plus `daysInMonth`.
 *
 * `month` 1-indexed (1 = Januari). Input tidak valid → `null` (pola sama dengan
 * `wibDayRangeToUtc`) agar pemanggil bisa membalas 400, bukan menghasilkan
 * rentang sampah.
 */
export function wibMonthBoundsUtc(
  year: number,
  month: number
): { start: Date; end: Date; daysInMonth: number } | null {
  if (!Number.isInteger(year) || year < 1970 || year > 2999) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;

  // Date.UTC(year, monthIndex, 0) = hari terakhir bulan monthIndex-1 (1-indexed).
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0) - WIB_OFFSET_MS),
    end: new Date(Date.UTC(year, month - 1, daysInMonth, 23, 59, 59, 999) - WIB_OFFSET_MS),
    daysInMonth,
  };
}

/** Geser bulan 1-indexed sebanyak `delta` bulan (boleh negatif). */
export function shiftWibMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const zeroBased = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

/**
 * Helper waktu WIB untuk kecerdasan AI.
 * Memberikan info jam presisi dan label waktu (pagi, siang, sore, malam)
 * agar sapaan AI 100% akurat sesuai waktu lokal.
 */
export function getWibTimeInfo(nowDate: Date = new Date()): WibTimeInfo {
  const wibDate = getWibNow(nowDate);
  const hourWib = wibDate.getUTCHours();
  const minutes = String(wibDate.getUTCMinutes()).padStart(2, '0');

  let timeOfDay: 'pagi' | 'siang' | 'sore' | 'malam' = 'pagi';
  let greetingRecommendation = 'Selamat Pagi';

  if (hourWib >= 3 && hourWib < 11) {
    timeOfDay = 'pagi';
    greetingRecommendation = 'Selamat Pagi';
  } else if (hourWib >= 11 && hourWib < 15) {
    timeOfDay = 'siang';
    greetingRecommendation = 'Selamat Siang';
  } else if (hourWib >= 15 && hourWib < 18) {
    timeOfDay = 'sore';
    greetingRecommendation = 'Selamat Sore';
  } else {
    timeOfDay = 'malam';
    greetingRecommendation = 'Selamat Malam';
  }

  return {
    hourWib,
    timeOfDay,
    greetingRecommendation,
    wibTimeString: `${String(hourWib).padStart(2, '0')}:${minutes} WIB (${greetingRecommendation})`,
  };
}
