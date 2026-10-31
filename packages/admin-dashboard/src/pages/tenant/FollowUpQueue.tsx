import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { apiRequest } from '../../services/api';
import { Pagination } from '../../components/common/Pagination';
import { ChatHistoryModal } from '../../components/modals/ChatHistoryModal';
import { FollowUpTemplates } from './FollowUpTemplates';
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
  Eye,
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
  Phone,
  MapPin,
  ChevronRight,
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
  customer_id?: string;
  variant?: number; // 1..3 — dihitung backend via getRollingVariant (WIB)
  type: string; // NO_PURCHASE | NEXT_TREATMENT | REMINDER_H1 | REVIEW_H1_BABY | REVIEW_H1_MOMS
  stage: number;
  // Fase 2: kategori treatment yang menentukan keluarga template (MOMS vs ANAK).
  treatment_category?: string | null;
  custom_text?: string | null;
  scheduled_at: string;
  sent_at: string | null;
  status: string; // PENDING | QUEUED | SENT | CANCELLED | FAILED | SKIPPED
  cancel_reason?: string | null;
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
  const [searchParams, setSearchParams] = useSearchParams();
  const activeMainTab = (searchParams.get('tab') === 'templates' ? 'TEMPLATES' : 'QUEUE') as 'QUEUE' | 'TEMPLATES';
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

  // Available Templates Cache for previews & resets
  const [availableTemplates, setAvailableTemplates] = useState<TemplateItem[]>([]);

  // Confirmation Modal
  const [confirmAction, setConfirmAction] = useState<{
    type: 'cancel' | 'send' | 'bulk-cancel' | 'queue' | 'bulk-queue' | 'reschedule-overdue';
    id?: string;
  } | null>(null);

  // Alasan pembatalan manual (opsional) — dikirim ke backend sebagai cancel_reason.
  const [confirmReason, setConfirmReason] = useState('');

  // Chat History Modal — render, fetch & quick-reply dimiliki ChatHistoryModal
  // terpusat (mode reply via endpoint live-chat valid; tanpa fallback 404).
  const [chatModal, setChatModal] = useState<{
    open: boolean;
    customer: Customer | null;
  }>({
    open: false,
    customer: null,
  });

  // Edit Modal (Date, Stage, Variant, and Custom Text)
  const [editModal, setEditModal] = useState<{
    open: boolean;
    item?: FollowUpItem;
    newDate: string;
    stage: number;
    variant: number;
    customText: string;
  }>({
    open: false,
    newDate: '',
    stage: 1,
    variant: 1,
    customText: '',
  });

  const PAGE_SIZE = 20;

  // Global ESC key listener to close modals (chat modal menutup diri sendiri
  // via capture-phase listener di ChatHistoryModal).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editModal.open) setEditModal({ open: false, newDate: '', stage: 1, variant: 1, customText: '' });
        if (confirmAction) {
          setConfirmAction(null);
          setConfirmReason('');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editModal.open, confirmAction]);

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

  const loadFollowUps = useCallback(async () => {
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
  }, [statusFilter, typeFilter, dateFilter, search, sortBy, sortOrder, page]);

  useEffect(() => {
    loadFollowUps();
  }, [loadFollowUps]);

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
        body: JSON.stringify({ maxPerDay: 40 }),
      });
      setToastMsg({
        type: 'success',
        text: res.message || 'Follow-up overdue berhasil dimajukan dan dijadwalkan (maks 40 blast/hari)!',
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

  const handleRetry = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await apiRequest(`follow-ups/${id}/retry`, { method: 'POST' });
      setToastMsg({ type: 'success', text: res.message || 'Follow-up dijadwalkan ulang untuk dikirim.' });
      loadFollowUps();
    } catch (err: any) {
      setToastMsg({ type: 'error', text: `Gagal coba ulang: ${err.message}` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (id: string, reason?: string) => {
    setActionLoading(id);
    try {
      await apiRequest(`follow-ups/${id}/cancel`, {
        method: 'PATCH',
        body: JSON.stringify({ reason: reason?.trim() || undefined }),
      });
      setToastMsg({ type: 'success', text: 'Follow-up berhasil dibatalkan.' });
      loadFollowUps();
    } catch (err: any) {
      setToastMsg({ type: 'error', text: `Gagal membatalkan: ${err.message}` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleBulkCancel = async (reason?: string) => {
    setActionLoading('bulk-cancel');
    try {
      const res = await apiRequest('follow-ups/bulk-cancel', {
        method: 'POST',
        body: JSON.stringify({ status: 'PENDING', reason: reason?.trim() || undefined }),
      });
      setToastMsg({ type: 'success', text: res.message || 'Semua antrian pending berhasil dibatalkan.' });
      loadFollowUps();
    } catch (err: any) {
      setToastMsg({ type: 'error', text: `Gagal membatalkan antrian: ${err.message}` });
    } finally {
      setActionLoading(null);
    }
  };

  const closeConfirmModal = () => {
    setConfirmAction(null);
    setConfirmReason('');
  };

  // Helpers varian — byte-identik dengan backend (WIB), fallback hanya untuk data lama tanpa field variant
  const getWibDateKey = (iso?: string | null) => {
    if (!iso) return '';
    const d = new Date(iso as string);
    if (isNaN(d.getTime())) return '';
    return new Date(d.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  };
  const fallbackRollingVariant = (fu: FollowUpItem): number => {
    const cid = fu.customer_id || fu.customer?.id || '';
    const str = `${cid}-${getWibDateKey(fu.scheduled_at)}`;
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; }
    return (Math.abs(h) % 3) + 1;
  };
  const effectiveVariant = (fu: FollowUpItem): number => {
    const v = Number(fu.variant);
    return v >= 1 && v <= 3 ? v : fallbackRollingVariant(fu);
  };

  // Kategori treatment efektif baris follow-up (state baris -> relasi reservasi).
  const resolveCategory = (fu?: FollowUpItem | null): string | null =>
    (fu?.treatment_category ?? fu?.reservation?.treatment_category ?? null) || null;

  // Helper template finder — DB-driven (tenant-aware). Fallback hanya generik.
  // Fase 2: keluarga template mengikuti kategori treatment (MOMS vs ANAK),
  // paritas dengan backend `resolveNextTreatmentTemplateType`.
  const getTemplateTextForTypeAndVariant = (
    type: string,
    stage: number,
    variant: number = 1,
    category?: string | null
  ) => {
    const stageKey = Math.min(3, Math.max(1, stage));
    let templateType = type;
    if (type === 'NO_PURCHASE') templateType = `NO_PURCHASE_${stageKey}`;
    else if (type === 'NEXT_TREATMENT') {
      const isMoms = String(category || '').toUpperCase() === 'MOMS';
      templateType = isMoms ? `NEXT_TREATMENT_MOMS_${stageKey}` : `NEXT_TREATMENT_${stageKey}`;
    }
    const v = Math.min(3, Math.max(1, variant));
    const found = availableTemplates.find((t) => t.type === templateType && t.variant === v);
    if (found && found.text) return found.text;
    return 'Halo Bunda {name}! Bagaimana kabarnya hari ini? Kami siap melayani bunda dan si kecil.';
  };

  // Preview jujur (Fase 5): TIDAK memakai nama dummy hardcoded. Nilai kosong
  // ditampilkan sebagai penanda eksplisit agar admin tidak mengira itu data nyata.
  const editCategory = resolveCategory(editModal.item);
  const editCustomer = (editModal.item?.customer as any) || null;
  const editHonorific =
    String(editCustomer?.preferences?.genderGreeting || '').toLowerCase() === 'bapak' ? 'Bapak' : 'Bunda';
  const editFirstName = editCustomer?.name?.split(' ')[0] || '[nama customer]';
  const editBabyLabel = editCustomer?.children?.[0]?.name
    ? `dek ${editCustomer.children[0].name}`
    : '[nama anak belum ada]';

  // Open Edit Modal — default varian = varian efektif baris tersebut
  const handleOpenEdit = (item: FollowUpItem) => {
    const ev = effectiveVariant(item);
    const defaultText = getTemplateTextForTypeAndVariant(item.type, item.stage, ev, resolveCategory(item));
    setEditModal({
      open: true,
      item,
      newDate: item.scheduled_at ? item.scheduled_at.slice(0, 16) : '',
      stage: item.stage || 1,
      variant: ev,
      customText: item.custom_text || defaultText,
    });
  };

  // Switch Variant in Edit Modal - hanya ganti gaya bahasa, TIDAK ubah stage/jadwal
  const handleVariantSelect = (newVariant: number) => {
    if (!editModal.item) return;
    const templateText = getTemplateTextForTypeAndVariant(editModal.item.type, editModal.stage, newVariant, resolveCategory(editModal.item));
    setEditModal((prev) => ({
      ...prev,
      variant: newVariant,
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
      setEditModal({ open: false, newDate: '', stage: 1, variant: 1, customText: '' });
      setToastMsg({ type: 'success', text: 'Perubahan follow-up berhasil disimpan!' });
      loadFollowUps();
    } catch (err: any) {
      setToastMsg({ type: 'error', text: `Gagal menyimpan: ${err.message}` });
    } finally {
      setActionLoading(null);
    }
  };

  // Open Chat History Modal — fetch & render dimiliki ChatHistoryModal terpusat.
  const handleOpenChatHistory = (customer: Customer) => {
    setChatModal({ open: true, customer });
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
        color: 'bg-warning/10 text-warning border-warning/20',
      };
    }
    if (type === 'NEXT_TREATMENT') {
      return {
        label: `Treatment Lanjutan (+${stage} Bulan)`,
        color: 'bg-violet/10 text-violet border-violet/20',
      };
    }
    if (type === 'REMINDER_H1') {
      return {
        label: `Reminder Treatment (H-1 Malam)`,
        color: 'bg-info/10 text-info border-info/20',
      };
    }
    if (type === 'REVIEW_H1_BABY') {
      return {
        label: `Review H+1 Baby Care`,
        color: 'bg-info/10 text-info border-info/20',
      };
    }
    if (type === 'REVIEW_H1_MOMS') {
      return {
        label: `Review H+1 Mom Care`,
        color: 'bg-danger/10 text-danger border-danger/20',
      };
    }
    if (type === 'WINBACK_60D') {
      return {
        label: `Re-engagement (>60 Hari)`,
        color: 'bg-warning-soft text-warning border-warning-line',
      };
    }
    return { label: `${type} #${stage}`, color: 'bg-fill-2/10 text-ink-2 border-strong/20' };
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-warning-soft text-warning border border-warning-line">
            <Clock size={11} />
            <span>PENDING</span>
          </span>
        );
      case 'QUEUED':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-info-soft text-info border border-info-line">
            <CalendarCheck size={11} />
            <span>QUEUED</span>
          </span>
        );
      case 'SENT':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-success-soft text-success border border-success-line">
            <CheckCircle size={11} />
            <span>SENT</span>
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-danger-soft text-danger border border-danger-line">
            <XCircle size={11} />
            <span>CANCELLED</span>
          </span>
        );
      case 'SKIPPED':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-fill-1 text-ink border border-strong">
            <AlertCircle size={11} />
            <span>SKIPPED</span>
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-danger-soft text-danger border border-danger-line">
            <AlertCircle size={11} />
            <span>FAILED</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-surface-2 text-ink-2 border border-divider">
            <span>{status}</span>
          </span>
        );
    }
  };

  // Badge status + sub-keterangan alasan pembatalan (CANCELLED / SKIPPED).
  const renderStatusCell = (fu: FollowUpItem) => (
    <div className="flex flex-col items-start gap-0.5">
      {getStatusBadge(fu.status)}
      {fu.cancel_reason && (fu.status === 'CANCELLED' || fu.status === 'SKIPPED') && (
        <span
          className="text-[9px] text-ink-2 italic block max-w-[170px] truncate"
          title={`Alasan: ${fu.cancel_reason}`}
        >
          Alasan: {fu.cancel_reason}
        </span>
      )}
    </div>
  );

  const renderSortIndicator = (field: string) => {
    if (sortBy !== field) {
      return <ArrowUpDown size={12} className="text-ink-3 opacity-40 group-hover:opacity-100 transition" />;
    }
    return sortOrder === 'asc' ? (
      <ArrowUp size={12} className="text-accent font-bold" />
    ) : (
      <ArrowDown size={12} className="text-accent font-bold" />
    );
  };

  return (
    <div className="space-y-5 animate-fadeIn pb-12">
      {/* Top-level Tabs: Queue vs Templates */}
      <div className="flex items-center gap-2 border-b border-divider pb-0">
        <button
          onClick={() => setSearchParams({}, { replace: true })}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition -mb-px ${activeMainTab === 'QUEUE' ? 'border-accent text-accent' : 'border-transparent text-ink-3 hover:text-ink'}`}
        >
          Antrean Follow-Up
        </button>
        <button
          onClick={() => setSearchParams({ tab: 'templates' }, { replace: true })}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition -mb-px ${activeMainTab === 'TEMPLATES' ? 'border-accent text-accent' : 'border-transparent text-ink-3 hover:text-ink'}`}
        >
          Template Pesan
        </button>
      </div>

      {activeMainTab === 'TEMPLATES' ? (
        <FollowUpTemplates />
      ) : (
      <>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-divider">
        <div className="flex items-center space-x-3.5">
          <div className="h-12 w-12 rounded-2xl bg-accent text-accent-ink flex items-center justify-center shadow-xs shrink-0">
            <CalendarCheck size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-black text-ink tracking-tight">Antrian Follow-Up</h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-accent-soft text-accent border border-divider">
                {totalItems} Antrian
              </span>
            </div>
            <p className="text-xs text-ink-2 mt-1 flex items-center gap-1.5 font-medium">
              <Clock size={13} className="text-accent shrink-0" />
              Kelola jadwal kirim otomatis (No Purchase, Treatment Lanjutan, Review & Reminder).
            </p>
          </div>
        </div>

        {/* Global Bulk Actions */}
        <div className="flex items-center space-x-2 flex-wrap gap-y-2">
          <button
            onClick={() => setConfirmAction({ type: 'bulk-queue' })}
            disabled={actionLoading !== null}
            className="px-3.5 py-2 bg-info hover:bg-info-hover active:scale-95 text-on-solid rounded-xl transition shadow-xs flex items-center space-x-1.5 text-xs font-bold"
            title="Jadwalkan seluruh follow-up pending ke antrian QUEUED"
          >
            <CalendarCheck size={14} />
            <span>Jadwalkan Semua Pending</span>
          </button>

          <button
            onClick={() => setConfirmAction({ type: 'reschedule-overdue' })}
            disabled={actionLoading !== null}
            className="px-3.5 py-2 bg-warning hover:bg-warning-hover active:scale-95 text-on-solid rounded-xl transition shadow-xs flex items-center space-x-1.5 text-xs font-bold"
            title="Majukan follow-up overdue mulai hari ini/besok (maks 40 blast/hari)"
          >
            <FastForward size={14} />
            <span>Majukan Overdue</span>
          </button>

          <button
            onClick={() => setConfirmAction({ type: 'bulk-cancel' })}
            disabled={actionLoading !== null}
            className="px-3.5 py-2 bg-surface hover:bg-danger-soft active:scale-95 border border-danger-line text-danger rounded-xl transition shadow-xs flex items-center space-x-1.5 text-xs font-bold"
            title="Batalkan seluruh antrian pending"
          >
            <Trash2 size={14} />
            <span>Batalkan Pending</span>
          </button>

          <button
            onClick={() => loadFollowUps()}
            disabled={loading}
            className="p-2 bg-surface hover:bg-fill-1 active:scale-95 border border-divider text-ink rounded-xl transition shadow-xs flex items-center space-x-1"
            title="Refresh Data"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin text-accent' : 'text-ink-3'} />
            <span className="text-xs font-semibold">Refresh</span>
          </button>
        </div>
      </div>

      {/* Safety Policy Notice */}
      <div className="bg-accent-soft border border-divider rounded-2xl p-3.5 flex items-start space-x-3 text-xs text-accent">
        <ShieldCheck size={18} className="text-accent flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-bold text-ink">Sistem Penjadwalan Antrian & Smart Context Guard</p>
          <p className="text-ink-2 mt-0.5">
            Pesan berstatus <strong>QUEUED</strong> akan terkirim otomatis tepat pada tanggal & jam yang sudah disetup (maksimal 40 blast per hari pada jam kerja).
            Dilengkapi <strong>Smart Context Guard</strong>: jika customer baru saja aktif chat (&lt;3 hari terakhir), jadwal otomatis dimundurkan agar tidak menimpa obrolan baru.
            Klik tombol <strong>Chat</strong> untuk membuka modal riwayat obrolan langsung di sini tanpa pindah halaman.
          </p>
        </div>
      </div>

      {/* Filters & Search Bar (Cleaned up - No sorting dropdown) */}
      <div className="bg-surface border border-divider rounded-2xl p-4 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
          <div className="flex items-center space-x-1.5 text-xs font-bold text-ink-2 pr-1">
            <Filter size={15} className="text-accent flex-shrink-0" />
            <span>Filter:</span>
          </div>

          {/* Date Filter Dropdown */}
          <select
            value={dateFilter}
            onChange={(e) => {
              setDateFilter(e.target.value);
              setPage(1);
            }}
            className="p-2.5 bg-surface border border-divider hover:border-accent rounded-xl text-xs text-ink font-semibold focus:outline-none focus:border-accent shadow-xs transition"
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
            className="p-2.5 bg-surface border border-divider hover:border-accent rounded-xl text-xs text-ink focus:outline-none focus:border-accent shadow-xs transition"
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
            className="p-2.5 bg-surface border border-divider hover:border-accent rounded-xl text-xs text-ink focus:outline-none focus:border-accent shadow-xs transition"
          >
            <option value="">Semua Tipe</option>
            <option value="REMINDER_H1">Reminder Treatment (H-1 Malam)</option>
            <option value="REVIEW_H1_BABY">Review H+1 Treatment Bayi</option>
            <option value="REVIEW_H1_MOMS">Review H+1 Treatment Moms</option>
            <option value="NO_PURCHASE">Belum Purchase (+3, +7, +14 Hari)</option>
            <option value="NEXT_TREATMENT">Treatment Lanjutan (+1, +2, +3 Bulan)</option>
            <option value="WINBACK_60D">Re-engagement Pelanggan Lama (&gt;60 Hari)</option>
          </select>
        </div>

        {/* Search Bar */}
        <form onSubmit={handleSearchSubmit} className="relative w-full lg:w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama / nomor WhatsApp..."
            className="w-full pl-8 pr-3 py-2.5 bg-surface border border-divider hover:border-accent rounded-xl text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent shadow-xs transition"
          />
        </form>
      </div>

      {/* Main Content: Mobile Card Stack (< md) + Desktop Table (>= md) */}
      <div className="bg-surface border border-divider rounded-2xl overflow-hidden shadow-xs">
        {/* Mobile Card Stack (< md) */}
        <div className="md:hidden divide-y divide-divider">
          {loading ? (
            <div className="py-16 text-center text-ink-3 text-xs">
              <div className="flex justify-center items-center space-x-2">
                <RefreshCw size={16} className="animate-spin text-accent" />
                <span>Memuat data antrian follow-up...</span>
              </div>
            </div>
          ) : followUps.length === 0 ? (
            <div className="py-16 text-center text-ink-3 text-xs px-4">
              <CalendarCheck size={36} className="mx-auto text-ink-3 mb-2.5 opacity-40" />
              <p className="font-bold text-ink text-sm">Tidak ada antrian follow-up yang sesuai filter.</p>
              <p className="text-ink-3 mt-1 max-w-sm mx-auto">
                Saat ini tidak ada jadwal follow-up aktif. Coba ubah pilihan tanggal atau status di atas.
              </p>
            </div>
          ) : (
            followUps.map((fu) => {
              const dt = formatDateTime(fu.scheduled_at);
              const typeMeta = getTypeLabel(fu.type, fu.stage);
              const c = fu.customer;
              const isOverdue =
                new Date(fu.scheduled_at).getTime() < Date.now() &&
                (fu.status === 'PENDING' || fu.status === 'QUEUED');

              return (
                <div key={`mobile-fu-${fu.id}`} className="p-4 space-y-3 bg-surface">
                  {/* Header row: Type badge & Status badge */}
                  <div className="flex items-center justify-between gap-2">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold border ${typeMeta.color}`}>
                      {typeMeta.label}
                    </span>
                    {renderStatusCell(fu)}
                  </div>

                  {/* Customer & Phone info */}
                  <div>
                    <div className="flex items-center space-x-1.5 font-bold text-sm text-ink">
                      <User size={14} className="text-accent shrink-0" />
                      <span className="truncate">{c?.name || 'Tanpa Nama'}</span>
                      {c?.conversations?.[0]?.is_human_handling && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-warning-soft text-warning border border-warning-line">
                          Human Handling
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-ink-3 font-mono mt-0.5 pl-5">
                      <span>{c?.phone}</span>
                      {c?.conversations?.[0]?.last_message_at && (
                        <span className="text-[10px] text-accent bg-accent-soft px-1.5 py-0.2 rounded font-sans">
                          Chat {formatLastChat(c.conversations[0].last_message_at)}
                        </span>
                      )}
                    </div>
                    {fu.reservation?.treatment_detail && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-1 pl-5">
                        📋 {fu.reservation.treatment_detail}
                      </p>
                    )}
                  </div>

                  {/* Schedule & Message Preview */}
                  <div className="p-2.5 rounded-xl bg-surface-2 dark:bg-surface-2 border border-divider space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-ink flex items-center gap-1">
                        <Calendar size={12} className="text-accent" />
                        <span>{dt.date}</span>
                        <span className="text-ink-3 font-normal">({dt.time})</span>
                      </span>
                      {isOverdue && (
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-warning-soft text-warning border border-warning-line">
                          Overdue
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-ink-2 line-clamp-2 leading-relaxed">
                      {fu.custom_text || getTemplateTextForTypeAndVariant(fu.type, fu.stage, effectiveVariant(fu), resolveCategory(fu))}
                    </p>
                  </div>

                  {/* Action buttons with touch-friendly dimensions */}
                  <div className="flex items-center justify-end gap-2 pt-1 border-t border-divider dark:border-divider">
                    {fu.status === 'PENDING' && (
                      <button
                        type="button"
                        onClick={() => setConfirmAction({ type: 'queue', id: fu.id })}
                        disabled={actionLoading === fu.id}
                        className="px-3 py-2 min-h-[38px] rounded-xl bg-info-soft hover:bg-info-line active:scale-95 border border-info-line text-info text-xs font-bold flex items-center space-x-1 shadow-xs cursor-pointer touch-manipulation"
                        title="Jadwalkan / Masukkan ke Antrian"
                      >
                        <CalendarCheck size={14} />
                        <span>Jadwalkan</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => fu.customer && handleOpenChatHistory(fu.customer)}
                      className="p-2 min-w-[38px] min-h-[38px] rounded-xl bg-surface hover:bg-accent-soft active:scale-95 border border-divider text-ink-2 hover:text-accent transition shadow-xs flex items-center justify-center cursor-pointer touch-manipulation"
                      title="Buka Riwayat Chat"
                    >
                      <MessageSquare size={15} />
                    </button>

                    {(fu.status === 'PENDING' || fu.status === 'QUEUED') && (
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(fu)}
                        disabled={actionLoading === fu.id}
                        className="p-2 min-w-[38px] min-h-[38px] rounded-xl bg-surface hover:bg-fill-1 active:scale-95 border border-divider text-ink-2 hover:text-ink transition shadow-xs flex items-center justify-center cursor-pointer touch-manipulation"
                        title="Edit Jadwal & Teks Pesan"
                      >
                        <Edit2 size={15} />
                      </button>
                    )}

                    {(fu.status === 'PENDING' || fu.status === 'QUEUED' || fu.status === 'FAILED') && (
                      <button
                        type="button"
                        onClick={() => setConfirmAction({ type: 'cancel', id: fu.id })}
                        disabled={actionLoading === fu.id}
                        className="p-2 min-w-[38px] min-h-[38px] rounded-xl bg-danger-soft hover:bg-danger-line active:scale-95 border border-danger-line text-danger transition shadow-xs flex items-center justify-center cursor-pointer touch-manipulation"
                        title="Batalkan Follow-Up"
                      >
                        <XCircle size={15} />
                      </button>
                    )}

                    {fu.status === 'FAILED' && (
                      <button
                        type="button"
                        onClick={() => handleRetry(fu.id)}
                        disabled={actionLoading === fu.id}
                        className="p-2 min-w-[38px] min-h-[38px] rounded-xl bg-warning-soft hover:bg-warning-line active:scale-95 border border-warning-line text-warning transition shadow-xs flex items-center justify-center cursor-pointer touch-manipulation"
                        title="Coba Lagi (Retry)"
                      >
                        <RotateCcw size={15} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Desktop Table (>= md) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-2 border-b border-divider text-ink-2 text-xs font-bold uppercase tracking-wider">
                <th
                  onClick={() => handleSort('scheduled_at')}
                  className="px-4 py-3.5 cursor-pointer hover:bg-fill-1 transition select-none group"
                >
                  <div className="flex items-center space-x-1">
                    <span>Jadwal Kirim</span>
                    {renderSortIndicator('scheduled_at')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('type')}
                  className="px-4 py-3.5 cursor-pointer hover:bg-fill-1 transition select-none group"
                >
                  <div className="flex items-center space-x-1">
                    <span>Tipe & Tahap</span>
                    {renderSortIndicator('type')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('customer_name')}
                  className="px-4 py-3.5 cursor-pointer hover:bg-fill-1 transition select-none group"
                >
                  <div className="flex items-center space-x-1">
                    <span>Customer & Konteks Chat</span>
                    {renderSortIndicator('customer_name')}
                  </div>
                </th>
                <th className="px-4 py-3.5">Template / Pesan</th>
                <th
                  onClick={() => handleSort('status')}
                  className="px-4 py-3.5 cursor-pointer hover:bg-fill-1 transition select-none group"
                >
                  <div className="flex items-center space-x-1">
                    <span>Status</span>
                    {renderSortIndicator('status')}
                  </div>
                </th>
                <th className="px-4 py-3.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-16 text-center text-ink-3 text-xs">
                    <div className="flex justify-center items-center space-x-2">
                      <RefreshCw size={16} className="animate-spin text-accent" />
                      <span>Memuat data antrian follow-up...</span>
                    </div>
                  </td>
                </tr>
              ) : followUps.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-16 text-center text-ink-3 text-xs">
                    <CalendarCheck size={36} className="mx-auto text-ink-3 mb-2.5 opacity-40" />
                    <p className="font-bold text-ink text-sm">Tidak ada antrian follow-up yang sesuai filter.</p>
                    <p className="text-ink-3 mt-1 max-w-sm mx-auto">
                      Saat ini tidak ada jadwal follow-up aktif. Coba ubah pilihan tanggal atau status di atas.
                    </p>
                  </td>
                </tr>
              ) : (
                followUps.map((fu) => {
                  const dt = formatDateTime(fu.scheduled_at);
                  const typeMeta = getTypeLabel(fu.type, fu.stage);
                  const c = fu.customer;
                  const isOverdue =
                    new Date(fu.scheduled_at).getTime() < Date.now() &&
                    (fu.status === 'PENDING' || fu.status === 'QUEUED');

                  return (
                    <tr key={fu.id} className="hover:bg-surface-2 transition group">
                      {/* Jadwal Kirim */}
                      <td className="px-4 py-3.5 text-xs">
                        <div className="font-bold text-ink flex items-center space-x-1.5">
                          <Calendar size={13} className="text-accent" />
                          <span>{dt.date}</span>
                        </div>
                        <div className="text-[11px] text-ink-3 flex items-center space-x-1 mt-0.5 font-medium">
                          <Clock size={10} className="text-ink-3" />
                          <span>{dt.time}</span>
                          {isOverdue && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-warning-soft text-warning border border-warning-line ml-1">
                              Overdue
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Tipe & Tahap */}
                      <td className="px-4 py-3.5 text-xs">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold border ${typeMeta.color}`}
                        >
                          {typeMeta.label}
                        </span>
                      </td>

                      {/* Customer & Konteks Chat */}
                      <td className="px-4 py-3.5 text-xs">
                        <div className="flex items-center space-x-1.5 font-bold text-ink">
                          <User size={13} className="text-ink-3" />
                          <span className="truncate max-w-[170px]">{c?.name || 'Tanpa Nama'}</span>
                          {c?.conversations?.[0]?.is_human_handling && (
                            <span
                              className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-warning-soft text-warning border border-warning-line"
                              title="Sedang/Pernah dikelola manual oleh Admin"
                            >
                              Human Handling
                            </span>
                          )}
                        </div>
                        <div className="flex items-center space-x-2 text-[10px] text-ink-3 font-mono ml-4 mt-0.5">
                          <span>{c?.phone}</span>
                          {c?.conversations?.[0]?.last_message_at && (
                            <span
                              className={`flex items-center space-x-0.5 px-1.5 py-0.5 rounded text-[9px] ${
                                Date.now() - new Date(c.conversations[0].last_message_at).getTime() < 72 * 60 * 60 * 1000
                                  ? 'bg-success-soft text-success font-bold border border-success-line'
                                  : 'text-ink-3'
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
                            className="text-[10px] text-ink-2 truncate max-w-[220px] ml-4 mt-0.5"
                            title={fu.reservation.treatment_detail}
                          >
                            📋 {fu.reservation.treatment_detail}
                          </div>
                        )}
                      </td>

                      {/* Template / Pesan */}
                      <td className="px-4 py-3.5 text-xs text-ink-2">
                        <div className="flex flex-col space-y-0.5">
                          <div className="flex items-center space-x-1.5">
                            <MessageSquare size={12} className="text-success flex-shrink-0" />
                            <span className="font-semibold text-ink">
                              {fu.type === 'NO_PURCHASE' ? `Hari ke-${[3,7,14][fu.stage-1]||fu.stage}` : fu.type === 'NEXT_TREATMENT' ? `Bulan ke-${fu.stage}` : `Tahap ${fu.stage}`} {fu.custom_text ? '' : `(Varian ${effectiveVariant(fu)})`}
                            </span>
                            {fu.custom_text ? (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-violet-soft text-violet border border-violet-line ml-1">
                                Custom
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-warning-soft text-warning border border-warning-line ml-1">
                                Auto
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-ink-3 truncate max-w-[220px]" title={fu.custom_text || getTemplateTextForTypeAndVariant(fu.type, fu.stage, effectiveVariant(fu), resolveCategory(fu))}>{(fu.custom_text || getTemplateTextForTypeAndVariant(fu.type, fu.stage, effectiveVariant(fu), resolveCategory(fu))).slice(0, 48)}...</span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5">{renderStatusCell(fu)}</td>

                      {/* Actions */}
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end space-x-1.5">
                          {fu.status === 'PENDING' && (
                            <button
                              onClick={() => setConfirmAction({ type: 'queue', id: fu.id })}
                              disabled={actionLoading === fu.id}
                              className="px-2.5 py-1.5 rounded-xl bg-info-soft hover:bg-info-line active:scale-95 border border-info-line text-info text-xs font-bold flex items-center space-x-1 transition shadow-xs"
                              title="Jadwalkan / Masukkan ke Antrian"
                            >
                              <CalendarCheck size={12} />
                              <span>Jadwalkan</span>
                            </button>
                          )}

                          {/* Chat History Modal Button */}
                          <button
                            onClick={() => fu.customer && handleOpenChatHistory(fu.customer)}
                            className="p-2 rounded-xl bg-surface hover:bg-accent-soft active:scale-95 border border-divider text-ink-2 hover:text-accent text-xs font-semibold transition shadow-xs flex items-center"
                            title="Buka Riwayat Chat Modal"
                          >
                            <MessageSquare size={13} />
                          </button>

                          {/* Edit Modal Button */}
                          {(fu.status === 'PENDING' || fu.status === 'QUEUED') && (
                            <button
                              onClick={() => handleOpenEdit(fu)}
                              disabled={actionLoading === fu.id}
                              className="p-2 rounded-xl bg-surface hover:bg-fill-1 active:scale-95 border border-divider text-ink-2 hover:text-ink text-xs font-semibold transition shadow-xs"
                              title="Edit Jadwal, Varian & Teks Pesan"
                            >
                              <Edit2 size={13} />
                            </button>
                          )}

                          {/* Cancel Button */}
                          {(fu.status === 'PENDING' || fu.status === 'QUEUED' || fu.status === 'FAILED') && (
                            <button
                              onClick={() => setConfirmAction({ type: 'cancel', id: fu.id })}
                              disabled={actionLoading === fu.id}
                              className="p-2 rounded-xl bg-danger-soft hover:bg-danger-line active:scale-95 border border-danger-line text-danger text-xs font-semibold transition shadow-xs"
                              title="Batalkan Follow-Up"
                            >
                              <XCircle size={13} />
                            </button>
                          )}

                          {/* Retry Button (H5) — hanya untuk item FAILED */}
                          {fu.status === 'FAILED' && (
                            <button
                              onClick={() => handleRetry(fu.id)}
                              disabled={actionLoading === fu.id}
                              className="p-2 rounded-xl bg-warning-soft hover:bg-warning-line active:scale-95 border border-warning-line text-warning text-xs font-semibold transition shadow-xs"
                              title="Coba Lagi (Retry)"
                            >
                              <RotateCcw size={13} />
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

      {/* ========================================================================= */}
      {/* PORTAL MODAL 1: Edit Follow-Up Modal (Date, Variant & Text Editor)       */}
      {/* ========================================================================= */}
      {editModal.open &&
        editModal.item &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-black/60 backdrop-blur-xs animate-fadeIn"
            onClick={() => setEditModal({ open: false, newDate: '', stage: 1, variant: 1, customText: '' })}
          >
            <div
              className="bg-surface border border-divider rounded-2xl w-full max-w-xl shadow-2xl flex flex-col my-auto max-h-[88vh] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="p-4 sm:p-5 border-b border-divider flex justify-between items-center bg-surface-2 shrink-0">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-xl bg-accent-soft text-accent flex items-center justify-center">
                    <Edit2 size={16} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-ink tracking-tight">Edit Follow-Up</h3>
                    <p className="text-[11px] text-ink-2">Atur jadwal pengiriman, varian pesan, atau sesuaikan teks khusus.</p>
                  </div>
                </div>
                <button
                  onClick={() => setEditModal({ open: false, newDate: '', stage: 1, variant: 1, customText: '' })}
                  className="p-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-fill-2 transition"
                  title="Tutup (Esc)"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4">
                {/* Customer Banner */}
                <div className="bg-surface-2 p-3 rounded-xl border border-divider flex items-center justify-between text-xs">
                  <div>
                    <span className="text-ink-3 block text-[10px]">Pelanggan</span>
                    <strong className="text-ink font-bold text-sm">
                      {editModal.item.customer?.name || 'Tanpa Nama'}
                    </strong>
                    <span className="text-ink-3 block font-mono text-[11px]">{editModal.item.customer?.phone}</span>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-accent-soft text-accent border border-divider">
                    {getTypeLabel(editModal.item.type, editModal.stage).label}
                  </span>
                </div>

                {/* Field 1: Jadwal Kirim */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-ink flex items-center space-x-1.5">
                    <Calendar size={14} className="text-accent" />
                    <span>Jadwal Kirim</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={editModal.newDate}
                    onChange={(e) => setEditModal({ ...editModal, newDate: e.target.value })}
                    className="w-full p-2.5 bg-surface border border-divider hover:border-accent focus:border-accent rounded-xl text-xs text-ink focus:outline-none shadow-xs transition font-medium"
                  />
                </div>

                {/* Field 2a: Tahap Jadwal (Stage) */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-ink flex items-center space-x-1.5">
                    <Calendar size={14} className="text-accent" />
                    <span>Tahap Jadwal</span>
                    <span className="text-[10px] font-normal text-ink-3">(kapan dikirim)</span>
                  </label>
                  <select
                    value={editModal.stage}
                    onChange={(e) => {
                      const newStage = parseInt(e.target.value, 10);
                      const templateText = getTemplateTextForTypeAndVariant(editModal.item!.type, newStage, editModal.variant, resolveCategory(editModal.item));
                      setEditModal((prev) => ({ ...prev, stage: newStage, customText: templateText }));
                    }}
                    className="w-full p-2.5 bg-surface border border-divider hover:border-accent focus:border-accent rounded-xl text-xs text-ink focus:outline-none shadow-xs font-medium"
                  >
                    {editModal.item?.type === 'NO_PURCHASE' ? (
                      <>
                        <option value={1}>Hari ke-3</option>
                        <option value={2}>Hari ke-7</option>
                        <option value={3}>Hari ke-14</option>
                      </>
                    ) : editModal.item?.type === 'NEXT_TREATMENT' ? (
                      <>
                        <option value={1}>Bulan ke-1</option>
                        <option value={2}>Bulan ke-2</option>
                        <option value={3}>Bulan ke-3</option>
                      </>
                    ) : editModal.item?.type === 'WINBACK_60D' ? (
                      <option value={1}>Re-engagement (Sekali)</option>
                    ) : (
                      <>
                        <option value={1}>Tahap 1</option>
                        <option value={2}>Tahap 2</option>
                        <option value={3}>Tahap 3</option>
                      </>
                    )}
                  </select>
                  <p className="text-[10px] text-ink-3">Mengganti tahap akan mengubah jadwal, varian tetap di tahap yang dipilih.</p>
                </div>

                {/* Field 2b: Varian Pesan (gaya bahasa) */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-ink flex items-center space-x-1.5">
                      <MessageSquare size={14} className="text-accent" />
                      <span>Varian Pesan</span>
                      <span className="text-[10px] font-normal text-ink-3">(gaya bahasa)</span>
                    </label>
                    <span className="text-[10px] text-ink-3">Klik varian untuk ganti teks tanpa ubah jadwal</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[1, 2, 3].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => handleVariantSelect(v)}
                        className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center space-x-1.5 active:scale-95 ${
                          editModal.variant === v
                            ? 'bg-accent-soft border-accent text-accent shadow-xs'
                            : 'bg-surface border-divider text-ink-2 hover:bg-surface-2'
                        }`}
                      >
                        <span>Varian #{v}</span>
                        {editModal.variant === v && <CheckCircle size={12} className="text-accent" />}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-ink-3">Varian 1=Ramah/Hangat, 2=Promo/Direct, 3=Edukatif.</p>
                </div>

                {/* Field 3: Teks Pesan Follow-Up */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-ink flex items-center space-x-1.5">
                      <FileText size={14} className="text-accent" />
                      <span>Teks Pesan Follow-Up</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        if (editModal.item) {
                          const defaultText = getTemplateTextForTypeAndVariant(editModal.item.type, editModal.stage, editModal.variant, resolveCategory(editModal.item));
                          setEditModal((prev) => ({ ...prev, customText: defaultText }));
                        }
                      }}
                      className="text-[11px] text-accent hover:underline flex items-center space-x-1 font-semibold"
                    >
                      <RotateCcw size={11} />
                      <span>Reset ke Template Default</span>
                    </button>
                  </div>

                  <textarea
                    rows={5}
                    value={editModal.customText}
                    onChange={(e) => setEditModal({ ...editModal, customText: e.target.value })}
                    placeholder="Tulis pesan follow-up kustom untuk pelanggan ini..."
                    className="w-full p-3 bg-surface border border-divider hover:border-accent focus:border-accent rounded-xl text-xs text-ink focus:outline-none shadow-xs leading-relaxed transition font-sans"
                  />

                  {/* Tag Helpers */}
                  <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                    <span className="text-[10px] text-ink-3 flex items-center gap-1">
                      <Tag size={10} /> Sisipkan Variabel:
                    </span>
                    {['{name}', ...(editCategory === 'MOMS' ? [] : ['{babyName}']), '{time}'].map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() =>
                          setEditModal((prev) => ({
                            ...prev,
                            customText: `${prev.customText} ${tag}`,
                          }))
                        }
                        className="px-2 py-0.5 rounded-lg bg-fill-1 hover:bg-fill-2 text-[10px] font-mono text-ink-2 border border-divider transition active:scale-95"
                      >
                        + {tag}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-ink-3 leading-tight">
                    * Variabel <code>{'{name}'}</code> akan otomatis disanitasi menjadi sapaan bersih (misal: "Bunda [nama]").{editCategory === 'MOMS' ? ' Variabel {babyName} tidak tersedia untuk kategori MOMS.' : ''}
                  </p>
                  {/* Live Preview */}
                  <div className="bg-success-soft border border-success-line rounded-xl p-3 space-y-1">
                    <p className="text-[10px] font-bold text-success flex items-center gap-1"><Eye size={10} /> Preview WhatsApp ({editHonorific} {editFirstName}{editCategory === 'MOMS' ? '' : `, ${editBabyLabel}`}):</p>
                    <p className="text-xs text-ink leading-relaxed whitespace-pre-wrap bg-surface p-2 rounded-lg border border-success-line">
                      {editModal.customText
                        .replace(/Bunda\s*\{name\}/gi, `${editHonorific} ${editFirstName}`)
                        .replace(/\{name\}/g, editFirstName)
                        .replace(/\{babyName\}/g, editCategory === 'MOMS' ? '[variabel bayi tidak berlaku]' : editBabyLabel)
                        .replace(/\{time\}/g, '10:00 WIB') || '—'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="p-4 border-t border-divider bg-surface-2 flex justify-end space-x-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setEditModal({ open: false, newDate: '', stage: 1, variant: 1, customText: '' })}
                  className="px-4 py-2 bg-surface hover:bg-fill-1 active:scale-95 border border-divider text-ink-2 rounded-xl text-xs font-semibold transition"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleEditSave}
                  disabled={actionLoading === editModal.item.id}
                  className="px-5 py-2 bg-accent hover:bg-accent active:scale-95 text-white rounded-xl text-xs font-bold transition shadow-xs flex items-center space-x-1.5"
                >
                  {actionLoading === editModal.item.id ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <CheckCircle size={13} />
                  )}
                  <span>Simpan Perubahan</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* ========================================================================= */}
      {/* PORTAL MODAL 2: Chat History Modal (terpusat — Anti-Bloat) */}
      {/* ========================================================================= */}
      <ChatHistoryModal
        isOpen={chatModal.open}
        customer={chatModal.customer}
        conversationId={chatModal.customer?.conversations?.[0]?.id ?? null}
        mode="reply"
        onClose={() => setChatModal((prev) => ({ ...prev, open: false }))}
      />

      {/* ========================================================================= */}
      {/* PORTAL MODAL 3: Confirm Action Modal                                     */}
      {/* ========================================================================= */}
      {confirmAction &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-black/60 backdrop-blur-xs animate-fadeIn"
            onClick={closeConfirmModal}
          >
            <div
              className="bg-surface border border-divider rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-2xl my-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-base font-bold text-ink flex items-center space-x-2">
                {confirmAction.type === 'reschedule-overdue' ? (
                  <>
                    <FastForward className="text-warning" size={18} />
                    <span>Majukan & Rapikan Jadwal Overdue?</span>
                  </>
                ) : confirmAction.type === 'bulk-cancel' ? (
                  <>
                    <Trash2 className="text-danger" size={18} />
                    <span>Batalkan Semua Antrian Pending?</span>
                  </>
                ) : confirmAction.type === 'bulk-queue' ? (
                  <>
                    <CalendarCheck className="text-info" size={18} />
                    <span>Jadwalkan Semua Antrian Pending?</span>
                  </>
                ) : confirmAction.type === 'cancel' ? (
                  <>
                    <XCircle className="text-danger" size={18} />
                    <span>Batalkan Follow-Up?</span>
                  </>
                ) : confirmAction.type === 'queue' ? (
                  <>
                    <CalendarCheck className="text-info" size={18} />
                    <span>Jadwalkan Follow-Up?</span>
                  </>
                ) : (
                  <>
                    <Send className="text-accent" size={18} />
                    <span>Setujui & Kirim Sekarang?</span>
                  </>
                )}
              </h3>
              <p className="text-xs text-ink-2 leading-relaxed">
                {confirmAction.type === 'reschedule-overdue'
                  ? 'Seluruh follow-up berstatus PENDING yang jadwalnya sebelum hari ini akan dimajukan mulai dari hari ini/besok, dan dibagi merata maksimal 40 blast per hari pada jam kerja (09:00 - 16:00 WIB).'
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

              {(confirmAction.type === 'cancel' || confirmAction.type === 'bulk-cancel') && (
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-ink flex items-center gap-1.5">
                    <FileText size={12} className="text-accent" />
                    <span>Alasan Pembatalan (opsional)</span>
                  </label>
                  <textarea
                    rows={2}
                    value={confirmReason}
                    onChange={(e) => setConfirmReason(e.target.value)}
                    placeholder="Misal: Customer minta ditunda, nomor salah, dsb."
                    className="w-full p-2.5 bg-surface border border-divider hover:border-accent focus:border-accent rounded-xl text-xs text-ink focus:outline-none shadow-xs transition resize-none"
                  />
                  <p className="text-[10px] text-ink-3 leading-tight">
                    Jika dikosongkan, sistem memakai alasan default (pembatalan manual oleh Admin).
                  </p>
                </div>
              )}

              <div className="flex justify-end space-x-2 pt-2 border-t border-divider">
                <button
                  onClick={closeConfirmModal}
                  className="px-4 py-2 bg-surface hover:bg-fill-1 active:scale-95 border border-divider text-ink-2 rounded-xl text-xs font-semibold transition"
                >
                  Batal
                </button>
                <button
                  onClick={() => {
                    const { type, id } = confirmAction;
                    const reason = confirmReason;
                    setConfirmAction(null);
                    setConfirmReason('');
                    if (type === 'reschedule-overdue') handleRescheduleOverdue();
                    else if (type === 'bulk-cancel') handleBulkCancel(reason);
                    else if (type === 'bulk-queue') handleBulkQueue();
                    else if (type === 'cancel' && id) handleCancel(id, reason);
                    else if (type === 'queue' && id) handleQueue(id);
                    else if (type === 'send' && id) handleSendNow(id);
                  }}
                  disabled={actionLoading !== null}
                  className={`px-4 py-2 text-white rounded-xl text-xs font-bold transition shadow-xs active:scale-95 ${
                    confirmAction.type === 'reschedule-overdue'
                      ? 'bg-warning hover:bg-warning-hover'
                      : confirmAction.type === 'cancel' || confirmAction.type === 'bulk-cancel'
                      ? 'bg-danger hover:bg-danger-hover'
                      : confirmAction.type === 'bulk-queue' || confirmAction.type === 'queue'
                      ? 'bg-info hover:bg-info-hover'
                      : 'bg-accent hover:bg-accent'
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
          </div>,
          document.body
        )}

      {/* Toast Notification */}
      {toastMsg && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl border text-xs font-bold shadow-xl flex items-center space-x-2 animate-fadeIn ${
            toastMsg.type === 'success'
              ? 'bg-success-soft border-success-line text-success'
              : 'bg-danger-soft border-danger-line text-danger'
          }`}
        >
          {toastMsg.type === 'success' ? (
            <CheckCircle size={14} className="text-success" />
          ) : (
            <AlertCircle size={14} className="text-danger" />
          )}
          <span>{toastMsg.text}</span>
          <button onClick={() => setToastMsg(null)} className="ml-2 text-ink-3 hover:text-ink">
            <XCircle size={13} />
          </button>
        </div>
      )}
      </>
      )}
    </div>
  );
};

export default FollowUpQueue;
