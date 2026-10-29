import React from 'react';
import { getStaffColor, shortStaffLabel } from '../../utils/staffColors';

interface StaffColorLegendProps {
  staffList?: Array<{ id: string; name: string }> | null;
  className?: string;
}

/**
 * Legenda "bidan → warna" untuk view kalender.
 *
 * Tanpa legenda, warna per bidan hanya berarti bagi orang yang sudah hafal
 * urutannya. Komponen ini sengaja ringkas (satu baris, bisa digeser) agar
 * tidak memakan tinggi layar HP.
 */
export const StaffColorLegend: React.FC<StaffColorLegendProps> = ({ staffList, className = '' }) => {
  const staff = (staffList || []).filter((s) => s && s.id && s.name);
  if (staff.length === 0) return null;

  return (
    <div
      data-horizontal-scroll="true"
      data-no-swipe-back="true"
      className={`flex items-center gap-2.5 overflow-x-auto no-scrollbar px-2 py-1 bg-[#fafafa] dark:bg-[#111b21] border-b border-[#e9edef] dark:border-[#2a3942] ${className}`}
      style={{ scrollbarWidth: 'none' }}
      aria-label="Legenda warna bidan"
    >
      <span className="text-[10px] font-bold uppercase tracking-wide text-[#8696a0] dark:text-[#8696a0] shrink-0">
        Bidan
      </span>
      {staff.map((s) => {
        const color = getStaffColor(s.id, staffList);
        return (
          <span
            key={s.id}
            className="inline-flex items-center gap-1 shrink-0 text-[10px] font-semibold text-[#54656f] dark:text-[#aebac1]"
            title={s.name}
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${color.dot}`} aria-hidden="true" />
            <span className="truncate max-w-[72px]">{shortStaffLabel(s.name)}</span>
          </span>
        );
      })}
    </div>
  );
};
