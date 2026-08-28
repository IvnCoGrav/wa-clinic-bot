import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest, getCachedApiResponse } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useUiFeedback } from '../../components/common/UiFeedback';
import {
  Calendar,
  Clock,
  MapPin,
  Baby,
  CreditCard,
  Navigation,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  Send,
  Navigation2,
  Camera,
  Crosshair,
  UserCheck,
  User,
  Sparkles,
  Smile,
  X,
  MessageSquare,
  Users,
  CheckCheck,
  Download,
  Image as ImageIcon,
  Maximize2,
  BarChart3,
  Timer,
  ChevronDown,
  Info,
  Phone,
  CalendarDays,
  ArrowRight,
} from 'lucide-react';

interface TaskChild {
  name: string;
  rawAgeText: string | null;
  birthDate: string | null;
}

interface TaskAddress {
  kelurahan: string | null;
  kecamatan: string | null;
  kota: string | null;
  lat?: number | null;
  lng?: number | null;
  distanceKm: number | null;
  estimatedMinutes?: number | null;
  distanceSource?: 'CLINIC' | 'PREVIOUS_PATIENT' | null;
  originName?: string | null;
  fullText: string;
  landmark?: string | null;
  housePhotoUrl?: string | null;
}

interface TaskPricing {
  treatmentFee: number;
  deliveryFee: number;
  totalFee: number;
  paymentStatus: 'LUNAS' | 'TAGIH_DI_TEMPAT';
  paymentStatusLabel: string;
}

interface TreatmentTask {
  reservationId: string;
  customerName: string | null;
  treatmentDetail: string | null;
  treatmentCategory: string | null;
  bookingDate: string | null;
  status: string;
  conversationId: string | null;
  mapsUrl: string | null;
  navigationUrl: string | null;
  address: TaskAddress;
  children: TaskChild[];
  pricing: TaskPricing;
  shareLocationText?: string | null;
  customerProfilePictureUrl?: string | null;
  assignedStaff?: {
    id: string;
    name: string;
    phone: string;
    role?: string;
  } | null;
  customerStats?: {
    totalTreatments: number;
    ltv: number;
  };
}

interface DateMeta {
  dateStr: string;
  formattedDate: string;
  isToday: boolean;
  isTomorrow: boolean;
}

function formatRupiah(amount: number): string {
  return 'Rp ' + (amount || 0).toLocaleString('id-ID');
}

/**
 * Helper untuk membersihkan tag buffer dan menghasilkan list numbering bersih
 */
function parseNumberedTreatments(treatmentDetail: string | null): { items: string[]; totalMinutes: number } {
  if (!treatmentDetail) return { items: [], totalMinutes: 0 };

  const sanitized = treatmentDetail
    .replace(/\[\s*total.*?buffer.*?\]/gi, '')
    .replace(/\[\s*total\s*bufer.*?\]/gi, '')
    .replace(/\[\s*total\s*\d+m\s*\+\s*buffer.*?\]/gi, '')
    .replace(/\[\s*buffer.*?\]/gi, '')
    .replace(/\[\s*bufer.*?\]/gi, '')
    .replace(/\[\s*total\s*=\s*\d+.*?\]/gi, '')
    .replace(/\(\+?\d+m\s*buffer\)/gi, '')
    .replace(/\(\+?\d+m\s*bufer\)/gi, '')
    .replace(/\+\s*buffer\s*\d+m/gi, '')
    .replace(/\+\s*bufer\s*\d+m/gi, '')
    .replace(/\b\d+m\s*buffer\b/gi, '')
    .replace(/\b\d+m\s*bufer\b/gi, '')
    .replace(/\btotal\s*bufer\s*=\s*\d+m?\b/gi, '')
    .replace(/\btotal\s*buffer\s*=\s*\d+m?\b/gi, '')
    .trim();

  if (!sanitized) return { items: [], totalMinutes: 0 };

  const rawItems = sanitized
    .split(/\r?\n|,|;|\+|&/)
    .map((s) => s.trim())
    .filter(Boolean);

  let totalMins = 0;
  const cleanItems: string[] = [];

  for (const item of rawItems) {
    const itemLower = item.toLowerCase();
    if (itemLower.includes('buffer') || itemLower.includes('bufer') || itemLower.includes('total scheduled')) {
      continue;
    }

    const minMatch = item.match(/(\d+)\s*(?:menit|mins?|m\b)/i);
    const hourMatch = item.match(/(\d+(?:\.\d+)?)\s*(?:jam|hours?|h\b)/i);

    if (minMatch) {
      totalMins += parseInt(minMatch[1], 10);
    } else if (hourMatch) {
      totalMins += Math.round(parseFloat(hourMatch[1]) * 60);
    }

    const clean = item
      .replace(/\s*[\(\[\{]\s*\d+\s*(?:menit|mins?|jam|hours?|m|h)\s*[\)\]\}]/gi, '')
      .replace(/\s*[-–—:]\s*\d+\s*(?:menit|mins?|jam|hours?|m|h)/gi, '')
      .replace(/\b\d+\s*(?:menit|mins?|jam|hours?|m|h)\b/gi, '')
      .replace(/^\d+[\.\)\-]\s*/, '')
      .trim();

    if (clean && !clean.toLowerCase().includes('buffer') && !clean.toLowerCase().includes('bufer')) {
      cleanItems.push(clean);
    }
  }

  return {
    items: cleanItems.length > 0 ? cleanItems : [sanitized.replace(/\s*\(\d+.*?\)/g, '').trim()].filter(Boolean),
    totalMinutes: totalMins,
  };
}

