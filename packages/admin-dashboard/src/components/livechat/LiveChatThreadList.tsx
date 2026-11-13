import React, { useRef, useState } from 'react';
import {
  MessageSquare,
  AlertTriangle,
  Bot,
  User,
  Loader,
  CheckCircle,
  ShoppingBag,
  FlaskConical,
  RefreshCw,
  Search,
  PenLine,
  MailCheck,
  X,
  Pin,
  Menu,
  Zap,
  Facebook,
  Archive,
  ArrowDownLeft,
  CheckCheck,
  Layers,
  MessageSquareDot,
} from 'lucide-react';
import { CustomerAvatar } from '../common/CustomerAvatar';
import { StaffOwnershipBadge } from '../common/StaffOwnershipBadge';
import { AiOffStrip } from './AiOffStrip';
import { ToggleSwitch } from '../common/ToggleSwitch';
import { renderHighlightedText, extractSmartSearchSnippet } from '../../utils/livechatSearch';
import { formatLastChatWib } from '../../utils/dateWib';
import type { LiveChatItem } from '../../types/livechat';
import type { SourceFilter } from '../../utils/livechatSourceFilter';
import { getSharelocCardStatus } from '../../utils/sharelocCardStatus';
import { resolveChatSenderIndicator } from '../../utils/chatSenderIndicator';
import { loadConversationDraft } from '../../hooks/useLiveChatDrafts';
import { formatRupiah } from '../../utils/money';

const formatLastChat = (dateStr: string | null) => {
  return formatLastChatWib(dateStr);
};

export interface LiveChatThreadListProps {
  mobileView: 'list' | 'chat';
  isDesktop: boolean;
  chatListContainerRef: React.RefObject<HTMLDivElement>;
  filteredChats: LiveChatItem[];
  sortedChats: LiveChatItem[];
  chats: LiveChatItem[];
  selectedId: string | null;
  sseConnected: boolean;
  delayAlert: any;
  copilotOpen: boolean;
  setCopilotOpen: (v: boolean) => void;
  user: any;
  bgSyncProgress: any;
  syncProgress: string | null;
  errorMessage: string | null;
  sourceFilter: SourceFilter;
  setSourceFilter: (f: SourceFilter) => void;
  labelFilter: 'all' | 'medical_concern' | 'unresolved_faq' | 'human_request';
  setLabelFilter: (l: 'all' | 'medical_concern' | 'unresolved_faq' | 'human_request') => void;
  reservationStaffFilter: string;
  setReservationStaffFilter: (s: string) => void;
  reservationStaffList: any[];
  totalUnreadCount: number;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  isSearching: boolean;
  searchInputRef: React.RefObject<HTMLInputElement>;
  triggerDebouncedSearch: (q: string) => void;
  handleClearInChatSearch: () => void;
  loadChats: (reset?: boolean, q?: string, isSearch?: boolean) => Promise<void>;
  chatBotActive: boolean;
  togglingBotCutoff: boolean;
  handleToggleGlobalBot: (enable: boolean) => void;
  handleMarkAllAsRead: () => void;
  setShowSyncInfoModal: (v: boolean) => void;
  handleCancelBackgroundSync: () => void;
  openMobileMenu: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  draftTick: number;
  replyTextRef: React.MutableRefObject<string>;
  handleSelect: (convId: string) => void;
  setContextMenu: (ctx: { x: number; y: number; chat: LiveChatItem } | null) => void;
  handleRelease: (chat: LiveChatItem) => void;
  releasingId: string | null;
  setInChatSearchQuery: (q: string) => void;
  setInChatSearchOpen: (v: boolean) => void;
  pendingFocusMessageIdRef: React.MutableRefObject<string | null>;
  selectedIdRef: React.MutableRefObject<string | null>;
  loadThread: (convId: string, focusId?: string) => Promise<void>;
  searchDebounceTimerRef: React.MutableRefObject<any>;
  searchInputFocusedRef: React.MutableRefObject<boolean>;
}

