import React from 'react';
import { Check, Loader2, RefreshCw } from 'lucide-react';
import {
  PULL_MAX_PX,
  pullToRefreshAriaLabel,
  type PullPhase,
} from '../../utils/pullToRefresh';

export interface PullToRefreshIndicatorProps {
  distance: number;
  progress: number;
  phase: PullPhase;
  isDragging: boolean;
}

/**
 * Indikator pull-to-refresh — hanya ikon (tanpa teks):
 * - menarik: ikon reload berputar mengikuti progress
 * - siap: ikon berputar penuh + warna aksen
 * - memuat: ikon berputar terus
 * - selesai: centang singkat (tanda data sudah diperbarui)
 */
export const PullToRefreshIndicator: React.FC<PullToRefreshIndicatorProps> = ({
  distance,
  progress,
  phase,
  isDragging,
}) => {
  if (phase === 'idle') return null;

  const visibleDistance = Math.min(distance, PULL_MAX_PX * 0.75);
  const translateY = phase === 'done' ? 0 : Math.max(0, visibleDistance - 28);
  const iconRotation = phase === 'armed' ? 180 : Math.round(progress * 180);

  return (
    <div
      className="fixed inset-x-0 top-0 z-[70] flex justify-center pointer-events-none"
      style={{
        transform: `translateY(${translateY}px)`,
        transition: isDragging ? 'none' : 'transform 240ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
      role="status"
      aria-live="polite"
      aria-label={pullToRefreshAriaLabel(phase)}
    >
      <div
        className={`flex h-9 w-9 items-center justify-center rounded-full border shadow-sm transition-colors duration-200 ${
          phase === 'done'
            ? 'bg-success-soft border-success-line text-success scale-100'
            : phase === 'armed' || phase === 'refreshing'
              ? 'bg-accent text-on-solid border-accent'
              : 'bg-surface border-divider text-accent'
        }`}
        style={{
          transform: `scale(${phase === 'pulling' ? 0.85 + progress * 0.15 : 1})`,
          transition: isDragging ? 'none' : 'transform 240ms cubic-bezier(0.22, 1, 0.36, 1), background-color 200ms ease',
        }}
      >
        {phase === 'done' ? (
          <Check size={16} />
        ) : phase === 'refreshing' ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <RefreshCw
            size={16}
            style={{
              transform: `rotate(${iconRotation}deg)`,
              transition: isDragging ? 'none' : 'transform 180ms ease-out',
            }}
          />
        )}
      </div>
    </div>
  );
};
