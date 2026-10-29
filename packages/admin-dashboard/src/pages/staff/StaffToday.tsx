import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
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
  Heart,
  CheckCircle2,
  Navigation,
  CreditCard,
  Baby,
  Search,
  CheckCheck,
  Check,
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
  ExternalLink,
  Pencil,
  ArrowLeft,
  Ban,
  AlertCircle,
  Play,
  Volume2,
  WifiOff,
  Bell,
  BellRing,
  QrCode,
  Copy,
  Home,
} from 'lucide-react';
import { MediaImage, ChatMediaData } from '../../components/common/MediaImage';
import { VoiceNotePlayer } from '../../components/common/VoiceNotePlayer';
import {
  extractMedia,
  extractLocation,
  extractAudio,
  extractImageCaption,
  resolveMessageDisplayText,
  maskPhoneInTextClient,
  ChatLocationData,
  ChatAudioData,
} from '../../utils/mediaExtractor';
import { CustomerAvatar } from '../../components/common/CustomerAvatar';
import { emitBootPhase } from '../../lib/bootProgress';
import { APP_VERSION, BUILD_TIME } from '../../config/version';
import { compressImageFile, compressDataUrl, prepareChatImage, resolveCompressProfile } from '../../utils/imageCompressor';
import { stampGpsWatermark } from '../../utils/imageWatermark';
import { formatChatDateSeparatorWib, isDifferentDayWib, formatWibTime, getTodayWibDateKey, getWibDateKey } from '../../utils/dateWib';
import { formatPatientName, formatChildAgeText } from '../../utils/staffDisplayFormat';
import { formatClinicalAge } from '../../utils/clinicalAge';
import { ThemeToggle } from '../../components/common/ThemeToggle';
import { useTripTelemetry } from '../../hooks/useTripTelemetry';
import {
  calculateHaversineKm,
  estimateTravelMinutesKm,
  getOtwGate,
  isWithinGpsWarmupWindow,
  formatWibClock,
  needsNavigationPreflight,
  getLocationBadgeConfig,
  startDepartGpsWarmup,
  stopDepartGpsWarmup,
  getDepartPositionFast,
} from '../../utils/geoUtils';
import { NavigationPreflightModal } from '../../components/staff/NavigationPreflightModal';
import { OtwConfirmModal } from '../../components/staff/OtwConfirmModal';
import { needsHousePhoto, resolveLocModalMode } from './housePhotoGuard';
import { resolveTaskAction } from './taskAction';

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
  addressDetail?: string | null;
  locationSource?: 'gps_pin' | 'estimated_area' | 'manual_staff' | null;
  addressSource?: 'card' | 'profile' | null;
  addressUpdatedAt?: string | null;
}

/**
 * Badge deterministik status akurasi koordinat pada kartu tugas terapis.
 * Sumber: `location_source` dari server (state, bukan tebakan klien).
 * Tujuan: terapis tahu apakah titik = pin rumah presisi atau estimasi wilayah
 * (wajib minta shareloc/patokan) → mencegah terapis tersasar.
 */
