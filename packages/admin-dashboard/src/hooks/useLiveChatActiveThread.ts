// Catatan kontrak error: catch kosong di hook ini adalah indikator mengetik,
// riwayat/URL browser, dan cache percakapan terpilih. Semua pelengkap; memuat
// thread tetap memberi pesan galat lewat state halaman.
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { apiRequest } from '../services/api';
import { isSameConversation } from '../utils/livechatSourceFilter';
import { dedupeThreadMessages } from '../utils/livechatThread';
import { extractMedia, extractLocation } from '../utils/mediaExtractor';
import { extractQuotedMessage } from '../types/livechat';
import { saveConversationScroll, getConversationScroll } from './useLiveChatScroll';
import { loadConversationDraft } from './useLiveChatDrafts';
import type { ChatMessage, LiveChatItem } from '../types/livechat';
import type { PinnedMessageData } from '../components/livechat/MessagePinBanner';

export interface UseLiveChatActiveThreadParams {
  selectedId: string | null;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  selectedIdRef: React.MutableRefObject<string | null>;
  chatsRef: React.MutableRefObject<LiveChatItem[]>;
  setChats: React.Dispatch<React.SetStateAction<LiveChatItem[]>>;
  chatContainerRef: React.RefObject<HTMLDivElement | null>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  mobileView: 'list' | 'chat';
  setMobileView: (view: 'list' | 'chat') => void;
  setSearchParams: any;
  isTypingActiveRef: React.MutableRefObject<boolean>;
  notifyTyping: (isTyping: boolean) => void;
  customerDetailData: any;
  setCustomerDetailData: (data: any) => void;
  refreshChatItem: (convId: string) => Promise<any>;
  replyTextRef: React.MutableRefObject<string>;
  setHasReplyText: (hasText: boolean) => void;
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export function useLiveChatActiveThread({
  selectedId,
  setSelectedId,
  selectedIdRef,
  chatsRef,
  setChats,
  chatContainerRef,
  messagesEndRef,
  mobileView,
  setMobileView,
  setSearchParams,
  isTypingActiveRef,
  notifyTyping,
  customerDetailData,
  setCustomerDetailData,
  refreshChatItem,
  replyTextRef,
  setHasReplyText,
  toast,
}: UseLiveChatActiveThreadParams) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const optimisticMessageIdsRef = useRef<Set<string>>(new Set());
  const [pinnedBubble, setPinnedBubble] = useState<PinnedMessageData | null>(null);
  const [isThreadLoading, setIsThreadLoading] = useState(false);
  const [threadLoadError, setThreadLoadError] = useState<string | null>(null);
  const activeThreadRequestIdRef = useRef(0);
  const loadedThreadConvIdRef = useRef<string | null>(null);

