import React, { useEffect, useRef, useState, useCallback, useMemo, startTransition } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import { useAuth } from '../../contexts/AuthContext';
import { connectLiveChatSse } from '../../services/liveChatSse';
import {
  MessageSquare,
  AlertTriangle,
  Play,
  User,
  Clock,
  Loader,
  CheckCircle,
  MessageCircle,
  Send,
  Wifi,
  WifiOff,
  Bot,
  ImagePlus,
  X,
  Zap,
  Info,
  Facebook,
  Layers,
  ShoppingBag,
  FlaskConical,
  RefreshCw,
  Trash2,
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  Tag,
  Plus,
  Check,
  CheckCheck,
  AlertCircle,
  Sparkles,
  ExternalLink,
  Calendar,
  FileText,
  Phone,
  Pin,
  Mail,
  MailCheck,
  Search,
  MoreVertical,
  PenLine,
  Smartphone,
  MapPin,
  Eye,
  Ban,
  Reply,
  CalendarPlus,
  Receipt,
  Smile,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { ToggleSwitch } from '../../components/common/ToggleSwitch';
import { MediaImage, ChatMediaData } from '../../components/common/MediaImage';
import { CustomerAvatar } from '../../components/common/CustomerAvatar';
import { CustomerEditForm } from '../../components/modals/CustomerEditForm';
import { ReservationDetailModal } from '../../components/modals/ReservationDetailModal';
import { CreateReservationModal } from '../../components/calendar/CreateReservationModal';
import { InvoiceGeneratorModal } from '../../components/modals/InvoiceGeneratorModal';
import { generateReservationInvoiceText } from '../../utils/paymentInvoiceFormatter';
import { extractScheduleFromMessages, ExtractedScheduleData, formatIndonesianDate, cleanBundaName } from '../../utils/chatScheduleExtractor';
import { formatChatDateSeparatorWib, isDifferentDayWib, formatLastChatWib, formatWibTime } from '../../utils/dateWib';
import { emitBootPhase } from '../../lib/bootProgress';

function renderHighlightedText(text: string, query: string) {
  if (!query || !query.trim() || !text) return text;
  const q = query.trim();
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    const regex = new RegExp(`(${escaped})`, 'gi');
    const parts = text.split(regex);
    if (parts.length <= 1) return text;
    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark key={i} className="bg-amber-300 text-amber-950 font-bold px-0.5 rounded shadow-2xs">
          {part}
        </mark>
      ) : (
        part
      )
    );
  } catch {
    return text;
  }
}

interface QuotedMessageData {
  id?: string;
  wa_message_id?: string | null;
  direction?: 'INBOUND' | 'OUTBOUND';
  sender_name?: string | null;
  sender_type?: string | null;
  content?: string;
  media?: ChatMediaData;
}

interface ChatMessage {
  id: string;
  wa_message_id?: string | null;
  direction: 'INBOUND' | 'OUTBOUND';
  content: string;
  sender_type?: string | null;
  sender_name?: string | null;
  delivery_status?: 'sent' | 'delivered' | 'read' | 'failed' | null;
  delivered_at?: string | null;
  read_at?: string | null;
  created_at: string;
  media?: ChatMediaData;
  quoted_message?: QuotedMessageData;
  is_revoked?: boolean;
  is_edited?: boolean;
  payload_raw?: any;
}

function extractQuotedMessage(msg: any): QuotedMessageData | undefined {
  const q = msg?.quoted_message ??
            msg?.payload_raw?.quoted_message ??
            msg?.payloadRaw?.quoted_message ??
            msg?.payload_raw?.quotedMsg ??
            msg?.payload_raw?._data?.quotedMsg;
  if (!q) return undefined;

  const content = q.content ?? q.body ?? q.text ?? (q.message?.conversation || q.message?.extendedTextMessage?.text) ?? '';
  const senderName = q.sender_name ?? q.senderName ?? q.pushName ?? (q.fromMe ? 'Bidan / CS' : undefined);
  const media = extractMedia(q);

  return {
    id: q.id ?? q.messageId ?? q.key?.id,
    wa_message_id: q.wa_message_id ?? q.id ?? q.key?.id,
    direction: q.direction ?? (q.fromMe ? 'OUTBOUND' : 'INBOUND'),
    sender_name: senderName,
    sender_type: q.sender_type ?? (q.fromMe ? 'ADMIN' : 'CUSTOMER'),
    content,
    media,
  };
}

function formatChatDateSeparator(dateStr: string): string {
  return formatChatDateSeparatorWib(dateStr);
}

