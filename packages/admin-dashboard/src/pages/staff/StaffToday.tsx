import React, { useEffect, useRef, useState, useCallback } from 'react';
import { apiRequest } from '../../services/api';
import { useStaffAuth } from '../../contexts/StaffAuthContext';
import { useUiFeedback } from '../../components/common/UiFeedback';
import {
  MessageSquare,
  AlertTriangle,
  Clock,
  Send,
  Wifi,
  WifiOff,
  Bot,
  User,
  MapPin,
  Calendar,
  LogOut,
  ChevronLeft,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  Navigation,
  CreditCard,
  Baby,
  Search,
  CheckCheck,
  Compass,
  Smile,
  Plus,
  Navigation2,
  Upload,
  Image as ImageIcon,
  X,
  MessageSquareOff,
  Trash2,
} from 'lucide-react';
import { MediaImage, ChatMediaData } from '../../components/common/MediaImage';
import { emitBootPhase } from '../../lib/bootProgress';

interface StaffTaskChild {
  name: string;
  rawAgeText: string | null;
  birthDate: string | null;
}

interface StaffTaskAddress {
  kelurahan: string | null;
  kecamatan: string | null;
  kota: string | null;
  distanceKm: number | null;
  estimatedMinutes?: number | null;
  distanceSource?: 'CLINIC' | 'PREVIOUS_PATIENT' | null;
  originName?: string | null;
  fullText: string;
}

interface StaffTaskPricing {
  treatmentFee: number;
  deliveryFee: number;
  totalFee: number;
  paymentStatus: 'LUNAS' | 'TAGIH_DI_TEMPAT';
  paymentStatusLabel: string;
}

interface StaffTask {
  reservationId: string;
  customerName: string | null;
  treatmentDetail: string | null;
  treatmentCategory: string | null;
  bookingDate: string | null;
  status: string;
  conversationId: string | null;
  mapsUrl: string | null;
  navigationUrl: string | null;
  address: StaffTaskAddress;
  children: StaffTaskChild[];
  pricing: StaffTaskPricing;
  shareLocationText: string | null;
}

interface ChatMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  content: string;
  sender_type?: string | null;
  sender_name?: string | null;
  created_at: string;
  media?: ChatMediaData;
}

function extractMedia(msg: any): ChatMediaData | undefined {
  const m = msg?.payload_raw?.media ?? msg?.payloadRaw?.media ?? msg?.media;
  if (m && (m.url || m.hdUrl)) return m;
  return undefined;
}

function formatRupiah(amount: number): string {
  return 'Rp ' + (amount || 0).toLocaleString('id-ID');
}

// Sound notification generator using Web Audio API
function playNotificationSound() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (_) {}
}

