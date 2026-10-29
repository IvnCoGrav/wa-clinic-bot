import React, { useEffect, useRef } from 'react';
import { Reservation } from '../../types';
import { Plus, User, Clock, ChevronLeft, ChevronRight, MapPin } from 'lucide-react';
import { QuickSlotTarget, StaffOption } from './types';
import { useCalendarZoom } from '../../hooks/useCalendarZoom';
import { CalendarZoomControls } from './CalendarZoomControls';
import { StaffColorLegend } from './StaffColorLegend';
import { ReservationStatusIcon } from './ReservationStatusIcon';
import { getWibHoursAndMinutes, getWibDateKey, getTodayWibDateKey } from '../../utils/dateWib';

interface WeekScheduleGridProps {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  reservations: Reservation[];
  onSelectReservation: (res: Reservation) => void;
  onQuickAdd: (target: QuickSlotTarget) => void;
  /** Daftar bidan tenant — sumber warna kartu & lookup nama terapis. */
  staffList?: StaffOption[];
}

// Hours to display (6 am to 9 pm / 06:00 to 21:00)
const HOURS = Array.from({ length: 16 }, (_, i) => i + 6);

// Ukuran layout dasar untuk kalkulasi auto-scroll
// Gutter, spacer, dan min-w DITURUNKAN dari satu konstanta (utils/calendarLayout).
// JANGAN menulis angka 1008/1020 manual di file ini — itu jebakan F-39.
const HEADER_HEIGHT = 50;

