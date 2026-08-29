import React, { useEffect, useRef, useState, useCallback } from 'react';
import { apiRequest } from '../../services/api';
import { useStaffAuth } from '../../contexts/StaffAuthContext';
import { useAuth } from '../../contexts/AuthContext';
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
  LayoutDashboard,
  ArrowRightLeft,
} from 'lucide-react';
import { MediaImage, ChatMediaData } from '../../components/common/MediaImage';
import { CustomerAvatar } from '../../components/common/CustomerAvatar';
import { emitBootPhase } from '../../lib/bootProgress';
import { APP_VERSION, BUILD_TIME } from '../../config/version';

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
  customerProfilePictureUrl?: string | null;
  assignedStaff?: { id: string; name: string; role?: string } | null;
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
  if (m && (m.url || m.hdUrl)) {
    const hdUrlStr = m.hdUrl || m.url;
    const standardUrlStr = (m.url && !m.url.includes('_thumb.')) ? m.url : (m.hdUrl || m.url);
    const thumbStr = m.thumbUrl || (m.url && m.url.includes('_thumb.') ? m.url : undefined);
    const cleanUrl = standardUrlStr.replace(/^https?:\/\/[^/]+/, '');
    const cleanHdUrl = hdUrlStr.replace(/^https?:\/\/[^/]+/, '');
    const cleanThumb = thumbStr ? thumbStr.replace(/^https?:\/\/[^/]+/, '') : undefined;
    return {
      ...m,
      url: cleanUrl.startsWith('/') ? cleanUrl : `/${cleanUrl}`,
      hdUrl: cleanHdUrl.startsWith('/') ? cleanHdUrl : `/${cleanHdUrl}`,
      thumbUrl: cleanThumb ? (cleanThumb.startsWith('/') ? cleanThumb : `/${cleanThumb}`) : undefined,
    };
  }
  const directMediaUrl = msg?.media_url ?? msg?.mediaUrl ?? msg?.media_hd_url ?? msg?.mediaHdUrl;
  if (directMediaUrl && typeof directMediaUrl === 'string') {
    const rawHdUrl = msg?.media_hd_url ?? msg?.mediaHdUrl ?? directMediaUrl;
    const rawUrl = (!directMediaUrl.includes('_thumb.')) ? directMediaUrl : rawHdUrl;
    const cleanUrl = rawUrl.replace(/^https?:\/\/[^/]+/, '');
    const cleanHdUrl = rawHdUrl.replace(/^https?:\/\/[^/]+/, '');
    return {
      url: cleanUrl.startsWith('/') ? cleanUrl : `/${cleanUrl}`,
      hdUrl: cleanHdUrl.startsWith('/') ? cleanHdUrl : `/${cleanHdUrl}`,
      thumbUrl: (msg?.media_thumb_url ?? msg?.mediaThumbUrl)?.replace(/^https?:\/\/[^/]+/, ''),
      mimeType: msg?.media_mime_type ?? msg?.mediaMimeType ?? 'image/jpeg',
      caption: msg?.media_caption ?? msg?.mediaCaption ?? undefined,
    };
  }
  if (msg?.payload_raw?.imageUrl) return { url: msg.payload_raw.imageUrl, hdUrl: msg.payload_raw.imageUrl };
  if (typeof msg?.content === 'string' && (msg.content.startsWith('/media/') || msg.content.startsWith('/api/files/') || msg.content.startsWith('http://') || msg.content.startsWith('https://')) && /\.(jpg|jpeg|png|webp|gif)$/i.test(msg.content)) {
    const clean = msg.content.replace(/^https?:\/\/[^/]+/, '');
    return { url: clean.startsWith('/') ? clean : `/${clean}`, hdUrl: clean.startsWith('/') ? clean : `/${clean}` };
  }
  return undefined;
}

import { playIncomingMessageSound } from '../../services/notificationSound';

function formatRupiah(amount: number): string {
  return 'Rp ' + (amount || 0).toLocaleString('id-ID');
}

