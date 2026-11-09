import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import { useAuth } from '../../contexts/AuthContext';
import { useCopilot } from '../../contexts/CopilotContext';
import {
  MessageSquare,
  AlertTriangle,
  Loader,
  RefreshCw,
  FileText,
  ShieldAlert,
  Radar,
} from 'lucide-react';
import { ToggleSwitch } from '../../components/common/ToggleSwitch';
import { LiveChatComposerHandle } from '../../components/livechat/LiveChatComposer';
import { AdminCopilotPanel } from '../../components/copilot/AdminCopilotPanel';
import { LiveChatDispatchWidget } from '../../components/livechat/LiveChatDispatchWidget';
import { AiOffStrip } from '../../components/livechat/AiOffStrip';
import { saveConversationDraft } from '../../hooks/useLiveChatDrafts';
import { useLiveChatSse } from '../../hooks/useLiveChatSse';
import { useLiveChatMessageOperations } from '../../hooks/useLiveChatMessageOperations';
import { useLiveChatComposerHandler } from '../../hooks/useLiveChatComposerHandler';
import { useLiveChatBanners } from '../../hooks/useLiveChatBanners';
import { useLiveChatBackgroundSync } from '../../hooks/useLiveChatBackgroundSync';
import { useLiveChatThreads } from '../../hooks/useLiveChatThreads';
import { useLiveChatActiveThread } from '../../hooks/useLiveChatActiveThread';
import { useLiveChatReservations } from '../../hooks/useLiveChatReservations';
import { useLiveChatBotAndLabels } from '../../hooks/useLiveChatBotAndLabels';
import { LiveChatThreadList } from '../../components/livechat/LiveChatThreadList';
import { LiveChatMessagePane } from '../../components/livechat/LiveChatMessagePane';
import { LiveChatModals } from '../../components/livechat/LiveChatModals';
import type { SourceFilter } from '../../utils/livechatSourceFilter';
import {
  type ChatMessage,
  type LiveChatItem,
} from '../../types/livechat';

