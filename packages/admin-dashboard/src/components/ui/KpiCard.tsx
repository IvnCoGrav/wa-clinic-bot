import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Card } from './Card';

export type DeltaPolarity = 'up-good' | 'up-bad' | 'neutral';

export interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
  delta?: {
    value: string | number;
    direction: 'up' | 'down' | 'flat';
    label?: string;
  };
  polarity?: DeltaPolarity;
  icon?: React.ReactNode;
  sparkline?: React.ReactNode;
  className?: string;
  hoverable?: boolean;
}

export const KpiCard: React.FC<KpiCardProps> = ({
  label,
  value,
  hint,
  delta,
  polarity = 'up-good',
  icon,
  sparkline,
  className = '',
  hoverable = false,
}) => {
  const resolveDeltaStyle = () => {
    if (!delta || delta.direction === 'flat' || polarity === 'neutral') {
      return {
        chip: 'bg-neutral-soft text-neutral border-divider',
        icon: <Minus size={11} />,
      };
    }

    const isGood =
      (polarity === 'up-good' && delta.direction === 'up') ||
      (polarity === 'up-bad' && delta.direction === 'down');

    if (isGood) {
      return {
        chip: 'bg-success-soft text-success border-success-line',
        icon: delta.direction === 'up' ? <TrendingUp size={11} /> : <TrendingDown size={11} />,
      };
    } else {
      return {
        chip: 'bg-danger-soft text-danger border-danger-line',
        icon: delta.direction === 'up' ? <TrendingUp size={11} /> : <TrendingDown size={11} />,
      };
    }
  };

  const deltaStyle = resolveDeltaStyle();

  return (
    <Card hoverable={hoverable} className={`p-4 sm:p-5 flex flex-col justify-between ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ink-2 truncate">{label}</span>
        {icon && <span className="text-ink-3 shrink-0">{icon}</span>}
      </div>

      <div className="my-2.5">
        <div className="text-2xl sm:text-3xl font-extrabold text-ink num tracking-tight">
          {value}
        </div>
      </div>

      {(delta || hint || sparkline) && (
        <div className="flex items-center justify-between gap-2 pt-1 text-[11px]">
          {delta && (
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold num ${deltaStyle.chip}`}
            >
              {deltaStyle.icon}
              <span>{delta.value}</span>
              {delta.label && <span className="text-ink-3 font-normal ml-0.5">{delta.label}</span>}
            </span>
          )}
          {sparkline && <div className="shrink-0">{sparkline}</div>}
          {hint && !delta && <span className="text-ink-3 truncate">{hint}</span>}
        </div>
      )}
    </Card>
  );
};
