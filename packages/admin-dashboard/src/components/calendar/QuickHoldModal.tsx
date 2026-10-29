import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';
import { X, Calendar as CalendarIcon, Clock, Zap, AlertCircle, Loader2, MapPin, User, Phone, AlertTriangle } from 'lucide-react';
import { buildWibIso, getWibDateKey, getTodayWibDateKey, getTodayWibDate } from '../../utils/dateWib';
import { resolveStaffName } from '../../utils/resolveStaffName';

interface QuickHoldModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newReservation?: any) => void;
  staffList?: any[];
  initialCustomer?: {
    id?: string;
    name?: string | null;
    phone?: string | null;
    kelurahan?: string | null;
    kecamatan?: string | null;
    kota?: string | null;
    distanceKm?: number | null;
    distance_km?: number | null;
  } | null;
  initialDate?: Date | string | null;
  initialTime?: string | null;
  onInsertToChat?: (text: string) => void;
}

const COMMON_SLOTS = ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00'];

export const QuickHoldModal: React.FC<QuickHoldModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialCustomer,
  initialDate,
  initialTime,
}) => {
  const { toast } = useUiFeedback();
  const [submitting, setSubmitting] = useState(false);

  const [customerId, setCustomerId] = useState<string | undefined>(undefined);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [bookingDate, setBookingDate] = useState('');
  const [bookingTime, setBookingTime] = useState('10:00');
  const [holdDuration, setHoldDuration] = useState<number>(60);
  const [notes, setNotes] = useState('');
  const [slotStatusMap, setSlotStatusMap] = useState<Record<string, 'full' | 'available' | 'hold'>>({});
  const [dailySlotsData, setDailySlotsData] = useState<Array<{ time: string; status: string; bookings?: any[] }>>([]);
  const [pendingOverlapSubmit, setPendingOverlapSubmit] = useState<(() => void) | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (initialCustomer) {
      setCustomerId(initialCustomer.id);
      setCustomerName(initialCustomer.name || '');
      setCustomerPhone(initialCustomer.phone || '');
    } else {
      setCustomerId(undefined);
      setCustomerName('');
      setCustomerPhone('');
    }
    if (typeof initialDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(initialDate)) {
      setBookingDate(initialDate);
    } else if (initialDate) {
      setBookingDate(getWibDateKey(initialDate as any));
    } else {
      setBookingDate(getTodayWibDateKey());
    }
    if (initialTime) {
      setBookingTime(initialTime);
    } else if (initialDate && typeof initialDate === 'object' && (initialDate as Date).getHours) {
      const h = String((initialDate as Date).getHours()).padStart(2, '0');
      const m = String((initialDate as Date).getMinutes()).padStart(2, '0');
      setBookingTime(`${h}:${m}`);
    } else {
      setBookingTime('10:00');
    }
    setNotes('');
    setHoldDuration(60);
  }, [isOpen, initialCustomer, initialDate, initialTime]);

  const handleDateShortcut = (offsetDays: number) => {
    const target = getTodayWibDate();
    target.setDate(target.getDate() + offsetDays);
    setBookingDate(getWibDateKey(target));
  };

  useEffect(() => {
    if (!isOpen || !bookingDate) return;
    apiRequest<{ success: boolean; slots: Array<{ time: string; status: 'full' | 'available' | 'hold'; bookings?: any[] }> }>(`/api/admin/reservations/daily-slots?date=${bookingDate}`)
      .then((res: any) => {
        if (res?.slots) {
          const map: Record<string, string> = {};
          res.slots.forEach((s: any) => (map[s.time] = s.status));
          setSlotStatusMap(map as any);
          setDailySlotsData(res.slots);
        }
      })
      .catch(() => {});
  }, [isOpen, bookingDate]);

  const overlappingBookings = useMemo(() => {
    if (!bookingTime || !bookingDate) return [];
    const [h, m] = bookingTime.split(':').map(Number);
    const startMin = h * 60 + m;
    const endMin = startMin + holdDuration;
    return (dailySlotsData || [])
      .filter((s) => {
        if (!s || !s.time || s.time === bookingTime) return false;
        const [sh, sm] = s.time.split(':').map(Number);
        const slotStartMin = sh * 60 + sm;
        const slotEndMin = slotStartMin + 60;
        return slotStartMin < endMin && startMin < slotEndMin;
      })
      .flatMap((s) => s.bookings || [])
      .filter(Boolean);
  }, [bookingTime, bookingDate, holdDuration, dailySlotsData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookingDate || !bookingTime) {
      toast('Tanggal dan Jam slot wajib diisi.', 'error');
      return;
    }
    if (!customerId && !customerPhone && !customerName) {
      toast('Harap masukkan Nama atau Nomor WhatsApp customer.', 'error');
      return;
    }
    if (overlappingBookings.length > 0) {
      setPendingOverlapSubmit(() => () => doSubmit(true));
      return;
    }
    await doSubmit(false);
  };

  const doSubmit = async (force: boolean) => {
    setPendingOverlapSubmit(null);
    setSubmitting(true);
    try {
      if (!bookingDate || !bookingTime) {
        toast('Format tanggal dan jam tidak valid.', 'error');
        setSubmitting(false);
        return;
      }
      const res = await apiRequest<{ success: boolean; data?: any; error?: string }>(
        '/api/admin/reservation/quick-hold',
        {
          method: 'POST',
          body: JSON.stringify({
            customerId: customerId || undefined,
            customerPhone: customerPhone || undefined,
            customerName: customerName || undefined,
            bookingDate: buildWibIso(bookingDate, bookingTime),
            durationMinutes: holdDuration,
            treatmentCategory: 'BABY',
            treatmentDetail: `[HOLD] Slot Ditawarkan (BABY) [${holdDuration}m]`,
            notes: notes || undefined,
            force: force || undefined,
          }),
        }
      );
      if (res.success && res.data) {
        toast('Slot berhasil ditahan (HOLD)!', 'success');
        onSuccess(res.data);
        onClose();
      } else {
        toast(res.error || 'Gagal menyimpan hold slot.', 'error');
      }
    } catch (err: any) {
      toast(err.message || 'Terjadi kesalahan jaringan.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const distKm = (initialCustomer as any)?.distanceKm ?? (initialCustomer as any)?.distance_km ?? null;
  const locLabel = initialCustomer?.kelurahan || initialCustomer?.kecamatan || initialCustomer?.kota
    ? [initialCustomer?.kelurahan, initialCustomer?.kecamatan].filter(Boolean).join(', ') + (initialCustomer?.kota ? ` • ${initialCustomer.kota}` : '')
    : null;
  const initials = (customerName || 'B').trim().charAt(0).toUpperCase() || 'B';

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 dark:bg-black/80 backdrop-blur-xs animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-t-3xl sm:rounded-3xl shadow-2xl border border-divider w-full max-w-lg overflow-hidden flex flex-col max-h-[90dvh] sm:max-h-[92vh] animate-slideUp sm:animate-modalScaleUp"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile Drag Handle */}
        <div className="pt-2 pb-1 bg-surface-2 sm:hidden flex justify-center shrink-0">
          <div className="w-10 h-1 bg-divider rounded-full" />
        </div>

        <div className="px-5 py-4 border-b border-divider bg-surface-2 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-2xl bg-warning text-surface flex items-center justify-center shadow-md shadow-warning/20">
              <Zap size={18} className="fill-current" />
            </div>
            <div>
              <h3 className="font-extrabold text-ink text-base leading-tight flex items-center gap-1.5">
                <span>Tahan Slot (Quick Hold)</span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-warning-soft text-warning border border-warning-line">
                  Ditawarkan
                </span>
              </h3>
              <p className="text-xs text-ink-3 mt-0.5">Kunci jadwal kilat saat negosiasi di WhatsApp</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full text-ink-3 hover:text-ink hover:bg-fill-1 flex items-center justify-center transition"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          <div className="p-3 rounded-2xl bg-warning-soft border border-warning-line text-warning flex items-start space-x-2.5 leading-relaxed">
            <AlertCircle size={16} className="text-warning shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Slot aman & tidak akan tertimpa.</span> Status <span className="font-bold underline">HOLD</span> akan tampil kuning di kalender, dan tidak akan memicu pesan WhatsApp otomatis.
            </div>
          </div>

          {/* Read-Only Patient Card */}
          <div className="bg-surface-2 p-4 rounded-2xl border border-divider flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent text-accent-ink flex items-center justify-center font-extrabold text-sm shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-ink text-sm truncate flex items-center gap-1.5">
                <User size={13} className="text-accent shrink-0" />
                <span>Bunda {customerName || '-'}</span>
              </p>
              <p className="text-[12px] text-ink-2 font-mono flex items-center gap-1 truncate">
                <Phone size={11} className="shrink-0" />
                <span>{customerPhone || '-'}</span>
              </p>
              <p className="text-[11px] text-ink-3 flex items-center gap-1 mt-0.5">
                <MapPin size={11} className="shrink-0" />
                <span className="truncate">
                  {locLabel ? `📍 ${locLabel}` : 'Lokasi belum ditentukan'}
                  {distKm != null ? ` • ${Number(distKm).toFixed(1)} km` : ''}
                </span>
              </p>
            </div>
            <span className="text-[10px] font-semibold text-accent bg-accent-soft px-2 py-1 rounded-md shrink-0">Auto dari Chat</span>
          </div>

          {/* Date & Time Fast Pickers */}
          <div className="space-y-3 bg-surface-2 p-3.5 rounded-2xl border border-divider">
            <div className="flex items-center justify-between">
              <label className="font-bold text-ink flex items-center space-x-1.5">
                <CalendarIcon size={14} className="text-accent" />
                <span>Tanggal & Jam Negosiasi</span>
              </label>
              <div className="flex items-center space-x-1">
                <button type="button" onClick={() => handleDateShortcut(0)} className="px-2 py-0.5 bg-surface hover:bg-accent-soft text-accent border border-divider hover:border-accent rounded-md text-[10px] font-semibold transition">Hari Ini</button>
                <button type="button" onClick={() => handleDateShortcut(1)} className="px-2 py-0.5 bg-surface hover:bg-accent-soft text-accent border border-divider hover:border-accent rounded-md text-[10px] font-semibold transition">Besok</button>
                <button type="button" onClick={() => handleDateShortcut(2)} className="px-2 py-0.5 bg-surface hover:bg-accent-soft text-accent border border-divider hover:border-accent rounded-md text-[10px] font-semibold transition">Lusa</button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="text-[11px] text-ink-3 block mb-1">Pilih Tanggal</label>
                <input type="date" value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} className="w-full px-3 py-2 bg-surface rounded-xl border border-divider focus:border-accent focus:ring-1 focus:ring-accent outline-none text-xs font-semibold text-ink" required />
              </div>
              <div>
                <label className="text-[11px] text-ink-3 block mb-1">Pilih Jam</label>
                <input type="time" value={bookingTime} onChange={(e) => setBookingTime(e.target.value)} className="w-full px-3 py-2 bg-surface rounded-xl border border-divider focus:border-accent focus:ring-1 focus:ring-accent outline-none text-xs font-semibold text-ink" required />
              </div>
            </div>

            <div>
              <p className="text-[10.5px] text-ink-3 mb-1.5 font-medium flex items-center gap-1"><Clock size={11} /> Slot Jam Populer:</p>
              <div className="flex flex-wrap gap-1.5">
                {COMMON_SLOTS.map((slot) => {
                  const isSelected = bookingTime === slot;
                  const s = (slotStatusMap as any)[slot] as string | undefined;
                  const dot = s === 'full' ? 'bg-danger' : s === 'hold' ? 'bg-warning' : s === 'available' ? 'bg-success' : 'bg-strong';
                  return (
                    <button key={slot} type="button" onClick={() => setBookingTime(slot)} className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold transition flex items-center gap-1 ${isSelected ? 'bg-accent text-accent-ink shadow-xs' : 'bg-surface text-ink-2 border border-divider hover:border-accent hover:bg-accent-soft'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                      {slot}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Overlap Warning Banner */}
          {overlappingBookings.length > 0 && (
            <div className="p-3 rounded-2xl bg-warning-soft border border-warning-line text-warning text-xs">
              <div className="flex items-center gap-2 font-bold mb-1.5">
                <AlertTriangle size={14} className="shrink-0" />
                <span>⚠️ Peringatan Jadwal Tumpang Tindih</span>
              </div>
              <p className="text-[11px] mb-1.5">Jam ini beririsan dengan jadwal pasien lain:</p>
              <ul className="space-y-1">
                {overlappingBookings.map((b: any, i: number) => (
                  <li key={i} className="text-[11px] flex items-center gap-1.5">
                    <span className="font-semibold">{b.customerName || b.customer?.name || 'Pasien'}</span>
                    <span className="text-[10px] opacity-75">({b.status} • {b.treatmentDetail || b.treatment_detail || '-'} • {resolveStaffName(b) || '-'})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Durasi Hold */}
          <div>
            <p className="text-[11px] text-ink-2 mb-1.5 font-medium flex items-center gap-1">
              <Clock size={11} /> Durasi Treatment:
              {(() => {
                const [h, m] = (bookingTime || '10:00').split(':').map(Number);
                if (isNaN(h) || isNaN(m)) return null;
                const end = new Date(2000, 0, 1, h, m + holdDuration);
                const hh = String(end.getHours()).padStart(2, '0');
                const mm = String(end.getMinutes()).padStart(2, '0');
                return <span className="font-bold text-accent">selesai ~{hh}:{mm}</span>;
              })()}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {[30, 45, 60, 90, 120, 180].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setHoldDuration(d)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold transition ${
                    holdDuration === d
                      ? 'bg-warning text-surface font-black ring-1 ring-warning-line shadow-xs'
                      : 'bg-surface text-ink-2 border border-divider hover:border-warning hover:bg-warning-soft'
                  }`}
                >
                  {d >= 60 ? `${d / 60} jam` : `${d} mnt`}
                </button>
              ))}
              <label className="flex items-center gap-1 text-[11px] text-ink-2 font-medium ml-1">
                Lainnya:
                <input
                  type="number"
                  min={15}
                  max={480}
                  step={5}
                  value={holdDuration}
                  onChange={(e) => {
                    const v = Math.min(480, Math.max(15, Number(e.target.value) || 15));
                    setHoldDuration(v);
                  }}
                  className="w-16 px-2 py-1 bg-surface rounded-lg border border-divider focus:border-warning focus:ring-1 focus:ring-warning outline-none text-xs font-bold text-ink"
                />
                <span>mnt</span>
              </label>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="font-bold text-ink block mb-1">Catatan (Opsional)</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Contoh: Menunggu persetujuan suami / opsi jam alternatif" rows={2} className="w-full px-3 py-2 bg-surface rounded-xl border border-divider focus:border-accent focus:ring-1 focus:ring-accent outline-none text-xs text-ink placeholder-ink-3 resize-none" />
          </div>
        </form>

        <div className="p-4 border-t border-divider bg-surface-2 flex items-center justify-between safe-bottom-padding shrink-0">
          <button type="button" onClick={onClose} disabled={submitting} className="px-4 py-2 bg-surface hover:bg-fill-1 text-ink-2 border border-divider text-xs font-bold rounded-xl transition">Batal</button>
          <button type="button" onClick={handleSubmit} disabled={submitting} className="px-5 py-2.5 bg-warning hover:bg-warning-hover text-surface text-xs font-bold rounded-xl transition shadow-md shadow-warning/25 flex items-center space-x-2 active:scale-95 disabled:opacity-50">
            {submitting ? (<><Loader2 size={14} className="animate-spin" /><span>Menyimpan...</span></>) : (<><Zap size={14} className="fill-current" /><span>⚡ Simpan & Tahan Slot</span></>)}
          </button>
        </div>
      </div>
      {pendingOverlapSubmit && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 backdrop-blur-xs">
          <div className="bg-surface rounded-2xl shadow-xl border border-divider p-6 max-w-sm mx-4 space-y-4">
            <div className="flex items-center gap-2 text-warning font-bold text-sm">
              <AlertTriangle size={20} />
              <span>Jadwal Tumpang Tindih</span>
            </div>
            <p className="text-xs text-ink-2">
              Terdapat jadwal lain yang tumpang tindih di jam ini. Apakah Anda yakin ingin tetap menahan (HOLD) slot ini?
            </p>
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={() => setPendingOverlapSubmit(null)} className="px-4 py-2 bg-surface hover:bg-fill-1 text-ink-2 border border-divider text-xs font-bold rounded-xl transition">Batal</button>
              <button type="button" onClick={() => pendingOverlapSubmit()} className="px-4 py-2 bg-warning hover:bg-warning-hover text-surface text-xs font-bold rounded-xl transition shadow-md shadow-warning/25 flex items-center space-x-2">
                <Zap size={14} className="fill-current" />
                <span>Yakin & Tahan</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};
