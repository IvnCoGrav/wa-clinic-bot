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
  X,
  RotateCcw,
  Loader2,
  FileText,
  Tag,
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
    id?: string;
    last_message_at: string;
    is_human_handling: boolean;
  }>;
}

interface FollowUpItem {
  id: string;
  type: string; // NO_PURCHASE | NEXT_TREATMENT | REMINDER_H1 | REVIEW_H1_BABY | REVIEW_H1_MOMS
  stage: number;
  custom_text?: string | null;
  scheduled_at: string;
  sent_at: string | null;
  status: string; // PENDING | QUEUED | SENT | CANCELLED | FAILED | SKIPPED
  customer: Customer | null;
  reservation?: {
    id: string;
    booking_date: string | null;
    treatment_category: string;
    treatment_detail: string | null;
  } | null;
}

interface TemplateItem {
  id: string | null;
  type: string;
  variant: number;
  text: string;
  isDefault: boolean;
}

export const FollowUpQueue: React.FC = () => {
  const [followUps, setFollowUps] = useState<FollowUpItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('upcoming'); // Default: Hari ini & ke depan
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

  // Available Templates Cache for previews & resets
  const [availableTemplates, setAvailableTemplates] = useState<TemplateItem[]>([]);

  // Chat History Modal
  const [chatModal, setChatModal] = useState<{
    open: boolean;
    customer: Customer | null;
    messages: any[];
    loading: boolean;
    replyText: string;
    sending: boolean;
  }>({
    open: false,
    customer: null,
    messages: [],
    loading: false,
    replyText: '',
    sending: false,
  });

  // Edit Modal (Date, Variant/Stage, and Custom Text)
  const [editModal, setEditModal] = useState<{
    open: boolean;
    item?: FollowUpItem;
    newDate: string;
    stage: number;
    customText: string;
  }>({
    open: false,
    newDate: '',
    stage: 1,
    customText: '',
  });

  const PAGE_SIZE = 20;

  // Pre-load templates
  useEffect(() => {
    apiRequest('follow-up-templates')
      .then((res) => {
        if (res && res.success && Array.isArray(res.data)) {
          setAvailableTemplates(res.data);
        }
      })
      .catch(() => {});
  }, []);

  const loadFollowUps = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (typeFilter) params.append('type', typeFilter);
      if (dateFilter) params.append('dateFilter', dateFilter);
      if (search) params.append('search', search);
      if (sortBy) params.append('sortBy', sortBy);
      if (sortOrder) params.append('sortOrder', sortOrder);
      params.append('page', String(page));
      params.append('pageSize', String(PAGE_SIZE));

      const endpoint = `follow-ups${params.toString() ? `?${params.toString()}` : ''}`;
      const res = await apiRequest(endpoint);
      const list = Array.isArray(res) ? res : res?.data || [];
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
  }, [statusFilter, typeFilter, dateFilter, page, sortBy, sortOrder]);

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
      setToastMsg({
        type: 'success',
        text: res.message || 'Semua antrian pending berhasil dijadwalkan ke status QUEUED.',
      });
      loadFollowUps();
    } catch (err: any) {
      setToastMsg({ type: 'error', text: `Gagal menjadwalkan semua antrian: ${err.message}` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleSendNow = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await apiRequest(`follow-ups/${id}/send-now`, { method: 'POST' });
      setToastMsg({ type: 'success', text: res.message || 'Follow-up berhasil dikirim!' });
      loadFollowUps();
    } catch (err: any) {
      setToastMsg({ type: 'error', text: `Gagal kirim: ${err.message}` });
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

  // Helper template finder
  const getTemplateTextForTypeAndVariant = (type: string, stage: number) => {
    let templateType = type;
    if (type === 'NO_PURCHASE') templateType = `NO_PURCHASE_${Math.min(3, Math.max(1, stage))}`;
    else if (type === 'NEXT_TREATMENT') templateType = `NEXT_TREATMENT_${Math.min(3, Math.max(1, stage))}`;

    const found = availableTemplates.find((t) => t.type === templateType && t.variant === stage);
    if (found && found.text) return found.text;

    if (type === 'NO_PURCHASE') {
      if (stage === 1) return 'Halo Bunda {name}! Bagaimana kabar hari ini? Kemarin sempat menanyakan perihal layanan kami, apakah ada yang bisa kami bantu jelaskan lebih lanjut bund? 😊';
      if (stage === 2) return 'Halo Bunda {name}! Semoga sehat selalu ya bund. Sekedar info, kami siap melayani homecare langsung ke rumah bunda dengan terapis bidan profesional lho. Apakah berkenan kami cek ketersediaan slotnya? 🌸';
      return 'Halo Bunda {name}! Jika bunda masih membutuhkan layanan baby/mom care, tim kami selalu siap membantu ya bund. Semoga bunda dan si kecil sehat selalu! ❤️';
    }

    if (type === 'NEXT_TREATMENT') {
      if (stage === 1) return 'Halo Bunda {name}! Sudah 1 bulan sejak treatment terakhir {babyName}. Bagaimana perkembangannya bund? Terapi/pijat rutin sangat baik untuk relaksasi dan stimulasi tumbuh kembang si kecil lho bund. Apakah ingin reservasi kembali? 😊';
      if (stage === 2) return 'Halo Bunda {name}! Waktunya perawatan berkala si kecil {babyName} nih bund. Terapis kami siap berkunjung lagi untuk memastikan si kecil tetap bugar dan ceria. Jadwalkan yuk bund? 🌸';
      return 'Halo Bunda {name}! Sudah 3 bulan berlalu, jangan lupa jadwalkan kembali sesi perawatan rutin {babyName} ya bund agar tumbuh kembangnya selalu optimal. Kami siap membantu reservasi! 💖';
    }

    return 'Halo Bunda {name}! Bagaimana kabarnya hari ini? Kami siap melayani bunda dan si kecil.';
  };

  // Open Edit Modal
  const handleOpenEdit = (item: FollowUpItem) => {
    const defaultText = getTemplateTextForTypeAndVariant(item.type, item.stage);
    setEditModal({
      open: true,
      item,
      newDate: item.scheduled_at ? item.scheduled_at.slice(0, 16) : '',
      stage: item.stage || 1,
      customText: item.custom_text || defaultText,
    });
  };

  // Switch Variant in Edit Modal
  const handleVariantSelect = (newStage: number) => {
    if (!editModal.item) return;
    const templateText = getTemplateTextForTypeAndVariant(editModal.item.type, newStage);
    setEditModal((prev) => ({
      ...prev,
      stage: newStage,
      customText: templateText,
    }));
  };

  // Save Edit Changes
  const handleEditSave = async () => {
    if (!editModal.item || !editModal.newDate) return;
    setActionLoading(editModal.item.id);
    try {
      await apiRequest(`follow-ups/${editModal.item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          scheduledAt: editModal.newDate,
          stage: editModal.stage,
          customText: editModal.customText,
        }),
      });
      setEditModal({ open: false, newDate: '', stage: 1, customText: '' });
      setToastMsg({ type: 'success', text: 'Perubahan follow-up berhasil disimpan!' });
      loadFollowUps();
    } catch (err: any) {
      setToastMsg({ type: 'error', text: `Gagal menyimpan: ${err.message}` });
    } finally {
      setActionLoading(null);
    }
  };

  // Open Chat History Modal
  const handleOpenChatHistory = async (customer: Customer) => {
    setChatModal({
      open: true,
      customer,
      messages: [],
      loading: true,
      replyText: '',
      sending: false,
    });
    try {
      const res = await apiRequest(`/api/admin/customers/${customer.id}/messages`);
      if (res && res.success) {
        setChatModal((prev) => ({ ...prev, messages: res.data || [], loading: false }));
      } else {
        setChatModal((prev) => ({ ...prev, loading: false }));
      }
    } catch (err: any) {
      setToastMsg({ type: 'error', text: `Gagal memuat chat: ${err.message}` });
      setChatModal((prev) => ({ ...prev, loading: false }));
    }
  };

  // Send Reply from Chat Modal
  const handleSendChatReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatModal.customer || !chatModal.replyText.trim() || chatModal.sending) return;
    const convId = chatModal.customer.conversations?.[0]?.id;
    setChatModal((prev) => ({ ...prev, sending: true }));
    try {
      if (convId) {
        await apiRequest(`/api/admin/live-chat/conversations/${convId}/reply`, {
          method: 'POST',
          body: JSON.stringify({ text: chatModal.replyText.trim() }),
        });
      } else {
        await apiRequest(`/api/admin/customers/${chatModal.customer.id}/reply`, {
          method: 'POST',
          body: JSON.stringify({ message: chatModal.replyText.trim() }),
        });
      }
      setToastMsg({ type: 'success', text: 'Pesan WhatsApp berhasil terkirim!' });
      setChatModal((prev) => ({ ...prev, replyText: '', sending: false }));

      // Refresh message list
      const res = await apiRequest(`/api/admin/customers/${chatModal.customer.id}/messages`);
      if (res && res.success) {
        setChatModal((prev) => ({ ...prev, messages: res.data || [] }));
      }
    } catch (err: any) {
      setToastMsg({ type: 'error', text: `Gagal mengirim balasan: ${err.message}` });
      setChatModal((prev) => ({ ...prev, sending: false }));
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
    if (type === 'REMINDER_H1') {
      return {
        label: `Reminder Treatment (H-1 Malam)`,
        color: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20',
      };
    }
    if (type === 'REVIEW_H1_BABY') {
      return {
        label: `Review H+1 Baby Care`,
        color: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
      };
    }
    if (type === 'REVIEW_H1_MOMS') {
      return {
        label: `Review H+1 Mom Care`,
        color: 'bg-pink-500/10 text-pink-600 border-pink-500/20',
      };
    }
    return { label: `${type} #${stage}`, color: 'bg-slate-500/10 text-slate-600 border-slate-500/20' };
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
            <Clock size={11} />
            <span>PENDING</span>
          </span>
        );
      case 'QUEUED':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 animate-pulse">
            <CalendarCheck size={11} />
            <span>QUEUED</span>
          </span>
        );
      case 'SENT':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle size={11} />
            <span>SENT</span>
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
            <XCircle size={11} />
            <span>CANCELLED</span>
          </span>
        );
      case 'SKIPPED':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-300">
            <AlertCircle size={11} />
            <span>SKIPPED</span>
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300">
            <AlertCircle size={11} />
            <span>FAILED</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-50 text-slate-600 border border-slate-200">
            <span>{status}</span>
          </span>
        );
    }
  };

  const renderSortIndicator = (field: string) => {
    if (sortBy !== field) {
      return <ArrowUpDown size={12} className="text-[#8696a0] opacity-40 group-hover:opacity-100" />;
    }
    return sortOrder === 'asc' ? (
      <ArrowUp size={12} className="text-[#008069] font-bold" />
    ) : (
      <ArrowDown size={12} className="text-[#008069] font-bold" />
    );
  };

  return (
    <div className="space-y-5 animate-fadeIn pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#e9edef]">
        <div className="flex items-center space-x-3.5">
          <div className="h-12 w-12 rounded-2xl bg-[#008069] text-white flex items-center justify-center shadow-sm shrink-0">
            <CalendarCheck size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-black text-[#111b21] tracking-tight">Antrian Follow-Up</h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-[#e8f5f2] text-[#008069] border border-[#c2e7e0]">
                {totalItems} Antrian
              </span>
            </div>
            <p className="text-xs text-[#54656f] mt-1 flex items-center gap-1.5 font-medium">
              <Clock size={13} className="text-[#008069] shrink-0" />
              Kelola jadwal kirim otomatis (No Purchase, Treatment Lanjutan, Review & Reminder).
            </p>
          </div>
        </div>

        {/* Global Bulk Actions */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setConfirmAction({ type: 'bulk-queue' })}
            disabled={actionLoading !== null}
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition shadow-xs flex items-center space-x-1.5 text-xs font-bold"
            title="Jadwalkan seluruh follow-up pending ke antrian QUEUED"
          >
            <CalendarCheck size={14} />
            <span>Jadwalkan Semua Pending</span>
          </button>

          <button
            onClick={() => setConfirmAction({ type: 'reschedule-overdue' })}
            disabled={actionLoading !== null}
            className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl transition shadow-xs flex items-center space-x-1.5 text-xs font-bold"
            title="Majukan follow-up overdue mulai hari ini/besok (maks 10 blast/hari)"
          >
            <FastForward size={14} />
            <span>Majukan Overdue</span>
          </button>

          <button
            onClick={() => setConfirmAction({ type: 'bulk-cancel' })}
            disabled={actionLoading !== null}
            className="px-3.5 py-2 bg-white hover:bg-rose-50 border border-rose-200 text-rose-600 rounded-xl transition shadow-xs flex items-center space-x-1.5 text-xs font-bold"
            title="Batalkan seluruh antrian pending"
          >
            <Trash2 size={14} />
            <span>Batalkan Pending</span>
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
            Pesan berstatus <strong>QUEUED</strong> akan terkirim otomatis tepat pada tanggal & jam yang sudah disetup (maksimal 10 blast per hari pada jam kerja).
            Dilengkapi <strong>Smart Context Guard</strong>: jika customer baru saja aktif chat (&lt;3 hari terakhir), jadwal otomatis dimundurkan agar tidak menimpa obrolan baru.
            Admin juga dapat mengklik tombol <strong>Chat</strong> untuk membuka modal riwayat obrolan langsung di sini tanpa pindah halaman.
          </p>
        </div>
      </div>

      {/* Filters & Search Bar */}
      <div className="bg-white border border-[#e9edef] rounded-2xl p-4 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          <Filter size={15} className="text-[#008069] flex-shrink-0" />

          {/* Date Filter Dropdown */}
          <select
            value={dateFilter}
            onChange={(e) => {
              setDateFilter(e.target.value);
              setPage(1);
            }}
            className="p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs font-medium"
          >
            <option value="upcoming">📅 Hari Ini & Ke Depan (Upcoming)</option>
            <option value="all">📅 Semua Tanggal</option>
            <option value="today">📅 Hari Ini Saja</option>
            <option value="this_week">📅 Minggu Ini</option>
            <option value="this_month">📅 Bulan Ini</option>
            <option value="overdue">⚠️ Lewat Jadwal (Overdue)</option>
          </select>

          {/* Status Filter Dropdown */}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
          >
            <option value="">Semua Status</option>
            <option value="QUEUED">QUEUED (Terjadwal di Antrian)</option>
            <option value="PENDING">PENDING (Menunggu Persetujuan)</option>
            <option value="SENT">SENT (Sudah Terkirim)</option>
            <option value="CANCELLED">CANCELLED (Dibatalkan)</option>
            <option value="SKIPPED">SKIPPED (Dilewati/Kadaluarsa)</option>
            <option value="FAILED">FAILED (Gagal)</option>
          </select>

          {/* Type Filter Dropdown */}
          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(1);
            }}
            className="p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
          >
            <option value="">Semua Tipe</option>
            <option value="REMINDER_H1">Reminder Treatment (H-1 Malam)</option>
            <option value="REVIEW_H1_BABY">Review H+1 Treatment Bayi</option>
            <option value="REVIEW_H1_MOMS">Review H+1 Treatment Moms</option>
            <option value="NO_PURCHASE">Belum Purchase (+3, +7, +14 Hari)</option>
            <option value="NEXT_TREATMENT">Treatment Lanjutan (+1, +2, +3 Bulan)</option>
          </select>

          {/* Quick Sort Dropdown */}
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
              className="p-1 bg-transparent text-xs text-[#111b21] focus:outline-none border-0"
            >
              <option value="scheduled_at:asc">Urutkan: Jadwal Terdekat (ASC)</option>
              <option value="scheduled_at:desc">Urutkan: Jadwal Terjauh (DESC)</option>
              <option value="created_at:desc">Urutkan: Terbaru Dibuat</option>
              <option value="customer_name:asc">Urutkan: Nama Customer (A-Z)</option>
              <option value="type:asc">Urutkan: Tipe Follow-Up</option>
              <option value="status:asc">Urutkan: Status</option>
            </select>
          </div>
        </div>

        {/* Search Bar */}
        <form onSubmit={handleSearchSubmit} className="relative w-full lg:w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8696a0]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama / nomor WhatsApp..."
            className="w-full pl-8 pr-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs"
          />
        </form>
      </div>

      {/* Main Table */}
      <div className="bg-white border border-[#e9edef] rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#f8fafc] border-b border-[#e9edef] text-[#54656f] text-xs font-bold uppercase tracking-wider">
                <th
                  onClick={() => handleSort('scheduled_at')}
                  className="px-4 py-3.5 cursor-pointer hover:bg-[#f0f2f5] transition select-none group"
                >
                  <div className="flex items-center space-x-1">
                    <span>Jadwal Kirim</span>
                    {renderSortIndicator('scheduled_at')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('type')}
                  className="px-4 py-3.5 cursor-pointer hover:bg-[#f0f2f5] transition select-none group"
                >
                  <div className="flex items-center space-x-1">
                    <span>Tipe & Tahap</span>
                    {renderSortIndicator('type')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('customer_name')}
                  className="px-4 py-3.5 cursor-pointer hover:bg-[#f0f2f5] transition select-none group"
                >
                  <div className="flex items-center space-x-1">
                    <span>Customer & Konteks Chat</span>
                    {renderSortIndicator('customer_name')}
                  </div>
                </th>
                <th className="px-4 py-3.5">Template / Pesan</th>
                <th
                  onClick={() => handleSort('status')}
                  className="px-4 py-3.5 cursor-pointer hover:bg-[#f0f2f5] transition select-none group"
                >
                  <div className="flex items-center space-x-1">
                    <span>Status</span>
                    {renderSortIndicator('status')}
                  </div>
                </th>
                <th className="px-4 py-3.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e9edef]">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-[#667781] text-xs">
                    <div className="flex justify-center items-center space-x-2">
                      <RefreshCw size={14} className="animate-spin text-[#008069]" />
                      <span>Memuat data antrian follow-up...</span>
                    </div>
                  </td>
                </tr>
              ) : followUps.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-[#667781] text-xs">
                    <CalendarCheck size={28} className="mx-auto text-[#8696a0] mb-2 opacity-50" />
                    <p className="font-semibold text-[#111b21]">Tidak ada antrian follow-up yang sesuai filter.</p>
                    <p className="text-[#8696a0] mt-0.5">
                      Coba ganti filter status, filter tanggal, atau bersihkan kata kunci pencarian.
                    </p>
                  </td>
                </tr>
              ) : (
                followUps.map((fu) => {
                  const dt = formatDateTime(fu.scheduled_at);
                  const typeMeta = getTypeLabel(fu.type, fu.stage);
                  const c = fu.customer;
                  const isOverdue = new Date(fu.scheduled_at).getTime() < Date.now() && (fu.status === 'PENDING' || fu.status === 'QUEUED');

                  return (
                    <tr key={fu.id} className="hover:bg-[#f8fafc] transition">
                      {/* Jadwal Kirim */}
                      <td className="px-4 py-3.5 text-xs">
                        <div className="font-semibold text-[#111b21] flex items-center space-x-1">
                          <Calendar size={12} className="text-[#8696a0]" />
                          <span>{dt.date}</span>
                        </div>
                        <div className="text-[11px] text-[#667781] flex items-center space-x-1 mt-0.5">
                          <Clock size={10} className="text-[#8696a0]" />
                          <span>{dt.time}</span>
                          {isOverdue && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-300 ml-1">
                              Overdue
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Tipe & Tahap */}
                      <td className="px-4 py-3.5 text-xs">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border ${typeMeta.color}`}
                        >
                          {typeMeta.label}
                        </span>
                      </td>

                      {/* Customer & Konteks Chat */}
                      <td className="px-4 py-3.5 text-xs">
                        <div className="flex items-center space-x-1.5 font-semibold text-[#111b21]">
                          <User size={12} className="text-[#8696a0]" />
                          <span className="truncate max-w-[170px]">{c?.name || 'Tanpa Nama'}</span>
                          {c?.conversations?.[0]?.is_human_handling && (
                            <span
                              className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-300"
                              title="Sedang/Pernah dikelola manual oleh Admin"
                            >
                              Human Handling
                            </span>
                          )}
                        </div>
                        <div className="flex items-center space-x-2 text-[10px] text-[#667781] font-mono ml-4 mt-0.5">
                          <span>{c?.phone}</span>
                          {c?.conversations?.[0]?.last_message_at && (
                            <span
                              className={`flex items-center space-x-0.5 px-1 py-0.2 rounded text-[9px] ${
                                Date.now() - new Date(c.conversations[0].last_message_at).getTime() < 72 * 60 * 60 * 1000
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
                        {fu.reservation?.treatment_detail && (
                          <div
                            className="text-[10px] text-slate-500 truncate max-w-[220px] ml-4 mt-0.5"
                            title={fu.reservation.treatment_detail}
                          >
                            📋 {fu.reservation.treatment_detail}
                          </div>
                        )}
                      </td>

                      {/* Template / Pesan */}
                      <td className="px-4 py-3.5 text-xs text-[#54656f]">
                        <div className="flex items-center space-x-1">
                          <Sparkles size={11} className="text-amber-500 flex-shrink-0" />
                          <span className="font-semibold">Varian #{((fu.stage - 1) % 3) + 1}</span>
                          {fu.custom_text && (
                            <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-purple-50 text-purple-700 border border-purple-200 ml-1">
                              Custom Text
                            </span>
                          )}
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
                              <button
                                onClick={() => fu.customer && handleOpenChatHistory(fu.customer)}
                                className="p-1.5 rounded-xl bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] hover:text-[#008069] text-xs font-semibold transition shadow-xs flex items-center"
                                title="Buka Riwayat Chat Modal"
                              >
                                <MessageSquare size={12} />
                              </button>
                              <button
                                onClick={() => handleOpenEdit(fu)}
                                disabled={actionLoading === fu.id}
                                className="p-1.5 rounded-xl bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] hover:text-[#111b21] text-xs font-semibold transition shadow-xs"
                                title="Edit Jadwal & Pesan"
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
                              <button
                                onClick={() => fu.customer && handleOpenChatHistory(fu.customer)}
                                className="p-1.5 rounded-xl bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] hover:text-[#008069] text-xs font-semibold transition shadow-xs flex items-center"
                                title="Buka Riwayat Chat Modal"
                              >
                                <MessageSquare size={12} />
                              </button>
                              <button
                                onClick={() => handleOpenEdit(fu)}
                                disabled={actionLoading === fu.id}
                                className="p-1.5 rounded-xl bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] hover:text-[#111b21] text-xs font-semibold transition shadow-xs"
                                title="Edit Jadwal & Pesan"
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
                          {fu.status !== 'PENDING' && fu.status !== 'QUEUED' && (
                            <button
                              onClick={() => fu.customer && handleOpenChatHistory(fu.customer)}
                              className="p-1.5 rounded-xl bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] hover:text-[#008069] text-xs font-semibold transition shadow-xs flex items-center"
                              title="Buka Riwayat Chat Modal"
                            >
                              <MessageSquare size={12} />
                            </button>
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
        label={`Menampilkan ${totalItems > 0 ? (page - 1) * 20 + 1 : 0} - ${Math.min(page * 20, totalItems)} dari ${totalItems} antrian`}
      />

      {/* Modal 1: Edit Follow-Up Modal (Date, Variant & Text Editor) */}
      {editModal.open && editModal.item && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          onClick={() => setEditModal({ open: false, newDate: '', stage: 1, customText: '' })}
        >
          <div
            className="bg-white border border-[#e9edef] rounded-2xl p-6 w-full max-w-xl space-y-4 shadow-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center pb-3 border-b border-[#e9edef]">
              <h3 className="text-base font-bold text-[#111b21] flex items-center space-x-2">
                <Edit2 className="text-[#008069]" size={18} />
                <span>Edit Follow-Up: Jadwal, Varian & Teks Pesan</span>
              </h3>
              <button
                onClick={() => setEditModal({ open: false, newDate: '', stage: 1, customText: '' })}
                className="p-1 rounded-lg text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5] transition"
              >
                <X size={16} />
              </button>
            </div>

            {/* Customer & Info Banner */}
            <div className="text-xs text-[#54656f] space-y-1 bg-[#f8fafc] p-3 rounded-xl border border-[#e9edef]">
              <p>
                <strong className="text-[#111b21]">Customer:</strong> {editModal.item.customer?.name || 'Tanpa Nama'} (
                {editModal.item.customer?.phone})
              </p>
              <p>
                <strong className="text-[#111b21]">Tipe Follow-Up:</strong> {getTypeLabel(editModal.item.type, editModal.stage).label}
              </p>
            </div>

            {/* Field 1: Jadwal Kirim */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-[#111b21] flex items-center space-x-1">
                <Calendar size={13} className="text-[#008069]" />
                <span>Jadwal Kirim</span>
              </label>
              <input
                type="datetime-local"
                value={editModal.newDate}
                onChange={(e) => setEditModal({ ...editModal, newDate: e.target.value })}
                className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
              />
            </div>

            {/* Field 2: Pilihan Varian (Stage 1 / 2 / 3) */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-[#111b21] flex items-center space-x-1">
                  <Sparkles size={13} className="text-amber-500" />
                  <span>Pilih Varian Rolling / Tahap</span>
                </label>
                <span className="text-[10px] text-[#8696a0]">Klik varian untuk memuat template defaultnya</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => handleVariantSelect(v)}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center space-x-1.5 ${
                      editModal.stage === v
                        ? 'bg-[#e8f5f2] border-[#008069] text-[#008069] shadow-xs'
                        : 'bg-white border-[#d1d7db] text-[#54656f] hover:bg-[#f8fafc]'
                    }`}
                  >
                    <span>Varian #{v}</span>
                    {editModal.stage === v && <CheckCircle size={12} className="text-[#008069]" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Field 3: Teks Pesan Follow-Up */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-[#111b21] flex items-center space-x-1">
                  <FileText size={13} className="text-[#008069]" />
                  <span>Teks Pesan Follow-Up</span>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    if (editModal.item) {
                      const defaultText = getTemplateTextForTypeAndVariant(editModal.item.type, editModal.stage);
                      setEditModal((prev) => ({ ...prev, customText: defaultText }));
                    }
                  }}
                  className="text-[11px] text-[#008069] hover:underline flex items-center space-x-1 font-semibold"
                >
                  <RotateCcw size={10} />
                  <span>Reset ke Template Default</span>
                </button>
              </div>

              <textarea
                rows={5}
                value={editModal.customText}
                onChange={(e) => setEditModal({ ...editModal, customText: e.target.value })}
                placeholder="Tulis pesan follow-up kustom untuk pelanggan ini..."
                className="w-full p-3 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs leading-relaxed font-sans"
              />

              {/* Tag Helpers */}
              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                <span className="text-[10px] text-[#8696a0] flex items-center gap-1">
                  <Tag size={10} /> Variabel:
                </span>
                {['{name}', '{babyName}', '{time}'].map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setEditModal((prev) => ({ ...prev, customText: `${prev.customText} ${tag}` }))}
                    className="px-2 py-0.5 rounded-lg bg-[#f0f2f5] hover:bg-[#e9edef] text-[10px] font-mono text-[#54656f] border border-[#d1d7db] transition"
                  >
                    + {tag}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-[#8696a0] leading-tight">
                * Variabel <code>{'{name}'}</code> akan otomatis disanitasi menjadi sapaan bersih (misal: "Bunda Rina").
              </p>
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end space-x-2 pt-3 border-t border-[#e9edef]">
              <button
                type="button"
                onClick={() => setEditModal({ open: false, newDate: '', stage: 1, customText: '' })}
                className="px-4 py-2 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] rounded-xl text-xs font-semibold transition"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleEditSave}
                disabled={actionLoading === editModal.item.id}
                className="px-5 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-bold transition shadow-xs flex items-center space-x-1.5"
              >
                {actionLoading === editModal.item.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                <span>Simpan Perubahan</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Chat History Modal */}
      {chatModal.open && chatModal.customer && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setChatModal((prev) => ({ ...prev, open: false }))}
        >
          <div
            className="bg-white border border-[#e9edef] rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 border-b border-[#e9edef] flex justify-between items-center bg-[#f8fafc]">
              <div>
                <h3 className="font-bold text-[#111b21] text-sm flex items-center space-x-2">
                  <MessageSquare size={16} className="text-[#008069]" />
                  <span>Riwayat Chat: {chatModal.customer.name || 'Customer'}</span>
                </h3>
                <p className="text-[11px] text-[#667781] mt-0.5">
                  {chatModal.customer.phone} • {chatModal.customer.kelurahan || chatModal.customer.kecamatan || chatModal.customer.kota || 'Surabaya/Sidoarjo'}
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <a
                  href="/admin/live-chat"
                  target="_blank"
                  rel="noreferrer"
                  className="px-2.5 py-1 rounded-xl bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] text-xs font-medium transition flex items-center space-x-1"
                  title="Buka Halaman Live Chat di Tab Baru"
                >
                  <ExternalLink size={12} />
                  <span>Live Chat Tab</span>
                </a>
                <button
                  onClick={() => setChatModal((prev) => ({ ...prev, open: false }))}
                  className="p-1.5 rounded-lg text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5] transition"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Modal Body: Message Stream with WhatsApp Pattern Background */}
            <div
              className="p-4 overflow-y-auto flex-1 space-y-3 bg-[#efeae2] min-h-[320px]"
              style={{
                backgroundImage: `radial-gradient(#d1d7db 0.75px, transparent 0.75px)`,
                backgroundSize: '16px 16px',
              }}
            >
              {chatModal.loading ? (
                <div className="flex justify-center items-center py-16">
                  <Loader2 className="animate-spin text-[#008069]" size={32} />
                </div>
              ) : chatModal.messages.length === 0 ? (
                <div className="text-center py-16 text-[#667781] text-xs">
                  Belum ada riwayat pesan tercatat untuk customer ini.
                </div>
              ) : (
                chatModal.messages.map((msg) => {
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
                })
              )}
            </div>

            {/* Modal Footer: Quick Reply Bar */}
            <form onSubmit={handleSendChatReply} className="p-3 border-t border-[#e9edef] bg-[#f8fafc] flex items-center space-x-2">
              <input
                type="text"
                value={chatModal.replyText}
                onChange={(e) => setChatModal({ ...chatModal, replyText: e.target.value })}
                placeholder="Ketik balasan WhatsApp langsung ke nomor ini..."
                className="flex-1 px-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs"
              />
              <button
                type="submit"
                disabled={chatModal.sending || !chatModal.replyText.trim()}
                className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] disabled:opacity-50 text-white rounded-xl text-xs font-bold transition shadow-xs flex items-center space-x-1.5 shrink-0"
              >
                {chatModal.sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                <span>Kirim</span>
              </button>
            </form>
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
                <>
                  <FastForward className="text-amber-600" size={18} />
                  <span>Majukan & Rapikan Jadwal Overdue?</span>
                </>
              ) : confirmAction.type === 'bulk-cancel' ? (
                <>
                  <Trash2 className="text-rose-600" size={18} />
                  <span>Batalkan Semua Antrian Pending?</span>
                </>
              ) : confirmAction.type === 'bulk-queue' ? (
                <>
                  <CalendarCheck className="text-blue-600" size={18} />
                  <span>Jadwalkan Semua Antrian Pending?</span>
                </>
              ) : confirmAction.type === 'cancel' ? (
                <>
                  <XCircle className="text-rose-600" size={18} />
                  <span>Batalkan Follow-Up?</span>
                </>
              ) : confirmAction.type === 'queue' ? (
                <>
                  <CalendarCheck className="text-blue-600" size={18} />
                  <span>Jadwalkan Follow-Up?</span>
                </>
              ) : (
                <>
                  <Send className="text-[#008069]" size={18} />
                  <span>Setujui & Kirim Sekarang?</span>
                </>
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
        <div
          className={`fixed bottom-6 right-6 z-[70] px-4 py-3 rounded-xl border text-xs font-bold shadow-xl flex items-center space-x-2 ${
            toastMsg.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {toastMsg.type === 'success' ? (
            <CheckCircle size={14} className="text-emerald-600" />
          ) : (
            <AlertCircle size={14} className="text-rose-600" />
          )}
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
