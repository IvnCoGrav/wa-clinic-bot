/**
 * Header halaman Reservasi: judul periode, navigasi tanggal, pemilih mode
 * tampilan, tombol buat jadwal, dan muat ulang.
 */
import React from 'react';
import {
  Calendar as CalendarIcon,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Columns,
  LayoutGrid,
  ListFilter,
  RefreshCw,
} from 'lucide-react';
import { getWibDateKey } from '../../utils/dateWib';
import { CalendarViewMode } from '../../components/calendar/types';
import { VIEW_MODE_OPTIONS } from '../../utils/calendarViewMode';

const VIEW_MODE_ICONS: Record<CalendarViewMode, React.ReactNode> = {
  table: <ListFilter size={13} />,
  day: <LayoutGrid size={13} />,
  week: <Columns size={13} />,
  month: <CalendarDays size={13} />,
};

interface ReservationsHeaderProps {
  title: string;
  viewMode: CalendarViewMode;
  selectedDate: Date;
  loading: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onDateChange: (date: Date) => void;
  onViewModeChange: (mode: CalendarViewMode) => void;
  onCreate: () => void;
  onRefresh: () => void;
}

export const ReservationsHeader: React.FC<ReservationsHeaderProps> = ({
  title,
  viewMode,
  selectedDate,
  loading,
  onPrev,
  onNext,
  onToday,
  onDateChange,
  onViewModeChange,
  onCreate,
  onRefresh,
}) => (
  <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 bg-surface p-3.5 sm:p-4 rounded-2xl border border-divider shadow-xs">
    <div className="flex flex-wrap items-center gap-3">
      <div>
        <div className="flex items-center space-x-2">
          <h1 className="text-lg sm:text-xl font-black tracking-tight text-ink capitalize">{title}</h1>

          {viewMode !== 'table' && (
            <div
              className={`flex items-center space-x-1 bg-fill-1 p-0.5 rounded-lg border border-divider ${
                viewMode === 'day' ? 'hidden sm:flex' : ''
              }`}
            >
              <button
                aria-label="Sebelumnya"
                onClick={onPrev}
                className="p-1 rounded-md bg-surface hover:bg-gray-100 dark:hover:bg-fill-2 text-ink shadow-2xs transition-colors cursor-pointer"
                title="Sebelumnya"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={onToday}
                className="px-2 py-0.5 rounded-md bg-surface hover:bg-gray-100 dark:hover:bg-fill-2 text-[11px] font-bold text-ink shadow-2xs transition-colors cursor-pointer whitespace-nowrap"
              >
                {viewMode === 'week' ? 'Minggu Ini' : viewMode === 'month' ? 'Bulan Ini' : 'Hari Ini'}
              </button>
              <button
                aria-label="Berikutnya"
                onClick={onNext}
                className="p-1 rounded-md bg-surface hover:bg-gray-100 dark:hover:bg-fill-2 text-ink shadow-2xs transition-colors cursor-pointer"
                title="Berikutnya"
              >
                <ChevronRight size={14} />
              </button>
              <div className="relative flex items-center">
                <input
                  type="date"
                  value={getWibDateKey(selectedDate)}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const [y, m, d] = e.target.value.split('-').map(Number);
                    onDateChange(new Date(y, m - 1, d));
                  }}
                  className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10"
                  title="Pilih Tanggal Spesifik"
                />
                <button
                  aria-label="Pilih Tanggal Spesifik"
                  type="button"
                  className="p-1 rounded-md bg-surface hover:bg-accent-soft dark:hover:bg-fill-2 text-ink-2 hover:text-accent shadow-2xs transition-colors cursor-pointer"
                  title="Pilih Tanggal Spesifik"
                >
                  <CalendarIcon size={13} />
                </button>
              </div>
            </div>
          )}
        </div>
        <p className="text-[11px] text-ink-3 mt-0.5">Jadwal Reservasi</p>
      </div>
    </div>

    <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto justify-between lg:justify-end">
      <div className="block sm:hidden flex-1 min-w-[110px]">
        <select
          value={viewMode}
          onChange={(e) => onViewModeChange(e.target.value as CalendarViewMode)}
          className="w-full px-3 py-2 bg-surface border border-divider rounded-xl text-xs font-bold text-ink focus:outline-none focus:border-accent shadow-xs"
        >
          {VIEW_MODE_OPTIONS.map((opt) => (
            <option key={opt.mode} value={opt.mode}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="hidden sm:flex space-x-1 p-1 bg-fill-1 rounded-xl shadow-inner text-xs border border-transparent dark:border-divider">
        {VIEW_MODE_OPTIONS.map((opt) => {
          const active = viewMode === opt.mode;
          return (
            <button
              key={opt.mode}
              type="button"
              onClick={() => onViewModeChange(opt.mode)}
              className={`flex items-center space-x-1 py-1.5 px-3 rounded-lg font-bold transition cursor-pointer ${
                active ? 'bg-surface text-ink shadow-xs' : 'text-ink-2 hover:text-ink dark:hover:text-ink'
              }`}
            >
              {VIEW_MODE_ICONS[opt.mode]}
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center space-x-2">
        <button
          onClick={onCreate}
          className="flex items-center space-x-1.5 px-3.5 py-2 bg-accent hover:bg-accent rounded-xl text-xs font-semibold text-on-solid transition-colors shadow-xs"
        >
          <CalendarIcon size={14} />
          <span>+ Buat Jadwal</span>
        </button>
        <button
          onClick={onRefresh}
          className="p-2 bg-surface hover:bg-fill-1 border border-divider rounded-xl text-ink transition-colors shadow-xs"
          title="Reload Data"
          aria-label="Muat ulang data reservasi"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin text-accent' : 'text-ink-3'} />
        </button>
      </div>
    </div>
  </div>
);
