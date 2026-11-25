import type React from 'react';
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
import { SWIPE_RATIO } from '../utils/swipeGesture';

export interface UsePullToRefreshOptions {
  onRefresh: () => void | Promise<void>;
  enabled?: boolean;
  threshold?: number;
}

export interface PullToRefreshState {
  phase: PullPhase;
  indicatorRef: React.RefObject<HTMLDivElement>;
}

/**
 * Pull-to-refresh deterministik untuk halaman yang diizinkan (LiveChat Monitor
 * & halaman staf). Bukan reload halaman: memanggil `onRefresh` milik halaman.
 *
 * 0-render per frame: jarak visual ditranslasikan langsung via ref & CSS custom
 * property, re-render React hanya dipicu saat fase diskret berganti.
 */
export function usePullToRefresh({
  onRefresh,
  enabled = true,
  threshold = PULL_THRESHOLD_PX,
}: UsePullToRefreshOptions): PullToRefreshState {
  const [phase, setPhase] = useState<PullPhase>('idle');
  const indicatorRef = useRef<HTMLDivElement>(null);
  const distanceRef = useRef(0);
  const phaseRef = useRef<PullPhase>('idle');

  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const busyRef = useRef(false);
  const cooldownUntilRef = useRef(0);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gestureRef = useRef({ startX: 0, startY: 0, canPull: false, distance: 0 });

  const paint = (distance: number) => {
    const el = indicatorRef.current;
    if (!el) return;
    el.style.setProperty('--ptr-y', `${distance}px`);
    el.style.setProperty('--ptr-progress', String(pullProgress(distance, threshold)));
  };

  const setPhaseDiscrete = (next: PullPhase) => {
    if (phaseRef.current === next) return;
    phaseRef.current = next;
    setPhase(next);
  };

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
      distanceRef.current = 0;
      paint(0);
    };

    const handleMove = (e: TouchEvent) => {
      const g = gestureRef.current;
      if (!g.canPull || e.touches.length !== 1) return;
      const dy = e.touches[0].clientY - g.startY;
      const dx = e.touches[0].clientX - g.startX;

      if (Math.abs(dx) > Math.abs(dy) * SWIPE_RATIO) {
        g.canPull = false;
        g.distance = 0;
        distanceRef.current = 0;
        paint(0);
        setPhaseDiscrete('idle');
        return;
      }
      if (dy <= 0) {
        if (g.distance !== 0) {
          g.distance = 0;
          distanceRef.current = 0;
          paint(0);
          setPhaseDiscrete('idle');
        }
        return;
      }
      if (e.cancelable) e.preventDefault();
      const next = applyPullResistance(dy);
      g.distance = next;
      distanceRef.current = next;
      paint(next);
      setPhaseDiscrete(next >= threshold ? 'armed' : 'pulling');
    };

    const finish = async () => {
      const g = gestureRef.current;
      if (!g.canPull) return;
      g.canPull = false;

      if (shouldTriggerRefresh(g.distance, threshold) && !busyRef.current) {
        busyRef.current = true;
        setPhaseDiscrete('refreshing');
        paint(threshold * 0.75);
        try {
          await refreshRef.current();
        } catch {
          // Halaman menangani error refresh-nya sendiri.
        } finally {
          setPhaseDiscrete('done');
          paint(0);
          cooldownUntilRef.current = Date.now() + PULL_COOLDOWN_MS;
          if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
          doneTimerRef.current = setTimeout(() => {
            setPhaseDiscrete('idle');
            busyRef.current = false;
          }, PULL_DONE_MS);
        }
        return;
      }

      g.distance = 0;
      distanceRef.current = 0;
      // Fase diubah lebih dulu agar aturan transisi idle terpasang, lalu target 0
      // ditulis pada frame berikutnya supaya animasi lepas jari benar-benar terlihat.
      setPhaseDiscrete('idle');
      requestAnimationFrame(() => paint(0));
    };

    document.addEventListener('touchstart', handleStart, { passive: true });
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', finish);
    document.addEventListener('touchcancel', finish);

    return () => {
      paint(0);
      document.removeEventListener('touchstart', handleStart);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', finish);
      document.removeEventListener('touchcancel', finish);
      if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
    };
  }, [enabled, threshold]);

  return { phase, indicatorRef };
}