export const StaffToday: React.FC = () => {
  const { staff, logout } = useStaffAuth();
  const { toast, confirm } = useUiFeedback();
  
  // Navigation Tabs: 'today' (Hari Ini & Live Chat) vs 'upcoming' (Jadwal Mendatang)
  const [activeTab, setActiveTab] = useState<'today' | 'upcoming'>('today');

  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<StaffTask[]>([]);
  const [upcomingTasks, setUpcomingTasks] = useState<StaffTask[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTask, setSelectedTask] = useState<StaffTask | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [sseConnected, setSseConnected] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
  const [sendingOtwId, setSendingOtwId] = useState<string | null>(null);

  // Payment Recording Modal State
  const [paymentModalTask, setPaymentModalTask] = useState<StaffTask | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'TRANSFER' | 'QRIS'>('CASH');
  const [proofImageB64, setProofImageB64] = useState<string | null>(null);
  const [submittingPayment, setSubmittingPayment] = useState(false);

  // Gateway capability (WAHA supportsRevoke=true vs WABA supportsRevoke=false)
  const [gatewayCapability, setGatewayCapability] = useState<{ provider: string; supportsRevoke: boolean } | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const selectedTaskRef = useRef<StaffTask | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  selectedTaskRef.current = selectedTask;

  // Tandai boot progress: halaman portal staff sudah tampil
  useEffect(() => {
    emitBootPhase('mount');
  }, []);

  // Format booking time
  const formatTime = (isoString: string | null) => {
    if (!isoString) return '-';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace(':', '.') + ' WIB';
    } catch {
      return isoString;
    }
  };

  // Format full date in Indonesian locale (e.g. "Sabtu, 15 Agustus 2026")
  const formatDateGroup = (isoString: string | null) => {
    if (!isoString) return 'Jadwal Mendatang';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      return isoString;
    }
  };

  // Request browser notification permission and load gateway capability once
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
    apiRequest('/api/staff/gateway-capability')
      .then((res) => {
        if (res?.success && res.data) setGatewayCapability(res.data);
      })
      .catch(() => {});
  }, []);

  // Fetch today tasks and upcoming schedule
  const fetchTasks = useCallback(async (isPolling = false) => {
    if (!isPolling) setLoading(true);
    try {
      const [todayRes, upcomingRes] = await Promise.all([
        apiRequest('/api/staff/today-tasks'),
        apiRequest('/api/staff/upcoming-schedule'),
      ]);

      if (todayRes.success && Array.isArray(todayRes.data)) {
        setTasks(todayRes.data);
        if (selectedTaskRef.current) {
          const updated = todayRes.data.find(
            (t: StaffTask) => t.reservationId === selectedTaskRef.current?.reservationId
          );
          if (updated) setSelectedTask(updated);
        }
      }

      if (upcomingRes.success && Array.isArray(upcomingRes.data)) {
        setUpcomingTasks(upcomingRes.data);
      }
    } catch (err: any) {
      if (!isPolling) setErrorMessage(err.message || 'Gagal memuat jadwal tugas.');
    } finally {
      if (!isPolling) {
        setLoading(false);
        emitBootPhase('data');
      }
    }
  }, []);

  // Auto-poll tasks every 20s
  useEffect(() => {
    fetchTasks();
    const interval = setInterval(() => fetchTasks(true), 20000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  // Fetch messages for selected task conversation (Dibatasi maksimal 10 bubble chat)
  const fetchMessages = useCallback(async (conversationId: string) => {
    setLoadingMessages(true);
    setErrorMessage(null);
    try {
      const res = await apiRequest(`/api/staff/conversations/${conversationId}/messages`);
      if (res.success && Array.isArray(res.data)) {
        setMessages(res.data.slice(-10));
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal memuat riwayat pesan.');
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  // Load conversation when task is selected
  useEffect(() => {
    if (selectedTask?.conversationId) {
      fetchMessages(selectedTask.conversationId);
    } else {
      setMessages([]);
    }
  }, [selectedTask?.conversationId, fetchMessages]);

  // Auto scroll chat to bottom
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, loadingMessages]);

  // Connect SSE for realtime live chat messages
  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimeout: any = null;

    const connectSSE = () => {
      es = new EventSource('/api/staff/live-chat/events');

      es.onopen = () => {
        setSseConnected(true);
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'connected') return;

          if (data.type === 'message.created' && data.payload?.message) {
            const msg = data.payload.message;
            const convId = data.payload.conversationId;

            // Play notification tone
            playNotificationSound();

            // Native browser notification
            if ('Notification' in window && Notification.permission === 'granted') {
              const sender = msg.sender_name || (msg.direction === 'INBOUND' ? 'Customer' : 'Bot');
              new Notification(`Pesan Baru dari ${sender}`, {
                body: msg.content || 'Mengirim media/gambar',
                icon: '/pwa-icon.svg',
              });
            }

            // Append message if matches currently open conversation (Maksimal 10 bubble)
            if (selectedTaskRef.current?.conversationId === convId) {
              setMessages((prev) => {
                if (prev.some((m) => m.id === msg.id)) return prev;
                return [...prev, msg].slice(-10);
              });
            }
          }

          if (data.type === 'message.updated' && data.payload?.messageId) {
            const { messageId, content, isRevoked } = data.payload;
            if (selectedTaskRef.current?.conversationId === data.payload.conversationId) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === messageId ? { ...m, content, is_revoked: isRevoked } : m
                )
              );
            }
          }
        } catch {
          // Ignore non-JSON heartbeat
        }
      };

      es.onerror = () => {
        setSseConnected(false);
        if (es) {
          es.close();
          es = null;
        }
        reconnectTimeout = setTimeout(connectSSE, 4000);
      };
    };

    connectSSE();

    return () => {
      if (es) es.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, []);

  // Send reply message
  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !selectedTask?.conversationId || sending) return;

    const textToSend = replyText.trim();
    const signature = `~ ${staff?.name || 'Bidan Terapis'}`;
    const optimisticContent = textToSend.endsWith(signature) ? textToSend : `${textToSend}\n\n${signature}`;

    setSending(true);
    setErrorMessage(null);

    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: ChatMessage = {
      id: tempId,
      direction: 'OUTBOUND',
      content: optimisticContent,
      sender_type: 'STAFF',
      sender_name: staff?.name || 'Staff',
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimisticMsg].slice(-10));
    setReplyText('');

    try {
      const res = await apiRequest(`/api/staff/conversations/${selectedTask.conversationId}/reply`, {
        method: 'POST',
        body: JSON.stringify({ text: textToSend }),
      });

      if (res.success && res.data) {
        setMessages((prev) => prev.map((m) => (m.id === tempId ? res.data : m)));
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal mengirim pesan balasan.');
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setReplyText(textToSend);
    } finally {
      setSending(false);
    }
  };

  // Quick Action: Send OTW notification using dynamic Super Admin template
  const handleSendOtw = async (task: StaffTask, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    if (!task.conversationId) {
      toast('Belum ada riwayat percakapan WhatsApp untuk pasien ini.', 'error');
      return;
    }

    const patientName = task.customerName || 'Bunda';

    try {
      // Ambil teks template OTW aktif yang telah dikonfigurasi di Super Admin
      let otwMessage = `Halo ${patientName}, saya ${staff?.name || 'Bidan Terapis'} dari klinik sudah bersiap dan sedang dalam perjalanan menuju ke lokasi Bunda ya. Mohon ditunggu ya Bunda 🙏🛵`;
      try {
        const tplRes = await apiRequest(`/api/staff/otw-template?patientName=${encodeURIComponent(patientName)}`);
        if (tplRes.success && tplRes.text) {
          otwMessage = tplRes.text;
        }
      } catch (_) {}

      const confirmed = await confirm({
        title: 'Kirim Info Menuju Lokasi (OTW)',
        message: `Kirim pesan WhatsApp langsung ke ${patientName}:\n\n"${otwMessage}"`,
        confirmText: 'Kirim Pesan OTW',
        cancelText: 'Batal',
      });

      if (!confirmed) return;

      setSendingOtwId(task.reservationId);
      const res = await apiRequest(`/api/staff/conversations/${task.conversationId}/reply`, {
        method: 'POST',
        body: JSON.stringify({ text: otwMessage }),
      });

      if (res.success) {
        toast(`Pesan OTW berhasil dikirim ke WhatsApp ${patientName}!`, 'success');
        if (selectedTaskRef.current?.conversationId === task.conversationId && res.data) {
          setMessages((prev) => [...prev, res.data].slice(-10));
        }
      }
    } catch (err: any) {
      toast(`Gagal mengirim info OTW: ${err.message || 'Terjadi kesalahan'}`, 'error');
    } finally {
      setSendingOtwId(null);
    }
  };

  // Revoke / Delete for Everyone WhatsApp Message Handler
  const handleRevokeMessage = async (msg: ChatMessage) => {
    if (!selectedTask?.conversationId || revokingId) return;

    const confirmed = await confirm({
      title: 'Tarik Pesan WhatsApp',
      message: `Tarik / Hapus pesan ini untuk semua orang di WhatsApp?\n\n"${msg.content}"`,
      confirmText: 'Tarik Pesan',
      cancelText: 'Batal',
      danger: true,
    });

    if (!confirmed) return;

    setRevokingId(msg.id);
    try {
      const res = await apiRequest(
        `/api/staff/conversations/${selectedTask.conversationId}/messages/${msg.id}`,
        { method: 'DELETE' }
      );

      if (res?.success) {
        toast('Pesan berhasil ditarik dari WhatsApp!', 'success');
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msg.id ? { ...m, content: '🚫 Pesan ini telah ditarik', is_revoked: true } : m
          )
        );
      } else {
        toast(`Gagal menarik pesan: ${res?.error || 'Terjadi kesalahan'}`, 'error');
      }
    } catch (err: any) {
      toast(`Gagal menarik pesan: ${err.message || 'Terjadi kesalahan'}`, 'error');
    } finally {
      setRevokingId(null);
    }
  };

  // Client-side HTML5 Canvas Image Compression (Max 800px, 0.65 JPEG Quality -> ~50 KB)
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast('File yang dipilih harus berupa gambar.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const MAX_DIM = 800;

        if (width > height) {
          if (width > MAX_DIM) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          }
        } else {
          if (height > MAX_DIM) {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setProofImageB64(loadEvent.target?.result as string);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        // Compressed base64 JPEG saving valuable server storage
        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.65);
        setProofImageB64(compressedDataUrl);
      };
      img.src = loadEvent.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Submit Payment Record
  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentModalTask) return;

    if (paymentMethod !== 'CASH' && !proofImageB64) {
      toast('Silakan unggah foto bukti transfer / QRIS terlebih dahulu.', 'error');
      return;
    }

    setSubmittingPayment(true);
    try {
      const res = await apiRequest(`/api/staff/reservations/${paymentModalTask.reservationId}/payment`, {
        method: 'POST',
        body: JSON.stringify({
          paymentMethod,
          amount: paymentModalTask.pricing.totalFee,
          proofImageB64: proofImageB64 || undefined,
        }),
      });

      if (res.success) {
        toast(`Pembayaran Rp ${paymentModalTask.pricing.totalFee.toLocaleString('id-ID')} berhasil dicatat!`, 'success');
        
        // Update local task state to LUNAS
        setTasks((prev) =>
          prev.map((t) =>
            t.reservationId === paymentModalTask.reservationId
              ? {
                  ...t,
                  pricing: {
                    ...t.pricing,
                    paymentStatus: 'LUNAS',
                    paymentStatusLabel: 'Lunas',
                  },
                }
              : t
          )
        );

        if (selectedTask?.reservationId === paymentModalTask.reservationId) {
          setSelectedTask((prev) =>
            prev
              ? {
                  ...prev,
                  pricing: {
                    ...prev.pricing,
                    paymentStatus: 'LUNAS',
                    paymentStatusLabel: 'Lunas',
                  },
                }
              : null
          );
        }

        // Close modal
        setPaymentModalTask(null);
        setProofImageB64(null);
        setPaymentMethod('CASH');
      } else {
        toast(`Gagal: ${res.error || 'Terjadi kesalahan saat simpan pembayaran'}`, 'error');
      }
    } catch (err: any) {
      toast(`Gagal: ${err.message || 'Terjadi kesalahan jaringan'}`, 'error');
    } finally {
      setSubmittingPayment(false);
    }
  };

  // Filter list
  const activeList = activeTab === 'today' ? tasks : upcomingTasks;
  const filteredTasks = activeList.filter((t) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const nameMatch = (t.customerName || '').toLowerCase().includes(q);
    const addressMatch = (t.address?.fullText || '').toLowerCase().includes(q);
    const treatmentMatch = (t.treatmentDetail || '').toLowerCase().includes(q);
    return nameMatch || addressMatch || treatmentMatch;
  });

  // Group upcoming tasks by date
  const groupedUpcoming = filteredTasks.reduce<Record<string, StaffTask[]>>((acc, item) => {
    const key = formatDateGroup(item.bookingDate);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  return (
    <div className="min-h-[100dvh] bg-[#f0f2f5] text-[#111b21] flex flex-col font-sans select-none overflow-hidden antialiased">
      {/* WhatsApp Web Light Mode Top Bar */}
      <header className="h-16 bg-[#f0f2f5] border-b border-[#e9edef] px-4 flex items-center justify-between sticky top-0 z-30 shadow-sm">
        <div className="flex items-center space-x-3">
          {mobileView === 'chat' && activeTab === 'today' && (
            <button
              onClick={() => setMobileView('list')}
              className="md:hidden p-2 rounded-full bg-white hover:bg-[#e9edef] text-[#54656f] transition-all active:scale-95 border border-[#e9edef]"
              title="Kembali ke daftar kunjungan"
            >
              <ChevronLeft size={20} />
            </button>
          )}

          <div className="h-10 w-10 rounded-full bg-[#008069] text-white flex items-center justify-center font-bold text-base shadow-sm">
            {staff?.name ? staff.name.charAt(0).toUpperCase() : 'T'}
          </div>

          <div>
            <div className="flex items-center space-x-2">
              <h1 className="font-bold text-base text-[#111b21] tracking-tight">
                WhatsApp Terapis
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#d9fdd3] text-[#008069] border border-[#00a884]/30">
                Portal Lapangan
              </span>
            </div>
            <p className="text-xs text-[#667781] font-medium truncate max-w-[200px] sm:max-w-xs">
              {staff?.name || 'Terapis'} • {staff?.phone || 'Aktif'}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Realtime Live Status Indicator */}
          <div
            className={`flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${
              sseConnected
                ? 'bg-[#d9fdd3] text-[#008069] border-[#00a884]/30'
                : 'bg-rose-100 text-rose-600 border-rose-200 animate-pulse'
            }`}
          >
            {sseConnected ? <Wifi size={13} /> : <WifiOff size={13} />}
            <span className="hidden sm:inline">{sseConnected ? 'Live' : 'Menghubungkan'}</span>
          </div>

          {/* Refresh Tasks Button */}
          <button
            onClick={() => fetchTasks(false)}
            disabled={loading}
            className="p-2.5 rounded-full bg-white hover:bg-[#e9edef] text-[#54656f] hover:text-[#111b21] transition-all disabled:opacity-50 active:scale-95 border border-[#e9edef] shadow-sm"
            title="Muat Ulang Data"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin text-[#008069]' : ''} />
          </button>

          {/* Logout Button */}
          <button
            onClick={logout}
            className="p-2.5 rounded-full bg-white hover:bg-rose-50 text-[#667781] hover:text-rose-600 transition-all active:scale-95 border border-[#e9edef] shadow-sm"
            title="Keluar dari Portal"
          >
            <LogOut size={15} />
          </button>
        </div>
      </header>

      {/* 2-Tab Navigation Switcher Subheader */}
      <div className="bg-white border-b border-[#e9edef] px-4 py-2 flex items-center justify-between z-20">
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => {
              setActiveTab('today');
              setMobileView('list');
            }}
            className={`flex items-center space-x-1.5 px-4 py-1.5 rounded-full text-xs font-bold transition-all shadow-xs ${
              activeTab === 'today'
                ? 'bg-[#008069] text-white border border-[#008069]'
                : 'bg-[#f0f2f5] hover:bg-[#e9edef] text-[#54656f] border border-transparent'
            }`}
          >
            <MessageSquare size={14} />
            <span>Tugas & Chat Hari Ini ({tasks.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('upcoming')}
            className={`flex items-center space-x-1.5 px-4 py-1.5 rounded-full text-xs font-bold transition-all shadow-xs ${
              activeTab === 'upcoming'
                ? 'bg-[#008069] text-white border border-[#008069]'
                : 'bg-[#f0f2f5] hover:bg-[#e9edef] text-[#54656f] border border-transparent'
            }`}
          >
            <Calendar size={14} />
            <span>Jadwal Mendatang ({upcomingTasks.length})</span>
          </button>
        </div>

        {activeTab === 'upcoming' && (
          <div className="hidden md:flex items-center space-x-1.5 text-xs text-[#667781]">
            <MessageSquareOff size={13} className="text-[#008069]" />
            <span>Chat otomatis aktif saat hari H treatment</span>
          </div>
        )}
      </div>

      {/* Error notification banner */}
      {errorMessage && (
        <div className="bg-rose-50 border-b border-rose-200 px-4 py-2 text-rose-700 text-xs flex items-center justify-between z-20">
          <div className="flex items-center space-x-2">
            <AlertTriangle size={14} className="flex-shrink-0 text-rose-500" />
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage(null)} className="text-rose-600 font-bold ml-2 hover:text-rose-800">
            ✕
          </button>
        </div>
      )}

      {/* Main Split-View Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* ========================================================================= */}
        {/* TAB 1: TUGAS HARI INI & LIVE CHAT SPLIT-VIEW */}
        {/* ========================================================================= */}
        {activeTab === 'today' ? (
          <>
            {/* Left Column: WhatsApp Chat List & Visit Schedule */}
            <div
              className={`${
                mobileView === 'chat' ? 'hidden md:flex' : 'flex'
              } w-full md:w-[420px] flex-col border-r border-[#e9edef] bg-white overflow-hidden flex-shrink-0`}
            >
              {/* Panel Search & Header */}
              <div className="p-3 bg-white border-b border-[#e9edef] space-y-2.5">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center space-x-2">
                    <Calendar size={16} className="text-[#008069]" />
                    <h2 className="font-bold text-sm text-[#111b21]">Jadwal Hari Ini</h2>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#d9fdd3] text-[#008069] border border-[#00a884]/30">
                    {tasks.length} Pasien
                  </span>
                </div>

                {/* Search Input Bar (WhatsApp Web Style) */}
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-[#54656f]">
                    <Search size={15} />
                  </span>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari nama pasien, alamat, treatment..."
                    className="w-full pl-9 pr-8 py-2 rounded-lg bg-[#f0f2f5] border border-transparent focus:border-[#008069] focus:bg-white text-xs text-[#111b21] placeholder-[#667781] focus:outline-none transition-all"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#667781] hover:text-[#111b21] text-xs"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Task cards scroll area */}
              <div className="flex-1 overflow-y-auto divide-y divide-[#e9edef]">
                {loading ? (
                  <div className="flex flex-col justify-center items-center h-48 space-y-3 text-[#667781]">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#008069] border-t-transparent"></div>
                    <span className="text-xs font-medium">Memuat daftar tugas...</span>
                  </div>
                ) : filteredTasks.length === 0 ? (
                  <div className="text-center py-16 px-4 text-[#667781] space-y-2 bg-[#f0f2f5]/30">
                    <CheckCircle2 size={40} className="mx-auto text-[#008069]/40 mb-2" />
                    <p className="text-sm font-semibold text-[#111b21]">
                      {searchQuery ? 'Tidak ada jadwal yang cocok' : 'Belum ada jadwal tugas hari ini'}
                    </p>
                    <p className="text-xs text-[#667781] max-w-xs mx-auto">
                      {searchQuery
                        ? 'Coba kata kunci nama pasien atau alamat lain.'
                        : 'Pasien yang dijadwalkan oleh admin akan muncul otomatis di sini.'}
                    </p>
                  </div>
                ) : (
                  filteredTasks.map((task) => {
                    const isSelected = selectedTask?.reservationId === task.reservationId;
                    const isSendingOtw = sendingOtwId === task.reservationId;
                    const isLunas = task.pricing.paymentStatus === 'LUNAS';

                    return (
                      <div
                        key={task.reservationId}
                        onClick={() => {
                          setSelectedTask(task);
                          setMobileView('chat');
                        }}
                        className={`p-3.5 cursor-pointer transition-all text-left relative ${
                          isSelected
                            ? 'bg-[#f0f2f5] border-l-4 border-[#008069]'
                            : 'bg-white hover:bg-[#f5f6f6]'
                        }`}
                      >
                        {/* Header: Customer Name & Time */}
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="flex items-center space-x-2.5 min-w-0">
                            <div className="h-10 w-10 rounded-full bg-[#dfe5e7] text-[#54656f] flex items-center justify-center font-bold text-sm flex-shrink-0 border border-[#e9edef]">
                              {task.customerName ? task.customerName.charAt(0).toUpperCase() : 'P'}
                            </div>
                            <div className="min-w-0">
                              <h3 className="font-semibold text-sm text-[#111b21] truncate">
                                {task.customerName || 'Customer'}
                              </h3>
                              <p className="text-[11px] text-[#008069] font-medium truncate">
                                {task.treatmentDetail || 'Treatment Spa'}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center space-x-1 text-[11px] font-semibold text-[#008069] bg-[#d9fdd3] px-2 py-0.5 rounded-md whitespace-nowrap border border-[#00a884]/30 flex-shrink-0">
                            <Clock size={11} />
                            <span>{formatTime(task.bookingDate).split(' ')[0]}</span>
                          </div>
                        </div>

                        {/* Alamat & Jarak dari Klinik */}
                        <div className="text-xs text-[#54656f] flex items-start gap-1.5 mb-2 mt-2 bg-[#f0f2f5] p-2 rounded-lg border border-[#e9edef]">
                          <MapPin size={13} className="text-[#008069] mt-0.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-[#111b21] leading-snug">{task.address.fullText}</p>
                            {task.address.distanceKm != null && (
                              <p className="text-[10px] font-semibold text-[#008069] mt-0.5 flex items-center gap-1">
                                <Compass size={10} />
                                <span>
                                  {task.address.distanceSource === 'PREVIOUS_PATIENT' && task.address.originName
                                    ? `Jarak: ${task.address.distanceKm.toFixed(1)} km dari ${task.address.originName}`
                                    : `Jarak: ${task.address.distanceKm.toFixed(1)} km dari klinik`}
                                  {task.address.estimatedMinutes != null && (
                                    <span className="text-[#54656f] font-normal ml-1">
                                      (±{task.address.estimatedMinutes} mnt perjalanan)
                                    </span>
                                  )}
                                </span>
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Data Pasien Bayi / Anak */}
                        {task.children && task.children.length > 0 && (
                          <div className="mb-2 flex flex-wrap gap-1.5">
                            {task.children.map((child, i) => (
                              <span
                                key={i}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#e7f8e8] text-[#008069] text-[11px] font-medium border border-[#00a884]/20"
                              >
                                <Baby size={11} />
                                <span>{child.name}</span>
                                {child.rawAgeText && (
                                  <span className="text-[#667781]">({child.rawAgeText})</span>
                                )}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Total Biaya & Status Bayar */}
                        <div className="flex items-center justify-between text-xs pt-1 border-t border-[#f0f2f5]">
                          <div className="flex items-center gap-1 text-[#667781]">
                            <CreditCard size={12} className="text-[#008069]" />
                            <span>Biaya:</span>
                            <span className="text-[#111b21] font-bold">
                              {formatRupiah(task.pricing.totalFee)}
                            </span>
                          </div>

                          {isLunas ? (
                            <span className="text-[10px] font-bold text-[#008069] bg-[#d9fdd3] px-2 py-0.5 rounded-full border border-[#00a884]/30 flex items-center gap-1">
                              <CheckCircle2 size={11} />
                              <span>Lunas</span>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPaymentModalTask(task);
                              }}
                              className="text-[10px] font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 px-2 py-0.5 rounded-full border border-amber-300 transition-all active:scale-95 flex items-center gap-1"
                            >
                              <CreditCard size={11} />
                              <span>Catat Bayar</span>
                            </button>
                          )}
                        </div>

                        {/* Quick Action Buttons: Navigasi, Infokan OTW, Catat Bayar */}
                        <div className="grid grid-cols-2 gap-1.5 pt-2 mt-1">
                          {task.navigationUrl || task.mapsUrl ? (
                            <a
                              href={task.navigationUrl || task.mapsUrl || '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center justify-center space-x-1 py-1.5 px-2 text-xs font-semibold text-white bg-[#008069] hover:bg-[#00a884] rounded-lg transition-all active:scale-95 shadow-xs"
                              title="Buka Peta Navigasi Google Maps"
                            >
                              <Navigation size={12} />
                              <span>Navigasi</span>
                            </a>
                          ) : (
                            <div className="text-[10px] text-[#667781] flex items-center justify-center bg-[#f0f2f5] py-1.5 rounded-lg border border-[#e9edef]">
                              Tanpa Peta
                            </div>
                          )}

                          <button
                            type="button"
                            disabled={isSendingOtw}
                            onClick={(e) => handleSendOtw(task, e)}
                            className="flex items-center justify-center space-x-1 py-1.5 px-2 text-xs font-semibold text-[#008069] bg-[#d9fdd3] hover:bg-[#cbf7c3] rounded-lg transition-all active:scale-95 border border-[#00a884]/30 shadow-xs disabled:opacity-50"
                            title="Kirim pesan cepat ke WhatsApp pasien bahwa Anda sedang menuju lokasi"
                          >
                            {isSendingOtw ? (
                              <div className="h-3 w-3 animate-spin rounded-full border-2 border-[#008069] border-t-transparent"></div>
                            ) : (
                              <>
                                <Navigation2 size={12} />
                                <span>Infokan OTW</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Column: WhatsApp Live Chat Canvas */}
            <div
              className={`${
                mobileView === 'list' ? 'hidden md:flex' : 'flex'
              } flex-1 flex-col bg-[#efeae2] overflow-hidden relative`}
            >
              {selectedTask ? (
                <>
                  {/* WhatsApp Web Chat Header */}
                  <div className="bg-[#f0f2f5] border-b border-[#e9edef] px-4 py-2.5 flex items-center justify-between gap-3 shadow-xs z-10">
                    <div className="flex items-center space-x-3 min-w-0">
                      <div className="h-10 w-10 rounded-full bg-[#dfe5e7] text-[#54656f] flex items-center justify-center font-bold text-sm border border-[#e9edef] flex-shrink-0">
                        {selectedTask.customerName ? selectedTask.customerName.charAt(0).toUpperCase() : 'P'}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center space-x-2">
                          <h2 className="font-semibold text-[#111b21] text-sm truncate">
                            {selectedTask.customerName || 'Customer'}
                          </h2>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#d9fdd3] text-[#008069] font-bold border border-[#00a884]/30 whitespace-nowrap">
                            {formatTime(selectedTask.bookingDate)}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#667781] truncate mt-0.5">
                          {selectedTask.treatmentDetail || 'Treatment'} • {selectedTask.address.fullText}
                        </p>
                      </div>
                    </div>

                    {/* Header Actions: Navigasi, Bayar, Infokan OTW */}
                    <div className="flex items-center space-x-1.5 flex-shrink-0">
                      {(selectedTask.navigationUrl || selectedTask.mapsUrl) && (
                        <a
                          href={selectedTask.navigationUrl || selectedTask.mapsUrl || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-[#008069] hover:bg-[#00a884] text-white text-xs font-semibold shadow-xs transition-all active:scale-95"
                          title="Buka Peta Navigasi Google Maps"
                        >
                          <Navigation size={12} />
                          <span className="hidden sm:inline">Navigasi</span>
                        </a>
                      )}

                      <button
                        onClick={() => setPaymentModalTask(selectedTask)}
                        className={`flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-xs active:scale-95 ${
                          selectedTask.pricing.paymentStatus === 'LUNAS'
                            ? 'bg-[#d9fdd3] text-[#008069] border border-[#00a884]/30'
                            : 'bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300'
                        }`}
                        title="Catat Status Pembayaran Transaksi"
                      >
                        <CreditCard size={12} />
                        <span>{selectedTask.pricing.paymentStatus === 'LUNAS' ? 'Lunas' : 'Catat Bayar'}</span>
                      </button>

                      <button
                        onClick={() => handleSendOtw(selectedTask)}
                        disabled={sendingOtwId === selectedTask.reservationId}
                        className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-[#d9fdd3] hover:bg-[#cbf7c3] text-[#008069] text-xs font-semibold transition-all border border-[#00a884]/30 active:scale-95 shadow-xs disabled:opacity-50"
                        title="Kirim pesan cepat ke WhatsApp pasien bahwa Anda sedang menuju lokasi"
                      >
                        {sendingOtwId === selectedTask.reservationId ? (
                          <div className="h-3 w-3 animate-spin rounded-full border-2 border-[#008069] border-t-transparent"></div>
                        ) : (
                          <>
                            <Navigation2 size={12} />
                            <span>Infokan OTW</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* WhatsApp Chat Bubbles Viewport (Warm Beige Wallpaper Canvas) */}
                  <div
                    ref={chatContainerRef}
                    className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#efeae2] relative"
                    style={{
                      backgroundImage: `radial-gradient(#d1c7b8 1px, transparent 1px)`,
                      backgroundSize: '24px 24px',
                    }}
                  >
                    {/* Date separator badge */}
                    <div className="flex justify-center my-1.5">
                      <div className="bg-white text-[#54656f] text-[11px] font-medium px-3 py-1 rounded-lg text-center shadow-xs border border-[#e9edef]">
                        Hari Ini (10 Pesan Terakhir)
                      </div>
                    </div>

                    {loadingMessages ? (
                      <div className="flex justify-center items-center h-48 space-x-2 text-[#667781] text-xs">
                        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#008069] border-t-transparent"></div>
                        <span>Memuat riwayat chat...</span>
                      </div>
                    ) : messages.length === 0 ? (
                      <div className="text-center py-20 text-[#667781] text-xs space-y-2">
                        <MessageSquare size={36} className="mx-auto text-[#d1c7b8] mb-1" />
                        <p className="font-semibold text-[#111b21]">Belum ada riwayat pesan</p>
                        <p className="text-[#667781]">Ketik balasan di bawah untuk mengirim pesan langsung ke WhatsApp pasien.</p>
                      </div>
                    ) : (
                      messages.map((msg) => {
                        const isInbound = msg.direction === 'INBOUND';
                        const isBot = !isInbound && msg.sender_type === 'BOT';
                        const isStaff = !isInbound && msg.sender_type === 'STAFF';
                        const media = extractMedia(msg);

                        const timeStr = new Date(msg.created_at).toLocaleTimeString('id-ID', {
                          hour: '2-digit',
                          minute: '2-digit',
                        }).replace(':', '.');

                        return (
                          <div
                            key={msg.id}
                            className={`flex flex-col ${isInbound ? 'items-start' : 'items-end'}`}
                          >
                            {/* Sender Label Tag */}
                            <div className="text-[10px] text-[#667781] mb-0.5 px-1.5 flex items-center space-x-1">
                              {isInbound ? (
                                <>
                                  <User size={10} className="text-[#667781]" />
                                  <span className="font-medium text-[#111b21]">{selectedTask.customerName || 'Pasien'}</span>
                                </>
                              ) : isBot ? (
                                <>
                                  <Sparkles size={10} className="text-[#008069]" />
                                  <span className="font-medium text-[#008069]">Kala Spa (Official)</span>
                                </>
                              ) : (
                                <>
                                  <Sparkles size={10} className="text-[#008069]" />
                                  <span className="font-medium text-[#008069]">{msg.sender_name || staff?.name || 'Terapis'}</span>
                                </>
                              )}
                            </div>

                              {/* WhatsApp Message Bubble */}
                              {(() => {
                                const isRevoked = msg.content === '🚫 Pesan ini telah ditarik' || (msg as any).is_revoked || (msg as any).payload_raw?.is_revoked;
                                const canRevoke = !isInbound && !isRevoked && !!gatewayCapability?.supportsRevoke;

                                return (
                                  <div
                                    className={`max-w-[85%] sm:max-w-[72%] rounded-lg px-3 py-2 shadow-xs text-sm leading-relaxed relative ${
                                      isInbound
                                        ? 'bg-white text-[#111b21] rounded-tl-none border border-black/5'
                                        : isBot
                                        ? 'bg-white text-[#111b21] rounded-tr-none border-l-4 border-[#008069] shadow-xs'
                                        : 'bg-[#d9fdd3] text-[#111b21] rounded-tr-none border border-[#00a884]/20'
                                    }`}
                                  >
                                    {media && (
                                      <div className="mb-2">
                                        <MediaImage
                                          src={media.url || media.hdUrl}
                                          downloadSrc={media.hdUrl}
                                          caption={media.caption}
                                          blur={isInbound}
                                        />
                                      </div>
                                    )}

                                    <p className={`whitespace-pre-wrap break-words ${isRevoked ? 'italic text-[#667781]' : ''}`}>
                                      {msg.content}
                                    </p>

                                    {/* Timestamp, Delivery Checkmarks & Revoke Trash Button */}
                                    <div className="flex items-center justify-end space-x-1.5 text-[11px] text-[#667781] mt-1 select-none">
                                      <span>{timeStr}</span>
                                      {!isInbound && (
                                        <CheckCheck size={14} className="text-[#53bdeb]" />
                                      )}
                                      {canRevoke && (
                                        <button
                                          type="button"
                                          disabled={revokingId === msg.id}
                                          onClick={() => handleRevokeMessage(msg)}
                                          className="ml-1 p-0.5 rounded text-[#8696a0] hover:text-rose-600 hover:bg-rose-50 transition active:scale-90"
                                          title="Tarik / Hapus pesan untuk semua orang (Delete for Everyone)"
                                        >
                                          {revokingId === msg.id ? (
                                            <div className="h-3 w-3 animate-spin rounded-full border border-rose-500 border-t-transparent" />
                                          ) : (
                                            <Trash2 size={12} />
                                          )}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          );
                      })
                    )}
                  </div>

                  {/* Quick Template Chips */}
                  <div className="bg-[#f0f2f5] px-4 pt-2 pb-1 flex items-center gap-1.5 overflow-x-auto border-t border-[#e9edef]">
                    <button
                      type="button"
                      onClick={() => setReplyText(`Halo ${selectedTask.customerName || 'Bunda'}, saya ${staff?.name || 'Terapis'} sudah tiba di depan rumah Bunda ya. 🙏`)}
                      className="px-2.5 py-1 rounded-full text-xs font-medium bg-white hover:bg-[#e9edef] text-[#111b21] border border-[#e9edef] whitespace-nowrap transition-colors shadow-xs"
                    >
                      📍 Sudah sampai di depan
                    </button>
                    <button
                      type="button"
                      onClick={() => setReplyText(`Terima kasih banyak ya Bunda ${selectedTask.customerName || ''}, semoga adik lekas sehat ceria selalu. 🙏🥰`)}
                      className="px-2.5 py-1 rounded-full text-xs font-medium bg-white hover:bg-[#e9edef] text-[#111b21] border border-[#e9edef] whitespace-nowrap transition-colors shadow-xs"
                    >
                      ❤️ Ucapan selesai perawatan
                    </button>
                  </div>

                  {/* WhatsApp Web Message Input Bar */}
                  <form
                    onSubmit={handleSendReply}
                    className="bg-[#f0f2f5] px-4 py-2.5 flex items-center space-x-2.5 z-10"
                  >
                    <button
                      type="button"
                      className="p-1.5 text-[#54656f] hover:text-[#111b21] transition-colors rounded-full hover:bg-[#e9edef]"
                      title="Emoji"
                    >
                      <Smile size={22} />
                    </button>

                    <button
                      type="button"
                      className="p-1.5 text-[#54656f] hover:text-[#111b21] transition-colors rounded-full hover:bg-[#e9edef]"
                      title="Lampiran"
                    >
                      <Plus size={22} />
                    </button>

                    <div className="flex-1 relative">
                      <input
                        type="text"
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder="Ketik pesan"
                        disabled={sending}
                        className="w-full bg-white border border-[#e9edef] focus:border-[#008069] text-[#111b21] rounded-lg px-4 py-2.5 text-sm focus:outline-none placeholder-[#667781] transition-colors disabled:opacity-50 shadow-xs"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={!replyText.trim() || sending}
                      className="h-10 w-10 rounded-full bg-[#008069] hover:bg-[#00a884] text-white font-semibold shadow-sm flex items-center justify-center transition-all disabled:opacity-40 disabled:hover:bg-[#008069] flex-shrink-0 active:scale-95"
                      title="Kirim Pesan"
                    >
                      {sending ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                      ) : (
                        <Send size={15} className="ml-0.5 text-white" />
                      )}
                    </button>
                  </form>

                  {/* Sender Identity Signature Badge Indicator */}
                  <div className="px-4 pb-2 pt-0.5 flex items-center justify-between text-[11px] text-[#667781] bg-[#f0f2f5] select-none">
                    <span className="flex items-center gap-1">
                      <span>✍️ Identitas pengirim:</span>
                      <strong className="text-[#008069]">~ {staff?.name || 'Bidan Terapis'}</strong>
                    </span>
                    <span className="hidden sm:inline text-[10px] text-[#8696a0]">Otomatis disematkan di akhir pesan</span>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-[#667781] space-y-4 bg-[#f0f2f5]/40">
                  <div className="h-20 w-20 rounded-full bg-white flex items-center justify-center text-[#008069] shadow-sm border border-[#e9edef]">
                    <MessageSquare size={36} />
                  </div>
                  <div className="space-y-1 max-w-sm">
                    <h3 className="font-bold text-[#111b21] text-base">WhatsApp Web Terapis</h3>
                    <p className="text-xs text-[#667781] leading-relaxed">
                      Pilih salah satu jadwal kunjungan pasien di sebelah kiri untuk melihat rincian lokasi, petunjuk arah peta, status pembayaran, dan berkirim pesan langsung melalui WhatsApp.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          /* ========================================================================= */
          /* TAB 2: JADWAL MENDATANG (READ-ONLY, NO CHAT) */
          /* ========================================================================= */
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-5xl mx-auto w-full space-y-6">
            {/* Search Bar */}
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-[#54656f]">
                <Search size={16} />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari jadwal pasien mendatang (nama, kelurahan, treatment)..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white border border-[#e9edef] focus:border-[#008069] text-sm text-[#111b21] placeholder-[#667781] focus:outline-none transition-all shadow-xs"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-[#667781] hover:text-[#111b21] text-xs font-bold"
                >
                  ✕
                </button>
              )}
            </div>

            {loading ? (
              <div className="flex flex-col justify-center items-center h-64 space-y-3 text-[#667781]">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#008069] border-t-transparent"></div>
                <span className="text-xs font-medium">Memuat jadwal reservasi mendatang...</span>
              </div>
            ) : Object.keys(groupedUpcoming).length === 0 ? (
              <div className="text-center py-20 px-4 text-[#667781] space-y-3 bg-white rounded-2xl border border-[#e9edef] shadow-xs">
                <CheckCircle2 size={48} className="mx-auto text-[#008069]/40" />
                <div className="space-y-1 max-w-sm mx-auto">
                  <h3 className="text-base font-bold text-[#111b21]">
                    {searchQuery ? 'Tidak Ada Jadwal yang Cocok' : 'Belum Ada Jadwal Mendatang'}
                  </h3>
                  <p className="text-xs text-[#667781] leading-relaxed">
                    {searchQuery
                      ? 'Coba gunakan kata kunci pencarian yang lain.'
                      : 'Reservasi pasien untuk hari esok dan seterusnya yang ditugaskan kepada Anda akan tampil di sini.'}
                  </p>
                </div>
              </div>
            ) : (
              Object.entries(groupedUpcoming).map(([dateLabel, items]) => (
                <div key={dateLabel} className="space-y-3">
                  {/* Date Header Pill */}
                  <div className="flex items-center space-x-2 pt-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#008069]"></span>
                    <h2 className="font-bold text-sm text-[#111b21]">{dateLabel}</h2>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white text-[#54656f] border border-[#e9edef]">
                      {items.length} Kunjungan
                    </span>
                  </div>

                  {/* Cards Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {items.map((item) => (
                      <div
                        key={item.reservationId}
                        className="bg-white rounded-2xl p-4 border border-[#e9edef] shadow-xs hover:border-[#008069]/40 transition-all space-y-3 text-left"
                      >
                        {/* Header: Name & Time */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center space-x-2.5 min-w-0">
                            <div className="h-10 w-10 rounded-full bg-[#dfe5e7] text-[#54656f] flex items-center justify-center font-bold text-sm flex-shrink-0 border border-[#e9edef]">
                              {item.customerName ? item.customerName.charAt(0).toUpperCase() : 'P'}
                            </div>
                            <div className="min-w-0">
                              <h3 className="font-bold text-sm text-[#111b21] truncate">
                                {item.customerName || 'Customer'}
                              </h3>
                              <p className="text-xs text-[#008069] font-medium truncate">
                                {item.treatmentDetail || 'Treatment Layanan Spa'}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center space-x-1 text-xs font-semibold text-[#008069] bg-[#d9fdd3] px-2.5 py-1 rounded-lg whitespace-nowrap border border-[#00a884]/30 flex-shrink-0">
                            <Clock size={12} />
                            <span>{formatTime(item.bookingDate)}</span>
                          </div>
                        </div>

                        {/* Alamat & Jarak dari Klinik */}
                        <div className="text-xs text-[#54656f] flex items-start gap-1.5 bg-[#f0f2f5] p-2.5 rounded-xl border border-[#e9edef]">
                          <MapPin size={14} className="text-[#008069] mt-0.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-[#111b21] leading-snug">{item.address.fullText}</p>
                            {item.address.distanceKm != null && (
                              <p className="text-[10px] font-semibold text-[#008069] mt-1 flex items-center gap-1">
                                <Compass size={11} />
                                <span>
                                  {item.address.distanceSource === 'PREVIOUS_PATIENT' && item.address.originName
                                    ? `Jarak: ${item.address.distanceKm.toFixed(1)} km dari ${item.address.originName}`
                                    : `Jarak: ${item.address.distanceKm.toFixed(1)} km dari klinik`}
                                  {item.address.estimatedMinutes != null && (
                                    <span className="text-[#54656f] font-normal ml-1">
                                      (±{item.address.estimatedMinutes} mnt perjalanan)
                                    </span>
                                  )}
                                </span>
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Data Pasien Bayi / Anak */}
                        {item.children && item.children.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {item.children.map((child, i) => (
                              <span
                                key={i}
                                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-[#e7f8e8] text-[#008069] text-xs font-medium border border-[#00a884]/20"
                              >
                                <Baby size={12} />
                                <span>{child.name}</span>
                                {child.rawAgeText && (
                                  <span className="text-[#667781]">({child.rawAgeText})</span>
                                )}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Total Biaya & Peta Navigasi */}
                        <div className="flex items-center justify-between pt-2 border-t border-[#f0f2f5]">
                          <div className="flex items-center gap-1 text-xs text-[#667781]">
                            <CreditCard size={13} className="text-[#008069]" />
                            <span>Biaya:</span>
                            <strong className="text-[#111b21] ml-0.5">{formatRupiah(item.pricing.totalFee)}</strong>
                          </div>

                          {item.navigationUrl || item.mapsUrl ? (
                            <a
                              href={item.navigationUrl || item.mapsUrl || '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center space-x-1 py-1.5 px-3 text-xs font-semibold text-white bg-[#008069] hover:bg-[#00a884] rounded-lg transition-all active:scale-95 shadow-xs"
                              title="Buka Peta Google Maps"
                            >
                              <Navigation size={12} />
                              <span>Peta Rute</span>
                            </a>
                          ) : (
                            <span className="text-[11px] text-[#667781]">Tanpa Peta</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL CATAT PEMBAYARAN (TUNAI VS NON-TUNAI / TRANSFER / QRIS) */}
      {/* ========================================================================= */}
      {paymentModalTask && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl border border-[#e9edef] space-y-4 text-left">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-[#111b21] flex items-center space-x-2">
                  <CreditCard className="text-[#008069]" size={20} />
                  <span>Catat Pembayaran Pasien</span>
                </h3>
                <p className="text-xs text-[#667781] mt-0.5">
                  {paymentModalTask.customerName || 'Pasien'} • {paymentModalTask.treatmentDetail || 'Treatment'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPaymentModalTask(null);
                  setProofImageB64(null);
                  setPaymentMethod('CASH');
                }}
                className="p-1 rounded-full text-[#667781] hover:text-[#111b21] hover:bg-[#f0f2f5] transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Total Tagihan Banner */}
            <div className="bg-[#f0f2f5] p-3.5 rounded-xl border border-[#e9edef] flex items-center justify-between">
              <div>
                <span className="text-xs text-[#667781] block">Total Tagihan:</span>
                <span className="text-base font-bold text-[#008069]">
                  {formatRupiah(paymentModalTask.pricing.totalFee)}
                </span>
              </div>
              <span className="text-[11px] font-semibold px-2.5 py-1 bg-white text-[#54656f] rounded-lg border border-[#e9edef]">
                Ongkir: {formatRupiah(paymentModalTask.pricing.deliveryFee)}
              </span>
            </div>

            <form onSubmit={handleSubmitPayment} className="space-y-4">
              {/* Metode Pembayaran Selection */}
              <div>
                <label className="text-xs font-bold text-[#111b21] block mb-2">
                  Pilih Metode Pembayaran:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentMethod('CASH');
                      setProofImageB64(null);
                    }}
                    className={`py-2 px-3 rounded-xl text-xs font-bold transition-all border ${
                      paymentMethod === 'CASH'
                        ? 'bg-[#d9fdd3] text-[#008069] border-[#008069] shadow-xs'
                        : 'bg-[#f0f2f5] text-[#54656f] border-[#e9edef] hover:bg-[#e9edef]'
                    }`}
                  >
                    💵 Tunai (Cash)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('TRANSFER')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold transition-all border ${
                      paymentMethod === 'TRANSFER'
                        ? 'bg-[#d9fdd3] text-[#008069] border-[#008069] shadow-xs'
                        : 'bg-[#f0f2f5] text-[#54656f] border-[#e9edef] hover:bg-[#e9edef]'
                    }`}
                  >
                    🏦 Transfer Bank
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('QRIS')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold transition-all border ${
                      paymentMethod === 'QRIS'
                        ? 'bg-[#d9fdd3] text-[#008069] border-[#008069] shadow-xs'
                        : 'bg-[#f0f2f5] text-[#54656f] border-[#e9edef] hover:bg-[#e9edef]'
                    }`}
                  >
                    📱 QRIS
                  </button>
                </div>
              </div>

              {/* Upload Foto Bukti Non-Tunai */}
              {paymentMethod !== 'CASH' && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[#111b21] flex items-center justify-between">
                    <span>Foto Bukti Transaksi:</span>
                    <span className="text-[10px] font-normal text-[#667781]">Otomatis dikompresi (~50 KB)</span>
                  </label>

                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />

                  {proofImageB64 ? (
                    <div className="relative rounded-xl border border-[#e9edef] overflow-hidden bg-[#f0f2f5] p-2 flex items-center justify-between">
                      <div className="flex items-center space-x-2.5">
                        <img
                          src={proofImageB64}
                          alt="Bukti Bayar"
                          className="h-14 w-14 object-cover rounded-lg border border-[#e9edef]"
                        />
                        <div>
                          <span className="text-xs font-bold text-[#008069] block">Foto Bukti Terlampir</span>
                          <span className="text-[10px] text-[#667781]">Siap disimpan ke database</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setProofImageB64(null)}
                        className="p-1.5 rounded-full hover:bg-rose-50 text-[#667781] hover:text-rose-600 transition"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full py-4 border-2 border-dashed border-[#008069]/40 hover:border-[#008069] bg-[#e7f8e8]/30 hover:bg-[#e7f8e8]/60 rounded-xl flex flex-col items-center justify-center space-y-1 text-[#008069] transition cursor-pointer"
                    >
                      <Upload size={20} />
                      <span className="text-xs font-bold">Ambil Foto / Pilih Bukti Transaksi</span>
                      <span className="text-[10px] text-[#667781]">Foto screenshot transfer atau struk QRIS</span>
                    </button>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-end space-x-2 pt-2 border-t border-[#e9edef]">
                <button
                  type="button"
                  disabled={submittingPayment}
                  onClick={() => {
                    setPaymentModalTask(null);
                    setProofImageB64(null);
                    setPaymentMethod('CASH');
                  }}
                  className="px-4 py-2.5 bg-[#f0f2f5] hover:bg-[#e9edef] text-[#54656f] hover:text-[#111b21] rounded-xl text-xs font-bold transition active:scale-95 disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submittingPayment}
                  className="px-5 py-2.5 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-bold shadow-xs transition active:scale-95 flex items-center space-x-1.5 disabled:opacity-50"
                >
                  {submittingPayment ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                  ) : (
                    <>
                      <CheckCircle2 size={15} />
                      <span>Simpan & Tandai Lunas</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
