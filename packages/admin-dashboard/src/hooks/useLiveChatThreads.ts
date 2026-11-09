import { useState, useRef, useEffect, useCallback, useMemo, startTransition } from 'react';
import { apiRequest } from '../services/api';
import { shouldPreserveActiveChat } from '../utils/livechatSourceFilter';
import type { LiveChatItem, ChatMessage, CustomerLabelData } from '../types/livechat';

export interface UseLiveChatThreadsParams {
  selectedIdRef: React.MutableRefObject<string | null>;
  searchQuery: string;
  searchQueryRef: React.MutableRefObject<string>;
  labelFilter: string;
  labelFilterRef: React.MutableRefObject<string>;
  sourceFilter: string;
  sourceFilterRef: React.MutableRefObject<string>;
  reservationStaffFilter: string;
  reservationStaffFilterRef: React.MutableRefObject<string>;
  setErrorMessage: (msg: string | null) => void;
  confirm: (opts: any) => Promise<boolean>;
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export function useLiveChatThreads({
  selectedIdRef,
  searchQuery,
  searchQueryRef,
  labelFilter,
  labelFilterRef,
  sourceFilter,
  sourceFilterRef,
  reservationStaffFilter,
  reservationStaffFilterRef,
  setErrorMessage,
  confirm,
  toast,
}: UseLiveChatThreadsParams) {
  const [chats, setChats] = useState<LiveChatItem[]>([]);
  const chatsRef = useRef<LiveChatItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [totalUnreadCount, setTotalUnreadCount] = useState<number>(0);

  const [syncingHistory, setSyncingHistory] = useState(false);
  const [syncNextOffset, setSyncNextOffset] = useState<number | null>(null);
  const [syncProgress, setSyncProgress] = useState<string | null>(null);

  const listOffsetRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const loadChatsAbortControllerRef = useRef<AbortController | null>(null);
  const searchDebounceTimerRef = useRef<any>(null);
  const firstRenderRef = useRef(true);
  const labelFilterFirstRenderRef = useRef(true);
  const reservationStaffFilterFirstRenderRef = useRef(true);
  const unreadCountFetchTimerRef = useRef<any>(null);

  const sortChats = useCallback((list: LiveChatItem[]): LiveChatItem[] => {
    return [...list].sort((a, b) => {
      if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
      return new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime();
    });
  }, []);

  const loadChats = useCallback(async (reset = false, search = searchQueryRef.current, isSearchOperation = false) => {
    if (reset && loadChatsAbortControllerRef.current) {
      loadChatsAbortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    if (reset) {
      loadChatsAbortControllerRef.current = abortController;
    }

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
      const offset = reset ? 0 : listOffsetRef.current;
      const searchParam = search && search.trim() ? `&search=${encodeURIComponent(search.trim())}` : '';
      const labelParam = labelFilterRef.current !== 'all' ? `&label=${encodeURIComponent(labelFilterRef.current)}` : '';
      const backendMode = sourceFilterRef.current === 'sandbox' ? 'sandbox' : 'real';
      const activeSource = sourceFilterRef.current;
      const filterParam = activeSource === 'unread' || activeSource === 'reservation' ? `&filter=${activeSource}` : '';
      const staffParam =
        activeSource === 'reservation' && reservationStaffFilterRef.current !== 'all'
          ? `&staffId=${encodeURIComponent(reservationStaffFilterRef.current)}`
          : '';
      const res = await apiRequest(`/api/admin/live-chat/conversations?limit=50&offset=${offset}&mode=${backendMode}${searchParam}${labelParam}${filterParam}${staffParam}`, {
        signal: abortController.signal,
        timeoutMs: isSearchOperation ? 8000 : 10000,
      });
      const data = Array.isArray(res) ? res : (res?.data || []);
      const nextHasMore = typeof res?.hasMore === 'boolean' ? res.hasMore : data.length === 50;
      listOffsetRef.current = reset ? data.length : listOffsetRef.current + data.length;
      if (reset) {
        const isSearchActive = !!(search && search.trim());
        const rawActive = !isSearchActive ? chatsRef.current.find((c) => c.conversationId === selectedIdRef.current) : null;
        const canPreserveActive = activeSource === 'all' || activeSource === 'sandbox';
        const currentActive = rawActive && canPreserveActive && shouldPreserveActiveChat(rawActive, sourceFilterRef.current as any) ? rawActive : null;
        const finalData = (currentActive && !data.some((c: LiveChatItem) => c.conversationId === currentActive.conversationId))
          ? [currentActive, ...data]
          : data;
        startTransition(() => setChats(finalData));
        chatsRef.current = finalData;
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
      if (err.name === 'AbortError' || abortController.signal.aborted) {
        return;
      }
      console.error('Failed to load live chat conversations:', err);
      setErrorMessage(err.message || 'Gagal memuat percakapan.');
    } finally {
      if (reset && loadChatsAbortControllerRef.current === abortController) {
        loadChatsAbortControllerRef.current = null;
      }
      loadingMoreRef.current = false;
      setLoadingMore(false);
      setIsSearching(false);
      setLoading(false);
    }
  }, [selectedIdRef, searchQueryRef, labelFilterRef, sourceFilterRef, reservationStaffFilterRef, setErrorMessage]);

  const refreshChatItem = useCallback(async (conversationId: string) => {
    try {
      const res = await apiRequest(`/api/admin/live-chat/conversations/${conversationId}`);
      const item = res?.data;
      if (!item) return;
      const updated = chatsRef.current.map((c) =>
        c.conversationId === conversationId ? { ...c, ...item } : c
      );
      chatsRef.current = updated;
      startTransition(() => setChats(updated));
    } catch {}
  }, []);

  const refreshTotalUnread = useCallback((immediate = false) => {
    if (unreadCountFetchTimerRef.current) {
      clearTimeout(unreadCountFetchTimerRef.current);
    }
    const run = async () => {
      try {
        const res = await apiRequest('/api/admin/live-chat/unread-count');
        const count = typeof res?.count === 'number' ? res.count : (typeof res === 'number' ? res : 0);
        startTransition(() => setTotalUnreadCount(count));
      } catch {}
    };
    if (immediate) {
      void run();
    } else {
      unreadCountFetchTimerRef.current = setTimeout(run, 1500);
    }
  }, []);

  useEffect(() => {
    refreshTotalUnread(true);
  }, [refreshTotalUnread]);

  useEffect(() => {
    if (labelFilterFirstRenderRef.current) {
      labelFilterFirstRenderRef.current = false;
      return;
    }
    loadChats(true);
  }, [labelFilter, loadChats]);

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    loadChats(true);
  }, [sourceFilter, loadChats]);

