import React from 'react';
import { Reservation } from '../../types';
import { MiniMonthCalendar } from './MiniMonthCalendar';
import { UpcomingSpotlightCard } from './UpcomingSpotlightCard';
import { CalendarFilterState, StaffOption } from './types';
import { Users, Filter } from 'lucide-react';

interface CalendarSidebarProps {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  reservations: Reservation[];
  filterState: CalendarFilterState;
  onFilterChange: (updater: (prev: CalendarFilterState) => CalendarFilterState) => void;
  staffList: StaffOption[];
  onSelectReservation: (res: Reservation) => void;
}

export const CalendarSidebar: React.FC<CalendarSidebarProps> = ({
  selectedDate,
  onSelectDate,
  reservations,
  filterState,
  onFilterChange,
  staffList,
  onSelectReservation,
}) => {
  // Category counts
  const categoryCounts = reservations.reduce(
    (acc, r) => {
      const cat = r.treatment_category;
      acc[cat] = (acc[cat] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const categories = [
    { key: 'all', label: 'Semua Kategori', color: 'bg-gray-400', count: reservations.length },
    { key: 'BABY', label: 'Baby Treatment', color: 'bg-sky-400', count: categoryCounts['BABY'] || 0 },
    { key: 'MOMS', label: 'Moms Treatment', color: 'bg-purple-400', count: categoryCounts['MOMS'] || 0 },
    { key: 'BOTH', label: 'Moms & Baby / Both', color: 'bg-emerald-400', count: categoryCounts['BOTH'] || 0 },
  ];

  return (
    <div className="space-y-4 w-full">
      {/* Mini Calendar Widget */}
      <MiniMonthCalendar
        selectedDate={selectedDate}
        onSelectDate={onSelectDate}
        reservations={reservations}
      />

      {/* Upcoming Spotlight Card */}
      <UpcomingSpotlightCard
        reservations={reservations}
        onSelectReservation={onSelectReservation}
      />

      {/* Categories & Filter Card */}
      <div className="bg-white rounded-2xl p-4 border border-[#e9edef] shadow-xs space-y-4">
        {/* Category Filters */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-[#111b21]">
            <span className="flex items-center space-x-1.5">
              <Filter size={13} className="text-[#008069]" />
              <span>Kategori Layanan</span>
            </span>
          </div>
          <div className="space-y-1">
            {categories.map((cat) => {
              const active = filterState.category === cat.key;
              return (
                <button
                  key={cat.key}
                  onClick={() =>
                    onFilterChange((prev) => ({
                      ...prev,
                      category: cat.key as any,
                    }))
                  }
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs transition-all ${
                    active
                      ? 'bg-[#e8f5f2] text-[#008069] font-bold border border-[#c2e7e0]'
                      : 'text-[#54656f] hover:bg-[#f0f2f5] hover:text-[#111b21]'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${cat.color}`} />
                    <span>{cat.label}</span>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[#f0f2f5] text-[#667781] font-semibold">
                    {cat.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Staff Filter */}
        <div className="pt-3 border-t border-[#e9edef] space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-[#111b21]">
            <span className="flex items-center space-x-1.5">
              <Users size={13} className="text-[#008069]" />
              <span>Filter Terapis / Staff</span>
            </span>
          </div>
          <select
            value={filterState.staffId}
            onChange={(e) =>
              onFilterChange((prev) => ({ ...prev, staffId: e.target.value }))
            }
            className="w-full p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
          >
            <option value="all">Semua Terapis ({staffList.length})</option>
            {staffList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {s.active === false ? '(Nonaktif)' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Status Filter Pills */}
        <div className="pt-3 border-t border-[#e9edef] space-y-2">
          <span className="text-[11px] font-bold text-[#667781] uppercase tracking-wider block">
            Status Reservasi
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { key: 'all', label: 'Semua' },
              { key: 'confirmed', label: 'Confirmed' },
              { key: 'pending', label: 'Pending' },
              { key: 'completed', label: 'Completed' },
            ].map((st) => (
              <button
                key={st.key}
                onClick={() =>
                  onFilterChange((prev) => ({ ...prev, status: st.key as any }))
                }
                className={`px-2 py-1.5 rounded-lg text-xs font-semibold text-center border transition-all ${
                  filterState.status === st.key
                    ? 'bg-[#e8f5f2] border-[#008069] text-[#008069] font-bold'
                    : 'border-[#d1d7db] text-[#54656f] hover:bg-[#f0f2f5]'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