export const LiveChatMonitor: React.FC = () => {
  const { toast, confirm } = useUiFeedback();
  const { user } = useAuth();
  const { open: copilotOpen, setOpen: setCopilotOpen, openMobileMenu } = useCopilot();
  const [searchParams, setSearchParams] = useSearchParams();

  // Mobile View Navigation: 'list' (daftar chat) vs 'chat' (pesan aktif)
  const [mobileView, setMobileView] = useState<'list' | 'chat'>(() => {
    try {
      const cached = sessionStorage.getItem('liveChat:mobileView');
      if (cached === 'list' || cached === 'chat') return cached;
    } catch {}
    const hasConvInUrl =
      typeof window !== 'undefined' &&
      (new URLSearchParams(window.location.search).has('conversationId') ||
        new URLSearchParams(window.location.search).has('id'));
    return hasConvInUrl ? 'chat' : 'list';
  });

  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(min-width: 1024px)').matches : true
  );

  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      const fromUrl = searchParams.get('conversationId') || searchParams.get('id');
      if (fromUrl) return fromUrl;
      const cached = sessionStorage.getItem('liveChat:selectedId');
      if (cached) return cached;
    } catch {}
    return null;
  });
  const selectedIdRef = useRef<string | null>(selectedId);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Search & Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const searchQueryRef = useRef('');
  searchQueryRef.current = searchQuery;
  const searchDebounceTimerRef = useRef<any>(null);

  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const sourceFilterRef = useRef<string>(sourceFilter);
  sourceFilterRef.current = sourceFilter;

  const [labelFilter, setLabelFilter] = useState<'all' | 'medical_concern' | 'unresolved_faq' | 'human_request'>('all');
  const labelFilterRef = useRef<string>(labelFilter);
  labelFilterRef.current = labelFilter;

  const [reservationStaffFilter, setReservationStaffFilter] = useState<string>('all');
  const reservationStaffFilterRef = useRef<string>(reservationStaffFilter);
  reservationStaffFilterRef.current = reservationStaffFilter;

  const {
    chats,
    setChats,
    chatsRef,
    loading,
    loadingMore,
    hasMore,
    totalUnreadCount,
    setTotalUnreadCount,
    syncProgress,
    isSearching,
    loadChats,
    refreshChatItem,
    refreshTotalUnread,
    triggerDebouncedSearch,
    handleTogglePin,
    handleToggleReadStatus,
    handleMarkAllAsRead,
    handleDismissFrustration,
    sortChats,
    filteredChats,
    sortedChats,
  } = useLiveChatThreads({
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
  });

  const selectedChat = useMemo(() => {
    if (!selectedId) return null;
    return chats.find((c) => c.conversationId === selectedId) || null;
  }, [chats, selectedId]);

  const replyTextRef = useRef('');
  const [hasReplyText, setHasReplyText] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [draftTick, setDraftTick] = useState(0);
  const draftListTimerRef = useRef<any>(null);

  const handleSelectReply = (msg: ChatMessage) => {
    if (msg.is_revoked || (msg as any).isRevoked) return;
    setReplyingTo(msg);
    composerRef.current?.focus();
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<LiveChatComposerHandle | null>(null);
  const chatListContainerRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
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

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; chat: LiveChatItem } | null>(null);

  // Active chat thread hook
  const {
    messages,
    setMessages,
    optimisticMessageIdsRef,
    pinnedBubble,
    setPinnedBubble,
    isThreadLoading,
    threadLoadError,
    hasMoreOlderMessages,
    isLoadingOlder,
    isDeepSearching,
    pendingFocusMessageIdRef,
    wasNearBottomRef,
    savedScrollTopRef,
    isChatHistoryPushedRef,
    inChatSearchQuery,
    setInChatSearchQuery,
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
    loadThread,
    loadOlderMessages,
    handleDeepSearchInHistory,
    scrollToBottom,
    scrollToMessage,
    handleNextMatch,
    handlePrevMatch,
    handleClearInChatSearch,
    handleSelect,
  } = useLiveChatActiveThread({
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
    customerDetailData: null,
    setCustomerDetailData: (val) => reservations.setCustomerDetailData(val),
    refreshChatItem,
    replyTextRef,
    setHasReplyText,
    toast,
  });

  // Reservations, Customer Detail, Dispatch & Modals hook
  const reservations = useLiveChatReservations({
    selectedChat,
    selectedIdRef,
    chatsRef,
    setChats,
    messages,
    toast,
    confirm,
  });

  const {
    customerDetailModalOpen,
    setCustomerDetailModalOpen,
    customerDetailEditMode,
    setCustomerDetailEditMode,
    customerDetailLoading,
    customerDetailData,
    setCustomerDetailData,
    addrBookCustomer,
    setAddrBookCustomer,
    savedAddressCount,
    setSavedAddressCount,
    selectedReservation,
    setSelectedReservation,
    proofModalReservation,
    setProofModalReservation,
    reservationRefreshRef,
    lastReservationRefreshTimeRef,
    dispatchTrip,
    dispatchLoading,
    dispatchDrawerOpen,
    setDispatchDrawerOpen,
    loadDispatchTripRef,
    dispatchReservationIdRef,
    dispatchOriginRef,
    reservationStaffList,
    showQuickBookingModal,
    setShowQuickBookingModal,
    showQuickHoldModal,
    setShowQuickHoldModal,
    quickHoldInitialDate,
    setQuickHoldInitialDate,
    quickHoldInitialTime,
    setQuickHoldInitialTime,
    convertingHoldId,
    setConvertingHoldId,
    activeEditingHoldReservation,
    setActiveEditingHoldReservation,
    activeEditingConfirmedReservation,
    setActiveEditingConfirmedReservation,
    quickBookingTargetSlot,
    setQuickBookingTargetSlot,
    quickBookingExtracted,
    setQuickBookingExtracted,
    dismissedFormBanner,
    setDismissedFormBanner,
    showDailyScheduleModal,
    setShowDailyScheduleModal,
    showInvoiceModal,
    setShowInvoiceModal,
    invoiceModalData,
    setInvoiceModalData,
    clinicServices,
    setClinicServices,
    pushModalHistory,
    handleOpenCustomerDetail,
    handleSaveCustomerDetail,
    handleOpenReservationDetail,
    handleReservationUpdate,
    handleOpenQuickReservation,
    handleOpenQuickHold,
    handleSlotHold,
    handleConvertHoldToBooking,
    handleConfirmPendingBooking,
    activeHoldReservation,
    activeConfirmedReservation,
    activePendingReservation,
    currentActiveReservation,
    dispatchReservationId,
    loadDispatchTrip,
    dispatchLocationSource,
  } = reservations;

  // Bot cutoff & labels management hook
  const {
    chatBotActive,
    setChatBotActive,
    togglingBotCutoff,
    clinicBrandName,
    handleToggleGlobalBot,
    gatewayCapability,
    allLabels,
    labelPopoverOpen,
    setLabelPopoverOpen,
    togglingLabelId,
    labelPopoverRef,
    handleToggleLabel,
  } = useLiveChatBotAndLabels({
    chatsRef,
    setChats,
    loadChats,
    setContextMenu,
    setCustomerDetailData,
    toast,
    confirm,
  });

  // Background WA sync hook
  const [showSyncInfoModal, setShowSyncInfoModal] = useState(false);
  const {
    bgSyncProgress,
    setBgSyncProgress,
    handleStartBackgroundFullSync,
    handleCancelBackgroundSync,
  } = useLiveChatBackgroundSync({
    loadChats,
    toast,
  });

  const [sseConnected, setSseConnected] = useState(false);
  const sseConnectedRef = useRef(false);
  const mobileViewRef = useRef(mobileView);
  mobileViewRef.current = mobileView;
  const isDesktopRef = useRef(isDesktop);
  isDesktopRef.current = isDesktop;
  const [delayAlert, setDelayAlert] = useState<any>(null);
  const delayAlertedRef = useRef<Set<string>>(new Set());

  // SSE real-time hook
  useLiveChatSse({
    selectedIdRef,
    sseConnectedRef,
    setSseConnected,
    loadChats,
    refreshTotalUnread,
    loadThread,
    setChatBotActive,
    setChats,
    chatsRef,
    setTotalUnreadCount,
    setMessages,
    optimisticMessageIdsRef,
    scrollToBottom,
    chatContainerRef,
    wasNearBottomRef,
    savedScrollTopRef,
    mobileViewRef,
    isDesktopRef,
    sourceFilterRef: sourceFilterRef as any,
    reservationRefreshRef,
    lastReservationRefreshTimeRef,
    delayAlertedRef,
    loadDispatchTripRef,
    sortChats,
    setCustomerDetailData,
    setPinnedBubble,
    setBgSyncProgress,
    setSelectedReservation,
    setDelayAlert,
    dispatchReservationIdRef,
  });

  // Message & Bot operations hook
  const {
    revokingId,
    editingMsg,
    setEditingMsg,
    isEditingSaving,
    editContent,
    setEditContent,
    isPinningMessageId,
    setIsPinningMessageId,
    isHidingMessageId,
    releasingId,
    generatingDraft,
    handleRevokeMessage,
    handleStartEdit,
    handleSaveEdit,
    handleCopyMessageText,
    handleToggleReaction,
    handleToggleMessagePin,
    handleToggleMessageHide,
    handleJumpToPinnedMessage,
    handleRelease,
    handleTakeover,
    handleGenerateAiDraft,
  } = useLiveChatMessageOperations({
    selectedChat,
    selectedId,
    selectedIdRef,
    messages,
    setMessages,
    chatsRef,
    setChats,
    refreshChatItem,
    composerRef,
    replyTextRef,
    setHasReplyText,
    scrollToMessage,
    loadThread,
    setPinnedBubble,
  });

  // Banners smart detection hook
  const {
    formBannerExtracted,
    matchedExistingReservation,
    formBannerKey,
    showFormReservasiBanner,
    showNeutralExistingReservationBanner,
    showUnregisteredVisitBanner,
  } = useLiveChatBanners({
    messages,
    customerDetailData,
    clinicServices,
    selectedChat,
    dismissedFormBanner,
    activeConfirmedReservation,
    activeHoldReservation,
    activePendingReservation,
    dispatchReservationId,
  });

  // Composer & sending hook
  const {
    selectedImage,
    sending,
    quickReplies,
    applyQuickReply,
    handleSendReply,
    handleImageFile,
    handlePickImage,
    handleRemoveSelectedImage,
    handleInsertInvoiceToChat,
    handleInsertDispatchDraft,
    markSharelocRequested,
    handleRequestSharelocFromDispatch,
    handleGenerateActiveReservationInvoice,
  } = useLiveChatComposerHandler({
    selectedId,
    selectedIdRef,
    selectedChat,
    user,
    customerDetailData,
    clinicBrandName,
    clinicServices,
    setClinicServices,
    replyingTo,
    setReplyingTo,
    composerRef,
    fileInputRef,
    replyTextRef,
    setHasReplyText,
    dispatchOriginRef,
    setDispatchDrawerOpen,
    setInvoiceModalData,
    setShowInvoiceModal,
    pushModalHistory,
    setAddrBookCustomer,
    setMessages,
    setChats,
    chatsRef,
    optimisticMessageIdsRef,
    sortChats,
    scrollToBottom,
    notifyTyping,
    loadThread,
    refreshChatItem,
    activeConfirmedReservation,
    activePendingReservation,
    handleOpenQuickReservation,
    toast,
  });

  const handleComposerTextChange = (text: string) => {
    replyTextRef.current = text;
    const isNotEmpty = text.trim().length > 0;
    if (hasReplyText !== isNotEmpty) {
      setHasReplyText(isNotEmpty);
    }
    if (draftListTimerRef.current) clearTimeout(draftListTimerRef.current);
    draftListTimerRef.current = setTimeout(() => {
      setDraftTick((t) => t + 1);
    }, 700);
  };

  const handleBackToList = () => {
    if (isTypingActiveRef.current) {
      try { notifyTyping(false); } catch {}
    }
    isTypingActiveRef.current = false;
    setSelectedId(null);
    selectedIdRef.current = null;
    setMobileView('list');
    try {
      sessionStorage.removeItem('liveChat:selectedId');
      sessionStorage.setItem('liveChat:mobileView', 'list');
    } catch {}

    const hasConvInUrl =
      typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('conversationId');
    if (hasConvInUrl && isChatHistoryPushedRef.current) {
      isChatHistoryPushedRef.current = false;
      window.history.back();
    } else {
      try {
        window.history.replaceState({}, '', '/admin/live-chat');
        setSearchParams({}, { replace: true });
      } catch {}
    }
    setTimeout(() => setMobileView('list'), 60);
  };

  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchInputFocusedRef = useRef(false);

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

  useEffect(() => {
    const saveCurrentDraft = () => {
      if (selectedIdRef.current) {
        const currentText = replyTextRef.current || '';
        if (currentText.trim()) {
          saveConversationDraft(selectedIdRef.current, currentText);
        }
      }
    };
    window.addEventListener('beforeunload', saveCurrentDraft);
    window.addEventListener('pagehide', saveCurrentDraft);
    return () => {
      saveCurrentDraft();
      if (draftListTimerRef.current) clearTimeout(draftListTimerRef.current);
      window.removeEventListener('beforeunload', saveCurrentDraft);
      window.removeEventListener('pagehide', saveCurrentDraft);
    };
  }, []);

  useEffect(() => {
    if (searchInputFocusedRef.current && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  });

  // Visual Viewport API: throttle 200ms
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    let throttleTimer: any = null;
    let lastVpHeight = window.visualViewport?.height || 0;
    const handleViewportChange = () => {
      if (mobileView !== 'chat') return;
      const newH = window.visualViewport?.height || 0;
      if (Math.abs(newH - lastVpHeight) < 80) return;
      lastVpHeight = newH;
      if (throttleTimer) return;
      throttleTimer = setTimeout(() => {
        throttleTimer = null;
        scrollToBottom(true, false);
      }, 200);
    };
    const vp = window.visualViewport;
    vp.addEventListener('resize', handleViewportChange);
    return () => {
      vp.removeEventListener('resize', handleViewportChange);
      if (throttleTimer) clearTimeout(throttleTimer);
    };
  }, [mobileView, scrollToBottom]);

  // Swipe-back listener from Layout
  useEffect(() => {
    const handleAppSwipeBack = (e: Event) => {
      if (contextMenu) { setContextMenu(null); e.preventDefault(); return; }
      if (labelPopoverOpen) { setLabelPopoverOpen(false); e.preventDefault(); return; }
      if (composerRef.current) {
        composerRef.current.closePopovers();
      }
      if (customerDetailModalOpen) { setCustomerDetailModalOpen(false); e.preventDefault(); return; }
      if (addrBookCustomer) { setAddrBookCustomer(null); e.preventDefault(); return; }
      if (customerDetailEditMode) { setCustomerDetailEditMode(false); e.preventDefault(); return; }
      if (showQuickBookingModal) { setShowQuickBookingModal(false); e.preventDefault(); return; }
      if (showInvoiceModal) { setShowInvoiceModal(false); e.preventDefault(); return; }
      if (showSyncInfoModal) { setShowSyncInfoModal(false); e.preventDefault(); return; }
      if (selectedReservation) { setSelectedReservation(null); e.preventDefault(); return; }

      if (mobileView === 'chat') {
        e.preventDefault();
        handleBackToList();
      }
    };
    window.addEventListener('app-swipe-back', handleAppSwipeBack);
    return () => window.removeEventListener('app-swipe-back', handleAppSwipeBack);
  }, [
    mobileView,
    contextMenu,
    labelPopoverOpen,
    customerDetailModalOpen,
    customerDetailEditMode,
    showQuickBookingModal,
    showInvoiceModal,
    showSyncInfoModal,
    selectedReservation,
  ]);

  // Popstate history navigation
  useEffect(() => {
    const handlePopState = (_e: PopStateEvent) => {
      if (contextMenu) { setContextMenu(null); return; }
      if (labelPopoverOpen) { setLabelPopoverOpen(false); return; }
      if (composerRef.current) { composerRef.current.closePopovers(); }
      if (customerDetailModalOpen) { setCustomerDetailModalOpen(false); return; }
      if (customerDetailEditMode) { setCustomerDetailEditMode(false); return; }
      if (showQuickBookingModal) { setShowQuickBookingModal(false); return; }
      if (showInvoiceModal) { setShowInvoiceModal(false); return; }
      if (showSyncInfoModal) { setShowSyncInfoModal(false); return; }
      if (selectedReservation) { setSelectedReservation(null); return; }

      const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
      const urlConvId = params?.get('conversationId') || params?.get('id');
      if (urlConvId) return;

      isChatHistoryPushedRef.current = false;
      if (mobileView === 'chat') {
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
    customerDetailModalOpen,
    customerDetailEditMode,
    showQuickBookingModal,
    showInvoiceModal,
    showSyncInfoModal,
    selectedReservation,
  ]);

  useEffect(() => {
    setMatchingMessageIds([]);
    setCurrentMatchIndex(-1);
    if (pendingFocusMessageIdRef.current) return;
    setHighlightedMsgId(null);
  }, [selectedId]);

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

  useEffect(() => {
    const handleClose = () => setContextMenu(null);
    window.addEventListener('click', handleClose);
    return () => window.removeEventListener('click', handleClose);
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const originalOverflow = document.body.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

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

  return (
    <div data-no-swipe-menu="true" className="h-full flex flex-col min-h-0 space-y-0 lg:space-y-1.5 p-0 lg:p-1.5 lg:pb-0 pt-[env(safe-area-inset-top,0px)]">
      {/* Top Header (Desktop only) */}
      <div className="hidden lg:flex justify-between items-center bg-surface border border-divider rounded-xl px-2.5 sm:px-3 py-1 sm:py-1.5 shadow-xs shrink-0">
        <div className="flex items-center space-x-2">
          <h1 className="text-sm sm:text-base font-bold text-ink tracking-tight flex items-center space-x-1.5">
            <MessageSquare className="text-accent" size={18} />
            <span>Live Chat Monitor</span>
          </h1>
          <span className="px-2 py-0.5 rounded-full bg-accent-soft text-accent text-xs font-bold font-mono border border-accent/30" title="Total percakapan aktif yang dimuat">
            {filteredChats.length} total
          </span>
          <div
            className="flex items-center space-x-1 px-2 py-0.5 bg-fill-1 border border-divider rounded-full text-[10px] font-semibold text-ink-2"
            title={sseConnected ? 'Status: Real-time Terhubung (SSE Aktif)' : 'Status: Menyambungkan kembali ke server...'}
          >
            <span className={`h-2 w-2 rounded-full ${sseConnected ? 'bg-success animate-pulse' : 'bg-warning animate-pulse'}`} />
            <span>{sseConnected ? 'Live' : 'Reconnecting'}</span>
          </div>
          {delayAlert && (
            <button
              type="button"
              onClick={() => {
                const conv = chats.find((c) => c.conversationId && (c as any).activeConfirmedReservation?.id === delayAlert.reservationId);
                if (conv?.conversationId) setSelectedId(conv.conversationId);
              }}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                delayAlert.level === 'critical'
                  ? 'bg-danger-soft border-danger-line text-danger'
                  : 'bg-warning-soft border-warning-line text-warning'
              }`}
              title={`Bidan${delayAlert.staffName ? ' ' + delayAlert.staffName : ''} diprediksi terlambat ${delayAlert.delayMinutes} menit${delayAlert.formattedArrivalWib ? ' (tiba ±' + delayAlert.formattedArrivalWib + ' WIB)' : ''}`}
            >
              <AlertTriangle size={12} />
              <span>Telat {delayAlert.delayMinutes}m</span>
            </button>
          )}
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => {
              const p = new URLSearchParams(searchParams.toString());
              p.set('action', 'export');
              setSearchParams(p, { replace: true });
            }}
            className="p-1.5 rounded-lg bg-surface border border-divider text-ink-2 hover:text-accent hover:border-accent shadow-2xs transition flex items-center justify-center"
            title="Ekspor Chat (Daily Export)"
          >
            <FileText size={14} />
          </button>
          <ToggleSwitch
            checked={chatBotActive}
            onChange={(enableBot) => handleToggleGlobalBot(enableBot)}
            disabled={togglingBotCutoff}
            loading={togglingBotCutoff}
            variant={chatBotActive ? 'emerald' : 'rose'}
            onLabel="BOT ON"
            offLabel="BOT OFF"
            size="sm"
            className="min-h-[44px] py-1"
            title={
              chatBotActive
                ? 'Status: Chatbot AI Aktif (Normal). Klik untuk menonaktifkan AI.'
                : 'Status: Chatbot AI Nonaktif (AI diam, CS manual). Klik untuk mengaktifkan kembali.'
            }
          />
          <button
            onClick={() => setShowSyncInfoModal(true)}
            disabled={bgSyncProgress.isSyncing}
            className="p-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white shadow-2xs transition flex items-center justify-center disabled:opacity-50 cursor-pointer"
            title="Sinkronisasi Seluruh Chat WhatsApp (Background)"
          >
            <RefreshCw size={14} className={bgSyncProgress.isSyncing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Internal Chatbot OFF Warning Banner */}
      {!chatBotActive && (
        <div className="hidden lg:flex p-2 sm:p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800/40 text-amber-900 dark:text-amber-200 text-xs font-semibold items-center justify-between shadow-2xs shrink-0 animate-fadeIn">
          <div className="flex items-center space-x-2 min-w-0">
            <ShieldAlert size={16} className="text-amber-600 dark:text-warning shrink-0" />
            <div className="truncate">
              <span className="font-bold text-amber-700 dark:text-warning">CHATBOT AI NONAKTIF:</span>{' '}
              <span className="text-amber-800 dark:text-amber-200">AI diam, dialihkan ke CS manual. Follow-Up & balasan Live Chat manual tetap aktif.</span>
            </div>
          </div>
          <button
            onClick={() => handleToggleGlobalBot(true)}
            disabled={togglingBotCutoff}
            className="px-2.5 py-1 text-[11px] font-bold text-on-solid bg-success hover:bg-success-hover rounded-lg transition shrink-0 ml-2 cursor-pointer shadow-2xs"
          >
            Aktifkan AI
          </button>
        </div>
      )}

      {/* Real-time Background Sync Banner */}
      {bgSyncProgress.isSyncing && (
        <div className="hidden lg:flex p-2 sm:p-2.5 rounded-xl bg-success-soft border border-success-line text-success text-[11px] font-medium items-center justify-between shadow-2xs shrink-0 animate-fadeIn">
          <div className="flex items-center space-x-2 min-w-0">
            <RefreshCw size={14} className="text-accent animate-spin shrink-0" />
            <div className="truncate">
              <span className="font-bold text-accent">Sinkronisasi Background Berjalan:</span>{' '}
              <span>
                {bgSyncProgress.syncedChats} / {bgSyncProgress.totalChats || '?'} chat ({bgSyncProgress.syncedMessages} pesan baru)
                {bgSyncProgress.currentChatName ? ` • Sedang memproses: ${bgSyncProgress.currentChatName}` : ''}
              </span>
            </div>
          </div>
          <button
            onClick={handleCancelBackgroundSync}
            className="px-2.5 py-0.5 text-[10px] font-bold text-danger bg-danger-soft hover:bg-danger border border-danger-line rounded-md transition shrink-0 ml-2 cursor-pointer shadow-2xs"
          >
            Batalkan
          </button>
        </div>
      )}

      {syncProgress && !bgSyncProgress.isSyncing && (
        <div className="hidden lg:flex p-2 rounded-xl bg-info-soft border border-info-line text-info text-[11px] font-medium items-center space-x-2 shrink-0">
          <RefreshCw size={12} className="text-info animate-spin" />
          <span>{syncProgress}</span>
        </div>
      )}

      {errorMessage && (
        <div className="hidden lg:flex p-2 rounded-xl bg-danger-soft border border-danger-line text-danger text-[11px] font-medium items-center space-x-2 shrink-0">
          <AlertTriangle size={13} className="text-danger" />
          <span>{errorMessage}</span>
        </div>
      )}

      {loading && chats.length === 0 ? (
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto overscroll-contain px-1.5 sm:px-2.5 pt-1.5 pb-2" style={{ overscrollBehavior: 'contain' }}>
          {!chatBotActive && <AiOffStrip />}
          <div className="flex-1 flex justify-center items-center py-20">
            <Loader className="animate-spin text-accent" size={32} />
          </div>
        </div>
      ) : (
        <div data-no-swipe-menu="true" className="flex-1 min-h-0 flex flex-col lg:flex-row gap-0 lg:gap-2 overflow-hidden">
          {/* Section 1: Conversations List */}
          <LiveChatThreadList
            mobileView={mobileView}
            isDesktop={isDesktop}
            chatListContainerRef={chatListContainerRef}
            filteredChats={filteredChats}
            sortedChats={sortedChats}
            chats={chats}
            selectedId={selectedId}
            sseConnected={sseConnected}
            delayAlert={delayAlert}
            copilotOpen={copilotOpen}
            setCopilotOpen={setCopilotOpen}
            user={user}
            bgSyncProgress={bgSyncProgress}
            syncProgress={syncProgress}
            errorMessage={errorMessage}
            sourceFilter={sourceFilter}
            setSourceFilter={setSourceFilter}
            labelFilter={labelFilter}
            setLabelFilter={setLabelFilter}
            reservationStaffFilter={reservationStaffFilter}
            setReservationStaffFilter={setReservationStaffFilter}
            reservationStaffList={reservationStaffList}
            totalUnreadCount={totalUnreadCount}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            isSearching={isSearching}
            searchInputRef={searchInputRef}
            triggerDebouncedSearch={triggerDebouncedSearch}
            handleClearInChatSearch={handleClearInChatSearch}
            loadChats={loadChats}
            chatBotActive={chatBotActive}
            togglingBotCutoff={togglingBotCutoff}
            handleToggleGlobalBot={handleToggleGlobalBot}
            handleMarkAllAsRead={handleMarkAllAsRead}
            setShowSyncInfoModal={setShowSyncInfoModal}
            handleCancelBackgroundSync={handleCancelBackgroundSync}
            openMobileMenu={openMobileMenu}
            hasMore={hasMore}
            loadingMore={loadingMore}
            draftTick={draftTick}
            replyTextRef={replyTextRef}
            handleSelect={handleSelect}
            setContextMenu={setContextMenu}
            handleRelease={handleRelease}
            releasingId={releasingId}
            setInChatSearchQuery={setInChatSearchQuery}
            setInChatSearchOpen={setInChatSearchOpen}
            pendingFocusMessageIdRef={pendingFocusMessageIdRef}
            selectedIdRef={selectedIdRef}
            loadThread={loadThread}
            searchDebounceTimerRef={searchDebounceTimerRef}
            searchInputFocusedRef={searchInputFocusedRef}
          />

          {/* Section 2: Right Panel - Live Chat Messages */}
          <LiveChatMessagePane
            mobileView={mobileView}
            selectedChat={selectedChat}
            selectedIdRef={selectedIdRef}
            chatsRef={chatsRef}
            setChats={setChats}
            loadThread={loadThread}
            wasNearBottomRef={wasNearBottomRef}
            savedScrollTopRef={savedScrollTopRef}
            searchQuery={searchQuery}
            handleReservationUpdate={handleReservationUpdate}
            setSelectedReservation={setSelectedReservation}
            setActiveEditingConfirmedReservation={setActiveEditingConfirmedReservation}
            setShowQuickBookingModal={setShowQuickBookingModal}
            markSharelocRequested={markSharelocRequested}
            setIsPinningMessageId={setIsPinningMessageId}
            gatewayCapability={gatewayCapability}
            selectedId={selectedId}
            messages={messages}
            isThreadLoading={isThreadLoading}
            threadLoadError={threadLoadError}
            hasMoreOlderMessages={hasMoreOlderMessages}
            isLoadingOlder={isLoadingOlder}
            loadOlderMessages={loadOlderMessages}
            chatContainerRef={chatContainerRef}
            messagesEndRef={messagesEndRef}
            composerRef={composerRef}
            fileInputRef={fileInputRef}
            inChatSearchInputRef={inChatSearchInputRef}
            inChatSearchOpen={inChatSearchOpen}
            setInChatSearchOpen={setInChatSearchOpen}
            inChatSearchQuery={inChatSearchQuery}
            setInChatSearchQuery={setInChatSearchQuery}
            matchingMessageIds={matchingMessageIds}
            currentMatchIndex={currentMatchIndex}
            isDeepSearching={isDeepSearching}
            handlePrevMatch={handlePrevMatch}
            handleNextMatch={handleNextMatch}
            handleClearInChatSearch={handleClearInChatSearch}
            handleDeepSearchInHistory={handleDeepSearchInHistory}
            highlightedMsgId={highlightedMsgId}
            handleBackToList={handleBackToList}
            handleOpenCustomerDetail={handleOpenCustomerDetail}
            handleToggleLabel={handleToggleLabel}
            allLabels={allLabels}
            togglingLabelId={togglingLabelId}
            labelPopoverOpen={labelPopoverOpen}
            setLabelPopoverOpen={setLabelPopoverOpen}
            labelPopoverRef={labelPopoverRef}
            activeHoldReservation={activeHoldReservation}
            activeConfirmedReservation={activeConfirmedReservation}
            activePendingReservation={activePendingReservation}
            currentActiveReservation={currentActiveReservation}
            dispatchTrip={dispatchTrip}
            setDispatchDrawerOpen={setDispatchDrawerOpen}
            chatBotActive={chatBotActive}
            handleToggleGlobalBot={handleToggleGlobalBot}
            releasingId={releasingId}
            handleRelease={handleRelease}
            handleTakeover={handleTakeover}
            handleToggleReadStatus={handleToggleReadStatus}
            copilotOpen={copilotOpen}
            setCopilotOpen={setCopilotOpen}
            showFormReservasiBanner={showFormReservasiBanner}
            showNeutralExistingReservationBanner={showNeutralExistingReservationBanner}
            showUnregisteredVisitBanner={showUnregisteredVisitBanner}
            formBannerExtracted={formBannerExtracted}
            formBannerKey={formBannerKey}
            matchedExistingReservation={matchedExistingReservation}
            setDismissedFormBanner={setDismissedFormBanner}
            handleOpenQuickReservation={handleOpenQuickReservation}
            handleOpenQuickHold={handleOpenQuickHold}
            handleConfirmPendingBooking={handleConfirmPendingBooking}
            handleConvertHoldToBooking={handleConvertHoldToBooking}
            handleJumpToPinnedMessage={handleJumpToPinnedMessage}
            pinnedBubble={pinnedBubble}
            setPinnedBubble={setPinnedBubble}
            isPinningMessageId={isPinningMessageId}
            isHidingMessageId={isHidingMessageId}
            revokingId={revokingId}
            handleSelectReply={handleSelectReply}
            handleCopyMessageText={handleCopyMessageText}
            handleToggleMessagePin={handleToggleMessagePin}
            handleToggleMessageHide={handleToggleMessageHide}
            handleRevokeMessage={handleRevokeMessage}
            handleStartEdit={handleStartEdit}
            handleToggleReaction={handleToggleReaction}
            setProofModalReservation={setProofModalReservation}
            sending={sending}
            generatingDraft={generatingDraft}
            replyingTo={replyingTo}
            setReplyingTo={setReplyingTo}
            selectedImage={selectedImage}
            quickReplies={quickReplies}
            handleComposerTextChange={handleComposerTextChange}
            notifyTyping={notifyTyping}
            handleSendReply={handleSendReply}
            applyQuickReply={applyQuickReply}
            handlePickImage={handlePickImage}
            handleImageFile={handleImageFile}
            handleRemoveSelectedImage={handleRemoveSelectedImage}
            handleGenerateAiDraft={handleGenerateAiDraft}
            setShowDailyScheduleModal={setShowDailyScheduleModal}
            handleGenerateActiveReservationInvoice={handleGenerateActiveReservationInvoice}
            scrollToBottom={scrollToBottom}
          />

          {/* Sidebar Kanan: Dispatch Radar */}
          {dispatchTrip && !dispatchTrip.arrivedAt && !['completed', 'cancelled', 'rejected'].includes(String(dispatchTrip.status || '')) && (
            <div className="hidden xl:flex xl:w-[340px] xl:shrink-0 p-2 overflow-y-auto">
              <div className="w-full">
                <LiveChatDispatchWidget
                  data={dispatchTrip}
                  loading={dispatchLoading}
                  staffName={dispatchTrip.staffName || null}
                  onRefresh={() => {
                    if (dispatchReservationId) loadDispatchTrip(dispatchReservationId);
                  }}
                  onContactStaff={() => {
                    if (dispatchTrip.staffPhone) {
                      window.location.href = `tel:${dispatchTrip.staffPhone}`;
                    } else {
                      toast('Nomor Bidan belum tersedia.', 'info');
                    }
                  }}
                  onInsertText={handleInsertDispatchDraft}
                  locationSource={dispatchLocationSource}
                  onRequestShareloc={handleRequestSharelocFromDispatch}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Drawer Radar OTW untuk laptop <1280px */}
      {dispatchDrawerOpen && dispatchTrip && (
        <div
          data-modal-active="true"
          className="fixed inset-0 z-50 flex justify-end bg-black/40 xl:hidden"
          onClick={() => setDispatchDrawerOpen(false)}
        >
          <div
            className="h-full w-full max-w-sm bg-surface-2 shadow-2xl p-3 overflow-y-auto animate-fadeIn"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-sm font-bold text-ink flex items-center gap-1.5">
                <Radar size={16} className="text-accent" /> Radar OTW Bidan
              </span>
              <button
                type="button"
                onClick={() => setDispatchDrawerOpen(false)}
                className="p-1.5 rounded-lg hover:bg-fill-2 text-ink-2"
                aria-label="Tutup radar OTW"
              >
                ✕
              </button>
            </div>
            <LiveChatDispatchWidget
              data={dispatchTrip}
              loading={dispatchLoading}
              staffName={dispatchTrip.staffName || null}
              onRefresh={() => {
                if (dispatchReservationId) loadDispatchTrip(dispatchReservationId);
              }}
              onContactStaff={() => {
                if (dispatchTrip.staffPhone) {
                  window.location.href = `tel:${dispatchTrip.staffPhone}`;
                } else {
                  toast('Nomor Bidan belum tersedia.', 'info');
                }
              }}
              onInsertText={handleInsertDispatchDraft}
              locationSource={dispatchLocationSource}
              onRequestShareloc={handleRequestSharelocFromDispatch}
            />
          </div>
        </div>
      )}

      <LiveChatModals
        customerDetailModalOpen={customerDetailModalOpen}
        activeEditingHoldReservation={activeEditingHoldReservation}
        setActiveEditingHoldReservation={setActiveEditingHoldReservation}
        convertingHoldId={convertingHoldId}
        setConvertingHoldId={setConvertingHoldId}
        quickBookingTargetSlot={quickBookingTargetSlot}
        setQuickBookingTargetSlot={setQuickBookingTargetSlot}
        quickBookingExtracted={quickBookingExtracted}
        setQuickBookingExtracted={setQuickBookingExtracted}
        setCustomerDetailModalOpen={setCustomerDetailModalOpen}
        customerDetailData={customerDetailData}
        setCustomerDetailData={setCustomerDetailData}
        selectedChat={selectedChat}
        customerDetailLoading={customerDetailLoading}
        savedAddressCount={savedAddressCount}
        setSavedAddressCount={setSavedAddressCount}
        customerDetailEditMode={customerDetailEditMode}
        setCustomerDetailEditMode={setCustomerDetailEditMode}
        handleSaveCustomerDetail={handleSaveCustomerDetail}
        addrBookCustomer={addrBookCustomer}
        setAddrBookCustomer={setAddrBookCustomer}
        selectedReservation={selectedReservation}
        setSelectedReservation={setSelectedReservation}
        reservationStaffList={reservationStaffList}
        user={user}
        handleReservationUpdate={handleReservationUpdate}
        proofModalReservation={proofModalReservation}
        setProofModalReservation={setProofModalReservation}
        showQuickBookingModal={showQuickBookingModal}
        setShowQuickBookingModal={setShowQuickBookingModal}
        activeEditingConfirmedReservation={activeEditingConfirmedReservation}
        setActiveEditingConfirmedReservation={setActiveEditingConfirmedReservation}
        handleInsertInvoiceToChat={handleInsertInvoiceToChat}
        showQuickHoldModal={showQuickHoldModal}
        setShowQuickHoldModal={setShowQuickHoldModal}
        quickHoldInitialDate={quickHoldInitialDate}
        setQuickHoldInitialDate={setQuickHoldInitialDate}
        quickHoldInitialTime={quickHoldInitialTime}
        setQuickHoldInitialTime={setQuickHoldInitialTime}
        setChats={setChats}
        chatsRef={chatsRef}
        loadChats={loadChats}
        showDailyScheduleModal={showDailyScheduleModal}
        setShowDailyScheduleModal={setShowDailyScheduleModal}
        handleSlotHold={handleSlotHold}
        showInvoiceModal={showInvoiceModal}
        setShowInvoiceModal={setShowInvoiceModal}
        invoiceModalData={invoiceModalData}
        clinicServices={clinicServices}
        contextMenu={contextMenu}
        setContextMenu={setContextMenu}
        allLabels={allLabels}
        togglingLabelId={togglingLabelId}
        handleTogglePin={handleTogglePin}
        handleToggleReadStatus={handleToggleReadStatus}
        handleTakeover={handleTakeover}
        handleRelease={handleRelease}
        handleDismissFrustration={handleDismissFrustration}
        handleToggleLabel={handleToggleLabel}
        editingMsg={editingMsg}
        setEditingMsg={setEditingMsg}
        isEditingSaving={isEditingSaving}
        editContent={editContent}
        setEditContent={setEditContent}
        handleSaveEdit={handleSaveEdit}
        searchParams={searchParams}
        setSearchParams={setSearchParams}
        showSyncInfoModal={showSyncInfoModal}
        setShowSyncInfoModal={setShowSyncInfoModal}
        handleStartBackgroundFullSync={handleStartBackgroundFullSync}
      />

      <AdminCopilotPanel conversationId={selectedChat?.conversationId} customerId={selectedChat?.customerId} />
    </div>
  );
};
