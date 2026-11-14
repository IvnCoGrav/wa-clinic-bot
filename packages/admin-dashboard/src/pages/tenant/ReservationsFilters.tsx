/**
 * Toolbar filter Reservasi: tab status (mobile dan desktop), pilihan terapis,
 * dan kolom pencarian untuk tampilan tabel.
 */
import React from 'react';
import { Search, X } from 'lucide-react';
import { CalendarFilterState } from '../../components/calendar/types';

interface ReservationStats {
  total: number;
  upcoming: number;
  overdue: number;
  hold: number;
  confirmed: number;
  completed: number;
  cancelled: number;
}

interface ReservationsFiltersProps {
  viewMode: 'table' | 'day' | 'week' | 'month';
  status: CalendarFilterState['status'];
  staffId: string;
  searchQuery: string;
  stats: ReservationStats;
  archiveCount: number;
  staffList: Array<{ id: string; name: string; role?: string }>;
  onStatusChange: (status: CalendarFilterState['status']) => void;
  onStaffChange: (staffId: string) => void;
  onSearchChange: (query: string) => void;
}

export const ReservationsFilters: React.FC<ReservationsFiltersProps> = ({
  viewMode,
  status,
  staffId,
  searchQuery,
  stats,
  archiveCount,
  staffList,
  onStatusChange,
  onStaffChange,
  onSearchChange,
}) => {
  const tabs: Array<{ key: CalendarFilterState['status']; label: string; count: number; isAlert?: boolean }> = [
    { key: 'all', label: 'Semua', count: stats.total },
    { key: 'upcoming', label: '📅 Aktif & Mendatang', count: stats.upcoming },
    { key: 'overdue', label: '⚠️ Perlu Verifikasi', count: stats.overdue, isAlert: true },
    { key: 'hold', label: '⏳ Hold (Ditawarkan)', count: stats.hold },
    { key: 'confirmed', label: '📅 Terjadwal', count: stats.confirmed },
    { key: 'completed', label: 'Completed (Selesai)', count: stats.completed },
    { key: 'cancelled', label: 'Cancelled (Batal)', count: stats.cancelled },
    { key: 'archive', label: '🗄️ Arsip (60 Hari)', count: archiveCount },
  ];

  return (
    <div className="space-y-2.5">
      {/* Mobile Status & Staff Dropdowns */}
      <div className="flex sm:hidden items-center gap-2 w-full">
        <select
          value={status}
          onChange={(e) => onStatusChange(e.target.value as CalendarFilterState['status'])}
          className="flex-1 px-3 py-2 bg-surface border border-divider rounded-xl text-xs font-bold text-ink focus:outline-none focus:border-accent shadow-xs truncate"
        >
          <option value="all">Semua Status ({stats.total})</option>
          <option value="upcoming">Aktif &amp; Mendatang ({stats.upcoming})</option>
          <option value="overdue">Perlu Verifikasi ({stats.overdue})</option>
          <option value="hold">⏳ Hold / Ditawarkan ({stats.hold})</option>
          <option value="confirmed">Terjadwal ({stats.confirmed})</option>
          <option value="completed">Completed / Selesai ({stats.completed})</option>
          <option value="cancelled">Cancelled / Batal ({stats.cancelled})</option>
        </select>

        <select
          value={staffId}
          onChange={(e) => onStaffChange(e.target.value)}
          className="flex-1 px-3 py-2 bg-surface border border-divider rounded-xl text-xs font-bold text-ink focus:outline-none focus:border-accent shadow-xs truncate"
        >
          <option value="all">Semua Terapis</option>
          <option value="unassigned">Belum Ada Terapis</option>
          {staffList.map((st) => (
            <option key={st.id} value={st.id}>
              {st.name}
            </option>
          ))}
        </select>
      </div>

      {/* Desktop Status Tabs & Staff Dropdown */}
      <div className="hidden sm:flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-fill-1 rounded-2xl border border-transparent dark:border-divider">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => onStatusChange(tab.key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 cursor-pointer ${
                status === tab.key
                  ? tab.isAlert
                    ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700/50 shadow-xs'
                    : 'bg-surface text-ink shadow-xs'
                  : 'text-ink-2 hover:text-ink dark:hover:text-ink'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                  status === tab.key
                    ? tab.isAlert
                      ? 'bg-amber-200 dark:bg-amber-900/80 text-amber-900 dark:text-amber-100 font-bold'
                      : 'bg-accent-soft text-accent'
                    : tab.isAlert && tab.count > 0
                      ? 'bg-amber-200 dark:bg-amber-900/60 text-amber-800 dark:text-warning font-bold'
                      : 'bg-fill-2 text-ink-3'
                }`}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center">
          <select
            value={staffId}
            onChange={(e) => onStaffChange(e.target.value)}
            className="px-3 py-1.5 bg-surface border border-divider rounded-xl text-xs font-bold text-ink focus:outline-none focus:border-accent shadow-xs"
          >
            <option value="all">Semua Terapis</option>
            <option value="unassigned">Belum Ada Terapis</option>
            {staffList.map((st) => (
              <option key={st.id} value={st.id}>
                {st.name} ({st.role || 'Staff'})
              </option>
            ))}
          </select>
        </div>
      </div>

      {viewMode === 'table' && (
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Cari pasien, nomor telepon, atau jenis treatment..."
            className="w-full pl-9 pr-4 py-2.5 bg-surface border border-divider rounded-xl text-xs text-ink focus:outline-none focus:border-accent shadow-xs"
          />
          <Search size={14} className="absolute left-3 top-3 text-ink-3" />
          {searchQuery && (
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSearchChange('')}
              className="absolute right-3 top-3 text-ink-3 hover:text-ink"
              aria-label="Hapus pencarian"
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
