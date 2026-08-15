import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../../services/api';
import { useStaffAuth } from '../../contexts/StaffAuthContext';
import {
  Calendar,
  Clock,
  MapPin,
  Baby,
  CreditCard,
  Navigation,
  RefreshCw,
  LogOut,
  ChevronLeft,
  Search,
  MessageSquareOff,
  Compass,
  MessageSquare,
  CheckCircle2,
} from 'lucide-react';

interface StaffTaskChild {
  name: string;
  rawAgeText: string | null;
  birthDate: string | null;
}

interface StaffTaskAddress {
  kelurahan: string | null;
  kecamatan: string | null;
  kota: string | null;
  distanceKm: number | null;
  fullText: string;
}

interface StaffTaskPricing {
  treatmentFee: number;
  deliveryFee: number;
  totalFee: number;
  paymentStatus: 'LUNAS' | 'TAGIH_DI_TEMPAT';
  paymentStatusLabel: string;
}

interface StaffScheduleItem {
  reservationId: string;
  customerName: string | null;
  treatmentDetail: string | null;
  treatmentCategory: string | null;
  bookingDate: string | null;
  status: string;
  mapsUrl: string | null;
  navigationUrl: string | null;
  address: StaffTaskAddress;
  children: StaffTaskChild[];
  pricing: StaffTaskPricing;
}

function formatRupiah(amount: number): string {
  return 'Rp ' + (amount || 0).toLocaleString('id-ID');
}

