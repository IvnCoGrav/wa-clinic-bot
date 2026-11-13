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
  /**
   * Satu layar hanya boleh punya satu angka fokus. `primary` dipakai untuk
   * kartu yang paling menentukan tindakan hari ini; sisanya `secondary` agar
   * mata tidak berebut perhatian.
   */
  emphasis?: 'primary' | 'secondary';
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
  emphasis = 'secondary',
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

  const isPrimary = emphasis === 'primary';

  return (
    <Card
      hoverable={hoverable}
      className={`p-4 sm:p-5 flex flex-col justify-between ${isPrimary ? 'ring-1 ring-accent/25' : ''} ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`font-semibold text-ink-2 truncate ${isPrimary ? 'text-[11px] uppercase tracking-wide' : 'text-xs'}`}
        >
          {label}
        </span>
        {icon && <span className="text-ink-3 shrink-0">{icon}</span>}
      </div>

      <div className="my-2.5">
        <div
          className={`font-extrabold text-ink num tracking-tight ${
            isPrimary ? 'text-3xl sm:text-4xl' : 'text-xl sm:text-2xl'
          }`}
        >
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
