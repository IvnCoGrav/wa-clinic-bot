import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { apiRequest } from '../../services/api';
import { useStaffAuth } from '../../contexts/StaffAuthContext';
import { useAuth } from '../../contexts/AuthContext';
import { useUiFeedback } from '../../components/common/UiFeedback';
import { Modal } from '../../components/ui/Modal';
import {
  MessageSquare,
  AlertTriangle,
  Clock,
  Send,
  Bot,
  User,
  Calendar,
  LogOut,
  ChevronLeft,
  RefreshCw,
  CheckCircle2,
  Navigation,
  Search,
  X,
  UserCheck,
  Info,
  Menu,
  Camera,
  PenLine,
  LayoutDashboard,
  ArrowRightLeft,
  WifiOff,
  Bell,
  BellRing,
  Copy,
  Home,
} from 'lucide-react';
import {
  extractMedia,
  maskPhoneInTextClient,
} from '../../utils/mediaExtractor';
import { emitBootPhase } from '../../lib/bootProgress';
import { fireAndForget, mustSucceed } from '../../services/errorPolicy';
import { APP_VERSION, BUILD_TIME } from '../../config/version';
import { compressImageFile, compressDataUrl, resolveCompressProfile } from '../../utils/imageCompressor';
import { stampGpsWatermark } from '../../utils/imageWatermark';
import { ThemeToggle } from '../../components/common/ThemeToggle';
import { useTripTelemetry } from '../../hooks/useTripTelemetry';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '../../components/common/PullToRefreshIndicator';
import {
  calculateHaversineKm,
  estimateTravelMinutesKm,
  getOtwGate,
  isWithinGpsWarmupWindow,
  formatWibClock,
  needsNavigationPreflight,
  startDepartGpsWarmup,
  stopDepartGpsWarmup,
  getDepartPositionFast,
} from '../../utils/geoUtils';
import { NavigationPreflightModal } from '../../components/staff/NavigationPreflightModal';
import { OtwConfirmModal } from '../../components/staff/OtwConfirmModal';
import { needsHousePhoto, resolveLocModalMode } from './housePhotoGuard';
import { StaffTask } from './staffTaskTypes';
import { DetailImageKind, StaffTaskDetailModal } from './StaffTaskDetailModal';
import { PaymentMethod, StaffPaymentModal } from './StaffPaymentModal';
import { StaffLocationModal } from './StaffLocationModal';
import { ChatMessage } from './staffChatTypes';
import {
  chatLockedTitle,
  formatTaskTime as formatTime,
  isChatWindowOpen,
  isOtwAllowed,
  isScheduleOngoing,
  isScheduleOverdue,
  isTimeForArrival,
  isTrulyCompleted,
} from './staffTaskLogic';
import { StaffTodayTaskCard } from './StaffTodayTaskCard';
import { StaffChatHeader } from './StaffChatHeader';
import { StaffChatComposer } from './StaffChatComposer';
import { StaffChatThread } from './StaffChatThread';
import { useStaffChatScroll } from './useStaffChatScroll';
import { useStaffMessages } from './useStaffMessages';
import { useStaffFailedOutbox } from './useStaffFailedOutbox';
import { useStaffChatSend } from './useStaffChatSend';
import { filterTasksByQuery, groupTasksByDate } from './staffTaskGrouping';
import { StaffUpcomingCard } from './StaffUpcomingCard';
import { StaffCompletedCard } from './StaffCompletedCard';

// extractMedia terpusat di utils/mediaExtractor.ts (single source of truth).
import { playIncomingMessageSound, initAudioUnlock, showSafeNotification } from '../../services/notificationSound';
import { subscribeToPushNotifications } from '../../services/pushNotification';
import { formatRupiah } from '../../utils/money';

interface StaffTodayProps {
  defaultTab?: 'today' | 'upcoming' | 'completed';
}

