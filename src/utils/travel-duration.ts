/**
 * Estimasi durasi tempuh sepeda motor (menit).
 * Kalibrasi: ~2.05 menit/km + buffer lampu merah/gang 2 menit.
 */
export function estimateTravelDurationMinutes(distanceKm: number | null): number | null {
  if (distanceKm == null || distanceKm <= 0) return null;
  return Math.max(3, Math.round(distanceKm * 2.05 + 2));
}
