import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
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

  // Available Templates Cache for previews & resets
  const [availableTemplates, setAvailableTemplates] = useState<TemplateItem[]>([]);

  // Confirmation Modal
  const [confirmAction, setConfirmAction] = useState<{
    type: 'cancel' | 'send' | 'bulk-cancel' | 'queue' | 'bulk-queue' | 'reschedule-overdue';
    id?: string;
  } | null>(null);

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

  const chatContainerRef = React.useRef<HTMLDivElement>(null);
  const chatMessagesEndRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll chat modal to bottom
  const scrollChatToBottom = useCallback((smooth = false) => {
    const doScroll = () => {
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight + 99999;
      }
      if (chatMessagesEndRef.current) {
        chatMessagesEndRef.current.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' });
      }
    };
    doScroll();
    requestAnimationFrame(doScroll);
    setTimeout(doScroll, 30);
    setTimeout(doScroll, 100);
    setTimeout(doScroll, 250);
  }, []);

  useEffect(() => {
    if (chatModal.open && chatModal.messages.length > 0 && !chatModal.loading) {
      scrollChatToBottom(false);
    }
  }, [chatModal.open, chatModal.messages, chatModal.loading, scrollChatToBottom]);

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

  // Global ESC key listener to close modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (chatModal.open) setChatModal((prev) => ({ ...prev, open: false }));
        if (editModal.open) setEditModal({ open: false, newDate: '', stage: 1, variant: 1, customText: '' });
        if (confirmAction) setConfirmAction(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [chatModal.open, editModal.open, confirmAction]);

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

  // Helper template finder - stage = jadwal, variant = gaya bahasa 1..3
  const getTemplateTextForTypeAndVariant = (type: string, stage: number, variant: number = 1) => {
    let templateType = type;
    if (type === 'NO_PURCHASE') templateType = `NO_PURCHASE_${Math.min(3, Math.max(1, stage))}`;
    else if (type === 'NEXT_TREATMENT') templateType = `NEXT_TREATMENT_${Math.min(3, Math.max(1, stage))}`;

    const v = Math.min(3, Math.max(1, variant));
    const found = availableTemplates.find((t) => t.type === templateType && t.variant === v);
    if (found && found.text) return found.text;

    // Fallback default varian berdasarkan variant, bukan stage
    if (type === 'NO_PURCHASE') {
      const map: Record<number, Record<number, string>> = {
        1: { 1: 'Halo Bunda {name}! Bagaimana kabar hari ini? Kemarin sempat menanyakan perihal layanan kami, apakah ada yang bisa kami bantu jelaskan lebih lanjut bund? 😊', 2: 'Pagi Bunda {name}! 🌸 Masih bingung pilih paket treatment yang cocok untuk si kecil? Bidan siap bantu rekomendasikan lho bund, mumpung ada promo bulan ini! 🤗', 3: 'Salam Bunda {name}! ✨ Kalau Bunda butuh informasi tambahan seputar perawatan bayi/ibu hamil, jangan ragu tanya Bidan ya bund. Kami siap datang langsung ke rumah! 🥰' },
        2: { 1: 'Halo Bunda {name}! Semoga sehat selalu ya bund. Sekedar info, kami siap melayani homecare langsung ke rumah bunda dengan terapis bidan profesional lho. Apakah berkenan kami cek ketersediaan slotnya? 🌸', 2: 'Pagi Bunda {name}! ✨ Bidan cuma mau kasih info nih, promo potongan ongkir & voucher treatment homecare masih berlaku ya bund. Mau dijadwalkan minggu ini? 😊', 3: 'Selamat pagi Bunda {name}! 💖 Momen tumbuh kembang si kecil sangat berharga. Yuk bantu stimulasi & relaksasinya lewat pijat bayi homecare dari bidan bersertifikat! ✨' },
        3: { 1: 'Halo Bunda {name}! Jika bunda masih membutuhkan layanan baby/mom care, tim kami selalu siap membantu ya bund. Semoga bunda dan si kecil sehat selalu! ❤️', 2: 'Halo Bunda {name}! 💖 Ini pesan sapaan terakhir dari Bidan ya bund. Kalau sewaktu-waktu si kecil atau Bunda butuh treatment homecare, simpan kontak klinik ini ya! 🤗✨', 3: 'Salam hangat Bunda {name}! ✨ Terima kasih sudah pernah menghubungi klinik. Jangan sungkan chat Bidan kapan pun butuh layanan pijat homecare terpercaya ya bund! ❤️' },
      };
      if (map[stage]?.[v]) return map[stage][v];
      if (stage === 1) return 'Halo Bunda {name}! Bagaimana kabar hari ini? Kemarin sempat menanyakan perihal layanan kami, apakah ada yang bisa kami bantu jelaskan lebih lanjut bund? 😊';
      if (stage === 2) return 'Halo Bunda {name}! Semoga sehat selalu ya bund. Sekedar info, kami siap melayani homecare langsung ke rumah bunda dengan terapis bidan profesional lho. Apakah berkenan kami cek ketersediaan slotnya? 🌸';
      return 'Halo Bunda {name}! Jika bunda masih membutuhkan layanan baby/mom care, tim kami selalu siap membantu ya bund. Semoga bunda dan si kecil sehat selalu! ❤️';
    }

    if (type === 'NEXT_TREATMENT') {
      const map: Record<number, Record<number, string>> = {
        1: { 1: 'Halo Bunda {name}! Sudah 1 bulan sejak treatment terakhir {babyName}. Bagaimana perkembangannya bund? Terapi/pijat rutin sangat baik untuk relaksasi dan stimulasi tumbuh kembang si kecil lho bund. Apakah ingin reservasi kembali? 😊', 2: 'Selamat pagi Bunda {name}! ✨ Pijat rutin 1 bulan sekali sangat bagus untuk menjaga kelenturan otot & kualitas tidur si kecil lho bund. Mau Bidan jadwalkan minggu ini? 😊', 3: 'Pagi Bunda {name}! 💖 Tidak terasa sudah sebulan lalu ya bund. Yuk amankan slot treatment rutin si kecil atau ibu hamil/nifas minggu ini bersama Bidan! ✨' },
        2: { 1: 'Halo Bunda {name}! Waktunya perawatan berkala si kecil {babyName} nih bund. Terapis kami siap berkunjung lagi untuk memastikan si kecil tetap bugar dan ceria. Jadwalkan yuk bund? 🌸', 2: 'Pagi Bunda {name}! 🌸 Tubuh Bunda atau si kecil sudah terasa pegal/capek lagi? Yuk manjakan diri & si kecil dengan perawatan homecare bulan ini bund! ✨', 3: 'Salam hangat Bunda {name}! ✨ Bidan siap bantu reservasi pijat rutin bulanan lagi nih bund. Bidan favorit Bunda masih tersedia lho! Mau pilih hari apa bund? 😊' },
        3: { 1: 'Halo Bunda {name}! Sudah 3 bulan berlalu, jangan lupa jadwalkan kembali sesi perawatan rutin {babyName} ya bund agar tumbuh kembangnya selalu optimal. Kami siap membantu reservasi! 💖', 2: 'Pagi Bunda {name}! ✨ Kalau si kecil butuh pijat tumbuh kembang atau Bunda butuh relaksasi, Bidan selalu siap kapan saja ya bund. Sehat selalu! ❤️', 3: 'Salam Bunda {name}! 💖 Terima kasih telah menjadi pelanggan setia. Simpan kontak ini ya bund, kapan pun butuh treatment homecare kami siap datang! ✨' },
      };
      if (map[stage]?.[v]) return map[stage][v];
      if (stage === 1) return 'Halo Bunda {name}! Sudah 1 bulan sejak treatment terakhir {babyName}. Bagaimana perkembangannya bund? Terapi/pijat rutin sangat baik untuk relaksasi dan stimulasi tumbuh kembang si kecil lho bund. Apakah ingin reservasi kembali? 😊';
      if (stage === 2) return 'Halo Bunda {name}! Waktunya perawatan berkala si kecil {babyName} nih bund. Terapis kami siap berkunjung lagi untuk memastikan si kecil tetap bugar dan ceria. Jadwalkan yuk bund? 🌸';
      return 'Halo Bunda {name}! Sudah 3 bulan berlalu, jangan lupa jadwalkan kembali sesi perawatan rutin {babyName} ya bund agar tumbuh kembangnya selalu optimal. Kami siap membantu reservasi! 💖';
    }

    return 'Halo Bunda {name}! Bagaimana kabarnya hari ini? Kami siap melayani bunda dan si kecil.';
  };

  // Open Edit Modal
  const handleOpenEdit = (item: FollowUpItem) => {
    const defaultText = getTemplateTextForTypeAndVariant(item.type, item.stage, 1);
    setEditModal({
      open: true,
      item,
      newDate: item.scheduled_at ? item.scheduled_at.slice(0, 16) : '',
      stage: item.stage || 1,
      variant: 1,
      customText: item.custom_text || defaultText,
    });
  };

  // Switch Variant in Edit Modal - hanya ganti gaya bahasa, TIDAK ubah stage/jadwal
  const handleVariantSelect = (newVariant: number) => {
    if (!editModal.item) return;
    const templateText = getTemplateTextForTypeAndVariant(editModal.item.type, editModal.stage, newVariant);
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
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
            <Clock size={11} />
            <span>PENDING</span>
          </span>
        );
      case 'QUEUED':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200 animate-pulse">
            <CalendarCheck size={11} />
            <span>QUEUED</span>
          </span>
        );
      case 'SENT':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle size={11} />
            <span>SENT</span>
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
            <XCircle size={11} />
            <span>CANCELLED</span>
          </span>
        );
      case 'SKIPPED':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-300">
            <AlertCircle size={11} />
            <span>SKIPPED</span>
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-300">
            <AlertCircle size={11} />
            <span>FAILED</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-50 text-slate-600 border border-slate-200">
            <span>{status}</span>
          </span>
        );
    }
  };

  const renderSortIndicator = (field: string) => {
    if (sortBy !== field) {
      return <ArrowUpDown size={12} className="text-[#8696a0] opacity-40 group-hover:opacity-100 transition" />;
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
          <div className="h-12 w-12 rounded-2xl bg-[#008069] text-white flex items-center justify-center shadow-xs shrink-0">
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
        <div className="flex items-center space-x-2 flex-wrap gap-y-2">
          <button
            onClick={() => setConfirmAction({ type: 'bulk-queue' })}
            disabled={actionLoading !== null}
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-xl transition shadow-xs flex items-center space-x-1.5 text-xs font-bold"
            title="Jadwalkan seluruh follow-up pending ke antrian QUEUED"
          >
            <CalendarCheck size={14} />
            <span>Jadwalkan Semua Pending</span>
          </button>

          <button
            onClick={() => setConfirmAction({ type: 'reschedule-overdue' })}
            disabled={actionLoading !== null}
            className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white rounded-xl transition shadow-xs flex items-center space-x-1.5 text-xs font-bold"
            title="Majukan follow-up overdue mulai hari ini/besok (maks 10 blast/hari)"
          >
            <FastForward size={14} />
            <span>Majukan Overdue</span>
          </button>

          <button
            onClick={() => setConfirmAction({ type: 'bulk-cancel' })}
            disabled={actionLoading !== null}
            className="px-3.5 py-2 bg-white hover:bg-rose-50 active:scale-95 border border-rose-200 text-rose-600 rounded-xl transition shadow-xs flex items-center space-x-1.5 text-xs font-bold"
            title="Batalkan seluruh antrian pending"
          >
            <Trash2 size={14} />
            <span>Batalkan Pending</span>
          </button>

          <button
            onClick={() => loadFollowUps()}
            disabled={loading}
            className="p-2 bg-white hover:bg-[#f0f2f5] active:scale-95 border border-[#d1d7db] text-[#111b21] rounded-xl transition shadow-xs flex items-center space-x-1"
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
            Klik tombol <strong>Chat</strong> untuk membuka modal riwayat obrolan langsung di sini tanpa pindah halaman.
          </p>
        </div>
      </div>

      {/* Filters & Search Bar (Cleaned up - No sorting dropdown) */}
      <div className="bg-white border border-[#e9edef] rounded-2xl p-4 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
          <div className="flex items-center space-x-1.5 text-xs font-bold text-[#54656f] pr-1">
            <Filter size={15} className="text-[#008069] flex-shrink-0" />
            <span>Filter:</span>
          </div>

          {/* Date Filter Dropdown */}
          <select
            value={dateFilter}
            onChange={(e) => {
              setDateFilter(e.target.value);
              setPage(1);
            }}
            className="p-2.5 bg-white border border-[#d1d7db] hover:border-[#008069] rounded-xl text-xs text-[#111b21] font-semibold focus:outline-none focus:border-[#008069] shadow-xs transition"
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
            className="p-2.5 bg-white border border-[#d1d7db] hover:border-[#008069] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs transition"
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
            className="p-2.5 bg-white border border-[#d1d7db] hover:border-[#008069] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs transition"
          >
            <option value="">Semua Tipe</option>
            <option value="REMINDER_H1">Reminder Treatment (H-1 Malam)</option>
            <option value="REVIEW_H1_BABY">Review H+1 Treatment Bayi</option>
            <option value="REVIEW_H1_MOMS">Review H+1 Treatment Moms</option>
            <option value="NO_PURCHASE">Belum Purchase (+3, +7, +14 Hari)</option>
            <option value="NEXT_TREATMENT">Treatment Lanjutan (+1, +2, +3 Bulan)</option>
          </select>
        </div>

        {/* Search Bar */}
        <form onSubmit={handleSearchSubmit} className="relative w-full lg:w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8696a0]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama / nomor WhatsApp..."
            className="w-full pl-8 pr-3 py-2.5 bg-white border border-[#d1d7db] hover:border-[#008069] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs transition"
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
                  <td colSpan={6} className="py-16 text-center text-[#667781] text-xs">
                    <div className="flex justify-center items-center space-x-2">
                      <RefreshCw size={16} className="animate-spin text-[#008069]" />
                      <span>Memuat data antrian follow-up...</span>
                    </div>
                  </td>
                </tr>
              ) : followUps.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-16 text-center text-[#667781] text-xs">
                    <CalendarCheck size={36} className="mx-auto text-[#8696a0] mb-2.5 opacity-40" />
                    <p className="font-bold text-[#111b21] text-sm">Tidak ada antrian follow-up yang sesuai filter.</p>
                    <p className="text-[#8696a0] mt-1 max-w-sm mx-auto">
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
                    <tr key={fu.id} className="hover:bg-[#f8fafc] transition group">
                      {/* Jadwal Kirim */}
                      <td className="px-4 py-3.5 text-xs">
                        <div className="font-bold text-[#111b21] flex items-center space-x-1.5">
                          <Calendar size={13} className="text-[#008069]" />
                          <span>{dt.date}</span>
                        </div>
                        <div className="text-[11px] text-[#667781] flex items-center space-x-1 mt-0.5 font-medium">
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
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold border ${typeMeta.color}`}
                        >
                          {typeMeta.label}
                        </span>
                      </td>

                      {/* Customer & Konteks Chat */}
                      <td className="px-4 py-3.5 text-xs">
                        <div className="flex items-center space-x-1.5 font-bold text-[#111b21]">
                          <User size={13} className="text-[#8696a0]" />
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
                              className={`flex items-center space-x-0.5 px-1.5 py-0.5 rounded text-[9px] ${
                                Date.now() - new Date(c.conversations[0].last_message_at).getTime() < 72 * 60 * 60 * 1000
                                  ? 'bg-emerald-50 text-emerald-700 font-bold border border-emerald-200'
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
                        <div className="flex flex-col space-y-0.5">
                          <div className="flex items-center space-x-1.5">
                            <Sparkles size={12} className="text-amber-500 flex-shrink-0" />
                            <span className="font-semibold text-[#111b21]">
                              {fu.type === 'NO_PURCHASE' ? `Hari ke-${[3,7,14][fu.stage-1]||fu.stage}` : fu.type === 'NEXT_TREATMENT' ? `Bulan ke-${fu.stage}` : `Tahap ${fu.stage}`} {fu.custom_text ? '' : `(Varian ${((fu.stage-1)%3)+1})`}
                            </span>
                            {fu.custom_text ? (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-50 text-purple-700 border border-purple-200 ml-1">
                                Custom
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200 ml-1">
                                Auto
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-[#667781] truncate max-w-[220px]" title={fu.custom_text || getTemplateTextForTypeAndVariant(fu.type, fu.stage, ((fu.stage-1)%3)+1)}>{(fu.custom_text || getTemplateTextForTypeAndVariant(fu.type, fu.stage, ((fu.stage-1)%3)+1)).slice(0, 48)}...</span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5">{getStatusBadge(fu.status)}</td>

                      {/* Actions */}
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end space-x-1.5">
                          {fu.status === 'PENDING' && (
                            <button
                              onClick={() => setConfirmAction({ type: 'queue', id: fu.id })}
                              disabled={actionLoading === fu.id}
                              className="px-2.5 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 active:scale-95 border border-blue-200 text-blue-700 text-xs font-bold flex items-center space-x-1 transition shadow-xs"
                              title="Jadwalkan / Masukkan ke Antrian"
                            >
                              <CalendarCheck size={12} />
                              <span>Jadwalkan</span>
                            </button>
                          )}

                          {/* Chat History Modal Button */}
                          <button
                            onClick={() => fu.customer && handleOpenChatHistory(fu.customer)}
                            className="p-2 rounded-xl bg-white hover:bg-[#e8f5f2] active:scale-95 border border-[#d1d7db] text-[#54656f] hover:text-[#008069] text-xs font-semibold transition shadow-xs flex items-center"
                            title="Buka Riwayat Chat Modal"
                          >
                            <MessageSquare size={13} />
                          </button>

                          {/* Edit Modal Button */}
                          {(fu.status === 'PENDING' || fu.status === 'QUEUED') && (
                            <button
                              onClick={() => handleOpenEdit(fu)}
                              disabled={actionLoading === fu.id}
                              className="p-2 rounded-xl bg-white hover:bg-[#f0f2f5] active:scale-95 border border-[#d1d7db] text-[#54656f] hover:text-[#111b21] text-xs font-semibold transition shadow-xs"
                              title="Edit Jadwal, Varian & Teks Pesan"
                            >
                              <Edit2 size={13} />
                            </button>
                          )}

                          {/* Cancel Button */}
                          {(fu.status === 'PENDING' || fu.status === 'QUEUED') && (
                            <button
                              onClick={() => setConfirmAction({ type: 'cancel', id: fu.id })}
                              disabled={actionLoading === fu.id}
                              className="p-2 rounded-xl bg-rose-50 hover:bg-rose-100 active:scale-95 border border-rose-200 text-rose-600 text-xs font-semibold transition shadow-xs"
                              title="Batalkan Follow-Up"
                            >
                              <XCircle size={13} />
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
              className="bg-white border border-[#e9edef] rounded-2xl w-full max-w-xl shadow-2xl flex flex-col my-auto max-h-[88vh] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="p-4 sm:p-5 border-b border-[#e9edef] flex justify-between items-center bg-[#f8fafc] shrink-0">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-xl bg-[#e8f5f2] text-[#008069] flex items-center justify-center">
                    <Edit2 size={16} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-[#111b21] tracking-tight">Edit Follow-Up</h3>
                    <p className="text-[11px] text-[#54656f]">Atur jadwal pengiriman, varian pesan, atau sesuaikan teks khusus.</p>
                  </div>
                </div>
                <button
                  onClick={() => setEditModal({ open: false, newDate: '', stage: 1, variant: 1, customText: '' })}
                  className="p-1.5 rounded-lg text-[#8696a0] hover:text-[#111b21] hover:bg-[#e9edef] transition"
                  title="Tutup (Esc)"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4">
                {/* Customer Banner */}
                <div className="bg-[#f8fafc] p-3 rounded-xl border border-[#e9edef] flex items-center justify-between text-xs">
                  <div>
                    <span className="text-[#667781] block text-[10px]">Pelanggan</span>
                    <strong className="text-[#111b21] font-bold text-sm">
                      {editModal.item.customer?.name || 'Tanpa Nama'}
                    </strong>
                    <span className="text-[#667781] block font-mono text-[11px]">{editModal.item.customer?.phone}</span>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-[#e8f5f2] text-[#008069] border border-[#c2e7e0]">
                    {getTypeLabel(editModal.item.type, editModal.stage).label}
                  </span>
                </div>

                {/* Field 1: Jadwal Kirim */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-[#111b21] flex items-center space-x-1.5">
                    <Calendar size={14} className="text-[#008069]" />
                    <span>Jadwal Kirim</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={editModal.newDate}
                    onChange={(e) => setEditModal({ ...editModal, newDate: e.target.value })}
                    className="w-full p-2.5 bg-white border border-[#d1d7db] hover:border-[#008069] focus:border-[#008069] rounded-xl text-xs text-[#111b21] focus:outline-none shadow-xs transition font-medium"
                  />
                </div>

                {/* Field 2a: Tahap Jadwal (Stage) */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-[#111b21] flex items-center space-x-1.5">
                    <Calendar size={14} className="text-[#008069]" />
                    <span>Tahap Jadwal</span>
                    <span className="text-[10px] font-normal text-[#8696a0]">(kapan dikirim)</span>
                  </label>
                  <select
                    value={editModal.stage}
                    onChange={(e) => {
                      const newStage = parseInt(e.target.value, 10);
                      const templateText = getTemplateTextForTypeAndVariant(editModal.item!.type, newStage, editModal.variant);
                      setEditModal((prev) => ({ ...prev, stage: newStage, customText: templateText }));
                    }}
                    className="w-full p-2.5 bg-white border border-[#d1d7db] hover:border-[#008069] focus:border-[#008069] rounded-xl text-xs text-[#111b21] focus:outline-none shadow-xs font-medium"
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
                    ) : (
                      <>
                        <option value={1}>Tahap 1</option>
                        <option value={2}>Tahap 2</option>
                        <option value={3}>Tahap 3</option>
                      </>
                    )}
                  </select>
                  <p className="text-[10px] text-[#8696a0]">Mengganti tahap akan mengubah jadwal, varian tetap di tahap yang dipilih.</p>
                </div>

                {/* Field 2b: Varian Pesan (gaya bahasa) */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-[#111b21] flex items-center space-x-1.5">
                      <Sparkles size={14} className="text-amber-500" />
                      <span>Varian Pesan</span>
                      <span className="text-[10px] font-normal text-[#8696a0]">(gaya bahasa)</span>
                    </label>
                    <span className="text-[10px] text-[#8696a0]">Klik varian untuk ganti teks tanpa ubah jadwal</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[1, 2, 3].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => handleVariantSelect(v)}
                        className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center space-x-1.5 active:scale-95 ${
                          editModal.variant === v
                            ? 'bg-[#e8f5f2] border-[#008069] text-[#008069] shadow-xs'
                            : 'bg-white border-[#d1d7db] text-[#54656f] hover:bg-[#f8fafc]'
                        }`}
                      >
                        <span>Varian #{v}</span>
                        {editModal.variant === v && <CheckCircle size={12} className="text-[#008069]" />}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-[#8696a0]">Varian 1=Ramah/Hangat, 2=Promo/Direct, 3=Edukatif.</p>
                </div>

                {/* Field 3: Teks Pesan Follow-Up */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-[#111b21] flex items-center space-x-1.5">
                      <FileText size={14} className="text-[#008069]" />
                      <span>Teks Pesan Follow-Up</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        if (editModal.item) {
                          const defaultText = getTemplateTextForTypeAndVariant(editModal.item.type, editModal.stage, editModal.variant);
                          setEditModal((prev) => ({ ...prev, customText: defaultText }));
                        }
                      }}
                      className="text-[11px] text-[#008069] hover:underline flex items-center space-x-1 font-semibold"
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
                    className="w-full p-3 bg-white border border-[#d1d7db] hover:border-[#008069] focus:border-[#008069] rounded-xl text-xs text-[#111b21] focus:outline-none shadow-xs leading-relaxed transition font-sans"
                  />

                  {/* Tag Helpers */}
                  <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                    <span className="text-[10px] text-[#8696a0] flex items-center gap-1">
                      <Tag size={10} /> Sisipkan Variabel:
                    </span>
                    {['{name}', '{babyName}', '{time}'].map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() =>
                          setEditModal((prev) => ({
                            ...prev,
                            customText: `${prev.customText} ${tag}`,
                          }))
                        }
                        className="px-2 py-0.5 rounded-lg bg-[#f0f2f5] hover:bg-[#e9edef] text-[10px] font-mono text-[#54656f] border border-[#d1d7db] transition active:scale-95"
                      >
                        + {tag}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-[#8696a0] leading-tight">
                    * Variabel <code>{'{name}'}</code> akan otomatis disanitasi menjadi sapaan bersih (misal: "Bunda Rina").
                  </p>
                  {/* Live Preview */}
                  <div className="bg-[#f0fdf4] border border-emerald-200 rounded-xl p-3 space-y-1">
                    <p className="text-[10px] font-bold text-emerald-800 flex items-center gap-1"><Sparkles size={10} /> Preview WhatsApp (Bunda {(editModal.item?.customer as any)?.name?.split(' ')[0] || 'Rina'}, {(editModal.item?.customer as any)?.children?.[0]?.name || 'Kenzo'}):</p>
                    <p className="text-xs text-[#111b21] leading-relaxed whitespace-pre-wrap bg-white p-2 rounded-lg border border-emerald-100">
                      {editModal.customText
                        .replace(/Bunda\s*\{name\}/gi, `Bunda ${(editModal.item?.customer as any)?.name?.split(' ')[0] || 'Rina'}`)
                        .replace(/\{name\}/g, (editModal.item?.customer as any)?.name?.split(' ')[0] || 'Rina')
                        .replace(/\{babyName\}/g, (editModal.item?.customer as any)?.children?.[0]?.name ? `dek ${(editModal.item?.customer as any).children[0].name}` : 'dek Kenzo')
                        .replace(/\{time\}/g, '10:00 WIB') || '—'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="p-4 border-t border-[#e9edef] bg-[#f8fafc] flex justify-end space-x-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setEditModal({ open: false, newDate: '', stage: 1, variant: 1, customText: '' })}
                  className="px-4 py-2 bg-white hover:bg-[#f0f2f5] active:scale-95 border border-[#d1d7db] text-[#54656f] rounded-xl text-xs font-semibold transition"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleEditSave}
                  disabled={actionLoading === editModal.item.id}
                  className="px-5 py-2 bg-[#008069] hover:bg-[#00a884] active:scale-95 text-white rounded-xl text-xs font-bold transition shadow-xs flex items-center space-x-1.5"
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
      {/* PORTAL MODAL 2: Chat History Modal (In-Page Viewport Centered)            */}
      {/* ========================================================================= */}
      {chatModal.open &&
        chatModal.customer &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-black/60 backdrop-blur-xs animate-fadeIn"
            onClick={() => setChatModal((prev) => ({ ...prev, open: false }))}
          >
            <div
              className="bg-white border border-[#e9edef] rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col my-auto max-h-[85vh] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="p-4 border-b border-[#e9edef] flex justify-between items-center bg-[#f8fafc] shrink-0">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-full bg-[#008069] text-white flex items-center justify-center font-bold text-sm shadow-xs">
                    {chatModal.customer.name ? chatModal.customer.name.slice(0, 2).toUpperCase() : 'CU'}
                  </div>
                  <div>
                    <h3 className="font-bold text-[#111b21] text-sm flex items-center space-x-1.5">
                      <span>{chatModal.customer.name || 'Customer'}</span>
                      {chatModal.customer.conversations?.[0]?.is_human_handling && (
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                          Human Handling
                        </span>
                      )}
                    </h3>
                    <p className="text-[11px] text-[#667781] flex items-center space-x-2 mt-0.5">
                      <span className="font-mono">{chatModal.customer.phone}</span>
                      <span>•</span>
                      <span className="flex items-center space-x-0.5">
                        <MapPin size={10} className="text-[#8696a0]" />
                        <span>
                          {chatModal.customer.kelurahan ||
                            chatModal.customer.kecamatan ||
                            chatModal.customer.kota ||
                            'Surabaya/Sidoarjo'}
                        </span>
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <a
                    href="/admin/live-chat"
                    target="_blank"
                    rel="noreferrer"
                    className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-[#f0f2f5] active:scale-95 border border-[#d1d7db] text-[#54656f] text-xs font-semibold transition flex items-center space-x-1"
                    title="Buka Halaman Live Chat di Tab Baru"
                  >
                    <ExternalLink size={12} />
                    <span className="hidden sm:inline">Live Chat Tab</span>
                  </a>
                  <button
                    onClick={() => setChatModal((prev) => ({ ...prev, open: false }))}
                    className="p-1.5 rounded-lg text-[#8696a0] hover:text-[#111b21] hover:bg-[#e9edef] transition"
                    title="Tutup (Esc)"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* Modal Body: Message Stream with WhatsApp Pattern Background */}
              <div
                ref={chatContainerRef}
                className="p-4 overflow-y-auto flex-1 space-y-3 bg-[#efeae2] min-h-[300px]"
                style={{
                  backgroundImage: `radial-gradient(#d1d7db 0.75px, transparent 0.75px)`,
                  backgroundSize: '16px 16px',
                }}
              >
                {chatModal.loading ? (
                  <div className="flex justify-center items-center py-20">
                    <Loader2 className="animate-spin text-[#008069]" size={32} />
                  </div>
                ) : chatModal.messages.length === 0 ? (
                  <div className="text-center py-20 text-[#667781] text-xs">
                    <MessageSquare size={32} className="mx-auto text-[#8696a0] mb-2 opacity-40" />
                    <p className="font-semibold text-[#111b21]">Belum ada riwayat pesan tercatat.</p>
                    <p className="text-[#8696a0] mt-0.5">Ketik pesan di bawah untuk memulai percakapan.</p>
                  </div>
                ) : (
                  <>
                    {chatModal.messages.map((msg) => {
                      const isInbound = msg.direction === 'INBOUND';
                      const typeUpper = (msg.sender_type || '').toUpperCase();
                      const sender = isInbound
                        ? 'Customer'
                        : typeUpper === 'ADMIN' || typeUpper === 'HUMAN' || typeUpper === 'STAFF'
                        ? msg.sender_name || 'Admin'
                        : 'Bot';

                      return (
                        <div key={msg.id} className={`flex flex-col ${isInbound ? 'items-start' : 'items-end'}`}>
                          <div className="flex items-center space-x-1 text-[10px] text-[#667781] mb-0.5 px-1">
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
                            className={`max-w-[85%] sm:max-w-[75%] p-3 rounded-2xl text-xs leading-relaxed shadow-xs ${
                              isInbound
                                ? 'bg-white text-[#111b21] rounded-tl-none border border-black/5'
                                : 'bg-[#d9fdd3] text-[#111b21] rounded-tr-none border border-[#00a884]/20'
                            }`}
                          >
                            <p className="whitespace-pre-wrap">{msg.content}</p>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={chatMessagesEndRef} className="h-0 w-0 pointer-events-none" />
                  </>
                )}
              </div>

              {/* Modal Footer: Quick Reply Bar */}
              <form
                onSubmit={handleSendChatReply}
                className="p-3 border-t border-[#e9edef] bg-[#f8fafc] flex items-center space-x-2 shrink-0"
              >
                <input
                  type="text"
                  value={chatModal.replyText}
                  onChange={(e) => setChatModal({ ...chatModal, replyText: e.target.value })}
                  placeholder="Ketik balasan WhatsApp langsung ke nomor ini..."
                  className="flex-1 px-3.5 py-2.5 bg-white border border-[#d1d7db] hover:border-[#008069] focus:border-[#008069] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none shadow-xs transition"
                />
                <button
                  type="submit"
                  disabled={chatModal.sending || !chatModal.replyText.trim()}
                  className="px-4 py-2.5 bg-[#008069] hover:bg-[#00a884] active:scale-95 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition shadow-xs flex items-center space-x-1.5 shrink-0"
                >
                  {chatModal.sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  <span>Kirim</span>
                </button>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* ========================================================================= */}
      {/* PORTAL MODAL 3: Confirm Action Modal                                     */}
      {/* ========================================================================= */}
      {confirmAction &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-black/60 backdrop-blur-xs animate-fadeIn"
            onClick={() => setConfirmAction(null)}
          >
            <div
              className="bg-white border border-[#e9edef] rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-2xl my-auto"
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
              <p className="text-xs text-[#54656f] leading-relaxed">
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
                  className="px-4 py-2 bg-white hover:bg-[#f0f2f5] active:scale-95 border border-[#d1d7db] text-[#54656f] rounded-xl text-xs font-semibold transition"
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
                  className={`px-4 py-2 text-white rounded-xl text-xs font-bold transition shadow-xs active:scale-95 ${
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
          </div>,
          document.body
        )}

      {/* Toast Notification */}
      {toastMsg && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl border text-xs font-bold shadow-xl flex items-center space-x-2 animate-fadeIn ${
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
