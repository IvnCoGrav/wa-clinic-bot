import React, { useRef, useEffect } from 'react';
import { Reservation } from '../../types';
import { Plus, User, Clock, MapPin, MessageCircle, CheckCircle2, AlertCircle } from 'lucide-react';
import { QuickSlotTarget } from './types';

interface DayScheduleGridProps {
  selectedDate: Date;
  reservations: Reservation[];
  onSelectReservation: (res: Reservation) => void;
  onQuickAdd: (target: QuickSlotTarget) => void;
}

const HOURS = Array.from({ length: 16 }, (_, i) => i + 6); // 6am - 9pm
const HOUR_ROW_HEIGHT = 90; // Standard pixel height for 1 hour

export const DayScheduleGrid: React.FC<DayScheduleGridProps> = ({
  selectedDate,
  reservations,
  onSelectReservation,
  onQuickAdd,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('[data-event-card]') || target.closest('input')) {
      return;
    }
    const container = scrollRef.current;
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
    const container = scrollRef.current;
    if (!container) return;

    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;

    container.scrollLeft = dragStartRef.current.scrollLeft - dx;
    container.scrollTop = dragStartRef.current.scrollTop - dy;
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

  const isSameDay = (d1: Date, d2: Date) => {
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  };

  const extractDurationMinutes = (detail?: string | null): number => {
    if (!detail) return 60;
    const match = detail.match(/(\d+)\s*(?:menit|mins|m)\b/i);
    if (match && match[1]) {
      const parsed = parseInt(match[1], 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return 60;
  };

  const getEventsForHour = (hour: number) => {
    return reservations.filter((r) => {
      if (!r.booking_date) return false;
      const bDate = new Date(r.booking_date);
      return isSameDay(bDate, selectedDate) && bDate.getHours() === hour;
    });
  };

  const formatHourLabel = (hour: number) => {
    if (hour === 12) return '12:00 PM';
    if (hour > 12) return `${(hour - 12).toString().padStart(2, '0')}:00 PM`;
    return `${hour.toString().padStart(2, '0')}:00 AM`;
  };

  const dayDateFormatted = selectedDate.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const getCategoryTheme = (cat: string) => {
    switch (cat) {
      case 'MOMS':
        return {
          card: 'bg-[#f3e8ff] border-l-4 border-[#9333ea] text-[#581c87]',
          badge: 'bg-[#9333ea]/10 text-[#9333ea]',
        };
      case 'BOTH':
        return {
          card: 'bg-[#dcfce7] border-l-4 border-[#16a34a] text-[#14532d]',
          badge: 'bg-[#16a34a]/10 text-[#16a34a]',
        };
      case 'KIDS':
        return {
          card: 'bg-[#ccfbf1] border-l-4 border-[#0d9488] text-[#115e59]',
          badge: 'bg-[#0d9488]/10 text-[#0d9488]',
        };
      case 'BUNDLE':
        return {
          card: 'bg-[#fef3c7] border-l-4 border-[#d97706] text-[#78350f]',
          badge: 'bg-[#d97706]/10 text-[#d97706]',
        };
      case 'BABY':
      default:
        return {
          card: 'bg-[#e0f2fe] border-l-4 border-[#0284c7] text-[#0c4a6e]',
          badge: 'bg-[#0284c7]/10 text-[#0284c7]',
        };
    }
  };

  // Auto-scroll ke jam jadwal paling awal hari ini atau jam 8 pagi
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const dayAppointments = reservations.filter((r) => {
      if (!r.booking_date) return false;
      return isSameDay(new Date(r.booking_date), selectedDate);
    });

    let targetHour = 8;
    if (dayAppointments.length > 0) {
      const earliestHour = Math.min(
        ...dayAppointments.map((r) => new Date(r.booking_date!).getHours())
      );
      targetHour = Math.max(6, Math.min(earliestHour, 18));
    }

    const hourIndex = Math.max(0, targetHour - 6);
    const targetTop = Math.max(0, hourIndex * HOUR_ROW_HEIGHT - 20);
    const maxTop = el.scrollHeight - el.clientHeight;
    el.scrollTop = Math.min(targetTop, Math.max(0, maxTop));
  }, [reservations, selectedDate]);

  return (
    <div className="bg-white rounded-2xl border border-[#e9edef] shadow-xs overflow-hidden flex flex-col">
      {/* Day Header Banner */}
      <div className="p-4 border-b border-[#e9edef] bg-[#fafafa] flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0">
        <div>
          <h3 className="font-extrabold text-base sm:text-lg text-[#111b21]">
            {dayDateFormatted}
          </h3>
          <p className="text-xs text-[#667781] mt-0.5">
            Agenda jadwal kunjungan &amp; perawatan harian
          </p>
        </div>
        <button
          onClick={() => onQuickAdd({ date: selectedDate, hour: 9 })}
          className="self-start sm:self-auto px-3.5 py-1.5 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white text-xs font-semibold flex items-center space-x-1.5 shadow-xs transition-all cursor-pointer"
        >
          <Plus size={14} />
          <span>+ Tambah di Tanggal Ini</span>
        </button>
      </div>

      {/* Hourly Timeline with Absolute Multi-Hour Spanning & 2D Drag Panning */}
      <div
        ref={scrollRef}
        data-horizontal-scroll="true"
        data-no-swipe-back="true"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="divide-y divide-[#e9edef] max-h-[720px] overflow-y-auto select-none cursor-grab active:cursor-grabbing"
        style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y' }}
      >
        {HOURS.map((hour) => {
          const events = getEventsForHour(hour);

          return (
            <div
              key={hour}
              className="grid grid-cols-[80px_1fr] sm:grid-cols-[100px_1fr] h-[90px] min-h-[90px] divide-x divide-[#e9edef] group"
            >
              {/* Hour Label (Sticky horizontally on the left) */}
              <div className="sticky left-0 z-20 p-3 text-right pr-4 text-xs font-semibold text-[#8696a0] bg-[#fafafa] select-none flex items-start justify-end border-r border-[#e9edef] shadow-[2px_0_5px_rgba(0,0,0,0.06)]">
                <span>{formatHourLabel(hour)}</span>
              </div>

              {/* Event slot cell */}
              <div className="relative transition-colors group/slot h-[90px] hover:bg-gray-50/40">
                {/* Empty Slot Hover Quick-Add Button (Always available behind cards) */}
                <button
                  onClick={() => onQuickAdd({ date: selectedDate, hour })}
                  className="w-full h-full absolute inset-0 z-0 border border-transparent hover:border-dashed hover:border-[#008069] hover:bg-[#e8f5f2]/40 text-transparent hover:text-[#008069] text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all opacity-0 group-hover/slot:opacity-100 cursor-pointer"
                  title={`Tambah Jadwal pada jam ${formatHourLabel(hour)}`}
                >
                  <Plus size={14} className="transform scale-90 group-hover/slot:scale-110 transition-transform" />
                  <span>+ Tambah Jadwal</span>
                </button>

                {/* Event Cards: Absolutely positioned & Spanning proportionally out of the cell */}
                {events.map((res, evIdx) => {
                  const theme = getCategoryTheme(res.treatment_category);
                  const bDate = new Date(res.booking_date!);
                  const duration = extractDurationMinutes(res.treatment_detail);
                  const endDate = new Date(bDate.getTime() + duration * 60000);
                  const startTimeStr = bDate
                    .toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false })
                    .replace('.', ':');
                  const endTimeStr = endDate
                    .toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false })
                    .replace('.', ':');
                  const timeRangeStr = `${startTimeStr} - ${endTimeStr}`;

                  const rawName = res.customer?.name || 'Pasien';
                  const cleanName = rawName
                    .replace(/^(?:Bunda|Ibu|Ny\.|Nn\.|Sdri\.|Mama|Mom|Moms)\s+/i, '')
                    .trim();
                  const displayName = cleanName || rawName;

                  const cleanDetail = (res.treatment_detail || 'Layanan Perawatan')
                    .replace(/\[\s*(?:total\s*)?buffer\s*=[^\]]*\]/gi, '')
                    .replace(/\[\s*total\s*\d+\s*m?\s*\+\s*buffer\s*\d+\s*m?\s*=\s*\d+\s*m?\s*\]/gi, '')
                    .trim();

                  // Posisi menit awal (0..59) dan tinggi proporsional durasi
                  const startMinutes = bDate.getMinutes();
                  const topOffsetPx = Math.round((startMinutes / 60) * HOUR_ROW_HEIGHT);
                  const heightPx = Math.max(54, Math.round((duration / 60) * HOUR_ROW_HEIGHT - 6));
                  const evCount = events.length;
                  const evWidth = evCount > 1 ? `calc(${100 / evCount}% - 8px)` : 'calc(100% - 12px)';
                  const evLeft = evCount > 1 ? `calc(${(evIdx * 100) / evCount}% + 4px)` : '6px';

                  return (
                    <div
                      key={res.id}
                      data-event-card="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectReservation(res);
                      }}
                      style={{
                        top: `${topOffsetPx + 3}px`,
                        height: `${heightPx}px`,
                        left: evLeft,
                        width: evWidth,
                      }}
                      className={`absolute z-10 p-3 rounded-xl transition-all cursor-pointer shadow-md hover:shadow-lg hover:z-15 ring-1 ring-black/5 flex flex-col justify-between overflow-hidden ${theme.card}`}
                    >
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                            <span className="font-bold text-sm text-[#111b21] truncate">
                              {displayName}
                            </span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${theme.badge}`}>
                              {res.treatment_category}
                            </span>
                            <span className="text-xs font-bold flex items-center space-x-1 font-mono opacity-85">
                              <Clock size={12} />
                              <span>{timeRangeStr}</span>
                            </span>
                            <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-black/5 font-mono">
                              {duration}m
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

                          <p className="text-xs font-semibold opacity-95 line-clamp-1">
                            {cleanDetail}
                          </p>

                          {res.customer?.kelurahan && (
                            <div className="flex items-center space-x-1 text-[11px] opacity-80">
                              <MapPin size={12} />
                              <span>
                                {res.customer.kelurahan}, {res.customer.kecamatan} ({res.customer.distance_km?.toFixed(1) || '0'} km)
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center space-x-3 self-end md:self-auto shrink-0">
                          <div className="flex items-center space-x-1 text-xs font-bold bg-white/80 px-2.5 py-1 rounded-lg border border-black/10">
                            <User size={12} className="text-[#008069]" />
                            <span>{res.assigned_staff?.name || 'Belum ada terapis'}</span>
                          </div>
                          {res.customer?.phone && (
                            <a
                              href={`https://wa.me/${res.customer.phone.replace(/\D/g, '')}`}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="p-2 rounded-xl bg-white hover:bg-[#008069] text-[#111b21] hover:text-white border border-[#d1d7db] shadow-xs transition-all cursor-pointer"
                              title="Chat WhatsApp Pasien"
                            >
                              <MessageCircle size={14} />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
