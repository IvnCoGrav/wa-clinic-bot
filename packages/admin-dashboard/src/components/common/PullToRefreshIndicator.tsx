import React from 'react';
import { Check, Loader2, RefreshCw } from 'lucide-react';
import { pullToRefreshAriaLabel, type PullPhase } from '../../utils/pullToRefresh';

export interface PullToRefreshIndicatorProps {
  phase: PullPhase;
}

export const PullToRefreshIndicator = React.forwardRef<HTMLDivElement, PullToRefreshIndicatorProps>(
  ({ phase }, ref) => (
    <div
      ref={ref}
      data-ptr-phase={phase}
      className="ptr-indicator fixed inset-x-0 top-0 z-[70] flex justify-center pointer-events-none"
      role="status"
      aria-live="polite"
      aria-label={pullToRefreshAriaLabel(phase)}
    >
      <div
        className={`ptr-indicator__pill flex h-9 w-9 items-center justify-center rounded-full border shadow-sm transition-colors duration-200 ${
          phase === 'done'
            ? 'bg-success-soft border-success-line text-success'
            : phase === 'armed' || phase === 'refreshing'
              ? 'bg-accent text-on-solid border-accent'
              : 'bg-surface border-divider text-accent'
        }`}
      >
        {phase === 'done' ? (
          <Check size={16} />
        ) : phase === 'refreshing' ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <RefreshCw size={16} className="ptr-indicator__icon" />
        )}
      </div>
    </div>
  ),
);
PullToRefreshIndicator.displayName = 'PullToRefreshIndicator';
