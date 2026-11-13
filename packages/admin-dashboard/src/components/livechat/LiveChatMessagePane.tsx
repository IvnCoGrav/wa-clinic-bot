import React, { useState, useRef } from 'react';
import {
  MessageSquare,
  AlertTriangle,
  Bot,
  User,
  Loader,
  CheckCircle,
  FlaskConical,
  RefreshCw,
  Search,
  PenLine,
  X,
  Pin,
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  ExternalLink,
  Plus,
  Radar,
  Lock,
  Reply,
  Check,
  CheckCheck,
  Clock,
  AlertCircle,
  MapPin,
  Receipt,
  Eye,
  EyeOff,
  Ban,
  Calendar,
  CalendarPlus,
  MessageCircle,
  Info,
} from 'lucide-react';
import { CustomerAvatar } from '../common/CustomerAvatar';
import { StaffOwnershipBadge } from '../common/StaffOwnershipBadge';
import { LiveChatThreadTools } from './LiveChatThreadTools';
import { LiveChatMessageMedia } from './LiveChatMessageMedia';
import { LiveChatQuotedPreview } from './LiveChatQuotedPreview';
import { LiveChatReactionToolbar } from './LiveChatReactionToolbar';
import { LiveChatMessageActions } from './LiveChatMessageActions';
import { groupReactions, senderLabel, type MessageReaction } from '../../utils/liveChatReactions';
import { LiveChatComposer, LiveChatComposerHandle, ComposerQuickReply } from './LiveChatComposer';
import { renderFormattedMessageContent } from '../../utils/livechatSearch';
import {
  formatChatDateSeparator,
  isDifferentDay,
  extractQuotedMessage,
  type LiveChatItem,
  type ChatMessage,
  type CustomerLabelData,
} from '../../types/livechat';
import { getLocationBadgeConfig } from '../../utils/geoUtils';
import { getSharelocCardStatus } from '../../utils/sharelocCardStatus';
import { resolveChatSenderIndicator } from '../../utils/chatSenderIndicator';
import { useUiFeedback } from '../common/UiFeedback';
import { useTheme } from '../../contexts/ThemeContext';
import { apiRequest } from '../../services/api';
import { evaluatePaymentProof } from '../../utils/paymentProof';
import { formatFormBannerAudienceLabel } from '../../utils/chatScheduleExtractor';
import { saveConversationScroll } from '../../hooks/useLiveChatScroll';
import {
  extractLocation,
  extractAudio,
  extractDocument,
  extractContact,
  extractVideo,
  resolveMessageDisplayText,
  type ChatLocationData,
  type ChatAudioData,
  type ChatDocumentData,
  type ChatContactData,
  type ChatVideoData,
} from '../../utils/mediaExtractor';
import { formatWibTime } from '../../utils/dateWib';
import { formatWib, formatWibClock } from '../../utils/dateWib';

export interface LiveChatMessagePaneProps {
  mobileView: 'list' | 'chat';
  selectedChat: LiveChatItem | null | undefined;
  selectedId: string | null;
  selectedIdRef: React.MutableRefObject<string | null>;
  chatsRef: React.MutableRefObject<LiveChatItem[]>;
  setChats: React.Dispatch<React.SetStateAction<LiveChatItem[]>>;
  messages: ChatMessage[];
  isThreadLoading: boolean;
  threadLoadError: string | null;
  hasMoreOlderMessages: boolean;
  isLoadingOlder: boolean;
  loadOlderMessages: () => Promise<void>;
  loadThread: (conversationId: string, focusId?: string) => Promise<void>;
  chatContainerRef: React.RefObject<HTMLDivElement>;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  wasNearBottomRef: React.MutableRefObject<boolean>;
  savedScrollTopRef: React.MutableRefObject<number | null>;
  composerRef: React.RefObject<LiveChatComposerHandle>;
  fileInputRef: React.RefObject<HTMLInputElement>;
  inChatSearchInputRef: React.RefObject<HTMLInputElement>;
  // In-chat search
  inChatSearchOpen: boolean;
  setInChatSearchOpen: (open: boolean) => void;
  inChatSearchQuery: string;
  setInChatSearchQuery: (q: string) => void;
  searchQuery: string;
  matchingMessageIds: string[];
  currentMatchIndex: number;
  isDeepSearching: boolean;
  handlePrevMatch: () => void;
  handleNextMatch: () => void;
  handleClearInChatSearch: () => void;
  handleDeepSearchInHistory: () => Promise<void>;
  highlightedMsgId: string | null;
  // Header actions
  handleBackToList: () => void;
  handleOpenCustomerDetail: (chat: LiveChatItem) => void;
  handleToggleLabel: (customerId: string, label: CustomerLabelData) => Promise<void>;
  allLabels: CustomerLabelData[];
  togglingLabelId: string | null;
  labelPopoverOpen: boolean;
  setLabelPopoverOpen: (open: boolean) => void;
  labelPopoverRef: React.RefObject<HTMLDivElement>;
  activeHoldReservation: any;
  activeConfirmedReservation: any;
  activePendingReservation: any;
  currentActiveReservation: any;
  handleReservationUpdate: (deletedReservationId?: string) => Promise<void>;
  setSelectedReservation: (res: any) => void;
  setActiveEditingConfirmedReservation: (res: any) => void;
  setShowQuickBookingModal: (show: boolean) => void;
  markSharelocRequested: (conversationId?: string | null) => Promise<void> | void;
  // Dispatch / Radar
  dispatchTrip: any;
  setDispatchDrawerOpen: (open: boolean) => void;
  // Bot & Chat state
  chatBotActive: boolean;
  handleToggleGlobalBot: (active: boolean) => Promise<void>;
  releasingId: string | null;
  handleRelease: (chat: LiveChatItem) => Promise<void>;
  handleTakeover: (chat: LiveChatItem) => Promise<void>;
  handleToggleReadStatus: (chat: LiveChatItem) => Promise<void>;
  copilotOpen: boolean;
  setCopilotOpen: (open: boolean) => void;
  // Banners & alerts
  showFormReservasiBanner: boolean;
  showNeutralExistingReservationBanner: boolean;
  showUnregisteredVisitBanner: boolean;
  formBannerExtracted: any;
  formBannerKey: string | null;
  matchedExistingReservation: any;
  setDismissedFormBanner: (key: string) => void;
  handleOpenQuickReservation: () => void;
  handleOpenQuickHold: () => void;
  handleConfirmPendingBooking: (res: any) => Promise<void>;
  handleConvertHoldToBooking: (res: any) => void | Promise<void>;
  handleJumpToPinnedMessage: (msgId: string) => void;
  pinnedBubble: any;
  setPinnedBubble: (b: any) => void;
  isPinningMessageId: string | null;
  setIsPinningMessageId: (id: string | null) => void;
  isHidingMessageId: string | null;
  revokingId: string | null;
  // Message actions
  handleSelectReply: (msg: ChatMessage) => void;
  handleCopyMessageText: (content: string) => Promise<void>;
  handleToggleMessagePin: (msg: ChatMessage, pinned?: boolean) => Promise<void>;
  handleToggleMessageHide: (msg: ChatMessage, hidden?: boolean) => Promise<void>;
  handleRevokeMessage: (msg: ChatMessage) => Promise<void>;
  handleStartEdit: (msg: ChatMessage) => void;
  handleToggleReaction: (msg: ChatMessage, emoji: string) => Promise<void>;
  setProofModalReservation: (res: any) => void;
  // Composer
  sending: boolean;
  generatingDraft: boolean;
  replyingTo: ChatMessage | null;
  setReplyingTo: (msg: ChatMessage | null) => void;
  selectedImage: any | null;
  quickReplies: any[];
  handleComposerTextChange: (text: string) => void;
  notifyTyping: (isTyping: boolean) => void;
  handleSendReply: (composerText?: string, isInternal?: boolean) => Promise<void>;
  applyQuickReply: (qr: any) => string;
  handlePickImage: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleImageFile: (file: File) => Promise<void>;
  handleRemoveSelectedImage: () => void;
  handleGenerateAiDraft: () => Promise<void>;
  setShowDailyScheduleModal: (show: boolean) => void;
  handleGenerateActiveReservationInvoice: () => Promise<void>;
  scrollToBottom: (smooth?: boolean, force?: boolean) => void;
  gatewayCapability?: any;
}

