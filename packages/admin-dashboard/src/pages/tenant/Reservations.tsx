// Catatan kontrak error: catch kosong di halaman ini adalah hitungan arsip
// dan daftar staf untuk filter/dropdown. Tabel reservasi utama punya
// penanganan galat sendiri; kegagalan pelengkap tidak boleh mengosongkan layar.
import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { apiRequest, getCachedApiResponse } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import { Reservation } from '../../types';
import { evaluatePaymentProof } from '../../utils/paymentProof';
import { getWibDateKey, getTodayWibDate } from '../../utils/dateWib';
import { buildReservationsQuery } from '../../utils/reservationQuery';
import { getWeekDateRange } from '../../utils/calendarWeekRange';
import { VIEW_MODE_OPTIONS, nextStatusForView } from '../../utils/calendarViewMode';
import { extractDurationMinutes } from '../../utils/durationCalculator';
import { Pagination } from '../../components/common/Pagination';
import { PaymentProofModal } from './PaymentProofModal';
import { ReservationsHeader } from './ReservationsHeader';
import { ReservationsFilters } from './ReservationsFilters';
import { 
  Search, 
  User, 
  Baby, 
  MapPin, 
  Check, 
  X, 
  Info, 
  FileText, 
  AlertTriangle, 
  Upload,
  Maximize2,
  Navigation,
  Compass,
  Camera,
  PenLine,
  CheckCircle,
  CheckCheck,
  Clock,
  MessageSquare,
  Loader,
  RotateCcw,
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
import { formatBookingDate, getPaymentMethodLabel, getStatusBadge } from './reservationsUi';
import { ReservationTable } from './ReservationTable';
import { ReservationMobileList } from './ReservationMobileList';
import { ReservationLocationModal } from './ReservationLocationModal';
import { ReservationDetailModal } from '../../components/modals/ReservationDetailModal';
import { ChatHistoryModal } from '../../components/modals/ChatHistoryModal';
import { Modal } from '../../components/ui/Modal';
import { ErrorState } from '../../components/ui/StateViews';
import { useAuth } from '../../contexts/AuthContext';
import { formatWib, formatWibClock } from '../../utils/dateWib';

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

// URL bisa dibagikan atau diketik manual, jadi nilai filter divalidasi dulu
// terhadap daftar yang dikenal. Tanpa ini `?status=abc` akan lolos sebagai
// state di luar tipe dan menyaring tabel dengan nilai yang tak dikenal.
const FILTER_CATEGORIES: CalendarFilterState['category'][] = ['all', 'BABY', 'MOMS', 'KIDS', 'BOTH', 'BUNDLE'];
const FILTER_STATUSES: CalendarFilterState['status'][] = [
  'all', 'upcoming', 'overdue', 'pending', 'confirmed', 'completed', 'cancelled', 'hold', 'archive',
];

function readFilterCategory(raw: string | null): CalendarFilterState['category'] {
  const value = raw as CalendarFilterState['category'];
  return FILTER_CATEGORIES.includes(value) ? value : 'all';
}

function readFilterStatus(
  raw: string | null,
  fallback: CalendarFilterState['status']
): CalendarFilterState['status'] {
  const value = raw as CalendarFilterState['status'];
  return FILTER_STATUSES.includes(value) ? value : fallback;
}

export const Reservations: React.FC = () => {
  const { user } = useAuth();
  const { toast, confirm } = useUiFeedback();
  const cachedRes = getCachedApiResponse<any>(`/api/admin/reservations?page=1&pageSize=20`);
  const initialReservations = Array.isArray(cachedRes) ? cachedRes : (cachedRes?.data || []);
  const [loading, setLoading] = useState(initialReservations.length === 0);
  // Kegagalan muat daftar tidak boleh hanya muncul sebagai toast: staf perlu
  // melihat statusnya di halaman dan bisa mencoba lagi tanpa reload penuh.
  const [loadError, setLoadError] = useState<string | null>(null);
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
  const [filterState, setFilterStateRaw] = useState<CalendarFilterState>({
    searchQuery: '',
    category: 'all',
    staffId: 'all',
    // Deep link `?date=...` langsung membuka view kalender. Status default
    // 'upcoming' akan menyembunyikan reservasi tanggal lampau (API memotong
    // `booking_date >= now-3j`), sehingga grid tampak kosong padahal ada data.
    status: deepLinkDate ? 'all' : 'upcoming',
  });

  // Filter disimpan di URL (bukan hanya state lokal) supaya refresh dan tombol
  // Back mempertahankan filter, dan tautan bisa dibagikan. Nilai bawaan tidak
  // ditulis ke URL agar tautan tetap bersih; penulisan memakai `replace` agar
  // mengetik di kolom cari tidak menumpuk riwayat per karakter.
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultFilterStatus: CalendarFilterState['status'] = deepLinkDate ? 'all' : 'upcoming';

  useEffect(() => {
    setFilterStateRaw({
      searchQuery: searchParams.get('q') ?? '',
      category: readFilterCategory(searchParams.get('category')),
      staffId: searchParams.get('staff') ?? 'all',
      status: readFilterStatus(searchParams.get('status'), defaultFilterStatus),
    });
  }, [searchParams, defaultFilterStatus]);

  const setFilterState = useCallback(
    (updater: React.SetStateAction<CalendarFilterState>) => {
      setSearchParams(
        (prev) => {
          const current: CalendarFilterState = {
            searchQuery: prev.get('q') ?? '',
            category: readFilterCategory(prev.get('category')),
            staffId: prev.get('staff') ?? 'all',
            status: readFilterStatus(prev.get('status'), defaultFilterStatus),
          };
          const next = typeof updater === 'function' ? updater(current) : updater;
          const params = new URLSearchParams(prev);
          const write = (key: string, value: string, fallback: string) => {
            if (!value || value === fallback) params.delete(key);
            else params.set(key, value);
          };
          write('q', next.searchQuery, '');
          write('category', next.category, 'all');
          write('staff', next.staffId, 'all');
          write('status', next.status, defaultFilterStatus);
          return params;
        },
        { replace: true }
      );
    },
    [setSearchParams, defaultFilterStatus]
  );

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

  const [archiveCount, setArchiveCount] = useState<number>(0);

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
    apiRequest('/api/admin/reservation/archive?limit=1')
      .then((r) => { if (typeof r?.total === 'number') setArchiveCount(r.total); })
      .catch(() => {});
  }, []);

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
        setLoadError(null);
        if (filterState.status === 'archive') {
          const searchParam = filterState.searchQuery ? `&search=${encodeURIComponent(filterState.searchQuery)}` : '';
          const res = await apiRequest(`/api/admin/reservation/archive?limit=${PAGE_SIZE}&offset=${(targetPage - 1) * PAGE_SIZE}${searchParam}`);
          const items = Array.isArray(res?.items) ? res.items : [];
          const mapped = items.map((arch: any) => ({
            id: arch.reservation_id || arch.id,
            archive_id: arch.id,
            customer_id: arch.customer_id,
            booking_date: arch.booking_date,
            status: 'archive' as any,
            original_status: arch.status,
            treatment_detail: arch.treatment_detail,
            purchase_value: arch.purchase_value,
            archived_at: arch.archived_at,
            restore_until: arch.restore_until,
            reason: arch.reason,
            customer: {
              id: arch.customer_id,
              name: arch.customer_name || 'Pelanggan',
              phone: arch.customer_phone || '-',
            },
          }));
          setReservations(mapped as any);
          setTotalReservations(res?.total || 0);
          setArchiveCount(res?.total || 0);
          setTotalPages(Math.ceil((res?.total || 1) / PAGE_SIZE) || 1);
          setPage(targetPage);
          return;
        }
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
        setLoadError(err instanceof Error ? err.message : 'Gagal memuat daftar reservasi.');
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
    // Multi-rumah: panduan lokasi milik KARTU yang tertaut jadwal, bukan profil root.
    const cardId = (res as any).customer_address_id;
    const card = (Array.isArray(prefs?.saved_addresses) ? prefs.saved_addresses : [])
      .find((a: any) => a?.id === cardId) || null;
    setEditHousePhotoB64(prefs?.house_photo_url || null);
    setEditRawHousePhotoB64(null);
    setEditLandmark(card?.landmark || prefs?.landmark || '');
    const baseLat = card ? card.lat : res.customer?.lat;
    const baseLng = card ? card.lng : res.customer?.lng;
    setEditLat(baseLat != null ? String(baseLat) : '');
    setEditLng(baseLng != null ? String(baseLng) : '');
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
      toast('Foto rumah berhasil dimuat & dikompres instan!', 'success');
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
      toast(`Titik GPS berhasil dikunci (Akurasi: ±${loc.accuracy}m)!`, 'success');
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
        toast(`Titik koordinat ditemukan untuk ${cust?.kelurahan || cust?.kecamatan}!`, 'success');
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
          // Wajib: tanpa ini landmark/GPS rumah kedua menimpa profil root.
          customerAddressId: (editLocationModal as any).customer_address_id || undefined,
        }),
      });

      if (res && res.success && res.data) {
        toast('Panduan lokasi & foto rumah berhasil disimpan!', 'success');
        const updatedCust = res.data;

        // Update selectedRes if active
        setSelectedRes((prev) => {
          if (!prev || prev.customer_id !== editLocationModal.customer_id) return prev;
          return {
            ...prev,
            ...(updatedCust.card ? { customer_address: updatedCust.card, customer_address_id: updatedCust.card.id } : {}),
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
  const headerDateTitle = formatWib(selectedDate, {
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });

  return (
    <div className="space-y-5">
      {loadError && (
        <div className="bg-surface border border-divider rounded-2xl shadow-xs">
          <ErrorState
            title="Daftar reservasi gagal dimuat"
            description={loadError}
            onRetry={() => void loadReservations(1)}
          />
        </div>
      )}
      {/* Top Header Bar */}
      <ReservationsHeader
        title={headerDateTitle}
        viewMode={viewMode}
        selectedDate={selectedDate}
        loading={loading}
        onPrev={handlePrevDate}
        onNext={handleNextDate}
        onToday={handleToday}
        onDateChange={setSelectedDate}
        onViewModeChange={handleViewModeChange}
        onCreate={() => {
          setQuickSlotTarget(null);
          setShowCreateModal(true);
        }}
        onRefresh={() => {
          setLoading(true);
          loadReservations();
        }}
      />

      {/* Main Calendar Pane (pure calendar) */}
      <div className="space-y-4">
        {/* Status Filter Tabs & Search bar */}
        <ReservationsFilters
          viewMode={viewMode}
          status={filterState.status}
          staffId={filterState.staffId}
          searchQuery={filterState.searchQuery}
          stats={stats}
          archiveCount={archiveCount}
          staffList={staffList}
          onStatusChange={(status) => setFilterState((prev) => ({ ...prev, status }))}
          onStaffChange={(staffId) => setFilterState((prev) => ({ ...prev, staffId }))}
          onSearchChange={(searchQuery) => setFilterState((prev) => ({ ...prev, searchQuery }))}
        />

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
              <ReservationMobileList
                reservations={filteredReservations}
                totalReservations={totalReservations}
                staffList={staffList}
                selectedIds={selectedIds}
                onSelect={setSelectedRes}
                onShowProof={setProofModal}
                onToggleSelect={toggleSelect}
                onToggleAll={toggleSelectAllOnPage}
              />

              {/* Desktop Table View */}
              <ReservationTable
                reservations={filteredReservations}
                staffList={staffList}
                selectedIds={selectedIds}
                sortField={sortField}
                sortOrder={sortOrder}
                onSelect={setSelectedRes}
                onShowProof={setProofModal}
                onToggleSelect={toggleSelect}
                onToggleAll={toggleSelectAllOnPage}
                onSort={handleSort}
              />

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
      {proofModal && (
        <PaymentProofModal
          proof={proofModal}
          paymentMethodLabel={getPaymentMethodLabel(proofModal.payment_method)}
          statusBadge={getStatusBadge(proofModal.status, proofModal.raw_text)}
          onClose={() => setProofModal(null)}
        />
      )}

      {/* House Front Photo Lightbox Modal */}
      {housePhotoModal &&
        createPortal(
          <div
            className="modal-backdrop fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 animate-fadeIn h-[100dvh] w-[100dvw]"
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
      {editLocationModal && (
        <ReservationLocationModal
          task={editLocationModal}
          lat={editLat}
          lng={editLng}
          landmark={editLandmark}
          housePhotoB64={editHousePhotoB64}
          removePhoto={editRemovePhoto}
          showManualCoords={editShowManualCoords}
          gettingGps={editGettingGps}
          geocoding={editGeocoding}
          mapsResolving={editMapsResolving}
          mapsUrlInput={editMapsUrlInput}
          gpsAccuracy={editGpsAccuracy}
          saving={submittingLocation}
          onClose={() => setEditLocationModal(null)}
          onGetGps={handleLockEditGps}
          onPasteMapsUrl={handlePasteEditMapsUrl}
          onGeocodeAddress={handleGeocodeEditAddress}
          onPickPhoto={handlePickAdminHousePhoto}
          onSave={handleSaveEditLocation}
          onLatChange={setEditLat}
          onLngChange={setEditLng}
          onLandmarkChange={setEditLandmark}
          onPhotoChange={setEditHousePhotoB64}
          onRemovePhotoChange={setEditRemovePhoto}
          onToggleManual={() => setEditShowManualCoords((v) => !v)}
        />
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
