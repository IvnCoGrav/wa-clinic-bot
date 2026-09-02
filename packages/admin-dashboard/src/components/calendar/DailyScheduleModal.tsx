import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Calendar, ChevronLeft, ChevronRight, Users } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { DayScheduleGrid } from './DayScheduleGrid';
import { Reservation } from '../../types';

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
  onSelectReservation?: (res: Reservation) => void;
  onInsertToChat?: (text: string) => void;
}

export const DailyScheduleModal: React.FC<Props> = ({ isOpen, onClose, initialDate, onSelectSlot, onSelectReservation, onInsertToChat }) => {
  const getTomorrowISO = () => {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    return toISODate(t);
  };
  const [selectedDateStr, setSelectedDateStr] = useState<string>(() => {
    if (initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate)) return initialDate;
    return getTomorrowISO();
  });
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(false);
  const [staffList, setStaffList] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('all');
  const dateInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      if (initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate)) setSelectedDateStr(initialDate);
      else setSelectedDateStr(getTomorrowISO());
    }
  }, [isOpen, initialDate]);

  useEffect(() => {
    if (!isOpen) return;
    apiRequest<any>('/api/admin/staff')
      .then((res: any) => {
        const list = Array.isArray(res) ? res : res?.data || [];
        setStaffList(list.filter((s: any) => s.active !== false).map((s: any) => ({ id: s.id, name: s.name })));
      })
      .catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    apiRequest<{ success: boolean; data: any; reservations: Reservation[]; rows: Reservation[] }>(
      `/api/admin/reservations?startDate=${selectedDateStr}&endDate=${selectedDateStr}&status=all&pageSize=200`
    )
      .then((res: any) => {
        if (cancelled) return;
        const list: Reservation[] = res?.data || res?.reservations || res?.rows || res?.data?.data || [];
        // Fallback: if paginated response, extract data
        const actual = Array.isArray(list) ? list : Array.isArray(res?.data) ? res.data : [];
        setReservations(actual as Reservation[]);
      })
      .catch(() => {
        if (!cancelled) setReservations([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedDateStr]);

  if (!isOpen) return null;

  const selectedDate = new Date(`${selectedDateStr}T00:00:00`);

  const shiftDate = (delta: number) => {
    const d = new Date(`${selectedDateStr}T00:00:00`);
    d.setDate(d.getDate() + delta);
    setSelectedDateStr(toISODate(d));
  };

  const filteredReservations = selectedStaffId === 'all' ? reservations : reservations.filter((r: any) => (r.assigned_staff?.id || (r as any).assigned_staff_id) === selectedStaffId);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-fadeIn" onClick={onClose}>
      <div className="bg-white rounded-t-3xl sm:rounded-3xl rounded-b-none sm:rounded-b-3xl shadow-2xl border border-[#e9edef] w-full max-w-4xl max-h-[92vh] sm:max-h-[88vh] flex flex-col overflow-hidden self-end sm:self-center" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-[#c2e7e0] bg-gradient-to-r from-[#e8f5f2] to-white flex items-center justify-between shrink-0">
          <h3 className="font-extrabold text-[#005c4b] text-sm flex items-center gap-2">
            <Calendar size={16} className="text-[#008069]" /> JADWAL KALENDER HARIAN
          </h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-white border border-[#c2e7e0] flex items-center justify-center text-[#005c4b]">
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-2 border-b border-[#e9edef] bg-[#f8fafc] shrink-0 space-y-2">
          <div className="flex items-center justify-between">
            <button onClick={() => shiftDate(-1)} className="w-8 h-8 rounded-full bg-white border border-[#d1d7db] flex items-center justify-center hover:bg-[#f0f2f5]">
              <ChevronLeft size={16} />
            </button>
            <button onClick={() => dateInputRef.current?.showPicker?.() || dateInputRef.current?.click()} className="font-bold text-sm text-[#111b21] hover:text-[#008069] flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-white border border-transparent hover:border-[#c2e7e0] transition">
              <Calendar size={14} className="text-[#008069]" />
              {formatDateLabel(selectedDateStr)}
            </button>
            <button onClick={() => shiftDate(1)} className="w-8 h-8 rounded-full bg-white border border-[#d1d7db] flex items-center justify-center hover:bg-[#f0f2f5]">
              <ChevronRight size={16} />
            </button>
          </div>
          <input ref={dateInputRef} type="date" value={selectedDateStr} onChange={(e) => setSelectedDateStr(e.target.value)} className="hidden" />
          {staffList.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <button onClick={() => setSelectedStaffId('all')} className={`px-3 py-1 rounded-full text-xs font-bold border ${selectedStaffId === 'all' ? 'bg-[#008069] text-white border-[#008069]' : 'bg-white border-[#d1d7db] text-[#54656f]'}`}>
                Semua Bidan
              </button>
              {staffList.map((s) => (
                <button key={s.id} onClick={() => setSelectedStaffId(s.id)} className={`px-3 py-1 rounded-full text-xs font-bold border ${selectedStaffId === s.id ? 'bg-[#008069] text-white border-[#008069]' : 'bg-white border-[#d1d7db] text-[#54656f]'}`}>
                  {s.name}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 text-[11px] text-[#008069] font-semibold">
            <Users size={12} /> {filteredReservations.length} Jadwal
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden bg-[#f8fafc] flex flex-col">
          {loading ? (
            <p className="text-center text-xs text-[#8696a0] py-8">Memuat jadwal...</p>
          ) : (
            <DayScheduleGrid
              hideHeader
              selectedDate={selectedDate}
              reservations={filteredReservations}
              onSelectReservation={(res) => {
                if (onSelectReservation) onSelectReservation(res);
                onClose();
              }}
              onQuickAdd={(target) => {
                const timeStr = `${String(target.hour).padStart(2, '0')}:00`;
                const dateStr = toISODate(target.date);
                if (onSelectSlot) onSelectSlot(dateStr, timeStr);
                onClose();
              }}
            />
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
