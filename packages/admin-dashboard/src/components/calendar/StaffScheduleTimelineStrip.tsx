import React, { useMemo } from 'react';
import { Clock, UserCheck, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';
import { Reservation } from '../../types';
import { StaffOption } from './types';
import { getWibDateKey, getWibHoursAndMinutes, getTodayWibDateKey } from '../../utils/dateWib';

export interface StaffScheduleTimelineStripProps {
  selectedStaff?: StaffOption | null;
  allStaff?: StaffOption[];
  onSelectStaff?: (staffId: string) => void;
  bookingDate: string; // YYYY-MM-DD
  currentSelectedTime: string; // HH:MM
  treatmentDurationMinutes: number; // pure + buffer
  bookedReservations: Reservation[];
  onSelectTimeSlot: (timeHHMM: string) => void;
  currentReservationId?: string | null;
}

const START_HOUR = 8; // 08:00 WIB
const END_HOUR = 18; // 18:00 WIB
const TOTAL_MINUTES = (END_HOUR - START_HOUR) * 60; // 600 menit (10 jam)

export const StaffScheduleTimelineStrip: React.FC<StaffScheduleTimelineStripProps> = ({
  selectedStaff,
  allStaff = [],
  onSelectStaff,
  bookingDate,
  currentSelectedTime,
  treatmentDurationMinutes = 80,
  bookedReservations = [],
  onSelectTimeSlot,
  currentReservationId,
}) => {
  // Filter reservasi bidan terpilih pada tanggal ini — WIB
  // Tampilkan semua (termasuk yang sedang diedit) — visual dibedakan via arsir, bukan dihilangkan
  const staffBookings = useMemo(() => {
    if (!bookingDate) return [];
    return bookedReservations.filter((r) => {
      if (!r.booking_date) return false;
      if (r.status === 'cancelled') return false;
      if (getWibDateKey(r.booking_date) !== bookingDate) return false;

      // Jika ada staf spesifik yang dipilih, filter berdasarkan staf tersebut
      if (selectedStaff?.id) {
        const rStaffId = r.assigned_staff_id || (r as any).assigned_staff?.id;
        return rStaffId === selectedStaff.id;
      }
      return true;
    });
  }, [bookedReservations, bookingDate, selectedStaff?.id, currentReservationId]);

  // Hitung interval menit untuk setiap booking yang ada — WIB
  const bookingIntervals = useMemo(() => {
    return staffBookings.map((b) => {
      const { hours, minutes, timeFormatted } = getWibHoursAndMinutes(b.booking_date!);
      const startMinutes = (hours - START_HOUR) * 60 + minutes;
      const duration = (b as any).duration_minutes || 60;
      const buffer = 20;
      const totalSpan = duration + buffer;
      const endMinutes = startMinutes + totalSpan;

      const customerName = (b.customer as any)?.name || 'Pasien';
      const cleanCustomerName = customerName.replace(/^(?:bunda|ibu|mama|moms?)\s+/i, '').trim();

      return {
        id: b.id,
        raw: b,
        customerName: cleanCustomerName,
        treatment: b.treatment_detail || 'Treatment',
        timeFormatted,
        startMinutes: Math.max(0, startMinutes),
        endMinutes: Math.min(TOTAL_MINUTES, endMinutes),
        duration,
        totalSpan,
        status: b.status,
      };
    });
  }, [staffBookings]);

  // Evaluasi apakah currentSelectedTime bentrok
  const selectedTimeMinutes = useMemo(() => {
    if (!currentSelectedTime || !/^\d{1,2}:\d{2}$/.test(currentSelectedTime)) return null;
    const [hh, mm] = currentSelectedTime.split(':').map((v) => parseInt(v, 10));
    return (hh - START_HOUR) * 60 + mm;
  }, [currentSelectedTime]);

  const collisionState = useMemo(() => {
    if (selectedTimeMinutes === null) return null;
    const selectedEnd = selectedTimeMinutes + treatmentDurationMinutes;

    for (const b of bookingIntervals) {
      // Overlap formula: startA < endB && endA > startB
      if (selectedTimeMinutes < b.endMinutes && selectedEnd > b.startMinutes) {
        return {
          hasCollision: true,
          collidedWith: b,
        };
      }
    }
    return { hasCollision: false };
  }, [selectedTimeMinutes, treatmentDurationMinutes, bookingIntervals]);

  // Generate slot kosong yang tersedia
  const availableQuickSlots = useMemo(() => {
    const slots: string[] = [];
    const candidateTimes = [
      '08:30', '09:00', '09:30', '10:00', '10:30', '11:00',
      '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30'
    ];

    const todayStr = getTodayWibDateKey();
    const isToday = bookingDate === todayStr;
    const { hours: nowH, minutes: nowM } = getWibHoursAndMinutes(new Date());
    const nowMinutesFromStart = (nowH - START_HOUR) * 60 + nowM;

    for (const time of candidateTimes) {
      const [h, m] = time.split(':').map(Number);
      const slotStart = (h - START_HOUR) * 60 + m;
      const slotEnd = slotStart + treatmentDurationMinutes;

      // Jika hari ini dan jam sudah lewat (+ buffer 15m), lewati
      if (isToday && slotStart <= nowMinutesFromStart + 15) {
        continue;
      }

      // Pastikan muat sebelum jam 18:00
      if (slotEnd > TOTAL_MINUTES) continue;

      // Cek bentrok dengan booking yang ada
      let hasConflict = false;
      for (const b of bookingIntervals) {
        if (slotStart < b.endMinutes && slotEnd > b.startMinutes) {
          hasConflict = true;
          break;
        }
      }

      if (!hasConflict) {
        slots.push(time);
      }
    }
    return slots;
  }, [bookingDate, treatmentDurationMinutes, bookingIntervals]);

  // Jam markers (08:00 - 18:00)
  const hourMarkers = useMemo(() => {
    const hours = [];
    for (let h = START_HOUR; h <= END_HOUR; h++) {
      hours.push(h);
    }
    return hours;
  }, []);

  if (!bookingDate) return null;

  return (
    <div className="p-3 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2.5 text-xs animate-fadeIn">
      {/* Header Info */}
      <div className="flex items-center justify-between flex-wrap gap-1">
        <div className="flex items-center space-x-1.5 font-bold text-slate-800 dark:text-slate-100">
          <Clock size={13} className="text-[#008069]" />
          <span>
            Pita Jadwal {selectedStaff ? `Bidan ${selectedStaff.name}` : 'Semua Terapis'}
          </span>
          <span className="text-[10px] font-normal text-slate-500">
            ({staffBookings.length} jadwal terisi)
          </span>
        </div>

        {/* Status Indicator */}
        {collisionState?.hasCollision ? (
          <div className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 text-[10px] font-bold border border-rose-300">
            <AlertCircle size={11} />
            <span>Bentrok ({collisionState.collidedWith?.timeFormatted} Ny. {collisionState.collidedWith?.customerName})</span>
          </div>
        ) : currentSelectedTime ? (
          <div className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 text-[10px] font-bold border border-emerald-300">
            <CheckCircle2 size={11} />
            <span>Jam {currentSelectedTime} Tersedia</span>
          </div>
        ) : (
          <span className="text-[10px] text-slate-500">Klik slot hijau di bawah untuk memilih jam</span>
        )}
      </div>

      {/* Quick Staff Selection Pills if no staff is selected */}
      {!selectedStaff && allStaff && allStaff.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5 pb-0.5">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1">
            <UserCheck size={11} className="text-[#008069]" />
            <span>Pilih Bidan:</span>
          </span>
          {allStaff
            .filter((s) => s.active !== false)
            .map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelectStaff?.(s.id)}
                className="px-2 py-0.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-[11px] font-bold text-slate-700 dark:text-slate-200 hover:border-[#008069] hover:text-[#008069] hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-all cursor-pointer active:scale-97"
              >
                {s.name}
              </button>
            ))}
        </div>
      )}

      {/* Visual Timeline Bar */}
      <div className="space-y-1">
        <div className="relative w-full h-9 bg-white dark:bg-slate-800 rounded-lg border border-slate-300 dark:border-slate-700 overflow-hidden shadow-inner select-none">
          {/* Jam Grid Lines */}
          <div className="absolute inset-0 flex justify-between pointer-events-none">
            {hourMarkers.map((h, idx) => {
              if (idx === 0 || idx === hourMarkers.length - 1) return null;
              const leftPercent = ((h - START_HOUR) / (END_HOUR - START_HOUR)) * 100;
              return (
                <div
                  key={h}
                  className="absolute top-0 bottom-0 border-r border-slate-200 dark:border-slate-700/60"
                  style={{ left: `${leftPercent}%` }}
                />
              );
            })}
          </div>

          {/* Booked Interval Blocks */}
          {bookingIntervals.map((b) => {
            const leftPercent = (b.startMinutes / TOTAL_MINUTES) * 100;
            const widthPercent = Math.max(2, ((b.endMinutes - b.startMinutes) / TOTAL_MINUTES) * 100);
            const isHold = b.status === 'hold';
            const isEditingThis = currentReservationId && b.id === currentReservationId;

            return (
              <div
                key={b.id}
                className={`absolute top-1 bottom-1 rounded-md px-1.5 flex items-center justify-between text-[10px] font-semibold border shadow-2xs truncate transition-transform hover:scale-[1.02] cursor-default ${
                  isEditingThis
                    ? 'bg-cyan-100 dark:bg-cyan-950/70 border-cyan-300 text-cyan-900 dark:text-cyan-200 ring-1 ring-cyan-300'
                    : isHold
                    ? 'bg-amber-100 dark:bg-amber-950/70 border-amber-300 text-amber-900 dark:text-amber-200'
                    : 'bg-rose-100 dark:bg-rose-950/70 border-rose-300 text-rose-900 dark:text-rose-200'
                }`}
                style={{
                  left: `${leftPercent}%`,
                  width: `${widthPercent}%`,
                }}
                title={`${b.timeFormatted} WIB: Ny. ${b.customerName} (${b.treatment})`}
              >
                <span className="truncate">
                  {b.timeFormatted} Ny. {b.customerName}
                </span>
              </div>
            );
          })}

          {/* Selected Booking Highlight Block */}
          {selectedTimeMinutes !== null && (
            <div
              className={`absolute top-0.5 bottom-0.5 rounded-md border-2 shadow-md transition-all duration-200 pointer-events-none flex items-center justify-center text-[10px] font-extrabold ${
                collisionState?.hasCollision
                  ? 'bg-rose-500/25 border-rose-600 text-rose-800 dark:text-rose-200 animate-pulse'
                  : 'bg-emerald-500/30 border-emerald-600 text-emerald-950 dark:text-emerald-100'
              }`}
              style={{
                left: `${Math.max(0, (selectedTimeMinutes / TOTAL_MINUTES) * 100)}%`,
                width: `${Math.min(100, (treatmentDurationMinutes / TOTAL_MINUTES) * 100)}%`,
              }}
            >
              <span className="truncate px-1 bg-white/80 dark:bg-slate-900/80 rounded">
                {currentSelectedTime} ({treatmentDurationMinutes}m)
              </span>
            </div>
          )}
        </div>

        {/* Time Scale Labels */}
        <div className="flex justify-between text-[9px] font-mono text-slate-400 select-none px-0.5">
          <span>08:00</span>
          <span>10:00</span>
          <span>12:00</span>
          <span>14:00</span>
          <span>16:00</span>
          <span>18:00</span>
        </div>
      </div>

      {/* Quick Available Slots Chips */}
      {availableQuickSlots.length > 0 ? (
        <div className="space-y-1.5 pt-1">
          <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 flex items-center space-x-1">
            <Sparkles size={11} className="text-emerald-600" />
            <span>Slot Jam Kosong yang Muat ({treatmentDurationMinutes} mnt):</span>
          </span>
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
            {availableQuickSlots.map((time) => {
              const isSelected = currentSelectedTime === time;
              return (
                <button
                  key={time}
                  type="button"
                  onClick={() => onSelectTimeSlot(time)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all duration-150 active:scale-97 cursor-pointer border ${
                    isSelected
                      ? 'bg-[#008069] text-white border-[#008069] shadow-sm ring-2 ring-[#008069]/40 font-extrabold scale-105'
                      : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-[#008069] hover:text-[#008069] hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
                  }`}
                  title={`Pilih jam ${time} WIB`}
                >
                  {time}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-amber-700 dark:text-amber-400 italic pt-1">
          Tidak ada slot kosong yang muat durasi {treatmentDurationMinutes} menit di tanggal ini. Silakan ganti tanggal atau force override.
        </p>
      )}
    </div>
  );
};
