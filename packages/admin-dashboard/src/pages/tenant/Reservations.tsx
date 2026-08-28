import React, { useEffect, useState, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest, getCachedApiResponse } from '../../services/api';
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
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Loader,
} from 'lucide-react';
import { CalendarViewMode, CalendarFilterState, QuickSlotTarget, StaffOption } from '../../components/calendar/types';
import { WeekScheduleGrid } from '../../components/calendar/WeekScheduleGrid';
import { DayScheduleGrid } from '../../components/calendar/DayScheduleGrid';
import { MonthScheduleGrid } from '../../components/calendar/MonthScheduleGrid';
import { CreateReservationModal } from '../../components/calendar/CreateReservationModal';
import { ReservationDetailModal } from '../../components/modals/ReservationDetailModal';
import { useAuth } from '../../contexts/AuthContext';

export const Reservations: React.FC = () => {
  const { user } = useAuth();
  const { toast, confirm } = useUiFeedback();
  const cachedRes = getCachedApiResponse<any>(`/api/admin/reservations?page=1&pageSize=50`);
  const initialReservations = Array.isArray(cachedRes) ? cachedRes : (cachedRes?.data || []);
  const [loading, setLoading] = useState(initialReservations.length === 0);
  const [reservations, setReservations] = useState<Reservation[]>(() => initialReservations);
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
    status: 'upcoming',
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

  // Escape key handler for active modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (housePhotoModal) setHousePhotoModal(null);
        else if (proofModal) setProofModal(null);
        else if (editLocationModal) setEditLocationModal(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [housePhotoModal, proofModal, editLocationModal]);

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
      if (reservations.length === 0) setLoading(true);
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

  const extractDurationMinutes = (detail?: string | null): number => {
    if (!detail) return 60;
    const totalMatch = detail.match(/=\s*(\d+)\s*m/i);
    if (totalMatch && totalMatch[1]) {
      const parsed = parseInt(totalMatch[1], 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    const match = detail.match(/(\d+)\s*(?:menit|mins|m)\b/i);
    if (match && match[1]) {
      const parsed = parseInt(match[1], 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return 60;
  };

  const formatBookingDate = (dateStr: string | null | undefined, detail?: string | null) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      const dayMonth = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
      const startTime = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', ':');
      const duration = extractDurationMinutes(detail);
      const endD = new Date(d.getTime() + duration * 60 * 1000);
      const endTime = endD.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', ':');
      return `${dayMonth} ${startTime} - ${endTime}`;
    } catch {
      return '';
    }
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

  // Shared ReservationDetailModal callbacks
  const handleModalConfirm = async (id: string) => {
    await handleConfirm(id);
  };

  const handleModalComplete = async (id: string) => {
    await handleComplete(id);
  };

  const handleModalStatusChange = async (id: string, newStatus: string) => {
    await handleStatusChange(id, newStatus);
  };

  const handleModalSetDate = async (id: string, date: string) => {
    await handleSetDate(id, date);
  };

  const handleModalAssignStaff = async (id: string, staffId: string | null) => {
    await handleAssignStaff(id, staffId);
  };

  const handleModalDelete = async (id: string) => {
    await handleDelete(id);
  };

  const handleModalProofUpload = async (file: File) => {
    await handleProofUpload(file);
  };

  const handleModalProofRemove = async () => {
    await handleProofRemove();
  };

  const handleModalOpenEditLocation = (res: Reservation) => {
    handleOpenEditLocation(res);
  };

  const handleModalProofView = (res: Reservation) => {
    setProofModal(res);
  };

  const handleModalHousePhotoView = (url: string) => {
    setHousePhotoModal(url);
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
  const handleSetDate = async (id: string, date?: string) => {
    const targetDate = date || editDate;
    if (!targetDate) return;
    try {
      setLoading(true);
      await apiRequest(`/api/admin/reservation/${id}/set-date`, {
        method: 'PATCH',
        body: JSON.stringify({ bookingDate: new Date(targetDate).toISOString() }),
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

  // Table sorting state (Default: sort by jadwal kunjungan ascending / nearest upcoming first)
  const [sortField, setSortField] = useState<'booking_date' | 'customer' | 'category' | 'status' | 'created_at'>('booking_date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const handleSort = (field: 'booking_date' | 'customer' | 'category' | 'status' | 'created_at') => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  // Filtered & Sorted reservations based on global sidebar, search filter, and sorting
  const filteredReservations = useMemo(() => {
    const now = Date.now();
    const isOverdue = (r: Reservation) => {
      if (!r.booking_date) return false;
      const time = new Date(r.booking_date).getTime();
      return time < now - 3 * 3600 * 1000 && r.status !== 'completed' && r.status !== 'cancelled';
    };
    const isUpcomingOrToday = (r: Reservation) => {
      if (!r.booking_date) return true;
      const time = new Date(r.booking_date).getTime();
      return time >= now - 3 * 3600 * 1000;
    };

    const list = reservations.filter((res) => {
      // Status & verification filter
      if (filterState.status === 'upcoming') {
        if (!isUpcomingOrToday(res)) return false;
      } else if (filterState.status === 'overdue') {
        if (!isOverdue(res)) return false;
      } else if (filterState.status !== 'all' && res.status !== filterState.status) {
        return false;
      }
      // Category filter
      if (filterState.category !== 'all' && res.treatment_category !== filterState.category) {
        return false;
      }
      // Staff filter
      if (filterState.staffId !== 'all') {
        if (filterState.staffId === 'unassigned') {
          if (res.assigned_staff_id || res.assigned_staff?.id) return false;
        } else {
          const match =
            res.assigned_staff_id === filterState.staffId ||
            res.assigned_staff?.id === filterState.staffId;
          if (!match) return false;
        }
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

    return list.sort((a, b) => {
      let comparison = 0;
      if (sortField === 'booking_date') {
        const now = Date.now();
        const getScore = (dateStr?: string | null) => {
          if (!dateStr) return Number.MAX_SAFE_INTEGER;
          const targetTime = new Date(dateStr).getTime();
          if (isNaN(targetTime)) return Number.MAX_SAFE_INTEGER;
          const diffMs = targetTime - now;
          // Jadwal hari ini & mendatang (toleransi 3 jam lalu hari ini):
          // Diberi prioritas utama (terdekat dari hari dan jam sekarang)
          if (diffMs >= -3 * 3600 * 1000) {
            return diffMs;
          }
          // Jadwal masa lalu yang sudah selesai: ditaruh setelah jadwal aktif
          return 10_000_000_000_000 + Math.abs(diffMs);
        };

        const scoreA = getScore(a.booking_date);
        const scoreB = getScore(b.booking_date);
        comparison = scoreA - scoreB;
      } else if (sortField === 'customer') {
        const nameA = a.customer?.name || 'Bunda';
        const nameB = b.customer?.name || 'Bunda';
        comparison = nameA.localeCompare(nameB);
      } else if (sortField === 'category') {
        const catA = a.treatment_category || '';
        const catB = b.treatment_category || '';
        comparison = catA.localeCompare(catB);
      } else if (sortField === 'status') {
        const statusOrder: Record<string, number> = { confirmed: 1, pending: 2, completed: 3, cancelled: 4 };
        const orderA = statusOrder[a.status] || 99;
        const orderB = statusOrder[b.status] || 99;
        comparison = orderA - orderB;
      } else if (sortField === 'created_at') {
        const tA = new Date(a.created_at || 0).getTime();
        const tB = new Date(b.created_at || 0).getTime();
        comparison = tA - tB;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [reservations, filterState, sortField, sortOrder]);

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
  const handleProofUploadBase64 = async (imageB64: string, mimeType: string, fileName: string) => {
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

  // Wrapper for shared modal - accepts File object
  const handleProofUpload = async (file: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('Hanya file gambar yang didukung.', 'error');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast('Gambar maksimal 8 MB.', 'error');
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      await handleProofUploadBase64(dataUrl, file.type || 'image/jpeg', file.name);
    } catch (err: any) {
      toast(`Gagal membaca file: ${err.message}`, 'error');
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
        await handleProofUploadBase64(dataUrl, file.type || 'image/jpeg', file.name);
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
                    className="p-1 rounded-md bg-white hover:bg-gray-100 text-[#111b21] shadow-2xs transition-colors cursor-pointer"
                    title="Sebelumnya"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    onClick={handleToday}
                    className="px-2 py-0.5 rounded-md bg-white hover:bg-gray-100 text-[11px] font-bold text-[#111b21] shadow-2xs transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {viewMode === 'week' ? 'Minggu Ini' : viewMode === 'month' ? 'Bulan Ini' : 'Hari Ini'}
                  </button>
                  <button
                    onClick={handleNextDate}
                    className="p-1 rounded-md bg-white hover:bg-gray-100 text-[#111b21] shadow-2xs transition-colors cursor-pointer"
                    title="Berikutnya"
                  >
                    <ChevronRight size={14} />
                  </button>
                  {/* 📅 Date Picker Quick Jump Button */}
                  <div className="relative flex items-center">
                    <input
                      type="date"
                      value={selectedDate.toISOString().split('T')[0]}
                      onChange={(e) => {
                        if (e.target.value) {
                          const [y, m, d] = e.target.value.split('-').map(Number);
                          const newD = new Date(y, m - 1, d);
                          setSelectedDate(newD);
                        }
                      }}
                      className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10"
                      title="Pilih Tanggal Spesifik"
                    />
                    <button
                      type="button"
                      className="p-1 rounded-md bg-white hover:bg-[#e8f5f2] text-[#54656f] hover:text-[#008069] shadow-2xs transition-colors cursor-pointer"
                      title="Pilih Tanggal Spesifik"
                    >
                      <CalendarIcon size={13} />
                    </button>
                  </div>
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
              onChange={(e) => {
                const newMode = e.target.value as CalendarViewMode;
                setViewMode(newMode);
                setFilterState((prev) => {
                  if (newMode === 'table') {
                    return prev.status === 'all' ? { ...prev, status: 'upcoming' } : prev;
                  } else {
                    return prev.status === 'upcoming' ? { ...prev, status: 'all' } : prev;
                  }
                });
              }}
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
              onClick={() => {
                setViewMode('table');
                setFilterState((prev) => (prev.status === 'all' ? { ...prev, status: 'upcoming' } : prev));
              }}
              className={`flex items-center space-x-1 py-1.5 px-3 rounded-lg font-bold transition-all cursor-pointer ${
                viewMode === 'table'
                  ? 'bg-white text-[#111b21] shadow-xs'
                  : 'text-[#54656f] hover:text-[#111b21]'
              }`}
            >
              <ListFilter size={13} />
              <span>Tabel</span>
            </button>
            <button
              onClick={() => {
                setViewMode('day');
                setFilterState((prev) => (prev.status === 'upcoming' ? { ...prev, status: 'all' } : prev));
              }}
              className={`flex items-center space-x-1 py-1.5 px-3 rounded-lg font-bold transition-all cursor-pointer ${
                viewMode === 'day'
                  ? 'bg-white text-[#111b21] shadow-xs'
                  : 'text-[#54656f] hover:text-[#111b21]'
              }`}
            >
              <LayoutGrid size={13} />
              <span>Hari</span>
            </button>
            <button
              onClick={() => {
                setViewMode('week');
                setFilterState((prev) => (prev.status === 'upcoming' ? { ...prev, status: 'all' } : prev));
              }}
              className={`hidden sm:flex items-center space-x-1 py-1.5 px-3 rounded-lg font-bold transition-all cursor-pointer ${
                viewMode === 'week'
                  ? 'bg-white text-[#111b21] shadow-xs'
                  : 'text-[#54656f] hover:text-[#111b21]'
              }`}
            >
              <Columns size={13} />
              <span>Minggu</span>
            </button>
            <button
              onClick={() => {
                setViewMode('month');
                setFilterState((prev) => (prev.status === 'upcoming' ? { ...prev, status: 'all' } : prev));
              }}
              className={`hidden md:flex items-center space-x-1 py-1.5 px-3 rounded-lg font-bold transition-all cursor-pointer ${
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
          {/* Mobile Status & Staff Dropdowns */}
          <div className="flex sm:hidden items-center gap-2 w-full">
            <select
              value={filterState.status}
              onChange={(e) =>
                setFilterState((prev) => ({ ...prev, status: e.target.value as any }))
              }
              className="flex-1 px-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs font-bold text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs truncate"
            >
              <option value="all">Semua Status ({reservations.length})</option>
              <option value="upcoming">📅 Aktif &amp; Mendatang ({reservations.filter((r) => !r.booking_date || new Date(r.booking_date).getTime() >= Date.now() - 3 * 3600 * 1000).length})</option>
              <option value="overdue">⚠️ Perlu Verifikasi ({reservations.filter((r) => r.booking_date && new Date(r.booking_date).getTime() < Date.now() - 3 * 3600 * 1000 && r.status !== 'completed' && r.status !== 'cancelled').length})</option>
              <option value="pending">Pending ({reservations.filter((r) => r.status === 'pending').length})</option>
              <option value="confirmed">Confirmed / Lunas ({reservations.filter((r) => r.status === 'confirmed').length})</option>
              <option value="completed">Completed / Selesai ({reservations.filter((r) => r.status === 'completed').length})</option>
              <option value="cancelled">Cancelled / Batal ({reservations.filter((r) => r.status === 'cancelled').length})</option>
            </select>

            <select
              value={filterState.staffId}
              onChange={(e) => setFilterState((prev) => ({ ...prev, staffId: e.target.value }))}
              className="flex-1 px-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs font-bold text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs truncate"
            >
              <option value="all">👥 Semua Terapis</option>
              <option value="unassigned">⚠️ Belum Ada Terapis</option>
              {staffList.map((st) => (
                <option key={st.id} value={st.id}>
                  🛵 {st.name}
                </option>
              ))}
            </select>
          </div>

          {/* Desktop Status Tabs & Staff Dropdown */}
          <div className="hidden sm:flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-1.5 p-1 bg-[#f0f2f5] rounded-2xl">
              {[
                { key: 'all', label: 'Semua', count: reservations.length },
                { key: 'upcoming', label: '📅 Aktif & Mendatang', count: reservations.filter((r) => !r.booking_date || new Date(r.booking_date).getTime() >= Date.now() - 3 * 3600 * 1000).length },
                { key: 'overdue', label: '⚠️ Perlu Verifikasi', count: reservations.filter((r) => r.booking_date && new Date(r.booking_date).getTime() < Date.now() - 3 * 3600 * 1000 && r.status !== 'completed' && r.status !== 'cancelled').length, isAlert: true },
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
                      ? tab.isAlert
                        ? 'bg-amber-100 text-amber-900 border border-amber-300 shadow-xs'
                        : 'bg-white text-[#111b21] shadow-xs'
                      : 'text-[#54656f] hover:text-[#111b21]'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                      filterState.status === tab.key
                        ? tab.isAlert
                          ? 'bg-amber-200 text-amber-900 font-bold'
                          : 'bg-[#e8f5f2] text-[#008069]'
                        : tab.isAlert && tab.count > 0
                        ? 'bg-amber-200 text-amber-800 font-bold animate-pulse'
                        : 'bg-[#e9edef] text-[#667781]'
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Staff Selector Dropdown next to Status Tabs */}
            <div className="flex items-center">
              <select
                value={filterState.staffId}
                onChange={(e) => setFilterState((prev) => ({ ...prev, staffId: e.target.value }))}
                className="px-3 py-1.5 bg-white border border-[#d1d7db] rounded-xl text-xs font-bold text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
              >
                <option value="all">👥 Semua Terapis</option>
                <option value="unassigned">⚠️ Belum Ada Terapis</option>
                {staffList.map((st) => (
                  <option key={st.id} value={st.id}>
                    🛵 {st.name} ({st.role || 'Staff'})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Search bar (Hanya muncul di Tampilan Tabel / List, tidak muncul di Hari, Minggu, dan Bulan) */}
          {viewMode === 'table' && (
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
          )}
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
                {/* Mobile Count Bar */}
                <div className="flex items-center justify-between gap-2 px-1">
                  <span className="text-[#667781] font-bold text-xs">
                    {filteredReservations.length} Data Reservasi
                  </span>
                </div>

                {filteredReservations.length === 0 ? (
                  <div className="bg-white border border-[#e9edef] rounded-2xl p-8 text-center text-[#667781] text-xs shadow-xs">
                    Tidak ada data reservasi yang sesuai.
                  </div>
                ) : (
                  filteredReservations.map((res) => (
                    <div
                      key={res.id}
                      onClick={() => setSelectedRes(res)}
                      className="bg-white rounded-2xl p-4 border border-[#e9edef] shadow-xs space-y-3 cursor-pointer hover:border-[#008069] hover:shadow-md transition"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-bold text-[#111b21] text-sm group-hover:text-[#008069] transition">{res.customer?.name || 'Bunda'}</h4>
                          <p className="text-xs text-[#667781] font-mono mt-0.5">{res.customer?.phone}</p>
                          {res.customer && (
                            <div className="flex items-center gap-1.5 mt-1 text-[10px]">
                              <span className="inline-flex items-center px-1.5 py-0.2 rounded-md bg-[#e8f5f2] text-[#008069] font-bold">
                                {(res.customer.totalTreatments ?? 1) > 1 ? `${res.customer.totalTreatments}x Treatment` : 'Pasien Baru (1x)'}
                              </span>
                              {res.customer.ltv !== undefined && (
                                <span className="text-[#8696a0] font-mono">
                                  LTV: Rp {res.customer.ltv.toLocaleString('id-ID')}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <div>{getStatusBadge(res.status)}</div>
                      </div>

                      <div className="flex items-center justify-between text-xs pt-1 border-t border-[#e9edef]">
                        <span className="px-2 py-0.5 rounded bg-[#f0f2f5] text-[#54656f] font-semibold text-[10px]">
                          {res.treatment_category}
                        </span>
                        <span className="font-bold text-[#008069] bg-[#e8f5f2] px-2 py-0.5 rounded border border-[#c2e7e0] text-xs">
                          {res.booking_date ? formatBookingDate(res.booking_date, res.treatment_detail) : 'Belum ada jadwal'}
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
                            onClick={(e) => {
                              e.stopPropagation();
                              setProofModal(res);
                            }}
                            className="p-2 bg-[#e8f5f2] hover:bg-[#c2e7e0] text-[#008069] border border-[#c2e7e0] rounded-xl transition-all flex items-center justify-center cursor-pointer"
                            title={`Lihat Bukti Bayar (${getPaymentMethodLabel(res.payment_method)})`}
                          >
                            <Eye size={15} />
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedRes(res);
                          }}
                          className="px-3 py-1.5 bg-[#f0f2f5] hover:bg-[#008069] text-[#111b21] hover:text-white border border-[#d1d7db] rounded-xl transition-all font-semibold text-xs cursor-pointer"
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
                      <tr className="border-b border-[#e9edef] bg-[#f8fafc] text-[#667781] text-xs uppercase tracking-wider font-bold select-none">
                        <th 
                          onClick={() => handleSort('customer')} 
                          className="py-3.5 px-5 cursor-pointer hover:bg-[#f0f2f5] transition-colors"
                          title="Klik untuk mengurutkan nama customer"
                        >
                          <div className="flex items-center gap-1.5">
                            <span>Customer</span>
                            {sortField === 'customer' ? (
                              sortOrder === 'asc' ? <ArrowUp size={13} className="text-[#008069]" /> : <ArrowDown size={13} className="text-[#008069]" />
                            ) : (
                              <ArrowUpDown size={12} className="opacity-40" />
                            )}
                          </div>
                        </th>
                        <th 
                          onClick={() => handleSort('category')} 
                          className="py-3.5 px-5 cursor-pointer hover:bg-[#f0f2f5] transition-colors"
                          title="Klik untuk mengurutkan kategori layanan"
                        >
                          <div className="flex items-center gap-1.5">
                            <span>Kategori</span>
                            {sortField === 'category' ? (
                              sortOrder === 'asc' ? <ArrowUp size={13} className="text-[#008069]" /> : <ArrowDown size={13} className="text-[#008069]" />
                            ) : (
                              <ArrowUpDown size={12} className="opacity-40" />
                            )}
                          </div>
                        </th>
                        <th className="py-3.5 px-5">Detail Layanan</th>
                        <th 
                          onClick={() => handleSort('booking_date')} 
                          className="py-3.5 px-5 cursor-pointer hover:bg-[#f0f2f5] transition-colors bg-[#e8f5f2]/40"
                          title="Klik untuk mengurutkan jadwal kunjungan"
                        >
                          <div className="flex items-center gap-1.5 text-[#008069]">
                            <span>Jadwal Kunjungan</span>
                            {sortField === 'booking_date' ? (
                              sortOrder === 'asc' ? <ArrowUp size={14} className="text-[#008069] font-bold" /> : <ArrowDown size={14} className="text-[#008069] font-bold" />
                            ) : (
                              <ArrowUpDown size={12} className="opacity-60" />
                            )}
                          </div>
                        </th>
                        <th className="py-3.5 px-5">Terapis</th>
                        <th 
                          onClick={() => handleSort('status')} 
                          className="py-3.5 px-5 cursor-pointer hover:bg-[#f0f2f5] transition-colors"
                          title="Klik untuk mengurutkan status"
                        >
                          <div className="flex items-center gap-1.5">
                            <span>Status</span>
                            {sortField === 'status' ? (
                              sortOrder === 'asc' ? <ArrowUp size={13} className="text-[#008069]" /> : <ArrowDown size={13} className="text-[#008069]" />
                            ) : (
                              <ArrowUpDown size={12} className="opacity-40" />
                            )}
                          </div>
                        </th>
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
                          <tr
                            key={res.id}
                            onClick={() => setSelectedRes(res)}
                            className="hover:bg-[#f0f2f5] transition-all cursor-pointer group"
                          >
                            <td className="py-3.5 px-5 font-medium">
                              <p className="font-bold text-[#111b21] group-hover:text-[#008069] transition">{res.customer?.name || 'Bunda'}</p>
                              <p className="text-xs text-[#667781] font-mono">{res.customer?.phone}</p>
                              {res.customer && (
                                <div className="flex items-center gap-1.5 mt-0.5 text-[10px]">
                                  <span className="inline-flex items-center px-1.5 py-0.2 rounded-md bg-[#e8f5f2] text-[#008069] font-bold">
                                    {(res.customer.totalTreatments ?? 1) > 1 ? `${res.customer.totalTreatments}x` : 'Baru (1x)'}
                                  </span>
                                  {res.customer.ltv !== undefined && (
                                    <span className="text-[#8696a0] font-mono">
                                      LTV: Rp {res.customer.ltv.toLocaleString('id-ID')}
                                    </span>
                                  )}
                                </div>
                              )}
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
                                formatBookingDate(res.booking_date, res.treatment_detail)
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedRes(res);
                                  }}
                                  className="px-2 py-1 rounded-lg bg-[#e8f5f2] border border-[#c2e7e0] text-[#008069] hover:bg-[#c2e7e0] text-xs font-semibold transition-all cursor-pointer"
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
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setProofModal(res);
                                  }}
                                  className="p-2 bg-[#e8f5f2] hover:bg-[#c2e7e0] text-[#008069] border border-[#c2e7e0] rounded-xl transition-all flex items-center justify-center cursor-pointer"
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
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedRes(res);
                                }}
                                className="px-3 py-1.5 bg-white hover:bg-[#008069] text-[#111b21] hover:text-white border border-[#d1d7db] rounded-xl text-xs transition-all font-semibold shadow-xs cursor-pointer"
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

      {/* Reservation Details & Management Modal (Shared Component) */}
      {selectedRes && (
        <ReservationDetailModal
          reservation={selectedRes}
          staffList={staffList}
          user={user}
          googleCalendarMockActive={googleCalendarMockActive}
          onClose={() => setSelectedRes(null)}
          onUpdate={loadReservations}
          onConfirm={handleModalConfirm}
          onComplete={handleModalComplete}
          onStatusChange={handleModalStatusChange}
          onSetDate={handleModalSetDate}
          onAssignStaff={handleModalAssignStaff}
          onDelete={handleModalDelete}
          onProofUpload={handleModalProofUpload}
          onProofRemove={handleModalProofRemove}
          onOpenEditLocation={handleModalOpenEditLocation}
          onProofView={handleModalProofView}
          onHousePhotoView={handleModalHousePhotoView}
        />
      )}

      {/* Payment Proof Viewer Modal */}
      {proofModal &&
        createPortal(
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[9999] flex items-center justify-center p-3 sm:p-4 animate-fadeIn h-[100dvh] w-[100dvw]"
            onClick={() => setProofModal(null)}
          >
            <div
              className="w-full max-w-md bg-white border border-[#e9edef] rounded-3xl p-4 sm:p-5 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto animate-modalScaleUp"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-[#e9edef] pb-3">
                <h3 className="text-sm font-bold text-[#111b21] flex items-center space-x-2">
                  <Receipt size={16} className="text-[#008069] flex-shrink-0" />
                  <span>Bukti Pembayaran</span>
                </h3>
                <button
                  onClick={() => setProofModal(null)}
                  className="p-1.5 rounded-full text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5] transition cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="text-xs space-y-1.5 bg-[#f8fafc] border border-[#e9edef] rounded-2xl p-3.5">
                <div className="flex justify-between">
                  <span className="text-[#667781]">Pasien:</span>
                  <span className="font-bold text-[#111b21]">
                    {proofModal.customer?.name || 'Bunda'} ({proofModal.customer?.phone})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#667781]">Metode:</span>
                  <span className="font-bold text-[#111b21]">{getPaymentMethodLabel(proofModal.payment_method)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#667781]">Nilai:</span>
                  <span className="font-bold text-[#111b21]">
                    {proofModal.purchase_value ? `Rp ${proofModal.purchase_value.toLocaleString('id-ID')}` : '-'}
                  </span>
                </div>
                <div className="flex justify-between items-center pt-1 border-t border-[#e9edef]">
                  <span className="text-[#667781]">Status:</span>
                  {getStatusBadge(proofModal.status)}
                </div>
              </div>

              <div className="rounded-2xl overflow-hidden border border-[#e9edef] bg-[#f8fafc]">
                <img
                  src={proofModal.proof_url!}
                  alt="Bukti pembayaran"
                  className="w-full max-h-72 object-contain"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-[#e9edef]">
                <button
                  type="button"
                  onClick={() => setProofModal(null)}
                  className="px-4 py-2 rounded-xl border border-[#d1d7db] text-xs font-semibold text-[#54656f] hover:bg-[#f0f2f5] transition cursor-pointer"
                >
                  Tutup
                </button>
                <a
                  href={proofModal.proof_url!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white text-xs font-bold transition shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  <Maximize2 size={13} />
                  <span>Buka Gambar Penuh</span>
                </a>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* House Front Photo Lightbox Modal */}
      {housePhotoModal &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-fadeIn h-[100dvh] w-[100dvw]"
            onClick={() => setHousePhotoModal(null)}
          >
            <div
              className="bg-white rounded-3xl p-5 max-w-lg w-full space-y-4 shadow-2xl border border-[#e9edef] relative animate-modalScaleUp"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-[#e9edef] pb-3">
                <div className="flex items-center space-x-2 text-[#008069]">
                  <Camera size={18} />
                  <h3 className="font-bold text-sm text-[#111b21]">Foto Tampak Depan Rumah Pasien</h3>
                </div>
                <button
                  onClick={() => setHousePhotoModal(null)}
                  className="p-1.5 rounded-full text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5] transition cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="rounded-2xl overflow-hidden border border-[#e9edef] bg-[#f8fafc]">
                <img
                  src={housePhotoModal}
                  alt="Foto depan rumah pasien"
                  className="w-full max-h-[70vh] object-contain"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-[#e9edef]">
                <button
                  type="button"
                  onClick={() => setHousePhotoModal(null)}
                  className="px-4 py-2 rounded-xl border border-[#d1d7db] text-xs font-semibold text-[#54656f] hover:bg-[#f0f2f5] transition cursor-pointer"
                >
                  Tutup
                </button>
                <a
                  href={housePhotoModal}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white text-xs font-bold transition shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  <Maximize2 size={13} />
                  <span>Buka Gambar Asli HD</span>
                </a>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Admin Edit Panduan Lokasi & Foto Rumah Modal */}
      {editLocationModal &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fadeIn h-[100dvh] w-[100dvw]"
            onClick={() => setEditLocationModal(null)}
          >
            <div
              className="bg-white rounded-3xl p-5 sm:p-6 max-w-md w-full space-y-4 shadow-2xl border border-[#e9edef] relative max-h-[92vh] overflow-y-auto animate-modalScaleUp"
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
                  className="p-1.5 rounded-full text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5] transition cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Info Alamat Pasien */}
              <div className="p-3 rounded-2xl bg-[#f8fafc] border border-[#e9edef] text-xs text-[#54656f] space-y-1">
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
                        className="p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition shadow-xs cursor-pointer"
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
                        className="p-1.5 rounded-full bg-rose-600 text-white hover:bg-rose-700 transition shadow-xs cursor-pointer"
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
                    className="w-full py-4 border-2 border-dashed border-[#d1d7db] hover:border-[#008069] rounded-2xl flex flex-col items-center justify-center text-xs text-[#667781] hover:text-[#008069] transition bg-[#f8fafc] cursor-pointer"
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
                  className="px-4 py-2.5 rounded-xl border border-[#d1d7db] text-xs font-semibold text-[#54656f] hover:bg-[#f0f2f5] transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleSaveEditLocation}
                  disabled={submittingLocation}
                  className="px-5 py-2.5 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
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
          </div>,
          document.body
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
