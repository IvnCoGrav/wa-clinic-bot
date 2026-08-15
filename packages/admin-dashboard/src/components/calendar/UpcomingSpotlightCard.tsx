import React from 'react';
import { Clock, User, Sparkles, ChevronRight, MessageCircle } from 'lucide-react';
import { Reservation } from '../../types';

interface UpcomingSpotlightCardProps {
  reservations: Reservation[];
  onSelectReservation: (res: Reservation) => void;
}

export const UpcomingSpotlightCard: React.FC<UpcomingSpotlightCardProps> = ({
  reservations,
  onSelectReservation,
}) => {
  // Find the closest upcoming confirmed/pending reservation
  const now = new Date().getTime();
  const upcoming = reservations
    .filter((r) => r.booking_date && r.status !== 'cancelled')
    .map((r) => ({
      ...r,
      timeMs: new Date(r.booking_date!).getTime(),
    }))
    .filter((r) => r.timeMs >= now - 60 * 60 * 1000) // Within past hour or future
    .sort((a, b) => a.timeMs - b.timeMs)[0];

  if (!upcoming) {
    return (
      <div className="bg-[#111b21] text-white rounded-2xl p-4 shadow-lg border border-[#202c33]">
        <div className="flex items-center space-x-2 text-xs text-[#8696a0] mb-2">
          <Sparkles size={14} className="text-[#00a884]" />
          <span className="font-semibold uppercase tracking-wider text-[10px]">Fokus Jadwal</span>
        </div>
        <p className="text-xs text-gray-300">Tidak ada jadwal mendesak saat ini.</p>
        <p className="text-[11px] text-gray-500 mt-1">Semua reservasi telah selesai atau belum terjadwal.</p>
      </div>
    );
  }

  const bookingDate = new Date(upcoming.booking_date!);
  const timeStr = bookingDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', ':');
  const dateStr = bookingDate.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div className="bg-[#111b21] text-white rounded-2xl p-4 shadow-lg border border-[#202c33] relative overflow-hidden group">
      {/* Glow accent */}
      <div className="absolute top-0 right-0 w-24 h-24 bg-[#00a884]/10 rounded-full blur-xl pointer-events-none" />

      {/* Header with Time */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-1.5 text-xs text-[#00a884] font-bold">
          <Clock size={13} />
          <span>{dateStr}, {timeStr}</span>
        </div>
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-[#00a884]/20 text-[#00a884] border border-[#00a884]/30">
          {upcoming.treatment_category}
        </span>
      </div>

      {/* Title / Patient */}
      <div className="space-y-1 my-2.5">
        <h4 className="font-bold text-sm text-white group-hover:text-[#00a884] transition-colors line-clamp-1">
          {upcoming.customer?.name || 'Bunda'}
        </h4>
        <p className="text-xs text-gray-300 line-clamp-2 leading-relaxed">
          {upcoming.treatment_detail || 'Layanan Perawatan'}
        </p>
      </div>

      {/* Staff & Actions */}
      <div className="pt-3 border-t border-[#202c33] flex items-center justify-between text-xs">
        <div className="flex items-center space-x-1.5 text-gray-400 text-[11px]">
          <User size={12} className="text-[#00a884]" />
          <span className="truncate max-w-[110px]">
            {upcoming.assigned_staff?.name || 'Belum assign'}
          </span>
        </div>
        <div className="flex items-center space-x-2">
          {upcoming.customer?.phone && (
            <a
              href={`https://wa.me/${upcoming.customer.phone.replace(/\D/g, '')}`}
              target="_blank"
              rel="noreferrer"
              className="p-1.5 rounded-lg bg-[#202c33] hover:bg-[#00a884] text-gray-300 hover:text-white transition-all"
              title="Chat WhatsApp"
            >
              <MessageCircle size={13} />
            </a>
          )}
          <button
            onClick={() => onSelectReservation(upcoming)}
            className="px-2.5 py-1 rounded-lg bg-[#00a884] hover:bg-[#008069] text-white font-semibold text-[11px] flex items-center space-x-1 transition-all shadow-xs"
          >
            <span>Detail</span>
            <ChevronRight size={12} />
          </button>
        </div>
      </div>
    </div>
  );
};
