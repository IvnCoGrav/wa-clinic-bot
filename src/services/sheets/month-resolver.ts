import { getWibNow, getWibDayName, formatWibDateYYYYMMDD } from '../../utils/wib-time';

/**
 * month-resolver.ts — pemetaan deterministik tanggal reservasi → tab bulan &
 * tahun (WIB). Modul MURNI (tanpa I/O, tanpa DB) agar mudah diuji dan dipakai
 * ulang. Logika waktu WIB WAJIB dari `src/utils/wib-time.ts` (single source of
 * truth) — DILARANG membuat konversi UTC+7 kedua di sini.
 *
 * Nama tab bulan adalah DATA per-tenant (kolom `TenantSheetsConfig.month_tab_names`)
 * yang disuntikkan sebagai parameter — BUKAN daftar hafalan di kode. Konstanta
 * DEFAULT di bawah hanya fallback bila pemanggil tidak menyediakan config.
 */
export const DEFAULT_MONTH_TAB_NAMES: readonly string[] = [
  'Jan', 'Feb', 'Mar', 'April', 'Mei', 'Juni',
  'Juli', 'Aug', 'Sept', 'okt', 'Nov', 'Des',
];

export interface SheetTarget {
  /** Nama tab bulan sesuai config tenant (mis. "okt"). */
  tabName: string;
  /** Tahun WIB (mis. 2027). */
  year: number;
  /** Indeks bulan WIB 0-11 (0 = Januari). */
  monthIndex: number;
  /** Nama hari WIB bahasa Indonesia (mis. "Kamis"). */
  dayName: string;
  /** Tanggal WIB "YYYY-MM-DD" (aman diketik USER_ENTERED ke Sheets). */
  isoDate: string;
}

/**
 * Petakan tanggal reservasi ke target penulisan spreadsheet (tab bulan + tahun).
 * Throw bila tanggal tidak valid — reservasi tanpa tanggal TIDAK boleh diam-diam
 * masuk ke tab bulan apa pun (dipaksa antre oleh pemanggil).
 */
export function resolveSheetTarget(
  bookingDate: Date | null | undefined,
  monthTabNames?: readonly string[] | null
): SheetTarget {
  if (!bookingDate || isNaN(bookingDate.getTime())) {
    throw new Error('INVALID_BOOKING_DATE');
  }
  const names =
    Array.isArray(monthTabNames) && monthTabNames.length === 12
      ? monthTabNames
      : DEFAULT_MONTH_TAB_NAMES;

  const wib = getWibNow(bookingDate);
  const year = wib.getUTCFullYear();
  const monthIndex = wib.getUTCMonth();
  const tabName = String(names[monthIndex] || DEFAULT_MONTH_TAB_NAMES[monthIndex]);

  return {
    tabName,
    year,
    monthIndex,
    dayName: getWibDayName(bookingDate),
    isoDate: formatWibDateYYYYMMDD(bookingDate),
  };
}

/**
 * Nama file spreadsheet tahunan, mis. "Rekapan Pasien 2027".
 * baseName berasal dari DB (`TenantSheetsConfig.file_base_name`), bukan hardcode.
 */
export function resolveYearlyFileName(
  year: number,
  baseName: string = 'Rekapan Pasien'
): string {
  const safeBase = (baseName || 'Rekapan Pasien').trim();
  return `${safeBase} ${year}`;
}
