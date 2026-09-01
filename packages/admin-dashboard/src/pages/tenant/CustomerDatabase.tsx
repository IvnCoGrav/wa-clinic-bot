import React, { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest, getCachedApiResponse } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import { Pagination } from '../../components/common/Pagination';
import { CustomerEditForm } from '../../components/modals/CustomerEditForm';
import { ReservationDetailModal } from '../../components/modals/ReservationDetailModal';
import {
  Users,
  Search,
  MessageSquare,
  Send,
  Loader,
  RefreshCw,
  X,
  Zap,
  Phone,
  Copy,
  Check,
  Tag,
  DollarSign,
  ShoppingBag,
  AlertCircle,
  Clock,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Eye,
  Info,
  Calendar,
  MapPin,
  Baby,
  Home,
  ExternalLink,
  UserCheck,
  ShieldCheck,
  FileText,
  Navigation,
  PenLine,
  ChevronRight,
} from 'lucide-react';

interface CustomerItem {
  id: string;
  phone: string;
  name: string | null;
  status: string;
  isMql: boolean;
  mqlBubbleCount: number;
  mqlTriggeredAt: string | null;
  trackingCode?: string;
  adClick?: any;
  ltv: number;
  reservationCount: number;
  createdAt: string;
  updatedAt: string;
  isAdminLabeled?: boolean;
  isHoldLabeled?: boolean;
  kecamatan?: string | null;
  kota?: string | null;
  kelurahan?: string | null;
  distanceKm?: number | null;
  ongkir?: number | null;
}

interface ChatMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  content: string;
  sender_type?: string | null;
  sender_name?: string | null;
  created_at: string;
}

