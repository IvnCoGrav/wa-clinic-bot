/**
 * Logika murni pull-to-refresh (swipe-down) untuk halaman tertentu.
 * Dipakai bersama `usePullToRefresh` + `PullToRefreshIndicator`.
 */

export const PULL_THRESHOLD_PX = 72;
export const PULL_MAX_PX = 120;
export const PULL_RESISTANCE = 0.5;

/** Jarak visual setelah hambatan (0..PULL_MAX_PX). */
export function applyPullResistance(deltaY: number, resistance = PULL_RESISTANCE, max = PULL_MAX_PX): number {
  if (!Number.isFinite(deltaY) || deltaY <= 0) return 0;
  return Math.min(max, deltaY * resistance);
}

/** True bila tarikan sudah melewati ambang refresh. */
export function shouldTriggerRefresh(distance: number, threshold = PULL_THRESHOLD_PX): boolean {
  return Number.isFinite(distance) && distance >= threshold;
}

/** Label indikator: menarik / siap dilepas / sedang memuat. */
export function pullToRefreshLabel(distance: number, refreshing: boolean, threshold = PULL_THRESHOLD_PX): string {
  if (refreshing) return 'Memuat data terbaru…';
  if (shouldTriggerRefresh(distance, threshold)) return 'Lepas untuk refresh';
  return distance > 0 ? 'Tarik untuk refresh' : '';
}
