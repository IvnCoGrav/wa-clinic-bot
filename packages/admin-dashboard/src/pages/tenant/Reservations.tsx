import React, { useEffect, useState, useMemo, useRef } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import { Reservation } from '../../types';
import { extractBabiesFromRawText } from '../../utils/reservationBabies';
import { 
  Search, 
  Calendar as CalendarIcon, 
  User, 
  Baby, 
  MapPin, 
  Check, 
  X, 
  Info, 
  FileText, 
  AlertTriangle, 
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  LayoutGrid,
  ListFilter,
  Columns,
  Eye,
  Receipt,
  Upload,
  Trash2,
  Maximize2,
  Navigation,
  Compass,
  Camera,
  PenLine,
  CheckCircle,
  CheckCheck,
} from 'lucide-react';
import { CalendarViewMode, CalendarFilterState, QuickSlotTarget, StaffOption } from '../../components/calendar/types';
import { WeekScheduleGrid } from '../../components/calendar/WeekScheduleGrid';
import { DayScheduleGrid } from '../../components/calendar/DayScheduleGrid';
import { MonthScheduleGrid } from '../../components/calendar/MonthScheduleGrid';
import { CreateReservationModal } from '../../components/calendar/CreateReservationModal';
import { useAuth } from '../../contexts/AuthContext';