function AccuracyBadge({ source }: { source?: string | null }) {
  const badge = getLocationBadgeConfig(source);
  if (!badge.source) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold ${badge.badgeClass} px-1.5 py-0.5 rounded-md`}
      title={
        badge.source === 'gps_pin'
          ? 'Titik koordinat presisi dari pin GPS / shareloc pasien.'
          : badge.source === 'manual_staff'
            ? 'Titik koordinat diverifikasi oleh bidan/staf di lapangan.'
            : 'Titik masih estimasi wilayah (belum ada pin GPS rumah). Konfirmasi shareloc/patokan ke pasien sebelum berangkat.'
      }
    >
      {badge.source === 'estimated_area' ? <AlertTriangle size={10} /> : null}
      {badge.label}
    </span>
  );
}

/**
 * R2 — Chip transparansi: seberapa BARU alamat tugas dikoreksi (server-driven
 * `address_updated_at`, bukan tebakan klien). Hanya tampil < 24 jam agar staf
 * tahu koreksi profil terbaru sudah terserap; alamat basi tidak berisik.
 */
function AddressUpdatedAtChip({ updatedAt }: { updatedAt?: string | null }) {
  if (!updatedAt) return null;
  const ts = Date.parse(updatedAt);
  if (!Number.isFinite(ts)) return null;
  const hours = (Date.now() - ts) / 36e5;
  if (hours < 0 || hours >= 24) return null;
  const label = hours < 1 ? 'kurang dari 1 jam' : `${Math.floor(hours)} jam`;
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-semibold text-warning bg-warning-soft border border-warning-line px-1.5 py-0.5 rounded-md"
      title="Alamat pelanggan dikoreksi (via chat/staf) dan sudah terserap ke tugas ini."
    >
      <RefreshCw size={10} />
      {`Alamat diperbarui ${label} lalu`}
    </span>
  );
}

interface StaffTaskPricing {
  treatmentFee: number;
  deliveryFee: number;
  totalFee: number;
  paymentStatus: 'LUNAS' | 'TAGIH_DI_TEMPAT';
  paymentStatusLabel: string;
  paymentMethod?: string | null;
  proofUrl?: string | null;
}

interface StaffTask {
  reservationId: string;
  customerName: string | null;
  treatmentDetail: string | null;
  treatmentCategory: string | null;
  bookingDate: string | null;
  status: string;
  otwSentAt?: string | null;
  arrivedAt?: string | null;
  conversationId: string | null;
  mapsUrl: string | null;
  navigationUrl: string | null;
  address: StaffTaskAddress;
  children: StaffTaskChild[];
  pricing: StaffTaskPricing;
  shareLocationText: string | null;
  customerProfilePictureUrl?: string | null;
  /** Fase 5r: catatan karakter pasien (sticky memory note) dari LiveChat. */
  adminNotes?: string | null;
  assignedStaff?: { id: string; name: string; role?: string } | null;
  /** Status jendela akses chat (server-driven, sumber kebenaran tunggal). */
  chatWindow?: {
    open: boolean;
    reason: 'SUPERVISOR' | 'OPEN' | 'NOT_YET_OPEN' | 'CLOSED_AFTER_COMPLETE' | 'PREVIOUS_DAY' | 'NO_ACTIVE_BOOKING';
    opensAt?: string | null;
    closesAt?: string | null;
  };
}

interface ChatMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  content: string;
  sender_type?: string | null;
  sender_name?: string | null;
  created_at: string;
  media?: ChatMediaData;
  delivery_status?: 'sent' | 'delivered' | 'read' | 'failed' | null;
  delivered_at?: string | null;
  read_at?: string | null;
  is_revoked?: boolean;
  is_edited?: boolean;
  quoted_message?: {
    id?: string;
    wa_message_id?: string;
    sender_name?: string | null;
    sender_type?: string | null;
    direction?: string;
    content?: string;
    media?: ChatMediaData;
  } | null;
  payload_raw?: any;
}

// extractMedia terpusat di utils/mediaExtractor.ts (single source of truth).
import { playIncomingMessageSound, initAudioUnlock, showSafeNotification } from '../../services/notificationSound';
import { subscribeToPushNotifications } from '../../services/pushNotification';

function formatRupiah(amount: number): string {
  return 'Rp ' + (amount || 0).toLocaleString('id-ID');
}

// Helper: ekstraksi quoted_message dari berbagai bentuk payload_raw — dengan sanitasi PII terapis (maskPhoneInTextClient)
function extractQuotedMessage(msg: ChatMessage, maskPhone = true): NonNullable<ChatMessage['quoted_message']> | null {
  const mask = (s: string): string => (maskPhone ? maskPhoneInTextClient(s) : s);
  const direct = (msg as any).quoted_message;
  if (direct && (direct.content || direct.media)) {
    const sanitized: any = { ...direct };
    if (typeof sanitized.content === 'string' && sanitized.content) sanitized.content = mask(sanitized.content);
    if (typeof sanitized.sender_name === 'string' && sanitized.sender_name) sanitized.sender_name = mask(sanitized.sender_name);
    if (sanitized.media && typeof sanitized.media.caption === 'string') sanitized.media = { ...sanitized.media, caption: mask(sanitized.media.caption) };
    return sanitized;
  }
  const pr = (msg as any).payload_raw;
  if (!pr) return null;
  const q = pr.quoted_message || pr.quotedMessage || pr.quoted || pr.reply_to_message || pr.quotedMsg;
  if (q && (q.content || q.media || q.text)) {
    return {
      id: q.id || q.wa_message_id || q.waMessageId,
      wa_message_id: q.wa_message_id || q.waMessageId || q.id,
      sender_name: q.sender_name || q.senderName || q.sender ? mask(String(q.sender_name || q.senderName || q.sender)) : null,
      sender_type: q.sender_type || q.senderType || null,
      direction: q.direction || q.dir || undefined,
      content: mask(q.content || q.text || q.caption || ''),
      media: q.media ? { ...q.media, caption: q.media.caption ? mask(String(q.media.caption)) : undefined } : undefined,
    };
  }
  return null;
}

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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [selectedImage, setSelectedImage] = useState<{ file: File; preview: string; dataUrl: string; mimeType: string; fileName: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [sseConnected, setSseConnected] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean>(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'TRANSFER' | 'QRIS'>('CASH');
  const [proofImageB64, setProofImageB64] = useState<string | null>(null);
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
  const locHouseCameraInputRef = useRef<HTMLInputElement>(null);
  const locHouseGalleryInputRef = useRef<HTMLInputElement>(null);
  const [locProcessingPhoto, setLocProcessingPhoto] = useState(false);

  // Gateway capability (WAHA supportsRevoke=true, supportsEdit=true vs WABA supportsRevoke=false)
  const [gatewayCapability, setGatewayCapability] = useState<{ provider: string; supportsRevoke: boolean; supportsEdit?: boolean } | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // Fase 1.2: outbox pesan gagal (sinyal 1-bar). Bertahan di layar + localStorage
  // agar terapis bisa "Coba Kirim Lagi" tanpa mengetik ulang / mengambil foto ulang.
  const [failedMessages, setFailedMessages] = useState<
    Array<{
      clientTempId: string;
      conversationId: string;
      text: string;
      image?: { preview: string; dataUrl: string; mimeType: string; fileName: string } | null;
      createdAt: string;
      error: string;
    }>
  >([]);
  const [retryingTempId, setRetryingTempId] = useState<string | null>(null);

  const selectedTaskRef = useRef<StaffTask | null>(null);
  const allTasksRef = useRef<StaffTask[]>([]);
  const knownTaskIdsRef = useRef<Set<string> | null>(null);
  const prevScopeRef = useRef<string>(scopeFilter);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
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

  selectedTaskRef.current = selectedTask;
  allTasksRef.current = [...tasks, ...upcomingTasks, ...completedTasks];

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
        icon: <Baby size={18} className="text-info" />,
        bg: 'bg-info-soft border-info-line text-info',
        badge: 'bg-info-soft text-info border-info-line',
        borderAccent: 'border-l-sky-500 bg-info-soft/20',
        label: 'Baby Spa',
      };
    }
    if (cat === 'MOMS') {
      return {
        icon: <Heart size={18} className="text-violet" />,
        bg: 'bg-violet-soft border-violet-line text-violet',
        badge: 'bg-violet-soft text-violet border-violet-line',
        borderAccent: 'border-l-purple-500 bg-violet-soft/20',
        label: 'Moms Spa',
      };
    }
    if (cat === 'BOTH' || cat === 'KIDS') {
      return {
        icon: <Smile size={18} className="text-success" />,
        bg: 'bg-success-soft border-success-line text-success',
        badge: 'bg-success-soft text-success border-success-line',
        borderAccent: 'border-l-emerald-500 bg-success-soft/20',
        label: 'Moms & Baby',
      };
    }
    return {
      icon: <User size={18} className="text-success" />,
      bg: 'bg-teal-100 dark:bg-teal-950/40 border-teal-200 dark:border-teal-800/40 text-teal-700 dark:text-accent',
      badge: 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-accent border-teal-200 dark:border-teal-800/40',
      borderAccent: 'border-l-teal-500 bg-teal-50/20 dark:bg-teal-950/20',
      label: 'Treatment',
    };
  };

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

  // Tombol OTW hanya bisa ditekan maksimal 2 jam sebelum jadwal treatment s/d toleransi 15 menit setelah jadwal
  const isOtwAllowed = (task: StaffTask) => getOtwGate(task.bookingDate).allowed;

  // Benar-benar jamnya tiba: H-10 menit s/d kapan pun setelah janji, belum OTW, belum Tiba.
  const isTimeForArrival = (t: StaffTask): boolean => {
    if (!t.bookingDate || t.otwSentAt || t.arrivedAt) return false;
    const start = new Date(t.bookingDate).getTime();
    if (isNaN(start)) return false;
    return Date.now() >= start - 10 * 60 * 1000;
  };

  // Jendela akses chat: server-driven (chatWindow) dengan fallback aman bila field belum ada.
  const isChatWindowOpen = (task: StaffTask): boolean => {
    if (task.chatWindow) return task.chatWindow.open;
    // Fallback: jadwal bukan hari lampau + belum melewati batas (server tetap jadi penentu akhir).
    if (!task.bookingDate) return false;
    return getWibDateKey(task.bookingDate) >= getTodayWibDateKey();
  };

  // Pesan alasan tombol chat nonaktif (ditampilkan sebagai tooltip).
  const chatLockedTitle = (task: StaffTask): string => {
    switch (task.chatWindow?.reason) {
      case 'NOT_YET_OPEN':
        return `Chat aktif H-3 jam sebelum jadwal (${formatTime(task.bookingDate)})`;
      case 'CLOSED_AFTER_COMPLETE':
        return 'Chat sudah ditutup (1 jam setelah treatment selesai)';
      case 'PREVIOUS_DAY':
        return 'Chat riwayat kunjungan lampau tidak dapat dibuka';
      case 'NO_ACTIVE_BOOKING':
        return 'Tidak ada jadwal aktif untuk chat ini';
      default:
        return 'Chat sedang tidak dapat dibuka';
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
        timeZone: 'Asia/Jakarta',
      });
    } catch {
      return isoString;
    }
  };

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
        toast('✅ Notifikasi perangkat berhasil diaktifkan & disinkronkan!', 'success');
        showSafeNotification('🔔 Notifikasi Perangkat Aktif', {
          body: `Perangkat ${currentStaff.name || 'Bidan'} siap menerima notifikasi tugas kunjungan.`,
          icon: '/admin/pwa-192x192.png',
          tag: 'push_activated',
        });
      } else {
        toast(`⚠️ ${res.error || 'Gagal mengaktifkan notifikasi. Periksa izin di browser.'}`, 'error');
      }
    } catch (err: any) {
      toast(`⚠️ Gagal: ${err.message}`, 'error');
    } finally {
      setPushSyncing(false);
    }
  };

  // Fase 0.3: JANGAN minta izin notifikasi otomatis di load (browser modern menolak
  // prompt tanpa gesture). Cukup baca status + unlock audio + load gateway capability.
  // Permintaan izin dilakukan lewat tombol "Aktifkan Notifikasi" (gesture pengguna).
  useEffect(() => {
    const cleanupAudio = initAudioUnlock();
    apiRequest('/api/staff/gateway-capability')
      .then((res) => {
        if (res?.success && res.data) setGatewayCapability(res.data);
      })
      .catch(() => {});
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
      ensurePaymentInfo().catch(() => {});
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
                    try { window.focus(); } catch (_) {}
                    const match = combined.find((t) => t.reservationId === first.reservationId) || first;
                    setSelectedTask(match as StaffTask);
                  });
                }
              } catch (_) {}
            }
          }
          if (todayRes.success && upcomingRes.success) {
            const todayList2: StaffTask[] = Array.isArray(todayRes.data) ? todayRes.data : [];
            const upcomingList2: StaffTask[] = Array.isArray(upcomingRes.data) ? upcomingRes.data : [];
            knownTaskIdsRef.current = new Set([...todayList2, ...upcomingList2].map((t: StaffTask) => t.reservationId));
          }
        } catch (_) {}
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
      apiRequest('/api/staff/team-members')
        .then((res) => {
          if (res?.success && Array.isArray(res.data)) {
            setTeamMembers(res.data);
          }
        })
        .catch(() => {});
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
  useEffect(() => {
    if (hasDepartWindowTask) startDepartGpsWarmup();
    else stopDepartGpsWarmup();
    return () => stopDepartGpsWarmup();
  }, [hasDepartWindowTask]);

  // Track user scroll position in chat viewport (anti-jerking when reading earlier messages)
  const handleChatScroll = useCallback(() => {
    if (!chatContainerRef.current) return;
    const el = chatContainerRef.current;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 120;
  }, []);

  // Auto-scroll chat viewport to latest message (respects manual scroll if user scrolled up)
  const scrollToBottom = useCallback((force = false) => {
    if (!force && !isNearBottomRef.current) return;
    const doScroll = () => {
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
      }
    };
    requestAnimationFrame(doScroll);
    if (force) {
      setTimeout(doScroll, 50);
    }
  }, []);

  // Fetch messages for selected task conversation (Maksimal 30 bubble chat)
  // `silent` (Fase 1.1): polling cadangan / auto-catchup resume tab — tanpa spinner,
  // tanpa paksa scroll, dan hanya re-render bila isi benar-benar berubah (anti-kedip).
  const fetchMessages = useCallback(
    async (conversationId: string, opts?: { silent?: boolean }) => {
      const silent = !!opts?.silent;
      if (!silent) setLoadingMessages(true);
      if (!silent) setErrorMessage(null);
      try {
        const res = await apiRequest(`/api/staff/conversations/${conversationId}/messages`);
        if (res.success && Array.isArray(res.data)) {
          // Masking HP hanya untuk terapis; supervisor (CS/SPV) melihat apa adanya.
          const shouldMask = !isSupervisorRef.current;
          const sanitized = res.data
            .slice(-30)
            .filter(
              (m: any) =>
                m &&
                typeof m === 'object' &&
                typeof m.id === 'string' &&
                !!m.created_at &&
                !isNaN(new Date(m.created_at).getTime()) &&
                // Pesan hidden admin: jangan masuk state terapis biasa (defense in depth;
                // backend sudah memfilter, ini menutup sisa jalur cache/polling lama).
                (isSupervisorRef.current || (!(m as any).is_message_hidden && !(m as any).payload_raw?.is_hidden))
            )
            .map((m: any) => ({
              ...m,
              content: shouldMask && typeof m.content === 'string' ? maskPhoneInTextClient(m.content) : m.content,
              sender_name: shouldMask && typeof m.sender_name === 'string' ? maskPhoneInTextClient(m.sender_name) : m.sender_name,
              senderName: shouldMask && typeof m.senderName === 'string' ? maskPhoneInTextClient(m.senderName) : m.senderName,
            }));
          setMessages((prev) => {
            // Rekonsiliasi idempoten: jangan ganti array bila tanda-tandanya identik
            // (mencegah re-render/kedip + reload gambar tiap poll).
            const sig = (arr: any[]) =>
              arr
                .map(
                  (m) =>
                    `${m.id}|${m.delivery_status || ''}|${m.read_at || ''}|${m.is_revoked ? 1 : 0}|${m.is_edited ? 1 : 0}|${
                      typeof m.content === 'string' ? m.content.length : 0
                    }`
                )
                .join('\n');
            return sig(prev) === sig(sanitized) ? prev : sanitized;
          });
          if (!silent) {
            isNearBottomRef.current = true;
            scrollToBottom(true);
          }
        }
      } catch (err: any) {
        if (!silent) setErrorMessage(err.message || 'Gagal memuat riwayat pesan.');
      } finally {
        if (!silent) {
          setLoadingMessages(false);
          isNearBottomRef.current = true;
          scrollToBottom(true);
        }
      }
    },
    [scrollToBottom]
  );

  // Fase 0.2: tandai percakapan dibaca saat dibuka (badge padam + sumber presence untuk
  // gerbang notifikasi berbasis "dibuka 1 menit terakhir"). Fire-and-forget.
  const markConversationRead = useCallback((conversationId: string) => {
    if (!conversationId) return;
    apiRequest(`/api/staff/conversations/${conversationId}/read`, { method: 'PATCH' }).catch(() => {});
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
          } catch (_) {}

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
                  try { window.focus(); } catch (_) {}
                  const match = allTasksRef.current.find((t) => t.conversationId === convId);
                  if (match) handleOpenChat(match);
                }
              );
            }
          } catch (_) {}

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
              } catch {}
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
        } catch {}
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
        } catch {}
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
  const handlePickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      // Fase 2.2: profil 'field' (960px/q0.65) — foto lapangan sinyal 1-bar.
      const prepared = await prepareChatImage(file, 'field');
      if (selectedImage?.preview && selectedImage.preview.startsWith('blob:')) {
        try { URL.revokeObjectURL(selectedImage.preview); } catch {}
      }
      setSelectedImage({
        file,
        preview: prepared.preview,
        dataUrl: prepared.dataUrl,
        mimeType: prepared.mimeType,
        fileName: prepared.fileName,
      });
      setErrorMessage(null);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal memproses foto.');
    } finally {
      if (chatFileInputRef.current) chatFileInputRef.current.value = '';
      if (chatGalleryInputRef.current) chatGalleryInputRef.current.value = '';
      e.target.value = '';
    }
  };

  const handleSendReply = async (e?: React.FormEvent | React.KeyboardEvent | React.SyntheticEvent) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    const image = selectedImage;
    const textToSend = replyText.trim();
    if ((!textToSend && !image) || !selectedTask?.conversationId || sending) return;

    if (!isOnline) {
      setErrorMessage('Koneksi internet terputus. Pesan tidak terkirim, coba lagi setelah sinyal kembali.');
      return;
    }

    const signature = `~ ${staff?.name || 'Bidan Terapis'}`;
    const hasText = !!textToSend;
    const optimisticContent = hasText
      ? textToSend.endsWith(signature) ? textToSend : `${textToSend}\n\n${signature}`
      : '[IMAGE]';

    setSending(true);
    setErrorMessage(null);

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const conversationId = selectedTask.conversationId;
    const optimisticMsg: ChatMessage = {
      id: tempId,
      direction: 'OUTBOUND',
      content: optimisticContent,
      media: image ? { url: image.preview, hdUrl: image.preview } : undefined,
      sender_type: 'STAFF',
      sender_name: staff?.name || 'Staff',
      created_at: new Date().toISOString(),
      delivery_status: 'sent',
    };

    setMessages((prev) => [...prev, optimisticMsg].slice(-30));
    setReplyText('');
    setSelectedImage(null);
    if (replyTextareaRef.current) {
      replyTextareaRef.current.style.height = 'auto';
    }
    isNearBottomRef.current = true;
    scrollToBottom(true);

    try {
      const body: Record<string, any> = { text: hasText ? textToSend : '', clientTempId: tempId };
      if (image) {
        // Fase 2.1: JANGAN kirim thumbB64 == imageB64 (dobel payload ~50%).
        // Backend membuat blur thumbnail server-side via sharp (media.service.ts).
        body.imageB64 = image.dataUrl;
        body.mimeType = image.mimeType;
        body.fileName = image.fileName;
      }
      const res = await apiRequest(`/api/staff/conversations/${conversationId}/reply`, {
        method: 'POST',
        body: JSON.stringify(body),
        timeoutMs: 45000,
      });

      if (res.success) {
        const assignedId = res.data?.messageId || res.data?.id;
        if (assignedId) {
          setMessages((prev) =>
            prev.map((m) => (m.id === tempId ? { ...m, id: assignedId } : m))
          );
        }
        // Berhasil → hapus dari antrean gagal (bila ini hasil retry).
        setFailedMessages((prev) => prev.filter((f) => f.clientTempId !== tempId));
      } else {
        const errorMsg = res.error || 'Gagal mengirim pesan balasan.';
        queueFailedMessage(tempId, conversationId, textToSend, image, errorMsg);
      }
    } catch (err: any) {
      const errorMsg = err.message || 'Gagal mengirim pesan balasan. Harap periksa koneksi WhatsApp.';
      queueFailedMessage(tempId, conversationId, textToSend, image, errorMsg);
    } finally {
      setSending(false);
    }
  };

  // Fase 1.2: simpan pesan gagal (bubble `failed` tetap tampil + tombol Coba Kirim Lagi).
  const queueFailedMessage = (
    clientTempId: string,
    conversationId: string,
    text: string,
    image: { preview: string; dataUrl: string; mimeType: string; fileName: string } | null,
    error: string
  ) => {
    setErrorMessage(error);
    toast(error, 'error');
    setMessages((prev) =>
      prev.map((m) => (m.id === clientTempId ? { ...m, delivery_status: 'failed' as const } : m))
    );
    setFailedMessages((prev) => {
      const next = [
        ...prev.filter((f) => f.clientTempId !== clientTempId),
        {
          clientTempId,
          conversationId,
          text,
          image: image
            ? { preview: image.preview, dataUrl: image.dataUrl, mimeType: image.mimeType, fileName: image.fileName }
            : null,
          createdAt: new Date().toISOString(),
          error,
        },
      ];
      persistFailedMessages(next);
      return next;
    });
  };

  // Fase 1.2: retry idempoten. Kirim ulang dengan `clientTempId` yang SAMA supaya
  // backend tidak menggandakan bubble di WhatsApp walau percobaan pertama sebenarnya sukses.
  const handleRetryFailedMessage = async (item: {
    clientTempId: string;
    conversationId: string;
    text: string;
    image?: { preview: string; dataUrl: string; mimeType: string; fileName: string } | null;
  }) => {
    if (retryingTempId) return;
    setRetryingTempId(item.clientTempId);
    try {
      const body: Record<string, any> = { text: item.text, clientTempId: item.clientTempId };
      if (item.image) {
        body.imageB64 = item.image.dataUrl;
        body.mimeType = item.image.mimeType;
        body.fileName = item.image.fileName;
      }
      const res = await apiRequest(`/api/staff/conversations/${item.conversationId}/reply`, {
        method: 'POST',
        body: JSON.stringify(body),
        timeoutMs: 45000,
      });
      if (res.success) {
        const assignedId = res.data?.messageId || res.data?.id;
        if (assignedId) {
          setMessages((prev) =>
            prev.map((m) => (m.id === item.clientTempId ? { ...m, id: assignedId, delivery_status: 'sent' } : m))
          );
        }
        setFailedMessages((prev) => {
          const next = prev.filter((f) => f.clientTempId !== item.clientTempId);
          persistFailedMessages(next);
          return next;
        });
        toast('✅ Pesan berhasil terkirim ulang.', 'success');
      } else {
        const errorMsg = res.error || 'Masih gagal mengirim. Periksa sinyal lalu coba lagi.';
        setFailedMessages((prev) => {
          const next = prev.map((f) => (f.clientTempId === item.clientTempId ? { ...f, error: errorMsg } : f));
          persistFailedMessages(next);
          return next;
        });
        toast(errorMsg, 'error');
      }
    } catch (err: any) {
      const errorMsg = err.message || 'Masih gagal mengirim. Periksa sinyal lalu coba lagi.';
      setFailedMessages((prev) => {
        const next = prev.map((f) => (f.clientTempId === item.clientTempId ? { ...f, error: errorMsg } : f));
        persistFailedMessages(next);
        return next;
      });
      toast(errorMsg, 'error');
    } finally {
      setRetryingTempId(null);
    }
  };

  // Fase 1.2: outbox tahan-reload (localStorage). Dipulihkan saat mount.
  const FAILED_OUTBOX_KEY = 'staff_failed_outbox_v1';
  const persistFailedMessages = (list: Array<unknown>) => {
    try {
      localStorage.setItem(FAILED_OUTBOX_KEY, JSON.stringify(list.slice(-20)));
    } catch {
      /* storage penuh / private mode → abaikan (best-effort) */
    }
  };
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FAILED_OUTBOX_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setFailedMessages(parsed);
      }
    } catch {
      /* abaikan */
    }
  }, []);

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
            toast('Info OTW sudah pernah dikirim sebelumnya — tidak dikirim ulang.', 'info');
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
          toast(`OTW terkirim ke WhatsApp ${task.customerName || 'pasien'} 🛵`, 'success');
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
    const waktu = task.bookingDate ? formatTime(task.bookingDate) : 'sesuai kesepakatan';
    const patokan = (task.address?.landmark || '').trim();
    return (
      `Halo ${name}, Bidan kami izin konfirmasi untuk persiapan treatment jam ${waktu}. ` +
      `Boleh minta tolong kirimkan shareloc WhatsApp terkini${patokan ? ` dan patokan rumah (${patokan})` : ''} ya Bun ` +
      `agar Bidan tidak tersasar? Terima kasih Bunda 🤗`
    );
  };

  const handleRequestShareloc = () => {
    const task = preflightTask;
    if (!task) return;
    const draft = buildSharelocDraft(task);
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
    } catch (_) {}

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
        toast(`✅ Status tiba di lokasi tercatat & pesan terkirim ke ${patientName}!`, 'success');
        const nowIso = new Date().toISOString();
        const updateArrival = (t: StaffTask): StaffTask =>
          t.reservationId === task.reservationId ? { ...t, arrivedAt: nowIso } : t;
        setTasks((prev) => prev.map(updateArrival));
        setUpcomingTasks((prev) => prev.map(updateArrival));
        if (selectedTask?.reservationId === task.reservationId) {
          setSelectedTask((prev) => (prev ? updateArrival(prev) : null));
        }
        // Hentikan pemancar telemetry (privasi mati total saat tiba).
        stopTelemetry().catch(() => {});
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
        title: '⚠️ Pembayaran Belum Lunas',
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
        title: '📸 Foto Rumah Belum Diunggah',
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
        toast(`✅ Kunjungan untuk ${patientName} berhasil diselesaikan!`, 'success');
        const updateCompleted = (t: StaffTask): StaffTask =>
          t.reservationId === task.reservationId ? { ...t, status: 'completed' } : t;
        setTasks((prev) => prev.map(updateCompleted));
        setUpcomingTasks((prev) => prev.map(updateCompleted));
        if (selectedTask?.reservationId === task.reservationId) {
          setSelectedTask((prev) => (prev ? updateCompleted(prev) : null));
        }
        // Kunjungan selesai → pastikan pemantauan perjalanan benar-benar mati.
        stopTelemetry().catch(() => {});
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
        toast(`✅ Info pembayaran & QRIS berhasil dikirim ke WhatsApp ${patientName}!`, 'success');
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
      toast(`Nomor rekening ${bank} (${accNum}) berhasil disalin! 📋`, 'success');
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = accNum;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      toast(`Nomor rekening ${bank} (${accNum}) berhasil disalin! 📋`, 'success');
    }
  };

  // Tombol 1-tap QRIS: tampilkan barcode QRIS layar penuh langsung ke pasien.
  const handleOpenQrisFast = useCallback(
    async (task: StaffTask, e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      setPaymentModalTask(task);
      setPaymentMethod('QRIS');
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

        const targetId = paymentModalTask.reservationId;
        const newProofUrl: string | null = res.data?.proofUrl ?? proofImageB64 ?? null;
        const newMethod: string | null = res.data?.paymentMethod ?? paymentMethod;
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
      acquireBestGps(true).catch(() => {});
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
          toast(`🟢 GPS presisi tinggi terkunci (±${acc}m pada percobaan ke-${attempt})!`, 'success');
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
      toast('Foto rumah berhasil dimuat! 📸', 'success');

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
    toast('✅ Lokasi & panduan berhasil diperbarui! ⚡', 'success');

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
        toast('Catatan lokasi tersimpan (tanpa perubahan titik GPS) — foto tersimpan tapi koordinat tidak diperbarui.', 'error');
      }
    } catch (err: any) {
      console.warn('[STAFF] Background sync location error:', err?.message || err);
    }
  };

  /**
   * Ekstraksi total durasi treatment murni (dalam menit) tanpa buffer perjalanan
   */
  const extractTreatmentMinutes = (treatmentDetail: string | null): number => {
    if (!treatmentDetail) return 60;
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

    if (!sanitized) return 60;
    const rawItems = sanitized.split(/\r?\n|,|;|\+|&/).map((s) => s.trim()).filter(Boolean);
    let totalMins = 0;
    for (const item of rawItems) {
      const itemLower = item.toLowerCase();
      if (itemLower.includes('buffer') || itemLower.includes('bufer') || itemLower.includes('total scheduled')) continue;
      const minMatch = item.match(/(\d+)\s*(?:menit|mins?|m\b)/i);
      const hourMatch = item.match(/(\d+(?:\.\d+)?)\s*(?:jam|hours?|h\b)/i);
      if (minMatch) {
        totalMins += parseInt(minMatch[1], 10);
      } else if (hourMatch) {
        totalMins += Math.round(parseFloat(hourMatch[1]) * 60);
      }
    }
    return totalMins > 0 ? totalMins : 60;
  };

  const isScheduleOngoing = (t: StaffTask): boolean => {
    if (!t.bookingDate || isTrulyCompleted(t)) return false;
    const startTime = new Date(t.bookingDate).getTime();
    if (isNaN(startTime)) return false;
    const endTime = startTime + extractTreatmentMinutes(t.treatmentDetail) * 60 * 1000;
    const now = Date.now();
    if (t.arrivedAt) return now < endTime + 30 * 60 * 1000;
    return now >= startTime && now < endTime;
  };

  const isScheduleOverdue = (t: StaffTask): boolean => {
    if (!t.bookingDate || isTrulyCompleted(t)) return false;
    if (isScheduleOngoing(t)) return false;
    const startTime = new Date(t.bookingDate).getTime();
    if (isNaN(startTime)) return false;
    const endTime = startTime + extractTreatmentMinutes(t.treatmentDetail) * 60 * 1000;
    return Date.now() >= endTime;
  };

  const isTrulyCompleted = (t: StaffTask) => {
    return (t.status || '').toLowerCase() === 'completed';
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

  return (
    <div className="h-[100dvh] max-h-[100dvh] w-full max-w-full overflow-hidden bg-app text-ink flex flex-col font-sans select-none antialiased">
      {/* WhatsApp Web Minimalist Clean Top Bar — hidden on mobile when chat active (fondasional gating) */}
      <header className={`${mobileView === 'chat' && activeTab === 'today' ? 'hidden md:block' : 'block'} bg-surface border-b border-divider dark:border-divider px-3 sm:px-4 py-2.5 sticky top-0 z-30 shadow-xs pt-[calc(0.625rem+env(safe-area-inset-top,0px))] md:pt-2.5 pl-[max(0.75rem,env(safe-area-inset-left,0px))] pr-[max(0.75rem,env(safe-area-inset-right,0px))] shrink-0`}>
        <div className="flex items-center justify-between gap-2 sm:gap-4 max-w-7xl mx-auto w-full">
          <div className="flex items-center space-x-2.5 min-w-0">
            {mobileView === 'chat' && activeTab === 'today' && (
              <button
                onClick={handleBackToList}
                className="md:hidden p-2 rounded-full bg-fill-1 hover:bg-fill-2 text-ink-2 transition-all active:scale-95 border border-divider flex-shrink-0"
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
              className="h-9 w-9 rounded-full bg-accent text-white hover:bg-accent-hover flex items-center justify-center shadow-xs transition-all active:scale-95 flex-shrink-0"
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
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
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
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
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
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
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
              className="p-2 rounded-full bg-surface hover:bg-fill-2 text-ink-2 hover:text-ink dark:hover:text-ink transition-all disabled:opacity-50 active:scale-95 border border-divider shadow-xs"
              title="Muat Ulang Data"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin text-accent' : ''} />
            </button>

            {/* Hamburger Button (Garis Tiga untuk buka Sidebar Menu Kanan) */}
            <button
              type="button"
              onClick={() => setShowMenuDrawer(true)}
              className="p-2 rounded-full bg-fill-1 hover:bg-fill-2 text-ink hover:text-accent dark:hover:text-accent-hover transition-all active:scale-95 border border-divider shadow-xs flex items-center justify-center"
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
              : 'Sinyal lemah — menyambungkan kembali obrolan...'}
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
                    className="w-full pl-9 pr-4 py-2 rounded-lg bg-fill-1 text-[16px] sm:text-xs text-ink placeholder-ink-3 dark:placeholder-ink-3 focus:outline-none focus:ring-1 focus:ring-accent transition-all"
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
                      className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                        scopeFilter === 'mine'
                          ? 'bg-surface text-accent shadow-xs'
                          : 'text-ink-2 hover:text-ink'
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
                          ? 'bg-accent text-white shadow-xs'
                          : 'text-ink-2 hover:text-ink'
                      }`}
                    >
                      <span>👥</span>
                      <span>Semua Terapis</span>
                    </button>
                  </div>
                )}

                {/* Status Sub-filter Pills for Today (Operational vs Completed) */}
                <div className="flex items-center gap-1.5 pt-1 overflow-x-auto no-scrollbar">
                  <button
                    type="button"
                    onClick={() => setTodayFilter('all')}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 ${
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
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 ${
                      todayFilter === 'pending'
                        ? 'bg-accent text-white shadow-xs'
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
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 ${
                      todayFilter === 'completed'
                        ? 'bg-accent text-white shadow-xs'
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
                  filteredTasks.map((task, idx) => {
                    const isSelected = selectedTask?.reservationId === task.reservationId;
                    const isSendingOtw = sendingOtwId === task.reservationId;
                    const isLunas = task.pricing.paymentStatus === 'LUNAS';
                    const catInfo = getCategoryIcon(task.treatmentCategory);

                    return (
                      <div
                        key={task.reservationId}
                        className={`p-3.5 rounded-2xl transition-all duration-200 text-left relative bg-surface shadow-xs border ${
                          isSelected
                            ? 'border-accent ring-2 ring-accent/30 shadow-md animate-pulseGlow'
                            : 'border-divider hover:border-accent/40 hover:shadow-sm active:scale-[0.98]'
                        } ${catInfo.borderAccent} border-l-4`}
                      >
                        {/* Header: Customer Icon & Name & Time (KLIK BARIS INI = DETAIL CUSTOMER) */}
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            setDetailModalTask(task);
                          }}
                          className="flex items-start justify-between gap-2 mb-1 p-1 -m-1 rounded-xl hover:bg-fill-1 transition cursor-pointer group"
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
                              <span className="absolute -top-1.5 -left-1.5 px-1.5 py-0.2 rounded-full bg-accent text-white text-[9px] font-extrabold shadow-xs">
                                #{idx + 1}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <h3 className="font-semibold text-sm text-ink truncate group-hover:text-accent transition">
                                {task.customerName || 'Customer'}
                              </h3>
                              <p className="text-[11px] text-accent font-medium line-clamp-2">
                                {task.treatmentDetail || 'Treatment Spa'}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center space-x-1.5 flex-shrink-0">
                            {task.status === 'completed' ? (
                              <span className="text-[10px] font-bold text-success bg-success-soft px-1.5 py-0.5 rounded-md border border-success-line flex items-center gap-1">
                                <CheckCircle2 size={10} />
                                <span>Selesai</span>
                              </span>
                            ) : task.arrivedAt ? (
                              <span className="text-[10px] font-bold text-info bg-info-soft px-1.5 py-0.5 rounded-md border border-info-line flex items-center gap-1 animate-pulse">
                                <span>📍</span>
                                <span>Tiba</span>
                              </span>
                            ) : task.otwSentAt ? (
                              <span
                                className="text-[10px] font-bold text-warning bg-warning-soft px-1.5 py-0.5 rounded-md border border-warning-line flex items-center gap-1"
                                title="Sedang menuju lokasi pasien"
                              >
                                <span>🛵</span>
                                <span>Dalam Perjalanan</span>
                              </span>
                            ) : isScheduleOngoing(task) ? (
                              <span className="text-[10px] font-bold text-warning bg-warning-soft px-1.5 py-0.5 rounded-md border border-warning-line flex items-center gap-1 animate-pulse">
                                <span className="w-1.5 h-1.5 rounded-full bg-warning inline-block animate-ping" />
                                <span>Berlangsung</span>
                              </span>
                            ) : isScheduleOverdue(task) ? (
                              <span className="text-[10px] font-bold text-danger bg-danger-soft px-1.5 py-0.5 rounded-md border border-danger-line flex items-center gap-1">
                                <AlertCircle size={10} />
                                <span>Perlu Selesai</span>
                              </span>
                            ) : null}
                            <div className="flex items-center space-x-1 text-[11px] font-semibold text-accent bg-bubble-out px-2 py-0.5 rounded-md whitespace-nowrap border border-accent/30">
                              <Clock size={11} />
                              <span>{formatTime(task.bookingDate).split(' ')[0]}</span>
                            </div>
                          </div>
                        </div>

                        {/* Area Bawah: Alamat, Foto Rumah, & Tombol Aksi */}
                        <div>
                          {/* Alamat & Jarak dari Klinik */}
                          <div className="text-xs text-ink-2 mb-2 mt-2 bg-fill-1 p-2.5 rounded-xl border border-divider space-y-2">
                            <div className="flex items-start gap-1.5">
                              <MapPin size={13} className="text-accent mt-0.5 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-ink leading-snug">{task.address.fullText}</p>
                                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                  <AccuracyBadge source={task.address.locationSource} />
                                  <AddressUpdatedAtChip updatedAt={task.address.addressUpdatedAt} />
                                </div>
                              {task.address.distanceKm != null && (
                                <p className="text-[10px] font-semibold text-accent mt-0.5 flex items-center gap-1">
                                  <Compass size={10} />
                                  <span>
                                    {task.address.distanceSource === 'PREVIOUS_PATIENT' && task.address.originName
                                      ? `Jarak: ${task.address.distanceKm.toFixed(1)} km dari ${task.address.originName}`
                                      : `Jarak: ${task.address.distanceKm.toFixed(1)} km dari klinik`}
                                    {task.address.estimatedMinutes != null && (
                                      <span className="text-ink-2 font-normal ml-1">
                                        (±{task.address.estimatedMinutes} mnt perjalanan)
                                      </span>
                                    )}
                                  </span>
                                </p>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={async (e) => {
                                e.stopPropagation();
                                const copyText = `${task.address.fullText}${
                                  task.address.landmark ? ` (Patokan: ${task.address.landmark})` : ''
                                }`;
                                try {
                                  await navigator.clipboard.writeText(copyText);
                                  toast('Alamat disalin ke clipboard. Tempel di Waze/Gojek! 📋', 'success');
                                } catch {
                                  const ta = document.createElement('textarea');
                                  ta.value = copyText;
                                  document.body.appendChild(ta);
                                  ta.select();
                                  document.execCommand('copy');
                                  document.body.removeChild(ta);
                                  toast('Alamat disalin ke clipboard. Tempel di Waze/Gojek! 📋', 'success');
                                }
                              }}
                              className="p-1.5 rounded-lg text-ink-2 hover:text-accent hover:bg-surface border border-divider transition active:scale-95 flex-shrink-0"
                              title="Salin alamat lengkap untuk Waze/Gojek"
                            >
                              <Copy size={12} />
                            </button>
                          </div>

                          {/* Foto Depan Rumah & Patokan Landmark */}
                          {task.address.housePhotoUrl ? (
                            <div className="flex items-center gap-2 p-1.5 rounded-lg bg-surface border border-divider">
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setZoomImageKind('house');
                                  setZoomImageUrl(task.address.housePhotoUrl || null);
                                }}
                                className="h-11 w-11 rounded-lg bg-fill-1 overflow-hidden flex-shrink-0 relative group cursor-pointer border border-divider"
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
                                <span className="text-[10px] font-bold text-accent uppercase tracking-wider block">
                                  🏠 Foto Depan Rumah
                                </span>
                                {task.address.landmark ? (
                                  <p className="text-[11px] text-ink truncate font-medium">
                                    Patokan: {task.address.landmark}
                                  </p>
                                ) : (
                                  <p className="text-[10px] text-ink-2 truncate">Panduan visual tersimpan</p>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenUpdateLocationModal(task);
                                }}
                                className="p-1.5 text-xs text-accent hover:bg-accent-soft rounded-lg transition-all border border-divider flex-shrink-0"
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
                              className="w-full flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl bg-warning-soft hover:bg-warning-line text-warning text-[11px] font-bold border border-warning-line shadow-2xs transition-all active:scale-95"
                              title="Ambil foto rumah untuk panduan visual kunjungan"
                            >
                              <Camera size={13} className="text-warning" />
                              <span>📸 Butuh Foto Rumah • Ambil Foto Sekarang</span>
                            </button>
                          )}
                        </div>

                        {/* Kotak Patokan Rumah (plan 2026-10-02): kontras tinggi agar
                            Bidan langsung hafal ciri pagar/rumah sebelum mengetuk pintu. */}
                        {(task.address.landmark || task.address.addressDetail) && (
                          <div className="mb-2 flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-300 dark:border-amber-900/50 text-amber-900 dark:text-amber-200">
                            <Home size={14} className="text-warning flex-shrink-0 mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] font-extrabold uppercase tracking-wide text-warning">
                                Patokan Rumah
                              </p>
                              {task.address.landmark && (
                                <p className="text-[12px] font-bold leading-snug">{task.address.landmark}</p>
                              )}
                              {task.address.addressDetail && (
                                <p className="text-[11px] text-warning leading-snug">{task.address.addressDetail}</p>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Data Pasien Bayi / Anak (plan 2026-10-02 — quick-peek klinis:
                            usia terhitung presisi dari birthDate bila tersedia, fallback
                            ke teks usia mentah. Bidan langsung hafal sebelum mengetuk pintu.) */}
                        {task.children && task.children.length > 0 && (
                          <div className="mb-2 flex flex-wrap gap-1.5">
                            {task.children.map((child, i) => {
                              const computedAge = child.birthDate ? formatClinicalAge(child.birthDate) : '';
                              const ageLabel = computedAge || (child.rawAgeText ? formatChildAgeText(child.rawAgeText) : '');
                              return (
                                <span
                                  key={i}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-bubble-out dark:bg-accent/20 text-accent text-[11px] font-medium border border-accent/20 dark:border-accent/40"
                                >
                                  <Baby size={11} />
                                  <span>{formatPatientName(child.name)}</span>
                                  {ageLabel && (
                                    <span className="text-ink-2">({ageLabel})</span>
                                  )}
                                </span>
                              );
                            })}
                          </div>
                        )}

                        {/* Cuplikan Catatan Klinis / Keluhan (dari CS/LiveChat) */}
                        {task.adminNotes && (
                          <div className="mb-2 flex items-start gap-1.5 px-2 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 text-amber-900 dark:text-amber-200 text-[11px] font-medium">
                            <AlertCircle size={12} className="text-warning flex-shrink-0 mt-0.5" />
                            <span className="line-clamp-2" title={task.adminNotes}>
                              <strong>Keluhan/Catatan:</strong> {task.adminNotes}
                            </span>
                          </div>
                        )}

                        {/* Total Biaya & Status Bayar */}
                        <div className="flex items-center justify-between text-xs pt-1 border-t border-divider">
                          <div className="flex items-center gap-1 text-ink-2">
                            <CreditCard size={12} className="text-accent" />
                            <span>Biaya:</span>
                            <span className="text-ink font-bold">
                              {formatRupiah(task.pricing.totalFee)}
                            </span>
                            {task.pricing.deliveryFee > 0 && (
                              <span className="text-[10px] text-ink-2 font-medium ml-1">
                                (ongkir {formatRupiah(task.pricing.deliveryFee)})
                              </span>
                            )}
                          </div>

                          {isLunas ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (task.pricing.proofUrl) {
                                  setZoomImageKind('proof');
                                  setZoomImageUrl(task.pricing.proofUrl);
                                } else {
                                  setPaymentModalTask(task);
                                }
                              }}
                              className="text-[10px] font-extrabold uppercase tracking-wide text-on-solid bg-success hover:bg-success-hover px-2.5 py-1 rounded-full shadow-xs transition-all active:scale-95 flex items-center gap-1"
                              title={task.pricing.proofUrl ? 'Lihat bukti pembayaran yang tersimpan' : 'Unggah bukti pembayaran / invoice susulan'}
                            >
                              <CheckCircle2 size={12} />
                              <span>SUDAH LUNAS — JANGAN TAGIH</span>
                              {task.pricing.proofUrl && <span className="text-[9px] font-bold">• BUKTI</span>}
                            </button>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={(e) => handleOpenQrisFast(task, e)}
                                className="text-[10px] font-bold text-accent bg-bubble-out hover:bg-accent-soft px-2 py-0.5 rounded-full border border-accent/30 transition-all active:scale-95 flex items-center gap-1 shadow-2xs"
                                title="Tampilkan barcode QRIS langsung ke pasien"
                              >
                                <QrCode size={11} />
                                <span>QRIS</span>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPaymentModalTask(task);
                                }}
                                className="text-[10px] font-extrabold uppercase tracking-wide text-on-solid bg-danger hover:bg-danger-hover px-2.5 py-1 rounded-full border border-danger transition-all active:scale-95 flex items-center gap-1 shadow-xs"
                                title="Klik untuk mencatat pembayaran transaksi ini"
                              >
                                <CreditCard size={12} />
                                <span>Catat Bayar ({formatRupiah(task.pricing.totalFee)})</span>
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Quick Action Buttons (plan 2026-10-02 — unifikasi 1-tap):
                            Chat + aksi utama tunggal. Tombol "Navigasi" & "Infokan OTW"
                            digabung menjadi [ MULAI JALAN ] agar Bidan tak bingung. */}
                        {(() => {
                          const isChatHidden = (task.status === 'completed' && !isChatWindowOpen(task)) || task.chatWindow?.reason === 'CLOSED_AFTER_COMPLETE';
                          const navUrl = task.navigationUrl || task.mapsUrl;
                          const action = resolveTaskAction({
                            status: task.status,
                            arrivedAt: task.arrivedAt,
                            otwSentAt: task.otwSentAt,
                            bookingDate: task.bookingDate,
                            navUrl,
                            isScheduleOverdue: isScheduleOverdue(task),
                            timeForArrival: isTimeForArrival(task),
                          });
                          const isTerminal = task.status === 'completed';
                          const isArrived = !isTerminal && (Boolean(task.arrivedAt) || isScheduleOverdue(task));
                          const isOtw = !isTerminal && !isArrived && !!task.otwSentAt;
                          const isDirectArrival = !isTerminal && !isArrived && !isOtw && isTimeForArrival(task);
                          const showExtraNav = action.showExtraNav ?? ((isOtw || isDirectArrival) && !!navUrl);
                          const colsClass = isChatHidden
                            ? (showExtraNav ? 'grid-cols-2' : 'grid-cols-1')
                            : (showExtraNav ? 'grid-cols-3' : 'grid-cols-2');
                          return (
                            <div className={`grid ${colsClass} gap-2 pt-2 mt-1`}>
                              {!isChatHidden && (
                                isChatWindowOpen(task) ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenChat(task);
                                    }}
                                    className="flex items-center justify-center space-x-1 min-h-[44px] py-2.5 px-2 sm:px-3 text-[11px] sm:text-xs font-bold text-accent bg-bubble-out hover:bg-accent-soft/80 rounded-xl transition-all active:scale-95 border border-accent/30 shadow-xs"
                                    title="Buka Ruang Percakapan WhatsApp Pasien"
                                  >
                                    <MessageSquare size={15} className="text-accent" />
                                    <span>Chat</span>
                                  </button>
                                ) : (
                                  <div
                                    className="flex items-center justify-center space-x-1 min-h-[44px] py-2.5 px-2 sm:px-3 text-[11px] sm:text-xs font-bold text-ink-3 bg-fill-1 rounded-xl border border-divider cursor-not-allowed"
                                    title={chatLockedTitle(task)}
                                  >
                                    <MessageSquare size={15} className="text-ink-3" />
                                    <span>Chat Terkunci</span>
                                  </div>
                                )
                              )}

                              {/* Mode sudah OTW: tombol Navigasi (buka peta ulang) tetap tersedia */}
                              {isOtw && (
                                navUrl ? (
                                  <button
                                    type="button"
                                    onClick={(e) => requestNavigation(task, e)}
                                    className={`flex items-center justify-center space-x-1 min-h-[44px] py-2.5 px-2 sm:px-3 text-[11px] sm:text-xs font-bold rounded-xl transition-all active:scale-95 shadow-xs cursor-pointer ${
                                      needsNavigationPreflight(task.address?.locationSource)
                                        ? 'text-warning bg-warning-soft hover:bg-warning border border-warning-line'
                                        : 'text-white bg-accent hover:bg-accent-hover'
                                    }`}
                                    title={needsNavigationPreflight(task.address?.locationSource) ? 'Titik estimasi — konfirmasi patokan dulu' : 'Buka ulang peta navigasi'}
                                  >
                                    <Navigation size={15} />
                                    <span>{needsNavigationPreflight(task.address?.locationSource) ? 'Navigasi (Estimasi)' : 'Navigasi'}</span>
                                  </button>
                                ) : (
                                  <div className="text-[10px] text-ink-2 flex items-center justify-center min-h-[44px] py-2.5 rounded-xl bg-fill-1 border border-divider">
                                    Tanpa Peta
                                  </div>
                                )
                              )}

                              {/* Mode jam tiba langsung (H-10): tombol OTW kedua di samping aksi utama Sampai */}
                              {action.secondary === 'otw' && (
                                <button
                                  type="button"
                                  disabled={isSendingOtw}
                                  onClick={(e) => requestNavigation(task, e)}
                                  className="flex items-center justify-center space-x-1 min-h-[44px] py-2.5 px-2 sm:px-3 text-[11px] sm:text-xs font-bold rounded-xl transition-all active:scale-95 shadow-xs text-accent bg-bubble-out hover:bg-accent-soft border border-accent/30"
                                  title="Kirim info OTW ke pasien & buka peta navigasi"
                                >
                                  <Navigation size={15} />
                                  <span>OTW</span>
                                </button>
                              )}

                              {/* Aksi operasional 3-state */}
                              {isTerminal || isArrived ? (
                                <button
                                  type="button"
                                  disabled={completingVisitId === task.reservationId || isTerminal}
                                  onClick={(e) => handleCompleteVisit(task, e)}
                                  className={`flex items-center justify-center space-x-1 min-h-[44px] py-2.5 px-2 sm:px-3 text-[11px] sm:text-xs font-bold rounded-xl transition-all active:scale-95 shadow-xs disabled:opacity-60 ${
                                    isTerminal
                                      ? 'text-success bg-success-soft border border-success-line'
                                      : 'text-white bg-accent hover:bg-accent-hover' + (completingVisitId === task.reservationId ? '' : ' animate-action-pulse')
                                  }`}
                                  title={isTerminal ? 'Kunjungan telah selesai' : 'Tandai tindakan selesai dan kunjungan tuntas'}
                                >
                                  {completingVisitId === task.reservationId ? (
                                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                  ) : (
                                    <>
                                      <CheckCircle2 size={15} />
                                      <span>Selesai</span>
                                    </>
                                  )}
                                </button>
                              ) : (isOtw || isDirectArrival) ? (
                                <button
                                  type="button"
                                  disabled={sendingArrivalId === task.reservationId}
                                  onClick={(e) => handleRecordArrival(task, e)}
                                  className="flex items-center justify-center space-x-1 min-h-[44px] py-2.5 px-2 sm:px-3 text-[11px] sm:text-xs font-bold text-on-solid bg-info hover:bg-info-hover rounded-xl transition-all active:scale-95 shadow-xs disabled:opacity-50"
                                  title="Infokan ke pasien dan klinik bahwa Anda sudah sampai di lokasi"
                                >
                                  {sendingArrivalId === task.reservationId ? (
                                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                  ) : (
                                    <>
                                      <MapPin size={15} />
                                      <span>Sampai</span>
                                    </>
                                  )}
                                </button>
                              ) : (
                                /* Default: SATU tombol besar — buka peta + kirim OTW sekaligus */
                                <button
                                  type="button"
                                  disabled={isSendingOtw}
                                  onClick={(e) => requestNavigation(task, e)}
                                  className={`flex items-center justify-center space-x-1.5 min-h-[44px] py-2.5 px-2 sm:px-3 text-[11px] sm:text-xs font-bold rounded-xl transition-all active:scale-95 shadow-xs ${
                                    navUrl && needsNavigationPreflight(task.address?.locationSource)
                                      ? 'text-warning bg-warning-soft hover:bg-warning border border-warning-line'
                                      : navUrl || isOtwAllowed(task)
                                        ? 'text-white bg-accent hover:bg-accent-hover'
                                        : 'text-ink-2 bg-fill-2 opacity-75 cursor-pointer border border-divider'
                                  }`}
                                  title={
                                    navUrl
                                      ? 'Buka peta navigasi & otomatis infokan OTW ke pasien'
                                      : `OTW H-2 jam s/d H+15 menit (${formatTime(task.bookingDate)}); lewat itu pakai Sudah Sampai`
                                  }
                                >
                                  {isSendingOtw ? (
                                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                  ) : (
                                    <>
                                      <Navigation2 size={15} />
                                      <span>MULAI JALAN (OTW &amp; PETA)</span>
                                    </>
                                  )}
                                </button>
                              )}
                            </div>
                          );
                        })()}

                        {/* Bar Terapis Penanggung Jawab & Delegasi (Khusus Supervisor / Mode Tim) */}
                        {isSupervisor && (
                          <div className="flex items-center justify-between mt-2 pt-2 border-t border-divider text-xs">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[10px] text-ink-2 font-semibold flex-shrink-0">Terapis:</span>
                              <span className="px-2 py-0.5 rounded-md bg-violet-soft text-violet text-[10px] font-bold border border-violet-line truncate">
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
                              className="px-2.5 py-1 rounded-lg bg-surface hover:bg-violet-soft text-violet text-[10px] font-bold border border-violet-line shadow-2xs transition-all active:scale-95 flex items-center gap-1 flex-shrink-0"
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
              } flex-1 flex-col bg-content overflow-hidden relative min-h-0 h-full`}
            >
              {selectedTask ? (
                <>
                  {/* WhatsApp Web Chat Header — safe-area for notch/Dynamic Island */}
                  <div className="bg-fill-1 border-b border-divider dark:border-divider px-4 pt-[calc(0.625rem+env(safe-area-inset-top,0px))] md:pt-2.5 pb-2.5 flex items-center justify-between gap-3 shadow-xs z-10 shrink-0">
                    <div className="flex items-center space-x-2.5 min-w-0">
                      {/* Mobile Back to List Button */}
                      <button
                        onClick={handleBackToList}
                        className="md:hidden p-2 rounded-full bg-surface hover:bg-fill-2 text-ink-2 transition-all active:scale-95 border border-divider flex-shrink-0"
                        title="Kembali ke daftar kunjungan"
                        aria-label="Kembali"
                      >
                        <ChevronLeft size={18} />
                      </button>

                      {/* Customer Info Header - Klik untuk melihat Detail Pasien */}
                      <div
                        onClick={() => setDetailModalTask(selectedTask)}
                        className="flex items-center space-x-2.5 min-w-0 p-1 -m-1 rounded-xl hover:bg-fill-2 transition cursor-pointer group"
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
                            <h2 className="font-semibold text-ink text-sm truncate group-hover:text-accent transition">
                              {selectedTask.customerName || 'Customer'}
                            </h2>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-bubble-out text-accent font-bold border border-accent/30 whitespace-nowrap">
                              {formatTime(selectedTask.bookingDate)}
                            </span>
                          </div>
                          <p className="text-[11px] text-ink-2 truncate mt-0.5">
                            {selectedTask.treatmentDetail || 'Treatment'} • {selectedTask.address.fullText}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Header Actions: Navigasi, Bayar, Infokan OTW (icon-only) */}
                    <div className="flex items-center space-x-1.5 flex-shrink-0">
                      {(selectedTask.navigationUrl || selectedTask.mapsUrl) && (
                        <button
                          type="button"
                          onClick={(e) => requestNavigation(selectedTask, e)}
                          className={`h-9 w-9 flex items-center justify-center rounded-lg shadow-xs transition-all active:scale-95 cursor-pointer ${
                            needsNavigationPreflight(selectedTask.address?.locationSource)
                              ? 'bg-warning-soft hover:bg-warning text-warning border border-warning-line'
                              : 'bg-accent hover:bg-accent-hover text-white'
                          }`}
                          title={needsNavigationPreflight(selectedTask.address?.locationSource) ? 'Titik estimasi — konfirmasi patokan dulu' : 'Buka Peta Navigasi Google Maps & Mulai Perjalanan'}
                        >
                          <Navigation size={16} />
                        </button>
                      )}

                      <button
                        onClick={() => setPaymentModalTask(selectedTask)}
                        className={`h-9 w-9 flex items-center justify-center rounded-lg text-xs font-semibold transition-all shadow-xs active:scale-95 ${
                          selectedTask.pricing.paymentStatus === 'LUNAS'
                            ? 'bg-bubble-out text-accent border border-accent/30'
                            : 'bg-warning-soft hover:bg-warning text-warning border border-warning-line'
                        }`}
                        title={
                          selectedTask.pricing.paymentStatus === 'LUNAS'
                            ? 'Pembayaran sudah lunas'
                            : 'Catat Status Pembayaran Transaksi'
                        }
                      >
                        <CreditCard size={16} />
                      </button>

{/* Dynamic Transit Progress Button in Chat Drawer */}
                       {/* Anti-OTW Trap: jika jadwal sudah terlewat (overdue), bypass langsung ke tombol Selesai */}
                       {selectedTask.status === 'completed' ? (
                         <div
                           className="h-9 w-9 flex items-center justify-center rounded-lg bg-success-soft text-success border border-success-line shadow-xs"
                           title="Kunjungan telah selesai"
                         >
                           <CheckCircle2 size={16} />
                         </div>
                       ) : selectedTask.arrivedAt || isScheduleOverdue(selectedTask) ? (
                         <button
                           onClick={() => handleCompleteVisit(selectedTask)}
                           disabled={completingVisitId === selectedTask.reservationId}
                           className={`h-9 w-9 flex items-center justify-center rounded-lg bg-accent hover:bg-accent-hover text-white transition-all shadow-xs active:scale-95 disabled:opacity-50 ${
                             completingVisitId === selectedTask.reservationId ? '' : 'animate-action-pulse'
                           }`}
                           title="Tandai Tindakan Selesai"
                         >
                           {completingVisitId === selectedTask.reservationId ? (
                             <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                           ) : (
                             <CheckCircle2 size={16} />
                           )}
                         </button>
                       ) : selectedTask.otwSentAt || isTimeForArrival(selectedTask) ? (
                         <button
                           onClick={() => handleRecordArrival(selectedTask)}
                           disabled={sendingArrivalId === selectedTask.reservationId}
                           className="h-9 w-9 flex items-center justify-center rounded-lg bg-info hover:bg-info-hover text-on-solid transition-all shadow-xs active:scale-95 disabled:opacity-50"
                           title="Tandai Sudah Sampai di Lokasi"
                         >
                           {sendingArrivalId === selectedTask.reservationId ? (
                             <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                           ) : (
                             <MapPin size={16} />
                           )}
                         </button>
                        ) : (
                          <button
                            onClick={() => requestNavigation(selectedTask)}
                            disabled={sendingOtwId === selectedTask.reservationId}
                            className={`h-9 w-9 flex items-center justify-center rounded-lg transition-all border shadow-xs active:scale-95 ${
                             isOtwAllowed(selectedTask) || selectedTask.navigationUrl || selectedTask.mapsUrl
                               ? 'bg-bubble-out hover:bg-accent-soft text-accent border-accent/30'
                               : 'bg-fill-1 text-ink-2 border-divider'
                           }`}
                          title={
                            selectedTask.navigationUrl || selectedTask.mapsUrl
                              ? 'Buka peta navigasi & otomatis infokan OTW'
                              : isOtwAllowed(selectedTask)
                              ? 'Kirim info menuju lokasi (OTW) ke WhatsApp pasien'
                              : `OTW H-2 jam s/d H+15 menit (${formatTime(selectedTask.bookingDate)}); lewat itu pakai Sudah Sampai`
                          }
                        >
                          {sendingOtwId === selectedTask.reservationId ? (
                            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                          ) : (
                            <Navigation2 size={16} />
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* WhatsApp Chat Bubbles Viewport (Warm Beige Wallpaper Canvas) */}
                  <div
                    ref={chatContainerRef}
                    onScroll={handleChatScroll}
                    className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-3 bg-content relative"
                    style={{
                      backgroundImage: 'radial-gradient(rgb(var(--c-strong)) 1px, transparent 1px)',
                      backgroundSize: '24px 24px',
                      WebkitOverflowScrolling: 'touch',
                    }}
                  >
                    {loadingMessages ? (
                      <div className="flex justify-center items-center h-48 space-x-2 text-ink-2 text-xs">
                        <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent"></div>
                        <span>Memuat riwayat chat...</span>
                      </div>
                    ) : messages.length === 0 ? (
                      <div className="text-center py-20 text-ink-2 text-xs space-y-2">
                        <MessageSquare size={36} className="mx-auto text-ink-3 mb-1" />
                        <p className="font-semibold text-ink">Belum ada riwayat pesan</p>
                        <p className="text-ink-2">Ketik balasan di bawah untuk mengirim pesan langsung ke WhatsApp pasien.</p>
                      </div>
                    ) : (
                      messages.map((msg, idx) => {
                        if (!msg || typeof msg !== 'object') return null;
                        const isInbound = msg.direction === 'INBOUND';
                        const isBot = !isInbound && msg.sender_type === 'BOT';
                        const isStaff = !isInbound && msg.sender_type === 'STAFF';
                        const media = extractMedia(msg);
                        const quotedMsg = extractQuotedMessage(msg, !isSupervisor);
                        const locData = extractLocation(msg);
                        const audioData = extractAudio(msg);
                        const audioUrl = audioData?.url || null;
                        const isRevoked = !!(msg.is_revoked || (msg as any).payload_raw?.is_revoked || (msg as any).isRevoked);
                        const isLocationMsg = !!locData;
                        const isAudioMsg = !!audioUrl && !isRevoked;
                        const isValidDate = !!msg.created_at && !isNaN(new Date(msg.created_at).getTime());
                        const timeStr = isValidDate ? formatWibTime(msg.created_at) : '';
                        const fullDateTitle = (() => {
                          try {
                            return isValidDate
                              ? new Date(msg.created_at).toLocaleDateString('id-ID', {
                                  weekday: 'long',
                                  day: 'numeric',
                                  month: 'long',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  timeZone: 'Asia/Jakarta',
                                }) + ' WIB'
                              : '';
                          } catch {
                            return '';
                          }
                        })();
                        const prevMsg = idx > 0 ? messages[idx - 1] : null;
                        const isDifferentDay = isValidDate && isDifferentDayWib(msg.created_at, prevMsg?.created_at || null);
                        const separatorLabel = isValidDate ? formatChatDateSeparatorWib(msg.created_at) : '';

                        return (
                          <React.Fragment key={msg.id || `msg-${idx}`}>
                            {isDifferentDay && separatorLabel && (
                              <div className="flex justify-center my-1.5">
                                <div className="bg-surface text-ink-2 text-[11px] font-medium px-3 py-1 rounded-lg text-center shadow-xs border border-divider dark:border-divider">
                                  {separatorLabel}
                                </div>
                              </div>
                            )}
                            <div
                              className={`flex flex-col ${isInbound ? 'items-start' : 'items-end'} animate-popIn`}
                            >
                              {/* Sender Label Tag */}
                              <div className="text-[10px] text-ink-2 mb-0.5 px-1.5 flex items-center space-x-1" title={fullDateTitle}>
                                {isInbound ? (
                                  <>
                                    <User size={10} className="text-ink-2" />
                                    <span className="font-medium text-ink">
                                      {selectedTask.customerName || 'Customer'}
                                    </span>
                                  </>
                                ) : isBot ? (
                                  <>
                                    <Bot size={10} className="text-accent" />
                                    <span className="font-medium text-accent">Bot Asisten Klinik</span>
                                  </>
                                ) : isStaff ? (
                                  <>
                                    <UserCheck size={10} className="text-info" />
                                    <span className="font-medium text-info">
                                      {msg.sender_name || staff?.name || 'Terapis'}
                                    </span>
                                  </>
                                ) : (
                                  <span className="font-medium text-ink-2">Admin</span>
                                )}
                                <span>•</span>
                                <span title={fullDateTitle}>{timeStr} WIB</span>
                              </div>

                              {/* WhatsApp Speech Bubble */}
                              <div
                                className={`relative group max-w-[85%] sm:max-w-[70%] p-3 rounded-2xl text-xs leading-relaxed shadow-xs transition-all ${
                                  isRevoked
                                    ? 'bg-fill-1 text-ink-2 border border-divider italic'
                                    : isInbound
                                    ? 'bg-surface text-ink rounded-tl-xs border border-divider'
                                    : isBot
                                    ? 'bg-accent-soft text-ink rounded-tr-xs border border-accent/30'
                                    : 'bg-bubble-out text-ink rounded-tr-xs border border-accent/20'
                                }`}
                              >
                                {isRevoked ? (
                                  <div className="flex items-center gap-1.5 py-0.5 text-ink-2">
                                    <Ban size={12} className="text-ink-3 shrink-0" />
                                    <span className="italic">🚫 Pesan ini telah ditarik</span>
                                  </div>
                                ) : (
                                  <>
                                    {/* Quoted Message Preview */}
                                    {quotedMsg && (
                                      <div className="mb-2 p-2 rounded-lg border-l-[3px] border-accent bg-black/[0.04] text-[11px] leading-snug">
                                        <p className="font-bold text-[10px] text-accent truncate mb-0.5">
                                          {quotedMsg.sender_name || (quotedMsg.direction === 'INBOUND' ? (selectedTask.customerName || 'Customer') : 'Bidan / CS')}
                                        </p>
                                        <p className="text-[11px] text-ink-2 truncate">
                                          {quotedMsg.media ? (
                                            <span className="flex items-center gap-1">📷 Foto {quotedMsg.content && !/^\[(IMAGE|MEDIA)/.test(quotedMsg.content) ? `• ${quotedMsg.content.slice(0, 60)}` : ''}</span>
                                          ) : (
                                            quotedMsg.content || 'Pesan'
                                          )}
                                        </p>
                                      </div>
                                    )}

                                    {/* Share Location Card */}
                                    {isLocationMsg && locData && (
                                      <div className="mb-2 p-2.5 rounded-xl bg-fill-1 border border-divider flex items-center gap-2.5">
                                        <div className="w-9 h-9 rounded-xl bg-danger-soft text-danger flex items-center justify-center shrink-0">
                                          <MapPin size={16} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <p className="font-bold text-[12px] text-ink leading-tight flex items-center gap-1">
                                            <span>📍 {locData.isLive ? 'Live Location Pasien' : 'Share Location Pasien'}</span>
                                            {locData.isLive && <span className="inline-block w-2 h-2 rounded-full bg-danger animate-pulse" />}
                                          </p>
                                          <p className="text-[10px] text-ink-2 font-mono truncate mt-0.5">
                                            {locData.latitude.toFixed(6)}, {locData.longitude.toFixed(6)}
                                          </p>
                                          {(locData.name || locData.address) && (
                                            <p className="text-[11px] text-ink truncate mt-0.5 font-medium">
                                              {locData.name || locData.address}
                                            </p>
                                          )}
                                        </div>
                                        <a
                                          href={locData.url || `https://www.google.com/maps/search/?api=1&query=${locData.latitude},${locData.longitude}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-lg text-[11px] font-bold transition shadow-xs flex items-center gap-1 shrink-0 active:scale-95"
                                          title="Buka lokasi di Google Maps"
                                        >
                                          <span>Buka Google Maps</span>
                                          <ExternalLink size={12} />
                                        </a>
                                      </div>
                                    )}

                                    {/* Voice Note / Audio Player */}
                                    {isAudioMsg && audioUrl ? (
                                      <div className="mb-2">
                                        <VoiceNotePlayer src={audioUrl} />
                                      </div>
                                    ) : media && !isLocationMsg ? (
                                      <div
                                        onLoad={() => scrollToBottom(false)}
                                        className="mb-2 rounded-xl overflow-hidden"
                                      >
                                        <MediaImage
                                          src={media.url || media.hdUrl || media.thumbUrl}
                                          downloadSrc={media.hdUrl || media.url}
                                          thumbUrl={media.thumbUrl}
                                          caption={media.caption || extractImageCaption(msg.content) || undefined}
                                        />
                                      </div>
                                    ) : null}

                                    {/* Message Text Content (Anti-Hollow Bubble: teks dirender TEPAT 1x via resolver terpusat) */}
                                    {(() => {
                                      const hasVisual = isLocationMsg || isAudioMsg || !!media;
                                      const displayText = resolveMessageDisplayText({ content: msg.content, media }, { maskPhone: !isSupervisor });
                                      if (!displayText) {
                                        if (hasVisual) return null;
                                        return <div className="text-[11px] italic text-ink-2">[Pesan tanpa teks]</div>;
                                      }
                                      return <div className="whitespace-pre-wrap break-words select-text">{displayText}</div>;
                                    })()}
                                  </>
                                )}

                                {/* Meta Info & Delivery Ticks */}
                                <div className="flex items-center justify-end space-x-1.5 mt-1 pt-0.5 text-[10px] text-ink-2">
                                  {((msg as any).is_edited || msg.is_edited || (msg as any).payload_raw?.is_edited) && !isRevoked && (
                                    <span className="text-[9px] text-ink-2 italic">diedit</span>
                                  )}
                                  <span title={fullDateTitle}>{timeStr}</span>
                                  {!isInbound && !isRevoked && (
                                    <span
                                      className="inline-flex items-center"
                                      title={
                                        msg.delivery_status === 'read'
                                          ? `Dibaca ${msg.read_at ? formatWibTime(msg.read_at) : ''} WIB`
                                          : msg.delivery_status === 'delivered'
                                          ? `Diterima ${msg.delivered_at ? formatWibTime(msg.delivered_at) : ''} WIB`
                                          : msg.delivery_status === 'failed'
                                          ? 'Gagal terkirim'
                                          : msg.delivery_status === 'sent'
                                          ? 'Terkirim'
                                          : 'Terkirim'
                                      }
                                    >
                                      {msg.delivery_status === 'read' ? (
                                        <CheckCheck size={13} className="text-info stroke-[2.5]" />
                                      ) : msg.delivery_status === 'delivered' ? (
                                        <CheckCheck size={13} className="text-ink-3" />
                                      ) : msg.delivery_status === 'failed' ? (
                                        <AlertCircle size={12} className="text-danger" />
                                      ) : (
                                        <Check size={12} className="text-ink-3" />
                                      )}
                                    </span>
                                  )}

                                  {/* Edit message button */}
                                  {isStaff && !isRevoked && !media && !isAudioMsg && (msg.created_at ? (Date.now() - new Date(msg.created_at).getTime() <= 15 * 60 * 1000) : false) && (gatewayCapability?.supportsEdit ?? true) && (
                                    <button
                                      onClick={() => handleStartEdit(msg)}
                                      className="opacity-0 group-hover:opacity-100 hover:text-accent transition-opacity p-0.5 ml-1"
                                      title="Edit pesan ini (maksimal 15 menit)"
                                    >
                                      <PenLine size={11} />
                                    </button>
                                  )}

                                  {/* Revoke message button */}
                                  {isStaff && !isRevoked && gatewayCapability?.supportsRevoke && (
                                    <button
                                      onClick={() => handleRevokeMessage(msg)}
                                      disabled={revokingId === msg.id}
                                      className="opacity-0 group-hover:opacity-100 hover:text-danger transition-opacity p-0.5 ml-1"
                                      title="Tarik pesan ini dari WhatsApp"
                                    >
                                      {revokingId === msg.id ? (
                                        <div className="h-2.5 w-2.5 animate-spin rounded-full border border-danger border-t-transparent"></div>
                                      ) : (
                                        <Trash2 size={11} />
                                      )}
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </React.Fragment>
                        );
                      })
                    )}
                    {/* Invisible Anchor for 100% Reliable Auto-Scroll */}
                    <div ref={messagesEndRef} className="h-0 w-0 pointer-events-none" />
                  </div>

                  {/* Fase 1.2: antrean pesan gagal — tombol "Coba Kirim Lagi" tanpa ketik ulang */}
                  {failedMessages.filter((f) => f.conversationId === selectedTask.conversationId).length > 0 && (
                    <div className="bg-danger-soft border-t border-danger-line px-3 py-2 space-y-1.5 shrink-0">
                      {failedMessages
                        .filter((f) => f.conversationId === selectedTask.conversationId)
                        .map((f) => (
                          <div key={f.clientTempId} className="flex items-center gap-2 text-[11px] text-danger">
                            <AlertCircle size={13} className="flex-shrink-0 text-danger" />
                            <span className="flex-1 min-w-0 truncate">
                              {f.image && !f.text ? '📷 Foto' : f.text || '(pesan)'} — gagal terkirim
                            </span>
                            <button
                              type="button"
                              disabled={retryingTempId === f.clientTempId}
                              onClick={() => handleRetryFailedMessage(f)}
                              className="px-2 py-1 rounded-lg bg-danger hover:bg-danger-hover text-on-solid font-semibold disabled:opacity-50 active:scale-95 flex items-center gap-1 shrink-0"
                            >
                              {retryingTempId === f.clientTempId ? (
                                <span className="h-3 w-3 animate-spin rounded-full border border-white border-t-transparent" />
                              ) : (
                                <RefreshCw size={11} />
                              )}
                              Coba Kirim Lagi
                            </button>
                          </div>
                        ))}
                    </div>
                  )}

                  {/* WhatsApp Quick Reply Input Bar */}
                  <form
                    onSubmit={handleSendReply}
                    className="bg-fill-1 border-t border-divider dark:border-divider p-2.5 sm:p-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] md:pb-3 z-10 space-y-2 shrink-0"
                  >
                    {/* Quick Reply Template Chips for Fast Field Messaging */}
                    <div
                      className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5"
                      style={{ touchAction: 'pan-x', overscrollBehaviorX: 'contain' }}
                    >
                      {/* Action Button: Kirim Pembayaran — Icon-Only 44x44 (hemat ruang vertikal keyboard) */}
                      <button
                        type="button"
                        disabled={isSendingPaymentInfo}
                        onClick={() => selectedTask && handleSendPaymentInfo(selectedTask)}
                        className="h-[44px] w-[44px] min-h-[44px] min-w-[44px] rounded-full bg-bubble-out hover:bg-accent-soft text-accent border border-accent/40 flex items-center justify-center transition-all duration-150 hover:scale-105 active:scale-95 shadow-xs flex-shrink-0 disabled:opacity-50 select-none cursor-pointer"
                        title="Kirim QRIS & Rekening Bank Resmi ke WhatsApp Pasien"
                        aria-label="Kirim QRIS & Rekening Bank"
                      >
                        {isSendingPaymentInfo ? (
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                        ) : (
                          <CreditCard size={18} className="text-accent" />
                        )}
                      </button>

                      {[
                        { label: '🛵 Sedang OTW', text: 'Halo Bunda, saya sudah dalam perjalanan (OTW) menuju ke lokasi Bunda ya 🙏' },
                        { label: '📍 Sudah Sampai', text: 'Halo Bunda, saya sudah sampai di depan rumah/lokasi Bunda ya 🙏' },
                      ].map((chip, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            if (
                              chip.label.includes('Sudah Sampai') &&
                              selectedTask &&
                              !selectedTask.arrivedAt &&
                              !isTrulyCompleted(selectedTask)
                            ) {
                              handleRecordArrival(selectedTask);
                              return;
                            }
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
                          className="text-xs font-semibold bg-surface hover:bg-accent-soft dark:hover:bg-fill-2 text-accent border border-accent/30 min-h-[44px] px-3.5 py-2.5 rounded-full whitespace-nowrap transition-transform duration-150 hover:scale-105 active:scale-95 shadow-2xs flex-shrink-0 inline-flex items-center select-none"
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>

                    {selectedImage && (
                      <div className="flex items-center space-x-2 bg-surface border border-divider rounded-xl p-2">
                        <img
                          src={selectedImage.preview}
                          alt="Lampiran"
                          className="h-12 w-12 object-cover rounded-lg border border-divider"
                        />
                        <span className="flex-1 text-xs text-ink-2 truncate">
                          {selectedImage.file.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedImage(null)}
                          className="p-1.5 rounded-lg text-danger bg-danger-soft hover:bg-danger-line transition"
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
                        className="h-10 w-10 rounded-xl bg-surface border border-divider text-accent hover:bg-accent-soft dark:hover:bg-fill-2 transition shadow-xs flex items-center justify-center flex-shrink-0 disabled:opacity-40 active:scale-95"
                        title="Buka Kamera & Ambil Foto Langsung"
                        aria-label="Kamera"
                      >
                        <Camera size={18} />
                      </button>
                      <input
                        type="file"
                        accept="image/*"
                        ref={chatGalleryInputRef}
                        onChange={handlePickImage}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => chatGalleryInputRef.current?.click()}
                        disabled={sending}
                        className="h-10 w-10 rounded-xl bg-surface border border-divider text-accent hover:bg-accent-soft dark:hover:bg-fill-2 transition shadow-xs flex items-center justify-center flex-shrink-0 disabled:opacity-40 active:scale-95"
                        title="Pilih Foto / Screenshot dari Galeri"
                        aria-label="Galeri"
                      >
                        <ImageIcon size={18} />
                      </button>
                      <div className="flex-1 relative">
                        <textarea
                          ref={replyTextareaRef}
                          rows={1}
                          value={replyText}
                          onChange={handleReplyTextChange}
                          placeholder={`Ketik balasan sebagai ~ ${staff?.name || 'Terapis'}...`}
                          disabled={sending}
                          style={{ fontSize: '16px' }}
                          className="w-full resize-none bg-surface border border-divider focus:border-accent focus:ring-1 focus:ring-accent text-ink rounded-xl px-3.5 py-2 text-[16px] sm:text-sm focus:outline-none placeholder-ink-3 dark:placeholder-ink-3 transition-colors disabled:opacity-50 shadow-xs min-h-[40px] max-h-[130px] leading-relaxed block"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={(!replyText.trim() && !selectedImage) || sending}
                        className="h-10 w-10 rounded-xl bg-accent hover:bg-accent-hover text-white font-semibold shadow-xs flex items-center justify-center transition-all disabled:opacity-40 disabled:hover:bg-accent flex-shrink-0 active:scale-95"
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
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface border border-divider focus:border-accent text-[16px] sm:text-sm text-ink placeholder-ink-3 focus:outline-none transition-all shadow-xs"
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
                <div key={dateLabel} className="space-y-3">
                  {/* Date Header Pill */}
                  <div className="flex items-center space-x-2 pt-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-accent"></span>
                    <h2 className="font-bold text-sm text-ink">{dateLabel}</h2>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-surface text-ink-2 border border-divider">
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
                          className={`bg-surface rounded-2xl p-4 border border-divider dark:border-divider shadow-xs hover:border-accent/40 transition-all space-y-3 text-left ${catInfo.borderAccent} border-l-4`}
                        >
                          {/* Header: Name & Time (KLIK BARIS INI = DETAIL PASIEN) */}
                          <div
                            onClick={() => setDetailModalTask(item)}
                            className="flex items-start justify-between gap-2 p-1 -m-1 rounded-xl hover:bg-fill-1 transition cursor-pointer group"
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
                                <h3 className="font-bold text-sm text-ink truncate group-hover:text-accent transition">
                                  {item.customerName || 'Customer'}
                                </h3>
                                <p className="text-xs text-accent font-medium line-clamp-2">
                                  {item.treatmentDetail || 'Treatment Layanan Spa'}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center space-x-1 text-xs font-semibold text-accent bg-bubble-out px-2.5 py-1 rounded-lg whitespace-nowrap border border-accent/30 flex-shrink-0">
                              <Clock size={12} />
                              <span>{formatTime(item.bookingDate)}</span>
                            </div>
                          </div>

                          {/* Alamat & Jarak dari Klinik */}
                          <div className="text-xs text-ink-2 bg-surface-2 p-2.5 rounded-xl border border-divider dark:border-divider space-y-2">
                            <div className="flex items-start gap-1.5">
                              <MapPin size={14} className="text-accent mt-0.5 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-ink leading-snug">{item.address.fullText}</p>
                                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                  <AccuracyBadge source={item.address.locationSource} />
                                  <AddressUpdatedAtChip updatedAt={item.address.addressUpdatedAt} />
                                </div>
                                {item.address.distanceKm != null && (
                                  <p className="text-[10px] font-semibold text-accent mt-1 flex items-center gap-1">
                                    <Compass size={11} />
                                    <span>
                                      {item.address.distanceSource === 'PREVIOUS_PATIENT' && item.address.originName
                                        ? `Jarak: ${item.address.distanceKm.toFixed(1)} km dari ${item.address.originName}`
                                        : `Jarak: ${item.address.distanceKm.toFixed(1)} km dari klinik`}
                                      {item.address.estimatedMinutes != null && (
                                        <span className="text-ink-2 font-normal ml-1">
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
                              <div className="flex items-center gap-2 p-1.5 rounded-lg bg-surface border border-divider">
                                <div
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setZoomImageKind('house');
                                    setZoomImageUrl(item.address.housePhotoUrl || null);
                                  }}
                                  className="h-11 w-11 rounded-lg bg-fill-1 overflow-hidden flex-shrink-0 relative group cursor-pointer border border-divider"
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
                                  <span className="text-[10px] font-bold text-accent uppercase tracking-wider block">
                                    🏠 Foto Depan Rumah
                                  </span>
                                  {item.address.landmark ? (
                                    <p className="text-[11px] text-ink truncate font-medium">
                                      Patokan: {item.address.landmark}
                                    </p>
                                  ) : (
                                    <p className="text-[10px] text-ink-2 truncate">Panduan visual tersimpan</p>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenUpdateLocationModal(item);
                                  }}
                                  className="p-1.5 text-xs text-accent hover:bg-accent-soft rounded-lg transition-all border border-divider flex-shrink-0"
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
                                className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-surface hover:bg-accent-soft text-accent text-[11px] font-semibold border border-dashed border-accent/40 transition-all active:scale-95"
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
                                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-bubble-out text-accent text-xs font-medium border border-accent/20"
                                >
                                  <Baby size={12} />
                                  <span>{formatPatientName(child.name)}</span>
                                  {child.rawAgeText && (
                                    <span className="text-ink-2">({formatChildAgeText(child.rawAgeText)})</span>
                                  )}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Total Biaya & Peta Navigasi */}
                          <div className="flex items-center justify-between pt-2 border-t border-divider">
                            <div className="flex items-center gap-1 text-xs text-ink-2">
                              <CreditCard size={13} className="text-accent" />
                              <span>Biaya:</span>
                              <strong className="text-ink ml-0.5">{formatRupiah(item.pricing.totalFee)}</strong>
                            </div>

                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-ink-2 bg-fill-1 px-2 py-0.5 rounded-md border border-divider hidden sm:inline">
                                Chat aktif di hari-H
                              </span>
                              {item.navigationUrl || item.mapsUrl ? (
                                <button
                                  type="button"
                                  onClick={(e) => requestNavigation(item, e)}
                                  className="flex items-center space-x-1 py-1.5 px-3 text-xs font-semibold text-white bg-accent hover:bg-accent-hover rounded-lg transition-all active:scale-95 shadow-xs"
                                  title="Buka Peta Google Maps"
                                >
                                  <Navigation size={12} />
                                  <span>Peta Rute</span>
                                </button>
                              ) : (
                                <span className="text-[11px] text-ink-2">Tanpa Peta</span>
                              )}
                            </div>
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
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface border border-divider focus:border-accent text-[16px] sm:text-sm text-ink placeholder-ink-3 focus:outline-none transition-all shadow-xs"
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
                <div key={dateLabel} className="space-y-3">
                  {/* Date Header Pill */}
                  <div className="flex items-center space-x-2 pt-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-success"></span>
                    <h2 className="font-bold text-sm text-ink">{dateLabel}</h2>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-surface text-ink-2 border border-divider">
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
                          className={`bg-surface rounded-2xl p-4 border border-divider dark:border-divider shadow-xs hover:border-emerald-500/40 transition-all space-y-3 text-left ${catInfo.borderAccent} border-l-4`}
                        >
                          {/* Header: Name & Completed Badge (KLIK BARIS INI = DETAIL PASIEN) */}
                          <div
                            onClick={() => setDetailModalTask(item)}
                            className="flex items-start justify-between gap-2 p-1 -m-1 rounded-xl hover:bg-fill-1 transition cursor-pointer group"
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
                                <h3 className="font-bold text-sm text-ink truncate group-hover:text-accent transition">
                                  {item.customerName || 'Customer'}
                                </h3>
                                <p className="text-xs text-accent font-medium line-clamp-2">
                                  {item.treatmentDetail || 'Treatment Layanan Spa'}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center space-x-1 text-xs font-semibold text-success bg-success-soft px-2.5 py-1 rounded-lg whitespace-nowrap border border-success-line flex-shrink-0">
                              <CheckCheck size={13} className="text-success" />
                              <span>Selesai</span>
                            </div>
                          </div>

                          {/* Alamat & Jarak dari Klinik */}
                          <div className="text-xs text-ink-2 bg-surface-2 p-2.5 rounded-xl border border-divider dark:border-divider space-y-2">
                            <div className="flex items-start gap-1.5">
                              <MapPin size={14} className="text-accent mt-0.5 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-ink leading-snug">{item.address.fullText}</p>
                                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                  <AccuracyBadge source={item.address.locationSource} />
                                  <AddressUpdatedAtChip updatedAt={item.address.addressUpdatedAt} />
                                </div>
                                {item.address.distanceKm != null && (
                                  <p className="text-[10px] font-semibold text-accent mt-1 flex items-center gap-1">
                                    <Compass size={11} />
                                    <span>Jarak: {item.address.distanceKm.toFixed(1)} km dari klinik</span>
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* Foto Depan Rumah & Patokan Landmark */}
                            {item.address.housePhotoUrl && (
                              <div className="flex items-center gap-2 p-1.5 rounded-lg bg-surface border border-divider">
                                <div
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setZoomImageKind('house');
                                    setZoomImageUrl(item.address.housePhotoUrl || null);
                                  }}
                                  className="h-11 w-11 rounded-lg bg-fill-1 overflow-hidden flex-shrink-0 relative group cursor-pointer border border-divider"
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
                                  <span className="text-[10px] font-bold text-accent uppercase tracking-wider block">
                                    🏠 Foto Depan Rumah
                                  </span>
                                  {item.address.landmark ? (
                                    <p className="text-[11px] text-ink truncate font-medium">
                                      Patokan: {item.address.landmark}
                                    </p>
                                  ) : (
                                    <p className="text-[10px] text-ink-2 truncate">Panduan visual tersimpan</p>
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
                                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-bubble-out text-accent text-xs font-medium border border-accent/20"
                                >
                                  <Baby size={12} />
                                  <span>{formatPatientName(child.name)}</span>
                                  {child.rawAgeText && (
                                    <span className="text-ink-2">({formatChildAgeText(child.rawAgeText)})</span>
                                  )}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Status Pembayaran & Detail Button */}
                          <div className="pt-2 border-t border-divider space-y-1.5">
                            <div className="flex items-center gap-1 text-xs text-ink-2 flex-wrap">
                              <CreditCard size={13} className="text-success" />
                              <strong className="text-success font-bold ml-0.5">
                                {formatRupiah(item.pricing.totalFee)}
                              </strong>
                              <span className="text-[10px] px-1.5 py-0.5 bg-success-soft text-success rounded font-semibold ml-1">
                                {item.pricing.paymentStatusLabel}
                              </span>
                            </div>

                            {item.pricing.paymentStatus === 'TAGIH_DI_TEMPAT' ? (
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                                {item.conversationId && isChatWindowOpen(item) && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenChat(item);
                                    }}
                                    className="min-h-[44px] py-2 px-2 text-xs font-semibold text-ink-2 bg-fill-1 hover:bg-fill-2 rounded-lg transition-all active:scale-95 border border-divider flex items-center justify-center gap-1"
                                    title="Buka Riwayat Chat WhatsApp"
                                  >
                                    <MessageSquare size={13} className="text-accent" />
                                    <span>Chat</span>
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={(e) => handleOpenQrisFast(item, e)}
                                  className="min-h-[44px] py-2 px-2 text-xs font-bold text-accent bg-bubble-out hover:bg-accent-soft/80 rounded-lg transition-all active:scale-95 border border-accent/30 flex items-center justify-center gap-1"
                                  title="Tampilkan barcode QRIS langsung ke pasien"
                                >
                                  <QrCode size={13} />
                                  <span>QRIS</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPaymentModalTask(item);
                                  }}
                                  className="min-h-[44px] py-2 px-2 text-xs font-bold text-warning bg-warning-soft hover:bg-warning rounded-lg transition-all active:scale-95 border border-warning-line flex items-center justify-center gap-1"
                                  title="Catat pembayaran / unggah bukti transfer pasien"
                                >
                                  <CreditCard size={13} className="text-warning" />
                                  <span>Catat Bayar</span>
                                </button>

                                {item.conversationId && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSendPaymentInfo(item);
                                    }}
                                    disabled={isSendingPaymentInfo}
                                    className="min-h-[44px] py-2 px-2 text-xs font-bold text-accent bg-bubble-out hover:bg-accent-soft/80 rounded-lg transition-all active:scale-95 border border-accent/30 disabled:opacity-50 flex items-center justify-center gap-1"
                                    title="Kirim rincian tagihan & QRIS ke WhatsApp pasien"
                                  >
                                    <MessageSquare size={13} />
                                    <span>Kirim Tagihan</span>
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() => setDetailModalTask(item)}
                                  className="min-h-[44px] py-2 px-2 text-xs font-semibold text-accent bg-bubble-out hover:bg-accent-soft/80 rounded-lg transition-all active:scale-95 border border-accent/30 flex items-center justify-center gap-1"
                                  title="Lihat Detail Lengkap Pasien"
                                >
                                  <Info size={13} />
                                  <span>Detail</span>
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between gap-1.5 flex-wrap">
                                <div className="flex items-center gap-1.5">
                                  {item.conversationId && isChatWindowOpen(item) && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleOpenChat(item);
                                      }}
                                      className="min-h-[44px] py-2 px-3 text-xs font-semibold text-ink-2 bg-fill-1 hover:bg-fill-2 rounded-lg transition-all active:scale-95 border border-divider flex items-center gap-1"
                                      title="Buka Riwayat Chat WhatsApp"
                                    >
                                      <MessageSquare size={13} className="text-accent" />
                                      <span>Chat</span>
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (item.pricing.proofUrl) {
                                        setZoomImageKind('proof');
                                        setZoomImageUrl(item.pricing.proofUrl);
                                      } else {
                                        setPaymentModalTask(item);
                                      }
                                    }}
                                    className="min-h-[44px] py-2 px-3 text-xs font-bold text-accent bg-bubble-out hover:bg-accent-soft/80 rounded-lg transition-all active:scale-95 border border-accent/30 flex items-center gap-1"
                                    title={item.pricing.proofUrl ? 'Lihat bukti pembayaran tersimpan' : 'Unggah bukti pembayaran / invoice susulan'}
                                  >
                                    <CheckCircle2 size={13} />
                                    <span>{item.pricing.proofUrl ? 'Bukti Bayar' : 'Unggah Bukti'}</span>
                                  </button>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => setDetailModalTask(item)}
                                  className="min-h-[44px] py-2 px-3 text-xs font-semibold text-accent bg-bubble-out hover:bg-accent-soft/80 rounded-lg transition-all active:scale-95 border border-accent/30 flex items-center gap-1"
                                  title="Lihat Detail Lengkap Pasien"
                                >
                                  <Info size={13} />
                                  <span>Detail</span>
                                </button>
                              </div>
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

        {/* Drawer Body (Notch-safe, lebar optimal mobile) */}
        <div
          className={`relative w-[75vw] sm:w-[280px] max-w-[300px] sm:max-w-[280px] bg-surface h-full shadow-2xl flex flex-col z-10 transform transition-transform duration-300 ease-out ${
            showMenuDrawer ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
            {/* Drawer Header — safe-area atas agar tidak tertutup notch / Dynamic Island */}
            <div className="px-3 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] pb-3 bg-accent text-white flex items-center justify-between shadow-xs">
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
                className={`w-full flex items-center justify-between p-2 rounded-xl transition-all text-left ${
                  activeTab === 'today'
                    ? 'bg-bubble-out text-accent font-bold shadow-xs border border-accent/30'
                    : 'bg-fill-1 hover:bg-fill-2 text-ink'
                }`}
              >
                <div className="flex items-center space-x-2 min-w-0">
                  <div
                    className={`h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      activeTab === 'today' ? 'bg-accent text-white' : 'bg-surface text-accent shadow-xs'
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
                    activeTab === 'today' ? 'bg-accent text-white' : 'bg-surface text-accent border border-divider'
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
                    ? 'bg-bubble-out text-accent font-bold shadow-xs border border-accent/30'
                    : 'bg-fill-1 hover:bg-fill-2 text-ink'
                }`}
              >
                <div className="flex items-center space-x-2 min-w-0">
                  <div
                    className={`h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      activeTab === 'upcoming' ? 'bg-accent text-white' : 'bg-surface text-accent shadow-xs'
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
                    activeTab === 'upcoming' ? 'bg-accent text-white' : 'bg-surface text-accent border border-divider'
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
                    ? 'bg-bubble-out text-accent font-bold shadow-xs border border-accent/30'
                    : 'bg-fill-1 hover:bg-fill-2 text-ink'
                }`}
              >
                <div className="flex items-center space-x-2 min-w-0">
                  <div
                    className={`h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      activeTab === 'completed' ? 'bg-accent text-white' : 'bg-surface text-accent shadow-xs'
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
                    activeTab === 'completed' ? 'bg-accent text-white' : 'bg-surface text-accent border border-divider'
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
                  className="w-full flex items-center justify-center space-x-1.5 py-2 px-2.5 rounded-xl bg-accent hover:bg-accent-hover text-[11px] font-bold text-white shadow-xs transition-all active:scale-95"
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
                className="w-full flex items-center justify-center space-x-1.5 py-2 px-2.5 rounded-xl bg-surface hover:bg-fill-2 text-[11px] font-semibold text-ink border border-divider shadow-xs transition-all active:scale-95"
              >
                <Info size={13} className="text-accent flex-shrink-0" />
                <span className="truncate">Profil Akun</span>
              </button>

              {/* Seksi Preferensi & Pengaturan: Notifikasi + Mode Terang/Gelap */}
              <div className="pt-2 mt-1 border-t border-divider">
                <div className="px-1.5 pb-1.5 text-[10px] font-bold text-ink-2 uppercase tracking-wider">
                  Preferensi & Pengaturan
                </div>

                <button
                  type="button"
                  onClick={handleSyncPush}
                  disabled={pushSyncing}
                  className={`w-full flex items-center justify-between p-2 rounded-xl border transition-all active:scale-95 shadow-xs disabled:opacity-60 ${
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
                className="w-full flex items-center justify-center space-x-1.5 py-2 px-2.5 rounded-xl bg-danger-soft hover:bg-danger-line text-[11px] font-semibold text-danger border border-danger-line shadow-xs transition-all active:scale-95"
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
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fadeIn"
          onClick={() => setShowStaffProfileModal(false)}
        >
          <div
            className="bg-surface rounded-3xl p-6 w-full max-w-sm shadow-2xl border border-divider dark:border-divider space-y-5 text-center relative animate-modalScaleUp"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowStaffProfileModal(false)}
              className="absolute top-4 right-4 p-1.5 rounded-full text-ink-3 hover:text-ink hover:bg-fill-1 transition"
            >
              <X size={18} />
            </button>

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
                    className="w-full py-2 px-3 bg-accent hover:bg-accent-hover text-white rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 shadow-xs"
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
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL DETAIL JADWAL & PASIEN (PRIVACY SAFE - NO PHONE LEAK) */}
      {/* ========================================================================= */}
      {detailModalTask && (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-xs animate-fadeIn"
          onClick={() => setDetailModalTask(null)}
        >
          <div
            className="bg-surface rounded-t-3xl sm:rounded-3xl p-6 w-full max-w-md shadow-2xl border border-divider dark:border-divider space-y-4 text-left relative max-h-[88dvh] sm:max-h-[90vh] overflow-y-auto animate-modalScaleUp"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Mobile drag handle */}
            <div className="w-12 h-1.5 bg-strong rounded-full mx-auto -mt-2 mb-2 sm:hidden shrink-0" />

            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-divider pb-3">
              <div className="flex items-center space-x-3">
                <CustomerAvatar
                  src={detailModalTask.customerProfilePictureUrl}
                  name={detailModalTask.customerName}
                  size="lg"
                />
                <div>
                  <h3 className="font-bold text-base text-ink">
                    {detailModalTask.customerName || 'Customer'}
                  </h3>
                  <div className="flex items-center space-x-1.5 text-xs text-accent font-semibold mt-0.5">
                    <Clock size={12} />
                    <span>{formatTime(detailModalTask.bookingDate)}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setDetailModalTask(null)}
                className="p-1.5 rounded-full text-ink-3 hover:text-ink hover:bg-fill-1 transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Treatment & Category */}
            <div className="p-3.5 rounded-2xl bg-surface-2 border border-divider space-y-1.5">
              <span className="text-[10px] font-bold text-ink-2 uppercase tracking-wider block">
                Layanan & Treatment
              </span>
              <p className="text-sm font-bold text-ink">
                {detailModalTask.treatmentDetail || 'Treatment Layanan Spa'}
              </p>
              <span className="inline-block px-2.5 py-0.5 rounded-md text-xs font-semibold bg-accent-soft text-accent border border-accent/30">
                Kategori: {getCategoryIcon(detailModalTask.treatmentCategory).label}
              </span>
            </div>

            {/* Alamat & Jarak */}
            <div className="p-3.5 rounded-2xl bg-surface-2 border border-divider space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-ink-2 uppercase tracking-wider block">
                  Alamat Lokasi Kunjungan
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const t = detailModalTask;
                    setDetailModalTask(null);
                    handleOpenUpdateLocationModal(t);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline"
                >
                  <PenLine size={11} />
                  <span>Update Titik & Foto</span>
                </button>
              </div>

              <div className="flex items-start space-x-2 text-xs text-ink">
                <MapPin size={15} className="text-accent mt-0.5 flex-shrink-0" />
                <div className="leading-relaxed flex-1 min-w-0">
                  <p className="font-medium">{detailModalTask.address.fullText}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <AccuracyBadge source={detailModalTask.address.locationSource} />
                    <AddressUpdatedAtChip updatedAt={detailModalTask.address.addressUpdatedAt} />
                  </div>
                  {detailModalTask.address.distanceKm != null && (
                    <p className="text-[11px] font-semibold text-accent mt-1 flex items-center space-x-1">
                      <Compass size={12} />
                      <span>
                        {detailModalTask.address.distanceSource === 'PREVIOUS_PATIENT' && detailModalTask.address.originName
                          ? `${detailModalTask.address.distanceKm.toFixed(1)} km dari ${detailModalTask.address.originName}`
                          : `${detailModalTask.address.distanceKm.toFixed(1)} km dari klinik`}
                        {detailModalTask.address.estimatedMinutes != null && (
                          <span className="text-ink-2 font-normal ml-1">
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
                <div className="flex items-center gap-2.5 p-2 rounded-xl bg-surface border border-divider mt-1">
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      setZoomImageKind('house');
                      setZoomImageUrl(detailModalTask.address.housePhotoUrl || null);
                    }}
                    className="h-14 w-14 rounded-xl bg-fill-1 overflow-hidden flex-shrink-0 relative group cursor-pointer border border-divider"
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
                    <span className="text-[10px] font-bold text-accent uppercase tracking-wider block">
                      🏠 Foto Tampak Depan Rumah
                    </span>
                    {detailModalTask.address.landmark ? (
                      <p className="text-xs text-ink font-semibold mt-0.5">
                        Patokan: {detailModalTask.address.landmark}
                      </p>
                    ) : (
                      <p className="text-[11px] text-ink-2">Panduan visual tersimpan</p>
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
                  className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-surface hover:bg-accent-soft text-accent text-xs font-semibold border border-dashed border-accent/40 transition-all active:scale-95"
                >
                  <Camera size={13} />
                  <span>+ Tambah Foto Depan Rumah & Update GPS</span>
                </button>
              )}
            </div>

            {/* Fase 5r — Ringkasan Pasien (catatan karakter dari LiveChat) */}
            {detailModalTask.adminNotes && (
              <div className="p-3.5 rounded-2xl bg-warning-soft border border-warning-line space-y-1.5">
                <span className="text-[10px] font-bold text-warning uppercase tracking-wider block flex items-center gap-1">
                  📋 Ringkasan Pasien — Catatan Khusus
                </span>
                <p className="text-xs text-warning whitespace-pre-wrap leading-relaxed">{detailModalTask.adminNotes}</p>
              </div>
            )}

            {/* Data Anak */}
            {detailModalTask.children && detailModalTask.children.length > 0 && (
              <div className="p-3.5 rounded-2xl bg-surface-2 border border-divider space-y-1.5">
                <span className="text-[10px] font-bold text-ink-2 uppercase tracking-wider block">
                  Data Pasien Anak
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {detailModalTask.children.map((c, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-xl bg-info-soft text-info border border-info-line text-xs font-semibold"
                    >
                      <Baby size={13} />
                      <span>{formatPatientName(c.name)} {c.rawAgeText ? `(${formatChildAgeText(c.rawAgeText)})` : ''}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Rincian Finansial / Pembayaran */}
            <div className="p-3.5 rounded-2xl bg-surface-2 border border-divider space-y-2">
              <span className="text-[10px] font-bold text-ink-2 uppercase tracking-wider block">
                Rincian Biaya & Status Pembayaran
              </span>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between text-ink-2">
                  <span>Biaya Layanan:</span>
                  <span>{formatRupiah(detailModalTask.pricing.treatmentFee)}</span>
                </div>
                <div className="flex justify-between text-ink-2">
                  <span>Ongkos Kirim:</span>
                  <span>{formatRupiah(detailModalTask.pricing.deliveryFee)}</span>
                </div>
                <div className="flex justify-between font-bold text-ink pt-1 border-t border-divider">
                  <span>Total Tagihan:</span>
                  <span className="text-accent text-sm">{formatRupiah(detailModalTask.pricing.totalFee)}</span>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between">
                <span className="text-xs text-ink-2">Status Pembayaran:</span>
                {detailModalTask.pricing.paymentStatus === 'LUNAS' ? (
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-bubble-out text-accent border border-accent/30 flex items-center space-x-1">
                    <CheckCircle2 size={12} />
                    <span>LUNAS</span>
                  </span>
                ) : (
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-warning-soft text-warning border border-warning-line flex items-center space-x-1">
                    <CreditCard size={12} />
                    <span>TAGIH DI TEMPAT</span>
                  </span>
                )}
              </div>

              {/* Aksi pembayaran pasca-selesai (tanpa gate jendela chat) */}
              <div className="pt-2 flex flex-wrap gap-2">
                {detailModalTask.pricing.paymentStatus === 'TAGIH_DI_TEMPAT' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setPaymentModalTask(detailModalTask)}
                      className="flex-1 min-w-[160px] py-2.5 px-3 bg-warning-soft hover:bg-warning text-warning border border-warning-line rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 active:scale-95"
                      title="Catat pembayaran & unggah bukti transfer pasien"
                    >
                      <CreditCard size={14} className="text-warning" />
                      <span>Catat Pembayaran & Unggah Bukti</span>
                    </button>
                    {detailModalTask.conversationId && (
                      <button
                        type="button"
                        onClick={() => handleSendPaymentInfo(detailModalTask)}
                        disabled={isSendingPaymentInfo}
                        className="flex-1 min-w-[160px] py-2.5 px-3 bg-bubble-out hover:bg-accent-soft/80 text-accent border border-accent/30 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 active:scale-95 disabled:opacity-50"
                        title="Kirim rincian tagihan & QRIS ke WhatsApp pasien"
                      >
                        <MessageSquare size={14} />
                        <span>Kirim Tagihan & QRIS ke WA</span>
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (detailModalTask.pricing.proofUrl) {
                        setZoomImageKind('proof');
                        setZoomImageUrl(detailModalTask.pricing.proofUrl);
                      } else {
                        setPaymentModalTask(detailModalTask);
                      }
                    }}
                    className="flex-1 min-w-[160px] py-2.5 px-3 bg-bubble-out hover:bg-accent-soft/80 text-accent border border-accent/30 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 active:scale-95"
                    title={detailModalTask.pricing.proofUrl ? 'Lihat bukti pembayaran tersimpan' : 'Unggah bukti pembayaran / invoice susulan'}
                  >
                    <CheckCircle2 size={14} />
                    <span>{detailModalTask.pricing.proofUrl ? 'Lihat Bukti Pembayaran' : 'Unggah Bukti Pembayaran'}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="pt-1 flex space-x-2">
              {detailModalTask.conversationId && isChatWindowOpen(detailModalTask) && (
                <button
                  type="button"
                  onClick={() => {
                    const t = detailModalTask;
                    setDetailModalTask(null);
                    handleOpenChat(t);
                  }}
                  className="flex-1 py-3 px-4 bg-bubble-out hover:bg-accent-soft/80 text-accent border border-accent/30 rounded-2xl text-xs font-bold transition flex items-center justify-center space-x-1.5 shadow-xs cursor-pointer active:scale-95"
                  title="Buka Chat WhatsApp Pasien"
                >
                  <MessageSquare size={14} className="text-accent" />
                  <span>Chat Pasien</span>
                </button>
              )}
              {(detailModalTask.navigationUrl || detailModalTask.mapsUrl) && (
                <button
                  type="button"
                  onClick={(e) => requestNavigation(detailModalTask, e)}
                  className={`flex-1 py-3 px-4 rounded-2xl text-xs font-bold transition flex items-center justify-center space-x-1.5 shadow-xs cursor-pointer active:scale-95 ${
                    needsNavigationPreflight(detailModalTask.address?.locationSource)
                      ? 'bg-warning-soft hover:bg-warning text-warning border border-warning-line'
                      : 'bg-accent hover:bg-accent-hover text-white'
                  }`}
                >
                  <Navigation size={14} />
                  <span>{needsNavigationPreflight(detailModalTask.address?.locationSource) ? 'Buka Peta (Estimasi)' : 'Buka Peta Navigasi'}</span>
                </button>
              )}
              <button
                onClick={() => setDetailModalTask(null)}
                className="py-3 px-5 bg-surface hover:bg-fill-1 border border-divider text-ink rounded-2xl text-xs font-bold transition shadow-xs"
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
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-xs animate-fadeIn"
          onClick={() => setPaymentModalTask(null)}
        >
          <div
            className="bg-surface rounded-t-3xl sm:rounded-3xl p-6 w-full max-w-md shadow-2xl border border-divider dark:border-divider space-y-4 text-left animate-modalScaleUp max-h-[88dvh] sm:max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Mobile drag handle */}
            <div className="w-12 h-1.5 bg-strong rounded-full mx-auto -mt-2 mb-2 sm:hidden shrink-0" />

            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-ink flex items-center space-x-2">
                  <CreditCard className="text-accent" size={20} />
                  <span>Catat Pembayaran Pasien</span>
                </h3>
                <p className="text-xs text-ink-2 mt-0.5">
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
                className="p-1.5 rounded-full text-ink-3 hover:text-ink hover:bg-fill-1 transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Total Tagihan Banner */}
            <div className="bg-fill-1 p-3.5 rounded-2xl border border-divider flex items-center justify-between">
              <div>
                <span className="text-xs text-ink-2 block">Total Tagihan:</span>
                <span className="text-base font-bold text-accent">
                  {formatRupiah(paymentModalTask.pricing.totalFee)}
                </span>
              </div>
              <span className="text-[11px] font-semibold px-2.5 py-1 bg-surface text-ink-2 rounded-xl border border-divider">
                Ongkir: {formatRupiah(paymentModalTask.pricing.deliveryFee)}
              </span>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmitPayment} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-ink mb-2">
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
                          ? 'bg-accent text-white border-accent shadow-xs'
                          : 'bg-surface text-ink-2 border-divider hover:bg-fill-1'
                      }`}
                    >
                      {method === 'CASH' ? '💵 Tunai' : method === 'TRANSFER' ? '🏦 Transfer' : '📱 QRIS'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dynamic Payment Info Details (Data-Driven from Clinic Policy / Tenant Settings) */}
              {paymentMethod === 'QRIS' && (
                <div className="p-3 bg-surface-2 rounded-2xl border border-divider space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-ink flex items-center gap-1.5">
                      <QrCode size={15} className="text-accent" />
                      <span>Barcode QRIS Klinik</span>
                    </span>
                    {paymentInfo?.qrisImageUrl && (
                      <button
                        type="button"
                        onClick={() => setQrisZoomModal(true)}
                        className="text-[11px] font-bold text-accent hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <span>Perbesar Layar</span>
                      </button>
                    )}
                  </div>

                  {loadingPaymentInfo ? (
                    <div className="py-6 flex flex-col items-center justify-center space-y-2 text-ink-2">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                      <span className="text-[11px]">Memuat QRIS resmi...</span>
                    </div>
                  ) : paymentInfo?.qrisImageUrl ? (
                    <div className="flex flex-col items-center space-y-2">
                      <div
                        onClick={() => setQrisZoomModal(true)}
                        className="p-2 bg-surface rounded-xl border border-divider shadow-xs cursor-pointer hover:border-accent transition group"
                        title="Ketuk untuk memperbesar QRIS ke layar penuh"
                      >
                        <img
                          src={paymentInfo.qrisImageUrl}
                          alt="QRIS Klinik"
                          className="w-44 h-44 object-contain rounded-lg group-hover:scale-[1.02] transition-transform"
                        />
                      </div>
                      <p className="text-[11px] text-ink-2 text-center">
                        Tunjukkan QRIS di atas kepada pasien untuk discan langsung via GoPay, OVO, Dana, BCA Mobile, dll.
                      </p>
                    </div>
                  ) : (
                    <div className="py-4 px-3 text-center text-xs text-warning bg-warning-soft rounded-xl border border-warning-line">
                      Gambar QRIS belum dikonfigurasi di pengaturan klinik. Silakan minta admin mengunggah QRIS atau gunakan transfer rekening.
                    </div>
                  )}
                  {paymentInfo?.instructions && (
                    <p className="text-[10px] text-ink-3 italic text-center">{paymentInfo.instructions}</p>
                  )}
                </div>
              )}

              {paymentMethod === 'TRANSFER' && (
                <div className="p-3 bg-surface-2 rounded-2xl border border-divider space-y-2.5">
                  <span className="text-xs font-bold text-ink block">
                    Rekening Resmi Klinik:
                  </span>

                  {loadingPaymentInfo ? (
                    <div className="py-6 flex flex-col items-center justify-center space-y-2 text-ink-2">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                      <span className="text-[11px]">Memuat rekening...</span>
                    </div>
                  ) : paymentInfo?.bankAccounts && paymentInfo.bankAccounts.length > 0 ? (
                    <div className="space-y-2">
                      {paymentInfo.bankAccounts.map((acc, idx) => (
                        <div
                          key={idx}
                          className="p-2.5 bg-surface rounded-xl border border-divider flex items-center justify-between shadow-2xs"
                        >
                          <div className="min-w-0">
                            <span className="text-xs font-bold text-ink block">{acc.bank}</span>
                            <span className="font-mono text-xs font-semibold text-accent tracking-wider block">
                              {acc.accountNumber}
                            </span>
                            <span className="text-[10px] text-ink-2 block truncate">
                              a.n. {acc.accountName}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleCopyAccountNumber(acc.accountNumber, acc.bank)}
                            className="px-2.5 py-1.5 rounded-lg bg-fill-1 hover:bg-bubble-out text-ink-2 hover:text-accent text-xs font-bold transition flex items-center gap-1 border border-divider active:scale-95 flex-shrink-0 cursor-pointer"
                            title="Salin nomor rekening"
                          >
                            <Copy size={12} />
                            <span>Salin</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-3 px-3 text-center text-xs text-warning bg-warning-soft rounded-xl border border-warning-line">
                      Rekening bank belum terdaftar di pengaturan klinik.
                    </div>
                  )}
                  {paymentInfo?.instructions && (
                    <p className="text-[10px] text-ink-3 italic text-center">{paymentInfo.instructions}</p>
                  )}
                </div>
              )}

              {paymentMethod === 'CASH' && (
                <div className="p-3 bg-success-soft/60 rounded-2xl border border-success-line text-xs text-success space-y-1">
                  <span className="font-bold block">💵 Pembayaran Tunai di Tempat</span>
                  <p className="text-[11px] text-success leading-relaxed">
                    Terima uang tunai pas sejumlah{' '}
                    <strong className="font-bold">{formatRupiah(paymentModalTask.pricing.totalFee)}</strong>.
                    Bukti foto struk tidak diwajibkan untuk metode tunai.
                  </p>
                </div>
              )}

              {/* Upload Proof if Non-Cash */}
              {paymentMethod !== 'CASH' && (
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-ink">
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
                    <div className="relative rounded-xl overflow-hidden border border-divider bg-black/5 flex items-center justify-center max-h-48">
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
                      className="w-full py-4 border-2 border-dashed border-divider hover:border-accent rounded-2xl flex flex-col items-center justify-center text-xs text-ink-2 hover:text-accent transition bg-surface-2"
                    >
                      <Upload size={20} className="mb-1 text-ink-3" />
                      <span>Ketuk untuk pilih atau ambil foto bukti transfer</span>
                    </button>
                  )}
                </div>
              )}

              {/* Submit Buttons */}
              <div className="flex justify-end space-x-2 pt-3 border-t border-divider">
                <button
                  type="button"
                  onClick={() => {
                    setPaymentModalTask(null);
                    setProofImageB64(null);
                    setPaymentMethod('CASH');
                  }}
                  className="px-4 py-2.5 rounded-xl border border-divider text-xs font-semibold text-ink-2 hover:bg-fill-1 transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submittingPayment || (paymentMethod !== 'CASH' && !proofImageB64)}
                  className="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50"
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
      {/* MODAL FULLSCREEN QRIS LIGHTBOX (UNTUK DITUNJUKKAN & DISCAN PASIEN) */}
      {/* ========================================================================= */}
      {qrisZoomModal && (
        <div
          className="fixed inset-0 z-[150] flex flex-col items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn"
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
              className="w-full py-2.5 rounded-xl bg-accent text-white text-xs font-bold hover:bg-accent-hover transition active:scale-95 shadow-xs"
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
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-fadeIn"
          onClick={() => setUpdateLocationModalTask(null)}
        >
          <div
            className="bg-surface rounded-3xl p-5 sm:p-6 w-full max-w-md shadow-2xl border border-divider dark:border-divider space-y-4 text-left relative max-h-[92vh] overflow-y-auto animate-modalScaleUp"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between border-b border-divider pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="h-10 w-10 rounded-2xl bg-accent-soft text-accent flex items-center justify-center border border-accent/30 shadow-xs">
                  <MapPin size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-base text-ink">
                    {locModalMode === 'view' ? 'Panduan Lokasi Tersimpan' : 'Update Lokasi & Foto Rumah'}
                  </h3>
                  <p className="text-xs text-ink-2 truncate max-w-[220px]">
                    {updateLocationModalTask.customerName || 'Customer'}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setUpdateLocationModalTask(null)}
                className="p-1.5 rounded-full text-ink-3 hover:text-ink hover:bg-fill-1 transition"
              >
                <X size={18} />
              </button>
            </div>

            {locModalMode === 'view' ? (
              <div className="space-y-4">
                {/* Foto Rumah Tersimpan */}
                {updateLocationModalTask.address.housePhotoUrl ? (
                  <div className="relative rounded-2xl overflow-hidden border border-divider bg-black/5 flex items-center justify-center max-h-56 group">
                    <img
                      src={updateLocationModalTask.address.housePhotoUrl}
                      alt="Foto Rumah"
                      className="object-contain max-h-56 w-auto rounded-xl"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setZoomImageKind('house');
                        setZoomImageUrl(updateLocationModalTask.address.housePhotoUrl!);
                      }}
                      className="absolute bottom-2.5 right-2.5 px-3 py-1.5 rounded-xl bg-black/70 text-white text-xs font-semibold hover:bg-black/90 transition shadow-md flex items-center gap-1.5 cursor-pointer backdrop-blur-xs"
                    >
                      <Maximize2 size={13} />
                      <span>Lihat Penuh</span>
                    </button>
                  </div>
                ) : (
                  <div className="p-5 rounded-2xl border-2 border-dashed border-divider bg-surface-2 text-center text-xs text-ink-3 space-y-1">
                    <ImageIcon size={24} className="mx-auto text-ink-3" />
                    <p>Belum ada foto tampak depan rumah</p>
                  </div>
                )}

                {/* Info Titik GPS */}
                {updateLocationModalTask.address.lat != null && updateLocationModalTask.address.lng != null ? (
                  <div className="p-3.5 bg-bubble-out/70 border border-accent/40 rounded-2xl space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5 text-xs font-bold text-accent">
                        <CheckCircle2 size={15} className="text-accent" />
                        <span>Titik GPS Terkunci</span>
                      </div>
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${updateLocationModalTask.address.lat},${updateLocationModalTask.address.lng}&travelmode=two-wheeler`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1 rounded-lg bg-accent text-white text-[11px] font-bold hover:bg-accent-hover transition inline-flex items-center gap-1 shadow-2xs"
                      >
                        <span>Buka Maps</span>
                        <ExternalLink size={11} />
                      </a>
                    </div>
                    <p className="text-xs font-mono text-ink bg-white/80 px-2.5 py-1.5 rounded-xl border border-accent/20">
                      📍 {updateLocationModalTask.address.lat.toFixed(6)}, {updateLocationModalTask.address.lng.toFixed(6)}
                    </p>
                  </div>
                ) : (
                  <div className="p-3 bg-warning-soft border border-warning-line rounded-xl text-xs text-warning flex items-center gap-2">
                    <AlertTriangle size={15} className="shrink-0 text-warning" />
                    <span>Belum ada titik GPS presisi untuk pasien ini.</span>
                  </div>
                )}

                {/* Info Patokan */}
                {updateLocationModalTask.address.landmark && (
                  <div className="p-3.5 bg-info-soft border border-info-line rounded-2xl space-y-1">
                    <span className="text-[10px] font-bold text-info uppercase tracking-wider block">
                      🏷️ Patokan / Ciri Rumah:
                    </span>
                    <p className="text-xs font-medium text-ink">
                      {updateLocationModalTask.address.landmark}
                    </p>
                  </div>
                )}

                {/* Info Alamat Pasien */}
                <div className="p-3 rounded-xl bg-surface-2 border border-divider text-xs text-ink-2 space-y-1">
                  <span className="text-[10px] font-bold text-ink-2 uppercase tracking-wider block">
                    Alamat Tercatat:
                  </span>
                  <p className="text-xs text-ink font-medium leading-snug">
                    {updateLocationModalTask.address.fullText}
                  </p>
                </div>

                {/* Action Buttons */}
                <div className="flex justify-end space-x-2 pt-3 border-t border-divider">
                  <button
                    type="button"
                    onClick={() => setUpdateLocationModalTask(null)}
                    className="px-4 py-2.5 rounded-xl border border-divider text-xs font-semibold text-ink-2 hover:bg-fill-1 transition"
                  >
                    Tutup
                  </button>
                  <button
                    type="button"
                    onClick={() => setLocModalMode('edit')}
                    className="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-xs active:scale-95"
                  >
                    <Pencil size={13} />
                    <span>Edit / Perbarui Panduan</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {hasSavedLocData && (
                  <button
                    type="button"
                    onClick={() => setLocModalMode('view')}
                    className="text-xs font-bold text-accent hover:underline flex items-center gap-1 cursor-pointer mb-1"
                  >
                    <ArrowLeft size={13} />
                    <span>Kembali ke Panduan Tersimpan</span>
                  </button>
                )}

                {/* Info Alamat Pasien */}
                <div className="p-3 rounded-xl bg-surface-2 border border-divider text-xs text-ink-2 space-y-1">
                  <span className="text-[10px] font-bold text-ink-2 uppercase tracking-wider block">
                    Alamat Tercatat:
                  </span>
                  <p className="text-xs text-ink font-medium leading-snug">
                    {updateLocationModalTask.address.fullText}
                  </p>
                </div>

                {/* Bagian 1: Koordinat GPS Otomatis */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-ink">
                    1. Titik Koordinat GPS Rumah Pasien:
                  </label>

                  <button
                    type="button"
                    onClick={handleGetCurrentGps}
                    disabled={locGettingGps}
                    className="w-full min-h-[46px] py-2.5 px-3 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-bold transition flex items-center justify-center space-x-2 shadow-xs active:scale-95 disabled:opacity-50"
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
                          ? 'bg-bubble-out/70 border-accent/30 text-accent'
                          : 'bg-warning-soft border-warning-line text-warning'
                      }`}
                    >
                      <div>
                        <div className="font-bold flex items-center gap-1">
                          {(locCoords.accuracy ?? 999) <= 10 ? (
                            <>
                              <CheckCircle2 size={13} className="text-accent" />
                              <span>GPS Sangat Akurat (≤10m)</span>
                            </>
                          ) : (
                            <>
                              <AlertTriangle size={13} className="text-warning" />
                              <span>Akurasi Cukup (±{locCoords.accuracy}m)</span>
                            </>
                          )}
                        </div>
                        <div className="font-mono text-[11px] text-ink-2 mt-0.5">
                          {locCoords.lat.toFixed(6)}, {locCoords.lng.toFixed(6)}
                          {locCoords.accuracy ? ` (Akurasi: ±${locCoords.accuracy}m)` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={handleGetCurrentGps}
                          disabled={locGettingGps}
                          className="p-1.5 rounded-lg bg-surface border border-divider hover:bg-fill-1 text-ink-2 text-[11px] font-semibold flex items-center gap-1 shadow-xs"
                          title="Kunci Ulang GPS"
                        >
                          <RefreshCw size={11} className={locGettingGps ? 'animate-spin' : ''} />
                          <span>Ulang</span>
                        </button>
                        <a
                          href={`https://maps.google.com/?q=${locCoords.lat},${locCoords.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-lg bg-surface text-accent border border-accent/30 hover:bg-accent-soft text-xs font-semibold flex items-center gap-1 shadow-xs"
                          title="Cek di Google Maps"
                        >
                          <Navigation size={12} />
                          <span>Cek</span>
                        </a>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-ink-3 italic">
                      * Berdirilah di luar pagar/depan rumah pasien lalu tekan tombol GPS di atas (target akurasi ≤ 10m).
                    </p>
                  )}
                </div>

                {/* Bagian 2: Foto Tampak Depan Rumah */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-ink">
                      2. Foto Tampak Depan Rumah:
                    </label>
                    {locProcessingPhoto && (
                      <span className="text-[10px] text-accent font-medium animate-pulse">
                        Mengompres foto...
                      </span>
                    )}
                  </div>

                  {/* Dual Hidden Inputs: Kamera Langsung & Galeri */}
                  <input
                    type="file"
                    ref={locHouseCameraInputRef}
                    accept="image/*"
                    capture="environment"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleProcessStaffHousePhoto(f);
                    }}
                    className="hidden"
                  />
                  <input
                    type="file"
                    ref={locHouseGalleryInputRef}
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleProcessStaffHousePhoto(f);
                    }}
                    className="hidden"
                  />

                  {locHousePhotoB64 ? (
                    <div className="relative rounded-2xl overflow-hidden border border-divider bg-black/5 flex items-center justify-center max-h-48">
                      <img
                        src={locHousePhotoB64}
                        alt="Tampak Depan Rumah"
                        className="object-contain max-h-48 w-auto rounded-xl"
                      />
                      <div className="absolute top-2 right-2 flex gap-1">
                        <button
                          type="button"
                          onClick={() => locHouseCameraInputRef.current?.click()}
                          className="p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition"
                          title="Foto ulang kamera"
                        >
                          <Camera size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setLocHousePhotoB64(null)}
                          className="p-1.5 rounded-full bg-danger text-on-solid hover:bg-danger-hover transition"
                          title="Hapus foto"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => locHouseCameraInputRef.current?.click()}
                        disabled={locProcessingPhoto}
                        className="min-h-[46px] py-3 px-3 rounded-2xl bg-success-soft hover:bg-success-line border-2 border-dashed border-success-line text-accent text-xs font-bold transition flex flex-col items-center justify-center gap-1 cursor-pointer shadow-xs active:scale-[0.98]"
                      >
                        <Camera size={18} className="text-accent" />
                        <span>📸 Buka Kamera</span>
                        <span className="text-[10px] text-ink-2 font-normal">Foto depan rumah</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => locHouseGalleryInputRef.current?.click()}
                        disabled={locProcessingPhoto}
                        className="min-h-[46px] py-3 px-3 rounded-2xl bg-surface-2 hover:bg-fill-2 border-2 border-dashed border-strong text-ink text-xs font-bold transition flex flex-col items-center justify-center gap-1 cursor-pointer shadow-xs active:scale-[0.98]"
                      >
                        <ImageIcon size={18} className="text-ink-2" />
                        <span>🖼️ Pilih Galeri</span>
                        <span className="text-[10px] text-ink-3 font-normal">Dari album foto</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Bagian 3: Patokan Landmark */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-ink">
                    3. Catatan Patokan / Ancer-ancer Rumah:
                  </label>
                  <input
                    type="text"
                    value={locLandmark}
                    onChange={(e) => setLocLandmark(e.target.value)}
                    placeholder="Contoh: Pagar hitam, samping toko berkah, seberang masjid"
                    className="w-full px-3.5 py-2.5 bg-surface border border-divider rounded-xl text-[16px] sm:text-sm text-ink placeholder-ink-3 focus:outline-none focus:border-accent transition shadow-xs"
                  />
                </div>

                {/* Tombol Simpan */}
                <div className="flex justify-end space-x-2 pt-3 border-t border-divider">
                  <button
                    type="button"
                    onClick={() => (hasSavedLocData ? setLocModalMode('view') : setUpdateLocationModalTask(null))}
                    disabled={submittingLoc}
                    className="px-4 py-2.5 rounded-xl border border-divider text-xs font-semibold text-ink-2 hover:bg-fill-1 transition"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveLocation}
                    disabled={submittingLoc}
                    className="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50"
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
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL ZOOM LIGHTBOX FOTO RUMAH / BUKTI BAYAR */}
      {/* ========================================================================= */}
      {zoomImageUrl && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn"
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
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-surface border border-divider dark:border-divider rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center px-5 py-3.5 border-b border-divider bg-surface-2">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 rounded-lg bg-accent-soft text-accent">
                  <PenLine size={16} />
                </div>
                <h3 className="text-sm font-bold text-ink">Edit Pesan WhatsApp</h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingMsg(null)}
                disabled={isEditingSaving}
                className="p-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-fill-2 transition text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-3.5">
              <div className="p-3 bg-warning-soft border border-warning-line rounded-xl text-[11px] text-warning space-y-1">
                <p className="font-bold flex items-center gap-1.5">
                  <Info size={13} className="text-warning shrink-0" />
                  Batas Waktu Edit WhatsApp: 15 Menit
                </p>
                <p className="text-warning leading-relaxed">
                  WhatsApp hanya mengizinkan pengeditan pesan dalam 15 menit pertama. Pesan yang diedit akan otomatis memiliki label <i>(Diedit)</i> di HP penerima.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[11px] font-bold text-ink">Isi Pesan Baru</label>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={4}
                  placeholder="Ketik perbaikan teks pesan..."
                  className="w-full bg-surface border border-divider rounded-xl p-3 text-[16px] sm:text-sm text-ink placeholder-ink-3 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition shadow-xs leading-relaxed"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-divider">
                <button
                  type="button"
                  onClick={() => setEditingMsg(null)}
                  disabled={isEditingSaving}
                  className="px-4 py-2 bg-surface hover:bg-fill-1 border border-divider text-ink rounded-xl text-xs font-semibold transition"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={isEditingSaving || !editContent.trim()}
                  className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-xs"
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
            className="bg-surface border border-divider dark:border-divider rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden animate-scaleUp"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center px-4 py-3.5 border-b border-divider bg-surface-2">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 rounded-lg bg-violet-soft text-violet">
                  <ArrowRightLeft size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-ink">Delegasikan Jadwal</h3>
                  <p className="text-[10px] text-ink-2 truncate max-w-[200px]">
                    Pasien: {reassignModalTask.customerName || 'Bunda'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReassignModalTask(null)}
                disabled={submittingReassign}
                className="p-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-fill-2 transition text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-3.5">
              <div className="p-2.5 bg-fill-1 rounded-xl text-xs space-y-1">
                <p className="text-[11px] text-ink-2">
                  Treatment: <span className="font-semibold text-ink">{reassignModalTask.treatmentDetail || 'Spa Homecare'}</span>
                </p>
                <p className="text-[11px] text-ink-2">
                  Terapis Saat Ini: <span className="font-bold text-violet">{reassignModalTask.assignedStaff?.name || 'Belum Ditugaskan'}</span>
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-ink">Pilih Terapis Pengganti / Baru:</label>
                <select
                  value={reassignSelectedStaffId}
                  onChange={(e) => setReassignSelectedStaffId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-fill-1 border-0 text-xs font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="" disabled>-- Pilih Terapis Tim --</option>
                  {teamMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.role || 'Staff'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-divider">
                <button
                  type="button"
                  onClick={() => setReassignModalTask(null)}
                  disabled={submittingReassign}
                  className="px-4 py-2 bg-surface hover:bg-fill-1 border border-divider text-ink rounded-xl text-xs font-semibold transition"
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
                  className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-xs"
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
            className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[58px] rounded-xl transition-all active:scale-95 ${
              activeTab === 'today' ? 'text-accent bg-bubble-out dark:bg-accent/20' : 'text-ink-2 hover:text-ink dark:hover:text-ink hover:bg-fill-1'
            }`}
          >
            <Calendar size={20} />
            <span className="text-[11px] font-bold leading-none">Hari Ini</span>
            {activeTodayTasks.length > 0 && (
              <span className={`absolute top-1 right-[22%] min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${
                activeTab === 'today' ? 'bg-accent text-white' : 'bg-fill-2 dark:bg-fill-1 text-ink-2'
              }`}>
                {activeTodayTasks.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('upcoming')}
            aria-current={activeTab === 'upcoming' ? 'page' : undefined}
            className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[58px] rounded-xl transition-all active:scale-95 ${
              activeTab === 'upcoming' ? 'text-accent bg-bubble-out dark:bg-accent/20' : 'text-ink-2 hover:text-ink dark:hover:text-ink hover:bg-fill-1'
            }`}
          >
            <Clock size={20} />
            <span className="text-[11px] font-bold leading-none">Mendatang</span>
            {upcomingTasks.length > 0 && (
              <span className={`absolute top-1 right-[22%] min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${
                activeTab === 'upcoming' ? 'bg-accent text-white' : 'bg-fill-2 dark:bg-fill-1 text-ink-2'
              }`}>
                {upcomingTasks.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('completed')}
            aria-current={activeTab === 'completed' ? 'page' : undefined}
            className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[58px] rounded-xl transition-all active:scale-95 ${
              activeTab === 'completed' ? 'text-accent bg-bubble-out dark:bg-accent/20' : 'text-ink-2 hover:text-ink dark:hover:text-ink hover:bg-fill-1'
            }`}
          >
            <CheckCircle2 size={20} />
            <span className="text-[11px] font-bold leading-none">Selesai</span>
            {combinedCompletedTasks.length > 0 && (
              <span className={`absolute top-1 right-[22%] min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${
                activeTab === 'completed' ? 'bg-accent text-white' : 'bg-fill-2 dark:bg-fill-1 text-ink-2'
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
