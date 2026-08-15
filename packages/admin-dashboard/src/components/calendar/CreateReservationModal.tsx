import React, { useState, useEffect, useMemo } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';
import { 
  X, 
  Calendar as CalendarIcon, 
  Search, 
  User, 
  Baby, 
  Sparkles, 
  Clock, 
  ChevronDown, 
  Check, 
  Plus, 
  MapPin,
  FileText
} from 'lucide-react';
import { ClinicServiceItem, StaffOption, QuickSlotTarget } from './types';

interface CreateReservationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  staffList: StaffOption[];
  initialSlotTarget?: QuickSlotTarget | null;
}

export const CreateReservationModal: React.FC<CreateReservationModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  staffList,
  initialSlotTarget,
}) => {
  const { toast } = useUiFeedback();
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomerInfo, setSelectedCustomerInfo] = useState<any | null>(null);
  const [customerResults, setCustomerResults] = useState<any[]>([]);
  const [searchingCustomer, setSearchingCustomer] = useState(false);

  // Service Selection State
  const [services, setServices] = useState<ClinicServiceItem[]>([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [serviceSearch, setServiceSearch] = useState('');
  const [selectedService, setSelectedService] = useState<ClinicServiceItem | null>(null);
  const [isCustomService, setIsCustomService] = useState(false);
  const [isServiceDropdownOpen, setIsServiceDropdownOpen] = useState(false);

  // Treatment Details
  const [treatmentCategory, setTreatmentCategory] = useState<'BABY' | 'MOMS' | 'BOTH' | 'KIDS' | 'BUNDLE'>('BABY');
  const [treatmentDetail, setTreatmentDetail] = useState('');

  // Date & Time
  const [bookingDate, setBookingDate] = useState('');
  const [bookingTime, setBookingTime] = useState('09:00');
  const [durationMinutes, setDurationMinutes] = useState(60);

  // Staff & Status
  const [assignedStaffId, setAssignedStaffId] = useState('');
  const [status, setStatus] = useState<'pending' | 'confirmed'>('pending');
  const [notes, setNotes] = useState('');

  // Children / Babies
  const [babies, setBabies] = useState<Array<{ name: string; ageText: string }>>([]);

  // Load clinic services catalog
  useEffect(() => {
    async function loadCatalog() {
      try {
        setLoadingServices(true);
        const res = await apiRequest('/api/admin/services');
        const list = Array.isArray(res) ? res : res?.data || [];
        setServices(list.filter((s: ClinicServiceItem) => s.isActive !== false));
      } catch {
        // Fallback demo services
        setServices([
          { id: '1', name: 'Pijat Bayi Sehat & Ceria', category: 'BABY', durationMinutes: 45, originalPrice: 75000, promoPrice: 65000, description: 'Pijat relaksasi bayi', isActive: true },
          { id: '2', name: 'Baby Hydrotherapy & Spa', category: 'BABY', durationMinutes: 60, originalPrice: 120000, promoPrice: 99000, description: 'Berenang & stimulasi sensorik', isActive: true },
          { id: '3', name: 'Pijat Laktasi & Breast Care', category: 'MOMS', durationMinutes: 60, originalPrice: 135000, promoPrice: 110000, description: 'Melancarkan produksi ASI', isActive: true },
          { id: '4', name: 'Postpartum Massage (Pijat Nifas)', category: 'MOMS', durationMinutes: 90, originalPrice: 185000, promoPrice: 150000, description: 'Pemulihan pasca melahirkan', isActive: true },
          { id: '5', name: 'Paket Bundling Bunda & Buah Hati', category: 'BOTH', durationMinutes: 90, originalPrice: 220000, promoPrice: 185000, description: 'Treatment komplit mom & baby', isActive: true },
        ]);
      } finally {
        setLoadingServices(false);
      }
    }
    if (isOpen) {
      loadCatalog();
    }
  }, [isOpen]);

  // Sync initial target slot if opened via calendar slot click
  useEffect(() => {
    if (isOpen && initialSlotTarget) {
      const d = new Date(initialSlotTarget.date);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      setBookingDate(`${yyyy}-${mm}-${dd}`);

      const hh = String(initialSlotTarget.hour || 9).padStart(2, '0');
      setBookingTime(`${hh}:00`);
    } else if (isOpen && !bookingDate) {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      setBookingDate(`${yyyy}-${mm}-${dd}`);
      setBookingTime('09:00');
    }
  }, [isOpen, initialSlotTarget]);

  // Customer search
  const handleCustomerSearch = async (query: string) => {
    setCustomerSearch(query);
    if (!query || query.length < 2) {
      setCustomerResults([]);
      return;
    }
    setSearchingCustomer(true);
    try {
      const params = new URLSearchParams({ search: query, pageSize: '8' });
      const res = await apiRequest(`/api/admin/customers?${params.toString()}`);
      setCustomerResults(res?.customers || res?.data || []);
    } catch {
      setCustomerResults([]);
    } finally {
      setSearchingCustomer(false);
    }
  };

  const handleSelectCustomer = (c: any) => {
    setCustomerId(c.id);
    setSelectedCustomerInfo(c);
    setCustomerSearch(`${c.name || 'Bunda'} (${c.phone})`);
    setCustomerResults([]);

    // If customer has registered children, pre-fill or make available
    if (c.children && c.children.length > 0) {
      setBabies(
        c.children.map((child: any) => ({
          name: child.name,
          ageText: child.current_age || child.raw_age_text || '',
        }))
      );
    }
  };

  // Filter services by search term
  const filteredServices = useMemo(() => {
    if (!serviceSearch.trim()) return services;
    const q = serviceSearch.toLowerCase();
    return services.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        (s.description && s.description.toLowerCase().includes(q))
    );
  }, [services, serviceSearch]);

  // Service selection handler
  const handleSelectService = (srv: ClinicServiceItem) => {
    setSelectedService(srv);
    setIsCustomService(false);
    setTreatmentCategory(srv.category);
    setTreatmentDetail(srv.name);
    setDurationMinutes(srv.durationMinutes || 60);
    setIsServiceDropdownOpen(false);
  };

  // End time calculation
  const calculateEndTime = () => {
    if (!bookingTime) return '';
    const [h, m] = bookingTime.split(':').map(Number);
    const totalMinutes = h * 60 + m + (durationMinutes || 60);
    const endH = Math.floor(totalMinutes / 60) % 24;
    const endM = totalMinutes % 60;
    return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
  };

  const handleAddBaby = () => {
    setBabies((prev) => [...prev, { name: '', ageText: '' }]);
  };

  const handleUpdateBaby = (idx: number, field: 'name' | 'ageText', val: string) => {
    setBabies((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      return next;
    });
  };

  const handleRemoveBaby = (idx: number) => {
    setBabies((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId) {
      toast('Pilih customer terlebih dahulu', 'error');
      return;
    }
    if (!treatmentDetail.trim()) {
      toast('Pilih layanan atau masukkan rincian treatment', 'error');
      return;
    }

    let fullBookingIso: string | undefined = undefined;
    if (bookingDate && bookingTime) {
      fullBookingIso = new Date(`${bookingDate}T${bookingTime}:00`).toISOString();
    }

    setSubmitting(true);
    try {
      await apiRequest('/api/admin/reservation', {
        method: 'POST',
        body: JSON.stringify({
          customerId,
          treatmentCategory,
          treatmentDetail,
          bookingDate: fullBookingIso,
          assignedStaffId: assignedStaffId || undefined,
          status,
          notes: notes.trim() || undefined,
          babies: babies.filter((b) => b.name.trim().length > 0),
        }),
      });

      toast('Jadwal reservasi berhasil dibuat!', 'success');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast(`Gagal membuat jadwal: ${err.message || 'Terjadi kesalahan'}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-2xl bg-white border border-[#e9edef] rounded-2xl p-5 sm:p-6 shadow-2xl relative my-8 max-h-[92vh] flex flex-col">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5] transition-colors"
        >
          <X size={18} />
        </button>

        {/* Modal Header */}
        <div className="mb-4 pr-6">
          <h3 className="text-base sm:text-lg font-bold text-[#111b21] flex items-center space-x-2">
            <CalendarIcon size={18} className="text-[#008069] flex-shrink-0" />
            <span>Buat Jadwal Baru</span>
          </h3>
          <p className="text-xs text-[#667781] mt-0.5">
            Jadwalkan kunjungan perawatan secara lengkap dan terstruktur
          </p>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto pr-1 flex-1">
          {/* Section 1: Customer Picker */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-[#667781] uppercase tracking-wider block">
              Customer / Pasien *
            </label>
            <div className="relative">
              <input
                type="text"
                value={customerSearch}
                onChange={(e) => handleCustomerSearch(e.target.value)}
                placeholder="Cari nama atau nomor WhatsApp customer..."
                className="w-full pl-9 pr-4 py-2.5 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
              />
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-[#8696a0] pointer-events-none">
                <Search size={14} />
              </span>
              {customerId && (
                <button
                  type="button"
                  onClick={() => {
                    setCustomerId('');
                    setCustomerSearch('');
                    setSelectedCustomerInfo(null);
                  }}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#8696a0] hover:text-rose-500"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {searchingCustomer && (
              <p className="text-[11px] text-[#008069] font-semibold animate-pulse">
                Mencari data customer...
              </p>
            )}

            {/* Customer search results dropdown */}
            {customerResults.length > 0 && !customerId && (
              <div className="border border-[#e9edef] rounded-xl bg-white max-h-48 overflow-y-auto divide-y divide-[#e9edef] shadow-lg z-20">
                {customerResults.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleSelectCustomer(c)}
                    className="w-full text-left px-3 py-2.5 hover:bg-[#f8fafc] text-xs text-[#111b21] flex justify-between items-center transition-colors"
                  >
                    <div>
                      <span className="font-bold">{c.name || 'Bunda'}</span>
                      <span className="text-[#667781] ml-2 font-mono">{c.phone}</span>
                      {c.kelurahan && (
                        <p className="text-[10px] text-[#8696a0]">
                          {c.kelurahan}, {c.kecamatan}
                        </p>
                      )}
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#e8f5f2] text-[#008069] font-bold">
                      Pilih
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Selected Customer Details Banner */}
            {selectedCustomerInfo && (
              <div className="p-3 bg-[#e8f5f2] border border-[#c2e7e0] rounded-xl flex items-start justify-between text-xs text-[#008069]">
                <div className="space-y-0.5">
                  <p className="font-bold">{selectedCustomerInfo.name || 'Bunda'} ({selectedCustomerInfo.phone})</p>
                  {selectedCustomerInfo.kelurahan && (
                    <p className="text-[11px] text-[#54656f] flex items-center space-x-1">
                      <MapPin size={11} className="text-[#008069]" />
                      <span>{selectedCustomerInfo.kelurahan}, {selectedCustomerInfo.kecamatan} ({selectedCustomerInfo.distance_km?.toFixed(1) || '0'} km)</span>
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Section 2: Searchable Service Catalog Dropdown */}
          <div className="space-y-1.5 relative">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-[#667781] uppercase tracking-wider block">
                Layanan Klinik / Treatment *
              </label>
              <button
                type="button"
                onClick={() => {
                  setIsCustomService(!isCustomService);
                  if (!isCustomService) {
                    setSelectedService(null);
                  }
                }}
                className="text-[11px] text-[#008069] font-bold hover:underline"
              >
                {isCustomService ? '← Pilih dari Katalog' : '+ Input Manual / Kustom'}
              </button>
            </div>

            {!isCustomService ? (
              <div className="relative">
                {/* Trigger Button */}
                <button
                  type="button"
                  onClick={() => setIsServiceDropdownOpen(!isServiceDropdownOpen)}
                  className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-xl text-xs text-left text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs flex items-center justify-between"
                >
                  <div className="flex items-center space-x-2 truncate">
                    <Sparkles size={14} className="text-[#008069] flex-shrink-0" />
                    <span className="truncate font-semibold">
                      {selectedService ? selectedService.name : 'Pilih layanan dari katalog...'}
                    </span>
                    {selectedService && (
                      <span className="px-2 py-0.2 rounded-full text-[10px] font-bold bg-[#e8f5f2] text-[#008069]">
                        {selectedService.category} · {selectedService.durationMinutes}m
                      </span>
                    )}
                  </div>
                  <ChevronDown size={14} className="text-[#8696a0] flex-shrink-0" />
                </button>

                {/* Dropdown Menu */}
                {isServiceDropdownOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-[#d1d7db] rounded-xl shadow-xl z-30 p-2 space-y-2 max-h-64 overflow-y-auto">
                    {/* Search inside dropdown */}
                    <div className="relative">
                      <input
                        type="text"
                        value={serviceSearch}
                        onChange={(e) => setServiceSearch(e.target.value)}
                        placeholder="Ketik nama layanan atau kategori..."
                        className="w-full pl-8 pr-3 py-1.5 bg-[#f0f2f5] border border-[#d1d7db] rounded-lg text-xs text-[#111b21] focus:outline-none focus:border-[#008069]"
                        autoFocus
                      />
                      <Search size={13} className="absolute left-2.5 top-2.5 text-[#8696a0]" />
                    </div>

                    {/* Service list items */}
                    <div className="divide-y divide-[#e9edef] max-h-48 overflow-y-auto">
                      {filteredServices.length === 0 ? (
                        <div className="p-3 text-center text-xs text-[#8696a0]">
                          Tidak ada layanan yang cocok.
                        </div>
                      ) : (
                        filteredServices.map((srv) => (
                          <div
                            key={srv.id}
                            onClick={() => handleSelectService(srv)}
                            className="p-2 hover:bg-[#e8f5f2] rounded-lg cursor-pointer transition-colors flex items-center justify-between group"
                          >
                            <div>
                              <div className="flex items-center space-x-1.5">
                                <span className="font-bold text-xs text-[#111b21] group-hover:text-[#008069]">
                                  {srv.name}
                                </span>
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-[#f0f2f5] text-[#54656f]">
                                  {srv.category}
                                </span>
                              </div>
                              {srv.description && (
                                <p className="text-[10px] text-[#667781] line-clamp-1 mt-0.5">
                                  {srv.description}
                                </p>
                              )}
                            </div>
                            <div className="text-right flex-shrink-0 ml-2">
                              <span className="text-xs font-bold text-[#008069]">
                                Rp {srv.promoPrice ? srv.promoPrice.toLocaleString('id-ID') : srv.originalPrice?.toLocaleString('id-ID')}
                              </span>
                              <span className="block text-[10px] text-[#8696a0]">
                                {srv.durationMinutes} mnt
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Custom Service Input */
              <input
                type="text"
                value={treatmentDetail}
                onChange={(e) => setTreatmentDetail(e.target.value)}
                placeholder="Masukkan nama treatment kustom (misal: Pijat Relaksasi Khusus)"
                className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
              />
            )}
          </div>

          {/* Section 3: Treatment Category Pills */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-[#667781] uppercase tracking-wider block">
              Kategori Treatment
            </label>
            <div className="flex flex-wrap gap-1.5">
              {(['BABY', 'MOMS', 'KIDS', 'BOTH', 'BUNDLE'] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setTreatmentCategory(cat)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                    treatmentCategory === cat
                      ? 'bg-[#e8f5f2] border-[#008069] text-[#008069] font-bold shadow-xs'
                      : 'border-[#d1d7db] text-[#54656f] bg-white hover:bg-[#f0f2f5]'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Section 4: Date, Time & Duration */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Date */}
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-[#667781] uppercase tracking-wider block">
                Tanggal Kunjungan
              </label>
              <input
                type="date"
                value={bookingDate}
                onChange={(e) => setBookingDate(e.target.value)}
                className="w-full p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
              />
            </div>

            {/* Start Time */}
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-[#667781] uppercase tracking-wider block">
                Jam Mulai (WIB)
              </label>
              <input
                type="time"
                value={bookingTime}
                onChange={(e) => setBookingTime(e.target.value)}
                className="w-full p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
              />
            </div>

            {/* Duration / End Time */}
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-[#667781] uppercase tracking-wider block">
                Durasi & Jam Selesai
              </label>
              <div className="flex items-center space-x-1.5">
                <select
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  className="flex-1 p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                >
                  <option value={30}>30 mnt</option>
                  <option value={45}>45 mnt</option>
                  <option value={60}>60 mnt</option>
                  <option value={90}>90 mnt</option>
                  <option value={120}>120 mnt</option>
                </select>
                <span className="text-[11px] font-bold text-[#008069] bg-[#e8f5f2] px-2 py-2 rounded-xl border border-[#c2e7e0] whitespace-nowrap">
                  s.d. {calculateEndTime()}
                </span>
              </div>
            </div>
          </div>

          {/* Section 5: Staff / Terapis Assignment & Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Staff */}
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-[#667781] uppercase tracking-wider block">
                Penugasan Terapis
              </label>
              <select
                value={assignedStaffId}
                onChange={(e) => setAssignedStaffId(e.target.value)}
                className="w-full p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
              >
                <option value="">-- Belum Ditugaskan --</option>
                {staffList
                  .filter((s) => s.active !== false)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>

            {/* Status */}
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-[#667781] uppercase tracking-wider block">
                Status Pembayaran / Booking
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="w-full p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
              >
                <option value="pending">Pending (Menunggu Pembayaran)</option>
                <option value="confirmed">Confirmed (Lunas / Terkonfirmasi)</option>
              </select>
            </div>
          </div>

          {/* Section 6: Children / Baby details (for Baby / Both) */}
          {treatmentCategory !== 'MOMS' && (
            <div className="space-y-2 p-3.5 bg-[#f8fafc] border border-[#e9edef] rounded-xl">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-[#008069] uppercase tracking-wider flex items-center space-x-1.5">
                  <Baby size={14} />
                  <span>Data Bayi / Anak</span>
                </span>
                <button
                  type="button"
                  onClick={handleAddBaby}
                  className="px-2.5 py-1 rounded-lg bg-white border border-[#d1d7db] text-[11px] font-bold text-[#111b21] hover:bg-[#f0f2f5] shadow-xs flex items-center space-x-1"
                >
                  <Plus size={12} />
                  <span>Tambah Bayi</span>
                </button>
              </div>

              {babies.length === 0 ? (
                <p className="text-[11px] text-[#8696a0] italic">
                  Belum ada data bayi/anak yang diisi.
                </p>
              ) : (
                <div className="space-y-2">
                  {babies.map((b, idx) => (
                    <div key={idx} className="flex items-center space-x-2">
                      <input
                        type="text"
                        value={b.name}
                        onChange={(e) => handleUpdateBaby(idx, 'name', e.target.value)}
                        placeholder="Nama bayi/anak"
                        className="flex-1 p-2 bg-white border border-[#d1d7db] rounded-lg text-xs text-[#111b21] focus:outline-none focus:border-[#008069]"
                      />
                      <input
                        type="text"
                        value={b.ageText}
                        onChange={(e) => handleUpdateBaby(idx, 'ageText', e.target.value)}
                        placeholder="Usia (mis. 6 bulan)"
                        className="w-32 p-2 bg-white border border-[#d1d7db] rounded-lg text-xs text-[#111b21] focus:outline-none focus:border-[#008069]"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveBaby(idx)}
                        className="p-2 text-[#8696a0] hover:text-rose-600 rounded-lg hover:bg-rose-50"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Section 7: Notes */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-[#667781] uppercase tracking-wider block flex items-center space-x-1">
              <FileText size={12} />
              <span>Catatan / Keluhan Khusus Pasien</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contoh: Pasien minta terapis senior, anak sedang pilek ringan..."
              rows={2}
              className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] resize-none shadow-xs"
            />
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t border-[#e9edef] flex items-center justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-[#d1d7db] text-xs font-semibold text-[#54656f] hover:bg-[#f0f2f5] transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 rounded-xl bg-[#008069] hover:bg-[#00a884] disabled:opacity-50 text-white text-xs font-semibold flex items-center space-x-1.5 shadow-xs transition-colors"
            >
              <Check size={14} />
              <span>{submitting ? 'Menyimpan...' : 'Simpan & Buat Jadwal'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