export const Reservations: React.FC = () => {
  const { user } = useAuth();
  const { toast, confirm } = useUiFeedback();
  const [loading, setLoading] = useState(true);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selectedRes, setSelectedRes] = useState<Reservation | null>(null);
  const [proofModal, setProofModal] = useState<Reservation | null>(null);
  const [proofUploading, setProofUploading] = useState(false);
  const [housePhotoModal, setHousePhotoModal] = useState<string | null>(null);
  const proofFileInputRef = useRef<HTMLInputElement>(null);

  // Edit Location & House Photo Modal (Admin CS)
  const [editLocationModal, setEditLocationModal] = useState<Reservation | null>(null);
  const [editHousePhotoB64, setEditHousePhotoB64] = useState<string | null>(null);
  const [editLandmark, setEditLandmark] = useState<string>('');
  const [editLat, setEditLat] = useState<string>('');
  const [editLng, setEditLng] = useState<string>('');
  const [editRemovePhoto, setEditRemovePhoto] = useState(false);
  const [submittingLocation, setSubmittingLocation] = useState(false);
  const adminHouseFileInputRef = useRef<HTMLInputElement>(null);

  // Calendar View State
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [viewMode, setViewMode] = useState<CalendarViewMode>('table');
  const [filterState, setFilterState] = useState<CalendarFilterState>({
    searchQuery: '',
    category: 'all',
    staffId: 'all',
    status: 'all',
  });

  const [googleCalendarMockActive, setGoogleCalendarMockActive] = useState(true);
  const [editDate, setEditDate] = useState('');
  const [staffList, setStaffList] = useState<StaffOption[]>([]);
  const [assigningStaff, setAssigningStaff] = useState(false);

  // Create Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [quickSlotTarget, setQuickSlotTarget] = useState<QuickSlotTarget | null>(null);

  // Table pagination state
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalReservations, setTotalReservations] = useState(0);
  const PAGE_SIZE = 100;

  useEffect(() => {
    if (selectedRes?.booking_date) {
      const d = new Date(selectedRes.booking_date);
      const tzOffset = d.getTimezoneOffset() * 60000;
      const localIso = new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
      setEditDate(localIso);
    } else {
      setEditDate('');
    }
  }, [selectedRes]);

  useEffect(() => {
    async function loadStaff() {
      try {
        const res = await apiRequest('/api/admin/staff');
        if (res.success && Array.isArray(res.data)) {
          setStaffList(res.data);
        }
      } catch (_) {}
    }
    loadStaff();
  }, []);

  const loadReservations = async (targetPage = 1, append = false) => {
    try {
      setLoading(true);
      const res = await apiRequest(`/api/admin/reservations?page=${targetPage}&pageSize=${PAGE_SIZE}`);
      const data = Array.isArray(res) ? res : res?.data || [];
      setReservations((prev) => (append ? [...prev, ...data] : data));
      if (!Array.isArray(res)) {
        setTotalPages(res?.totalPages || 1);
        setTotalReservations(res?.total ?? data.length);
      } else {
        setTotalPages(1);
        setTotalReservations(data.length);
      }
      setPage(targetPage);
    } catch (err) {
      console.error('Failed to load reservations:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReservations(1);
  }, []);

  const loadMore = () => {
    if (page < totalPages) loadReservations(page + 1, true);
  };

  const formatBookingDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const dayMonth = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
    const time = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', ':');
    return `${dayMonth} ${time}`;
  };

  // Date Navigation Handlers
  const handlePrevDate = () => {
    const next = new Date(selectedDate);
    if (viewMode === 'day') {
      next.setDate(next.getDate() - 1);
    } else if (viewMode === 'week') {
      next.setDate(next.getDate() - 7);
    } else if (viewMode === 'month') {
      next.setMonth(next.getMonth() - 1);
    }
    setSelectedDate(next);
  };

  const handleNextDate = () => {
    const next = new Date(selectedDate);
    if (viewMode === 'day') {
      next.setDate(next.getDate() + 1);
    } else if (viewMode === 'week') {
      next.setDate(next.getDate() + 7);
    } else if (viewMode === 'month') {
      next.setMonth(next.getMonth() + 1);
    }
    setSelectedDate(next);
  };

  const handleToday = () => {
    setSelectedDate(new Date());
  };

  const handleQuickAdd = (target: QuickSlotTarget) => {
    setQuickSlotTarget(target);
    setShowCreateModal(true);
  };

  // Confirm Reservation
  const handleConfirm = async (id: string) => {
    try {
      setLoading(true);
      await apiRequest(`/api/admin/reservation/${id}/confirm`, {
        method: 'PATCH',
      });
      toast('Reservasi ditandai lunas & disinkronkan ke Google Calendar', 'success');
      setSelectedRes(null);
      loadReservations();
    } catch (err: any) {
      toast(`Error confirming reservation: ${err.message}`, 'error');
      setLoading(false);
    }
  };

  // Complete Reservation (Selesai Treatment)
  const handleComplete = async (id: string) => {
    const ok = await confirm({
      title: 'Tandai Selesai Treatment?',
      message: 'Apakah reservasi ini sudah selesai dilakukan penanganan/treatment oleh terapis?',
      confirmText: 'Ya, Selesai',
    });
    if (!ok) return;

    try {
      setLoading(true);
      await apiRequest(`/api/admin/reservation/${id}/complete`, {
        method: 'PATCH',
      });
      toast('Reservasi berhasil ditandai Selesai Treatment!', 'success');
      setSelectedRes(null);
      loadReservations();
    } catch (err: any) {
      toast(`Gagal menyelesaikan reservasi: ${err.message}`, 'error');
      setLoading(false);
    }
  };

  // Generic Status Change
  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      setLoading(true);
      await apiRequest(`/api/admin/reservation/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      });
      toast(`Status reservasi diubah menjadi ${newStatus}.`, 'success');
      setSelectedRes(null);
      loadReservations();
    } catch (err: any) {
      toast(`Gagal mengubah status: ${err.message}`, 'error');
      setLoading(false);
    }
  };

  // Update Reservation Date
  const handleSetDate = async (id: string) => {
    if (!editDate) return;
    try {
      setLoading(true);
      await apiRequest(`/api/admin/reservation/${id}/set-date`, {
        method: 'PATCH',
        body: JSON.stringify({ bookingDate: new Date(editDate).toISOString() }),
      });
      toast('Jadwal kunjungan berhasil diperbarui!', 'success');
      setSelectedRes(null);
      setEditDate('');
      loadReservations();
    } catch (err: any) {
      toast(`Error updating date: ${err.message}`, 'error');
      setLoading(false);
    }
  };

  // Delete Reservation
  const handleDelete = async (id: string) => {
    const isConfirmed = await confirm({
      title: 'Hapus Reservasi?',
      message: 'Apakah Anda yakin ingin membatalkan dan menghapus jadwal reservasi ini?',
      confirmText: 'Ya, Hapus',
      danger: true,
    });
    if (!isConfirmed) return;
    try {
      setLoading(true);
      await apiRequest(`/api/admin/reservation/${id}`, {
        method: 'DELETE',
      });
      toast('Reservasi berhasil dibatalkan.', 'success');
      setSelectedRes(null);
      loadReservations();
    } catch (err: any) {
      toast(`Error deleting: ${err.message}`, 'error');
      setLoading(false);
    }
  };

  // Assign Staff
  const handleAssignStaff = async (reservationId: string, staffId: string | null) => {
    setAssigningStaff(true);
    try {
      const res = await apiRequest(`/api/admin/reservation/${reservationId}/assign-staff`, {
        method: 'PATCH',
        body: JSON.stringify({ assigned_staff_id: staffId || null }),
      });

      if (res.success) {
        toast(staffId ? 'Staff berhasil ditugaskan ke reservasi.' : 'Penugasan staff telah dilepas.', 'success');
        setReservations((prev) =>
          prev.map((r) =>
            r.id === reservationId
              ? { ...r, assigned_staff_id: staffId, assigned_staff: res.data?.assigned_staff }
              : r
          )
        );
        if (selectedRes && selectedRes.id === reservationId) {
          setSelectedRes((prev) =>
            prev ? { ...prev, assigned_staff_id: staffId, assigned_staff: res.data?.assigned_staff } : null
          );
        }
      }
    } catch (err: any) {
      toast(`Gagal menugaskan staff: ${err.message || 'Terjadi kesalahan'}`, 'error');
    } finally {
      setAssigningStaff(false);
    }
  };

  // Baby info resolver
  const getBabyRows = (res: Reservation | null): Array<{ name: string; age: string; regAge?: string }> => {
    if (!res) return [];
    const children = res.customer?.children;
    if (children && children.length > 0) {
      return children.map((c) => ({
        name: c.name,
        age: c.current_age || c.raw_age_text || '',
        regAge: c.raw_age_text || undefined,
      }));
    }
    const bd = res.baby_details;
    if (bd && bd.length > 0) return bd.map((b) => ({ name: b.name, age: b.age }));
    return extractBabiesFromRawText(res.raw_text, res.treatment_detail).map((b) => ({ name: b.name, age: b.age }));
  };

  // Filtered reservations based on global sidebar & search filter
  const filteredReservations = useMemo(() => {
    return reservations.filter((res) => {
      // Status filter
      if (filterState.status !== 'all' && res.status !== filterState.status) {
        return false;
      }
      // Category filter
      if (filterState.category !== 'all' && res.treatment_category !== filterState.category) {
        return false;
      }
      // Staff filter
      if (filterState.staffId !== 'all' && res.assigned_staff_id !== filterState.staffId) {
        return false;
      }
      // Search query
      if (filterState.searchQuery.trim()) {
        const q = filterState.searchQuery.toLowerCase();
        const cPhone = (res.customer?.phone || '').toLowerCase();
        const cName = (res.customer?.name || '').toLowerCase();
        const detail = (res.treatment_detail || '').toLowerCase();
        if (!cPhone.includes(q) && !cName.includes(q) && !detail.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [reservations, filterState]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'confirmed':
        return <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-semibold">Confirmed</span>;
      case 'completed':
        return <span className="px-2.5 py-0.5 rounded-full bg-sky-100 border border-sky-200 text-sky-800 text-xs font-semibold">Completed</span>;
      case 'cancelled':
        return <span className="px-2.5 py-0.5 rounded-full bg-rose-100 border border-rose-200 text-rose-800 text-xs font-semibold">Cancelled</span>;
      default:
        return <span className="px-2.5 py-0.5 rounded-full bg-amber-100 border border-amber-200 text-amber-800 text-xs font-semibold">Pending</span>;
    }
  };

  const getPaymentMethodLabel = (m?: string | null) => {
    if (m === 'CASH') return 'Tunai';
    if (m === 'TRANSFER') return 'Transfer';
    if (m === 'QRIS') return 'QRIS';
    return '-';
  };

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
      reader.readAsDataURL(file);
    });

  // Upload bukti bayar dari modal Manage (dikompres server-side max 800px)
  const handleProofUpload = async (imageB64: string, mimeType: string, fileName: string) => {
    if (!selectedRes) return;
    setProofUploading(true);
    try {
      const res = await apiRequest(`/api/admin/reservation/${selectedRes.id}/proof`, {
        method: 'PUT',
        body: JSON.stringify({ imageB64, mimeType, fileName }),
      });
      if (res && res.success) {
        toast('Bukti bayar berhasil disimpan.', 'success');
        setSelectedRes((prev) => (prev ? { ...prev, proof_url: res.data?.proof_url ?? prev.proof_url } : prev));
        loadReservations();
      }
    } catch (err: any) {
      toast(`Gagal menyimpan bukti bayar: ${err.message}`, 'error');
    } finally {
      setProofUploading(false);
    }
  };

  const handleProofPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('Hanya file gambar yang didukung.', 'error');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast('Gambar maksimal 8 MB.', 'error');
      return;
    }
    void (async () => {
      try {
        const dataUrl = await fileToDataUrl(file);
        await handleProofUpload(dataUrl, file.type || 'image/jpeg', file.name);
      } catch (err: any) {
        toast(`Gagal membaca file: ${err.message}`, 'error');
      } finally {
        if (proofFileInputRef.current) proofFileInputRef.current.value = '';
      }
    })();
  };

  const handleProofRemove = async () => {
    if (!selectedRes || !selectedRes.proof_url) return;
    const ok = await confirm({
      title: 'Hapus Bukti Bayar',
      message: 'Hapus bukti bayar dari reservasi ini?',
      danger: true,
      confirmText: 'Ya, Hapus',
    });
    if (!ok) return;
    setProofUploading(true);
    try {
      const res = await apiRequest(`/api/admin/reservation/${selectedRes.id}/proof`, {
        method: 'PUT',
        body: JSON.stringify({ remove: true }),
      });
      if (res && res.success) {
        toast('Bukti bayar dihapus.', 'success');
        setSelectedRes((prev) => (prev ? { ...prev, proof_url: null } : prev));
        loadReservations();
      }
    } catch (err: any) {
      toast(`Gagal menghapus bukti bayar: ${err.message}`, 'error');
    } finally {
      setProofUploading(false);
    }
  };

  const handleOpenEditLocation = (res: Reservation) => {
    setEditLocationModal(res);
    const prefs = res.customer?.preferences as any;
    setEditHousePhotoB64(prefs?.house_photo_url || null);
    setEditLandmark(prefs?.landmark || '');
    setEditLat(res.customer?.lat != null ? String(res.customer.lat) : '');
    setEditLng(res.customer?.lng != null ? String(res.customer.lng) : '');
    setEditRemovePhoto(false);
  };

  const handlePickAdminHousePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 12 * 1024 * 1024) {
      toast('Ukuran file maksimal 12 MB', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setEditHousePhotoB64(reader.result as string);
      setEditRemovePhoto(false);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveEditLocation = async () => {
    if (!editLocationModal || !editLocationModal.customer_id) {
      toast('Data customer tidak ditemukan', 'error');
      return;
    }

    setSubmittingLocation(true);
    try {
      const parsedLat = editLat.trim() ? parseFloat(editLat) : null;
      const parsedLng = editLng.trim() ? parseFloat(editLng) : null;

      const res = await apiRequest(`/api/admin/customers/${editLocationModal.customer_id}/location`, {
        method: 'PUT',
        body: JSON.stringify({
          housePhotoB64: editHousePhotoB64 && editHousePhotoB64.startsWith('data:image/') ? editHousePhotoB64 : undefined,
          landmark: editLandmark,
          lat: parsedLat,
          lng: parsedLng,
          removePhoto: editRemovePhoto,
        }),
      });

      if (res && res.success && res.data) {
        toast('✅ Panduan lokasi & foto rumah berhasil disimpan!', 'success');
        const updatedCust = res.data;

        // Update selectedRes if active
        setSelectedRes((prev) => {
          if (!prev || prev.customer_id !== editLocationModal.customer_id) return prev;
          return {
            ...prev,
            customer: {
              ...(prev.customer as any),
              lat: updatedCust.lat,
              lng: updatedCust.lng,
              distance_km: updatedCust.distance_km,
              preferences: updatedCust.preferences,
            },
          };
        });

        // Update list
        setReservations((prev) =>
          prev.map((r) => {
            if (r.customer_id !== editLocationModal.customer_id) return r;
            return {
              ...r,
              customer: {
                ...(r.customer as any),
                lat: updatedCust.lat,
                lng: updatedCust.lng,
                distance_km: updatedCust.distance_km,
                preferences: updatedCust.preferences,
              },
            };
          })
        );

        setEditLocationModal(null);
      } else {
        toast(`Gagal: ${res?.error || 'Terjadi kesalahan saat menyimpan'}`, 'error');
      }
    } catch (err: any) {
      toast(`Gagal: ${err.message || 'Terjadi kesalahan jaringan'}`, 'error');
    } finally {
      setSubmittingLocation(false);
    }
  };

  // Header month/year display
  const headerDateTitle = selectedDate.toLocaleDateString('id-ID', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="space-y-5">
      {/* Top Header Bar */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 bg-white p-3.5 sm:p-4 rounded-2xl border border-[#e9edef] shadow-xs">
        {/* Title & Month Navigation */}
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-lg sm:text-xl font-black tracking-tight text-[#111b21] capitalize">
                {headerDateTitle}
              </h2>

              {/* Date Navigation group placed right next to Month text */}
              {viewMode !== 'table' && (
                <div className="flex items-center space-x-1 bg-[#f0f2f5] p-0.5 rounded-lg border border-[#e9edef]">
                  <button
                    onClick={handlePrevDate}
                    className="p-1 rounded-md bg-white hover:bg-gray-100 text-[#111b21] shadow-2xs transition-colors"
                    title="Sebelumnya"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    onClick={handleToday}
                    className="px-2 py-0.5 rounded-md bg-white hover:bg-gray-100 text-[11px] font-bold text-[#111b21] shadow-2xs transition-colors"
                  >
                    Hari Ini
                  </button>
                  <button
                    onClick={handleNextDate}
                    className="p-1 rounded-md bg-white hover:bg-gray-100 text-[#111b21] shadow-2xs transition-colors"
                    title="Berikutnya"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              )}
            </div>
            <p className="text-[11px] text-[#667781] mt-0.5">
              Jadwal Reservasi
            </p>
          </div>
        </div>

        {/* View mode switcher & Actions */}
        <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto justify-between lg:justify-end">
          {/* Mobile View Mode Dropdown */}
          <div className="block sm:hidden flex-1 min-w-[110px]">
            <select
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as CalendarViewMode)}
              className="w-full px-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs font-bold text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
            >
              <option value="table">List</option>
              <option value="day">Hari</option>
              <option value="week">Minggu</option>
              <option value="month">Bulan</option>
            </select>
          </div>

          {/* Desktop View Switcher Tabs */}
          <div className="hidden sm:flex space-x-1 p-1 bg-[#f0f2f5] rounded-xl shadow-inner text-xs">
            <button
              onClick={() => setViewMode('table')}
              className={`flex items-center space-x-1 py-1.5 px-3 rounded-lg font-bold transition-all ${
                viewMode === 'table'
                  ? 'bg-white text-[#111b21] shadow-xs'
                  : 'text-[#54656f] hover:text-[#111b21]'
              }`}
            >
              <ListFilter size={13} />
              <span>Tabel</span>
            </button>
            <button
              onClick={() => setViewMode('day')}
              className={`flex items-center space-x-1 py-1.5 px-3 rounded-lg font-bold transition-all ${
                viewMode === 'day'
                  ? 'bg-white text-[#111b21] shadow-xs'
                  : 'text-[#54656f] hover:text-[#111b21]'
              }`}
            >
              <LayoutGrid size={13} />
              <span>Hari</span>
            </button>
            <button
              onClick={() => setViewMode('week')}
              className={`hidden sm:flex items-center space-x-1 py-1.5 px-3 rounded-lg font-bold transition-all ${
                viewMode === 'week'
                  ? 'bg-white text-[#111b21] shadow-xs'
                  : 'text-[#54656f] hover:text-[#111b21]'
              }`}
            >
              <Columns size={13} />
              <span>Minggu</span>
            </button>
            <button
              onClick={() => setViewMode('month')}
              className={`hidden md:flex items-center space-x-1 py-1.5 px-3 rounded-lg font-bold transition-all ${
                viewMode === 'month'
                  ? 'bg-white text-[#111b21] shadow-xs'
                  : 'text-[#54656f] hover:text-[#111b21]'
              }`}
            >
              <CalendarDays size={13} />
              <span>Bulan</span>
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                setQuickSlotTarget(null);
                setShowCreateModal(true);
              }}
              className="flex items-center space-x-1.5 px-3.5 py-2 bg-[#008069] hover:bg-[#00a884] rounded-xl text-xs font-semibold text-white transition-colors shadow-xs"
            >
              <CalendarIcon size={14} />
              <span>+ Buat Jadwal</span>
            </button>
            <button
              onClick={() => {
                setLoading(true);
                loadReservations();
              }}
              className="p-2 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] rounded-xl text-[#111b21] transition-colors shadow-xs"
              title="Reload Data"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin text-[#008069]' : 'text-[#667781]'} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Calendar Pane (pure calendar) */}
      <div className="space-y-4">
        {/* Status Filter Tabs & Search bar */}
        <div className="space-y-2.5">
          {/* Mobile Status Dropdown */}
          <div className="block sm:hidden w-full">
            <select
              value={filterState.status}
              onChange={(e) =>
                setFilterState((prev) => ({ ...prev, status: e.target.value as any }))
              }
              className="w-full px-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs font-bold text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
            >
              <option value="all">Semua Status ({reservations.length})</option>
              <option value="pending">Pending ({reservations.filter((r) => r.status === 'pending').length})</option>
              <option value="confirmed">Confirmed / Lunas ({reservations.filter((r) => r.status === 'confirmed').length})</option>
              <option value="completed">Completed / Selesai ({reservations.filter((r) => r.status === 'completed').length})</option>
              <option value="cancelled">Cancelled / Batal ({reservations.filter((r) => r.status === 'cancelled').length})</option>
            </select>
          </div>

          {/* Desktop Status Tabs */}
          <div className="hidden sm:flex flex-wrap items-center gap-1.5 p-1 bg-[#f0f2f5] rounded-2xl w-fit">
            {[
              { key: 'all', label: 'Semua Status', count: reservations.length },
              { key: 'pending', label: 'Pending', count: reservations.filter((r) => r.status === 'pending').length },
              { key: 'confirmed', label: 'Confirmed (Lunas)', count: reservations.filter((r) => r.status === 'confirmed').length },
              { key: 'completed', label: 'Completed (Selesai)', count: reservations.filter((r) => r.status === 'completed').length },
              { key: 'cancelled', label: 'Cancelled (Batal)', count: reservations.filter((r) => r.status === 'cancelled').length },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setFilterState((prev) => ({ ...prev, status: tab.key as any }))}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 ${
                  filterState.status === tab.key
                    ? 'bg-white text-[#111b21] shadow-xs'
                    : 'text-[#54656f] hover:text-[#111b21]'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                    filterState.status === tab.key
                      ? 'bg-[#e8f5f2] text-[#008069]'
                      : 'bg-[#e9edef] text-[#667781]'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* Search bar */}
          <div className="relative">
            <input
              type="text"
              value={filterState.searchQuery}
              onChange={(e) =>
                setFilterState((prev) => ({ ...prev, searchQuery: e.target.value }))
              }
              placeholder="Cari pasien, nomor telepon, atau jenis treatment..."
              className="w-full pl-9 pr-4 py-2.5 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
            />
            <Search size={14} className="absolute left-3 top-3 text-[#8696a0]" />
            {filterState.searchQuery && (
              <button
                onClick={() => setFilterState((prev) => ({ ...prev, searchQuery: '' }))}
                className="absolute right-3 top-3 text-[#8696a0] hover:text-[#111b21]"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

          {/* View rendering */}
          {viewMode === 'week' && (
            <WeekScheduleGrid
              selectedDate={selectedDate}
              onSelectDate={(d) => setSelectedDate(d)}
              reservations={filteredReservations}
              onSelectReservation={(r) => setSelectedRes(r)}
              onQuickAdd={handleQuickAdd}
            />
          )}

          {viewMode === 'day' && (
            <DayScheduleGrid
              selectedDate={selectedDate}
              reservations={filteredReservations}
              onSelectReservation={(r) => setSelectedRes(r)}
              onQuickAdd={handleQuickAdd}
            />
          )}

          {viewMode === 'month' && (
            <MonthScheduleGrid
              selectedDate={selectedDate}
              onSelectDate={(d) => {
                setSelectedDate(d);
                setViewMode('day');
              }}
              reservations={filteredReservations}
              onSelectReservation={(r) => setSelectedRes(r)}
              onQuickAdd={handleQuickAdd}
            />
          )}

          {viewMode === 'table' && (
            <div className="space-y-4">
              {/* Mobile Card List */}
              <div className="block md:hidden space-y-3">
                {filteredReservations.length === 0 ? (
                  <div className="bg-white border border-[#e9edef] rounded-2xl p-8 text-center text-[#667781] text-xs shadow-xs">
                    Tidak ada data reservasi yang sesuai.
                  </div>
                ) : (
                  filteredReservations.map((res) => (
                    <div key={res.id} className="bg-white rounded-2xl p-4 border border-[#e9edef] shadow-xs space-y-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-bold text-[#111b21] text-sm">{res.customer?.name || 'Bunda'}</h4>
                          <p className="text-xs text-[#667781] font-mono mt-0.5">{res.customer?.phone}</p>
                        </div>
                        <div>{getStatusBadge(res.status)}</div>
                      </div>

                      <div className="flex items-center justify-between text-xs pt-1 border-t border-[#e9edef]">
                        <span className="px-2 py-0.5 rounded bg-[#f0f2f5] text-[#54656f] font-semibold text-[10px]">
                          {res.treatment_category}
                        </span>
                        <span className="font-bold text-[#008069] bg-[#e8f5f2] px-2 py-0.5 rounded border border-[#c2e7e0] text-xs">
                          {res.booking_date ? formatBookingDate(res.booking_date) : 'Belum ada jadwal'}
                        </span>
                      </div>

                      {res.treatment_detail && (
                        <p className="text-xs text-[#54656f] bg-[#f8fafc] p-2.5 rounded-xl border border-[#e9edef] line-clamp-2">
                          {res.treatment_detail}
                        </p>
                      )}

                      {res.assigned_staff && (
                        <div className="text-xs text-[#008069] font-semibold flex items-center space-x-1">
                          <span>Terapis: {res.assigned_staff.name}</span>
                        </div>
                      )}

                      <div className="pt-2 flex justify-end space-x-2">
                        {res.status === 'completed' && res.proof_url && (
                          <button
                            onClick={() => setProofModal(res)}
                            className="p-2 bg-[#e8f5f2] hover:bg-[#c2e7e0] text-[#008069] border border-[#c2e7e0] rounded-xl transition-all flex items-center justify-center"
                            title={`Lihat Bukti Bayar (${getPaymentMethodLabel(res.payment_method)})`}
                          >
                            <Eye size={15} />
                          </button>
                        )}
                        <button
                          onClick={() => setSelectedRes(res)}
                          className="px-3 py-1.5 bg-[#f0f2f5] hover:bg-[#008069] text-[#111b21] hover:text-white border border-[#d1d7db] rounded-xl transition-all font-semibold text-xs"
                        >
                          Manage
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Desktop Table View */}
              <div className="hidden md:block bg-white border border-[#e9edef] rounded-2xl overflow-hidden shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#e9edef] bg-[#f8fafc] text-[#667781] text-xs uppercase tracking-wider font-bold">
                        <th className="py-3.5 px-5">Customer</th>
                        <th className="py-3.5 px-5">Kategori</th>
                        <th className="py-3.5 px-5">Detail Layanan</th>
                        <th className="py-3.5 px-5">Jadwal Kunjungan</th>
                        <th className="py-3.5 px-5">Terapis</th>
                        <th className="py-3.5 px-5">Status</th>
                        <th className="py-3.5 px-5">Bukti Bayar</th>
                        <th className="py-3.5 px-5">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e9edef] text-xs text-[#111b21]">
                      {filteredReservations.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-[#667781] text-xs">
                            Tidak ada data reservasi yang sesuai.
                          </td>
                        </tr>
                      ) : (
                        filteredReservations.map((res) => (
                          <tr key={res.id} className="hover:bg-[#f8fafc] transition-all">
                            <td className="py-3.5 px-5 font-medium">
                              <p className="font-bold text-[#111b21]">{res.customer?.name || 'Bunda'}</p>
                              <p className="text-xs text-[#667781] font-mono">{res.customer?.phone}</p>
                            </td>
                            <td className="py-3.5 px-5">
                              <span className="px-2 py-0.5 rounded bg-[#f0f2f5] text-[11px] text-[#54656f] font-semibold">
                                {res.treatment_category}
                              </span>
                            </td>
                            <td className="py-3.5 px-5 max-w-xs truncate text-[#54656f]" title={res.treatment_detail}>
                              {res.treatment_detail}
                            </td>
                            <td className="py-3.5 px-5 font-semibold text-[#008069] whitespace-nowrap">
                              {res.booking_date ? (
                                formatBookingDate(res.booking_date)
                              ) : (
                                <button
                                  onClick={() => setSelectedRes(res)}
                                  className="px-2 py-1 rounded-lg bg-[#e8f5f2] border border-[#c2e7e0] text-[#008069] hover:bg-[#c2e7e0] text-xs font-semibold transition-all"
                                >
                                  + Atur Jadwal
                                </button>
                              )}
                            </td>
                            <td className="py-3.5 px-5">
                              {res.assigned_staff ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-[#e8f5f2] text-[#008069] border border-[#c2e7e0]">
                                  {res.assigned_staff.name}
                                </span>
                              ) : (
                                <span className="text-xs text-[#8696a0] italic">Belum ditugaskan</span>
                              )}
                            </td>
                            <td className="py-3.5 px-5">{getStatusBadge(res.status)}</td>
                            <td className="py-3.5 px-5 whitespace-nowrap">
                              {res.status === 'completed' && res.proof_url ? (
                                <button
                                  onClick={() => setProofModal(res)}
                                  className="p-2 bg-[#e8f5f2] hover:bg-[#c2e7e0] text-[#008069] border border-[#c2e7e0] rounded-xl transition-all flex items-center justify-center"
                                  title={`Lihat Bukti Bayar — ${getPaymentMethodLabel(res.payment_method)}`}
                                >
                                  <Eye size={15} />
                                </button>
                              ) : res.payment_method ? (
                                <span className="px-2 py-0.5 rounded bg-[#f0f2f5] text-[11px] text-[#54656f] font-semibold">
                                  {getPaymentMethodLabel(res.payment_method)}
                                </span>
                              ) : (
                                <span className="text-[#8696a0] text-xs">-</span>
                              )}
                            </td>
                            <td className="py-3.5 px-5">
                              <button
                                onClick={() => setSelectedRes(res)}
                                className="px-3 py-1.5 bg-white hover:bg-[#008069] text-[#111b21] hover:text-white border border-[#d1d7db] rounded-xl text-xs transition-all font-semibold shadow-xs"
                              >
                                Manage
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Pagination Footer */}
              {totalPages > 1 && (
                <div className="p-4 border-t border-[#e9edef] flex items-center justify-between text-xs text-[#667781] bg-white rounded-xl shadow-xs">
                  <span>
                    Menampilkan {reservations.length} dari total <span className="text-[#111b21] font-bold">{totalReservations}</span> reservasi
                  </span>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => {
                        setReservations([]);
                        loadReservations(1);
                      }}
                      disabled={page === 1 || loading}
                      className="px-3 py-1.5 rounded-xl bg-white border border-[#d1d7db] text-[#111b21] hover:bg-[#f0f2f5] disabled:opacity-40 transition font-semibold"
                    >
                      Awal
                    </button>
                    <button
                      onClick={loadMore}
                      disabled={page >= totalPages || loading}
                      className="px-3 py-1.5 rounded-xl bg-white border border-[#d1d7db] text-[#111b21] hover:bg-[#f0f2f5] disabled:opacity-40 transition font-semibold"
                    >
                      {loading ? 'Memuat...' : `Muat Halaman ${page + 1} / ${totalPages}`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

      {/* Reservation Details & Management Modal */}
      {selectedRes && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4"
          onClick={() => setSelectedRes(null)}
        >
          <div
            className="w-full max-w-2xl bg-white border border-[#e9edef] rounded-2xl p-4 sm:p-6 space-y-4 sm:space-y-5 shadow-xl relative max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setSelectedRes(null)}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5]"
            >
              <X size={18} />
            </button>

            {/* Modal Header */}
            <div>
              <h3 className="text-base sm:text-lg font-bold text-[#111b21] flex items-center space-x-2 pr-6">
                <Info size={18} className="text-[#008069] flex-shrink-0" />
                <span>Detail Reservasi</span>
              </h3>
              <p className="text-xs text-[#667781] mt-0.5">
                Kelola penugasan terapis, tanggal jadwal, dan status pembayaran
              </p>
            </div>

            {/* Info contents split layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5 text-xs">
              <div className="space-y-3">
                <div className="p-3.5 rounded-xl bg-[#f8fafc] border border-[#e9edef] space-y-2">
                  <span className="text-[11px] text-[#667781] font-bold block uppercase">Data Pasien</span>
                  <div className="flex items-center space-x-2 text-[#111b21]">
                    <User size={15} className="text-[#8696a0] flex-shrink-0" />
                    <span className="font-semibold break-all">
                      {selectedRes.customer?.name || 'Bunda'} ({selectedRes.customer?.phone})
                    </span>
                  </div>
                  {selectedRes.customer?.kelurahan && (
                    <div className="flex items-center space-x-2 text-[#54656f] text-[11px]">
                      <MapPin size={13} className="text-[#8696a0] flex-shrink-0" />
                      <span className="break-words">
                        {selectedRes.customer?.kelurahan}, {selectedRes.customer?.kecamatan}, {selectedRes.customer?.kota}
                      </span>
                    </div>
                  )}

                  {/* Baby / Anak info */}
                  {getBabyRows(selectedRes).length > 0 && (
                    <div className="mt-2 pt-2 border-t border-[#e9edef] space-y-1.5">
                      <span className="text-[11px] text-[#008069] font-bold uppercase tracking-wider block">
                        Bayi / Anak ({getBabyRows(selectedRes).length})
                      </span>
                      {getBabyRows(selectedRes).map((baby, i) => (
                        <div key={i} className="flex items-center space-x-2 text-[#111b21]">
                          <Baby size={14} className="text-[#008069] flex-shrink-0" />
                          <span className="break-words">
                            <span className="font-semibold">{baby.name || '-'}</span>
                            <span className="text-[#54656f] text-xs"> · {baby.age || '?'}</span>
                            {baby.regAge && baby.regAge !== baby.age && (
                              <span className="text-[#8696a0] text-[11px] ml-1">
                                (saat booking: {baby.regAge})
                              </span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-3.5 rounded-xl bg-[#f8fafc] border border-[#e9edef] space-y-2.5">
                  <span className="text-[11px] text-[#667781] font-bold block uppercase">Lokasi & Pengiriman</span>
                  <div className="flex justify-between text-xs">
                    <span className="text-[#667781]">Jarak dari Cabang</span>
                    <span className="text-[#111b21] font-bold">
                      {selectedRes.customer?.distance_km?.toFixed(2) || '0.0'} km
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-[#667781]">Ongkir</span>
                    <span className="text-[#111b21] font-bold">
                      {selectedRes.customer?.ongkir ? `Rp ${selectedRes.customer.ongkir.toLocaleString()}` : 'Gratis / Belum dihitung'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-[#008069]">
                    <span>Status Jarak</span>
                    <span className="font-bold">Haversine 1.6x Terkalibrasi</span>
                  </div>

                  {/* Foto Depan Rumah & Landmark Patokan */}
                  {(() => {
                    const prefs = selectedRes.customer?.preferences as any;
                    const housePhoto = prefs?.house_photo_url;
                    const landmark = prefs?.landmark;
                    const lat = selectedRes.customer?.lat;
                    const lng = selectedRes.customer?.lng;
                    const mapsUrl = lat && lng ? `https://maps.google.com/?q=${lat},${lng}` : null;

                    if (!housePhoto && !landmark && !mapsUrl) {
                      return (
                        <div className="mt-2 pt-2 border-t border-[#e9edef]">
                          <button
                            type="button"
                            onClick={() => handleOpenEditLocation(selectedRes)}
                            className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-white hover:bg-[#e8f5f2] text-[#008069] text-xs font-semibold border border-dashed border-[#00a884]/40 transition shadow-xs"
                          >
                            <Camera size={13} />
                            <span>+ Tambah Foto Rumah & Patokan</span>
                          </button>
                        </div>
                      );
                    }

                    return (
                      <div className="mt-2 pt-2 border-t border-[#e9edef] space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-[#008069] font-bold uppercase tracking-wider block">
                            Panduan Lokasi & Foto Rumah
                          </span>
                          <div className="flex items-center space-x-2">
                            {mapsUrl && (
                              <a
                                href={mapsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] text-[#008069] hover:underline font-semibold flex items-center gap-1"
                              >
                                <Navigation size={11} />
                                <span>Maps</span>
                              </a>
                            )}
                            <button
                              type="button"
                              onClick={() => handleOpenEditLocation(selectedRes)}
                              className="text-[11px] text-[#008069] hover:underline font-semibold flex items-center gap-1"
                              title="Edit foto rumah / patokan / titik koordinat"
                            >
                              <PenLine size={11} />
                              <span>Edit</span>
                            </button>
                          </div>
                        </div>

                        {housePhoto && (
                          <div className="flex items-center gap-2.5 p-2 rounded-xl bg-white border border-[#e9edef]">
                            <div
                              onClick={() => setHousePhotoModal(housePhoto)}
                              className="h-14 w-14 rounded-xl bg-[#f0f2f5] overflow-hidden flex-shrink-0 relative group cursor-pointer border border-[#e9edef]"
                              title="Klik untuk memperbesar foto rumah"
                            >
                              <img
                                src={housePhoto}
                                alt="Foto Depan Rumah"
                                className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                              />
                              <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                                <Maximize2 size={14} />
                              </div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="text-[10px] font-bold text-[#008069] uppercase tracking-wider block">
                                🏠 Foto Tampak Depan Rumah
                              </span>
                              {landmark ? (
                                <p className="text-xs text-[#111b21] font-semibold mt-0.5 leading-snug">
                                  Patokan: {landmark}
                                </p>
                              ) : (
                                <p className="text-[11px] text-[#667781]">Foto panduan tersimpan</p>
                              )}
                              {prefs?.location_updated_by_staff_name && (
                                <p className="text-[10px] text-[#8696a0] mt-0.5">
                                  Diperbarui oleh: {prefs.location_updated_by_staff_name}
                                </p>
                              )}
                            </div>
                          </div>
                        )}

                        {!housePhoto && landmark && (
                          <div className="p-2 rounded-xl bg-white border border-[#e9edef] text-xs">
                            <span className="text-[10px] font-bold text-[#008069] uppercase tracking-wider block">
                              📍 Patokan Rumah
                            </span>
                            <p className="text-xs text-[#111b21] font-semibold mt-0.5">{landmark}</p>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Bukti Bayar (upload + lihat) */}
                <div className="p-3.5 rounded-xl bg-[#f8fafc] border border-[#e9edef] space-y-2">
                  <span className="text-[11px] text-[#667781] font-bold block uppercase">Bukti Bayar</span>
                  {selectedRes.proof_url ? (
                    <div className="flex items-center space-x-2.5">
                      <img
                        src={selectedRes.proof_url}
                        alt="Bukti bayar"
                        className="h-14 w-14 object-cover rounded-lg border border-[#e9edef] shadow-xs bg-white"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-[#54656f] truncate">
                          Metode: <span className="font-bold text-[#111b21]">{getPaymentMethodLabel(selectedRes.payment_method)}</span>
                        </p>
                        <p className="text-[10px] text-[#8696a0]">Bukti tersimpan (versi ringan)</p>
                      </div>
                      <button
                        onClick={() => setProofModal(selectedRes)}
                        className="p-2 rounded-lg bg-[#e8f5f2] hover:bg-[#c2e7e0] text-[#008069] border border-[#c2e7e0] transition flex items-center justify-center"
                        title="Lihat Detail Bukti Bayar"
                      >
                        <Eye size={15} />
                      </button>
                      <button
                        onClick={handleProofRemove}
                        disabled={proofUploading}
                        className="p-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 transition flex items-center justify-center disabled:opacity-50"
                        title="Hapus Bukti Bayar"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => proofFileInputRef.current?.click()}
                      disabled={proofUploading}
                      className="w-full py-3 rounded-xl border-2 border-dashed border-[#d1d7db] hover:border-[#008069] hover:bg-[#e8f5f2]/20 text-xs text-[#54656f] hover:text-[#008069] font-semibold transition flex items-center justify-center space-x-2 disabled:opacity-50"
                    >
                      {proofUploading ? (
                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#008069] border-t-transparent"></div>
                      ) : (
                        <Upload size={14} />
                      )}
                      <span>{proofUploading ? 'Menyimpan...' : 'Unggah Bukti Bayar (maks 8 MB)'}</span>
                    </button>
                  )}
                  <input
                    ref={proofFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleProofPick}
                  />
                </div>
              </div>

              {/* Edit Schedule section */}
              <div className="space-y-3">
                <div className="p-3.5 rounded-xl bg-[#f8fafc] border border-[#e9edef] space-y-2.5">
                  <span className="text-[11px] text-[#667781] font-bold block uppercase">Atur Jadwal Kunjungan</span>
                  <input
                    type="datetime-local"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full p-2 bg-white border border-[#d1d7db] rounded-lg text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                  />
                  <button
                    onClick={() => handleSetDate(selectedRes.id)}
                    className="w-full py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-lg text-xs font-semibold transition shadow-xs"
                  >
                    Simpan Jadwal Kunjungan
                  </button>
                </div>

                {/* Staff Assignment */}
                <div className="p-3.5 rounded-xl bg-[#f8fafc] border border-[#e9edef] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[#667781] font-bold block uppercase">Penugasan Staff / Terapis</span>
                    {user?.id && selectedRes.assigned_staff_id !== user.id && (
                      <button
                        type="button"
                        onClick={() => handleAssignStaff(selectedRes.id, user.id)}
                        disabled={assigningStaff}
                        className="text-[10px] text-[#008069] font-bold hover:underline flex items-center gap-1 cursor-pointer bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200"
                      >
                        <span>⚡ Tugaskan ke Saya</span>
                      </button>
                    )}
                  </div>
                  <select
                    value={selectedRes.assigned_staff_id || ''}
                    onChange={(e) => handleAssignStaff(selectedRes.id, e.target.value || null)}
                    disabled={assigningStaff}
                    className="w-full p-2 bg-white border border-[#d1d7db] rounded-lg text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                  >
                    <option value="">-- Belum Ditugaskan --</option>
                    {staffList
                      .filter((s) => s.active !== false || s.id === selectedRes.assigned_staff_id)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} {s.active === false ? '(Nonaktif)' : ''}
                        </option>
                      ))}
                  </select>
                  {selectedRes.assigned_staff && (
                    <p className="text-xs text-[#008069] font-bold">
                      Ditugaskan ke: {selectedRes.assigned_staff.name}
                    </p>
                  )}
                </div>

                {/* Google Calendar sync notifier */}
                {googleCalendarMockActive && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 flex items-start space-x-2.5 text-xs">
                    <AlertTriangle className="flex-shrink-0 mt-0.5 text-amber-600" size={15} />
                    <div>
                      <p className="font-bold">Google Calendar: Mode Mock Aktif</p>
                      <p className="mt-0.5 text-[10px] text-amber-700">
                        Sinkronisasi berjalan dalam simulasi lokal.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Raw Text Log */}
            <div className="space-y-1.5">
              <span className="text-[11px] text-[#667781] font-bold block uppercase flex items-center space-x-1">
                <FileText size={12} />
                <span>Format Teks Chat Asli / Detail</span>
              </span>
              <pre className="p-3 bg-[#f8fafc] border border-[#e9edef] rounded-xl text-[11px] text-[#54656f] font-mono overflow-auto max-h-28 whitespace-pre-wrap break-all">
                {selectedRes.raw_text}
              </pre>
            </div>

            {/* Actions button footer */}
            <div className="pt-3.5 border-t border-[#e9edef] flex flex-col-reverse sm:flex-row gap-2 sm:gap-0 justify-between items-center">
              <button
                onClick={() => handleDelete(selectedRes.id)}
                className="w-full sm:w-auto justify-center px-4 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 transition text-xs font-semibold flex items-center space-x-1.5"
              >
                <X size={14} />
                <span>Batalkan Reservasi</span>
              </button>

              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
                {selectedRes.status === 'pending' && (() => {
                  const purchaseSentAt = selectedRes.purchase_event_sent_at ? new Date(selectedRes.purchase_event_sent_at) : null;
                  const purchaseWindowOpen = purchaseSentAt && Date.now() - purchaseSentAt.getTime() < 7 * 24 * 60 * 60 * 1000;
                  return (
                    <button
                      onClick={() => handleConfirm(selectedRes.id)}
                      disabled={!!purchaseWindowOpen}
                      title={
                        purchaseWindowOpen
                          ? `Purchase event sudah terkirim ${purchaseSentAt.toLocaleString('id-ID')}. Nonaktif 7 hari untuk mencegah double-count.`
                          : undefined
                      }
                      className={`w-full sm:w-auto justify-center px-5 py-2 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition ${
                        purchaseWindowOpen
                          ? 'bg-[#e9edef] text-[#8696a0] cursor-not-allowed'
                          : 'bg-[#008069] text-white hover:bg-[#00a884] shadow-xs'
                      }`}
                    >
                      <Check size={14} />
                      <span>{purchaseWindowOpen ? 'Purchase Sudah Dikirim' : 'Tandai Lunas'}</span>
                    </button>
                  );
                })()}

                {selectedRes.status === 'confirmed' && (
                  <button
                    onClick={() => handleComplete(selectedRes.id)}
                    className="w-full sm:w-auto justify-center px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold flex items-center space-x-1.5 transition shadow-xs"
                  >
                    <CheckCircle size={14} />
                    <span>Tandai Selesai Treatment</span>
                  </button>
                )}

                {selectedRes.status === 'completed' && (
                  <div className="flex items-center space-x-2">
                    <span className="px-3 py-1.5 rounded-xl bg-sky-100 border border-sky-200 text-sky-800 text-xs font-bold flex items-center space-x-1">
                      <CheckCheck size={14} className="text-sky-600" />
                      <span>Treatment Telah Selesai</span>
                    </span>
                    <button
                      onClick={() => handleStatusChange(selectedRes.id, 'confirmed')}
                      className="px-2.5 py-1.5 rounded-xl bg-white border border-[#d1d7db] text-[#54656f] hover:text-[#111b21] text-xs font-semibold transition"
                      title="Kembalikan ke status Terkonfirmasi / Lunas"
                    >
                      Ubah Status
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Payment Proof Viewer Modal */}
      {proofModal && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-xs z-[60] flex items-center justify-center p-3 sm:p-4"
          onClick={() => setProofModal(null)}
        >
          <div
            className="w-full max-w-md bg-white border border-[#e9edef] rounded-2xl p-4 sm:p-5 space-y-4 shadow-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#111b21] flex items-center space-x-2">
                <Receipt size={16} className="text-[#008069] flex-shrink-0" />
                <span>Bukti Pembayaran</span>
              </h3>
              <button
                onClick={() => setProofModal(null)}
                className="p-1.5 rounded-lg text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5]"
              >
                <X size={18} />
              </button>
            </div>

            <div className="text-xs space-y-1.5 bg-[#f8fafc] border border-[#e9edef] rounded-xl p-3.5">
              <div className="flex justify-between">
                <span className="text-[#667781]">Pasien</span>
                <span className="font-bold text-[#111b21]">
                  {proofModal.customer?.name || 'Bunda'} ({proofModal.customer?.phone})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#667781]">Metode</span>
                <span className="font-bold text-[#111b21]">{getPaymentMethodLabel(proofModal.payment_method)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#667781]">Nilai</span>
                <span className="font-bold text-[#111b21]">
                  {proofModal.purchase_value ? `Rp ${proofModal.purchase_value.toLocaleString('id-ID')}` : '-'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[#667781]">Status</span>
                {getStatusBadge(proofModal.status)}
              </div>
            </div>

            <img
              src={proofModal.proof_url!}
              alt="Bukti pembayaran"
              className="w-full rounded-xl border border-[#e9edef] bg-[#f8fafc]"
            />

            <div className="flex justify-center">
              <a
                href={proofModal.proof_url!}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white text-xs font-semibold transition shadow-xs"
              >
                Buka Gambar Penuh
              </a>
            </div>
          </div>
        </div>
      )}

      {/* House Front Photo Lightbox Modal */}
      {housePhotoModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-fadeIn"
          onClick={() => setHousePhotoModal(null)}
        >
          <div
            className="bg-white rounded-3xl p-5 max-w-lg w-full space-y-4 shadow-2xl border border-[#e9edef] relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#e9edef] pb-3">
              <div className="flex items-center space-x-2 text-[#008069]">
                <Camera size={18} />
                <h3 className="font-bold text-sm text-[#111b21]">Foto Tampak Depan Rumah Pasien</h3>
              </div>
              <button
                onClick={() => setHousePhotoModal(null)}
                className="p-1 rounded-full text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5] transition"
              >
                <X size={18} />
              </button>
            </div>

            <img
              src={housePhotoModal}
              alt="Foto depan rumah pasien"
              className="w-full max-h-[70vh] object-contain rounded-2xl border border-[#e9edef] bg-[#f8fafc]"
            />

            <div className="flex justify-center">
              <a
                href={housePhotoModal}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white text-xs font-semibold transition shadow-xs"
              >
                Buka Gambar Asli HD
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Admin Edit Panduan Lokasi & Foto Rumah Modal */}
      {editLocationModal && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-xs animate-fadeIn"
          onClick={() => setEditLocationModal(null)}
        >
          <div
            className="bg-white rounded-3xl p-5 sm:p-6 max-w-md w-full space-y-4 shadow-2xl border border-[#e9edef] relative max-h-[92vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between border-b border-[#e9edef] pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="h-10 w-10 rounded-2xl bg-[#e8f5f2] text-[#008069] flex items-center justify-center border border-[#c2e7e0] shadow-xs">
                  <MapPin size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-base text-[#111b21]">Edit Panduan Lokasi & Foto Rumah</h3>
                  <p className="text-xs text-[#667781] truncate max-w-[220px]">
                    {editLocationModal.customer?.name || 'Bunda'} ({editLocationModal.customer?.phone})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setEditLocationModal(null)}
                className="p-1.5 rounded-full text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5] transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Info Alamat Pasien */}
            <div className="p-3 rounded-xl bg-[#f8fafc] border border-[#e9edef] text-xs text-[#54656f] space-y-1">
              <span className="text-[10px] font-bold text-[#667781] uppercase tracking-wider block">
                Alamat Pasien:
              </span>
              <p className="text-xs text-[#111b21] font-medium leading-snug">
                {editLocationModal.customer?.kelurahan
                  ? `${editLocationModal.customer.kelurahan}, ${editLocationModal.customer.kecamatan}, ${editLocationModal.customer.kota}`
                  : 'Alamat belum tercatat lengkap'}
              </p>
            </div>

            {/* Bagian 1: Foto Depan Rumah */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-[#111b21]">
                1. Foto Tampak Depan Rumah:
              </label>

              <input
                type="file"
                ref={adminHouseFileInputRef}
                accept="image/*"
                onChange={handlePickAdminHousePhoto}
                className="hidden"
              />

              {editHousePhotoB64 && !editRemovePhoto ? (
                <div className="relative rounded-2xl overflow-hidden border border-[#e9edef] bg-black/5 flex items-center justify-center max-h-48">
                  <img
                    src={editHousePhotoB64}
                    alt="Tampak Depan Rumah"
                    className="object-contain max-h-48 w-auto rounded-xl"
                  />
                  <div className="absolute top-2 right-2 flex gap-1">
                    <button
                      type="button"
                      onClick={() => adminHouseFileInputRef.current?.click()}
                      className="p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition shadow-xs"
                      title="Ganti foto"
                    >
                      <Camera size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditRemovePhoto(true);
                        setEditHousePhotoB64(null);
                      }}
                      className="p-1.5 rounded-full bg-rose-600 text-white hover:bg-rose-700 transition shadow-xs"
                      title="Hapus foto"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => adminHouseFileInputRef.current?.click()}
                  className="w-full py-4 border-2 border-dashed border-[#d1d7db] hover:border-[#008069] rounded-2xl flex flex-col items-center justify-center text-xs text-[#667781] hover:text-[#008069] transition bg-[#f8fafc]"
                >
                  <Upload size={20} className="mb-1 text-[#008069]" />
                  <span className="font-semibold text-[#111b21]">Unggah Foto Depan Rumah</span>
                  <span className="text-[10px] text-[#8696a0]">Pilih gambar dari komputer / galeri (maks 12 MB)</span>
                </button>
              )}
            </div>

            {/* Bagian 2: Catatan Patokan */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-[#111b21]">
                2. Catatan Patokan / Ancer-ancer Rumah:
              </label>
              <textarea
                rows={2}
                value={editLandmark}
                onChange={(e) => setEditLandmark(e.target.value)}
                placeholder="Contoh: Pagar hitam gerbang kayu, seberang masjid, samping toko berkah"
                className="w-full px-3.5 py-2.5 bg-white border border-[#e9edef] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] transition shadow-xs resize-none"
              />
            </div>

            {/* Bagian 3: Koordinat GPS (Opsional) */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-[#111b21]">
                3. Koordinat GPS (Latitude, Longitude - Opsional):
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={editLat}
                  onChange={(e) => setEditLat(e.target.value)}
                  placeholder="Latitude (misal: -7.3488)"
                  className="w-full px-3 py-2 bg-white border border-[#e9edef] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] transition"
                />
                <input
                  type="text"
                  value={editLng}
                  onChange={(e) => setEditLng(e.target.value)}
                  placeholder="Longitude (misal: 112.7516)"
                  className="w-full px-3 py-2 bg-white border border-[#e9edef] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] transition"
                />
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end space-x-2 pt-3 border-t border-[#e9edef]">
              <button
                type="button"
                onClick={() => setEditLocationModal(null)}
                disabled={submittingLocation}
                className="px-4 py-2.5 rounded-xl border border-[#d1d7db] text-xs font-semibold text-[#54656f] hover:bg-[#f0f2f5] transition"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveEditLocation}
                disabled={submittingLocation}
                className="px-5 py-2.5 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50"
              >
                {submittingLocation ? (
                  <>
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                    <span>Menyimpan...</span>
                  </>
                ) : (
                  <>
                    <Check size={14} />
                    <span>Simpan Panduan Rumah</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Comprehensive Create Reservation Modal */}
      <CreateReservationModal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          setQuickSlotTarget(null);
        }}
        onSuccess={() => {
          loadReservations();
        }}
        staffList={staffList}
        initialSlotTarget={quickSlotTarget}
        existingReservations={reservations}
      />
    </div>
  );
};
