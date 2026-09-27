/**
 * wib-time.ts — Util terpusat waktu WIB (UTC+7).
 *
 * Tujuan: hentikan duplikasi logika batas-hari WIB yang tersebar di banyak file
 * (reservation-core, nightly-watchdog, customers.subroute, indonesian-date-parser,
 * copilot-tools). Kode BARU wajib memakai util ini; call-site lama dimigrasi bertahap.
 */

export const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

export const DAY_NAMES_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'] as const;

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
