/**
 * calendarTimePosition.ts — posisi garis "sekarang" pada timeline kalender.
 *
 * Fase 3 queue kalender: view Harian belum punya penanda waktu sekarang,
 * sehingga admin harus menghitung sendiri "jam 10 lewat berapa" saat melihat
 * jadwal hari ini.
 *
 * Kenapa fungsi murni terpisah:
 * - Posisi WAJIB terikat pada `hourHeight` (zoom compact/standard/detailed).
 *   Menghitung dengan angka tetap membuat garis meleset saat admin zoom.
 * - Bisa diuji tanpa DOM, termasuk kasus batas 06:00 / 22:00 dan input rusak.
 *
 * Grid menampilkan `HOURS = 6..21` → 06:00 s.d. 22:00 (16 jam).
 */
export const GRID_START_HOUR = 6;
export const GRID_END_HOUR = 22;

/**
 * Menit sejak 06:00 → posisi px, terikat pada `hourHeight`.
 *
 * Mengembalikan `null` bila di luar jam grid atau bila input tidak masuk akal,
 * sehingga pemanggil tidak perlu menulis guard tambahan (dan tidak mungkin
 * menggambar garis di luar kanvas).
 */
export function computeNowTopPx(
  hours: number,
  minutes: number,
  hourHeight: number
): number | null {
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (!Number.isFinite(hourHeight) || hourHeight <= 0) return null;

  const totalMinutes = (hours - GRID_START_HOUR) * 60 + minutes;
  const maxMinutes = (GRID_END_HOUR - GRID_START_HOUR) * 60;
  if (totalMinutes < 0 || totalMinutes > maxMinutes) return null;

  return (totalMinutes / 60) * hourHeight;
}
