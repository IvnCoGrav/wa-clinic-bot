import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Calendar, Clock, ChevronLeft, ChevronRight, Users } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { getCleanTreatmentName } from '../../utils/treatmentFormatter';

interface SlotBooking {
  staffName: string;
  staffId: string | null;
  customerName: string;
  area: string;
  status: string;
  treatment: string;
}
interface SlotInfo {
  time: string;
  status: 'full' | 'available' | 'hold';
  availableCount: number;
  availableStaff?: Array<{ id: string; name: string }>;
  bookings: SlotBooking[];
}
interface DailySlotsResponse {
  success: boolean;
  date: string;
  totalTherapists: number;
  slots: SlotInfo[];
}

const SLOT_END: Record<string, string> = {
  '09:00': '10:00',
  '10:30': '12:00',
  '13:00': '14:30',
  '14:30': '16:00',
  '16:00': '17:30',
};

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function formatDateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialDate?: string | null;
  onSelectSlot?: (date: string, time: string) => void;
  onInsertToChat?: (text: string) => void;
}

export const DailyScheduleModal: React.FC<Props> = ({ isOpen, onClose, initialDate, onSelectSlot, onInsertToChat }) => {
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    if (initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate)) return initialDate;
    return toISODate(new Date());
  });
  const [data, setData] = useState<DailySlotsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate)) setSelectedDate(initialDate);
  }, [isOpen, initialDate]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    apiRequest<DailySlotsResponse>(`/api/admin/reservations/daily-slots?date=${selectedDate}`)
      .then((res: any) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedDate]);

  if (!isOpen) return null;

  const todayISO = toISODate(new Date());
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowISO = toISODate(tomorrow);
  const lusa = new Date();
  lusa.setDate(lusa.getDate() + 2);
  const lusaISO = toISODate(lusa);

  const shiftDate = (delta: number) => {
    const d = new Date(`${selectedDate}T00:00:00`);
    d.setDate(d.getDate() + delta);
    setSelectedDate(toISODate(d));
  };

  const readyCount = data?.slots.filter((s) => s.status !== 'full').length || 0;

  const handleHold = (time: string) => {
    if (onSelectSlot) onSelectSlot(selectedDate, time);
    onClose();
  };
  const handleCopy = (time: string) => {
    if (onInsertToChat) {
      const d = new Date(`${selectedDate}T00:00:00`);
      const isTomorrow = selectedDate === tomorrowISO;
      const isToday = selectedDate === todayISO;
      const prefix = isToday ? 'hari ini' : isTomorrow ? 'besok' : '';
      const dayName = d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short' });
      const timeFmt = time.replace(':', '.');
      const text = `Untuk ${prefix ? `${prefix} ` : ''}${dayName}, slot jam ${timeFmt} masih ready ya Bun 😊 Mau kami amankan di jam ini?`;
      onInsertToChat(text);
    }
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-fadeIn" onClick={onClose}>
      <div className="bg-white rounded-t-3xl sm:rounded-3xl rounded-b-none sm:rounded-b-3xl shadow-2xl border border-[#e9edef] w-full max-w-lg max-h-[92vh] sm:max-h-[88vh] flex flex-col overflow-hidden self-end sm:self-center" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-[#e9edef] flex items-center justify-between shrink-0">
          <h3 className="font-extrabold text-[#111b21] text-sm flex items-center gap-2">
            <Calendar size={16} className="text-[#008069]" /> JADWAL KALENDER HARIAN
          </h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-[#f0f2f5] flex items-center justify-center text-[#8696a0]">
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-2 border-b border-[#e9edef] bg-[#f8fafc] shrink-0 space-y-2">
          <div className="flex items-center justify-between">
            <button onClick={() => shiftDate(-1)} className="w-8 h-8 rounded-full bg-white border border-[#d1d7db] flex items-center justify-center hover:bg-[#f0f2f5]">
              <ChevronLeft size={16} />
            </button>
            <span className="font-bold text-sm text-[#111b21]">{formatDateLabel(selectedDate)}</span>
            <button onClick={() => shiftDate(1)} className="w-8 h-8 rounded-full bg-white border border-[#d1d7db] flex items-center justify-center hover:bg-[#f0f2f5]">
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button onClick={() => setSelectedDate(todayISO)} className={`px-3 py-1.5 rounded-full text-xs font-bold border ${selectedDate === todayISO ? 'bg-[#008069] text-white border-[#008069]' : 'bg-white border-[#d1d7db] text-[#54656f]'}`}>
              Hari Ini
            </button>
            <button onClick={() => setSelectedDate(tomorrowISO)} className={`px-3 py-1.5 rounded-full text-xs font-bold border ${selectedDate === tomorrowISO ? 'bg-[#008069] text-white border-[#008069]' : 'bg-white border-[#d1d7db] text-[#54656f]'}`}>
              👉 Besok
            </button>
            <button onClick={() => setSelectedDate(lusaISO)} className={`px-3 py-1.5 rounded-full text-xs font-bold border ${selectedDate === lusaISO ? 'bg-[#008069] text-white border-[#008069]' : 'bg-white border-[#d1d7db] text-[#54656f]'}`}>
              Lusa
            </button>
            <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="px-2 py-1.5 bg-white border border-[#d1d7db] rounded-full text-xs" />
          </div>
          <div className="flex items-center gap-2 text-[11px] text-[#008069] font-semibold">
            <Users size={12} /> {data?.totalTherapists || 2} Bidan Bertugas • 🟢 {readyCount} Slot Kosong
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-[#f8fafc]">
          {loading ? (
            <p className="text-center text-xs text-[#8696a0] py-8">Memuat jadwal...</p>
          ) : (
            data?.slots.map((slot) => {
              const badge =
                slot.status === 'full' ? (
                  <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200 text-[10px] font-bold">🔴 TERJADWAL</span>
                ) : slot.status === 'hold' ? (
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-bold">🟡 HOLD • {slot.availableCount} TERSEDIA</span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 text-[10px] font-bold">🟢 {slot.availableCount} SLOT TERSEDIA</span>
                );
              return (
                <div key={slot.time} className="bg-white rounded-2xl border border-[#e9edef] p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-xs text-[#111b21] flex items-center gap-1.5">
                      <Clock size={12} className="text-[#008069]" /> {slot.time} - {SLOT_END[slot.time] || ''}
                    </span>
                    {badge}
                  </div>
                  {slot.bookings.length > 0 ? (
                    <ul className="text-[11px] text-[#54656f] space-y-0.5">
                      {slot.bookings.map((b, i) => (
                        <li key={i} className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${b.status === 'hold' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                          <span>
                            Bidan {b.staffName} ➔ {b.customerName} {b.treatment ? `(${getCleanTreatmentName(b.treatment)})` : ''} {b.area !== '-' ? `• ${b.area}` : ''}
                          </span>
                        </li>
                      ))}
                      {(slot as any).availableStaff?.length > 0 &&
                        (slot as any).availableStaff.map((s: any, i: number) => (
                          <li key={`av-${i}`} className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            <span>Bidan {s.name} ➔ SIAP / KOSONG</span>
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <p className="text-[11px] text-emerald-700">
                      {(slot as any).availableStaff?.length ? `Semua Bidan Siap (${(slot as any).availableStaff.map((s: any) => s.name).join(', ')})` : 'Semua Bidan Siap / Kosong'}
                    </p>
                  )}
                  {slot.status !== 'full' && (
                    <div className="grid grid-cols-2 gap-1.5 pt-1">
                      <button onClick={() => handleHold(slot.time)} className="py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold">
                        + Kunci Hold
                      </button>
                      <button onClick={() => handleCopy(slot.time)} className="py-1.5 rounded-xl bg-white border border-[#d1d7db] hover:bg-[#f0f2f5] text-[#54656f] text-xs font-bold">
                        📋 Salin Jam
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="p-3 border-t border-[#e9edef] bg-white shrink-0">
          <button onClick={onClose} className="w-full py-2.5 rounded-xl bg-[#f0f2f5] hover:bg-[#e9edef] text-[#54656f] text-xs font-bold">
            Tutup
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