export const CustomerDatabase: React.FC = () => {
  const { toast, confirm } = useUiFeedback();
  const cachedCustRes = getCachedApiResponse<any>('/api/admin/customers?page=1&pageSize=15&sortBy=created_at&sortOrder=desc');
  const initialCustomers = Array.isArray(cachedCustRes) ? cachedCustRes : (cachedCustRes?.data || []);
  const [loading, setLoading] = useState(initialCustomers.length === 0);
  const [customers, setCustomers] = useState<CustomerItem[]>(() => initialCustomers);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [segment, setSegment] = useState<'all' | 'purchased' | 'mql' | 'prospect'>('all');
  const [stats, setStats] = useState<{
    totalCustomers: number;
    totalPurchasers: number;
    totalMql: number;
    totalProspects: number;
    totalRevenue: number;
  }>({
    totalCustomers: 0,
    totalPurchasers: 0,
    totalMql: 0,
    totalProspects: 0,
    totalRevenue: 0,
  });
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Retry & Error State (Phase 2)
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // Sorting State
  const [sortBy, setSortBy] = useState<string>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Customer Detail Modal State
  const [activeDetailCustomer, setActiveDetailCustomer] = useState<CustomerItem | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailData, setDetailData] = useState<any | null>(null);
  const [detailEditMode, setDetailEditMode] = useState(false);
  // Reservation detail dari riwayat (klik row/card)
  const [selectedReservation, setSelectedReservation] = useState<any>(null);
  const [reservationStaffList, setReservationStaffList] = useState<any[]>([]);

  // Chat History Modal State
  const [activeHistoryCustomer, setActiveHistoryCustomer] = useState<CustomerItem | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyMessages, setHistoryMessages] = useState<ChatMessage[]>([]);
  const historyContainerRef = useRef<HTMLDivElement>(null);
  const historyMessagesEndRef = useRef<HTMLDivElement>(null);

  const scrollHistoryToBottom = useCallback((smooth = false) => {
    const doScroll = () => {
      if (historyContainerRef.current) {
        historyContainerRef.current.scrollTop = historyContainerRef.current.scrollHeight + 99999;
      }
      if (historyMessagesEndRef.current) {
        historyMessagesEndRef.current.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' });
      }
    };
    doScroll();
    requestAnimationFrame(doScroll);
    setTimeout(doScroll, 30);
    setTimeout(doScroll, 100);
    setTimeout(doScroll, 250);
  }, []);

  useEffect(() => {
    if (activeHistoryCustomer && historyMessages.length > 0 && !loadingHistory) {
      scrollHistoryToBottom(false);
    }
  }, [activeHistoryCustomer, historyMessages, loadingHistory, scrollHistoryToBottom]);

  // Send Event Modal State
  const [activeEventCustomer, setActiveEventCustomer] = useState<CustomerItem | null>(null);
  const [selectedEvent, setSelectedEvent] = useState('Lead');
  const [eventValue, setEventValue] = useState<number | ''>('');
  const [eventCurrency, setEventCurrency] = useState('IDR');
  const [sendingEvent, setSendingEvent] = useState(false);

  // Search debounce ref (Phase 1)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const loadCustomers = async () => {
    if (customers.length === 0) setLoading(true);
    setLoadError(null);
    try {
      const query = new URLSearchParams({
        page: String(page),
        pageSize: '15',
        sortBy,
        sortOrder,
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(segment !== 'all' ? { segment } : {}),
      });

      const res = await apiRequest(`/api/admin/customers?${query.toString()}`, { timeoutMs: 20000 });
      if (res && res.success) {
        setCustomers(res.customers || []);
        setTotalPages(res.totalPages || 1);
        setTotalCount(res.total || 0);
      }
    } catch (err: any) {
      setLoadError(err.message);
      toast(`Gagal memuat database customer: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, [page, segment, sortBy, sortOrder, retryCount]);

  // Search debounce: trigger 300ms after user stops typing
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [search]);

  // Re-fetch when debouncedSearch changes (not covered by retryCount effect)
  useEffect(() => {
    loadCustomers();
  }, [debouncedSearch]);

  // Phase 3: Stats fetched independently, stale-while-revalidate 60s
  useEffect(() => {
    let cancelled = false;
    const loadStats = async () => {
      try {
        const res = await apiRequest('/api/admin/customers/stats', { timeoutMs: 15000 });
        if (!cancelled && res?.success && res.stats) {
          setStats(res.stats);
        }
      } catch {}
    };
    loadStats();
    return () => { cancelled = true; };
  }, []);

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
    setPage(1);
  };

  const handleOpenDetail = async (customer: CustomerItem) => {
    setActiveDetailCustomer(customer);
    setLoadingDetail(true);
    setDetailData(null);
    try {
      const res = await apiRequest(`/api/admin/customers/${customer.id}`);
      if (res && res.success) {
        setDetailData(res.data);
      } else {
        toast(res?.error || 'Gagal memuat detail data customer', 'error');
      }
    } catch (err: any) {
      toast(`Gagal memuat detail customer: ${err.message}`, 'error');
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleSaveCustomerDetail = async (data: any) => {
    if (!activeDetailCustomer) return;
    try {
      await apiRequest(`/api/admin/customers/${activeDetailCustomer.id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      // Refresh detail data
      const res = await apiRequest(`/api/admin/customers/${activeDetailCustomer.id}`);
      if (res?.data) {
        setDetailData({ ...res.data, labels: detailData?.labels || [] });
      }
      setDetailEditMode(false);
      toast('Profil customer berhasil diperbarui!', 'success');
    } catch (err: any) {
      toast(`Gagal menyimpan: ${err.message}`, 'error');
    }
  };

  const handleOpenReservationDetail = async (reservationId: string) => {
    try {
      const res = await apiRequest(`/api/admin/reservation/${reservationId}`);
      const data = res?.data || res;
      if (data) {
        setSelectedReservation(data);
        if (reservationStaffList.length === 0) {
          try {
            const staffRes = await apiRequest('/api/admin/staff');
            if (staffRes?.success && Array.isArray(staffRes.data)) setReservationStaffList(staffRes.data);
            else if (Array.isArray(staffRes)) setReservationStaffList(staffRes);
          } catch {}
        }
      }
    } catch (err: any) {
      toast(`Gagal memuat detail reservasi: ${err.message}`, 'error');
    }
  };

  const handleReservationUpdate = async () => {
    if (activeDetailCustomer) {
      try {
        const res = await apiRequest(`/api/admin/customers/${activeDetailCustomer.id}`);
        if (res?.data) setDetailData((prev: any) => ({ ...prev, ...res.data, reservations: res.data.reservations || prev?.reservations }));
      } catch {}
    }
    if (selectedReservation?.id) {
      try {
        const res = await apiRequest(`/api/admin/reservation/${selectedReservation.id}`);
        const data = res?.data || res;
        if (data) setSelectedReservation(data);
      } catch {}
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Debounce already handles re-fetch; just ensure page resets
    setPage(1);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    setDebouncedSearch(search);
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    toast(`Tracking Code ${code} disalin!`, 'info');
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleToggleLabel = async (customer: CustomerItem, label: 'admin' | 'hold', enabled: boolean) => {
    const labelName = label === 'admin' ? 'Admin' : 'Hold';
    const ok = await confirm({
      title: `${enabled ? 'Pasang' : 'Lepas'} Label "${labelName}"`,
      message: `${enabled ? 'Pasang' : 'Lepas'} label "${labelName}" di sistem untuk ${customer.name || customer.phone}?`,
      confirmText: `Ya, ${enabled ? 'Pasang' : 'Lepas'}`,
      danger: !enabled,
    });
    if (!ok) return;

    try {
      const res = await apiRequest(`/api/admin/customers/${customer.id}/label`, {
        method: 'PATCH',
        body: JSON.stringify({ label, enabled }),
      });
      if (res && res.success) {
        toast(res.message || `Label "${labelName}" berhasil diperbarui di sistem.`, 'success');
        loadCustomers();
      } else {
        toast(res?.error || `Gagal memperbarui label "${labelName}".`, 'error');
      }
    } catch (err: any) {
      toast(`Gagal memperbarui label: ${err.message}`, 'error');
    }
  };

  // Open Chat History Modal
  const handleOpenHistory = async (customer: CustomerItem) => {
    setActiveHistoryCustomer(customer);
    setLoadingHistory(true);
    setHistoryMessages([]);
    try {
      const res = await apiRequest(`/api/admin/customers/${customer.id}/messages`);
      if (res && res.success) {
        setHistoryMessages(res.data || []);
      }
    } catch (err: any) {
      toast(`Gagal memuat riwayat chat: ${err.message}`, 'error');
    } finally {
      setLoadingHistory(false);
    }
  };

  // Submit Send Event
  const handleSendMetaEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEventCustomer || !selectedEvent) return;

    setSendingEvent(true);
    try {
      const res = await apiRequest(`/api/admin/customers/${activeEventCustomer.id}/send-event`, {
        method: 'POST',
        body: JSON.stringify({
          eventName: selectedEvent,
          value: eventValue !== '' ? Number(eventValue) : undefined,
          currency: eventCurrency,
        }),
      });

      if (res && res.success) {
        toast(`Event '${selectedEvent}' berhasil dikirim ke Meta CAPI!`, 'success');
        setActiveEventCustomer(null);
      }
    } catch (err: any) {
      toast(`Gagal mengirim event Meta CAPI: ${err.message}`, 'error');
    } finally {
      setSendingEvent(false);
    }
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);
  };

  const renderSortIcon = (field: string) => {
    if (sortBy !== field) {
      return <ArrowUpDown size={11} className="text-[#8696a0] opacity-40 group-hover:opacity-100" />;
    }
    return sortOrder === 'asc' ? (
      <ArrowUp size={11} className="text-[#008069] font-bold" />
    ) : (
      <ArrowDown size={11} className="text-[#008069] font-bold" />
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#111b21] tracking-tight flex items-center space-x-2">
            <Users className="text-[#008069]" size={22} />
            <span>Database Customer</span>
          </h1>
          <p className="text-xs text-[#667781] mt-0.5">
            Kelola data customer, wilayah (kecamatan & kota), nilai LTV, riwayat reservasi/anak, riwayat chat, dan kirim event Meta CAPI.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={loadCustomers}
            disabled={loading}
            className="px-3 py-1.5 rounded-xl bg-white border border-[#d1d7db] text-[#54656f] hover:bg-[#f0f2f5] hover:text-[#111b21] transition shadow-xs disabled:opacity-50 flex items-center space-x-1.5 text-xs font-semibold cursor-pointer"
            title="Refresh database"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin text-[#008069]' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Ringkasan Finansial & Statistik Pelanggan */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white p-3.5 rounded-xl border border-[#e9edef] shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#667781] uppercase tracking-wider">Total Pelanggan</span>
            <Users size={15} className="text-[#008069]" />
          </div>
          <p className="text-lg font-bold text-[#111b21] mt-1">{stats.totalCustomers || totalCount}</p>
          <span className="text-[10px] text-[#667781]">Kontak WhatsApp Aktif</span>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-[#e9edef] shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#667781] uppercase tracking-wider">Pelanggan Pembeli</span>
            <ShoppingBag size={15} className="text-emerald-600" />
          </div>
          <p className="text-lg font-bold text-emerald-700 mt-1">{stats.totalPurchasers} Kontak</p>
          <span className="text-[10px] text-emerald-600 font-medium">Memiliki Form Reservasi / Paid</span>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-[#e9edef] shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#667781] uppercase tracking-wider">Total Omset (LTV)</span>
            <DollarSign size={15} className="text-[#008069]" />
          </div>
          <p className="text-lg font-bold text-[#008069] mt-1">{formatCurrency(stats.totalRevenue)}</p>
          <span className="text-[10px] text-[#667781]">Akumulasi Transaksi Riil</span>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-[#e9edef] shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#667781] uppercase tracking-wider">Prospek Tanya-Tanya</span>
            <MessageSquare size={15} className="text-sky-600" />
          </div>
          <p className="text-lg font-bold text-sky-700 mt-1">{stats.totalProspects} Kontak</p>
          <span className="text-[10px] text-sky-600 font-medium">Konsultasi / Belum Reservasi</span>
        </div>
      </div>

      {/* Sub-Filter Segmentasi & Search Bar */}
      <div className="space-y-2.5">
        {/* Desktop Segment Filter Tabs (>= md) */}
        <div className="hidden md:flex flex-wrap items-center gap-1.5 p-1 bg-[#f0f2f5] border border-[#e9edef] rounded-xl w-fit">
          <button
            onClick={() => {
              setSegment('all');
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center space-x-1.5 cursor-pointer ${
              segment === 'all'
                ? 'bg-white text-[#111b21] shadow-2xs font-bold'
                : 'text-[#667781] hover:text-[#111b21]'
            }`}
          >
            <Users size={12} />
            <span>Semua Pelanggan ({stats.totalCustomers || totalCount})</span>
          </button>
          <button
            onClick={() => {
              setSegment('purchased');
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center space-x-1.5 cursor-pointer ${
              segment === 'purchased'
                ? 'bg-emerald-600 text-white shadow-2xs font-bold'
                : 'text-[#667781] hover:text-[#111b21]'
            }`}
          >
            <ShoppingBag size={12} />
            <span>🎯 Pembeli / Ada Reservasi ({stats.totalPurchasers})</span>
          </button>
          <button
            onClick={() => {
              setSegment('mql');
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center space-x-1.5 cursor-pointer ${
              segment === 'mql'
                ? 'bg-amber-600 text-white shadow-2xs font-bold'
                : 'text-[#667781] hover:text-[#111b21]'
            }`}
          >
            <Zap size={12} className={segment === 'mql' ? 'fill-white' : ''} />
            <span>⚡ MQL Aktif ({stats.totalMql})</span>
          </button>
          <button
            onClick={() => {
              setSegment('prospect');
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center space-x-1.5 cursor-pointer ${
              segment === 'prospect'
                ? 'bg-sky-600 text-white shadow-2xs font-bold'
                : 'text-[#667781] hover:text-[#111b21]'
            }`}
          >
            <MessageSquare size={12} />
            <span>💬 Prospek Saja ({stats.totalProspects})</span>
          </button>
        </div>

        {/* Mobile Dropdowns (< md): Segment (Left) + Sorting (Right) */}
        <div className="grid grid-cols-2 gap-2 md:hidden">
          {/* Left Dropdown: Segment Filter */}
          <div className="relative">
            <select
              value={segment}
              onChange={(e) => {
                setSegment(e.target.value as any);
                setPage(1);
              }}
              className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs font-semibold text-[#111b21] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs cursor-pointer appearance-none pr-7 truncate"
            >
              <option value="all">👥 Semua ({stats.totalCustomers || totalCount})</option>
              <option value="purchased">🎯 Pembeli ({stats.totalPurchasers})</option>
              <option value="mql">⚡ MQL Aktif ({stats.totalMql})</option>
              <option value="prospect">💬 Prospek ({stats.totalProspects})</option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-[#8696a0]">
              <ArrowUpDown size={12} />
            </div>
          </div>

          {/* Right Dropdown: Sorting */}
          <div className="relative">
            <select
              value={`${sortBy}:${sortOrder}`}
              onChange={(e) => {
                const [f, o] = e.target.value.split(':');
                setSortBy(f);
                setSortOrder(o as 'asc' | 'desc');
                setPage(1);
              }}
              className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs font-semibold text-[#111b21] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs cursor-pointer appearance-none pr-7 truncate"
            >
              <option value="created_at:desc">Terdaftar: Terbaru</option>
              <option value="created_at:asc">Terdaftar: Terlama</option>
              <option value="name:asc">Nama (A - Z)</option>
              <option value="name:desc">Nama (Z - A)</option>
              <option value="kecamatan:asc">Wilayah (A - Z)</option>
              <option value="ltv:desc">LTV Tertinggi</option>
              <option value="ltv:asc">LTV Terendah</option>
              <option value="mqlBubbleCount:desc">MQL Bubble Terbanyak</option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-[#8696a0]">
              <ArrowUpDown size={12} />
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <form onSubmit={handleSearchSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-2.5 text-[#8696a0]" size={15} />
            <input
              type="text"
              placeholder="Cari berdasarkan No HP, Nama, Kecamatan, atau Kota..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-bold transition flex items-center space-x-1 shadow-xs cursor-pointer"
          >
            <span>Cari</span>
          </button>
        </form>
      </div>

      {/* Retry Error Banner (Phase 2) */}
      {loadError && !loading && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-center justify-between">
          <span className="text-xs text-rose-700 flex items-center gap-1.5"><AlertCircle size={14}/>{loadError}</span>
          <button onClick={()=>{setRetryCount(c=>c+1);}} disabled={loading} className="px-3 py-1.5 bg-[#008069] text-white rounded-xl text-xs font-bold disabled:opacity-50 cursor-pointer">Coba Lagi</button>
        </div>
      )}

      {/* Customer Table & Mobile Cards */}
      <div className="bg-white border border-[#e9edef] rounded-2xl overflow-hidden shadow-xs relative">
        {/* Loading Overlay (refresh — data exists) */}
        {loading && customers.length > 0 && (
          <div className="absolute inset-0 z-10 bg-white/60 animate-pulse" />
        )}

        {loading && customers.length === 0 ? (
          /* Skeleton: Stats grid */
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4">
              {Array(4).fill(0).map((_, i) => (
                <div key={i} className="bg-[#f0f2f5] h-[72px] rounded-xl animate-pulse flex flex-col justify-center px-4 space-y-2">
                  <div className="h-3 w-20 bg-[#d1d7db] rounded" />
                  <div className="h-6 w-16 bg-[#d1d7db] rounded" />
                </div>
              ))}
            </div>
            {/* Skeleton: Search + Segment bar */}
            <div className="px-4 pb-3 space-y-2.5">
              <div className="h-9 bg-[#f0f2f5] rounded-xl animate-pulse" />
              <div className="h-9 bg-[#f0f2f5] rounded-xl animate-pulse w-3/4" />
            </div>
            {/* Skeleton: Table rows */}
            <div className="divide-y divide-[#e9edef]">
              {Array(15).fill(0).map((_, i) => (
                <div key={i} className="flex items-center space-x-4 px-4 py-3.5">
                  <div className="w-8 h-8 rounded-full bg-[#f0f2f5] animate-pulse shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-3/4 bg-[#f0f2f5] rounded animate-pulse" />
                    <div className="h-3 w-1/2 bg-[#f0f2f5] rounded animate-pulse" />
                  </div>
                  <div className="h-3 w-1/4 bg-[#f0f2f5] rounded animate-pulse" />
                  <div className="h-6 w-16 bg-[#f0f2f5] rounded animate-pulse" />
                  <div className="h-5 w-16 bg-[#f0f2f5] rounded animate-pulse" />
                </div>
              ))}
            </div>
            {/* Skeleton: Pagination */}
            <div className="px-4 py-3 border-t border-[#e9edef]">
              <div className="h-8 w-48 bg-[#f0f2f5] rounded animate-pulse" />
            </div>
          </>
        ) : customers.length === 0 ? (
          <div className="text-center py-16 text-[#667781] text-xs">
            <AlertCircle className="mx-auto text-[#8696a0] mb-2" size={32} />
            <p className="font-bold text-[#111b21]">Tidak ada customer ditemukan</p>
          </div>
        ) : (
          <>
            {/* Mobile Card List (< md) */}
            <div className="md:hidden divide-y divide-[#e9edef]">
              {customers.map((customer) => (
                <div
                  key={customer.id}
                  onClick={() => handleOpenDetail(customer)}
                  className="p-4 space-y-2.5 bg-white hover:bg-[#f8fafc] active:bg-[#f0f2f5] transition cursor-pointer"
                >
                  {/* Top row: Name/Phone/Location & LTV */}
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center space-x-1.5">
                        <span className="font-bold text-sm text-[#111b21] truncate">
                          {customer.name || 'Bunda Customer'}
                        </span>
                        {customer.isMql && (
                          <span
                            title={`MQL (${customer.mqlBubbleCount ?? 0} Bubble)`}
                            className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 shrink-0"
                          >
                            <Zap size={8} className="mr-0.5" />
                            MQL
                          </span>
                        )}
                      </div>
                      <div className="flex items-center space-x-1.5 text-xs text-[#54656f] mt-0.5">
                        <Phone size={12} className="text-[#8696a0] shrink-0" />
                        <span className="font-mono">{customer.phone}</span>
                      </div>
                      {(customer.kecamatan || customer.kota) && (
                        <div className="flex items-center space-x-1.5 text-xs text-[#54656f] mt-1">
                          <MapPin size={12} className="text-[#008069] shrink-0" />
                          <span className="truncate">
                            {[customer.kecamatan, customer.kota].filter(Boolean).join(', ')}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center space-x-2 shrink-0">
                      <div className="text-right">
                        {customer.ltv > 0 ? (
                          <>
                            <div className="font-bold text-emerald-700 text-sm">
                              {formatCurrency(customer.ltv)}
                            </div>
                            <span className="text-[10px] text-emerald-600 font-medium">
                              {customer.reservationCount}x transaksi
                            </span>
                          </>
                        ) : (
                          <>
                            <div className="font-semibold text-slate-500 text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                              Rp 0
                            </div>
                            <span className="text-[10px] text-[#8696a0]">
                              Prospek
                            </span>
                          </>
                        )}
                      </div>
                      <ChevronRight size={16} className="text-[#8696a0]" />
                    </div>
                  </div>

                  {/* Ad Campaign (if any) */}
                  {customer.adClick?.utmCampaign && (
                    <div className="flex items-center space-x-1 text-[11px] text-[#667781] truncate">
                      <span className="text-[#8696a0]">Campaign:</span>
                      <span className="text-[#111b21] font-medium truncate">{customer.adClick.utmCampaign}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Desktop Table (>= md) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#e9edef] bg-[#f8fafc] text-[#667781] font-bold uppercase text-[10px] tracking-wider select-none">
                    <th
                      className="py-3 px-4 cursor-pointer hover:text-[#111b21] group transition"
                      onClick={() => handleSort('name')}
                    >
                      <div className="flex items-center space-x-1.5">
                        <span>No HP / Nama</span>
                        {renderSortIcon('name')}
                      </div>
                    </th>
                    <th
                      className="py-3 px-4 cursor-pointer hover:text-[#111b21] group transition"
                      onClick={() => handleSort('kecamatan')}
                    >
                      <div className="flex items-center space-x-1.5">
                        <span>Wilayah (Kecamatan & Kota)</span>
                        {renderSortIcon('kecamatan')}
                      </div>
                    </th>
                    <th
                      className="py-3 px-4 cursor-pointer hover:text-[#111b21] group transition"
                      onClick={() => handleSort('ltv')}
                    >
                      <div className="flex items-center space-x-1.5">
                        <span>LTV (Lifetime Value)</span>
                        {renderSortIcon('ltv')}
                      </div>
                    </th>
                    <th
                      className="py-3 px-4 cursor-pointer hover:text-[#111b21] group transition"
                      onClick={() => handleSort('created_at')}
                    >
                      <div className="flex items-center space-x-1.5">
                        <span>Terdaftar</span>
                        {renderSortIcon('created_at')}
                      </div>
                    </th>
                    <th className="py-3 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e9edef]">
                  {customers.map((customer) => (
                    <tr key={customer.id} className="hover:bg-[#f8fafc] transition">
                      {/* Customer Phone & Name with MQL icon */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center space-x-2.5">
                          <div className="w-8 h-8 rounded-full bg-[#e8f5f2] text-[#008069] flex items-center justify-center font-bold text-xs shrink-0">
                            {(customer.name || customer.phone || 'B').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center space-x-1.5">
                              <span className="font-bold text-[#111b21] truncate">
                                {customer.name || 'Bunda Customer'}
                              </span>
                              {customer.isMql && (
                                <span
                                  title={`MQL (${customer.mqlBubbleCount ?? 0} Bubble)`}
                                  className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 shrink-0"
                                >
                                  <Zap size={8} className="mr-0.5" />
                                  MQL
                                </span>
                              )}
                            </div>
                            <div className="flex items-center space-x-1 text-[11px] text-[#667781] font-mono mt-0.5">
                              <Phone size={11} className="text-[#8696a0] shrink-0" />
                              <span>{customer.phone}</span>
                            </div>
                            {customer.adClick?.utmCampaign && (
                              <p className="text-[10px] text-[#8696a0] truncate max-w-[170px] mt-0.5">
                                Ad: {customer.adClick.utmCampaign}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Wilayah (Kecamatan & Kota) */}
                      <td className="py-3.5 px-4">
                        {customer.kecamatan || customer.kota ? (
                          <div className="flex items-start space-x-1.5">
                            <MapPin size={13} className="text-[#008069] shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <span className="font-bold text-[#111b21] block truncate text-xs">
                                {customer.kecamatan || '-'}
                              </span>
                              <span className="text-[11px] text-[#667781] block truncate">
                                {customer.kota || '-'}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <span className="text-[#8696a0] text-xs italic">-</span>
                        )}
                      </td>

                      {/* LTV */}
                      <td className="py-3.5 px-4">
                        {customer.ltv > 0 ? (
                          <div>
                            <span className="font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded text-[11px] inline-block">
                              {formatCurrency(customer.ltv)}
                            </span>
                            <span className="text-[10px] text-emerald-600 block mt-0.5 font-medium">
                              {customer.reservationCount}x Transaksi
                            </span>
                          </div>
                        ) : (
                          <div>
                            <span className="font-semibold text-[#667781] bg-[#f0f2f5] border border-[#e9edef] px-2 py-0.5 rounded text-[10px] inline-block">
                              Rp 0
                            </span>
                            <span className="text-[10px] text-[#8696a0] block mt-0.5">
                              Prospek
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Terdaftar */}
                      <td className="py-3.5 px-4 text-[#54656f] text-[11px] whitespace-nowrap">
                        {customer.createdAt ? new Date(customer.createdAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end space-x-1.5">
                          <button
                            onClick={() => handleOpenDetail(customer)}
                            className="px-2.5 py-1.5 rounded-xl bg-[#e8f5f2] hover:bg-[#c2e7e0] text-[#008069] border border-[#c2e7e0] text-xs font-semibold transition flex items-center space-x-1 shadow-xs cursor-pointer"
                            title="Lihat Detail Lengkap Pasien"
                          >
                            <Eye size={12} />
                            <span>Detail</span>
                          </button>

                          <button
                            onClick={() => handleOpenHistory(customer)}
                            className="px-2.5 py-1.5 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 text-xs font-semibold transition flex items-center space-x-1 shadow-xs cursor-pointer"
                            title="Buka Riwayat Chat"
                          >
                            <MessageSquare size={12} />
                            <span>History</span>
                          </button>

                          <button
                            onClick={() => setActiveEventCustomer(customer)}
                            className="px-2.5 py-1.5 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white text-xs font-semibold transition flex items-center space-x-1 shadow-xs cursor-pointer"
                            title="Kirim Event Meta CAPI"
                          >
                            <Send size={12} />
                            <span>Event</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Pagination Footer */}
        {!loading && customers.length > 0 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            label={`Menampilkan ${customers.length} dari total ${totalCount} customer`}
          />
        )}
      </div>

      {/* Modal 1: Chat History Modal */}
      {activeHistoryCustomer &&
        createPortal(
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn"
            onClick={() => setActiveHistoryCustomer(null)}
          >
            <div
              className="bg-white border border-[#e9edef] rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden my-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="p-4 border-b border-[#e9edef] flex justify-between items-center bg-[#f8fafc] shrink-0">
                <div>
                  <h3 className="font-bold text-[#111b21] text-sm flex items-center space-x-2">
                    <MessageSquare size={16} className="text-[#008069]" />
                    <span>Riwayat Chat: {activeHistoryCustomer.phone}</span>
                  </h3>
                  <p className="text-[11px] text-[#667781]">
                    {activeHistoryCustomer.name || 'Customer'} • Tracking Code: {activeHistoryCustomer.trackingCode}
                  </p>
                </div>
                <button
                  onClick={() => setActiveHistoryCustomer(null)}
                  className="p-1.5 rounded-lg text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5] transition"
                  title="Tutup (Esc)"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Modal Body: Message Stream with WhatsApp Wallpaper */}
              <div
                ref={historyContainerRef}
                className="p-4 overflow-y-auto flex-1 space-y-3 bg-[#efeae2] min-h-[300px]"
                style={{
                  backgroundImage: `radial-gradient(#d1d7db 0.75px, transparent 0.75px)`,
                  backgroundSize: '16px 16px',
                }}
              >
                {loadingHistory ? (
                  <div className="flex justify-center items-center py-12">
                    <Loader className="animate-spin text-[#008069]" size={32} />
                  </div>
                ) : historyMessages.length === 0 ? (
                  <div className="text-center py-12 text-[#667781] text-xs">
                    Belum ada pesan tercatat untuk customer ini.
                  </div>
                ) : (
                  <>
                    {historyMessages.map((msg) => {
                      const isInbound = msg.direction === 'INBOUND';
                      const typeUpper = (msg.sender_type || '').toUpperCase();
                      const sender = isInbound
                        ? 'Customer'
                        : typeUpper === 'ADMIN' || typeUpper === 'HUMAN' || typeUpper === 'STAFF'
                        ? msg.sender_name || 'Admin'
                        : 'Bot';

                      return (
                        <div key={msg.id} className={`flex flex-col ${isInbound ? 'items-start' : 'items-end'}`}>
                          <div className="flex items-center space-x-1 text-[10px] text-[#667781] mb-0.5">
                            <span className="font-bold text-[#111b21]">{sender}</span>
                            <span>•</span>
                            <Clock size={9} />
                            <span>
                              {new Date(msg.created_at).toLocaleTimeString('id-ID', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <div
                            className={`max-w-[80%] p-3 rounded-xl text-xs leading-relaxed shadow-xs ${
                              isInbound
                                ? 'bg-white text-[#111b21] rounded-tl-none border border-black/5'
                                : 'bg-[#d9fdd3] text-[#111b21] rounded-tr-none border border-[#00a884]/20'
                            }`}
                          >
                            {msg.content}
                          </div>
                        </div>
                      );
                    })}
                    <div ref={historyMessagesEndRef} className="h-0 w-0 pointer-events-none" />
                  </>
                )}
              </div>

              {/* Modal Footer */}
              <div className="p-3.5 border-t border-[#e9edef] bg-[#f8fafc] flex justify-end shrink-0">
                <button
                  onClick={() => setActiveHistoryCustomer(null)}
                  className="px-4 py-2 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#111b21] rounded-xl text-xs font-semibold transition shadow-xs"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Modal 2: Send Meta Event Modal */}
      {activeEventCustomer && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setActiveEventCustomer(null)}
        >
          <div
            className="bg-white border border-[#e9edef] rounded-2xl w-full max-w-md shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <form onSubmit={handleSendMetaEvent}>
              {/* Modal Header */}
              <div className="p-4 border-b border-[#e9edef] flex justify-between items-center bg-[#f8fafc]">
                <div>
                  <h3 className="font-bold text-[#111b21] text-sm flex items-center space-x-2">
                    <Send size={15} className="text-[#008069]" />
                    <span>Send Event ke Meta Pixel / CAPI</span>
                  </h3>
                  <p className="text-[11px] text-[#667781]">
                    Customer: {activeEventCustomer.phone} ({activeEventCustomer.trackingCode})
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveEventCustomer(null)}
                  className="p-1.5 rounded-lg text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5] transition"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Modal Form Content */}
              <div className="p-5 space-y-4 text-xs">
                <div className="space-y-1.5">
                  <label className="text-[#111b21] font-bold block">Pilih Event Meta CAPI</label>
                  <select
                    value={selectedEvent}
                    onChange={(e) => setSelectedEvent(e.target.value)}
                    className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-xl text-[#111b21] text-xs focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs"
                  >
                    <option value="Lead">Lead (Minimum Qualified Lead)</option>
                    <option value="Purchase">Purchase (Pembelian / Transaksi)</option>
                    <option value="Contact">Contact (Kontak via WhatsApp)</option>
                    <option value="ViewContent">ViewContent (Melihat Layanan/Menu)</option>
                    <option value="AddToCart">AddToCart (Tambah ke Keranjang)</option>
                    <option value="InitiateCheckout">InitiateCheckout (Mulai Checkout)</option>
                  </select>
                </div>

                {(selectedEvent === 'Purchase' || selectedEvent === 'InitiateCheckout') && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[#111b21] font-bold block">Nilai Transaksi (Rp)</label>
                      <input
                        type="number"
                        placeholder="Contoh: 150000"
                        value={eventValue}
                        onChange={(e) => setEventValue(e.target.value === '' ? '' : Number(e.target.value))}
                        className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-xl text-[#111b21] text-xs focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[#111b21] font-bold block">Mata Uang</label>
                      <input
                        type="text"
                        value={eventCurrency}
                        onChange={(e) => setEventCurrency(e.target.value)}
                        className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-xl text-[#111b21] text-xs font-mono focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs"
                      />
                    </div>
                  </div>
                )}

                <div className="p-3 rounded-xl bg-[#e8f5f2] border border-[#c2e7e0] text-[#008069] text-[11px] leading-relaxed">
                  Event akan dikirim langsung ke Meta Conversions API menggunakan data atribusi (<code>fbclid</code>, <code>fbp</code>, <code>fbc</code>, IP, UserAgent) milik customer.
                </div>
              </div>

              {/* Modal Footer */}
              <div className="p-4 border-t border-[#e9edef] bg-[#f8fafc] flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setActiveEventCustomer(null)}
                  className="px-4 py-2 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#111b21] rounded-xl text-xs font-semibold transition shadow-xs"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={sendingEvent}
                  className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 disabled:opacity-50 shadow-xs"
                >
                  <Send size={12} />
                  <span>{sendingEvent ? 'Mengirim...' : 'Kirim Event Sekarang'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 3: Complete Customer Details Modal */}
      {activeDetailCustomer && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-fadeIn"
          onClick={() => setActiveDetailCustomer(null)}
        >
          <div
            className="bg-white border border-[#e9edef] rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-[#e9edef] bg-[#f8fafc] flex justify-between items-start">
              <div className="flex items-center space-x-3">
                <div className="h-12 w-12 rounded-2xl bg-[#e8f5f2] border border-[#c2e7e0] text-[#008069] flex items-center justify-center font-bold text-lg shadow-xs flex-shrink-0">
                  {(detailData?.name || activeDetailCustomer.name || 'B')[0].toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <h3 className="font-bold text-base text-[#111b21]">
                      {detailData?.name || activeDetailCustomer.name || 'Bunda Customer'}
                    </h3>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      (detailData?.status || activeDetailCustomer.status) === 'legacy'
                        ? 'bg-purple-100 text-purple-800 border border-purple-200'
                        : (detailData?.status || activeDetailCustomer.status) === 'blocked'
                        ? 'bg-rose-100 text-rose-800 border border-rose-200'
                        : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                    }`}>
                      {detailData?.status || activeDetailCustomer.status || 'Active'}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[#54656f] mt-0.5">
                    <span className="font-mono flex items-center space-x-1">
                      <Phone size={12} className="text-[#8696a0]" />
                      <span>{detailData?.phone || activeDetailCustomer.phone}</span>
                    </span>
                    {(detailData?.kecamatan || activeDetailCustomer.kecamatan || detailData?.kota || activeDetailCustomer.kota) && (
                      <>
                        <span>•</span>
                        <span className="flex items-center space-x-1 text-[#008069] font-medium">
                          <MapPin size={12} className="text-[#008069]" />
                          <span>{[detailData?.kecamatan || activeDetailCustomer.kecamatan, detailData?.kota || activeDetailCustomer.kota].filter(Boolean).join(', ')}</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <button
                onClick={() => setActiveDetailCustomer(null)}
                className="p-1.5 rounded-xl text-[#8696a0] hover:text-[#111b21] hover:bg-[#e9edef] transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-5 text-xs text-[#111b21]">
              {loadingDetail ? (
                <div className="flex flex-col justify-center items-center py-16 space-y-3">
                  <Loader className="animate-spin text-[#008069]" size={36} />
                  <p className="text-xs text-[#667781] font-medium">Memuat data lengkap customer...</p>
                </div>
              ) : (
                <>
                  {/* Grid Top Cards: LTV & MQL Status */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="p-3 bg-[#f8fafc] border border-[#e9edef] rounded-2xl">
                      <span className="text-[10px] uppercase font-bold text-[#667781] block">Total LTV</span>
                      <p className="font-bold text-sm text-[#008069] mt-0.5">
                        {formatCurrency(detailData?.ltv ?? activeDetailCustomer.ltv)}
                      </p>
                    </div>

                    <div className="p-3 bg-[#f8fafc] border border-[#e9edef] rounded-2xl">
                      <span className="text-[10px] uppercase font-bold text-[#667781] block">Total Transaksi</span>
                      <p className="font-bold text-sm text-[#111b21] mt-0.5">
                        {(detailData?.reservations?.length ?? activeDetailCustomer.reservationCount)}x Reservasi
                      </p>
                    </div>

                    <div className="p-3 bg-[#f8fafc] border border-[#e9edef] rounded-2xl">
                      <span className="text-[10px] uppercase font-bold text-[#667781] block">Status MQL</span>
                      <div className="mt-0.5">
                        {activeDetailCustomer.isMql ? (
                          <span className="inline-flex items-center space-x-1 text-emerald-700 font-bold text-xs">
                            <Zap size={11} className="fill-emerald-600 text-emerald-600" />
                            <span>MQL ({activeDetailCustomer.mqlBubbleCount} Bubble)</span>
                          </span>
                        ) : (
                          <span className="text-[#667781] font-semibold text-xs">
                            Regular ({activeDetailCustomer.mqlBubbleCount} Bubble)
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="p-3 bg-[#f8fafc] border border-[#e9edef] rounded-2xl">
                      <span className="text-[10px] uppercase font-bold text-[#667781] block">Terdaftar Sejak</span>
                      <p className="font-semibold text-xs text-[#54656f] mt-0.5 truncate">
                        {activeDetailCustomer.createdAt
                          ? new Date(activeDetailCustomer.createdAt).toLocaleDateString('id-ID', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })
                          : '-'}
                      </p>
                    </div>
                  </div>

                  {/* Section 1: Alamat & Lokasi Rumah */}
                  <div className="p-4 bg-white border border-[#e9edef] rounded-2xl space-y-3 shadow-2xs">
                    <h4 className="font-bold text-xs text-[#111b21] flex items-center space-x-1.5 text-[#008069]">
                      <MapPin size={15} />
                      <span>Alamat Lengkap & Logistik Kunjungan</span>
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-[10px] text-[#667781] font-semibold block uppercase">Alamat Pasien</span>
                        <p className="text-[#111b21] font-medium mt-0.5">
                          {detailData?.address || detailData?.kelurahan || detailData?.kecamatan
                            ? [detailData?.address, detailData?.kelurahan, detailData?.kecamatan, detailData?.kota]
                                .filter(Boolean)
                                .join(', ')
                            : 'Alamat belum tercatat lengkap di profil'}
                        </p>
                      </div>

                      <div>
                        <span className="text-[10px] text-[#667781] font-semibold block uppercase">Patokan / Landmark</span>
                        <p className="text-[#111b21] font-medium mt-0.5">
                          {detailData?.address_notes || detailData?.landmark || 'Tidak ada catatan patokan khusus'}
                        </p>
                      </div>
                    </div>

                    {/* Coordinates & Delivery Info */}
                    <div className="pt-2 border-t border-[#f0f2f5] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#54656f]">
                      <div className="flex items-center space-x-2">
                        {detailData?.latitude && detailData?.longitude ? (
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${detailData.latitude},${detailData.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center space-x-1 text-[#008069] font-bold hover:underline"
                          >
                            <Navigation size={12} />
                            <span>Buka Titik GPS Google Maps</span>
                            <ExternalLink size={10} />
                          </a>
                        ) : (
                          <span className="text-[#8696a0] italic">Pin GPS belum diset</span>
                        )}
                      </div>

                      {(detailData?.delivery_distance_km || detailData?.delivery_fee) && (
                        <div className="font-semibold text-[#111b21]">
                          Jarak: <span className="text-[#008069]">{detailData.delivery_distance_km} km</span> • Ongkir: <span className="text-[#008069]">{formatCurrency(detailData.delivery_fee || 0)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Section 2: Data Anak / Bayi */}
                  <div className="p-4 bg-white border border-[#e9edef] rounded-2xl space-y-3 shadow-2xs">
                    <h4 className="font-bold text-xs text-[#111b21] flex items-center space-x-1.5 text-[#008069]">
                      <Baby size={15} />
                      <span>Data Anak / Bayi Pasien ({detailData?.children?.length || 0})</span>
                    </h4>

                    {!detailData?.children || detailData.children.length === 0 ? (
                      <div className="p-3 bg-[#f8fafc] border border-[#e9edef] rounded-xl text-center text-xs text-[#8696a0]">
                        Belum ada data profil anak yang tercatat terpisah.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {detailData.children.map((child: any) => (
                          <div
                            key={child.id}
                            className="p-3 bg-[#f8fafc] border border-[#e9edef] rounded-xl flex items-center justify-between"
                          >
                            <div>
                              <p className="font-bold text-[#111b21] text-xs">{child.name || 'Anak Pasien'}</p>
                              <p className="text-[11px] text-[#667781] mt-0.5">
                                Usia: <span className="font-semibold text-[#008069]">{child.current_age || child.raw_age_text || 'Tidak tercatat'}</span>
                              </p>
                            </div>
                            {child.birth_date && (
                              <span className="text-[10px] text-[#8696a0] font-mono">
                                Lahir: {new Date(child.birth_date).toLocaleDateString('id-ID')}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Section 3: Riwayat Reservasi & Layanan */}
                  <div className="p-4 bg-white border border-[#e9edef] rounded-2xl space-y-3 shadow-2xs">
                    <h4 className="font-bold text-xs text-[#111b21] flex items-center space-x-1.5 text-[#008069]">
                      <Calendar size={15} />
                      <span>Riwayat Layanan & Reservasi ({detailData?.reservations?.length || 0})</span>
                    </h4>

                    {!detailData?.reservations || detailData.reservations.length === 0 ? (
                      <div className="p-3 bg-[#f8fafc] border border-[#e9edef] rounded-xl text-center text-xs text-[#8696a0]">
                        Belum ada riwayat reservasi yang tercatat untuk customer ini.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-[#e9edef] bg-[#f8fafc] text-[#667781] text-[10px] uppercase font-bold">
                              <th className="py-2 px-3">Tanggal</th>
                              <th className="py-2 px-3">Kategori</th>
                              <th className="py-2 px-3">Treatment</th>
                              <th className="py-2 px-3">Terapis</th>
                              <th className="py-2 px-3 text-right">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#e9edef]">
                            {detailData.reservations.map((res: any) => (
                              <tr
                                key={res.id}
                                onClick={() => handleOpenReservationDetail(res.id)}
                                className="hover:bg-[#f8fafc] hover:border-[#008069]/20 cursor-pointer transition group"
                                title="Klik untuk lihat detail reservasi"
                              >
                                <td className="py-2.5 px-3 whitespace-nowrap text-[11px] font-semibold text-[#111b21]">
                                  {res.booking_date
                                    ? new Date(res.booking_date).toLocaleDateString('id-ID', {
                                        day: '2-digit',
                                        month: 'short',
                                        year: 'numeric',
                                      })
                                    : 'Tanpa Jadwal'}
                                </td>
                                <td className="py-2.5 px-3">
                                  <span className="px-1.5 py-0.5 rounded bg-[#f0f2f5] text-[10px] font-bold text-[#54656f]">
                                    {res.treatment_category}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 text-[#54656f] max-w-[180px] truncate" title={res.treatment_detail}>
                                  {res.treatment_detail || res.raw_text}
                                </td>
                                <td className="py-2.5 px-3 text-[#54656f] text-[11px] group-hover:text-[#008069]">
                                  {res.assigned_staff?.name || <span className="text-[#8696a0] italic">-</span>}
                                </td>
                                <td className="py-2.5 px-3 text-right">
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                    res.status === 'completed'
                                      ? 'bg-sky-100 text-sky-800 border border-sky-200'
                                      : res.status === 'confirmed'
                                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                      : res.status === 'cancelled'
                                      ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                      : 'bg-amber-100 text-amber-800 border border-amber-200'
                                  }`}>
                                    {res.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {detailData?.reservations?.length > 0 && (
                      <p className="text-[10px] text-[#8696a0] italic flex items-center space-x-1"><Eye size={10} /><span>Klik baris untuk lihat detail lengkap</span></p>
                    )}
                  </div>

                  {/* Section 4: Atribusi Meta Ads & Label */}
                  <div className="p-4 bg-white border border-[#e9edef] rounded-2xl space-y-2 shadow-2xs">
                    <h4 className="font-bold text-xs text-[#111b21] flex items-center space-x-1.5 text-[#008069]">
                      <Tag size={15} />
                      <span>Atribusi Iklan Meta & Tag</span>
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-[#54656f]">
                      <div>
                        <span className="font-semibold text-[#8696a0] block">Campaign Iklan:</span>
                        <p className="font-medium text-[#111b21] truncate">
                          {detailData?.adClick?.utmCampaign || activeDetailCustomer.adClick?.utmCampaign || 'Organik / Langsung'}
                        </p>
                      </div>
                      <div>
                        <span className="font-semibold text-[#8696a0] block">Source / Medium:</span>
                        <p className="font-medium text-[#111b21]">
                          {detailData?.adClick?.utmSource || 'wa'} / {detailData?.adClick?.utmMedium || 'ctwa'}
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Modal Footer with Actions */}
            <div className="p-4 border-t border-[#e9edef] bg-[#f8fafc] flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => {
                    const cust = activeDetailCustomer;
                    setActiveDetailCustomer(null);
                    handleOpenHistory(cust);
                  }}
                  className="px-3 py-2 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 text-xs font-semibold transition flex items-center space-x-1.5 shadow-xs"
                >
                  <MessageSquare size={13} />
                  <span>Riwayat Chat</span>
                </button>

                <button
                  onClick={() => {
                    const cust = activeDetailCustomer;
                    setActiveDetailCustomer(null);
                    setActiveEventCustomer(cust);
                  }}
                  className="px-3 py-2 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white text-xs font-semibold transition flex items-center space-x-1.5 shadow-xs"
                >
                  <Send size={13} />
                  <span>Kirim Event Meta</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setDetailEditMode(true)}
                className="px-4 py-2 bg-[#e8f5f2] hover:bg-[#c2e7e0] text-[#008069] border border-[#c2e7e0] text-xs font-semibold rounded-xl transition shadow-xs flex items-center space-x-1.5"
              >
                <PenLine size={13} />
                <span>Edit Profil & Data Anak</span>
              </button>
            <button
              onClick={() => setActiveDetailCustomer(null)}
              className="px-4 py-2 bg-white hover:bg-[#e9edef] border border-[#d1d7db] text-[#111b21] rounded-xl text-xs font-semibold transition shadow-xs ml-auto"
            >
              Tutup
            </button>
          </div>
          </div>
      </div>
    )}

      {/* Edit Profil Modal - terpisah, placement seperti ReservationDetailModal (tidak nested, full overlay) */}
      {detailEditMode && activeDetailCustomer && (
        <CustomerEditForm
          customer={{
            id: activeDetailCustomer.id,
            name: detailData?.name || activeDetailCustomer.name,
            phone: detailData?.phone || activeDetailCustomer.phone,
            address: detailData?.preferences?.address || detailData?.preferences?.full_address || '',
            kelurahan: detailData?.kelurahan,
            kecamatan: detailData?.kecamatan,
            kota: detailData?.kota,
            zipcode: detailData?.zipcode,
            landmark: detailData?.preferences?.landmark || detailData?.preferences?.address_notes,
            lat: detailData?.lat,
            lng: detailData?.lng,
            children: detailData?.children || [],
            preferences: detailData?.preferences,
          }}
          onSave={handleSaveCustomerDetail}
          onCancel={() => setDetailEditMode(false)}
          loading={loadingDetail}
        />
      )}

      {/* Reservation Detail Modal dari riwayat (klik row) */}
      {selectedReservation && (
        <ReservationDetailModal
          reservation={selectedReservation}
          staffList={reservationStaffList}
          user={null}
          googleCalendarMockActive={false}
          onClose={() => setSelectedReservation(null)}
          onUpdate={handleReservationUpdate}
          onConfirm={async (id) => { await apiRequest(`/api/admin/reservation/${id}/confirm`, { method: 'PATCH' }); await handleReservationUpdate(); }}
          onComplete={async (id) => { await apiRequest(`/api/admin/reservation/${id}/complete`, { method: 'PATCH' }); await handleReservationUpdate(); }}
          onStatusChange={async (id, s) => { await apiRequest(`/api/admin/reservation/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: s }) }); await handleReservationUpdate(); }}
          onSetDate={async (id, d) => { await apiRequest(`/api/admin/reservation/${id}/set-date`, { method: 'PATCH', body: JSON.stringify({ bookingDate: new Date(d).toISOString() }) }); await handleReservationUpdate(); }}
          onAssignStaff={async (id, sid) => { await apiRequest(`/api/admin/reservation/${id}/assign-staff`, { method: 'PATCH', body: JSON.stringify({ assigned_staff_id: sid }) }); await handleReservationUpdate(); }}
          onDelete={async (id) => { await apiRequest(`/api/admin/reservation/${id}`, { method: 'DELETE' }); setSelectedReservation(null); await handleReservationUpdate(); }}
          onProofUpload={async (file) => {
            const toB64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('read fail')); r.readAsDataURL(f); });
            const b64 = await toB64(file);
            await apiRequest(`/api/admin/reservation/${selectedReservation.id}/proof`, { method: 'PUT', body: JSON.stringify({ imageB64: b64, mimeType: file.type, fileName: file.name }) });
            await handleReservationUpdate();
          }}
          onProofRemove={async () => { await apiRequest(`/api/admin/reservation/${selectedReservation.id}/proof`, { method: 'PUT', body: JSON.stringify({ remove: true }) }); await handleReservationUpdate(); }}
          onOpenEditLocation={() => toast('Edit lokasi via menu Reservations untuk akses penuh.', 'info')}
          onProofView={(r) => window.open(r.proof_url!, '_blank')}
          onHousePhotoView={(url) => window.open(url, '_blank')}
        />
      )}
  </div>
);
};
