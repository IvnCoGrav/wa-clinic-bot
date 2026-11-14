import { useEffect, useRef, useState } from 'react';
import {
  PULL_THRESHOLD_PX,
  applyPullResistance,
  shouldTriggerRefresh,
} from '../utils/pullToRefresh';

export interface UsePullToRefreshOptions {
  onRefresh: () => void | Promise<void>;
  enabled?: boolean;
  threshold?: number;
}

export interface PullToRefreshState {
  distance: number;
  isRefreshing: boolean;
}

/**
 * Pull-to-refresh deterministik untuk halaman yang diizinkan (LiveChat Monitor
 * & halaman staf). Bukan reload halaman: memanggil `onRefresh` milik halaman.
 *
 * Aturan:
 * - Hanya aktif di perangkat sentuh (satu jari).
 * - Hanya memicu bila kontainer scroll terdekat berada di paling atas.
 * - Elemen ber-atribut `data-ptr-ignore` (mis. viewer gambar) tidak memicu.
 * - Tidak aktif saat body scroll dikunci (modal/drawer terbuka).
 */
export function usePullToRefresh({
  onRefresh,
  enabled = true,
  threshold = PULL_THRESHOLD_PX,
}: UsePullToRefreshOptions): PullToRefreshState {
  const [distance, setDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const refreshingRef = useRef(false);
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
      if (refreshingRef.current || isBlocked() || e.touches.length !== 1) {
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
        setDistance(0);
        return;
      }
      if (dy <= 0) {
        g.distance = 0;
        setDistance(0);
        return;
      }
      if (e.cancelable) e.preventDefault();
      const next = applyPullResistance(dy);
      g.distance = next;
      setDistance(next);
    };

    const finish = async () => {
      const g = gestureRef.current;
      if (!g.canPull) return;
      g.canPull = false;
      if (shouldTriggerRefresh(g.distance, threshold) && !refreshingRef.current) {
        refreshingRef.current = true;
        setIsRefreshing(true);
        setDistance(threshold * 0.6);
        try {
          await refreshRef.current();
        } catch {
          // Halaman menangani error refresh-nya sendiri.
        } finally {
          refreshingRef.current = false;
          setIsRefreshing(false);
          setDistance(0);
        }
        return;
      }
      g.distance = 0;
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
    };
  }, [enabled, threshold]);

  return { distance, isRefreshing };
}
