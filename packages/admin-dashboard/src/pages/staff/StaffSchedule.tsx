import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../../services/api';
import { useStaffAuth } from '../../contexts/StaffAuthContext';
import { useUiFeedback } from '../../components/common/UiFeedback';
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
  Sparkles,
  Smile,
  User,
  UserCheck,
  X,
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
  estimatedMinutes?: number | null;
  distanceSource?: 'CLINIC' | 'PREVIOUS_PATIENT' | null;
  originName?: string | null;
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
  const { confirm } = useUiFeedback();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [scheduleList, setScheduleList] = useState<StaffScheduleItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [detailModalItem, setDetailModalItem] = useState<StaffScheduleItem | null>(null);

  const getCategoryIcon = (category: string | null) => {
    const cat = (category || '').toUpperCase();
    if (cat === 'BABY') {
      return {
        icon: <Baby size={18} className="text-sky-600" />,
        bg: 'bg-sky-100 border-sky-200 text-sky-700',
        borderAccent: 'border-l-sky-500 bg-sky-50/20',
        label: 'Baby Spa',
      };
    }
    if (cat === 'MOMS') {
      return {
        icon: <Sparkles size={18} className="text-purple-600" />,
        bg: 'bg-purple-100 border-purple-200 text-purple-700',
        borderAccent: 'border-l-purple-500 bg-purple-50/20',
        label: 'Moms Spa',
      };
    }
    if (cat === 'BOTH' || cat === 'KIDS') {
      return {
        icon: <Smile size={18} className="text-emerald-600" />,
        bg: 'bg-emerald-100 border-emerald-200 text-emerald-700',
        borderAccent: 'border-l-emerald-500 bg-emerald-50/20',
        label: 'Moms & Baby',
      };
    }
    return {
      icon: <User size={18} className="text-teal-600" />,
      bg: 'bg-teal-100 border-teal-200 text-teal-700',
      borderAccent: 'border-l-teal-500 bg-teal-50/20',
      label: 'Treatment',
    };
  };

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
      {/* WhatsApp Web Minimalist Clean Top Header */}
      <header className="h-14 bg-[#f0f2f5] border-b border-[#e9edef] px-4 flex items-center justify-between sticky top-0 z-30 shadow-xs">
        <div className="flex items-center space-x-2.5 min-w-0">
          <button
            onClick={() => navigate('/admin/staff/today')}
            className="p-2 rounded-full bg-white hover:bg-[#e9edef] text-[#54656f] transition-all active:scale-95 border border-[#e9edef] flex-shrink-0"
            title="Kembali ke tugas hari ini"
            aria-label="Kembali"
          >
            <ChevronLeft size={18} />
          </button>

          {/* Interactive Profile Avatar Button */}
          <button
            type="button"
            onClick={() => setShowProfileModal(true)}
            className="h-9 w-9 rounded-full bg-[#008069] text-white hover:bg-[#00a884] flex items-center justify-center shadow-xs transition-all active:scale-95 flex-shrink-0"
            title="Buka profil staff & logout"
          >
            <UserCheck size={18} />
          </button>

          <div className="min-w-0">
            <h1 className="font-bold text-sm sm:text-base text-[#111b21] tracking-tight truncate">
              {staff?.name || 'Terapis'}
            </h1>
            <p className="text-[11px] text-[#667781] truncate">
              {scheduleList.length} Jadwal Mendatang
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 flex-shrink-0">
          <button
            onClick={() => navigate('/admin/staff/today')}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-white hover:bg-[#e9edef] text-[#008069] text-xs font-bold transition-all border border-[#00a884]/30 shadow-xs"
          >
            <MessageSquare size={13} />
            <span className="hidden sm:inline">Buka Chat Hari Ini</span>
          </button>

          <button
            onClick={() => fetchSchedule(false)}
            disabled={loading}
            className="p-2 rounded-full bg-white hover:bg-[#e9edef] text-[#54656f] hover:text-[#111b21] transition-all disabled:opacity-50 active:scale-95 border border-[#e9edef] shadow-xs"
            title="Muat Ulang Jadwal"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin text-[#008069]' : ''} />
          </button>
        </div>
      </header>

      {/* Notice Banner */}
      <div className="bg-white border-b border-[#e9edef] px-4 py-2 text-xs text-[#54656f] flex items-center justify-between shadow-xs">
        <div className="flex items-center space-x-2">
          <MessageSquareOff size={14} className="text-[#008069] flex-shrink-0" />
          <span>
            Halaman ini menampilkan jadwal persiapan kunjungan. Akses chat WhatsApp pasien akan otomatis terbuka pada hari H treatment.
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
                {items.map((item) => {
                  const catInfo = getCategoryIcon(item.treatmentCategory);
                  return (
                    <div
                      key={item.reservationId}
                      className={`bg-white rounded-2xl p-4 border border-[#e9edef] shadow-xs hover:border-[#008069]/40 transition-all space-y-3 text-left ${catInfo.borderAccent} border-l-4`}
                    >
                      {/* Header: Name & Time */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center space-x-2.5 min-w-0">
                          {/* Service Category Icon - Click to view detail */}
                          <button
                            type="button"
                            onClick={() => setDetailModalItem(item)}
                            className={`h-10 w-10 rounded-2xl flex items-center justify-center flex-shrink-0 border shadow-xs transition-all active:scale-95 ${catInfo.bg}`}
                            title="Lihat detail lengkap pasien"
                          >
                            {catInfo.icon}
                          </button>
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
                              <span>
                                {item.address.distanceSource === 'PREVIOUS_PATIENT' && item.address.originName
                                  ? `Jarak: ${item.address.distanceKm.toFixed(1)} km dari ${item.address.originName}`
                                  : `Jarak: ${item.address.distanceKm.toFixed(1)} km dari klinik`}
                                {item.address.estimatedMinutes != null && (
                                  <span className="text-[#54656f] font-normal ml-1">
                                    (±{item.address.estimatedMinutes} mnt perjalanan)
                                  </span>
                                )}
                              </span>
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
                          {item.pricing.deliveryFee > 0 && (
                            <span className="text-[10px] text-[#667781] font-medium ml-0.5">
                              (ongkir {formatRupiah(item.pricing.deliveryFee)})
                            </span>
                          )}
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
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Staff Profile Modal */}
      {showProfileModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fadeIn"
          onClick={() => setShowProfileModal(false)}
        >
          <div
            className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl border border-[#e9edef] space-y-5 text-center relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowProfileModal(false)}
              className="absolute top-4 right-4 p-1.5 rounded-full text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5] transition"
            >
              <X size={18} />
            </button>

            <div className="mx-auto h-20 w-20 rounded-3xl bg-[#e8f5f2] border-2 border-[#c2e7e0] text-[#008069] flex items-center justify-center shadow-inner">
              <UserCheck size={40} />
            </div>

            <div className="space-y-1">
              <h3 className="font-bold text-lg text-[#111b21]">
                {staff?.name || 'Terapis'}
              </h3>
              <p className="text-xs text-[#667781] font-mono">
                {staff?.phone || 'Akun Terapis'}
              </p>
              <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-[#d9fdd3] text-[#008069] border border-[#00a884]/30 mt-1">
                Staff Terapis Lapangan
              </span>
            </div>

            <div className="pt-2 space-y-2">
              <button
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Keluar dari Portal?',
                    message: 'Apakah Anda yakin ingin keluar dari akun terapis ini?',
                    confirmText: 'Ya, Keluar',
                    danger: true,
                  });
                  if (ok) {
                    setShowProfileModal(false);
                    logout();
                  }
                }}
                className="w-full py-3 px-4 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-2xl text-sm font-bold transition flex items-center justify-center space-x-2 shadow-xs"
              >
                <LogOut size={16} />
                <span>Keluar Akun (Logout)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer Detail Modal (Privacy Safe - No Phone Leak) */}
      {detailModalItem && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fadeIn"
          onClick={() => setDetailModalItem(null)}
        >
          <div
            className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl border border-[#e9edef] space-y-4 text-left relative max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-[#e9edef] pb-3">
              <div className="flex items-center space-x-3">
                <div className={`h-11 w-11 rounded-2xl flex items-center justify-center border shadow-xs ${getCategoryIcon(detailModalItem.treatmentCategory).bg}`}>
                  {getCategoryIcon(detailModalItem.treatmentCategory).icon}
                </div>
                <div>
                  <h3 className="font-bold text-base text-[#111b21]">
                    {detailModalItem.customerName || 'Customer'}
                  </h3>
                  <div className="flex items-center space-x-1.5 text-xs text-[#008069] font-semibold mt-0.5">
                    <Clock size={12} />
                    <span>{formatTime(detailModalItem.bookingDate)}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setDetailModalItem(null)}
                className="p-1.5 rounded-full text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5] transition"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-3.5 rounded-2xl bg-[#f8fafc] border border-[#e9edef] space-y-1.5">
              <span className="text-[10px] font-bold text-[#667781] uppercase tracking-wider block">
                Layanan & Treatment
              </span>
              <p className="text-sm font-bold text-[#111b21]">
                {detailModalItem.treatmentDetail || 'Treatment Layanan Spa'}
              </p>
              <span className="inline-block px-2.5 py-0.5 rounded-md text-xs font-semibold bg-[#e8f5f2] text-[#008069] border border-[#c2e7e0]">
                Kategori: {getCategoryIcon(detailModalItem.treatmentCategory).label}
              </span>
            </div>

            <div className="p-3.5 rounded-2xl bg-[#f8fafc] border border-[#e9edef] space-y-2">
              <span className="text-[10px] font-bold text-[#667781] uppercase tracking-wider block">
                Alamat Lokasi Kunjungan
              </span>
              <div className="flex items-start space-x-2 text-xs text-[#111b21]">
                <MapPin size={15} className="text-[#008069] mt-0.5 flex-shrink-0" />
                <div className="leading-relaxed">
                  <p className="font-medium">{detailModalItem.address.fullText}</p>
                  {detailModalItem.address.distanceKm != null && (
                    <p className="text-[11px] font-semibold text-[#008069] mt-1 flex items-center space-x-1">
                      <Compass size={12} />
                      <span>
                        {detailModalItem.address.distanceSource === 'PREVIOUS_PATIENT' && detailModalItem.address.originName
                          ? `${detailModalItem.address.distanceKm.toFixed(1)} km dari ${detailModalItem.address.originName}`
                          : `${detailModalItem.address.distanceKm.toFixed(1)} km dari klinik`}
                        {detailModalItem.address.estimatedMinutes != null && (
                          <span className="text-[#667781] font-normal ml-1">
                            (±{detailModalItem.address.estimatedMinutes} menit)
                          </span>
                        )}
                      </span>
                    </p>
                  )}
                </div>
              </div>
            </div>

            {detailModalItem.children && detailModalItem.children.length > 0 && (
              <div className="p-3.5 rounded-2xl bg-[#f8fafc] border border-[#e9edef] space-y-1.5">
                <span className="text-[10px] font-bold text-[#667781] uppercase tracking-wider block">
                  Data Pasien Anak
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {detailModalItem.children.map((c, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-xl bg-sky-50 text-sky-800 border border-sky-200 text-xs font-semibold"
                    >
                      <Baby size={13} />
                      <span>{c.name} {c.rawAgeText ? `(${c.rawAgeText})` : ''}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="p-3.5 rounded-2xl bg-[#f8fafc] border border-[#e9edef] space-y-2">
              <span className="text-[10px] font-bold text-[#667781] uppercase tracking-wider block">
                Rincian Biaya & Status Pembayaran
              </span>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between text-[#667781]">
                  <span>Biaya Layanan:</span>
                  <span>{formatRupiah(detailModalItem.pricing.treatmentFee)}</span>
                </div>
                <div className="flex justify-between text-[#667781]">
                  <span>Ongkos Kirim:</span>
                  <span>{formatRupiah(detailModalItem.pricing.deliveryFee)}</span>
                </div>
                <div className="flex justify-between font-bold text-[#111b21] pt-1 border-t border-[#e9edef]">
                  <span>Total Tagihan:</span>
                  <span className="text-[#008069] text-sm">{formatRupiah(detailModalItem.pricing.totalFee)}</span>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between">
                <span className="text-xs text-[#667781]">Status Pembayaran:</span>
                {detailModalItem.pricing.paymentStatus === 'LUNAS' ? (
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-[#d9fdd3] text-[#008069] border border-[#00a884]/30 flex items-center space-x-1">
                    <CheckCircle2 size={12} />
                    <span>LUNAS</span>
                  </span>
                ) : (
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300 flex items-center space-x-1">
                    <CreditCard size={12} />
                    <span>TAGIH DI TEMPAT</span>
                  </span>
                )}
              </div>
            </div>

            <div className="pt-1 flex space-x-2">
              {(detailModalItem.navigationUrl || detailModalItem.mapsUrl) && (
                <a
                  href={detailModalItem.navigationUrl || detailModalItem.mapsUrl || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-3 px-4 bg-[#008069] hover:bg-[#00a884] text-white rounded-2xl text-xs font-bold transition flex items-center justify-center space-x-1.5 shadow-xs"
                >
                  <Navigation size={14} />
                  <span>Buka Peta Navigasi</span>
                </a>
              )}
              <button
                onClick={() => setDetailModalItem(null)}
                className="py-3 px-5 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#111b21] rounded-2xl text-xs font-bold transition shadow-xs"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
