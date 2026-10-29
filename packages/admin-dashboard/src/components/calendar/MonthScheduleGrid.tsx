import React from 'react';
import { Reservation } from '../../types';
import { QuickSlotTarget, StaffOption } from './types';
import { resolveReservationDuration } from '../../utils/durationCalculator';
import { getWibDateKey, getTodayWibDateKey } from '../../utils/dateWib';
import { resolveStaffId } from '../../utils/resolveStaffName';
import { getStaffColor } from '../../utils/staffColors';
import { stripHonorific } from '../../utils/patientName';

interface MonthScheduleGridProps {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  reservations: Reservation[];
  onSelectReservation?: (res: Reservation) => void;
  onQuickAdd?: (target: QuickSlotTarget) => void;
  /** Daftar bidan tenant — sumber warna pill. */
  staffList?: StaffOption[];
}

export const MonthScheduleGrid: React.FC<MonthScheduleGridProps> = ({
  selectedDate,
  onSelectDate,
  reservations,
  staffList = [],
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
    return getWibDateKey(d1) === getWibDateKey(d2);
  };

  const isToday = (d: Date) => getWibDateKey(d) === getTodayWibDateKey();

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

  return (
    <div className="bg-surface rounded-none border-y border-x-0 border-divider shadow-xs sm:rounded-2xl sm:border-x overflow-hidden">
      {/* Weekday Header */}
      <div className="grid grid-cols-7 border-b border-divider bg-surface-2">
        {dayLabels.map((day, idx) => (
          <div
            key={idx}
            className="p-2 sm:p-3 text-center text-[11px] font-bold text-ink-3 uppercase tracking-wider border-r border-divider last:border-r-0"
          >
            <span className="hidden sm:inline">{day}</span>
            <span className="inline sm:hidden">{day.slice(0, 3)}</span>
          </div>
        ))}
      </div>

      {/* Days Grid */}
      <div className="grid grid-cols-7 divide-x divide-y divide-divider">
        {allCalendarDays.map((item, idx) => {
          const events = getEventsForDay(item.date);
          const isSelected = isSameDay(item.date, selectedDate);
          const currentDay = isToday(item.date);

          return (
            <div
              key={idx}
              onClick={() => onSelectDate(item.date)}
              className={`min-h-[96px] sm:min-h-[120px] p-0.5 sm:p-1.5 relative flex flex-col justify-start gap-0.5 sm:gap-1 transition-colors cursor-pointer select-none group ${
                isSelected
                  ? 'bg-accent-soft/30 ring-1 ring-accent'
                  : item.isCurrentMonth
                  ? 'bg-surface hover:bg-fill-1'
                  : 'bg-app/50 text-ink-3'
              }`}
            >
              {/* Date number header */}
              <div className="flex items-center justify-between w-full">
                <span
                  className={`text-[10px] sm:text-xs font-bold w-4 h-4 sm:w-5 sm:h-5 flex items-center justify-center rounded-full ${
                    currentDay
                      ? 'bg-accent text-accent-ink'
                      : isSelected
                      ? 'bg-ink text-surface'
                      : item.isCurrentMonth
                      ? 'text-ink'
                      : 'text-ink-3'
                  }`}
                >
                  {item.date.getDate()}
                </span>
                {events.length > 0 && (
                  <span className={`text-[9px] sm:text-[10px] font-bold font-mono ${
                    currentDay ? 'text-accent' : isSelected ? 'text-ink' : 'text-ink-3'
                  }`}>
                    {events.length}
                  </span>
                )}
              </div>

              {/* Event pills (Full-width, pure static labels, no buttons, no icons) */}
              <div className="space-y-0.5 w-full overflow-hidden flex-1">
                {events.slice(0, 4).map((res) => {
                  const bDate = new Date(res.booking_date!);
                  const duration = resolveReservationDuration(res);
                  const endDate = new Date(bDate.getTime() + duration * 60000);
                  const startTimeStr = bDate
                    .toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false })
                    .replace('.', ':');
                  const endTimeStr = endDate
                    .toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false })
                    .replace('.', ':');
                  const isHold = res.status === 'hold';
                  // Warna pill = bidan penanggung jawab.
                  const staffPillColor = isHold
                    ? 'bg-warning-soft text-warning border-dashed border-warning-line font-bold'
                    : getStaffColor(resolveStaffId(res), staffList).card;
                  const cleanName = stripHonorific(res.customer?.name) || 'Pasien';
                  const nameDisplay = isHold ? `[HOLD] ${cleanName}` : cleanName;

                  return (
                    <div
                      key={res.id}
                      className={`w-full px-1 py-0.5 rounded-[2px] sm:rounded text-[9px] sm:text-[10px] font-semibold truncate border block leading-tight ${staffPillColor}`}
                      title={`${nameDisplay} (${startTimeStr} - ${endTimeStr}) - ${res.treatment_detail || res.treatment_category}`}
                    >
                      <span className="truncate block font-medium">
                        {nameDisplay}
                      </span>
                    </div>
                  );
                })}
                {events.length > 4 && (
                  <div className="w-full text-center text-[9px] text-accent font-bold pt-0.5 truncate">
                    +{events.length - 4} lainnya
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
