import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';
import { X, Calendar as CalendarIcon, Clock, Zap, AlertCircle, Loader2, MapPin, User, Phone } from 'lucide-react';

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
  const [notes, setNotes] = useState('');
  const [slotStatusMap, setSlotStatusMap] = useState<Record<string, 'full' | 'available' | 'hold'>>({});

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
    } else {
      const today = new Date();
      const d = initialDate ? new Date(initialDate as any) : today;
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      setBookingDate(`${yyyy}-${mm}-${dd}`);
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
  }, [isOpen, initialCustomer, initialDate, initialTime]);

  const handleDateShortcut = (offsetDays: number) => {
    const target = new Date();
    target.setDate(target.getDate() + offsetDays);
    const yyyy = target.getFullYear();
    const mm = String(target.getMonth() + 1).padStart(2, '0');
    const dd = String(target.getDate()).padStart(2, '0');
    setBookingDate(`${yyyy}-${mm}-${dd}`);
  };

  useEffect(() => {
    if (!isOpen || !bookingDate) return;
    apiRequest<{ success: boolean; slots: Array<{ time: string; status: 'full' | 'available' | 'hold' }> }>(`/api/admin/reservations/daily-slots?date=${bookingDate}`)
      .then((res: any) => {
        if (res?.slots) {
          const map: Record<string, string> = {};
          res.slots.forEach((s: any) => (map[s.time] = s.status));
          setSlotStatusMap(map as any);
        }
      })
      .catch(() => {});
  }, [isOpen, bookingDate]);

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
    setSubmitting(true);
    try {
      const combinedDateTime = new Date(`${bookingDate}T${bookingTime}:00`);
      if (isNaN(combinedDateTime.getTime())) {
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
            bookingDate: combinedDateTime.toISOString(),
            treatmentCategory: 'BABY',
            treatmentDetail: '[HOLD] Slot Ditawarkan (BABY)',
            notes: notes || undefined,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
      <div
        className="bg-white rounded-3xl shadow-2xl border border-[#e9edef] w-full max-w-lg overflow-hidden flex flex-col max-h-[92vh] transition-all transform scale-100"
        role="dialog"
        aria-modal="true"
      >
        <div className="px-5 py-4 border-b border-[#e9edef] bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-md shadow-amber-500/20">
              <Zap size={18} className="fill-current" />
            </div>
            <div>
              <h3 className="font-extrabold text-[#111b21] text-base leading-tight flex items-center gap-1.5">
                <span>Tahan Slot (Quick Hold)</span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                  Ditawarkan
                </span>
              </h3>
              <p className="text-xs text-[#667781] mt-0.5">Kunci jadwal kilat saat negosiasi di WhatsApp</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5] flex items-center justify-center transition"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          <div className="p-3 rounded-2xl bg-amber-50/80 border border-amber-200/80 text-amber-900 flex items-start space-x-2.5 leading-relaxed">
            <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Slot aman & tidak akan tertimpa.</span> Status <span className="font-bold underline">HOLD</span> akan tampil kuning di kalender, dan tidak akan memicu pesan WhatsApp otomatis.
            </div>
          </div>

          {/* Read-Only Patient Card */}
          <div className="bg-[#f8fafc] p-4 rounded-2xl border border-[#e9edef] flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#008069] text-white flex items-center justify-center font-extrabold text-sm shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-[#111b21] text-sm truncate flex items-center gap-1.5">
                <User size={13} className="text-[#008069] shrink-0" />
                <span>Bunda {customerName || '-'}</span>
              </p>
              <p className="text-[12px] text-[#54656f] font-mono flex items-center gap-1 truncate">
                <Phone size={11} className="shrink-0" />
                <span>{customerPhone || '-'}</span>
              </p>
              <p className="text-[11px] text-[#667781] flex items-center gap-1 mt-0.5">
                <MapPin size={11} className="shrink-0" />
                <span className="truncate">
                  {locLabel ? `📍 ${locLabel}` : 'Lokasi belum ditentukan'}
                  {distKm != null ? ` • ${Number(distKm).toFixed(1)} km` : ''}
                </span>
              </p>
            </div>
            <span className="text-[10px] font-semibold text-[#008069] bg-[#e8f5f2] px-2 py-1 rounded-md shrink-0">Auto dari Chat</span>
          </div>

          {/* Date & Time Fast Pickers */}
          <div className="space-y-3 bg-[#f8fafc] p-3.5 rounded-2xl border border-[#e9edef]">
            <div className="flex items-center justify-between">
              <label className="font-bold text-[#111b21] flex items-center space-x-1.5">
                <CalendarIcon size={14} className="text-[#008069]" />
                <span>Tanggal & Jam Negosiasi</span>
              </label>
              <div className="flex items-center space-x-1">
                <button type="button" onClick={() => handleDateShortcut(0)} className="px-2 py-0.5 bg-white hover:bg-emerald-50 text-[#008069] border border-[#d1d7db] hover:border-[#008069] rounded-md text-[10px] font-semibold transition">Hari Ini</button>
                <button type="button" onClick={() => handleDateShortcut(1)} className="px-2 py-0.5 bg-white hover:bg-emerald-50 text-[#008069] border border-[#d1d7db] hover:border-[#008069] rounded-md text-[10px] font-semibold transition">Besok</button>
                <button type="button" onClick={() => handleDateShortcut(2)} className="px-2 py-0.5 bg-white hover:bg-emerald-50 text-[#008069] border border-[#d1d7db] hover:border-[#008069] rounded-md text-[10px] font-semibold transition">Lusa</button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="text-[11px] text-[#667781] block mb-1">Pilih Tanggal</label>
                <input type="date" value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} className="w-full px-3 py-2 bg-white rounded-xl border border-[#d1d7db] focus:border-[#008069] focus:ring-1 focus:ring-[#008069] outline-none text-xs font-semibold text-[#111b21]" required />
              </div>
              <div>
                <label className="text-[11px] text-[#667781] block mb-1">Pilih Jam</label>
                <input type="time" value={bookingTime} onChange={(e) => setBookingTime(e.target.value)} className="w-full px-3 py-2 bg-white rounded-xl border border-[#d1d7db] focus:border-[#008069] focus:ring-1 focus:ring-[#008069] outline-none text-xs font-semibold text-[#111b21]" required />
              </div>
            </div>

            <div>
              <p className="text-[10.5px] text-[#667781] mb-1.5 font-medium flex items-center gap-1"><Clock size={11} /> Slot Jam Populer:</p>
              <div className="flex flex-wrap gap-1.5">
                {COMMON_SLOTS.map((slot) => {
                  const isSelected = bookingTime === slot;
                  const s = (slotStatusMap as any)[slot] as string | undefined;
                  const dot = s === 'full' ? 'bg-rose-500' : s === 'hold' ? 'bg-amber-500' : s === 'available' ? 'bg-emerald-500' : 'bg-gray-300';
                  return (
                    <button key={slot} type="button" onClick={() => setBookingTime(slot)} className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold transition flex items-center gap-1 ${isSelected ? 'bg-[#008069] text-white shadow-xs' : 'bg-white text-[#54656f] border border-[#d1d7db] hover:border-[#008069] hover:bg-[#e8f5f2]'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                      {slot}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="font-bold text-[#111b21] block mb-1">Catatan (Opsional)</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Contoh: Menunggu persetujuan suami / opsi jam alternatif" rows={2} className="w-full px-3 py-2 bg-white rounded-xl border border-[#d1d7db] focus:border-[#008069] focus:ring-1 focus:ring-[#008069] outline-none text-xs text-[#111b21] resize-none" />
          </div>
        </form>

        <div className="p-4 border-t border-[#e9edef] bg-[#f8fafc] flex items-center justify-between">
          <button type="button" onClick={onClose} disabled={submitting} className="px-4 py-2 bg-white hover:bg-[#f0f2f5] text-[#54656f] border border-[#d1d7db] text-xs font-bold rounded-xl transition">Batal</button>
          <button type="button" onClick={handleSubmit} disabled={submitting} className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white text-xs font-bold rounded-xl transition shadow-md shadow-amber-500/25 flex items-center space-x-2 active:scale-95 disabled:opacity-50">
            {submitting ? (<><Loader2 size={14} className="animate-spin" /><span>Menyimpan...</span></>) : (<><Zap size={14} className="fill-current" /><span>⚡ Simpan & Tahan Slot</span></>)}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