function isDifferentDay(d1Str: string, d2Str?: string | null): boolean {
  return isDifferentDayWib(d1Str, d2Str);
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

interface CustomerLabelData {
  id: string;
  name: string;
  color: string;
  description?: string | null;
}

interface LiveChatItem {
  conversationId: string;
  customerId: string;
  customerName: string | null;
  customerPhone: string | null;
  kelurahan?: string | null;
  kecamatan?: string | null;
  kota?: string | null;
  distanceKm?: number | null;
  ongkir?: number | null;
  currentState: string;
  isHumanHandling: boolean;
  humanHandlingSince: string | null;
  escalationReason: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  lastMessages?: { content: string; direction?: string; created_at?: string }[];
  isMql?: boolean;
  mqlBubbleCount?: number;
  isSandboxTest?: boolean;
  trafficSource?: 'meta' | 'legacy' | null;
  purchaseCount?: number;
  ltv?: number;
  customerLabels?: CustomerLabelData[];
  customerProfilePictureUrl?: string | null;
  unreadCount?: number;
  isManualUnread?: boolean;
  isPinned?: boolean;
  pinnedAt?: string | null;
  isAwaitingReply?: boolean;
}

const DEFAULT_FAVORITE_EMOJIS = [
  '😊', '🙏', '👶', '❤️', '👍', '✅', '✨', '🌸',
  '🥰', '🙌', '🩺', '🗓️', '🍼', '💐', '💬', '🎉',
  '😄', '👌', '💆‍♀️', '💵', '⭐', '☀️', '📞', '💡',
];

const EMOJI_CATEGORIES = [
  {
    id: 'favorites',
    label: 'Favorit & Sering Digunakan',
    icon: '⭐',
    emojis: [] as string[],
  },
  {
    id: 'smileys',
    label: 'Wajah & Ekspresi',
    icon: '😊',
    emojis: [
      '😊', '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '🥹',
      '🥰', '😍', '🤩', '😘', '😗', '😚', '😋', '😛', '😜', '🤪',
      '🤗', '🤭', '🫢', '🤫', '🤔', '🫡', '🤐', '🤨', '😐', '😑',
      '😶', '😏', '😒', '🙄', '😬', '😮‍💨', '🤥', '😌', '😔', '😪',
      '😴', '😷', '🤒', '🤕', '🤢', '🤧', '🥵', '🥶', '🥴', '😵',
      '🤯', '🥳', '🥸', '😎', '🤓', '🧐', '😇', '🤠', '🥺', '😭'
    ],
  },
  {
    id: 'gestures',
    label: 'Tangan & Hati',
    icon: '👍',
    emojis: [
      '👍', '👍🏻', '👍🏼', '👍🏽', '👎', '👌', '👌🏻', '👌🏼', '✌️', '🤞',
      '🫰', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '✋',
      '🤚', '🖐️', '👋', '🤝', '🙏', '🤲', '💪', '👏', '🙌', '🫶',
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🤎', '🖤', '🤍', '💔',
      '❤️‍🔥', '❤️‍🩹', '💖', '💗', '💓', '💞', '💕', '💌', '✨', '⭐',
      '🌟', '💫', '💥', '🔥', '💯', '🎉', '🎊', '💐', '🌸', '🌹'
    ],
  },
  {
    id: 'clinic',
    label: 'Klinik & Bayi',
    icon: '👶',
    emojis: [
      '👶', '👶🏻', '👶🏼', '🧒', '👧', '👦', '👩‍🍼', '👨‍🍼', '🍼', '🤱',
      '🤰', '💆‍♀️', '💆‍♂️', '🧖‍♀️', '🧖‍♂️', '🛁', '🫧', '🧴', '🩺', '🩹',
      '💊', '💉', '🏥', '🗓️', '📅', '⏰', '⏱️', '📍', '🗺️', '🏡',
      '🏠', '🚗', '🛵', '💳', '💵', '🧾', '💰', '🎁', '🎈', '🌿',
      '🌱', '☀️', '🌤️', '🌙', '⭐', '🌈', '☂️', '☕', '🍵', '🍎'
    ],
  },
  {
    id: 'symbols',
    label: 'Simbol',
    icon: '✅',
    emojis: [
      '✅', '✔️', '☑️', '❌', '❎', '❓', '❔', '❗', '❕', '⚠️',
      '⛔', '🚫', '💡', '🔔', '🔕', '📌', '📍', '📞', '📱', '💬',
      '💭', '📝', '📋', '📎', '➡️', '⬅️', '⬆️', '⬇️', '▶️', '⏸️',
      '🔁', '🔂', '🔄', '📢', '📣', '🔍', '🔎', '🔒', '🔓', '🔑',
      '🏷️', '🏧', '🟢', '🟡', '🔴', '⚪', '⚫', '🟦', '🟧', '🟨',
      '🟩', '🟣', '🟤', '🔘', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'
    ],
  },
] as const;

export const LiveChatMonitor: React.FC = () => {
  const { toast, confirm } = useUiFeedback();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [chats, setChats] = useState<LiveChatItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      const urlParam = new URLSearchParams(window.location.search).get('conversationId') || new URLSearchParams(window.location.search).get('id');
      if (urlParam) return urlParam;
      return sessionStorage.getItem('liveChat:selectedId');
    } catch {
      return null;
    }
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const replyTextRef = useRef('');
  const [hasReplyText, setHasReplyText] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);

  const handleSelectReply = (msg: ChatMessage) => {
    if (msg.is_revoked || (msg as any).isRevoked) return;
    setReplyingTo(msg);
    setTimeout(() => {
      if (chatInputRef.current) {
        chatInputRef.current.focus();
      }
    }, 50);
  };

  const [sending, setSending] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [customerDetailModalOpen, setCustomerDetailModalOpen] = useState(false);
  const [customerDetailEditMode, setCustomerDetailEditMode] = useState(false);
  const [customerDetailLoading, setCustomerDetailLoading] = useState(false);
  const [customerDetailData, setCustomerDetailData] = useState<any>(null);
  // Reservation detail dari riwayat (klik card reservasi)
  const [selectedReservation, setSelectedReservation] = useState<any>(null);
  const [reservationStaffList, setReservationStaffList] = useState<any[]>([]);
  const [showQuickBookingModal, setShowQuickBookingModal] = useState(false);
  // Invoice Generator Modal (Draft Preview)
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [invoiceModalData, setInvoiceModalData] = useState<ExtractedScheduleData | null>(null);
  const [clinicServices, setClinicServices] = useState<any[]>([]);
  const [selectedImage, setSelectedImage] = useState<{ file: File; preview: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatInputRef = useRef<HTMLDivElement>(null);
  const [releasingId, setReleasingId] = useState<string | null>(null);
  const [editingMsg, setEditingMsg] = useState<{ id: string; content: string } | null>(null);
  const [editContent, setEditContent] = useState('');
  const [isEditingSaving, setIsEditingSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const sseConnectedRef = useRef(false);
  const [showSyncInfoModal, setShowSyncInfoModal] = useState(false);
  const [labelFilter, setLabelFilter] = useState<'all' | 'medical_concern' | 'unresolved_faq' | 'human_request'>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'real' | 'sandbox'>('real');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const searchDebounceTimerRef = useRef<any>(null);

  // In-Chat Search & Target Message Highlighting — unified dengan global searchQuery
  const [matchingMessageIds, setMatchingMessageIds] = useState<string[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState<number>(-1);
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);

  // Derived: searchQuery digunakan sebagai in-chat search jika ada percakapan aktif
  const effectiveInChatQuery = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!selectedId || !q || q.length < 2) return '';
    return q;
  }, [searchQuery, selectedId]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; chat: LiveChatItem } | null>(null);
  const longPressTimerRef = useRef<any>(null);
  const longPressTriggeredRef = useRef(false);
  const longPressTouchRef = useRef<{ x: number; y: number } | null>(null);
  const detailTouchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  // Press-and-Hold Tooltip for filter icons on mobile (tanpa getaran haptik)
  const [iconTooltip, setIconTooltip] = useState<string | null>(null);
  const iconTooltipTimerRef = useRef<any>(null);

  const handleIconTouchStart = (title: string) => {
    if (iconTooltipTimerRef.current) clearTimeout(iconTooltipTimerRef.current);
    iconTooltipTimerRef.current = setTimeout(() => {
      setIconTooltip(title);
    }, 280);
  };

  const handleIconTouchEnd = () => {
    if (iconTooltipTimerRef.current) {
      clearTimeout(iconTooltipTimerRef.current);
      iconTooltipTimerRef.current = null;
    }
    setTimeout(() => {
      setIconTooltip(null);
    }, 1500);
  };

  // 🛑 Global Bot Cut-Off (Emergency Kill-Switch)
  const [globalBotCutoff, setGlobalBotCutoff] = useState(false);
  const [togglingBotCutoff, setTogglingBotCutoff] = useState(false);

  const loadBotCutoffStatus = async () => {
    try {
      const data = await apiRequest('/api/admin/whatsapp-provider');
      if (data && typeof data.wahaOutboundCutoff === 'boolean') {
        setGlobalBotCutoff(data.wahaOutboundCutoff);
      }
    } catch (_) {}
  };

  useEffect(() => {
    loadBotCutoffStatus();
  }, []);

  const handleToggleGlobalBot = async (enableBot: boolean) => {
    const nextCutOff = !enableBot;

    const isConfirm = await confirm({
      title: nextCutOff ? 'Matikan Seluruh Bot & Pesan Keluar?' : 'Aktifkan Kembali Seluruh Bot?',
      message: nextCutOff
        ? 'PERINGATAN: Mematikan bot global akan menghentikan SEMUA pesan keluar dari sistem (Bot AI, Follow-Up otomatis, Reminder, Broadcast, & balasan Live Chat). Sesi WhatsApp di HP tetap aktif dan pesan masuk tetap tersimpan.'
        : 'Aktifkan kembali seluruh pengiriman pesan bot otomatis dan sistem WhatsApp?',
      confirmText: nextCutOff ? 'Ya, Matikan Bot Global' : 'Ya, Aktifkan Bot',
      danger: nextCutOff,
    });
    if (!isConfirm) return;

    setTogglingBotCutoff(true);
    try {
      const res = await apiRequest('/api/admin/whatsapp-provider/cutoff', {
        method: 'PATCH',
        body: JSON.stringify({ cutOff: nextCutOff }),
      });
      if (res && res.success) {
        setGlobalBotCutoff(Boolean(res.wahaOutboundCutoff));
        toast(
          nextCutOff
            ? 'Bot Global DINONAKTIFKAN (Kill-Switch AKTIF). Seluruh pesan keluar sistem dimatikan.'
            : 'Bot Global DIAKTIFKAN KEMBALI. Seluruh pesan keluar sistem normal.',
          nextCutOff ? 'info' : 'success'
        );
      }
    } catch (err: any) {
      toast(`Gagal mengubah status Bot Global: ${err?.message || err}`, 'error');
    } finally {
      setTogglingBotCutoff(false);
    }
  };

  // ✍️ WhatsApp Typing Presence & Seen Notification — debounce untuk hindari spam saat ketik
  const typingTimerRef = useRef<any>(null);
  const typingStartTimerRef = useRef<any>(null);
  const isTypingActiveRef = useRef(false);

  const notifyTyping = (isTyping: boolean) => {
    if (!selectedIdRef.current) return;
    if (isTypingActiveRef.current === isTyping && isTyping) return;
    isTypingActiveRef.current = isTyping;

    apiRequest(`/api/admin/live-chat/conversations/${selectedIdRef.current}/typing`, {
      method: 'POST',
      body: JSON.stringify({ isTyping }),
    }).catch(() => {});
  };

  const handleInputChange = (text: string) => {
    replyTextRef.current = text;
    const isNotEmpty = text.trim().length > 0;
    if (hasReplyText !== isNotEmpty) {
      setHasReplyText(isNotEmpty);
    }
    if (!selectedIdRef.current) return;

    if (isNotEmpty) {
      // Debounce 500ms sebelum kirim startTyping — hindari goyang akibat SSE balik tiap karakter
      if (typingStartTimerRef.current) clearTimeout(typingStartTimerRef.current);
      typingStartTimerRef.current = setTimeout(() => {
        notifyTyping(true);
      }, 500);

      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => {
        notifyTyping(false);
      }, 3000);
    } else {
      if (typingStartTimerRef.current) clearTimeout(typingStartTimerRef.current);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      notifyTyping(false);
    }
  };

  const listTouchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const isChatHistoryPushedRef = useRef(false);

  const handleBackToList = () => {
    if (isChatHistoryPushedRef.current || (typeof window !== 'undefined' && window.history.state?.view === 'live-chat-detail')) {
      isChatHistoryPushedRef.current = false;
      if (window.history.state?.view === 'live-chat-detail') {
        window.history.back();
      } else {
        setMobileView('list');
        try { sessionStorage.setItem('liveChat:mobileView', 'list'); } catch {}
      }
    } else {
      setMobileView('list');
      try { sessionStorage.setItem('liveChat:mobileView', 'list'); } catch {}
    }
  };

  const handleListTouchStart = (e: React.TouchEvent) => {
    if (mobileView !== 'list' || e.touches.length !== 1) return;
    const target = e.target as HTMLElement | null;
    if (target && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.tagName === 'BUTTON' ||
      target.closest('button') ||
      target.closest('input') ||
      target.closest('textarea')
    )) {
      listTouchStartRef.current = null;
      return;
    }
    const touch = e.touches[0];
    // Zona tepi kiri (<= 45px dari tepi kiri layar)
    if (touch && touch.clientX <= 45) {
      listTouchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now(),
      };
    }
  };

  const handleListTouchMove = (e: React.TouchEvent) => {
    if (!listTouchStartRef.current || e.touches.length === 0) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - listTouchStartRef.current.x;
    const deltaY = touch.clientY - listTouchStartRef.current.y;
    // Mencegah OS Android/iOS mencegat gestur tepi kiri menjadi history back preview
    if (deltaX > 10 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
      if (e.cancelable) e.preventDefault();
    }
  };

  const handleDetailTouchStart = (e: React.TouchEvent) => {
    if (mobileView !== 'chat' || e.touches.length !== 1) return;
    const target = e.target as HTMLElement | null;
    if (target && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.tagName === 'BUTTON' ||
      target.closest('button') ||
      target.closest('input') ||
      target.closest('textarea')
    )) {
      detailTouchStartRef.current = null;
      return;
    }
    const touch = e.touches[0];
    // Zona tepi kiri (<= 45px dari tepi kiri layar)
    if (touch && touch.clientX <= 45) {
      detailTouchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now(),
      };
    }
  };

  const handleDetailTouchMove = (e: React.TouchEvent) => {
    if (!detailTouchStartRef.current || e.touches.length === 0) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - detailTouchStartRef.current.x;
    const deltaY = touch.clientY - detailTouchStartRef.current.y;
    // Cegah browser native history swipe back yang menyebabkan reload halaman
    if (deltaX > 10 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
      if (e.cancelable) e.preventDefault();
    }
  };

  const handleDetailTouchEnd = (e: React.TouchEvent) => {
    if (!detailTouchStartRef.current || e.changedTouches.length === 0) return;
    const start = detailTouchStartRef.current;
    detailTouchStartRef.current = null;

    const end = e.changedTouches[0];
    if (!end) return;
    const deltaX = end.clientX - start.x;
    const deltaY = end.clientY - start.y;

    // Usapan tegas dari tepi kiri ke kanan (deltaX > 40px) -> Kembali ke list seketika tanpa reload!
    if (deltaX > 40 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
      handleBackToList();
    }
  };
  const [syncingHistory, setSyncingHistory] = useState(false);
  const [syncNextOffset, setSyncNextOffset] = useState<number | null>(null);
  const [syncProgress, setSyncProgress] = useState<string | null>(null);
  const [bgSyncProgress, setBgSyncProgress] = useState<{
    isSyncing: boolean;
    status: 'idle' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
    syncedChats: number;
    skippedChats: number;
    syncedMessages: number;
    totalChats: number;
    currentChatName?: string;
    currentOffset: number;
    error?: string;
  }>({
    isSyncing: false,
    status: 'idle',
    syncedChats: 0,
    skippedChats: 0,
    syncedMessages: 0,
    totalChats: 0,
    currentOffset: 0,
  });
  const [gatewayCapability, setGatewayCapability] = useState<{ provider: string; supportsRevoke: boolean; supportsEdit?: boolean } | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const chatsRef = useRef<LiveChatItem[]>([]);
  const selectedIdRef = useRef<string | null>(null);
  const chatListContainerRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchInputFocusedRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const firstRenderRef = useRef(true);

  const [allLabels, setAllLabels] = useState<CustomerLabelData[]>([]);
  const [labelPopoverOpen, setLabelPopoverOpen] = useState(false);
  const [togglingLabelId, setTogglingLabelId] = useState<string | null>(null);
  const labelPopoverRef = useRef<HTMLDivElement>(null);

  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const toolsMenuRef = useRef<HTMLDivElement>(null);

  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const [favoriteEmojis, setFavoriteEmojis] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('liveChat:favoriteEmojis');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (_) {}
    return DEFAULT_FAVORITE_EMOJIS;
  });
  const [emojiCategory, setEmojiCategory] = useState<'favorites' | 'smileys' | 'gestures' | 'clinic' | 'symbols'>('favorites');

  // Periksa status background sync saat pertama kali buka halaman
  const checkBackgroundSyncStatus = async () => {
    try {
      const res = await apiRequest('/api/admin/live-chat/sync-status');
      if (res?.success && res.data) {
        setBgSyncProgress(res.data);
      }
    } catch (_) {}
  };

  useEffect(() => {
    checkBackgroundSyncStatus();
  }, []);

  // Polling halus setiap 2.5 detik selama background sync berjalan
  useEffect(() => {
    if (!bgSyncProgress.isSyncing) return;
    const interval = setInterval(async () => {
      try {
        const res = await apiRequest('/api/admin/live-chat/sync-status');
        if (res?.success && res.data) {
          setBgSyncProgress(res.data);
          if (!res.data.isSyncing) {
            loadChats(true);
            if (res.data.status === 'completed') {
              toast(`🎉 Sinkronisasi seluruh riwayat WhatsApp selesai: ${res.data.syncedChats} chat (${res.data.syncedMessages} pesan baru)!`, 'success');
            } else if (res.data.status === 'failed') {
              toast(`Sinkronisasi latar belakang terhenti: ${res.data.error || 'Terjadi kesalahan'}`, 'error');
            }
          }
        }
      } catch (_) {}
    }, 2500);
    return () => clearInterval(interval);
  }, [bgSyncProgress.isSyncing]);

  const handleStartBackgroundFullSync = async () => {
    try {
      const res = await apiRequest('/api/admin/live-chat/sync-full', {
        method: 'POST',
        body: JSON.stringify({ messagesPerChat: 100 }),
      });
      if (res?.success) {
        toast('🚀 Sinkronisasi seluruh riwayat WhatsApp dimulai di latar belakang...', 'success');
        if (res.progress) {
          setBgSyncProgress(res.progress);
        } else {
          setBgSyncProgress((prev) => ({ ...prev, isSyncing: true, status: 'in_progress' }));
        }
      }
    } catch (err: any) {
      toast(`Gagal memulai sinkronisasi: ${err.message}`, 'error');
    }
  };

  const handleCancelBackgroundSync = async () => {
    try {
      await apiRequest('/api/admin/live-chat/sync-cancel', { method: 'POST' });
      toast('Sinkronisasi latar belakang dihentikan.', 'info');
      setBgSyncProgress((prev) => ({ ...prev, isSyncing: false, status: 'cancelled' }));
    } catch (err: any) {
      toast(`Gagal membatalkan: ${err.message}`, 'error');
    }
  };

  // Close label popover, tools menu, and emoji picker on outside click
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      if (labelPopoverRef.current && !labelPopoverRef.current.contains(e.target as Node)) {
        setLabelPopoverOpen(false);
      }
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target as Node)) {
        setToolsMenuOpen(false);
      }
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setEmojiPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleDocumentClick);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
    };
  }, []);

  const insertEmoji = (emoji: string) => {
    if (!chatInputRef.current) return;
    chatInputRef.current.focus();

    // Auto-update list emoji favorit / sering digunakan
    setFavoriteEmojis((prev) => {
      const next = [emoji, ...prev.filter((e) => e !== emoji)].slice(0, 32);
      try {
        localStorage.setItem('liveChat:favoriteEmojis', JSON.stringify(next));
      } catch (_) {}
      return next;
    });

    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (chatInputRef.current.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        const textNode = document.createTextNode(emoji);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        chatInputRef.current.innerText += emoji;
        const newRange = document.createRange();
        newRange.selectNodeContents(chatInputRef.current);
        newRange.collapse(false);
        sel.removeAllRanges();
        sel.addRange(newRange);
      }
    } else {
      chatInputRef.current.innerText += emoji;
      if (sel) {
        const newRange = document.createRange();
        newRange.selectNodeContents(chatInputRef.current);
        newRange.collapse(false);
        sel.removeAllRanges();
        sel.addRange(newRange);
      }
    }

    const updatedText = chatInputRef.current.innerText || '';
    handleInputChange(updatedText);
  };

  const resetChatInput = () => {
    replyTextRef.current = '';
    setHasReplyText(false);
    setReplyingTo(null);
    setEmojiPickerOpen(false);
    if (chatInputRef.current) {
      chatInputRef.current.innerText = '';
    }
  };

  useEffect(() => {
    selectedIdRef.current = selectedId;
    resetChatInput();
    try {
      if (selectedId) sessionStorage.setItem('liveChat:selectedId', selectedId);
      else sessionStorage.removeItem('liveChat:selectedId');
    } catch {}
    if (selectedId) {
      loadThread(selectedId);
      // Jika conversation belum ada di chats list (misal dibuka langsung dari URL / Push notif), ambil detailnya
      if (!chatsRef.current.some((c) => c.conversationId === selectedId)) {
        apiRequest(`/api/admin/live-chat/conversations/${selectedId}`)
          .then((res) => {
            if (res?.success && res.data) {
              setChats((prev) => {
                if (prev.some((c) => c.conversationId === selectedId)) return prev;
                const updated = [res.data, ...prev];
                chatsRef.current = updated;
                return updated;
              });
            }
          })
          .catch(() => {});
      }
    }
  }, [selectedId]);

  // Load gateway capability & available customer labels on mount
  useEffect(() => {
    emitBootPhase('done');
    apiRequest('/api/admin/gateway-capability')
      .then((res) => {
        if (res?.success && res.data) setGatewayCapability(res.data);
      })
      .catch(() => {});

    apiRequest('/api/admin/labels')
      .then((res) => {
        if (res?.success && Array.isArray(res.data)) {
          setAllLabels(res.data);
        } else if (Array.isArray(res)) {
          setAllLabels(res);
        }
      })
      .catch(() => {});
  }, []);

  const handleToggleLabel = async (customerId: string, label: CustomerLabelData) => {
    if (togglingLabelId) return;
    setTogglingLabelId(label.id);
    try {
      const targetChat = chatsRef.current.find((c) => c.customerId === customerId);
      const currentLabels = targetChat?.customerLabels || [];
      const isAssigned = currentLabels.some((l) => l.id === label.id);
      const action = isAssigned ? 'unassign' : 'assign';

      // Optimistic update for chats list
      const nextLabels = isAssigned
        ? currentLabels.filter((l) => l.id !== label.id)
        : [...currentLabels, label];

      setChats((prev) => {
        const updated = prev.map((c) =>
          c.customerId === customerId ? { ...c, customerLabels: nextLabels } : c
        );
        chatsRef.current = updated;
        return updated;
      });

      // Optimistic update for customer detail modal if open
      setCustomerDetailData((prev: any) => {
        if (!prev) return prev;
        if (prev.id !== customerId && prev.phone !== targetChat?.customerPhone) return prev;
        return {
          ...prev,
          labels: nextLabels.map((l) => ({ label: l })),
        };
      });

      await apiRequest(`/api/admin/customers/${customerId}/labels`, {
        method: 'POST',
        body: JSON.stringify({ labelId: label.id, action }),
      });
    } catch (err: any) {
      toast(err.message || 'Gagal memperbarui label customer.', 'error');
      loadChats(true);
    } finally {
      setTogglingLabelId(null);
    }
  };

  // Ganti filter label → reset daftar ke halaman pertama.
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    loadChats(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelFilter]);

  // Ganti filter sumber (WhatsApp asli / sandbox) → reset daftar ke halaman pertama.
  useEffect(() => {
    if (firstRenderRef.current) return;
    loadChats(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFilter]);

  const triggerDebouncedSearch = (q: string) => {
    if (searchDebounceTimerRef.current) {
      clearTimeout(searchDebounceTimerRef.current);
    }
    searchDebounceTimerRef.current = setTimeout(() => {
      loadChats(true, q, true);
    }, 350);
  };

  const loadChats = async (reset = false, search = searchQuery, isSearchOperation = false) => {
    // Hanya aktifkan full-page loader saat boot awal (chats belum pernah dimuat sama sekali)
    if (reset && chatsRef.current.length === 0) {
      setLoading(true);
    }
    if (isSearchOperation) {
      setIsSearching(true);
    }
    if (loadingMoreRef.current && !reset) return;
    loadingMoreRef.current = true;
    if (!reset) {
      setLoadingMore(true);
    }
    try {
      const offset = reset ? 0 : chatsRef.current.length;
      const searchParam = search && search.trim() ? `&search=${encodeURIComponent(search.trim())}` : '';
      const res = await apiRequest(`/api/admin/live-chat/conversations?limit=50&offset=${offset}&mode=${sourceFilter}${searchParam}`);
      const data = Array.isArray(res) ? res : (res?.data || []);
      const nextHasMore = typeof res?.hasMore === 'boolean' ? res.hasMore : data.length === 50;
      if (reset) {
        startTransition(() => setChats(data));
        chatsRef.current = data;
      } else {
        const merged = [...chatsRef.current];
        const seen = new Set(merged.map((c) => c.conversationId));
        for (const item of data) {
          if (!seen.has(item.conversationId)) {
            merged.push(item);
            seen.add(item.conversationId);
          }
        }
        startTransition(() => setChats(merged));
        chatsRef.current = merged;
      }
      setHasMore(nextHasMore);
      setErrorMessage(null);
    } catch (err: any) {
      console.error('Failed to load live chat conversations:', err);
      setErrorMessage(err.message || 'Gagal memuat percakapan.');
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
      setIsSearching(false);
      setLoading(false);
    }
  };

  const handleSyncHistory = async (offset = 0) => {
    setSyncingHistory(true);
    try {
      const res = await apiRequest('/api/admin/live-chat/sync-history', {
        method: 'POST',
        body: JSON.stringify({ limit: 50, offset }),
        timeoutMs: 120000,
      });
      const data = res?.data || res;
      if (!data || data.success === false) {
        throw new Error(data?.error || 'Sync history gagal.');
      }
      setSyncNextOffset(data.hasMore ? data.nextOffset : null);
      setSyncProgress(
        `Sync selesai: ${data.syncedChats} chat diproses (${data.syncedMessages} pesan baru) dari total ${data.totalChats}${data.hasMore ? ' — klik Load More untuk lanjut' : ''}`
      );
      loadChats(true);
      toast(`Sync history: ${data.syncedMessages} pesan dari ${data.syncedChats} chat ditambahkan.`, 'success');
    } catch (err: any) {
      toast(`Sync history gagal: ${err.message}`, 'error');
    } finally {
      setSyncingHistory(false);
    }
  };

  const loadThread = async (conversationId: string) => {
    try {
      const res = await apiRequest(`/api/admin/live-chat/conversations/${conversationId}/messages`);
      const list: ChatMessage[] = Array.isArray(res) ? res : (res?.data || []);
      
      // Client-side deduplication filter (mencegah double render bubble pesan/gambar identik)
      const isImageOrPricelist = (c?: string, m?: any) => 
        !c || /^\[(IMAGE|GAMBAR|Image|MEDIA)/i.test((c || '').trim()) || (c || '').startsWith('Pricelist') || !!m;

      const deduped: ChatMessage[] = [];
      for (const m of list) {
        const hasDuplicate = deduped.some((existing) => {
          if (existing.id === m.id) return true;
          if (
            existing.direction === m.direction &&
            Math.abs(new Date(existing.created_at).getTime() - new Date(m.created_at).getTime()) < 20000
          ) {
            if (existing.content && m.content && existing.content === m.content) return true;
            if (isImageOrPricelist(existing.content, existing.media) && isImageOrPricelist(m.content, m.media)) {
              return true;
            }
          }
          return false;
        });
        if (!hasDuplicate) {
          deduped.push(m);
        }
      }

      setMessages(deduped.map((m) => ({ ...m, media: extractMedia(m), quoted_message: extractQuotedMessage(m) })));
    } catch (err: any) {
      console.error('Failed to load conversation thread:', err);
      setMessages([]);
    }
  };

  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' ? window.innerWidth >= 1024 : true);

  useEffect(() => {
    try {
      const urlConvId = searchParams.get('conversationId') || searchParams.get('id');
      const savedView = sessionStorage.getItem('liveChat:mobileView');
      const savedId = sessionStorage.getItem('liveChat:selectedId');
      const effectiveId = urlConvId || savedId;
      if (effectiveId) {
        setSelectedId(effectiveId);
        if (urlConvId || savedView === 'chat' || window.innerWidth < 1024) {
          setMobileView('chat');
        } else if (savedView) {
          setMobileView(savedView as any);
        }
      } else if (savedView) {
        setMobileView(savedView as any);
      }
    } catch {}
  }, [searchParams]);

  useEffect(() => {
    try { sessionStorage.setItem('liveChat:mobileView', mobileView); } catch {}
  }, [mobileView]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(min-width: 1024px)');
    setIsDesktop(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // Focus restoration: jika search input fokus sebelum re-render (loadChats/SSE), restore fokusnya
  useEffect(() => {
    if (searchInputFocusedRef.current && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  });

  const scrollToBottom = useCallback((smooth = false, forceMulti = true) => {
    // Goyang fix: hanya scroll jika user dekat bawah (tidak ganggu saat baca history), dan kurangi multi-timeout.
    const isNearBottom = (() => {
      const el = chatContainerRef.current;
      if (!el) return true;
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      return distanceFromBottom < 300; // threshold 300px
    })();
    if (!isNearBottom && !forceMulti) return;
    const doScroll = () => {
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight + 99999;
      }
      // scrollIntoView hanya jika nearBottom untuk hindari fight dengan scrollTop
      if (isNearBottom && messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' });
      }
    };
    doScroll();
    requestAnimationFrame(doScroll);
    if (forceMulti) {
      // kurangi dari 4 → 1 rAF tambahan untuk hemat jank
      setTimeout(doScroll, 120);
    }
  }, []);

  const scrollToMessage = useCallback((msgId: string, smooth = true) => {
    setHighlightedMsgId(msgId);
    const doScroll = () => {
      const el = document.getElementById(`msg-${msgId}`);
      if (el) {
        el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
      }
    };
    doScroll();
    requestAnimationFrame(doScroll);
    setTimeout(doScroll, 40);
    setTimeout(doScroll, 120);
    setTimeout(doScroll, 300);

    // Hilangkan flash highlight setelah 3.5 detik
    setTimeout(() => {
      setHighlightedMsgId((prev) => (prev === msgId ? null : prev));
    }, 3500);
  }, []);

  // 📱 Visual Viewport API: throttle 200ms + cek nearBottom untuk hindari goyang saat ketik
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    let throttleTimer: any = null;
    let lastVpHeight = window.visualViewport?.height || 0;
    const handleViewportChange = () => {
      if (mobileView !== 'chat') return;
      // hanya scroll jika tinggi viewport berubah signifikan (>80px = keyboard open/close), bukan tiap karakter
      const newH = window.visualViewport?.height || 0;
      if (Math.abs(newH - lastVpHeight) < 80) return;
      lastVpHeight = newH;
      if (throttleTimer) return;
      throttleTimer = setTimeout(() => {
        throttleTimer = null;
        scrollToBottom(true, false); // false = hanya jika nearBottom
      }, 200);
    };
    const vp = window.visualViewport;
    vp.addEventListener('resize', handleViewportChange);
    // scroll event tidak perlu, hanya resize untuk keyboard
    return () => {
      vp.removeEventListener('resize', handleViewportChange);
      if (throttleTimer) clearTimeout(throttleTimer);
    };
  }, [mobileView, scrollToBottom]);

  // ⬅️ Listener untuk Edge Swipe-Back Navigation dari Layout (Kembali dari Chat ke List di Mobile)
  useEffect(() => {
    const handleAppSwipeBack = (e: Event) => {
      if (mobileView === 'chat') {
        e.preventDefault();
        handleBackToList();
      }
    };
    window.addEventListener('app-swipe-back', handleAppSwipeBack);
    return () => window.removeEventListener('app-swipe-back', handleAppSwipeBack);
  }, [mobileView]);

  // 📱 Listener untuk Default Android Back button & popstate history navigation
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      // Prioritas 1: Tutup menu konteks / modal / popup yang sedang aktif terlebih dahulu
      if (contextMenu) {
        setContextMenu(null);
        return;
      }
      if (labelPopoverOpen) {
        setLabelPopoverOpen(false);
        return;
      }
      if (toolsMenuOpen) {
        setToolsMenuOpen(false);
        return;
      }
      if (emojiPickerOpen) {
        setEmojiPickerOpen(false);
        return;
      }
      if (customerDetailModalOpen) {
        setCustomerDetailModalOpen(false);
        return;
      }
      if (customerDetailEditMode) {
        setCustomerDetailEditMode(false);
        return;
      }
      if (showQuickBookingModal) {
        setShowQuickBookingModal(false);
        return;
      }
      if (showInvoiceModal) {
        setShowInvoiceModal(false);
        return;
      }
      if (showSyncInfoModal) {
        setShowSyncInfoModal(false);
        return;
      }
      if (selectedReservation) {
        setSelectedReservation(null);
        return;
      }

      // Jika state yang baru di-pop masih berada di live-chat-detail (misal setelah drawer sidebar tertutup)
      if (e.state?.view === 'live-chat-detail' || (typeof window !== 'undefined' && window.history.state?.view === 'live-chat-detail')) {
        return;
      }

      // Prioritas 2: Jika di tampilan chat mobile, kembali ke list
      if (mobileView === 'chat') {
        isChatHistoryPushedRef.current = false;
        setMobileView('list');
        try { sessionStorage.setItem('liveChat:mobileView', 'list'); } catch {}
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [
    mobileView,
    contextMenu,
    labelPopoverOpen,
    toolsMenuOpen,
    emojiPickerOpen,
    customerDetailModalOpen,
    customerDetailEditMode,
    showQuickBookingModal,
    showInvoiceModal,
    showSyncInfoModal,
    selectedReservation,
  ]);

  // Saat pindah percakapan, reset in-chat search agar banner tidak persisten.
  useEffect(() => {
    setMatchingMessageIds([]);
    setCurrentMatchIndex(-1);
    setHighlightedMsgId(null);
  }, [selectedId]);

  // Hitung daftar matching message IDs dalam thread percakapan aktif — minimal 2 karakter agar tidak spam untuk nomor pendek
  useEffect(() => {
    const q = effectiveInChatQuery;
    if (!q || messages.length === 0) {
      setMatchingMessageIds([]);
      setCurrentMatchIndex(-1);
      return;
    }
    const matches = messages
      .filter((m) => m.content && m.content.toLowerCase().includes(q))
      .map((m) => m.id);

    setMatchingMessageIds(matches);
    if (matches.length > 0) {
      setCurrentMatchIndex((prev) => (prev >= 0 && prev < matches.length ? prev : matches.length - 1));
    } else {
      setCurrentMatchIndex(-1);
    }
  }, [effectiveInChatQuery, messages]);

  const handlePrevMatch = () => {
    if (matchingMessageIds.length === 0) return;
    const newIdx = currentMatchIndex > 0 ? currentMatchIndex - 1 : matchingMessageIds.length - 1;
    setCurrentMatchIndex(newIdx);
    const targetId = matchingMessageIds[newIdx];
    if (targetId) scrollToMessage(targetId, true);
  };

  const handleNextMatch = () => {
    if (matchingMessageIds.length === 0) return;
    const newIdx = currentMatchIndex < matchingMessageIds.length - 1 ? currentMatchIndex + 1 : 0;
    setCurrentMatchIndex(newIdx);
    const targetId = matchingMessageIds[newIdx];
    if (targetId) scrollToMessage(targetId, true);
  };

  const handleClearInChatSearch = () => {
    setSearchQuery('');
    setMatchingMessageIds([]);
    setCurrentMatchIndex(-1);
    setHighlightedMsgId(null);
    scrollToBottom(true);
  };

  useEffect(() => {
    // Smart auto-scroll: jika ada keyword pencarian dalam-bubble dan pesan cocok, scroll langsung ke target
    if (messages.length > 0) {
      const q = effectiveInChatQuery;
      if (q) {
        const matches = messages
          .filter((m) => m.content && m.content.toLowerCase().includes(q))
          .map((m) => m.id);

        if (matches.length > 0) {
          const targetId = matches[matches.length - 1];
          scrollToMessage(targetId, false);
          return;
        }
      }
      scrollToBottom(false, true);
    }
  }, [messages, selectedId, effectiveInChatQuery, scrollToBottom, scrollToMessage]);

  const sortChats = (list: LiveChatItem[]): LiveChatItem[] => {
    return [...list].sort((a, b) => {
      if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
      return new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime();
    });
  };

  // Close context menu on outside click or window scroll
  useEffect(() => {
    const handleClose = () => setContextMenu(null);
    window.addEventListener('click', handleClose);
    window.addEventListener('scroll', handleClose, true);
    return () => {
      window.removeEventListener('click', handleClose);
      window.removeEventListener('scroll', handleClose, true);
    };
  }, []);

  const handleTogglePin = async (chat: LiveChatItem) => {
    setContextMenu(null);
    const newPinned = !chat.isPinned;
    try {
      await apiRequest(`/api/admin/conversations/${chat.conversationId}/pin`, {
        method: 'PATCH',
        body: JSON.stringify({ isPinned: newPinned }),
      });
      setChats((prev) => {
        const updated = prev.map((c) =>
          c.conversationId === chat.conversationId ? { ...c, isPinned: newPinned } : c
        );
        const sorted = sortChats(updated);
        chatsRef.current = sorted;
        return sorted;
      });
      toast(newPinned ? 'Percakapan disematkan di atas.' : 'Sematan percakapan dilepas.', 'success');
    } catch (err: any) {
      toast(`Gagal mengubah status sematan: ${err.message}`, 'error');
    }
  };

  const handleToggleReadStatus = async (chat: LiveChatItem) => {
    setContextMenu(null);
    const isCurrentlyUnread = (chat.unreadCount || 0) > 0 || chat.isManualUnread;
    const targetEndpoint = isCurrentlyUnread ? 'read' : 'unread';
    try {
      await apiRequest(`/api/admin/conversations/${chat.conversationId}/${targetEndpoint}`, {
        method: 'PATCH',
      });
      setChats((prev) => {
        const updated = prev.map((c) => {
          if (c.conversationId !== chat.conversationId) return c;
          if (targetEndpoint === 'read') {
            return { ...c, unreadCount: 0, isManualUnread: false, isAwaitingReply: false };
          } else {
            return { ...c, unreadCount: 1, isManualUnread: true, isAwaitingReply: false };
          }
        });
        chatsRef.current = updated;
        return updated;
      });
      toast(
        targetEndpoint === 'unread' ? 'Ditandai belum dibaca (Hijau Tua).' : 'Ditandai sudah dibaca.',
        'success'
      );
    } catch (err: any) {
      toast(`Gagal mengubah status dibaca: ${err.message}`, 'error');
    }
  };

  const handleMarkAllAsRead = async () => {
    const confirmed = await confirm({
      title: 'Tandai Semua Telah Dibaca',
      message: 'Tandai semua pesan dari seluruh pelanggan sebagai telah dibaca?',
      confirmText: 'Tandai Semua Dibaca',
      cancelText: 'Batal',
    });
    if (!confirmed) return;
    try {
      await apiRequest('/api/admin/live-chat/mark-all-read', { method: 'POST' });
      setChats((prev) =>
        prev.map((c) => ({
          ...c,
          unreadCount: 0,
          isManualUnread: false,
        }))
      );
      toast('Semua percakapan berhasil ditandai telah dibaca!', 'success');
    } catch (err: any) {
      toast(`Gagal menandai semua dibaca: ${err.message}`, 'error');
    }
  };

  const handleSelect = (conversationId: string) => {
    setSelectedId(conversationId);
    setMobileView('chat');
    try {
      sessionStorage.setItem('liveChat:selectedId', conversationId);
      sessionStorage.setItem('liveChat:mobileView', 'chat');
      if (typeof window !== 'undefined' && window.innerWidth < 1024) {
        window.history.pushState({ view: 'live-chat-detail', conversationId }, '');
        isChatHistoryPushedRef.current = true;
      }
    } catch {}

    // Auto mark-as-read jika masih ada unread atau isManualUnread
    const targetChat = chatsRef.current.find((c) => c.conversationId === conversationId);
    if (targetChat && ((targetChat.unreadCount || 0) > 0 || targetChat.isManualUnread)) {
      apiRequest(`/api/admin/conversations/${conversationId}/read`, { method: 'PATCH' }).catch(() => {});
      setChats((prev) => {
        const updated = prev.map((c) =>
          c.conversationId === conversationId
            ? { ...c, unreadCount: 0, isManualUnread: false, isAwaitingReply: true }
            : c
        );
        chatsRef.current = updated;
        return updated;
      });
    }
  };

  // Global capture listener untuk memblokir total popup native 'Copy / Salin' Android Chrome saat hold-press
  useEffect(() => {
    const handleContextMenuCapture = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-no-select]')) {
        e.preventDefault();
      }
    };

    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const anchorNode = selection.anchorNode;
        const elem = anchorNode instanceof HTMLElement ? anchorNode : anchorNode?.parentElement;
        if (elem?.closest('[data-no-select]')) {
          selection.removeAllRanges();
        }
      }
    };

    window.addEventListener('contextmenu', handleContextMenuCapture, { capture: true, passive: false });
    document.addEventListener('selectionchange', handleSelectionChange);

    return () => {
      window.removeEventListener('contextmenu', handleContextMenuCapture, { capture: true });
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, []);

  // SSE real-time: message.created & conversation.updated
  useEffect(() => {
    loadChats(true);

    const unsubscribe = connectLiveChatSse({
      onStatusChange: (connected) => {
        setSseConnected(connected);
        sseConnectedRef.current = connected;
      },
      onEvent: (type, payload) => {
        if (type === 'conversation.updated' && payload?.allRead) {
          startTransition(() => setChats((prev) =>
            prev.map((c) => ({
              ...c,
              unreadCount: 0,
              isManualUnread: false,
            }))
          ));
          return;
        }

        if (type === 'message.created') {
          const conversationId = payload.conversationId;
          const msgTime = payload.createdAt || payload.created_at || new Date().toISOString();
          const msg: ChatMessage = {
            id: payload.messageId || `sse_${Date.now()}`,
            direction: payload.direction,
            content: payload.content || '',
            sender_type: payload.senderType || payload.sender_type || null,
            sender_name: payload.senderName || payload.sender_name || null,
            created_at: msgTime,
            delivery_status: payload.deliveryStatus || 'sent',
            media: extractMedia(payload),
            quoted_message: extractQuotedMessage(payload),
          };

          // Append ke thread yang sedang dibuka / replace optimistic message
          if (selectedIdRef.current === conversationId) {
            setMessages((prev) => {
              const isImageOrPricelist = (c?: string, m?: any) =>
                !c || /^\[(IMAGE|GAMBAR|Image|MEDIA)/i.test((c || '').trim()) || (c || '').startsWith('Pricelist') || !!m;
              
              // Cek apakah ada optimistic message (temp_) yang cocok
              const tempIndex = prev.findIndex(
                (m) =>
                  m.id.startsWith('temp_') &&
                  m.direction === msg.direction &&
                  (m.content === msg.content ||
                    (isImageOrPricelist(m.content, m.media) && isImageOrPricelist(msg.content, msg.media)))
              );
              if (tempIndex !== -1) {
                const next = [...prev];
                next[tempIndex] = {
                  ...msg,
                  id: msg.id || next[tempIndex].id,
                  media: msg.media || next[tempIndex].media,
                };
                return next;
              }

              const isDuplicate = prev.some(
                (m) =>
                  m.id === msg.id ||
                  (m.direction === msg.direction &&
                    (m.content === msg.content ||
                      (isImageOrPricelist(m.content, m.media) && isImageOrPricelist(msg.content, msg.media))) &&
                    Math.abs(new Date(m.created_at).getTime() - new Date(msg.created_at).getTime()) < 20000)
              );
              if (isDuplicate) return prev;
              return [...prev, msg];
            });
            setTimeout(() => scrollToBottom(true), 50);
          }

          // Update preview daftar
          const current = chatsRef.current;
          const existing = current.find((c) => c.conversationId === conversationId);
          if (existing) {
            const isMsgInbound = msg.direction === 'INBOUND';
            const isCurrentOpen = selectedIdRef.current === conversationId;
            const nextUnread = isCurrentOpen ? 0 : (existing.unreadCount || 0) + (isMsgInbound ? 1 : 0);

            const updated = current.map((c) =>
              c.conversationId !== conversationId
                ? c
                : {
                    ...c,
                    lastMessageAt: msgTime,
                    lastMessages: [...(c.lastMessages || []), msg].slice(-3),
                    unreadCount: nextUnread,
                    isAwaitingReply: isCurrentOpen && isMsgInbound,
                    isManualUnread: false,
                  }
            );
            const sorted = sortChats(updated);
            startTransition(() => setChats(sorted));
            chatsRef.current = sorted;
          } else {
            // Percakapan baru muncul → reload daftar dari awal
            loadChats(true);
          }
        } else if (type === 'conversation.updated') {
          const current = chatsRef.current;
          if (!current.some((c) => c.conversationId === payload.conversationId)) {
            loadChats(true);
            return;
          }
          const updated = current.map((c) =>
            c.conversationId === payload.conversationId
              ? {
                  ...c,
                  currentState: payload.currentState ?? c.currentState,
                  isHumanHandling: payload.isHumanHandling !== undefined ? !!payload.isHumanHandling : c.isHumanHandling,
                  humanHandlingSince: payload.humanHandlingSince ?? c.humanHandlingSince,
                  escalationReason: payload.escalationReason ?? c.escalationReason,
                  isPinned: payload.isPinned !== undefined ? !!payload.isPinned : c.isPinned,
                  pinnedAt: payload.pinnedAt ?? c.pinnedAt,
                  unreadCount: payload.unreadCount !== undefined ? payload.unreadCount : c.unreadCount,
                  isManualUnread: payload.isManualUnread !== undefined ? payload.isManualUnread : c.isManualUnread,
                }
              : c
          );
          const sorted = sortChats(updated);
          startTransition(() => setChats(sorted));
          chatsRef.current = sorted;
        } else if (type === 'message.updated' && payload?.messageId) {
          const { messageId, content, isRevoked } = payload;
          if (selectedIdRef.current === payload.conversationId) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === messageId ? { ...m, content, is_revoked: isRevoked } : m
              )
            );
          }
        } else if ((type === 'message:reaction' || type === 'message.reaction') && (payload?.messageId || payload?.waMessageId)) {
          const { messageId, waMessageId, conversationId, reactions } = payload;
          if (!conversationId || selectedIdRef.current === conversationId) {
            setMessages((prev) =>
              prev.map((m) => {
                if (
                  (messageId && m.id === messageId) ||
                  (waMessageId && (m.wa_message_id === waMessageId || m.id === waMessageId))
                ) {
                  return {
                    ...m,
                    reactions,
                    payload_raw: {
                      ...(typeof m.payload_raw === 'object' && m.payload_raw ? m.payload_raw : {}),
                      reactions,
                    },
                  };
                }
                return m;
              })
            );
          }
        } else if (type === 'message.status_updated' && (payload?.messageId || payload?.waMessageId)) {
          const { messageId, waMessageId, conversationId, status, deliveredAt, readAt } = payload;
          if (!conversationId || selectedIdRef.current === conversationId) {
            setMessages((prev) =>
              prev.map((m) => {
                if (
                  (messageId && m.id === messageId) ||
                  (waMessageId && (m.wa_message_id === waMessageId || m.id === waMessageId))
                ) {
                  return {
                    ...m,
                    delivery_status: status,
                    delivered_at: deliveredAt || m.delivered_at,
                    read_at: readAt || m.read_at,
                  };
                }
                return m;
              })
            );
          }
        } else if (type === ('sync.progress' as any) || payload?.status) {
          const syncData = payload.payload || payload;
          if (syncData && typeof syncData.syncedChats === 'number') {
            setBgSyncProgress((prev) => ({ ...prev, ...syncData }));
            if (syncData.status === 'completed') {
              loadChats(true);
            }
          }
        }
      },
    });

    // 🔄 Smart Event-Driven / Fallback Background Sync
    // Saat SSE aktif, polling konstan 3.5s dimatikan untuk menghemat 95% resource & mencegah UI jitter.
    // Jika SSE terputus, gunakan fallback interval 15s.
    const pollInterval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        if (!sseConnectedRef.current) {
          loadChats(true);
        }
      }
    }, 15000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadChats(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      unsubscribe();
      clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRevokeMessage = async (msg: ChatMessage) => {
    if (!selectedChat?.conversationId || revokingId) return;

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
        `/api/admin/conversations/${selectedChat.conversationId}/messages/${msg.id}`,
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
    if (!editingMsg || !selectedChat?.conversationId || isEditingSaving) return;
    if (!editContent.trim()) {
      toast('Teks pesan tidak boleh kosong.', 'error');
      return;
    }

    setIsEditingSaving(true);
    try {
      const res = await apiRequest(
        `/api/admin/conversations/${selectedChat.conversationId}/messages/${editingMsg.id}/edit`,
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

  const [activeReactionMsgId, setActiveReactionMsgId] = useState<string | null>(null);
  const [customEmojiMsgId, setCustomEmojiMsgId] = useState<string | null>(null);

  const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
  const EXTRA_REACTIONS = ['🔥', '👏', '🎉', '💯', '✨', '🤝', '🌸', '💐', '👶', '🍼', '🤱', '💪'];

  const handleToggleReaction = async (msg: ChatMessage, emoji: string) => {
    if (!selectedChat?.conversationId || !msg) return;
    setActiveReactionMsgId(null);
    setCustomEmojiMsgId(null);

    const targetMsgId = msg.id || msg.wa_message_id;
    const currentReactions: Array<{ emoji: string; fromMe: boolean; senderName?: string; actorId?: string }> =
      (msg as any).reactions || (msg as any).payload_raw?.reactions || [];
    const myReaction = currentReactions.find((r) => r.fromMe);
    const newEmoji = myReaction && myReaction.emoji === emoji ? '' : emoji;

    // Optimistic UI update
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id === msg.id || (msg.wa_message_id && m.wa_message_id === msg.wa_message_id)) {
          let updatedReactions = (
            (m as any).reactions || (m as any).payload_raw?.reactions || []
          ).filter((r: any) => !r.fromMe);

          if (newEmoji) {
            updatedReactions.push({
              emoji: newEmoji,
              fromMe: true,
              senderName: (user as any)?.name || 'Admin',
              createdAt: new Date().toISOString(),
            });
          }
          return {
            ...m,
            reactions: updatedReactions,
            payload_raw: {
              ...(typeof (m as any).payload_raw === 'object' && (m as any).payload_raw ? (m as any).payload_raw : {}),
              reactions: updatedReactions,
            },
          };
        }
        return m;
      })
    );

    try {
      const res = await apiRequest(
        `/api/admin/live-chat/conversations/${selectedChat.conversationId}/messages/${targetMsgId}/reaction`,
        {
          method: 'POST',
          body: JSON.stringify({ emoji: newEmoji }),
        }
      );

      if (res?.success) {
        if (res.reactions) {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id === msg.id || (msg.wa_message_id && m.wa_message_id === msg.wa_message_id)) {
                return {
                  ...m,
                  reactions: res.reactions,
                  payload_raw: {
                    ...(typeof (m as any).payload_raw === 'object' && (m as any).payload_raw ? (m as any).payload_raw : {}),
                    reactions: res.reactions,
                  },
                };
              }
              return m;
            })
          );
        }
      } else {
        toast(`Gagal mengirim reaksi: ${res?.error || 'Terjadi kesalahan'}`, 'error');
      }
    } catch (err: any) {
      toast(`Gagal mengirim reaksi: ${err.message || 'Terjadi kesalahan'}`, 'error');
    }
  };

  const handleRelease = async (chat: LiveChatItem) => {
    const isMedical = chat.escalationReason === 'medical_concern';

    const isConfirmed = await confirm({
      title: 'Kembalikan ke Bot?',
      message: isMedical
        ? 'Percakapan ini ditandai sebagai eskalasi medis. Bot AI tidak memiliki auto-release waktu untuk kasus medis demi keselamatan. Apakah Anda benar-benar yakin ingin mengembalikan chat ini ke respon otomatis AI Bot?'
        : 'Apakah Anda yakin ingin mengembalikan percakapan ini ke bot otomatis? Bot akan mulai merespon chat berikutnya secara mandiri.',
      confirmText: 'Ya, Kembalikan',
      danger: isMedical,
    });
    if (!isConfirmed) return;

    setReleasingId(chat.conversationId);
    try {
      await apiRequest(`/api/admin/conversation/${chat.conversationId}/release`, {
        method: 'PATCH',
        body: JSON.stringify({}),
      });

      // Optimistic in-place update: chat tetap terbuka dan badge langsung beralih ke Bot secara mulus
      setChats((prev) =>
        prev.map((c) =>
          c.conversationId === chat.conversationId
            ? { ...c, isHumanHandling: false, escalationReason: null, status: 'active', lastHandledBy: 'bot' }
            : c
        )
      );
      chatsRef.current = chatsRef.current.map((c) =>
        c.conversationId === chat.conversationId
          ? { ...c, isHumanHandling: false, escalationReason: null, status: 'active', lastHandledBy: 'bot' }
          : c
      );

      // Sinkronisasi data latar belakang tanpa reload/unmount
      loadChats(false);
      toast('Percakapan berhasil dikembalikan ke bot.', 'success');
    } catch (err: any) {
      toast(`Gagal merilis percakapan ke bot: ${err.message}`, 'error');
    } finally {
      setReleasingId(null);
    }
  };

  const handleTakeover = async (chat: LiveChatItem) => {
    const isConfirmed = await confirm({
      title: 'Ambil Alih Percakapan (CS)?',
      message: `Apakah Anda yakin ingin mengambil alih percakapan dengan ${chat.customerName || chat.customerPhone || 'pelanggan'}? Bot AI akan berhenti merespon secara otomatis agar Anda dapat melayani secara manual.`,
      confirmText: 'Ya, Ambil Alih',
    });
    if (!isConfirmed) return;

    setReleasingId(chat.conversationId);
    try {
      await apiRequest(`/api/admin/conversation/${chat.conversationId}/takeover`, {
        method: 'PATCH',
        body: JSON.stringify({}),
      });

      // Optimistic in-place update
      setChats((prev) =>
        prev.map((c) =>
          c.conversationId === chat.conversationId
            ? { ...c, isHumanHandling: true, escalationReason: 'manual_takeover', lastHandledBy: 'human' }
            : c
        )
      );
      chatsRef.current = chatsRef.current.map((c) =>
        c.conversationId === chat.conversationId
          ? { ...c, isHumanHandling: true, escalationReason: 'manual_takeover', lastHandledBy: 'human' }
          : c
      );

      loadChats(false);
      toast('Percakapan berhasil diambil alih oleh admin (CS).', 'success');
    } catch (err: any) {
      toast(`Gagal mengambil alih percakapan: ${err.message || err}`, 'error');
    } finally {
      setReleasingId(null);
    }
  };

  const handleGenerateAiDraft = async () => {
    if (!selectedId) return;
    setGeneratingDraft(true);
    try {
      const res = await apiRequest(`/api/admin/live-chat/conversations/${selectedId}/suggest-reply`, {
        method: 'POST',
      });
      if (res?.data?.draftText) {
        replyTextRef.current = res.data.draftText;
        setHasReplyText(true);
        if (chatInputRef.current) {
          chatInputRef.current.innerText = res.data.draftText;
        }
        toast('Draf jawaban AI berhasil dibuat! Anda dapat mengedit sebelum mengirim.', 'success');
      } else {
        toast('Gagal mendapatkan saran balasan AI.', 'error');
      }
    } catch (err: any) {
      toast(`Gagal memuat saran AI: ${err.message}`, 'error');
    } finally {
      setGeneratingDraft(false);
    }
  };

  const handleOpenCustomerDetail = async (chat: LiveChatItem) => {
    setCustomerDetailModalOpen(true);
    setCustomerDetailLoading(true);
    // Instant preliminary data so modal never opens empty
    const initialLabels = (chat.customerLabels || []).map((l) => ({ label: l }));
    setCustomerDetailData({
      id: chat.customerId,
      name: chat.customerName,
      phone: chat.customerPhone,
      profile_picture_url: chat.customerProfilePictureUrl,
      labels: initialLabels,
      purchaseCount: chat.purchaseCount || 0,
      ltv: chat.ltv || 0,
    });
    try {
      const res = await apiRequest(`/api/admin/customers/${chat.customerId}`);
      if (res?.data) {
        const fetchedLabels = (res.data.labels && res.data.labels.length > 0)
          ? res.data.labels
          : initialLabels;
        setCustomerDetailData({
          ...res.data,
          labels: fetchedLabels,
        });
      }
    } catch (err: any) {
      // Preliminary data already active
    } finally {
      setCustomerDetailLoading(false);
    }
  };

  const handleSaveCustomerDetail = async (data: any) => {
    const customerId = customerDetailData?.id || selectedChat?.customerId;
    if (!customerId) throw new Error('Customer ID tidak ditemukan');
    await apiRequest(`/api/admin/customers/${customerId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    // Refresh customer detail data after save
    const res = await apiRequest(`/api/admin/customers/${customerId}`);
    if (res?.data) {
      setCustomerDetailData({ ...res.data, labels: customerDetailData?.labels || [] });
    }
    setCustomerDetailEditMode(false);
  };

  const handleOpenReservationDetail = async (reservationId: string) => {
    try {
      const res = await apiRequest(`/api/admin/reservation/${reservationId}`);
      const data = res?.data || res;
      if (data) {
        setSelectedReservation(data);
        // load staff list jika belum
        if (reservationStaffList.length === 0) {
          try {
            const staffRes = await apiRequest('/api/admin/staff');
            if (staffRes?.success && Array.isArray(staffRes.data)) setReservationStaffList(staffRes.data);
            else if (Array.isArray(staffRes)) setReservationStaffList(staffRes);
          } catch {}
        }
      }
    } catch (err: any) {
      toast(`Gagal memuat detail reservasi: ${err.message}`, 'error');
    }
  };

  const handleReservationUpdate = async () => {
    // refresh customer detail setelah update reservasi
    const cid = customerDetailData?.id || selectedChat?.customerId;
    if (cid) {
      try {
        const res = await apiRequest(`/api/admin/customers/${cid}`);
        if (res?.data) setCustomerDetailData((prev: any) => ({ ...prev, ...res.data, reservations: res.data.reservations || prev?.reservations }));
      } catch {}
    }
    if (selectedReservation?.id) {
      try {
        const res = await apiRequest(`/api/admin/reservation/${selectedReservation.id}`);
        const data = res?.data || res;
        if (data) setSelectedReservation(data);
      } catch {}
    }
  };

  const handleOpenQuickReservation = async () => {
    if (!selectedChat) {
      toast('Pilih percakapan customer terlebih dahulu.', 'info');
      return;
    }
    if (reservationStaffList.length === 0) {
      try {
        const staffRes = await apiRequest('/api/admin/staff');
        if (staffRes?.success && Array.isArray(staffRes.data)) setReservationStaffList(staffRes.data);
        else if (Array.isArray(staffRes)) setReservationStaffList(staffRes);
      } catch {}
    }
    // Pastikan customer detail terbaru termuat
    if (selectedChat.customerId && (!customerDetailData || customerDetailData.id !== selectedChat.customerId)) {
      try {
        const res = await apiRequest(`/api/admin/customers/${selectedChat.customerId}`);
        if (res?.data) setCustomerDetailData(res.data);
      } catch {}
    }
    setShowQuickBookingModal(true);
  };

  const handleInsertInvoiceToChat = (text: string) => {
    if (chatInputRef.current) {
      chatInputRef.current.innerText = text;
      replyTextRef.current = text;
      setHasReplyText(true);
      chatInputRef.current.focus();
    }
  };

  const handleGenerateAndInsertInvoice = async (resItem: any) => {
    let currentServices = clinicServices;
    if (currentServices.length === 0) {
      try {
        const sRes = await apiRequest('/api/admin/services');
        if (sRes?.data && Array.isArray(sRes.data)) {
          currentServices = sRes.data;
          setClinicServices(sRes.data);
        } else if (Array.isArray(sRes)) {
          currentServices = sRes;
          setClinicServices(sRes);
        }
      } catch {}
    }

    const custData = customerDetailData || (selectedChat ? {
      id: selectedChat.customerId,
      name: selectedChat.customerName,
      phone: selectedChat.customerPhone,
      address: (selectedChat as any).address || '',
      kelurahan: (selectedChat as any).kelurahan || null,
      kecamatan: (selectedChat as any).kecamatan || null,
      kota: (selectedChat as any).kota || null,
      children: (selectedChat as any).children || [],
      ongkir: (selectedChat as any).ongkir ?? 0,
      distance_km: (selectedChat as any).distanceKm ?? (selectedChat as any).distance_km ?? null,
    } : null);

    const bookingD = resItem?.booking_date ? new Date(resItem.booking_date) : new Date();
    let timeStr = '12.00-12.30';
    try {
      if (resItem?.booking_date && !isNaN(bookingD.getTime())) {
        timeStr = bookingD.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace(':', '.');
      }
    } catch {}

    const mappedData: ExtractedScheduleData = {
      bookingDate: !isNaN(bookingD.getTime()) ? bookingD : new Date(),
      dateDisplay: formatIndonesianDate(bookingD),
      timeDisplay: timeStr,
      treatmentName: resItem?.treatment_detail || resItem?.treatment_name || 'Pijat Ceria',
      treatmentPrice: Number(resItem?.purchase_value || resItem?.treatment_price) || 60000,
      treatmentCategory: (resItem?.treatment_category === 'MOMS' || resItem?.treatment_detail?.toLowerCase()?.includes('mom')) ? 'MOMS' : 'BABY',
      childName: resItem?.child_name || custData?.children?.[0]?.name || '',
      childAge: resItem?.child_age || custData?.children?.[0]?.raw_age_text || custData?.children?.[0]?.current_age || '',
      bundaName: cleanBundaName(custData?.name || selectedChat?.customerName || '', custData?.kecamatan, custData?.kota),
      phone: custData?.phone || selectedChat?.customerPhone || '',
      address: custData?.address || custData?.preferences?.address || custData?.kelurahan || '',
      kecamatan: custData?.kecamatan || '',
      kota: custData?.kota || '',
      distanceKm: Number(custData?.distance_km ?? custData?.distanceKm ?? 3.0),
      ongkir: Number(custData?.ongkir ?? 0),
      discount: 0,
      isExtractedFromChat: false,
      confidenceScore: 1.0,
    };

    setInvoiceModalData(mappedData);
    setShowInvoiceModal(true);
  };

  const handleGenerateActiveReservationInvoice = async () => {
    if (!selectedChat) {
      toast('Pilih percakapan customer terlebih dahulu.', 'info');
      return;
    }

    let currentServices = clinicServices;
    if (currentServices.length === 0) {
      try {
        const sRes = await apiRequest('/api/admin/services');
        if (sRes?.data && Array.isArray(sRes.data)) {
          currentServices = sRes.data;
          setClinicServices(sRes.data);
        } else if (Array.isArray(sRes)) {
          currentServices = sRes;
          setClinicServices(sRes);
        }
      } catch {}
    }

    let custData = customerDetailData;
    if (!custData && selectedChat?.customerId) {
      try {
        const res = await apiRequest(`/api/admin/customers/${selectedChat.customerId}`);
        if (res?.data) {
          custData = res.data;
          setCustomerDetailData(res.data);
        }
      } catch {}
    }

    if (!custData && selectedChat) {
      custData = {
        id: selectedChat.customerId,
        name: selectedChat.customerName,
        phone: selectedChat.customerPhone,
        address: (selectedChat as any).address || '',
        kelurahan: (selectedChat as any).kelurahan || null,
        kecamatan: (selectedChat as any).kecamatan || null,
        kota: (selectedChat as any).kota || null,
        children: (selectedChat as any).children || [],
        ongkir: (selectedChat as any).ongkir ?? 0,
        distance_km: (selectedChat as any).distanceKm ?? (selectedChat as any).distance_km ?? null,
      };
    }

    // Ekstraksi pintar jadwal & rincian dari obrolan chat
    const extracted = extractScheduleFromMessages(messages, custData, currentServices);
    setInvoiceModalData(extracted);
    setShowInvoiceModal(true);
  };

  const handleSendReply = async () => {
    const image = selectedImage;
    const text = (chatInputRef.current?.innerText || replyTextRef.current || '').trim();
    if (!selectedId || (!text && !image)) return;

    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    notifyTyping(false);

    const currentReplyingTo = replyingTo;
    const tempId = `temp_${Date.now()}`;
    const optimisticMsg: ChatMessage = {
      id: tempId,
      direction: 'OUTBOUND',
      content: text || (image ? '[IMAGE]' : ''),
      sender_type: 'ADMIN',
      sender_name: user?.email || 'Admin',
      created_at: new Date().toISOString(),
      delivery_status: 'sent',
      media: image ? { url: image.preview, hdUrl: image.preview, mimeType: image.file.type } : undefined,
      quoted_message: currentReplyingTo ? {
        id: currentReplyingTo.id,
        wa_message_id: currentReplyingTo.wa_message_id,
        direction: currentReplyingTo.direction,
        sender_name: currentReplyingTo.sender_name || (currentReplyingTo.direction === 'INBOUND' ? (selectedChat?.customerName || 'Customer') : 'Admin'),
        sender_type: currentReplyingTo.sender_type,
        content: currentReplyingTo.content,
        media: currentReplyingTo.media,
      } : undefined,
    };

    // 1. Instan tampil di thread pesan (0ms delay)
    setMessages((prev) => [...prev, optimisticMsg]);

    // 2. Instan update preview teks di daftar chat list
    setChats((prev) => {
      const updated = prev.map((c) =>
        c.conversationId === selectedId
          ? {
              ...c,
              lastMessageAt: optimisticMsg.created_at,
              lastMessages: [...(c.lastMessages || []), optimisticMsg].slice(-3),
              isAwaitingReply: false,
            }
          : c
      );
      const sorted = sortChats(updated);
      chatsRef.current = sorted;
      return sorted;
    });

    // 3. Instan kosongkan form input, pratinjau gambar, dan reply state
    resetChatInput();
    setSelectedImage(null);
    setReplyingTo(null);
    setTimeout(() => scrollToBottom(true), 50);

    setSending(true);
    try {
      const body: Record<string, any> = {
        adminName: user?.email || 'Admin',
      };
      if (text) body.text = text;
      if (currentReplyingTo) {
        body.replyToMessageId = currentReplyingTo.wa_message_id || currentReplyingTo.id;
      }
      if (image) {
        const imageB64 = await fileToDataUrl(image.file);
        const thumbB64 = await makeThumbnail(imageB64);
        body.imageB64 = imageB64;
        body.thumbB64 = thumbB64;
        body.mimeType = image.file.type || 'image/jpeg';
        body.fileName = image.file.name;
      }

      const res = await apiRequest(`/api/admin/live-chat/conversations/${selectedId}/reply`, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      const actualMsg = res?.data?.message || res?.data;
      const actualId = actualMsg?.id || actualMsg?.messageId;
      if (actualId) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId
              ? {
                  ...m,
                  id: actualId,
                  wa_message_id: actualMsg.messageId || actualMsg.wa_message_id || m.wa_message_id,
                  delivery_status: 'sent',
                }
              : m
          )
        );
      }
    } catch (err: any) {
      toast(`Gagal mengirim balasan: ${err.message}`, 'error');
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, delivery_status: 'failed' } : m))
      );
    } finally {
      setSending(false);
    }
  };

  const handlePickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('Hanya file gambar yang didukung.', 'error');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast('Gambar maksimal 8 MB.', 'error');
      return;
    }
    const preview = URL.createObjectURL(file);
    setSelectedImage({ file, preview });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

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
      img.onerror = () => reject(new Error('Gagal membuat thumbnail.'));
      img.src = dataUrl;
    });

  const selectedChat = chats.find((c) => c.conversationId === selectedId);

  const getChatLabel = (chat: LiveChatItem): 'medical_concern' | 'unresolved_faq' | 'human_request' | 'all' => {
    if (chat.escalationReason === 'medical_concern') return 'medical_concern';
    if (chat.escalationReason === 'unresolved_faq') return 'unresolved_faq';
    if (chat.isHumanHandling) return 'human_request';
    return 'all';
  };

  const filteredChats = useMemo(() => chats.filter((chat) => {
    // 1. Filter label
    if (labelFilter !== 'all' && getChatLabel(chat) !== labelFilter) {
      return false;
    }

    // 2. Filter search query (Nama, Nomor HP, atau Keyword Pesan)
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const cleanDigits = q.replace(/\D/g, '');
      const nameMatch = (chat.customerName || '').toLowerCase().includes(q);
      const phoneMatch = cleanDigits.length >= 2
        ? (chat.customerPhone || '').includes(cleanDigits)
        : (chat.customerPhone || '').toLowerCase().includes(q);
      const messageMatch = (chat.lastMessages || []).some((m) =>
        (m.content || '').toLowerCase().includes(q)
      );

      if (!nameMatch && !phoneMatch && !messageMatch) {
        return false;
      }
    }

    return true;
  }), [chats, labelFilter, searchQuery]);

  const getElapsedTime = (sinceStr: string | null) => {
    if (!sinceStr) return '';
    return formatLastChat(sinceStr);
  };

  const formatLastChat = (dateStr: string | null) => {
    return formatLastChatWib(dateStr);
  };

  const senderLabel = (m: ChatMessage) => {
    if (m.direction === 'INBOUND') return 'Customer';
    const type = (m.sender_type || '').toUpperCase();
    return type === 'ADMIN' || type === 'HUMAN' || type === 'STAFF' ? m.sender_name || 'Admin' : 'Bot';
  };

  const formatRp = (val: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);

  const formatRpShort = (val: number) => {
    if (!val || val === 0) return 'Rp 0';
    if (val >= 1_000_000) return `Rp ${(val / 1_000_000).toFixed(1).replace('.0', '')}jt`;
    if (val >= 1_000) return `Rp ${Math.round(val / 1000)}rb`;
    return `Rp ${val}`;
  };

  return (
    <div data-no-swipe-menu="true" className="h-full flex flex-col min-h-0 space-y-1 sm:space-y-1.5">
      {/* Top Header (Desktop / Large screen only - on mobile it scrolls with the list) */}
      <div className="hidden lg:flex justify-between items-center bg-white border border-[#e9edef] rounded-xl px-2.5 sm:px-3 py-1 sm:py-1.5 shadow-xs shrink-0">
        <div className="flex items-center space-x-2">
          <h1 className="text-sm sm:text-base font-bold text-[#111b21] tracking-tight flex items-center space-x-1.5">
            <MessageSquare className="text-[#008069]" size={18} />
            <span>Live Chat Monitor</span>
          </h1>
          {/* Total Conversations Badge directly next to Title */}
          <span className="px-2 py-0.5 rounded-full bg-[#e8f5f2] text-[#008069] text-xs font-bold font-mono border border-[#c2e7e0]" title="Total percakapan aktif">
            {filteredChats.length}
          </span>
          {/* Real-time Status Icon Indicator */}
          <div
            className="flex items-center space-x-1 px-2 py-0.5 bg-[#f0f2f5] border border-[#e9edef] rounded-full text-[10px] font-semibold text-[#54656f]"
            title={sseConnected ? 'Status: Real-time Terhubung (SSE Aktif)' : 'Status: Menyambungkan kembali ke server...'}
          >
            <span className={`h-2 w-2 rounded-full ${sseConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500 animate-pulse'}`} />
            <span>{sseConnected ? 'Live' : 'Reconnecting'}</span>
          </div>
        </div>

        {/* Controls: Global Bot Switch + Sync */}
        <div className="flex items-center space-x-2">
          <ToggleSwitch
            checked={!globalBotCutoff}
            onChange={(enableBot) => handleToggleGlobalBot(enableBot)}
            disabled={togglingBotCutoff}
            loading={togglingBotCutoff}
            variant={globalBotCutoff ? 'rose' : 'emerald'}
            onLabel="BOT ON"
            offLabel="BOT OFF"
            size="sm"
            title={
              globalBotCutoff
                ? 'Status: Bot & Semua Pesan Keluar Sistem Nonaktif (Cut-Off Aktif). Klik untuk mengaktifkan kembali.'
                : 'Status: Bot & Pesan Sistem Aktif (Normal). Klik untuk mematikan semua bot & pesan keluar.'
            }
          />
          <button
            onClick={() => setShowSyncInfoModal(true)}
            disabled={bgSyncProgress.isSyncing}
            className="p-1.5 rounded-lg bg-[#008069] hover:bg-[#00a884] text-white shadow-2xs transition flex items-center justify-center disabled:opacity-50 cursor-pointer"
            title="Sinkronisasi Seluruh Chat WhatsApp (Background)"
          >
            <RefreshCw size={14} className={bgSyncProgress.isSyncing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Global Bot Cut-Off Active Warning Banner */}
      {globalBotCutoff && (
        <div className="p-2 sm:p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs font-semibold flex items-center justify-between shadow-2xs shrink-0 animate-fadeIn">
          <div className="flex items-center space-x-2 min-w-0">
            <ShieldAlert size={16} className="text-rose-600 shrink-0" />
            <div className="truncate">
              <span className="font-bold text-rose-700">BOT GLOBAL NONAKTIF (CUT-OFF AKTIF):</span>{' '}
              <span className="text-rose-800">Seluruh pesan bot otomatis, follow-up, reminder, dan pesan keluar sistem dimatikan.</span>
            </div>
          </div>
          <button
            onClick={() => handleToggleGlobalBot(true)}
            disabled={togglingBotCutoff}
            className="px-2.5 py-1 text-[11px] font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition shrink-0 ml-2 cursor-pointer shadow-2xs"
          >
            Aktifkan Bot
          </button>
        </div>
      )}

      {/* Real-time Background Sync Banner */}
      {bgSyncProgress.isSyncing && (
        <div className="p-2 sm:p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] font-medium flex items-center justify-between shadow-2xs shrink-0 animate-fadeIn">
          <div className="flex items-center space-x-2 min-w-0">
            <RefreshCw size={14} className="text-[#008069] animate-spin shrink-0" />
            <div className="truncate">
              <span className="font-bold text-[#008069]">Sinkronisasi Background Berjalan:</span>{' '}
              <span>
                {bgSyncProgress.syncedChats} / {bgSyncProgress.totalChats || '?'} chat ({bgSyncProgress.syncedMessages} pesan baru)
                {bgSyncProgress.currentChatName ? ` • Sedang memproses: ${bgSyncProgress.currentChatName}` : ''}
              </span>
            </div>
          </div>
          <button
            onClick={handleCancelBackgroundSync}
            className="px-2.5 py-0.5 text-[10px] font-bold text-rose-700 bg-rose-100 hover:bg-rose-200 border border-rose-200 rounded-md transition shrink-0 ml-2 cursor-pointer shadow-2xs"
          >
            Batalkan
          </button>
        </div>
      )}

      {syncProgress && !bgSyncProgress.isSyncing && (
        <div className="p-2 rounded-xl bg-sky-50 border border-sky-200 text-sky-800 text-[11px] font-medium flex items-center space-x-2 shrink-0">
          <RefreshCw size={12} className="text-sky-600 animate-spin" />
          <span>{syncProgress}</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-medium flex items-center space-x-2 shrink-0">
          <AlertTriangle size={13} className="text-rose-600" />
          <span>{errorMessage}</span>
        </div>
      )}

      {loading && chats.length === 0 ? (
        <div className="flex-1 flex justify-center items-center py-20">
          <Loader className="animate-spin text-[#008069]" size={32} />
        </div>
      ) : (
        <div data-no-swipe-menu="true" className="flex-1 min-h-0 flex flex-col lg:flex-row gap-2.5 overflow-hidden">
          {/* Section 1: Conversations List */}
          <div
            onTouchStart={handleListTouchStart}
            onTouchMove={handleListTouchMove}
            onTouchEnd={() => { listTouchStartRef.current = null; }}
            onTouchCancel={() => { listTouchStartRef.current = null; }}
            className={`${mobileView === 'chat' ? 'hidden lg:flex' : 'flex animate-mobile-list-enter lg:animate-none'} w-full lg:w-[320px] xl:w-[360px] lg:shrink-0 flex-col h-full bg-white border border-[#e9edef] rounded-xl sm:rounded-2xl shadow-xs overflow-hidden min-h-0`}
          >
            {/* Scrollable Container covering entire panel: Header & filter bar scroll off, Searchbar sticks at top-0 */}
            <div
              ref={chatListContainerRef}
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-1.5 sm:px-2.5 pt-1.5 pb-2"
              style={{ overscrollBehavior: 'contain' }}
            >
              {/* Mobile Page Header (Inside scroll flow so it scrolls off on scroll down) */}
              <div className="flex lg:hidden justify-between items-center pb-2 border-b border-[#f0f2f5] mb-1.5">
                <div className="flex items-center space-x-2">
                  <h1 className="text-sm font-bold text-[#111b21] tracking-tight flex items-center space-x-1.5">
                    <MessageSquare className="text-[#008069]" size={16} />
                    <span>Live Chat</span>
                  </h1>
                  <span className="px-2 py-0.5 rounded-full bg-[#e8f5f2] text-[#008069] text-xs font-bold font-mono border border-[#c2e7e0]">
                    {filteredChats.length}
                  </span>
                  <div className="flex items-center space-x-1 px-1.5 py-0.5 bg-[#f0f2f5] border border-[#e9edef] rounded-full text-[10px] font-semibold text-[#54656f]">
                    <span className={`h-1.5 w-1.5 rounded-full ${sseConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500 animate-pulse'}`} />
                    <span>{sseConnected ? 'Live' : 'Offline'}</span>
                  </div>
                </div>

                <div className="flex items-center space-x-1.5">
                  <ToggleSwitch
                    checked={!globalBotCutoff}
                    onChange={(enableBot) => handleToggleGlobalBot(enableBot)}
                    disabled={togglingBotCutoff}
                    loading={togglingBotCutoff}
                    variant={globalBotCutoff ? 'rose' : 'emerald'}
                    onLabel="ON"
                    offLabel="OFF"
                    size="sm"
                    title="Toggle Bot Global"
                  />
                  <button
                    onClick={() => setShowSyncInfoModal(true)}
                    disabled={bgSyncProgress.isSyncing}
                    className="p-1.5 rounded-lg bg-[#008069] text-white shadow-2xs transition flex items-center justify-center disabled:opacity-50 cursor-pointer"
                    title="Sinkronisasi Seluruh Chat WhatsApp"
                  >
                    <RefreshCw size={13} className={bgSyncProgress.isSyncing ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>

              {/* Header Toolbar: Source Filter + Label Dropdown (Normal in-flow, scrolls away on scroll down) */}
              <div className="pb-1.5 border-b border-[#f0f2f5]">
                <div className="flex items-center justify-between gap-1.5">
                  {/* Filter sumber percakapan: WhatsApp Asli, Semua, Sandbox (Ikon Saja + Press Hold Tooltip) */}
                  <div className="relative flex items-center space-x-0.5 p-0.5 bg-[#f0f2f5] border border-[#e9edef] rounded-lg shrink-0">
                    {[
                      { value: 'real', title: 'WhatsApp Asli (Live)', icon: Smartphone },
                      { value: 'all', title: 'Semua Percakapan', icon: Layers },
                      { value: 'sandbox', title: 'Sandbox QA Test', icon: FlaskConical },
                    ].map((opt) => {
                      const Icon = opt.icon;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => setSourceFilter(opt.value as any)}
                          onTouchStart={() => handleIconTouchStart(opt.title)}
                          onTouchEnd={handleIconTouchEnd}
                          onTouchCancel={handleIconTouchEnd}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setIconTooltip(opt.title);
                            setTimeout(() => setIconTooltip(null), 2000);
                          }}
                          title={opt.title}
                          className={`p-1.5 rounded-md transition flex items-center justify-center cursor-pointer relative ${
                            sourceFilter === opt.value
                              ? opt.value === 'sandbox'
                                ? 'bg-purple-100 text-purple-800 border border-purple-200 shadow-2xs'
                                : opt.value === 'real'
                                  ? 'bg-[#e8f5f2] text-[#008069] border border-[#c2e7e0] shadow-2xs'
                                  : 'bg-[#111b21] text-white shadow-2xs'
                              : 'text-[#667781] hover:text-[#111b21]'
                          }`}
                        >
                          <Icon size={13} />
                        </button>
                      );
                    })}

                    {/* Press-Hold Floating Tooltip */}
                    {iconTooltip && (
                      <div className="absolute top-full left-0 mt-1 z-50 px-2 py-1 bg-[#111b21] text-white text-[10px] font-bold rounded-lg shadow-lg animate-fadeIn whitespace-nowrap pointer-events-none flex items-center space-x-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#25D366]" />
                        <span>{iconTooltip}</span>
                      </div>
                    )}
                  </div>

                  {/* Label Filter Dropdown & Mark All Read (Disampingnya) */}
                  <div className="flex items-center space-x-1 flex-1 min-w-0">
                    {(isDesktop || mobileView === 'list') && (
                      <select
                        value={labelFilter}
                        onChange={(e) => setLabelFilter(e.target.value as typeof labelFilter)}
                        className="w-full px-2 py-1 bg-white border border-[#d1d7db] rounded-lg text-[11px] font-semibold text-[#111b21] focus:outline-none focus:border-[#008069] cursor-pointer shadow-2xs truncate"
                      >
                        <option value="all">Semua Label</option>
                        <option value="human_request">Human Request</option>
                        <option value="medical_concern">Medical Emergency</option>
                        <option value="unresolved_faq">Unresolved FAQ</option>
                      </select>
                    )}

                    <button
                      type="button"
                      onClick={handleMarkAllAsRead}
                      tabIndex={mobileView === 'chat' ? -1 : 0}
                      title="Tandai semua percakapan sebagai telah dibaca"
                      className="p-1 bg-white hover:bg-[#e8f5f2] border border-[#d1d7db] hover:border-[#c2e7e0] text-[#54656f] hover:text-[#008069] rounded-lg transition flex items-center justify-center shrink-0 cursor-pointer shadow-2xs active:scale-95"
                    >
                      <MailCheck size={14} className="text-[#008069]" />
                    </button>
                  </div>
                </div>
              </div>

              {/* 🔍 Search Bar Input: STICKY AT TOP ONLY (Hanya Searchbar yang Stick Saat Scroll di Mobile) */}
              {(isDesktop || mobileView === 'list') && (
                <div className="sticky top-0 z-20 bg-white py-1.5 border-b border-[#f0f2f5] shadow-xs -mx-1 px-1">
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-[#8696a0]">
                      {isSearching ? (
                        <Loader size={13} className="animate-spin text-[#008069]" />
                      ) : (
                        <Search size={13} />
                      )}
                    </span>
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        triggerDebouncedSearch(e.target.value);
                      }}
                      onFocus={() => { searchInputFocusedRef.current = true; }}
                      onBlur={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                          searchInputFocusedRef.current = false;
                        }
                      }}
                      placeholder="Cari nama, no. HP, atau keyword chat..."
                      className="w-full pl-8 pr-7 py-1.5 bg-[#f0f2f5] hover:bg-[#e9edef] focus:bg-white border border-[#e9edef] focus:border-[#008069] rounded-lg text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:ring-1 focus:ring-[#008069]/20 transition-all shadow-2xs"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery('');
                          loadChats(true, '', true);
                        }}
                        className="absolute inset-y-0 right-0 pr-2 flex items-center text-[#8696a0] hover:text-[#111b21] cursor-pointer"
                        title="Hapus pencarian"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Chat Cards or Empty State */}
              {filteredChats.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-6 text-center text-[#667781] text-xs min-h-[180px]">
                  {searchQuery ? (
                    <>
                      <Search className="mx-auto text-[#8696a0] mb-2 opacity-50" size={24} />
                      <p className="font-bold text-[#111b21]">Tidak ada hasil pencarian</p>
                      <p className="text-[#667781] text-[10px] mt-0.5">
                        Tidak ditemukan chat dengan kata kunci &quot;{searchQuery}&quot;
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery('');
                          loadChats(true, '');
                        }}
                        className="mt-2.5 px-2.5 py-1 rounded-lg bg-[#f0f2f5] hover:bg-[#e9edef] text-[#008069] text-[11px] font-semibold transition cursor-pointer"
                      >
                        Reset Pencarian
                      </button>
                    </>
                  ) : (
                    <>
                      <CheckCircle className="mx-auto text-[#008069] mb-2" size={24} />
                      <p className="font-bold text-[#111b21]">
                        {chats.length === 0 ? 'Belum ada percakapan' : 'Tidak ada percakapan'}
                      </p>
                      <p className="text-[#667781] text-[10px] mt-0.5">
                        {chats.length === 0
                          ? 'Percakapan baru akan muncul secara real-time.'
                          : 'Ganti filter sumber atau label untuk melihat lainnya.'}
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5 pt-1.5">
                {filteredChats.map((chat) => {
                  const isMedical = chat.escalationReason === 'medical_concern';
                  const isSelected = chat.conversationId === selectedId;
                  const chatName = chat.customerName || 'Customer';
                  const preview = chat.lastMessages && chat.lastMessages.length > 0
                    ? chat.lastMessages[chat.lastMessages.length - 1]?.content
                    : null;

                  return (
                    <div
                      key={chat.conversationId}
                      data-no-select="true"
                      onClick={() => {
                        if (longPressTriggeredRef.current) {
                          longPressTriggeredRef.current = false;
                          return;
                        }
                        handleSelect(chat.conversationId);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (typeof window !== 'undefined') {
                          window.getSelection()?.removeAllRanges();
                        }
                        setContextMenu({ x: e.clientX, y: e.clientY, chat });
                      }}
                      onTouchStart={(e) => {
                        const touch = e.touches[0];
                        if (!touch) return;
                        const x = touch.clientX;
                        const y = touch.clientY;
                        longPressTouchRef.current = { x, y };
                        if (typeof window !== 'undefined') {
                          window.getSelection()?.removeAllRanges();
                        }
                        longPressTimerRef.current = setTimeout(() => {
                          longPressTriggeredRef.current = true;
                          if (typeof window !== 'undefined') {
                            window.getSelection()?.removeAllRanges();
                          }
                          setContextMenu({ x, y, chat });
                        }, 450);
                      }}
                      onTouchEnd={() => {
                        if (longPressTimerRef.current) {
                          clearTimeout(longPressTimerRef.current);
                          longPressTimerRef.current = null;
                        }
                        longPressTouchRef.current = null;
                        setTimeout(() => {
                          longPressTriggeredRef.current = false;
                        }, 200);
                      }}
                      onTouchMove={(e) => {
                        if (longPressTimerRef.current && longPressTouchRef.current && e.touches[0]) {
                          const dx = e.touches[0].clientX - longPressTouchRef.current.x;
                          const dy = e.touches[0].clientY - longPressTouchRef.current.y;
                          // Hanya batalkan jika jari bergeser lebih dari 10px (toleransi getaran jari)
                          if (Math.hypot(dx, dy) > 10) {
                            clearTimeout(longPressTimerRef.current);
                            longPressTimerRef.current = null;
                            longPressTouchRef.current = null;
                          }
                        }
                      }}
                      onTouchCancel={() => {
                        if (longPressTimerRef.current) {
                          clearTimeout(longPressTimerRef.current);
                          longPressTimerRef.current = null;
                        }
                        longPressTouchRef.current = null;
                        longPressTriggeredRef.current = false;
                      }}
                      style={{
                        WebkitUserSelect: 'none',
                        userSelect: 'none',
                        WebkitTouchCallout: 'none',
                      }}
                      className={`bg-white rounded-xl p-2 border transition-all duration-150 active:scale-[0.985] cursor-pointer text-left flex flex-col justify-between space-y-1.5 shadow-2xs relative select-none touch-manipulation ${
                        isSelected
                          ? 'border-[#008069] bg-[#e8f5f2] ring-1 ring-[#008069]'
                          : isMedical
                            ? 'border-rose-300 bg-rose-50/40 hover:bg-rose-50/70 active:bg-rose-100/50'
                            : 'border-[#e9edef] hover:border-[#c2e7e0] hover:bg-[#f8fafc] active:bg-[#f0f2f5]'
                      }`}
                    >
                      {/* Top Row: Avatar, Name, Group 1 Labels (Under Name), & Release/Bot Icon + Badges */}
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex items-start space-x-2 min-w-0">
                          <CustomerAvatar
                            src={chat.customerProfilePictureUrl}
                            name={chatName}
                            phone={chat.customerPhone}
                            size="sm"
                          />
                          <div className="space-y-0.5 min-w-0">
                            <h4 className="font-bold text-[#111b21] text-xs flex items-center space-x-1.5 truncate">
                              {chat.isPinned && (
                                <span title="Percakapan Disematkan (Pin)" className="inline-flex shrink-0">
                                  <Pin size={11} className="text-[#008069] fill-current" />
                                </span>
                              )}
                              <span className="truncate">{chatName}</span>
                              <span className="text-[10px] text-[#667781] font-normal flex-shrink-0">({chat.customerPhone || 'Unknown'})</span>
                            </h4>

                            {/* GRUP 1: Label Kustom Pelanggan (CRM Tags di bawah nama & nomor) */}
                            <div className="flex flex-wrap items-center gap-1">
                              {(chat.customerLabels || []).map((lbl) => (
                                <span
                                  key={lbl.id}
                                  className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold text-white shadow-2xs"
                                  style={{ backgroundColor: lbl.color || '#008069' }}
                                  title={`Label: ${lbl.name}${lbl.description ? ` (${lbl.description})` : ''}`}
                                >
                                  {lbl.name}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Right Column: Release Icon Button (Khusus Human/CS) + Unread / Awaiting Badge */}
                        <div className="shrink-0 flex flex-col items-end justify-between self-stretch">
                          {chat.isHumanHandling ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRelease(chat);
                              }}
                              disabled={releasingId === chat.conversationId}
                              title="Kembalikan percakapan ke Bot AI"
                              className={`p-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center shadow-2xs disabled:opacity-50 ${
                                isMedical
                                  ? 'bg-rose-100 hover:bg-rose-200 text-rose-700 border border-rose-300'
                                  : 'bg-[#e8f5f2] hover:bg-[#c2e7e0] text-[#008069] border border-[#c2e7e0]'
                              }`}
                            >
                              {releasingId === chat.conversationId ? (
                                <Loader size={12} className="animate-spin" />
                              ) : (
                                <Bot size={13} />
                              )}
                            </button>
                          ) : (
                            <div className="h-6" />
                          )}

                          {/* Badge Unread / Orange Dot (Di Bawah Icon Bot) */}
                          <div className="flex items-center justify-end mt-1 min-h-[19px]">
                            {(chat.unreadCount || 0) > 0 ? (
                              chat.isManualUnread ? (
                                <span
                                  className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#005c4b] shadow-2xs ring-1 ring-white/50"
                                  title="Ditandai belum dibaca (Manual)"
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-white" />
                                </span>
                              ) : (
                                <span
                                  className="inline-flex items-center justify-center min-w-[19px] h-[19px] px-1 text-[10px] font-bold text-white bg-[#25D366] rounded-full shadow-2xs"
                                  title={`${chat.unreadCount} pesan belum dibaca`}
                                >
                                  {chat.unreadCount}
                                </span>
                              )
                            ) : chat.isAwaitingReply ? (
                              <span
                                title="Sudah dibaca, menunggu balasan (< 24 jam)"
                                className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-2xs ring-2 ring-white inline-block animate-pulse"
                              />
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {/* Chat Preview */}
                      <p className="text-xs text-[#54656f] line-clamp-1 italic leading-relaxed">
                        "{preview || 'Tidak ada pesan'}"
                      </p>

                      {/* GRUP 2: Metrik, Order, Traffic, Medis, & Jam (Di Footer Bar) */}
                      <div className="flex justify-between items-center text-[10px] text-[#667781] pt-1.5 border-t border-[#e9edef]">
                        <span className="flex items-center space-x-1.5 flex-wrap gap-y-1">

                          {/* Medis Badge */}
                          {isMedical && (
                            <span
                              className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold bg-rose-100 text-rose-700 border border-rose-200"
                              title="Medical Concern / Emergency — Butuh respon medis"
                            >
                              <AlertTriangle size={8} className="mr-0.5" />
                              Medis
                            </span>
                          )}

                          {/* MQL Badge */}
                          {chat.isMql && (
                            <span
                              title={`MQL (${chat.mqlBubbleCount ?? 0} Bubble)`}
                              className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200"
                            >
                              <Zap size={8} className="mr-0.5" />
                              MQL
                            </span>
                          )}

                          {/* Order Count / Repeat Badge */}
                          {!!chat.purchaseCount && chat.purchaseCount > 0 && (
                            <span
                              title={
                                chat.purchaseCount === 1
                                  ? `Purchase 1x (LTV: ${formatRp(chat.ltv || 0)})`
                                  : `Repeat Order ${chat.purchaseCount}x (LTV: ${formatRp(chat.ltv || 0)})`
                              }
                              className={`inline-flex items-center space-x-0.5 px-1.5 py-0.2 rounded text-[9px] font-bold border ${
                                chat.purchaseCount === 1
                                  ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                                  : 'bg-amber-100 text-amber-800 border-amber-200'
                              }`}
                            >
                              <ShoppingBag size={8} className="mr-0.5" />
                              <span>{chat.purchaseCount}x</span>
                            </span>
                          )}

                          {/* Traffic Source Meta Badge */}
                          {chat.trafficSource === 'meta' && (
                            <span
                              title="Traffic Iklan Meta"
                              className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold bg-sky-100 text-sky-800 border border-sky-200"
                            >
                              <Facebook size={8} className="mr-0.5" />
                              Meta
                            </span>
                          )}

                          {/* Traffic Source Legacy Badge (Tunggal di footer) */}
                          {chat.trafficSource === 'legacy' && (
                            <span
                              title="Pasien Legacy (Data hasil migrasi arsip riwayat WhatsApp lama)"
                              className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold bg-purple-100 text-purple-800 border border-purple-200"
                            >
                              Legacy
                            </span>
                          )}

                          {/* Sandbox Badge */}
                          {chat.isSandboxTest && (
                            <span
                              className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold bg-purple-100 text-purple-800 border border-purple-200"
                              title="Chat simulasi / sandbox"
                            >
                              Sandbox
                            </span>
                          )}
                        </span>

                        {/* Timestamp & Current State */}
                        <span className="flex items-center space-x-1.5">
                          {chat.lastMessageAt && (
                            <span className="text-[#667781] font-sans text-[10px]">
                              {formatLastChat(chat.lastMessageAt)}
                            </span>
                          )}
                          <span className="font-mono text-[9px] font-bold uppercase text-[#8696a0]">{chat.currentState}</span>
                        </span>
                      </div>
                    </div>
                  );
                })}
                {hasMore && (
                  <div className="flex justify-center pt-2">
                    <button
                      onClick={() => loadChats(false)}
                      disabled={loadingMore}
                      className="px-3.5 py-1.5 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] rounded-xl text-xs font-semibold text-[#111b21] transition shadow-xs disabled:opacity-50 flex items-center space-x-1.5"
                    >
                      {loadingMore && <Loader size={11} className="animate-spin text-[#008069]" />}
                      <span>{loadingMore ? 'Memuat...' : 'Muat lebih banyak'}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
            </div>
          </div>

          {/* Section 2: Right Panel - Live Chat Messages */}
          <div
            data-chat-detail="true"
            onTouchStart={handleDetailTouchStart}
            onTouchMove={handleDetailTouchMove}
            onTouchEnd={handleDetailTouchEnd}
            onTouchCancel={() => { detailTouchStartRef.current = null; }}
            className={`${mobileView === 'list' ? 'hidden lg:flex' : 'flex animate-mobile-chat-enter lg:animate-none'} flex-1 min-w-0 h-full min-h-0 flex-col`}
          >
            {selectedChat ? (
              <div className="bg-white border border-[#e9edef] rounded-xl sm:rounded-2xl p-1 sm:p-2.5 md:p-3 h-full flex flex-col justify-between shadow-xs overflow-hidden min-h-0">
                {/* Header Info: Clickable Card to view full customer detail modal */}
                <div className="border-b border-[#e9edef] pb-1.5 sm:pb-2 space-y-1 sm:space-y-1.5 shrink-0">
                  {selectedChat.isSandboxTest && (
                    <div className="flex items-center space-x-2 px-2.5 py-0.5 rounded-lg bg-purple-50 border border-purple-200 text-purple-700 text-[10px] font-bold uppercase tracking-wider">
                      <FlaskConical size={11} />
                      <span>QA TEST — chat simulasi</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center gap-2">
                    <div className="flex items-center min-w-0 flex-1">
                      {/* Mobile Back Button (Dedicated Independent Touch Target) */}
                      <button
                        type="button"
                        onClick={handleBackToList}
                        className="lg:hidden flex items-center justify-center w-10 h-10 -ml-1 mr-1.5 rounded-xl bg-[#f0f2f5] hover:bg-[#e9edef] active:bg-[#d1d7db] text-[#111b21] transition shrink-0 active:scale-90 touch-manipulation z-20 cursor-pointer shadow-2xs"
                        title="Kembali ke daftar percakapan"
                        aria-label="Kembali ke daftar percakapan"
                      >
                        <ChevronLeft size={22} className="stroke-[2.5]" />
                      </button>

                      {/* Clickable Customer Header Box */}
                      <div
                        onClick={() => handleOpenCustomerDetail(selectedChat)}
                        className="flex items-center space-x-2 p-1 -m-1 rounded-xl hover:bg-[#f8fafc] cursor-pointer transition border border-transparent hover:border-[#e9edef] group min-w-0 flex-1"
                        title="Klik untuk melihat detail lengkap profil customer"
                      >
                        <CustomerAvatar
                          src={selectedChat.customerProfilePictureUrl}
                          name={selectedChat.customerName}
                          phone={selectedChat.customerPhone}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <h3 className="text-xs sm:text-sm font-bold text-[#111b21] flex items-center space-x-1 group-hover:text-[#008069] transition truncate">
                            <span className="truncate">{selectedChat.customerName || 'Customer'}</span>
                            <ExternalLink size={11} className="text-[#8696a0] group-hover:text-[#008069] shrink-0" />
                          </h3>
                        <div className="flex items-center space-x-1.5 mt-0.5 flex-wrap gap-y-1">
                          <p className="text-[11px] text-[#667781] font-mono">
                            {selectedChat.customerPhone || 'Unknown'}
                          </p>

                          {/* Active Label Colored Dots */}
                          {(selectedChat.customerLabels || []).map((lbl) => (
                            <span
                              key={lbl.id}
                              className="w-2.5 h-2.5 rounded-full inline-block shrink-0 shadow-2xs cursor-help ring-1 ring-white"
                              style={{ backgroundColor: lbl.color || '#008069' }}
                              title={`Label: ${lbl.name}${lbl.description ? ` (${lbl.description})` : ''}`}
                            />
                          ))}

                          {/* Add / Manage Label Button (+) right next to phone & dots */}
                          <div className="relative inline-flex" ref={labelPopoverRef} onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => setLabelPopoverOpen(!labelPopoverOpen)}
                              className="inline-flex items-center justify-center w-4.5 h-4.5 rounded-md text-[10px] font-bold bg-[#f0f2f5] hover:bg-[#e9edef] text-[#54656f] hover:text-[#008069] border border-[#d1d7db] transition shadow-2xs active:scale-95 ml-0.5"
                              title="Tambah / Kelola Label Pasien"
                              aria-label="Tambah Label"
                            >
                              <Plus size={10} />
                            </button>

                            {/* Label Picker Popover */}
                            {labelPopoverOpen && (
                              <div className="absolute left-0 top-full mt-1.5 z-30 w-52 bg-white border border-[#e9edef] rounded-xl shadow-lg p-2 space-y-1">
                                <div className="flex justify-between items-center px-1.5 pb-1 border-b border-[#f0f2f5] text-[11px] font-bold text-[#667781]">
                                  <span>PILIH LABEL</span>
                                  <button
                                    type="button"
                                    onClick={() => setLabelPopoverOpen(false)}
                                    className="text-[#8696a0] hover:text-[#111b21] text-xs font-semibold"
                                  >
                                    ✕
                                  </button>
                                </div>
                                {allLabels.length === 0 ? (
                                  <p className="text-[11px] text-[#667781] p-2 text-center">
                                    Belum ada label.{' '}
                                    <a href="/admin/labels" className="text-[#008069] underline font-semibold">
                                      Buat label
                                    </a>
                                  </p>
                                ) : (
                                  <div className="max-h-48 overflow-y-auto space-y-0.5 py-1">
                                    {allLabels.map((lbl) => {
                                      const isChecked = (selectedChat.customerLabels || []).some((l) => l.id === lbl.id);
                                      return (
                                        <button
                                          key={lbl.id}
                                          type="button"
                                          onClick={() => handleToggleLabel(selectedChat.customerId, lbl)}
                                          disabled={togglingLabelId === lbl.id}
                                          className={`w-full text-left px-2 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-between transition ${
                                            isChecked ? 'bg-[#e8f5f2] text-[#008069]' : 'hover:bg-[#f0f2f5] text-[#111b21]'
                                          }`}
                                        >
                                          <span className="flex items-center space-x-2 truncate">
                                            <span
                                              className="w-2.5 h-2.5 rounded-full shrink-0"
                                              style={{ backgroundColor: lbl.color }}
                                            />
                                            <span className="truncate">{lbl.name}</span>
                                          </span>
                                          {isChecked && <Check size={13} className="text-[#008069] shrink-0" />}
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                    {/* Header actions: Bot Release/Takeover */}
                    <div className="shrink-0 flex items-center gap-1.5">
                      {selectedChat.isHumanHandling ? (
                        <button
                          onClick={() => handleRelease(selectedChat)}
                          disabled={releasingId === selectedChat.conversationId}
                          title="Kembalikan percakapan ke Bot AI"
                          className="px-3 py-1.5 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
                        >
                          <Bot size={14} />
                          <span className="hidden sm:inline">Kembalikan ke Bot</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => handleTakeover(selectedChat)}
                          disabled={releasingId === selectedChat.conversationId}
                          title="Ambil alih percakapan (CS / Manual). Bot AI akan dinonaktifkan untuk percakapan ini."
                          className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-300 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-2xs disabled:opacity-50 cursor-pointer"
                        >
                          <User size={14} className="text-amber-600" />
                          <span>Ambil Alih (CS)</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Chat Bubbles Container with WhatsApp Wallpaper */}
                <div 
                  ref={chatContainerRef} 
                  className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-1.5 sm:p-2.5 md:p-3 space-y-1.5 sm:space-y-2 my-1 sm:my-1.5 rounded-lg sm:rounded-xl border border-[#e9edef] bg-[#efeae2]"
                  style={{
                    backgroundImage: `radial-gradient(#d1d7db 0.75px, transparent 0.75px)`,
                    backgroundSize: '16px 16px',
                    overscrollBehavior: 'contain',
                  }}
                >
                  {/* Floating In-Chat Search Navigation Bar — unified dengan searchQuery global */}
                  {effectiveInChatQuery && messages.length > 0 && matchingMessageIds.length > 0 && (
                    <div className="sticky top-1 z-30 mx-auto w-fit max-w-[94%] bg-amber-50/95 backdrop-blur-md border border-amber-300 shadow-md rounded-full px-3 py-1.5 flex items-center gap-2 text-xs text-amber-900 animate-fadeIn select-none">
                      <Search size={13} className="text-amber-600 shrink-0" />
                      <span className="truncate">
                        Hasil pencarian: <span className="font-semibold text-amber-950">"{searchQuery}"</span> ({currentMatchIndex + 1} dari {matchingMessageIds.length})
                      </span>
                      <div className="flex items-center gap-0.5 border-l border-amber-200 pl-1.5 shrink-0">
                        <button
                          type="button"
                          title="Pesan Sebelumnya (Lebih Lama)"
                          onClick={handlePrevMatch}
                          className="p-1 rounded-full hover:bg-amber-200/70 text-amber-800 transition active:scale-90 cursor-pointer"
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          type="button"
                          title="Pesan Berikutnya (Lebih Baru)"
                          onClick={handleNextMatch}
                          className="p-1 rounded-full hover:bg-amber-200/70 text-amber-800 transition active:scale-90 cursor-pointer"
                        >
                          <ChevronDown size={14} />
                        </button>
                        <button
                          type="button"
                          title="Tutup Navigasi Pencarian"
                          onClick={handleClearInChatSearch}
                          className="p-1 rounded-full hover:bg-amber-200/70 text-amber-600 hover:text-amber-900 ml-0.5 transition active:scale-90 cursor-pointer"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  )}

                  {effectiveInChatQuery && messages.length > 0 && matchingMessageIds.length === 0 && (
                    <div className="sticky top-1 z-30 mx-auto w-fit max-w-[94%] bg-slate-50/95 backdrop-blur-md border border-slate-300 shadow-sm rounded-full px-3 py-1 flex items-center gap-2 text-xs text-slate-600 animate-fadeIn select-none">
                      <Info size={13} className="text-slate-500 shrink-0" />
                      <span className="truncate">
                        Tidak ada bubble pesan berisi <span className="font-semibold">"{searchQuery}"</span> di percakapan ini
                      </span>
                      <button
                        type="button"
                        title="Tutup"
                        onClick={handleClearInChatSearch}
                        className="p-0.5 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-700 ml-1 transition active:scale-90 cursor-pointer"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )}

                  {messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center text-[#667781] text-xs">
                      <MessageCircle size={32} className="mb-2 text-[#8696a0]" />
                      <p>Belum ada pesan di percakapan ini.</p>
                    </div>
                  ) : (
                    messages.map((msg, idx) => {
                      const isCustomer = msg.direction === 'INBOUND';
                      const senderTypeUpper = (msg.sender_type || '').toUpperCase();
                      const isAdmin = msg.direction === 'OUTBOUND' && (senderTypeUpper === 'ADMIN' || senderTypeUpper === 'HUMAN' || senderTypeUpper === 'STAFF');
                      const isRevoked = msg.content === '🚫 Pesan ini telah ditarik' || (msg as any).is_revoked || (msg as any).payload_raw?.is_revoked;
                      const isEdited = !!(msg as any).is_edited || !!(msg as any).payload_raw?.is_edited;
                      const canRevoke = !isCustomer && !isRevoked && !!gatewayCapability?.supportsRevoke;
                      const isWithin15Mins = msg.created_at ? (Date.now() - new Date(msg.created_at).getTime() <= 15 * 60 * 1000) : false;
                      const canEdit = !isCustomer && !isRevoked && isWithin15Mins && !msg.media && (gatewayCapability?.supportsEdit ?? true);
                      const hasMedia = !!msg.media;
                      const quotedMsg = msg.quoted_message || extractQuotedMessage(msg);
                      const showDateSeparator = isDifferentDay(msg.created_at, messages[idx - 1]?.created_at);

                      // Pencarian match & highlight status
                      const isMatchBubble = effectiveInChatQuery ? matchingMessageIds.includes(msg.id) : false;
                      const isCurrentActiveMatch = effectiveInChatQuery ? (matchingMessageIds[currentMatchIndex] === msg.id || highlightedMsgId === msg.id) : false;

                      // Lokasi valid = latitude/longitude ada dan bukan 0,0 (image WA Web sering kebawa location kosong)
                      const rawLoc = (msg as any).payload_raw?.location || (msg as any).payloadRaw?.location;
                      const hasValidLocation = !!(
                        rawLoc &&
                        Number(rawLoc.latitude) !== 0 &&
                        Number(rawLoc.longitude) !== 0 &&
                        !isNaN(Number(rawLoc.latitude)) &&
                        !isNaN(Number(rawLoc.longitude))
                      );
                      const isLocationMsg = hasValidLocation && ((msg.content && /^\[LOCATION/i.test(msg.content)) || !!rawLoc);
                      // Jika ada media valid, jangan anggap sebagai location walau payload_raw.location ada (0,0)
                      const effectiveIsLocationMsg = isLocationMsg && !hasMedia;
                      const hasMediaOnly = hasMedia && (!msg.content || /^\[(IMAGE|MEDIA)/.test(msg.content));

                      // Extract Location Coordinates if present (hanya jika lokasi valid & bukan image)
                      let locLat: string | null = null;
                      let locLng: string | null = null;
                      if (effectiveIsLocationMsg) {
                        const locMatch = msg.content?.match(/Lat\s*([-\d.]+),\s*Lng\s*([-\d.]+)/i);
                        if (locMatch && Number(locMatch[1]) !== 0 && Number(locMatch[2]) !== 0) {
                          locLat = locMatch[1];
                          locLng = locMatch[2];
                        } else if (hasValidLocation) {
                          locLat = rawLoc.latitude != null ? String(rawLoc.latitude) : null;
                          locLng = rawLoc.longitude != null ? String(rawLoc.longitude) : null;
                        }
                      }

                      // Reaksi Pesan (WhatsApp Message Reactions)
                      const reactions: Array<{ emoji: string; fromMe: boolean; senderName?: string; actorId?: string }> =
                        (msg as any).reactions || (msg as any).payload_raw?.reactions || [];
                      const myReaction = reactions.find((r) => r.fromMe);

                      const groupedReactionsMap = new Map<string, { emoji: string; count: number; senders: string[] }>();
                      for (const r of reactions) {
                        if (!r.emoji) continue;
                        const entry = groupedReactionsMap.get(r.emoji) || { emoji: r.emoji, count: 0, senders: [] };
                        entry.count += 1;
                        entry.senders.push(r.fromMe ? 'Anda' : (r.senderName || 'Customer'));
                        groupedReactionsMap.set(r.emoji, entry);
                      }
                      const groupedReactions = Array.from(groupedReactionsMap.values());

                      return (
                        <React.Fragment key={msg.id}>
                          {showDateSeparator && (
                            <div className="flex justify-center my-2 sm:my-2.5">
                              <div className="bg-white/95 backdrop-blur-xs px-3 py-1 rounded-lg text-[11px] font-semibold text-[#54656f] shadow-2xs border border-black/5 select-none tracking-wide">
                                {formatChatDateSeparator(msg.created_at)}
                              </div>
                            </div>
                          )}
                          <div
                            id={`msg-${msg.id}`}
                            className={`flex ${isCustomer ? 'justify-start' : 'justify-end'} group transition-all duration-300 relative ${
                              isCurrentActiveMatch
                                ? 'ring-3 ring-amber-400/90 bg-amber-200/30 rounded-2xl p-1 -m-1 shadow-md scale-[1.01]'
                                : isMatchBubble
                                ? 'ring-1 ring-amber-300/60 bg-amber-100/20 rounded-2xl p-0.5 -m-0.5'
                                : ''
                            }`}
                          >
                            {/* Floating WhatsApp-Style Quick Emoji Reaction Toolbar */}
                            {activeReactionMsgId === msg.id && (
                              <div
                                className={`absolute -top-10 ${isCustomer ? 'left-0' : 'right-0'} z-30 bg-white border border-[#d1d7db] rounded-full shadow-lg px-2 py-1 flex items-center gap-1 animate-fadeIn select-none`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {QUICK_REACTIONS.map((em) => {
                                  const isSelected = myReaction?.emoji === em;
                                  return (
                                    <button
                                      key={em}
                                      type="button"
                                      onClick={() => handleToggleReaction(msg, em)}
                                      className={`w-7 h-7 flex items-center justify-center text-base rounded-full hover:scale-125 transition active:scale-95 ${
                                        isSelected ? 'bg-[#d9fdd3] ring-2 ring-[#008069]' : 'hover:bg-[#f0f2f5]'
                                      }`}
                                      title={`Reaksi ${em}${isSelected ? ' (klik untuk batal)' : ''}`}
                                    >
                                      {em}
                                    </button>
                                  );
                                })}
                                <button
                                  type="button"
                                  onClick={() => setCustomEmojiMsgId(customEmojiMsgId === msg.id ? null : msg.id)}
                                  className={`w-7 h-7 flex items-center justify-center text-xs rounded-full hover:bg-[#f0f2f5] transition ${
                                    customEmojiMsgId === msg.id ? 'bg-[#e8f5f2] text-[#008069]' : 'text-[#54656f]'
                                  }`}
                                  title="Pilih emoji lainnya"
                                >
                                  ➕
                                </button>
                              </div>
                            )}

                            {/* Extra Emoji Grid Popup */}
                            {activeReactionMsgId === msg.id && customEmojiMsgId === msg.id && (
                              <div
                                className={`absolute -top-28 ${isCustomer ? 'left-0' : 'right-0'} z-40 bg-white border border-[#d1d7db] rounded-2xl shadow-xl p-2 grid grid-cols-6 gap-1 animate-fadeIn select-none`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {EXTRA_REACTIONS.map((em) => {
                                  const isSelected = myReaction?.emoji === em;
                                  return (
                                    <button
                                      key={em}
                                      type="button"
                                      onClick={() => handleToggleReaction(msg, em)}
                                      className={`w-7 h-7 flex items-center justify-center text-base rounded-full hover:scale-125 transition active:scale-95 ${
                                        isSelected ? 'bg-[#d9fdd3] ring-2 ring-[#008069]' : 'hover:bg-[#f0f2f5]'
                                      }`}
                                      title={`Reaksi ${em}`}
                                    >
                                      {em}
                                    </button>
                                  );
                                })}
                              </div>
                            )}

                            <div
                              className={`relative ${hasMediaOnly ? 'max-w-[240px] sm:max-w-[280px] p-1 sm:p-1.5' : 'max-w-[88%] sm:max-w-[75%] md:max-w-[70%] px-2.5 sm:px-3 py-1.5'} rounded-lg text-xs leading-relaxed shadow-2xs transition-all select-text cursor-text ${
                                isRevoked
                                  ? 'bg-[#f0f2f5] text-[#667781] border border-[#d1d7db]'
                                  : isCustomer
                                    ? 'bg-white text-[#111b21] rounded-tl-none border border-black/5'
                                    : isAdmin
                                      ? 'bg-[#d9fdd3] text-[#111b21] rounded-tr-none border border-[#00a884]/20'
                                      : 'bg-white text-[#111b21] rounded-tr-none border-l-4 border-[#008069]'
                              }`}
                            >
                              {(!hasMediaOnly || (!isCustomer && !isAdmin)) && !isRevoked && (
                                <span className={`block text-[10px] font-bold mb-0.5 flex items-center space-x-1 ${
                                  isCustomer ? 'text-[#667781]' : isAdmin ? 'text-[#008069]' : 'text-[#008069]'
                                }`}>
                                  {!isCustomer && !isAdmin && <Bot size={10} />}
                                  <span>{senderLabel(msg)}</span>
                                </span>
                              )}

                              {/* Quoted Message / WhatsApp Reply preview inside bubble */}
                              {quotedMsg && !isRevoked && (
                                <div
                                  className={`mb-1.5 p-1.5 rounded-md border-l-[3px] text-[11px] leading-snug cursor-pointer transition select-none ${
                                    isCustomer
                                      ? 'bg-black/[0.04] hover:bg-black/[0.07] border-[#008069]'
                                      : 'bg-black/[0.05] hover:bg-black/[0.08] border-[#008069]'
                                  }`}
                                  onClick={() => {
                                    if (quotedMsg.id || quotedMsg.wa_message_id) {
                                      const targetElem = document.getElementById(`msg-${quotedMsg.id}`) || document.getElementById(`msg-${quotedMsg.wa_message_id}`);
                                      if (targetElem) {
                                        targetElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                        targetElem.classList.add('ring-2', 'ring-[#008069]');
                                        setTimeout(() => targetElem.classList.remove('ring-2', 'ring-[#008069]'), 1200);
                                      }
                                    }
                                  }}
                                  title="Klik untuk melihat pesan asli"
                                >
                                  <p className="font-bold text-[10px] text-[#008069] truncate mb-0.5">
                                    {quotedMsg.sender_name || (quotedMsg.direction === 'INBOUND' ? (selectedChat.customerName || 'Customer') : 'Bidan / CS')}
                                  </p>
                                  <p className="text-[11px] text-[#54656f] truncate font-sans">
                                    {quotedMsg.media ? (
                                      <span className="flex items-center gap-1">
                                        <span>📷</span>
                                        <span>Foto</span>
                                        {quotedMsg.content && !/^\[(IMAGE|MEDIA)/.test(quotedMsg.content) && <span>{quotedMsg.content}</span>}
                                      </span>
                                    ) : (
                                      quotedMsg.content || 'Pesan'
                                    )}
                                  </p>
                                </div>
                              )}

                              {!isRevoked && msg.media && (
                                <div className={hasMediaOnly ? 'mb-0.5' : 'mb-1.5'}>
                                  <MediaImage
                                    src={msg.media.url || msg.media.hdUrl || msg.media.thumbUrl}
                                    downloadSrc={msg.media.hdUrl || msg.media.url}
                                    thumbUrl={msg.media.thumbUrl}
                                    caption={msg.media.caption || undefined}
                                  />
                                </div>
                              )}
                              {isRevoked ? (
                                <p className="font-sans whitespace-pre-wrap italic text-[#667781] flex items-center space-x-1.5 py-0.5">
                                  <Ban size={12} className="text-[#8696a0] shrink-0" />
                                  <span>Pesan ini telah ditarik</span>
                                </p>
                              ) : (
                                <>
                                  {effectiveIsLocationMsg && (
                                    <div className="my-1 p-2 bg-[#f0f2f5] hover:bg-[#e8f5f2] rounded-xl border border-[#d1d7db] transition flex items-center space-x-2.5 text-left">
                                      <div className="w-8 h-8 rounded-lg bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                                        <MapPin size={17} />
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="font-bold text-[12px] text-[#111b21] leading-tight">Share Location</p>
                                        <p className="text-[10px] text-[#667781] font-mono truncate mt-0.5">
                                          {locLat && locLng ? `${locLat}, ${locLng}` : 'Titik koordinat diterima'}
                                        </p>
                                      </div>
                                      {locLat && locLng && (
                                        <a
                                          href={`https://www.google.com/maps/search/?api=1&query=${locLat},${locLng}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="px-2.5 py-1.5 bg-[#008069] hover:bg-[#00a884] text-white rounded-lg text-[11px] font-bold transition shadow-xs flex items-center space-x-1 shrink-0 active:scale-95"
                                          title="Buka lokasi di Google Maps"
                                        >
                                          <span>Peta</span>
                                          <ExternalLink size={12} />
                                        </a>
                                      )}
                                    </div>
                                  )}
                                  {msg.content && !/^\[(IMAGE|MEDIA|LOCATION)/.test(msg.content) && !effectiveIsLocationMsg && (
                                    <p className="font-sans whitespace-pre-wrap select-text cursor-text">
                                      {renderHighlightedText(msg.content, searchQuery)}
                                    </p>
                                  )}
                                </>
                              )}
                              <div className="flex items-center justify-end space-x-1 mt-0.5 text-right select-none text-[10px] text-[#667781]">
                                {isEdited && !isRevoked && (
                                  <span className="text-[9px] text-[#667781] italic mr-0.5">diedit</span>
                                )}
                                <span>
                                  {msg.created_at ? formatWibTime(msg.created_at) : ''}
                                </span>
                                {!isCustomer && (
                                  <span
                                    className="inline-flex items-center ml-0.5"
                                    title={
                                      msg.delivery_status === 'read'
                                        ? `Dibaca ${msg.read_at ? formatWibTime(msg.read_at) : ''}`
                                        : msg.delivery_status === 'delivered'
                                        ? `Diterima di HP ${msg.delivered_at ? formatWibTime(msg.delivered_at) : ''}`
                                        : msg.delivery_status === 'failed'
                                        ? 'Gagal terkirim'
                                        : 'Terkirim'
                                    }
                                  >
                                    {msg.delivery_status === 'read' ? (
                                      <CheckCheck size={13} className="text-[#53bdeb] stroke-[2.5]" />
                                    ) : msg.delivery_status === 'delivered' ? (
                                      <CheckCheck size={13} className="text-[#8696a0]" />
                                    ) : msg.delivery_status === 'failed' ? (
                                      <AlertCircle size={12} className="text-rose-500" />
                                    ) : (
                                      <Check size={12} className="text-[#8696a0]" />
                                    )}
                                  </span>
                                )}
                                {!isRevoked && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveReactionMsgId(activeReactionMsgId === msg.id ? null : msg.id);
                                      setCustomEmojiMsgId(null);
                                    }}
                                    className={`ml-0.5 p-0.5 rounded transition active:scale-90 ${
                                      activeReactionMsgId === msg.id || myReaction
                                        ? 'text-[#008069] bg-[#e8f5f2]'
                                        : 'text-[#8696a0] hover:text-[#008069] hover:bg-[#e8f5f2]'
                                    }`}
                                    title={myReaction ? `Reaksi Anda: ${myReaction.emoji} (klik untuk ubah/batal)` : 'Beri reaksi emotikon'}
                                  >
                                    <Smile size={11} />
                                  </button>
                                )}
                                {!isRevoked && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSelectReply(msg);
                                    }}
                                    className="ml-0.5 p-0.5 rounded text-[#8696a0] hover:text-[#008069] hover:bg-[#e8f5f2] transition active:scale-90"
                                    title="Balas pesan ini"
                                  >
                                    <Reply size={11} />
                                  </button>
                                )}
                                {canEdit && (
                                  <button
                                    type="button"
                                    onClick={() => handleStartEdit(msg)}
                                    className="ml-0.5 p-0.5 rounded text-[#8696a0] hover:text-[#008069] hover:bg-[#e8f5f2] transition active:scale-90"
                                    title="Edit pesan (maksimal 15 menit)"
                                  >
                                    <PenLine size={11} />
                                  </button>
                                )}
                                {canRevoke && (
                                  <button
                                    type="button"
                                    disabled={revokingId === msg.id}
                                    onClick={() => handleRevokeMessage(msg)}
                                    className="ml-0.5 p-0.5 rounded text-[#8696a0] hover:text-rose-600 hover:bg-rose-50 transition active:scale-90"
                                    title="Tarik / Hapus pesan untuk semua orang (Delete for Everyone)"
                                  >
                                    {revokingId === msg.id ? (
                                      <div className="h-2.5 w-2.5 animate-spin rounded-full border border-rose-500 border-t-transparent" />
                                    ) : (
                                      <Trash2 size={11} />
                                    )}
                                  </button>
                                )}
                              </div>

                              {/* Reaction Badges (WhatsApp Style Pill attached to bottom corner of bubble) */}
                              {groupedReactions.length > 0 && !isRevoked && (
                                <div
                                  className={`absolute -bottom-2.5 ${isCustomer ? 'left-2' : 'right-2'} z-10 flex items-center bg-white border border-[#d1d7db] rounded-full px-1.5 py-0.5 shadow-xs text-[11px] gap-1 select-none hover:shadow-md cursor-pointer transition`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveReactionMsgId(activeReactionMsgId === msg.id ? null : msg.id);
                                    setCustomEmojiMsgId(null);
                                  }}
                                  title={reactions.map((r) => `${r.emoji} ${r.fromMe ? 'Anda' : (r.senderName || 'Customer')}`).join('\n')}
                                >
                                  {groupedReactions.map((g) => (
                                    <span key={g.emoji} className="flex items-center gap-0.5">
                                      <span>{g.emoji}</span>
                                      {g.count > 1 && <span className="text-[10px] text-[#667781] font-bold">{g.count}</span>}
                                    </span>
                                  ))}
                                </div>
                              )}
                             </div>
                          </div>
                        </React.Fragment>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} className="h-0 w-0 pointer-events-none" />
                </div>

                {/* Reply Composer */}
                <div className="border-t border-[#e9edef] pt-1 sm:pt-1.5 shrink-0">
                  {selectedChat.isSandboxTest ? (
                    <div className="flex items-center justify-center space-x-2 px-3 py-2.5 rounded-xl bg-purple-50 border border-purple-200 text-purple-700 text-xs font-semibold">
                      <FlaskConical size={13} />
                      <span>Chat sandbox — balasan admin diblokir otomatis</span>
                    </div>
                  ) : (
                  <>
                  {/* Active Quoted Message Banner (WhatsApp-Style Replying Bar) */}
                  {replyingTo && (
                    <div className="flex items-center justify-between bg-white px-3 py-2 border-l-4 border-[#008069] rounded-t-xl mb-1 shadow-xs border border-b-0 border-[#e9edef] animate-fadeIn">
                      <div className="flex-1 min-w-0 pr-2">
                        <div className="flex items-center space-x-1.5">
                          <Reply size={12} className="text-[#008069] shrink-0" />
                          <span className="text-[11px] font-bold text-[#008069] truncate">
                            Membalas {replyingTo.direction === 'INBOUND' ? (selectedChat.customerName || 'Customer') : 'Bidan / CS'}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#54656f] truncate mt-0.5 pl-4">
                          {replyingTo.media ? '📷 Foto' : (replyingTo.content || 'Pesan')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setReplyingTo(null)}
                        className="p-1 text-[#8696a0] hover:text-rose-500 hover:bg-rose-50 rounded-full transition active:scale-90"
                        title="Batal membalas"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}

                  {selectedImage && (
                    <div className="relative inline-block mb-2">
                      <img
                        src={selectedImage.preview}
                        alt="Preview"
                        className="w-20 h-20 object-cover rounded-lg border border-[#e9edef]"
                      />
                      <button
                        onClick={() => setSelectedImage(null)}
                        className="absolute -top-1.5 -right-1.5 p-0.5 bg-rose-500 text-white rounded-full hover:bg-rose-600 transition"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )}

                  <div className={`flex items-end space-x-1.5 sm:space-x-2 bg-[#f0f2f5] p-1 sm:p-1.5 md:p-2 border border-[#e9edef] w-full ${replyingTo ? 'rounded-b-xl border-t-0' : 'rounded-xl'}`}>
                    <input
                      ref={fileInputRef}
                      type="file"
                      tabIndex={-1}
                      aria-hidden="true"
                      accept="image/*"
                      onChange={handlePickImage}
                      className="hidden"
                    />

                    {/* Tools Button */}
                    <div className="relative shrink-0" ref={toolsMenuRef}>
                      <button
                        type="button"
                        onClick={() => setToolsMenuOpen(!toolsMenuOpen)}
                        disabled={sending || generatingDraft}
                        className={`w-9 h-9 sm:w-10 sm:h-10 min-h-[36px] sm:min-h-[38px] p-0 bg-white border border-[#d1d7db] hover:border-[#008069] disabled:opacity-40 rounded-xl text-xs font-bold transition flex items-center justify-center shadow-xs active:scale-95 shrink-0 ${
                          toolsMenuOpen ? 'bg-[#e8f5f2] border-[#008069] text-[#008069]' : 'text-[#54656f] hover:text-[#008069]'
                        }`}
                        title="Fitur & Lampiran (AI Copilot / Gambar)"
                        aria-label="Menu Tools & Lampiran"
                      >
                        {generatingDraft ? (
                          <Loader size={17} className="animate-spin text-amber-500" />
                        ) : (
                          <Plus size={17} className={`transition-transform duration-200 ${toolsMenuOpen ? 'rotate-45 text-[#008069]' : ''}`} />
                        )}
                      </button>

                      {/* Tools Popover Menu */}
                      {toolsMenuOpen && (
                        <div className="absolute bottom-full left-0 mb-2 w-56 bg-white border border-[#e9edef] rounded-2xl shadow-xl p-1.5 z-30 animate-fadeIn space-y-1">
                          {/* Option 1: AI Copilot Draft */}
                          <button
                            type="button"
                            onClick={() => {
                              setToolsMenuOpen(false);
                              handleGenerateAiDraft();
                            }}
                            disabled={generatingDraft || sending}
                            className="w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#111b21] hover:bg-amber-50/80 hover:text-amber-700 transition text-left group disabled:opacity-50"
                          >
                            <div className="w-7 h-7 rounded-lg bg-amber-100/80 text-amber-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                              <Sparkles size={15} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-[12px] truncate flex items-center gap-1">
                                <span>AI Copilot Draft</span>
                                <span className="text-[9px] px-1 py-0.2 bg-amber-100 text-amber-800 rounded font-semibold">AI</span>
                              </p>
                              <p className="text-[10px] text-[#667781] truncate">Saran balasan otomatis bidan</p>
                            </div>
                          </button>

                          {/* Option 2: Quick Create Reservation */}
                          <button
                            type="button"
                            onClick={() => {
                              setToolsMenuOpen(false);
                              handleOpenQuickReservation();
                            }}
                            disabled={!selectedChat || sending}
                            className="w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#111b21] hover:bg-emerald-50/80 hover:text-[#008069] transition text-left group disabled:opacity-50"
                          >
                            <div className="w-7 h-7 rounded-lg bg-emerald-100/80 text-[#008069] flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                              <CalendarPlus size={15} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-[12px] truncate">Buat Reservasi Baru</p>
                              <p className="text-[10px] text-[#667781] truncate">Auto-fill data pasien & anak</p>
                            </div>
                          </button>

                          {/* Option 3: Generate Invoice / Payment */}
                          <button
                            type="button"
                            onClick={() => {
                              setToolsMenuOpen(false);
                              handleGenerateActiveReservationInvoice();
                            }}
                            disabled={!selectedChat || sending}
                            className="w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#111b21] hover:bg-sky-50/80 hover:text-sky-700 transition text-left group disabled:opacity-50"
                          >
                            <div className="w-7 h-7 rounded-lg bg-sky-100/80 text-sky-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                              <Receipt size={15} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-[12px] truncate">Generate Invoice / Payment</p>
                              <p className="text-[10px] text-[#667781] truncate">Isi format rincian ke chat</p>
                            </div>
                          </button>

                          {/* Option 4: Image Attachment */}
                          <button
                            type="button"
                            onClick={() => {
                              setToolsMenuOpen(false);
                              fileInputRef.current?.click();
                            }}
                            disabled={sending}
                            className="w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#111b21] hover:bg-[#e8f5f2] hover:text-[#008069] transition text-left group disabled:opacity-50"
                          >
                            <div className="w-7 h-7 rounded-lg bg-[#e8f5f2] text-[#008069] flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                              <ImagePlus size={15} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-[12px] truncate">Lampirkan Gambar</p>
                              <p className="text-[10px] text-[#667781] truncate">Kirim foto/pricelist (maks 8MB)</p>
                            </div>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Emoji Picker Button (Khusus Tampilan Web/Desktop) */}
                    <div className="relative shrink-0 hidden md:block" ref={emojiPickerRef}>
                      <button
                        type="button"
                        onClick={() => setEmojiPickerOpen(!emojiPickerOpen)}
                        disabled={sending}
                        className={`w-9 h-9 sm:w-10 sm:h-10 min-h-[36px] sm:min-h-[38px] p-0 bg-white border border-[#d1d7db] hover:border-[#008069] disabled:opacity-40 rounded-xl text-xs font-bold transition flex items-center justify-center shadow-xs active:scale-95 shrink-0 ${
                          emojiPickerOpen ? 'bg-[#e8f5f2] border-[#008069] text-[#008069]' : 'text-[#54656f] hover:text-[#008069]'
                        }`}
                        title="Pilih Emoticon (Khusus Web)"
                        aria-label="Pilih Emoticon"
                      >
                        <Smile size={18} className={emojiPickerOpen ? 'text-[#008069]' : 'text-[#54656f]'} />
                      </button>

                      {/* Emoji Popover */}
                      {emojiPickerOpen && (
                        <div className="absolute bottom-full left-0 mb-2 w-80 bg-white border border-[#e9edef] rounded-2xl shadow-2xl p-2.5 z-40 animate-fadeIn flex flex-col gap-2 select-none">
                          {/* Header / Category Tabs - Icon Only */}
                          <div className="flex items-center justify-between border-b border-[#e9edef] pb-1.5 px-0.5">
                            <div className="flex items-center space-x-1">
                              {EMOJI_CATEGORIES.map((cat) => (
                                <button
                                  key={cat.id}
                                  type="button"
                                  onClick={() => setEmojiCategory(cat.id as any)}
                                  className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-base transition active:scale-95 cursor-pointer ${
                                    emojiCategory === cat.id
                                      ? 'bg-[#e8f5f2] text-[#008069] font-bold shadow-xs scale-105'
                                      : 'text-[#54656f] hover:bg-[#f0f2f5]'
                                  }`}
                                  title={cat.label}
                                  aria-label={cat.label}
                                >
                                  <span>{cat.icon}</span>
                                </button>
                              ))}
                            </div>
                            <button
                              type="button"
                              onClick={() => setEmojiPickerOpen(false)}
                              className="text-[#8696a0] hover:text-[#111b21] p-1.5 rounded-lg hover:bg-[#f0f2f5] transition"
                              title="Tutup"
                            >
                              <X size={14} />
                            </button>
                          </div>

                          {/* Emoji Grid */}
                          <div className="grid grid-cols-8 gap-1 max-h-52 overflow-y-auto p-1 custom-scrollbar">
                            {(emojiCategory === 'favorites'
                              ? favoriteEmojis
                              : (EMOJI_CATEGORIES.find((cat) => cat.id === emojiCategory)?.emojis || [])
                            ).map((emoji, idx) => (
                              <button
                                key={`${emoji}-${idx}`}
                                type="button"
                                onClick={() => insertEmoji(emoji)}
                                className="w-8 h-8 flex items-center justify-center text-lg rounded-lg hover:bg-[#f0f2f5] hover:scale-125 transition-transform active:scale-95 cursor-pointer"
                                title={emoji}
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div
                      ref={chatInputRef}
                      contentEditable="plaintext-only"
                      role="textbox"
                      aria-multiline="true"
                      data-placeholder="Tulis balasan... (Enter baris baru, klik Kirim)"
                      onFocus={() => {
                        // viewport handler throttle sudah handle, tidak perlu scroll paksa lagi saat fokus untuk hindari goyang
                      }}
                      onInput={(e) => {
                        handleInputChange(e.currentTarget.innerText || '');
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          handleSendReply();
                        }
                      }}
                      className="chat-contenteditable flex-1 w-full min-w-0 rounded-xl bg-white border border-[#d1d7db] focus:border-[#008069] focus:ring-1 focus:ring-[#008069] focus:outline-none text-[16px] sm:text-sm text-[#111b21] py-2 px-2.5 sm:px-3 shadow-xs min-h-[38px] max-h-[220px] overflow-y-auto leading-relaxed outline-none"
                      style={{ fontSize: '16px', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}
                    />
                    <button
                      onClick={handleSendReply}
                      disabled={sending || (!hasReplyText && !selectedImage)}
                      className="w-9 h-9 sm:w-auto sm:px-4 min-h-[36px] sm:min-h-[38px] p-0 sm:py-2.5 bg-[#008069] hover:bg-[#00a884] disabled:opacity-40 text-white rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 shadow-xs shrink-0 active:scale-95"
                      title="Kirim Balasan"
                    >
                      <Send size={15} />
                      <span className="hidden sm:inline">{sending ? 'Mengirim...' : 'Kirim'}</span>
                    </button>
                  </div>
                </>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-white border border-[#e9edef] rounded-2xl p-8 h-full flex flex-col justify-center items-center text-center text-[#667781] text-xs shadow-xs">
                <MessageSquare size={44} className="mb-3 text-[#8696a0]" />
                <p className="font-bold text-[#111b21] text-sm">Pilih Percakapan</p>
                <p className="text-[#667781] max-w-sm mt-1">
                  Pilih salah satu percakapan dari daftar di sebelah kiri untuk melihat thread dan membalas langsung.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Customer Detail Modal */}
      {customerDetailModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-[#e9edef] rounded-2xl w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex justify-between items-center px-5 py-4 border-b border-[#e9edef] bg-[#f8fafc]">
              <div className="flex items-center space-x-3">
                <CustomerAvatar
                  src={customerDetailData?.profile_picture_url || selectedChat?.customerProfilePictureUrl}
                  name={customerDetailData?.name || selectedChat?.customerName}
                  phone={customerDetailData?.phone || selectedChat?.customerPhone}
                  size="md"
                />
                <div>
                  <h3 className="text-base font-bold text-[#111b21]">
                    {customerDetailData?.name || selectedChat?.customerName || 'Customer'}
                  </h3>
                  <p className="text-xs text-[#667781] font-mono">
                    {customerDetailData?.phone || selectedChat?.customerPhone || '-'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCustomerDetailModalOpen(false)}
                className="p-2 rounded-xl text-[#8696a0] hover:text-[#111b21] hover:bg-[#e9edef] transition text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-5 overflow-y-auto flex-1 text-xs text-[#111b21]">
              {customerDetailLoading ? (
                <div className="py-12 flex justify-center items-center">
                  <Loader size={24} className="animate-spin text-[#008069]" />
                </div>
              ) : (
                <>
                  {/* Quick Metric Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="p-3 bg-[#f8fafc] border border-[#e9edef] rounded-xl text-center space-y-1">
                      <p className="text-[10px] text-[#667781] font-semibold uppercase">Total Order</p>
                      <p className="text-base font-bold text-[#111b21]">{customerDetailData?.purchaseCount || customerDetailData?.reservations?.length || 0}x</p>
                    </div>
                    <div className="p-3 bg-[#f8fafc] border border-[#e9edef] rounded-xl text-center space-y-1">
                      <p className="text-[10px] text-[#667781] font-semibold uppercase">LTV (Value)</p>
                      <p className="text-base font-bold text-[#008069]">{formatRpShort(customerDetailData?.ltv || 0)}</p>
                    </div>
                    <div className="p-3 bg-[#f8fafc] border border-[#e9edef] rounded-xl text-center space-y-1">
                      <p className="text-[10px] text-[#667781] font-semibold uppercase">Segment</p>
                      <p className="text-xs font-bold text-[#111b21] truncate">
                        {customerDetailData?.is_legacy_source ? 'Legacy' : (customerDetailData?.purchaseCount > 0 ? 'Repeat' : 'New Customer')}
                      </p>
                    </div>
                    <a
                      href={`https://wa.me/${(customerDetailData?.phone || '').replace(/\D/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-3 bg-[#e8f5f2] hover:bg-[#c2e7e0] border border-[#c2e7e0] rounded-xl text-center space-y-1 transition flex flex-col items-center justify-center text-[#008069] font-bold shadow-2xs"
                    >
                      <Phone size={14} />
                      <span className="text-[10px]">Chat WA</span>
                    </a>
                  </div>

                  {/* Customer Labels Section */}
                  <div className="space-y-2">
                    <h4 className="font-bold text-[#667781] uppercase tracking-wider text-[11px] flex items-center space-x-1.5">
                      <Tag size={12} />
                      <span>Label Pasien</span>
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {(customerDetailData?.labels || []).length === 0 ? (
                        <p className="text-[#8696a0] italic">Belum ada label kustom.</p>
                      ) : (
                        customerDetailData.labels.map((cl: any) => {
                          const lbl = cl.label || cl;
                          return (
                            <span
                              key={lbl.id}
                              className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold text-white shadow-2xs"
                              style={{ backgroundColor: lbl.color || '#008069' }}
                              title={lbl.description ? `${lbl.name}: ${lbl.description}` : lbl.name}
                            >
                              {lbl.name}
                            </span>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Detail Alamat & Lokasi */}
                  <div className="space-y-2">
                    <h4 className="font-bold text-[#667781] uppercase tracking-wider text-[11px] flex items-center space-x-1.5">
                      <MapPin size={12} />
                      <span>Alamat & Lokasi</span>
                    </h4>
                    <div className="p-3 rounded-xl border border-[#e9edef] bg-[#f8fafc] space-y-2">
                      <div>
                        <p className="text-[10px] text-[#667781] font-semibold uppercase">Alamat / Kelurahan</p>
                        <p className="font-medium text-[#111b21]">{customerDetailData?.kelurahan || selectedChat?.kelurahan || customerDetailData?.address || customerDetailData?.preferences?.address || '-'}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#e9edef]">
                        <div>
                          <p className="text-[10px] text-[#667781] font-semibold uppercase">Kecamatan</p>
                          <p className="font-medium text-[#111b21]">{customerDetailData?.kecamatan || selectedChat?.kecamatan || '-'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-[#667781] font-semibold uppercase">Kota / Kabupaten</p>
                          <p className="font-medium text-[#111b21]">{customerDetailData?.kota || selectedChat?.kota || '-'}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#e9edef]">
                        <div>
                          <p className="text-[10px] text-[#667781] font-semibold uppercase">Jarak & Ongkir</p>
                          <p className="font-bold text-[#008069]">
                            {(customerDetailData?.distance_km != null ? customerDetailData.distance_km : selectedChat?.distanceKm != null ? selectedChat.distanceKm : null) != null
                              ? `${customerDetailData?.distance_km ?? selectedChat?.distanceKm} km`
                              : '-'} (Rp {Number(customerDetailData?.ongkir ?? selectedChat?.ongkir ?? 0).toLocaleString('id-ID')})
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-[#667781] font-semibold uppercase">Koordinat GPS</p>
                          {customerDetailData?.lat && customerDetailData?.lng ? (
                            <a
                              href={`https://maps.google.com/?q=${customerDetailData.lat},${customerDetailData.lng}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] font-bold text-sky-600 hover:underline flex items-center space-x-1"
                            >
                              <span>{Number(customerDetailData.lat).toFixed(4)}, {Number(customerDetailData.lng).toFixed(4)}</span>
                              <ExternalLink size={10} />
                            </a>
                          ) : (
                            <p className="text-[11px] text-[#8696a0] italic">Belum shareloc</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Children / Anak Data */}
                  <div className="space-y-2">
                    <h4 className="font-bold text-[#667781] uppercase tracking-wider text-[11px]">
                      Data Anak / Bayi ({customerDetailData?.children?.length || 0})
                    </h4>
                    {(customerDetailData?.children || []).length === 0 ? (
                      <p className="text-[#8696a0] italic">Belum ada data anak tercatat.</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {customerDetailData.children.map((ch: any) => (
                          <div key={ch.id} className="p-2.5 rounded-xl border border-[#e9edef] bg-white space-y-0.5">
                            <p className="font-bold text-[#111b21]">{ch.name || 'Anak'}</p>
                            <p className="text-[#667781] text-[11px]">
                              {ch.raw_age_text ? `Usia: ${ch.raw_age_text}` : ch.current_age ? `Usia: ${ch.current_age}` : ch.age_months ? `Usia: ${ch.age_months} bulan` : ch.birth_date ? `Lahir: ${new Date(ch.birth_date).toLocaleDateString('id-ID')}` : '-'}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Riwayat Reservasi */}
                  <div className="space-y-2">
                    <h4 className="font-bold text-[#667781] uppercase tracking-wider text-[11px] flex items-center space-x-1.5">
                      <Calendar size={12} />
                      <span>Riwayat Reservasi ({customerDetailData?.reservations?.length || 0})</span>
                    </h4>
                    {(customerDetailData?.reservations || []).length === 0 ? (
                      <p className="text-[#8696a0] italic">Belum pernah membuat reservasi.</p>
                    ) : (
                      <>
                        <div className="space-y-1.5 max-h-48 overflow-y-auto">
                          {customerDetailData.reservations.map((r: any) => (
                            <div
                              key={r.id}
                              onClick={() => handleOpenReservationDetail(r.id)}
                              className="p-2.5 rounded-xl border border-[#e9edef] bg-white flex justify-between items-center cursor-pointer hover:border-[#008069] hover:bg-[#f8fafc] active:scale-[0.98] transition group"
                              title="Klik untuk lihat detail reservasi"
                            >
                              <div className="flex-1 min-w-0">
                                <p className="font-bold text-[#111b21] group-hover:text-[#008069] truncate">{r.treatment_detail || r.raw_text || 'Layanan Homecare'}</p>
                                <p className="text-[11px] text-[#667781]">
                                  {r.booking_date ? new Date(r.booking_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : new Date(r.created_at).toLocaleDateString('id-ID')}
                                </p>
                                <p className="text-[10px] text-[#008069] font-semibold flex items-center space-x-1 mt-0.5">
                                  <User size={10} />
                                  <span>Bidan: {r.assigned_staff?.name || r.assigned_staff_name || 'Belum ditugaskan'}</span>
                                </p>
                              </div>
                              <div className="flex items-center space-x-1.5 shrink-0 ml-2">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleGenerateAndInsertInvoice(r);
                                  }}
                                  className="p-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 transition shadow-2xs group-hover:border-sky-300"
                                  title="Generate & Masukkan Format Invoice ke Box Chat WhatsApp"
                                >
                                  <Receipt size={13} />
                                </button>
                                <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                                  r.status === 'confirmed'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : r.status === 'pending'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-gray-100 text-gray-700'
                                }`}>
                                  {r.status}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                        <p className="text-[10px] text-[#8696a0] italic flex items-center space-x-1"><Eye size={10} /><span>Klik card untuk lihat detail lengkap</span></p>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-[#e9edef] bg-[#f8fafc] flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setCustomerDetailEditMode(true)}
                className="px-4 py-2 bg-[#e8f5f2] hover:bg-[#c2e7e0] text-[#008069] border border-[#c2e7e0] text-xs font-bold rounded-xl transition shadow-xs flex items-center space-x-1.5"
              >
                <PenLine size={14} />
                <span>Edit Profil</span>
              </button>
              <button
                type="button"
                onClick={() => setCustomerDetailModalOpen(false)}
                className="px-4 py-2 bg-[#111b21] hover:bg-black text-white text-xs font-bold rounded-xl transition shadow-xs"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Profil Modal - terpisah, placement seperti ReservationDetailModal (tidak nested, full overlay) */}
      {customerDetailEditMode && (
        <CustomerEditForm
          customer={{
            id: customerDetailData?.id || selectedChat?.customerId || '',
            name: customerDetailData?.name || selectedChat?.customerName || null,
            phone: customerDetailData?.phone || selectedChat?.customerPhone || '',
            kelurahan: customerDetailData?.kelurahan || null,
            kecamatan: customerDetailData?.kecamatan || null,
            kota: customerDetailData?.kota || null,
            zipcode: customerDetailData?.zipcode || null,
            landmark: customerDetailData?.preferences?.landmark || customerDetailData?.preferences?.address_notes || null,
            lat: customerDetailData?.lat ?? null,
            lng: customerDetailData?.lng ?? null,
            preferences: customerDetailData?.preferences,
          }}
          onSave={handleSaveCustomerDetail}
          onCancel={() => setCustomerDetailEditMode(false)}
          loading={customerDetailLoading}
        />
      )}

      {/* Reservation Detail Modal dari riwayat (klik card) */}
      {selectedReservation && (
        <ReservationDetailModal
          reservation={selectedReservation}
          staffList={reservationStaffList}
          user={user}
          googleCalendarMockActive={false}
          onClose={() => setSelectedReservation(null)}
          onUpdate={handleReservationUpdate}
          onConfirm={async (id) => { await apiRequest(`/api/admin/reservation/${id}/confirm`, { method: 'PATCH' }); await handleReservationUpdate(); }}
          onComplete={async (id) => { await apiRequest(`/api/admin/reservation/${id}/complete`, { method: 'PATCH' }); await handleReservationUpdate(); }}
          onStatusChange={async (id, s) => { await apiRequest(`/api/admin/reservation/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: s }) }); await handleReservationUpdate(); }}
          onSetDate={async (id, d) => { await apiRequest(`/api/admin/reservation/${id}/set-date`, { method: 'PATCH', body: JSON.stringify({ bookingDate: new Date(d).toISOString() }) }); await handleReservationUpdate(); }}
          onAssignStaff={async (id, sid) => { await apiRequest(`/api/admin/reservation/${id}/assign-staff`, { method: 'PATCH', body: JSON.stringify({ assigned_staff_id: sid }) }); await handleReservationUpdate(); }}
          onDelete={async (id) => { await apiRequest(`/api/admin/reservation/${id}`, { method: 'DELETE' }); setSelectedReservation(null); await handleReservationUpdate(); }}
          onProofUpload={async (file) => {
            const toB64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('read fail')); r.readAsDataURL(f); });
            const b64 = await toB64(file);
            await apiRequest(`/api/admin/reservation/${selectedReservation.id}/proof`, { method: 'PUT', body: JSON.stringify({ imageB64: b64, mimeType: file.type, fileName: file.name }) });
            await handleReservationUpdate();
          }}
          onProofRemove={async () => { await apiRequest(`/api/admin/reservation/${selectedReservation.id}/proof`, { method: 'PUT', body: JSON.stringify({ remove: true }) }); await handleReservationUpdate(); }}
          onOpenEditLocation={() => toast('Edit lokasi via menu Reservations untuk akses penuh.', 'info')}
          onProofView={(r) => window.open(r.proof_url!, '_blank')}
          onHousePhotoView={(url) => window.open(url, '_blank')}
        />
      )}

      {/* Quick Create Reservation Modal dari Live Chat */}
      {showQuickBookingModal && (
        <CreateReservationModal
          isOpen={showQuickBookingModal}
          onClose={() => setShowQuickBookingModal(false)}
          staffList={reservationStaffList}
          initialCustomer={customerDetailData || (selectedChat?.customerId ? {
            id: selectedChat.customerId,
            name: selectedChat.customerName,
            phone: selectedChat.customerPhone,
            kelurahan: (selectedChat as any).kelurahan || null,
            kecamatan: (selectedChat as any).kecamatan || null,
            kota: (selectedChat as any).kota || null,
            children: (selectedChat as any).children || [],
            ongkir: (selectedChat as any).ongkir ?? 0,
            distance_km: (selectedChat as any).distanceKm ?? (selectedChat as any).distance_km ?? null,
          } : null)}
          initialCustomerId={selectedChat?.customerId}
          onSuccess={async (newRes) => {
            setShowQuickBookingModal(false);
            await handleReservationUpdate();
            if (newRes) {
              handleGenerateAndInsertInvoice(newRes);
            }
          }}
        />
      )}

      {/* Draft Preview & Invoice Generator Modal */}
      {showInvoiceModal && invoiceModalData && (
        <InvoiceGeneratorModal
          isOpen={showInvoiceModal}
          onClose={() => setShowInvoiceModal(false)}
          initialData={invoiceModalData}
          clinicServices={clinicServices}
          onInsertToChat={handleInsertInvoiceToChat}
        />
      )}

      {/* Context Menu Modal with Full Screen Backdrop (Prevents Tap-Through) */}
      {contextMenu && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-2xs animate-in fade-in duration-150"
          onClick={() => setContextMenu(null)}
        >
          {/* Mobile Bottom Action Sheet (sm:hidden) */}
          <div
            className="sm:hidden w-full bg-white rounded-t-2xl shadow-2xl p-4 space-y-3 animate-in slide-in-from-bottom duration-200 border-t border-[#e9edef]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Grab Handle */}
            <div className="w-10 h-1 bg-[#d1d7db] rounded-full mx-auto" />

            {/* Header info */}
            <div className="flex items-center space-x-3 pb-2 border-b border-[#f0f2f5]">
              <CustomerAvatar
                src={contextMenu.chat.customerProfilePictureUrl}
                name={contextMenu.chat.customerName || 'Customer'}
                phone={contextMenu.chat.customerPhone}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-[#111b21] truncate">
                  {contextMenu.chat.customerName || 'Customer'}
                </p>
                <p className="text-[11px] text-[#667781] font-mono">
                  {contextMenu.chat.customerPhone || 'Unknown'}
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => handleTogglePin(contextMenu.chat)}
                className="w-full px-3.5 py-3 text-left rounded-xl bg-[#f8fafc] hover:bg-[#f0f2f5] active:bg-[#e9edef] flex items-center space-x-3 transition font-medium text-xs text-[#111b21] cursor-pointer"
              >
                <Pin size={16} className={contextMenu.chat.isPinned ? 'text-[#008069] fill-current' : 'text-[#54656f]'} />
                <span>{contextMenu.chat.isPinned ? 'Lepas Sematan (Unpin dari Atas)' : 'Sematkan Percakapan (Pin ke Atas)'}</span>
              </button>

              <button
                type="button"
                onClick={() => handleToggleReadStatus(contextMenu.chat)}
                className="w-full px-3.5 py-3 text-left rounded-xl bg-[#f8fafc] hover:bg-[#f0f2f5] active:bg-[#e9edef] flex items-center space-x-3 transition font-medium text-xs text-[#111b21] cursor-pointer"
              >
                {(contextMenu.chat.unreadCount || 0) > 0 || contextMenu.chat.isManualUnread ? (
                  <>
                    <MailCheck size={16} className="text-emerald-600" />
                    <span>Tandai Sudah Dibaca</span>
                  </>
                ) : (
                  <>
                    <Mail size={16} className="text-[#005c4b]" />
                    <span>Tandai Belum Dibaca (Badge Hijau Tua)</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  const c = contextMenu.chat;
                  setContextMenu(null);
                  if (c.isHumanHandling) {
                    handleRelease(c);
                  } else {
                    handleTakeover(c);
                  }
                }}
                className="w-full px-3.5 py-3 text-left rounded-xl bg-[#f8fafc] hover:bg-[#f0f2f5] active:bg-[#e9edef] flex items-center space-x-3 transition font-medium text-xs text-[#54656f] cursor-pointer"
              >
                {contextMenu.chat.isHumanHandling ? (
                  <>
                    <Bot size={16} />
                    <span>Kembalikan ke Bot AI</span>
                  </>
                ) : (
                  <>
                    <User size={16} className="text-amber-600" />
                    <span>Ambil Alih Manual (CS)</span>
                  </>
                )}
              </button>
            </div>

            {/* Cancel Button */}
            <button
              type="button"
              onClick={() => setContextMenu(null)}
              className="w-full py-3 bg-[#f0f2f5] active:bg-[#e9edef] text-[#111b21] font-bold text-xs rounded-xl transition cursor-pointer"
            >
              Batal
            </button>
          </div>

          {/* Desktop Floating Popover (hidden sm:block) */}
          <div
            className="hidden sm:block bg-white border border-[#d1d7db] rounded-xl shadow-2xl py-1.5 w-64 text-xs text-[#111b21] animate-in fade-in zoom-in-95 duration-100 divide-y divide-[#f0f2f5]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3.5 py-2 text-[11px] font-bold text-[#667781] truncate">
              {contextMenu.chat.customerName || contextMenu.chat.customerPhone || 'Opsi Percakapan'}
            </div>
            <div className="py-1">
              <button
                type="button"
                onClick={() => handleTogglePin(contextMenu.chat)}
                className="w-full px-3.5 py-2.5 text-left hover:bg-[#f5f6f6] flex items-center space-x-2.5 transition font-medium cursor-pointer"
              >
                <Pin size={14} className={contextMenu.chat.isPinned ? 'text-[#008069] fill-current' : 'text-[#54656f]'} />
                <span>{contextMenu.chat.isPinned ? 'Lepas Sematan (Unpin)' : 'Sematkan Chat (Pin ke Atas)'}</span>
              </button>
              <button
                type="button"
                onClick={() => handleToggleReadStatus(contextMenu.chat)}
                className="w-full px-3.5 py-2.5 text-left hover:bg-[#f5f6f6] flex items-center space-x-2.5 transition font-medium cursor-pointer"
              >
                {(contextMenu.chat.unreadCount || 0) > 0 || contextMenu.chat.isManualUnread ? (
                  <>
                    <MailCheck size={14} className="text-emerald-600" />
                    <span>Tandai Sudah Dibaca</span>
                  </>
                ) : (
                  <>
                    <Mail size={14} className="text-[#005c4b]" />
                    <span>Tandai Belum Dibaca (Hijau Tua)</span>
                  </>
                )}
              </button>
            </div>
            <div className="py-1">
              <button
                type="button"
                onClick={() => {
                  const c = contextMenu.chat;
                  setContextMenu(null);
                  if (c.isHumanHandling) {
                    handleRelease(c);
                  } else {
                    handleTakeover(c);
                  }
                }}
                className="w-full px-3.5 py-2.5 text-left hover:bg-[#f5f6f6] flex items-center space-x-2.5 transition text-[#54656f] font-medium cursor-pointer"
              >
                {contextMenu.chat.isHumanHandling ? (
                  <>
                    <Bot size={14} />
                    <span>Kembalikan ke Bot AI</span>
                  </>
                ) : (
                  <>
                    <User size={14} className="text-amber-600" />
                    <span>Ambil Alih Manual (CS)</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Message Modal */}
      {editingMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
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
                      <Check size={14} />
                      <span>Simpan Perubahan</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 📋 Modal Informasi & Konfirmasi Sinkronisasi WhatsApp */}
      {showSyncInfoModal && (
        <div className="fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center p-4 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-[#e9edef] space-y-4 animate-scaleUp">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-[#f0f2f5]">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 rounded-xl bg-[#e8f5f2] text-[#008069]">
                  <RefreshCw size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#111b21]">Sinkronisasi WhatsApp</h3>
                  <p className="text-[11px] text-[#667781]">Penyelarasan Riwayat Chat di Background</p>
                </div>
              </div>
              <button
                onClick={() => setShowSyncInfoModal(false)}
                className="p-1 text-[#8696a0] hover:text-[#111b21] rounded-lg hover:bg-[#f0f2f5] transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Konten Penjelasan */}
            <div className="space-y-3 text-xs text-[#54656f]">
              {/* Apa yang dilakukan */}
              <div className="p-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl space-y-1">
                <p className="font-bold text-[#111b21] flex items-center space-x-1.5">
                  <span>⚙️</span>
                  <span>Apa yang dilakukan?</span>
                </p>
                <p className="leading-relaxed text-[11px]">
                  Sistem akan menarik dan menyelaraskan seluruh percakapan dari server WhatsApp (WAHA) langsung ke database bot secara otomatis tanpa mengganggu chat yang sedang aktif.
                </p>
              </div>

              {/* Data yang disinkronkan */}
              <div className="space-y-1.5">
                <p className="font-bold text-[#111b21] flex items-center space-x-1.5">
                  <span>📥</span>
                  <span>Data yang disinkronkan (Scrape):</span>
                </p>
                <ul className="space-y-1 text-[11px] pl-1">
                  <li className="flex items-start space-x-2">
                    <span className="text-[#008069] font-bold">✓</span>
                    <span><strong>Daftar Kontak & Customer:</strong> Deteksi nomor baru dan update nama pelanggan.</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <span className="text-[#008069] font-bold">✓</span>
                    <span><strong>Riwayat Percakapan:</strong> Pesan teks, lampiran media (foto/gambar), dan status kirim/baca.</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <span className="text-[#008069] font-bold">✓</span>
                    <span><strong>Foto Profil WhatsApp:</strong> Cache foto profil customer untuk notifikasi mobile & avatar.</span>
                  </li>
                </ul>
              </div>

              {/* Estimasi Waktu */}
              <div className="p-2.5 bg-amber-50 border border-amber-200/80 rounded-xl space-y-1 text-amber-900">
                <p className="font-bold flex items-center space-x-1.5 text-[11px]">
                  <span>⏱️</span>
                  <span>Estimasi Waktu Bekerja di Background:</span>
                </p>
                <p className="text-[11px] leading-relaxed text-amber-800">
                  Estimasi <strong>~1 - 3 menit</strong> (tergantung banyaknya riwayat chat WhatsApp). Anda dapat tetap menggunakan dashboard dan membuka percakapan seperti biasa tanpa menunggu.
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-[#f0f2f5]">
              <button
                type="button"
                onClick={() => setShowSyncInfoModal(false)}
                className="px-3.5 py-1.5 text-xs font-semibold text-[#54656f] hover:text-[#111b21] hover:bg-[#f0f2f5] rounded-xl transition cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowSyncInfoModal(false);
                  handleStartBackgroundFullSync();
                }}
                className="px-4 py-1.5 text-xs font-bold text-white bg-[#008069] hover:bg-[#00a884] rounded-xl shadow-xs transition flex items-center space-x-1.5 cursor-pointer"
              >
                <RefreshCw size={12} />
                <span>Mulai Sinkronisasi Sekarang</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