export { extractDurationMinutes } from '../../utils/durationCalculator';
import { resolveReservationDuration } from '../../utils/durationCalculator';
import { resolveStaffId, resolveStaffName, staffShortName } from '../../utils/resolveStaffName';
import { formatReservationArea } from '../../utils/reservationAddress';
import { stripHonorific } from '../../utils/patientName';
import { getStaffColor } from '../../utils/staffColors';
import { GRID_MIN_WIDTH, GRID_TEMPLATE_COLUMNS, TIME_GUTTER } from '../../utils/calendarLayout';
import {
  formatHourLabel as formatHourLabelUtil,
  formatHourLabelLong,
} from '../../utils/calendarHourLabel';

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
      const { hours, minutes } = getWibHoursAndMinutes(r.booking_date!);
      const duration = resolveReservationDuration(r);
      const startMinutes = (hours - 6) * 60 + minutes;
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
  staffList = [],
}) => {
  const zoomState = useCalendarZoom();
  const { hourHeight, zoomLevel, containerRef } = zoomState;

  const topScrollbarRef = useRef<HTMLDivElement>(null);
  const pillStripRef = useRef<HTMLDivElement>(null);
  const dayColumnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const hasAutoScrolledRef = useRef(false);

  // === Sinkronisasi scroll 1 arah + penjaga gema (anti-getar) ===
  // Grid → penggaris atas: aman, karena penggaris tidak sedang dipegang jari.
  // Penggaris atas → grid: HANYA saat penggaris benar-benar disentuh user, dan
  // event gema akibat tulisan programatik kita sendiri diabaikan.
  //
  // Sebelumnya kedua arah aktif tanpa penjaga waktu. Saat jari menggeser grid,
  // browser menggerakkan grid di lapisan compositor sehingga `scrollLeft` yang
  // dibaca JS tertinggal beberapa frame. Nilai basi itu ditulis balik ke grid
  // → grid "ditarik mundur" tiap frame → getar kiri-kanan.
  const topTouchingRef = useRef(false);
  const lastTopWriteRef = useRef(0);
  const TOP_SYNC_ECHO_MS = 300;

  const handleMainScroll = () => {
    const container = containerRef.current;
    const top = topScrollbarRef.current;
    if (!container || !top) return;
    // Jangan pernah menulis posisi ke elemen yang sedang dipegang jari.
    if (topTouchingRef.current) return;
    const currentScrollLeft = container.scrollLeft;
    if (Math.abs(currentScrollLeft - top.scrollLeft) < 1) return;
    lastTopWriteRef.current = performance.now();
    top.scrollLeft = currentScrollLeft;
  };

  const handleTopScrollbar = () => {
    const container = containerRef.current;
    const top = topScrollbarRef.current;
    if (!container || !top) return;
    // Abaikan event gema dari tulisan kita sendiri (baris di atas).
    if (performance.now() - lastTopWriteRef.current < TOP_SYNC_ECHO_MS) return;
    container.scrollLeft = top.scrollLeft;
  };

  const handleTopPointerDown = () => {
    topTouchingRef.current = true;
    // Buka penjaga gema segera agar tarikan user langsung terasa.
    lastTopWriteRef.current = 0;
  };

  const handleTopPointerUp = () => {
    topTouchingRef.current = false;
  };

  const isDraggingRef = useRef(false);
  const dragMovedRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  // Touch tracking and synthetic click suppression guard for mobile
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const touchMovedRef = useRef(false);
  const touchEndTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (touchEndTimeoutRef.current) {
        clearTimeout(touchEndTimeoutRef.current);
      }
    };
  }, []);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length > 0) {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        time: Date.now(),
      };
      touchMovedRef.current = false;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartRef.current && e.touches.length > 0) {
      const dx = e.touches[0].clientX - touchStartRef.current.x;
      const dy = e.touches[0].clientY - touchStartRef.current.y;
      if (Math.hypot(dx, dy) > 6) {
        touchMovedRef.current = true;
        dragMovedRef.current = true;
      }
    }
  };

  const handleTouchEnd = () => {
    if (touchMovedRef.current) {
      if (touchEndTimeoutRef.current) {
        clearTimeout(touchEndTimeoutRef.current);
      }
      touchEndTimeoutRef.current = setTimeout(() => {
        dragMovedRef.current = false;
        touchMovedRef.current = false;
      }, 120);
    } else {
      dragMovedRef.current = false;
    }
    touchStartRef.current = null;
  };

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
    return getWibDateKey(d1) === getWibDateKey(d2);
  };

  const isToday = (d: Date) => getWibDateKey(d) === getTodayWibDateKey();

  /**
   * Reveal kolom hari terpilih dengan MENGUKUR DOM, bukan konstanta lebar kolom.
   * Konstanta `DAY_COL_WIDTH` (140px) tidak sama dengan lebar riil saat grid
   * memakai `minmax(140px, 1fr)` di layar lebar, sehingga posisi geser lama
   * meleset dan hari tujuan tetap tak terlihat.
   */
  const revealDayColumn = (idx: number, behavior: ScrollBehavior = 'smooth') => {
    const el = containerRef.current;
    const col = dayColumnRefs.current[idx];
    if (!el || !col) return;

    const elRect = el.getBoundingClientRect();
    const colRect = col.getBoundingClientRect();

    // Sudah terlihat penuh di area yang tidak tertutup kolom jam sticky?
    const visibleLeft = elRect.left + TIME_GUTTER;
    if (colRect.left >= visibleLeft - 1 && colRect.right <= elRect.right + 1) return;

    const targetLeft = el.scrollLeft + (colRect.left - elRect.left) - TIME_GUTTER;
    const maxLeft = el.scrollWidth - el.clientWidth;
    el.scrollTo({ left: Math.max(0, Math.min(targetLeft, maxLeft)), behavior });
  };

  const formatHourLabel = formatHourLabelUtil;

  const selectedDateKey = getWibDateKey(selectedDate);

  // Auto-scroll VERTIKAL sekali saat kalender pertama dimuat (posisi jam sekarang).
  // Sumbu horizontal ditangani effect "reveal" di bawah.
  useEffect(() => {
    if (hasAutoScrolledRef.current) return;
    const el = containerRef.current;
    if (!el) return;

    const now = new Date();
    const currentHour = now.getHours();
    const targetHour = Math.max(6, Math.min(currentHour, 20));
    const targetTop = Math.max(0, (targetHour - 6) * hourHeight - HEADER_HEIGHT / 2);
    const maxTop = el.scrollHeight - el.clientHeight;
    el.scrollTop = Math.min(targetTop, Math.max(0, maxTop));

    hasAutoScrolledRef.current = true;
  }, []);

  // Reveal kolom hari terpilih SETIAP kali tanggal berubah — termasuk saat
  // chevron header halaman melompat seminggu (dulu tidak pernah menggeser view).
  // Sekaligus memusatkan pill hari aktif agar Senin/Sabtu selalu terjangkau.
  useEffect(() => {
    const idx = weekDays.findIndex((d) => isSameDay(d, selectedDate));
    if (idx === -1) return;
    revealDayColumn(idx);

    const strip = pillStripRef.current;
    const pill = strip?.querySelector<HTMLElement>('[data-day-pill][data-active="true"]');
    if (!strip || !pill) return;

    const stripRect = strip.getBoundingClientRect();
    const pillRect = pill.getBoundingClientRect();
    const delta = pillRect.left - stripRect.left;
    const target = strip.scrollLeft + delta - (strip.clientWidth - pillRect.width) / 2;
    const max = strip.scrollWidth - strip.clientWidth;
    strip.scrollTo({ left: Math.max(0, Math.min(target, max)), behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDateKey]);

  const minCardHeight = zoomLevel === 'compact' ? 32 : 50;

  return (
    <div className="bg-white dark:bg-[#111b21] rounded-2xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs overflow-hidden flex flex-col relative group/calendar">
      {/* Floating Zoom Controls Bar (Desktop & Tablet) */}
      <div className="absolute top-3 right-3 z-40 hidden sm:block">
        <CalendarZoomControls zoomState={zoomState} variant="floating" />
      </div>

      {/* Top Interactive Day Navigation Bar */}
      <div
        data-horizontal-scroll="true"
        data-no-swipe-back="true"
        className="flex items-center justify-between border-b border-[#e9edef] dark:border-[#2a3942] bg-[#f8fafc] dark:bg-[#182229] px-2 py-1.5 z-30 shrink-0 select-none"
      >
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              const prev = new Date(selectedDate);
              prev.setDate(prev.getDate() - 1);
              // Reveal ditangani effect [selectedDateKey] — aman lintas minggu.
              onSelectDate(prev);
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
          ref={pillStripRef}
          data-horizontal-scroll="true"
          data-no-swipe-back="true"
          className="flex-1 flex items-center justify-start gap-1 overflow-x-auto no-scrollbar mx-1 px-1 py-0.5"
          style={{ scrollbarWidth: 'none', touchAction: 'pan-x pan-y' }}
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
                data-day-pill="true"
                data-active={isSel ? 'true' : 'false'}
                onClick={() => {
                  // Reveal kolom + pusatkan pill ditangani effect [selectedDateKey].
                  onSelectDate(d);
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
            // Reveal ditangani effect [selectedDateKey] — aman lintas minggu.
            onSelectDate(next);
          }}
          className="p-1.5 rounded-lg hover:bg-white dark:hover:bg-[#202c33] border border-transparent hover:border-[#d1d7db] dark:hover:border-[#374248] text-[#54656f] dark:text-[#aebac1] transition-all cursor-pointer"
          title="Hari Berikutnya"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Legenda warna per bidan (hanya tampil bila daftar bidan tersedia) */}
      <StaffColorLegend staffList={staffList} />

      {/* Dedicated Top Horizontal Scrollbar Track (1:1 Synchronized with 1008px Calendar Grid) */}
      <div
        ref={topScrollbarRef}
        data-horizontal-scroll="true"
        data-no-swipe-back="true"
        onScroll={handleTopScrollbar}
        onPointerDown={handleTopPointerDown}
        onPointerUp={handleTopPointerUp}
        onPointerCancel={handleTopPointerUp}
        className="overflow-x-auto overflow-y-hidden h-5 sm:h-3.5 bg-[#f0f2f5] dark:bg-[#111b21] border-b border-[#e9edef] dark:border-[#2a3942] select-none cursor-pointer touch-pan-x"
        style={{
          touchAction: 'pan-x pan-y',
        }}
        title="Geser kalender secara horizontal"
      >
        <div style={{ width: `${GRID_MIN_WIDTH}px`, height: '1px' }} />
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
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        className="cal-2d overflow-x-auto overflow-y-auto max-h-[720px] select-none cursor-grab active:cursor-grabbing"
      >
        <div className="w-full divide-y divide-[#e9edef] dark:divide-[#2a3942]" style={{ minWidth: `${GRID_MIN_WIDTH}px` }}>
          {/* Sticky Header: Day Names & Dates */}
          <div
            className="sticky top-0 z-30 grid divide-x divide-[#e9edef] dark:divide-[#2a3942] border-b border-[#e9edef] dark:border-[#2a3942] bg-[#fafafa] dark:bg-[#182229] shadow-xs"
            style={{ gridTemplateColumns: GRID_TEMPLATE_COLUMNS }}
          >
            {/* Top-left corner box — ikon jam menggantikan teks "GMT+7" */}
            <div
              className="sticky left-0 z-40 bg-[#fafafa] dark:bg-[#182229] border-r border-[#e9edef] dark:border-[#2a3942] flex items-center justify-center p-1 text-[10px] font-bold text-[#8696a0] shadow-[2px_0_5px_rgba(0,0,0,0.06)] dark:shadow-[2px_0_5px_rgba(0,0,0,0.3)]"
              title="Waktu Indonesia Barat (WIB)"
              aria-label="Waktu Indonesia Barat (WIB)"
            >
              <Clock size={12} className="opacity-60" aria-hidden="true" />
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
                  ref={(node) => {
                    dayColumnRefs.current[i] = node;
                  }}
                  data-day-column={i}
                  onClick={() => {
                    if (dragMovedRef.current) return;
                    // Reveal kolom ditangani effect [selectedDateKey].
                    onSelectDate(day);
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
            className="grid divide-x divide-[#e9edef] dark:divide-[#2a3942] relative"
            style={{ gridTemplateColumns: GRID_TEMPLATE_COLUMNS, height: `${HOURS.length * hourHeight}px`, minHeight: `${HOURS.length * hourHeight}px` }}
          >
            {/* Time label column (frozen horizontally on scroll) */}
            <div className="sticky left-0 z-20 bg-[#fafafa] dark:bg-[#182229] divide-y divide-[#e9edef] dark:divide-[#2a3942] border-r border-[#e9edef] dark:border-[#2a3942] shadow-[2px_0_5px_rgba(0,0,0,0.06)] dark:shadow-[2px_0_5px_rgba(0,0,0,0.3)]">
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  style={{ height: `${hourHeight}px` }}
                  className="py-1 pl-0 pr-0.5 text-right text-[10px] sm:text-xs font-semibold font-mono tabular-nums text-[#8696a0] select-none flex items-start justify-end pt-1.5"
                >
                  <span title={formatHourLabelLong(hour)}>{formatHourLabel(hour)}</span>
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
                          if (dragMovedRef.current || touchMovedRef.current) {
                            e.preventDefault();
                            e.stopPropagation();
                            return;
                          }
                          onQuickAdd({ date: day, hour });
                        }}
                        className="w-full h-full absolute inset-0 z-0 border border-transparent hover:border-dashed hover:border-[#008069] dark:hover:border-[#00a884] hover:bg-[#e8f5f2]/40 dark:hover:bg-[#00a884]/15 text-transparent hover:text-[#008069] dark:hover:text-[#00a884] flex items-center justify-center transition-all opacity-0 group-hover/slot:opacity-100 cursor-pointer"
                        title={`Tambah Jadwal pada ${day.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })} jam ${formatHourLabelLong(hour)}`}
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
                    // Warna kartu = bidan penanggung jawab (bukan kategori treatment).
                    const staffColor = getStaffColor(resolveStaffId(res), staffList);
                    const categoryStyles = isHold
                      ? 'bg-amber-50/95 dark:bg-[#33230a] border-2 border-dashed border-amber-500 dark:border-amber-800/40 text-amber-950 dark:text-amber-100 hover:bg-amber-100/90 dark:hover:bg-[#422e0c]'
                      : staffColor.card;

                    // Nama pasien: gelar sapaan dibuang lewat seam tunggal (patientName.ts).
                    const cleanName = stripHonorific(res.customer?.name) || 'Pasien';
                    const firstName = cleanName.split(' ')[0] || cleanName;

                    // Daerah kunjungan (bukan nama treatment) — lihat formatReservationArea.
                    const areaLabel = formatReservationArea(res);

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
                              {startTimeStr}
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
                                  <span className="inline-flex items-center px-1 py-0.2 rounded-full text-[8px] sm:text-[8.5px] font-bold bg-blue-600/10 dark:bg-[#202c33]/20 text-blue-800 dark:text-[#aebac1]">
                                    Sesi {res.session_number}/{res.total_sessions}
                                  </span>
                                )}
                                {res.status === 'hold' ? (
                                  <span className="inline-flex items-center px-1.5 py-0.2 rounded-full text-[8px] sm:text-[8.5px] font-black bg-amber-500 text-slate-950 ring-1 ring-amber-300 dark:ring-amber-300/60 shadow-2xs">
                                    <Clock size={9} className="mr-0.5" />
                                    HOLD
                                  </span>
                                ) : (
                                  <ReservationStatusIcon
                                    status={res.status}
                                    paid={Boolean((res as any).purchase_occurred_at)}
                                  />
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
                              {pos.heightPx >= 58 && areaLabel && (
                                <p
                                  className="text-[10px] opacity-90 font-medium leading-tight flex items-center gap-0.5 min-w-0"
                                  title={areaLabel}
                                >
                                  <MapPin size={9} className="shrink-0 opacity-75" />
                                  <span className="truncate">{areaLabel}</span>
                                </p>
                              )}
                            </div>

                            {/* Baris Bawah: Nama Terapis & Durasi */}
                            <div className="pt-0.5 border-t border-black/10 dark:border-white/10 flex items-center justify-between text-[9px] sm:text-[9.5px] opacity-85 shrink-0">
                              <div className="flex items-center space-x-1 truncate font-semibold text-[#54656f] dark:text-[#aebac1]">
                                <User size={9} className="shrink-0 text-[#008069] dark:text-[#00a884]" />
                                <span className="truncate">
                                  {staffShortName(resolveStaffName(res, staffList)) || 'Unassigned'}
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
