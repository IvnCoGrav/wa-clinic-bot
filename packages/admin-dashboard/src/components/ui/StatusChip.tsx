import React from 'react';
import { TONE_STYLES, toneChipClass, type StatusTone } from '../../lib/statusTones';

export type { StatusTone };

export interface StatusChipProps {
  tone: StatusTone;
  label: string;
  dot?: boolean;
  icon?: React.ReactNode;
  className?: string;
  title?: string;
}

export const StatusChip: React.FC<StatusChipProps> = ({
  tone,
  label,
  dot = true,
  icon,
  className = '',
  title,
}) => {
  const chipClass = toneChipClass(tone);
  const dotClass = (TONE_STYLES[tone] || TONE_STYLES.neutral).dot;

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 h-[22px] px-2.5 rounded-full border text-xs font-semibold select-none leading-none shrink-0 ${chipClass} ${className}`}
    >
      {icon ? (
        <span className="shrink-0">{icon}</span>
      ) : (
        dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
      )}
      <span className="truncate">{label}</span>
    </span>
  );
};
