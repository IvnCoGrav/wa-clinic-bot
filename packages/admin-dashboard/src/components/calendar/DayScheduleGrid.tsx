import React, { useRef, useEffect, useState } from 'react';
import { Reservation } from '../../types';
import { Plus, User, MapPin } from 'lucide-react';
import { QuickSlotTarget, StaffOption } from './types';
import { useCalendarZoom } from '../../hooks/useCalendarZoom';
import { CalendarZoomControls } from './CalendarZoomControls';
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

  // Tema kartu kini mengikuti bidan penanggung jawab (getStaffColor), bukan kategori treatment.

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
    <div className={`${hideHeader ? 'flex-1 min-h-0' : 'bg-white dark:bg-[#111b21] rounded-2xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs'} overflow-hidden flex flex-col relative group/calendar`}>
      {/* Day Header Banner with Integrated Zoom Controls */}
      {!hideHeader && (
        <div className="p-2.5 sm:p-4 border-b border-[#e9edef] dark:border-[#2a3942] bg-[#fafafa] dark:bg-[#182229] flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-2.5 shrink-0">
          <div>
            <h3 className="font-extrabold text-sm sm:text-lg text-[#111b21] dark:text-[#e9edef]">
              {dayDateFormatted}
            </h3>
            <p className="hidden sm:block text-xs text-[#667781] dark:text-[#8696a0] mt-0.5">
              Agenda jadwal kunjungan &amp; perawatan harian
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
            {/* Zoom Controls Bar */}
            <CalendarZoomControls zoomState={zoomState} variant="inline" />

            <button
              onClick={() => onQuickAdd({ date: selectedDate, hour: 9 })}
              aria-label="Tambah jadwal di tanggal ini"
              title="Tambah jadwal di tanggal ini"
              className="px-2.5 py-1 min-h-9 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white text-[11px] font-semibold flex items-center space-x-1.5 shadow-xs transition-all cursor-pointer"
            >
              <Plus size={14} />
              <span className="hidden sm:inline">+ Tambah di Tanggal Ini</span>
            </button>
          </div>
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
          className="grid grid-cols-[28px_1fr] sm:grid-cols-[44px_1fr] divide-x divide-[#e9edef] dark:divide-[#2a3942] relative"
          style={{ height: `${HOURS.length * hourHeight}px`, minHeight: `${HOURS.length * hourHeight}px` }}
        >
          {/* Hour Label Column (Sticky left) */}
          <div className="sticky left-0 z-20 divide-y divide-[#e9edef] dark:divide-[#2a3942] border-r border-[#e9edef] dark:border-[#2a3942] shadow-[2px_0_5px_rgba(0,0,0,0.06)] dark:shadow-[2px_0_5px_rgba(0,0,0,0.3)]">
            {HOURS.map((hour) => {
              const isOp = hour >= 8 && hour <= 17 && hour !== 12;
              return (
                <div
                  key={hour}
                  style={{ height: `${hourHeight}px` }}
                  className={`py-1 sm:py-2 text-right pl-0 pr-0.5 text-[10px] sm:text-xs font-semibold font-mono tabular-nums select-none flex items-start justify-end ${isOp ? 'bg-[#fafafa] dark:bg-[#182229] text-[#8696a0]' : 'bg-[#f0f0f0] dark:bg-[#111b21] text-[#a0a0a0] dark:text-[#54656f] italic'}`}
                >
                  <span title={formatHourLabelLong(hour)}>{formatHourLabel(hour)}</span>
                </div>
              );
            })}
          </div>

          {/* Continuous Day Column */}
          <div className="relative divide-y divide-[#e9edef] dark:divide-[#2a3942]">
            {/* Background Hourly Slot Grids & Hover Add Buttons */}
            {HOURS.map((hour) => {
              const isOp = hour >= 8 && hour <= 17 && hour !== 12;
              return (
                <div
                  key={hour}
                  style={{ height: `${hourHeight}px` }}
                  className={`relative group/slot transition-colors ${
                    isOp
                      ? 'hover:bg-[#e8f5f2]/30 dark:hover:bg-[#202c33]/40 bg-white dark:bg-[#111b21]'
                      : 'bg-[#f5f5f5] dark:bg-[#141e24] bg-[repeating-linear-gradient(45deg,#f5f5f5,#f5f5f5_8px,#ebebeb_8px,#ebebeb_9px)] dark:bg-[repeating-linear-gradient(45deg,#141e24,#141e24_8px,#1c2830_8px,#1c2830_9px)]'
                  }`}
                >
                  <button
                    onClick={() => onQuickAdd({ date: selectedDate, hour })}
                    className={`w-full h-full absolute inset-0 z-0 border border-transparent text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all opacity-0 group-hover/slot:opacity-100 cursor-pointer ${
                      isOp
                        ? 'hover:border-dashed hover:border-[#008069] dark:hover:border-[#00a884] hover:bg-[#e8f5f2]/40 dark:hover:bg-[#00a884]/15 hover:text-[#008069] dark:hover:text-[#00a884]'
                        : 'hover:border-dashed hover:border-[#a0a0a0] dark:hover:border-[#374248] hover:bg-[#e0e0e0]/50 dark:hover:bg-[#202c33]/50 hover:text-[#666] dark:hover:text-[#8696a0] text-[#a0a0a0] dark:text-[#54656f]'
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
                <div className="w-2 h-2 rounded-full bg-red-500 -ml-1 shrink-0" />
                <div className="flex-1 border-t-2 border-red-500" />
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
              // F-33: rentang jam & durasi dibuang — gutter jam di sebelah kiri sudah
              // menunjukkan waktunya, dan tinggi kartu sudah mewakili durasi.
              const categoryMeta = getTreatmentCategoryMeta(res.treatment_category);
              const CategoryIcon = categoryMeta?.Icon;
              const isPaid = Boolean((res as any).purchase_occurred_at);
              // F-32: elemen dibuang dari prioritas terendah (detail → area) agar
              // baris bidan di bawah TIDAK terpotong. Baris bidan tidak pernah dibatasi LOD.
              const { showDetail: canShowDetail, showArea: canShowArea } = computeDayCardLod(pos.heightPx);

              // Nama pasien: gelar sapaan dibuang lewat seam tunggal (patientName.ts).
              const displayName = stripHonorific(res.customer?.name) || 'Pasien';
              const cleanDetail = cleanTreatmentDetailForDisplay(res.treatment_detail, res.treatment_category);
              // Daerah kunjungan — kelurahan saja (F-33); cadangan kecamatan.
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
                ? 'bg-amber-50/95 dark:bg-[#33230a] border-2 border-dashed border-amber-500 dark:border-amber-800/40 text-amber-950 dark:text-amber-100 hover:bg-amber-100/90 dark:hover:bg-[#422e0c]'
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
                        <span className={`font-bold text-xs truncate ${isHold ? 'text-amber-950 dark:text-amber-100' : 'text-[#111b21] dark:text-[#e9edef]'}`}>
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
                        <span className="text-[10px] font-semibold text-[#54656f] dark:text-[#aebac1]">
                          {staffShortName(resolveStaffName(res, staffList)) || 'Unassigned'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    /* STANDARD & DETAILED DAY LOD */
                    /* F-32: tinggi kartu lebih kecil dari tinggi isi → dulu `justify-between`
                     * + `overflow-hidden` memotong elemen TERAKHIR (nama bidan). Kini isi
                     * disusun vertikal dan elemen dibuang berurutan dari prioritas terendah:
                     * nama → jam mulai → bidan → area → detail treatment. Bidan dibuang paling akhir. */
                    <div className="flex flex-col h-full min-h-0 gap-0.5">
                      <div className="flex items-center gap-1.5 min-w-0 shrink-0 overflow-hidden">
                        <span className={`font-bold text-sm truncate min-w-0 ${isHold ? 'text-amber-950 dark:text-amber-100' : 'text-[#111b21] dark:text-[#e9edef]'}`}>
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
                          <span className="inline-flex items-center px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-blue-600/10 dark:bg-[#202c33]/20 text-blue-800 dark:text-[#aebac1] shrink-0">
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

                      {/* Baris paling bawah = bidan penanggung jawab (permintaan user). */}
                      <div className="mt-auto flex items-center gap-1 min-w-0 shrink-0 text-[11px] font-bold">
                        <User size={11} className="shrink-0 text-[#008069] dark:text-[#00a884]" />
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
