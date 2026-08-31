import { useState, useEffect, useRef, useCallback } from 'react';

export type CalendarZoomPreset = 'compact' | 'normal' | 'detailed';

export interface CalendarZoomState {
  hourHeight: number;
  zoomPercent: number;
  zoomLevel: CalendarZoomPreset;
  setHourHeight: (height: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  setPreset: (preset: CalendarZoomPreset) => void;
  containerRef: React.RefObject<HTMLDivElement>;
}

const STORAGE_KEY = 'calendar_hour_height';
const MIN_HOUR_HEIGHT = 44; // Zoom out maksimal (seluruh jam muat dalam layar HP)
const MAX_HOUR_HEIGHT = 180; // Zoom in maksimal (detail lengkap)
const DEFAULT_HOUR_HEIGHT = 90; // Standar normal

const PRESET_HEIGHTS: Record<CalendarZoomPreset, number> = {
  compact: 52,
  normal: 90,
  detailed: 150,
};

export function useCalendarZoom(initialHeight?: number): CalendarZoomState {
  const containerRef = useRef<HTMLDivElement>(null);

  // Baca dari localStorage jika ada
  const [hourHeight, setHourHeightState] = useState<number>(() => {
    if (initialHeight) return initialHeight;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= MIN_HOUR_HEIGHT && parsed <= MAX_HOUR_HEIGHT) {
          return parsed;
        }
      }
    } catch (_) {}
    return DEFAULT_HOUR_HEIGHT;
  });

  const hourHeightRef = useRef(hourHeight);
  hourHeightRef.current = hourHeight;

  const setHourHeight = useCallback((val: number | ((prev: number) => number)) => {
    setHourHeightState((prev) => {
      const next = typeof val === 'function' ? val(prev) : val;
      const clamped = Math.max(MIN_HOUR_HEIGHT, Math.min(MAX_HOUR_HEIGHT, Math.round(next)));
      try {
        localStorage.setItem(STORAGE_KEY, clamped.toString());
      } catch (_) {}
      return clamped;
    });
  }, []);

  const zoomIn = useCallback(() => {
    setHourHeight((prev) => prev + 15);
  }, [setHourHeight]);

  const zoomOut = useCallback(() => {
    setHourHeight((prev) => prev - 15);
  }, [setHourHeight]);

  const resetZoom = useCallback(() => {
    setHourHeight(DEFAULT_HOUR_HEIGHT);
  }, [setHourHeight]);

  const setPreset = useCallback(
    (preset: CalendarZoomPreset) => {
      setHourHeight(PRESET_HEIGHTS[preset]);
    },
    [setHourHeight]
  );

  const zoomPercent = Math.round((hourHeight / DEFAULT_HOUR_HEIGHT) * 100);

  let zoomLevel: CalendarZoomPreset = 'normal';
  if (hourHeight < 65) {
    zoomLevel = 'compact';
  } else if (hourHeight >= 120) {
    zoomLevel = 'detailed';
  }

  // Multi-Touch Pinch Gesture & Wheel Zoom on Container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let isPinching = false;
    let startDistance = 0;
    let startHeight = hourHeightRef.current;
    let anchorScrollRatio = 0.5;

    const getDistance = (t1: Touch, t2: Touch) => {
      return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        isPinching = true;
        startDistance = getDistance(e.touches[0], e.touches[1]);
        startHeight = hourHeightRef.current;

        // Simpan titik tengah vertikal untuk anchor scroll
        if (el.scrollHeight > 0) {
          anchorScrollRatio = (el.scrollTop + el.clientHeight / 2) / el.scrollHeight;
        }
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isPinching || e.touches.length !== 2) return;
      // Cegah default browser zoom
      e.preventDefault();

      const currentDistance = getDistance(e.touches[0], e.touches[1]);
      if (startDistance <= 0) return;

      const scale = currentDistance / startDistance;
      const targetHeight = Math.max(
        MIN_HOUR_HEIGHT,
        Math.min(MAX_HOUR_HEIGHT, Math.round(startHeight * scale))
      );

      if (targetHeight !== hourHeightRef.current) {
        setHourHeight(targetHeight);

        // Pertahankan fokus anchor vertikal
        requestAnimationFrame(() => {
          if (el) {
            const targetScrollTop = anchorScrollRatio * el.scrollHeight - el.clientHeight / 2;
            el.scrollTop = Math.max(0, targetScrollTop);
          }
        });
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        isPinching = false;
      }
    };

    // Desktop Ctrl + MouseWheel Zoom
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 10 : -10;
        setHourHeight((prev) => prev + delta);
      }
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    el.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('wheel', handleWheel);
    };
  }, [setHourHeight]);

  return {
    hourHeight,
    zoomPercent,
    zoomLevel,
    setHourHeight,
    zoomIn,
    zoomOut,
    resetZoom,
    setPreset,
    containerRef,
  };
}
