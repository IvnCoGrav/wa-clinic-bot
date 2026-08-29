import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { Pagination } from '../../components/common/Pagination';
import {
  Clock,
  Send,
  XCircle,
  Calendar,
  CalendarCheck,
  Search,
  Filter,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  User,
  Sparkles,
  Edit2,
  ShieldCheck,
  Trash2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  FastForward,
  MessageSquare,
  ExternalLink,
} from 'lucide-react';

interface Customer {
  id: string;
  name: string | null;
  phone: string;
  kelurahan: string | null;
  kecamatan: string | null;
  kota: string | null;
  status: string;
  conversations?: Array<{
    last_message_at: string;
    is_human_handling: boolean;
  }>;
}

interface FollowUpItem {
  id: string;
  type: string; // NO_PURCHASE | NEXT_TREATMENT
  stage: number;
  scheduled_at: string;
  sent_at: string | null;
  status: string; // PENDING | QUEUED | SENT | CANCELLED | FAILED | SKIPPED
  customer: Customer | null;
}

export const FollowUpQueue: React.FC = () => {
  const [followUps, setFollowUps] = useState<FollowUpItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<string>('scheduled_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'cancel' | 'send' | 'bulk-cancel' | 'queue' | 'bulk-queue' | 'reschedule-overdue';
    id?: string;
  } | null>(null);

  // Reschedule Modal
  const [rescheduleModal, setRescheduleModal] = useState<{ open: boolean; item?: FollowUpItem; newDate?: string }>({ open: false });

  const PAGE_SIZE = 20;

  const loadFollowUps = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (typeFilter) params.append('type', typeFilter);
      if (search) params.append('search', search);
      if (sortBy) params.append('sortBy', sortBy);
      if (sortOrder) params.append('sortOrder', sortOrder);
      params.append('page', String(page));
      params.append('pageSize', String(PAGE_SIZE));

      const endpoint = `follow-ups${params.toString() ? `?${params.toString()}` : ''}`;
      const res = await apiRequest(endpoint);
      const list = Array.isArray(res) ? res : (res?.data || []);
      setFollowUps(list);
      setTotalPages(res?.pagination?.totalPages || 1);
      setTotalItems(res?.pagination?.total || 0);
    } catch (err: any) {
      console.warn('Gagal load follow-ups:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFollowUps();
  }, [statusFilter, typeFilter, page, sortBy, sortOrder]);

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
    setPage(1);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadFollowUps();
  };

  const handleRescheduleOverdue = async () => {
    setActionLoading('reschedule-overdue');
    try {
      const res = await apiRequest('follow-ups/reschedule-overdue', {
        method: 'POST',
        body: JSON.stringify({ maxPerDay: 10 }),
      });
      setToastMsg({
        type: 'success',
        text: res.message || 'Follow-up overdue berhasil dimajukan dan dijadwalkan (maks 10 blast/hari)!',
      });
      loadFollowUps();
    } catch (err: any) {
      setToastMsg({ type: 'error', text: `Gagal memajukan jadwal: ${err.message}` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleQueue = async (id: string) => {
    setActionLoading(id);
    try {
      await apiRequest(`follow-ups/${id}/queue`, { method: 'POST' });
      setToastMsg({ type: 'success', text: 'Follow-up berhasil dijadwalkan dan masuk ke antrian!' });
      loadFollowUps();
    } catch (err: any) {
      setToastMsg({ type: 'error', text: `Gagal menjadwalkan: ${err.message}` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleBulkQueue = async () => {
    setActionLoading('bulk-queue');
    try {
      const res = await apiRequest('follow-ups/bulk-queue', { method: 'POST' });
      setToastMsg({ type: 'success', text: res.message || 'Semua antrian pending berhasil dijadwalkan.' });
      loadFollowUps();
    } catch (err: any) {
      setToastMsg({ type: 'error', text: `Gagal menjadwalkan antrian: ${err.message}` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleSendNow = async (id: string) => {
    setActionLoading(id);
    try {
      await apiRequest(`follow-ups/${id}/send-now`, { method: 'POST' });
      setToastMsg({ type: 'success', text: 'Follow-up berhasil disetujui & dikirim ke WhatsApp!' });
      loadFollowUps();
    } catch (err: any) {
      setToastMsg({ type: 'error', text: `Gagal mengirim: ${err.message}` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (id: string) => {
    setActionLoading(id);
    try {
      await apiRequest(`follow-ups/${id}/cancel`, { method: 'PATCH' });
      setToastMsg({ type: 'success', text: 'Follow-up berhasil dibatalkan.' });
      loadFollowUps();
    } catch (err: any) {
      setToastMsg({ type: 'error', text: `Gagal membatalkan: ${err.message}` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleBulkCancel = async () => {
    setActionLoading('bulk-cancel');
    try {
      const res = await apiRequest('follow-ups/bulk-cancel', {
        method: 'POST',
        body: JSON.stringify({ status: 'PENDING' }),
      });
      setToastMsg({ type: 'success', text: res.message || 'Semua antrian pending berhasil dibatalkan.' });
      loadFollowUps();
    } catch (err: any) {
      setToastMsg({ type: 'error', text: `Gagal membatalkan antrian: ${err.message}` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRescheduleSave = async () => {
    if (!rescheduleModal.item || !rescheduleModal.newDate) return;
    setActionLoading(rescheduleModal.item.id);
    try {
      await apiRequest(`follow-ups/${rescheduleModal.item.id}/reschedule`, {
        method: 'PATCH',
        body: JSON.stringify({ scheduledAt: rescheduleModal.newDate }),
      });
      setRescheduleModal({ open: false });
      setToastMsg({ type: 'success', text: 'Jadwal follow-up berhasil diperbarui!' });
      loadFollowUps();
    } catch (err: any) {
      setToastMsg({ type: 'error', text: `Gagal reschedule: ${err.message}` });
    } finally {
      setActionLoading(null);
    }
  };

  const formatDateTime = (isoStr: string) => {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return { date: '-', time: '-' };
    const date = d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
    const time = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';
    return { date, time };
  };

  const formatLastChat = (lastMessageAt?: string | null) => {
    if (!lastMessageAt) return null;
    const d = new Date(lastMessageAt);
    if (isNaN(d.getTime())) return null;
    const diffHours = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60));
    if (diffHours < 1) return 'Baru saja';
    if (diffHours < 24) return `${diffHours}j lalu`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Kemarin';
    if (diffDays < 30) return `${diffDays}h lalu`;
    return `${Math.floor(diffDays / 30)}bln lalu`;
  };

  const getTypeLabel = (type: string, stage: number) => {
    if (type === 'NO_PURCHASE') {
      const days = [3, 7, 14];
      return {
        label: `Belum Purchase (+${days[stage - 1] || stage} Hari)`,
        color: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
      };
    }
    if (type === 'NEXT_TREATMENT') {
      return {
        label: `Treatment Lanjutan (+${stage} Bulan)`,
        color: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
      };
    }
    return { label: `${type} Stage ${stage}`, color: 'bg-slate-500/10 text-slate-600 border-slate-500/20' };
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 flex items-center space-x-1 w-fit">
            <Clock size={10} />
            <span>Menunggu Persetujuan</span>
          </span>
        );
      case 'QUEUED':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 flex items-center space-x-1 w-fit">
            <CalendarCheck size={10} />
            <span>Terjadwal di Antrian</span>
          </span>
        );
      case 'SENT':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center space-x-1 w-fit">
            <CheckCircle size={10} />
            <span>Sudah Terkirim</span>
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200 flex items-center space-x-1 w-fit">
            <XCircle size={10} />
            <span>Dibatalkan</span>
          </span>
        );
      case 'SKIPPED':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-500 border border-gray-200 flex items-center space-x-1 w-fit">
            <FastForward size={10} />
            <span>Dilewati (Kadaluarsa)</span>
          </span>
        );
      case 'FAILED':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 flex items-center space-x-1 w-fit">
            <AlertCircle size={10} />
            <span>Gagal Terkirim</span>
          </span>
        );
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#111b21]">Follow-Up & Reminder Queue</h1>
          <p className="text-xs text-[#54656f] mt-0.5">
            Daftar antrian pesan follow-up otomatis untuk pelanggan baru dan jadwal perawatan rutin.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {/* Tombol Bulk Queue: Jadwalkan Semua PENDING */}
          <button
            onClick={() => setConfirmAction({ type: 'bulk-queue' })}
            disabled={actionLoading === 'bulk-queue'}
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition shadow-xs flex items-center space-x-1.5"
            title="Jadwalkan semua pesan berstatus PENDING ke antrian otomatis"
          >
            <CalendarCheck size={14} className={actionLoading === 'bulk-queue' ? 'animate-spin' : ''} />
            <span>Jadwalkan Semua Pending</span>
          </button>

          {/* Tombol Memajukan Overdue */}
          <button
            onClick={() => setConfirmAction({ type: 'reschedule-overdue' })}
            disabled={actionLoading === 'reschedule-overdue'}
            className="px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold transition shadow-xs flex items-center space-x-1.5"
            title="Majukan follow-up yang lewat jadwal ke hari ini/besok (maks 10 pesan/hari)"
          >
            <FastForward size={14} className={actionLoading === 'reschedule-overdue' ? 'animate-spin' : ''} />
            <span>Majukan Overdue</span>
          </button>

          {/* Tombol Bulk Cancel */}
          <button
            onClick={() => setConfirmAction({ type: 'bulk-cancel' })}
            disabled={actionLoading === 'bulk-cancel'}
            className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 rounded-xl text-xs font-semibold transition shadow-xs flex items-center space-x-1.5"
            title="Batalkan semua antrian follow-up berstatus PENDING"
          >
            <Trash2 size={14} />
            <span>Batalkan Semua</span>
          </button>

          <button
            onClick={loadFollowUps}
            disabled={loading}
            className="p-2 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#111b21] rounded-xl transition shadow-xs flex items-center space-x-1"
            title="Refresh Data"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin text-[#008069]' : 'text-[#667781]'} />
            <span className="text-xs font-semibold">Refresh</span>
          </button>
        </div>
      </div>

      {/* Safety Policy Notice */}
      <div className="bg-[#e8f5f2] border border-[#c2e7e0] rounded-2xl p-3.5 flex items-start space-x-3 text-xs text-[#005c4b]">
        <ShieldCheck size={18} className="text-[#008069] flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-bold text-[#111b21]">Sistem Penjadwalan Antrian & Smart Context Guard</p>
          <p className="text-[#54656f] mt-0.5">
            Pesan berstatus <strong>PENDING</strong> menunggu konfirmasi admin. Klik tombol <strong>Jadwalkan</strong> untuk memasukkan pesan ke antrian (<strong>QUEUED</strong>) agar terkirim otomatis tepat pada tanggal & jam yang sudah disetup (maksimal 10 blast per hari pada jam kerja).
            Dilengkapi <strong>Smart Context Guard</strong>: jika customer baru saja aktif chat (&lt;3 hari terakhir), jadwal otomatis dimundurkan agar tidak menimpa obrolan baru.
          </p>
        </div>
      </div>

      {/* Filters & Search Bar */}
      <div className="bg-white border border-[#e9edef] rounded-2xl p-4 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          <Filter size={15} className="text-[#008069] flex-shrink-0" />
          
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
          >
            <option value="">Semua Status</option>
            <option value="PENDING">PENDING (Menunggu Persetujuan)</option>
            <option value="QUEUED">QUEUED (Terjadwal di Antrian)</option>
            <option value="SENT">SENT (Sudah Terkirim)</option>
            <option value="CANCELLED">CANCELLED (Dibatalkan)</option>
            <option value="SKIPPED">SKIPPED (Dilewati/Kadaluarsa)</option>
            <option value="FAILED">FAILED (Gagal)</option>
          </select>

          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(1);
            }}
            className="p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
          >
            <option value="">Semua Tipe</option>
            <option value="NO_PURCHASE">Belum Purchase (+3, +7, +14 Hari)</option>
            <option value="NEXT_TREATMENT">Treatment Lanjutan (+1, +2, +3 Bulan)</option>
          </select>

          <div className="flex items-center space-x-1 border border-[#d1d7db] rounded-xl px-2 py-1 bg-white shadow-xs">
            <ArrowUpDown size={13} className="text-[#8696a0]" />
            <select
              value={`${sortBy}:${sortOrder}`}
              onChange={(e) => {
                const [sb, so] = e.target.value.split(':');
                setSortBy(sb);
                setSortOrder(so as 'asc' | 'desc');
                setPage(1);
              }}
              className="bg-transparent text-xs text-[#111b21] focus:outline-none cursor-pointer py-1"
            >
              <option value="scheduled_at:asc">Urutkan: Jadwal Terdekat (ASC)</option>
              <option value="scheduled_at:desc">Urutkan: Jadwal Terjauh (DESC)</option>
              <option value="customer_name:asc">Urutkan: Nama Customer (A-Z)</option>
              <option value="customer_name:desc">Urutkan: Nama Customer (Z-A)</option>
              <option value="type:asc">Urutkan: Tipe Follow-Up</option>
              <option value="status:asc">Urutkan: Status</option>
              <option value="created_at:desc">Urutkan: Terbaru Dibuat</option>
            </select>
          </div>
        </div>

        <form onSubmit={handleSearchSubmit} className="flex items-center space-x-2 w-full lg:w-auto">
          <div className="relative w-full lg:w-64">
            <Search size={14} className="absolute left-3 top-2.5 text-[#8696a0]" />
            <input
              type="text"
              placeholder="Cari nama atau nomor HP..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs"
            />
          </div>
          <button
            type="submit"
            className="px-3.5 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-semibold transition shadow-xs"
          >
            Cari
          </button>
        </form>
      </div>

      {/* Main Table */}
      <div className="bg-white border border-[#e9edef] rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[#111b21]">
            <thead>
              <tr className="border-b border-[#e9edef] bg-[#f8fafc] text-[#667781] font-bold uppercase text-[10px]">
                <th
                  onClick={() => handleSort('scheduled_at')}
                  className="px-4 py-3.5 cursor-pointer select-none hover:text-[#008069] transition-colors"
                  title="Klik untuk urutkan berdasarkan Tanggal Jadwal"
                >
                  <div className="flex items-center space-x-1">
                    <span>Tanggal Jadwal</span>
                    {sortBy === 'scheduled_at' ? (
                      sortOrder === 'asc' ? <ArrowUp size={12} className="text-[#008069]" /> : <ArrowDown size={12} className="text-[#008069]" />
                    ) : (
                      <ArrowUpDown size={12} className="text-slate-400 opacity-60" />
                    )}
                  </div>
                </th>
                <th className="px-4 py-3.5">Jam</th>
                <th
                  onClick={() => handleSort('type')}
                  className="px-4 py-3.5 cursor-pointer select-none hover:text-[#008069] transition-colors"
                  title="Klik untuk urutkan berdasarkan Tipe & Stage"
                >
                  <div className="flex items-center space-x-1">
                    <span>Tipe & Stage</span>
                    {sortBy === 'type' ? (
                      sortOrder === 'asc' ? <ArrowUp size={12} className="text-[#008069]" /> : <ArrowDown size={12} className="text-[#008069]" />
                    ) : (
                      <ArrowUpDown size={12} className="text-slate-400 opacity-60" />
                    )}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('customer_name')}
                  className="px-4 py-3.5 cursor-pointer select-none hover:text-[#008069] transition-colors"
                  title="Klik untuk urutkan berdasarkan Nama Customer"
                >
                  <div className="flex items-center space-x-1">
                    <span>Customer & No. HP</span>
                    {sortBy === 'customer_name' || sortBy === 'name' ? (
                      sortOrder === 'asc' ? <ArrowUp size={12} className="text-[#008069]" /> : <ArrowDown size={12} className="text-[#008069]" />
                    ) : (
                      <ArrowUpDown size={12} className="text-slate-400 opacity-60" />
                    )}
                  </div>
                </th>
                <th className="px-4 py-3.5">Varian Template</th>
                <th
                  onClick={() => handleSort('status')}
                  className="px-4 py-3.5 cursor-pointer select-none hover:text-[#008069] transition-colors"
                  title="Klik untuk urutkan berdasarkan Status"
                >
                  <div className="flex items-center space-x-1">
                    <span>Status</span>
                    {sortBy === 'status' ? (
                      sortOrder === 'asc' ? <ArrowUp size={12} className="text-[#008069]" /> : <ArrowDown size={12} className="text-[#008069]" />
                    ) : (
                      <ArrowUpDown size={12} className="text-slate-400 opacity-60" />
                    )}
                  </div>
                </th>
                <th className="px-4 py-3.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e9edef]">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-xs text-[#667781]">
                    <RefreshCw className="animate-spin mx-auto text-[#008069] mb-2" size={24} />
                    <span>Memuat antrian follow-up...</span>
                  </td>
                </tr>
              ) : followUps.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-xs text-[#667781]">
                    Tidak ada antrian follow-up yang sesuai filter.
                  </td>
                </tr>
              ) : (
                followUps.map((fu) => {
                  const { date, time } = formatDateTime(fu.scheduled_at);
                  const typeInfo = getTypeLabel(fu.type, fu.stage);
                  const c = fu.customer;

                  return (
                    <tr key={fu.id} className="hover:bg-[#f8fafc] transition-colors">
                      {/* Date */}
                      <td className="px-4 py-3.5 font-bold text-[#111b21]">
                        <div className="flex items-center space-x-1.5">
                          <Calendar size={13} className="text-[#008069] flex-shrink-0" />
                          <span>{date}</span>
                        </div>
                      </td>

                      {/* Time */}
                      <td className="px-4 py-3.5 font-mono text-xs text-[#54656f]">
                        {time}
                      </td>

                      {/* Type & Stage */}
                      <td className="px-4 py-3.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${typeInfo.color}`}>
                          {typeInfo.label}
                        </span>
                      </td>

                      {/* Customer */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center space-x-1.5">
                          <User size={13} className="text-[#8696a0] flex-shrink-0" />
                          <span className="font-bold text-[#111b21]">{c?.name || 'Bunda'}</span>
                          {c?.conversations?.[0]?.is_human_handling && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-300" title="Sedang/Pernah dikelola manual oleh Admin">
                              Human Handling
                            </span>
                          )}
                        </div>
                        <div className="flex items-center space-x-2 text-[10px] text-[#667781] font-mono ml-4 mt-0.5">
                          <span>{c?.phone}</span>
                          {c?.conversations?.[0]?.last_message_at && (
                            <span
                              className={`flex items-center space-x-0.5 px-1 py-0.2 rounded text-[9px] ${
                                (Date.now() - new Date(c.conversations[0].last_message_at).getTime()) < 72 * 60 * 60 * 1000
                                  ? 'bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200'
                                  : 'text-[#8696a0]'
                              }`}
                              title={`Chat terakhir: ${new Date(c.conversations[0].last_message_at).toLocaleString('id-ID')}`}
                            >
                              <MessageSquare size={9} />
                              <span>{formatLastChat(c.conversations[0].last_message_at)}</span>
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Template Rolling */}
                      <td className="px-4 py-3.5 text-xs text-[#54656f]">
                        <div className="flex items-center space-x-1">
                          <Sparkles size={11} className="text-amber-500 flex-shrink-0" />
                          <span>Varian #{((fu.stage - 1) % 3) + 1}</span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5">{getStatusBadge(fu.status)}</td>

                      {/* Actions */}
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end space-x-1">
                          {fu.status === 'PENDING' && (
                            <>
                              <button
                                onClick={() => setConfirmAction({ type: 'queue', id: fu.id })}
                                disabled={actionLoading === fu.id}
                                className="px-2.5 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 text-xs font-bold flex items-center space-x-1 transition shadow-xs"
                                title="Jadwalkan / Masukkan ke Antrian"
                              >
                                <CalendarCheck size={12} />
                                <span>Jadwalkan</span>
                              </button>
                              <a
                                href="/admin/live-chat"
                                target="_blank"
                                rel="noreferrer"
                                className="p-1.5 rounded-xl bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] hover:text-[#008069] text-xs font-semibold transition shadow-xs flex items-center"
                                title="Buka Live Chat (Sapa Manual)"
                              >
                                <MessageSquare size={12} />
                              </a>
                              <button
                                onClick={() => setRescheduleModal({ open: true, item: fu, newDate: fu.scheduled_at.slice(0, 16) })}
                                disabled={actionLoading === fu.id}
                                className="p-1.5 rounded-xl bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] hover:text-[#111b21] text-xs font-semibold transition shadow-xs"
                                title="Ubah Jadwal"
                              >
                                <Edit2 size={12} />
                              </button>
                              <button
                                onClick={() => setConfirmAction({ type: 'cancel', id: fu.id })}
                                disabled={actionLoading === fu.id}
                                className="p-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 text-xs font-semibold transition shadow-xs"
                                title="Batalkan"
                              >
                                <XCircle size={12} />
                              </button>
                            </>
                          )}
                          {fu.status === 'QUEUED' && (
                            <>
                              <a
                                href="/admin/live-chat"
                                target="_blank"
                                rel="noreferrer"
                                className="p-1.5 rounded-xl bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] hover:text-[#008069] text-xs font-semibold transition shadow-xs flex items-center"
                                title="Buka Live Chat (Sapa Manual)"
                              >
                                <MessageSquare size={12} />
                              </a>
                              <button
                                onClick={() => setRescheduleModal({ open: true, item: fu, newDate: fu.scheduled_at.slice(0, 16) })}
                                disabled={actionLoading === fu.id}
                                className="p-1.5 rounded-xl bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] hover:text-[#111b21] text-xs font-semibold transition shadow-xs"
                                title="Ubah Jadwal"
                              >
                                <Edit2 size={12} />
                              </button>
                              <button
                                onClick={() => setConfirmAction({ type: 'cancel', id: fu.id })}
                                disabled={actionLoading === fu.id}
                                className="p-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 text-xs font-semibold transition shadow-xs"
                                title="Batalkan"
                              >
                                <XCircle size={12} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <Pagination
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        loading={loading}
        label={`Menampilkan ${totalItems > 0 ? ((page - 1) * 20) + 1 : 0} - ${Math.min(page * 20, totalItems)} dari ${totalItems} antrian`}
      />

      {/* Reschedule Modal */}
      {rescheduleModal.open && rescheduleModal.item && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          onClick={() => setRescheduleModal({ open: false })}
        >
          <div
            className="bg-white border border-[#e9edef] rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-[#111b21] flex items-center space-x-2">
              <Calendar className="text-[#008069]" size={18} />
              <span>Ubah Jadwal Kirim Follow-Up</span>
            </h3>

            <div className="text-xs text-[#54656f] space-y-1 bg-[#f8fafc] p-3 rounded-xl border border-[#e9edef]">
              <p><strong className="text-[#111b21]">Customer:</strong> {rescheduleModal.item.customer?.name} ({rescheduleModal.item.customer?.phone})</p>
              <p><strong className="text-[#111b21]">Tipe:</strong> {rescheduleModal.item.type} Stage {rescheduleModal.item.stage}</p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-[#111b21]">Jadwal Kirim Baru</label>
              <input
                type="datetime-local"
                value={rescheduleModal.newDate}
                onChange={(e) => setRescheduleModal({ ...rescheduleModal, newDate: e.target.value })}
                className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-[#e9edef]">
              <button
                onClick={() => setRescheduleModal({ open: false })}
                className="px-4 py-2 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] rounded-xl text-xs font-semibold transition"
              >
                Batal
              </button>
              <button
                onClick={handleRescheduleSave}
                className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-bold transition shadow-xs"
              >
                Simpan Jadwal Baru
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Modal untuk Queue / Bulk-Queue / Cancel / Bulk-Cancel / Send */}
      {confirmAction && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          onClick={() => setConfirmAction(null)}
        >
          <div
            className="bg-white border border-[#e9edef] rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-[#111b21] flex items-center space-x-2">
              {confirmAction.type === 'reschedule-overdue' ? (
                <><FastForward className="text-amber-600" size={18} /><span>Majukan & Rapikan Jadwal Overdue?</span></>
              ) : confirmAction.type === 'bulk-cancel' ? (
                <><Trash2 className="text-rose-600" size={18} /><span>Batalkan Semua Antrian Pending?</span></>
              ) : confirmAction.type === 'bulk-queue' ? (
                <><CalendarCheck className="text-blue-600" size={18} /><span>Jadwalkan Semua Antrian Pending?</span></>
              ) : confirmAction.type === 'cancel' ? (
                <><XCircle className="text-rose-600" size={18} /><span>Batalkan Follow-Up?</span></>
              ) : confirmAction.type === 'queue' ? (
                <><CalendarCheck className="text-blue-600" size={18} /><span>Jadwalkan Follow-Up?</span></>
              ) : (
                <><Send className="text-[#008069]" size={18} /><span>Setujui & Kirim Sekarang?</span></>
              )}
            </h3>
            <p className="text-xs text-[#54656f]">
              {confirmAction.type === 'reschedule-overdue'
                ? 'Seluruh follow-up berstatus PENDING yang jadwalnya sebelum hari ini akan dimajukan mulai dari hari ini/besok, dan dibagi merata maksimal 10 blast per hari pada jam kerja (09:00 - 16:00 WIB).'
                : confirmAction.type === 'bulk-cancel'
                ? 'Seluruh follow-up berstatus PENDING akan dibatalkan sekaligus dan tidak akan dikirim.'
                : confirmAction.type === 'bulk-queue'
                ? 'Seluruh follow-up berstatus PENDING akan dimasukkan ke antrian (QUEUED) dan dikirim otomatis sesuai tanggal & jam jadwal masing-masing.'
                : confirmAction.type === 'cancel'
                ? 'Follow-up ini akan dibatalkan dan tidak akan dikirim ke customer.'
                : confirmAction.type === 'queue'
                ? 'Follow-up ini akan dimasukkan ke antrian (QUEUED) dan dikirim otomatis sesuai tanggal & jam yang sudah disetup.'
                : 'Pesan follow-up akan langsung dikirim sekarang ke nomor WhatsApp customer.'}
            </p>
            <div className="flex justify-end space-x-2 pt-2 border-t border-[#e9edef]">
              <button
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] rounded-xl text-xs font-semibold transition"
              >
                Batal
              </button>
              <button
                onClick={() => {
                  const { type, id } = confirmAction;
                  setConfirmAction(null);
                  if (type === 'reschedule-overdue') handleRescheduleOverdue();
                  else if (type === 'bulk-cancel') handleBulkCancel();
                  else if (type === 'bulk-queue') handleBulkQueue();
                  else if (type === 'cancel' && id) handleCancel(id);
                  else if (type === 'queue' && id) handleQueue(id);
                  else if (type === 'send' && id) handleSendNow(id);
                }}
                disabled={actionLoading !== null}
                className={`px-4 py-2 text-white rounded-xl text-xs font-bold transition shadow-xs ${
                  confirmAction.type === 'reschedule-overdue'
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : confirmAction.type === 'cancel' || confirmAction.type === 'bulk-cancel'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : confirmAction.type === 'bulk-queue' || confirmAction.type === 'queue'
                    ? 'bg-blue-600 hover:bg-blue-700'
                    : 'bg-[#008069] hover:bg-[#00a884]'
                }`}
              >
                {actionLoading !== null
                  ? 'Memproses...'
                  : confirmAction.type === 'reschedule-overdue'
                  ? 'Ya, Majukan & Rapikan'
                  : confirmAction.type === 'bulk-cancel'
                  ? 'Ya, Batalkan Semua'
                  : confirmAction.type === 'bulk-queue'
                  ? 'Ya, Jadwalkan Semua'
                  : confirmAction.type === 'cancel'
                  ? 'Ya, Batalkan'
                  : confirmAction.type === 'queue'
                  ? 'Ya, Jadwalkan'
                  : 'Ya, Kirim'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMsg && (
        <div className={`fixed bottom-6 right-6 z-[70] px-4 py-3 rounded-xl border text-xs font-bold shadow-xl flex items-center space-x-2 ${
          toastMsg.type === 'success'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-rose-50 border-rose-200 text-rose-800'
        }`}>
          {toastMsg.type === 'success' ? <CheckCircle size={14} className="text-emerald-600" /> : <AlertCircle size={14} className="text-rose-600" />}
          <span>{toastMsg.text}</span>
          <button onClick={() => setToastMsg(null)} className="ml-2 text-[#8696a0] hover:text-[#111b21]">
            <XCircle size={13} />
          </button>
        </div>
      )}
    </div>
  );
};

export default FollowUpQueue;