  useEffect(() => {
    if (reservationStaffFilterFirstRenderRef.current) {
      reservationStaffFilterFirstRenderRef.current = false;
      return;
    }
    if (sourceFilterRef.current === 'reservation') loadChats(true);
  }, [reservationStaffFilter, sourceFilterRef, loadChats]);

  const triggerDebouncedSearch = useCallback((q: string) => {
    if (searchDebounceTimerRef.current) {
      clearTimeout(searchDebounceTimerRef.current);
    }
    searchDebounceTimerRef.current = setTimeout(() => {
      loadChats(true, q, true);
    }, 350);
  }, [loadChats]);

  const handleSyncHistory = useCallback(async (offset = 0) => {
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
  }, [loadChats, toast]);

  const handleTogglePin = useCallback(async (chat: LiveChatItem) => {
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
  }, [sortChats, toast]);

  const handleToggleReadStatus = useCallback(async (chat: LiveChatItem) => {
    const isCurrentlyUnread = (chat.unreadCount || 0) > 0 || chat.isManualUnread;
    const targetEndpoint = isCurrentlyUnread ? 'read' : 'unread';
    try {
      const res = await apiRequest(`/api/admin/conversations/${chat.conversationId}/${targetEndpoint}`, {
        method: 'PATCH',
      });
      if ((res as any)?.degraded) {
        toast('Status baca belum tersinkron ke database. Data dimuat ulang dari server.', 'info');
        void refreshChatItem(chat.conversationId);
        refreshTotalUnread(true);
        return;
      }
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
      refreshTotalUnread();
      toast(
        targetEndpoint === 'unread' ? 'Ditandai belum dibaca (Hijau Tua).' : 'Ditandai sudah dibaca.',
        'success'
      );
    } catch (err: any) {
      toast(`Gagal mengubah status dibaca: ${err.message}`, 'error');
    }
  }, [refreshChatItem, refreshTotalUnread, toast]);

  const handleDismissFrustration = useCallback(async (chat: LiveChatItem) => {
    try {
      await apiRequest(`/api/admin/live-chat/conversations/${chat.conversationId}/dismiss-frustration`, {
        method: 'PATCH',
      });
      setChats((prev) => {
        const updated = prev.map((c) =>
          c.conversationId === chat.conversationId
            ? { ...c, isFrustrated: false, frustratedAt: null, frustratedReason: null }
            : c
        );
        chatsRef.current = updated;
        return updated;
      });
      toast('Peringatan SLA dipadamkan.', 'success');
    } catch (err: any) {
      toast(`Gagal memadamkan peringatan SLA: ${err.message}`, 'error');
    }
  }, [toast]);

  const handleMarkAllAsRead = useCallback(async () => {
    const confirmed = await confirm({
      title: 'Tandai Semua Telah Dibaca',
      message: 'Tandai semua pesan dari seluruh pelanggan sebagai telah dibaca?',
      confirmText: 'Tandai Semua Dibaca',
      cancelText: 'Batal',
    });
    if (!confirmed) return;
    try {
      const res = await apiRequest('/api/admin/live-chat/mark-all-read', { method: 'POST' });
      if ((res as any)?.degraded) {
        toast('Perintah diterima, tetapi status baca belum tersinkron ke database. Muat ulang setelah koneksi pulih.', 'info');
        void loadChats(true);
        refreshTotalUnread(true);
        return;
      }
      const updatedChats = chatsRef.current.map((c) => ({
        ...c,
        unreadCount: 0,
        isManualUnread: false,
      }));
      setChats(updatedChats);
      chatsRef.current = updatedChats;
      setTotalUnreadCount(0);
      toast('Semua percakapan berhasil ditandai telah dibaca!', 'success');
    } catch (err: any) {
      toast(`Gagal menandai semua dibaca: ${err.message}`, 'error');
    }
  }, [confirm, loadChats, refreshTotalUnread, toast]);

