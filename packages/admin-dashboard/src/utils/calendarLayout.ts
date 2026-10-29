/**
 * calendarLayout.ts — satu sumber kebenaran geometri grid kalender.
 *
 * Kenapa file ini ada (F-39 / F-44):
 * Sebelumnya tiga angka ditulis terpisah di `WeekScheduleGrid.tsx`:
 *   1. `TIME_GUTTER = 28`   (lebar kolom label jam)
 *   2. spacer scroll atas   (`width: '1008px'`)
 *   3. `min-w-[1008px]`     (lebar minimum kanvas)
 * Ketiganya WAJIB identik, karena spacer 1:1 dipakai untuk menyinkronkan
 * scrollbar atas dengan kanvas. Bila gutter dikecilkan tanpa mengubah spacer,
 * muncul "ruang geser hantu": kalender bisa digeser melewati kolom Minggu.
 *
 * Dengan menurunkan spacer & `min-w` dari `TIME_GUTTER` + lebar kolom,
 * ketidakcocokan itu mustahil terjadi lagi — bukan dijaga ingatan manusia,
 * tapi dijamin aritmetika.
 *
 * Tanpa React, tanpa DOM: bisa diuji di node.
 */

/** Lebar kolom label jam (px). Label hanya 2 digit (`08`, `13`, `21`). */
export const TIME_GUTTER = 28;

/** Lebar minimum satu kolom hari (px) — dipakai `minmax(…, 1fr)`. */
export const DAY_COL_MIN_WIDTH = 140;

/** Jumlah kolom hari dalam seminggu. */
export const DAY_COL_COUNT = 7;

/**
 * Lebar minimum kanvas mingguan = gutter + 7 kolom.
 * 28 + 7×140 = 1008.
 */
export const GRID_MIN_WIDTH = TIME_GUTTER + DAY_COL_COUNT * DAY_COL_MIN_WIDTH;

/** Template kolom CSS grid mingguan (gutter tetap + 7 kolom fleksibel). */
export const GRID_TEMPLATE_COLUMNS = `${TIME_GUTTER}px repeat(${DAY_COL_COUNT}, minmax(${DAY_COL_MIN_WIDTH}px, 1fr))`;

/**
 * Gutter kolom jam pada view Harian (hanya 2 nilai, tidak terikat spacer).
 * Dibiarkan sebagai kelas Tailwind di komponen agar bisa responsif;
 * nilainya didokumentasikan di sini supaya audit layout punya rujukan tunggal.
 */
export const DAY_GUTTER_MOBILE = 28;
export const DAY_GUTTER_DESKTOP = 44;
