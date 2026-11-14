import React from 'react';
import { Loader2, ArrowDown } from 'lucide-react';
import { pullToRefreshLabel, shouldTriggerRefresh } from '../../utils/pullToRefresh';

export interface PullToRefreshIndicatorProps {
  distance: number;
  isRefreshing: boolean;
  threshold?: number;
}

/**
 * Indikator visual pull-to-refresh — fixed di atas viewport, hanya tampil saat
 * pengguna menarik atau saat refresh berjalan.
 */
export const PullToRefreshIndicator: React.FC<PullToRefreshIndicatorProps> = ({
  distance,
  isRefreshing,
  threshold,
}) => {
  const visible = distance > 0 || isRefreshing;
  if (!visible) return null;
  const armed = shouldTriggerRefresh(distance, threshold);
  const label = pullToRefreshLabel(distance, isRefreshing, threshold);

  return (
    <div
      className="fixed inset-x-0 top-0 z-[70] flex justify-center pointer-events-none"
      style={{ transform: `translateY(${Math.min(distance, 88)}px)` }}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 rounded-full bg-surface border border-divider shadow-sm px-3 py-1.5 text-[11px] font-semibold text-ink-2">
        {isRefreshing ? (
          <Loader2 size={13} className="animate-spin text-accent" />
        ) : (
          <ArrowDown
            size={13}
            className={`transition-transform ${armed ? 'rotate-180 text-accent' : 'text-ink-3'}`}
          />
        )}
        <span>{label}</span>
      </div>
    </div>
  );
};
