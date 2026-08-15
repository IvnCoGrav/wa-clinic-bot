import React from 'react';
import { Reservation } from '../../types';
import { Plus, User, Clock, MapPin, Baby, MessageCircle } from 'lucide-react';
import { QuickSlotTarget } from './types';

interface DayScheduleGridProps {
  selectedDate: Date;
  reservations: Reservation[];
  onSelectReservation: (res: Reservation) => void;
  onQuickAdd: (target: QuickSlotTarget) => void;
}

const HOURS = Array.from({ length: 16 }, (_, i) => i + 6); // 6am - 9pm

export const DayScheduleGrid: React.FC<DayScheduleGridProps> = ({
  selectedDate,
  reservations,
  onSelectReservation,
  onQuickAdd,
}) => {
  const isSameDay = (d1: Date, d2: Date) => {
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
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

  return (
    <div className="bg-white rounded-2xl border border-[#e9edef] shadow-xs overflow-hidden">
      {/* Day Header Banner */}
      <div className="p-4 border-b border-[#e9edef] bg-[#fafafa] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h3 className="font-extrabold text-base sm:text-lg text-[#111b21]">
            {dayDateFormatted}
          </h3>
          <p className="text-xs text-[#667781] mt-0.5">
            Agenda jadwal kunjungan & perawatan harian
          </p>
        </div>
        <button
          onClick={() => onQuickAdd({ date: selectedDate, hour: 9 })}
          className="self-start sm:self-auto px-3.5 py-1.5 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white text-xs font-semibold flex items-center space-x-1.5 shadow-xs transition-all"
        >
          <Plus size={14} />
          <span>+ Tambah di Tanggal Ini</span>
        </button>
      </div>

      {/* Hourly Timeline */}
      <div className="divide-y divide-[#e9edef] max-h-[720px] overflow-y-auto">
        {HOURS.map((hour) => {
          const events = getEventsForHour(hour);

          return (
            <div
              key={hour}
              className="grid grid-cols-[80px_1fr] sm:grid-cols-[100px_1fr] min-h-[85px] divide-x divide-[#e9edef] group hover:bg-gray-50/40 transition-colors"
            >
              {/* Hour Label */}
              <div className="p-3 text-right pr-4 text-xs font-semibold text-[#8696a0] bg-[#fafafa] select-none flex items-start justify-end">
                <span>{formatHourLabel(hour)}</span>
              </div>

              {/* Event slot */}
              <div className="p-2 sm:p-3 relative flex flex-col gap-2 justify-center">
                {events.length > 0 ? (
                  events.map((res) => {
                    const theme = getCategoryTheme(res.treatment_category);
                    const bDate = new Date(res.booking_date!);
                    const timeStr = bDate
                      .toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false })
                      .replace('.', ':');

                    return (
                      <div
                        key={res.id}
                        onClick={() => onSelectReservation(res)}
                        className={`p-3.5 rounded-xl transition-all cursor-pointer shadow-xs relative ${theme.card}`}
                      >
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                          <div className="space-y-1">
                            <div className="flex items-center space-x-2">
                              <span className="font-bold text-sm text-[#111b21]">
                                {res.customer?.name || 'Bunda'}
                              </span>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${theme.badge}`}>
                                {res.treatment_category}
                              </span>
                              <span className="text-xs font-bold flex items-center space-x-1 opacity-80">
                                <Clock size={12} />
                                <span>{timeStr} WIB</span>
                              </span>
                            </div>

                            <p className="text-xs font-semibold opacity-95">
                              {res.treatment_detail || 'Layanan Perawatan'}
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

                          <div className="flex items-center space-x-3 self-end md:self-auto">
                            {res.assigned_staff && (
                              <div className="flex items-center space-x-1 text-xs font-bold bg-white/80 px-2.5 py-1 rounded-lg border border-black/10">
                                <User size={12} className="text-[#008069]" />
                                <span>{res.assigned_staff.name}</span>
                              </div>
                            )}
                            {res.customer?.phone && (
                              <a
                                href={`https://wa.me/${res.customer.phone.replace(/\D/g, '')}`}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="p-2 rounded-xl bg-white hover:bg-[#008069] text-[#111b21] hover:text-white border border-[#d1d7db] shadow-xs transition-all"
                                title="Chat WhatsApp Pasien"
                              >
                                <MessageCircle size={14} />
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <button
                    onClick={() => onQuickAdd({ date: selectedDate, hour })}
                    className="w-full h-10 rounded-xl border border-transparent hover:border-dashed hover:border-[#008069] hover:bg-[#e8f5f2]/40 text-transparent hover:text-[#008069] text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all"
                  >
                    <Plus size={14} />
                    <span>Slot Kosong · Tambah Jadwal</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
