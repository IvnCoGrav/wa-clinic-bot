import React, { useEffect, useRef } from 'react';
import { Reservation } from '../../types';
import { Plus, User, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import { QuickSlotTarget } from './types';

interface WeekScheduleGridProps {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  reservations: Reservation[];
  onSelectReservation: (res: Reservation) => void;
  onQuickAdd: (target: QuickSlotTarget) => void;
}

// Hours to display (6 am to 9 pm / 06:00 to 21:00)
const HOURS = Array.from({ length: 16 }, (_, i) => i + 6);

// Ukuran layout untuk kalkulasi auto-scroll (harus sinkron dengan class Tailwind).
const TIME_GUTTER = 70; // kolom label jam
const DAY_COL_WIDTH = 140; // minmax(140px,1fr) pada kolom hari
const HOUR_ROW_HEIGHT = 90; // min-h-[90px] tiap baris jam
const HEADER_HEIGHT = 60; // sticky header hari (kira-kira)

export const WeekScheduleGrid: React.FC<WeekScheduleGridProps> = ({
  selectedDate,
  onSelectDate,
  reservations,
  onSelectReservation,
  onQuickAdd,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Compute the 7 days of the current week (Senin s.d. Minggu)
  const curr = new Date(selectedDate);
  const dayOfWeek = curr.getDay(); // 0 is Sunday, 1 is Monday...
  const distanceFromMonday = (dayOfWeek + 6) % 7;
  const monday = new Date(curr);
  monday.setDate(curr.getDate() - distanceFromMonday);

  const weekDays: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    weekDays.push(day);
  }

  const isSameDay = (d1: Date, d2: Date) => {
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  };

  const isToday = (d: Date) => isSameDay(d, new Date());

  // Map reservations by day index (0..6) and hour (6..21)
  const getEventsForSlot = (dayDate: Date, hour: number) => {
    return reservations.filter((r) => {
      if (!r.booking_date) return false;
      const bDate = new Date(r.booking_date);
      return isSameDay(bDate, dayDate) && bDate.getHours() === hour;
    });
  };

  const formatHourLabel = (hour: number) => {
    if (hour === 12) return '12 pm';
    if (hour > 12) return `${hour - 12} pm`;
    return `${hour} am`;
  };

  const getCategoryStyles = (category: string) => {
    switch (category) {
      case 'MOMS':
        return 'bg-[#f3e8ff] border-l-4 border-[#9333ea] text-[#581c87] hover:bg-[#ebd5ff]';
      case 'BOTH':
        return 'bg-[#dcfce7] border-l-4 border-[#16a34a] text-[#14532d] hover:bg-[#bbf7d0]';
      case 'KIDS':
        return 'bg-[#ccfbf1] border-l-4 border-[#0d9488] text-[#115e59] hover:bg-[#99f6e4]';
      case 'BUNDLE':
        return 'bg-[#fef3c7] border-l-4 border-[#d97706] text-[#78350f] hover:bg-[#fde68a]';
      case 'BABY':
      default:
        return 'bg-[#e0f2fe] border-l-4 border-[#0284c7] text-[#0c4a6e] hover:bg-[#bae6fd]';
    }
  };

  // Auto-scroll saat minggu dibuka: ke treatment terdekat dari sekarang;
  // bila tidak ada, ke kolom hari ini + jam sekarang.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const now = new Date();
    const upcoming = reservations
      .filter((r) => r.booking_date && new Date(r.booking_date).getTime() >= now.getTime())
      .sort(
        (a, b) =>
          new Date(a.booking_date!).getTime() - new Date(b.booking_date!).getTime()
      );
    const target = upcoming[0] ? new Date(upcoming[0].booking_date!) : null;

    let targetDay: Date;
    let targetHour: number;
    if (target) {
      targetDay = target;
      targetHour = target.getHours();
    } else {
      targetDay = new Date();
      targetHour = now.getHours();
    }
    if (targetHour < 6) targetHour = 6;
    if (targetHour > 21) targetHour = 21;

    // Kolom target dalam minggu (0=Senin..6=Minggu)
    const tIdx = weekDays.findIndex((d) => isSameDay(d, targetDay));
    if (tIdx === -1) return;

    const dayStart = TIME_GUTTER + tIdx * DAY_COL_WIDTH;
    const viewportW = el.clientWidth;
    const targetLeft = Math.max(0, dayStart - (viewportW - DAY_COL_WIDTH) / 2);
    const maxLeft = el.scrollWidth - viewportW;
    el.scrollLeft = Math.min(targetLeft, Math.max(0, maxLeft));

    const targetTop = Math.max(0, (targetHour - 6) * HOUR_ROW_HEIGHT - HEADER_HEIGHT / 2);
    const maxTop = el.scrollHeight - el.clientHeight;
    el.scrollTop = Math.min(targetTop, Math.max(0, maxTop));
  }, [reservations, selectedDate]);

  return (
    <div className="bg-white rounded-2xl border border-[#e9edef] shadow-xs overflow-hidden flex flex-col">
      {/* Scrollable Container with sticky header for continuous vertical line alignment */}
      <div ref={scrollRef} className="overflow-x-auto overflow-y-auto max-h-[720px]">
        <div className="min-w-[1050px] w-full divide-y divide-[#e9edef]">
          {/* Week Header Days Bar */}
          <div className="sticky top-0 z-20 grid grid-cols-[70px_repeat(7,minmax(140px,1fr))] divide-x divide-[#e9edef] border-b border-[#e9edef] bg-[#fafafa] shadow-xs">
            {/* Empty top-left time cell (frozen horizontally & vertically) */}
            <div className="sticky left-0 z-30 p-3 flex items-center justify-center text-[#8696a0] bg-[#fafafa] border-r border-[#e9edef] shadow-[2px_0_5px_rgba(0,0,0,0.06)]">
              <Clock size={16} />
            </div>

            {/* 7 Day Columns */}
            {weekDays.map((day, idx) => {
              const isSelected = isSameDay(day, selectedDate);
              const currentDay = isToday(day);
              const dayName = day.toLocaleDateString('id-ID', { weekday: 'long' });
              const dayNum = day.getDate();

              return (
                <button
                  key={idx}
                  onClick={() => onSelectDate(day)}
                  className={`p-2.5 sm:p-3 text-center transition-all flex flex-col items-center justify-center ${
                    isSelected
                      ? 'bg-[#111b21] text-white shadow-sm'
                      : currentDay
                      ? 'bg-[#e8f5f2] text-[#008069] font-semibold hover:bg-[#d5ebe6]'
                      : 'hover:bg-[#f0f2f5] text-[#54656f] bg-[#fafafa]'
                  }`}
                >
                  <span
                    className={`text-[11px] font-medium uppercase tracking-wider ${
                      isSelected ? 'text-gray-300' : currentDay ? 'text-[#008069]' : 'text-[#8696a0]'
                    }`}
                  >
                    {dayName}
                  </span>
                  <span
                    className={`text-base sm:text-lg font-extrabold mt-0.5 ${
                      isSelected ? 'text-white' : currentDay ? 'text-[#008069]' : 'text-[#111b21]'
                    }`}
                  >
                    {dayNum}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Hourly Timeline Grid */}
          {HOURS.map((hour) => (
            <div
              key={hour}
              className="grid grid-cols-[70px_repeat(7,minmax(140px,1fr))] min-h-[90px] divide-x divide-[#e9edef] group"
            >
              {/* Time label column (frozen horizontally on scroll) */}
              <div className="sticky left-0 z-10 p-2 text-right pr-3 text-xs font-semibold text-[#8696a0] select-none bg-[#fafafa] flex items-start justify-end pt-2 border-r border-[#e9edef] shadow-[2px_0_5px_rgba(0,0,0,0.06)]">
                <span>{formatHourLabel(hour)}</span>
              </div>

              {/* Day Slots */}
              {weekDays.map((day, dayIdx) => {
                const events = getEventsForSlot(day, hour);
                const isSelectedDay = isSameDay(day, selectedDate);

                return (
                  <div
                    key={dayIdx}
                    className={`p-1.5 relative transition-colors group/slot min-h-[90px] flex flex-col gap-1.5 ${
                      isSelectedDay ? 'bg-emerald-50/20' : 'hover:bg-gray-50/60'
                    }`}
                  >
                    {/* Event Blocks */}
                    {events.map((res) => {
                      const bDate = new Date(res.booking_date!);
                      const timeStr = bDate
                        .toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false })
                        .replace('.', ':');
                      const categoryStyles = getCategoryStyles(res.treatment_category);

                      return (
                        <div
                          key={res.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectReservation(res);
                          }}
                          className={`p-2.5 rounded-xl transition-all cursor-pointer shadow-xs relative overflow-hidden group/card ${categoryStyles}`}
                        >
                          {/* Status dot & Time */}
                          <div className="flex items-center justify-between text-[11px] font-bold mb-1">
                            <span className="flex items-center space-x-1">
                              <Clock size={11} className="opacity-80" />
                              <span>{timeStr}</span>
                            </span>
                            {res.status === 'confirmed' ? (
                              <span className="inline-flex items-center px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-emerald-600/10 text-emerald-800">
                                <CheckCircle2 size={10} className="mr-0.5 text-emerald-600" />
                                Lunas
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-amber-600/10 text-amber-800">
                                <AlertCircle size={10} className="mr-0.5 text-amber-600" />
                                Pending
                              </span>
                            )}
                          </div>

                          {/* Customer & Treatment title */}
                          <h5 className="font-bold text-xs line-clamp-1 leading-tight">
                            {res.customer?.name || 'Bunda'}
                          </h5>
                          <p className="text-[11px] opacity-90 line-clamp-1 mt-0.5 font-medium">
                            {res.treatment_detail || res.treatment_category}
                          </p>

                          {/* Staff badge */}
                          {res.assigned_staff && (
                            <div className="mt-1.5 pt-1 border-t border-black/10 flex items-center space-x-1 text-[10px] opacity-85">
                              <User size={10} />
                              <span className="truncate font-semibold">{res.assigned_staff.name}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Empty Slot Hover Quick-Add Button */}
                    {events.length === 0 && (
                      <button
                        onClick={() => onQuickAdd({ date: day, hour })}
                        className="w-full h-full min-h-[60px] rounded-xl border border-transparent hover:border-dashed hover:border-[#008069] hover:bg-[#e8f5f2]/40 text-transparent hover:text-[#008069] flex items-center justify-center transition-all group-hover/slot:opacity-100"
                        title={`Tambah Jadwal pada ${day.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })} jam ${formatHourLabel(hour)}`}
                      >
                        <Plus size={16} className="transform scale-90 group-hover/slot:scale-110 transition-transform" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