  const getChatLabel = useCallback((chat: LiveChatItem): 'medical_concern' | 'unresolved_faq' | 'human_request' | 'all' => {
    if (chat.escalationReason === 'medical_concern') return 'medical_concern';
    if (chat.escalationReason === 'unresolved_faq') return 'unresolved_faq';
    if (chat.isHumanHandling) return 'human_request';
    return 'all';
  }, []);

  const filteredChats = useMemo(() => chats.filter((chat) => {
    if (sourceFilter === 'sandbox') {
      if (!(chat as any).isSandboxTest) return false;
    } else {
      if ((chat as any).isSandboxTest) return false;
    }
    if (sourceFilter === 'unread') {
      const isUnread = (chat.unreadCount || 0) > 0 || chat.isManualUnread;
      if (!isUnread) return false;
    }
    if (sourceFilter === 'reservation') {
      const activeRes =
        (chat as any).activeConfirmedReservation || (chat as any).activeHoldReservation || (chat as any).activePendingReservation;
      if (!activeRes) return false;
      const bd = activeRes.booking_date ? new Date(activeRes.booking_date).getTime() : null;
      const stale = bd !== null && !Number.isNaN(bd) && bd < Date.now() - 2 * 60 * 60 * 1000;
      if (stale) return false;
      if (reservationStaffFilter !== 'all') {
        const sid = activeRes.assigned_staff_id || (activeRes as any).assigned_staff?.id || null;
        if (reservationStaffFilter === 'unassigned') {
          if (sid) return false;
        } else if (sid !== reservationStaffFilter) {
          return false;
        }
      }
    }
    if (labelFilter !== 'all' && getChatLabel(chat) !== labelFilter) {
      return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const digitsOnly = q.replace(/\D/g, '');
      let normalized = digitsOnly;
      if (normalized.startsWith('0')) normalized = '62' + normalized.slice(1);
      else if (normalized.startsWith('8')) normalized = '62' + normalized;

      const phone = (chat.customerPhone || '').replace(/\D/g, '');
      const nameMatch = (chat.customerName || '').toLowerCase().includes(q);
      const phoneMatch = digitsOnly.length >= 3 && (
        phone.includes(digitsOnly) ||
        (normalized.length >= 4 && phone.includes(normalized)) ||
        (chat.customerPhone || '').toLowerCase().includes(q)
      );
      const messageMatch = (chat.lastMessages || []).some((m) =>
        (m.content || '').toLowerCase().includes(q)
      );

      if (!nameMatch && !phoneMatch && !messageMatch) {
        const isFromServerSearch = isSearching || (chatsRef.current.length > 0 && searchQuery.trim().length >= 2);
        if (!isFromServerSearch) {
          return false;
        }
      }
    }

    return true;
  }), [chats, labelFilter, searchQuery, sourceFilter, isSearching, reservationStaffFilter, getChatLabel]);

  const sortedChats = useMemo(() => {
    if (!searchQuery.trim()) return filteredChats;
    const q = searchQuery.trim().toLowerCase();
    const digitsOnly = q.replace(/\D/g, '');
    const nameHits = (chat: LiveChatItem): boolean =>
      (chat.customerName || '').toLowerCase().includes(q) ||
      (digitsOnly.length >= 3 && (chat.customerPhone || '').replace(/\D/g, '').includes(digitsOnly));
    return [...filteredChats].sort((a, b) => {
      const an = nameHits(a);
      const bn = nameHits(b);
      if (an && !bn) return -1;
      if (!an && bn) return 1;
      return new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime();
    });
  }, [filteredChats, searchQuery]);

  return {
    chats,
    setChats,
    chatsRef,
    loading,
    setLoading,
    loadingMore,
    setLoadingMore,
    hasMore,
    setHasMore,
    isSearching,
    setIsSearching,
    totalUnreadCount,
    setTotalUnreadCount,
    syncingHistory,
    setSyncingHistory,
    syncNextOffset,
    setSyncNextOffset,
    syncProgress,
    setSyncProgress,
    listOffsetRef,
    loadChatsAbortControllerRef,
    loadChats,
    refreshChatItem,
    refreshTotalUnread,
    handleSyncHistory,
    handleTogglePin,
    handleToggleReadStatus,
    handleDismissFrustration,
    handleMarkAllAsRead,
    sortChats,
    getChatLabel,
    filteredChats,
    sortedChats,
    triggerDebouncedSearch,
  };
}
