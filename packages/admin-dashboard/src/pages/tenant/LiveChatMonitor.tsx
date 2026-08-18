import React, { useEffect, useRef, useState } from 'react';
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
  Tag,
  Plus,
  Check,
  Sparkles,
  ExternalLink,
  Calendar,
  FileText,
  Phone,
  Pin,
  Mail,
  MailCheck,
  MoreVertical,
} from 'lucide-react';
import { MediaImage, ChatMediaData } from '../../components/common/MediaImage';
import { CustomerAvatar } from '../../components/common/CustomerAvatar';

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

export const LiveChatMonitor: React.FC = () => {
  const { toast, confirm } = useUiFeedback();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [chats, setChats] = useState<LiveChatItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [customerDetailModalOpen, setCustomerDetailModalOpen] = useState(false);
  const [customerDetailLoading, setCustomerDetailLoading] = useState(false);
  const [customerDetailData, setCustomerDetailData] = useState<any>(null);
  const [selectedImage, setSelectedImage] = useState<{ file: File; preview: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [releasingId, setReleasingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [labelFilter, setLabelFilter] = useState<'all' | 'medical_concern' | 'unresolved_faq' | 'human_request'>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'real' | 'sandbox'>('real');
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; chat: LiveChatItem } | null>(null);
  const longPressTimerRef = useRef<any>(null);
  const longPressTriggeredRef = useRef(false);
  const longPressTouchRef = useRef<{ x: number; y: number } | null>(null);
  const detailTouchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const handleBackToList = () => {
    setMobileView('list');
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
  const [gatewayCapability, setGatewayCapability] = useState<{ provider: string; supportsRevoke: boolean } | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const chatsRef = useRef<LiveChatItem[]>([]);
  const selectedIdRef = useRef<string | null>(null);
  const chatListContainerRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);
  const firstRenderRef = useRef(true);

  const [allLabels, setAllLabels] = useState<CustomerLabelData[]>([]);
  const [labelPopoverOpen, setLabelPopoverOpen] = useState(false);
  const [togglingLabelId, setTogglingLabelId] = useState<string | null>(null);
  const labelPopoverRef = useRef<HTMLDivElement>(null);

  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const toolsMenuRef = useRef<HTMLDivElement>(null);

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

  // Close label popover and tools menu on outside click
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      if (labelPopoverRef.current && !labelPopoverRef.current.contains(e.target as Node)) {
        setLabelPopoverOpen(false);
      }
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target as Node)) {
        setToolsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleDocumentClick);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
    };
  }, []);

  const resetTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '38px';
    }
  };

  const handleReplyTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setReplyText(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const nextHeight = Math.min(textareaRef.current.scrollHeight, 220);
      textareaRef.current.style.height = `${Math.max(nextHeight, 38)}px`;
    }
  };

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // Load gateway capability & available customer labels on mount
  useEffect(() => {
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

  const loadChats = async (reset = false) => {
    if (reset) setLoading(true);
    if (loadingMoreRef.current && !reset) return;
    if (reset) {
      loadingMoreRef.current = true;
    } else {
      loadingMoreRef.current = true;
      setLoadingMore(true);
    }
    try {
      const offset = reset ? 0 : chatsRef.current.length;
      const res = await apiRequest(`/api/admin/live-chat/conversations?limit=50&offset=${offset}&mode=${sourceFilter}`);
      const data = Array.isArray(res) ? res : (res?.data || []);
      const nextHasMore = typeof res?.hasMore === 'boolean' ? res.hasMore : data.length === 50;
      if (reset) {
        setChats(data);
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
        setChats(merged);
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
      if (reset) setLoading(false);
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

  const loadThread = async (conversationId: string) => {    try {
      const res = await apiRequest(`/api/admin/live-chat/conversations/${conversationId}/messages`);
      const list: ChatMessage[] = Array.isArray(res) ? res : (res?.data || []);
      setMessages(list.map((m) => ({ ...m, media: extractMedia(m) })));
    } catch (err: any) {
      console.error('Failed to load conversation thread:', err);
      setMessages([]);
    }
  };

  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');

  const scrollToBottom = (smooth = false) => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
  };

  useEffect(() => {
    // Auto scroll down to latest message when messages change or new chat opened
    scrollToBottom(false);
  }, [messages, selectedId]);

  const sortChats = (list: LiveChatItem[]): LiveChatItem[] => {
    return [...list].sort((a, b) => {
      if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
      if (!!a.isHumanHandling !== !!b.isHumanHandling) return a.isHumanHandling ? -1 : 1;
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
    // Push history state untuk tombol Back hardware/browser mobile
    if (window.history.state?.liveChatView !== 'chat') {
      window.history.pushState({ liveChatView: 'chat' }, '');
    }
    resetTextareaHeight();
    loadThread(conversationId);

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

  // Popstate listener untuk navigasi Back hardware di mobile (kembali ke list)
  useEffect(() => {
    const handlePopState = () => {
      if (mobileView === 'chat') {
        setMobileView('list');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [mobileView]);

  // SSE real-time: message.created & conversation.updated
  useEffect(() => {
    loadChats(true);

    const unsubscribe = connectLiveChatSse({
      onStatusChange: (connected) => setSseConnected(connected),
      onEvent: (type, payload) => {
        if (type === 'conversation.updated' && payload?.allRead) {
          setChats((prev) =>
            prev.map((c) => ({
              ...c,
              unreadCount: 0,
              isManualUnread: false,
            }))
          );
          return;
        }

        if (type === 'message.created') {
          const conversationId = payload.conversationId;
          const msg: ChatMessage = {
            id: payload.messageId || `sse_${Date.now()}`,
            direction: payload.direction,
            content: payload.content || '',
            sender_type: payload.senderType || payload.sender_type || null,
            sender_name: payload.senderName || payload.sender_name || null,
            created_at: payload.createdAt || payload.created_at || new Date().toISOString(),
            media: extractMedia(payload),
          };

          // Append ke thread yang sedang dibuka (hindari duplikat by id / timestamp & content dalam rentang 30 detik)
          if (selectedIdRef.current === conversationId) {
            setMessages((prev) =>
              prev.some(
                (m) =>
                  m.id === msg.id ||
                  (m.content === msg.content &&
                    m.direction === msg.direction &&
                    Math.abs(new Date(m.created_at).getTime() - new Date(msg.created_at).getTime()) < 30000)
              )
                ? prev
                : [...prev, msg]
            );
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
                    lastMessageAt: payload.createdAt || payload.created_at || c.lastMessageAt,
                    lastMessages: [...(c.lastMessages || []), msg].slice(-3),
                    unreadCount: nextUnread,
                    isAwaitingReply: isCurrentOpen && isMsgInbound,
                    isManualUnread: false,
                  }
            );
            const sorted = sortChats(updated);
            setChats(sorted);
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
          setChats(sorted);
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

    return () => unsubscribe();
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
      loadChats(true);
      if (selectedId === chat.conversationId) {
        setSelectedId(null);
        setMessages([]);
      }
      toast('Percakapan berhasil dikembalikan ke bot.', 'success');
    } catch (err: any) {
      toast(`Gagal merilis percakapan ke bot: ${err.message}`, 'error');
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
        setReplyText(res.data.draftText);
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            const nextHeight = Math.min(textareaRef.current.scrollHeight, 220);
            textareaRef.current.style.height = `${Math.max(nextHeight, 38)}px`;
          }
        }, 50);
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

  const handleSendReply = async () => {
    const image = selectedImage;
    if (!selectedId || (!replyText.trim() && !image)) return;
    setSending(true);
    try {
      const body: Record<string, any> = {
        adminName: user?.email || 'Admin',
      };
      if (replyText.trim()) body.text = replyText.trim();
      if (image) {
        const imageB64 = await fileToDataUrl(image.file);
        const thumbB64 = await makeThumbnail(imageB64);
        body.imageB64 = imageB64;
        body.thumbB64 = thumbB64;
        body.mimeType = image.file.type || 'image/jpeg';
        body.fileName = image.file.name;
      }
      await apiRequest(`/api/admin/live-chat/conversations/${selectedId}/reply`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setReplyText('');
      resetTextareaHeight();
      setSelectedImage(null);
      toast('Balasan admin terkirim.', 'success');
    } catch (err: any) {
      toast(`Gagal mengirim balasan: ${err.message}`, 'error');
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

  const filteredChats = chats.filter(
    (chat) => labelFilter === 'all' || getChatLabel(chat) === labelFilter
  );

  const getElapsedTime = (sinceStr: string | null) => {
    if (!sinceStr) return '';
    return formatLastChat(sinceStr);
  };

  const formatLastChat = (dateStr: string | null) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const diffMins = Math.floor((Date.now() - date.getTime()) / 60000);

    if (diffMins < 1) return 'Baru saja';
    if (diffMins < 60) return `${diffMins} menit lalu`;
    if (diffMins < 6 * 60) return `${Math.floor(diffMins / 60)} jam lalu`;
    if (diffMins < 24 * 60) return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    if (diffMins < 7 * 24 * 60) return `${Math.floor(diffMins / (24 * 60))} hari yang lalu`;
    return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
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
    <div className="h-full flex flex-col min-h-0 space-y-1 sm:space-y-1.5">
      {/* Top Header */}
      <div className={`${mobileView === 'chat' ? 'hidden lg:flex' : 'flex'} justify-between items-center bg-white border border-[#e9edef] rounded-xl px-2.5 sm:px-3 py-1 sm:py-1.5 shadow-xs shrink-0`}>
        <div className="flex items-center space-x-2.5">
          <h1 className="text-sm sm:text-base font-bold text-[#111b21] tracking-tight flex items-center space-x-1.5">
            <MessageSquare className="text-[#008069]" size={18} />
            <span>Live Chat Monitor</span>
          </h1>
          {/* Real-time Status Icon Indicator */}
          <div
            className="flex items-center space-x-1 px-2 py-0.5 bg-[#f0f2f5] border border-[#e9edef] rounded-full text-[10px] font-semibold text-[#54656f]"
            title={sseConnected ? 'Status: Real-time Terhubung (SSE Aktif)' : 'Status: Menyambungkan kembali ke server...'}
          >
            <span className={`h-2 w-2 rounded-full ${sseConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500 animate-pulse'}`} />
            <span>{sseConnected ? 'Live' : 'Reconnecting'}</span>
          </div>
        </div>

        {/* Sync Controls */}
        <div className="flex items-center space-x-1.5">
          {/* Background Full Sync Button */}
          <button
            onClick={handleStartBackgroundFullSync}
            disabled={bgSyncProgress.isSyncing}
            className="px-2.5 py-1 rounded-lg bg-[#008069] hover:bg-[#00a884] text-white text-[11px] font-bold shadow-2xs transition flex items-center space-x-1 disabled:opacity-50 cursor-pointer"
            title="Ambil seluruh riwayat chat WhatsApp di latar belakang (tanpa batas waktu)"
          >
            <RefreshCw size={12} className={bgSyncProgress.isSyncing ? 'animate-spin' : ''} />
            <span>{bgSyncProgress.isSyncing ? 'Sync Background...' : 'Sync Semua (Background)'}</span>
          </button>
        </div>
      </div>

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

      {loading ? (
        <div className="flex-1 flex justify-center items-center py-20">
          <Loader className="animate-spin text-[#008069]" size={32} />
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-2.5 overflow-hidden">
          {/* Section 1: Conversations List */}
          <div className={`${mobileView === 'chat' ? 'hidden lg:flex' : 'flex'} w-full lg:w-[320px] xl:w-[360px] lg:shrink-0 flex-col h-full bg-white border border-[#e9edef] rounded-xl sm:rounded-2xl p-1.5 sm:p-2.5 shadow-xs overflow-hidden min-h-0`}>
            {/* Header Toolbar Daftar Percakapan: Source Filter & Label Dropdown */}
            <div className="space-y-1.5 pb-2 border-b border-[#f0f2f5] shrink-0">
              <div className="flex justify-between items-center gap-1.5">
                <span className="text-[11px] font-bold text-[#667781] uppercase tracking-wider">
                  Percakapan ({filteredChats.length})
                </span>

                {/* Filter sumber percakapan: WhatsApp Asli vs Sandbox (Khusus Daftar Chat) */}
                <div className="flex items-center space-x-0.5 p-0.5 bg-[#f0f2f5] border border-[#e9edef] rounded-lg">
                  {(
                    [
                      { value: 'real', label: 'WhatsApp Asli' },
                      { value: 'all', label: 'Semua' },
                      { value: 'sandbox', label: 'Sandbox' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setSourceFilter(opt.value)}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition flex items-center space-x-1 cursor-pointer ${
                        sourceFilter === opt.value
                          ? opt.value === 'sandbox'
                            ? 'bg-purple-100 text-purple-800 border border-purple-200 shadow-2xs'
                            : opt.value === 'real'
                              ? 'bg-[#e8f5f2] text-[#008069] border border-[#c2e7e0] shadow-2xs'
                              : 'bg-[#111b21] text-white shadow-2xs'
                          : 'text-[#667781] hover:text-[#111b21]'
                      }`}
                    >
                      {opt.value === 'sandbox' && <FlaskConical size={10} />}
                      {opt.value === 'real' && <CheckCircle size={10} />}
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Label Filter Dropdown & Mark All Read */}
              <div className="flex items-center space-x-1.5">
                <select
                  value={labelFilter}
                  onChange={(e) => setLabelFilter(e.target.value as typeof labelFilter)}
                  className="flex-1 px-2 py-1 bg-white border border-[#d1d7db] rounded-lg text-[11px] font-semibold text-[#111b21] focus:outline-none focus:border-[#008069] cursor-pointer shadow-2xs"
                >
                  <option value="all">Semua Label Pasien</option>
                  <option value="human_request">Human Request</option>
                  <option value="medical_concern">Medical Emergency</option>
                  <option value="unresolved_faq">Unresolved FAQ</option>
                </select>

                <button
                  type="button"
                  onClick={handleMarkAllAsRead}
                  title="Tandai semua percakapan sebagai telah dibaca"
                  className="px-2 py-1 bg-white hover:bg-[#e8f5f2] border border-[#d1d7db] hover:border-[#c2e7e0] text-[#54656f] hover:text-[#008069] rounded-lg text-[11px] font-semibold transition flex items-center space-x-1 shrink-0 cursor-pointer shadow-2xs active:scale-95"
                >
                  <MailCheck size={13} className="text-[#008069]" />
                  <span className="hidden sm:inline">Tandai Dibaca</span>
                </button>
              </div>
            </div>

            {filteredChats.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-[#667781] text-xs">
                <CheckCircle className="mx-auto text-[#008069] mb-2" size={24} />
                <p className="font-bold text-[#111b21]">
                  {chats.length === 0 ? 'Belum ada percakapan' : 'Tidak ada percakapan'}
                </p>
                <p className="text-[#667781] text-[10px] mt-0.5">
                  {chats.length === 0
                    ? 'Percakapan baru akan muncul secara real-time.'
                    : 'Ganti filter sumber atau label untuk melihat lainnya.'}
                </p>
              </div>
            ) : (
              <div
                ref={chatListContainerRef}
                className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-1.5 pr-1 mt-1.5"
                style={{ overscrollBehavior: 'contain' }}
              >
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
                      className={`bg-white rounded-xl p-2 border transition cursor-pointer text-left flex flex-col justify-between space-y-1.5 shadow-2xs relative select-none touch-manipulation ${
                        isSelected
                          ? 'border-[#008069] bg-[#e8f5f2] ring-1 ring-[#008069]'
                          : isMedical
                            ? 'border-rose-300 bg-rose-50/40 hover:bg-rose-50/70'
                            : 'border-[#e9edef] hover:border-[#c2e7e0] hover:bg-[#f8fafc]'
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

                        {/* Right Column: Bot / Release Icon Button + Unread / Awaiting Badge (Di Bawah Icon) */}
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
                            <span
                              title="Ditangani Bot AI"
                              className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-[#f0f2f5] text-[#667781] border border-[#e9edef]"
                            >
                              <Bot size={12} />
                            </span>
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

          {/* Section 2: Right Panel - Live Chat Messages */}
          <div
            onTouchStart={handleDetailTouchStart}
            onTouchMove={handleDetailTouchMove}
            onTouchEnd={handleDetailTouchEnd}
            onTouchCancel={() => { detailTouchStartRef.current = null; }}
            className={`${mobileView === 'list' ? 'hidden lg:flex' : 'flex'} flex-1 min-w-0 h-full min-h-0 flex-col`}
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

                    {/* Bot Release Button in Chat Header (Icon-based) */}
                    <div className="shrink-0">
                      {selectedChat.isHumanHandling ? (
                        <button
                          onClick={() => handleRelease(selectedChat)}
                          disabled={releasingId === selectedChat.conversationId}
                          title="Kembalikan percakapan ke Bot AI"
                          className="px-3 py-1.5 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50"
                        >
                          <Bot size={14} />
                          <span className="hidden sm:inline">Kembalikan ke Bot</span>
                        </button>
                      ) : (
                        <span
                          title="Ditangani Bot AI"
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#f0f2f5] text-[#54656f] border border-[#e9edef] rounded-xl text-xs font-semibold uppercase tracking-wider"
                        >
                          <Bot size={13} />
                          <span>Bot</span>
                        </span>
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
                  {messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center text-[#667781] text-xs">
                      <MessageCircle size={32} className="mb-2 text-[#8696a0]" />
                      <p>Belum ada pesan di percakapan ini.</p>
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const isCustomer = msg.direction === 'INBOUND';
                      const senderTypeUpper = (msg.sender_type || '').toUpperCase();
                      const isAdmin = msg.direction === 'OUTBOUND' && (senderTypeUpper === 'ADMIN' || senderTypeUpper === 'HUMAN' || senderTypeUpper === 'STAFF');
                      const isRevoked = msg.content === '🚫 Pesan ini telah ditarik' || (msg as any).is_revoked || (msg as any).payload_raw?.is_revoked;
                      const canRevoke = !isCustomer && !isRevoked && !!gatewayCapability?.supportsRevoke;

                      return (
                        <div key={msg.id} className={`flex ${isCustomer ? 'justify-start' : 'justify-end'}`}>
                          <div className={`max-w-[88%] sm:max-w-[75%] md:max-w-[70%] rounded-lg px-2.5 sm:px-3 py-1.5 text-xs leading-relaxed shadow-2xs ${
                            isCustomer
                              ? 'bg-white text-[#111b21] rounded-tl-none border border-black/5'
                              : isAdmin
                                ? 'bg-[#d9fdd3] text-[#111b21] rounded-tr-none border border-[#00a884]/20'
                                : 'bg-white text-[#111b21] rounded-tr-none border-l-4 border-[#008069]'
                          }`}>
                            <span className={`block text-[10px] font-bold mb-0.5 flex items-center space-x-1 ${
                              isCustomer ? 'text-[#667781]' : isAdmin ? 'text-[#008069]' : 'text-[#008069]'
                            }`}>
                              {!isCustomer && !isAdmin && <Bot size={10} />}
                              <span>{senderLabel(msg)}</span>
                            </span>
                            {msg.media && (
                              <div className="mb-1.5">
                                <MediaImage
                                  src={msg.media.url || msg.media.hdUrl}
                                  downloadSrc={msg.media.hdUrl}
                                  caption={msg.media.caption || undefined}
                                  blur={isCustomer}
                                />
                              </div>
                            )}
                            {msg.content && !/^\[(IMAGE|MEDIA|LOCATION)/.test(msg.content) && (
                              <p className={`font-sans whitespace-pre-wrap ${isRevoked ? 'italic text-[#667781]' : ''}`}>{msg.content}</p>
                            )}
                            <div className="flex items-center justify-end space-x-1.5 mt-0.5 text-right select-none text-[10px] text-[#667781]">
                              <span>
                                {msg.created_at ? new Date(msg.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace(':', '.') : ''}
                              </span>
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
                          </div>
                        </div>
                      );
                    })
                  )}
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
                  {selectedImage && (
                    <div className="relative inline-block mb-2">
                      <img
                        src={selectedImage.preview}
                        alt="Preview"
                        className="w-20 h-16 object-cover rounded-xl border border-[#d1d7db]"
                      />
                      <button
                        onClick={() => {
                          setSelectedImage(null);
                        }}
                        className="absolute -top-1.5 -right-1.5 p-1 rounded-full bg-rose-500 text-white shadow-xs hover:bg-rose-600 transition"
                        title="Hapus lampiran"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  )}
                  <div className="flex items-end space-x-1 sm:space-x-1.5 md:space-x-2 bg-[#f0f2f5] p-1 sm:p-1.5 md:p-2 rounded-xl border border-[#e9edef] w-full">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handlePickImage}
                      className="hidden"
                    />

                    {/* Tools Button with Dropdown Menu (AI Copilot + Lampirkan Gambar) */}
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

                          {/* Option 2: Image Attachment */}
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

                    <textarea
                      ref={textareaRef}
                      value={replyText}
                      onChange={handleReplyTextChange}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          handleSendReply();
                        }
                      }}
                      rows={1}
                      placeholder="Tulis balasan... (Enter baris baru, klik Kirim)"
                      className="flex-1 w-full min-w-0 resize-none rounded-xl bg-white border border-[#d1d7db] focus:border-[#008069] focus:ring-1 focus:ring-[#008069] focus:outline-none text-[16px] sm:text-sm text-[#111b21] placeholder-[#8696a0] py-2 px-2.5 sm:px-3 shadow-xs min-h-[38px] max-h-[220px] leading-relaxed"
                      style={{ fontSize: '16px' }}
                    />
                    <button
                      onClick={handleSendReply}
                      disabled={sending || (!replyText.trim() && !selectedImage)}
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
                              {ch.age_months ? `Usia: ${ch.age_months} bulan` : ch.birth_date ? `Lahir: ${new Date(ch.birth_date).toLocaleDateString('id-ID')}` : '-'}
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
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {customerDetailData.reservations.map((r: any) => (
                          <div key={r.id} className="p-2.5 rounded-xl border border-[#e9edef] bg-white flex justify-between items-center">
                            <div>
                              <p className="font-bold text-[#111b21]">{r.treatment_detail || r.raw_text || 'Layanan Homecare'}</p>
                              <p className="text-[11px] text-[#667781]">
                                {r.booking_date ? new Date(r.booking_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : new Date(r.created_at).toLocaleDateString('id-ID')}
                              </p>
                            </div>
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
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-[#e9edef] bg-[#f8fafc] flex justify-end">
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
                  handleRelease(c);
                }}
                className="w-full px-3.5 py-3 text-left rounded-xl bg-[#f8fafc] hover:bg-[#f0f2f5] active:bg-[#e9edef] flex items-center space-x-3 transition font-medium text-xs text-[#54656f] cursor-pointer"
              >
                <Bot size={16} />
                <span>{contextMenu.chat.isHumanHandling ? 'Kembalikan ke Bot AI' : 'Ambil Alih Manual (CS)'}</span>
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
                  handleRelease(c);
                }}
                className="w-full px-3.5 py-2.5 text-left hover:bg-[#f5f6f6] flex items-center space-x-2.5 transition text-[#54656f] font-medium cursor-pointer"
              >
                <Bot size={14} />
                <span>{contextMenu.chat.isHumanHandling ? 'Kembalikan ke Bot AI' : 'Ambil Alih Manual (CS)'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

