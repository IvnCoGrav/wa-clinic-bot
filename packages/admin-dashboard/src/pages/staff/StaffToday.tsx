import React, { useEffect, useRef, useState, useCallback } from 'react';
import { apiRequest } from '../../services/api';
import { useStaffAuth } from '../../contexts/StaffAuthContext';
import { useUiFeedback } from '../../components/common/UiFeedback';
import {
  MessageSquare,
  AlertTriangle,
  Clock,
  Send,
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
  Navigation2,
  Upload,
  Image as ImageIcon,
  X,
  Trash2,
  UserCheck,
  Info,
  Menu,
  Camera,
  Maximize2,
  Crosshair,
  PenLine,
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
  lat?: number | null;
  lng?: number | null;
  distanceKm: number | null;
  estimatedMinutes?: number | null;
  distanceSource?: 'CLINIC' | 'PREVIOUS_PATIENT' | null;
  originName?: string | null;
  fullText: string;
  housePhotoUrl?: string | null;
  landmark?: string | null;
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
  
  // Navigation Tabs: 'today' (Hari Ini & Live Chat) vs 'upcoming' (Jadwal Mendatang) vs 'completed' (Treatment Selesai)
  const [activeTab, setActiveTab] = useState<'today' | 'upcoming' | 'completed'>('today');

  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<StaffTask[]>([]);
  const [upcomingTasks, setUpcomingTasks] = useState<StaffTask[]>([]);
  const [completedTasks, setCompletedTasks] = useState<StaffTask[]>([]);
  const [showMenuDrawer, setShowMenuDrawer] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTask, setSelectedTask] = useState<StaffTask | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [selectedImage, setSelectedImage] = useState<{ file: File; preview: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [sseConnected, setSseConnected] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
  const [sendingOtwId, setSendingOtwId] = useState<string | null>(null);

  // Staff Profile Drawer State
  const [showStaffProfileModal, setShowStaffProfileModal] = useState(false);

  // Customer Detail Modal State (Privacy Safe - No Phone Leak)
  const [detailModalTask, setDetailModalTask] = useState<StaffTask | null>(null);

  // Payment Recording Modal State
  const [paymentModalTask, setPaymentModalTask] = useState<StaffTask | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'TRANSFER' | 'QRIS'>('CASH');
  const [proofImageB64, setProofImageB64] = useState<string | null>(null);
  const [submittingPayment, setSubmittingPayment] = useState(false);

  // Update Location & House Photo Modal State
  const [updateLocationModalTask, setUpdateLocationModalTask] = useState<StaffTask | null>(null);
  const [locCoords, setLocCoords] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [locHousePhotoB64, setLocHousePhotoB64] = useState<string | null>(null);
  const [locLandmark, setLocLandmark] = useState<string>('');
  const [locGettingGps, setLocGettingGps] = useState(false);
  const [submittingLoc, setSubmittingLoc] = useState(false);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);
  const locHouseFileInputRef = useRef<HTMLInputElement>(null);

  // Gateway capability (WAHA supportsRevoke=true vs WABA supportsRevoke=false)
  const [gatewayCapability, setGatewayCapability] = useState<{ provider: string; supportsRevoke: boolean } | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const selectedTaskRef = useRef<StaffTask | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);

  selectedTaskRef.current = selectedTask;

  // Category Icon & Color Mapping Helper
  const getCategoryIcon = (category: string | null) => {
    const cat = (category || '').toUpperCase();
    if (cat === 'BABY') {
      return {
        icon: <Baby size={18} className="text-sky-600" />,
        bg: 'bg-sky-100 border-sky-200 text-sky-700',
        badge: 'bg-sky-50 text-sky-700 border-sky-200',
        borderAccent: 'border-l-sky-500 bg-sky-50/20',
        label: 'Baby Spa',
      };
    }
    if (cat === 'MOMS') {
      return {
        icon: <Sparkles size={18} className="text-purple-600" />,
        bg: 'bg-purple-100 border-purple-200 text-purple-700',
        badge: 'bg-purple-50 text-purple-700 border-purple-200',
        borderAccent: 'border-l-purple-500 bg-purple-50/20',
        label: 'Moms Spa',
      };
    }
    if (cat === 'BOTH' || cat === 'KIDS') {
      return {
        icon: <Smile size={18} className="text-emerald-600" />,
        bg: 'bg-emerald-100 border-emerald-200 text-emerald-700',
        badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        borderAccent: 'border-l-emerald-500 bg-emerald-50/20',
        label: 'Moms & Baby',
      };
    }
    return {
      icon: <User size={18} className="text-teal-600" />,
      bg: 'bg-teal-100 border-teal-200 text-teal-700',
      badge: 'bg-teal-50 text-teal-700 border-teal-200',
      borderAccent: 'border-l-teal-500 bg-teal-50/20',
      label: 'Treatment',
    };
  };

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

  // Tombol OTW hanya bisa ditekan maksimal 2 jam sebelum jadwal treatment
  const isOtwAllowed = (task: StaffTask) => {
    if (!task.bookingDate) return false;
    return Date.now() >= new Date(task.bookingDate).getTime() - 2 * 60 * 60 * 1000;
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

  // Fetch today tasks, upcoming schedule, and completed tasks
  const fetchTasks = useCallback(async (isPolling = false) => {
    if (!isPolling) setLoading(true);
    try {
      const [todayRes, upcomingRes, completedRes] = await Promise.all([
        apiRequest('/api/staff/today-tasks'),
        apiRequest('/api/staff/upcoming-schedule'),
        apiRequest('/api/staff/completed-tasks'),
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

      if (completedRes?.success && Array.isArray(completedRes.data)) {
        setCompletedTasks(completedRes.data);
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

  // Auto-scroll chat viewport to latest message
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
      }
    });
  }, []);

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

  // Auto scroll chat when messages update or view switches to chat
  useEffect(() => {
    if (mobileView === 'chat' || selectedTask) {
      scrollToBottom();
      const t = setTimeout(scrollToBottom, 60);
      return () => clearTimeout(t);
    }
  }, [mobileView, selectedTask, messages, scrollToBottom]);

  // Open Chat with history push for Android/iOS Hardware Back Button
  const handleOpenChat = (task: StaffTask) => {
    setSelectedTask(task);
    setMobileView('chat');
    window.history.pushState({ view: 'chat', taskId: task.reservationId }, '');
  };

  // Back button in UI
  const handleBackToList = () => {
    if (window.history.state?.view === 'chat') {
      window.history.back();
    } else {
      setMobileView('list');
    }
  };

  // Popstate event listener for hardware / browser back button
  useEffect(() => {
    const handlePopState = () => {
      if (detailModalTask) {
        setDetailModalTask(null);
        return;
      }
      if (paymentModalTask) {
        setPaymentModalTask(null);
        return;
      }
      if (showStaffProfileModal) {
        setShowStaffProfileModal(false);
        return;
      }
      if (mobileView === 'chat') {
        setMobileView('list');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [mobileView, detailModalTask, paymentModalTask, showStaffProfileModal]);

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
  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
      reader.readAsDataURL(file);
    });

  const makeThumbnail = (dataUrl: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const maxDim = 480;
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('no ctx');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('Gagal memproses gambar.'));
      img.src = dataUrl;
    });

  const handlePickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMessage('Hanya file gambar yang didukung.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setErrorMessage('Gambar maksimal 8 MB.');
      return;
    }
    setSelectedImage({ file, preview: URL.createObjectURL(file) });
    if (chatFileInputRef.current) chatFileInputRef.current.value = '';
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    const image = selectedImage;
    if ((!replyText.trim() && !image) || !selectedTask?.conversationId || sending) return;

    const textToSend = replyText.trim();
    const signature = `~ ${staff?.name || 'Bidan Terapis'}`;
    const hasText = !!textToSend;
    const optimisticContent = hasText
      ? textToSend.endsWith(signature) ? textToSend : `${textToSend}\n\n${signature}`
      : '[Image]';

    setSending(true);
    setErrorMessage(null);

    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: ChatMessage = {
      id: tempId,
      direction: 'OUTBOUND',
      content: optimisticContent,
      media: image ? { url: image.preview, hdUrl: image.preview } : undefined,
      sender_type: 'STAFF',
      sender_name: staff?.name || 'Staff',
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimisticMsg].slice(-10));
    setReplyText('');
    setSelectedImage(null);

    try {
      const body: Record<string, any> = { text: hasText ? textToSend : '' };
      if (image) {
        const imageB64 = await fileToDataUrl(image.file);
        const thumbB64 = await makeThumbnail(imageB64);
        body.imageB64 = imageB64;
        body.thumbB64 = thumbB64;
        body.mimeType = image.file.type || 'image/jpeg';
        body.fileName = image.file.name;
      }
      const res = await apiRequest(`/api/staff/conversations/${selectedTask.conversationId}/reply`, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      if (res.success && res.data) {
        setMessages((prev) => prev.map((m) => (m.id === tempId ? res.data : m)));
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal mengirim pesan balasan.');
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setReplyText(textToSend);
      setSelectedImage(image);
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

  // Open Location Update Modal
  const handleOpenUpdateLocationModal = (task: StaffTask) => {
    setUpdateLocationModalTask(task);
    if (task.address.lat != null && task.address.lng != null) {
      setLocCoords({ lat: task.address.lat, lng: task.address.lng });
    } else {
      setLocCoords(null);
    }
    setLocHousePhotoB64(task.address.housePhotoUrl || null);
    setLocLandmark(task.address.landmark || '');
  };

  // Get GPS directly from mobile device
  const handleGetCurrentGps = () => {
    if (!('geolocation' in navigator)) {
      toast('Perangkat Anda tidak mendukung fitur Geolocation GPS.', 'error');
      return;
    }

    setLocGettingGps(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocCoords({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: Math.round(position.coords.accuracy),
        });
        setLocGettingGps(false);
        toast(`📍 Koordinat GPS berhasil diambil (akurasi ±${Math.round(position.coords.accuracy)}m)`, 'success');
      },
      (error) => {
        setLocGettingGps(false);
        toast(`Gagal mengambil GPS: ${error.message}. Pastikan izin lokasi browser aktif.`, 'error');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  // Pick / Capture House Photo from camera
  const handlePickHousePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const b64 = reader.result as string;
      setLocHousePhotoB64(b64);
    };
    reader.readAsDataURL(file);

    // Auto-fetch GPS if not yet fetched so therapist captures photo & GPS in 1 step
    if (!locCoords && 'geolocation' in navigator && !locGettingGps) {
      setLocGettingGps(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocCoords({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: Math.round(position.coords.accuracy),
          });
          setLocGettingGps(false);
          toast(`📍 GPS otomatis terkunci bersama foto (akurasi ±${Math.round(position.coords.accuracy)}m)`, 'success');
        },
        (error) => {
          setLocGettingGps(false);
          console.warn('[GPS] Auto GPS failed:', error.message);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    }
  };

  // Submit Location & House Photo Update
  const handleSaveLocation = async () => {
    if (!updateLocationModalTask) return;

    // Konfirmasi titik lokasi GPS sebelum menyimpan
    if (locCoords) {
      const ok = await confirm({
        title: 'Konfirmasi Titik Lokasi Rumah Pasien',
        message: `Apakah Anda yakin saat ini sedang berada di depan/lokasi rumah pasien (${updateLocationModalTask.customerName || 'Bunda'})? Titik koordinat GPS ini akan disimpan sebagai panduan tetap untuk kunjungan berikutnya.`,
        confirmText: 'Ya, Saya di Lokasi Pasien',
        cancelText: 'Batal / Cek Lagi',
      });
      if (!ok) return;
    }

    setSubmittingLoc(true);
    try {
      const res = await apiRequest('/api/staff/update-location', {
        method: 'POST',
        body: JSON.stringify({
          reservationId: updateLocationModalTask.reservationId,
          lat: locCoords?.lat,
          lng: locCoords?.lng,
          housePhotoB64: locHousePhotoB64 && locHousePhotoB64.startsWith('data:image/') ? locHousePhotoB64 : undefined,
          landmark: locLandmark,
        }),
      });

      if (res.success && res.data) {
        toast('✅ Titik lokasi & panduan rumah berhasil diperbarui!', 'success');
        const targetResId = updateLocationModalTask.reservationId;
        const newHouseUrl = res.data.housePhotoUrl || updateLocationModalTask.address.housePhotoUrl;
        const newLandmark = res.data.landmark !== undefined ? res.data.landmark : locLandmark;
        const newLat = res.data.lat ?? locCoords?.lat;
        const newLng = res.data.lng ?? locCoords?.lng;
        const newDistKm = res.data.distanceKm ?? updateLocationModalTask.address.distanceKm;
        const newEstMin = res.data.estimatedMinutes ?? updateLocationModalTask.address.estimatedMinutes;
        const newMapsUrl = newLat && newLng ? `https://maps.google.com/?q=${newLat},${newLng}` : null;
        const newNavUrl =
          newLat && newLng
            ? `https://www.google.com/maps/dir/?api=1&destination=${newLat},${newLng}&travelmode=bicycling`
            : null;

        const updateTaskObj = (t: StaffTask) => {
          if (t.reservationId !== targetResId) return t;
          return {
            ...t,
            mapsUrl: newMapsUrl,
            navigationUrl: newNavUrl,
            address: {
              ...t.address,
              lat: newLat,
              lng: newLng,
              distanceKm: newDistKm,
              estimatedMinutes: newEstMin,
              housePhotoUrl: newHouseUrl,
              landmark: newLandmark,
            },
          };
        };

        setTasks((prev) => prev.map(updateTaskObj));
        setUpcomingTasks((prev) => prev.map(updateTaskObj));
        setCompletedTasks((prev) => prev.map(updateTaskObj));

        if (selectedTask?.reservationId === targetResId) {
          setSelectedTask((prev) => (prev ? updateTaskObj(prev) : null));
        }
        if (detailModalTask?.reservationId === targetResId) {
          setDetailModalTask((prev) => (prev ? updateTaskObj(prev) : null));
        }

        setUpdateLocationModalTask(null);
      } else {
        toast(`Gagal: ${res.error || 'Terjadi kesalahan saat memperbarui lokasi'}`, 'error');
      }
    } catch (err: any) {
      toast(`Gagal: ${err.message || 'Terjadi kesalahan jaringan'}`, 'error');
    } finally {
      setSubmittingLoc(false);
    }
  };

  // Filter list
  const activeList =
    activeTab === 'today'
      ? tasks
      : activeTab === 'upcoming'
      ? upcomingTasks
      : completedTasks;

  const filteredTasks = activeList.filter((t) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const nameMatch = (t.customerName || '').toLowerCase().includes(q);
    const addressMatch = (t.address?.fullText || '').toLowerCase().includes(q);
    const treatmentMatch = (t.treatmentDetail || '').toLowerCase().includes(q);
    return nameMatch || addressMatch || treatmentMatch;
  });

  // Group upcoming tasks by date
  const groupedUpcoming = (activeTab === 'upcoming' ? filteredTasks : upcomingTasks).reduce<Record<string, StaffTask[]>>((acc, item) => {
    const key = formatDateGroup(item.bookingDate);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  // Group completed tasks by date
  const groupedCompleted = (activeTab === 'completed' ? filteredTasks : completedTasks).reduce<Record<string, StaffTask[]>>((acc, item) => {
    const key = formatDateGroup(item.bookingDate);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  const totalRevenueCompleted = completedTasks.reduce((sum, t) => sum + (t.pricing?.totalFee || 0), 0);

  return (
    <div className="min-h-[100dvh] bg-[#f0f2f5] text-[#111b21] flex flex-col font-sans select-none overflow-hidden antialiased">
      {/* WhatsApp Web Minimalist Clean Top Bar */}
      <header className="bg-white border-b border-[#e9edef] px-3 sm:px-4 py-2.5 sticky top-0 z-30 shadow-xs">
        <div className="flex items-center justify-between gap-2 sm:gap-4 max-w-7xl mx-auto w-full">
          <div className="flex items-center space-x-2.5 min-w-0">
            {mobileView === 'chat' && activeTab === 'today' && (
              <button
                onClick={handleBackToList}
                className="md:hidden p-2 rounded-full bg-[#f0f2f5] hover:bg-[#e9edef] text-[#54656f] transition-all active:scale-95 border border-[#e9edef] flex-shrink-0"
                title="Kembali ke daftar kunjungan"
                aria-label="Kembali"
              >
                <ChevronLeft size={18} />
              </button>
            )}

            {/* Interactive Staff Profile Avatar Icon (Tap/Click to open drawer) */}
            <button
              type="button"
              onClick={() => setShowStaffProfileModal(true)}
              className="h-9 w-9 rounded-full bg-[#008069] text-white hover:bg-[#00a884] flex items-center justify-center shadow-xs transition-all active:scale-95 flex-shrink-0"
              title="Buka profil staff & logout"
            >
              <UserCheck size={18} />
            </button>

            <div className="min-w-0">
              <h1 className="font-bold text-sm sm:text-base text-[#111b21] tracking-tight truncate">
                {staff?.name || 'Terapis'}
              </h1>
              <p className="text-[11px] text-[#667781] truncate">
                {tasks.length} Hari Ini • {upcomingTasks.length} Mendatang
              </p>
            </div>
          </div>

          {/* Navigation Tab Switcher (Hari Ini vs Jadwal Mendatang vs Selesai) */}
          {!(mobileView === 'chat' && activeTab === 'today') && (
            <div className="hidden sm:flex items-center bg-[#f0f2f5] p-1 rounded-xl border border-[#e9edef]">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('today');
                  setMobileView('list');
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'today'
                    ? 'bg-white text-[#008069] shadow-xs'
                    : 'text-[#54656f] hover:text-[#111b21]'
                }`}
              >
                <Calendar size={13} className={activeTab === 'today' ? 'text-[#008069]' : 'text-[#667781]'} />
                <span>Hari Ini</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                    activeTab === 'today' ? 'bg-[#d9fdd3] text-[#008069]' : 'bg-[#e9edef] text-[#667781]'
                  }`}
                >
                  {tasks.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTab('upcoming');
                  setMobileView('list');
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'upcoming'
                    ? 'bg-white text-[#008069] shadow-xs'
                    : 'text-[#54656f] hover:text-[#111b21]'
                }`}
              >
                <Clock size={13} className={activeTab === 'upcoming' ? 'text-[#008069]' : 'text-[#667781]'} />
                <span>Jadwal Mendatang</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                    activeTab === 'upcoming' ? 'bg-[#d9fdd3] text-[#008069]' : 'bg-[#e9edef] text-[#667781]'
                  }`}
                >
                  {upcomingTasks.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTab('completed');
                  setMobileView('list');
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'completed'
                    ? 'bg-white text-[#008069] shadow-xs'
                    : 'text-[#54656f] hover:text-[#111b21]'
                }`}
              >
                <CheckCircle2 size={13} className={activeTab === 'completed' ? 'text-[#008069]' : 'text-[#667781]'} />
                <span>Selesai</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                    activeTab === 'completed' ? 'bg-[#d9fdd3] text-[#008069]' : 'bg-[#e9edef] text-[#667781]'
                  }`}
                >
                  {completedTasks.length}
                </span>
              </button>
            </div>
          )}

          <div className="flex items-center space-x-2 flex-shrink-0">
            {/* Minimalist Connection Dot (Green = Connected, Red = Disconnected/Reconnecting) */}
            <div
              className="flex items-center justify-center p-1.5"
              title={sseConnected ? 'Realtime Online' : 'Koneksi terputus, mencoba menghubungkan ulang...'}
            >
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  sseConnected
                    ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]'
                    : 'bg-rose-500 animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.6)]'
                }`}
              />
            </div>

            {/* Refresh Tasks Button */}
            <button
              onClick={() => fetchTasks(false)}
              disabled={loading}
              className="p-2 rounded-full bg-white hover:bg-[#e9edef] text-[#54656f] hover:text-[#111b21] transition-all disabled:opacity-50 active:scale-95 border border-[#e9edef] shadow-xs"
              title="Muat Ulang Data"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin text-[#008069]' : ''} />
            </button>

            {/* Hamburger Button (Garis Tiga untuk buka Sidebar Menu Kanan) */}
            <button
              type="button"
              onClick={() => setShowMenuDrawer(true)}
              className="p-2 rounded-full bg-[#f0f2f5] hover:bg-[#e9edef] text-[#111b21] hover:text-[#008069] transition-all active:scale-95 border border-[#e9edef] shadow-xs flex items-center justify-center"
              title="Buka Menu Navigasi"
              aria-label="Menu"
            >
              <Menu size={16} />
            </button>
          </div>
        </div>
      </header>

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
              } w-full md:w-[420px] flex-col border-r border-[#e9edef] bg-[#f0f2f5] overflow-hidden flex-shrink-0`}
            >
              {/* Panel Search & Header */}
              <div className="p-3 bg-white border-b border-[#e9edef] space-y-2.5">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center space-x-2">
                    <Calendar size={16} className="text-[#008069]" />
                    <h2 className="font-bold text-sm text-[#111b21]">Jadwal Kunjungan Hari Ini</h2>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#d9fdd3] text-[#008069] border border-[#00a884]/30">
                    {tasks.length} Pasien
                  </span>
                </div>

                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-[#54656f]">
                    <Search size={14} />
                  </span>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari pasien atau alamat..."
                    className="w-full pl-9 pr-4 py-2 rounded-lg bg-[#f0f2f5] text-xs text-[#111b21] placeholder-[#667781] focus:outline-none focus:ring-1 focus:ring-[#008069] transition-all"
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

              {/* Task cards scroll area with proper background & space-y-3 spacing between cards */}
              <div className="flex-1 overflow-y-auto p-3 bg-[#f0f2f5] space-y-3">
                {loading ? (
                  <div className="flex flex-col justify-center items-center h-48 space-y-3 text-[#667781]">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#008069] border-t-transparent"></div>
                    <span className="text-xs font-medium">Memuat daftar tugas...</span>
                  </div>
                ) : filteredTasks.length === 0 ? (
                  <div className="text-center py-16 px-4 text-[#667781] space-y-2 bg-white rounded-2xl border border-[#e9edef] shadow-xs">
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
                  filteredTasks.map((task, idx) => {
                    const isSelected = selectedTask?.reservationId === task.reservationId;
                    const isSendingOtw = sendingOtwId === task.reservationId;
                    const isLunas = task.pricing.paymentStatus === 'LUNAS';
                    const catInfo = getCategoryIcon(task.treatmentCategory);

                    return (
                      <div
                        key={task.reservationId}
                        onClick={() => handleOpenChat(task)}
                        className={`p-3.5 rounded-2xl cursor-pointer transition-all text-left relative bg-white shadow-xs border ${
                          isSelected
                            ? 'border-[#008069] ring-2 ring-[#008069]/25 shadow-md'
                            : 'border-[#e9edef] hover:border-[#008069]/40 hover:shadow-sm'
                        } ${catInfo.borderAccent} border-l-4`}
                      >
                        {/* Header: Customer Icon & Name & Time */}
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="flex items-center space-x-2.5 min-w-0">
                            {/* Service Category Avatar Icon - Click to view detail */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDetailModalTask(task);
                              }}
                              className={`h-10 w-10 rounded-2xl flex items-center justify-center flex-shrink-0 border shadow-xs transition-all active:scale-95 ${catInfo.bg}`}
                              title="Lihat detail lengkap pasien"
                            >
                              {catInfo.icon}
                            </button>
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
                        <div className="text-xs text-[#54656f] mb-2 mt-2 bg-[#f0f2f5] p-2.5 rounded-xl border border-[#e9edef] space-y-2">
                          <div className="flex items-start gap-1.5">
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

                          {/* Foto Depan Rumah & Patokan Landmark */}
                          {task.address.housePhotoUrl ? (
                            <div className="flex items-center gap-2 p-1.5 rounded-lg bg-white border border-[#e9edef]">
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setZoomImageUrl(task.address.housePhotoUrl || null);
                                }}
                                className="h-11 w-11 rounded-lg bg-[#f0f2f5] overflow-hidden flex-shrink-0 relative group cursor-pointer border border-[#e9edef]"
                                title="Klik untuk memperbesar foto rumah"
                              >
                                <img
                                  src={task.address.housePhotoUrl}
                                  alt="Foto Depan Rumah"
                                  className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                                />
                                <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                                  <Maximize2 size={12} />
                                </div>
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="text-[10px] font-bold text-[#008069] uppercase tracking-wider block">
                                  🏠 Foto Depan Rumah
                                </span>
                                {task.address.landmark ? (
                                  <p className="text-[11px] text-[#111b21] truncate font-medium">
                                    Patokan: {task.address.landmark}
                                  </p>
                                ) : (
                                  <p className="text-[10px] text-[#667781] truncate">Panduan visual tersimpan</p>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenUpdateLocationModal(task);
                                }}
                                className="p-1.5 text-xs text-[#008069] hover:bg-[#e8f5f2] rounded-lg transition-all border border-[#e9edef] flex-shrink-0"
                                title="Perbarui titik lokasi / foto rumah"
                              >
                                <PenLine size={12} />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenUpdateLocationModal(task);
                              }}
                              className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-white hover:bg-[#e8f5f2] text-[#008069] text-[11px] font-semibold border border-dashed border-[#00a884]/40 transition-all active:scale-95"
                            >
                              <Camera size={12} />
                              <span>+ Update Titik Lokasi & Foto Rumah</span>
                            </button>
                          )}
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
                            {task.pricing.deliveryFee > 0 && (
                              <span className="text-[10px] text-[#667781] font-medium ml-1">
                                (ongkir {formatRupiah(task.pricing.deliveryFee)})
                              </span>
                            )}
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

                        {/* Quick Action Buttons: Navigasi, Infokan OTW */}
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
                            disabled={isSendingOtw || !isOtwAllowed(task)}
                            onClick={(e) => handleSendOtw(task, e)}
                            className="flex items-center justify-center space-x-1 py-1.5 px-2 text-xs font-semibold text-[#008069] bg-[#d9fdd3] hover:bg-[#cbf7c3] rounded-lg transition-all active:scale-95 border border-[#00a884]/30 shadow-xs disabled:opacity-40 disabled:cursor-not-allowed"
                            title={
                              isOtwAllowed(task)
                                ? 'Kirim pesan cepat ke WhatsApp pasien bahwa Anda sedang menuju lokasi'
                                : `OTW baru bisa dikirim maks. 2 jam sebelum jadwal (${formatTime(task.bookingDate)})`
                            }
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
                    <div className="flex items-center space-x-2.5 min-w-0">
                      {/* Mobile Back to List Button */}
                      <button
                        onClick={handleBackToList}
                        className="md:hidden p-2 rounded-full bg-white hover:bg-[#e9edef] text-[#54656f] transition-all active:scale-95 border border-[#e9edef] flex-shrink-0"
                        title="Kembali ke daftar kunjungan"
                        aria-label="Kembali"
                      >
                        <ChevronLeft size={18} />
                      </button>

                      {/* Customer Service Category Icon - Click for detail */}
                      <button
                        type="button"
                        onClick={() => setDetailModalTask(selectedTask)}
                        className={`h-10 w-10 rounded-2xl flex items-center justify-center flex-shrink-0 border shadow-xs transition-all active:scale-95 ${getCategoryIcon(selectedTask.treatmentCategory).bg}`}
                        title="Lihat detail lengkap pasien"
                      >
                        {getCategoryIcon(selectedTask.treatmentCategory).icon}
                      </button>

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

                    {/* Header Actions: Navigasi, Bayar, Infokan OTW (icon-only) */}
                    <div className="flex items-center space-x-1.5 flex-shrink-0">
                      {(selectedTask.navigationUrl || selectedTask.mapsUrl) && (
                        <a
                          href={selectedTask.navigationUrl || selectedTask.mapsUrl || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="h-9 w-9 flex items-center justify-center rounded-lg bg-[#008069] hover:bg-[#00a884] text-white shadow-xs transition-all active:scale-95"
                          title="Buka Peta Navigasi Google Maps"
                        >
                          <Navigation size={16} />
                        </a>
                      )}

                      <button
                        onClick={() => setPaymentModalTask(selectedTask)}
                        className={`h-9 w-9 flex items-center justify-center rounded-lg text-xs font-semibold transition-all shadow-xs active:scale-95 ${
                          selectedTask.pricing.paymentStatus === 'LUNAS'
                            ? 'bg-[#d9fdd3] text-[#008069] border border-[#00a884]/30'
                            : 'bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300'
                        }`}
                        title={
                          selectedTask.pricing.paymentStatus === 'LUNAS'
                            ? 'Pembayaran sudah lunas'
                            : 'Catat Status Pembayaran Transaksi'
                        }
                      >
                        <CreditCard size={16} />
                      </button>

                      <button
                        onClick={() => handleSendOtw(selectedTask)}
                        disabled={sendingOtwId === selectedTask.reservationId || !isOtwAllowed(selectedTask)}
                        className={`h-9 w-9 flex items-center justify-center rounded-lg text-[#008069] transition-all border shadow-xs active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
                          isOtwAllowed(selectedTask)
                            ? 'bg-[#d9fdd3] hover:bg-[#cbf7c3] border-[#00a884]/30'
                            : 'bg-[#f0f2f5] border-[#e9edef]'
                        }`}
                        title={
                          isOtwAllowed(selectedTask)
                            ? 'Kirim info menuju lokasi (OTW) ke WhatsApp pasien'
                            : `OTW baru bisa dikirim maks. 2 jam sebelum jadwal (${formatTime(selectedTask.bookingDate)})`
                        }
                      >
                        {sendingOtwId === selectedTask.reservationId ? (
                          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#008069] border-t-transparent"></div>
                        ) : (
                          <Navigation2 size={16} />
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
                                  <User size={10} className="text-[#54656f]" />
                                  <span className="font-medium text-[#111b21]">
                                    {selectedTask.customerName || 'Customer'}
                                  </span>
                                </>
                              ) : isBot ? (
                                <>
                                  <Bot size={10} className="text-[#008069]" />
                                  <span className="font-medium text-[#008069]">Bot Asisten Klinik</span>
                                </>
                              ) : isStaff ? (
                                <>
                                  <UserCheck size={10} className="text-sky-600" />
                                  <span className="font-medium text-sky-700">
                                    {msg.sender_name || staff?.name || 'Terapis'}
                                  </span>
                                </>
                              ) : (
                                <span className="font-medium text-[#54656f]">Admin</span>
                              )}
                              <span>•</span>
                              <span>{timeStr}</span>
                            </div>

                            {/* WhatsApp Speech Bubble */}
                            <div
                              className={`relative group max-w-[85%] sm:max-w-[70%] p-3 rounded-2xl text-xs leading-relaxed shadow-xs transition-all ${
                                isInbound
                                  ? 'bg-white text-[#111b21] rounded-tl-xs border border-[#e9edef]'
                                  : isBot
                                  ? 'bg-[#e8f5f2] text-[#111b21] rounded-tr-xs border border-[#c2e7e0]'
                                  : 'bg-[#d9fdd3] text-[#111b21] rounded-tr-xs border border-[#00a884]/20'
                              }`}
                            >
                              {/* Media Attachment Thumbnail Preview */}
                              {media && (
                                <div className="mb-2 rounded-xl overflow-hidden border border-black/5 bg-black/5">
                                  <MediaImage
                                    src={media.url || media.hdUrl}
                                    downloadSrc={media.hdUrl || media.url}
                                    caption={media.caption}
                                    blur={isInbound}
                                  />
                                </div>
                              )}

                              {/* Message Text Content */}
                              <div className="whitespace-pre-wrap break-words">{msg.content}</div>

                              {/* Meta Info & Double Blue Ticks / Delete Button */}
                              <div className="flex items-center justify-end space-x-1.5 mt-1 pt-0.5 text-[10px] text-[#667781]">
                                <span>{timeStr}</span>
                                {!isInbound && (
                                  <span title="Terkirim ke WhatsApp">
                                    <CheckCheck size={13} className="text-[#53bdeb]" />
                                  </span>
                                )}

                                {/* Revoke message button (for Staff Outbound Messages) */}
                                {isStaff && gatewayCapability?.supportsRevoke && (
                                  <button
                                    onClick={() => handleRevokeMessage(msg)}
                                    disabled={revokingId === msg.id}
                                    className="opacity-0 group-hover:opacity-100 hover:text-rose-600 transition-opacity p-0.5 ml-1"
                                    title="Tarik pesan ini dari WhatsApp"
                                  >
                                    {revokingId === msg.id ? (
                                      <div className="h-2.5 w-2.5 animate-spin rounded-full border border-rose-500 border-t-transparent"></div>
                                    ) : (
                                      <Trash2 size={11} />
                                    )}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* WhatsApp Quick Reply Input Bar */}
                  <form
                    onSubmit={handleSendReply}
                    className="bg-[#f0f2f5] border-t border-[#e9edef] p-3 z-10"
                  >
                    {selectedImage && (
                      <div className="flex items-center space-x-2 mb-2 bg-white border border-[#e9edef] rounded-xl p-2">
                        <img
                          src={selectedImage.preview}
                          alt="Lampiran"
                          className="h-12 w-12 object-cover rounded-lg border border-[#e9edef]"
                        />
                        <span className="flex-1 text-xs text-[#54656f] truncate">
                          {selectedImage.file.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedImage(null)}
                          className="p-1.5 rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100 transition"
                          title="Hapus lampiran"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )}
                    <div className="flex items-center space-x-2">
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        ref={chatFileInputRef}
                        onChange={handlePickImage}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => chatFileInputRef.current?.click()}
                        disabled={sending}
                        className="h-10 w-10 rounded-xl bg-white border border-[#e9edef] text-[#008069] hover:bg-[#e8f5f2] transition shadow-xs flex items-center justify-center flex-shrink-0 disabled:opacity-40"
                        title="Buka Kamera & Ambil Foto"
                        aria-label="Kamera"
                      >
                        <Camera size={18} />
                      </button>
                      <div className="flex-1 relative">
                        <input
                          type="text"
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder="Ketik pesan balasan..."
                          disabled={sending}
                          className="w-full bg-white border border-[#e9edef] focus:border-[#008069] text-[#111b21] rounded-xl px-4 py-2.5 text-xs sm:text-sm focus:outline-none placeholder-[#667781] transition-colors disabled:opacity-50 shadow-xs"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={(!replyText.trim() && !selectedImage) || sending}
                        className="h-10 w-10 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white font-semibold shadow-xs flex items-center justify-center transition-all disabled:opacity-40 disabled:hover:bg-[#008069] flex-shrink-0 active:scale-95"
                        title="Kirim Pesan"
                      >
                        {sending ? (
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                        ) : (
                          <Send size={15} className="ml-0.5 text-white" />
                        )}
                      </button>
                    </div>
                  </form>

                  {/* Sender Identity Signature Badge */}
                  <div className="px-4 pb-2 pt-0.5 flex items-center justify-between text-[11px] text-[#667781] bg-[#f0f2f5] select-none">
                    <span className="flex items-center gap-1">
                      <span>✍️ Identitas pengirim:</span>
                      <strong className="text-[#008069]">~ {staff?.name || 'Terapis'}</strong>
                    </span>
                    <span className="hidden sm:inline text-[10px] text-[#8696a0]">Otomatis disematkan di akhir pesan</span>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-[#667781] space-y-4 bg-[#f0f2f5]/40">
                  <div className="h-16 w-16 rounded-3xl bg-white flex items-center justify-center text-[#008069] shadow-xs border border-[#e9edef]">
                    <MessageSquare size={32} />
                  </div>
                  <div className="space-y-1 max-w-sm">
                    <h3 className="font-bold text-[#111b21] text-base">Pilih Jadwal Pasien</h3>
                    <p className="text-xs text-[#667781] leading-relaxed">
                      Pilih salah satu jadwal kunjungan pasien di sebelah kiri untuk melihat rincian lokasi, petunjuk arah peta, status pembayaran, dan berkirim pesan langsung melalui WhatsApp.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : activeTab === 'upcoming' ? (
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
                    {items.map((item) => {
                      const catInfo = getCategoryIcon(item.treatmentCategory);
                      return (
                        <div
                          key={item.reservationId}
                          className={`bg-white rounded-2xl p-4 border border-[#e9edef] shadow-xs hover:border-[#008069]/40 transition-all space-y-3 text-left ${catInfo.borderAccent} border-l-4`}
                        >
                          {/* Header: Name & Time */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center space-x-2.5 min-w-0">
                              {/* Service Category Icon - Click to view detail */}
                              <button
                                type="button"
                                onClick={() => setDetailModalTask(item)}
                                className={`h-10 w-10 rounded-2xl flex items-center justify-center flex-shrink-0 border shadow-xs transition-all active:scale-95 ${catInfo.bg}`}
                                title="Lihat detail lengkap pasien"
                              >
                                {catInfo.icon}
                              </button>
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
                          <div className="text-xs text-[#54656f] bg-[#f0f2f5] p-2.5 rounded-xl border border-[#e9edef] space-y-2">
                            <div className="flex items-start gap-1.5">
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

                            {/* Foto Depan Rumah & Patokan Landmark */}
                            {item.address.housePhotoUrl ? (
                              <div className="flex items-center gap-2 p-1.5 rounded-lg bg-white border border-[#e9edef]">
                                <div
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setZoomImageUrl(item.address.housePhotoUrl || null);
                                  }}
                                  className="h-11 w-11 rounded-lg bg-[#f0f2f5] overflow-hidden flex-shrink-0 relative group cursor-pointer border border-[#e9edef]"
                                  title="Klik untuk memperbesar foto rumah"
                                >
                                  <img
                                    src={item.address.housePhotoUrl}
                                    alt="Foto Depan Rumah"
                                    className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                                  />
                                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                                    <Maximize2 size={12} />
                                  </div>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <span className="text-[10px] font-bold text-[#008069] uppercase tracking-wider block">
                                    🏠 Foto Depan Rumah
                                  </span>
                                  {item.address.landmark ? (
                                    <p className="text-[11px] text-[#111b21] truncate font-medium">
                                      Patokan: {item.address.landmark}
                                    </p>
                                  ) : (
                                    <p className="text-[10px] text-[#667781] truncate">Panduan visual tersimpan</p>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenUpdateLocationModal(item);
                                  }}
                                  className="p-1.5 text-xs text-[#008069] hover:bg-[#e8f5f2] rounded-lg transition-all border border-[#e9edef] flex-shrink-0"
                                  title="Perbarui titik lokasi / foto rumah"
                                >
                                  <PenLine size={12} />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenUpdateLocationModal(item);
                                }}
                                className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-white hover:bg-[#e8f5f2] text-[#008069] text-[11px] font-semibold border border-dashed border-[#00a884]/40 transition-all active:scale-95"
                              >
                                <Camera size={12} />
                                <span>+ Update Titik Lokasi & Foto Rumah</span>
                              </button>
                            )}
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
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          /* ========================================================================= */
          /* TAB 3: TREATMENT YANG SUDAH DILAKUKAN (SELESAI) */
          /* ========================================================================= */
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-5xl mx-auto w-full space-y-6">
            {/* Header / Summary Metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="bg-white p-4 rounded-2xl border border-[#e9edef] shadow-xs flex items-center space-x-3.5">
                <div className="h-11 w-11 rounded-2xl bg-[#d9fdd3] text-[#008069] flex items-center justify-center flex-shrink-0 border border-[#00a884]/30">
                  <CheckCircle2 size={22} />
                </div>
                <div>
                  <div className="text-[11px] font-bold text-[#667781] uppercase tracking-wider">Total Selesai</div>
                  <div className="text-lg font-extrabold text-[#111b21]">
                    {completedTasks.length} <span className="text-xs font-semibold text-[#667781]">Treatment</span>
                  </div>
                </div>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-[#e9edef] shadow-xs flex items-center space-x-3.5">
                <div className="h-11 w-11 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center flex-shrink-0 border border-amber-200">
                  <CreditCard size={22} />
                </div>
                <div>
                  <div className="text-[11px] font-bold text-[#667781] uppercase tracking-wider">Total Nilai Treatment</div>
                  <div className="text-lg font-extrabold text-[#111b21]">
                    {formatRupiah(totalRevenueCompleted)}
                  </div>
                </div>
              </div>
            </div>

            {/* Search Bar */}
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-[#54656f]">
                <Search size={16} />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari riwayat treatment yang sudah selesai (nama, kelurahan, treatment)..."
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
                <span className="text-xs font-medium">Memuat riwayat treatment selesai...</span>
              </div>
            ) : Object.keys(groupedCompleted).length === 0 ? (
              <div className="text-center py-20 px-4 text-[#667781] space-y-3 bg-white rounded-2xl border border-[#e9edef] shadow-xs">
                <CheckCircle2 size={48} className="mx-auto text-[#008069]/40" />
                <div className="space-y-1 max-w-sm mx-auto">
                  <h3 className="text-base font-bold text-[#111b21]">
                    {searchQuery ? 'Tidak Ada Riwayat yang Cocok' : 'Belum Ada Treatment Selesai'}
                  </h3>
                  <p className="text-xs text-[#667781] leading-relaxed">
                    {searchQuery
                      ? 'Coba gunakan kata kunci pencarian yang lain.'
                      : 'Riwayat tugas treatment yang telah Anda selesaikan atau dibayar akan otomatis tercatat di sini.'}
                  </p>
                </div>
              </div>
            ) : (
              Object.entries(groupedCompleted).map(([dateLabel, items]) => (
                <div key={dateLabel} className="space-y-3">
                  {/* Date Header Pill */}
                  <div className="flex items-center space-x-2 pt-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-600"></span>
                    <h2 className="font-bold text-sm text-[#111b21]">{dateLabel}</h2>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white text-[#54656f] border border-[#e9edef]">
                      {items.length} Selesai
                    </span>
                  </div>

                  {/* Cards Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {items.map((item) => {
                      const catInfo = getCategoryIcon(item.treatmentCategory);
                      return (
                        <div
                          key={item.reservationId}
                          className={`bg-white rounded-2xl p-4 border border-[#e9edef] shadow-xs hover:border-emerald-500/40 transition-all space-y-3 text-left ${catInfo.borderAccent} border-l-4`}
                        >
                          {/* Header: Name & Completed Badge */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center space-x-2.5 min-w-0">
                              {/* Service Category Icon - Click to view detail */}
                              <button
                                type="button"
                                onClick={() => setDetailModalTask(item)}
                                className={`h-10 w-10 rounded-2xl flex items-center justify-center flex-shrink-0 border shadow-xs transition-all active:scale-95 ${catInfo.bg}`}
                                title="Lihat detail lengkap pasien"
                              >
                                {catInfo.icon}
                              </button>
                              <div className="min-w-0">
                                <h3 className="font-bold text-sm text-[#111b21] truncate">
                                  {item.customerName || 'Customer'}
                                </h3>
                                <p className="text-xs text-[#008069] font-medium truncate">
                                  {item.treatmentDetail || 'Treatment Layanan Spa'}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center space-x-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg whitespace-nowrap border border-emerald-200 flex-shrink-0">
                              <CheckCheck size={13} className="text-emerald-600" />
                              <span>Selesai</span>
                            </div>
                          </div>

                          {/* Alamat & Jarak dari Klinik */}
                          <div className="text-xs text-[#54656f] bg-[#f0f2f5] p-2.5 rounded-xl border border-[#e9edef] space-y-2">
                            <div className="flex items-start gap-1.5">
                              <MapPin size={14} className="text-[#008069] mt-0.5 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-[#111b21] leading-snug">{item.address.fullText}</p>
                                {item.address.distanceKm != null && (
                                  <p className="text-[10px] font-semibold text-[#008069] mt-1 flex items-center gap-1">
                                    <Compass size={11} />
                                    <span>Jarak: {item.address.distanceKm.toFixed(1)} km dari klinik</span>
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* Foto Depan Rumah & Patokan Landmark */}
                            {item.address.housePhotoUrl && (
                              <div className="flex items-center gap-2 p-1.5 rounded-lg bg-white border border-[#e9edef]">
                                <div
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setZoomImageUrl(item.address.housePhotoUrl || null);
                                  }}
                                  className="h-11 w-11 rounded-lg bg-[#f0f2f5] overflow-hidden flex-shrink-0 relative group cursor-pointer border border-[#e9edef]"
                                  title="Klik untuk memperbesar foto rumah"
                                >
                                  <img
                                    src={item.address.housePhotoUrl}
                                    alt="Foto Depan Rumah"
                                    className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                                  />
                                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                                    <Maximize2 size={12} />
                                  </div>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <span className="text-[10px] font-bold text-[#008069] uppercase tracking-wider block">
                                    🏠 Foto Depan Rumah
                                  </span>
                                  {item.address.landmark ? (
                                    <p className="text-[11px] text-[#111b21] truncate font-medium">
                                      Patokan: {item.address.landmark}
                                    </p>
                                  ) : (
                                    <p className="text-[10px] text-[#667781] truncate">Panduan visual tersimpan</p>
                                  )}
                                </div>
                              </div>
                            )}
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

                          {/* Status Pembayaran & Detail Button */}
                          <div className="flex items-center justify-between pt-2 border-t border-[#f0f2f5]">
                            <div className="flex items-center gap-1 text-xs text-[#667781]">
                              <CreditCard size={13} className="text-emerald-600" />
                              <strong className="text-emerald-700 font-bold ml-0.5">
                                {formatRupiah(item.pricing.totalFee)}
                              </strong>
                              <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded font-semibold ml-1">
                                {item.pricing.paymentStatusLabel}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => setDetailModalTask(item)}
                              className="flex items-center space-x-1 py-1.5 px-3 text-xs font-semibold text-[#008069] bg-[#d9fdd3] hover:bg-[#c2e7e0] rounded-lg transition-all active:scale-95 border border-[#00a884]/30"
                              title="Lihat Detail Lengkap Pasien"
                            >
                              <Info size={12} />
                              <span>Detail</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* RIGHT SIDEBAR SLIDE-OVER DRAWER (MENU GARIS TIGA) */}
      {/* ========================================================================= */}
      {showMenuDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop Overlay */}
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity duration-300"
            onClick={() => setShowMenuDrawer(false)}
          />

          {/* Drawer Body */}
          <div className="relative w-[320px] sm:w-[380px] max-w-[85vw] bg-white h-full shadow-2xl flex flex-col z-10 transform transition-transform duration-300 ease-in-out">
            {/* Drawer Header */}
            <div className="p-4 bg-[#008069] text-white flex items-center justify-between shadow-xs">
              <div className="flex items-center space-x-3 min-w-0">
                <div className="h-10 w-10 rounded-full bg-white/20 flex items-center justify-center text-white border border-white/30 flex-shrink-0">
                  <UserCheck size={20} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-sm truncate">{staff?.name || 'Terapis'}</h3>
                  <p className="text-[11px] text-white/80 truncate">Terapis Homecare Klinik</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowMenuDrawer(false)}
                className="h-8 w-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all active:scale-95"
                title="Tutup Menu"
              >
                <X size={16} />
              </button>
            </div>

            {/* Navigation Menu List */}
            <div className="flex-1 overflow-y-auto p-3.5 space-y-2">
              <div className="px-2 py-1 text-[11px] font-bold text-[#667781] uppercase tracking-wider">
                Menu Jadwal & Treatment
              </div>

              {/* Menu 1: Treatment Hari Ini */}
              <button
                type="button"
                onClick={() => {
                  setActiveTab('today');
                  setMobileView('list');
                  setShowMenuDrawer(false);
                }}
                className={`w-full flex items-center justify-between p-3 rounded-2xl transition-all text-left ${
                  activeTab === 'today'
                    ? 'bg-[#d9fdd3] text-[#008069] font-bold shadow-xs border border-[#00a884]/30'
                    : 'bg-[#f0f2f5] hover:bg-[#e9edef] text-[#111b21]'
                }`}
              >
                <div className="flex items-center space-x-3 min-w-0">
                  <div
                    className={`h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      activeTab === 'today' ? 'bg-[#008069] text-white' : 'bg-white text-[#008069] shadow-xs'
                    }`}
                  >
                    <Calendar size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">Treatment Hari Ini</div>
                    <div className="text-[11px] text-[#667781] font-normal truncate">
                      Kunjungan & chat pasien aktif
                    </div>
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                    activeTab === 'today' ? 'bg-[#008069] text-white' : 'bg-white text-[#008069] border border-[#e9edef]'
                  }`}
                >
                  {tasks.length}
                </span>
              </button>

              {/* Menu 2: Jadwal Mendatang */}
              <button
                type="button"
                onClick={() => {
                  setActiveTab('upcoming');
                  setMobileView('list');
                  setShowMenuDrawer(false);
                }}
                className={`w-full flex items-center justify-between p-3 rounded-2xl transition-all text-left ${
                  activeTab === 'upcoming'
                    ? 'bg-[#d9fdd3] text-[#008069] font-bold shadow-xs border border-[#00a884]/30'
                    : 'bg-[#f0f2f5] hover:bg-[#e9edef] text-[#111b21]'
                }`}
              >
                <div className="flex items-center space-x-3 min-w-0">
                  <div
                    className={`h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      activeTab === 'upcoming' ? 'bg-[#008069] text-white' : 'bg-white text-[#008069] shadow-xs'
                    }`}
                  >
                    <Clock size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">Jadwal Mendatang</div>
                    <div className="text-[11px] text-[#667781] font-normal truncate">
                      Reservasi hari esok & seterusnya
                    </div>
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                    activeTab === 'upcoming' ? 'bg-[#008069] text-white' : 'bg-white text-[#008069] border border-[#e9edef]'
                  }`}
                >
                  {upcomingTasks.length}
                </span>
              </button>

              {/* Menu 3: Treatment yang Sudah Dilakukan */}
              <button
                type="button"
                onClick={() => {
                  setActiveTab('completed');
                  setMobileView('list');
                  setShowMenuDrawer(false);
                }}
                className={`w-full flex items-center justify-between p-3 rounded-2xl transition-all text-left ${
                  activeTab === 'completed'
                    ? 'bg-[#d9fdd3] text-[#008069] font-bold shadow-xs border border-[#00a884]/30'
                    : 'bg-[#f0f2f5] hover:bg-[#e9edef] text-[#111b21]'
                }`}
              >
                <div className="flex items-center space-x-3 min-w-0">
                  <div
                    className={`h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      activeTab === 'completed' ? 'bg-[#008069] text-white' : 'bg-white text-[#008069] shadow-xs'
                    }`}
                  >
                    <CheckCircle2 size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">Treatment Selesai</div>
                    <div className="text-[11px] text-[#667781] font-normal truncate">
                      Riwayat yang sudah dilakukan
                    </div>
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                    activeTab === 'completed' ? 'bg-[#008069] text-white' : 'bg-white text-[#008069] border border-[#e9edef]'
                  }`}
                >
                  {completedTasks.length}
                </span>
              </button>
            </div>

            {/* Drawer Footer Actions */}
            <div className="p-4 border-t border-[#e9edef] bg-[#f0f2f5] space-y-2">
              <button
                type="button"
                onClick={() => {
                  setShowMenuDrawer(false);
                  setShowStaffProfileModal(true);
                }}
                className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 rounded-xl bg-white hover:bg-[#e9edef] text-xs font-semibold text-[#111b21] border border-[#e9edef] shadow-xs transition-all active:scale-95"
              >
                <Info size={14} className="text-[#008069]" />
                <span>Informasi Profil & Akun</span>
              </button>

              <button
                type="button"
                onClick={async () => {
                  setShowMenuDrawer(false);
                  const ok = await confirm({
                    title: 'Keluar dari Portal?',
                    message: 'Apakah Anda yakin ingin keluar dari akun terapis ini?',
                    confirmText: 'Ya, Keluar',
                    danger: true,
                  });
                  if (ok) {
                    logout();
                  }
                }}
                className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 rounded-xl bg-rose-50 hover:bg-rose-100 text-xs font-semibold text-rose-600 border border-rose-200 shadow-xs transition-all active:scale-95"
              >
                <LogOut size={14} />
                <span>Keluar dari Akun</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL / DRAWER PROFIL STAFF & LOGOUT */}
      {/* ========================================================================= */}
      {showStaffProfileModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fadeIn"
          onClick={() => setShowStaffProfileModal(false)}
        >
          <div
            className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl border border-[#e9edef] space-y-5 text-center relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowStaffProfileModal(false)}
              className="absolute top-4 right-4 p-1.5 rounded-full text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5] transition"
            >
              <X size={18} />
            </button>

            {/* Avatar Icon */}
            <div className="mx-auto h-20 w-20 rounded-3xl bg-[#e8f5f2] border-2 border-[#c2e7e0] text-[#008069] flex items-center justify-center shadow-inner">
              <UserCheck size={40} />
            </div>

            {/* Staff Info */}
            <div className="space-y-1">
              <h3 className="font-bold text-lg text-[#111b21]">
                {staff?.name || 'Terapis'}
              </h3>
              <p className="text-xs text-[#667781] font-mono">
                {staff?.phone || 'Akun Terapis'}
              </p>
              <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-[#d9fdd3] text-[#008069] border border-[#00a884]/30 mt-1">
                Staff Terapis Lapangan
              </span>
            </div>

            {/* Actions */}
            <div className="pt-2 space-y-2">
              <button
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Keluar dari Portal?',
                    message: 'Apakah Anda yakin ingin keluar dari akun terapis ini?',
                    confirmText: 'Ya, Keluar',
                    danger: true,
                  });
                  if (ok) {
                    setShowStaffProfileModal(false);
                    logout();
                  }
                }}
                className="w-full py-3 px-4 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-2xl text-sm font-bold transition flex items-center justify-center space-x-2 shadow-xs"
              >
                <LogOut size={16} />
                <span>Keluar Akun (Logout)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL DETAIL JADWAL & PASIEN (PRIVACY SAFE - NO PHONE LEAK) */}
      {/* ========================================================================= */}
      {detailModalTask && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fadeIn"
          onClick={() => setDetailModalTask(null)}
        >
          <div
            className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl border border-[#e9edef] space-y-4 text-left relative max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-[#e9edef] pb-3">
              <div className="flex items-center space-x-3">
                <div className={`h-11 w-11 rounded-2xl flex items-center justify-center border shadow-xs ${getCategoryIcon(detailModalTask.treatmentCategory).bg}`}>
                  {getCategoryIcon(detailModalTask.treatmentCategory).icon}
                </div>
                <div>
                  <h3 className="font-bold text-base text-[#111b21]">
                    {detailModalTask.customerName || 'Customer'}
                  </h3>
                  <div className="flex items-center space-x-1.5 text-xs text-[#008069] font-semibold mt-0.5">
                    <Clock size={12} />
                    <span>{formatTime(detailModalTask.bookingDate)}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setDetailModalTask(null)}
                className="p-1.5 rounded-full text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5] transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Treatment & Category */}
            <div className="p-3.5 rounded-2xl bg-[#f8fafc] border border-[#e9edef] space-y-1.5">
              <span className="text-[10px] font-bold text-[#667781] uppercase tracking-wider block">
                Layanan & Treatment
              </span>
              <p className="text-sm font-bold text-[#111b21]">
                {detailModalTask.treatmentDetail || 'Treatment Layanan Spa'}
              </p>
              <span className="inline-block px-2.5 py-0.5 rounded-md text-xs font-semibold bg-[#e8f5f2] text-[#008069] border border-[#c2e7e0]">
                Kategori: {getCategoryIcon(detailModalTask.treatmentCategory).label}
              </span>
            </div>

            {/* Alamat & Jarak */}
            <div className="p-3.5 rounded-2xl bg-[#f8fafc] border border-[#e9edef] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-[#667781] uppercase tracking-wider block">
                  Alamat Lokasi Kunjungan
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const t = detailModalTask;
                    setDetailModalTask(null);
                    handleOpenUpdateLocationModal(t);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#008069] hover:underline"
                >
                  <PenLine size={11} />
                  <span>Update Titik & Foto</span>
                </button>
              </div>

              <div className="flex items-start space-x-2 text-xs text-[#111b21]">
                <MapPin size={15} className="text-[#008069] mt-0.5 flex-shrink-0" />
                <div className="leading-relaxed flex-1 min-w-0">
                  <p className="font-medium">{detailModalTask.address.fullText}</p>
                  {detailModalTask.address.distanceKm != null && (
                    <p className="text-[11px] font-semibold text-[#008069] mt-1 flex items-center space-x-1">
                      <Compass size={12} />
                      <span>
                        {detailModalTask.address.distanceSource === 'PREVIOUS_PATIENT' && detailModalTask.address.originName
                          ? `${detailModalTask.address.distanceKm.toFixed(1)} km dari ${detailModalTask.address.originName}`
                          : `${detailModalTask.address.distanceKm.toFixed(1)} km dari klinik`}
                        {detailModalTask.address.estimatedMinutes != null && (
                          <span className="text-[#667781] font-normal ml-1">
                            (±{detailModalTask.address.estimatedMinutes} menit)
                          </span>
                        )}
                      </span>
                    </p>
                  )}
                </div>
              </div>

              {/* Foto Depan Rumah & Patokan Landmark */}
              {detailModalTask.address.housePhotoUrl ? (
                <div className="flex items-center gap-2.5 p-2 rounded-xl bg-white border border-[#e9edef] mt-1">
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      setZoomImageUrl(detailModalTask.address.housePhotoUrl || null);
                    }}
                    className="h-14 w-14 rounded-xl bg-[#f0f2f5] overflow-hidden flex-shrink-0 relative group cursor-pointer border border-[#e9edef]"
                    title="Klik untuk memperbesar foto rumah"
                  >
                    <img
                      src={detailModalTask.address.housePhotoUrl}
                      alt="Foto Depan Rumah"
                      className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                    />
                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                      <Maximize2 size={14} />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] font-bold text-[#008069] uppercase tracking-wider block">
                      🏠 Foto Tampak Depan Rumah
                    </span>
                    {detailModalTask.address.landmark ? (
                      <p className="text-xs text-[#111b21] font-semibold mt-0.5">
                        Patokan: {detailModalTask.address.landmark}
                      </p>
                    ) : (
                      <p className="text-[11px] text-[#667781]">Panduan visual tersimpan</p>
                    )}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    const t = detailModalTask;
                    setDetailModalTask(null);
                    handleOpenUpdateLocationModal(t);
                  }}
                  className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-white hover:bg-[#e8f5f2] text-[#008069] text-xs font-semibold border border-dashed border-[#00a884]/40 transition-all active:scale-95"
                >
                  <Camera size={13} />
                  <span>+ Tambah Foto Depan Rumah & Update GPS</span>
                </button>
              )}
            </div>

            {/* Data Anak */}
            {detailModalTask.children && detailModalTask.children.length > 0 && (
              <div className="p-3.5 rounded-2xl bg-[#f8fafc] border border-[#e9edef] space-y-1.5">
                <span className="text-[10px] font-bold text-[#667781] uppercase tracking-wider block">
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

            {/* Rincian Finansial / Pembayaran */}
            <div className="p-3.5 rounded-2xl bg-[#f8fafc] border border-[#e9edef] space-y-2">
              <span className="text-[10px] font-bold text-[#667781] uppercase tracking-wider block">
                Rincian Biaya & Status Pembayaran
              </span>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between text-[#667781]">
                  <span>Biaya Layanan:</span>
                  <span>{formatRupiah(detailModalTask.pricing.treatmentFee)}</span>
                </div>
                <div className="flex justify-between text-[#667781]">
                  <span>Ongkos Kirim:</span>
                  <span>{formatRupiah(detailModalTask.pricing.deliveryFee)}</span>
                </div>
                <div className="flex justify-between font-bold text-[#111b21] pt-1 border-t border-[#e9edef]">
                  <span>Total Tagihan:</span>
                  <span className="text-[#008069] text-sm">{formatRupiah(detailModalTask.pricing.totalFee)}</span>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between">
                <span className="text-xs text-[#667781]">Status Pembayaran:</span>
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

            {/* Modal Actions */}
            <div className="pt-1 flex space-x-2">
              {(detailModalTask.navigationUrl || detailModalTask.mapsUrl) && (
                <a
                  href={detailModalTask.navigationUrl || detailModalTask.mapsUrl || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-3 px-4 bg-[#008069] hover:bg-[#00a884] text-white rounded-2xl text-xs font-bold transition flex items-center justify-center space-x-1.5 shadow-xs"
                >
                  <Navigation size={14} />
                  <span>Buka Peta Navigasi</span>
                </a>
              )}
              <button
                onClick={() => setDetailModalTask(null)}
                className="py-3 px-5 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#111b21] rounded-2xl text-xs font-bold transition shadow-xs"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL CATAT PEMBAYARAN (TUNAI VS NON-TUNAI / TRANSFER / QRIS) */}
      {/* ========================================================================= */}
      {paymentModalTask && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fadeIn"
          onClick={() => setPaymentModalTask(null)}
        >
          <div
            className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl border border-[#e9edef] space-y-4 text-left"
            onClick={(e) => e.stopPropagation()}
          >
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
                className="p-1.5 rounded-full text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5] transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Total Tagihan Banner */}
            <div className="bg-[#f0f2f5] p-3.5 rounded-2xl border border-[#e9edef] flex items-center justify-between">
              <div>
                <span className="text-xs text-[#667781] block">Total Tagihan:</span>
                <span className="text-base font-bold text-[#008069]">
                  {formatRupiah(paymentModalTask.pricing.totalFee)}
                </span>
              </div>
              <span className="text-[11px] font-semibold px-2.5 py-1 bg-white text-[#54656f] rounded-xl border border-[#e9edef]">
                Ongkir: {formatRupiah(paymentModalTask.pricing.deliveryFee)}
              </span>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmitPayment} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#111b21] mb-2">
                  Metode Pembayaran:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['CASH', 'TRANSFER', 'QRIS'] as const).map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setPaymentMethod(method)}
                      className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all ${
                        paymentMethod === method
                          ? 'bg-[#008069] text-white border-[#008069] shadow-xs'
                          : 'bg-white text-[#54656f] border-[#e9edef] hover:bg-[#f0f2f5]'
                      }`}
                    >
                      {method === 'CASH' ? '💵 Tunai' : method === 'TRANSFER' ? '🏦 Transfer' : '📱 QRIS'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Upload Proof if Non-Cash */}
              {paymentMethod !== 'CASH' && (
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-[#111b21]">
                    Foto Bukti Pembayaran (Wajib):
                  </label>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                  {proofImageB64 ? (
                    <div className="relative rounded-xl overflow-hidden border border-[#e9edef] bg-black/5 flex items-center justify-center max-h-48">
                      <img src={proofImageB64} alt="Bukti bayar" className="object-contain max-h-48 w-auto" />
                      <button
                        type="button"
                        onClick={() => setProofImageB64(null)}
                        className="absolute top-2 right-2 p-1 rounded-full bg-black/60 text-white hover:bg-black/80 transition"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full py-4 border-2 border-dashed border-[#d1d7db] hover:border-[#008069] rounded-2xl flex flex-col items-center justify-center text-xs text-[#667781] hover:text-[#008069] transition bg-[#f8fafc]"
                    >
                      <Upload size={20} className="mb-1 text-[#8696a0]" />
                      <span>Ketuk untuk pilih atau ambil foto bukti transfer</span>
                    </button>
                  )}
                </div>
              )}

              {/* Submit Buttons */}
              <div className="flex justify-end space-x-2 pt-3 border-t border-[#e9edef]">
                <button
                  type="button"
                  onClick={() => {
                    setPaymentModalTask(null);
                    setProofImageB64(null);
                    setPaymentMethod('CASH');
                  }}
                  className="px-4 py-2.5 rounded-xl border border-[#d1d7db] text-xs font-semibold text-[#54656f] hover:bg-[#f0f2f5] transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submittingPayment || (paymentMethod !== 'CASH' && !proofImageB64)}
                  className="px-5 py-2.5 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50"
                >
                  {submittingPayment ? (
                    <>
                      <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                      <span>Menyimpan...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={14} />
                      <span>Simpan Status Lunas</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL UPDATE TITIK LOKASI & FOTO RUMAH */}
      {/* ========================================================================= */}
      {updateLocationModalTask && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-fadeIn"
          onClick={() => setUpdateLocationModalTask(null)}
        >
          <div
            className="bg-white rounded-3xl p-5 sm:p-6 w-full max-w-md shadow-2xl border border-[#e9edef] space-y-4 text-left relative max-h-[92vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between border-b border-[#e9edef] pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="h-10 w-10 rounded-2xl bg-[#e8f5f2] text-[#008069] flex items-center justify-center border border-[#c2e7e0] shadow-xs">
                  <MapPin size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-base text-[#111b21]">Update Lokasi & Foto Rumah</h3>
                  <p className="text-xs text-[#667781] truncate max-w-[220px]">
                    {updateLocationModalTask.customerName || 'Customer'}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setUpdateLocationModalTask(null)}
                className="p-1.5 rounded-full text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5] transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Info Alamat Pasien */}
            <div className="p-3 rounded-xl bg-[#f8fafc] border border-[#e9edef] text-xs text-[#54656f] space-y-1">
              <span className="text-[10px] font-bold text-[#667781] uppercase tracking-wider block">
                Alamat Tercatat:
              </span>
              <p className="text-xs text-[#111b21] font-medium leading-snug">
                {updateLocationModalTask.address.fullText}
              </p>
            </div>

            {/* Bagian 1: Koordinat GPS Otomatis */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-[#111b21]">
                1. Titik Koordinat GPS Rumah Pasien:
              </label>

              <button
                type="button"
                onClick={handleGetCurrentGps}
                disabled={locGettingGps}
                className="w-full py-2.5 px-3 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white text-xs font-bold transition flex items-center justify-center space-x-2 shadow-xs active:scale-95 disabled:opacity-50"
              >
                {locGettingGps ? (
                  <>
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                    <span>Mendeteksi Satelit GPS...</span>
                  </>
                ) : (
                  <>
                    <Crosshair size={14} />
                    <span>📍 Gunakan Titik GPS HP Saya Sekarang</span>
                  </>
                )}
              </button>

              {locCoords ? (
                <div className="p-2.5 rounded-xl bg-[#d9fdd3]/70 border border-[#00a884]/30 text-xs text-[#008069] flex items-center justify-between">
                  <div>
                    <div className="font-bold flex items-center gap-1">
                      <CheckCircle2 size={13} />
                      <span>Koordinat Presisi Terkunci</span>
                    </div>
                    <div className="font-mono text-[11px] text-[#54656f] mt-0.5">
                      {locCoords.lat.toFixed(6)}, {locCoords.lng.toFixed(6)}
                      {locCoords.accuracy ? ` (Akurasi: ±${locCoords.accuracy}m)` : ''}
                    </div>
                  </div>
                  <a
                    href={`https://maps.google.com/?q=${locCoords.lat},${locCoords.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg bg-white text-[#008069] border border-[#00a884]/30 hover:bg-[#e8f5f2] text-xs font-semibold flex items-center gap-1 shadow-xs"
                    title="Cek di Google Maps"
                  >
                    <Navigation size={12} />
                    <span>Cek</span>
                  </a>
                </div>
              ) : (
                <p className="text-[11px] text-[#8696a0] italic">
                  * Berdirilah di depan pagar rumah pasien lalu tekan tombol GPS di atas.
                </p>
              )}
            </div>

            {/* Bagian 2: Foto Tampak Depan Rumah */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-[#111b21]">
                2. Foto Tampak Depan Rumah (Kamera):
              </label>

              <input
                type="file"
                ref={locHouseFileInputRef}
                accept="image/*"
                capture="environment"
                onChange={handlePickHousePhoto}
                className="hidden"
              />

              {locHousePhotoB64 ? (
                <div className="relative rounded-2xl overflow-hidden border border-[#e9edef] bg-black/5 flex items-center justify-center max-h-48">
                  <img
                    src={locHousePhotoB64}
                    alt="Tampak Depan Rumah"
                    className="object-contain max-h-48 w-auto rounded-xl"
                  />
                  <div className="absolute top-2 right-2 flex gap-1">
                    <button
                      type="button"
                      onClick={() => locHouseFileInputRef.current?.click()}
                      className="p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition"
                      title="Foto ulang"
                    >
                      <Camera size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setLocHousePhotoB64(null)}
                      className="p-1.5 rounded-full bg-rose-600 text-white hover:bg-rose-700 transition"
                      title="Hapus foto"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => locHouseFileInputRef.current?.click()}
                  className="w-full py-4 border-2 border-dashed border-[#d1d7db] hover:border-[#008069] rounded-2xl flex flex-col items-center justify-center text-xs text-[#667781] hover:text-[#008069] transition bg-[#f8fafc]"
                >
                  <Camera size={22} className="mb-1 text-[#008069]" />
                  <span className="font-semibold text-[#111b21]">Buka Kamera & Foto Rumah Pasien</span>
                  <span className="text-[10px] text-[#8696a0]">Foto pagar, nomor rumah, atau tampak depan</span>
                </button>
              )}
            </div>

            {/* Bagian 3: Patokan Landmark */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-[#111b21]">
                3. Catatan Patokan / Ancer-ancer Rumah:
              </label>
              <input
                type="text"
                value={locLandmark}
                onChange={(e) => setLocLandmark(e.target.value)}
                placeholder="Contoh: Pagar hitam, samping toko berkah, seberang masjid"
                className="w-full px-3.5 py-2.5 bg-white border border-[#e9edef] rounded-xl text-xs sm:text-sm text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] transition shadow-xs"
              />
            </div>

            {/* Tombol Simpan */}
            <div className="flex justify-end space-x-2 pt-3 border-t border-[#e9edef]">
              <button
                type="button"
                onClick={() => setUpdateLocationModalTask(null)}
                disabled={submittingLoc}
                className="px-4 py-2.5 rounded-xl border border-[#d1d7db] text-xs font-semibold text-[#54656f] hover:bg-[#f0f2f5] transition"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveLocation}
                disabled={submittingLoc}
                className="px-5 py-2.5 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50"
              >
                {submittingLoc ? (
                  <>
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                    <span>Menyimpan...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={14} />
                    <span>Simpan Pembaruan Lokasi</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL ZOOM LIGHTBOX FOTO RUMAH */}
      {/* ========================================================================= */}
      {zoomImageUrl && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn"
          onClick={() => setZoomImageUrl(null)}
        >
          <div className="relative max-w-2xl w-full max-h-[90vh] flex flex-col items-center">
            <button
              onClick={() => setZoomImageUrl(null)}
              className="absolute -top-10 right-0 p-2 text-white/80 hover:text-white transition"
              title="Tutup Foto"
            >
              <X size={24} />
            </button>
            <img
              src={zoomImageUrl}
              alt="Foto Depan Rumah"
              className="max-h-[80vh] w-auto rounded-2xl shadow-2xl object-contain border border-white/20"
              onClick={(e) => e.stopPropagation()}
            />
            <div className="mt-2 text-xs text-white/80 font-medium">
              🏠 Foto Panduan Tampak Depan Rumah Pasien
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
