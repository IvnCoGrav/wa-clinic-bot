import React, { useEffect, useRef } from 'react';
import { Reservation } from '../../types';
import { Plus, User, Clock, CheckCircle2, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { QuickSlotTarget } from './types';
import { useCalendarZoom } from '../../hooks/useCalendarZoom';
import { CalendarZoomControls } from './CalendarZoomControls';

interface WeekScheduleGridProps {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  reservations: Reservation[];
  onSelectReservation: (res: Reservation) => void;
  onQuickAdd: (target: QuickSlotTarget) => void;
}

// Hours to display (6 am to 9 pm / 06:00 to 21:00)
const HOURS = Array.from({ length: 16 }, (_, i) => i + 6);

// Ukuran layout dasar untuk kalkulasi auto-scroll
const TIME_GUTTER = 70; // kolom label jam
const DAY_COL_WIDTH = 140; // minmax(140px,1fr) pada kolom hari
const HEADER_HEIGHT = 50;

export { extractDurationMinutes } from '../../utils/durationCalculator';
import { cleanTreatmentDetailForDisplay, resolveReservationDuration } from '../../utils/durationCalculator';

interface PositionedEvent {
  res: Reservation;
  startMinutes: number; // Menit terhitung dari jam 06:00
  endMinutes: number;
  duration: number;
  topPx: number;
  heightPx: number;
  colIndex: number;
  totalCols: number;
}

function layoutEventsForDay(
  dayReservations: Reservation[],
  hourHeight: number,
  minCardHeight: number
): PositionedEvent[] {
  const eventsWithTiming = dayReservations
    .filter((r) => !!r.booking_date)
    .map((r) => {
      const bDate = new Date(r.booking_date!);
      const duration = resolveReservationDuration(r);
      const startMinutes = (bDate.getHours() - 6) * 60 + bDate.getMinutes();
      const endMinutes = startMinutes + duration;
      return { res: r, startMinutes, endMinutes, duration };
    })
    .sort((a, b) => a.startMinutes - b.startMinutes || b.duration - a.duration);

  const positioned: PositionedEvent[] = [];
  let currentCluster: typeof eventsWithTiming = [];
  let clusterEnd = -1;

  const processCluster = (cluster: typeof eventsWithTiming) => {
    if (cluster.length === 0) return;
    const columns: Array<{ endMinutes: number }> = [];
    const clusterPositions: Array<{ colIndex: number }> = [];

    for (const ev of cluster) {
      let placedCol = -1;
      for (let c = 0; c < columns.length; c++) {
        if (columns[c].endMinutes <= ev.startMinutes) {
          columns[c].endMinutes = ev.endMinutes;
          placedCol = c;
          break;
        }
      }
      if (placedCol === -1) {
        placedCol = columns.length;
        columns.push({ endMinutes: ev.endMinutes });
      }
      clusterPositions.push({ colIndex: placedCol });
    }

    const totalCols = Math.max(1, columns.length);
    cluster.forEach((ev, idx) => {
      const colIndex = clusterPositions[idx].colIndex;
      const topPx = Math.max(0, Math.round((ev.startMinutes / 60) * hourHeight));
      const heightPx = Math.max(minCardHeight, Math.round((ev.duration / 60) * hourHeight - 4));
      positioned.push({
        res: ev.res,
        startMinutes: ev.startMinutes,
        endMinutes: ev.endMinutes,
        duration: ev.duration,
        topPx,
        heightPx,
        colIndex,
        totalCols,
      });
    });
  };

  for (const ev of eventsWithTiming) {
    if (currentCluster.length === 0) {
      currentCluster.push(ev);
      clusterEnd = ev.endMinutes;
    } else if (ev.startMinutes < clusterEnd) {
      currentCluster.push(ev);
      clusterEnd = Math.max(clusterEnd, ev.endMinutes);
    } else {
      processCluster(currentCluster);
      currentCluster = [ev];
      clusterEnd = ev.endMinutes;
    }
  }
  processCluster(currentCluster);

  return positioned;
}

export const WeekScheduleGrid: React.FC<WeekScheduleGridProps> = ({
  selectedDate,
  onSelectDate,
  reservations,
  onSelectReservation,
  onQuickAdd,
}) => {
  const zoomState = useCalendarZoom();
  const { hourHeight, zoomLevel, containerRef } = zoomState;

  const topScrollbarRef = useRef<HTMLDivElement>(null);
  const isSyncingScrollRef = useRef(false);
  const hasAutoScrolledRef = useRef(false);

  const handleTopScrollbar = () => {
    if (isSyncingScrollRef.current) return;
    if (!topScrollbarRef.current || !containerRef.current) return;
    isSyncingScrollRef.current = true;
    containerRef.current.scrollLeft = topScrollbarRef.current.scrollLeft;
    requestAnimationFrame(() => {
      isSyncingScrollRef.current = false;
    });
  };

  const handleMainScroll = () => {
    if (isSyncingScrollRef.current) return;
    if (!topScrollbarRef.current || !containerRef.current) return;
    isSyncingScrollRef.current = true;
    topScrollbarRef.current.scrollLeft = containerRef.current.scrollLeft;
    requestAnimationFrame(() => {
      isSyncingScrollRef.current = false;
    });
  };

  const isDraggingRef = useRef(false);
  const dragMovedRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('input') || target.closest('select') || target.closest('textarea') || target.closest('button') || target.closest('[data-event-card]')) {
      return;
    }
    const container = containerRef.current;
    if (!container) return;

    if (e.pointerType !== 'mouse') return;

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
    const container = containerRef.current;
    if (!container) return;

    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const distance = Math.hypot(dx, dy);

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
    const container = containerRef.current;
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

  const scrollToDayIndex = (idx: number) => {
    const el = containerRef.current;
    if (!el) return;
    const dayStart = TIME_GUTTER + idx * DAY_COL_WIDTH;
    const viewportW = el.clientWidth;
    const targetLeft = Math.max(0, dayStart - (viewportW - DAY_COL_WIDTH) / 2);
    el.scrollTo({ left: targetLeft, behavior: 'smooth' });
  };

  const formatHourLabel = (hour: number) => {
    if (hour === 12) return '12 pm';
    if (hour > 12) return `${hour - 12} pm`;
    return `${hour} am`;
  };

  const getCategoryStyles = (category: string) => {
    switch (category) {
      case 'MOMS':
        return 'bg-[#f3e8ff] dark:bg-[#251438] border-l-4 border-[#9333ea] dark:border-l-[#c084fc] text-[#581c87] dark:text-[#f3e8ff] hover:bg-[#ebd5ff] dark:hover:bg-[#321c4a] border border-transparent dark:border-[#c084fc]/30';
      case 'BOTH':
        return 'bg-[#dcfce7] dark:bg-[#0d2e1e] border-l-4 border-[#16a34a] dark:border-l-[#4ade80] text-[#14532d] dark:text-[#dcfce7] hover:bg-[#bbf7d0] dark:hover:bg-[#14422c] border border-transparent dark:border-[#4ade80]/30';
      case 'KIDS':
        return 'bg-[#ccfbf1] dark:bg-[#0b2b28] border-l-4 border-[#0d9488] dark:border-l-[#2dd4bf] text-[#115e59] dark:text-[#ccfbf1] hover:bg-[#99f6e4] dark:hover:bg-[#123e3a] border border-transparent dark:border-[#2dd4bf]/30';
      case 'BUNDLE':
        return 'bg-[#fef3c7] dark:bg-[#2e2009] border-l-4 border-[#d97706] dark:border-l-[#fbbf24] text-[#78350f] dark:text-[#fef3c7] hover:bg-[#fde68a] dark:hover:bg-[#402d0d] border border-transparent dark:border-[#fbbf24]/30';
      case 'BABY':
      default:
        return 'bg-[#e0f2fe] dark:bg-[#0c2438] border-l-4 border-[#0284c7] dark:border-l-[#38bdf8] text-[#0c4a6e] dark:text-[#e0f2fe] hover:bg-[#bae6fd] dark:hover:bg-[#12334e] border border-transparent dark:border-[#38bdf8]/30';
    }
  };

  // Auto-scroll sekali saat kalender pertama kali dimuat
  useEffect(() => {
    if (hasAutoScrolledRef.current) return;
    const el = containerRef.current;
    if (!el) return;

    const now = new Date();
    const tIdx = weekDays.findIndex((d) => isSameDay(d, selectedDate) || isSameDay(d, now));
    const activeIdx = tIdx !== -1 ? tIdx : 0;

    const dayStart = TIME_GUTTER + activeIdx * DAY_COL_WIDTH;
    const viewportW = el.clientWidth || 360;
    const targetLeft = Math.max(0, dayStart - (viewportW - DAY_COL_WIDTH) / 2);
    const maxLeft = el.scrollWidth - viewportW;
    el.scrollLeft = Math.min(targetLeft, Math.max(0, maxLeft));

    const currentHour = now.getHours();
    const targetHour = Math.max(6, Math.min(currentHour, 20));
    const targetTop = Math.max(0, (targetHour - 6) * hourHeight - HEADER_HEIGHT / 2);
    const maxTop = el.scrollHeight - el.clientHeight;
    el.scrollTop = Math.min(targetTop, Math.max(0, maxTop));

    hasAutoScrolledRef.current = true;
  }, []);

  const minCardHeight = zoomLevel === 'compact' ? 32 : 50;

  return (
    <div className="bg-white dark:bg-[#111b21] rounded-2xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs overflow-hidden flex flex-col relative group/calendar">
      {/* Floating Zoom Controls Bar (Desktop & Tablet) */}
      <div className="absolute top-3 right-3 z-40 hidden sm:block">
        <CalendarZoomControls zoomState={zoomState} variant="floating" />
      </div>

      {/* Top Interactive Day Navigation Bar */}
      <div className="flex items-center justify-between border-b border-[#e9edef] dark:border-[#2a3942] bg-[#f8fafc] dark:bg-[#182229] px-2 py-1.5 z-30 shrink-0 select-none">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              const prev = new Date(selectedDate);
              prev.setDate(prev.getDate() - 1);
              onSelectDate(prev);
              const idx = weekDays.findIndex((d) => isSameDay(d, prev));
              if (idx !== -1) scrollToDayIndex(idx);
            }}
            className="p-1.5 rounded-lg hover:bg-white dark:hover:bg-[#202c33] border border-transparent hover:border-[#d1d7db] dark:hover:border-[#374248] text-[#54656f] dark:text-[#aebac1] transition-all cursor-pointer"
            title="Hari Sebelumnya"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-xs font-bold text-[#111b21] dark:text-[#e9edef] hidden sm:inline px-1">
            Navigasi Hari:
          </span>
        </div>

        {/* Clickable Day Pills */}
        <div
          className="flex-1 flex items-center justify-center gap-1 overflow-x-auto no-scrollbar mx-1 px-1 py-0.5"
          style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
        >
          {weekDays.map((d, i) => {
            const isSel = isSameDay(d, selectedDate);
            const isTod = isToday(d);
            const dayName = d.toLocaleDateString('id-ID', { weekday: 'short' });
            const dayNum = d.getDate();

            return (
              <button
                key={i}
                type="button"
                onClick={() => {
                  onSelectDate(d);
                  scrollToDayIndex(i);
                }}
                className={`px-2.5 py-1 rounded-xl text-xs font-semibold flex items-center space-x-1 transition-all cursor-pointer shrink-0 ${
                  isSel
                    ? 'bg-[#008069] dark:bg-[#00a884] text-white shadow-xs'
                    : isTod
                    ? 'bg-[#e8f5f2] dark:bg-[#00a884]/20 text-[#008069] dark:text-[#00a884] border border-[#c2e7e0] dark:border-[#00a884]/30'
                    : 'bg-white dark:bg-[#202c33] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] text-[#54656f] dark:text-[#aebac1] border border-[#e9edef] dark:border-[#2a3942]'
                }`}
              >
                <span>{dayName}</span>
                <span className="font-bold">{dayNum}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => {
            const next = new Date(selectedDate);
            next.setDate(next.getDate() + 1);
            onSelectDate(next);
            const idx = weekDays.findIndex((d) => isSameDay(d, next));
            if (idx !== -1) scrollToDayIndex(idx);
          }}
          className="p-1.5 rounded-lg hover:bg-white dark:hover:bg-[#202c33] border border-transparent hover:border-[#d1d7db] dark:hover:border-[#374248] text-[#54656f] dark:text-[#aebac1] transition-all cursor-pointer"
          title="Hari Berikutnya"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Dedicated Top Horizontal Scrollbar Track (1:1 Synchronized with 1050px Calendar Grid) */}
      <div
        ref={topScrollbarRef}
        onScroll={handleTopScrollbar}
        className="overflow-x-auto overflow-y-hidden h-3 sm:h-3.5 bg-[#f0f2f5] dark:bg-[#111b21] border-b border-[#e9edef] dark:border-[#2a3942] select-none cursor-pointer"
        style={{
          WebkitOverflowScrolling: 'touch',
        }}
        title="Geser kalender secara horizontal"
      >
        <div style={{ width: '1050px', height: '1px' }} />
      </div>

      {/* Main 2D Scrollable Timeline View */}
      <div
        ref={containerRef}
        data-horizontal-scroll="true"
        data-no-swipe-back="true"
        onScroll={handleMainScroll}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="overflow-x-auto overflow-y-auto max-h-[720px] select-none cursor-grab active:cursor-grabbing"
        style={{
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <div className="min-w-[1050px] w-full divide-y divide-[#e9edef] dark:divide-[#2a3942]">
          {/* Sticky Header: Day Names & Dates */}
          <div className="sticky top-0 z-30 grid grid-cols-[70px_repeat(7,minmax(140px,1fr))] divide-x divide-[#e9edef] dark:divide-[#2a3942] border-b border-[#e9edef] dark:border-[#2a3942] bg-[#fafafa] dark:bg-[#182229] shadow-xs">
            {/* Top-left corner box */}
            <div className="sticky left-0 z-40 bg-[#fafafa] dark:bg-[#182229] border-r border-[#e9edef] dark:border-[#2a3942] flex items-center justify-center p-2 text-xs font-bold text-[#8696a0] shadow-[2px_0_5px_rgba(0,0,0,0.06)] dark:shadow-[2px_0_5px_rgba(0,0,0,0.3)]">
              GMT+7
            </div>

            {/* 7 Days Header Columns */}
            {weekDays.map((day, i) => {
              const dayName = day.toLocaleDateString('id-ID', { weekday: 'short' });
              const dayNum = day.getDate();
              const isSelected = isSameDay(day, selectedDate);
              const currentDay = isToday(day);

              return (
                <button
                  key={i}
                  onClick={() => {
                    if (dragMovedRef.current) return;
                    onSelectDate(day);
                    scrollToDayIndex(i);
                  }}
                  className={`p-2 sm:p-2.5 text-center flex flex-col items-center justify-center transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#111b21] dark:bg-[#00a884]/20 text-white dark:text-[#00a884] shadow-sm ring-1 ring-black/10 dark:ring-[#00a884]/40'
                      : currentDay
                      ? 'bg-[#e8f5f2] dark:bg-[#008069]/20 text-[#008069] dark:text-[#00a884] font-semibold hover:bg-[#d5ebe6] dark:hover:bg-[#008069]/30'
                      : 'hover:bg-[#f0f2f5] dark:hover:bg-[#202c33] text-[#54656f] dark:text-[#aebac1] bg-[#fafafa] dark:bg-[#182229]'
                  }`}
                >
                  <span className={`text-[11px] font-medium uppercase tracking-wider ${isSelected ? 'text-gray-300 dark:text-[#00a884]' : currentDay ? 'text-[#008069] dark:text-[#00a884]' : 'text-[#8696a0]'}`}>
                    {dayName}
                  </span>
                  <span className={`text-base sm:text-lg font-extrabold mt-0.5 ${isSelected ? 'text-white dark:text-[#e9edef]' : currentDay ? 'text-[#008069] dark:text-[#00a884]' : 'text-[#111b21] dark:text-[#e9edef]'}`}>
                    {dayNum}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Continuous Multi-Hour Timeline Canvas */}
          <div
            className="grid grid-cols-[70px_repeat(7,minmax(140px,1fr))] divide-x divide-[#e9edef] dark:divide-[#2a3942] relative"
            style={{ height: `${HOURS.length * hourHeight}px`, minHeight: `${HOURS.length * hourHeight}px` }}
          >
            {/* Time label column (frozen horizontally on scroll) */}
            <div className="sticky left-0 z-20 bg-[#fafafa] dark:bg-[#182229] divide-y divide-[#e9edef] dark:divide-[#2a3942] border-r border-[#e9edef] dark:border-[#2a3942] shadow-[2px_0_5px_rgba(0,0,0,0.06)] dark:shadow-[2px_0_5px_rgba(0,0,0,0.3)]">
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  style={{ height: `${hourHeight}px` }}
                  className="p-2 text-right pr-3 text-xs font-semibold text-[#8696a0] select-none flex items-start justify-end pt-2"
                >
                  <span>{formatHourLabel(hour)}</span>
                </div>
              ))}
            </div>

            {/* 7 Continuous Day Columns */}
            {weekDays.map((day, dayIdx) => {
              const isSelectedDay = isSameDay(day, selectedDate);
              const dayReservations = reservations.filter(
                (r) => r.booking_date && isSameDay(new Date(r.booking_date), day)
              );
              const positionedEvents = layoutEventsForDay(dayReservations, hourHeight, minCardHeight);

              return (
                <div
                  key={dayIdx}
                  className={`relative divide-y divide-[#e9edef] dark:divide-[#2a3942] transition-colors ${
                    isSelectedDay ? 'bg-emerald-50/20 dark:bg-[#00a884]/10' : ''
                  }`}
                >
                  {/* Background Hourly Slot Grids & Hover Add Buttons */}
                  {HOURS.map((hour) => (
                    <div
                      key={hour}
                      style={{ height: `${hourHeight}px` }}
                      className="relative group/slot hover:bg-gray-50/60 dark:hover:bg-[#202c33]/40 transition-colors"
                    >
                      <button
                        onClick={(e) => {
                          if (dragMovedRef.current) {
                            e.preventDefault();
                            e.stopPropagation();
                            return;
                          }
                          onQuickAdd({ date: day, hour });
                        }}
                        className="w-full h-full absolute inset-0 z-0 border border-transparent hover:border-dashed hover:border-[#008069] dark:hover:border-[#00a884] hover:bg-[#e8f5f2]/40 dark:hover:bg-[#00a884]/15 text-transparent hover:text-[#008069] dark:hover:text-[#00a884] flex items-center justify-center transition-all opacity-0 group-hover/slot:opacity-100 cursor-pointer"
                        title={`Tambah Jadwal pada ${day.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })} jam ${formatHourLabel(hour)}`}
                      >
                        <Plus size={14} className="transform scale-90 group-hover/slot:scale-110 transition-transform" />
                      </button>
                    </div>
                  ))}

                  {/* Absolute Continuous Event Blocks Spanning Across Multi-Hours */}
                  {positionedEvents.map((pos) => {
                    const res = pos.res;
                    const bDate = new Date(res.booking_date!);
                    const startTimeStr = bDate
                      .toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false })
                      .replace('.', ':');
                    const isHold = res.status === 'hold';
                    const categoryStyles = isHold
                      ? 'bg-amber-50/95 dark:bg-[#33230a] border-2 border-dashed border-amber-500 dark:border-amber-400 text-amber-950 dark:text-amber-100 hover:bg-amber-100/90 dark:hover:bg-[#422e0c]'
                      : getCategoryStyles(res.treatment_category);

                    const rawName = res.customer?.name || 'Pasien';
                    const cleanName = rawName
                      .replace(/^(?:Bunda|Ibu|Ny\.|Nn\.|Sdri\.|Mama|Mom|Moms)\s+/i, '')
                      .trim();
                    const firstName = cleanName.split(/\s+/)[0] || cleanName;

                    const cleanDetail = isHold ? '⏳ Ditawarkan (HOLD)' : cleanTreatmentDetailForDisplay(res.treatment_detail, res.treatment_category);

                    const evWidth =
                      pos.totalCols > 1
                        ? `calc(${100 / pos.totalCols}% - 6px)`
                        : 'calc(100% - 8px)';
                    const evLeft =
                      pos.totalCols > 1
                        ? `calc(${(pos.colIndex * 100) / pos.totalCols}% + 3px)`
                        : '4px';

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
                          top: `${pos.topPx + 2}px`,
                          height: `${pos.heightPx}px`,
                          left: evLeft,
                          width: evWidth,
                        }}
                        className={`absolute z-10 p-1.5 sm:p-2 rounded-xl transition-all cursor-pointer shadow-md hover:shadow-lg hover:z-20 ring-1 ring-black/5 dark:ring-white/10 flex flex-col justify-between overflow-hidden ${categoryStyles}`}
                      >
                        {zoomLevel === 'compact' ? (
                          /* COMPACT VIEW LOD (<65px) */
                          <div className="flex items-center justify-between gap-1 h-full">
                            <span className={`font-extrabold text-[10.5px] truncate leading-tight ${isHold ? 'text-amber-950 dark:text-amber-100' : 'text-[#111b21] dark:text-[#e9edef]'}`}>
                              {isHold ? `[HOLD] ${firstName}` : firstName}
                            </span>
                            <span className="font-mono text-[9px] font-bold text-[#54656f] dark:text-[#aebac1] shrink-0">
                              {startTimeStr} ({pos.duration}m)
                            </span>
                          </div>
                        ) : (
                          /* STANDARD & DETAILED VIEW LOD */
                          <>
                            {/* Baris Atas: Jam Mulai & Status Badge */}
                            <div className="flex items-center justify-between text-[10px] sm:text-[10.5px] font-bold shrink-0">
                              <span className={`flex items-center space-x-1 font-mono ${isHold ? 'text-amber-950 dark:text-amber-100' : 'text-[#111b21] dark:text-[#e9edef]'}`}>
                                <Clock size={10} className="opacity-75 shrink-0" />
                                <span>{startTimeStr}</span>
                              </span>
                              <div className="flex items-center space-x-1 shrink-0">
                                {res.session_number != null && res.total_sessions != null && (
                                  <span className="inline-flex items-center px-1 py-0.2 rounded-full text-[8px] sm:text-[8.5px] font-bold bg-blue-600/10 dark:bg-blue-500/20 text-blue-800 dark:text-blue-300">
                                    Sesi {res.session_number}/{res.total_sessions}
                                  </span>
                                )}
                                {res.status === 'hold' ? (
                                  <span className="inline-flex items-center px-1.5 py-0.2 rounded-full text-[8px] sm:text-[8.5px] font-black bg-amber-500 text-slate-950 ring-1 ring-amber-300 dark:ring-amber-300/60 shadow-2xs">
                                    <Clock size={9} className="mr-0.5" />
                                    HOLD
                                  </span>
                                ) : res.status === 'confirmed' ? (
                                  <span className="inline-flex items-center px-1.5 py-0.2 rounded-full text-[8px] sm:text-[8.5px] font-bold bg-emerald-600/10 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 ring-1 ring-emerald-500/30">
                                    <CheckCircle2 size={9} className="mr-0.5 text-emerald-600 dark:text-emerald-400" />
                                    Lunas
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-1.5 py-0.2 rounded-full text-[8px] sm:text-[8.5px] font-bold bg-amber-600/10 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 ring-1 ring-amber-500/30">
                                    <AlertCircle size={9} className="mr-0.5 text-amber-600 dark:text-amber-400" />
                                    Pending
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Baris Tengah: Nama Pasien & Detail Layanan */}
                            <div className="my-auto py-0.5 overflow-hidden space-y-0.5">
                              <h5
                                className={`font-extrabold text-xs truncate leading-tight ${isHold ? 'text-amber-950 dark:text-amber-100' : 'text-[#111b21] dark:text-[#e9edef]'}`}
                                title={res.customer?.name || ''}
                              >
                                {zoomLevel === 'detailed' ? cleanName : firstName}
                              </h5>
                              {pos.heightPx >= 58 && cleanDetail && (
                                <p className="text-[10px] opacity-90 line-clamp-1 font-medium leading-tight">
                                  {cleanDetail}
                                </p>
                              )}
                            </div>

                            {/* Baris Bawah: Nama Terapis & Durasi */}
                            <div className="pt-0.5 border-t border-black/10 dark:border-white/10 flex items-center justify-between text-[9px] sm:text-[9.5px] opacity-85 shrink-0">
                              <div className="flex items-center space-x-1 truncate font-semibold text-[#54656f] dark:text-[#aebac1]">
                                <User size={9} className="shrink-0 text-[#008069] dark:text-[#00a884]" />
                                <span className="truncate">
                                  {res.assigned_staff?.name
                                    ? res.assigned_staff.name.split(/\s+/)[0]
                                    : 'Unassigned'}
                                </span>
                              </div>
                              <span className="font-mono font-bold text-[8.5px] px-1 py-0.2 rounded bg-black/5 dark:bg-white/10 shrink-0 ml-1">
                                {pos.duration}m
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Floating Bottom Toolbar for Mobile Screen */}
      <div className="p-2 sm:hidden flex justify-end border-t border-[#e9edef] dark:border-[#2a3942] bg-[#fafafa] dark:bg-[#182229]">
        <CalendarZoomControls zoomState={zoomState} variant="inline" />
      </div>
    </div>
  );
};