export const TodayTreatments: React.FC = () => {
  const { user } = useAuth();
  const { toast, confirm } = useUiFeedback();

  // Date selection states: 'today' | 'tomorrow' | 'custom'
  const [dateTab, setDateTab] = useState<'today' | 'tomorrow' | 'custom'>('today');
  const [customDate, setCustomDate] = useState<string>(() => {
    const d = new Date();
    return d.toISOString().split('T')[0];
  });
  const [dateMeta, setDateMeta] = useState<DateMeta | null>(null);

  const cachedTasksRes = getCachedApiResponse<any>('/api/staff/today-tasks?scope=mine') || getCachedApiResponse<any>('/api/staff/today-tasks?scope=all');
  const [loading, setLoading] = useState(!cachedTasksRes?.data);
  const [tasks, setTasks] = useState<TreatmentTask[]>(() => Array.isArray(cachedTasksRes?.data) ? cachedTasksRes.data : []);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'OTW' | 'COMPLETED'>('ALL');
  const [scopeFilter, setScopeFilter] = useState<string>('mine');
  const [isSupervisor, setIsSupervisor] = useState(false);

  // Modals
  const [showMetricsModal, setShowMetricsModal] = useState(false);
  const [detailModalTask, setDetailModalTask] = useState<TreatmentTask | null>(null);

  // Delegation / Reassign Modal
  const [teamMembers, setTeamMembers] = useState<{ id: string; name: string; role?: string }[]>([]);
  const [reassignTask, setReassignTask] = useState<TreatmentTask | null>(null);
  const [reassignStaffId, setReassignStaffId] = useState<string>('');
  const [submittingReassign, setSubmittingReassign] = useState(false);

  // Payment Recording Modal
  const [paymentTask, setPaymentTask] = useState<TreatmentTask | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'TRANSFER' | 'QRIS'>('CASH');
  const [proofImageB64, setProofImageB64] = useState<string | null>(null);
  const [submittingPayment, setSubmittingPayment] = useState(false);

  // Location & House Photo Modal
  const [locationTask, setLocationTask] = useState<TreatmentTask | null>(null);
  const [locLandmark, setLocLandmark] = useState('');
  const [locCoords, setLocCoords] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [locHousePhotoB64, setLocHousePhotoB64] = useState<string | null>(null);
  const [locGettingGps, setLocGettingGps] = useState(false);
  const [locGpsError, setLocGpsError] = useState<string | null>(null);
  const [locSaving, setLocSaving] = useState(false);
  const locHouseFileInputRef = useRef<HTMLInputElement>(null);

  // Zoom Image Modal
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);

  // Sending OTW Status
  const [sendingOtwId, setSendingOtwId] = useState<string | null>(null);

  // Quick Chat Modal
  const [chatModalTask, setChatModalTask] = useState<TreatmentTask | null>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const [selectedChatImage, setSelectedChatImage] = useState<{ file: File; preview: string } | null>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);

  // Escape key handler for active modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (zoomImageUrl) setZoomImageUrl(null);
        else if (detailModalTask) setDetailModalTask(null);
        else if (showMetricsModal) setShowMetricsModal(false);
        else if (reassignTask) setReassignTask(null);
        else if (paymentTask) setPaymentTask(null);
        else if (locationTask) setLocationTask(null);
        else if (chatModalTask) setChatModalTask(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomImageUrl, detailModalTask, showMetricsModal, reassignTask, paymentTask, locationTask, chatModalTask]);

  // Category Icon & Accent Helper
  const getCategoryIcon = (category: string | null) => {
    const cat = (category || '').toUpperCase();
    if (cat === 'BABY') {
      return {
        icon: <Baby size={15} className="text-sky-600" />,
        badge: 'bg-sky-50 border-sky-200 text-sky-700',
        borderAccent: 'border-l-4 border-l-sky-500',
        label: 'Baby Spa',
      };
    }
    if (cat === 'MOMS') {
      return {
        icon: <Sparkles size={15} className="text-purple-600" />,
        badge: 'bg-purple-50 border-purple-200 text-purple-700',
        borderAccent: 'border-l-4 border-l-purple-500',
        label: 'Moms Spa',
      };
    }
    if (cat === 'BOTH' || cat === 'KIDS') {
      return {
        icon: <Smile size={15} className="text-emerald-600" />,
        badge: 'bg-emerald-50 border-emerald-200 text-emerald-700',
        borderAccent: 'border-l-4 border-l-emerald-500',
        label: 'Moms & Baby',
      };
    }
    return {
      icon: <User size={15} className="text-teal-600" />,
      badge: 'bg-teal-50 border-teal-200 text-teal-700',
      borderAccent: 'border-l-4 border-l-teal-500',
      label: 'Treatment',
    };
  };

  // OTW Safety Gate: Kirim OTW hanya aktif pada hari-H dan maksimal 2 jam sebelum jam kunjungan
  const isOtwAllowed = (task: TreatmentTask) => {
    if (dateTab !== 'today') return false;
    if (!task.bookingDate) return true;
    return Date.now() >= new Date(task.bookingDate).getTime() - 2 * 60 * 60 * 1000;
  };

  const fetchTasks = useCallback(async (isPolling = false) => {
    if (!isPolling && tasks.length === 0) setLoading(true);
    try {
      const apiScope = scopeFilter.startsWith('staff:') ? 'all' : scopeFilter;
      const apiDate = dateTab === 'custom' ? customDate : dateTab;
      const res = await apiRequest(`/api/staff/today-tasks?scope=${apiScope}&date=${apiDate}`);
      if (res.success && Array.isArray(res.data)) {
        setTasks(res.data);
        if (res.isSupervisor !== undefined) {
          setIsSupervisor(Boolean(res.isSupervisor));
        }
        if (res.meta) {
          setDateMeta(res.meta);
        }
      }
    } catch (err: any) {
      if (!isPolling && tasks.length === 0) toast(err.message || 'Gagal memuat tugas treatment.', 'error');
    } finally {
      setLoading(false);
    }
  }, [scopeFilter, dateTab, customDate, toast, tasks.length]);

  const fetchTeamMembers = useCallback(async () => {
    try {
      const res = await apiRequest('/api/staff/team-members');
      if (res.success && Array.isArray(res.data)) {
        setTeamMembers(res.data);
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    fetchTasks();
    fetchTeamMembers();

    const timer = setInterval(() => fetchTasks(true), 15000);
    return () => clearInterval(timer);
  }, [fetchTasks, fetchTeamMembers]);

  // Format jam:menit dan rentang jam mulai - jam selesai
  const formatTime = (isoString: string | null) => {
    if (!isoString) return '--:--';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
      return '--:--';
    }
  };

  const formatTimeRange = (isoString: string | null, totalDurationMinutes?: number) => {
    if (!isoString) return '--:--';
    try {
      const start = new Date(isoString);
      const startStr = start.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
      const duration = (totalDurationMinutes && totalDurationMinutes > 0) ? totalDurationMinutes : 60;
      const end = new Date(start.getTime() + duration * 60 * 1000);
      const endStr = end.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
      return `${startStr} - ${endStr}`;
    } catch {
      return '--:--';
    }
  };

  // Filtered Tasks
  const filteredTasks = tasks.filter((t) => {
    if (scopeFilter.startsWith('staff:')) {
      const targetStaffId = scopeFilter.replace('staff:', '');
      if (t.assignedStaff?.id !== targetStaffId) return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = (t.customerName || '').toLowerCase().includes(q);
      const matchTreat = (t.treatmentDetail || '').toLowerCase().includes(q);
      const matchAddr = (t.address.fullText || '').toLowerCase().includes(q);
      const matchStaff = (t.assignedStaff?.name || '').toLowerCase().includes(q);
      if (!matchName && !matchTreat && !matchAddr && !matchStaff) return false;
    }

    if (statusFilter === 'PENDING' && t.status.toLowerCase() !== 'pending') return false;
    if (statusFilter === 'OTW' && t.status.toLowerCase() !== 'otw') return false;
    if (statusFilter === 'COMPLETED' && t.status.toLowerCase() !== 'completed') return false;

    return true;
  });

  // Summary Metrics
  const totalCount = tasks.length;
  const completedCount = tasks.filter((t) => t.status.toLowerCase() === 'completed').length;
  const otwCount = tasks.filter((t) => t.status.toLowerCase() === 'otw').length;
  const pendingCount = tasks.filter((t) => t.status.toLowerCase() === 'pending').length;
  const lunasCount = tasks.filter((t) => t.pricing.paymentStatus === 'LUNAS').length;
  const totalRevenue = tasks.reduce((sum, t) => sum + (t.pricing.totalFee || 0), 0);

  // Handle Send OTW
  const handleSendOtw = async (task: TreatmentTask) => {
    if (dateTab !== 'today') {
      toast('Notifikasi OTW hanya dapat dikirim pada hari-H kunjungan.', 'info');
      return;
    }

    const ok = await confirm({
      title: 'Kirim Notifikasi OTW?',
      message: `Kirim pesan WhatsApp otomatis ke ${task.customerName || 'pasien'} bahwa terapis sedang meluncur ke lokasi?`,
      confirmText: 'Ya, Kirim OTW',
    });
    if (!ok) return;

    setSendingOtwId(task.reservationId);
    try {
      const res = await apiRequest(`/api/staff/reservations/${task.reservationId}/otw`, { method: 'POST' });
      if (res.success) {
        toast('Notifikasi OTW berhasil dikirim ke WhatsApp pasien!', 'success');
        fetchTasks(true);
      }
    } catch (err: any) {
      toast(err.message || 'Gagal mengirim notifikasi OTW.', 'error');
    } finally {
      setSendingOtwId(null);
    }
  };

  // Handle Reassign
  const handleOpenReassign = (task: TreatmentTask) => {
    setReassignTask(task);
    setReassignStaffId(task.assignedStaff?.id || '');
  };

  const handleSaveReassign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reassignTask || !reassignStaffId) return;

    setSubmittingReassign(true);
    try {
      const res = await apiRequest(`/api/staff/reservations/${reassignTask.reservationId}/reassign`, {
        method: 'POST',
        body: JSON.stringify({ targetStaffId: reassignStaffId, staffId: reassignStaffId }),
      });
      if (res.success) {
        toast('Jadwal berhasil didelegasikan ke terapis baru.', 'success');
        setReassignTask(null);
        fetchTasks();
      }
    } catch (err: any) {
      toast(err.message || 'Gagal mendelegasikan jadwal.', 'error');
    } finally {
      setSubmittingReassign(false);
    }
  };

  // Handle Payment
  const handleSavePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentTask) return;

    setSubmittingPayment(true);
    try {
      const res = await apiRequest(`/api/staff/reservations/${paymentTask.reservationId}/payment`, {
        method: 'POST',
        body: JSON.stringify({
          paymentMethod,
          proofImageB64: paymentMethod !== 'CASH' ? proofImageB64 : null,
        }),
      });
      if (res.success) {
        toast('Status pembayaran berhasil diperbarui menjadi LUNAS.', 'success');
        setPaymentTask(null);
        setProofImageB64(null);
        fetchTasks();
      }
    } catch (err: any) {
      toast(err.message || 'Gagal menyimpan status lunas.', 'error');
    } finally {
      setSubmittingPayment(false);
    }
  };

  // Handle Location & GPS
  const handleOpenLocationModal = (task: TreatmentTask) => {
    setLocationTask(task);
    setLocLandmark(task.address.landmark || '');
    setLocCoords(task.address.lat && task.address.lng ? { lat: task.address.lat, lng: task.address.lng } : null);
    setLocGpsError(null);
    setLocHousePhotoB64(task.address.housePhotoUrl || null);
  };

  const handleGetGps = () => {
    if (!navigator.geolocation) {
      setLocGpsError('Browser tidak mendukung GPS Geolocation.');
      return;
    }
    setLocGettingGps(true);
    setLocGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
        });
        setLocGettingGps(false);
      },
      (err) => {
        setLocGpsError('Gagal membaca GPS: ' + err.message);
        setLocGettingGps(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const handleSaveLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!locationTask) return;

    setLocSaving(true);
    try {
      const res = await apiRequest(`/api/staff/reservations/${locationTask.reservationId}/location`, {
        method: 'POST',
        body: JSON.stringify({
          landmark: locLandmark || null,
          lat: locCoords?.lat || null,
          lng: locCoords?.lng || null,
          housePhotoB64: locHousePhotoB64 || null,
        }),
      });
      if (res.success) {
        toast('Titik lokasi dan foto rumah berhasil disimpan.', 'success');
        setLocationTask(null);
        fetchTasks();
      }
    } catch (err: any) {
      toast(err.message || 'Gagal menyimpan lokasi.', 'error');
    } finally {
      setLocSaving(false);
    }
  };

  // Handle Chat Modal
  const handleOpenChat = async (task: TreatmentTask) => {
    setChatModalTask(task);
    setReplyText('');
    setSelectedChatImage(null);
    if (!task.conversationId) {
      setChatMessages([]);
      return;
    }

    setLoadingChat(true);
    try {
      const res = await apiRequest(`/api/staff/conversations/${task.conversationId}/messages`);
      if (res.success && Array.isArray(res.data)) {
        setChatMessages(res.data);
      }
    } catch (err: any) {
      toast(err.message || 'Gagal memuat pesan chat.', 'error');
    } finally {
      setLoadingChat(false);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatModalTask?.conversationId || (!replyText.trim() && !selectedChatImage)) return;

    setSendingChat(true);
    try {
      let imageBase64: string | undefined;
      if (selectedChatImage) {
        imageBase64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(selectedChatImage.file);
        });
      }

      const res = await apiRequest(`/api/staff/conversations/${chatModalTask.conversationId}/reply`, {
        method: 'POST',
        body: JSON.stringify({
          message: replyText.trim(),
          imageBase64,
        }),
      });

      if (res.success) {
        setReplyText('');
        setSelectedChatImage(null);
        toast('Pesan berhasil terkirim ke WhatsApp pasien.', 'success');
        const updated = await apiRequest(`/api/staff/conversations/${chatModalTask.conversationId}/messages`);
        if (updated.success && Array.isArray(updated.data)) {
          setChatMessages(updated.data);
        }
      }
    } catch (err: any) {
      toast(err.message || 'Gagal mengirim pesan chat.', 'error');
    } finally {
      setSendingChat(false);
    }
  };

  // Effective display date string
  const displayDateText = dateMeta?.formattedDate || (dateTab === 'today' ? 'Hari Ini' : dateTab === 'tomorrow' ? 'Besok' : customDate);

  return (
    <div className="space-y-5 animate-fadeIn pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#e9edef]">
        <div className="flex items-center space-x-3.5">
          <div className="h-12 w-12 rounded-2xl bg-[#008069] text-white flex items-center justify-center shadow-sm shrink-0">
            {dateTab === 'tomorrow' ? <Sparkles size={24} className="animate-pulse text-amber-200" /> : <CalendarDays size={24} />}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-black text-[#111b21] tracking-tight">
                {dateTab === 'today' ? 'Treatment Hari Ini' : dateTab === 'tomorrow' ? 'Treatment Besok' : 'Jadwal Treatment'}
              </h1>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold border ${
                dateTab === 'tomorrow'
                  ? 'bg-purple-50 text-purple-700 border-purple-200'
                  : 'bg-[#e8f5f2] text-[#008069] border-[#c2e7e0]'
              }`}>
                {filteredTasks.length} Jadwal
              </span>
            </div>
            <p className="text-xs text-[#54656f] mt-1 flex items-center gap-1.5 font-medium">
              <Calendar size={13} className="text-[#008069] shrink-0" />
              <span className="font-semibold text-[#111b21]">{displayDateText}</span>
              {dateTab === 'tomorrow' && (
                <span className="text-[11px] px-1.5 py-0.2 rounded bg-purple-100 text-purple-800 font-bold ml-1">
                  Besok
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Date Segmented Tabs & Scope Select */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Segmented Date Control */}
          <div className="inline-flex p-1 rounded-2xl bg-[#f0f2f5] border border-[#e9edef] shadow-2xs">
            <button
              type="button"
              onClick={() => setDateTab('today')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all duration-150 cursor-pointer ${
                dateTab === 'today'
                  ? 'bg-white text-[#008069] shadow-xs ring-1 ring-[#008069]/20'
                  : 'text-[#54656f] hover:text-[#111b21]'
              }`}
            >
              📅 Hari Ini
            </button>
            <button
              type="button"
              onClick={() => setDateTab('tomorrow')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all duration-150 cursor-pointer ${
                dateTab === 'tomorrow'
                  ? 'bg-white text-purple-700 shadow-xs ring-1 ring-purple-500/20'
                  : 'text-[#54656f] hover:text-[#111b21]'
              }`}
            >
              ✨ Besok
            </button>
            <div className="relative inline-flex items-center">
              <input
                type="date"
                value={customDate}
                onChange={(e) => {
                  if (e.target.value) {
                    setCustomDate(e.target.value);
                    setDateTab('custom');
                  }
                }}
                className={`text-xs font-bold px-2.5 py-1.5 rounded-xl border-0 bg-transparent cursor-pointer focus:outline-none ${
                  dateTab === 'custom'
                    ? 'bg-white text-sky-700 shadow-xs ring-1 ring-sky-500/20'
                    : 'text-[#54656f] hover:text-[#111b21]'
                }`}
                title="Pilih Tanggal Tertentu"
              />
            </div>
          </div>

          {/* Scope Select (Mine vs All) */}
          <div className="relative">
            <select
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value)}
              className="bg-white border border-[#d1d7db] text-[#111b21] text-xs font-bold rounded-xl px-3 py-2 pr-8 focus:outline-none focus:border-[#008069] shadow-xs cursor-pointer appearance-none min-h-[38px]"
            >
              <option value="mine">🛵 Tugas Saya</option>
              {isSupervisor && <option value="all">👥 Semua Terapis</option>}
              {teamMembers.length > 0 && (
                <optgroup label="Terapis Spesifik">
                  {teamMembers.map((m) => (
                    <option key={m.id} value={`staff:${m.id}`}>
                      👤 {m.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-[#54656f]">
              <ChevronDown size={14} />
            </div>
          </div>

          {/* Metrics Modal Toggle */}
          <button
            onClick={() => setShowMetricsModal(true)}
            className="p-2.5 rounded-xl bg-white border border-[#d1d7db] text-[#111b21] hover:bg-[#f0f2f5] transition shadow-xs active:scale-[0.98] cursor-pointer min-h-[38px] min-w-[38px] flex items-center justify-center"
            title="Rekap Ringkasan Metrik"
          >
            <BarChart3 size={16} className="text-[#008069]" />
          </button>

          {/* Reload Button */}
          <button
            onClick={() => fetchTasks()}
            disabled={loading}
            className="p-2.5 rounded-xl bg-white border border-[#d1d7db] text-[#54656f] hover:text-[#111b21] hover:bg-[#f0f2f5] transition shadow-xs disabled:opacity-50 active:scale-[0.98] cursor-pointer min-h-[38px] min-w-[38px] flex items-center justify-center"
            title="Muat Ulang Tugas"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin text-[#008069]' : ''} />
          </button>
        </div>
      </div>

      {/* Date Notice Banner if Tomorrow or Custom Date */}
      {dateTab !== 'today' && (
        <div className={`p-3.5 rounded-2xl border flex items-center justify-between text-xs font-semibold ${
          dateTab === 'tomorrow'
            ? 'bg-purple-50/70 border-purple-200 text-purple-900'
            : 'bg-sky-50/70 border-sky-200 text-sky-900'
        }`}>
          <div className="flex items-center gap-2.5">
            <Info size={16} className={dateTab === 'tomorrow' ? 'text-purple-600' : 'text-sky-600'} />
            <span>
              {dateTab === 'tomorrow'
                ? `Menampilkan jadwal persiapan treatment untuk BESOK (${displayDateText}). Anda dapat meninjau rute dan mendelegasikan terapis lebih awal.`
                : `Menampilkan jadwal treatment untuk tanggal ${displayDateText}.`}
            </span>
          </div>
          <button
            onClick={() => setDateTab('today')}
            className="px-3 py-1 bg-white border border-current rounded-xl text-xs font-bold hover:bg-white/80 transition cursor-pointer shrink-0 ml-2"
          >
            Kembali ke Hari Ini
          </button>
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="bg-white p-3.5 rounded-2xl border border-[#e9edef] shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-[#8696a0]">
            <Search size={14} />
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari pasien, alamat, terapis, atau treatment..."
            className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-[#f0f2f5] border-0 text-[#111b21] text-xs focus:outline-none focus:ring-2 focus:ring-[#008069] min-h-[38px]"
          />
        </div>

        <div className="flex items-center space-x-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setStatusFilter('ALL')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
              statusFilter === 'ALL'
                ? 'bg-[#008069] text-white shadow-xs'
                : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef]'
            }`}
          >
            Semua ({tasks.length})
          </button>
          <button
            onClick={() => setStatusFilter('PENDING')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
              statusFilter === 'PENDING'
                ? 'bg-[#008069] text-white shadow-xs'
                : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef]'
            }`}
          >
            Menunggu ({pendingCount})
          </button>
          <button
            onClick={() => setStatusFilter('OTW')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
              statusFilter === 'OTW'
                ? 'bg-[#008069] text-white shadow-xs'
                : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef]'
            }`}
          >
            OTW ({otwCount})
          </button>
          <button
            onClick={() => setStatusFilter('COMPLETED')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
              statusFilter === 'COMPLETED'
                ? 'bg-[#008069] text-white shadow-xs'
                : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef]'
            }`}
          >
            Selesai ({completedCount})
          </button>
        </div>
      </div>

      {/* Task List Cards */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-[#e9edef] p-12 text-center text-[#667781] shadow-xs">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-3 border-[#008069] border-t-transparent mb-3"></div>
          <p className="text-xs font-bold text-[#111b21]">Memuat daftar tugas treatment...</p>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#e9edef] p-12 text-center text-[#667781] shadow-xs space-y-3">
          <Calendar size={40} className="mx-auto text-[#8696a0]" />
          <h3 className="font-bold text-sm text-[#111b21]">
            {dateTab === 'tomorrow'
              ? 'Belum ada reservasi treatment terjadwal untuk besok'
              : 'Tidak ada jadwal treatment yang cocok'}
          </h3>
          <p className="text-xs text-[#8696a0] max-w-md mx-auto">
            {searchQuery
              ? 'Coba ganti kata kunci pencarian.'
              : dateTab === 'tomorrow'
              ? 'Reservasi yang masuk dan telah dikonfirmasi untuk besok akan otomatis muncul di sini.'
              : 'Belum ada reservasi treatment pada filter ini.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredTasks.map((task) => {
            const isCompleted = task.status.toLowerCase() === 'completed';
            const isOtw = task.status.toLowerCase() === 'otw';
            const isLunas = task.pricing.paymentStatus === 'LUNAS';
            const catCfg = getCategoryIcon(task.treatmentCategory);
            const otwReady = isOtwAllowed(task);
            const parsedTreatments = parseNumberedTreatments(task.treatmentDetail);

            return (
              <div
                key={task.reservationId}
                onClick={() => setDetailModalTask(task)}
                className={`bg-white rounded-2xl border p-5 shadow-xs transition-all space-y-4 relative cursor-pointer group hover:shadow-md ${catCfg.borderAccent} ${
                  isCompleted
                    ? 'border-emerald-200 bg-emerald-50/10'
                    : isOtw
                    ? 'border-sky-300 bg-sky-50/15 ring-1 ring-sky-300'
                    : 'border-[#e9edef] hover:border-[#008069]'
                }`}
              >
                {/* Card Top: Time, Avatar, Status, Assigned Staff */}
                <div className="flex items-start justify-between gap-3 border-b border-[#f0f2f5] pb-3">
                  <div className="flex items-center space-x-3">
                    <div className="relative shrink-0">
                      {task.customerProfilePictureUrl ? (
                        <img
                          src={task.customerProfilePictureUrl}
                          alt={task.customerName || 'Pasien'}
                          className="h-11 w-11 rounded-2xl object-cover border border-[#c2e7e0] shadow-xs"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <div className="h-11 w-11 rounded-2xl bg-[#e8f5f2] border border-[#c2e7e0] text-[#008069] flex items-center justify-center font-extrabold text-sm shadow-xs">
                          {(task.customerName || 'P').charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="absolute -bottom-1 -right-1 px-1.5 py-0.5 rounded-md bg-[#111b21] text-white text-[9px] font-mono font-bold shadow-xs whitespace-nowrap">
                        {formatTimeRange(task.bookingDate, parsedTreatments.totalMinutes)}
                      </span>
                    </div>

                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h3 className="font-bold text-sm text-[#111b21] group-hover:text-[#008069] transition">
                          {task.customerName || 'Customer'}
                        </h3>
                        <span
                          className={`p-1 rounded-md border ${catCfg.badge} inline-flex items-center justify-center shadow-2xs`}
                          title={catCfg.label}
                        >
                          {catCfg.icon}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 text-[11px] text-[#54656f] mt-0.5 font-mono" title="Terapis Penanggung Jawab">
                        <UserCheck size={13} className="text-[#008069] shrink-0" />
                        <span className="font-bold text-[#008069] truncate">{task.assignedStaff?.name || 'Belum Ditugaskan'}</span>
                      </div>

                      {task.customerStats && (
                        <div className="flex items-center gap-1.5 mt-1 text-[10px]">
                          <span className="inline-flex items-center px-1.5 py-0.2 rounded-md bg-[#e8f5f2] text-[#008069] font-bold">
                            {task.customerStats.totalTreatments > 1 ? `${task.customerStats.totalTreatments}x Treatment` : 'Pasien Baru (1x)'}
                          </span>
                          <span className="text-[#8696a0] font-mono">
                            LTV: {formatRupiah(task.customerStats.ltv)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    {isCompleted ? (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#d9fdd3] text-[#008069] border border-[#00a884]/30 flex items-center gap-1">
                        <CheckCircle2 size={12} />
                        <span>Selesai</span>
                      </span>
                    ) : isOtw ? (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-sky-100 text-sky-800 border border-sky-300 flex items-center gap-1 animate-pulse">
                        <Navigation2 size={12} />
                        <span>Sedang OTW</span>
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                        Menunggu
                      </span>
                    )}

                    {isLunas ? (
                      <span className="text-[10px] font-bold text-[#008069]">✓ Lunas</span>
                    ) : (
                      <span className="text-[10px] font-bold text-amber-700">Tagih: {formatRupiah(task.pricing.totalFee)}</span>
                    )}
                  </div>
                </div>

                {/* Treatment List Numbering Bersih + Total Waktu Terpadu */}
                <div className="space-y-2 text-xs">
                  <div className="space-y-1">
                    {parsedTreatments.items.map((treatmentName, idx) => (
                      <div key={idx} className="font-semibold text-[#111b21] flex items-start gap-2">
                        <span className="h-5 w-5 rounded-full bg-[#e8f5f2] text-[#008069] flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">
                          {idx + 1}
                        </span>
                        <span className="leading-tight pt-0.5">{treatmentName}</span>
                      </div>
                    ))}
                  </div>

                  {/* Total Estimasi Waktu Layanan & Data Anak */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {parsedTreatments.totalMinutes > 0 && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-bold">
                        <Timer size={12} className="text-amber-600" />
                        <span>Total Durasi: {parsedTreatments.totalMinutes} Menit</span>
                      </span>
                    )}

                    {task.children && task.children.length > 0 && (
                      task.children.map((c, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-lg bg-sky-50 text-sky-800 border border-sky-200 text-[11px]"
                        >
                          <Baby size={11} />
                          <span>{c.name} {c.rawAgeText ? `(${c.rawAgeText})` : ''}</span>
                        </span>
                      ))
                    )}
                  </div>
                </div>

                {/* Address, Chain Route & Landmark */}
                <div className="p-3 bg-[#f8fafc] rounded-xl border border-[#e9edef] space-y-1.5 text-xs">
                  <div className="flex items-start gap-1.5 text-[#111b21]">
                    <MapPin size={14} className="text-[#008069] mt-0.5 shrink-0" />
                    <span className="line-clamp-2">{task.address.fullText || 'Alamat belum tercatat lengkap'}</span>
                  </div>
                  
                  {task.address.landmark && (
                    <p className="text-[11px] text-[#54656f] pl-5">
                      <span className="font-bold text-[#111b21]">Patokan:</span> {task.address.landmark}
                    </p>
                  )}

                  {/* Chain Route Smart Indicator */}
                  {task.address.distanceKm !== null && (
                    <div className="pl-5 pt-0.5 flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="font-bold text-[#008069] font-mono">
                        📍 ±{task.address.distanceKm.toFixed(1)} km
                      </span>
                      {task.address.distanceSource === 'PREVIOUS_PATIENT' ? (
                        <span className="px-2 py-0.2 rounded-md bg-purple-50 text-purple-700 border border-purple-200 font-medium text-[10px]">
                          Rute Berantai dari {task.address.originName || 'Pasien Sebelumnya'}
                        </span>
                      ) : (
                        <span className="px-2 py-0.2 rounded-md bg-gray-100 text-gray-700 border border-gray-200 font-medium text-[10px]">
                          Dari Klinik
                        </span>
                      )}
                      {task.address.estimatedMinutes && (
                        <span className="text-[#8696a0] text-[10px] font-mono">
                          (Est. {task.address.estimatedMinutes} menit)
                        </span>
                      )}
                    </div>
                  )}

                  {/* House Photo Thumbnail */}
                  {task.address.housePhotoUrl && (
                    <div className="pl-5 pt-1.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setZoomImageUrl(task.address.housePhotoUrl || null);
                        }}
                        className="group relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white border border-[#d1d7db] text-[11px] font-bold text-[#54656f] hover:text-[#008069] hover:border-[#008069] transition shadow-2xs cursor-pointer"
                      >
                        <ImageIcon size={13} className="text-[#008069]" />
                        <span>Lihat Foto Depan Rumah Pasien</span>
                        <Maximize2 size={11} className="text-[#8696a0] group-hover:scale-110 transition" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Mobile-First Action Buttons Toolbar */}
                <div
                  className="pt-3 border-t border-[#f0f2f5] space-y-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="grid grid-cols-3 sm:flex sm:items-center gap-2">
                    {/* Buka Google Maps */}
                    {(task.navigationUrl || task.mapsUrl) && (
                      <a
                        href={task.navigationUrl || task.mapsUrl || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="py-2.5 px-3 rounded-xl bg-white border border-[#d1d7db] text-[#111b21] hover:bg-[#f0f2f5] text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition active:scale-95 touch-manipulation cursor-pointer"
                        title="Buka Peta Navigasi"
                      >
                        <Navigation size={14} className="text-[#008069]" />
                        <span>Maps</span>
                      </a>
                    )}

                    {/* Update GPS & Foto Rumah */}
                    <button
                      onClick={() => handleOpenLocationModal(task)}
                      className="py-2.5 px-3 rounded-xl bg-white border border-[#d1d7db] text-[#54656f] hover:text-[#111b21] hover:bg-[#f0f2f5] text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition active:scale-95 touch-manipulation cursor-pointer"
                      title="Update Titik GPS & Foto Rumah"
                    >
                      <Camera size={14} />
                      <span>Lokasi</span>
                    </button>

                    {/* Chat Pasien */}
                    <button
                      onClick={() => handleOpenChat(task)}
                      className="py-2.5 px-3 rounded-xl bg-white border border-[#d1d7db] text-[#54656f] hover:text-[#111b21] hover:bg-[#f0f2f5] text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition active:scale-95 touch-manipulation cursor-pointer"
                      title="Buka Live Chat WhatsApp Pasien"
                    >
                      <MessageSquare size={14} className="text-[#008069]" />
                      <span>Chat</span>
                    </button>
                  </div>

                  {/* Operasional Actions: Kirim OTW, Catat Lunas, Delegasi */}
                  <div className="grid grid-cols-1 sm:flex sm:items-center sm:justify-end gap-2 pt-1">
                    {!isCompleted && !isOtw && (
                      <button
                        onClick={() => handleSendOtw(task)}
                        disabled={sendingOtwId === task.reservationId || !otwReady}
                        className={`w-full sm:w-auto py-2.5 px-4 rounded-xl text-white text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-xs active:scale-95 touch-manipulation cursor-pointer ${
                          dateTab !== 'today'
                            ? 'bg-gray-300 text-gray-600 border border-gray-300 cursor-not-allowed opacity-80'
                            : otwReady
                            ? 'bg-sky-600 hover:bg-sky-700 disabled:opacity-50'
                            : 'bg-gray-400 cursor-not-allowed opacity-70'
                        }`}
                        title={
                          dateTab !== 'today'
                            ? 'Tombol Kirim OTW hanya aktif pada hari-H kunjungan'
                            : otwReady
                            ? 'Kirim notifikasi OTW ke pasien'
                            : 'Tombol OTW aktif 2 jam sebelum jam treatment'
                        }
                      >
                        <Send size={13} />
                        <span>
                          {dateTab !== 'today'
                            ? 'Jadwal Besok (OTW Hari-H)'
                            : otwReady
                            ? 'Kirim OTW'
                            : 'OTW (Aktif H-2 Jam)'}
                        </span>
                      </button>
                    )}

                    {!isLunas && (
                      <button
                        onClick={() => {
                          setPaymentTask(task);
                          setPaymentMethod('CASH');
                          setProofImageB64(null);
                        }}
                        className="w-full sm:w-auto py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-xs active:scale-95 touch-manipulation cursor-pointer"
                      >
                        <CreditCard size={13} />
                        <span>Catat Lunas</span>
                      </button>
                    )}

                    {isSupervisor && (
                      <button
                        onClick={() => handleOpenReassign(task)}
                        className="w-full sm:w-auto py-2.5 px-3.5 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-xs active:scale-95 touch-manipulation cursor-pointer"
                        title={task.assignedStaff ? 'Ganti Terapis yang Ditugaskan' : 'Delegasikan Jadwal ke Terapis Lain'}
                      >
                        <UserCheck size={14} />
                        <span>{task.assignedStaff ? 'Ganti Terapis' : 'Delegasikan'}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL DETAIL LENGKAP CUSTOMER & TREATMENT */}
      {/* ========================================================================= */}
      {detailModalTask &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fadeIn h-[100dvh] w-[100dvw]"
            onClick={() => setDetailModalTask(null)}
          >
            <div
              className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-6 w-full max-w-lg shadow-2xl border border-[#e9edef] space-y-4 text-left relative max-h-[85dvh] sm:max-h-[80dvh] overflow-y-auto overscroll-contain animate-modalScaleUp"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header Detail */}
              <div className="flex items-start justify-between border-b border-[#e9edef] pb-3">
                <div className="flex items-center space-x-3">
                  {detailModalTask.customerProfilePictureUrl ? (
                    <img
                      src={detailModalTask.customerProfilePictureUrl}
                      alt={detailModalTask.customerName || 'Pasien'}
                      className="h-12 w-12 rounded-2xl object-cover border border-[#c2e7e0] shadow-xs"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded-2xl bg-[#e8f5f2] border border-[#c2e7e0] text-[#008069] flex items-center justify-center font-extrabold text-base shadow-xs">
                      {(detailModalTask.customerName || 'P').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <h3 className="font-bold text-base text-[#111b21] flex items-center gap-1.5">
                      <span>{detailModalTask.customerName || 'Customer'}</span>
                      <span
                        className={`p-1 rounded-md border ${getCategoryIcon(detailModalTask.treatmentCategory).badge} inline-flex items-center justify-center`}
                        title={getCategoryIcon(detailModalTask.treatmentCategory).label}
                      >
                        {getCategoryIcon(detailModalTask.treatmentCategory).icon}
                      </span>
                    </h3>
                    <p className="text-xs text-[#54656f] mt-0.5">
                      Jam Kunjungan:{' '}
                      <span className="font-bold text-[#111b21]">
                        {formatTimeRange(
                          detailModalTask.bookingDate,
                          parseNumberedTreatments(detailModalTask.treatmentDetail).totalMinutes
                        )}
                      </span>
                    </p>
                    {detailModalTask.customerStats && (
                      <div className="flex items-center gap-2 mt-1 text-[11px]">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-[#e8f5f2] text-[#008069] font-bold">
                          {detailModalTask.customerStats.totalTreatments > 1
                            ? `${detailModalTask.customerStats.totalTreatments}x Treatment`
                            : 'Pasien Baru (1x)'}
                        </span>
                        <span className="text-[#54656f] font-mono">
                          LTV: <strong className="text-[#111b21]">{formatRupiah(detailModalTask.customerStats.ltv)}</strong>
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => setDetailModalTask(null)}
                  className="p-1.5 rounded-full text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5] transition cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Treatment & Layanan */}
              <div className="p-3.5 bg-[#f8fafc] rounded-2xl border border-[#e9edef] space-y-2">
                <span className="text-[10px] font-bold text-[#54656f] uppercase tracking-wider block">
                  Layanan Treatment Dipesan
                </span>
                <div className="space-y-1 text-xs">
                  {parseNumberedTreatments(detailModalTask.treatmentDetail).items.map((it, idx) => (
                    <div key={idx} className="font-semibold text-[#111b21] flex items-start gap-2">
                      <span className="h-5 w-5 rounded-full bg-[#e8f5f2] text-[#008069] flex items-center justify-center font-bold text-[10px] shrink-0">
                        {idx + 1}
                      </span>
                      <span>{it}</span>
                    </div>
                  ))}
                </div>

                {parseNumberedTreatments(detailModalTask.treatmentDetail).totalMinutes > 0 && (
                  <div className="pt-1">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 text-xs font-bold">
                      <Timer size={12} className="text-amber-600" />
                      <span>Total Estimasi Waktu: {parseNumberedTreatments(detailModalTask.treatmentDetail).totalMinutes} Menit</span>
                    </span>
                  </div>
                )}
              </div>

              {/* Data Pasien Anak */}
              {detailModalTask.children && detailModalTask.children.length > 0 && (
                <div className="p-3.5 bg-[#f8fafc] rounded-2xl border border-[#e9edef] space-y-1.5">
                  <span className="text-[10px] font-bold text-[#54656f] uppercase tracking-wider block">
                    Data Pasien Anak
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {detailModalTask.children.map((c, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-xl bg-sky-50 text-sky-800 border border-sky-200 text-xs font-semibold"
                      >
                        <Baby size={13} />
                        <span>{c.name} {c.rawAgeText ? `(${c.rawAgeText})` : ''}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Alamat & Lokasi */}
              <div className="p-3.5 bg-[#f8fafc] rounded-2xl border border-[#e9edef] space-y-2">
                <span className="text-[10px] font-bold text-[#54656f] uppercase tracking-wider block">
                  Alamat & Titik Lokasi
                </span>
                <p className="text-xs text-[#111b21] leading-relaxed">{detailModalTask.address.fullText}</p>
                
                {detailModalTask.address.landmark && (
                  <p className="text-xs text-[#54656f]">
                    <span className="font-bold text-[#111b21]">Patokan:</span> {detailModalTask.address.landmark}
                  </p>
                )}

                {detailModalTask.address.housePhotoUrl && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setZoomImageUrl(detailModalTask.address.housePhotoUrl || null)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-[#d1d7db] text-xs font-bold text-[#008069] shadow-2xs hover:bg-[#e8f5f2] cursor-pointer"
                    >
                      <ImageIcon size={14} />
                      <span>Lihat Foto Depan Rumah (Zoom)</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Rincian Finansial */}
              <div className="p-3.5 bg-[#f8fafc] rounded-2xl border border-[#e9edef] space-y-2 text-xs">
                <span className="text-[10px] font-bold text-[#54656f] uppercase tracking-wider block">
                  Rincian Biaya & Status Pembayaran
                </span>
                <div className="space-y-1">
                  <div className="flex justify-between text-[#54656f]">
                    <span>Biaya Layanan:</span>
                    <span>{formatRupiah(detailModalTask.pricing.treatmentFee)}</span>
                  </div>
                  <div className="flex justify-between text-[#54656f]">
                    <span>Ongkos Kirim:</span>
                    <span>{formatRupiah(detailModalTask.pricing.deliveryFee)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-[#111b21] pt-1 border-t border-[#e9edef]">
                    <span>Total Tagihan:</span>
                    <span className="text-[#008069] text-sm">{formatRupiah(detailModalTask.pricing.totalFee)}</span>
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-between">
                  <span className="text-xs text-[#54656f]">Status Pembayaran:</span>
                  {detailModalTask.pricing.paymentStatus === 'LUNAS' ? (
                    <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-[#d9fdd3] text-[#008069] border border-[#00a884]/30 flex items-center space-x-1">
                      <CheckCircle2 size={12} />
                      <span>LUNAS</span>
                    </span>
                  ) : (
                    <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300 flex items-center space-x-1">
                      <CreditCard size={12} />
                      <span>TAGIH DI TEMPAT</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Action Buttons di Modal */}
              <div className="pt-2 flex space-x-2">
                {(detailModalTask.navigationUrl || detailModalTask.mapsUrl) && (
                  <a
                    href={detailModalTask.navigationUrl || detailModalTask.mapsUrl || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 py-2.5 px-4 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 shadow-xs cursor-pointer"
                  >
                    <Navigation size={14} />
                    <span>Buka Peta</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const t = detailModalTask;
                    setDetailModalTask(null);
                    handleOpenChat(t);
                  }}
                  className="py-2.5 px-4 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#111b21] rounded-xl text-xs font-bold transition flex items-center space-x-1.5 cursor-pointer"
                >
                  <MessageSquare size={14} className="text-[#008069]" />
                  <span>Chat WA</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDetailModalTask(null)}
                  className="py-2.5 px-4 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] rounded-xl text-xs font-bold transition cursor-pointer"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* ========================================================================= */}
      {/* MODAL DETAIL REKAP RESERVASI */}
      {/* ========================================================================= */}
      {showMetricsModal &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fadeIn h-[100dvh] w-[100dvw]"
            onClick={() => setShowMetricsModal(false)}
          >
            <div
              className="bg-white rounded-3xl p-6 w-full max-w-lg shadow-2xl border border-[#e9edef] space-y-4 text-left relative max-h-[85dvh] sm:max-h-[80dvh] overflow-y-auto overscroll-contain animate-modalScaleUp"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between border-b border-[#e9edef] pb-3">
                <div className="flex items-center space-x-2.5">
                  <div className="h-10 w-10 rounded-2xl bg-[#e8f5f2] text-[#008069] flex items-center justify-center border border-[#c2e7e0] shadow-xs">
                    <BarChart3 size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-[#111b21]">
                      Rekap Metrik Treatment {dateTab === 'today' ? 'Hari Ini' : dateTab === 'tomorrow' ? 'Besok' : displayDateText}
                    </h3>
                    <p className="text-xs text-[#54656f]">{displayDateText}</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowMetricsModal(false)}
                  className="p-1.5 rounded-full text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5] transition cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="bg-[#f8fafc] rounded-2xl border border-[#e9edef] p-4">
                  <span className="text-[11px] font-bold text-[#54656f] uppercase tracking-wider block">Total Treatment</span>
                  <p className="text-2xl font-black text-[#111b21] mt-1">{totalCount}</p>
                  <span className="text-[11px] text-[#8696a0]">Kunjungan terjadwal</span>
                </div>

                <div className="bg-emerald-50/40 rounded-2xl border border-emerald-200 p-4">
                  <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider block">Selesai</span>
                  <p className="text-2xl font-black text-emerald-700 mt-1">{completedCount}</p>
                  <span className="text-[11px] text-emerald-600">Pasien telah ditangani</span>
                </div>

                <div className="bg-sky-50/40 rounded-2xl border border-sky-200 p-4">
                  <span className="text-[11px] font-bold text-sky-700 uppercase tracking-wider block">Sedang OTW</span>
                  <p className="text-2xl font-black text-sky-700 mt-1">{otwCount}</p>
                  <span className="text-[11px] text-sky-600">Dalam perjalanan</span>
                </div>

                <div className="bg-amber-50/40 rounded-2xl border border-amber-200 p-4">
                  <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wider block">Status Lunas</span>
                  <p className="text-2xl font-black text-amber-700 mt-1">{lunasCount} / {totalCount}</p>
                  <span className="text-[11px] text-amber-600">{totalCount - lunasCount} Tagih di tempat</span>
                </div>
              </div>

              <div className="p-4 bg-[#f8fafc] rounded-2xl border border-[#e9edef] flex items-center justify-between text-xs">
                <span className="font-bold text-[#54656f]">Total Nilai Transaksi:</span>
                <span className="font-black text-sm text-[#008069]">{formatRupiah(totalRevenue)}</span>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setShowMetricsModal(false)}
                  className="px-5 py-2.5 rounded-xl bg-[#008069] text-white text-xs font-bold hover:bg-[#00a884] transition cursor-pointer shadow-xs"
                >
                  Tutup Rekap
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* ========================================================================= */}
      {/* MODAL FULL SCREEN ZOOM IMAGE */}
      {/* ========================================================================= */}
      {zoomImageUrl &&
        createPortal(
          <div
            className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn h-[100dvh] w-[100dvw]"
            onClick={() => setZoomImageUrl(null)}
          >
            <div className="relative max-w-3xl w-full max-h-[90dvh] flex flex-col items-center justify-center p-2" onClick={(e) => e.stopPropagation()}>
              <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
                <a
                  href={zoomImageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  download
                  className="p-2 rounded-full bg-white/20 hover:bg-white/40 text-white backdrop-blur-md transition"
                  title="Buka / Download Foto Asli"
                >
                  <Download size={18} />
                </a>
                <button
                  onClick={() => setZoomImageUrl(null)}
                  className="p-2 rounded-full bg-white/20 hover:bg-white/40 text-white backdrop-blur-md transition cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
              <img src={zoomImageUrl} alt="Zoom" className="max-w-full max-h-[85dvh] object-contain rounded-2xl shadow-2xl" />
            </div>
          </div>,
          document.body
        )}

      {/* ========================================================================= */}
      {/* MODAL DELEGASI & GANTI TERAPIS */}
      {/* ========================================================================= */}
      {reassignTask &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fadeIn h-[100dvh] w-[100dvw]"
            onClick={() => setReassignTask(null)}
          >
            <div
              className="bg-white rounded-2xl sm:rounded-3xl w-full max-w-md max-h-[85dvh] sm:max-h-[80dvh] flex flex-col shadow-2xl border border-[#e9edef] overflow-hidden animate-modalScaleUp relative"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-[#e9edef] bg-[#f8fafc] flex items-start justify-between shrink-0">
                <div className="flex items-center space-x-2.5">
                  <div className="h-10 w-10 rounded-2xl bg-purple-100 text-purple-700 flex items-center justify-center border border-purple-200 shadow-xs">
                    <UserCheck size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-[#111b21]">
                      {reassignTask.assignedStaff ? 'Ganti Terapis Jadwal' : 'Delegasikan Jadwal'}
                    </h3>
                    <p className="text-xs text-[#54656f] truncate max-w-[220px]">
                      {reassignTask.customerName || 'Pasien'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setReassignTask(null)}
                  className="p-1.5 rounded-full text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5] transition cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveReassign} className="flex-1 overflow-y-auto p-5 space-y-4 text-left overscroll-contain">
                <div className="p-3.5 bg-[#f8fafc] rounded-2xl border border-[#e9edef] space-y-1.5 text-xs">
                  <p className="text-[#54656f]">
                    Jam Kunjungan: <span className="font-bold text-[#111b21]">{formatTime(reassignTask.bookingDate)}</span>
                  </p>
                  <p className="text-[#54656f]">
                    Treatment: <span className="font-bold text-[#111b21]">{reassignTask.treatmentDetail}</span>
                  </p>
                  <p className="text-[#54656f]">
                    Terapis Saat Ini: <span className="font-bold text-purple-700">{reassignTask.assignedStaff?.name || 'Belum Ditugaskan'}</span>
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-[#111b21]">Pilih Terapis Pengganti:</label>
                  <select
                    value={reassignStaffId}
                    onChange={(e) => setReassignStaffId(e.target.value)}
                    className="w-full bg-white border border-[#d1d7db] rounded-xl p-3 text-xs text-[#111b21] font-semibold focus:outline-none focus:border-[#008069] shadow-xs"
                  >
                    <option value="">-- Pilih Staf Terapis --</option>
                    {teamMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.role || 'Staff'})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#e9edef]">
                  <button
                    type="button"
                    onClick={() => setReassignTask(null)}
                    className="px-4 py-2.5 rounded-xl border border-[#d1d7db] text-xs font-semibold text-[#54656f] hover:bg-[#f0f2f5] transition cursor-pointer"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={submittingReassign || !reassignStaffId}
                    className="px-5 py-2.5 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
                  >
                    {submittingReassign ? <span>Menyimpan...</span> : <span>{reassignTask.assignedStaff ? 'Simpan Ganti Terapis' : 'Simpan Delegasi'}</span>}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* ========================================================================= */}
      {/* MODAL PENCATATAN PEMBAYARAN */}
      {/* ========================================================================= */}
      {paymentTask &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fadeIn h-[100dvh] w-[100dvw]"
            onClick={() => setPaymentTask(null)}
          >
            <div
              className="bg-white rounded-2xl sm:rounded-3xl w-full max-w-md max-h-[85dvh] sm:max-h-[80dvh] flex flex-col shadow-2xl border border-[#e9edef] overflow-hidden animate-modalScaleUp relative"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-[#e9edef] bg-[#f8fafc] flex items-start justify-between shrink-0">
                <div className="flex items-center space-x-2.5">
                  <div className="h-10 w-10 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center border border-amber-200 shadow-xs">
                    <CreditCard size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-[#111b21]">Catat Pembayaran Lunas</h3>
                    <p className="text-xs text-[#54656f] truncate max-w-[220px]">
                      {paymentTask.customerName || 'Pasien'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setPaymentTask(null)}
                  className="p-1.5 rounded-full text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5] transition cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSavePayment} className="flex-1 overflow-y-auto p-5 space-y-4 text-left overscroll-contain">
                <div className="p-3.5 bg-amber-50/50 rounded-2xl border border-amber-200 text-xs space-y-1">
                  <div className="flex justify-between text-[#54656f]">
                    <span>Biaya Layanan:</span>
                    <span>{formatRupiah(paymentTask.pricing.treatmentFee)}</span>
                  </div>
                  <div className="flex justify-between text-[#54656f]">
                    <span>Ongkos Kirim:</span>
                    <span>{formatRupiah(paymentTask.pricing.deliveryFee)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-[#111b21] pt-1 border-t border-amber-200">
                    <span>Total Tagihan:</span>
                    <span className="text-[#008069] text-sm">{formatRupiah(paymentTask.pricing.totalFee)}</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-[#111b21]">Metode Pembayaran:</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['CASH', 'TRANSFER', 'QRIS'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setPaymentMethod(m)}
                        className={`py-2 px-3 rounded-xl text-xs font-bold border transition cursor-pointer ${
                          paymentMethod === m
                            ? 'bg-[#008069] text-white border-[#008069] shadow-xs'
                            : 'bg-white text-[#54656f] border-[#d1d7db] hover:bg-[#f0f2f5]'
                        }`}
                      >
                        {m === 'CASH' ? '💵 Tunai' : m === 'TRANSFER' ? '🏦 Transfer' : '📱 QRIS'}
                      </button>
                    ))}
                  </div>
                </div>

                {paymentMethod !== 'CASH' && (
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-[#111b21]">Upload Bukti Transfer:</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onloadend = () => setProofImageB64(reader.result as string);
                          reader.readAsDataURL(file);
                        }
                      }}
                      className="w-full text-xs text-[#54656f] file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-[#e8f5f2] file:text-[#008069] hover:file:bg-[#c2e7e0] cursor-pointer"
                    />
                    {proofImageB64 && (
                      <div className="relative mt-2 rounded-xl overflow-hidden border">
                        <img src={proofImageB64} alt="Bukti" className="h-28 w-auto object-contain" />
                        <button
                          type="button"
                          onClick={() => setZoomImageUrl(proofImageB64)}
                          className="absolute bottom-1 right-1 p-1 bg-black/60 text-white rounded-md text-[10px] flex items-center gap-1 cursor-pointer"
                        >
                          <Maximize2 size={10} />
                          <span>Zoom</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#e9edef]">
                  <button
                    type="button"
                    onClick={() => setPaymentTask(null)}
                    className="px-4 py-2.5 rounded-xl border border-[#d1d7db] text-xs font-semibold text-[#54656f] hover:bg-[#f0f2f5] transition cursor-pointer"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={submittingPayment}
                    className="px-5 py-2.5 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
                  >
                    {submittingPayment ? <span>Menyimpan...</span> : <span>Simpan Status Lunas</span>}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* ========================================================================= */}
      {/* MODAL UPDATE LOKASI & FOTO RUMAH */}
      {/* ========================================================================= */}
      {locationTask &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fadeIn h-[100dvh] w-[100dvw]"
            onClick={() => setLocationTask(null)}
          >
            <div
              className="bg-white rounded-2xl sm:rounded-3xl w-full max-w-md max-h-[85dvh] sm:max-h-[80dvh] flex flex-col shadow-2xl border border-[#e9edef] overflow-hidden animate-modalScaleUp relative"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-[#e9edef] bg-[#f8fafc] flex items-start justify-between shrink-0">
                <div className="flex items-center space-x-2.5">
                  <div className="h-10 w-10 rounded-2xl bg-[#e8f5f2] text-[#008069] flex items-center justify-center border border-[#c2e7e0] shadow-xs">
                    <MapPin size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-[#111b21]">Update Lokasi & Foto Rumah</h3>
                    <p className="text-xs text-[#54656f] truncate max-w-[220px]">
                      {locationTask.customerName || 'Pasien'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setLocationTask(null)}
                  className="p-1.5 rounded-full text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5] transition cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveLocation} className="flex-1 overflow-y-auto p-5 space-y-4 text-left overscroll-contain">
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-[#111b21]">Patokan Rumah (Landmark):</label>
                  <input
                    type="text"
                    value={locLandmark}
                    onChange={(e) => setLocLandmark(e.target.value)}
                    placeholder="Contoh: Pagar hitam, depan pos satpam blok C..."
                    className="w-full bg-white border border-[#d1d7db] rounded-xl p-3 text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                  />
                </div>

                {/* GPS Lock */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-[#111b21]">Kunci Titik GPS Akurat:</label>
                  <button
                    type="button"
                    onClick={handleGetGps}
                    disabled={locGettingGps}
                    className="w-full py-2.5 px-4 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-[#008069] border border-emerald-300 text-xs font-bold transition flex items-center justify-center space-x-2 cursor-pointer shadow-2xs"
                  >
                    <Crosshair size={14} className={locGettingGps ? 'animate-spin' : ''} />
                    <span>{locGettingGps ? 'Mengunci GPS...' : '📍 Kunci Titik GPS Saya Sekarang'}</span>
                  </button>

                  {locCoords && (
                    <p className="text-[11px] text-[#008069] font-mono font-bold bg-[#d9fdd3]/60 p-2 rounded-lg border border-[#00a884]/30">
                      ✓ Koordinat: {locCoords.lat.toFixed(6)}, {locCoords.lng.toFixed(6)} (Akurasi: ±{locCoords.accuracy || 10}m)
                    </p>
                  )}
                  {locGpsError && (
                    <p className="text-[11px] text-rose-600 bg-rose-50 p-2 rounded-lg border border-rose-200">
                      {locGpsError}
                    </p>
                  )}
                </div>

                {/* Foto Rumah */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-[#111b21]">Foto Tampak Depan Rumah:</label>
                  <input
                    type="file"
                    ref={locHouseFileInputRef}
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onloadend = () => setLocHousePhotoB64(reader.result as string);
                        reader.readAsDataURL(file);
                      }
                    }}
                    className="hidden"
                  />

                  {locHousePhotoB64 ? (
                    <div className="relative rounded-2xl overflow-hidden border border-[#e9edef] bg-black/5 flex items-center justify-center max-h-40">
                      <img src={locHousePhotoB64} alt="Rumah" className="object-contain max-h-40 w-auto rounded-xl" />
                      <div className="absolute top-2 right-2 flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setZoomImageUrl(locHousePhotoB64)}
                          className="p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition shadow-md cursor-pointer"
                          title="Zoom Foto"
                        >
                          <Maximize2 size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setLocHousePhotoB64(null)}
                          className="p-1.5 rounded-full bg-rose-600 text-white hover:bg-rose-700 transition shadow-md cursor-pointer"
                          title="Hapus Foto"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => locHouseFileInputRef.current?.click()}
                      className="w-full py-3 border-2 border-dashed border-[#d1d7db] rounded-2xl text-xs font-semibold text-[#54656f] hover:border-[#008069] hover:bg-[#e8f5f2]/40 transition flex items-center justify-center space-x-2 cursor-pointer"
                    >
                      <Camera size={16} className="text-[#008069]" />
                      <span>Upload / Ambil Foto Rumah Pasien</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#e9edef]">
                  <button
                    type="button"
                    onClick={() => setLocationTask(null)}
                    className="px-4 py-2.5 rounded-xl border border-[#d1d7db] text-xs font-semibold text-[#54656f] hover:bg-[#f0f2f5] transition cursor-pointer"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={locSaving}
                    className="px-5 py-2.5 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
                  >
                    {locSaving ? <span>Menyimpan...</span> : <span>Simpan Lokasi</span>}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* ========================================================================= */}
      {/* MODAL QUICK LIVE CHAT */}
      {/* ========================================================================= */}
      {chatModalTask &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fadeIn h-[100dvh] w-[100dvw]"
            onClick={() => setChatModalTask(null)}
          >
            <div
              className="bg-white rounded-2xl sm:rounded-3xl w-full max-w-lg max-h-[85dvh] sm:max-h-[80dvh] flex flex-col shadow-2xl border border-[#e9edef] overflow-hidden animate-modalScaleUp relative"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="px-5 py-3.5 border-b border-[#e9edef] bg-[#f8fafc] flex items-center justify-between shrink-0">
                <div className="flex items-center space-x-2.5">
                  <div className="h-9 w-9 rounded-full bg-[#008069] text-white flex items-center justify-center font-bold text-xs shadow-xs">
                    {chatModalTask.customerName?.charAt(0) || 'P'}
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-[#111b21]">{chatModalTask.customerName || 'Pasien'}</h3>
                    <p className="text-[10px] text-[#008069] font-medium">WhatsApp Pasien</p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <a
                    href="/admin/live-chat"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2.5 py-1 rounded-lg bg-[#e8f5f2] text-[#008069] hover:bg-[#c2e7e0] text-xs font-bold transition flex items-center gap-1 border border-[#c2e7e0]"
                    title="Buka Halaman Live Chat Lengkap di Tab Baru"
                  >
                    <span>Live Chat Penuh ↗</span>
                  </a>
                  <button
                    onClick={() => setChatModalTask(null)}
                    className="p-1.5 rounded-full text-[#8696a0] hover:text-[#111b21] hover:bg-[#e9edef] transition cursor-pointer"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* Quick Replies Templates Bar */}
              <div className="p-2 border-b border-[#e9edef] bg-[#f0f2f5] flex items-center gap-1.5 overflow-x-auto shrink-0">
                <button
                  type="button"
                  onClick={() => setReplyText(`Halo Bunda ${chatModalTask.customerName || ''}, saya dari Kala Moms & Baby Spa. Mau konfirmasi jadwal treatment ya Bun 🙏`)}
                  className="px-2.5 py-1 rounded-lg bg-white border border-[#d1d7db] text-[11px] font-bold text-[#54656f] hover:text-[#008069] hover:border-[#008069] transition shrink-0 cursor-pointer"
                >
                  👋 Sapa Pasien
                </button>
                <button
                  type="button"
                  onClick={() => setReplyText(`Bunda ${chatModalTask.customerName || ''}, saya sudah meluncur OTW ke lokasi Bunda ya 🛵 Estimasi sampai sekitar 15-20 menit.`)}
                  className="px-2.5 py-1 rounded-lg bg-white border border-[#d1d7db] text-[11px] font-bold text-[#54656f] hover:text-[#008069] hover:border-[#008069] transition shrink-0 cursor-pointer"
                >
                  🛵 Meluncur OTW
                </button>
                <button
                  type="button"
                  onClick={() => setReplyText(`Halo Bunda, saya sudah sampai di depan rumah/lokasi Bunda ya 🏠`)}
                  className="px-2.5 py-1 rounded-lg bg-white border border-[#d1d7db] text-[11px] font-bold text-[#54656f] hover:text-[#008069] hover:border-[#008069] transition shrink-0 cursor-pointer"
                >
                  🏠 Sudah Sampai
                </button>
              </div>

              {/* Message History */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-[#efeae2]/30 overscroll-contain">
                {loadingChat ? (
                  <div className="text-center py-10 text-xs text-[#54656f]">Memuat riwayat chat...</div>
                ) : chatMessages.length === 0 ? (
                  <div className="text-center py-10 text-xs text-[#8696a0]">Belum ada pesan tercatat.</div>
                ) : (
                  chatMessages.map((m: any) => {
                    const isOut = m.direction === 'OUTBOUND';
                    return (
                      <div key={m.id} className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-xs shadow-xs ${
                            isOut ? 'bg-[#d9fdd3] text-[#111b21] rounded-tr-xs' : 'bg-white text-[#111b21] rounded-tl-xs'
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words">{m.content}</p>
                          <span className="block text-[9px] text-[#8696a0] text-right mt-1 font-mono">
                            {formatTime(m.created_at)}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Selected Image Attachment Preview */}
              {selectedChatImage && (
                <div className="p-2 border-t border-[#e9edef] bg-white flex items-center justify-between shrink-0">
                  <div className="flex items-center space-x-2">
                    <img src={selectedChatImage.preview} alt="Lampiran" className="h-10 w-10 object-cover rounded-lg border" />
                    <span className="text-xs text-[#54656f] font-medium">{selectedChatImage.file.name}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedChatImage(null)}
                    className="p-1 text-rose-500 hover:text-rose-700 cursor-pointer"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}

              {/* Input Reply */}
              <form onSubmit={handleSendReply} className="p-3 border-t border-[#e9edef] bg-white flex items-center gap-2 shrink-0">
                <input
                  type="file"
                  ref={chatFileInputRef}
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setSelectedChatImage({ file, preview: URL.createObjectURL(file) });
                    }
                  }}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => chatFileInputRef.current?.click()}
                  className="p-2 text-[#54656f] hover:text-[#008069] hover:bg-[#f0f2f5] rounded-xl transition cursor-pointer"
                  title="Lampirkan Gambar"
                >
                  <Camera size={18} />
                </button>

                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Ketik pesan balasan ke pasien..."
                  className="flex-1 px-3.5 py-2 rounded-xl bg-[#f0f2f5] border-0 text-xs text-[#111b21] focus:outline-none focus:ring-2 focus:ring-[#008069]"
                />
                <button
                  type="submit"
                  disabled={sendingChat || (!replyText.trim() && !selectedChatImage)}
                  className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center gap-1 shadow-xs cursor-pointer"
                >
                  <Send size={13} />
                  <span>Kirim</span>
                </button>
              </form>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default TodayTreatments;
