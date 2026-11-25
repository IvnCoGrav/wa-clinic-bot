import { useEffect, useRef } from 'react';
import {
  EDGE_ZONE_PX,
  SWIPE_MAX_DURATION_MS,
  isDominantHorizontal,
  resolveSwipeDirection,
  type SwipeDirection,
} from '../utils/swipeGesture';

const SKIP_SELECTOR =
  'input,textarea,select,button,[contenteditable="true"],[data-horizontal-scroll],[data-no-swipe]';

export interface SwipeGestureDetail {
  direction: SwipeDirection;
  startX: number;
  startY: number;
  deltaX: number;
  deltaY: number;
  durationMs: number;
  fromRightEdge: boolean;
}

export interface UseSwipeGestureOptions {
  onSwipe: (detail: SwipeGestureDetail) => void;
  threshold?: number;
  maxDurationMs?: number;
  enabled?: boolean;
}

/**
 * Gestur swipe horizontal berbasis listener native (passive) pada elemen.
 * Tidak pernah memanggil preventDefault → aman dari larangan passive
 * listener React 18 dan tidak merebut scroll vertikal.
 */
export function useSwipeGesture<T extends HTMLElement = HTMLDivElement>({
  onSwipe,
  threshold,
  maxDurationMs = SWIPE_MAX_DURATION_MS,
  enabled = true,
}: UseSwipeGestureOptions) {
  const targetRef = useRef<T | null>(null);
  const onSwipeRef = useRef(onSwipe);
  onSwipeRef.current = onSwipe;

  useEffect(() => {
    const el = targetRef.current;
    if (!el || !enabled) return;
    let start: { x: number; y: number; time: number } | null = null;

    const handleStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        start = null;
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.closest(SKIP_SELECTOR)) {
        start = null;
        return;
      }
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY, time: Date.now() };
    };

    const handleEnd = (e: TouchEvent) => {
      const s = start;
      start = null;
      if (!s || e.changedTouches.length === 0) return;
      const t = e.changedTouches[0];
      const deltaX = t.clientX - s.x;
      const deltaY = t.clientY - s.y;
      const durationMs = Date.now() - s.time;
      if (durationMs > maxDurationMs) return;
      if (!isDominantHorizontal(deltaX, deltaY)) return;
      const direction = resolveSwipeDirection(deltaX, threshold);
      if (!direction) return;
      onSwipeRef.current({
        direction,
        startX: s.x,
        startY: s.y,
        deltaX,
        deltaY,
        durationMs,
        fromRightEdge: s.x >= window.innerWidth - EDGE_ZONE_PX,
      });
    };

    el.addEventListener('touchstart', handleStart, { passive: true });
    el.addEventListener('touchend', handleEnd, { passive: true });
    el.addEventListener('touchcancel', handleEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', handleStart);
      el.removeEventListener('touchend', handleEnd);
      el.removeEventListener('touchcancel', handleEnd);
    };
  }, [enabled, maxDurationMs, threshold]);

  return targetRef;
}