  const [hasMoreOlderMessages, setHasMoreOlderMessages] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isDeepSearching, setIsDeepSearching] = useState(false);
  const oldestMessageCursorRef = useRef<string | null>(null);
  const pendingFocusMessageIdRef = useRef<string | null>(null);

  const wasNearBottomRef = useRef(true);
  const savedScrollTopRef = useRef<number | null>(null);
  const isInitialMessagesLoadRef = useRef(true);
  const isChatHistoryPushedRef = useRef(false);

  // In-Chat Search
  const [inChatSearchQuery, setInChatSearchQuery] = useState('');
  const [inChatSearchOpen, setInChatSearchOpen] = useState(false);
  const [matchingMessageIds, setMatchingMessageIds] = useState<string[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState<number>(-1);
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const inChatSearchInputRef = useRef<HTMLInputElement | null>(null);

  const [debouncedInChatQuery, setDebouncedInChatQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedInChatQuery(inChatSearchQuery), 350);
    return () => clearTimeout(t);
  }, [inChatSearchQuery]);

  const effectiveInChatQuery = useMemo(() => {
    const q = debouncedInChatQuery.trim().toLowerCase();
    if (!selectedId || !q || q.length < 2) return '';
    return q;
  }, [debouncedInChatQuery, selectedId]);

  const lastScrolledInChatQueryRef = useRef<string>('');
  const autoDeepSearchDoneRef = useRef<string>('');

  const scrollToBottom = useCallback((smooth = false, force = false) => {
    const el = chatContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isNearBottom = distanceFromBottom < 300;
    if (!isNearBottom && !force) return;
    wasNearBottomRef.current = true;
    const doScroll = () => {
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight + 99999;
      }
      if ((isNearBottom || force) && messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' });
      }
    };
    doScroll();
    requestAnimationFrame(doScroll);
    if (force) {
      setTimeout(doScroll, 60);
      setTimeout(doScroll, 150);
    }
  }, [chatContainerRef, messagesEndRef]);

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

    setTimeout(() => {
      setHighlightedMsgId((prev) => (prev === msgId ? null : prev));
    }, 3500);
  }, []);

  const loadThread = useCallback(async (conversationId: string, focusMessageId?: string) => {
    const reqId = ++activeThreadRequestIdRef.current;
    const effectiveFocus = focusMessageId || pendingFocusMessageIdRef.current || undefined;
    if (focusMessageId) pendingFocusMessageIdRef.current = focusMessageId;
    const isRefreshSameThread = isSameConversation(loadedThreadConvIdRef.current, conversationId);
    if (!isRefreshSameThread) {
      setIsThreadLoading(true);
    }
    setHasMoreOlderMessages(false);
    setIsLoadingOlder(false);
    oldestMessageCursorRef.current = null;
    try {
      const focusQs = effectiveFocus ? `&focusMessageId=${encodeURIComponent(effectiveFocus)}` : '';
      const res = await apiRequest(`/api/admin/live-chat/conversations/${conversationId}/messages?limit=50${focusQs}`);
      if (activeThreadRequestIdRef.current !== reqId || selectedIdRef.current !== conversationId) {
        return;
      }
      const list: ChatMessage[] = Array.isArray(res) ? res : (res?.data || []);
      setHasMoreOlderMessages(!!(res as any)?.hasMore);
      const cursor = (res as any)?.oldestCursor as string | undefined;
      const firstLoaded = list[0] as any;
      oldestMessageCursorRef.current = cursor || (firstLoaded ? `${firstLoaded.created_at}|${firstLoaded.id}` : null);

      const deduped: ChatMessage[] = dedupeThreadMessages(list);

      if (activeThreadRequestIdRef.current === reqId && selectedIdRef.current === conversationId) {
        const mappedMessages = deduped.map((m) => ({
          ...m,
          is_message_pinned: !!(m.is_message_pinned || (m as any).payload_raw?.is_pinned),
          is_message_hidden: !!(m.is_message_hidden || (m as any).payload_raw?.is_hidden),
          pinned_by: m.pinned_by || (m as any).payload_raw?.pinned_by || null,
          pinned_at: m.pinned_at || (m as any).payload_raw?.pinned_at || null,
          hidden_by: m.hidden_by || (m as any).payload_raw?.hidden_by || null,
          hidden_at: m.hidden_at || (m as any).payload_raw?.hidden_at || null,
          media: extractMedia(m),
          location: (m as any).location || extractLocation(m),
          quoted_message: extractQuotedMessage(m),
        }));
        setMessages(mappedMessages);
        setThreadLoadError(null);

        if (res?.pinnedMessage) {
          setPinnedBubble(res.pinnedMessage);
        } else {
          const foundPinned = mappedMessages.find((m) => m.is_message_pinned);
          if (foundPinned) {
            setPinnedBubble({
              id: foundPinned.id,
              wa_message_id: foundPinned.wa_message_id,
              content: foundPinned.content,
              sender_name: foundPinned.sender_name,
              sender_type: foundPinned.sender_type,
              created_at: foundPinned.created_at,
              pinned_by: foundPinned.pinned_by,
              pinned_at: foundPinned.pinned_at,
            });
          } else {
            setPinnedBubble(null);
          }
        }

        loadedThreadConvIdRef.current = conversationId;
        if (effectiveFocus) {
          pendingFocusMessageIdRef.current = null;
          setHighlightedMsgId(effectiveFocus);
          setTimeout(() => scrollToMessage(effectiveFocus, true), 80);
          setTimeout(() => scrollToMessage(effectiveFocus, true), 350);
        }
      }
    } catch (err: any) {
      if (activeThreadRequestIdRef.current === reqId && selectedIdRef.current === conversationId) {
        console.error('Failed to load conversation thread:', err);
        if (!isRefreshSameThread) setMessages([]);
        setThreadLoadError(err?.message || 'Gagal memuat riwayat chat.');
      }
    } finally {
      if (activeThreadRequestIdRef.current === reqId && selectedIdRef.current === conversationId) {
        setIsThreadLoading(false);
      }
    }
  }, [selectedIdRef, scrollToMessage]);

  const loadOlderMessages = useCallback(async () => {
    const conversationId = selectedIdRef.current;
    const el = chatContainerRef.current;
    if (!conversationId || !el || isLoadingOlder || !hasMoreOlderMessages || !oldestMessageCursorRef.current) {
      return;
    }
    setIsLoadingOlder(true);
    const prevScrollHeight = el.scrollHeight;
    const prevScrollTop = el.scrollTop;
    try {
      const res = await apiRequest(
        `/api/admin/live-chat/conversations/${conversationId}/messages?limit=50&before=${encodeURIComponent(oldestMessageCursorRef.current)}`
      );
      if (selectedIdRef.current !== conversationId) return;
      const older: ChatMessage[] = Array.isArray(res) ? res : (res?.data || []);
      setHasMoreOlderMessages(!!(res as any)?.hasMore);
      const cursor = (res as any)?.oldestCursor as string | undefined;
      if (older.length > 0) {
        const firstOlder = older[0] as any;
        oldestMessageCursorRef.current = cursor || (firstOlder ? `${firstOlder.created_at}|${firstOlder.id}` : oldestMessageCursorRef.current);
        const mapped = older.map((m) => ({
          ...m,
          media: extractMedia(m),
          location: (m as any).location || extractLocation(m),
          quoted_message: extractQuotedMessage(m),
        }));
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => String(m.id)));
          const fresh = mapped.filter((m) => {
            const wa = String((m as any).wa_message_id || (m as any).waMessageId || '');
            if (seen.has(String(m.id))) return false;
            if (wa && prev.some((p) => String((p as any).wa_message_id || (p as any).waMessageId || '') === wa)) return false;
            return true;
          });
          return [...fresh, ...prev];
        });
      } else if (!(res as any)?.hasMore) {
        setHasMoreOlderMessages(false);
      }
      requestAnimationFrame(() => {
        const target = chatContainerRef.current;
        if (target && selectedIdRef.current === conversationId) {
          target.scrollTop = prevScrollTop + (target.scrollHeight - prevScrollHeight);
        }
      });
    } catch (err: any) {
      console.error('Failed to load older messages:', err);
    } finally {
      if (selectedIdRef.current === conversationId) {
        setIsLoadingOlder(false);
      }
    }
  }, [selectedIdRef, chatContainerRef, isLoadingOlder, hasMoreOlderMessages]);

  const handleDeepSearchInHistory = useCallback(async () => {
    const conversationId = selectedIdRef.current;
    const q = effectiveInChatQuery;
    if (!conversationId || !q || isDeepSearching || isLoadingOlder) return;
    setIsDeepSearching(true);
    try {
      let cursor = oldestMessageCursorRef.current;
      let guard = 0;
      while (cursor && guard < 20) {
        guard++;
        const res = await apiRequest(
          `/api/admin/live-chat/conversations/${conversationId}/messages?limit=50&before=${encodeURIComponent(cursor)}`
        );
        if (selectedIdRef.current !== conversationId) return;
        const batch: ChatMessage[] = Array.isArray(res) ? res : (res?.data || []);
        const hasMore = !!(res as any)?.hasMore;
        const nextCursor = (res as any)?.oldestCursor as string | undefined;
        if (batch.length === 0) {
          setHasMoreOlderMessages(hasMore);
          if (!hasMore) oldestMessageCursorRef.current = null;
          break;
        }
        const firstBatch = batch[0] as any;
        cursor = nextCursor || (firstBatch ? `${firstBatch.created_at}|${firstBatch.id}` : null);
        oldestMessageCursorRef.current = cursor;
        setHasMoreOlderMessages(hasMore);
        const mapped = batch.map((m) => ({ ...m, media: extractMedia(m), quoted_message: extractQuotedMessage(m) }));
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => String(m.id)));
          const fresh = mapped.filter((m) => {
            const wa = String((m as any).wa_message_id || (m as any).waMessageId || '');
            if (seen.has(String(m.id))) return false;
            if (wa && prev.some((p) => String((p as any).wa_message_id || (p as any).waMessageId || '') === wa)) return false;
            return true;
          });
          return [...fresh, ...prev];
        });
        if (batch.some((m) => ((m as any)?.content || '').toLowerCase().includes(q))) break;
        if (!hasMore) break;
      }
    } catch (err: any) {
      console.error('Failed deep search history:', err);
    } finally {
      if (selectedIdRef.current === conversationId) {
        setIsDeepSearching(false);
      }
    }
  }, [selectedIdRef, effectiveInChatQuery, isDeepSearching, isLoadingOlder]);

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
    setInChatSearchQuery('');
    setDebouncedInChatQuery('');
    setInChatSearchOpen(false);
    setMatchingMessageIds([]);
    setCurrentMatchIndex(-1);
    setHighlightedMsgId(null);
    scrollToBottom(true, true);
  };

  // Sync matchingMessageIds whenever messages or query change
  useEffect(() => {
    if (!effectiveInChatQuery) {
      setMatchingMessageIds([]);
      setCurrentMatchIndex(-1);
      return;
    }
    const matches = messages
      .filter((m) => (m.content || '').toLowerCase().includes(effectiveInChatQuery))
      .map((m) => m.id);
    setMatchingMessageIds(matches);
    setCurrentMatchIndex(matches.length > 0 ? matches.length - 1 : -1);
  }, [effectiveInChatQuery, messages]);

  // Handle in-chat search scrolling / initial scroll
  useEffect(() => {
    if (messages.length > 0) {
      const q = effectiveInChatQuery;
      if (q) {
        if (lastScrolledInChatQueryRef.current !== q) {
          const matches = messages
            .filter((m) => m.content && m.content.toLowerCase().includes(q))
            .map((m) => m.id);
          if (matches.length > 0) {
            const targetId = matches[matches.length - 1];
            lastScrolledInChatQueryRef.current = q;
            scrollToMessage(targetId, false);
            return;
          }
        }
        return;
      } else {
        lastScrolledInChatQueryRef.current = '';
      }
      if (pendingFocusMessageIdRef.current || highlightedMsgId) {
        isInitialMessagesLoadRef.current = false;
        return;
      }
      if (isInitialMessagesLoadRef.current) {
        if (!wasNearBottomRef.current && savedScrollTopRef.current !== null) {
          const targetScroll = savedScrollTopRef.current;
          const restoreScroll = () => {
            if (chatContainerRef.current) {
              chatContainerRef.current.scrollTop = targetScroll;
            }
          };
          restoreScroll();
          requestAnimationFrame(restoreScroll);
          setTimeout(restoreScroll, 50);
          setTimeout(restoreScroll, 150);
        } else {
          scrollToBottom(false, true);
        }
        isInitialMessagesLoadRef.current = false;
      } else {
        scrollToBottom(false, false);
      }
    }
  }, [messages, selectedId, effectiveInChatQuery, scrollToBottom, scrollToMessage, highlightedMsgId]);

  // Auto deep search
  useEffect(() => {
    if (!effectiveInChatQuery || selectedId == null) {
      autoDeepSearchDoneRef.current = '';
      return;
    }
    if (!inChatSearchOpen) {
      setInChatSearchOpen(true);
    }
    if (
      matchingMessageIds.length === 0 &&
      hasMoreOlderMessages &&
      !isDeepSearching &&
      !isLoadingOlder &&
      !isThreadLoading &&
      messages.length > 0 &&
      autoDeepSearchDoneRef.current !== `${selectedId}:${effectiveInChatQuery}`
    ) {
      autoDeepSearchDoneRef.current = `${selectedId}:${effectiveInChatQuery}`;
      void handleDeepSearchInHistory();
    }
  }, [
    effectiveInChatQuery,
    matchingMessageIds.length,
    hasMoreOlderMessages,
    isDeepSearching,
    isLoadingOlder,
    isThreadLoading,
    messages.length,
    selectedId,
    inChatSearchOpen,
    handleDeepSearchInHistory,
  ]);

  const handleSelect = useCallback((conversationId: string) => {
    if (selectedIdRef.current && selectedIdRef.current !== conversationId && isTypingActiveRef.current) {
      try { notifyTyping(false); } catch {}
    }
    isTypingActiveRef.current = false;

    if (selectedIdRef.current && chatContainerRef.current) {
      const el = chatContainerRef.current;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      saveConversationScroll(selectedIdRef.current, el.scrollTop, distance < 300);
    }

    const targetChatPre = chatsRef.current.find((c) => c.conversationId === conversationId);
    if (targetChatPre && customerDetailData && customerDetailData.id !== targetChatPre.customerId) {
      setCustomerDetailData(null);
    }
    setSelectedId(conversationId);
    selectedIdRef.current = conversationId;
    setMobileView('chat');
    try {
      sessionStorage.setItem('liveChat:selectedId', conversationId);
      sessionStorage.setItem('liveChat:mobileView', 'chat');
      setSearchParams({ conversationId }, { replace: false });
      isChatHistoryPushedRef.current = true;
    } catch {}

    const targetChat = chatsRef.current.find((c) => c.conversationId === conversationId);
    if (targetChat && ((targetChat.unreadCount || 0) > 0 || targetChat.isManualUnread)) {
      apiRequest(`/api/admin/conversations/${conversationId}/read`, { method: 'PATCH' })
        .then((res: any) => {
          if (res?.degraded) void refreshChatItem(conversationId);
        })
        .catch(() => { void refreshChatItem(conversationId); });
      const lastMsg = (targetChat.lastMessages || [])[(targetChat.lastMessages || []).length - 1] as any;
      const isLastInbound = !!lastMsg && lastMsg.direction === 'INBOUND';
      const lastAgeOk = !!lastMsg && (Date.now() - new Date(lastMsg.created_at).getTime()) <= 24 * 60 * 60 * 1000;
      setChats((prev) => {
        const updated = prev.map((c) =>
          c.conversationId === conversationId
            ? { ...c, unreadCount: 0, isManualUnread: false, isAwaitingReply: isLastInbound && lastAgeOk }
            : c
        );
        chatsRef.current = updated;
        return updated;
      });
    }
  }, [
    selectedIdRef,
    isTypingActiveRef,
    notifyTyping,
    chatContainerRef,
    chatsRef,
    customerDetailData,
    setCustomerDetailData,
    setSelectedId,
    setMobileView,
    setSearchParams,
    refreshChatItem,
    setChats,
  ]);

  // Perubahan conversationId: sinkronisasi pesan & draf
  useEffect(() => {
    isInitialMessagesLoadRef.current = true;
    if (selectedId) {
      const saved = getConversationScroll(selectedId);
      savedScrollTopRef.current = saved ? saved.scrollTop : null;
      wasNearBottomRef.current = saved ? saved.isNearBottom : true;
    } else {
      savedScrollTopRef.current = null;
      wasNearBottomRef.current = true;
    }

    if (selectedId) {
      const draft = loadConversationDraft(selectedId);
      replyTextRef.current = draft;
      setHasReplyText(draft.trim().length > 0);
    } else {
      replyTextRef.current = '';
      setHasReplyText(false);
    }

    try {
      if (selectedId) sessionStorage.setItem('liveChat:selectedId', selectedId);
      else sessionStorage.removeItem('liveChat:selectedId');
    } catch {}

    if (selectedId) {
      setMessages([]);
      setThreadLoadError(null);
      loadThread(selectedId);
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
    } else {
      loadedThreadConvIdRef.current = null;
      setMessages([]);
      setThreadLoadError(null);
      setIsThreadLoading(false);
    }
  }, [selectedId, loadThread, chatsRef, setChats, replyTextRef, setHasReplyText]);

  return {
    messages,
    setMessages,
    optimisticMessageIdsRef,
    pinnedBubble,
    setPinnedBubble,
    isThreadLoading,
    setIsThreadLoading,
    threadLoadError,
    setThreadLoadError,
    hasMoreOlderMessages,
    setHasMoreOlderMessages,
    isLoadingOlder,
    setIsLoadingOlder,
    isDeepSearching,
    setIsDeepSearching,
    oldestMessageCursorRef,
    pendingFocusMessageIdRef,
    wasNearBottomRef,
    savedScrollTopRef,
    isInitialMessagesLoadRef,
    isChatHistoryPushedRef,
    inChatSearchQuery,
    setInChatSearchQuery,
    debouncedInChatQuery,
    setDebouncedInChatQuery,
    effectiveInChatQuery,
    inChatSearchOpen,
    setInChatSearchOpen,
    matchingMessageIds,
    setMatchingMessageIds,
    currentMatchIndex,
    setCurrentMatchIndex,
    highlightedMsgId,
    setHighlightedMsgId,
    inChatSearchInputRef,
    lastScrolledInChatQueryRef,
    autoDeepSearchDoneRef,
    loadThread,
    loadOlderMessages,
    handleDeepSearchInHistory,
    scrollToBottom,
    scrollToMessage,
    handleNextMatch,
    handlePrevMatch,
    handleClearInChatSearch,
    handleSelect,
  };
}
