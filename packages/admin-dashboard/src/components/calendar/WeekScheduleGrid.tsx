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

function extractDurationMinutes(detail?: string | null): number {
  if (!detail) return 60;
  const totalMatch = detail.match(/\[Total\s*(\d+)m/i);
  if (totalMatch) return parseInt(totalMatch[1], 10);
  const minMatches = detail.match(/(\d+)\s*(?:menit|mins?|m\b)/gi);
  if (minMatches && minMatches.length > 0) {
    let sum = 0;
    for (const m of minMatches) {
      const num = parseInt(m.replace(/\D/g, ''), 10);
      if (num > 0 && num <= 300) sum += num;
    }
    if (sum > 0) return sum;
  }
  return 60;
}

export const WeekScheduleGrid: React.FC<WeekScheduleGridProps> = ({
  selectedDate,
  onSelectDate,
  reservations,
  onSelectReservation,
  onQuickAdd,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragMovedRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Hanya abaikan jika klik pada input atau form controls
    const target = e.target as HTMLElement;
    if (target.closest('input') || target.closest('select') || target.closest('textarea')) {
      return;
    }
    const container = scrollRef.current;
    if (!container) return;

    isDraggingRef.current = true;
    dragMovedRef.current = false;
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const container = scrollRef.current;
    if (!container) return;

    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const distance = Math.hypot(dx, dy);

    // Aktifkan drag setelah threshold 4px agar klik biasa tetap berfungsi
    if (distance > 4) {
      if (!dragMovedRef.current) {
        dragMovedRef.current = true;
        try {
          container.setPointerCapture?.(e.pointerId);
        } catch (_) {}
      }
      container.scrollLeft = dragStartRef.current.scrollLeft - dx;
      container.scrollTop = dragStartRef.current.scrollTop - dy;
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    const container = scrollRef.current;
    if (container) {
      try {
        container.releasePointerCapture?.(e.pointerId);
      } catch (_) {}
    }
  };

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
      <div
        ref={scrollRef}
        data-horizontal-scroll="true"
        data-no-swipe-back="true"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="overflow-x-auto overflow-y-auto max-h-[720px] overscroll-x-contain select-none cursor-grab active:cursor-grabbing"
        style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y' }}
      >
        <div className="min-w-[1050px] w-full divide-y divide-[#e9edef]">
          {/* Week Header Days Bar */}
          <div className="sticky top-0 z-30 grid grid-cols-[70px_repeat(7,minmax(140px,1fr))] divide-x divide-[#e9edef] border-b border-[#e9edef] bg-[#fafafa] shadow-xs">
            {/* Empty top-left time cell (frozen horizontally & vertically) */}
            <div className="sticky top-0 left-0 z-40 p-3 flex items-center justify-center text-[#8696a0] bg-[#fafafa] border-r border-[#e9edef] shadow-[2px_0_5px_rgba(0,0,0,0.06)]">
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
                  onClick={() => {
                    if (dragMovedRef.current) return;
                    onSelectDate(day);
                  }}
                  className={`p-2.5 sm:p-3 text-center transition-all flex flex-col items-center justify-center cursor-pointer ${
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
              className="grid grid-cols-[70px_repeat(7,minmax(140px,1fr))] h-[90px] min-h-[90px] divide-x divide-[#e9edef] group"
            >
              {/* Time label column (frozen horizontally on scroll) */}
              <div className="sticky left-0 z-20 p-2 text-right pr-3 text-xs font-semibold text-[#8696a0] select-none bg-[#fafafa] flex items-start justify-end pt-2 border-r border-[#e9edef] shadow-[2px_0_5px_rgba(0,0,0,0.06)]">
                <span>{formatHourLabel(hour)}</span>
              </div>

              {/* Day Slots */}
              {weekDays.map((day, dayIdx) => {
                const events = getEventsForSlot(day, hour);
                const isSelectedDay = isSameDay(day, selectedDate);

                return (
                  <div
                    key={dayIdx}
                    className={`relative transition-colors group/slot h-[90px] ${
                      isSelectedDay ? 'bg-emerald-50/20' : 'hover:bg-gray-50/60'
                    }`}
                  >
                    {/* Empty Slot Hover Quick-Add Button (Always available behind cards) */}
                    <button
                      onClick={(e) => {
                        if (dragMovedRef.current) {
                          e.preventDefault();
                          e.stopPropagation();
                          return;
                        }
                        onQuickAdd({ date: day, hour });
                      }}
                      className="w-full h-full absolute inset-0 z-0 border border-transparent hover:border-dashed hover:border-[#008069] hover:bg-[#e8f5f2]/40 text-transparent hover:text-[#008069] flex items-center justify-center transition-all opacity-0 group-hover/slot:opacity-100 cursor-pointer"
                      title={`Tambah Jadwal pada ${day.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })} jam ${formatHourLabel(hour)}`}
                    >
                      <Plus size={16} className="transform scale-90 group-hover/slot:scale-110 transition-transform" />
                    </button>

                    {/* Event Blocks (Spanning proportionally by start minute & total duration) */}
                    {events.map((res, evIdx) => {
                      const bDate = new Date(res.booking_date!);
                      const duration = extractDurationMinutes(res.treatment_detail);
                      const startTimeStr = bDate
                        .toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false })
                        .replace('.', ':');
                      const categoryStyles = getCategoryStyles(res.treatment_category);

                      // Bersihkan gelar/sapaan "Bunda/Ibu" dan ambil nama depan saja
                      const rawName = res.customer?.name || 'Pasien';
                      const cleanName = rawName
                        .replace(/^(?:Bunda|Ibu|Ny\.|Nn\.|Sdri\.|Mama|Mom|Moms)\s+/i, '')
                        .trim();
                      const firstName = cleanName.split(/\s+/)[0] || cleanName;

                      const cleanDetail = (res.treatment_detail || res.treatment_category || '')
                        .replace(/\[\s*(?:total\s*)?buffer\s*=[^\]]*\]/gi, '')
                        .replace(/\[\s*total\s*\d+\s*m?\s*\+\s*buffer\s*\d+\s*m?\s*=\s*\d+\s*m?\s*\]/gi, '')
                        .trim();

                      // Posisi menit awal (0..59) dan tinggi proporsional durasi
                      const startMinutes = bDate.getMinutes();
                      const topOffsetPx = Math.round((startMinutes / 60) * HOUR_ROW_HEIGHT);
                      const heightPx = Math.max(54, Math.round((duration / 60) * HOUR_ROW_HEIGHT - 6));
                      const evCount = events.length;
                      const evWidth = evCount > 1 ? `calc(${100 / evCount}% - 6px)` : 'calc(100% - 8px)';
                      const evLeft = evCount > 1 ? `calc(${(evIdx * 100) / evCount}% + 3px)` : '4px';

                      return (
                        <div
                          key={res.id}
                          data-event-card="true"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (dragMovedRef.current) return;
                            onSelectReservation(res);
                          }}
                          style={{
                            top: `${topOffsetPx + 3}px`,
                            height: `${heightPx}px`,
                            left: evLeft,
                            width: evWidth,
                          }}
                          className={`absolute z-10 p-2 rounded-xl transition-all cursor-pointer shadow-md hover:shadow-lg hover:z-15 ring-1 ring-black/5 flex flex-col justify-between overflow-hidden ${categoryStyles}`}
                        >
                          {/* Baris Atas: Jam Mulai & Status Badge */}
                          <div className="flex items-center justify-between text-[10.5px] font-bold shrink-0">
                            <span className="flex items-center space-x-1 font-mono text-[#111b21]">
                              <Clock size={10} className="opacity-75 shrink-0" />
                              <span>{startTimeStr}</span>
                            </span>
                            {res.status === 'confirmed' ? (
                              <span className="inline-flex items-center px-1 py-0.2 rounded-full text-[8.5px] font-bold bg-emerald-600/10 text-emerald-800 shrink-0">
                                <CheckCircle2 size={9} className="mr-0.5 text-emerald-600" />
                                Lunas
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-1 py-0.2 rounded-full text-[8.5px] font-bold bg-amber-600/10 text-amber-800 shrink-0">
                                <AlertCircle size={9} className="mr-0.5 text-amber-600" />
                                Pending
                              </span>
                            )}
                          </div>

                          {/* Baris Tengah: Nama Depan Saja (Bold) & Detail Treatment jika cukup tinggi */}
                          <div className="my-auto py-0.5 overflow-hidden space-y-0.5">
                            <h5 className="font-extrabold text-xs text-[#111b21] truncate leading-tight" title={res.customer?.name || ''}>
                              {firstName}
                            </h5>
                            {heightPx >= 68 && cleanDetail && (
                              <p className="text-[10px] opacity-90 line-clamp-1 font-medium leading-tight">
                                {cleanDetail}
                              </p>
                            )}
                          </div>

                          {/* Baris Bawah: Nama Terapis & Durasi */}
                          <div className="pt-0.5 border-t border-black/10 flex items-center justify-between text-[9.5px] opacity-85 shrink-0">
                            <div className="flex items-center space-x-1 truncate font-semibold text-[#54656f]">
                              <User size={9} className="shrink-0 text-[#008069]" />
                              <span className="truncate">{res.assigned_staff?.name ? res.assigned_staff.name.split(/\s+/)[0] : 'Unassigned'}</span>
                            </div>
                            <span className="font-mono font-bold text-[8.5px] px-1 py-0.2 rounded bg-black/5 shrink-0 ml-1">
                              {duration}m
                            </span>
                          </div>
                        </div>
                      );
                    })}
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
