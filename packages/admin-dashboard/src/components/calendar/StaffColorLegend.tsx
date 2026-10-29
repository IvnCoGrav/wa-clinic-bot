import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { filterActiveStaff, getStaffColor } from '../../utils/staffColors';
import { staffDisplayName } from '../../utils/resolveStaffName';

interface StaffColorLegendProps {
  staffList?: Array<{ id: string; name: string; active?: boolean | null }> | null;
  className?: string;
}

/**
 * Legenda "bidan → warna" untuk view kalender.
 *
 * F-34: sebelumnya legenda selalu terbuka dan memakan tinggi layar HP secara
 * permanen (6 bidan = 2 baris). Kini berbentuk dropdown yang **default tertutup**:
 * baris tertutup hanya menampilkan 4 titik warna sebagai pratinjau.
 *
 * F-31: label memakai `staffDisplayName()` sehingga yang tampil "Hanifah",
 * bukan "Bidan" (dulu `split(' ')[0]` memotong gelar, bukan nama).
 *
 * F-35: hanya bidan **aktif** yang ditampilkan (`filterActiveStaff`). Warna tetap
 * dihitung dari daftar penuh agar identik dengan warna kartu kalender.
 *
 * Sengaja memakai pola toggle yang sudah dipakai dashboard (`useState(false)` +
 * `ChevronDown`/`ChevronUp`) — tidak ada dependency atau komponen baru.
 */
export const StaffColorLegend: React.FC<StaffColorLegendProps> = ({ staffList, className = '' }) => {
  const [open, setOpen] = useState(false);

  const staff = filterActiveStaff((staffList || []).filter((s) => s && s.id && s.name));
  if (staff.length === 0) return null;

  const preview = staff.slice(0, 4);
  const panelId = 'staff-color-legend-panel';

  return (
    <div
      data-no-swipe-back="true"
      className={`bg-surface-2 border-b border-divider ${className}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="w-full h-7 px-2 flex items-center gap-1.5 text-left"
      >
        <span className="text-[10px] font-bold uppercase tracking-wide text-ink-3 shrink-0">
          Warna Bidan
        </span>

        {/* Pratinjau warna saat tertutup — cukup 4 titik, hemat ruang. */}
        <span className="flex items-center gap-1 shrink-0" aria-hidden="true">
          {preview.map((s) => (
            <span
              key={s.id}
              className={`w-2 h-2 rounded-full shrink-0 ${getStaffColor(s.id, staffList).dot}`}
            />
          ))}
          {staff.length > preview.length && (
            <span className="text-[9px] font-bold text-ink-3">+{staff.length - preview.length}</span>
          )}
        </span>

        <span className="flex-1" />
        {open ? (
          <ChevronUp size={12} className="text-ink-3 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronDown size={12} className="text-ink-3 shrink-0" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div
          id={panelId}
          aria-label="Legenda warna bidan"
          className="px-2 pb-1.5 pt-0.5 flex flex-wrap gap-x-3 gap-y-1"
        >
          {staff.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 shrink-0 text-[10px] font-semibold text-ink-2"
              title={s.name}
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${getStaffColor(s.id, staffList).dot}`}
                aria-hidden="true"
              />
              <span className="truncate max-w-[110px]">{staffDisplayName(s.name)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