export const StaffSchedule: React.FC = () => {
  const { staff, logout } = useStaffAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [scheduleList, setScheduleList] = useState<StaffScheduleItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchSchedule = useCallback(async (isPolling = false) => {
    if (!isPolling) setLoading(true);
    try {
      const res = await apiRequest('/api/staff/upcoming-schedule');
      if (res.success && Array.isArray(res.data)) {
        setScheduleList(res.data);
      }
    } catch (err: any) {
      if (!isPolling) setErrorMessage(err.message || 'Gagal memuat jadwal mendatang.');
    } finally {
      if (!isPolling) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  // Format full date in Indonesian locale (e.g. "Sabtu, 15 Agustus 2026")
  const formatDateGroup = (isoString: string | null) => {
    if (!isoString) return 'Jadwal Mendatang';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      return isoString;
    }
  };

  // Format time (e.g. "09.00 WIB")
  const formatTime = (isoString: string | null) => {
    if (!isoString) return '-';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace(':', '.') + ' WIB';
    } catch {
      return isoString;
    }
  };

  const filteredList = scheduleList.filter((item) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const nameMatch = (item.customerName || '').toLowerCase().includes(q);
    const addressMatch = (item.address?.fullText || '').toLowerCase().includes(q);
    const treatmentMatch = (item.treatmentDetail || '').toLowerCase().includes(q);
    return nameMatch || addressMatch || treatmentMatch;
  });

  // Group items by date string
  const groupedSchedule = filteredList.reduce<Record<string, StaffScheduleItem[]>>((acc, item) => {
    const key = formatDateGroup(item.bookingDate);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  return (
    <div className="min-h-[100dvh] bg-[#f0f2f5] text-[#111b21] flex flex-col font-sans select-none overflow-hidden antialiased">
      {/* WhatsApp Web Light Top Header */}
      <header className="h-16 bg-[#f0f2f5] border-b border-[#e9edef] px-4 flex items-center justify-between sticky top-0 z-30 shadow-sm">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => navigate('/admin/staff/today')}
            className="p-2 rounded-full bg-white hover:bg-[#e9edef] text-[#54656f] transition-all active:scale-95 border border-[#e9edef]"
            title="Kembali ke tugas hari ini"
          >
            <ChevronLeft size={20} />
          </button>

          <div className="h-10 w-10 rounded-full bg-[#008069] text-white flex items-center justify-center font-bold text-base shadow-sm">
            <Calendar size={20} />
          </div>

          <div>
            <div className="flex items-center space-x-2">
              <h1 className="font-bold text-base text-[#111b21] tracking-tight">
                Jadwal Kunjungan Mendatang
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#e7f8e8] text-[#008069] border border-[#00a884]/30">
                {scheduleList.length} Reservasi
              </span>
            </div>
            <p className="text-xs text-[#667781] font-medium">
              {staff?.name || 'Terapis'} • Jadwal hari esok dan seterusnya
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Switch to Chat/Today */}
          <button
            onClick={() => navigate('/admin/staff/today')}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-white hover:bg-[#e9edef] text-[#008069] text-xs font-bold transition-all border border-[#00a884]/30 shadow-xs"
          >
            <MessageSquare size={14} />
            <span className="hidden sm:inline">Buka Chat Hari Ini</span>
          </button>

          {/* Refresh Button */}
          <button
            onClick={() => fetchSchedule(false)}
            disabled={loading}
            className="p-2.5 rounded-full bg-white hover:bg-[#e9edef] text-[#54656f] hover:text-[#111b21] transition-all disabled:opacity-50 active:scale-95 border border-[#e9edef] shadow-sm"
            title="Muat Ulang Jadwal"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin text-[#008069]' : ''} />
          </button>

          {/* Logout Button */}
          <button
            onClick={logout}
            className="p-2.5 rounded-full bg-white hover:bg-rose-50 text-[#667781] hover:text-rose-600 transition-all active:scale-95 border border-[#e9edef] shadow-sm"
            title="Keluar dari Portal"
          >
            <LogOut size={15} />
          </button>
        </div>
      </header>

      {/* Notice Banner */}
      <div className="bg-[#ffffff] border-b border-[#e9edef] px-4 py-2 text-xs text-[#54656f] flex items-center justify-between shadow-xs">
        <div className="flex items-center space-x-2">
          <MessageSquareOff size={15} className="text-[#008069] flex-shrink-0" />
          <span>
            Halaman ini menampilkan jadwal persiapan kunjungan. Akses chat WhatsApp pasien akan otomatis terbuka pada hari pelaksanaan treatment.
          </span>
        </div>
      </div>

      {/* Main Content Viewport */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-5xl mx-auto w-full space-y-6">
        {/* Search Bar */}
        <div className="relative">
          <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-[#54656f]">
            <Search size={16} />
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari jadwal pasien mendatang (nama, kelurahan, treatment)..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white border border-[#e9edef] focus:border-[#008069] text-sm text-[#111b21] placeholder-[#667781] focus:outline-none transition-all shadow-xs"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-[#667781] hover:text-[#111b21] text-xs font-bold"
            >
              ✕
            </button>
          )}
        </div>

        {/* Schedule List */}
        {loading ? (
          <div className="flex flex-col justify-center items-center h-64 space-y-3 text-[#667781]">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#008069] border-t-transparent"></div>
            <span className="text-xs font-medium">Memuat jadwal reservasi mendatang...</span>
          </div>
        ) : Object.keys(groupedSchedule).length === 0 ? (
          <div className="text-center py-20 px-4 text-[#667781] space-y-3 bg-white rounded-2xl border border-[#e9edef] shadow-xs">
            <CheckCircle2 size={48} className="mx-auto text-[#008069]/40" />
            <div className="space-y-1 max-w-sm mx-auto">
              <h3 className="text-base font-bold text-[#111b21]">
                {searchQuery ? 'Tidak Ada Jadwal yang Cocok' : 'Belum Ada Jadwal Mendatang'}
              </h3>
              <p className="text-xs text-[#667781] leading-relaxed">
                {searchQuery
                  ? 'Coba gunakan kata kunci pencarian yang lain.'
                  : 'Reservasi pasien untuk hari esok dan seterusnya yang ditugaskan kepada Anda akan tampil di sini.'}
              </p>
            </div>
          </div>
        ) : (
          Object.entries(groupedSchedule).map(([dateLabel, items]) => (
            <div key={dateLabel} className="space-y-3">
              {/* Date Header Pill */}
              <div className="flex items-center space-x-2 pt-2">
                <span className="h-2.5 w-2.5 rounded-full bg-[#008069]"></span>
                <h2 className="font-bold text-sm text-[#111b21]">{dateLabel}</h2>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white text-[#54656f] border border-[#e9edef]">
                  {items.length} Kunjungan
                </span>
              </div>

              {/* Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {items.map((item) => (
                  <div
                    key={item.reservationId}
                    className="bg-white rounded-2xl p-4 border border-[#e9edef] shadow-xs hover:border-[#008069]/40 transition-all space-y-3 text-left"
                  >
                    {/* Header: Name & Time */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <div className="h-10 w-10 rounded-full bg-[#dfe5e7] text-[#54656f] flex items-center justify-center font-bold text-sm flex-shrink-0 border border-[#e9edef]">
                          {item.customerName ? item.customerName.charAt(0).toUpperCase() : 'P'}
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-bold text-sm text-[#111b21] truncate">
                            {item.customerName || 'Customer'}
                          </h3>
                          <p className="text-xs text-[#008069] font-medium truncate">
                            {item.treatmentDetail || 'Treatment Layanan Spa'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-1 text-xs font-semibold text-[#008069] bg-[#d9fdd3] px-2.5 py-1 rounded-lg whitespace-nowrap border border-[#00a884]/30 flex-shrink-0">
                        <Clock size={12} />
                        <span>{formatTime(item.bookingDate)}</span>
                      </div>
                    </div>

                    {/* Alamat & Jarak dari Klinik */}
                    <div className="text-xs text-[#54656f] flex items-start gap-1.5 bg-[#f0f2f5] p-2.5 rounded-xl border border-[#e9edef]">
                      <MapPin size={14} className="text-[#008069] mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-[#111b21] leading-snug">{item.address.fullText}</p>
                        {item.address.distanceKm != null && (
                          <p className="text-[10px] font-semibold text-[#008069] mt-1 flex items-center gap-1">
                            <Compass size={11} />
                            <span>Jarak: {item.address.distanceKm.toFixed(1)} km dari klinik</span>
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Data Pasien Bayi / Anak */}
                    {item.children && item.children.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {item.children.map((child, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-[#e7f8e8] text-[#008069] text-xs font-medium border border-[#00a884]/20"
                          >
                            <Baby size={12} />
                            <span>{child.name}</span>
                            {child.rawAgeText && (
                              <span className="text-[#667781]">({child.rawAgeText})</span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Total Biaya & Peta Navigasi */}
                    <div className="flex items-center justify-between pt-2 border-t border-[#f0f2f5]">
                      <div className="flex items-center gap-1 text-xs text-[#667781]">
                        <CreditCard size={13} className="text-[#008069]" />
                        <span>Biaya:</span>
                        <strong className="text-[#111b21] ml-0.5">{formatRupiah(item.pricing.totalFee)}</strong>
                      </div>

                      {item.navigationUrl || item.mapsUrl ? (
                        <a
                          href={item.navigationUrl || item.mapsUrl || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center space-x-1 py-1.5 px-3 text-xs font-semibold text-white bg-[#008069] hover:bg-[#00a884] rounded-lg transition-all active:scale-95 shadow-xs"
                          title="Buka Peta Google Maps"
                        >
                          <Navigation size={12} />
                          <span>Peta Rute</span>
                        </a>
                      ) : (
                        <span className="text-[11px] text-[#667781]">Peta Belum Ada</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
