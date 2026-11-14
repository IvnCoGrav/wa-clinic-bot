import { useEffect, useRef, useState } from 'react';
import {
  PULL_COOLDOWN_MS,
  PULL_DONE_MS,
  PULL_THRESHOLD_PX,
  applyPullResistance,
  canStartPull,
  pullProgress,
  shouldTriggerRefresh,
  type PullPhase,
} from '../utils/pullToRefresh';

export interface UsePullToRefreshOptions {
  onRefresh: () => void | Promise<void>;
  enabled?: boolean;
  threshold?: number;
}

export interface PullToRefreshState {
  distance: number;
  progress: number;
  phase: PullPhase;
  isDragging: boolean;
  isRefreshing: boolean;
}

/**
 * Pull-to-refresh deterministik untuk halaman yang diizinkan (LiveChat Monitor
 * & halaman staf). Bukan reload halaman: memanggil `onRefresh` milik halaman.
 *
 * Fase: idle → pulling → armed → refreshing → done (centang singkat) → cooldown.
 * Cooldown mencegah refresh berulang tanpa sengaja.
 */
export function usePullToRefresh({
  onRefresh,
  enabled = true,
  threshold = PULL_THRESHOLD_PX,
}: UsePullToRefreshOptions): PullToRefreshState {
  const [distance, setDistance] = useState(0);
  const [phase, setPhase] = useState<PullPhase>('idle');
  const [isDragging, setIsDragging] = useState(false);

  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const busyRef = useRef(false);
  const cooldownUntilRef = useRef(0);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gestureRef = useRef({ startX: 0, startY: 0, canPull: false, distance: 0 });

  useEffect(() => {
    if (!enabled) return;

    const findScrollableAncestor = (node: HTMLElement | null): HTMLElement | null => {
      let el: HTMLElement | null = node;
      while (el && el !== document.body && el !== document.documentElement) {
        const style = window.getComputedStyle(el);
        const scrollable = /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 2;
        if (scrollable) return el;
        el = el.parentElement;
      }
      return null;
    };

    const isBlocked = () =>
      document.body.classList.contains('body-scroll-locked') ||
      Boolean(document.querySelector('[data-ptr-ignore-active="true"]'));

    const handleStart = (e: TouchEvent) => {
      if (busyRef.current || isBlocked() || e.touches.length !== 1 || !canStartPull(Date.now(), cooldownUntilRef.current)) {
        gestureRef.current.canPull = false;
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-ptr-ignore]')) {
        gestureRef.current.canPull = false;
        return;
      }
      const scrollable = findScrollableAncestor(target);
      if (scrollable && scrollable.scrollTop > 0) {
        gestureRef.current.canPull = false;
        return;
      }
      if (!scrollable && window.scrollY > 0) {
        gestureRef.current.canPull = false;
        return;
      }
      gestureRef.current = {
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        canPull: true,
        distance: 0,
      };
      setIsDragging(true);
    };

    const handleMove = (e: TouchEvent) => {
      const g = gestureRef.current;
      if (!g.canPull || e.touches.length !== 1) return;
      const dy = e.touches[0].clientY - g.startY;
      const dx = e.touches[0].clientX - g.startX;
      // Abaikan gestur horizontal (swipe) agar tidak bentrok dengan navigasi.
      if (Math.abs(dx) > Math.abs(dy) * 1.2) {
        g.canPull = false;
        g.distance = 0;
        setIsDragging(false);
        setDistance(0);
        setPhase('idle');
        return;
      }
      if (dy <= 0) {
        g.distance = 0;
        setDistance(0);
        setPhase('idle');
        return;
      }
      if (e.cancelable) e.preventDefault();
      const next = applyPullResistance(dy);
      g.distance = next;
      setDistance(next);
      setPhase(shouldTriggerRefresh(next, threshold) ? 'armed' : 'pulling');
    };

    const finish = async () => {
      const g = gestureRef.current;
      if (!g.canPull) {
        setIsDragging(false);
        return;
      }
      g.canPull = false;
      setIsDragging(false);

      if (shouldTriggerRefresh(g.distance, threshold) && !busyRef.current) {
        busyRef.current = true;
        setPhase('refreshing');
        setDistance(threshold * 0.75);
        try {
          await refreshRef.current();
        } catch {
          // Halaman menangani error refresh-nya sendiri.
        } finally {
          setPhase('done');
          setDistance(0);
          cooldownUntilRef.current = Date.now() + PULL_COOLDOWN_MS;
          if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
          doneTimerRef.current = setTimeout(() => {
            setPhase('idle');
            busyRef.current = false;
          }, PULL_DONE_MS);
        }
        return;
      }

      g.distance = 0;
      setPhase('idle');
      setDistance(0);
    };

    document.addEventListener('touchstart', handleStart, { passive: true });
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', finish);
    document.addEventListener('touchcancel', finish);

    return () => {
      document.removeEventListener('touchstart', handleStart);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', finish);
      document.removeEventListener('touchcancel', finish);
      if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
    };
  }, [enabled, threshold]);

  return {
    distance,
    progress: pullProgress(distance, threshold),
    phase,
    isDragging,
    isRefreshing: phase === 'refreshing',
  };
}
