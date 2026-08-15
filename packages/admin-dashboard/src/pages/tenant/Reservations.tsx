import React, { useEffect, useState, useMemo } from 'react';
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
  Filter,
  Receipt,
} from 'lucide-react';
import { CalendarViewMode, CalendarFilterState, QuickSlotTarget, StaffOption } from '../../components/calendar/types';
import { CalendarSidebar } from '../../components/calendar/CalendarSidebar';
import { WeekScheduleGrid } from '../../components/calendar/WeekScheduleGrid';
import { DayScheduleGrid } from '../../components/calendar/DayScheduleGrid';
import { MonthScheduleGrid } from '../../components/calendar/MonthScheduleGrid';
import { CreateReservationModal } from '../../components/calendar/CreateReservationModal';

export const Reservations: React.FC = () => {
  const { toast, confirm } = useUiFeedback();
  const [loading, setLoading] = useState(true);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selectedRes, setSelectedRes] = useState<Reservation | null>(null);
  const [proofModal, setProofModal] = useState<Reservation | null>(null);

  // Calendar View State
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [viewMode, setViewMode] = useState<CalendarViewMode>('table');
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
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

  // Header month/year display
  const headerDateTitle = selectedDate.toLocaleDateString('id-ID', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="space-y-5">
      {/* Top Header Bar */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-white p-4 sm:p-5 rounded-2xl border border-[#e9edef] shadow-xs">
        {/* Title & Month Navigation */}
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-[#111b21] capitalize">
              {headerDateTitle}
            </h2>
            <p className="text-xs text-[#667781] mt-0.5">
              Jadwal reservasi & kunjungan terapis klinik
            </p>
          </div>

          {/* Date Navigation group (hanya untuk mode kalender; tabel menampilkan semua data) */}
          {viewMode !== 'table' && (
          <div className="flex items-center space-x-1.5 ml-0 sm:ml-4 bg-[#f0f2f5] p-1 rounded-xl">
            <button
              onClick={handlePrevDate}
              className="p-1.5 rounded-lg bg-white hover:bg-gray-100 text-[#111b21] shadow-xs transition-colors"
              title="Sebelumnya"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={handleToday}
              className="px-3 py-1 rounded-lg bg-white hover:bg-gray-100 text-xs font-bold text-[#111b21] shadow-xs transition-colors"
            >
              Hari Ini
            </button>
            <button
              onClick={handleNextDate}
              className="p-1.5 rounded-lg bg-white hover:bg-gray-100 text-[#111b21] shadow-xs transition-colors"
              title="Berikutnya"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          )}
        </div>

        {/* View mode switcher & Actions */}
        <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto justify-between lg:justify-end">
          {/* View Switcher Tabs */}
          <div className="flex space-x-1 p-1 bg-[#f0f2f5] rounded-xl shadow-inner text-xs">
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
            {/* Mobile Filter Toggle */}
            <button
              onClick={() => setShowMobileSidebar(!showMobileSidebar)}
              className={`lg:hidden flex items-center space-x-1.5 px-3 py-2 border rounded-xl text-xs font-semibold transition shadow-xs ${
                showMobileSidebar
                  ? 'bg-[#e8f5f2] text-[#008069] border-[#c2e7e0]'
                  : 'bg-white text-[#111b21] border-[#d1d7db] hover:bg-[#f0f2f5]'
              }`}
              title="Toggle Filter & Spotlight"
            >
              <Filter size={14} />
              <span>{showMobileSidebar ? 'Tutup Filter' : 'Filter'}</span>
            </button>

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

      {/* Main Dual-Pane Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5 items-start">
        {/* Left Column: Sidebar Widgets (Collapsible on mobile) */}
        <div className={`${showMobileSidebar ? 'block' : 'hidden'} lg:block w-full`}>
          <CalendarSidebar
            reservations={reservations}
            filterState={filterState}
            onFilterChange={setFilterState}
            staffList={staffList}
            onSelectReservation={(r) => setSelectedRes(r)}
          />
        </div>

        {/* Right Column: Calendar / Schedule Views */}
        <div className="space-y-4 min-w-0">
          {/* Search bar inside view */}
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
              onSelectDate={(d) => setSelectedDate(d)}
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
                            className="px-3 py-1.5 bg-[#e8f5f2] hover:bg-[#c2e7e0] text-[#008069] border border-[#c2e7e0] rounded-xl transition-all font-semibold text-xs flex items-center space-x-1"
                          >
                            <Receipt size={12} />
                            <span>Cek Bukti Bayar</span>
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
                                  className="px-2.5 py-1.5 bg-[#e8f5f2] hover:bg-[#c2e7e0] text-[#008069] border border-[#c2e7e0] rounded-xl text-xs font-semibold transition-all flex items-center space-x-1"
                                  title={`Metode: ${getPaymentMethodLabel(res.payment_method)}`}
                                >
                                  <Receipt size={12} />
                                  <span>Cek Bukti Bayar</span>
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
      </div>

      {/* Reservation Details & Management Modal */}
      {selectedRes && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="w-full max-w-2xl bg-white border border-[#e9edef] rounded-2xl p-4 sm:p-6 space-y-4 sm:space-y-5 shadow-xl relative max-h-[90vh] overflow-y-auto">
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

                <div className="p-3.5 rounded-xl bg-[#f8fafc] border border-[#e9edef] space-y-2">
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
                    <span>Haversine Multiplier</span>
                    <span className="font-bold">Active (1.25x)</span>
                  </div>
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
                  <span className="text-[11px] text-[#667781] font-bold block uppercase">Penugasan Staff / Terapis</span>
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
            <div className="pt-3.5 border-t border-[#e9edef] flex flex-col-reverse sm:flex-row gap-2 sm:gap-0 justify-between">
              <button
                onClick={() => handleDelete(selectedRes.id)}
                className="w-full sm:w-auto justify-center px-4 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 transition text-xs font-semibold flex items-center space-x-1.5"
              >
                <X size={14} />
                <span>Batalkan Reservasi</span>
              </button>

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
      />
    </div>
  );
};
