/**
 * Logika murni pull-to-refresh (swipe-down) untuk halaman tertentu.
 * Dipakai bersama `usePullToRefresh` + `PullToRefreshIndicator`.
 */
import { applyRubberBand } from './swipeGesture';

export const PULL_THRESHOLD_PX = 64;
export const PULL_MAX_PX = 96;
export const PULL_RUBBER_RANGE_PX = 85;
/** Jeda setelah refresh selesai sebelum gestur berikutnya diterima. */
export const PULL_COOLDOWN_MS = 2000;
/** Lama ikon centang "selesai" tampil. */
export const PULL_DONE_MS = 1100;

export type PullPhase = 'idle' | 'pulling' | 'armed' | 'refreshing' | 'done';

/** Jarak visual setelah redaman eksponensial (0..~max, tanpa dinding keras). */
export function applyPullResistance(deltaY: number): number {
  return applyRubberBand(deltaY, PULL_MAX_PX, PULL_RUBBER_RANGE_PX);
}

/** True bila tarikan sudah melewati ambang refresh. */
export function shouldTriggerRefresh(distance: number, threshold = PULL_THRESHOLD_PX): boolean {
  return Number.isFinite(distance) && distance >= threshold;
}

/** Progress 0..1 untuk rotasi ikon saat menarik. */
export function pullProgress(distance: number, threshold = PULL_THRESHOLD_PX): number {
  if (!Number.isFinite(distance) || distance <= 0 || threshold <= 0) return 0;
  return Math.min(1, distance / threshold);
}

/** Gestur baru boleh dimulai bila jeda pasca-refresh sudah lewat. */
export function canStartPull(now: number, cooldownUntil: number): boolean {
  return Number.isFinite(now) && now >= cooldownUntil;
}

/** Label aksesibilitas (tidak ditampilkan visual — indikator hanya ikon). */
export function pullToRefreshAriaLabel(phase: PullPhase): string {
  switch (phase) {
    case 'refreshing':
      return 'Memuat data terbaru';
    case 'done':
      return 'Data sudah diperbarui';
    case 'armed':
      return 'Lepas untuk memperbarui';
    case 'pulling':
      return 'Tarik untuk memperbarui';
    default:
      return '';
  }
}
