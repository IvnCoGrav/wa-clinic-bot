/**
 * Fisika & klasifikasi gestur kanonis untuk dashboard.
 * Murni, tanpa DOM. Dipakai PTR, swipe-back, edge drawer, dan ganti tab.
 */

/** Rasio dominansi horizontal untuk gestur navigasi. */
export const SWIPE_RATIO = 1.8;
/** Rasio lebih ketat untuk edge drawer (mencegah salah buka menu). */
export const EDGE_RATIO = 2.2;
/** Ambang minimum geser untuk ganti tab. */
export const TAB_SWIPE_MIN_PX = 60;
/** Ambang minimum geser untuk buka drawer dari tepi kanan. */
export const EDGE_OPEN_MIN_PX = 45;
/** Lebar zona sentuh tepi kanan layar. */
export const EDGE_ZONE_PX = 30;
/** Durasi maksimum gestur swipe yang masih dianggap navigasi. */
export const SWIPE_MAX_DURATION_MS = 650;

export type SwipeDirection = 'left' | 'right';
export type TabSlideDirection = SwipeDirection | 'none';

/**
 * Redaman eksponensial: 0 → 0, mendekati maxPx secara asimtotik.
 * Tidak pernah "menabrak dinding" karena turunannya mengecil terus.
 */
export function applyRubberBand(delta: number, maxPx: number, rangePx: number): number {
  if (!Number.isFinite(delta) || delta <= 0 || maxPx <= 0 || rangePx <= 0) return 0;
  return maxPx * (1 - Math.exp(-delta / rangePx));
}

export function isDominantHorizontal(deltaX: number, deltaY: number, ratio = SWIPE_RATIO): boolean {
  return Math.abs(deltaX) > Math.abs(deltaY) * ratio;
}

export function resolveSwipeDirection(deltaX: number, threshold = TAB_SWIPE_MIN_PX): SwipeDirection | null {
  if (!Number.isFinite(deltaX) || Math.abs(deltaX) < threshold) return null;
  return deltaX < 0 ? 'left' : 'right';
}

/** Arah isi tab: geser ke kiri (tab berikutnya) → konten masuk dari kanan. */
export function slideClassFor(direction: TabSlideDirection): string {
  if (direction === 'left') return 'animate-slideInFromRight';
  if (direction === 'right') return 'animate-slideInFromLeft';
  return 'animate-fadeIn';
}
