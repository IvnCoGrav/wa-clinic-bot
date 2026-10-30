import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest, getCachedApiResponse } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import { Reservation } from '../../types';
import { evaluatePaymentProof } from '../../utils/paymentProof';
import { extractBabiesFromRawText } from '../../utils/reservationBabies';
import { getWibDateKey, getTodayWibDate } from '../../utils/dateWib';
import { buildReservationsQuery } from '../../utils/reservationQuery';
import { getWeekDateRange } from '../../utils/calendarWeekRange';
import { VIEW_MODE_OPTIONS, nextStatusForView } from '../../utils/calendarViewMode';
import { resolveChildAgeRows, momGestationalBadge } from '../../utils/clinicalAge';
import { extractDurationMinutes } from '../../utils/durationCalculator';
import { Pagination } from '../../components/common/Pagination';
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
  Clock,
  Crosshair,
  Link2,
  ExternalLink,
  ChevronUp,
  ChevronDown,
  CheckCircle2,
  MessageSquare,
  Loader,
} from 'lucide-react';
import { CalendarViewMode, CalendarFilterState, QuickSlotTarget, StaffOption } from '../../components/calendar/types';
import { WeekScheduleGrid } from '../../components/calendar/WeekScheduleGrid';
import { extractLatLngFromMapsUrl, getCurrentDeviceLocation, geocodeAddressWithNominatim, getGoogleMapsDirectionUrl } from '../../utils/geoUtils';
import { useMapsShortlinkResolver } from '../../hooks/useMapsShortlinkResolver';
import { compressImageFile, resolveCompressProfile } from '../../utils/imageCompressor';
import { stampGpsWatermark } from '../../utils/imageWatermark';
import { DayScheduleGrid } from '../../components/calendar/DayScheduleGrid';
import { MonthScheduleGrid } from '../../components/calendar/MonthScheduleGrid';
import { CreateReservationModal } from '../../components/calendar/CreateReservationModal';
import { ReservationDetailModal } from '../../components/modals/ReservationDetailModal';
import { ChatHistoryModal } from '../../components/modals/ChatHistoryModal';
import { StatusChip } from '../../components/ui/StatusChip';
import { reservationStatusToTone } from '../../utils/statusTone';
import { useAuth } from '../../contexts/AuthContext';
import { resolveStaffName } from '../../utils/resolveStaffName';

/**
 * Baca deep-link tanggal dari query `?date=YYYY-MM-DD` (mis. dari notifikasi
 * tumpang jadwal). Mengembalikan Date lokal atau null bila tak ada/tidak valid.
 * Parsing pakai URLSearchParams + validasi angka (bukan regex hafalan).
 */
function readInitialDateFromQuery(): Date | null {
  try {
    const raw = new URLSearchParams(window.location.search).get('date');
    if (!raw) return null;
    const parts = raw.split('-');
    if (parts.length !== 3) return null;
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    const d = Number(parts[2]);
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const parsed = new Date(y, m - 1, d);
    if (isNaN(parsed.getTime())) return null;
    // Tolak overflow (mis. 2026-02-31 → 3 Mar) agar hanya tanggal valid diterima.
    if (parsed.getFullYear() !== y || parsed.getMonth() !== m - 1 || parsed.getDate() !== d) return null;
    return parsed;
  } catch {
    return null;
  }
}

const VIEW_MODE_ICONS: Record<CalendarViewMode, React.ReactNode> = {
  table: <ListFilter size={13} />,
  day: <LayoutGrid size={13} />,
  week: <Columns size={13} />,
  month: <CalendarDays size={13} />,
};