export const LiveChatMessagePane: React.FC<LiveChatMessagePaneProps> = ({
  mobileView,
  selectedChat,
  selectedId,
  selectedIdRef,
  chatsRef,
  setChats,
  messages,
  isThreadLoading,
  threadLoadError,
  hasMoreOlderMessages,
  isLoadingOlder,
  loadOlderMessages,
  loadThread,
  chatContainerRef,
  messagesEndRef,
  wasNearBottomRef,
  savedScrollTopRef,
  composerRef,
  fileInputRef,
  inChatSearchInputRef,
  inChatSearchOpen,
  setInChatSearchOpen,
  inChatSearchQuery,
  setInChatSearchQuery,
  searchQuery,
  matchingMessageIds,
  currentMatchIndex,
  isDeepSearching,
  handlePrevMatch,
  handleNextMatch,
  handleClearInChatSearch,
  handleDeepSearchInHistory,
  highlightedMsgId,
  handleBackToList,
  handleOpenCustomerDetail,
  handleToggleLabel,
  allLabels,
  togglingLabelId,
  labelPopoverOpen,
  setLabelPopoverOpen,
  labelPopoverRef,
  activeHoldReservation,
  activeConfirmedReservation,
  activePendingReservation,
  currentActiveReservation,
  handleReservationUpdate,
  setSelectedReservation,
  setActiveEditingConfirmedReservation,
  setShowQuickBookingModal,
  markSharelocRequested,
  dispatchTrip,
  setDispatchDrawerOpen,
  chatBotActive,
  handleToggleGlobalBot,
  releasingId,
  handleRelease,
  handleTakeover,
  handleToggleReadStatus,
  copilotOpen,
  setCopilotOpen,
  showFormReservasiBanner,
  showNeutralExistingReservationBanner,
  showUnregisteredVisitBanner,
  formBannerExtracted,
  formBannerKey,
  matchedExistingReservation,
  setDismissedFormBanner,
  handleOpenQuickReservation,
  handleOpenQuickHold,
  handleConfirmPendingBooking,
  handleConvertHoldToBooking,
  handleJumpToPinnedMessage,
  pinnedBubble,
  setPinnedBubble,
  isPinningMessageId,
  setIsPinningMessageId,
  isHidingMessageId,
  revokingId,
  handleSelectReply,
  handleCopyMessageText,
  handleToggleMessagePin,
  handleToggleMessageHide,
  handleRevokeMessage,
  handleStartEdit,
  handleToggleReaction,
  setProofModalReservation,
  sending,
  generatingDraft,
  replyingTo,
  setReplyingTo,
  selectedImage,
  quickReplies,
  handleComposerTextChange,
  notifyTyping,
  handleSendReply,
  applyQuickReply,
  handlePickImage,
  handleImageFile,
  handleRemoveSelectedImage,
  handleGenerateAiDraft,
  setShowDailyScheduleModal,
  handleGenerateActiveReservationInvoice,
  scrollToBottom,
  gatewayCapability,
}) => {
  const { toast, confirm } = useUiFeedback();
  const { resolved: currentTheme } = useTheme();

  const [activeReactionMsgId, setActiveReactionMsgId] = useState<string | null>(null);
  const [customEmojiMsgId, setCustomEmojiMsgId] = useState<string | null>(null);
  const [isBannerCollapsed, setIsBannerCollapsed] = useState(false);

  const expandBanner = () => {
    setIsBannerCollapsed(false);
  };

  const effectiveInChatQuery = inChatSearchQuery.trim();

  return (
          <div
            data-chat-detail="true"
            className={`${mobileView === 'list' ? 'hidden lg:flex' : 'flex animate-mobile-chat-enter lg:animate-none'} flex-1 min-w-0 h-full min-h-0 flex-col`}
          >
            {selectedChat ? (
              <div className="bg-surface border-0 lg:border border-divider rounded-none lg:rounded-2xl p-1 sm:p-2 md:p-2.5 pb-0 sm:pb-0 md:pb-0 h-full flex flex-col justify-between shadow-none lg:shadow-xs overflow-hidden min-h-0">
                {/* Header Info: Clickable Card to view full customer detail modal */}
                <div className="border-b border-divider pb-1 sm:pb-1.5 space-y-1 shrink-0">
                  {selectedChat.isSandboxTest && (
                    <div className="flex items-center space-x-2 px-2 py-0.5 rounded-lg bg-violet-soft border border-violet-line text-violet text-[10px] font-bold uppercase tracking-wider">
                      <FlaskConical size={11} />
                      <span>QA TEST: chat simulasi</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center gap-2">
                    <div className="flex items-center min-w-0 flex-1">
                      {/* Mobile Back Button (Dedicated Independent Touch Target) */}
                      <button
                        type="button"
                        onClick={handleBackToList}
                        className="lg:hidden flex items-center justify-center w-10 h-10 min-w-[40px] min-h-[40px] -ml-1 mr-2 rounded-xl bg-fill-1 hover:bg-fill-2 active:bg-strong text-ink transition shrink-0 active:scale-95 touch-manipulation z-20 cursor-pointer shadow-2xs"
                        title="Kembali ke daftar percakapan"
                        aria-label="Kembali ke daftar percakapan"
                      >
                        <ChevronLeft size={22} className="stroke-[2.5]" />
                      </button>

                      {/* Clickable Customer Header Box */}
                      <div
                        onClick={() => handleOpenCustomerDetail(selectedChat)}
                        className="flex items-center space-x-2.5 p-1 -m-1 rounded-xl hover:bg-surface-2 cursor-pointer transition border border-transparent hover:border-divider group min-w-0 flex-1"
                        title="Klik untuk melihat detail lengkap profil customer"
                      >
                        <CustomerAvatar
                          src={selectedChat.customerProfilePictureUrl}
                          name={selectedChat.customerName}
                          phone={selectedChat.customerPhone}
                          size="sm"
                        />
                        <div className="min-w-0 flex flex-col justify-center">
                          <h3 className="text-xs sm:text-sm font-bold text-ink flex items-center space-x-1 group-hover:text-accent transition truncate leading-none">
                            <span className="truncate">{selectedChat.customerName || 'Customer'}</span>
                            <ExternalLink size={11} className="text-ink-3 group-hover:text-accent shrink-0" />
                          </h3>
                          <div className="flex items-center space-x-1.5 mt-1 flex-wrap gap-y-1">
                            <p className="text-[11px] text-ink-2 font-mono leading-none">
                              {selectedChat.customerPhone || 'Unknown'}
                            </p>

                            <StaffOwnershipBadge ownership={selectedChat.staffOwnership} />

                            {/* Active Label Colored Dots */}
                            {(selectedChat.customerLabels || []).map((lbl) => (
                              <span
                                key={lbl.id}
                                className="w-2.5 h-2.5 rounded-full inline-block shrink-0 shadow-2xs cursor-help ring-1 ring-white"
                                style={{ backgroundColor: lbl.color || 'rgb(var(--c-accent))' }}
                                title={`Label: ${lbl.name}${lbl.description ? ` (${lbl.description})` : ''}`}
                              />
                            ))}

                            {/* Active Reservation Badges in Chat Header: Disupresi jika alert banner reservasi sudah tampil di bawah */}
                            {Boolean((selectedChat as any).hasActiveHold || activeHoldReservation) && !activeHoldReservation && (
                              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-black bg-amber-500 text-slate-950 ring-1 ring-amber-300 dark:ring-amber-300/60 shadow-xs tracking-wide">
                                ⏳ HOLD
                              </span>
                            )}
                            {Boolean((selectedChat as any).hasUpcomingBooking || activeConfirmedReservation) && !activeConfirmedReservation && (
                              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-600 text-white ring-1 ring-emerald-300 dark:ring-emerald-400/60 shadow-xs">
                                Terjadwal
                              </span>
                            )}
                            {Boolean((selectedChat as any).hasPendingBooking || activePendingReservation) && !activePendingReservation && (
                              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-bold bg-sky-600 text-white ring-1 ring-sky-300 dark:ring-sky-400/60 shadow-xs">
                                Pending
                              </span>
                            )}

                            {/* Add / Manage Label Button (+) right next to phone & dots */}
                            <div className="relative inline-flex items-center" ref={labelPopoverRef} onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={() => setLabelPopoverOpen(!labelPopoverOpen)}
                                className="inline-flex items-center justify-center w-7 h-7 min-w-[28px] min-h-[28px] max-h-[28px] aspect-square rounded-full text-[11px] font-bold bg-fill-1 hover:bg-fill-2 text-ink-2 hover:text-accent border border-divider transition shadow-2xs active:scale-95 ml-1 shrink-0"
                                title="Tambah / Kelola Label Pasien"
                                aria-label="Tambah Label"
                              >
                                <Plus size={10} />
                              </button>

                            {/* Label Picker Popover */}
                            {labelPopoverOpen && (
                              <div className="absolute left-0 top-full mt-1.5 z-30 w-52 bg-surface border border-divider rounded-xl shadow-lg p-2 space-y-1">
                                <div className="flex justify-between items-center px-1.5 pb-1 border-b border-divider text-[11px] font-bold text-ink-2">
                                  <span>PILIH LABEL</span>
                                  <button
                                    type="button"
                                    onClick={() => setLabelPopoverOpen(false)}
                                    className="text-ink-3 hover:text-ink text-xs font-semibold"
                                  >
                                    ✕
                                  </button>
                                </div>
                                {allLabels.length === 0 ? (
                                  <p className="text-[11px] text-ink-2 p-2 text-center">
                                    Belum ada label.{' '}
                                    <a href="/admin/labels" className="text-accent underline font-semibold">
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
                                            isChecked ? 'bg-accent-soft text-accent' : 'hover:bg-fill-1 text-ink'
                                          }`}
                                        >
                                          <span className="flex items-center space-x-2 truncate">
                                            <span
                                              className="w-2.5 h-2.5 rounded-full shrink-0"
                                              style={{ backgroundColor: lbl.color }}
                                            />
                                            <span className="truncate">{lbl.name}</span>
                                          </span>
                                          {isChecked && <Check size={13} className="text-accent shrink-0" />}
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

                    {/* Header actions: In-chat search + Unread toggle + Bot Release/Takeover */}
                    <div className="shrink-0 flex items-center gap-1.5">
                      {dispatchTrip && !dispatchTrip.arrivedAt && !['completed', 'cancelled', 'rejected'].includes(String(dispatchTrip.status || '')) && (
                        <button
                          type="button"
                          onClick={() => setDispatchDrawerOpen(true)}
                          title="Buka Radar OTW Bidan"
                          className="xl:hidden inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-accent-soft text-accent border border-accent/30 text-xs font-bold shadow-2xs active:scale-95 transition"
                        >
                          <Radar size={14} />
                          <span className="hidden sm:inline">Radar OTW</span>
                        </button>
                      )}
                      {(() => {
                        const sharelocStatus = getSharelocCardStatus(selectedChat);
                        if (!sharelocStatus.needed) return null;
                        return (
                          <button
                            type="button"
                            onClick={() => {
                              const qr = quickReplies.find((q) => q.shortcut === 'shareloc');
                              if (!qr?.content) {
                                toast('Template shareloc belum diatur di Balasan Cepat (kategori Pasca Booking).', 'error');
                                return;
                              }
                              const text = applyQuickReply({ content: qr.content });
                              composerRef.current?.setText(text);
                              markSharelocRequested(selectedChat?.conversationId);
                              toast('Template shareloc dimasukkan ke composer balasan.', 'success');
                            }}
                            title={sharelocStatus.label || 'Minta Titik Presisi (Shareloc)'}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-orange-50 hover:bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300 border border-orange-300 dark:border-orange-800 text-xs font-bold shadow-2xs active:scale-95 transition cursor-pointer"
                          >
                            <MapPin size={14} className="text-orange-600 dark:text-orange-400 shrink-0" />
                            <span className="hidden sm:inline">Minta Shareloc</span>
                          </button>
                        );
                      })()}
                      <button
                        type="button"
                        onClick={() => {
                          const next = !inChatSearchOpen;
                          setInChatSearchOpen(next);
                          if (next) setTimeout(() => inChatSearchInputRef.current?.focus(), 60);
                        }}
                        title={inChatSearchOpen ? 'Tutup pencarian dalam chat' : 'Cari dalam chat'}
                        className={`p-1.5 min-w-[38px] min-h-[38px] rounded-xl border transition shadow-2xs flex items-center justify-center ${inChatSearchOpen ? 'bg-accent text-on-solid border-accent' : 'bg-white dark:bg-fill-2 border-divider dark:border-strong text-ink-2 dark:text-ink-2 hover:text-ink hover:bg-fill-1 dark:hover:bg-strong'}`}
                      >
                        <Search size={14} />
                      </button>
                      {selectedChat.isHumanHandling ? (
                        <button
                          onClick={() => handleRelease(selectedChat)}
                          disabled={releasingId === selectedChat.conversationId}
                          title="Kembalikan percakapan ke Bot AI"
                          className="px-3 py-1.5 bg-info hover:bg-info-hover text-on-solid rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
                        >
                          <Bot size={14} />
                          <span className="hidden sm:inline">Kembalikan ke Bot</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => handleTakeover(selectedChat)}
                          disabled={releasingId === selectedChat.conversationId}
                          title="Ambil alih percakapan (CS / Manual). Bot AI akan dinonaktifkan untuk percakapan ini."
                          className="px-3 py-1.5 bg-warning-soft hover:bg-warning-line text-warning border border-warning-line rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-2xs disabled:opacity-50 cursor-pointer"
                        >
                          <User size={14} className="text-warning" />
                          {/* FASE 4 (M-05): di HP cukup ikon agar nama pasien tidak terpotong. */}
                          <span className="hidden sm:inline">Ambil Alih (CS)</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Active Hold Slot Alert Banner - Ultra-Pressed Single-Line (ultra-compact saat banner cut-off merah ikut tampil) */}
                {/* Smart Micro-Pill (mobile saja): mengapung tanpa background bar yang menutupi livechat */}
                {isBannerCollapsed && (activeHoldReservation || activeConfirmedReservation || activePendingReservation) && (
                  <div className="md:hidden h-0 overflow-visible relative z-30 flex justify-center pointer-events-none animate-fadeIn">
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={expandBanner}
                        className={`pointer-events-auto h-[26px] px-3 rounded-full text-[11px] font-bold inline-flex items-center gap-1.5 shadow-md backdrop-blur-md cursor-pointer active:scale-95 transition border ${
                          activeHoldReservation
                            ? 'bg-amber-50/95 dark:bg-amber-950/90 border-amber-300/80 text-amber-900 dark:text-amber-200 shadow-amber-500/10'
                            : activeConfirmedReservation
                              ? 'bg-emerald-50/95 dark:bg-emerald-950/90 border-emerald-300/80 text-emerald-900 dark:text-emerald-200 shadow-emerald-500/10'
                              : 'bg-sky-50/95 dark:bg-sky-950/90 border-sky-300/80 text-sky-900 dark:text-sky-200 shadow-sky-500/10'
                        }`}
                        title="Tampilkan detail banner"
                      >
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          activeHoldReservation ? 'bg-warning' : activeConfirmedReservation ? 'bg-success' : 'bg-info'
                        }`} />
                        <span>
                          {(() => {
                            const r = activeHoldReservation || activeConfirmedReservation || activePendingReservation;
                            if (!r?.booking_date) return '';
                            const d = formatWib(r.booking_date, { weekday: 'short', day: 'numeric', month: 'short' });
    const t = formatWibClock(r.booking_date);
                            const dur = Number(r.duration_minutes) > 0 ? ` • ${r.duration_minutes} mnt` : '';
                            return `${d} ${t}${dur}`;
                          })()}
                        </span>
                        <ChevronDown size={12} className="stroke-[2.5]" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Active Hold Slot Alert Banner */}
                {activeHoldReservation && (
                  <div className={`mx-1.5 mb-1.5 px-3 py-1.5 min-h-[40px] rounded-xl border ${isBannerCollapsed ? 'hidden md:flex' : 'flex'} items-center gap-2.5 text-xs shadow-xs shrink-0 animate-fadeIn overflow-hidden transition bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent dark:from-amber-500/10 dark:via-transparent dark:to-transparent border-amber-300/80 dark:border-amber-600/50 text-amber-950 dark:text-amber-100`}>
                    <div className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden">
                      <span className="w-2 h-2 rounded-full bg-warning shrink-0" />
                      <div className="flex flex-col justify-center leading-tight min-w-0">
                        <span className="font-extrabold text-[9px] uppercase tracking-wider text-amber-800 dark:text-warning">HOLD</span>
                        <span className="flex items-center gap-1 min-w-0 text-amber-950 dark:text-amber-100">
                          <Clock size={11} className="text-amber-700 dark:text-warning shrink-0" />
                          <span className="font-semibold truncate text-[11px]">
                            {activeHoldReservation.booking_date
                              ? formatWib(activeHoldReservation.booking_date, {
                                  weekday: 'short',
                                  day: 'numeric',
                                  month: 'short',
                                }) +
                                ' ' +
                                formatWibClock(activeHoldReservation.booking_date, {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                                            })
                              : 'Slot belum ditentukan'}
                            {Number(activeHoldReservation.duration_minutes) > 0 ? ` • ${activeHoldReservation.duration_minutes} mnt` : ''}
                          </span>
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleConvertHoldToBooking(activeHoldReservation)}
                        className="inline-flex items-center gap-1.5 h-[30px] px-3 bg-gradient-to-r from-warning to-warning hover:from-warning hover:to-warning active:scale-95 text-white font-bold rounded-full text-xs leading-none transition shadow-xs cursor-pointer whitespace-nowrap shrink-0"
                        title="Lengkapi data booking reservasi ini"
                      >
                        <PenLine size={13} className="shrink-0" />
                        <span>Lengkapi</span>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await apiRequest(`/api/admin/reservation/${activeHoldReservation.id}/release-hold`, {
                              method: 'PATCH',
                            });
                            toast('Slot hold berhasil dilepas.', 'success');
                            await handleReservationUpdate();
                            if (selectedChat) {
                              setChats((prev) => {
                                const updated = prev.map((c) => c.conversationId === selectedChat.conversationId ? { ...c, hasActiveHold: false, activeHoldReservation: null } : c);
                                chatsRef.current = updated;
                                return updated;
                              });
                            }
                          } catch {
                            toast('Gagal melepas slot hold.', 'error');
                          }
                        }}
                        className="inline-flex items-center justify-center h-[30px] w-[30px] bg-white/90 dark:bg-amber-950/60 hover:bg-rose-50 dark:hover:bg-rose-950/50 active:scale-95 text-amber-800 hover:text-rose-600 dark:text-amber-200 dark:hover:text-rose-300 border border-amber-300/70 dark:border-amber-700/60 hover:border-rose-300 dark:hover:border-rose-700 rounded-full transition shadow-2xs cursor-pointer shrink-0"
                        title="Lepas slot hold"
                      >
                        <X size={13} strokeWidth={2.5} className="shrink-0" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsBannerCollapsed(true)}
                        className="md:hidden inline-flex items-center justify-center h-[30px] w-[30px] text-amber-700 dark:text-warning hover:bg-amber-500/15 active:scale-95 rounded-full transition shrink-0"
                        title="Ciutkan banner"
                      >
                        <ChevronUp size={14} className="stroke-[2.5]" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Active Payment Proof Banner (Bukti Bayar Masuk) */}
                {Boolean(currentActiveReservation?.proof_url) && (() => {
                  const proofEval = evaluatePaymentProof(currentActiveReservation);
                  const isMismatch = proofEval.isMismatch;
                  const bannerBg = isMismatch
                    ? 'bg-rose-50/95 dark:bg-rose-950/60 border-rose-300 dark:border-rose-700/60 text-rose-950 dark:text-rose-100'
                    : 'bg-emerald-50/90 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700/60 text-emerald-950 dark:text-emerald-100';
                  const iconColor = isMismatch
                    ? 'text-rose-600 dark:text-danger'
                    : 'text-emerald-700 dark:text-accent';
                  const headerColor = isMismatch
                    ? 'text-rose-800 dark:text-danger'
                    : 'text-emerald-800 dark:text-accent';
                  const subtextColor = isMismatch
                    ? 'text-rose-900 dark:text-rose-200'
                    : 'text-emerald-900 dark:text-emerald-200';

                  return (
                    <div className={`mx-1.5 mb-1.5 px-3 py-2 rounded-xl border ${isBannerCollapsed ? 'hidden md:flex' : 'flex'} items-center justify-between gap-2.5 text-xs shadow-xs shrink-0 animate-fadeIn overflow-hidden transition ${bannerBg}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        {isMismatch ? (
                          <AlertTriangle size={16} className={`${iconColor} shrink-0`} />
                        ) : (
                          <Receipt size={16} className={`${iconColor} shrink-0`} />
                        )}
                        <div className="flex flex-col justify-center leading-tight min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={`font-extrabold text-[9px] uppercase tracking-wider ${headerColor}`}>
                              BUKTI TRANSFER ({currentActiveReservation.payment_method || 'Transfer'})
                            </span>
                            {isMismatch && (
                              <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-danger text-on-solid uppercase tracking-wider shadow-2xs">
                                NOMINAL TIDAK SESUAI
                              </span>
                            )}
                          </div>
                          <span className={`text-[11px] truncate font-medium ${subtextColor}`}>
                            {proofEval.description} • Status: <span className="font-bold">{currentActiveReservation.purchase_review_status === 'approved' ? 'Lunas' : 'Menunggu Verifikasi CS'}</span>
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => setProofModalReservation(currentActiveReservation)}
                          className={`px-2.5 py-1 rounded-lg border text-xs font-semibold transition flex items-center gap-1 cursor-pointer shadow-2xs ${
                            isMismatch
                              ? 'bg-white dark:bg-rose-900 border-rose-300 dark:border-rose-600 text-rose-800 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-800'
                              : 'bg-white dark:bg-emerald-900 border-emerald-300 dark:border-emerald-600 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-800'
                          }`}
                          title="Lihat Bukti Transfer"
                        >
                          <Eye size={13} />
                          <span>Lihat Bukti</span>
                        </button>
                        {currentActiveReservation.purchase_review_status !== 'approved' && (
                          <button
                            type="button"
                            onClick={async () => {
                              const ok = await confirm({
                                title: isMismatch ? 'Peringatan: Nominal Tidak Sesuai. Tetap Setujui?' : 'Tandai Lunas & Setujui?',
                                message: isMismatch
                                  ? `Nominal struk (Rp ${proofEval.receiptAmount?.toLocaleString('id-ID')}) TIDAK SESUAI dengan tagihan resmi (Rp ${proofEval.totalExpected.toLocaleString('id-ID')}). Tetap setujui pembayaran?`
                                  : `Setujui pembayaran ${currentActiveReservation.payment_method || 'Transfer'} sebesar ${currentActiveReservation.purchase_value ? `Rp ${currentActiveReservation.purchase_value.toLocaleString('id-ID')}` : ''}?`,
                                confirmText: isMismatch ? 'Ya, Tetap Setujui' : 'Ya, Tandai Lunas',
                                cancelText: 'Batal',
                              });
                              if (!ok) return;
                              try {
                                await apiRequest(`/api/admin/reservation/${currentActiveReservation.id}/approve-purchase`, {
                                  method: 'POST',
                                  body: JSON.stringify({ force: true, reason: isMismatch ? 'CS Override Mismatched Payment Proof' : 'CS Verified Payment Proof' }),
                                });
                                toast('Pembayaran berhasil disetujui & ditandai lunas.', 'success');
                                await handleReservationUpdate();
                              } catch (err: any) {
                                toast(`Gagal memproses persetujuan: ${err?.message || 'Terjadi kesalahan'}`, 'error');
                              }
                            }}
                            className="px-2.5 py-1 rounded-lg bg-success hover:bg-success-hover text-on-solid text-xs font-bold transition flex items-center gap-1 cursor-pointer shadow-2xs"
                            title="Tandai pembayaran telah diverifikasi CS"
                          >
                            <CheckCircle size={13} />
                            <span>Tandai Lunas</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Active Confirmed / Terjadwal Alert Banner */}
                 {!activeHoldReservation && activeConfirmedReservation && (
                   <div className={`mx-1.5 mb-1.5 px-3 py-1.5 min-h-[40px] rounded-xl border ${isBannerCollapsed ? 'hidden md:flex' : 'flex'} items-center gap-2.5 text-xs shadow-xs shrink-0 animate-fadeIn overflow-hidden transition bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-transparent dark:from-emerald-500/10 dark:via-transparent dark:to-transparent border-emerald-300/80 dark:border-emerald-600/50 text-emerald-950 dark:text-emerald-100`}>
                     <button
                       type="button"
                       onClick={() => setSelectedReservation(activeConfirmedReservation)}
                       className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden text-left cursor-pointer hover:opacity-90 transition-opacity"
                       title="Lihat Ringkasan Jadwal & Bukti Bayar Pasien"
                     >
                       <span className="w-2 h-2 rounded-full bg-success shrink-0" />
                       <div className="flex flex-col justify-center leading-tight min-w-0">
                         <span className="font-extrabold text-[9px] uppercase tracking-wider text-emerald-800 dark:text-accent">JADWAL</span>
                         <span className="flex items-center gap-1 min-w-0 text-emerald-950 dark:text-emerald-100">
                           <Clock size={11} className="text-emerald-700 dark:text-accent shrink-0" />
                           <span className="font-semibold truncate text-[11px]">
                             {activeConfirmedReservation.booking_date
                               ? formatWib(activeConfirmedReservation.booking_date, {
                                   weekday: 'short',
                                   day: 'numeric',
                                   month: 'short',
                                 }) +
                                 ' ' +
                                  formatWibClock(activeConfirmedReservation.booking_date, {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                                                })
                               : 'Jadwal terkonfirmasi'}
                              {activeConfirmedReservation.treatment_detail ? ` • ${activeConfirmedReservation.treatment_detail}` : ''}
                             {Number(activeConfirmedReservation.duration_minutes) > 0 ? ` • ${activeConfirmedReservation.duration_minutes} mnt` : ''}
                           </span>
                         </span>
                       </div>
                     </button>
                     <div className={`flex items-center shrink-0 ${chatBotActive ? 'gap-2' : 'gap-1.5'}`}>
                       <button
                         type="button"
                         onClick={() => {
                           setActiveEditingConfirmedReservation(activeConfirmedReservation);
                           setShowQuickBookingModal(true);
                         }}
                         className={`inline-flex items-center justify-center bg-transparent border-transparent active:scale-95 text-emerald-700 dark:text-accent hover:text-emerald-900 dark:hover:text-emerald-100 transition cursor-pointer shrink-0 ${chatBotActive ? 'w-7 h-4' : 'h-[30px] w-[30px]'}`}
                         title="Ubah Jadwal, Jam, atau Bidan Bertugas"
                       >
                         <PenLine size={chatBotActive ? 12 : 14} className="shrink-0" />
                       </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await confirm({
                            title: 'Tandai Selesai?',
                            message: 'Tandai reservasi ini sebagai selesai?',
                            confirmText: 'Ya, Selesai',
                            cancelText: 'Batal',
                          });
                          if (!ok) return;
                          try {
                            await apiRequest(`/api/admin/reservation/${activeConfirmedReservation.id}/complete`, { method: 'PATCH' });
                            toast('Reservasi ditandai selesai.', 'success');
                            await handleReservationUpdate();
                          } catch {
                            toast('Gagal menandai selesai.', 'error');
                          }
                        }}
                        className={`inline-flex items-center justify-center bg-transparent border-transparent active:scale-95 text-emerald-700 dark:text-accent hover:text-emerald-900 dark:hover:text-emerald-100 transition cursor-pointer shrink-0 ${chatBotActive ? 'w-7 h-4' : 'h-[30px] w-[30px]'}`}
                        title="Tandai reservasi telah selesai treatment"
                      >
                        <CheckCircle size={chatBotActive ? 12 : 14} className="shrink-0" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsBannerCollapsed(true)}
                        className="md:hidden inline-flex items-center justify-center h-[30px] w-[30px] text-emerald-700 dark:text-accent hover:bg-emerald-500/15 active:scale-95 rounded-full transition shrink-0"
                        title="Ciutkan banner"
                      >
                        <ChevronUp size={14} className="stroke-[2.5]" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Active Pending Alert Banner */}
                {!activeHoldReservation && !activeConfirmedReservation && activePendingReservation && (
                  <div className={`mx-1.5 mb-1.5 px-3 py-1.5 min-h-[40px] rounded-xl border ${isBannerCollapsed ? 'hidden md:flex' : 'flex'} items-center gap-2.5 text-xs shadow-xs shrink-0 animate-fadeIn overflow-hidden transition bg-gradient-to-r from-sky-500/10 via-sky-500/5 to-transparent dark:from-sky-500/20 dark:via-sky-500/10 dark:to-transparent border-sky-300/80 dark:border-sky-600/50 text-sky-950 dark:text-sky-100`}>
                    <div className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden">
                      <span className="w-2 h-2 rounded-full bg-info shrink-0" />
                      <div className="flex flex-col justify-center leading-tight min-w-0">
                        <span className="font-extrabold text-[9px] uppercase tracking-wider text-sky-800 dark:text-info">PENDING</span>
                        <span className="flex items-center gap-1 min-w-0 text-sky-950 dark:text-sky-100">
                          <Clock size={11} className="text-sky-700 dark:text-info shrink-0" />
                          <span className="font-semibold truncate text-[11px]">
                            {activePendingReservation.booking_date
                              ? formatWib(activePendingReservation.booking_date, {
                                  weekday: 'short',
                                  day: 'numeric',
                                  month: 'short',
                                }) +
                                ' ' +
                                formatWibClock(activePendingReservation.booking_date, {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                                            })
                              : 'Menunggu konfirmasi jadwal'}
                            {activePendingReservation.treatment_detail ? ` • ${activePendingReservation.treatment_detail}` : ''}
                          </span>
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleConfirmPendingBooking(activePendingReservation)}
                        className="inline-flex items-center gap-1.5 h-[30px] px-3 bg-gradient-to-r from-info to-info hover:from-info hover:to-info active:scale-95 text-white font-bold rounded-full text-xs leading-none transition shadow-xs cursor-pointer whitespace-nowrap shrink-0"
                        title="Konfirmasi dan jadwalkan booking ini"
                      >
                        <Check size={13} strokeWidth={2.5} className="shrink-0" />
                        <span>Konfirmasi</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsBannerCollapsed(true)}
                        className="md:hidden inline-flex items-center justify-center h-[30px] w-[30px] text-sky-700 dark:text-info hover:bg-sky-500/15 active:scale-95 rounded-full transition shrink-0"
                        title="Ciutkan banner"
                      >
                        <ChevronUp size={14} className="stroke-[2.5]" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Fase 4B — Smart Action Banner: form reservasi terdeteksi dari chat
                    (1-tap booking). Gerbang: flag deterministik extractor + tanpa
                    reservasi aktif; punya tombol dismiss sendiri per-signatur form. */}
                {showFormReservasiBanner && formBannerExtracted && (
                  <div className="mx-1.5 mb-1.5 px-3 py-2 min-h-[44px] rounded-xl border flex items-center justify-between gap-2 text-xs shadow-xs shrink-0 animate-fadeIn bg-gradient-to-r from-emerald-500/10 via-teal-500/5 to-transparent border-emerald-300 dark:border-emerald-700 text-emerald-950 dark:text-emerald-100">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full bg-success shrink-0" />
                      <div className="flex flex-col justify-center leading-tight min-w-0">
                        <span className="font-extrabold text-[9px] uppercase tracking-wider text-emerald-800 dark:text-accent">
                          {formBannerExtracted.hasExplicitReservationForm
                            ? 'FORM RESERVASI MASUK'
                            : 'KESEPAKATAN JADWAL TERDETEKSI (CHAT)'}
                        </span>
                        <span className="font-semibold truncate text-[11px]">
                          {formBannerExtracted.dateDisplay || 'Jadwal'}{formBannerExtracted.timeDisplay ? ` (${formBannerExtracted.timeDisplay})` : ''} • {formatFormBannerAudienceLabel(formBannerExtracted)} • {formBannerExtracted.isTreatmentFromHistory && formBannerExtracted.treatmentName
                            ? `Layanan belum dipilih (rekomendasi riwayat: ${formBannerExtracted.treatmentName})`
                            : formBannerExtracted.treatmentName || 'Layanan belum dipilih'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleOpenQuickReservation()}
                        className="inline-flex items-center gap-1.5 h-[34px] px-3.5 bg-accent hover:bg-accent-hover active:scale-95 text-on-solid font-bold rounded-xl text-xs shadow-xs cursor-pointer whitespace-nowrap"
                        title="Buka form reservasi dengan data chat yang sudah terisi"
                      >
                        <CalendarPlus size={14} />
                        <span>Jadwalkan & Buat Invoice</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => formBannerKey && setDismissedFormBanner(formBannerKey)}
                        className="inline-flex items-center justify-center w-[30px] h-[30px] text-emerald-700 dark:text-accent hover:bg-emerald-500/15 active:scale-95 rounded-full transition shrink-0"
                        title="Abaikan banner form ini"
                      >
                        <X size={14} strokeWidth={2.5} />
                      </button>
                    </div>
                  </div>
                )}

                {/* Banner Netral: Form reservasi terdeteksi tapi SUDAH tercatat (mencegah klik ganda).
                    Disupresi deterministik bila activeConfirmedReservation sudah tampil di atas. */}
                {showNeutralExistingReservationBanner && matchedExistingReservation && (
                  <div className="mx-1.5 mb-1.5 px-3 py-2 min-h-[44px] rounded-xl border flex items-center justify-between gap-2 text-xs shadow-xs shrink-0 animate-fadeIn bg-slate-500/10 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full bg-fill-2 shrink-0" />
                      <div className="flex flex-col justify-center leading-tight min-w-0">
                        <span className="font-extrabold text-[9px] uppercase tracking-wider text-slate-600 dark:text-slate-400">
                          RESERVASI SUDAH TERCATAT (OTOMATIS)
                        </span>
                        <span className="font-semibold truncate text-[11px]">
                          {formBannerExtracted?.dateDisplay || 'Jadwal'}{formBannerExtracted?.timeDisplay ? ` (${formBannerExtracted.timeDisplay})` : ''} • Jadwal untuk chat ini sudah tersimpan di sistem
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setSelectedReservation(matchedExistingReservation)}
                        className="inline-flex items-center gap-1.5 h-[34px] px-3.5 bg-ink-2 hover:bg-ink active:scale-95 text-surface font-bold rounded-xl text-xs shadow-xs cursor-pointer whitespace-nowrap"
                        title="Lihat detail reservasi yang sudah tercatat"
                      >
                        <Calendar size={14} />
                        <span>Lihat Detail Reservasi</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => formBannerKey && setDismissedFormBanner(formBannerKey)}
                        className="inline-flex items-center justify-center w-[30px] h-[30px] text-slate-600 dark:text-slate-400 hover:bg-slate-500/15 active:scale-95 rounded-full transition shrink-0"
                        title="Abaikan pemberitahuan ini"
                      >
                        <X size={14} strokeWidth={2.5} />
                      </button>
                    </div>
                  </div>
                )}

                {/* MT-2.2: Banner Oranye Palang Pintu Kunjungan Tanpa Reservasi Aktif */}
                {showUnregisteredVisitBanner && selectedChat && (
                  <div className="mx-1.5 mb-1.5 px-3 py-2 min-h-[44px] rounded-xl border flex items-center justify-between gap-2 text-xs shadow-xs shrink-0 animate-fadeIn bg-gradient-to-r from-amber-500/10 via-orange-500/5 to-transparent border-amber-300 dark:border-amber-700 text-amber-950 dark:text-amber-100">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full bg-warning shrink-0" />
                      <div className="flex flex-col justify-center leading-tight min-w-0">
                        <span className="font-extrabold text-[9px] uppercase tracking-wider text-amber-800 dark:text-warning">
                          PERINGATAN KUNJUNGAN LAPANGAN
                        </span>
                        <span className="font-semibold truncate text-[11px]">
                          Kunjungan lapangan terdeteksi tetapi belum ada reservasi aktif di kalender.
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleOpenQuickReservation()}
                        className="inline-flex items-center gap-1.5 h-[34px] px-3.5 bg-warning hover:bg-warning-hover active:scale-95 text-on-solid font-bold rounded-xl text-xs shadow-xs cursor-pointer whitespace-nowrap"
                        title="Buat reservasi sekarang dengan data chat yang ada"
                      >
                        <CalendarPlus size={14} />
                        <span>Buat Reservasi Sekarang (+)</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* In-chat search toolbar (terpisah dari pencarian daftar kiri) */}
                <LiveChatThreadTools
                  searchOpen={inChatSearchOpen}
                  searchQuery={inChatSearchQuery}
                  searchInputRef={inChatSearchInputRef}
                  onQueryChange={setInChatSearchQuery}
                  onClearSearch={handleClearInChatSearch}
                  pinnedBubble={pinnedBubble}
                  onJumpToPinned={handleJumpToPinnedMessage}
                  onUnpin={(msgId) => {
                    const target = messages.find((m) => m.id === msgId);
                    if (target) {
                      void handleToggleMessagePin(target);
                    } else if (selectedChat?.conversationId) {
                      setIsPinningMessageId(msgId);
                      apiRequest(`/api/admin/live-chat/conversations/${selectedChat.conversationId}/messages/${msgId}/pin`, {
                        method: 'PATCH',
                        body: JSON.stringify({ isPinned: false }),
                      })
                        .then(() => {
                          toast('Sematan pesan dilepas.', 'success');
                          setPinnedBubble(null);
                        })
                        .catch((err: any) => {
                          toast(`Gagal melepas sematan: ${err.message}`, 'error');
                        })
                        .finally(() => setIsPinningMessageId(null));
                    }
                  }}
                  isUnpinning={isPinningMessageId === pinnedBubble?.id}
                />

                {/* Chat Bubbles Container with WhatsApp Wallpaper */}
                <div 
                  key={selectedChat?.conversationId || 'empty'}
                  ref={chatContainerRef} 
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
                    const isNear = distance < 300;
                    wasNearBottomRef.current = isNear;
                    savedScrollTopRef.current = el.scrollTop;
                    if (selectedIdRef.current) {
                      saveConversationScroll(selectedIdRef.current, el.scrollTop, isNear);
                    }
                    // Infinite scroll up: capai puncak → muat riwayat lama
                    if (el.scrollTop < 80 && hasMoreOlderMessages && !isLoadingOlder) {
                      loadOlderMessages();
                    }
                  }}
                  className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-1.5 sm:p-2.5 md:p-3 space-y-1.5 sm:space-y-2 my-1 sm:my-1.5 rounded-lg sm:rounded-xl border border-divider bg-content"
                  style={{
                    backgroundImage: currentTheme === 'dark'
                      ? 'radial-gradient(rgba(255, 255, 255, 0.04) 0.75px, transparent 0.75px)'
                      : 'radial-gradient(rgb(var(--c-strong)) 0.75px, transparent 0.75px)',
                    backgroundSize: '16px 16px',
                    overscrollBehavior: 'contain',
                  }}
                >
                  {/* Indikator riwayat lama di puncak chat */}
                  {hasMoreOlderMessages && isLoadingOlder && (
                    <div className="mx-auto w-fit flex items-center gap-2 px-3 py-1.5 my-1 rounded-full bg-white/90 dark:bg-fill-1/90 border border-divider dark:border-divider shadow-xs text-[11px] text-ink-2 animate-fadeIn select-none">
                      <Loader size={12} className="animate-spin text-accent" />
                      <span>Memuat riwayat chat sebelumnya...</span>
                    </div>
                  )}
                  {hasMoreOlderMessages && !isLoadingOlder && messages.length > 0 && (
                    <div className="mx-auto w-fit my-1">
                      <button
                        type="button"
                        onClick={loadOlderMessages}
                        className="px-3 py-1.5 rounded-full bg-white/90 dark:bg-fill-1/90 border border-divider dark:border-divider shadow-xs text-[11px] font-semibold text-accent hover:bg-accent-soft dark:hover:bg-accent-hover/15 transition active:scale-95 cursor-pointer"
                      >
                        ↑ Muat pesan sebelumnya
                      </button>
                    </div>
                  )}
                  {!hasMoreOlderMessages && !isThreadLoading && messages.length > 50 && (
                    <div className="mx-auto w-fit my-1 px-3 py-1 rounded-full bg-black/5 dark:bg-white/10 text-[10px] text-ink-3 select-none">
                      Awal dari riwayat percakapan
                    </div>
                  )}
                  {/* Floating In-Chat Search Navigation Bar — terpisah dari pencarian daftar */}
                  {effectiveInChatQuery && messages.length > 0 && matchingMessageIds.length > 0 && (
                    <div className="sticky top-1 z-30 mx-auto w-fit max-w-[94%] bg-warning-soft/95 border border-warning-line shadow-md rounded-full px-3 py-1.5 flex items-center gap-2 text-xs text-warning animate-fadeIn select-none">
                      <Search size={13} className="text-warning shrink-0" />
                      <span className="truncate">
                        Hasil pencarian: <span className="font-semibold text-warning">"{inChatSearchQuery}"</span> ({currentMatchIndex + 1} dari {matchingMessageIds.length})
                      </span>
                      <div className="flex items-center gap-0.5 border-l border-warning-line pl-1.5 shrink-0">
                        <button
                          aria-label="Pesan Sebelumnya (Lebih Lama)"
                          type="button"
                          title="Pesan Sebelumnya (Lebih Lama)"
                          onClick={handlePrevMatch}
                          className="p-1 rounded-full hover:bg-warning/70 text-warning transition active:scale-90 cursor-pointer"
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          aria-label="Pesan Berikutnya (Lebih Baru)"
                          type="button"
                          title="Pesan Berikutnya (Lebih Baru)"
                          onClick={handleNextMatch}
                          className="p-1 rounded-full hover:bg-warning/70 text-warning transition active:scale-90 cursor-pointer"
                        >
                          <ChevronDown size={14} />
                        </button>
                        <button
                          aria-label="Tutup Navigasi Pencarian"
                          type="button"
                          title="Tutup Navigasi Pencarian"
                          onClick={handleClearInChatSearch}
                          className="p-1 rounded-full hover:bg-warning/70 text-warning hover:text-warning ml-0.5 transition active:scale-90 cursor-pointer"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  )}

                  {effectiveInChatQuery && messages.length > 0 && matchingMessageIds.length === 0 && (
                    <div className="sticky top-1 z-30 mx-auto w-fit max-w-[94%] bg-surface-2/95 border border-strong shadow-sm rounded-full px-3 py-1 flex items-center gap-2 text-xs text-ink-2 animate-fadeIn select-none">
                      <Info size={13} className="text-ink-2 shrink-0" />
                      <span className="truncate">
                        Tidak ada bubble pesan berisi <span className="font-semibold">"{inChatSearchQuery}"</span> di percakapan ini
                      </span>
                      {hasMoreOlderMessages && (
                        <button
                          type="button"
                          onClick={handleDeepSearchInHistory}
                          disabled={isDeepSearching}
                          className="shrink-0 ml-1 px-2 py-0.5 rounded-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-on-solid text-[10px] font-bold transition active:scale-95 cursor-pointer flex items-center gap-1"
                        >
                          {isDeepSearching ? (
                            <Loader size={11} className="animate-spin" />
                          ) : (
                            <Search size={11} />
                          )}
                          <span>{isDeepSearching ? 'Mencari...' : 'Cari di riwayat lama'}</span>
                        </button>
                      )}
                      <button
                        aria-label="Tutup"
                        type="button"
                        title="Tutup"
                        onClick={handleClearInChatSearch}
                        className="p-0.5 rounded-full hover:bg-fill-2 text-ink-3 hover:text-ink ml-1 transition active:scale-90 cursor-pointer"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )}

                  {isThreadLoading ? (
                    <div className="h-full flex flex-col items-center justify-center text-center text-ink-2 text-xs py-16 animate-fadeIn">
                      <Loader className="animate-spin text-accent mb-2" size={26} />
                      <p className="font-semibold text-ink-2">Memuat riwayat chat...</p>
                    </div>
                  ) : messages.length === 0 && threadLoadError ? (
                    <div className="h-full flex flex-col items-center justify-center text-center text-ink-2 text-xs px-6">
                      <AlertTriangle size={30} className="mb-2 text-danger" />
                      <p className="font-bold text-ink">Gagal memuat riwayat chat</p>
                      <p className="text-[11px] mt-1 max-w-xs break-words">{threadLoadError}</p>
                      <button
                        type="button"
                        onClick={() => { if (selectedId) void loadThread(selectedId); }}
                        className="mt-3 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-on-solid text-[11px] font-bold transition active:scale-95 cursor-pointer"
                      >
                        Coba Lagi
                      </button>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center text-ink-2 text-xs">
                      <MessageCircle size={32} className="mb-2 text-ink-3" />
                      <p>Belum ada pesan di percakapan ini.</p>
                    </div>
                  ) : (
                    messages.map((msg, idx) => {
                      const isCustomer = msg.direction === 'INBOUND';
                      const senderTypeUpper = (msg.sender_type || '').toUpperCase();
                      const isAdmin = msg.direction === 'OUTBOUND' && (senderTypeUpper === 'ADMIN' || senderTypeUpper === 'HUMAN' || senderTypeUpper === 'STAFF');
                      const isInternalNote = senderTypeUpper === 'INTERNAL_NOTE';
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

                      // Ekstraksi data kaya: lokasi, audio/PTT, dokumen, kontak, video via helper terpusat
                      const locData: ChatLocationData | null = (msg as any).location || extractLocation(msg);
                      const audioData: ChatAudioData | null = extractAudio(msg);
                      const docData: ChatDocumentData | null = extractDocument(msg);
                      const contactData: ChatContactData | null = extractContact(msg);
                      const videoData: ChatVideoData | null = extractVideo(msg);
                      const hasMediaOnly = hasMedia && !audioData && !docData && !videoData && !resolveMessageDisplayText({ content: msg.content, media: msg.media });

                      // Reaksi Pesan (WhatsApp Message Reactions)
                      const reactions: MessageReaction[] =
                        (msg as any).reactions || (msg as any).payload_raw?.reactions || [];
                      const myReaction = reactions.find((r) => r.fromMe);
                      const groupedReactions = groupReactions(reactions);

                      const isMessagePinned = !!(msg.is_message_pinned || (msg as any).payload_raw?.is_pinned);
                      const isMessageHidden = !!(msg.is_message_hidden || (msg as any).payload_raw?.is_hidden);

                      return (
                        <React.Fragment key={msg.id}>
                          {showDateSeparator && (
                            <div className="flex justify-center my-2 sm:my-2.5">
                              <div className="bg-white/95 dark:bg-surface-2/95 px-3 py-1 rounded-lg text-[11px] font-semibold text-ink-2 shadow-2xs border border-black/5 dark:border-white/10 select-none tracking-wide">
                                {formatChatDateSeparator(msg.created_at)}
                              </div>
                            </div>
                          )}
                          <div
                            id={`msg-${msg.id}`}
                            className={`flex ${isCustomer ? 'justify-start' : 'justify-end'} group relative ${
                              isCurrentActiveMatch
                                ? 'transition-transform duration-150 ring-3 ring-warning/90 bg-warning-line/30 rounded-2xl p-1 -m-1 shadow-md scale-[1.01]'
                                : isMatchBubble
                                ? 'transition-colors duration-150 ring-1 ring-warning/60 bg-warning-soft/20 rounded-2xl p-0.5 -m-0.5'
                                : ''
                            }`}
                          >
                            {/* Floating WhatsApp-Style Quick Emoji Reaction Toolbar */}
                            <LiveChatReactionToolbar
                              active={activeReactionMsgId === msg.id}
                              customOpen={customEmojiMsgId === msg.id}
                              isCustomer={isCustomer}
                              selectedEmoji={myReaction?.emoji}
                              onToggleReaction={(emoji) => handleToggleReaction(msg, emoji)}
                              onToggleCustom={() => setCustomEmojiMsgId(customEmojiMsgId === msg.id ? null : msg.id)}
                            />

                            <div
                              className={`relative ${hasMediaOnly ? 'max-w-[240px] sm:max-w-[280px] p-1 sm:p-1.5' : 'max-w-[88%] sm:max-w-[75%] md:max-w-[70%] px-2.5 sm:px-3 py-1.5'} rounded-lg text-xs leading-relaxed shadow-2xs select-text cursor-text ${
                                isInternalNote
                                  ? 'bg-amber-50 dark:bg-amber-950/40 border border-dashed border-amber-300 dark:border-amber-700 text-amber-950 dark:text-amber-100 rounded-tr-none'
                                  : isRevoked
                                  ? 'bg-fill-1 text-ink-2 border border-divider'
                                  : isMessageHidden
                                  ? isCustomer
                                    ? 'bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-tl-none'
                                    : 'bg-slate-200/90 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 rounded-tr-none'
                                  : isCustomer
                                    ? 'bg-white text-ink rounded-tl-none border border-black/5 dark:bg-fill-1 dark:text-ink dark:border-divider'
                                    : isAdmin
                                      ? 'bg-bubble-out text-ink rounded-tr-none border border-accent/20'
                                      : 'bg-bubble-out text-ink rounded-tr-none border-l-4 border-accent dark:border-l-4 dark:border-accent'
                              }`}
                            >
                              {isMessagePinned && !isRevoked && (
                                <div className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-warning mb-1 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800 w-fit select-none">
                                  <Pin size={10} className="text-warning fill-warning" />
                                  <span>Disematkan{msg.pinned_by ? ` • ${msg.pinned_by}` : ''}</span>
                                </div>
                              )}
                              {isInternalNote && !isRevoked && (
                                <span className="flex items-center gap-1 text-[10px] font-bold mb-0.5 text-amber-700 dark:text-warning">
                                  <Lock size={10} />
                                  <span>Catatan Internal: {msg.sender_name || 'Staf'}</span>
                                </span>
                              )}
                              {(!hasMediaOnly || (!isCustomer && !isAdmin)) && !isRevoked && !isInternalNote && (
                                <span className={`block text-[10px] font-bold mb-0.5 flex items-center space-x-1 ${
                                  isCustomer ? 'text-ink-2' : isAdmin ? 'text-accent' : 'text-accent'
                                }`}>
                                  {!isCustomer && !isAdmin && <Bot size={10} />}
                                  <span>{senderLabel(msg)}</span>
                                </span>
                              )}

                              {/* Quoted Message / WhatsApp Reply preview inside bubble */}
                              {quotedMsg && !isRevoked && (
                                <LiveChatQuotedPreview
                                  quotedMsg={quotedMsg}
                                  customerName={selectedChat?.customerName}
                                  isCustomer={isCustomer}
                                />
                              )}

                              {!isRevoked && (
                                <>
                                  <LiveChatMessageMedia
                                    content={msg.content}
                                    media={msg.media}
                                    audioData={audioData}
                                    docData={docData}
                                    videoData={videoData}
                                    contactData={contactData}
                                    locData={locData}
                                    hasMediaOnly={hasMediaOnly}
                                    renderCaption={(text) => renderFormattedMessageContent(text, effectiveInChatQuery || searchQuery)}
                                  />

                                  {/* 7. Text Content (Anti-Hollow Bubble: teks dirender TEPAT 1x via resolver terpusat) */}
                                  {(() => {
                                    const hasVisual = (hasMedia && !audioData && !docData && !videoData) || !!locData || !!audioData || !!docData || !!videoData || !!contactData;
                                    const displayText = resolveMessageDisplayText({ content: msg.content, media: msg.media });
                                    if (!displayText) {
                                      if (hasVisual) return null;
                                      return (
                                        <p className="font-sans italic text-ink-2 py-0.5 text-[11px]">
                                          [Pesan tanpa teks]
                                        </p>
                                      );
                                    }
                                    return (
                                      <p className="font-sans whitespace-pre-wrap select-text cursor-text">
                                        {renderFormattedMessageContent(displayText, effectiveInChatQuery || searchQuery)}
                                      </p>
                                    );
                                  })()}
                                </>
                              )}
                              {isRevoked && (
                                <p className="font-sans whitespace-pre-wrap italic text-ink-2 flex items-center space-x-1.5 py-0.5">
                                  <Ban size={12} className="text-ink-3 shrink-0" />
                                  <span>Pesan ini telah ditarik</span>
                                </p>
                              )}
                              {isMessageHidden && !isRevoked && (
                                <div className="flex items-center justify-between gap-1.5 mt-1 pt-1 border-t border-slate-300/60 dark:border-slate-600/60 text-[10px] text-slate-500 dark:text-slate-400 select-none">
                                  <span className="flex items-center gap-1 font-medium truncate">
                                    <EyeOff size={11} className="text-ink-3 shrink-0" />
                                    <span className="truncate">Disembunyikan dari Staf Bidan{msg.hidden_by ? ` • oleh ${msg.hidden_by}` : ''}</span>
                                  </span>
                                  <button
                                    type="button"
                                    disabled={isHidingMessageId === msg.id}
                                    onClick={() => handleToggleMessageHide(msg, false)}
                                    className="text-accent dark:text-accent hover:underline font-bold cursor-pointer shrink-0 text-[10px]"
                                    title="Pulihkan pesan agar terlihat kembali oleh staf bidan"
                                  >
                                    Pulihkan
                                  </button>
                                </div>
                              )}
                              <div className="flex items-center justify-end space-x-1 mt-0.5 text-right select-none text-[10px] text-ink-2">
                                {isEdited && !isRevoked && (
                                  <span className="text-[9px] text-ink-2 italic mr-0.5">diedit</span>
                                )}
                                <span>
                                  {msg.created_at ? formatWibTime(msg.created_at) : ''}
                                </span>
                                {isInternalNote && !isRevoked && (
                                  <span className="text-[9px] text-amber-700 dark:text-warning italic ml-0.5">
                                    Hanya tim klinik • tidak dikirim ke WhatsApp
                                  </span>
                                )}
                                {!isCustomer && !isInternalNote && (
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
                                <LiveChatMessageActions
                                  isRevoked={isRevoked}
                                  isInternalNote={isInternalNote}
                                  activeReactionMsgId={activeReactionMsgId}
                                  myReaction={myReaction}
                                  canEdit={canEdit}
                                  canRevoke={canRevoke}
                                  isMessagePinned={isMessagePinned}
                                  isMessageHidden={isMessageHidden}
                                  revokingId={revokingId}
                                  isPinningMessageId={isPinningMessageId}
                                  isHidingMessageId={isHidingMessageId}
                                  messageId={msg.id}
                                  onCopy={() => {
                                    void handleCopyMessageText(resolveMessageDisplayText({ content: msg.content, media: msg.media }) || msg.content || '');
                                  }}
                                  onToggleReactionBar={() => {
                                    setActiveReactionMsgId(activeReactionMsgId === msg.id ? null : msg.id);
                                    setCustomEmojiMsgId(null);
                                  }}
                                  onReply={() => handleSelectReply(msg)}
                                  onEdit={() => handleStartEdit(msg)}
                                  onRevoke={() => handleRevokeMessage(msg)}
                                  onTogglePin={(next) => handleToggleMessagePin(msg, next)}
                                  onToggleHide={(next) => handleToggleMessageHide(msg, next)}
                                />
                              </div>

                              {/* Reaction Badges (WhatsApp Style Pill attached to bottom corner of bubble) */}
                              {groupedReactions.length > 0 && !isRevoked && (
                                <div
                                  className={`absolute -bottom-2.5 ${isCustomer ? 'left-2' : 'right-2'} z-10 flex items-center bg-surface border border-divider rounded-full px-1.5 py-0.5 shadow-xs text-[11px] gap-1 select-none hover:shadow-md cursor-pointer transition`}
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
                                      {g.count > 1 && <span className="text-[10px] text-ink-2 font-bold">{g.count}</span>}
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
                <div className="chat-composer-container pt-0.5 shrink-0 bg-transparent pb-0 border-t-0">
                  {selectedChat.isSandboxTest ? (
                    <div className="flex items-center justify-center space-x-2 px-3 py-2.5 rounded-xl bg-violet-soft border border-violet-line text-violet text-xs font-semibold">
                      <FlaskConical size={13} />
                      <span>Chat sandbox: balasan admin diblokir otomatis</span>
                    </div>
                  ) : (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      tabIndex={-1}
                      aria-hidden="true"
                      accept="image/*"
                      onChange={handlePickImage}
                      className="hidden"
                    />
                    {selectedId && (
                      <LiveChatComposer
                        ref={composerRef}
                        conversationId={selectedId}
                        sending={sending}
                        generatingDraft={generatingDraft}
                        replyingTo={replyingTo ? {
                          senderLabel: replyingTo.direction === 'INBOUND' ? (selectedChat.customerName || 'Customer') : 'Bidan / CS',
                          preview: replyingTo.media ? '📷 Foto' : (replyingTo.content || 'Pesan'),
                        } : null}
                        selectedImage={selectedImage ? { preview: selectedImage.preview } : null}
                        quickReplies={quickReplies}
                        onTextChange={handleComposerTextChange}
                        onTyping={notifyTyping}
                        onSend={handleSendReply}
                        onApplyQuickReply={applyQuickReply}
                        onPickImage={() => fileInputRef.current?.click()}
                        onPasteImageFile={handleImageFile}
                        onRemoveImage={handleRemoveSelectedImage}
                        onCancelReply={() => setReplyingTo(null)}
                        onGenerateAiDraft={handleGenerateAiDraft}
                        onOpenSchedule={() => setShowDailyScheduleModal(true)}
                        onOpenQuickHold={handleOpenQuickHold}
                        onOpenQuickReservation={handleOpenQuickReservation}
                        onGenerateInvoice={handleGenerateActiveReservationInvoice}
                        hasActiveReservation={Boolean(activeConfirmedReservation || activePendingReservation)}
                        onRequestScrollToBottom={() => scrollToBottom(true, false)}
                        chatBotActive={chatBotActive}
                        onToggleGlobalBot={() => handleToggleGlobalBot(!chatBotActive)}
                      />
                    )}
                  </>
                    )}
                  </div>
              </div>
            ) : (
              <div className="bg-surface border border-divider rounded-2xl p-8 h-full flex flex-col justify-center items-center text-center text-ink-2 text-xs shadow-xs">
                <MessageSquare size={44} className="mb-3 text-ink-3" />
                <p className="font-bold text-ink text-sm">Pilih Percakapan</p>
                <p className="text-ink-2 max-w-sm mt-1">
                  Pilih salah satu percakapan dari daftar di sebelah kiri untuk melihat thread dan membalas langsung.
                </p>
              </div>
            )}
          </div>
  );
};