export const StaffToday: React.FC = () => {
  const { staff, logout: staffLogout } = useStaffAuth();
  const { user, logout: adminLogout } = useAuth();
  const { toast, confirm } = useUiFeedback();

  const logout = staff ? staffLogout : adminLogout;
  const currentStaff = staff || (user ? { id: user.id, name: user.name, role: user.role, phone: user.phone } : null);
  
  // Navigation Tabs: 'today' (Hari Ini & Live Chat) vs 'upcoming' (Jadwal Mendatang) vs 'completed' (Treatment Selesai)
  const [activeTab, setActiveTab] = useState<'today' | 'upcoming' | 'completed'>('today');
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | 'none'>('none');

  const handleTabChange = (nextTab: 'today' | 'upcoming' | 'completed') => {
    if (nextTab === activeTab) return;
    const tabs: Array<'today' | 'upcoming' | 'completed'> = ['today', 'upcoming', 'completed'];
    const currentIndex = tabs.indexOf(activeTab);
    const nextIndex = tabs.indexOf(nextTab);
    setSlideDirection(nextIndex > currentIndex ? 'left' : 'right');
    setActiveTab(nextTab);
    setMobileView('list');
  };

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
  const [editingMsg, setEditingMsg] = useState<{ id: string; content: string } | null>(null);
  const [editContent, setEditContent] = useState('');
  const [isEditingSaving, setIsEditingSaving] = useState(false);

  // Staff Profile Drawer State
  const [showStaffProfileModal, setShowStaffProfileModal] = useState(false);
  const [telegramPairingInfo, setTelegramPairingInfo] = useState<{
    pairingToken: string;
    directLink: string;
    isConnected: boolean;
    telegramChatId: string | null;
  } | null>(null);
  const [loadingTelegramInfo, setLoadingTelegramInfo] = useState(false);

  const userRole = (currentStaff?.role || '').toLowerCase();
  const isSupervisor =
    userRole === 'spv_cs' || userRole === 'super_admin' || userRole === 'tenant_admin' || userRole === 'admin_cs';

  // Supervisor Delegation & Team Scope State
  const [scopeFilter, setScopeFilter] = useState<'mine' | 'all'>('mine');
  const [teamMembers, setTeamMembers] = useState<{ id: string; name: string; role?: string }[]>([]);
  const [reassignModalTask, setReassignModalTask] = useState<StaffTask | null>(null);
  const [reassignSelectedStaffId, setReassignSelectedStaffId] = useState<string>('');
  const [submittingReassign, setSubmittingReassign] = useState(false);

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
  const [gpsAttemptInfo, setGpsAttemptInfo] = useState<string | null>(null);
  const [submittingLoc, setSubmittingLoc] = useState(false);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);
  const locHouseFileInputRef = useRef<HTMLInputElement>(null);

  // Gateway capability (WAHA supportsRevoke=true, supportsEdit=true vs WABA supportsRevoke=false)
  const [gatewayCapability, setGatewayCapability] = useState<{ provider: string; supportsRevoke: boolean; supportsEdit?: boolean } | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const selectedTaskRef = useRef<StaffTask | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null);

  selectedTaskRef.current = selectedTask;

  const handleReplyTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setReplyText(e.target.value);
    if (replyTextareaRef.current) {
      replyTextareaRef.current.style.height = 'auto';
      replyTextareaRef.current.style.height = `${Math.min(replyTextareaRef.current.scrollHeight, 130)}px`;
    }
  };

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
  const fetchTasks = useCallback(
    async (isPolling = false, currentScope?: 'mine' | 'all') => {
      if (!isPolling) setLoading(true);
      const scopeToUse = currentScope || scopeFilter;
      try {
        const [todayRes, upcomingRes, completedRes] = await Promise.all([
          apiRequest(`/api/staff/today-tasks?scope=${scopeToUse}`),
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
    },
    [scopeFilter]
  );

  // Load team members for supervisor delegation dropdown
  useEffect(() => {
    if (isSupervisor) {
      apiRequest('/api/staff/team-members')
        .then((res) => {
          if (res?.success && Array.isArray(res.data)) {
            setTeamMembers(res.data);
          }
        })
        .catch(() => {});
    }
  }, [isSupervisor]);

  // Auto-poll tasks every 20s
  useEffect(() => {
    fetchTasks();
    const interval = setInterval(() => fetchTasks(true), 20000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  // Auto-scroll chat viewport to latest message with multi-tick dual execution
  const scrollToBottom = useCallback((forceMulti = true) => {
    const doScroll = () => {
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight + 99999;
      }
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });
      }
    };
    requestAnimationFrame(doScroll);
    if (forceMulti) {
      setTimeout(doScroll, 30);
      setTimeout(doScroll, 100);
      setTimeout(doScroll, 250);
      setTimeout(doScroll, 500);
    }
  }, []);

  // Fetch messages for selected task conversation (Maksimal 30 bubble chat)
  const fetchMessages = useCallback(async (conversationId: string) => {
    setLoadingMessages(true);
    setErrorMessage(null);
    try {
      const res = await apiRequest(`/api/staff/conversations/${conversationId}/messages`);
      if (res.success && Array.isArray(res.data)) {
        setMessages(res.data.slice(-30));
        scrollToBottom(true);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal memuat riwayat pesan.');
    } finally {
      setLoadingMessages(false);
      scrollToBottom(true);
    }
  }, [scrollToBottom]);

  // Load conversation when task is selected
  useEffect(() => {
    if (replyTextareaRef.current) {
      replyTextareaRef.current.style.height = 'auto';
    }
    if (selectedTask?.conversationId) {
      fetchMessages(selectedTask.conversationId);
    } else {
      setMessages([]);
    }
  }, [selectedTask?.conversationId, fetchMessages]);

  // Auto scroll chat when messages update or loading completes or view switches to chat
  useEffect(() => {
    if (!loadingMessages && (mobileView === 'chat' || selectedTask)) {
      scrollToBottom(true);
    }
  }, [mobileView, selectedTask, messages, loadingMessages, scrollToBottom]);

  // Open Chat with history push for Android/iOS Hardware Back Button
  const handleOpenChat = (task: StaffTask) => {
    setSelectedTask(task);
    setMobileView('chat');
    window.history.pushState({ view: 'chat', taskId: task.reservationId }, '');
    scrollToBottom(true);
  };

  // Back button in UI
  const handleBackToList = () => {
    if (window.history.state?.view === 'chat') {
      window.history.back();
    } else {
      setMobileView('list');
    }
  };

  // Touch swipe gesture handler for mobile navigation
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        time: Date.now(),
      };
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current || e.changedTouches.length === 0) return;
    const start = touchStartRef.current;
    touchStartRef.current = null;

    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const deltaX = endX - start.x;
    const deltaY = endY - start.y;
    const deltaTime = Date.now() - start.time;

    // Ignore slow gestures (> 650ms) or short drags (< 35px) or mostly vertical scrolls
    if (deltaTime > 650 || Math.abs(deltaX) < 35 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) {
      return;
    }

    const isRightEdgeStart = start.x >= window.innerWidth - 55;

    // Right-Edge Swipe Gesture (Usap dari tepi paling kanan layar ke kiri) -> Buka Menu Drawer/Sidebar!
    if (isRightEdgeStart && deltaX < -35) {
      setShowMenuDrawer(true);
      return;
    }

    // Swipe ke kanan saat drawer terbuka -> Tutup drawer
    if (showMenuDrawer && deltaX > 35) {
      setShowMenuDrawer(false);
      return;
    }

    // Ignore tab/chat swipe if other modals or image zoom are open
    if (
      detailModalTask ||
      paymentModalTask ||
      updateLocationModalTask ||
      showStaffProfileModal ||
      showMenuDrawer ||
      zoomImageUrl
    ) {
      return;
    }

    // Case 1: In full-screen mobile chat view -> swipe RIGHT (left-to-right) navigates back to list
    if (mobileView === 'chat' && activeTab === 'today') {
      if (deltaX > 40) {
        handleBackToList();
      }
      return;
    }

    // Case 2: In tab list view -> swipe left/right switches tabs with directional sliding animation
    if (mobileView === 'list') {
      const tabs: Array<'today' | 'upcoming' | 'completed'> = ['today', 'upcoming', 'completed'];
      const currentIndex = tabs.indexOf(activeTab);

      if (deltaX < -40 && currentIndex < tabs.length - 1) {
        // Swipe Left -> next tab (content slides from right)
        handleTabChange(tabs[currentIndex + 1]);
      } else if (deltaX > 40 && currentIndex > 0) {
        // Swipe Right -> previous tab (content slides from left)
        handleTabChange(tabs[currentIndex - 1]);
      }
    }
  };

  // Popstate event listener for hardware / browser back button
  useEffect(() => {
    const handlePopState = () => {
      if (showMenuDrawer) {
        setShowMenuDrawer(false);
        return;
      }
      if (detailModalTask) {
        setDetailModalTask(null);
        return;
      }
      if (paymentModalTask) {
        setPaymentModalTask(null);
        return;
      }
      if (updateLocationModalTask) {
        setUpdateLocationModalTask(null);
        return;
      }
      if (showStaffProfileModal) {
        setShowStaffProfileModal(false);
        return;
      }
      if (zoomImageUrl) {
        setZoomImageUrl(null);
        return;
      }
      if (mobileView === 'chat') {
        setMobileView('list');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [mobileView, detailModalTask, paymentModalTask, updateLocationModalTask, showStaffProfileModal, showMenuDrawer, zoomImageUrl]);

  // Fetch Staff Telegram Pairing Status on Profile Modal Open
  useEffect(() => {
    if (showStaffProfileModal) {
      setLoadingTelegramInfo(true);
      apiRequest<{ success: boolean; data: any }>('/api/staff/me/telegram-pairing')
        .then((res) => {
          if (res.success && res.data) {
            setTelegramPairingInfo(res.data);
          }
        })
        .catch(() => {})
        .finally(() => setLoadingTelegramInfo(false));
    }
  }, [showStaffProfileModal]);

  // Connect SSE for realtime live chat messages
  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimeout: any = null;

    const connectSSE = () => {
      es = new EventSource('/api/staff/live-chat/events');

      es.onopen = () => {
        setSseConnected(true);
      };

      es.addEventListener('message.created', (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data);
          const convId = payload.conversationId || payload.conversation_id;
          const msg: ChatMessage = {
            id: payload.messageId || payload.id || `sse_${Date.now()}`,
            direction: payload.direction,
            content: payload.content || '',
            sender_type: payload.senderType || payload.sender_type || null,
            sender_name: payload.senderName || payload.sender_name || null,
            created_at: payload.createdAt || payload.created_at || new Date().toISOString(),
            media: extractMedia(payload),
          };

          const isSandbox = Boolean(payload.isSandboxTest || payload.is_sandbox_test || payload.isSandbox);

          // Play notification tone only on new incoming inbound message (bukan pesan riwayat / historical & bukan sandbox)
          if (msg.direction === 'INBOUND' && !payload.isHistorical && !isSandbox) {
            playIncomingMessageSound();
          }

          // Native browser notification (hanya untuk pesan live masuk dari customer asli)
          if ('Notification' in window && Notification.permission === 'granted' && msg.direction === 'INBOUND' && !payload.isHistorical && !isSandbox) {
            const sender = msg.sender_name || 'Pelanggan';
            const notif = new Notification(`Pesan Baru dari ${sender}`, {
              body: msg.content || 'Mengirim media/gambar',
              icon: '/admin/pwa-192x192.png',
              tag: `staff_chat_${convId}`,
            });
            notif.onclick = () => {
              window.focus();
              const allTasks = [...tasks, ...upcomingTasks, ...completedTasks];
              const match = allTasks.find((t) => t.conversationId === convId);
              if (match) {
                handleOpenChat(match);
              }
              try { notif.close(); } catch (_) {}
            };
          }

          // Append/reconcile message if matches currently open conversation (Maksimal 10 bubble)
          if (selectedTaskRef.current?.conversationId === convId) {
            setMessages((prev) => {
              const isImagePlaceholder = (c?: string) => !c || /^\[(IMAGE|GAMBAR|Image|MEDIA)\]/i.test(c.trim());

              const isDuplicate = prev.some(
                (m) =>
                  m.id === msg.id ||
                  (m.direction === msg.direction &&
                    (m.content === msg.content ||
                      (isImagePlaceholder(m.content) && isImagePlaceholder(msg.content)) ||
                      (!!m.media && !!msg.media)) &&
                    Math.abs(new Date(m.created_at).getTime() - new Date(msg.created_at).getTime()) < 30000)
              );

              if (isDuplicate) {
                // Reconcile: jika ada pesan sementara (temp-), ganti id-nya dengan id resmi dari server
                return prev.map((m) =>
                  m.direction === msg.direction &&
                  m.id.startsWith('temp-') &&
                  (m.content === msg.content ||
                    (isImagePlaceholder(m.content) && isImagePlaceholder(msg.content)) ||
                    (!!m.media && !!msg.media))
                    ? { ...m, id: msg.id, media: msg.media || m.media }
                    : m
                );
              }
              return [...prev, msg].slice(-30);
            });
          }
        } catch {
          // Ignore non-JSON heartbeat
        }
      });

      es.addEventListener('message.updated', (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data);
          const { messageId, content, isRevoked, conversationId } = payload;
          if (selectedTaskRef.current?.conversationId === conversationId) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === messageId ? { ...m, content, is_revoked: isRevoked } : m
              )
            );
          }
        } catch {}
      });

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

  const handleSendReply = async (e?: React.FormEvent | React.KeyboardEvent | React.SyntheticEvent) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    const image = selectedImage;
    const textToSend = replyText.trim();
    if ((!textToSend && !image) || !selectedTask?.conversationId || sending) return;

    const signature = `~ ${staff?.name || 'Bidan Terapis'}`;
    const hasText = !!textToSend;
    const optimisticContent = hasText
      ? textToSend.endsWith(signature) ? textToSend : `${textToSend}\n\n${signature}`
      : '[IMAGE]';

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

    setMessages((prev) => [...prev, optimisticMsg].slice(-30));
    setReplyText('');
    setSelectedImage(null);
    if (replyTextareaRef.current) {
      replyTextareaRef.current.style.height = 'auto';
    }
    scrollToBottom(true);

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

      if (res.success) {
        const assignedId = res.data?.messageId || res.data?.id;
        if (assignedId) {
          setMessages((prev) =>
            prev.map((m) => (m.id === tempId ? { ...m, id: assignedId } : m))
          );
        }
      } else {
        const errorMsg = res.error || 'Gagal mengirim pesan balasan.';
        setErrorMessage(errorMsg);
        toast(errorMsg, 'error');
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setReplyText(textToSend);
        setSelectedImage(image);
      }
    } catch (err: any) {
      const errorMsg = err.message || 'Gagal mengirim pesan balasan. Harap periksa koneksi WhatsApp.';
      setErrorMessage(errorMsg);
      toast(errorMsg, 'error');
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

  const handleStartEdit = (msg: ChatMessage) => {
    setEditingMsg({ id: msg.id, content: msg.content });
    setEditContent(msg.content);
  };

  const handleSaveEdit = async () => {
    if (!editingMsg || !selectedTask?.conversationId || isEditingSaving) return;
    if (!editContent.trim()) {
      toast('Teks pesan tidak boleh kosong.', 'error');
      return;
    }

    setIsEditingSaving(true);
    try {
      const res = await apiRequest(
        `/api/staff/conversations/${selectedTask.conversationId}/messages/${editingMsg.id}/edit`,
        {
          method: 'PUT',
          body: JSON.stringify({ text: editContent.trim() }),
        }
      );

      if (res?.success) {
        toast('Pesan berhasil diperbarui di WhatsApp!', 'success');
        setMessages((prev) =>
          prev.map((m) =>
            m.id === editingMsg.id
              ? { ...m, content: editContent.trim(), is_edited: true }
              : m
          )
        );
        setEditingMsg(null);
      } else {
        toast(`Gagal mengedit pesan: ${res?.error || 'Terjadi kesalahan'}`, 'error');
      }
    } catch (err: any) {
      toast(`Gagal mengedit pesan: ${err.message || 'Terjadi kesalahan'}`, 'error');
    } finally {
      setIsEditingSaving(false);
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

  // Auto-retry polling GPS hingga 5 kali percobaan atau hingga akurasi ≤ 10m
  const acquireBestGps = async (isPhotoAutoTrigger: boolean = false) => {
    if (!('geolocation' in navigator)) {
      toast('Perangkat Anda tidak mendukung fitur Geolocation GPS.', 'error');
      return;
    }

    setLocGettingGps(true);
    setGpsAttemptInfo('Mencari satelit GPS (1/5)...');

    let bestPos: { lat: number; lng: number; accuracy: number } | null = null;
    const MAX_ATTEMPTS = 5;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      setGpsAttemptInfo(`Mengunci satelit GPS (Percobaan ${attempt}/${MAX_ATTEMPTS})...`);

      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 6000,
            maximumAge: 0,
          });
        });

        const acc = Math.round(pos.coords.accuracy);
        const currentCoord = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: acc,
        };

        if (!bestPos || acc < bestPos.accuracy) {
          bestPos = currentCoord;
          setLocCoords(currentCoord);
        }

        // Jika sudah mencapai target presisi tinggi (≤ 10 meter), langsung stop & selesai!
        if (acc <= 10) {
          setGpsAttemptInfo(null);
          setLocGettingGps(false);
          toast(`🟢 GPS presisi tinggi terkunci (±${acc}m pada percobaan ke-${attempt})!`, 'success');
          return;
        }

        // Jika belum ≤ 10m dan masih ada sisa percobaan, tunggu sebentar lalu coba lagi
        if (attempt < MAX_ATTEMPTS) {
          setGpsAttemptInfo(`Akurasi ±${acc}m. Mencari sinyal lebih kuat (${attempt + 1}/${MAX_ATTEMPTS})...`);
          await new Promise((r) => setTimeout(r, 800));
        }
      } catch (err: any) {
        console.warn(`[GPS] Percobaan ${attempt} gagal:`, err?.message);
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 800));
        }
      }
    }

    setLocGettingGps(false);
    setGpsAttemptInfo(null);

    if (bestPos) {
      setLocCoords(bestPos);
      if (bestPos.accuracy <= 10) {
        toast(`🟢 GPS presisi tinggi terkunci (±${bestPos.accuracy}m)`, 'success');
      } else {
        toast(
          isPhotoAutoTrigger
            ? `📍 GPS terkunci (akurasi ±${bestPos.accuracy}m)`
            : `📍 GPS terkunci dengan akurasi terbaik ±${bestPos.accuracy}m (5 percobaan).`,
          'info'
        );
      }
    } else {
      toast('Gagal mengunci sinyal GPS. Pastikan izin lokasi browser aktif dan berada di luar ruangan.', 'error');
    }
  };

  // Get GPS directly from mobile device
  const handleGetCurrentGps = () => {
    acquireBestGps(false);
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
      acquireBestGps(true);
    }
  };

  // Submit Location & House Photo Update
  const handleSaveLocation = async () => {
    if (!updateLocationModalTask) return;

    // Konfirmasi titik lokasi GPS sebelum menyimpan
    if (locCoords) {
      const isLowAccuracy = locCoords.accuracy && locCoords.accuracy > 10;
      const confirmMsg = isLowAccuracy
        ? `⚠️ Perhatian: Akurasi GPS saat ini ±${locCoords.accuracy}m (target maksimal 10m).\n\nUntuk hasil paling presisi, disarankan berdiri di luar pagar/gerbang rumah pasien.\n\nApakah Anda ingin tetap menyimpan koordinat ini?`
        : `Apakah Anda yakin saat ini sedang berada di depan/lokasi rumah pasien (${updateLocationModalTask.customerName || 'Bunda'})? Titik koordinat GPS ini akan disimpan sebagai panduan tetap untuk kunjungan berikutnya.`;

      const ok = await confirm({
        title: isLowAccuracy ? 'Konfirmasi Akurasi GPS' : 'Konfirmasi Titik Lokasi Rumah Pasien',
        message: confirmMsg,
        confirmText: isLowAccuracy ? 'Ya, Tetap Simpan' : 'Ya, Saya di Lokasi Pasien',
        cancelText: 'Batal / Kunci GPS Lagi',
        danger: !!isLowAccuracy,
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
            ? `https://www.google.com/maps/dir/?api=1&destination=${newLat},${newLng}&travelmode=two-wheeler`
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
    <div className="min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-[#f0f2f5] text-[#111b21] flex flex-col font-sans select-none antialiased">
      {/* WhatsApp Web Minimalist Clean Top Bar */}
      <header className="bg-white border-b border-[#e9edef] px-3 sm:px-4 py-2.5 sticky top-0 z-30 shadow-xs pt-[calc(0.625rem+env(safe-area-inset-top,0px))] md:pt-2.5 pl-[max(0.75rem,env(safe-area-inset-left,0px))] pr-[max(0.75rem,env(safe-area-inset-right,0px))] shrink-0">
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
                {currentStaff?.name || 'Terapis'}
              </h1>
              <p className="text-[11px] text-[#667781] truncate flex items-center gap-1">
                <span>{tasks.length} Hari Ini • {upcomingTasks.length} Mendatang</span>
                <span className="text-[9px] text-[#8696a0] font-mono">({APP_VERSION})</span>
              </p>
            </div>
          </div>

          {/* Navigation Tab Switcher (Hari Ini vs Jadwal Mendatang vs Selesai) */}
          {!(mobileView === 'chat' && activeTab === 'today') && (
            <div className="hidden sm:flex items-center bg-[#f0f2f5] p-1 rounded-xl border border-[#e9edef]">
              <button
                type="button"
                onClick={() => handleTabChange('today')}
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
                onClick={() => handleTabChange('upcoming')}
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
                onClick={() => handleTabChange('completed')}
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

      {/* Mobile Navigation Segment Tab Bar (Always visible on mobile when not inside full-screen chat) */}
      {!(mobileView === 'chat' && activeTab === 'today') && (
        <nav aria-label="Mobile Navigation" className="sm:hidden px-3 py-2 bg-white border-b border-[#e9edef] flex items-center justify-between gap-1.5 shadow-xs z-20">
          <button
            type="button"
            onClick={() => handleTabChange('today')}
            className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 active:scale-95 ${
              activeTab === 'today'
                ? 'bg-[#008069] text-white shadow-xs'
                : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef]'
            }`}
          >
            <Calendar size={13} />
            <span>Hari Ini</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                activeTab === 'today' ? 'bg-white/20 text-white' : 'bg-[#e9edef] text-[#667781]'
              }`}
            >
              {tasks.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('upcoming')}
            className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 active:scale-95 ${
              activeTab === 'upcoming'
                ? 'bg-[#008069] text-white shadow-xs'
                : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef]'
            }`}
          >
            <Clock size={13} />
            <span>Mendatang</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                activeTab === 'upcoming' ? 'bg-white/20 text-white' : 'bg-[#e9edef] text-[#667781]'
              }`}
            >
              {upcomingTasks.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('completed')}
            className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 active:scale-95 ${
              activeTab === 'completed'
                ? 'bg-[#008069] text-white shadow-xs'
                : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef]'
            }`}
          >
            <CheckCircle2 size={13} />
            <span>Selesai</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                activeTab === 'completed' ? 'bg-white/20 text-white' : 'bg-[#e9edef] text-[#667781]'
              }`}
            >
              {completedTasks.length}
            </span>
          </button>
        </nav>
      )}

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

      {/* Main Split-View Workspace with Mobile Touch Swipe Navigation */}
      <div
        className="flex-1 flex overflow-hidden touch-pan-y"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* ========================================================================= */}
        {/* TAB 1: TUGAS HARI INI & LIVE CHAT SPLIT-VIEW (1 PAGE PER VIEW ON MOBILE) */}
        {/* ========================================================================= */}
        {activeTab === 'today' ? (
          <>
            {/* Left Column: WhatsApp Chat List & Visit Schedule */}
            <div
              className={`${
                mobileView === 'chat' ? 'hidden md:flex' : 'flex'
              } w-full md:w-[420px] flex-col border-r border-[#e9edef] bg-[#f0f2f5] overflow-hidden flex-shrink-0 min-h-0 h-full animate-fadeIn`}
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

                {/* Supervisor Scope Filter: Tugas Saya vs Semua Terapis Tim */}
                {isSupervisor && (
                  <div className="flex items-center p-1 bg-[#f0f2f5] rounded-xl border border-[#e9edef] gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setScopeFilter('mine');
                        fetchTasks(false, 'mine');
                      }}
                      className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                        scopeFilter === 'mine'
                          ? 'bg-white text-[#008069] shadow-xs'
                          : 'text-[#54656f] hover:text-[#111b21]'
                      }`}
                    >
                      <span>🛵</span>
                      <span>Tugas Saya</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setScopeFilter('all');
                        fetchTasks(false, 'all');
                      }}
                      className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                        scopeFilter === 'all'
                          ? 'bg-[#008069] text-white shadow-xs'
                          : 'text-[#54656f] hover:text-[#111b21]'
                      }`}
                    >
                      <span>👥</span>
                      <span>Semua Terapis</span>
                    </button>
                  </div>
                )}
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
                        className={`p-3.5 rounded-2xl transition-all duration-200 text-left relative bg-white shadow-xs border ${
                          isSelected
                            ? 'border-[#008069] ring-2 ring-[#008069]/30 shadow-md animate-pulseGlow'
                            : 'border-[#e9edef] hover:border-[#008069]/40 hover:shadow-sm active:scale-[0.98]'
                        } ${catInfo.borderAccent} border-l-4`}
                      >
                        {/* Header: Customer Icon & Name & Time (KLIK BARIS INI = DETAIL CUSTOMER) */}
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            setDetailModalTask(task);
                          }}
                          className="flex items-start justify-between gap-2 mb-1 p-1 -m-1 rounded-xl hover:bg-[#f0f2f5] transition cursor-pointer group"
                          title="Klik untuk melihat detail lengkap pasien"
                        >
                          <div className="flex items-center space-x-2.5 min-w-0">
                            {/* Customer Avatar with Visit Order Badge */}
                            <div className="relative flex-shrink-0">
                              <CustomerAvatar
                                src={task.customerProfilePictureUrl}
                                name={task.customerName}
                                size="md"
                              />
                              <span className="absolute -top-1.5 -left-1.5 px-1.5 py-0.2 rounded-full bg-[#008069] text-white text-[9px] font-extrabold shadow-xs">
                                #{idx + 1}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <h3 className="font-semibold text-sm text-[#111b21] truncate group-hover:text-[#008069] transition">
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

                        {/* Area Bawah: Alamat, Foto Rumah, & Tombol Chat (KLIK KE BAWAH = CHAT / AKSI) */}
                        <div onClick={() => handleOpenChat(task)} className="cursor-pointer">
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

                        {/* Bar Terapis Penanggung Jawab & Delegasi (Khusus Supervisor / Mode Tim) */}
                        {isSupervisor && (
                          <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#e9edef] text-xs">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[10px] text-[#667781] font-semibold flex-shrink-0">Terapis:</span>
                              <span className="px-2 py-0.5 rounded-md bg-purple-50 text-purple-800 text-[10px] font-bold border border-purple-200 truncate">
                                {task.assignedStaff?.name || 'Belum Ditugaskan'}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setReassignModalTask(task);
                                setReassignSelectedStaffId(task.assignedStaff?.id || '');
                              }}
                              className="px-2.5 py-1 rounded-lg bg-white hover:bg-purple-50 text-purple-700 text-[10px] font-bold border border-purple-200 shadow-2xs transition-all active:scale-95 flex items-center gap-1 flex-shrink-0"
                              title="Ganti / Delegasikan terapis penanggung jawab"
                            >
                              <ArrowRightLeft size={11} />
                              <span>Delegasikan</span>
                            </button>
                          </div>
                        )}
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
              } flex-1 flex-col bg-[#efeae2] overflow-hidden relative min-h-0 h-full`}
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

                      {/* Customer Info Header - Klik untuk melihat Detail Pasien */}
                      <div
                        onClick={() => setDetailModalTask(selectedTask)}
                        className="flex items-center space-x-2.5 min-w-0 p-1 -m-1 rounded-xl hover:bg-[#e9edef] transition cursor-pointer group"
                        title="Klik untuk melihat detail lengkap pasien"
                      >
                        {/* Customer Avatar */}
                        <CustomerAvatar
                          src={selectedTask.customerProfilePictureUrl}
                          name={selectedTask.customerName}
                          size="md"
                        />

                        <div className="min-w-0">
                          <div className="flex items-center space-x-2">
                            <h2 className="font-semibold text-[#111b21] text-sm truncate group-hover:text-[#008069] transition">
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
                    className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#efeae2] relative min-h-0"
                    style={{
                      backgroundImage: `radial-gradient(#d1c7b8 1px, transparent 1px)`,
                      backgroundSize: '24px 24px',
                    }}
                  >
                    {/* Date separator badge */}
                    <div className="flex justify-center my-1.5">
                      <div className="bg-white text-[#54656f] text-[11px] font-medium px-3 py-1 rounded-lg text-center shadow-xs border border-[#e9edef]">
                        Percakapan WhatsApp Pasien
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

                        const isValidDate = msg.created_at && !isNaN(new Date(msg.created_at).getTime());
                        const timeStr = isValidDate
                          ? new Date(msg.created_at).toLocaleTimeString('id-ID', {
                              hour: '2-digit',
                              minute: '2-digit',
                            }).replace(':', '.')
                          : new Date().toLocaleTimeString('id-ID', {
                              hour: '2-digit',
                              minute: '2-digit',
                            }).replace(':', '.');

                        return (
                          <div
                            key={msg.id}
                            className={`flex flex-col ${isInbound ? 'items-start' : 'items-end'} animate-popIn`}
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
                              {/* Media Attachment Preview */}
                              {media && (
                                <div
                                  onLoad={() => scrollToBottom(false)}
                                  className="mb-2 rounded-xl overflow-hidden"
                                >
                                  <MediaImage
                                    src={media.url || media.hdUrl || media.thumbUrl}
                                    downloadSrc={media.hdUrl || media.url}
                                    thumbUrl={media.thumbUrl}
                                    caption={media.caption}
                                  />
                                </div>
                              )}

                              {/* Message Text Content */}
                              <div className="whitespace-pre-wrap break-words">{msg.content}</div>

                              {/* Meta Info & Double Blue Ticks / Delete Button */}
                              <div className="flex items-center justify-end space-x-1.5 mt-1 pt-0.5 text-[10px] text-[#667781]">
                                {((msg as any).is_edited || (msg as any).payload_raw?.is_edited) && (
                                  <span className="text-[9px] text-[#667781] italic">diedit</span>
                                )}
                                <span>{timeStr}</span>
                                {!isInbound && (
                                  <span title="Terkirim ke WhatsApp">
                                    <CheckCheck size={13} className="text-[#53bdeb]" />
                                  </span>
                                )}

                                {/* Edit message button (for Staff Outbound Messages within 15 mins) */}
                                {isStaff && !media && (msg.created_at ? (Date.now() - new Date(msg.created_at).getTime() <= 15 * 60 * 1000) : false) && (gatewayCapability?.supportsEdit ?? true) && (
                                  <button
                                    onClick={() => handleStartEdit(msg)}
                                    className="opacity-0 group-hover:opacity-100 hover:text-[#008069] transition-opacity p-0.5 ml-1"
                                    title="Edit pesan ini (maksimal 15 menit)"
                                  >
                                    <PenLine size={11} />
                                  </button>
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
                    {/* Invisible Anchor for 100% Reliable Auto-Scroll */}
                    <div ref={messagesEndRef} className="h-0 w-0 pointer-events-none" />
                  </div>

                  {/* WhatsApp Quick Reply Input Bar */}
                  <form
                    onSubmit={handleSendReply}
                    className="bg-[#f0f2f5] border-t border-[#e9edef] p-2.5 sm:p-3 z-10 space-y-2"
                  >
                    {/* Quick Reply Template Chips for Fast Field Messaging */}
                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                      {[
                        { label: '🛵 Sedang OTW', text: 'Halo Bunda, saya sudah dalam perjalanan (OTW) menuju ke lokasi Bunda ya 🙏' },
                        { label: '📍 Sudah Sampai', text: 'Halo Bunda, saya sudah sampai di depan rumah/lokasi Bunda ya 🙏' },
                        { label: '🙏 Selesai', text: 'Terima kasih banyak Bunda atas kepercayaannya. Treatment hari ini telah selesai 🙏' },
                      ].map((chip, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setReplyText(chip.text);
                            if (replyTextareaRef.current) {
                              replyTextareaRef.current.focus();
                              replyTextareaRef.current.style.height = 'auto';
                              setTimeout(() => {
                                if (replyTextareaRef.current) {
                                  replyTextareaRef.current.style.height = `${Math.min(replyTextareaRef.current.scrollHeight, 130)}px`;
                                }
                              }, 0);
                            }
                          }}
                          className="text-[11px] font-medium bg-white hover:bg-[#e8f5f2] text-[#008069] border border-[#00a884]/30 px-2.5 py-1 rounded-full whitespace-nowrap transition-transform duration-150 hover:scale-105 active:scale-95 shadow-2xs flex-shrink-0"
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>

                    {selectedImage && (
                      <div className="flex items-center space-x-2 bg-white border border-[#e9edef] rounded-xl p-2">
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
                    <div className="flex items-end space-x-2">
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
                        className="h-10 w-10 rounded-xl bg-white border border-[#e9edef] text-[#008069] hover:bg-[#e8f5f2] transition shadow-xs flex items-center justify-center flex-shrink-0 disabled:opacity-40 active:scale-95"
                        title="Buka Kamera & Ambil Foto"
                        aria-label="Kamera"
                      >
                        <Camera size={18} />
                      </button>
                      <div className="flex-1 relative">
                        <textarea
                          ref={replyTextareaRef}
                          rows={1}
                          value={replyText}
                          onChange={handleReplyTextChange}
                          placeholder="Ketik pesan balasan... (Enter untuk baris baru)"
                          disabled={sending}
                          style={{ fontSize: '16px' }}
                          className="w-full resize-none bg-white border border-[#e9edef] focus:border-[#008069] focus:ring-1 focus:ring-[#008069] text-[#111b21] rounded-xl px-3.5 py-2 text-[16px] sm:text-sm focus:outline-none placeholder-[#667781] transition-colors disabled:opacity-50 shadow-xs min-h-[40px] max-h-[130px] leading-relaxed block"
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
          /* TAB 2: JADWAL MENDATANG (READ-ONLY, NO CHAT, 1 PAGE) */
          /* ========================================================================= */
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-5xl mx-auto w-full space-y-6 animate-fadeIn">
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
                          {/* Header: Name & Time (KLIK BARIS INI = DETAIL PASIEN) */}
                          <div
                            onClick={() => setDetailModalTask(item)}
                            className="flex items-start justify-between gap-2 p-1 -m-1 rounded-xl hover:bg-[#f0f2f5] transition cursor-pointer group"
                            title="Klik untuk melihat detail lengkap pasien"
                          >
                            <div className="flex items-center space-x-2.5 min-w-0">
                              {/* Service Category Icon */}
                              <div
                                className={`h-10 w-10 rounded-2xl flex items-center justify-center flex-shrink-0 border shadow-xs transition-all group-hover:scale-105 ${catInfo.bg}`}
                              >
                                {catInfo.icon}
                              </div>
                              <div className="min-w-0">
                                <h3 className="font-bold text-sm text-[#111b21] truncate group-hover:text-[#008069] transition">
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
          /* TAB 3: TREATMENT YANG SUDAH DILAKUKAN (SELESAI, 1 PAGE) */
          /* ========================================================================= */
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-5xl mx-auto w-full space-y-6 animate-fadeIn">
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
                          {/* Header: Name & Completed Badge (KLIK BARIS INI = DETAIL PASIEN) */}
                          <div
                            onClick={() => setDetailModalTask(item)}
                            className="flex items-start justify-between gap-2 p-1 -m-1 rounded-xl hover:bg-[#f0f2f5] transition cursor-pointer group"
                            title="Klik untuk melihat detail lengkap pasien"
                          >
                            <div className="flex items-center space-x-2.5 min-w-0">
                              {/* Customer Avatar */}
                              <CustomerAvatar
                                src={item.customerProfilePictureUrl}
                                name={item.customerName}
                                size="md"
                              />
                              <div className="min-w-0">
                                <h3 className="font-bold text-sm text-[#111b21] truncate group-hover:text-[#008069] transition">
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
      {/* ========================================================================= */}
      {/* RIGHT SIDEBAR SLIDE-OVER DRAWER (MENU GARIS TIGA - MAKS 50% LAYAR) */}
      {/* ========================================================================= */}
      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className={`fixed inset-0 z-50 flex justify-end transition-opacity duration-300 ${
          showMenuDrawer ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Backdrop Overlay (Sisa 50% layar kiri transparan/gelap mudah diklik/diswipe) */}
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity duration-300"
          onClick={() => setShowMenuDrawer(false)}
        />

        {/* Drawer Body (Maks 50% layar mobile) */}
        <div
          className={`relative w-[50vw] sm:w-[280px] max-w-[50vw] sm:max-w-[280px] bg-white h-full shadow-2xl flex flex-col z-10 transform transition-transform duration-300 ease-out ${
            showMenuDrawer ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
            {/* Drawer Header */}
            <div className="p-3 bg-[#008069] text-white flex items-center justify-between shadow-xs">
              <div className="flex items-center space-x-2 min-w-0">
                <div className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center text-white border border-white/30 flex-shrink-0">
                  <UserCheck size={16} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-xs truncate">{staff?.name || 'Terapis'}</h3>
                  <p className="text-[10px] text-white/80 truncate">Terapis Homecare</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowMenuDrawer(false)}
                className="h-7 w-7 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all active:scale-95 flex-shrink-0 ml-1"
                title="Tutup Menu (atau Usap ke Kanan)"
              >
                <X size={15} />
              </button>
            </div>

            {/* Navigation Menu List */}
            <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
              <div className="px-1.5 py-0.5 text-[10px] font-bold text-[#667781] uppercase tracking-wider">
                Menu Jadwal
              </div>

              {/* Menu 1: Treatment Hari Ini */}
              <button
                type="button"
                onClick={() => {
                  handleTabChange('today');
                  setShowMenuDrawer(false);
                }}
                className={`w-full flex items-center justify-between p-2 rounded-xl transition-all text-left ${
                  activeTab === 'today'
                    ? 'bg-[#d9fdd3] text-[#008069] font-bold shadow-xs border border-[#00a884]/30'
                    : 'bg-[#f0f2f5] hover:bg-[#e9edef] text-[#111b21]'
                }`}
              >
                <div className="flex items-center space-x-2 min-w-0">
                  <div
                    className={`h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      activeTab === 'today' ? 'bg-[#008069] text-white' : 'bg-white text-[#008069] shadow-xs'
                    }`}
                  >
                    <Calendar size={14} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate">Hari Ini</div>
                    <div className="text-[10px] text-[#667781] font-normal truncate hidden sm:block">
                      Pasien aktif
                    </div>
                  </div>
                </div>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ml-1 ${
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
                  handleTabChange('upcoming');
                  setShowMenuDrawer(false);
                }}
                className={`w-full flex items-center justify-between p-2 rounded-xl transition-all text-left ${
                  activeTab === 'upcoming'
                    ? 'bg-[#d9fdd3] text-[#008069] font-bold shadow-xs border border-[#00a884]/30'
                    : 'bg-[#f0f2f5] hover:bg-[#e9edef] text-[#111b21]'
                }`}
              >
                <div className="flex items-center space-x-2 min-w-0">
                  <div
                    className={`h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      activeTab === 'upcoming' ? 'bg-[#008069] text-white' : 'bg-white text-[#008069] shadow-xs'
                    }`}
                  >
                    <Clock size={14} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate">Mendatang</div>
                    <div className="text-[10px] text-[#667781] font-normal truncate hidden sm:block">
                      Hari esok+
                    </div>
                  </div>
                </div>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ml-1 ${
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
                  handleTabChange('completed');
                  setShowMenuDrawer(false);
                }}
                className={`w-full flex items-center justify-between p-2 rounded-xl transition-all text-left ${
                  activeTab === 'completed'
                    ? 'bg-[#d9fdd3] text-[#008069] font-bold shadow-xs border border-[#00a884]/30'
                    : 'bg-[#f0f2f5] hover:bg-[#e9edef] text-[#111b21]'
                }`}
              >
                <div className="flex items-center space-x-2 min-w-0">
                  <div
                    className={`h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      activeTab === 'completed' ? 'bg-[#008069] text-white' : 'bg-white text-[#008069] shadow-xs'
                    }`}
                  >
                    <CheckCircle2 size={14} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate">Selesai</div>
                    <div className="text-[10px] text-[#667781] font-normal truncate hidden sm:block">
                      Riwayat
                    </div>
                  </div>
                </div>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ml-1 ${
                    activeTab === 'completed' ? 'bg-[#008069] text-white' : 'bg-white text-[#008069] border border-[#e9edef]'
                  }`}
                >
                  {completedTasks.length}
                </span>
              </button>
            </div>

            {/* Drawer Footer Actions */}
            <div className="p-3 border-t border-[#e9edef] bg-[#f0f2f5] space-y-1.5">
              {isSupervisor && (
                <button
                  type="button"
                  onClick={() => {
                    setShowMenuDrawer(false);
                    window.location.href = '/admin/overview';
                  }}
                  className="w-full flex items-center justify-center space-x-1.5 py-2 px-2.5 rounded-xl bg-[#008069] hover:bg-[#00a884] text-[11px] font-bold text-white shadow-xs transition-all active:scale-95"
                >
                  <LayoutDashboard size={13} className="flex-shrink-0" />
                  <span className="truncate">Buka Portal Admin / CS</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setShowMenuDrawer(false);
                  setShowStaffProfileModal(true);
                }}
                className="w-full flex items-center justify-center space-x-1.5 py-2 px-2.5 rounded-xl bg-white hover:bg-[#e9edef] text-[11px] font-semibold text-[#111b21] border border-[#e9edef] shadow-xs transition-all active:scale-95"
              >
                <Info size={13} className="text-[#008069] flex-shrink-0" />
                <span className="truncate">Profil Akun</span>
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
                className="w-full flex items-center justify-center space-x-1.5 py-2 px-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-[11px] font-semibold text-rose-600 border border-rose-200 shadow-xs transition-all active:scale-95"
              >
                <LogOut size={13} className="flex-shrink-0" />
                <span className="truncate">Keluar</span>
              </button>

              {/* Version & Build Timestamp */}
              <div className="pt-1 text-center text-[9px] text-[#8696a0] truncate">
                Staff Portal {APP_VERSION}
              </div>
            </div>
          </div>
        </div>

      {/* ========================================================================= */}
      {/* MODAL / DRAWER PROFIL STAFF & LOGOUT */}
      {/* ========================================================================= */}
      {showStaffProfileModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fadeIn"
          onClick={() => setShowStaffProfileModal(false)}
        >
          <div
            className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl border border-[#e9edef] space-y-5 text-center relative animate-modalScaleUp"
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
                {currentStaff?.name || 'Terapis'}
              </h3>
              <p className="text-xs text-[#667781] font-mono">
                {currentStaff?.phone || 'Akun Sistem'}
              </p>
              <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-[#d9fdd3] text-[#008069] border border-[#00a884]/30 mt-1">
                {isSupervisor ? 'Supervisor CS & Terapis' : 'Staff Terapis Lapangan'}
              </span>
            </div>

            {/* Telegram Dispatch Card */}
            <div className="p-3.5 bg-[#f8fafc] border border-emerald-200 rounded-2xl text-left space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#111b21] flex items-center space-x-1.5">
                  <Send size={13} className="text-[#008069]" />
                  <span>Notifikasi Telegram Tugas</span>
                </span>
                {telegramPairingInfo?.isConnected ? (
                  <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                    <CheckCircle2 size={10} className="text-emerald-600" />
                    <span>Terhubung</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                    <span>Belum Aktif</span>
                  </span>
                )}
              </div>

              <p className="text-[11px] text-[#667781] leading-relaxed">
                Terima rincian jadwal kunjungan pasien, patokan rumah, navigasi Google Maps, dan status bayar langsung di Telegram pribadi Anda.
              </p>

              {loadingTelegramInfo ? (
                <div className="text-[11px] text-[#8696a0] animate-pulse">Memeriksa status Telegram...</div>
              ) : telegramPairingInfo?.isConnected ? (
                <div className="pt-1 flex items-center justify-between text-[11px]">
                  <span className="text-[#54656f] text-[10px] font-mono">ID: {telegramPairingInfo.telegramChatId}</span>
                  <a
                    href={telegramPairingInfo.directLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#008069] hover:underline font-bold text-[11px]"
                  >
                    Buka Bot Telegram &rarr;
                  </a>
                </div>
              ) : (
                <div className="pt-1">
                  <a
                    href={telegramPairingInfo?.directLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-2 px-3 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 shadow-xs"
                  >
                    <Send size={13} />
                    <span>Sambungkan Telegram Saya (1-Klik)</span>
                  </a>
                </div>
              )}
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
            className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl border border-[#e9edef] space-y-4 text-left relative max-h-[90vh] overflow-y-auto animate-modalScaleUp"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-[#e9edef] pb-3">
              <div className="flex items-center space-x-3">
                <CustomerAvatar
                  src={detailModalTask.customerProfilePictureUrl}
                  name={detailModalTask.customerName}
                  size="lg"
                />
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
            className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl border border-[#e9edef] space-y-4 text-left animate-modalScaleUp"
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
            className="bg-white rounded-3xl p-5 sm:p-6 w-full max-w-md shadow-2xl border border-[#e9edef] space-y-4 text-left relative max-h-[92vh] overflow-y-auto animate-modalScaleUp"
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
                    <span>{gpsAttemptInfo || 'Mendeteksi Satelit GPS (Target ≤ 10m)...'}</span>
                  </>
                ) : (
                  <>
                    <Crosshair size={14} />
                    <span>📍 Gunakan Titik GPS HP Saya Sekarang</span>
                  </>
                )}
              </button>

              {locCoords ? (
                <div
                  className={`p-2.5 rounded-xl border text-xs flex items-center justify-between transition ${
                    (locCoords.accuracy ?? 999) <= 10
                      ? 'bg-[#d9fdd3]/70 border-[#00a884]/30 text-[#008069]'
                      : 'bg-amber-50 border-amber-200 text-amber-800'
                  }`}
                >
                  <div>
                    <div className="font-bold flex items-center gap-1">
                      {(locCoords.accuracy ?? 999) <= 10 ? (
                        <>
                          <CheckCircle2 size={13} className="text-[#008069]" />
                          <span>GPS Sangat Akurat (≤10m)</span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle size={13} className="text-amber-600" />
                          <span>Akurasi Cukup (±{locCoords.accuracy}m)</span>
                        </>
                      )}
                    </div>
                    <div className="font-mono text-[11px] text-[#54656f] mt-0.5">
                      {locCoords.lat.toFixed(6)}, {locCoords.lng.toFixed(6)}
                      {locCoords.accuracy ? ` (Akurasi: ±${locCoords.accuracy}m)` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleGetCurrentGps}
                      disabled={locGettingGps}
                      className="p-1.5 rounded-lg bg-white border border-[#e9edef] hover:bg-[#f0f2f5] text-[#54656f] text-[11px] font-semibold flex items-center gap-1 shadow-xs"
                      title="Kunci Ulang GPS"
                    >
                      <RefreshCw size={11} className={locGettingGps ? 'animate-spin' : ''} />
                      <span>Ulang</span>
                    </button>
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
                </div>
              ) : (
                <p className="text-[11px] text-[#8696a0] italic">
                  * Berdirilah di luar pagar/depan rumah pasien lalu tekan tombol GPS di atas (target akurasi ≤ 10m).
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

      {/* ========================================================================= */}
      {/* MODAL EDIT PESAN WHATSAPP */}
      {/* ========================================================================= */}
      {editingMsg && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-[#e9edef] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center px-5 py-3.5 border-b border-[#e9edef] bg-[#f8fafc]">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 rounded-lg bg-[#e8f5f2] text-[#008069]">
                  <PenLine size={16} />
                </div>
                <h3 className="text-sm font-bold text-[#111b21]">Edit Pesan WhatsApp</h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingMsg(null)}
                disabled={isEditingSaving}
                className="p-1.5 rounded-lg text-[#8696a0] hover:text-[#111b21] hover:bg-[#e9edef] transition text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-3.5">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-800 space-y-1">
                <p className="font-bold flex items-center gap-1.5">
                  <Info size={13} className="text-amber-600 shrink-0" />
                  Batas Waktu Edit WhatsApp: 15 Menit
                </p>
                <p className="text-amber-700 leading-relaxed">
                  WhatsApp hanya mengizinkan pengeditan pesan dalam 15 menit pertama. Pesan yang diedit akan otomatis memiliki label <i>(Diedit)</i> di HP penerima.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[11px] font-bold text-[#111b21]">Isi Pesan Baru</label>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={4}
                  placeholder="Ketik perbaikan teks pesan..."
                  className="w-full bg-white border border-[#d1d7db] rounded-xl p-3 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] transition shadow-xs leading-relaxed"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-[#e9edef]">
                <button
                  type="button"
                  onClick={() => setEditingMsg(null)}
                  disabled={isEditingSaving}
                  className="px-4 py-2 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#111b21] rounded-xl text-xs font-semibold transition"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={isEditingSaving || !editContent.trim()}
                  className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-xs"
                >
                  {isEditingSaving ? (
                    <>
                      <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span>Menyimpan...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={14} />
                      <span>Simpan Perubahan</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL DELEGASI JADWAL TERAPIS (KHUSUS SUPERVISOR / SPV CS) */}
      {/* ========================================================================= */}
      {reassignModalTask && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-fadeIn"
          onClick={() => setReassignModalTask(null)}
        >
          <div
            className="bg-white border border-[#e9edef] rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden animate-scaleUp"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center px-4 py-3.5 border-b border-[#e9edef] bg-[#f8fafc]">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 rounded-lg bg-purple-50 text-purple-700">
                  <ArrowRightLeft size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#111b21]">Delegasikan Jadwal</h3>
                  <p className="text-[10px] text-[#667781] truncate max-w-[200px]">
                    Pasien: {reassignModalTask.customerName || 'Bunda'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReassignModalTask(null)}
                disabled={submittingReassign}
                className="p-1.5 rounded-lg text-[#8696a0] hover:text-[#111b21] hover:bg-[#e9edef] transition text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-3.5">
              <div className="p-2.5 bg-[#f0f2f5] rounded-xl text-xs space-y-1">
                <p className="text-[11px] text-[#667781]">
                  Treatment: <span className="font-semibold text-[#111b21]">{reassignModalTask.treatmentDetail || 'Spa Homecare'}</span>
                </p>
                <p className="text-[11px] text-[#667781]">
                  Terapis Saat Ini: <span className="font-bold text-purple-700">{reassignModalTask.assignedStaff?.name || 'Belum Ditugaskan'}</span>
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-[#111b21]">Pilih Terapis Pengganti / Baru:</label>
                <select
                  value={reassignSelectedStaffId}
                  onChange={(e) => setReassignSelectedStaffId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-[#f0f2f5] border-0 text-xs font-semibold text-[#111b21] focus:outline-none focus:ring-2 focus:ring-[#008069]"
                >
                  <option value="" disabled>-- Pilih Terapis Tim --</option>
                  {teamMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.role || 'Staff'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-[#e9edef]">
                <button
                  type="button"
                  onClick={() => setReassignModalTask(null)}
                  disabled={submittingReassign}
                  className="px-4 py-2 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#111b21] rounded-xl text-xs font-semibold transition"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={submittingReassign || !reassignSelectedStaffId}
                  onClick={async () => {
                    setSubmittingReassign(true);
                    try {
                      const res = await apiRequest(`/api/staff/reservations/${reassignModalTask.reservationId}/reassign`, {
                        method: 'POST',
                        body: JSON.stringify({ targetStaffId: reassignSelectedStaffId }),
                      });
                      if (res.success) {
                        toast('Tugas berhasil didelegasikan ke terapis baru.', 'success');
                        setReassignModalTask(null);
                        fetchTasks(false);
                      } else {
                        toast(res.error || 'Gagal mendelegasikan tugas.', 'error');
                      }
                    } catch (err: any) {
                      toast(err.message || 'Gagal mendelegasikan tugas.', 'error');
                    } finally {
                      setSubmittingReassign(false);
                    }
                  }}
                  className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-xs"
                >
                  {submittingReassign ? (
                    <>
                      <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span>Menyimpan...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={14} />
                      <span>Simpan Delegasi</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