export const Reservations: React.FC = () => {
  const { user } = useAuth();
  const { toast, confirm } = useUiFeedback();
  const cachedRes = getCachedApiResponse<any>(`/api/admin/reservations?page=1&pageSize=20`);
  const initialReservations = Array.isArray(cachedRes) ? cachedRes : (cachedRes?.data || []);
  const [loading, setLoading] = useState(initialReservations.length === 0);
  const [reservations, setReservations] = useState<Reservation[]>(() => initialReservations);
  const [selectedRes, setSelectedRes] = useState<Reservation | null>(null);
  const [proofModal, setProofModal] = useState<Reservation | null>(null);
  const [proofUploading, setProofUploading] = useState(false);
  const [housePhotoModal, setHousePhotoModal] = useState<string | null>(null);
  const proofFileInputRef = useRef<HTMLInputElement>(null);

  // Chat History Modal State — render & fetch dimiliki ChatHistoryModal terpusat.
  // Selalu zIndex 10000: halaman ini membuka riwayat dari atas
  // ReservationDetailModal (z-[9999]).
  const [activeHistoryCustomer, setActiveHistoryCustomer] = useState<{ id: string; name?: string; phone?: string } | null>(null);

  // Edit Location & House Photo Modal (Admin CS)
  const [editLocationModal, setEditLocationModal] = useState<Reservation | null>(null);
  const [editHousePhotoB64, setEditHousePhotoB64] = useState<string | null>(null);
  const [editLandmark, setEditLandmark] = useState<string>('');
  const [editLat, setEditLat] = useState<string>('');
  const [editLng, setEditLng] = useState<string>('');
  const [editRemovePhoto, setEditRemovePhoto] = useState(false);
  const [submittingLocation, setSubmittingLocation] = useState(false);
  const adminHouseFileInputRef = useRef<HTMLInputElement>(null);

  // Calendar View State — deep-link `?date=YYYY-MM-DD` (notifikasi tumpang jadwal)
  // membuka mode "day" pada tanggal terkait; tanpa param → hari ini, mode tabel.
  const deepLinkDate = useMemo(() => readInitialDateFromQuery(), []);
  const [selectedDate, setSelectedDate] = useState<Date>(() => deepLinkDate ?? getTodayWibDate());
  const [viewMode, setViewMode] = useState<CalendarViewMode>(() => (deepLinkDate ? 'day' : 'table'));
  const [filterState, setFilterState] = useState<CalendarFilterState>({
    searchQuery: '',
    category: 'all',
    staffId: 'all',
    // Deep link `?date=...` langsung membuka view kalender. Status default
    // 'upcoming' akan menyembunyikan reservasi tanggal lampau (API memotong
    // `booking_date >= now-3j`), sehingga grid tampak kosong padahal ada data.
    status: deepLinkDate ? 'all' : 'upcoming',
  });

  const handleViewModeChange = useCallback((newMode: CalendarViewMode) => {
    setViewMode(newMode);
    setFilterState((prev) => {
      const nextStatus = nextStatusForView(newMode, prev.status);
      return nextStatus === prev.status ? prev : { ...prev, status: nextStatus };
    });
  }, []);

  const [sortField, setSortField] = useState<'booking_date' | 'customer' | 'category' | 'status' | 'created_at'>('booking_date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const [googleCalendarMockActive, setGoogleCalendarMockActive] = useState(true);
  const [editDate, setEditDate] = useState('');
  const [staffList, setStaffList] = useState<StaffOption[]>([]);
  const [assigningStaff, setAssigningStaff] = useState(false);

  // Global stats state
  const [stats, setStats] = useState<{
    total: number;
    upcoming: number;
    overdue: number;
    pending: number;
    confirmed: number;
    completed: number;
    cancelled: number;
    hold: number;
  }>({
    total: 0,
    upcoming: 0,
    overdue: 0,
    pending: 0,
    confirmed: 0,
    completed: 0,
    cancelled: 0,
    hold: 0,
  });

  // Create Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [quickSlotTarget, setQuickSlotTarget] = useState<QuickSlotTarget | null>(null);

  // Table pagination state
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalReservations, setTotalReservations] = useState(0);
  const PAGE_SIZE = 20;

  // Bulk complete (checklist massal). Cakupan pilihan = baris pada halaman/filter aktif.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCompleting, setBulkCompleting] = useState(false);

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

  // Modal Back Navigation: Keyboard Escape, app-swipe-back & popstate listener for mobile back gestures
  useEffect(() => {
    const hasOpenModal = Boolean(housePhotoModal || proofModal || editLocationModal || activeHistoryCustomer || showCreateModal);
    if (!hasOpenModal) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dismissActiveModal();
      }
    };

    const handleSwipeBack = (e: Event) => {
      e.preventDefault();
      dismissActiveModal();
    };

    const handlePopState = () => {
      dismissActiveModal();
    };

    const dismissActiveModal = () => {
      if (housePhotoModal) setHousePhotoModal(null);
      else if (proofModal) setProofModal(null);
      else if (editLocationModal) setEditLocationModal(null);
      else if (activeHistoryCustomer) setActiveHistoryCustomer(null);
      else if (showCreateModal) {
        setShowCreateModal(false);
        setQuickSlotTarget(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('app-swipe-back', handleSwipeBack);
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('app-swipe-back', handleSwipeBack);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [housePhotoModal, proofModal, editLocationModal, activeHistoryCustomer, showCreateModal]);

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

  const getCalendarDateRange = (mode: CalendarViewMode, date: Date) => {
    if (mode === 'day') {
      const key = getWibDateKey(date);
      return { startDate: key, endDate: key };
    } else if (mode === 'week') {
      // F-43: rentang minggu WAJIB dari seam yang sama dengan kolom grid.
      return getWeekDateRange(date);
    } else if (mode === 'month') {
      const start = new Date(date.getFullYear(), date.getMonth(), 1);
      const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      return { startDate: getWibDateKey(start), endDate: getWibDateKey(end) };
    }
    return null;
  };

  const loadReservations = useCallback(
    async (targetPage = 1) => {
      try {
        setLoading(true);
        const params = buildReservationsQuery({
          viewMode,
          filters: filterState,
          page: targetPage,
          pageSize: PAGE_SIZE,
          sortField,
          sortOrder,
          range: viewMode === 'table' ? null : getCalendarDateRange(viewMode, selectedDate),
        });

        const res = await apiRequest(`/api/admin/reservations?${params.toString()}`);
        const data = Array.isArray(res) ? res : res?.data || [];
        setReservations(data);
        if (!Array.isArray(res)) {
          setTotalPages(res?.totalPages || 1);
          setTotalReservations(res?.total ?? data.length);
          if (res?.stats) {
            setStats(res.stats);
          }
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
    },
    [viewMode, selectedDate, filterState.status, filterState.staffId, filterState.category, filterState.searchQuery, sortField, sortOrder]
  );

  // Trigger data load when filters or views change
  useEffect(() => {
    loadReservations(1);
  }, [
    viewMode,
    selectedDate,
    filterState.status,
    filterState.staffId,
    filterState.category,
    sortField,
    sortOrder,
  ]);

  // Debounced search query trigger
  useEffect(() => {
    const handler = setTimeout(() => {
      loadReservations(1);
    }, 300);
    return () => clearTimeout(handler);
  }, [filterState.searchQuery]);

  // Reset pilihan massal saat berpindah halaman/filter/view — agar cakupan tetap
  // = baris yang tampil (halaman aktif), tidak ada id "hantu" dari halaman lain.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [page, viewMode, filterState.status, filterState.staffId, filterState.category, sortField, sortOrder]);

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
    setSelectedDate(getTodayWibDate());
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

  const handleModalCancel = async (id: string) => {
    await handleCancel(id);
  };

  const handleModalDeletePermanent = async (id: string) => {
    await handleDeletePermanent(id);
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

  // ── Bulk complete (checklist massal) ─────────────────────────────────────
  const BULK_COMPLETE_MAX = 50;

  const toggleSelect = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    setSelectedIds((prev) => {
      const pageIds = filteredReservations.map((r) => r.id);
      const allSelected = pageIds.length > 0 && pageIds.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        for (const id of pageIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of pageIds) next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkComplete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (ids.length > BULK_COMPLETE_MAX) {
      toast(`Maksimal ${BULK_COMPLETE_MAX} reservasi per sekali proses. Persempit pilihan Anda.`, 'error');
      return;
    }
    const ok = await confirm({
      title: `Tandai ${ids.length} Reservasi Selesai?`,
      message: `${ids.length} reservasi yang dipilih akan ditandai Selesai Treatment. Reservasi yang belum dijadwalkan, yang tanggalnya masih di masa depan, atau yang sudah selesai akan otomatis dilewati.`,
      confirmText: `Ya, Selesaikan ${ids.length}`,
    });
    if (!ok) return;

    try {
      setBulkCompleting(true);
      const res = await apiRequest('/api/admin/reservations/bulk-complete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
      const completed: string[] = Array.isArray(res?.completed) ? res.completed : [];
      const skipped: Array<{ id: string; reason: string }> = Array.isArray(res?.skipped) ? res.skipped : [];
      if (skipped.length === 0) {
        toast(`${completed.length} reservasi berhasil ditandai Selesai Treatment.`, 'success');
      } else {
        toast(`${completed.length} selesai, ${skipped.length} dilewati (mungkin sudah selesai / belum dijadwalkan / masa depan).`, 'info');
      }
      clearSelection();
      await loadReservations(page);
    } catch (err: any) {
      toast(`Gagal menyelesaikan massal: ${err.message}`, 'error');
    } finally {
      setBulkCompleting(false);
    }
  };
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

  // Cancel Reservation (Soft Cancel -> Status: Cancelled)
  const handleCancel = async (id: string) => {
    const isConfirmed = await confirm({
      title: 'Batalkan Reservasi?',
      message: 'Apakah Anda yakin ingin membatalkan jadwal reservasi ini? Status reservasi akan diubah menjadi Cancelled.',
      confirmText: 'Ya, Batalkan',
      danger: true,
    });
    if (!isConfirmed) return;
    try {
      setLoading(true);
      await apiRequest(`/api/admin/reservation/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' }),
      });
      toast('Reservasi berhasil dibatalkan.', 'success');
      setSelectedRes(null);
      loadReservations();
    } catch (err: any) {
      toast(`Gagal membatalkan: ${err.message}`, 'error');
      setLoading(false);
    }
  };

  // Delete Reservation Permanently (Hard Delete)
  const handleDeletePermanent = async (id: string) => {
    const isConfirmed = await confirm({
      title: 'Hapus Reservasi Permanen?',
      message: 'Apakah Anda yakin ingin menghapus data reservasi ini secara permanen dari database? Tindakan ini tidak dapat dibatalkan.',
      confirmText: 'Ya, Hapus Permanen',
      danger: true,
    });
    if (!isConfirmed) return;
    try {
      setLoading(true);
      await apiRequest(`/api/admin/reservation/${id}?hard=true`, {
        method: 'DELETE',
      });
      toast('Reservasi berhasil dihapus permanen.', 'success');
      setSelectedRes(null);
      loadReservations();
    } catch (err: any) {
      toast(`Gagal menghapus reservasi: ${err.message}`, 'error');
      setLoading(false);
    }
  };

  // Delete Reservation (Legacy wrapper)
  const handleDelete = async (id: string) => {
    await handleCancel(id);
  };

  // Open Chat History — fetch & render dimiliki ChatHistoryModal terpusat.
  const handleOpenChatHistory = (customerId: string, customerName?: string, customerPhone?: string) => {
    setActiveHistoryCustomer({ id: customerId, name: customerName, phone: customerPhone });
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

  // Baby info resolver — usia klinis seragam (util bersama, cermin engine backend)
  const getBabyRows = (res: Reservation | null): Array<{ name: string; age: string; regAge?: string }> => {
    return resolveChildAgeRows(res as any, extractBabiesFromRawText);
  };

  const handleSort = (field: 'booking_date' | 'customer' | 'category' | 'status' | 'created_at') => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  // Direct server-filtered reservations (lightweight & zero memory overhead)
  const filteredReservations = reservations;

  const getStatusBadge = (status: string, rawText?: string | null) => {
    if (status === 'pending' && rawText && /\[SAME_DAY_REQUEST\]/i.test(rawText)) {
      return (
        <span className="px-2.5 py-0.5 rounded-full bg-danger text-on-solid text-xs font-bold shadow-2xs">
          ⏰ Hari Ini — Perlu Cek
        </span>
      );
    }
    const tone = reservationStatusToTone(status);
    const labels: Record<string, string> = {
      hold: '⏳ Hold',
      confirmed: '📅 Terjadwal',
      en_route: '🛵 Dalam Perjalanan',
      completed: '✅ Selesai',
      cancelled: '❌ Batal',
      pending: '⏳ Menunggu',
    };
    return <StatusChip tone={tone} label={labels[status] || '⏳ Hold'} dot={false} />;
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

  // Smart location assistant states in Reservations
  const [editMapsUrlInput, setEditMapsUrlInput] = useState('');
  const { resolve: resolveEditMapsUrl, isResolving: editMapsResolving } = useMapsShortlinkResolver();
  const [editGettingGps, setEditGettingGps] = useState(false);
  const [editGeocoding, setEditGeocoding] = useState(false);
  const [editGpsAccuracy, setEditGpsAccuracy] = useState<number | null>(null);
  const [editShowManualCoords, setEditShowManualCoords] = useState(false);
  const [editRawHousePhotoB64, setEditRawHousePhotoB64] = useState<string | null>(null);

  const handleOpenEditLocation = (res: Reservation) => {
    setEditLocationModal(res);
    const prefs = res.customer?.preferences as any;
    setEditHousePhotoB64(prefs?.house_photo_url || null);
    setEditRawHousePhotoB64(null);
    setEditLandmark(prefs?.landmark || '');
    setEditLat(res.customer?.lat != null ? String(res.customer.lat) : '');
    setEditLng(res.customer?.lng != null ? String(res.customer.lng) : '');
    setEditRemovePhoto(false);
    setEditMapsUrlInput('');
    setEditGpsAccuracy(null);
    setEditShowManualCoords(false);
  };

  const handlePickAdminHousePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // Kompresi cepat di sisi client — profil 'chat' seragam (1280px/q0.75)
      const cp = resolveCompressProfile('chat');
      const compressed = await compressImageFile(file, { maxWidth: cp.maxWidth, maxHeight: cp.maxHeight, quality: cp.quality });
      setEditRawHousePhotoB64(compressed.dataUrl);
      
      // Beri watermark GPS / Kelurahan jika tersedia
      const cust = editLocationModal?.customer;
      const adminName = user?.name || user?.email || 'Admin Klinik';
      const watermarked = await stampGpsWatermark(compressed.dataUrl, {
        lat: editLat ? parseFloat(editLat) : cust?.lat,
        lng: editLng ? parseFloat(editLng) : cust?.lng,
        kelurahan: cust?.kelurahan,
        kecamatan: cust?.kecamatan,
        landmark: editLandmark,
        customerName: cust?.name || undefined,
        takerName: adminName,
        staffName: adminName,
      });

      setEditHousePhotoB64(watermarked);
      setEditRemovePhoto(false);
      toast('Foto rumah berhasil dimuat & dikompres instan! 📸', 'success');
    } catch {
      toast('Gagal memproses foto rumah.', 'error');
    }
  };

  // Smart Maps URL Parser
  const handlePasteEditMapsUrl = async (val: string) => {
    setEditMapsUrlInput(val);
    if (!val || val.trim().length < 5) return;

    const parsed = await resolveEditMapsUrl(val);
    if (parsed) {
      setEditLat(parsed.lat.toFixed(6));
      setEditLng(parsed.lng.toFixed(6));
      setEditGpsAccuracy(null);
    }
  };

  // Kunci GPS Perangkat Sekarang
  const handleLockEditGps = async () => {
    setEditGettingGps(true);
    try {
      const loc = await getCurrentDeviceLocation(10000);
      setEditLat(loc.lat.toFixed(6));
      setEditLng(loc.lng.toFixed(6));
      setEditGpsAccuracy(loc.accuracy);
      toast(`✓ Titik GPS berhasil dikunci (Akurasi: ±${loc.accuracy}m)! 📍`, 'success');
    } catch (err: any) {
      toast(err.message || 'Gagal mengunci GPS.', 'error');
    } finally {
      setEditGettingGps(false);
    }
  };

  // Cari Koordinat dari Alamat via Geocoding
  const handleGeocodeEditAddress = async () => {
    const cust = editLocationModal?.customer;
    const addressQuery = [cust?.kelurahan, cust?.kecamatan, cust?.kota].filter(Boolean).join(', ');
    if (!addressQuery || addressQuery.trim().length < 3) {
      toast('Alamat kelurahan/kecamatan belum lengkap untuk pencarian otomatis.', 'info');
      return;
    }

    setEditGeocoding(true);
    try {
      const res = await geocodeAddressWithNominatim(addressQuery);
      if (res) {
        setEditLat(res.lat.toFixed(6));
        setEditLng(res.lng.toFixed(6));
        setEditGpsAccuracy(null);
        toast(`✓ Titik koordinat ditemukan untuk ${cust?.kelurahan || cust?.kecamatan}! 📍`, 'success');
      } else {
        toast('Titik tidak ditemukan untuk alamat ini. Coba tempel link Google Maps.', 'info');
      }
    } catch {
      toast('Gagal mencari titik alamat.', 'error');
    } finally {
      setEditGeocoding(false);
    }
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
          housePhotoB64: editRawHousePhotoB64 || (editHousePhotoB64 && editHousePhotoB64.startsWith('data:image/') ? editHousePhotoB64 : undefined),
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
    timeZone: 'Asia/Jakarta',
  });

  return (
    <div className="space-y-5">
      {/* Top Header Bar */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 bg-surface p-3.5 sm:p-4 rounded-2xl border border-divider shadow-xs">
        {/* Title & Month Navigation */}
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-lg sm:text-xl font-black tracking-tight text-ink capitalize">
                {headerDateTitle}
              </h2>

              {/* Date Navigation group placed right next to Month text */}
              {viewMode !== 'table' && (
                <div className={`flex items-center space-x-1 bg-fill-1 p-0.5 rounded-lg border border-divider ${viewMode === 'day' ? 'hidden sm:flex' : ''}`}>
                  <button
                    onClick={handlePrevDate}
                    className="p-1 rounded-md bg-surface hover:bg-gray-100 dark:hover:bg-fill-2 text-ink shadow-2xs transition-colors cursor-pointer"
                    title="Sebelumnya"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    onClick={handleToday}
                    className="px-2 py-0.5 rounded-md bg-surface hover:bg-gray-100 dark:hover:bg-fill-2 text-[11px] font-bold text-ink shadow-2xs transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {viewMode === 'week' ? 'Minggu Ini' : viewMode === 'month' ? 'Bulan Ini' : 'Hari Ini'}
                  </button>
                  <button
                    onClick={handleNextDate}
                    className="p-1 rounded-md bg-surface hover:bg-gray-100 dark:hover:bg-fill-2 text-ink shadow-2xs transition-colors cursor-pointer"
                    title="Berikutnya"
                  >
                    <ChevronRight size={14} />
                  </button>
                  {/* 📅 Date Picker Quick Jump Button */}
                  <div className="relative flex items-center">
                    <input
                      type="date"
                      value={getWibDateKey(selectedDate)}
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
                      className="p-1 rounded-md bg-surface hover:bg-accent-soft dark:hover:bg-fill-2 text-ink-2 hover:text-accent shadow-2xs transition-colors cursor-pointer"
                      title="Pilih Tanggal Spesifik"
                    >
                      <CalendarIcon size={13} />
                    </button>
                  </div>
                </div>
              )}
            </div>
            <p className="text-[11px] text-ink-3 mt-0.5">
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
              onChange={(e) => handleViewModeChange(e.target.value as CalendarViewMode)}
              className="w-full px-3 py-2 bg-surface border border-divider rounded-xl text-xs font-bold text-ink focus:outline-none focus:border-accent shadow-xs"
            >
              {VIEW_MODE_OPTIONS.map((opt) => (
                <option key={opt.mode} value={opt.mode}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Desktop View Switcher Tabs */}
          <div className="hidden sm:flex space-x-1 p-1 bg-fill-1 rounded-xl shadow-inner text-xs border border-transparent dark:border-divider">
            {VIEW_MODE_OPTIONS.map((opt) => {
              const active = viewMode === opt.mode;
              return (
                <button
                  key={opt.mode}
                  type="button"
                  onClick={() => handleViewModeChange(opt.mode)}
                  className={`flex items-center space-x-1 py-1.5 px-3 rounded-lg font-bold transition-all cursor-pointer ${
                    active
                      ? 'bg-surface text-ink shadow-xs'
                      : 'text-ink-2 hover:text-ink dark:hover:text-ink'
                  }`}
                >
                  {VIEW_MODE_ICONS[opt.mode]}
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>

          {/* Action buttons */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                setQuickSlotTarget(null);
                setShowCreateModal(true);
              }}
              className="flex items-center space-x-1.5 px-3.5 py-2 bg-accent hover:bg-accent rounded-xl text-xs font-semibold text-white transition-colors shadow-xs"
            >
              <CalendarIcon size={14} />
              <span>+ Buat Jadwal</span>
            </button>
            <button
              onClick={() => {
                setLoading(true);
                loadReservations();
              }}
              className="p-2 bg-surface hover:bg-fill-1 border border-divider rounded-xl text-ink transition-colors shadow-xs"
              title="Reload Data"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin text-accent' : 'text-ink-3'} />
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
              className="flex-1 px-3 py-2 bg-surface border border-divider rounded-xl text-xs font-bold text-ink focus:outline-none focus:border-accent shadow-xs truncate"
            >
              <option value="all">Semua Status ({stats.total})</option>
              <option value="upcoming">📅 Aktif &amp; Mendatang ({stats.upcoming})</option>
              <option value="overdue">⚠️ Perlu Verifikasi ({stats.overdue})</option>
              <option value="hold">⏳ Hold / Ditawarkan ({stats.hold})</option>
                            <option value="confirmed">📅 Terjadwal ({stats.confirmed})</option>
              <option value="completed">Completed / Selesai ({stats.completed})</option>
              <option value="cancelled">Cancelled / Batal ({stats.cancelled})</option>
            </select>

            <select
              value={filterState.staffId}
              onChange={(e) => setFilterState((prev) => ({ ...prev, staffId: e.target.value }))}
              className="flex-1 px-3 py-2 bg-surface border border-divider rounded-xl text-xs font-bold text-ink focus:outline-none focus:border-accent shadow-xs truncate"
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
            <div className="flex flex-wrap items-center gap-1.5 p-1 bg-fill-1 rounded-2xl border border-transparent dark:border-divider">
              {[
                { key: 'all', label: 'Semua', count: stats.total },
                { key: 'upcoming', label: '📅 Aktif & Mendatang', count: stats.upcoming },
                { key: 'overdue', label: '⚠️ Perlu Verifikasi', count: stats.overdue, isAlert: true },
                { key: 'hold', label: '⏳ Hold (Ditawarkan)', count: stats.hold },
                                { key: 'confirmed', label: '📅 Terjadwal', count: stats.confirmed },
                { key: 'completed', label: 'Completed (Selesai)', count: stats.completed },
                { key: 'cancelled', label: 'Cancelled (Batal)', count: stats.cancelled },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setFilterState((prev) => ({ ...prev, status: tab.key as any }))}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 cursor-pointer ${
                    filterState.status === tab.key
                      ? tab.isAlert
                        ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700/50 shadow-xs'
                        : 'bg-surface text-ink shadow-xs'
                      : 'text-ink-2 hover:text-ink dark:hover:text-ink'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                      filterState.status === tab.key
                        ? tab.isAlert
                          ? 'bg-amber-200 dark:bg-amber-900/80 text-amber-900 dark:text-amber-100 font-bold'
                          : 'bg-accent-soft text-accent'
                        : tab.isAlert && tab.count > 0
                        ? 'bg-amber-200 dark:bg-amber-900/60 text-amber-800 dark:text-warning font-bold animate-pulse'
                        : 'bg-fill-2 text-ink-3'
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
                className="px-3 py-1.5 bg-surface border border-divider rounded-xl text-xs font-bold text-ink focus:outline-none focus:border-accent shadow-xs"
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
                className="w-full pl-9 pr-4 py-2.5 bg-surface border border-divider rounded-xl text-xs text-ink focus:outline-none focus:border-accent shadow-xs"
              />
              <Search size={14} className="absolute left-3 top-3 text-ink-3" />
              {filterState.searchQuery && (
                <button
                  onClick={() => setFilterState((prev) => ({ ...prev, searchQuery: '' }))}
                  className="absolute right-3 top-3 text-ink-3 hover:text-ink"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Blok kalender: full-bleed HANYA di HP (edge-to-edge), desktop tetap kartu.
            Sumber inset = --page-pad dari <main> (Layout.tsx), bukan angka -mx-4
            yang bisa basi bila padding halaman berubah. Kartu filter di atas TIDAK
            ikut full-bleed agar tombol tidak menempel tepi layar. */}
        <div className="-mx-[var(--page-pad)] sm:mx-0">
          {/* View rendering */}
          {viewMode === 'week' && (
            <WeekScheduleGrid
              selectedDate={selectedDate}
              onSelectDate={(d) => setSelectedDate(d)}
              reservations={filteredReservations}
              onSelectReservation={(r) => setSelectedRes(r)}
              onQuickAdd={handleQuickAdd}
              staffList={staffList}
            />
          )}

          {viewMode === 'day' && (
            <DayScheduleGrid
              selectedDate={selectedDate}
              reservations={filteredReservations}
              onSelectReservation={(r) => setSelectedRes(r)}
              onQuickAdd={handleQuickAdd}
              staffList={staffList}
              onPrevDate={handlePrevDate}
              onNextDate={handleNextDate}
              onToday={handleToday}
              onSelectDate={(newDate) => setSelectedDate(newDate)}
            />
          )}

          {viewMode === 'month' && (
            <MonthScheduleGrid
              selectedDate={selectedDate}
              onSelectDate={(d) => {
                setSelectedDate(d);
                handleViewModeChange('day');
              }}
              reservations={filteredReservations}
              onSelectReservation={(r) => setSelectedRes(r)}
              onQuickAdd={handleQuickAdd}
              staffList={staffList}
            />
          )}

        </div>

          {viewMode === 'table' && (
            <div className="space-y-4">
              {/* Bulk Complete Action Bar — muncul saat ada pilihan */}
              {selectedIds.size > 0 && (
                <div className="sticky top-2 z-30 flex items-center justify-between gap-3 px-4 py-2.5 bg-accent text-accent-ink rounded-2xl shadow-lg">
                  <span className="text-xs font-bold">
                    {selectedIds.size} reservasi dipilih
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={clearSelection}
                      disabled={bulkCompleting}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white/15 hover:bg-white/25 transition disabled:opacity-50 cursor-pointer"
                    >
                      Batal
                    </button>
                    <button
                      onClick={handleBulkComplete}
                      disabled={bulkCompleting}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold bg-surface text-accent hover:bg-accent-soft transition disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                    >
                      {bulkCompleting ? <Loader size={13} className="animate-spin" /> : <CheckCheck size={14} />}
                      <span>{bulkCompleting ? 'Memproses...' : 'Tandai Selesai'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Mobile Card List */}
              <div className="block md:hidden space-y-3">
                {/* Mobile Count Bar */}
                <div className="flex items-center justify-between gap-2 px-1">
                  <span className="text-ink-3 font-bold text-xs">
                    {totalReservations > 0
                      ? `Menampilkan ${reservations.length} dari ${totalReservations} Reservasi`
                      : '0 Data Reservasi'}
                  </span>
                  {filteredReservations.length > 0 && (
                    <label className="flex items-center gap-1.5 text-ink-2 font-bold text-xs cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={filteredReservations.every((r) => selectedIds.has(r.id))}
                        ref={(el) => {
                          if (el) {
                            const some = filteredReservations.some((r) => selectedIds.has(r.id));
                            const all = filteredReservations.every((r) => selectedIds.has(r.id));
                            el.indeterminate = some && !all;
                          }
                        }}
                        onChange={toggleSelectAllOnPage}
                        className="h-4 w-4 accent-accent cursor-pointer"
                      />
                      <span>Pilih semua</span>
                    </label>
                  )}
                </div>

                {filteredReservations.length === 0 ? (
                  <div className="bg-surface border border-divider rounded-2xl p-8 text-center text-ink-3 text-xs shadow-xs">
                    Tidak ada data reservasi yang sesuai.
                  </div>
                ) : (
                  filteredReservations.map((res) => (
                    <div
                      key={res.id}
                      onClick={() => setSelectedRes(res)}
                      className="bg-surface rounded-2xl p-4 border border-divider shadow-xs space-y-3 cursor-pointer hover:border-accent hover:shadow-md transition"
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(res.id)}
                            onClick={(e) => toggleSelect(res.id, e)}
                            onChange={() => {}}
                            className="mt-1 h-4 w-4 accent-accent cursor-pointer shrink-0"
                            aria-label={`Pilih reservasi ${res.customer?.name || 'Bunda'}`}
                          />
                          <div>
                            <h4 className="font-bold text-ink text-sm group-hover:text-accent transition">{res.customer?.name || 'Bunda'}</h4>
                            <p className="text-xs text-ink-3 font-mono mt-0.5">{res.customer?.phone}</p>
                            {res.customer && (
                              <div className="flex items-center gap-1.5 mt-1 text-[10px]">
                                <span className="inline-flex items-center px-1.5 py-0.2 rounded-md bg-accent-soft text-accent font-bold">
                                  {(res.customer.totalTreatments ?? 1) > 1 ? `${res.customer.totalTreatments}x Treatment` : 'Pasien Baru (1x)'}
                                </span>
                                {res.customer.ltv !== undefined && (
                                  <span className="text-ink-3 font-mono">
                                    LTV: Rp {res.customer.ltv.toLocaleString('id-ID')}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                        <div>{getStatusBadge(res.status, res.raw_text)}</div>
                      </div>

                      <div className="flex items-center justify-between text-xs pt-1 border-t border-divider">
                        <span className="px-2 py-0.5 rounded bg-fill-1 text-ink-2 font-semibold text-[10px]">
                          {res.treatment_category}
                        </span>
                        <span className="font-bold text-accent bg-accent-soft px-2 py-0.5 rounded border border-divider text-xs">
                          {res.booking_date ? formatBookingDate(res.booking_date, res.treatment_detail) : 'Belum ada jadwal'}
                        </span>
                      </div>

                      {res.treatment_detail && (
                        <p className="text-xs text-ink-2 bg-surface-2 p-2.5 rounded-xl border border-divider line-clamp-2">
                          {res.treatment_detail}
                        </p>
                      )}

                      {(momGestationalBadge(res.mom_gestational_info) || getBabyRows(res).length > 0) && (
                        <div className="flex flex-wrap gap-1.5">
                          {momGestationalBadge(res.mom_gestational_info) && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-danger-soft text-danger border border-danger-line text-[10px] font-bold">
                              {momGestationalBadge(res.mom_gestational_info)}
                            </span>
                          )}
                          {getBabyRows(res).map((b, i) => (
                            <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-accent-soft text-accent border border-divider text-[10px] font-semibold">
                              <Baby size={10} />
                              {b.name}{b.age ? ` · ${b.age}` : ''}
                            </span>
                          ))}
                        </div>
                      )}

                      {(() => {
                        const staffName = resolveStaffName(res, staffList);
                        if (!staffName) return null;
                        return (
                          <div className="text-xs text-accent font-semibold flex items-center space-x-1">
                            <span>Terapis: {staffName}</span>
                          </div>
                        );
                      })()}
                      
                      {Boolean(res.proof_url) && (() => {
                        const proofEval = evaluatePaymentProof(res);
                        return (
                          <div className="pt-1 flex items-center justify-end gap-1.5">
                            {proofEval.isMismatch && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-danger text-on-solid flex items-center gap-1 uppercase tracking-wider">
                                <AlertTriangle size={10} className="shrink-0" />
                                <span>{proofEval.badgeLabel}</span>
                              </span>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setProofModal(res);
                              }}
                              className={`px-2.5 py-1 rounded-xl transition text-[11px] font-semibold flex items-center space-x-1 cursor-pointer border ${
                                proofEval.isMismatch
                                  ? 'bg-danger-soft hover:bg-danger-line text-danger border-danger-line'
                                  : 'bg-accent-soft hover:bg-accent-soft text-accent border-divider'
                              }`}
                              title={`Lihat Bukti Bayar (${getPaymentMethodLabel(res.payment_method)})`}
                            >
                              <Eye size={13} />
                              <span>Bukti Bayar</span>
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  ))
                )}
              </div>

              {/* Desktop Table View */}
              <div className="hidden md:block bg-surface border border-divider rounded-2xl overflow-hidden shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-divider bg-surface-2 text-ink-3 text-xs uppercase tracking-wider font-bold select-none">
                        <th className="py-3.5 pl-5 pr-0 w-8">
                          <input
                            type="checkbox"
                            checked={filteredReservations.length > 0 && filteredReservations.every((r) => selectedIds.has(r.id))}
                            ref={(el) => {
                              if (el) {
                                const some = filteredReservations.some((r) => selectedIds.has(r.id));
                                const all = filteredReservations.every((r) => selectedIds.has(r.id));
                                el.indeterminate = some && !all;
                              }
                            }}
                            onChange={toggleSelectAllOnPage}
                            className="h-4 w-4 accent-accent cursor-pointer align-middle"
                            title="Pilih semua reservasi di halaman ini"
                            aria-label="Pilih semua reservasi di halaman ini"
                          />
                        </th>
                        <th 
                          onClick={() => handleSort('customer')} 
                          className="py-3.5 px-5 cursor-pointer hover:bg-fill-1 transition-colors"
                          title="Klik untuk mengurutkan nama customer"
                        >
                          <div className="flex items-center gap-1.5">
                            <span>Customer</span>
                            {sortField === 'customer' ? (
                              sortOrder === 'asc' ? <ArrowUp size={13} className="text-accent" /> : <ArrowDown size={13} className="text-accent" />
                            ) : (
                              <ArrowUpDown size={12} className="opacity-40" />
                            )}
                          </div>
                        </th>
                        <th 
                          onClick={() => handleSort('category')} 
                          className="py-3.5 px-5 cursor-pointer hover:bg-fill-1 transition-colors"
                          title="Klik untuk mengurutkan kategori layanan"
                        >
                          <div className="flex items-center gap-1.5">
                            <span>Kategori</span>
                            {sortField === 'category' ? (
                              sortOrder === 'asc' ? <ArrowUp size={13} className="text-accent" /> : <ArrowDown size={13} className="text-accent" />
                            ) : (
                              <ArrowUpDown size={12} className="opacity-40" />
                            )}
                          </div>
                        </th>
                        <th className="py-3.5 px-5">Detail Layanan</th>
                        <th 
                          onClick={() => handleSort('booking_date')} 
                          className="py-3.5 px-5 cursor-pointer hover:bg-fill-1 transition-colors"
                          title="Klik untuk mengurutkan jadwal kunjungan"
                        >
                          <div className="flex items-center gap-1.5">
                            <span>Jadwal Kunjungan</span>
                            {sortField === 'booking_date' ? (
                              sortOrder === 'asc' ? <ArrowUp size={13} className="text-accent" /> : <ArrowDown size={13} className="text-accent" />
                            ) : (
                              <ArrowUpDown size={12} className="opacity-40" />
                            )}
                          </div>
                        </th>
                        <th className="py-3.5 px-5">Terapis</th>
                        <th 
                          onClick={() => handleSort('status')} 
                          className="py-3.5 px-5 cursor-pointer hover:bg-fill-1 transition-colors"
                          title="Klik untuk mengurutkan status"
                        >
                          <div className="flex items-center gap-1.5">
                            <span>Status</span>
                            {sortField === 'status' ? (
                              sortOrder === 'asc' ? <ArrowUp size={13} className="text-accent" /> : <ArrowDown size={13} className="text-accent" />
                            ) : (
                              <ArrowUpDown size={12} className="opacity-40" />
                            )}
                          </div>
                        </th>
                        <th className="py-3.5 px-5">Bukti Bayar</th>
                        <th className="py-3.5 px-5 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-divider text-xs text-ink">
                      {filteredReservations.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="py-8 text-center text-ink-3 text-xs">
                            Tidak ada data reservasi yang sesuai.
                          </td>
                        </tr>
                      ) : (
                        filteredReservations.map((res) => (
                          <tr
                            key={res.id}
                            onClick={() => setSelectedRes(res)}
                            className="hover:bg-fill-1 transition-all cursor-pointer group"
                          >
                            <td className="py-3.5 pl-5 pr-0 w-8">
                              <input
                                type="checkbox"
                                checked={selectedIds.has(res.id)}
                                onClick={(e) => toggleSelect(res.id, e)}
                                onChange={() => {}}
                                className="h-4 w-4 accent-accent cursor-pointer align-middle"
                                aria-label={`Pilih reservasi ${res.customer?.name || 'Bunda'}`}
                              />
                            </td>
                            <td className="py-3.5 px-5 font-medium">
                              <p className="font-bold text-ink group-hover:text-accent transition">{res.customer?.name || 'Bunda'}</p>
                              <p className="text-xs text-ink-3 font-mono">{res.customer?.phone}</p>
                              {res.customer && (
                                <div className="flex items-center gap-1.5 mt-0.5 text-[10px]">
                                  <span className="inline-flex items-center px-1.5 py-0.2 rounded-md bg-accent-soft text-accent font-bold">
                                    {(res.customer.totalTreatments ?? 1) > 1 ? `${res.customer.totalTreatments}x` : 'Baru (1x)'}
                                  </span>
                                  {res.customer.ltv !== undefined && (
                                    <span className="text-ink-3 font-mono">
                                      LTV: Rp {res.customer.ltv.toLocaleString('id-ID')}
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="py-3.5 px-5">
                              <span className="px-2 py-0.5 rounded bg-fill-1 text-[11px] text-ink-2 font-semibold">
                                {res.treatment_category}
                              </span>
                            </td>
                            <td className="py-3.5 px-5 max-w-xs truncate text-ink-2" title={res.treatment_detail}>
                              {res.treatment_detail}
                            </td>
                            <td className="py-3.5 px-5 font-semibold text-accent whitespace-nowrap">
                              {res.booking_date ? (
                                formatBookingDate(res.booking_date, res.treatment_detail)
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedRes(res);
                                  }}
                                  className="px-2 py-1 rounded-lg bg-accent-soft border border-divider text-accent hover:bg-accent-soft text-xs font-semibold transition-all cursor-pointer"
                                >
                                  + Atur Jadwal
                                </button>
                              )}
                            </td>
                            <td className="py-3.5 px-5">
                              {(() => {
                                const staffName = resolveStaffName(res, staffList);
                                return staffName ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-accent-soft text-accent border border-divider">
                                    {staffName}
                                  </span>
                                ) : (
                                  <span className="text-xs text-ink-3 italic">Belum ditugaskan</span>
                                );
                              })()}
                            </td>
                            <td className="py-3.5 px-5">{getStatusBadge(res.status, res.raw_text)}</td>
                            <td className="py-3.5 px-5 whitespace-nowrap">
                              {res.proof_url ? (() => {
                                const proofEval = evaluatePaymentProof(res);
                                return (
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setProofModal(res);
                                      }}
                                      className={`p-2 rounded-xl transition-all flex items-center justify-center cursor-pointer border ${
                                        proofEval.isMismatch
                                          ? 'bg-danger-soft hover:bg-danger-line text-danger border-danger-line shadow-2xs'
                                          : 'bg-accent-soft hover:bg-accent-soft text-accent border-divider'
                                      }`}
                                      title={`Lihat Bukti Bayar — ${getPaymentMethodLabel(res.payment_method)}`}
                                    >
                                      <Eye size={15} />
                                    </button>
                                    {proofEval.isMismatch ? (
                                      <span
                                        className="px-2 py-0.5 rounded-md bg-danger-soft text-danger border border-danger-line text-[10px] font-bold flex items-center gap-1 cursor-help"
                                        title={proofEval.description}
                                      >
                                        <AlertTriangle size={11} className="shrink-0" />
                                        <span>Beda: Rp {proofEval.receiptAmount?.toLocaleString('id-ID')}</span>
                                      </span>
                                    ) : res.payment_method ? (
                                      <span className="px-2 py-0.5 rounded bg-fill-1 text-[11px] text-ink-2 font-semibold">
                                        {getPaymentMethodLabel(res.payment_method)}
                                      </span>
                                    ) : null}
                                  </div>
                                );
                              })() : res.payment_method ? (
                                <span className="px-2 py-0.5 rounded bg-fill-1 text-[11px] text-ink-2 font-semibold">
                                  {getPaymentMethodLabel(res.payment_method)}
                                </span>
                              ) : (
                                <span className="text-ink-3 text-xs">-</span>
                              )}
                            </td>
                            <td className="py-3.5 px-5 text-right">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedRes(res);
                                }}
                                className="px-3 py-1.5 bg-surface hover:bg-accent text-ink hover:text-accent-ink border border-divider rounded-xl text-xs transition-all font-semibold shadow-xs cursor-pointer"
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
              <Pagination
                page={page}
                totalPages={totalPages}
                onPageChange={(newPage) => {
                  setPage(newPage);
                  loadReservations(newPage);
                }}
                loading={loading}
                totalItems={totalReservations}
                loadedItems={reservations.length}
              />
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
          onCancel={handleModalCancel}
          onDeletePermanent={handleModalDeletePermanent}
          onOpenChatHistory={handleOpenChatHistory}
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
              className="w-full max-w-md bg-surface border border-divider rounded-3xl p-4 sm:p-5 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto animate-modalScaleUp"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-divider pb-3">
                <h3 className="text-sm font-bold text-ink flex items-center space-x-2">
                  <Receipt size={16} className="text-accent flex-shrink-0" />
                  <span>Bukti Pembayaran</span>
                </h3>
                <button
                  onClick={() => setProofModal(null)}
                  className="p-1.5 rounded-full text-ink-3 hover:text-ink hover:bg-fill-1 transition cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {(() => {
                const modalEval = evaluatePaymentProof(proofModal);
                if (!modalEval.isMismatch) return null;
                return (
                  <div className="p-3 rounded-2xl bg-danger-soft border border-danger-line text-danger space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-danger">
                      <AlertTriangle size={15} className="shrink-0" />
                      <span>Peringatan: Nominal Transfer Tidak Sesuai Tagihan</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-danger-line">
                      <div>
                        <span className="text-[10px] text-danger block uppercase font-bold">Total Tagihan:</span>
                        <strong>Rp {modalEval.totalExpected.toLocaleString('id-ID')}</strong>
                      </div>
                      <div>
                        <span className="text-[10px] text-danger block uppercase font-bold">Nominal di Struk:</span>
                        <strong className="text-danger font-extrabold">Rp {modalEval.receiptAmount?.toLocaleString('id-ID')}</strong>
                      </div>
                    </div>
                    <div className="text-[11px] font-semibold text-danger">
                      Selisih: {modalEval.isUnderpaid ? `Kurang Rp ${Math.abs(modalEval.difference).toLocaleString('id-ID')}` : `Lebih Rp ${modalEval.difference.toLocaleString('id-ID')}`}
                    </div>
                  </div>
                );
              })()}

              <div className="text-xs space-y-1.5 bg-surface-2 border border-divider rounded-2xl p-3.5">
                <div className="flex justify-between">
                  <span className="text-ink-3">Pasien:</span>
                  <span className="font-bold text-ink">
                    {proofModal.customer?.name || 'Bunda'} ({proofModal.customer?.phone})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-3">Metode:</span>
                  <span className="font-bold text-ink">{getPaymentMethodLabel(proofModal.payment_method)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-3">Tagihan Resmi:</span>
                  <span className="font-bold text-ink">
                    {proofModal.purchase_value ? `Rp ${proofModal.purchase_value.toLocaleString('id-ID')}` : '-'}
                  </span>
                </div>
                {proofModal.receipt_amount != null && (
                  <div className="flex justify-between">
                    <span className="text-ink-3">Nominal di Struk:</span>
                    <span className="font-bold text-danger">
                      Rp {proofModal.receipt_amount.toLocaleString('id-ID')}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-1 border-t border-divider">
                  <span className="text-ink-3">Status:</span>
                  {getStatusBadge(proofModal.status, proofModal.raw_text)}
                </div>
              </div>

              <div className="rounded-2xl overflow-hidden border border-divider bg-surface-2">
                <img
                  src={proofModal.proof_url!}
                  alt="Bukti pembayaran"
                  className="w-full max-h-72 object-contain"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-divider">
                <button
                  type="button"
                  onClick={() => setProofModal(null)}
                  className="px-4 py-2 rounded-xl border border-divider text-xs font-semibold text-ink-2 hover:bg-fill-1 transition cursor-pointer"
                >
                  Tutup
                </button>
                <a
                  href={proofModal.proof_url!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 rounded-xl bg-accent hover:bg-accent-hover text-accent-ink text-xs font-bold transition shadow-xs cursor-pointer flex items-center gap-1.5"
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
              className="bg-surface rounded-3xl p-5 max-w-lg w-full space-y-4 shadow-2xl border border-divider relative animate-modalScaleUp"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-divider pb-3">
                <div className="flex items-center space-x-2 text-accent">
                  <Camera size={18} />
                  <h3 className="font-bold text-sm text-ink">Foto Tampak Depan Rumah Pasien</h3>
                </div>
                <button
                  onClick={() => setHousePhotoModal(null)}
                  className="p-1.5 rounded-full text-ink-3 hover:text-ink hover:bg-fill-1 transition cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="rounded-2xl overflow-hidden border border-divider bg-surface-2">
                <img
                  src={housePhotoModal}
                  alt="Foto depan rumah pasien"
                  className="w-full max-h-[70vh] object-contain"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-divider">
                <button
                  type="button"
                  onClick={() => setHousePhotoModal(null)}
                  className="px-4 py-2 rounded-xl border border-divider text-xs font-semibold text-ink-2 hover:bg-fill-1 transition cursor-pointer"
                >
                  Tutup
                </button>
                <a
                  href={housePhotoModal}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 rounded-xl bg-accent hover:bg-accent-hover text-accent-ink text-xs font-bold transition shadow-xs cursor-pointer flex items-center gap-1.5"
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
            data-modal-active="true"
            className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fadeIn h-[100dvh] w-[100dvw]"
            onClick={() => setEditLocationModal(null)}
          >
            <div
              className="bg-surface rounded-3xl p-5 sm:p-6 max-w-md w-full space-y-4 shadow-2xl border border-divider relative max-h-[92vh] overflow-y-auto animate-modalScaleUp"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-start justify-between border-b border-divider pb-3">
                <div className="flex items-center space-x-2.5">
                  <div className="h-10 w-10 rounded-2xl bg-accent-soft text-accent flex items-center justify-center border border-divider shadow-xs">
                    <MapPin size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-ink">Edit Panduan Lokasi & Foto Rumah</h3>
                    <p className="text-xs text-ink-3 truncate max-w-[220px]">
                      {editLocationModal.customer?.name || 'Bunda'} ({editLocationModal.customer?.phone})
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setEditLocationModal(null)}
                  className="p-1.5 rounded-full text-ink-3 hover:text-ink hover:bg-fill-1 transition cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Info Alamat Pasien */}
              <div className="p-3 rounded-2xl bg-surface-2 border border-divider text-xs text-ink-2 space-y-1">
                <span className="text-[10px] font-bold text-ink-3 uppercase tracking-wider block">
                  Alamat Pasien:
                </span>
                <p className="text-xs text-ink font-medium leading-snug">
                  {editLocationModal.customer?.kelurahan
                    ? `${editLocationModal.customer.kelurahan}, ${editLocationModal.customer.kecamatan}, ${editLocationModal.customer.kota}`
                    : 'Alamat belum tercatat lengkap'}
                </p>
              </div>

              {/* Bagian 1: Foto Depan Rumah */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-ink">
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
                  <div className="relative rounded-2xl overflow-hidden border border-divider bg-black/5 flex items-center justify-center max-h-48">
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
                        className="p-1.5 rounded-full bg-danger text-on-solid hover:bg-danger-hover transition shadow-xs cursor-pointer"
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
                    className="w-full py-4 border-2 border-dashed border-divider hover:border-accent rounded-2xl flex flex-col items-center justify-center text-xs text-ink-3 hover:text-accent transition bg-surface-2 cursor-pointer"
                  >
                    <Upload size={20} className="mb-1 text-accent" />
                    <span className="font-semibold text-ink">Unggah Foto Depan Rumah</span>
                    <span className="text-[10px] text-ink-3">Pilih gambar dari komputer / galeri (maks 12 MB)</span>
                  </button>
                )}
              </div>

              {/* Bagian 2: Catatan Patokan */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-ink">
                  2. Catatan Patokan / Ancer-ancer Rumah:
                </label>
                <textarea
                  rows={2}
                  value={editLandmark}
                  onChange={(e) => setEditLandmark(e.target.value)}
                  placeholder="Contoh: Pagar hitam gerbang kayu, seberang masjid, samping toko berkah"
                  className="w-full px-3.5 py-2.5 bg-surface border border-divider rounded-xl text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent transition shadow-xs resize-none"
                />
              </div>

              {/* Bagian 3: Smart Koordinat GPS Rumah Pasien */}
              <div className="space-y-3 bg-surface-2 -mx-4 p-4 rounded-2xl border border-divider">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-ink flex items-center space-x-1.5">
                    <Crosshair size={13} className="text-accent" />
                    <span>3. Titik Lokasi GPS Rumah Pasien:</span>
                  </label>
                  {editLat && editLng && (
                    <a
                      href={getGoogleMapsDirectionUrl(parseFloat(editLat), parseFloat(editLng), editLandmark || null)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-bold text-accent hover:underline inline-flex items-center gap-1"
                    >
                      <span>Lihat Maps</span>
                      <ExternalLink size={11} />
                    </a>
                  )}
                </div>

                {/* Assistant 1: Tempel Link Maps */}
                <div className="space-y-1">
                  <label className="block text-[10px] font-semibold text-ink-2 flex items-center gap-1">
                    <Link2 size={11} className="text-accent" />
                    <span>Tempel Link Shareloc / Google Maps Pasien:</span>
                  </label>
                  <div className="flex space-x-1.5">
                    <input
                      type="text"
                      value={editMapsUrlInput}
                      onChange={(e) => handlePasteEditMapsUrl(e.target.value)}
                      placeholder="Paste link Google Maps / shareloc di sini..."
                      className="flex-1 px-3 py-2 bg-surface border border-divider rounded-xl text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent shadow-2xs"
                    />
                    <button
                      type="button"
                      onClick={() => handlePasteEditMapsUrl(editMapsUrlInput)}
                      disabled={editMapsResolving || !editMapsUrlInput.trim()}
                      className="px-3 py-2 bg-surface hover:bg-accent-soft border border-divider text-accent rounded-xl text-xs font-bold transition flex items-center gap-1 shadow-2xs disabled:opacity-50 cursor-pointer"
                      title="Cari koordinat dari tautan"
                    >
                      {editMapsResolving ? <Loader size={12} className="animate-spin" /> : <Search size={12} />}
                      <span>Cek</span>
                    </button>
                  </div>
                  {editMapsResolving && (
                    <p className="text-[11px] text-accent flex items-center gap-1.5 animate-pulse mt-1">
                      <Loader size={12} className="animate-spin" />
                      <span>Sedang mengurai tautan Google Maps...</span>
                    </p>
                  )}
                </div>

                {/* Assistant 2: Tombol Cepat GPS & Geocode */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleLockEditGps}
                    disabled={editGettingGps}
                    className="py-2.5 px-3 rounded-xl bg-success-soft hover:bg-success-line text-accent border border-success-line text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer shadow-2xs active:scale-[0.98]"
                  >
                    <Crosshair size={13} className={editGettingGps ? 'animate-spin' : ''} />
                    <span>{editGettingGps ? 'Mengunci...' : '📍 Kunci GPS Saya'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleGeocodeEditAddress}
                    disabled={editGeocoding}
                    className="py-2.5 px-3 rounded-xl bg-info-soft hover:bg-info-line text-info border border-info-line text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer shadow-2xs active:scale-[0.98]"
                  >
                    <Search size={13} className={editGeocoding ? 'animate-spin' : ''} />
                    <span>{editGeocoding ? 'Mencari...' : '🔍 Cari dari Alamat'}</span>
                  </button>
                </div>

                {/* Coordinate Status Badge */}
                {editLat && editLng ? (
                  <div className="p-2.5 bg-bubble-out/70 border border-accent/40 rounded-xl flex items-center justify-between text-xs text-accent">
                    <div className="flex items-center space-x-1.5 font-mono font-bold">
                      <CheckCircle2 size={14} className="text-accent shrink-0" />
                      <span>Titik: {parseFloat(editLat).toFixed(6)}, {parseFloat(editLng).toFixed(6)}</span>
                      {editGpsAccuracy && <span className="text-[10px] text-ink-2">(±{editGpsAccuracy}m)</span>}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditLat('');
                        setEditLng('');
                      }}
                      className="text-[10px] text-danger hover:underline font-semibold"
                    >
                      Hapus
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] text-ink-3 italic">
                    Belum ada titik koordinat. Gunakan tombol di atas atau tempel link Maps.
                  </p>
                )}

                {/* Collapsible Manual Coordinates */}
                <div>
                  <button
                    type="button"
                    onClick={() => setEditShowManualCoords(!editShowManualCoords)}
                    className="text-[11px] text-ink-2 hover:text-ink font-semibold flex items-center gap-1 transition"
                  >
                    <span>{editShowManualCoords ? 'Sembunyikan Input Manual' : 'Input Koordinat Manual (Angka)'}</span>
                    {editShowManualCoords ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>

                  {editShowManualCoords && (
                    <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-divider">
                      <div className="space-y-1">
                        <label className="block text-[10px] text-ink-3">Latitude</label>
                        <input
                          type="text"
                          value={editLat}
                          onChange={(e) => setEditLat(e.target.value)}
                          placeholder="-7.3488"
                          className="w-full px-3 py-2 bg-surface border border-divider rounded-xl text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent transition"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="block text-[10px] text-ink-3">Longitude</label>
                        <input
                          type="text"
                          value={editLng}
                          onChange={(e) => setEditLng(e.target.value)}
                          placeholder="112.7516"
                          className="w-full px-3 py-2 bg-surface border border-divider rounded-xl text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent transition"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex justify-end space-x-2 pt-3 border-t border-divider">
                <button
                  type="button"
                  onClick={() => setEditLocationModal(null)}
                  disabled={submittingLocation}
                  className="px-4 py-2.5 rounded-xl border border-divider text-xs font-semibold text-ink-2 hover:bg-fill-1 transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleSaveEditLocation}
                  disabled={submittingLocation}
                  className="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-accent-ink text-xs font-bold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
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

      {/* Chat History Stream Modal (terpusat — Anti-Bloat) */}
      <ChatHistoryModal
        isOpen={!!activeHistoryCustomer}
        customer={activeHistoryCustomer}
        zIndex={10000}
        onClose={() => setActiveHistoryCustomer(null)}
      />

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
        onEditReservation={(res: any) => {
          setShowCreateModal(false);
          setQuickSlotTarget(null);
          if (res?.id) setSelectedRes(res);
        }}
      />
    </div>
  );
};
