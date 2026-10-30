import React, { useRef, useEffect, useState } from 'react';
import { Reservation } from '../../types';
import { Plus, User, MapPin, ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';
import { QuickSlotTarget, StaffOption } from './types';
import { useCalendarZoom } from '../../hooks/useCalendarZoom';
import { StaffColorLegend } from './StaffColorLegend';
import { ReservationStatusIcon } from './ReservationStatusIcon';
import { getWibDateKey, getWibHoursAndMinutes, getTodayWibDateKey } from '../../utils/dateWib';

interface DayScheduleGridProps {
  selectedDate: Date;
  reservations: Reservation[];
  onSelectReservation: (res: Reservation) => void;
  onQuickAdd: (target: QuickSlotTarget) => void;
  hideHeader?: boolean;
  /** Daftar bidan tenant — sumber warna kartu & lookup nama terapis. */
  staffList?: StaffOption[];
  onPrevDate?: () => void;
  onNextDate?: () => void;
  onToday?: () => void;
  onSelectDate?: (date: Date) => void;
}

import { cleanTreatmentDetailForDisplay, resolveReservationDuration } from '../../utils/durationCalculator';
import { resolveStaffId, resolveStaffName, staffDisplayName, staffShortName } from '../../utils/resolveStaffName';
import { formatReservationKelurahan } from '../../utils/reservationAddress';
import { getStaffColor } from '../../utils/staffColors';
import { getTreatmentCategoryMeta } from '../../utils/treatmentCategoryIcon';
import { computeDayCardLod } from '../../utils/calendarCardLod';
import { stripHonorific } from '../../utils/patientName';
import { computeNowTopPx } from '../../utils/calendarTimePosition';
import {
  formatHourLabel as formatHourLabelUtil,
  formatHourLabelLong,
} from '../../utils/calendarHourLabel';

const HOURS = Array.from({ length: 16 }, (_, i) => i + 6); // 6am - 9pm

export const DayScheduleGrid: React.FC<DayScheduleGridProps> = ({
  selectedDate,
  reservations,
  onSelectReservation,
  onQuickAdd,
  hideHeader = false,
  staffList = [],
  onPrevDate,
  onNextDate,
  onToday,
  onSelectDate,
}) => {
  const zoomState = useCalendarZoom();
  const { hourHeight, zoomLevel, containerRef } = zoomState;

  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  /**
   * Fase 3 queue: penanda waktu sekarang. Diperbarui tiap menit dan SELALU
   * dibersihkan saat unmount (risiko kebocoran `setInterval`).
   * Jam diambil dari WIB, bukan jam perangkat, agar konsisten dengan posisi
   * jadwal yang juga dihitung dari WIB.
   */
  const [nowTick, setNowTick] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNowTick(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const nowWib = getWibHoursAndMinutes(nowTick);
  const isToday = getWibDateKey(selectedDate) === getTodayWibDateKey();
  const nowTopPx = isToday ? computeNowTopPx(nowWib.hours, nowWib.minutes, hourHeight) : null;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('[data-event-card]') || target.closest('input') || target.closest('a')) {
      return;
    }
    const container = containerRef.current;
    if (!container) return;

    isDraggingRef.current = true;
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
    };
    container.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const container = containerRef.current;
    if (!container) return;

    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;

    container.scrollLeft = dragStartRef.current.scrollLeft - dx;
    container.scrollTop = dragStartRef.current.scrollTop - dy;
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

  const isSameDay = (d1: Date, d2: Date) => {
    return getWibDateKey(d1) === getWibDateKey(d2);
  };

  const formatHourLabel = formatHourLabelUtil;

  const dayDateFormatted = selectedDate.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });

  // Auto-scroll ke jam jadwal paling awal hari ini atau jam 8 pagi
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const dayAppointments = reservations.filter((r) => {
      if (!r.booking_date) return false;
      return isSameDay(new Date(r.booking_date), selectedDate);
    });

    let targetHour = 8;
    if (dayAppointments.length > 0) {
      const earliestHour = Math.min(
        ...dayAppointments.map((r) => getWibHoursAndMinutes(r.booking_date!).hours)
      );
      targetHour = Math.max(6, Math.min(earliestHour, 18));
    }

    const hourIndex = Math.max(0, targetHour - 6);
    const targetTop = Math.max(0, hourIndex * hourHeight - 20);
    const maxTop = el.scrollHeight - el.clientHeight;
    el.scrollTop = Math.min(targetTop, Math.max(0, maxTop));
  }, [reservations, selectedDate, hourHeight]);

  const minCardHeight = zoomLevel === 'compact' ? 36 : 52;
  const dayReservations = reservations.filter(
    (r) => r.booking_date && isSameDay(new Date(r.booking_date), selectedDate)
  );

  // Clustering and layout for day events
  const eventsWithTiming = dayReservations
    .map((r) => {
      const { hours, minutes } = getWibHoursAndMinutes(r.booking_date!);
      const duration = resolveReservationDuration(r);
      const startMinutes = (hours - 6) * 60 + minutes;
      const endMinutes = startMinutes + duration;
      return { res: r, startMinutes, endMinutes, duration };
    })
    .sort((a, b) => a.startMinutes - b.startMinutes || b.duration - a.duration);

  const positionedEvents: Array<{
    res: Reservation;
    startMinutes: number;
    endMinutes: number;
    duration: number;
    topPx: number;
    heightPx: number;
    colIndex: number;
    totalCols: number;
  }> = [];

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
      positionedEvents.push({
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

  return (
    <div className={`${hideHeader ? 'flex-1 min-h-0' : 'bg-surface rounded-none border-y border-x-0 border-divider shadow-xs sm:rounded-2xl sm:border-x'} overflow-visible sm:overflow-hidden flex flex-col relative group/calendar`}>
      {/* Sticky Day Header Banner: Tanggal (Kiri) & View Hari Itu (Kanan) */}
      {!hideHeader && (
        <div className="sticky top-[calc(3rem+env(safe-area-inset-top,0px))] md:top-[calc(3.25rem+env(safe-area-inset-top,0px))] z-30 px-3 py-2 sm:px-4 sm:py-2.5 border-b border-divider bg-surface/95 dark:bg-surface/95 backdrop-blur-md flex items-center justify-between gap-2 shrink-0 shadow-xs">
          {/* Sisi Kiri: Tanggal */}
          <div className="min-w-0 pr-1">
            <h3 className="font-extrabold text-xs sm:text-base text-ink capitalize tracking-tight truncate">
              <span className="sm:hidden">
                {selectedDate.toLocaleDateString('id-ID', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  timeZone: 'Asia/Jakarta',
                })}
              </span>
              <span className="hidden sm:inline">
                {dayDateFormatted}
              </span>
            </h3>
            <p className="hidden sm:block text-[11px] text-ink-3">
              Agenda jadwal kunjungan &amp; perawatan harian
            </p>
          </div>

          {/* Sisi Kanan: View Hari Itu (< Hari Ini > [📅]) */}
          {onPrevDate && onNextDate && onToday && onSelectDate && (
            <div className="flex items-center space-x-1 bg-fill-1 dark:bg-fill-2 p-0.5 rounded-lg border border-divider shrink-0">
              <button
                type="button"
                onClick={onPrevDate}
                className="p-1 rounded-md bg-surface text-ink hover:bg-fill-2 dark:hover:bg-fill-1 shadow-2xs transition-colors cursor-pointer touch-manipulation"
                title="Hari Sebelumnya"
                aria-label="Hari Sebelumnya"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                onClick={onToday}
                className="px-2 py-0.5 rounded-md bg-surface text-[11px] font-bold text-ink shadow-2xs transition-colors cursor-pointer whitespace-nowrap touch-manipulation"
              >
                Hari Ini
              </button>
              <button
                type="button"
                onClick={onNextDate}
                className="p-1 rounded-md bg-surface text-ink hover:bg-fill-2 dark:hover:bg-fill-1 shadow-2xs transition-colors cursor-pointer touch-manipulation"
                title="Hari Berikutnya"
                aria-label="Hari Berikutnya"
              >
                <ChevronRight size={14} />
              </button>
              <div className="relative flex items-center">
                <input
                  type="date"
                  value={getWibDateKey(selectedDate)}
                  onChange={(e) => {
                    if (e.target.value) {
                      const [y, m, d] = e.target.value.split('-').map(Number);
                      onSelectDate(new Date(y, m - 1, d));
                    }
                  }}
                  className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10"
                  title="Pilih Tanggal Spesifik"
                  aria-label="Pilih Tanggal Spesifik"
                />
                <button
                  type="button"
                  className="p-1 rounded-md bg-surface hover:bg-accent-soft text-ink-2 hover:text-accent shadow-2xs transition-colors cursor-pointer touch-manipulation"
                  title="Pilih Tanggal Spesifik"
                  aria-label="Pilih Tanggal Spesifik"
                >
                  <CalendarIcon size={13} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Legenda warna per bidan (hanya tampil bila daftar bidan tersedia) */}
      {!hideHeader && <StaffColorLegend staffList={staffList} />}

      {/* Hourly Timeline with Continuous Multi-Hour Column Canvas */}
      <div
        ref={containerRef}
        data-horizontal-scroll="true"
        data-no-swipe-back="true"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`${hideHeader ? 'flex-1 min-h-0' : 'max-h-[720px]'} overflow-y-auto select-none cursor-grab active:cursor-grabbing`}
        style={{ touchAction: 'pan-y', overscrollBehaviorY: 'auto' }}
      >
        <div
          className="grid grid-cols-[28px_1fr] sm:grid-cols-[44px_1fr] divide-x divide-divider relative"
          style={{ height: `${HOURS.length * hourHeight}px`, minHeight: `${HOURS.length * hourHeight}px` }}
        >
          {/* Hour Label Column (Sticky left) */}
          <div className="sticky left-0 z-20 divide-y divide-divider border-r border-divider shadow-[2px_0_5px_rgba(0,0,0,0.06)] dark:shadow-[2px_0_5px_rgba(0,0,0,0.3)]">
            {HOURS.map((hour) => {
              const isOp = hour >= 8 && hour <= 17 && hour !== 12;
              return (
                <div
                  key={hour}
                  style={{ height: `${hourHeight}px` }}
                  className={`py-1 sm:py-2 text-right pl-0 pr-0.5 text-[10px] sm:text-xs font-semibold font-mono tabular-nums select-none flex items-start justify-end ${isOp ? 'bg-surface-2 text-ink-3' : 'bg-app text-ink-3 italic'}`}
                >
                  <span title={formatHourLabelLong(hour)}>{formatHourLabel(hour)}</span>
                </div>
              );
            })}
          </div>

          {/* Continuous Day Column */}
          <div className="relative divide-y divide-divider">
            {/* Background Hourly Slot Grids & Hover Add Buttons */}
            {HOURS.map((hour) => {
              const isOp = hour >= 8 && hour <= 17 && hour !== 12;
              return (
                <div
                  key={hour}
                  style={{ height: `${hourHeight}px` }}
                  className={`relative group/slot transition-colors ${
                    isOp
                      ? 'hover:bg-accent-soft/30 bg-surface'
                      : 'bg-app'
                  }`}
                >
                  <button
                    onClick={() => onQuickAdd({ date: selectedDate, hour })}
                    className={`w-full h-full absolute inset-0 z-0 border border-transparent text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all opacity-0 group-hover/slot:opacity-100 cursor-pointer ${
                      isOp
                        ? 'hover:border-dashed hover:border-accent hover:bg-accent-soft/40 hover:text-accent'
                        : 'hover:border-dashed hover:border-divider hover:bg-fill-1 hover:text-ink-2 text-ink-3'
                    }`}
                    title={isOp ? `Tambah Jadwal pada jam ${formatHourLabelLong(hour)}` : `Jam non-operasional ${formatHourLabelLong(hour)}`}
                  >
                    <Plus size={14} className="transform scale-90 group-hover/slot:scale-110 transition-transform" />
                    <span>{isOp ? '+ Tambah Jadwal' : 'Non-ops'}</span>
                  </button>
                </div>
              );
            })}

            {/* Penanda waktu sekarang (Fase 3 queue) — digambar DI DALAM kolom hari
             * agar tidak menimpa gutter jam, dan `top` terikat `hourHeight` (zoom). */}
            {nowTopPx !== null && (
              <div
                className="absolute left-0 right-0 z-30 pointer-events-none flex items-center"
                style={{ top: `${nowTopPx}px` }}
                aria-hidden="true"
              >
                <div className="w-2 h-2 rounded-full bg-danger -ml-1 shrink-0" />
                <div className="flex-1 border-t-2 border-danger" />
              </div>
            )}

            {/* Absolute Continuous Event Blocks Spanning Multi-Hours */}
            {positionedEvents.map((pos) => {
              const res = pos.res;
              // Warna kartu = bidan penanggung jawab (bukan kategori treatment).
              const staffColor = getStaffColor(resolveStaffId(res), staffList);
              const bDate = new Date(res.booking_date!);
              const startTimeStr = bDate
                .toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false })
                .replace('.', ':');
              const categoryMeta = getTreatmentCategoryMeta(res.treatment_category);
              const CategoryIcon = categoryMeta?.Icon;
              // `undefined` (bukan `false`) saat kolom kosong: absennya `purchase_occurred_at`
  // berarti "tidak tercatat", bukan bukti "belum lunas".
  const isPaid: boolean | undefined = (res as any).purchase_occurred_at ? true : undefined;
              const { showDetail: canShowDetail, showArea: canShowArea } = computeDayCardLod(pos.heightPx);

              const displayName = stripHonorific(res.customer?.name) || 'Pasien';
              const cleanDetail = cleanTreatmentDetailForDisplay(res.treatment_detail, res.treatment_category);
              const areaLabel = formatReservationKelurahan(res);
              const distanceKm =
                typeof res.customer?.distance_km === 'number' && Number.isFinite(res.customer.distance_km)
                  ? res.customer.distance_km
                  : null;

              const evWidth =
                pos.totalCols > 1
                  ? `calc(${100 / pos.totalCols}% - 8px)`
                  : 'calc(100% - 12px)';
              const evLeft =
                pos.totalCols > 1
                  ? `calc(${(pos.colIndex * 100) / pos.totalCols}% + 4px)`
                  : '6px';

              const isHold = res.status === 'hold';
              const effectiveCardStyle = isHold
                ? 'bg-warning-soft border-2 border-dashed border-warning-line text-warning hover:bg-warning-soft/90'
                : staffColor.card;

              return (
                <div
                  key={res.id}
                  data-event-card="true"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectReservation(res);
                  }}
                  style={{
                    top: `${pos.topPx + 2}px`,
                    height: `${pos.heightPx}px`,
                    left: evLeft,
                    width: evWidth,
                  }}
                  className={`absolute z-10 p-1.5 sm:p-2.5 rounded-xl transition-all cursor-pointer shadow-md hover:shadow-lg hover:z-20 ring-1 ring-black/5 dark:ring-white/10 flex flex-col overflow-hidden ${effectiveCardStyle}`}
                >
                  {zoomLevel === 'compact' ? (
                    /* COMPACT DAY LOD (<65px) */
                    <div className="flex items-center justify-between gap-2 h-full">
                      <div className="flex items-center space-x-1.5 min-w-0">
                        <span className={`font-bold text-xs truncate ${isHold ? 'text-warning' : 'text-ink'}`}>
                          {isHold ? `[HOLD] ${displayName}` : displayName}
                        </span>
                        <span className="text-[10px] font-mono font-bold opacity-80 shrink-0">
                          {startTimeStr}
                        </span>
                      </div>
                      <div className="flex items-center space-x-1 shrink-0">
                        {CategoryIcon && categoryMeta && (
                          <span
                            role="img"
                            aria-label={categoryMeta.label}
                            title={categoryMeta.label}
                            className={`inline-flex items-center justify-center p-0.5 rounded-full ${staffColor.badge}`}
                          >
                            <CategoryIcon size={11} aria-hidden="true" />
                          </span>
                        )}
                        <span className="text-[10px] font-semibold text-ink-2">
                          {staffShortName(resolveStaffName(res, staffList)) || 'Unassigned'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    /* STANDARD & DETAILED DAY LOD */
                    <div className="flex flex-col h-full min-h-0 gap-0.5">
                      <div className="flex items-center gap-1.5 min-w-0 shrink-0 overflow-hidden">
                        <span className={`font-bold text-sm truncate min-w-0 ${isHold ? 'text-warning' : 'text-ink'}`}>
                          {displayName}
                        </span>
                        <span className="text-[10px] font-mono font-bold opacity-80 shrink-0">
                          {startTimeStr}
                        </span>
                        {CategoryIcon && categoryMeta && (
                          <span
                            role="img"
                            aria-label={categoryMeta.label}
                            title={categoryMeta.label}
                            className={`inline-flex items-center justify-center p-0.5 rounded-full shrink-0 ${staffColor.badge}`}
                          >
                            <CategoryIcon size={12} aria-hidden="true" />
                          </span>
                        )}
                        {res.session_number != null && res.total_sessions != null && (
                          <span className="inline-flex items-center px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-info-soft text-info shrink-0">
                            Sesi {res.session_number}/{res.total_sessions}
                          </span>
                        )}
                        <ReservationStatusIcon status={res.status} paid={isPaid} />
                      </div>

                      {canShowDetail && (
                        <p className="text-xs font-semibold opacity-95 truncate shrink-0">
                          {cleanDetail}
                        </p>
                      )}

                      {canShowArea && areaLabel && (
                        <div className="flex items-center space-x-1 text-[11px] opacity-80 min-w-0 shrink-0">
                          <MapPin size={11} className="shrink-0" />
                          <span className="truncate" title={areaLabel}>
                            {areaLabel}
                            {distanceKm !== null ? ` (${distanceKm.toFixed(1)} km)` : ''}
                          </span>
                        </div>
                      )}

                      {/* Baris paling bawah = bidan penanggung jawab */}
                      <div className="mt-auto flex items-center gap-1 min-w-0 shrink-0 text-[11px] font-bold">
                        <User size={11} className="shrink-0 text-accent" />
                        <span className="truncate" title={resolveStaffName(res, staffList) || undefined}>
                          {staffDisplayName(resolveStaffName(res, staffList)) || 'Belum ada terapis'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
