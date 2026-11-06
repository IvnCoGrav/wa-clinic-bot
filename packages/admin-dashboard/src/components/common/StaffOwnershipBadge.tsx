import React from 'react';
import { Crown } from 'lucide-react';
import {
  formatOwnershipDate,
  resolveOwnershipBadge,
} from '../../utils/staffOwnershipBadge';
import type { OwnershipTone, StaffOwnership } from '../../utils/staffOwnershipBadge';

const TONE_CLASS: Record<OwnershipTone, string> = {
  violet:
    'bg-violet-100 dark:bg-violet-950/60 text-violet-800 dark:text-ink-2 ring-violet-300 dark:ring-divider',
  amber:
    'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-warning ring-amber-300 dark:ring-amber-800/40',
  gray: 'bg-fill-1 text-ink-2 ring-divider',
  neutral: 'bg-fill-1 text-ink-3 ring-divider',
};

interface Props {
  ownership?: StaffOwnership | null;
  variant?: 'chip' | 'banner';
  showNew?: boolean;
  className?: string;
}

export const StaffOwnershipBadge: React.FC<Props> = ({
  ownership,
  variant = 'chip',
  showNew = false,
  className = '',
}) => {
  const model = resolveOwnershipBadge(ownership, {
    compact: variant === 'chip',
    showNew,
  });
  if (!model.show) return null;

  if (variant === 'banner') {
    const since = formatOwnershipDate(ownership?.ownerSince);
    const lastDate = formatOwnershipDate(ownership?.lastVisitDate);
    const ownerName = ownership?.ownerStaffName || 'Bidan pemilik';
    const lastLine = ownership?.hasRotation && ownership?.lastStaffName
      ? `Terakhir ditangani ${ownership.lastStaffName} (${lastDate})`
      : `${ownership?.totalVisits ?? 0} kunjungan`;
    return (
      <div
        className={`flex items-start gap-2 rounded-xl border border-divider bg-surface-2 px-3 py-2.5 ${className}`}
        title={model.tooltip}
      >
        <span className={`mt-0.5 inline-flex items-center justify-center rounded-full p-1 ring-1 ${TONE_CLASS[model.tone]}`}>
          <Crown size={12} />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-ink truncate">
            Customer milik {ownerName}
          </p>
          <p className="text-[10px] text-ink-2">
            sejak {since} · {lastLine}
          </p>
        </div>
      </div>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold ring-1 shadow-2xs shrink-0 ${TONE_CLASS[model.tone]} ${className}`}
      title={model.tooltip}
      aria-label={model.tooltip}
    >
      <Crown size={9} className="shrink-0" />
      <span className="truncate max-w-[110px]">{model.label}</span>
    </span>
  );
};
