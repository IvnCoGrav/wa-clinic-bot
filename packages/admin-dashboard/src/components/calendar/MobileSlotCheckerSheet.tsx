import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Calendar, Clock, Check, Users } from 'lucide-react';
import { apiRequest } from '../../services/api';

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
  bookings: SlotBooking[];
}
interface DailySlotsResponse {
  success: boolean;
  date: string;
  totalTherapists: number;
  slots: SlotInfo[];
}

const SLOT_END: Record<string, string> = {
  '09:00': '10:30',
  '10:30': '12:00',
  '13:00': '14:30',
  '14:30': '16:00',
  '16:00': '17:30',
};

function formatDateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialDate?: string | null;
  onInsertToChat?: (text: string) => void;
  onHoldSlot?: (date: string, time: string) => void;
}

export const MobileSlotCheckerSheet: React.FC<Props> = ({ isOpen, onClose, initialDate, onInsertToChat, onHoldSlot }) => {
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    if (initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate)) return initialDate;
    return toISODate(new Date());
  });
  const [data, setData] = useState<DailySlotsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen && initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate)) {
      setSelectedDate(initialDate);
    }
  }, [isOpen, initialDate]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    apiRequest<DailySlotsResponse>(`/api/admin/reservations/daily-slots?date=${selectedDate}`)
      .then((res) => {
        if (!cancelled) setData(res as any);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    setSelectedSlots(new Set());
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

  const readyCount = data?.slots.filter((s) => s.status !== 'full').length || 0;

  const toggleSlot = (time: string, status: string) => {
    if (status === 'full') return;
    setSelectedSlots((prev) => {
      const next = new Set(prev);
      if (next.has(time)) next.delete(time);
      else next.add(time);
      return next;
    });
  };

  const handleInsert = () => {
    if (selectedSlots.size === 0 || !onInsertToChat) return;
    const times = Array.from(selectedSlots).sort();
    const dateLabel = formatDateLabel(selectedDate);
    const jamStr = times.join(' dan ');
    const text = `Untuk ${dateLabel}, slot yang ready ada jam ${jamStr} ya Bun 😊 Mau kami amankan di jam berapa Bun?`;
    onInsertToChat(text);
    onClose();
  };

  const handleHold = () => {
    if (selectedSlots.size !== 1 || !onHoldSlot) return;
    const time = Array.from(selectedSlots)[0];
    onHoldSlot(selectedDate, time);
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-xs animate-fadeIn" onClick={onClose}>
      <div
        className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-[#e9edef] w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden animate-slideUp"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-[#e9edef] flex items-center justify-between shrink-0 bg-white">
          <h3 className="font-extrabold text-[#111b21] text-sm flex items-center gap-2">
            <Calendar size={16} className="text-[#008069]" /> CEK KETERSEDIAAN JADWAL
          </h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-[#f0f2f5] flex items-center justify-center text-[#8696a0]">
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-2 border-b border-[#e9edef] shrink-0 bg-[#f8fafc]">
          <p className="text-[11px] font-bold text-[#667781] mb-1.5">Shortcut Tanggal:</p>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button onClick={() => setSelectedDate(todayISO)} className={`px-3 py-1.5 rounded-full text-xs font-bold border ${selectedDate === todayISO ? 'bg-[#008069] text-white border-[#008069]' : 'bg-white border-[#d1d7db] text-[#54656f]'}`}>Hari Ini</button>
            <button onClick={() => setSelectedDate(tomorrowISO)} className={`px-3 py-1.5 rounded-full text-xs font-bold border ${selectedDate === tomorrowISO ? 'bg-[#008069] text-white border-[#008069]' : 'bg-white border-[#d1d7db] text-[#54656f]'}`}>👉 Besok, {new Date(tomorrowISO).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</button>
            <button onClick={() => setSelectedDate(lusaISO)} className={`px-3 py-1.5 rounded-full text-xs font-bold border ${selectedDate === lusaISO ? 'bg-[#008069] text-white border-[#008069]' : 'bg-white border-[#d1d7db] text-[#54656f]'}`}>Lusa</button>
            <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="px-2 py-1.5 bg-white border border-[#d1d7db] rounded-full text-xs" />
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11px] text-[#008069] font-semibold">
            <Users size={12} /> {data?.totalTherapists || 2} Bidan Aktif • {readyCount} Slot Ready • {formatDateLabel(selectedDate)}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-[#f8fafc]">
          {loading ? (
            <p className="text-center text-xs text-[#8696a0] py-8">Memuat slot...</p>
          ) : (
            data?.slots.map((slot) => {
              const isSelected = selectedSlots.has(slot.time);
              const isFull = slot.status === 'full';
              const badge =
                slot.status === 'full' ? (
                  <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200 text-[10px] font-bold">🔴 PENUH ({slot.bookings.length}/{data?.totalTherapists})</span>
                ) : slot.status === 'hold' ? (
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-bold">🟡 HOLD • {slot.availableCount} SLOT</span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 text-[10px] font-bold">🟢 {slot.availableCount} SLOT TERSEDIA</span>
                );
              return (
                <div key={slot.time} className={`bg-white rounded-2xl border p-3 space-y-1.5 ${isSelected ? 'border-[#008069] ring-1 ring-[#008069] bg-emerald-50/40' : isFull ? 'border-rose-200' : 'border-[#e9edef]'}`}>
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
                            Bidan {b.staffName} ➔ {b.customerName} ({b.area}) {b.status === 'hold' ? '• Hold' : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[11px] text-emerald-700">{slot.availableCount} Bidan Siap</p>
                  )}
                  {!isFull && (
                    <button
                      onClick={() => toggleSlot(slot.time, slot.status)}
                      className={`w-full py-1.5 rounded-xl text-xs font-bold border flex items-center justify-center gap-1.5 ${isSelected ? 'bg-[#008069] text-white border-[#008069]' : 'bg-white border-[#d1d7db] text-[#54656f] hover:bg-[#f0f2f5]'}`}
                    >
                      {isSelected ? <Check size={12} /> : null} {isSelected ? 'Terpilih' : 'Pilih untuk ditawarkan ke Bunda'}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="p-3 border-t border-[#e9edef] bg-white shrink-0 space-y-2">
          {selectedSlots.size > 0 && <p className="text-[11px] text-[#667781] font-medium">AKSI CEPAT ({selectedSlots.size} Slot Terpilih: {Array.from(selectedSlots).sort().join(', ')})</p>}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleInsert}
              disabled={selectedSlots.size === 0}
              className="py-2.5 rounded-xl bg-[#008069] hover:bg-[#00a884] disabled:opacity-40 text-white text-xs font-bold flex items-center justify-center gap-1.5"
            >
              📋 Masukkan ke Chat
            </button>
            <button
              onClick={handleHold}
              disabled={selectedSlots.size !== 1}
              title={selectedSlots.size !== 1 ? 'Pilih 1 slot untuk kunci hold' : ''}
              className="py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-xs font-bold flex items-center justify-center gap-1.5"
            >
              ⚡ Kunci Hold
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