export const LiveChatThreadList: React.FC<LiveChatThreadListProps> = ({
  mobileView,
  isDesktop,
  chatListContainerRef,
  filteredChats,
  sortedChats,
  chats,
  selectedId,
  sseConnected,
  delayAlert,
  copilotOpen,
  setCopilotOpen,
  user,
  bgSyncProgress,
  syncProgress,
  errorMessage,
  sourceFilter,
  setSourceFilter,
  labelFilter,
  setLabelFilter,
  reservationStaffFilter,
  setReservationStaffFilter,
  reservationStaffList,
  totalUnreadCount,
  searchQuery,
  setSearchQuery,
  isSearching,
  searchInputRef,
  triggerDebouncedSearch,
  handleClearInChatSearch,
  loadChats,
  chatBotActive,
  togglingBotCutoff,
  handleToggleGlobalBot,
  handleMarkAllAsRead,
  setShowSyncInfoModal,
  handleCancelBackgroundSync,
  openMobileMenu,
  hasMore,
  loadingMore,
  draftTick,
  replyTextRef,
  handleSelect,
  setContextMenu,
  handleRelease,
  releasingId,
  setInChatSearchQuery,
  setInChatSearchOpen,
  pendingFocusMessageIdRef,
  selectedIdRef,
  loadThread,
  searchDebounceTimerRef,
  searchInputFocusedRef,
}) => {
  const [iconTooltip, setIconTooltip] = useState<string | null>(null);
  const iconTooltipTimerRef = useRef<any>(null);

  const handleIconTouchStart = (title: string) => {
    if (iconTooltipTimerRef.current) clearTimeout(iconTooltipTimerRef.current);
    iconTooltipTimerRef.current = setTimeout(() => {
      setIconTooltip(title);
    }, 350);
  };

  const handleIconTouchEnd = () => {
    if (iconTooltipTimerRef.current) {
      clearTimeout(iconTooltipTimerRef.current);
      iconTooltipTimerRef.current = null;
    }
    setTimeout(() => setIconTooltip(null), 1200);
  };

  const listTouchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const longPressTimerRef = useRef<any>(null);
  const longPressTriggeredRef = useRef(false);
  const longPressTouchRef = useRef<{ x: number; y: number } | null>(null);

  const handleListTouchStart = (e: React.TouchEvent) => {
    if (mobileView !== 'list' || e.touches.length !== 1) return;
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.tagName === 'BUTTON' ||
        target.closest('button') ||
        target.closest('input') ||
        target.closest('textarea'))
    ) {
      listTouchStartRef.current = null;
      return;
    }
    const touch = e.touches[0];
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
    if (deltaX > 10 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
      if (e.cancelable) e.preventDefault();
    }
  };

  return (
    <div
      onTouchStart={handleListTouchStart}
      onTouchMove={handleListTouchMove}
      onTouchEnd={() => {
        listTouchStartRef.current = null;
      }}
      onTouchCancel={() => {
        listTouchStartRef.current = null;
      }}
      className={`${
        mobileView === 'chat' ? 'hidden lg:flex' : 'flex animate-mobile-list-enter lg:animate-none'
      } w-full lg:w-[320px] xl:w-[360px] lg:shrink-0 flex-col h-full bg-surface border-0 lg:border border-divider rounded-none lg:rounded-2xl shadow-none lg:shadow-xs overflow-hidden min-h-0`}
    >
      {/* Scrollable Container covering entire panel: Header & filter bar scroll off, Searchbar sticks at top-0 */}
      <div
        ref={chatListContainerRef}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-1.5 sm:px-2.5 pt-1.5 pb-2"
        style={{ overscrollBehavior: 'contain' }}
      >
        {/* Mobile Page Header (Inside scroll flow so it scrolls off on scroll down) */}
        <div className="flex lg:hidden justify-between items-center pb-2 border-b border-divider mb-1.5">
          <div className="flex items-center space-x-2">
            <h1 className="text-sm font-bold text-ink tracking-tight flex items-center space-x-1.5">
              <MessageSquare className="text-accent" size={16} />
              <span>Live Chat</span>
            </h1>
            <span
              className="px-2 py-0.5 rounded-full bg-accent-soft text-accent text-xs font-bold font-mono border border-accent/30"
              title="Total percakapan aktif yang dimuat"
            >
              {filteredChats.length} total
            </span>
            <div className="flex items-center space-x-1 px-1.5 py-0.5 bg-fill-1 border border-divider rounded-full text-[10px] font-semibold text-ink-2">
              <span className={`h-1.5 w-1.5 rounded-full ${sseConnected ? 'bg-success' : 'bg-warning'}`} />
              <span>{sseConnected ? 'Live' : 'Offline'}</span>
            </div>
            {delayAlert && (
              <div
                className={`flex items-center space-x-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${
                  delayAlert.level === 'critical'
                    ? 'bg-danger-soft border-danger-line text-danger'
                    : 'bg-warning-soft border-warning-line text-warning'
                }`}
                title={`Bidan diprediksi terlambat ${delayAlert.delayMinutes} menit`}
              >
                <AlertTriangle size={11} />
                <span>{delayAlert.delayMinutes}m</span>
              </div>
            )}
          </div>

          <div className="flex items-center space-x-1.5">
            {/* Pengganti tombol copilot header global (ADR-001: tenant non-owner disembunyikan) */}
            {user?.copilotEnabled !== false && (
              <button
                type="button"
                onClick={() => setCopilotOpen(!copilotOpen)}
                title={copilotOpen ? 'Sembunyikan AI Copilot' : 'Buka AI Copilot'}
                aria-label={copilotOpen ? 'Sembunyikan AI Copilot' : 'Buka AI Copilot'}
                aria-pressed={copilotOpen}
                className={`lg:hidden p-1.5 min-w-[38px] min-h-[38px] rounded-lg border transition flex items-center justify-center cursor-pointer shadow-2xs active:scale-95 touch-manipulation ${
                  copilotOpen
                    ? 'bg-bubble-out dark:bg-accent/20 border-accent/40 text-accent ring-2 ring-accent/30'
                    : 'bg-fill-1 dark:bg-fill-2 border-divider dark:border-strong text-ink-3 hover:text-ink dark:hover:text-ink'
                }`}
              >
                <Bot size={15} />
              </button>
            )}
            {/* Tombol sinkronisasi chat */}
            <button
              onClick={() => setShowSyncInfoModal(true)}
              disabled={bgSyncProgress.isSyncing}
              className="p-1.5 min-w-[38px] min-h-[38px] rounded-lg bg-accent text-on-solid shadow-2xs transition flex items-center justify-center disabled:opacity-50 cursor-pointer"
              title="Sinkronisasi Seluruh Chat WhatsApp"
            >
              <RefreshCw size={13} className={bgSyncProgress.isSyncing ? 'animate-spin' : ''} />
            </button>
            {/* Tombol ☰ menu navigasi mobile (paling kanan) */}
            <button
              type="button"
              onClick={openMobileMenu}
              aria-label="Buka Menu"
              title="Buka Menu Navigasi"
              className="lg:hidden p-1.5 min-w-[38px] min-h-[38px] rounded-lg bg-fill-1 dark:bg-fill-2 text-ink-2 dark:text-ink-2 hover:text-ink dark:hover:text-ink transition active:scale-95 touch-manipulation cursor-pointer shadow-2xs flex items-center justify-center"
            >
              <Menu size={15} />
            </button>
          </div>
        </div>

        {/* Mobile Chatbot OFF Warning (strip teks; toggle ada di sticky search bar) */}
        {!chatBotActive && <AiOffStrip />}

        {/* Mobile Sync/Error Warnings (ikut scroll bersama daftar; desktop memakai banner global di atas) */}
        {bgSyncProgress.isSyncing && (
          <div className="lg:hidden mb-1.5 p-2 rounded-xl bg-success-soft border border-success-line text-success text-[11px] font-medium flex items-center justify-between shadow-2xs animate-fadeIn">
            <div className="flex items-center space-x-1.5 min-w-0">
              <RefreshCw size={13} className="text-accent animate-spin shrink-0" />
              <span className="truncate">
                <span className="font-bold text-accent">Sync:</span> {bgSyncProgress.syncedChats} / {bgSyncProgress.totalChats || '?'} chat ({bgSyncProgress.syncedMessages} baru)
              </span>
            </div>
            <button
              onClick={handleCancelBackgroundSync}
              className="px-2 py-0.5 text-[10px] font-bold text-danger bg-danger-soft hover:bg-danger border border-danger-line rounded-md transition shrink-0 ml-2 cursor-pointer shadow-2xs"
            >
              Batal
            </button>
          </div>
        )}
        {syncProgress && !bgSyncProgress.isSyncing && (
          <div className="lg:hidden mb-1.5 p-2 rounded-xl bg-info-soft border border-info-line text-info text-[11px] font-medium flex items-center space-x-1.5 shadow-2xs">
            <RefreshCw size={12} className="text-info animate-spin shrink-0" />
            <span className="truncate">{syncProgress}</span>
          </div>
        )}
        {errorMessage && (
          <div className="lg:hidden mb-1.5 p-2 rounded-xl bg-danger-soft border border-danger-line text-danger text-[11px] font-medium flex items-center space-x-1.5 shadow-2xs">
            <AlertTriangle size={12} className="text-danger shrink-0" />
            <span className="truncate">{errorMessage}</span>
          </div>
        )}

        {/* Header Toolbar: Source Filter + Label Dropdown (Normal in-flow, scrolls away on scroll down) */}
        <div className="pb-1.5 border-b border-divider">
          <div className="flex items-center justify-between gap-1.5">
            {/* Filter sumber percakapan: WhatsApp Asli, Semua, Sandbox (Ikon Saja + Press Hold Tooltip) */}
            <div className="relative flex items-center space-x-0.5 p-0.5 bg-fill-1 border border-divider rounded-lg shrink-0">
              {[
                { value: 'all', title: 'Semua Percakapan WhatsApp', icon: Layers },
                { value: 'unread', title: 'Pesan Belum Dibaca (Unread)', icon: MessageSquareDot },
                { value: 'reservation', title: 'Reservasi Aktif (Pending/Hold/Terjadwal)', icon: ShoppingBag },
                { value: 'sandbox', title: 'QA Tester / Sandbox (Simulasi Lokal)', icon: FlaskConical },
              ].map((opt) => {
                const Icon = opt.icon;
                const isActive = sourceFilter === opt.value;
                const activeClass =
                  opt.value === 'sandbox'
                    ? 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-ink-2 border border-purple-200 dark:border-divider shadow-2xs'
                    : 'bg-accent-soft text-accent border border-accent/30 shadow-2xs';
                const hasUnreadBadge =
                  opt.value === 'unread' &&
                  (totalUnreadCount > 0 ||
                    chats.some((c) => !c.isSandboxTest && ((c.unreadCount || 0) > 0 || c.isManualUnread)));
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
                      isActive ? activeClass : 'text-ink-2 hover:text-ink'
                    }`}
                  >
                    <Icon size={13} />
                    {hasUnreadBadge && (
                      <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-success ring-1 ring-white" />
                    )}
                  </button>
                );
              })}

              {/* Press-Hold Floating Tooltip */}
              {iconTooltip && (
                <div className="absolute top-full left-0 mt-1 z-50 px-2 py-1 bg-ink text-white text-[10px] font-bold rounded-lg shadow-lg animate-fadeIn whitespace-nowrap pointer-events-none flex items-center space-x-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-success" />
                  <span>{iconTooltip}</span>
                </div>
              )}
            </div>

            {/* Label Filter Dropdown & Mark All Read (Disampingnya) */}
            <div className="flex items-center space-x-1 flex-1 min-w-0">
              {(isDesktop || mobileView === 'list') && sourceFilter === 'reservation' && (
                <select
                  value={reservationStaffFilter}
                  onChange={(e) => setReservationStaffFilter(e.target.value)}
                  className="w-full px-2 py-1 bg-surface border border-divider rounded-lg text-[11px] font-semibold text-ink focus:outline-none focus:border-accent cursor-pointer shadow-2xs truncate"
                  title="Filter bidan yang bertugas"
                >
                  <option value="all">Semua Bidan</option>
                  <option value="unassigned">Belum Ada Bidan</option>
                  {reservationStaffList
                    .filter((s: any) => s.role === 'THERAPIST' && s.active !== false)
                    .map((s: any) => (
                      <option key={s.id} value={s.id}>
                        Bidan {s.name}
                      </option>
                    ))}
                </select>
              )}

              {(isDesktop || mobileView === 'list') && sourceFilter !== 'reservation' && (
                <select
                  value={labelFilter}
                  onChange={(e) => {
                    setLabelFilter(e.target.value as 'all' | 'medical_concern' | 'unresolved_faq' | 'human_request');
                  }}
                  className="w-full px-2 py-1 bg-surface border border-divider rounded-lg text-[11px] font-semibold text-ink focus:outline-none focus:border-accent cursor-pointer shadow-2xs truncate"
                >
                  <option value="all">Semua Label</option>
                  <option value="human_request">Human Request</option>
                  <option value="medical_concern">Medical Emergency</option>
                  <option value="unresolved_faq">Unresolved FAQ</option>
                </select>
              )}

              <button
                aria-label="Tandai semua percakapan sebagai telah dibaca"
                type="button"
                onClick={handleMarkAllAsRead}
                tabIndex={mobileView === 'chat' ? -1 : 0}
                title="Tandai semua percakapan sebagai telah dibaca"
                className="p-2 min-w-[38px] min-h-[38px] bg-surface hover:bg-accent-soft border border-divider hover:border-accent/30 text-ink-2 hover:text-accent rounded-lg transition flex items-center justify-center shrink-0 cursor-pointer shadow-2xs active:scale-95"
              >
                <MailCheck size={14} className="text-accent" />
              </button>
            </div>
          </div>
        </div>

        {/* 🔍 Search Bar Input: STICKY AT TOP ONLY (Searchbar & AI Toggle Stick Bersama Saat Scroll di Mobile) */}
        {(isDesktop || mobileView === 'list') && (
          <div className="sticky top-0 z-20 bg-surface py-1.5 border-b border-divider shadow-xs -mx-1 px-1">
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1 min-w-0">
                <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-ink-3">
                  {isSearching ? <Loader size={13} className="animate-spin text-accent" /> : <Search size={13} />}
                </span>
                <input
                  ref={searchInputRef}
                  type="text"
                  tabIndex={mobileView === 'chat' ? -1 : 0}
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    triggerDebouncedSearch(e.target.value);
                  }}
                  onFocus={() => {
                    searchInputFocusedRef.current = true;
                  }}
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      searchInputFocusedRef.current = false;
                    }
                  }}
                  placeholder="Cari nama, no. HP, atau keyword chat..."
                  className="w-full pl-8 pr-7 py-1.5 bg-fill-1 hover:bg-fill-2 focus:bg-surface border border-divider focus:border-accent rounded-lg text-xs text-ink placeholder-ink-3 focus:outline-none focus:ring-1 focus:ring-accent/20 transition shadow-2xs"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      if (searchDebounceTimerRef.current) {
                        clearTimeout(searchDebounceTimerRef.current);
                        searchDebounceTimerRef.current = null;
                      }
                      setSearchQuery('');
                      loadChats(true, '', true);
                      handleClearInChatSearch();
                    }}
                    className="absolute inset-y-0 right-0 pr-2 flex items-center text-ink-3 hover:text-ink cursor-pointer"
                    title="Hapus pencarian"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              {/* Mobile Sticky AI Toggle: Melayang bersama Search Bar agar mudah diakses saat scroll */}
              <div
                className="lg:hidden shrink-0 flex items-center"
                title={chatBotActive ? 'Chatbot AI Aktif' : 'Chatbot AI Nonaktif'}
              >
                <ToggleSwitch
                  checked={chatBotActive}
                  onChange={(enableBot) => handleToggleGlobalBot(enableBot)}
                  disabled={togglingBotCutoff}
                  loading={togglingBotCutoff}
                  variant={chatBotActive ? 'emerald' : 'rose'}
                  onLabel="ON"
                  offLabel="OFF"
                  size="sm"
                  className="min-h-[44px] py-1.5"
                />
              </div>
            </div>
          </div>
        )}

        {/* Chat Cards or Empty State */}
        {filteredChats.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 text-center text-ink-2 text-xs min-h-[180px]">
            {searchQuery ? (
              <>
                <Search className="mx-auto text-ink-3 mb-2 opacity-50" size={24} />
                <p className="font-bold text-ink">Tidak ada hasil pencarian</p>
                <p className="text-ink-2 text-[10px] mt-0.5">
                  Tidak ditemukan chat dengan kata kunci &quot;{searchQuery}&quot;
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (searchDebounceTimerRef.current) {
                      clearTimeout(searchDebounceTimerRef.current);
                      searchDebounceTimerRef.current = null;
                    }
                    setSearchQuery('');
                    loadChats(true, '', true);
                    handleClearInChatSearch();
                  }}
                  className="mt-2.5 px-2.5 py-1 rounded-lg bg-fill-1 hover:bg-fill-2 text-accent text-[11px] font-semibold transition cursor-pointer"
                >
                  Reset Pencarian
                </button>
              </>
            ) : sourceFilter === 'unread' ? (
              <>
                <CheckCircle className="mx-auto text-accent mb-2" size={24} />
                <p className="font-bold text-ink">Semua pesan sudah dibaca! </p>
                <p className="text-ink-2 text-[10px] mt-0.5">
                  Tidak ada percakapan yang menunggu dibalas saat ini.
                </p>
              </>
            ) : sourceFilter === 'reservation' ? (
              <>
                <ShoppingBag className="mx-auto text-accent mb-2" size={24} />
                <p className="font-bold text-ink">Belum ada reservasi aktif</p>
                <p className="text-ink-2 text-[10px] mt-0.5">
                  Percakapan dengan booking pending, hold, atau terjadwal akan muncul di sini.
                </p>
              </>
            ) : (
              <>
                <CheckCircle className="mx-auto text-accent mb-2" size={24} />
                <p className="font-bold text-ink">
                  {chats.length === 0 ? 'Belum ada percakapan' : 'Tidak ada percakapan untuk filter ini'}
                </p>
                <p className="text-ink-2 text-[10px] mt-0.5">
                  {chats.length === 0
                    ? 'Percakapan baru akan muncul secara real-time.'
                    : 'Coba ubah label atau kata kunci, atau reset filter di bawah.'}
                </p>
                {labelFilter !== 'all' && (
                  <button
                    type="button"
                    onClick={() => setLabelFilter('all')}
                    className="mt-2.5 px-2.5 py-1 rounded-lg bg-accent hover:bg-accent-hover text-on-solid text-[11px] font-semibold transition cursor-pointer shadow-xs"
                  >
                    Reset Filter Label
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="space-y-1.5 pt-1.5">
            {sortedChats.map((chat) => {
              const isMedical = chat.escalationReason === 'medical_concern';
              const isSelected = chat.conversationId === selectedId;
              const sharelocCard = getSharelocCardStatus(chat);
              const chatName = chat.customerName || 'Customer';
              const lastMsg =
                chat.lastMessages && chat.lastMessages.length > 0
                  ? chat.lastMessages[chat.lastMessages.length - 1]
                  : null;
              const isLastMsgHidden = !!((lastMsg as any)?.is_message_hidden || (lastMsg as any)?.payload_raw?.is_hidden);
              const preview = isLastMsgHidden ? `👁️🗨️ [Hidden] ${lastMsg?.content || 'Pesan'}` : lastMsg?.content || null;
              const senderInd = resolveChatSenderIndicator(lastMsg);
              void draftTick;
              const liveDraft = chat.conversationId === selectedId ? replyTextRef.current || '' : '';
              const draftText = (liveDraft || loadConversationDraft(chat.conversationId) || '').trim();

              return (
                <div
                  key={chat.conversationId}
                  data-no-select="true"
                  onClick={() => {
                    if (longPressTriggeredRef.current) {
                      longPressTriggeredRef.current = false;
                      return;
                    }
                    const matchedId = (chat as any).matchedMessage?.id || null;
                    const wasSameConversation = selectedIdRef.current === chat.conversationId;
                    if (searchQuery.trim() && matchedId) {
                      setInChatSearchQuery(searchQuery);
                      setInChatSearchOpen(true);
                      pendingFocusMessageIdRef.current = matchedId;
                    } else if (searchQuery.trim()) {
                      const q = searchQuery.trim().toLowerCase();
                      const localMatch = (chat.lastMessages || []).find((m: any) =>
                        (m.content || '').toLowerCase().includes(q)
                      );
                      if (localMatch) {
                        setInChatSearchQuery(searchQuery);
                        setInChatSearchOpen(true);
                      }
                    }
                    handleSelect(chat.conversationId);
                    if (matchedId && wasSameConversation) {
                      loadThread(chat.conversationId, matchedId);
                    }
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
                  className={`bg-white dark:bg-surface rounded-xl px-2 pt-1.5 border transition duration-150 active:scale-[0.985] cursor-pointer text-left flex flex-col justify-between space-y-1 shadow-2xs relative select-none touch-manipulation ${
                    chat.isFrustrated
                      ? 'border-rose-400 dark:border-rose-600/70 border-l-4 border-l-rose-500 bg-rose-50/40 dark:bg-rose-950/20 hover:bg-rose-100/60 dark:hover:bg-rose-950/30'
                      : isSelected
                      ? `border-accent dark:border-accent bg-accent-soft/80 dark:bg-accent/15 ${
                          (chat as any).hasActiveHold
                            ? 'border-l-4 border-l-amber-500'
                            : (chat as any).hasPendingBooking
                              ? 'border-l-4 border-l-sky-500'
                              : (chat as any).hasUpcomingBooking
                                ? 'border-l-4 border-l-emerald-500'
                                : sharelocCard.needed && sharelocCard.borderClass
                                  ? sharelocCard.borderClass
                                  : ''
                        }`
                      : isMedical
                        ? 'border-rose-300 dark:border-rose-700/60 bg-rose-50/40 dark:bg-rose-950/20 hover:bg-rose-50/70 dark:hover:bg-rose-950/30 active:bg-rose-100/50'
                        : (chat as any).hasActiveHold
                          ? 'border-divider dark:border-divider border-l-4 border-l-amber-500 bg-amber-100/90 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-900/40 active:bg-amber-200/70'
                          : (chat as any).hasUpcomingBooking
                            ? 'border-divider dark:border-divider border-l-4 border-l-emerald-500 bg-emerald-50/65 dark:bg-emerald-950/30 hover:bg-emerald-100/60 dark:hover:bg-emerald-900/40 active:bg-emerald-100'
                            : (chat as any).hasPendingBooking
                              ? 'border-divider dark:border-divider border-l-4 border-l-sky-500 bg-sky-100/90 dark:bg-sky-950/30 hover:bg-sky-100 dark:hover:bg-sky-900/40 active:bg-sky-200/70'
                              : sharelocCard.needed && sharelocCard.borderClass
                                ? `border-divider dark:border-divider ${sharelocCard.borderClass} ${
                                    sharelocCard.urgent ? 'bg-orange-50/40 dark:bg-orange-950/20' : 'bg-amber-50/40 dark:bg-amber-950/20'
                                  } hover:bg-surface-2 dark:hover:bg-fill-1`
                                : 'border-divider dark:border-divider hover:border-accent/30 dark:hover:border-accent/50 hover:bg-surface-2 dark:hover:bg-fill-1 active:bg-fill-1 dark:active:bg-fill-2'
                  }`}
                >
                  {/* Top Row: Avatar, Name, Group 1 Labels, Release/Bot Icon + Badges */}
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex items-start space-x-2 min-w-0">
                      <CustomerAvatar
                        src={chat.customerProfilePictureUrl}
                        name={chatName}
                        phone={chat.customerPhone}
                        size="sm"
                      />
                      <div className="space-y-0.5 min-w-0">
                        <h4 className="font-bold text-ink text-xs flex items-center space-x-1.5 truncate">
                          {chat.isPinned && (
                            <span title="Percakapan Disematkan (Pin)" className="inline-flex shrink-0">
                              <Pin size={11} className="text-accent fill-current" />
                            </span>
                          )}
                          <span className="truncate">{chatName}</span>
                          <span className="text-[10px] text-ink-2 font-normal flex-shrink-0">
                            ({chat.customerPhone || 'Unknown'})
                          </span>
                        </h4>

                        {/* GRUP 1: Label Kustom Pelanggan */}
                        <div className="flex flex-wrap items-center gap-1">
                          {chat.isFrustrated && (
                            <span
                              title="Butuh Respon Segera (Menunggu balasan > 60 menit)"
                              aria-label="Butuh respon segera, menunggu balasan lebih dari 60 menit"
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-danger ring-1 ring-rose-300 dark:ring-rose-800/40 shadow-2xs shrink-0 cursor-help"
                            >
                              <span className="relative flex h-2 w-2">
                                
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-danger"></span>
                              </span>
                              <AlertTriangle size={11} className="text-rose-600 dark:text-danger shrink-0" />
                            </span>
                          )}
                          <StaffOwnershipBadge ownership={chat.staffOwnership} />
                          {(chat.customerLabels || []).map((lbl) => (
                            <span
                              key={lbl.id}
                              className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold text-white shadow-2xs"
                              style={{ backgroundColor: lbl.color || 'rgb(var(--c-accent))' }}
                              title={`Label: ${lbl.name}${lbl.description ? ` (${lbl.description})` : ''}`}
                            >
                              {lbl.name}
                            </span>
                          ))}
                          {(chat as any).hasActiveHold && (
                            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-black bg-amber-500 text-slate-950 ring-1 ring-amber-300 dark:ring-amber-300/60 shadow-xs tracking-wide">
                              ⏳ HOLD
                            </span>
                          )}
                          {(chat as any).hasUpcomingBooking && (
                            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-600 text-white ring-1 ring-emerald-300 dark:ring-emerald-400/60 shadow-xs">
                              Terjadwal
                            </span>
                          )}
                          {(chat as any).hasPendingBooking && (
                            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-bold bg-sky-600 text-white ring-1 ring-sky-300 dark:ring-sky-400/60 shadow-xs">
                              Pending
                            </span>
                          )}
                          {sharelocCard.needed && (
                            <span
                              className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-bold shadow-2xs border ${sharelocCard.badgeClass}`}
                              title={sharelocCard.label || 'Butuh Shareloc'}
                            >
                              {sharelocCard.label}
                            </span>
                          )}
                          {sourceFilter === 'reservation' &&
                            (() => {
                              const ar =
                                (chat as any).activeConfirmedReservation ||
                                (chat as any).activeHoldReservation ||
                                (chat as any).activePendingReservation;
                              const staff = ar?.assigned_staff;
                              if (staff?.name) {
                                return (
                                  <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-bold bg-violet-100 dark:bg-violet-950/60 text-violet-800 dark:text-ink-2 ring-1 ring-violet-300 dark:ring-divider shadow-2xs">
                                    👩‍⚕️ Bidan {staff.name}
                                  </span>
                                );
                              }
                              if (ar && !ar.assigned_staff_id) {
                                return (
                                  <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-warning ring-1 ring-amber-300 dark:ring-amber-800/40 shadow-2xs">
                                    Belum Ada Bidan
                                  </span>
                                );
                              }
                              return null;
                            })()}
                        </div>
                      </div>
                    </div>

                    {/* Right Column: Release Icon Button + Unread Badge */}
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
                              ? 'bg-danger-soft hover:bg-danger text-danger border border-danger-line'
                              : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/60 dark:text-ink-2 dark:border-divider'
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

                      {/* Badge Unread / Orange Dot */}
                      <div className="flex items-center justify-end mt-1 min-h-[19px]">
                        {(chat.unreadCount || 0) > 0 ? (
                          chat.isManualUnread ? (
                            <span
                              className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-accent-hover shadow-2xs ring-1 ring-white/50"
                              title="Ditandai belum dibaca (Manual)"
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-surface" />
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center justify-center min-w-[19px] h-[19px] px-1 text-[10px] font-bold text-on-solid bg-success rounded-full shadow-2xs"
                              title={`${chat.unreadCount} pesan belum dibaca`}
                            >
                              {chat.unreadCount}
                            </span>
                          )
                        ) : chat.isAwaitingReply ? (
                          <span
                            title="Sudah dibaca, menunggu balasan"
                            className="w-2.5 h-2.5 rounded-full bg-ink-3 shadow-2xs ring-1.5 ring-white inline-block"
                          />
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* Chat Preview */}
                  {(() => {
                    const matchedSnippet = searchQuery.trim()
                      ? (() => {
                          const q = searchQuery.trim();
                          const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                          const wbRegex = new RegExp(`(^|\\W)${escaped}($|\\W)`, 'i');
                          const mm = (chat as any).matchedMessage;
                          const isMmHidden = !!(mm?.is_message_hidden || mm?.payload_raw?.is_hidden);
                          const mmContent = isMmHidden ? null : mm?.content;
                          if (mmContent && wbRegex.test(mmContent)) return mmContent;
                          const fallbackMsg = (chat.lastMessages || []).find(
                            (m: any) => !m?.is_message_hidden && !m?.payload_raw?.is_hidden && wbRegex.test(m.content || '')
                          );
                          return fallbackMsg?.content || null;
                        })()
                      : null;
                    if (searchQuery.trim() && matchedSnippet) {
                      return (
                        <div className="mt-1 p-1.5 rounded bg-amber-50/60 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/20 text-[11px] text-ink dark:text-slate-200 line-clamp-2 leading-tight flex gap-1.5 items-start">
                          <Search size={10} className="shrink-0 mt-0.5 text-amber-600 dark:text-warning/60" />
                          <span className="flex-1 min-w-0">
                            &quot;{renderHighlightedText(extractSmartSearchSnippet(matchedSnippet, searchQuery), searchQuery)}&quot;
                          </span>
                        </div>
                      );
                    }
                    if (draftText) {
                      return (
                        <p
                          className="text-xs text-accent line-clamp-1 leading-snug font-medium flex items-center gap-1"
                          title={`Draf belum terkirim: ${draftText}`}
                        >
                          <PenLine size={11} className="shrink-0" />
                          <span className="truncate">Draft: {draftText}</span>
                        </p>
                      );
                    }
                    return (
                      <p className="text-xs text-ink-2 dark:text-ink-2 line-clamp-1 italic leading-snug flex items-center gap-1.5 min-w-0">
                        {senderInd.isCustomer && (
                          <span
                            className="shrink-0 inline-flex items-center text-rose-600 dark:text-rose-400"
                            title={senderInd.tooltip}
                          >
                            <ArrowDownLeft size={13} strokeWidth={2.5} />
                          </span>
                        )}
                        {senderInd.isAdmin && (
                          <span
                            className="shrink-0 inline-flex items-center text-accent"
                            title={senderInd.tooltip}
                          >
                            <CheckCheck size={13} />
                          </span>
                        )}
                        {senderInd.isBot && (
                          <span
                            className="shrink-0 inline-flex items-center text-indigo-600 dark:text-indigo-400"
                            title={senderInd.tooltip}
                          >
                            <Bot size={12} />
                          </span>
                        )}
                        <span className="truncate">&quot;{preview || 'Tidak ada pesan'}&quot;</span>
                      </p>
                    );
                  })()}

                  {/* GRUP 2: Metrik, Order, Traffic, Medis, & Jam (Footer Bar) */}
                  <div
                    className={`flex justify-between items-center text-[10px] border-t -mx-2 px-2.5 py-1.5 rounded-b-[11px] mt-1.5 ${
                      (chat as any).hasActiveHold
                        ? 'bg-amber-100/90 dark:bg-amber-950/50 border-amber-300/70 dark:border-amber-800/40 text-amber-950 dark:text-amber-200'
                        : (chat as any).hasUpcomingBooking
                          ? 'bg-emerald-50/90 dark:bg-emerald-950/50 border-emerald-200/70 dark:border-emerald-800/40 text-emerald-900 dark:text-emerald-200'
                          : (chat as any).hasPendingBooking
                            ? 'bg-sky-100/90 dark:bg-sky-950/50 border-sky-300/70 dark:border-sky-800/40 text-sky-950 dark:text-sky-200'
                            : 'bg-surface-2/60 dark:bg-black/35 border-divider dark:border-divider text-ink-2 dark:text-ink-2'
                    }`}
                  >
                    <span className="flex items-center flex-wrap gap-1.5">
                      {/* Medis Badge */}
                      {isMedical && (
                        <span
                          className="inline-flex items-center p-1 rounded text-[9px] font-bold bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-danger border border-rose-200 dark:border-rose-800/40"
                          title="Medical Concern / Emergency: Butuh respon medis"
                        >
                          <AlertTriangle size={8} />
                        </span>
                      )}

                      {/* MQL Badge */}
                      {chat.isMql && !(chat.purchaseCount && chat.purchaseCount > 0) && (
                        <span
                          title={`MQL (${chat.mqlBubbleCount ?? 0} Bubble)`}
                          className="inline-flex items-center p-1 rounded text-[9px] font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-accent border border-emerald-200 dark:border-emerald-800/40"
                        >
                          <Zap size={8} />
                        </span>
                      )}

                      {/* Order Count / Repeat Badge */}
                      {!!chat.purchaseCount && chat.purchaseCount > 0 && (
                        <span
                          title={
                            chat.purchaseCount === 1
                              ? `Purchase 1x (LTV: ${formatRupiah(chat.ltv || 0)})`
                              : `Repeat Order ${chat.purchaseCount}x (LTV: ${formatRupiah(chat.ltv || 0)})`
                          }
                          className={`inline-flex items-center space-x-0.5 px-1.5 py-0.2 rounded text-[9px] font-bold border ${
                            chat.purchaseCount === 1
                              ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-accent border-emerald-200 dark:border-emerald-800/40'
                              : 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-warning border-amber-200 dark:border-amber-800/40'
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
                          className="inline-flex items-center p-1 rounded text-[9px] font-bold bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-info border border-sky-200 dark:border-sky-800/40"
                        >
                          <Facebook size={8} />
                        </span>
                      )}

                      {/* Traffic Source Legacy Badge */}
                      {chat.trafficSource === 'legacy' && !(chat.purchaseCount && chat.purchaseCount > 0) && (
                        <span
                          title="Pasien Legacy (Data hasil migrasi arsip riwayat WhatsApp lama)"
                          className="inline-flex items-center p-1 rounded text-[9px] font-bold bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-ink-2 border border-purple-200 dark:border-divider"
                        >
                          <Archive size={8} />
                        </span>
                      )}

                      {/* Sandbox Badge */}
                      {chat.isSandboxTest && (
                        <span
                          className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-ink-2 border border-purple-200 dark:border-divider"
                          title="Chat simulasi / sandbox"
                        >
                          Sandbox
                        </span>
                      )}
                    </span>

                    {/* Timestamp & Status Alur */}
                    <span className="flex items-center gap-1.5">
                      {chat.lastMessageAt && (
                        <span className="text-ink-2 dark:text-ink-2 font-sans text-[10px]">
                          {formatLastChat(chat.lastMessageAt)}
                        </span>
                      )}
                      {chat.currentState === 'HUMAN_HANDLING' ? (
                        <span
                          className="inline-flex items-center p-1 rounded-full text-[9px] font-bold bg-amber-100 dark:bg-amber-950/30 text-amber-800 dark:text-warning border border-amber-200 dark:border-amber-800/40"
                          title="Ditangani CS (manual)"
                        >
                          <User size={10} />
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center p-1 rounded-full text-[9px] font-bold bg-emerald-100 dark:bg-emerald-950/30 text-emerald-800 dark:text-accent border border-emerald-200 dark:border-emerald-800/40"
                          title={`Alur: ${chat.currentState}`}
                        >
                          <Bot size={10} />
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
            {hasMore && filteredChats.length > 0 && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={() => loadChats(false)}
                  disabled={loadingMore}
                  className="px-3.5 py-1.5 bg-surface hover:bg-fill-1 border border-divider rounded-xl text-xs font-semibold text-ink transition shadow-xs disabled:opacity-50 flex items-center space-x-1.5"
                >
                  {loadingMore && <Loader size={11} className="animate-spin text-accent" />}
                  <span>{loadingMore ? 'Memuat...' : 'Muat lebih banyak'}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
