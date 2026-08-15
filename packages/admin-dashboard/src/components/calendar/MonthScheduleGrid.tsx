import React from 'react';
import { Reservation } from '../../types';
import { Plus, Clock } from 'lucide-react';
import { QuickSlotTarget } from './types';

interface MonthScheduleGridProps {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  reservations: Reservation[];
  onSelectReservation: (res: Reservation) => void;
  onQuickAdd: (target: QuickSlotTarget) => void;
}

export const MonthScheduleGrid: React.FC<MonthScheduleGridProps> = ({
  selectedDate,
  onSelectDate,
  reservations,
  onSelectReservation,
  onQuickAdd,
}) => {
  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();

  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);

  let firstDayIndex = firstDayOfMonth.getDay() - 1;
  if (firstDayIndex === -1) firstDayIndex = 6;

  const totalDays = lastDayOfMonth.getDate();
  const prevMonthLastDay = new Date(year, month, 0).getDate();

  const prevDays = [];
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    prevDays.push({
      date: new Date(year, month - 1, prevMonthLastDay - i),
      isCurrentMonth: false,
    });
  }

  const currentDays = [];
  for (let i = 1; i <= totalDays; i++) {
    currentDays.push({
      date: new Date(year, month, i),
      isCurrentMonth: true,
    });
  }

  const totalSlots = Math.ceil((prevDays.length + currentDays.length) / 7) * 7;
  const nextDaysCount = totalSlots - (prevDays.length + currentDays.length);
  const nextDays = [];
  for (let i = 1; i <= nextDaysCount; i++) {
    nextDays.push({
      date: new Date(year, month + 1, i),
      isCurrentMonth: false,
    });
  }

  const allCalendarDays = [...prevDays, ...currentDays, ...nextDays];

  const isSameDay = (d1: Date, d2: Date) => {
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  };

  const isToday = (d: Date) => isSameDay(d, new Date());

  const getEventsForDay = (date: Date) => {
    return reservations
      .filter((r) => {
        if (!r.booking_date) return false;
        const bDate = new Date(r.booking_date);
        return isSameDay(bDate, date);
      })
      .sort((a, b) => {
        const ta = a.booking_date ? new Date(a.booking_date).getTime() : 0;
        const tb = b.booking_date ? new Date(b.booking_date).getTime() : 0;
        return ta - tb;
      });
  };

  const dayLabels = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];

  const getCategoryColor = (cat: string) => {
    switch (cat) {
      case 'MOMS':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'BOTH':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'KIDS':
        return 'bg-teal-100 text-teal-800 border-teal-200';
      case 'BUNDLE':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'BABY':
      default:
        return 'bg-sky-100 text-sky-800 border-sky-200';
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-[#e9edef] shadow-xs overflow-hidden">
      {/* Day header */}
      <div className="grid grid-cols-7 border-b border-[#e9edef] bg-[#fafafa] text-center text-xs font-bold text-[#54656f] py-2.5">
        {dayLabels.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>

      {/* Days Grid */}
      <div className="grid grid-cols-7 divide-x divide-y divide-[#e9edef]">
        {allCalendarDays.map((item, idx) => {
          const events = getEventsForDay(item.date);
          const isSelected = isSameDay(item.date, selectedDate);
          const currentDay = isToday(item.date);

          return (
            <div
              key={idx}
              onClick={() => onSelectDate(item.date)}
              className={`min-h-[110px] sm:min-h-[130px] p-2 relative flex flex-col justify-between transition-colors group ${
                isSelected
                  ? 'bg-emerald-50/30'
                  : item.isCurrentMonth
                  ? 'bg-white hover:bg-[#fafafa]'
                  : 'bg-gray-50/60 text-gray-400'
              }`}
            >
              {/* Date number header */}
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${
                    currentDay
                      ? 'bg-[#008069] text-white'
                      : isSelected
                      ? 'bg-[#111b21] text-white'
                      : item.isCurrentMonth
                      ? 'text-[#111b21]'
                      : 'text-gray-400'
                  }`}
                >
                  {item.date.getDate()}
                </span>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onQuickAdd({ date: item.date, hour: 9 });
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-[#008069] hover:text-white text-[#8696a0] transition-all"
                  title="Tambah Jadwal"
                >
                  <Plus size={13} />
                </button>
              </div>

              {/* Event pills */}
              <div className="space-y-1 my-1 overflow-y-auto max-h-[80px]">
                {events.slice(0, 3).map((res) => {
                  const bDate = new Date(res.booking_date!);
                  const timeStr = bDate
                    .toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false })
                    .replace('.', ':');
                  const catColor = getCategoryColor(res.treatment_category);

                  return (
                    <div
                      key={res.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectReservation(res);
                      }}
                      className={`px-1.5 py-0.5 rounded-md text-[10px] font-semibold truncate border cursor-pointer hover:shadow-xs transition-all flex items-center space-x-1 ${catColor}`}
                      title={`${res.customer?.name || 'Bunda'} - ${res.treatment_detail} (${timeStr})`}
                    >
                      <Clock size={9} className="flex-shrink-0 opacity-70" />
                      <span className="truncate">{timeStr} {res.customer?.name || 'Bunda'}</span>
                    </div>
                  );
                })}
                {events.length > 3 && (
                  <span className="block text-[9px] text-[#008069] font-bold px-1">
                    +{events.length - 3} lainnya
                  </span>
                )}
              </div>

              <div />
            </div>
          );
        })}
      </div>
    </div>
  );
};
