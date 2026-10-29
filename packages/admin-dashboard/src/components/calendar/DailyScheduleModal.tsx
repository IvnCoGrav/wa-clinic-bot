import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Calendar, ChevronLeft, ChevronRight, Users } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { DayScheduleGrid } from './DayScheduleGrid';
import { Reservation } from '../../types';
import { getWibDateKey, getTodayWibDate, formatWibDate } from '../../utils/dateWib';

function formatDateLabel(iso: string): string {
  return formatWibDate(`${iso}T12:00:00+07:00`, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialDate?: string | null;
  onSelectSlot?: (date: string, time: string) => void;
  onSelectReservation?: (res: Reservation) => void;
  onInsertToChat?: (text: string) => void;
}

export const DailyScheduleModal: React.FC<Props> = ({
  isOpen,
  onClose,
  initialDate,
  onSelectSlot,
  onSelectReservation,
  onInsertToChat: _onInsertToChat,
}) => {
  const getTomorrowISO = () => {
    const t = getTodayWibDate();
    t.setDate(t.getDate() + 1);
    return getWibDateKey(t);
  };

  const [selectedDateStr, setSelectedDateStr] = useState<string>(() => {
    if (initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate)) return initialDate;
    return getTomorrowISO();
  });
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(false);
  const [staffList, setStaffList] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('all');

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

  const selectedDate = new Date(`${selectedDateStr}T12:00:00+07:00`);

  const shiftDate = (delta: number) => {
    const [y, m, d] = selectedDateStr.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d, 12, 0, 0);
    dateObj.setDate(dateObj.getDate() + delta);
    setSelectedDateStr(getWibDateKey(dateObj));
  };

  const filteredReservations =
    selectedStaffId === 'all'
      ? reservations
      : reservations.filter((r: any) => (r.assigned_staff?.id || (r as any).assigned_staff_id) === selectedStaffId);

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-t-3xl sm:rounded-3xl rounded-b-none sm:rounded-b-3xl shadow-2xl border border-divider w-full max-w-4xl max-h-[92vh] sm:max-h-[88vh] flex flex-col overflow-hidden self-end sm:self-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-divider bg-surface-2 flex items-center justify-between shrink-0">
          <h3 className="font-extrabold text-accent text-sm flex items-center gap-2">
            <Calendar size={16} className="text-accent" /> JADWAL KALENDER HARIAN
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-fill-1 border border-divider flex items-center justify-center text-accent"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-2 border-b border-divider bg-surface-2 shrink-0 space-y-2">
          <div className="flex items-center justify-between">
            <button
              onClick={() => shiftDate(-1)}
              className="w-8 h-8 rounded-full bg-surface border border-divider text-ink flex items-center justify-center hover:bg-fill-1"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="relative font-bold text-sm text-ink hover:text-accent flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-divider transition shadow-2xs cursor-pointer">
              <Calendar size={14} className="text-accent shrink-0 pointer-events-none" />
              <span className="truncate pointer-events-none">{formatDateLabel(selectedDateStr)}</span>
              <input
                type="date"
                value={selectedDateStr}
                onChange={(e) => {
                  if (e.target.value) setSelectedDateStr(e.target.value);
                }}
                className="absolute inset-0 w-full h-full opacity-0 z-10 cursor-pointer pointer-events-auto appearance-none"
                aria-label="Pilih Tanggal Jadwal"
              />
            </div>
            <button
              onClick={() => shiftDate(1)}
              className="w-8 h-8 rounded-full bg-surface border border-divider text-ink flex items-center justify-center hover:bg-fill-1"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          {staffList.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => setSelectedStaffId('all')}
                className={`px-3 py-1 rounded-full text-xs font-bold border ${selectedStaffId === 'all' ? 'bg-accent text-accent-ink border-accent' : 'bg-surface border-divider text-ink-2'}`}
              >
                Semua Bidan
              </button>
              {staffList.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedStaffId(s.id)}
                  className={`px-3 py-1 rounded-full text-xs font-bold border ${selectedStaffId === s.id ? 'bg-accent text-accent-ink border-accent' : 'bg-surface border-divider text-ink-2'}`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 text-[11px] text-accent font-semibold">
            <Users size={12} /> {filteredReservations.length} Jadwal
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden bg-app flex flex-col">
          {loading ? (
            <p className="text-center text-xs text-ink-3 py-8">Memuat jadwal...</p>
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
                const dateStr = getWibDateKey(target.date);
                if (onSelectSlot) onSelectSlot(dateStr, timeStr);
                onClose();
              }}
            />
          )}
        </div>

        <div className="p-3 border-t border-divider bg-surface shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-fill-1 hover:bg-fill-2 text-ink-2 text-xs font-bold cursor-pointer"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
