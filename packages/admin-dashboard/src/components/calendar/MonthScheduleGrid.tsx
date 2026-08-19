import React from 'react';
import { Reservation } from '../../types';
import { QuickSlotTarget } from './types';

interface MonthScheduleGridProps {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  reservations: Reservation[];
  onSelectReservation?: (res: Reservation) => void;
  onQuickAdd?: (target: QuickSlotTarget) => void;
}

export const MonthScheduleGrid: React.FC<MonthScheduleGridProps> = ({
  selectedDate,
  onSelectDate,
  reservations,
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
      {/* Weekday Header */}
      <div className="grid grid-cols-7 border-b border-[#e9edef] bg-[#fafafa]">
        {dayLabels.map((day, idx) => (
          <div
            key={idx}
            className="p-2 sm:p-3 text-center text-[11px] font-bold text-[#667781] uppercase tracking-wider border-r border-[#e9edef] last:border-r-0"
          >
            <span className="hidden sm:inline">{day}</span>
            <span className="inline sm:hidden">{day.slice(0, 3)}</span>
          </div>
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
              className={`min-h-[105px] sm:min-h-[125px] p-1.5 sm:p-2 relative flex flex-col justify-start gap-1 transition-colors cursor-pointer select-none group ${
                isSelected
                  ? 'bg-emerald-50/30 ring-1 ring-[#008069]'
                  : item.isCurrentMonth
                  ? 'bg-white hover:bg-[#fafafa]'
                  : 'bg-gray-50/60 text-gray-400'
              }`}
            >
              {/* Date number header */}
              <div className="flex items-center justify-between w-full">
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
                {events.length > 0 && (
                  <span className={`text-[10px] font-bold font-mono ${
                    currentDay ? 'text-[#008069]' : isSelected ? 'text-[#111b21]' : 'text-[#667781]'
                  }`}>
                    {events.length}
                  </span>
                )}
              </div>

              {/* Event pills (Full-width, pure static labels, no buttons, no icons) */}
              <div className="space-y-1 w-full overflow-hidden flex-1">
                {events.slice(0, 3).map((res) => {
                  const bDate = new Date(res.booking_date!);
                  const timeStr = bDate
                    .toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false })
                    .replace('.', ':');
                  const catColor = getCategoryColor(res.treatment_category);
                  const nameDisplay = res.customer?.name || 'Bunda';

                  return (
                    <div
                      key={res.id}
                      className={`w-full px-1.5 py-0.5 rounded text-[9.5px] sm:text-[10.5px] font-semibold truncate border block leading-tight ${catColor}`}
                      title={`${nameDisplay} - ${res.treatment_detail || res.treatment_category} (${timeStr})`}
                    >
                      <span className="truncate block font-medium">
                        {timeStr} {nameDisplay}
                      </span>
                    </div>
                  );
                })}
                {events.length > 3 && (
                  <div className="w-full text-center text-[9px] text-[#008069] font-bold pt-0.5 truncate">
                    +{events.length - 3} lainnya
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