export const StaffToday: React.FC<StaffTodayProps> = ({ defaultTab }) => {
  const { staff, logout: staffLogout } = useStaffAuth();
  const { user, logout: adminLogout } = useAuth();
  const { toast, confirm } = useUiFeedback();
  // DEPRECATED (plan 2026-09-30): `startTelemetry`/`telemetryStatus` tidak lagi dipakai
  // (tracking kontinu dihentikan). `stopTelemetry` disisakan untuk mematikan sesi lama
  // (mis. saat kunjungan selesai) agar mesin idle tetap bersih.
  const { stopTelemetry } = useTripTelemetry();

  const logout = staff ? staffLogout : adminLogout;
  const currentStaff = staff || (user ? { id: user.id, name: user.name, role: user.role, phone: user.phone } : null);
  
  // Navigation Tabs: 'today' (Hari Ini & Live Chat) vs 'upcoming' (Jadwal Mendatang) vs 'completed' (Treatment Selesai)
  const [activeTab, setActiveTab] = useState<'today' | 'upcoming' | 'completed'>(() => {
    if (defaultTab) return defaultTab;
    try {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab');
      if (tabParam === 'upcoming' || tabParam === 'completed' || tabParam === 'today') {
        return tabParam;
      }
    } catch {
      // Fallback safe
    }
    return 'today';
  });
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
  const [sseConnected, setSseConnected] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean>(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
  const [sendingOtwId, setSendingOtwId] = useState<string | null>(null);
  const [sendingArrivalId, setSendingArrivalId] = useState<string | null>(null);
  const [completingVisitId, setCompletingVisitId] = useState<string | null>(null);
  const [todayFilter, setTodayFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const [paymentInfo, setPaymentInfo] = useState<{
    qrisImageUrl: string | null;
    bankAccounts: Array<{ bank: string; accountNumber: string; accountName: string }>;
    instructions?: string;
  } | null>(null);
  const [loadingPaymentInfo, setLoadingPaymentInfo] = useState(false);
  const [qrisZoomModal, setQrisZoomModal] = useState(false);
  const paymentInfoRef = useRef<{
    qrisImageUrl: string | null;
    bankAccounts: Array<{ bank: string; accountNumber: string; accountName: string }>;
    instructions?: string;
  } | null>(null);
  const [editingMsg, setEditingMsg] = useState<{ id: string; content: string } | null>(null);
  const [editContent, setEditContent] = useState('');
  const [isEditingSaving, setIsEditingSaving] = useState(false);
  const [isSendingPaymentInfo, setIsSendingPaymentInfo] = useState(false);

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
  // Hanya benih metode awal untuk form; pilihan metode sesudahnya dipegang modal.
  const [paymentInitialMethod, setPaymentInitialMethod] = useState<PaymentMethod>('CASH');
  const [submittingPayment, setSubmittingPayment] = useState(false);

  // Update Location & House Photo Modal State
  const [updateLocationModalTask, setUpdateLocationModalTask] = useState<StaffTask | null>(null);
  const [locModalMode, setLocModalMode] = useState<'view' | 'edit'>('view');
  const [hasSavedLocData, setHasSavedLocData] = useState(false);
  const [locCoords, setLocCoords] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [locHousePhotoB64, setLocHousePhotoB64] = useState<string | null>(null);
  const [locRawHousePhotoB64, setLocRawHousePhotoB64] = useState<string | null>(null);
  const [locLandmark, setLocLandmark] = useState<string>('');
  const [locGettingGps, setLocGettingGps] = useState(false);
  const [gpsAttemptInfo, setGpsAttemptInfo] = useState<string | null>(null);
  const [submittingLoc, setSubmittingLoc] = useState(false);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);
  const [zoomImageKind, setZoomImageKind] = useState<'proof' | 'house' | null>(null);
  const [otwModal, setOtwModal] = useState<{
    task: StaffTask;
    navUrl: string | null;
    draft: string;
  } | null>(null);
  const [preflightTask, setPreflightTask] = useState<StaffTask | null>(null);
  const [locProcessingPhoto, setLocProcessingPhoto] = useState(false);

  // Gateway capability (WAHA supportsRevoke=true, supportsEdit=true vs WABA supportsRevoke=false)
  const [gatewayCapability, setGatewayCapability] = useState<{ provider: string; supportsRevoke: boolean; supportsEdit?: boolean } | null>(null);
  const [quickReplyTemplates, setQuickReplyTemplates] = useState<Array<{ shortcut: string; title: string; content: string; category?: string | null }>>([]);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // Fase 1.2: outbox pesan gagal dikelola hook useStaffFailedOutbox.

  const selectedTaskRef = useRef<StaffTask | null>(null);
  const allTasksRef = useRef<StaffTask[]>([]);
  const knownTaskIdsRef = useRef<Set<string> | null>(null);
  const prevScopeRef = useRef<string>(scopeFilter);
  const { chatContainerRef, messagesEndRef, isNearBottomRef, handleChatScroll, scrollToBottom } = useStaffChatScroll();
  // Fase 0.1/0.4: status SSE terbaru dibaca dari ref (interval/effect mount-once)
  // + Last-Event-ID untuk mendeteksi gap saat tab tidur lalu bangun.
  const sseConnectedRef = useRef(false);
  const sseReconnectRef = useRef<(() => void) | null>(null);
  const lastEventIdRef = useRef<string | null>(null);
  const refreshActiveChatRef = useRef<((opts?: { keepScroll?: boolean }) => void) | null>(null);
  const chatPollInFlightRef = useRef(false);
  const lastInboundAtRef = useRef<number>(0);
  const markConversationReadRef = useRef<((conversationId: string) => void) | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const chatGalleryInputRef = useRef<HTMLInputElement>(null);
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const currentStaffRef = useRef(currentStaff);
  const isSupervisorRef = useRef(isSupervisor);
  const fetchTasksRef = useRef<((isPolling?: boolean, currentScope?: 'mine' | 'all') => Promise<void>) | null>(null);

  currentStaffRef.current = currentStaff;
  isSupervisorRef.current = isSupervisor;

  const {
    messages,
    setMessages,
    loadingMessages,
    setLoadingMessages,
    errorMessage,
    setErrorMessage,
    fetchMessages,
  } = useStaffMessages({ isSupervisorRef, isNearBottomRef, scrollToBottom });
  const { failedMessages, setFailedMessages, retryingTempId, retryFailedMessage, persistFailedMessages } =
    useStaffFailedOutbox({ setMessages, toast });
  const {
    replyText,
    setReplyText,
    selectedImage,
    setSelectedImage,
    sending,
    handleReplyTextChange,
    handlePickImage,
    handleSendReply,
  } = useStaffChatSend({
    selectedTask,
    staffName: staff?.name,
    isOnline,
    setMessages,
    setErrorMessage,
    setFailedMessages,
    persistFailedMessages,
    replyTextareaRef,
    chatFileInputRef,
    chatGalleryInputRef,
    isNearBottomRef,
    scrollToBottom,
    toast,
  });

  selectedTaskRef.current = selectedTask;
  allTasksRef.current = [...tasks, ...upcomingTasks, ...completedTasks];

  // Tandai boot progress: halaman portal staff sudah tampil
  useEffect(() => {
    emitBootPhase('mount');
  }, []);

  // Indikator ketahanan jaringan (offline di lapangan)
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const [pushStatus, setPushStatus] = useState<'granted' | 'default' | 'denied' | 'unsupported'>('default');
  const [pushSyncing, setPushSyncing] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPushStatus('unsupported');
    } else {
      setPushStatus(Notification.permission);
    }
  }, []);

  const handleSyncPush = async () => {
    if (!currentStaff?.id) {
      toast('Sesi staf belum siap. Coba muat ulang halaman.', 'error');
      return;
    }
    // Fase 0.3: izin harus diminta dari gesture pengguna (bukan auto-load). Bila
    // sudah 'denied', browser memblokir prompt → arahkan buka pengaturan situs.
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'denied') {
        toast(
          'Izin notifikasi diblokir. Buka pengaturan situs di browser → ubah "Notifikasi" menjadi Izinkan, lalu muat ulang.',
          'error'
        );
        setPushStatus('denied');
        return;
      }
      if (Notification.permission === 'default') {
        try {
          const p = await Notification.requestPermission();
          setPushStatus(p);
          if (p !== 'granted') {
            toast('Izin notifikasi belum diberikan. Aktifkan untuk menerima getar pesan pasien.', 'error');
            return;
          }
        } catch {
          /* lanjut coba subscribe */
        }
      }
    }
    setPushSyncing(true);
    try {
      playIncomingMessageSound(true);
      const res = await subscribeToPushNotifications('STAFF', currentStaff.id);
      if (res.success) {
        setPushStatus('granted');
        toast('Notifikasi perangkat berhasil diaktifkan & disinkronkan!', 'success');
        showSafeNotification('🔔 Notifikasi Perangkat Aktif', {
          body: `Perangkat ${currentStaff.name || 'Bidan'} siap menerima notifikasi tugas kunjungan.`,
          icon: '/admin/pwa-192x192.png',
          tag: 'push_activated',
        });
      } else {
        toast(`${res.error || 'Gagal mengaktifkan notifikasi. Periksa izin di browser.'}`, 'error');
      }
    } catch (err: any) {
      toast(`Gagal: ${err.message}`, 'error');
    } finally {
      setPushSyncing(false);
    }
  };

  // Fase 0.3: JANGAN minta izin notifikasi otomatis di load (browser modern menolak
  // prompt tanpa gesture). Cukup baca status + unlock audio + load gateway capability.
  // Permintaan izin dilakukan lewat tombol "Aktifkan Notifikasi" (gesture pengguna).
  useEffect(() => {
    const cleanupAudio = initAudioUnlock();
    // Keduanya pelengkap tampilan: gagal tidak boleh menghalangi tugas hari ini.
    fireAndForget(
      apiRequest('/api/staff/gateway-capability').then((res) => {
        if (res?.success && res.data) setGatewayCapability(res.data);
      }),
      'muat kapabilitas gateway'
    );
    // Template permintaan titik presisi WAJIB dari DB (bukan hardcode).
    fireAndForget(
      apiRequest('/api/staff/quick-replies').then((res) => {
        if (res?.success && Array.isArray(res.data)) setQuickReplyTemplates(res.data);
      }),
      'muat template quick reply'
    );
    return cleanupAudio;
  }, []);

  // Muat info pembayaran (QRIS & rekening) data-driven. Dipakai modal pembayaran
  // DAN tombol 1-tap QRIS di kartu depan (Fase 3.3), dengan cache ref anti-fetch ganda.
  const ensurePaymentInfo = useCallback(async () => {
    if (paymentInfoRef.current) return paymentInfoRef.current;
    setLoadingPaymentInfo(true);
    try {
      const res = await apiRequest('/api/staff/payment-info');
      if (res && res.success && res.data) {
        paymentInfoRef.current = res.data;
        setPaymentInfo(res.data);
        return res.data;
      }
    } catch (err) {
      console.warn('[STAFF] Failed to load payment info:', err);
    } finally {
      setLoadingPaymentInfo(false);
    }
    return null;
  }, []);

  // Load payment info (QRIS & Bank Accounts) from data-driven endpoint when payment modal opens
  useEffect(() => {
    if (paymentModalTask) {
      // Info pembayaran wajib terlihat bila gagal: staf tidak boleh mengira
      // nominal/QRIS sudah termuat padahal request-nya gagal. Pesan sudah
      // ditampilkan mustSucceed; catch di sini hanya mencegah unhandled rejection.
      void mustSucceed(() => ensurePaymentInfo(), 'Memuat info pembayaran').catch(() => {});
    }
  }, [paymentModalTask, ensurePaymentInfo]);

  // Daftarkan PWA Web Push Subscription untuk Staff / Terapis jika izin sudah granted
  useEffect(() => {
    if (currentStaff?.id && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      subscribeToPushNotifications('STAFF', currentStaff.id).catch((err) => {
        console.warn('[StaffToday] Web Push auto-subscribe failed:', err);
      });
    }
  }, [currentStaff?.id]);

  // Fetch today tasks, upcoming schedule, and completed tasks
  const fetchTasks = useCallback(
    async (isPolling = false, currentScope?: 'mine' | 'all') => {
      if (!isPolling) setLoading(true);
      const scopeToUse = currentScope || scopeFilter;
      if (prevScopeRef.current !== scopeToUse) {
        knownTaskIdsRef.current = null;
        prevScopeRef.current = scopeToUse;
      }
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

        // Deteksi tugas baru (today + upcoming) untuk alert real-time — hanya saat polling berikutnya, bukan load awal
        try {
          const todayList: StaffTask[] = todayRes.success && Array.isArray(todayRes.data) ? todayRes.data : [];
          const upcomingList: StaffTask[] = upcomingRes.success && Array.isArray(upcomingRes.data) ? upcomingRes.data : [];
          const combined: StaffTask[] = [...todayList, ...upcomingList];
          if (knownTaskIdsRef.current !== null && combined.length > 0) {
            const prevIds = knownTaskIdsRef.current;
            const newAssignedTasks = combined.filter((t: StaffTask) => !prevIds.has(t.reservationId));
            if (newAssignedTasks.length > 0) {
              // Suara notifikasi opsional (browser bisa memblokir audio).
              try { playIncomingMessageSound(true); } catch (_) {}
              const first = newAssignedTasks[0];
              const timeLabel = formatTime(first.bookingDate);
              const extra = newAssignedTasks.length > 1 ? ' +' + (newAssignedTasks.length - 1) + ' lainnya' : '';
              toast(`Tugas Baru Ditugaskan: ${first.customerName || 'Bunda'} (${timeLabel})${extra}`, 'success');
              try {
                if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
                  showSafeNotification('Tugas Baru Ditugaskan!', {
                    body: `${first.customerName || 'Bunda'} - ${first.treatmentDetail || 'Treatment'} pukul ${timeLabel}`,
                    icon: '/admin/pwa-192x192.png',
                    tag: `new_task_${first.reservationId}`,
                  }, () => {
                    // Fokus jendela bisa ditolak browser; tidak memengaruhi aksi.
                    try { window.focus(); } catch (_) {}
                    const match = combined.find((t) => t.reservationId === first.reservationId) || first;
                    setSelectedTask(match as StaffTask);
                  });
                }
              } catch (_) {
                // Notifikasi sistem opsional; toast in-app di atas sudah tampil.
              }
            }
          }
          if (todayRes.success && upcomingRes.success) {
            const todayList2: StaffTask[] = Array.isArray(todayRes.data) ? todayRes.data : [];
            const upcomingList2: StaffTask[] = Array.isArray(upcomingRes.data) ? upcomingRes.data : [];
            knownTaskIdsRef.current = new Set([...todayList2, ...upcomingList2].map((t: StaffTask) => t.reservationId));
          }
        } catch (_) {
          // Deteksi tugas baru bersifat tambahan; kegagalan tidak membatalkan muat jadwal.
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

  fetchTasksRef.current = fetchTasks;

  // Load team members for supervisor delegation dropdown
  useEffect(() => {
    if (isSupervisor) {
      // Daftar tim hanya untuk filter; kegagalan tidak memblokir jadwal.
      fireAndForget(
        apiRequest('/api/staff/team-members').then((res) => {
          if (res?.success && Array.isArray(res.data)) {
            setTeamMembers(res.data);
          }
        }),
        'muat anggota tim'
      );
    }
  }, [isSupervisor]);

  // Auto-poll tasks every 20s (Fase 0.1: skip saat tab tersembunyi → hemat baterai/kuota
  // di lapangan; debt lama "polling 20s di background" ditutup).
  useEffect(() => {
    fetchTasks();
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      fetchTasks(true);
    }, 20000);
    return () => {
      clearInterval(interval);
    };
  }, [fetchTasks]);

  // Fase 0.1: Zero-Loss Resume — saat tab kembali terlihat / window fokus:
  //  - muat ulang daftar tugas,
  //  - muat ulang isi chat yang sedang dibuka (silent, tanpa sentak scroll),
  //  - reconnect SSE segera bila terputus (tanpa tunggu backoff 4 dtk),
  //  - tandai dibaca (presence).
  useEffect(() => {
    const resume = () => {
      if (document.visibilityState !== 'visible') return;
      fetchTasksRef.current?.(true);
      if (selectedTaskRef.current?.conversationId) {
        refreshActiveChatRef.current?.({ keepScroll: true });
      }
      if (!sseConnectedRef.current) {
        sseReconnectRef.current?.();
      }
    };
    const onFocus = () => resume();
    const onVisible = () => {
      if (document.visibilityState === 'visible') resume();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
    };
  }, []);

  // Fase 1.1: jaring pengaman polling aktif HANYA saat chat terbuka & SSE tidak sehat.
  // Interval 5 dtk, 30 pesan terakhir, rekonsiliasi idempoten. Saat SSE hidup → 0 request.
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const convId = selectedTaskRef.current?.conversationId;
      if (!convId) return;
      const sseSehat = sseConnectedRef.current && isOnline && Date.now() - lastInboundAtRef.current < 20000;
      if (sseSehat) return;
      if (chatPollInFlightRef.current) return;
      chatPollInFlightRef.current = true;
      refreshActiveChatRef.current?.({ keepScroll: true });
      setTimeout(() => {
        chatPollInFlightRef.current = false;
      }, 1500);
    }, 5000);
    return () => clearInterval(interval);
  }, [isOnline]);

  // DEPRECATED (plan 2026-09-30, NAVIGASI_DEPART_CONTROL_REVISI_PLAN): tracking GPS
  // kontinu (auto-start H-30, pemancar `useTripTelemetry`) DIHENTIKAN — tidak andal di
  // PWA karena OS membekukan browser saat Bidan pindah ke aplikasi Google Maps.
  // Pengganti: kontrol keberangkatan via tombol "Navigasi" (GPS sekali-tembak + status
  // "dalam perjalanan" + ETA). Mesin telemetry (hook + endpoint backend) DIPERTAHANKAN
  // utuh untuk aplikasi native kelak, namun TIDAK ada lagi pemicu otomatis di sini.

  // Pre-warm GPS (plan 2026-10-04, Silent Depart-Capture): panaskan cache lokasi
  // SAAT ada tugas dalam jendela keberangkatan, sehingga klik "Navigasi" memakai
  // posisi segar (0 dtk) — bukan tembakan GPS dingin yang sering time-out ketika
  // prompt izin tertinggal di tab background. Silent total; dilepas saat tak ada
  // tugas dalam window / unmount (privasi).
  const hasDepartWindowTask = useMemo(
    () => [...tasks, ...upcomingTasks].some((t) => isWithinGpsWarmupWindow(t.bookingDate)),
    [tasks, upcomingTasks]
  );
  // S-06: warm-up GPS TIDAK boleh berjalan diam-diam. Wajib consent eksplisit
  // per perangkat; tanpa izin, tombol Navigasi tetap memakai GPS sekali-tembak.
  const [gpsWarmupConsent, setGpsWarmupConsent] = useState<'granted' | 'denied' | null>(() => {
    try {
      const v = localStorage.getItem('staff_gps_warmup_consent_v1');
      return v === 'granted' || v === 'denied' ? v : null;
    } catch {
      return null;
    }
  });
  const decideGpsWarmup = (decision: 'granted' | 'denied') => {
    try {
      localStorage.setItem('staff_gps_warmup_consent_v1', decision);
    } catch {
      /* storage diblokir: keputusan berlaku untuk sesi ini */
    }
    setGpsWarmupConsent(decision);
  };
  useEffect(() => {
    if (hasDepartWindowTask && gpsWarmupConsent === 'granted') startDepartGpsWarmup();
    else stopDepartGpsWarmup();
    return () => stopDepartGpsWarmup();
  }, [hasDepartWindowTask, gpsWarmupConsent]);


  // Fase 0.2: tandai percakapan dibaca saat dibuka (badge padam + sumber presence untuk
  // gerbang notifikasi berbasis "dibuka 1 menit terakhir"). Fire-and-forget.
  const markConversationRead = useCallback((conversationId: string) => {
    if (!conversationId) return;
    // Sengaja opsional: badge cukup padam saat request berhasil. Kegagalan tidak
    // perlu mengganggu terapis yang sedang melayani pasien.
    fireAndForget(
      apiRequest(`/api/staff/conversations/${conversationId}/read`, { method: 'PATCH' }),
      'tandai percakapan dibaca'
    );
  }, []);
  markConversationReadRef.current = markConversationRead;

  // Load conversation when task is selected
  useEffect(() => {
    if (replyTextareaRef.current) {
      replyTextareaRef.current.style.height = 'auto';
    }
    if (selectedTask?.conversationId) {
      fetchMessages(selectedTask.conversationId);
      markConversationRead(selectedTask.conversationId);
    } else {
      setMessages([]);
    }
  }, [selectedTask?.conversationId, fetchMessages, markConversationRead]);

  // Fase 0.1: ekspos refresh chat aktif ke effect mount-once (visibility/polling).
  refreshActiveChatRef.current = (opts?: { keepScroll?: boolean }) => {
    const convId = selectedTaskRef.current?.conversationId;
    if (!convId) return;
    if (!opts?.keepScroll) isNearBottomRef.current = true;
    fetchMessages(convId, { silent: true });
    if (document.visibilityState === 'visible') markConversationRead(convId);
  };

  // Auto scroll chat when messages update or loading completes
  useEffect(() => {
    if (!loadingMessages && messages.length > 0) {
      scrollToBottom(false);
    }
  }, [messages, loadingMessages, scrollToBottom]);

  // Open Chat with history push for Android/iOS Hardware Back Button
  const handleOpenChat = (task: StaffTask) => {
    setActiveTab('today');
    setSelectedTask(task);
    setMobileView('chat');
    window.history.pushState({ view: 'chat', taskId: task.reservationId }, '');
    isNearBottomRef.current = true;
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

    // Abaikan gestur lambat (> 650ms), drag pendek, atau scroll dominan vertikal.
    // Rasio horizontal diperketat (1.8x) agar scroll diagonal jempol tidak salah
    // ganti tab. Ambang khusus pergantian TAB dinaikkan ke 60px (edge-swipe drawer
    // tetap 35px karena dimulai dari tepi kanan layar).
    if (deltaTime > 650 || Math.abs(deltaX) < 35 || Math.abs(deltaX) < Math.abs(deltaY) * 1.8) {
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

    // Ambang khusus pergantian TAB (lebih ketat dari edge-swipe/drawer).
    const TAB_SWIPE_MIN = 60;
    const tabSwipeEngaged = Math.abs(deltaX) >= TAB_SWIPE_MIN;

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
      if (deltaX > TAB_SWIPE_MIN) {
        handleBackToList();
      }
      return;
    }

    // Case 2: In tab list view -> swipe left/right switches tabs with directional sliding animation
    if (mobileView === 'list' && tabSwipeEngaged) {
      const tabs: Array<'today' | 'upcoming' | 'completed'> = ['today', 'upcoming', 'completed'];
      const currentIndex = tabs.indexOf(activeTab);

      if (deltaX < -TAB_SWIPE_MIN && currentIndex < tabs.length - 1) {
        // Swipe Left -> next tab (content slides from right)
        handleTabChange(tabs[currentIndex + 1]);
      } else if (deltaX > TAB_SWIPE_MIN && currentIndex > 0) {
        // Swipe Right -> previous tab (content slides from left)
        handleTabChange(tabs[currentIndex - 1]);
      }
    }
  };

  // Popstate event listener for hardware / browser back button
  useEffect(() => {
    const handlePopState = () => {
      if (qrisZoomModal) {
        setQrisZoomModal(false);
        return;
      }
      if (otwModal) {
        setOtwModal(null);
        return;
      }
      if (preflightTask) {
        setPreflightTask(null);
        return;
      }
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
        setZoomImageKind(null);
        return;
      }
      if (mobileView === 'chat') {
        setMobileView('list');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [mobileView, detailModalTask, paymentModalTask, updateLocationModalTask, showStaffProfileModal, showMenuDrawer, zoomImageUrl, qrisZoomModal, otwModal, preflightTask]);

  // Fetch Staff Telegram Pairing Status on Profile Modal Open
  useEffect(() => {
    if (showStaffProfileModal) {
      setLoadingTelegramInfo(true);
      // Status pairing hanya informasi profil; spinner tetap harus berhenti.
      fireAndForget(
        apiRequest<{ success: boolean; data: any }>('/api/staff/me/telegram-pairing')
          .then((res) => {
            if (res.success && res.data) {
              setTelegramPairingInfo(res.data);
            }
          })
          .finally(() => setLoadingTelegramInfo(false)),
        'muat status Telegram'
      );
    }
  }, [showStaffProfileModal]);

  // Connect SSE for realtime live chat messages
  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimeout: any = null;

    const handleGap = (event: MessageEvent) => {
      // Fase 0.4: id monotonik proses-wide. Bila lompat → ada event terlewat
      // (tab tidur lalu bangun). Rekonsiliasi deterministik via fetchMessages.
      try {
        const idNum = Number((event as any).lastEventId);
        const prev = lastEventIdRef.current ? Number(lastEventIdRef.current) : null;
        if (Number.isFinite(idNum)) {
          if (prev != null && Number.isFinite(prev) && idNum > prev + 1) {
            refreshActiveChatRef.current?.({ keepScroll: true });
          }
          lastEventIdRef.current = String(idNum);
        }
      } catch {
        /* abaikan */
      }
    };

    const connectSSE = () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
      try {
        if (es) es.close();
      } catch {
        /* abaikan */
      }
      es = new EventSource('/api/staff/live-chat/events');

      es.onopen = () => {
        sseConnectedRef.current = true;
        setSseConnected(true);
        // Setelah reconnect, tarik pesan yang mungkin terlewat selagi offline.
        refreshActiveChatRef.current?.({ keepScroll: true });
      };

      es.addEventListener('message.created', (event) => {
        try {
          handleGap(event as MessageEvent);
          const payload = JSON.parse((event as MessageEvent).data);
          const convId = payload.conversationId || payload.conversation_id;
          const incomingHidden = !!((payload as any).isMessageHidden || (payload as any).payload_raw?.is_hidden);
          if (incomingHidden && !isSupervisorRef.current) {
            // Pesan hidden: jangan tampilkan ke terapis; pastikan tidak ada di state.
            const hid = String(payload.messageId || payload.id || '');
            const hwa = (payload as any).waMessageId || (payload as any).wa_message_id;
            if (selectedTaskRef.current?.conversationId === convId) {
              setMessages((prev) => prev.filter((m) => m.id !== hid && (m as any).wa_message_id !== hwa));
            }
            return;
          }
          const shouldMask = !isSupervisorRef.current;
          const maskP = (s: string): string => (shouldMask ? maskPhoneInTextClient(s) : s);
          const msg: ChatMessage = {
            id: maskP(String(payload.messageId || payload.id || `sse_${Date.now()}`)),
            direction: payload.direction,
            content: maskP(payload.content || ''),
            sender_type: payload.senderType || payload.sender_type || null,
            sender_name: payload.senderName || payload.sender_name ? maskP(String(payload.senderName || payload.sender_name)) : null,
            created_at: payload.createdAt || payload.created_at || new Date().toISOString(),
            media: (() => {
              const m = extractMedia(payload);
              if (m && typeof (m as any).caption === 'string') (m as any).caption = maskP((m as any).caption);
              return m;
            })(),
            delivery_status: payload.delivery_status || payload.deliveryStatus || null,
            delivered_at: payload.deliveredAt || payload.delivered_at || null,
            read_at: payload.readAt || payload.read_at || null,
            is_revoked: payload.isRevoked ?? payload.is_revoked ?? false,
            quoted_message: (() => {
              const q = payload.quoted_message || payload.quotedMessage || payload.payloadRaw?.quoted_message || payload.payload_raw?.quoted_message || null;
              if (q && typeof q === 'object') {
                const qc: any = { ...q };
                if (typeof qc.content === 'string') qc.content = maskP(qc.content);
                if (typeof qc.sender_name === 'string') qc.sender_name = maskP(qc.sender_name);
                if (typeof qc.senderName === 'string') qc.senderName = maskP(qc.senderName);
                return qc;
              }
              return q;
            })(),
            payload_raw: payload.payloadRaw || payload.payload_raw || payload.payload_raw || undefined,
          };

          const isSandbox = Boolean(payload.isSandboxTest || payload.is_sandbox_test || payload.isSandbox);
          // Mandat In-System PWA Only: suara & banner HANYA untuk pesan yang benar-benar
          // butuh penanganan staf (percakapan dipegang manusia / eskalasi), BUKAN saat Bot AI
          // sedang membalas. Ini mencegah ponsel terapis bergetar untuk chat bot-handled.
          const isHumanHandling = Boolean(
            payload.isHumanHandling ?? payload.is_human_handling ?? false
          );

          // Fase 1.1: catat waktu pesan masuk agar polling cadangan tahu SSE masih segar.
          if (msg.direction === 'INBOUND' && !payload.isHistorical) {
            lastInboundAtRef.current = Date.now();
          }

          try {
            if (msg.direction === 'INBOUND' && !payload.isHistorical && !isSandbox && isHumanHandling) {
              playIncomingMessageSound();
            }
          } catch (_) {
            // Audio pesan opsional; pesan tetap tampil walau suara gagal.
          }

          // Fase 0.2: bila percakapan ini sedang dibuka & terlihat, pesan masuk otomatis
          // ditandai dibaca (padamkan badge + presence untuk gerbang notifikasi).
          if (selectedTaskRef.current?.conversationId === convId && typeof document !== 'undefined' && document.visibilityState === 'visible') {
            markConversationReadRef.current?.(convId);
          }

          try {
            const isChatVisible = selectedTaskRef.current?.conversationId === convId && typeof document !== 'undefined' && document.visibilityState === 'visible';
            if (!isChatVisible && msg.direction === 'INBOUND' && !payload.isHistorical && !isSandbox && isHumanHandling) {
              const sender = msg.sender_name || 'Pelanggan';
              showSafeNotification(
                `Pesan Baru dari ${sender}`,
                {
                  body: msg.content || 'Mengirim media/gambar',
                  icon: '/admin/pwa-192x192.png',
                  tag: `staff_chat_${convId}`,
                },
                () => {
                  // Fokus jendela opsional; navigasi tetap dilakukan di bawah.
                  try { window.focus(); } catch (_) {}
                  const match = allTasksRef.current.find((t) => t.conversationId === convId);
                  if (match) handleOpenChat(match);
                }
              );
            }
          } catch (_) {
            // Notifikasi sistem opsional; bubble chat tetap diperbarui di bawah.
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
          const { messageId, waMessageId, content, isRevoked, isEdited, conversationId } = payload;
          const matchesUpdated = (m: any) => {
            if (messageId && (m.id === messageId || (m as any).wa_message_id === messageId)) return true;
            if (waMessageId && (m.id === waMessageId || (m as any).wa_message_id === waMessageId)) return true;
            const shortA = messageId ? String(messageId).split('_').pop() : null;
            if (shortA && (m as any).wa_message_id && String((m as any).wa_message_id).endsWith(`_${shortA}`)) return true;
            return false;
          };
          if (selectedTaskRef.current?.conversationId === conversationId) {
            const updatedHidden =
              (payload as any).isMessageHidden === true || (payload as any).payload_raw?.is_hidden === true;
            if (updatedHidden && !isSupervisorRef.current) {
              // Admin me-hide: hapus bubble dari layar terapis seketika.
              setMessages((prev) => prev.filter((m) => !matchesUpdated(m)));
              return;
            }
            if ((payload as any).isMessageHidden === false && !isSupervisorRef.current) {
              // Admin memulihkan: refetch agar pesan muncul kembali.
              try {
                refreshActiveChatRef.current?.({ keepScroll: true });
              } catch {
                // Refresh bersifat best-effort; bubble lokal sudah diperbarui.
              }
            }
            setMessages((prev) =>
              prev.map((m) =>
                matchesUpdated(m)
                  ? {
                      ...m,
                      content: content != null ? (isSupervisorRef.current ? String(content) : maskPhoneInTextClient(String(content))) : m.content,
                      is_revoked: isRevoked ?? m.is_revoked,
                      is_edited: isEdited ?? m.is_edited,
                      media: payload.media || (m as any).media,
                      payload_raw: {
                        ...((m as any).payload_raw || {}),
                        is_revoked: isRevoked ?? (m.payload_raw as any)?.is_revoked,
                        is_edited: isEdited ?? (m.payload_raw as any)?.is_edited,
                        ...(payload.media ? { media: payload.media } : {}),
                      },
                    }
                  : m
              )
            );
          }
        } catch {
          // Payload SSE tidak terbaca: lewati event ini, koneksi tetap hidup.
        }
      });

      es.addEventListener('message.status_updated', (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data);
          const { messageId, waMessageId, conversationId, status, deliveredAt, readAt } = payload;
          const targetId = messageId || waMessageId;
          if (!targetId) return;
          if (conversationId && selectedTaskRef.current?.conversationId !== conversationId) return;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === targetId || (m as any).wa_message_id === targetId || (payload.waMessageId && (m as any).wa_message_id === payload.waMessageId)
                ? { ...m, delivery_status: status, delivered_at: deliveredAt || m.delivered_at, read_at: readAt || m.read_at }
                : m
            )
          );
        } catch {
          // Payload SSE tidak terbaca: lewati event ini, koneksi tetap hidup.
        }
      });

      // Listen to new task assigned event (Real-time in-system notification)
      es.addEventListener('staff.task_assigned', (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data);
          const staffId = currentStaffRef.current?.id;
          const isSpv = isSupervisorRef.current;
          if (!isSpv && payload.staffId && payload.staffId !== staffId) return;

          playIncomingMessageSound(true);
          const patient = payload.patientName || 'Bunda';
          const treatment = payload.treatmentDetail || 'Treatment';
          toast(`Tugas Baru: ${treatment} untuk ${patient}`, 'success');

          showSafeNotification('Tugas Kunjungan Baru 💆‍♀️', {
            body: `${treatment} untuk ${patient}`,
            icon: '/admin/pwa-192x192.png',
            tag: `staff_task_${payload.reservationId || Date.now()}`,
          }, () => {
            // Fokus jendela opsional; notifikasi in-app tetap tampil.
            try { window.focus(); } catch (_) {}
          });

          if (fetchTasksRef.current) fetchTasksRef.current(true);
        } catch (e) {
          console.warn('[SSE] staff.task_assigned error:', e);
        }
      });

      // Listen to task cancelled / reassigned event
      es.addEventListener('staff.task_cancelled', (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data);
          const staffId = currentStaffRef.current?.id;
          const isSpv = isSupervisorRef.current;
          if (!isSpv && payload.staffId && payload.staffId !== staffId) return;

          const reason = payload.reason || 'Jadwal kunjungan telah dibatalkan atau dialihkan.';
          toast(`Jadwal Kunjungan Dibatalkan / Dialihkan: ${reason}`, 'info');

          showSafeNotification('Jadwal Kunjungan Dibatalkan ❌', {
            body: reason,
            icon: '/admin/pwa-192x192.png',
            tag: `staff_task_cancel_${payload.reservationId || Date.now()}`,
          }, () => {
            // Fokus jendela opsional; toast pembatalan tetap tampil.
            try { window.focus(); } catch (_) {}
          });

          if (fetchTasksRef.current) fetchTasksRef.current(true);
        } catch (e) {
          console.warn('[SSE] staff.task_cancelled error:', e);
        }
      });

      // Listen to customer location updated event (real-time GPS from field staff)
      es.addEventListener('customer.location_updated', (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data);
          const staffId = currentStaffRef.current?.id;
          const isSpv = isSupervisorRef.current;
          if (!isSpv && payload.staffId && payload.staffId !== staffId) return;

          const { reservationId, lat, lng, distanceKm, ongkir, landmark, housePhotoUrl, diverged, diffKm } = payload;
          const updateTaskLocation = (t: StaffTask): StaffTask => {
            if (t.reservationId !== reservationId) return t;
            return {
              ...t,
              address: {
                ...t.address,
                ...(lat != null && { lat }),
                ...(lng != null && { lng }),
                ...(distanceKm != null && { distanceKm }),
                ...(ongkir != null && { ongkir }),
                ...(landmark && { landmark }),
                ...(housePhotoUrl && { housePhotoUrl }),
                ...(diverged && diffKm != null && { landmark: `${t.address.landmark || ''} [GPS Lapangan +${diffKm}km]` }),
              },
            };
          };
          setTasks((prev) => prev.map(updateTaskLocation));
          setUpcomingTasks((prev) => prev.map(updateTaskLocation));
          if (selectedTaskRef.current?.reservationId === reservationId) {
            setSelectedTask((prev) => (prev ? updateTaskLocation(prev) : null));
          }
        } catch (e) {
          console.warn('[SSE] customer.location_updated error:', e);
        }
      });

      // Listen to staff task completed event
      es.addEventListener('staff.task_completed', (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data);
          const staffId = currentStaffRef.current?.id;
          const isSpv = isSupervisorRef.current;
          if (!isSpv && payload.staffId && payload.staffId !== staffId) return;

          const { reservationId } = payload;
          const updateTaskCompleted = (t: StaffTask): StaffTask =>
            t.reservationId === reservationId ? { ...t, status: 'completed' as const } : t;
          setTasks((prev) => prev.map(updateTaskCompleted));
          setUpcomingTasks((prev) => prev.map(updateTaskCompleted));
          if (selectedTaskRef.current?.reservationId === reservationId) {
            setSelectedTask((prev) => (prev ? updateTaskCompleted(prev) : null));
          }
        } catch (e) {
          console.warn('[SSE] staff.task_completed error:', e);
        }
      });

      es.onerror = () => {
        sseConnectedRef.current = false;
        setSseConnected(false);
        if (es) {
          es.close();
          es = null;
        }
        reconnectTimeout = setTimeout(connectSSE, 4000);
      };
    };

    // Fase 0.1: izinkan resume handler memicu reconnect segera (tanpa tunggu 4 dtk).
    sseReconnectRef.current = connectSSE;
    connectSSE();

    return () => {
      sseReconnectRef.current = null;
      try {
        if (es) es.close();
      } catch {
        /* abaikan */
      }
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, []);

  // Send reply message
  // Foto kamera dikompres instan saat dipilih (JPEG ~1280px) → tidak pernah kirim Base64 mentah.


  // Quick Action: Send OTW notification using dynamic Super Admin template
  // ── Unifikasi OTW (plan 2026-10-04) ─────────────────────────────────────────
  // SATU jalur kirim OTW untuk semua tombol (kartu & drawer) → mencegah kirim
  // ganda ke customer. Pesan hanya di-POST dari modal konfirmasi; `sendingOtwId`
  // mengunci semua tombol selama proses. GMaps dibuka dari gesture tombol modal
  // (sinkron) agar tidak diblokir pop-up-blocker.
  const [otwDepart, setOtwDepart] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [otwGpsChecking, setOtwGpsChecking] = useState(false);

  const openMapsIfAny = (navUrl: string | null): void => {
    if (!navUrl || navUrl === '#') return;
    const win = window.open(navUrl, '_blank', 'noopener,noreferrer');
    if (!win) toast('Izinkan pop-up untuk membuka peta navigasi.', 'error');
  };

  /**
   * Titik masuk tunggal semua aksi keberangkatan.
   * - Sudah OTW → hanya buka ulang peta (tanpa kirim).
   * - Belum OTW & layak → rekam GPS + buka modal konfirmasi (pesan DB-driven).
   * - Belum OTW tapi di luar jendela / offline / tanpa chat → mode intip / info.
   */
  const handleUnifiedDepart = async (task: StaffTask, navUrl: string | null) => {
    if (sendingOtwId) return;
    const TERMINAL = ['completed', 'cancelled', 'rejected'];
    if (TERMINAL.includes(String(task.status || '').toLowerCase())) {
      openMapsIfAny(navUrl);
      return;
    }
    if (task.otwSentAt) {
      openMapsIfAny(navUrl);
      return;
    }

    const gate = getOtwGate(task.bookingDate);
    if (!gate.allowed) {
      openMapsIfAny(navUrl);
      if (gate.reason === 'too_early') {
        toast(`Tombol OTW baru aktif maks. 2 jam sebelum jadwal (${formatTime(task.bookingDate)})`, 'info');
      } else if (gate.reason === 'expired') {
        toast('Jadwal treatment sudah lewat batas OTW. Silakan gunakan tombol "Sampai".', 'info');
      } else {
        toast('Jadwal belum memiliki waktu booking yang valid.', 'error');
      }
      return;
    }

    if (!isOnline) {
      openMapsIfAny(navUrl);
      toast('Koneksi internet terputus. Tidak dapat mengirim info OTW saat ini.', 'error');
      return;
    }

    if (!task.conversationId) {
      openMapsIfAny(navUrl);
      toast('Belum ada riwayat percakapan WhatsApp untuk pasien ini.', 'error');
      return;
    }

    // Rekam titik awal keberangkatan (cache pre-warm → 0 dtk; fallback balapan ≤2 dtk).
    setSendingOtwId(task.reservationId);
    setOtwGpsChecking(true);
    const depart = await getDepartPositionFast();
    setOtwDepart(depart);
    setOtwGpsChecking(false);

    const patientName = task.customerName || 'Bunda';
    let draft = `Halo Bunda ${patientName} 😊\n\nSaya sudah dalam perjalanan menuju rumah Bunda untuk treatmentnya yaa 🚗💨\nMohon ditunggu, Bun. Sampai bertemu sebentar lagi 🤍\n\n~ ${staff?.name || 'Bidan Terapis'}`;
    try {
      const tplRes = await apiRequest(`/api/staff/otw-template?patientName=${encodeURIComponent(patientName)}`);
      if (tplRes?.success && tplRes.text) draft = tplRes.text;
    } catch (_) {
      /* pakai draf fallback */
    }

    setSendingOtwId(null);
    setOtwModal({ task, navUrl, draft });
  };

  const retryOtwGps = async () => {
    setOtwGpsChecking(true);
    try {
      setOtwDepart(await getDepartPositionFast());
    } finally {
      setOtwGpsChecking(false);
    }
  };

  /** Konfirmasi modal OTW: buka peta (sinkron) lalu kirim — satu-satunya POST OTW. */
  const confirmOtwDepart = () => {
    const m = otwModal;
    if (!m) return;
    const { task, navUrl, draft } = m;

    const TERMINAL = ['completed', 'cancelled', 'rejected'];
    if (TERMINAL.includes(String(task.status || '').toLowerCase())) {
      setOtwModal(null);
      openMapsIfAny(navUrl);
      return;
    }

    // Guard ganda (anti double-tap / lintas tombol saat in-flight).
    if (task.otwSentAt) {
      setOtwModal(null);
      openMapsIfAny(navUrl);
      return;
    }

    // 1. Buka Google Maps SINKRON dari gesture (anti pop-up block).
    openMapsIfAny(navUrl);

    // 2. ETA best-effort dari titik awal (bila GPS & tujuan tersedia).
    const depart = otwDepart;
    const destLat = task.address?.lat;
    const destLng = task.address?.lng;
    let etaMinutes: number | null = null;
    let arrivalWib: string | null = null;
    if (depart && destLat != null && destLng != null) {
      const km = calculateHaversineKm(depart.lat, depart.lng, destLat, destLng);
      etaMinutes = estimateTravelMinutesKm(km);
      arrivalWib = formatWibClock(new Date(), etaMinutes);
    }

    setOtwModal(null);
    setOtwDepart(null);

    // 3. Kirim OTW (fire-and-forget) — satu-satunya jalur POST OTW.
    (async () => {
      try {
        const res = await apiRequest(`/api/staff/reservations/${task.reservationId}/otw`, {
          method: 'POST',
          keepalive: true,
          body: JSON.stringify({
            customText: draft,
            markEnRoute: true,
            ...(etaMinutes != null ? { etaMinutes } : {}),
            ...(arrivalWib ? { arrivalWib } : {}),
            ...(depart ? { lat: depart.lat, lng: depart.lng, accuracy: depart.accuracy } : {}),
          }),
        });
        if (res?.success) {
          if (res?.data?.alreadySent) {
            const serverOtwAt = res?.data?.otwSentAt || task.otwSentAt || new Date().toISOString();
            const nextStatus = res?.data?.status || task.status;
            const updateOtw = (t: StaffTask): StaffTask =>
              t.reservationId === task.reservationId ? { ...t, otwSentAt: serverOtwAt, status: nextStatus } : t;
            setTasks((prev) => prev.map(updateOtw));
            setUpcomingTasks((prev) => prev.map(updateOtw));
            setSelectedTask((prev) => (prev ? updateOtw(prev) : prev));
            toast('Info OTW sudah pernah dikirim sebelumnya: tidak dikirim ulang.', 'info');
            return;
          }
          const nowIso = new Date().toISOString();
          const nextStatus = res?.data?.status || 'en_route';
          const updateOtw = (t: StaffTask): StaffTask =>
            t.reservationId === task.reservationId ? { ...t, otwSentAt: nowIso, status: nextStatus } : t;
          setTasks((prev) => prev.map(updateOtw));
          setUpcomingTasks((prev) => prev.map(updateOtw));
          setSelectedTask((prev) => (prev ? updateOtw(prev) : prev));
          if (task.conversationId && selectedTaskRef.current?.conversationId === task.conversationId) {
            void fetchMessages(task.conversationId, { silent: true });
          }
          toast(`OTW terkirim ke WhatsApp ${task.customerName || 'pasien'}`, 'success');
        } else {
          toast(`Gagal kirim OTW: ${res?.error || 'kesalahan tidak diketahui'}`, 'error');
        }
      } catch (err) {
        toast(`Gagal kirim OTW: ${(err as any)?.message || 'periksa koneksi'}`, 'error');
      }
    })();
  };

  // Kontrol keberangkatan terpadu (plan 2026-10-04).
  // Tracking GPS kontinu tetap DI-DEPRECATE (tidak andal di PWA).
  // Gerbang pengaman pra-navigasi (insiden Bidan tersasar 2026-09-30): titik
  // NON-presisi (manual_staff/estimated_area/belum diketahui) DILARANG membuka
  // Google Maps langsung — munculkan modal konfirmasi + opsi minta shareloc.

  /**
   * Titik masuk tunggal tombol navigasi/OTW. Bila titik estimasi → gerbang
   * preflight dulu; selain itu langsung ke `handleUnifiedDepart` (satu jalur kirim).
   */
  const requestNavigation = (task: StaffTask, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const navUrl = task.navigationUrl || task.mapsUrl || '';
    if (navUrl && needsNavigationPreflight(task.address?.locationSource)) {
      setPreflightTask(task);
      return;
    }
    handleUnifiedDepart(task, navUrl || null);
  };

  const buildSharelocDraft = (task: StaffTask): string => {
    const name = (task.customerName || '').trim() || 'Bunda';
    const template =
      quickReplyTemplates.find((q) => q.shortcut === 'shareloc')?.content ||
      quickReplyTemplates.find((q) => q.shortcut === 'shareloct')?.content ||
      '';
    if (!template.trim()) return '';
    return template.replace(/\{(?:name|nama|nama_bunda)\}/gi, name);
  };

  const handleRequestShareloc = () => {
    const task = preflightTask;
    if (!task) return;
    const draft = buildSharelocDraft(task);
    if (!draft) {
      toast('Template titik presisi belum diatur di Balasan Cepat (kategori Pasca Booking).', 'error');
      setPreflightTask(null);
      return;
    }
    setReplyText(draft);
    setPreflightTask(null);
    handleOpenChat(task);
    requestAnimationFrame(() => replyTextareaRef.current?.focus());
  };

  // Quick Action: Record Arrival and send "Sudah Sampai" notification
  const handleRecordArrival = async (task: StaffTask, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    if (!isOnline) {
      toast('Koneksi internet terputus. Tidak dapat memperbarui status kedatangan saat ini.', 'error');
      return;
    }

    const patientName = task.customerName || 'Bunda';
    const staffSignature = staff?.name || 'Bidan Terapis';
    let arrivalMessage = `Halo Bunda, saya ${staffSignature} sudah sampai di depan rumah/lokasi Bunda ya 🙏\n\n~ ${staffSignature}`;
    try {
      const tplRes = await apiRequest(`/api/staff/arrival-template?patientName=${encodeURIComponent(patientName)}`);
      if (tplRes.success && tplRes.text) {
        arrivalMessage = tplRes.text;
      }
    } catch (_) {
      // Template dari DB opsional; pakai draf cadangan di atas bila gagal.
    }

    const missingPhotoNotice = needsHousePhoto(task)
      ? '\n\n💡 Catatan: Foto rumah pasien ini belum tersedia di sistem. Sempatkan mengambil foto depan rumah setelah tiba ya Bidan.'
      : '';

    const confirmed = await confirm({
      title: 'Konfirmasi Tiba di Lokasi',
      message: `Kirim pesan WhatsApp bahwa Anda sudah sampai di depan lokasi ${patientName}?\n\n"${arrivalMessage}"${missingPhotoNotice}`,
      confirmText: 'Ya, Sudah Sampai',
      cancelText: 'Batal',
    });

    if (!confirmed) return;

    setSendingArrivalId(task.reservationId);
    try {
      const res = await apiRequest(`/api/staff/reservations/${task.reservationId}/arrive`, {
        method: 'POST',
      });

      if (res.success) {
        // S-09: jangan klaim "pesan terkirim" bila WhatsApp gagal/ditekan.
        const wa = res.data?.waResult;
        const waSent = wa?.success === true;
        const suppressed = !!res.data?.arrivalWaSuppressed;
        if (waSent) {
          toast(`Status tiba di lokasi tercatat & pesan terkirim ke ${patientName}!`, 'success');
        } else if (suppressed) {
          toast('Kedatangan tercatat. Pesan WhatsApp tidak dikirim karena baru saja ada pesan OTW — kirim manual bila perlu.', 'info');
        } else {
          toast('Kedatangan tercatat, tetapi pesan WhatsApp GAGAL dikirim. Silakan kirim manual dari Live Chat.', 'error');
        }
        const nowIso = new Date().toISOString();
        const updateArrival = (t: StaffTask): StaffTask =>
          t.reservationId === task.reservationId ? { ...t, arrivedAt: nowIso } : t;
        setTasks((prev) => prev.map(updateArrival));
        setUpcomingTasks((prev) => prev.map(updateArrival));
        if (selectedTask?.reservationId === task.reservationId) {
          setSelectedTask((prev) => (prev ? updateArrival(prev) : null));
        }
        // Hentikan pemancar telemetry (privasi mati total saat tiba).
        fireAndForget(stopTelemetry(), 'hentikan telemetry saat tiba');
      } else {
        toast(`Gagal: ${res.error || 'Terjadi kesalahan saat mencatat kedatangan'}`, 'error');
      }
    } catch (err: any) {
      toast(`Gagal: ${err.message || 'Terjadi kesalahan'}`, 'error');
    } finally {
      setSendingArrivalId(null);
    }
  };

  // Quick Action: Complete Visit (for already paid or independent completion)
  const handleCompleteVisit = async (task: StaffTask, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    const patientName = task.customerName || 'Bunda';

    // Safety Guard pelunasan (lapis UI; backend `completeTask` tetap gerbang akhir):
    // tagihan belum lunas → tawarkan catat pembayaran dulu, bukan langsung selesai.
    if (task.pricing?.paymentStatus === 'TAGIH_DI_TEMPAT') {
      const proceedUnpaid = await confirm({
        title: 'Pembayaran Belum Lunas',
        message: `Pasien ${patientName} memiliki tagihan ${formatRupiah(
          task.pricing.totalFee
        )} yang belum lunas.\n\nApakah Anda sudah menerima uang pembayaran? Disarankan mencatat pembayaran terlebih dahulu.`,
        confirmText: 'Ya, Sudah Diterima & Selesaikan',
        cancelText: 'Catat Pembayaran Dulu',
        danger: true,
      });
      if (!proceedUnpaid) {
        setPaymentModalTask(task);
        return;
      }
    }

    // Soft guard: Pengingat foto rumah jika belum ada (tidak memblokir darurat)
    if (needsHousePhoto(task)) {
      const wantToTake = await confirm({
        title: 'Foto Rumah Belum Diunggah',
        message: `Foto depan rumah untuk pasien ${patientName} belum ada di sistem.\n\nFoto rumah sangat membantu tim bidan lain menemukan lokasi dengan cepat untuk kunjungan berikutnya. Mau ambil foto rumah sekarang?`,
        confirmText: 'Ambil Foto Rumah Sekarang',
        cancelText: 'Lewati & Selesaikan',
      });
      if (wantToTake) {
        handleOpenUpdateLocationModal(task);
        return;
      }
    } else if (task.pricing?.paymentStatus !== 'TAGIH_DI_TEMPAT') {
      const confirmed = await confirm({
        title: 'Selesaikan Kunjungan',
        message: `Tandai kunjungan & tindakan untuk ${patientName} telah selesai dilakukan?`,
        confirmText: 'Ya, Kunjungan Selesai',
        cancelText: 'Batal',
      });
      if (!confirmed) return;
    }

    setCompletingVisitId(task.reservationId);
    try {
      const forceUnpaid = task.pricing?.paymentStatus === 'TAGIH_DI_TEMPAT';
      const res = await apiRequest(`/api/staff/reservations/${task.reservationId}/complete`, {
        method: 'POST',
        body: JSON.stringify({ forceUnpaid }),
      });

      if (res.success) {
        toast(`Kunjungan untuk ${patientName} berhasil diselesaikan!`, 'success');
        const updateCompleted = (t: StaffTask): StaffTask =>
          t.reservationId === task.reservationId ? { ...t, status: 'completed' } : t;
        setTasks((prev) => prev.map(updateCompleted));
        setUpcomingTasks((prev) => prev.map(updateCompleted));
        if (selectedTask?.reservationId === task.reservationId) {
          setSelectedTask((prev) => (prev ? updateCompleted(prev) : null));
        }
        // Kunjungan selesai → pastikan pemantauan perjalanan benar-benar mati.
        fireAndForget(stopTelemetry(), 'hentikan telemetry saat kunjungan selesai');
      } else {
        toast(`Gagal: ${res.error || 'Terjadi kesalahan saat menyelesaikan kunjungan'}`, 'error');
      }
    } catch (err: any) {
      toast(`Gagal: ${err.message || 'Terjadi kesalahan'}`, 'error');
    } finally {
      setCompletingVisitId(null);
    }
  };

  // Quick Action: Send Payment Info (QRIS & Bank Accounts) directly to customer WhatsApp
  const handleSendPaymentInfo = async (task: StaffTask) => {
    if (!task.conversationId) {
      toast('Belum ada riwayat percakapan WhatsApp untuk pasien ini.', 'error');
      return;
    }

    if (!isOnline) {
      toast('Koneksi internet terputus. Tidak dapat mengirim info pembayaran saat ini.', 'error');
      return;
    }

    const patientName = task.customerName || 'Bunda';
    const isLunas = task.pricing?.paymentStatus === 'LUNAS';

    const confirmTitle = isLunas ? 'Konfirmasi Tagihan (Status: Lunas)' : 'Kirim Info Pembayaran ke WhatsApp';
    const confirmMessage = isLunas
      ? `Pasien ${patientName} tercatat SUDAH LUNAS.\n\nApakah Anda tetap ingin mengirimkan informasi rekening/QRIS ke nomor WhatsApp pasien?`
      : `Kirim rincian pembayaran, barcode QRIS, dan nomor rekening bank resmi klinik langsung ke nomor WhatsApp ${patientName}?`;

    const confirmed = await confirm({
      title: confirmTitle,
      message: confirmMessage,
      confirmText: isLunas ? 'Tetap Kirim' : 'Ya, Kirim Sekarang',
      cancelText: 'Batal',
    });

    if (!confirmed) return;

    setIsSendingPaymentInfo(true);
    try {
      const res = await apiRequest(`/api/staff/reservations/${task.reservationId}/send-payment-info`, {
        method: 'POST',
      });

      if (res.success) {
        toast(`Info pembayaran & QRIS berhasil dikirim ke WhatsApp ${patientName}!`, 'success');
        // Muat ulang pesan percakapan agar langsung muncul di layar chat
        if (selectedTask?.reservationId === task.reservationId && selectedTask.conversationId) {
          await fetchMessages(selectedTask.conversationId);
          scrollToBottom(true);
        }
      } else {
        toast(`Gagal: ${res.error || 'Terjadi kesalahan saat mengirim info pembayaran'}`, 'error');
      }
    } catch (err: any) {
      toast(`Gagal: ${err.message || 'Terjadi kesalahan'}`, 'error');
    } finally {
      setIsSendingPaymentInfo(false);
    }
  };

  // Helper: Salin nomor rekening ke clipboard
  const handleCopyAccountNumber = async (accNum: string, bank: string) => {
    try {
      await navigator.clipboard.writeText(accNum);
      toast(`Nomor rekening ${bank} (${accNum}) berhasil disalin!`, 'success');
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = accNum;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      toast(`Nomor rekening ${bank} (${accNum}) berhasil disalin!`, 'success');
    }
  };

  // Tombol 1-tap QRIS: tampilkan barcode QRIS layar penuh langsung ke pasien.
  const handleOpenQrisFast = useCallback(
    async (task: StaffTask, e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      setPaymentModalTask(task);
      setPaymentInitialMethod('QRIS');
      const info = await ensurePaymentInfo();
      if (!info || !info.qrisImageUrl) {
        toast('QRIS belum tersedia. Hubungi admin untuk mengunggah barcode QRIS.', 'error');
        return;
      }
      setQrisZoomModal(true);
    },
    [ensurePaymentInfo, toast]
  );

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

  // Catat pembayaran: modal sudah memegang state form, di sini hanya API dan
  // penyegaran daftar tugas.
  const handleSubmitPayment = async (method: PaymentMethod, proofImageB64: string | null) => {
    if (!paymentModalTask) return;
    if (method !== 'CASH' && !proofImageB64) return;

    setSubmittingPayment(true);
    try {
      const res = await apiRequest(`/api/staff/reservations/${paymentModalTask.reservationId}/payment`, {
        method: 'POST',
        body: JSON.stringify({
          paymentMethod: method,
          amount: paymentModalTask.pricing.totalFee,
          proofImageB64: proofImageB64 || undefined,
        }),
      });

      if (res.success) {
        toast(`Pembayaran Rp ${paymentModalTask.pricing.totalFee.toLocaleString('id-ID')} berhasil dicatat!`, 'success');

        const targetId = paymentModalTask.reservationId;
        const newProofUrl: string | null = res.data?.proofUrl ?? proofImageB64 ?? null;
        const newMethod: string | null = res.data?.paymentMethod ?? method;
        const applyLunas = (t: StaffTask): StaffTask =>
          t.reservationId === targetId
            ? {
                ...t,
                pricing: {
                  ...t.pricing,
                  paymentStatus: 'LUNAS',
                  paymentStatusLabel: 'Lunas',
                  paymentMethod: newMethod,
                  proofUrl: newProofUrl ?? t.pricing.proofUrl ?? null,
                },
              }
            : t;

        // Sinkronisasi reaktif menyeluruh: kartu Hari Ini, Riwayat Selesai,
        // Jadwal Mendatang, drawer chat terpilih, dan modal detail pasien.
        setTasks((prev) => prev.map(applyLunas));
        setCompletedTasks((prev) => prev.map(applyLunas));
        setUpcomingTasks((prev) => prev.map(applyLunas));
        setSelectedTask((prev) => (prev ? applyLunas(prev) : null));
        setDetailModalTask((prev) => (prev ? applyLunas(prev) : null));

        setPaymentModalTask(null);
        setPaymentInitialMethod('CASH');
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
    const initialCoords =
      task.address.lat != null && task.address.lng != null
        ? { lat: task.address.lat, lng: task.address.lng }
        : null;
    setLocCoords(initialCoords);
    setLocHousePhotoB64(task.address.housePhotoUrl || null);
    setLocRawHousePhotoB64(null);
    setLocLandmark(task.address.landmark || '');

    const hasData = Boolean(
      task.address.housePhotoUrl ||
      initialCoords != null ||
      task.address.landmark
    );
    setHasSavedLocData(hasData);
    const mode = resolveLocModalMode(task);
    setLocModalMode(mode);

    // Warm up GPS jika buka mode edit dan koordinat belum tersedia (hemat baterai, tanpa izin berulang)
    if (mode === 'edit' && !initialCoords && !locGettingGps && 'geolocation' in navigator) {
      fireAndForget(acquireBestGps(true), 'hangatkan GPS mode edit');
    }
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
            timeout: 3500,
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

        // Jika sudah mencapai target presisi tinggi (≤ 10 meter, atau ≤ 15 meter pada attempt 1-2), langsung stop & selesai!
        if (acc <= 10 || (attempt <= 2 && acc <= 15)) {
          setGpsAttemptInfo(null);
          setLocGettingGps(false);
          toast(`GPS presisi tinggi terkunci (±${acc}m pada percobaan ke-${attempt})!`, 'success');
          return;
        }

        // Jika belum memenuhi target dan masih ada sisa percobaan, tunggu sebentar lalu coba lagi
        if (attempt < MAX_ATTEMPTS) {
          setGpsAttemptInfo(`Akurasi ±${acc}m. Mencari sinyal lebih kuat (${attempt + 1}/${MAX_ATTEMPTS})...`);
          await new Promise((r) => setTimeout(r, 300));
        }
      } catch (err: any) {
        console.warn(`[GPS] Percobaan ${attempt} gagal:`, err?.message);
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    }

    setLocGettingGps(false);
    setGpsAttemptInfo(null);

    if (bestPos) {
      setLocCoords(bestPos);
      // Perbarui watermark foto secara reaktif jika foto sudah diambil
      if (locRawHousePhotoB64) {
        await applyStaffWatermarkToRaw(locRawHousePhotoB64, bestPos, locLandmark);
      }

      if (bestPos.accuracy <= 10) {
        toast(`GPS presisi tinggi terkunci (±${bestPos.accuracy}m)`, 'success');
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

  // Helper untuk membubuhkan watermark GPS & info lokasi ke raw photo di staff page
  const applyStaffWatermarkToRaw = async (
    rawB64: string,
    coords: { lat: number; lng: number; accuracy?: number } | null,
    landmark: string,
    taskObj?: StaffTask | null
  ) => {
    const currentTask = taskObj || updateLocationModalTask;
    const targetLat = coords?.lat ?? currentTask?.address?.lat ?? null;
    const targetLng = coords?.lng ?? currentTask?.address?.lng ?? null;
    const targetAcc = coords?.accuracy ?? null;

    const takerName = staff?.name || 'Bidan Terapis';
    const watermarked = await stampGpsWatermark(rawB64, {
      lat: targetLat,
      lng: targetLng,
      accuracy: targetAcc,
      kelurahan: currentTask?.address?.kelurahan,
      kecamatan: currentTask?.address?.kecamatan,
      landmark: landmark || currentTask?.address?.landmark || null,
      customerName: currentTask?.customerName || undefined,
      takerName,
      staffName: takerName,
    });
    // Fase 2.2: stampGpsWatermark meng-encode ulang q0.85 → bisa membengkakkan file.
    // Re-kompres sekali ke profil 'house' agar ukuran akhir tetap terbatas (sinyal 1-bar).
    let finalB64 = watermarked;
    try {
      const hp = resolveCompressProfile('house');
      const rec = await compressDataUrl(watermarked, { maxWidth: hp.maxWidth, maxHeight: hp.maxHeight, quality: hp.quality });
      if (rec) finalB64 = rec;
    } catch {
      /* bila gagal, pakai hasil watermark apa adanya */
    }
    setLocHousePhotoB64(finalB64);
    return finalB64;
  };

  // Get GPS directly from mobile device
  const handleGetCurrentGps = () => {
    acquireBestGps(false);
  };

  // Pick / Capture House Photo from camera / gallery with instant client-side compression
  const handleProcessStaffHousePhoto = async (file: File) => {
    setLocProcessingPhoto(true);
    try {
      // 1. Fast Canvas downscaling — profil 'house' seragam (1000px/q0.70).
      const hp = resolveCompressProfile('house');
      const compressed = await compressImageFile(file, { maxWidth: hp.maxWidth, maxHeight: hp.maxHeight, quality: hp.quality });
      setLocRawHousePhotoB64(compressed.dataUrl);
      setLocHousePhotoB64(compressed.dataUrl);
      toast('Foto rumah berhasil dimuat!', 'success');

      // 2. Auto-fetch GPS di background jika belum terkunci
      if (!locCoords && 'geolocation' in navigator && !locGettingGps) {
        acquireBestGps(true);
      }
    } catch {
      toast('Gagal memproses foto rumah.', 'error');
    } finally {
      setLocProcessingPhoto(false);
    }
  };

  // Submit Location & House Photo Update (Optimistic UI - 0 Detik Loading)
  const handleSaveLocation = async () => {
    if (!updateLocationModalTask) return;
    const hasPhoto = !!(locRawHousePhotoB64 || (locHousePhotoB64 && locHousePhotoB64.startsWith('data:image/')));
    if (hasPhoto && !locCoords) {
      toast('Kunci titik GPS dulu sebelum menyimpan foto rumah.', 'error');
      return;
    }

    // Konsolidasi konfirmasi: Timpa data & akurasi GPS dalam satu dialog terpadu
    const confirmWarnings: string[] = [];
    if (hasSavedLocData) {
      confirmWarnings.push('• Data foto & titik panduan GPS pasien ini sudah pernah disimpan sebelumnya.');
    }
    const isLowAccuracy = !!(locCoords && locCoords.accuracy && locCoords.accuracy > 15);
    if (isLowAccuracy) {
      confirmWarnings.push(`• Akurasi sinyal GPS saat ini ±${locCoords.accuracy}m (akurasi rendah/di atas batas ideal 15m).`);
    }

    if (confirmWarnings.length > 0) {
      const ok = await confirm({
        title: 'Konfirmasi Simpan Data Lokasi',
        message: `Perhatian sebelum menyimpan data lokasi untuk ${updateLocationModalTask.customerName || 'Bunda'}:\n\n${confirmWarnings.join('\n')}\n\nApakah Anda yakin ingin tetap menyimpan pembaruan ini?`,
        confirmText: 'Ya, Tetap Simpan',
        cancelText: 'Periksa Kembali',
        danger: isLowAccuracy,
      });
      if (!ok) return;
    }

    const targetResId = updateLocationModalTask.reservationId;
    const photoPayload = locRawHousePhotoB64 || (locHousePhotoB64 && locHousePhotoB64.startsWith('data:image/') ? locHousePhotoB64 : undefined);
    const newLandmark = locLandmark || updateLocationModalTask.address.landmark;
    const newLat = locCoords?.lat ?? updateLocationModalTask.address.lat;
    const newLng = locCoords?.lng ?? updateLocationModalTask.address.lng;
    const newMapsUrl = newLat && newLng ? `https://maps.google.com/?q=${newLat},${newLng}` : null;
    const newNavUrl =
      newLat && newLng
        ? `https://www.google.com/maps/dir/?api=1&destination=${newLat},${newLng}&travelmode=two-wheeler`
        : null;

    const updateTaskObj = (t: StaffTask): StaffTask => {
      if (t.reservationId !== targetResId) return t;
      return {
        ...t,
        mapsUrl: newMapsUrl,
        navigationUrl: newNavUrl,
        address: {
          ...t.address,
          lat: newLat,
          lng: newLng,
          housePhotoUrl: photoPayload || t.address.housePhotoUrl,
          landmark: newLandmark,
        },
      };
    };

    // 1. UPDATE STATE SECARA INSTAN (0s Perceived Loading)
    setTasks((prev) => prev.map(updateTaskObj));
    setUpcomingTasks((prev) => prev.map(updateTaskObj));
    setCompletedTasks((prev) => prev.map(updateTaskObj));
    if (selectedTask?.reservationId === targetResId) {
      setSelectedTask((prev) => (prev ? updateTaskObj(prev) : null));
    }
    if (detailModalTask?.reservationId === targetResId) {
      setDetailModalTask((prev) => (prev ? updateTaskObj(prev) : null));
    }

    // Langsung tutup modal & tampilkan feedback sukses instan
    setUpdateLocationModalTask(null);
    setLocRawHousePhotoB64(null);
    toast('Lokasi & panduan berhasil diperbarui!', 'success');

    // 2. SINKRONISASI SERVER DI BACKGROUND
    try {
      const res = await apiRequest('/api/staff/update-location', {
        method: 'POST',
        body: JSON.stringify({
          reservationId: targetResId,
          lat: locCoords?.lat,
          lng: locCoords?.lng,
          accuracyM: locCoords?.accuracy,
          housePhotoB64: photoPayload,
          landmark: locLandmark,
        }),
      });

      if (res && res.success && res.data?.housePhotoUrl) {
        const updateServerUrl = (t: StaffTask): StaffTask => {
          if (t.reservationId !== targetResId) return t;
          return {
            ...t,
            address: {
              ...t.address,
              housePhotoUrl: res.data.housePhotoUrl,
              distanceKm: res.data.distanceKm ?? t.address.distanceKm,
              estimatedMinutes: res.data.estimatedMinutes ?? t.address.estimatedMinutes,
            },
          };
        };
        setTasks((prev) => prev.map(updateServerUrl));
        setUpcomingTasks((prev) => prev.map(updateServerUrl));
        setCompletedTasks((prev) => prev.map(updateServerUrl));
      }
      if (res && res.data?.coordsUpdated === false) {
        toast('Catatan lokasi tersimpan (tanpa perubahan titik GPS): foto tersimpan tapi koordinat tidak diperbarui.', 'error');
      }
    } catch (err: any) {
      console.warn('[STAFF] Background sync location error:', err?.message || err);
    }
  };

  const pendingTodayTasks = tasks.filter((t) => !isTrulyCompleted(t));
  const completedTodayTasks = tasks.filter((t) => isTrulyCompleted(t));

  const activeTodayTasks =
    todayFilter === 'all'
      ? tasks
      : todayFilter === 'pending'
      ? pendingTodayTasks
      : completedTodayTasks;

  const combinedCompletedTasks = [
    ...completedTasks.map((c) => {
      const fromToday = completedTodayTasks.find((t) => t.reservationId === c.reservationId);
      return fromToday?.conversationId ? { ...c, conversationId: fromToday.conversationId } : c;
    }),
    ...completedTodayTasks.filter((t) => !completedTasks.some((c) => c.reservationId === t.reservationId)),
  ];

  // Filter list
  const activeList =
    activeTab === 'today'
      ? activeTodayTasks
      : activeTab === 'upcoming'
      ? upcomingTasks
      : combinedCompletedTasks;

  const filteredTasks = filterTasksByQuery(activeList, searchQuery);

  // Group upcoming tasks by date
  const groupedUpcoming = groupTasksByDate(activeTab === 'upcoming' ? filteredTasks : upcomingTasks);

  // Group completed tasks by date
  const groupedCompleted = groupTasksByDate(activeTab === 'completed' ? filteredTasks : completedTasks);

  // Pull-to-refresh (swipe-down) khusus halaman staf: muat ulang tugas tanpa reload.
  const pullToRefresh = usePullToRefresh({
    onRefresh: () => fetchTasks(true, scopeFilter),
  });

  return (
    <div className="h-[100dvh] max-h-[100dvh] w-full max-w-full overflow-hidden bg-app text-ink flex flex-col font-sans select-none antialiased">
      <PullToRefreshIndicator
        distance={pullToRefresh.distance}
        progress={pullToRefresh.progress}
        phase={pullToRefresh.phase}
        isDragging={pullToRefresh.isDragging}
      />
      {/* S-06: consent eksplisit sebelum warm-up GPS latar berjalan. */}
      {hasDepartWindowTask && gpsWarmupConsent === null && (
        <div
          role="dialog"
          aria-label="Izin lokasi latar"
          className="mx-3 mt-2 rounded-xl border border-divider bg-surface p-3 text-xs text-ink-2 shadow-xs"
        >
          <p className="mb-2 leading-relaxed">
            Izinkan aplikasi memakai lokasi di latar <strong>hanya saat ada jadwal kunjungan</strong> agar tombol
            Navigasi lebih cepat? Lokasi berhenti direkam saat tidak ada jadwal.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => decideGpsWarmup('granted')}
              className="min-h-[44px] px-3 rounded-lg bg-accent hover:bg-accent-hover text-on-solid font-semibold"
            >
              Izinkan
            </button>
            <button
              type="button"
              onClick={() => decideGpsWarmup('denied')}
              className="min-h-[44px] px-3 rounded-lg border border-divider text-ink-2"
            >
              Tidak
            </button>
          </div>
        </div>
      )}
      {/* WhatsApp Web Minimalist Clean Top Bar — hidden on mobile when chat active (fondasional gating) */}
      <header className={`${mobileView === 'chat' && activeTab === 'today' ? 'hidden md:block' : 'block'} bg-surface border-b border-divider dark:border-divider px-3 sm:px-4 py-2.5 sticky top-0 z-30 shadow-xs pt-[calc(0.625rem+env(safe-area-inset-top,0px))] md:pt-2.5 pl-[max(0.75rem,env(safe-area-inset-left,0px))] pr-[max(0.75rem,env(safe-area-inset-right,0px))] shrink-0`}>
        <div className="flex items-center justify-between gap-2 sm:gap-4 max-w-7xl mx-auto w-full">
          <div className="flex items-center space-x-2.5 min-w-0">
            {mobileView === 'chat' && activeTab === 'today' && (
              <button
                onClick={handleBackToList}
                className="md:hidden p-2 rounded-full bg-fill-1 hover:bg-fill-2 text-ink-2 transition active:scale-95 border border-divider flex-shrink-0"
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
              className="h-9 w-9 rounded-full bg-accent text-on-solid hover:bg-accent-hover flex items-center justify-center shadow-xs transition active:scale-95 flex-shrink-0"
              title="Buka profil staff & logout"
            >
              <UserCheck size={18} />
            </button>

            <div className="min-w-0">
              <h1 className="font-bold text-sm sm:text-base text-ink tracking-tight truncate">
                {currentStaff?.name || 'Terapis'}
              </h1>
              <p className="text-[11px] text-ink-2 truncate flex items-center gap-1">
                <span>{tasks.length} Hari Ini • {upcomingTasks.length} Mendatang</span>
                <span className="text-[9px] text-ink-3 font-mono">({APP_VERSION})</span>
              </p>
            </div>
          </div>

          {/* Navigation Tab Switcher (Hari Ini vs Jadwal Mendatang vs Selesai) */}
          {!(mobileView === 'chat' && activeTab === 'today') && (
            <div className="hidden sm:flex items-center bg-fill-1 p-1 rounded-xl border border-divider dark:border-divider">
              <button
                type="button"
                onClick={() => handleTabChange('today')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  activeTab === 'today'
                    ? 'bg-surface text-accent shadow-xs'
                    : 'text-ink-2 hover:text-ink'
                }`}
              >
                <Calendar size={13} className={activeTab === 'today' ? 'text-accent' : 'text-ink-2'} />
                <span>Hari Ini</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                    activeTab === 'today' ? 'bg-bubble-out dark:bg-accent/20 text-accent' : 'bg-fill-2 dark:bg-fill-1 text-ink-2'
                  }`}
                >
                  {activeTodayTasks.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleTabChange('upcoming')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  activeTab === 'upcoming'
                    ? 'bg-surface text-accent shadow-xs'
                    : 'text-ink-2 hover:text-ink'
                }`}
              >
                <Clock size={13} className={activeTab === 'upcoming' ? 'text-accent' : 'text-ink-2'} />
                <span>Jadwal Mendatang</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                    activeTab === 'upcoming' ? 'bg-bubble-out dark:bg-accent/20 text-accent' : 'bg-fill-2 dark:bg-fill-1 text-ink-2'
                  }`}
                >
                  {upcomingTasks.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleTabChange('completed')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  activeTab === 'completed'
                    ? 'bg-surface text-accent shadow-xs'
                    : 'text-ink-2 hover:text-ink'
                }`}
              >
                <CheckCircle2 size={13} className={activeTab === 'completed' ? 'text-accent' : 'text-ink-2'} />
                <span>Selesai</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                    activeTab === 'completed' ? 'bg-bubble-out dark:bg-accent/20 text-accent' : 'bg-fill-2 dark:bg-fill-1 text-ink-2'
                  }`}
                >
                  {combinedCompletedTasks.length}
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
                    ? 'bg-success shadow-[0_0_8px_rgba(16,185,129,0.6)]'
                    : 'bg-danger animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.6)]'
                }`}
              />
            </div>

            {/* Refresh Tasks Button */}
            <button
              onClick={() => fetchTasks(false)}
              disabled={loading}
              className="p-2 rounded-full bg-surface hover:bg-fill-2 text-ink-2 hover:text-ink dark:hover:text-ink transition disabled:opacity-50 active:scale-95 border border-divider shadow-xs"
              title="Muat Ulang Data"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin text-accent' : ''} />
            </button>

            {/* Hamburger Button (Garis Tiga untuk buka Sidebar Menu Kanan) */}
            <button
              type="button"
              onClick={() => setShowMenuDrawer(true)}
              className="p-2 rounded-full bg-fill-1 hover:bg-fill-2 text-ink hover:text-accent dark:hover:text-accent-hover transition active:scale-95 border border-divider shadow-xs flex items-center justify-center"
              title="Buka Menu Navigasi"
              aria-label="Menu"
            >
              <Menu size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* Offline / sinyal lemah connectivity banner (lapangan).
          Fase 1.3: tampilkan juga saat koneksi ada tapi SSE putus (1-bar). */}
      {(!isOnline || !sseConnected) && (
        <div className="bg-warning-soft border-b border-warning-line px-4 py-2 text-warning text-xs flex items-center gap-2 z-20 shrink-0">
          <WifiOff size={15} className="flex-shrink-0 text-warning" />
          <span className="font-semibold">
            {!isOnline
              ? 'Koneksi internet terputus. Menunggu sinyal seluler...'
              : 'Sinyal lemah: menyambungkan kembali obrolan...'}
          </span>
        </div>
      )}

      {/* Error notification banner */}
      {errorMessage && (
        <div className="bg-danger-soft border-b border-danger-line px-4 py-2 text-danger text-xs flex items-center justify-between z-20">
          <div className="flex items-center space-x-2">
            <AlertTriangle size={14} className="flex-shrink-0 text-danger" />
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage(null)} className="text-danger font-bold ml-2 hover:text-danger">
            ✕
          </button>
        </div>
      )}

      {/* Main Split-View Workspace with Mobile Touch Swipe Navigation */}
      <div
        className="flex-1 min-h-0 flex overflow-hidden touch-pan-y"
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
              } w-full md:w-[420px] flex-col border-r border-divider dark:border-divider bg-fill-1 overflow-hidden flex-shrink-0 min-h-0 h-full animate-fadeIn`}
            >
              {/* Panel Search & Header */}
              <div className="p-3 bg-surface border-b border-divider dark:border-divider space-y-2.5">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center space-x-2">
                    <Calendar size={16} className="text-accent" />
                    <h2 className="font-bold text-sm text-ink">Jadwal Kunjungan Hari Ini</h2>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-bubble-out text-accent border border-accent/30">
                    {tasks.length} Pasien
                  </span>
                </div>

                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-ink-2">
                    <Search size={14} />
                  </span>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari pasien, alamat, atau layanan..."
                    className="w-full pl-9 pr-4 py-2 rounded-lg bg-fill-1 text-[16px] sm:text-xs text-ink placeholder-ink-3 dark:placeholder-ink-3 focus:outline-none focus:ring-1 focus:ring-accent transition"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-ink-2 hover:text-ink text-xs"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Supervisor Scope Filter: Tugas Saya vs Semua Terapis Tim */}
                {isSupervisor && (
                  <div className="flex items-center p-1 bg-fill-1 rounded-xl border border-divider gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setScopeFilter('mine');
                        fetchTasks(false, 'mine');
                      }}
                      className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                        scopeFilter === 'mine'
                          ? 'bg-surface text-accent shadow-xs'
                          : 'text-ink-2 hover:text-ink'
                      }`}
                    >
                      
                      <span>Tugas Saya</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setScopeFilter('all');
                        fetchTasks(false, 'all');
                      }}
                      className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                        scopeFilter === 'all'
                          ? 'bg-accent text-on-solid shadow-xs'
                          : 'text-ink-2 hover:text-ink'
                      }`}
                    >
                      
                      <span>Semua Terapis</span>
                    </button>
                  </div>
                )}

                {/* Status Sub-filter Pills for Today (Operational vs Completed) */}
                <div className="flex items-center gap-1.5 pt-1 overflow-x-auto no-scrollbar">
                  <button
                    type="button"
                    onClick={() => setTodayFilter('all')}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition flex items-center gap-1.5 ${
                      todayFilter === 'all'
                        ? 'bg-ink text-white shadow-xs'
                        : 'bg-fill-1 text-ink-2 hover:bg-fill-2 hover:text-ink'
                    }`}
                  >
                    <span>Semua</span>
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                      todayFilter === 'all' ? 'bg-white/20 text-white' : 'bg-fill-2 text-ink-2'
                    }`}>
                      {tasks.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTodayFilter('pending')}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition flex items-center gap-1.5 ${
                      todayFilter === 'pending'
                        ? 'bg-accent text-on-solid shadow-xs'
                        : 'bg-fill-1 text-ink-2 hover:bg-fill-2 hover:text-ink'
                    }`}
                  >
                    <span>Perlu Dikunjungi</span>
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                      todayFilter === 'pending' ? 'bg-white/20 text-white' : 'bg-fill-2 text-ink-2'
                    }`}>
                      {pendingTodayTasks.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTodayFilter('completed')}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition flex items-center gap-1.5 ${
                      todayFilter === 'completed'
                        ? 'bg-accent text-on-solid shadow-xs'
                        : 'bg-fill-1 text-ink-2 hover:bg-fill-2 hover:text-ink'
                    }`}
                  >
                    <span>Selesai</span>
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                      todayFilter === 'completed' ? 'bg-white/20 text-white' : 'bg-fill-2 text-ink-2'
                    }`}>
                      {completedTodayTasks.length}
                    </span>
                  </button>
                </div>
              </div>

              {/* Task cards scroll area with proper background & space-y-3 spacing between cards */}
              <div className="flex-1 overflow-y-auto p-3 pb-20 sm:pb-3 bg-fill-1 space-y-3">
                {loading ? (
                  <div className="flex flex-col justify-center items-center h-48 space-y-3 text-ink-2">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent"></div>
                    <span className="text-xs font-medium">Memuat daftar tugas...</span>
                  </div>
                ) : filteredTasks.length === 0 ? (
                  <div className="text-center py-16 px-4 text-ink-2 space-y-2 bg-surface rounded-2xl border border-divider shadow-xs">
                    <CheckCircle2 size={40} className="mx-auto text-accent/40 mb-2" />
                    <p className="text-sm font-semibold text-ink">
                      {searchQuery ? 'Tidak ada jadwal yang cocok' : 'Belum ada jadwal tugas hari ini'}
                    </p>
                    <p className="text-xs text-ink-2 max-w-xs mx-auto">
                      {searchQuery
                        ? 'Coba kata kunci nama pasien atau alamat lain.'
                        : 'Pasien yang dijadwalkan oleh admin akan muncul otomatis di sini.'}
                    </p>
                  </div>
                ) : (
                  filteredTasks.map((task, idx) => (
                    <StaffTodayTaskCard
                      key={task.reservationId}
                      task={task}
                      index={idx}
                      isSelected={selectedTask?.reservationId === task.reservationId}
                      isSendingOtw={sendingOtwId === task.reservationId}
                      isCompleting={completingVisitId === task.reservationId}
                      isSendingArrival={sendingArrivalId === task.reservationId}
                      isSupervisor={isSupervisor}
                      onOpenDetail={setDetailModalTask}
                      onOpenPayment={setPaymentModalTask}
                      onReassign={setReassignModalTask}
                      onReassignStaffChange={setReassignSelectedStaffId}
                      onShowImage={(kind, url) => {
                        setZoomImageKind(kind);
                        setZoomImageUrl(url);
                      }}
                      onComplete={handleCompleteVisit}
                      onOpenChat={handleOpenChat}
                      onOpenQris={handleOpenQrisFast}
                      onEditLocation={handleOpenUpdateLocationModal}
                      onRecordArrival={handleRecordArrival}
                      onNavigate={requestNavigation}
                      onToast={toast}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Right Column: WhatsApp Live Chat Canvas */}
            <div
              className={`${
                mobileView === 'list' ? 'hidden md:flex' : 'flex'
              } flex-1 flex-col bg-content overflow-hidden relative min-h-0 h-full`}
            >
              {selectedTask ? (
                <>
                  {/* WhatsApp Web Chat Header - safe-area for notch/Dynamic Island */}
                  <StaffChatHeader
                    task={selectedTask}
                    isCompleting={completingVisitId === selectedTask.reservationId}
                    isSendingArrival={sendingArrivalId === selectedTask.reservationId}
                    isSendingOtw={sendingOtwId === selectedTask.reservationId}
                    isOverdue={isScheduleOverdue(selectedTask)}
                    isTimeForArrival={isTimeForArrival(selectedTask)}
                    isOtwReady={isOtwAllowed(selectedTask)}
                    onBackToList={handleBackToList}
                    onOpenDetail={setDetailModalTask}
                    onNavigate={requestNavigation}
                    onOpenPayment={setPaymentModalTask}
                    onComplete={handleCompleteVisit}
                    onRecordArrival={handleRecordArrival}
                  />

                  {/* WhatsApp Chat Bubbles Viewport (Warm Beige Wallpaper Canvas) */}
                  <StaffChatThread
                    task={selectedTask}
                    messages={messages}
                    loadingMessages={loadingMessages}
                    staffName={staff?.name}
                    isSupervisor={isSupervisor}
                    gatewayCapability={gatewayCapability}
                    revokingId={revokingId}
                    failedMessages={failedMessages}
                    retryingTempId={retryingTempId}
                    chatContainerRef={chatContainerRef}
                    messagesEndRef={messagesEndRef}
                    onScroll={handleChatScroll}
                    onScrollToBottom={() => scrollToBottom(false)}
                    onStartEdit={handleStartEdit}
                    onRevoke={handleRevokeMessage}
                    onRetry={retryFailedMessage}
                  />

                  {/* WhatsApp Quick Reply Input Bar */}
                  <StaffChatComposer
                    task={selectedTask}
                    staffName={staff?.name}
                    replyText={replyText}
                    replyTextareaRef={replyTextareaRef}
                    selectedImage={selectedImage}
                    sending={sending}
                    isSendingPaymentInfo={isSendingPaymentInfo}
                    chatFileInputRef={chatFileInputRef}
                    chatGalleryInputRef={chatGalleryInputRef}
                    onReplyTextChange={handleReplyTextChange}
                    onSetReplyText={setReplyText}
                    onRemoveImage={() => setSelectedImage(null)}
                    onPickImage={handlePickImage}
                    onSend={handleSendReply}
                    onSendPaymentInfo={handleSendPaymentInfo}
                    onRecordArrival={handleRecordArrival}
                  />
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-ink-2 space-y-4 bg-fill-1/40">
                  <div className="h-16 w-16 rounded-3xl bg-surface flex items-center justify-center text-accent shadow-xs border border-divider">
                    <MessageSquare size={32} />
                  </div>
                  <div className="space-y-1 max-w-sm">
                    <h3 className="font-bold text-ink text-base">Pilih Jadwal Pasien</h3>
                    <p className="text-xs text-ink-2 leading-relaxed">
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
          <div className="flex-1 overflow-y-auto p-4 pb-20 sm:p-6 max-w-5xl mx-auto w-full space-y-6 animate-fadeIn">
            {/* Search Bar */}
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-ink-2">
                <Search size={16} />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari pasien, alamat, atau layanan..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface border border-divider focus:border-accent text-[16px] sm:text-sm text-ink placeholder-ink-3 focus:outline-none transition shadow-xs"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-ink-2 hover:text-ink text-xs font-bold"
                >
                  ✕
                </button>
              )}
            </div>

            {loading ? (
              <div className="flex flex-col justify-center items-center h-64 space-y-3 text-ink-2">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-accent border-t-transparent"></div>
                <span className="text-xs font-medium">Memuat jadwal reservasi mendatang...</span>
              </div>
            ) : Object.keys(groupedUpcoming).length === 0 ? (
              <div className="text-center py-20 px-4 text-ink-2 space-y-3 bg-surface rounded-2xl border border-divider shadow-xs">
                <CheckCircle2 size={48} className="mx-auto text-accent/40" />
                <div className="space-y-1 max-w-sm mx-auto">
                  <h3 className="text-base font-bold text-ink">
                    {searchQuery ? 'Tidak Ada Jadwal yang Cocok' : 'Belum Ada Jadwal Mendatang'}
                  </h3>
                  <p className="text-xs text-ink-2 leading-relaxed">
                    {searchQuery
                      ? 'Coba gunakan kata kunci pencarian yang lain.'
                      : 'Reservasi pasien untuk hari esok dan seterusnya yang ditugaskan kepada Anda akan tampil di sini.'}
                  </p>
                </div>
              </div>
            ) : (
              Object.entries(groupedUpcoming).map(([dateLabel, items]) => (
                <StaffUpcomingCard
                  key={dateLabel}
                  dateLabel={dateLabel}
                  items={items}
                  onOpenDetail={setDetailModalTask}
                  onEditLocation={handleOpenUpdateLocationModal}
                  onNavigate={requestNavigation}
                  onSearchQuery={setSearchQuery}
                  onShowImage={(kind, url) => {
                    setZoomImageKind(kind);
                    setZoomImageUrl(url);
                  }}
                />
              ))
            )}
          </div>
        ) : (
          /* ========================================================================= */
          /* TAB 3: TREATMENT YANG SUDAH DILAKUKAN (SELESAI, 1 PAGE) */
          /* ========================================================================= */
          <div className="flex-1 overflow-y-auto p-4 pb-20 sm:p-6 max-w-5xl mx-auto w-full space-y-6 animate-fadeIn">
            {/* Header / Summary Metrics */}
            <div className="grid grid-cols-1 gap-3.5">
              <div className="bg-surface p-4 rounded-2xl border border-divider shadow-xs flex items-center space-x-3.5">
                <div className="h-11 w-11 rounded-2xl bg-bubble-out text-accent flex items-center justify-center flex-shrink-0 border border-accent/30">
                  <CheckCircle2 size={22} />
                </div>
                <div>
                  <div className="text-[11px] font-bold text-ink-2 uppercase tracking-wider">Total Selesai</div>
                  <div className="text-lg font-extrabold text-ink">
                    {completedTasks.length} <span className="text-xs font-semibold text-ink-2">Treatment</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Search Bar */}
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-ink-2">
                <Search size={16} />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari pasien, alamat, atau layanan..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface border border-divider focus:border-accent text-[16px] sm:text-sm text-ink placeholder-ink-3 focus:outline-none transition shadow-xs"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-ink-2 hover:text-ink text-xs font-bold"
                >
                  ✕
                </button>
              )}
            </div>

            {loading ? (
              <div className="flex flex-col justify-center items-center h-64 space-y-3 text-ink-2">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-accent border-t-transparent"></div>
                <span className="text-xs font-medium">Memuat riwayat treatment selesai...</span>
              </div>
            ) : Object.keys(groupedCompleted).length === 0 ? (
              <div className="text-center py-20 px-4 text-ink-2 space-y-3 bg-surface rounded-2xl border border-divider shadow-xs">
                <CheckCircle2 size={48} className="mx-auto text-accent/40" />
                <div className="space-y-1 max-w-sm mx-auto">
                  <h3 className="text-base font-bold text-ink">
                    {searchQuery ? 'Tidak Ada Riwayat yang Cocok' : 'Belum Ada Treatment Selesai'}
                  </h3>
                  <p className="text-xs text-ink-2 leading-relaxed">
                    {searchQuery
                      ? 'Coba gunakan kata kunci pencarian yang lain.'
                      : 'Riwayat tugas treatment yang telah Anda selesaikan atau dibayar akan otomatis tercatat di sini.'}
                  </p>
                </div>
              </div>
            ) : (
              Object.entries(groupedCompleted).map(([dateLabel, items]) => (
                <StaffCompletedCard
                  key={dateLabel}
                  dateLabel={dateLabel}
                  items={items}
                  isSendingPaymentInfo={isSendingPaymentInfo}
                  onOpenDetail={setDetailModalTask}
                  onOpenPayment={setPaymentModalTask}
                  onOpenChat={handleOpenChat}
                  onOpenQris={handleOpenQrisFast}
                  onSendPaymentInfo={handleSendPaymentInfo}
                  onShowImage={(kind, url) => {
                    setZoomImageKind(kind);
                    setZoomImageUrl(url);
                  }}
                />
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
          className="modal-backdrop fixed inset-0 bg-black/40 transition-opacity duration-300"
          onClick={() => setShowMenuDrawer(false)}
        />

        {/* Drawer Body (Notch-safe, lebar optimal mobile) */}
        <div
          className={`relative w-[75vw] sm:w-[280px] max-w-[300px] sm:max-w-[280px] bg-surface h-full shadow-2xl flex flex-col z-10 transform transition-transform duration-300 ease-out ${
            showMenuDrawer ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
            {/* Drawer Header — safe-area atas agar tidak tertutup notch / Dynamic Island */}
            <div className="px-3 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] pb-3 bg-accent text-on-solid flex items-center justify-between shadow-xs">
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
                className="h-7 w-7 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition active:scale-95 flex-shrink-0 ml-1"
                title="Tutup Menu (atau Usap ke Kanan)"
              >
                <X size={15} />
              </button>
            </div>

            {/* Navigation Menu List */}
            <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
              <div className="px-1.5 py-0.5 text-[10px] font-bold text-ink-2 uppercase tracking-wider">
                Menu Jadwal
              </div>

              {/* Menu 1: Treatment Hari Ini */}
              <button
                type="button"
                onClick={() => {
                  handleTabChange('today');
                  setShowMenuDrawer(false);
                }}
                className={`w-full flex items-center justify-between p-2 rounded-xl transition text-left ${
                  activeTab === 'today'
                    ? 'bg-bubble-out text-accent font-bold shadow-xs border border-accent/30'
                    : 'bg-fill-1 hover:bg-fill-2 text-ink'
                }`}
              >
                <div className="flex items-center space-x-2 min-w-0">
                  <div
                    className={`h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      activeTab === 'today' ? 'bg-accent text-on-solid' : 'bg-surface text-accent shadow-xs'
                    }`}
                  >
                    <Calendar size={14} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate">Hari Ini</div>
                    <div className="text-[10px] text-ink-2 font-normal truncate hidden sm:block">
                      Pasien aktif
                    </div>
                  </div>
                </div>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ml-1 ${
                    activeTab === 'today' ? 'bg-accent text-on-solid' : 'bg-surface text-accent border border-divider'
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
                className={`w-full flex items-center justify-between p-2 rounded-xl transition text-left ${
                  activeTab === 'upcoming'
                    ? 'bg-bubble-out text-accent font-bold shadow-xs border border-accent/30'
                    : 'bg-fill-1 hover:bg-fill-2 text-ink'
                }`}
              >
                <div className="flex items-center space-x-2 min-w-0">
                  <div
                    className={`h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      activeTab === 'upcoming' ? 'bg-accent text-on-solid' : 'bg-surface text-accent shadow-xs'
                    }`}
                  >
                    <Clock size={14} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate">Mendatang</div>
                    <div className="text-[10px] text-ink-2 font-normal truncate hidden sm:block">
                      Hari esok+
                    </div>
                  </div>
                </div>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ml-1 ${
                    activeTab === 'upcoming' ? 'bg-accent text-on-solid' : 'bg-surface text-accent border border-divider'
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
                className={`w-full flex items-center justify-between p-2 rounded-xl transition text-left ${
                  activeTab === 'completed'
                    ? 'bg-bubble-out text-accent font-bold shadow-xs border border-accent/30'
                    : 'bg-fill-1 hover:bg-fill-2 text-ink'
                }`}
              >
                <div className="flex items-center space-x-2 min-w-0">
                  <div
                    className={`h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      activeTab === 'completed' ? 'bg-accent text-on-solid' : 'bg-surface text-accent shadow-xs'
                    }`}
                  >
                    <CheckCircle2 size={14} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate">Selesai</div>
                    <div className="text-[10px] text-ink-2 font-normal truncate hidden sm:block">
                      Riwayat
                    </div>
                  </div>
                </div>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ml-1 ${
                    activeTab === 'completed' ? 'bg-accent text-on-solid' : 'bg-surface text-accent border border-divider'
                  }`}
                >
                  {completedTasks.length}
                </span>
              </button>
            </div>

            {/* Drawer Footer Actions — safe-area bawah untuk home indicator iPhone */}
            <div className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] border-t border-divider dark:border-divider bg-surface-2 space-y-1.5">
              {isSupervisor && (
                <button
                  type="button"
                  onClick={() => {
                    setShowMenuDrawer(false);
                    window.location.href = '/admin/overview';
                  }}
                  className="w-full flex items-center justify-center space-x-1.5 py-2 px-2.5 rounded-xl bg-accent hover:bg-accent-hover text-[11px] font-bold text-on-solid shadow-xs transition active:scale-95"
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
                className="w-full flex items-center justify-center space-x-1.5 py-2 px-2.5 rounded-xl bg-surface hover:bg-fill-2 text-[11px] font-semibold text-ink border border-divider shadow-xs transition active:scale-95"
              >
                <Info size={13} className="text-accent flex-shrink-0" />
                <span className="truncate">Profil Akun</span>
              </button>

              {/* Seksi Preferensi & Pengaturan: Notifikasi + Mode Terang/Gelap */}
              <div className="pt-2 mt-1 border-t border-divider">
                <div className="px-1.5 pb-1.5 text-[10px] font-bold text-ink-2 uppercase tracking-wider">
                  Preferensi & Pengaturan
                </div>

                <button aria-label={pushStatus === 'granted' ? 'Notifikasi perangkat aktif. Klik untuk uji coba bunyi & banner.' : 'Klik untuk mengaktifkan notifikasi penugasan di perangkat ini'}
                  type="button"
                  onClick={handleSyncPush}
                  disabled={pushSyncing}
                  className={`w-full flex items-center justify-between p-2 rounded-xl border transition active:scale-95 shadow-xs disabled:opacity-60 ${
                    pushStatus === 'granted'
                      ? 'bg-success-soft hover:bg-success-line text-success border-success-line'
                      : 'bg-warning-soft hover:bg-warning-line text-warning border-warning-line'
                  }`}
                  title={
                    pushStatus === 'granted'
                      ? 'Notifikasi perangkat aktif. Klik untuk uji coba bunyi & banner.'
                      : 'Klik untuk mengaktifkan notifikasi penugasan di perangkat ini'
                  }
                >
                  <span className="flex items-center space-x-2 min-w-0">
                    {pushStatus === 'granted' ? (
                      <Bell size={14} className={pushSyncing ? 'animate-bounce' : ''} />
                    ) : (
                      <BellRing size={14} />
                    )}
                    <span className="text-[11px] font-semibold truncate">
                      {pushStatus === 'granted' ? 'Notifikasi Aktif' : 'Aktifkan Notifikasi'}
                    </span>
                  </span>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                    pushStatus === 'granted' ? 'bg-success text-on-solid' : 'bg-warning text-on-solid'
                  }`}>
                    {pushStatus === 'granted' ? 'ON' : 'OFF'}
                  </span>
                </button>

                <div className="mt-1.5 flex items-center justify-between p-2 rounded-xl bg-fill-1 border border-divider">
                  <span className="flex items-center space-x-2 min-w-0 text-ink">
                    <span className="text-[11px] font-semibold truncate">Mode Terang / Gelap</span>
                  </span>
                  <ThemeToggle size={15} />
                </div>
              </div>

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
                className="w-full flex items-center justify-center space-x-1.5 py-2 px-2.5 rounded-xl bg-danger-soft hover:bg-danger-line text-[11px] font-semibold text-danger border border-danger-line shadow-xs transition active:scale-95"
              >
                <LogOut size={13} className="flex-shrink-0" />
                <span className="truncate">Keluar</span>
              </button>

              {/* Version & Build Timestamp */}
              <div className="pt-1 text-center text-[9px] text-ink-3 truncate">
                Staff Portal {APP_VERSION}
              </div>
            </div>
          </div>
        </div>

      {/* ========================================================================= */}
      {/* MODAL / DRAWER PROFIL STAFF & LOGOUT */}
      {/* ========================================================================= */}
      {showStaffProfileModal && (
        <Modal
          open
          onClose={() => setShowStaffProfileModal(false)}
          size="sm"
          bodyClassName="p-6 space-y-5 text-center"
          title="Profil Terapis"
        >
            {/* Avatar Icon */}
            <div className="mx-auto h-20 w-20 rounded-3xl bg-accent-soft border-2 border-accent/30 text-accent flex items-center justify-center shadow-inner">
              <UserCheck size={40} />
            </div>

            {/* Staff Info */}
            <div className="space-y-1">
              <h3 className="font-bold text-lg text-ink">
                {currentStaff?.name || 'Terapis'}
              </h3>
              <p className="text-xs text-ink-2 font-mono">
                {currentStaff?.phone || 'Akun Sistem'}
              </p>
              <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-bubble-out text-accent border border-accent/30 mt-1">
                {isSupervisor ? 'Supervisor CS & Terapis' : 'Staff Terapis Lapangan'}
              </span>
            </div>

            {/* Telegram Dispatch Card */}
            <div className="p-3.5 bg-surface-2 border border-success-line rounded-2xl text-left space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-ink flex items-center space-x-1.5">
                  <Send size={13} className="text-accent" />
                  <span>Notifikasi Telegram Tugas</span>
                </span>
                {telegramPairingInfo?.isConnected ? (
                  <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-success-soft text-success">
                    <CheckCircle2 size={10} className="text-success" />
                    <span>Terhubung</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-warning-soft text-warning">
                    <span>Belum Aktif</span>
                  </span>
                )}
              </div>

              <p className="text-[11px] text-ink-2 leading-relaxed">
                Terima rincian jadwal kunjungan pasien, patokan rumah, navigasi Google Maps, dan status bayar langsung di Telegram pribadi Anda.
              </p>

              {loadingTelegramInfo ? (
                <div className="text-[11px] text-ink-3 animate-pulse">Memeriksa status Telegram...</div>
              ) : telegramPairingInfo?.isConnected ? (
                <div className="pt-1 flex items-center justify-between text-[11px]">
                  <span className="text-ink-2 text-[10px] font-mono">ID: {telegramPairingInfo.telegramChatId}</span>
                  <a
                    href={telegramPairingInfo.directLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline font-bold text-[11px]"
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
                    className="w-full py-2 px-3 bg-accent hover:bg-accent-hover text-on-solid rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 shadow-xs"
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
                className="w-full py-3 px-4 bg-danger-soft hover:bg-danger-line text-danger border border-danger-line rounded-2xl text-sm font-bold transition flex items-center justify-center space-x-2 shadow-xs"
              >
                <LogOut size={16} />
                <span>Keluar Akun (Logout)</span>
              </button>
            </div>
        </Modal>
      )}

      {/* ========================================================================= */}
      {/* MODAL DETAIL JADWAL & PASIEN (PRIVACY SAFE - NO PHONE LEAK) */}
      {/* ========================================================================= */}
      {detailModalTask && (
        <StaffTaskDetailModal
          task={detailModalTask}
          timeLabel={formatTime(detailModalTask.bookingDate)}
          chatOpen={isChatWindowOpen(detailModalTask)}
          onClose={() => setDetailModalTask(null)}
          onEditLocation={handleOpenUpdateLocationModal}
          onOpenPayment={setPaymentModalTask}
          onSendPaymentInfo={handleSendPaymentInfo}
          isSendingPaymentInfo={isSendingPaymentInfo}
          onShowImage={(kind: DetailImageKind, url: string) => {
            setZoomImageKind(kind);
            setZoomImageUrl(url);
          }}
          onOpenChat={handleOpenChat}
          onNavigate={requestNavigation}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL CATAT PEMBAYARAN (TUNAI VS NON-TUNAI / TRANSFER / QRIS) */}
      {/* ========================================================================= */}
      {paymentModalTask && (
        <StaffPaymentModal
          task={paymentModalTask}
          paymentInfo={paymentInfo}
          loadingPaymentInfo={loadingPaymentInfo}
          initialMethod={paymentInitialMethod}
          submitting={submittingPayment}
          onClose={() => {
            setPaymentModalTask(null);
            setPaymentInitialMethod('CASH');
          }}
          onOpenQris={() => setQrisZoomModal(true)}
          onCopyAccount={handleCopyAccountNumber}
          onSubmit={handleSubmitPayment}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL FULLSCREEN QRIS LIGHTBOX (UNTUK DITUNJUKKAN & DISCAN PASIEN) */}
      {/* ========================================================================= */}
      {qrisZoomModal && (
        <div
          className="modal-backdrop fixed inset-0 z-[150] flex flex-col items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn"
          onClick={() => setQrisZoomModal(false)}
        >
          <div
            className="bg-surface rounded-3xl p-6 max-w-sm w-full shadow-2xl flex flex-col items-center space-y-4 animate-modalScaleUp text-center relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setQrisZoomModal(false)}
              className="absolute top-3 right-3 p-2 rounded-full bg-fill-1 hover:bg-fill-2 text-ink-2 transition"
              title="Tutup QRIS"
            >
              <X size={18} />
            </button>

            <div className="space-y-1 pt-2">
              <h3 className="font-bold text-base text-ink">Scan QRIS Resmi Klinik</h3>
              <p className="text-xs text-ink-2">
                Arahkan kamera e-wallet / mobile banking pasien ke barcode di bawah ini
              </p>
            </div>

            <div className="p-4 bg-surface rounded-2xl border-2 border-divider shadow-inner">
              <img
                src={paymentInfo?.qrisImageUrl || ''}
                alt="QRIS Fullscreen"
                className="w-64 h-64 sm:w-72 sm:h-72 object-contain"
              />
            </div>

            <button
              type="button"
              onClick={() => setQrisZoomModal(false)}
              className="w-full py-2.5 rounded-xl bg-accent text-on-solid text-xs font-bold hover:bg-accent-hover transition active:scale-95 shadow-xs"
            >
              Tutup Tampilan QRIS
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL UPDATE TITIK LOKASI & FOTO RUMAH */}
      {/* ========================================================================= */}
      {updateLocationModalTask && (
        <StaffLocationModal
          task={updateLocationModalTask}
          mode={locModalMode}
          hasSavedLocData={hasSavedLocData}
          coords={locCoords}
          housePhotoB64={locHousePhotoB64}
          landmark={locLandmark}
          gettingGps={locGettingGps}
          gpsAttemptInfo={gpsAttemptInfo}
          processingPhoto={locProcessingPhoto}
          submitting={submittingLoc}
          onClose={() => setUpdateLocationModalTask(null)}
          onModeChange={setLocModalMode}
          onGetGps={handleGetCurrentGps}
          onPickPhoto={handleProcessStaffHousePhoto}
          onRemovePhoto={() => setLocHousePhotoB64(null)}
          onLandmarkChange={setLocLandmark}
          onShowSavedPhoto={(url) => {
            setZoomImageKind('house');
            setZoomImageUrl(url);
          }}
          onSave={handleSaveLocation}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL ZOOM LIGHTBOX FOTO RUMAH / BUKTI BAYAR */}
      {/* ========================================================================= */}
      {zoomImageUrl && (
        <div
          className="modal-backdrop fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn"
          onClick={() => {
            setZoomImageUrl(null);
            setZoomImageKind(null);
          }}
        >
          <div className="relative max-w-2xl w-full max-h-[90vh] flex flex-col items-center">
            <button
              onClick={() => {
                setZoomImageUrl(null);
                setZoomImageKind(null);
              }}
              className="absolute -top-10 right-0 p-2 text-white/80 hover:text-white transition"
              title="Tutup Foto"
            >
              <X size={24} />
            </button>
            <img
              src={zoomImageUrl}
              alt={zoomImageKind === 'proof' ? 'Bukti Pembayaran' : 'Foto Depan Rumah'}
              className="max-h-[80vh] w-auto rounded-2xl shadow-2xl object-contain border border-white/20"
              onClick={(e) => e.stopPropagation()}
            />
            <div className="mt-2 text-xs text-white/80 font-medium">
              {zoomImageKind === 'proof' ? '🧾 Bukti Pembayaran Pasien' : '🏠 Foto Panduan Tampak Depan Rumah Pasien'}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL EDIT PESAN WHATSAPP */}
      {/* ========================================================================= */}
      {editingMsg && (
        <Modal
          open
          onClose={() => setEditingMsg(null)}
          size="md"
          title={
            <span className="flex items-center gap-2">
              <PenLine size={16} className="text-accent" aria-hidden="true" />
              <span>Edit Pesan WhatsApp</span>
            </span>
          }
          footer={
            <>
              <button
                type="button"
                onClick={() => setEditingMsg(null)}
                disabled={isEditingSaving}
                className="px-4 py-2 bg-surface hover:bg-fill-1 border border-divider text-ink rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={isEditingSaving || !editContent.trim()}
                className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-on-solid rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-xs cursor-pointer"
              >
                {isEditingSaving ? (
                  <>
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
                    <span>Menyimpan...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={14} aria-hidden="true" />
                    <span>Simpan Perubahan</span>
                  </>
                )}
              </button>
            </>
          }
        >
          <div className="p-3 bg-warning-soft border border-warning-line rounded-xl text-[11px] text-warning space-y-1">
            <p className="font-bold flex items-center gap-1.5">
              <Info size={13} className="text-warning shrink-0" aria-hidden="true" />
              Batas Waktu Edit WhatsApp: 15 Menit
            </p>
            <p className="text-warning leading-relaxed">
              WhatsApp hanya mengizinkan pengeditan pesan dalam 15 menit pertama. Pesan yang diedit akan otomatis memiliki label <i>(Diedit)</i> di HP penerima.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="staff-edit-message" className="block text-[11px] font-bold text-ink">
              Isi Pesan Baru
            </label>
            <textarea
              id="staff-edit-message"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={4}
              placeholder="Ketik perbaikan teks pesan..."
              className="w-full bg-surface border border-divider rounded-xl p-3 text-[16px] sm:text-sm text-ink placeholder-ink-3 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition shadow-xs leading-relaxed"
            />
          </div>
        </Modal>
      )}

      {/* ========================================================================= */}
      {/* MODAL DELEGASI JADWAL TERAPIS (KHUSUS SUPERVISOR / SPV CS) */}
      {/* ========================================================================= */}
      {reassignModalTask && (
        <Modal
          open
          onClose={() => setReassignModalTask(null)}
          size="sm"
          title={
            <span className="flex items-center gap-2">
              <ArrowRightLeft size={16} className="text-violet" aria-hidden="true" />
              <span>Delegasikan Jadwal</span>
            </span>
          }
          subtitle={`Pasien: ${reassignModalTask.customerName || 'Bunda'}`}
          footer={
            <>
              <button
                type="button"
                onClick={() => setReassignModalTask(null)}
                disabled={submittingReassign}
                className="px-4 py-2 bg-surface hover:bg-fill-1 border border-divider text-ink rounded-xl text-xs font-semibold transition cursor-pointer"
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
                className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-on-solid rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-xs cursor-pointer"
              >
                {submittingReassign ? (
                  <>
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
                    <span>Menyimpan...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={14} aria-hidden="true" />
                    <span>Simpan Delegasi</span>
                  </>
                )}
              </button>
            </>
          }
        >
          <div className="p-2.5 bg-fill-1 rounded-xl text-xs space-y-1">
            <p className="text-[11px] text-ink-2">
              Treatment: <span className="font-semibold text-ink">{reassignModalTask.treatmentDetail || 'Spa Homecare'}</span>
            </p>
            <p className="text-[11px] text-ink-2">
              Terapis Saat Ini: <span className="font-bold text-violet">{reassignModalTask.assignedStaff?.name || 'Belum Ditugaskan'}</span>
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="reassign-staff" className="block text-xs font-bold text-ink">
              Pilih Terapis Pengganti / Baru:
            </label>
            <select
              id="reassign-staff"
              value={reassignSelectedStaffId}
              onChange={(e) => setReassignSelectedStaffId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-fill-1 border-0 text-xs font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-accent cursor-pointer"
            >
              <option value="" disabled>-- Pilih Terapis Tim --</option>
              {teamMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.role || 'Staff'})
                </option>
              ))}
            </select>
          </div>
        </Modal>
      )}

      {/* ========================================================================= */}
      {/* STICKY BOTTOM NAVIGATION BAR (Thumb-Zone Ergonomics, Mobile Only) */}
      {/* ========================================================================= */}
      {!(mobileView === 'chat' && activeTab === 'today') && (
        <nav
          aria-label="Navigasi Utama Bawah"
          className="sm:hidden sticky bottom-0 z-30 bg-surface border-t border-divider dark:border-divider shadow-[0_-2px_8px_rgba(0,0,0,0.06)] flex items-stretch justify-around gap-1 px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom,0px))] shrink-0"
        >
          <button
            type="button"
            onClick={() => handleTabChange('today')}
            aria-current={activeTab === 'today' ? 'page' : undefined}
            className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[58px] rounded-xl transition active:scale-95 ${
              activeTab === 'today' ? 'text-accent bg-bubble-out dark:bg-accent/20' : 'text-ink-2 hover:text-ink dark:hover:text-ink hover:bg-fill-1'
            }`}
          >
            <Calendar size={20} />
            <span className="text-[11px] font-bold leading-none">Hari Ini</span>
            {activeTodayTasks.length > 0 && (
              <span className={`absolute top-1 right-[22%] min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${
                activeTab === 'today' ? 'bg-accent text-on-solid' : 'bg-fill-2 dark:bg-fill-1 text-ink-2'
              }`}>
                {activeTodayTasks.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('upcoming')}
            aria-current={activeTab === 'upcoming' ? 'page' : undefined}
            className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[58px] rounded-xl transition active:scale-95 ${
              activeTab === 'upcoming' ? 'text-accent bg-bubble-out dark:bg-accent/20' : 'text-ink-2 hover:text-ink dark:hover:text-ink hover:bg-fill-1'
            }`}
          >
            <Clock size={20} />
            <span className="text-[11px] font-bold leading-none">Mendatang</span>
            {upcomingTasks.length > 0 && (
              <span className={`absolute top-1 right-[22%] min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${
                activeTab === 'upcoming' ? 'bg-accent text-on-solid' : 'bg-fill-2 dark:bg-fill-1 text-ink-2'
              }`}>
                {upcomingTasks.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('completed')}
            aria-current={activeTab === 'completed' ? 'page' : undefined}
            className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[58px] rounded-xl transition active:scale-95 ${
              activeTab === 'completed' ? 'text-accent bg-bubble-out dark:bg-accent/20' : 'text-ink-2 hover:text-ink dark:hover:text-ink hover:bg-fill-1'
            }`}
          >
            <CheckCircle2 size={20} />
            <span className="text-[11px] font-bold leading-none">Selesai</span>
            {combinedCompletedTasks.length > 0 && (
              <span className={`absolute top-1 right-[22%] min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${
                activeTab === 'completed' ? 'bg-accent text-on-solid' : 'bg-fill-2 dark:bg-fill-1 text-ink-2'
              }`}>
                {combinedCompletedTasks.length}
              </span>
            )}
          </button>
        </nav>
      )}

      {/* Gerbang pengaman pra-navigasi (insiden Bidan tersasar): mencegah
          titik estimasi membuka Google Maps tanpa konfirmasi patokan. */}
      <NavigationPreflightModal
        open={!!preflightTask}
        task={
          preflightTask
            ? {
                customerName: preflightTask.customerName,
                address: {
                  fullText: preflightTask.address.fullText,
                  landmark: preflightTask.address.landmark,
                  addressDetail: preflightTask.address.addressDetail,
                },
              }
            : null
        }
        onClose={() => setPreflightTask(null)}
        onProceedNavigation={() => {
          const task = preflightTask;
          setPreflightTask(null);
          if (task) handleUnifiedDepart(task, task.navigationUrl || task.mapsUrl || null);
        }}
        onRequestShareloc={handleRequestShareloc}
      />

      {/* Modal konfirmasi OTW terpadu — satu-satunya titik kirim pesan OTW. */}
      <OtwConfirmModal
        open={!!otwModal}
        patientName={otwModal?.task.customerName || 'Bunda'}
        draft={otwModal?.draft || ''}
        depart={otwDepart}
        gpsChecking={otwGpsChecking}
        sending={!!sendingOtwId}
        onRetryGps={retryOtwGps}
        onConfirm={confirmOtwDepart}
        onClose={() => {
          if (sendingOtwId) return;
          setOtwModal(null);
          setOtwDepart(null);
        }}
      />
    </div>
  );
};
