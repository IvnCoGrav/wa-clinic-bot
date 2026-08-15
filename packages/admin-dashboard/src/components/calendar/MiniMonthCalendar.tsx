import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Reservation } from '../../types';

interface MiniMonthCalendarProps {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  reservations: Reservation[];
}

export const MiniMonthCalendar: React.FC<MiniMonthCalendarProps> = ({
  selectedDate,
  onSelectDate,
  reservations,
}) => {
  const [viewDate, setViewDate] = useState<Date>(new Date(selectedDate));

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const prevMonth = () => {
    setViewDate(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setViewDate(new Date(year, month + 1, 1));
  };

  // Month name
  const monthName = viewDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

  // Compute days in month
  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);

  // Day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
  // Let's adjust so Monday is first (0) and Sunday is last (6)
  let firstDayIndex = firstDayOfMonth.getDay() - 1;
  if (firstDayIndex === -1) firstDayIndex = 6;

  const totalDays = lastDayOfMonth.getDate();

  // Previous month trailing days
  const prevMonthLastDay = new Date(year, month, 0).getDate();
  const prevDays = [];
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    prevDays.push({
      date: new Date(year, month - 1, prevMonthLastDay - i),
      isCurrentMonth: false,
    });
  }

  // Current month days
  const currentDays = [];
  for (let i = 1; i <= totalDays; i++) {
    currentDays.push({
      date: new Date(year, month, i),
      isCurrentMonth: true,
    });
  }

  // Next month leading days
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

  // Set of dates with reservations
  const datesWithBookings = new Set<string>();
  reservations.forEach((r) => {
    if (r.booking_date) {
      const d = new Date(r.booking_date);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      datesWithBookings.add(key);
    }
  });

  const isSameDay = (d1: Date, d2: Date) => {
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  };

  const isToday = (d: Date) => isSameDay(d, new Date());

  const dayHeaders = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

  return (
    <div className="bg-[#111b21] text-white rounded-2xl p-4 shadow-lg border border-[#202c33] select-none">
      {/* Month Navigation */}
      <div className="flex items-center justify-between mb-3 px-1">
        <h4 className="font-bold text-sm text-gray-100 capitalize">{monthName}</h4>
        <div className="flex items-center space-x-1">
          <button
            onClick={prevMonth}
            className="p-1 rounded-lg hover:bg-[#202c33] text-gray-400 hover:text-white transition-colors"
            title="Bulan Sebelumnya"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={nextMonth}
            className="p-1 rounded-lg hover:bg-[#202c33] text-gray-400 hover:text-white transition-colors"
            title="Bulan Berikutnya"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Week Day Labels */}
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-[#8696a0] mb-2">
        {dayHeaders.map((day, idx) => (
          <div key={idx} className="py-0.5">
            {day}
          </div>
        ))}
      </div>

      {/* Days Grid */}
      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {allCalendarDays.map((item, idx) => {
          const isSelected = isSameDay(item.date, selectedDate);
          const hasBooking = datesWithBookings.has(
            `${item.date.getFullYear()}-${item.date.getMonth()}-${item.date.getDate()}`
          );
          const currentDay = isToday(item.date);

          return (
            <button
              key={idx}
              onClick={() => onSelectDate(item.date)}
              className={`relative flex flex-col items-center justify-center h-8 w-8 mx-auto rounded-xl transition-all ${
                isSelected
                  ? 'bg-[#00a884] text-white font-bold shadow-sm'
                  : currentDay
                  ? 'border border-[#00a884] text-[#00a884] font-semibold hover:bg-[#202c33]'
                  : item.isCurrentMonth
                  ? 'text-gray-200 hover:bg-[#202c33]'
                  : 'text-gray-600 hover:bg-[#1a242a]'
              }`}
            >
              <span className="text-[11px]">{item.date.getDate()}</span>
              {hasBooking && !isSelected && (
                <span className="absolute bottom-1 w-1 h-1 rounded-full bg-[#00a884]" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
