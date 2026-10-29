/**
 * calendarHourLabel.ts — label kolom jam pada view Harian & Mingguan.
 *
 * Fase 2 queue kalender: label lama `6 am` / `12 pm` / `1 pm` memakan 4–5
 * karakter untuk informasi yang cukup ditulis dua angka. Pada layar 360px,
 * gutter 70px berarti ~19% lebar layar habis hanya untuk label jam.
 *
 * Dua fungsi, dua keperluan berbeda:
 * - `formatHourLabel()` → gutter visual (hemat ruang, dua digit, 24 jam).
 * - `formatHourLabelLong()` → `title`/`aria-label` (tetap "13:00" agar tidak
 *   ambigu saat hover di desktop maupun untuk pembaca layar).
 *
 * Sengaja fungsi murni tanpa React agar bisa diuji tanpa DOM.
 */

/** Label gutter: dua angka saja (06, 08, 13, 21) — tanpa `:00`, tanpa am/pm. */
export function formatHourLabel(hour: number): string {
  const value = Number(hour);
  if (!Number.isFinite(value)) return '00';
  const truncated = Math.trunc(value);
  return truncated >= 0 && truncated < 10 ? `0${truncated}` : String(truncated);
}

/** Label panjang untuk tooltip/judul — jangan sampai tooltip cuma "jam 13". */
export function formatHourLabelLong(hour: number): string {
  return `${formatHourLabel(hour)}:00`;
}
