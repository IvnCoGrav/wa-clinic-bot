import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, Send, Loader2, ExternalLink, Clock } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';
import { MediaImage, ChatMediaData } from '../common/MediaImage';
import { Modal } from '../ui/Modal';
import { extractMedia, resolveMessageDisplayText } from '../../utils/mediaExtractor';
import { renderFormattedMessageContent } from '../../utils/livechatSearch';
import {
  formatChatDateSeparatorWib,
  isDifferentDayWib,
  formatWibTime,
} from '../../utils/dateWib';

/**
 * ChatHistoryModal — modal riwayat chat terpusat (Anti-Bloat & Modularity-First).
 *
 * Menggantikan 3 implementasi inline yang terduplikasi di CustomerDatabase,
 * Reservations, dan FollowUpQueue (~300 LOC duplikat).
 *
 * Koreksi stacking vs plan: listener Escape/swipe-back/popstate didaftarkan di
 * fase CAPTURE + stopPropagation, karena modal di belakang (mis.
 * ReservationDetailModal z-[9999]) mendaftarkan listener window fase bubble
 * LEBIH DULU — stopPropagation di listener bubble tidak dapat mencegah handler
 * yang sudah berjalan. Capture + zIndex prop menyelesaikan konflik Escape &
 * z-index tanpa tergantung urutan mount.
 */

export interface ChatHistoryCustomer {
  id: string;
  name?: string | null;
  phone?: string | null;
  trackingCode?: string | null;
}

export interface ChatHistoryMessage {
  id: string;
  direction?: string | null;
  content?: string | null;
  sender_type?: string | null;
  sender_name?: string | null;
  created_at: string;
  media?: ChatMediaData | null;
  payload_raw?: any;
  payloadRaw?: any;
  media_url?: string | null;
  mediaUrl?: string | null;
}

export interface ChatHistoryModalProps {
  isOpen: boolean;
  customer: ChatHistoryCustomer | null;
  conversationId?: string | null;
  initialMessages?: ChatHistoryMessage[];
  mode?: 'view' | 'reply';
  /** Default 50; oper 10000 saat dibuka di atas ReservationDetailModal (z-[9999]). */
  zIndex?: number;
  onClose: () => void;
}

function resolveSender(msg: ChatHistoryMessage): string {
  const isInbound = (msg.direction || '').toUpperCase() === 'INBOUND';
  if (isInbound) return 'Customer';
  const typeUpper = (msg.sender_type || '').toUpperCase();
  if (typeUpper === 'ADMIN' || typeUpper === 'HUMAN' || typeUpper === 'STAFF') {
    return msg.sender_name || 'Admin';
  }
  return 'Bot';
}

export const ChatHistoryModal: React.FC<ChatHistoryModalProps> = ({
  isOpen,
  customer,
  conversationId,
  initialMessages,
  mode = 'view',
  zIndex = 50,
  onClose,
}) => {
  const { toast } = useUiFeedback();
  const [messages, setMessages] = useState<ChatHistoryMessage[]>(initialMessages || []);
  const [loading, setLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const loadMessages = useCallback(async (customerId: string) => {
    const reqId = ++requestIdRef.current;
    setLoading(true);
    try {
      const res: any = await apiRequest(`/api/admin/customers/${customerId}/messages`);
      if (requestIdRef.current !== reqId) return;
      setMessages(Array.isArray(res?.data) ? res.data : []);
    } catch (err: any) {
      if (requestIdRef.current !== reqId) return;
      setMessages([]);
      toast(`Gagal memuat riwayat chat: ${err?.message || err}`, 'error');
    } finally {
      if (requestIdRef.current === reqId) setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!isOpen || !customer?.id) return;
    if (initialMessages && initialMessages.length > 0) {
      setMessages(initialMessages);
      return;
    }
    setMessages([]);
    void loadMessages(customer.id);
  }, [isOpen, customer?.id, initialMessages, loadMessages]);

  useEffect(() => {
    if (!isOpen || loading || messages.length === 0) return;
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight + 99999;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [isOpen, messages, loading]);

  useEffect(() => {
    if (!isOpen) return;
    const closeTop = (e: Event) => {
      e.stopPropagation();
      // Listener pasif bisa menolak preventDefault; modal tetap ditutup.
      try { e.preventDefault(); } catch {}
      onCloseRef.current();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeTop(e);
    };
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('app-swipe-back', closeTop, true);
    window.addEventListener('popstate', closeTop, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('app-swipe-back', closeTop, true);
      window.removeEventListener('popstate', closeTop, true);
    };
  }, [isOpen]);

  const canReply = mode === 'reply' && !!conversationId && !!customer?.id;

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = replyText.trim();
    if (!text || sending || !conversationId) return;
    setSending(true);
    try {
      await apiRequest(`/api/admin/live-chat/conversations/${conversationId}/reply`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      setReplyText('');
      const optimistic: ChatHistoryMessage = {
        id: `temp_${Date.now()}`,
        direction: 'OUTBOUND',
        content: text,
        sender_type: 'ADMIN',
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);
      if (customer?.id) await loadMessages(customer.id);
      toast('Balasan terkirim.', 'success');
    } catch (err: any) {
      toast(`Gagal mengirim balasan: ${err?.message || err}`, 'error');
    } finally {
      setSending(false);
    }
  };

  if (!isOpen || !customer) return null;

  const liveChatUrl = conversationId
    ? `/admin/live-chat?conversationId=${encodeURIComponent(conversationId)}`
    : '/admin/live-chat';

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      variant="sheet"
      bodyClassName="p-0 overflow-hidden flex-1 flex flex-col min-h-0"
      title={
        <span className="flex items-center gap-2 min-w-0">
          <MessageSquare size={14} className="text-accent shrink-0" aria-hidden="true" />
          <span className="truncate">{customer.name || 'Customer'}</span>
        </span>
      }
      subtitle={`${customer.phone || '-'}${customer.trackingCode ? ` • Tracking: ${customer.trackingCode}` : ''}`}
      headerAction={
        <a
          href={liveChatUrl}
          target="_blank"
          rel="noreferrer"
          className="px-2.5 py-1.5 rounded-xl bg-surface hover:bg-fill-1 active:scale-95 border border-divider text-ink-2 text-xs font-semibold transition flex items-center space-x-1"
          title="Buka di Live Chat Penuh"
        >
          <ExternalLink size={12} aria-hidden="true" />
          <span className="hidden sm:inline">Buka Live Chat</span>
        </a>
      }
      footer={
        canReply ? (
          <form onSubmit={handleSendReply} className="w-full flex items-center space-x-2">
            <label htmlFor="chat-history-reply" className="sr-only">
              Balasan WhatsApp
            </label>
            <input
              id="chat-history-reply"
              type="text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Ketik balasan WhatsApp langsung ke nomor ini..."
              className="flex-1 px-3.5 py-2.5 bg-surface border border-divider hover:border-accent focus:border-accent rounded-xl text-xs text-ink placeholder:text-ink-3 focus:outline-none shadow-xs transition"
            />
            <button
              type="submit"
              disabled={sending || !replyText.trim()}
              className="px-4 py-2.5 bg-accent hover:bg-accent-hover active:scale-95 disabled:opacity-50 text-accent-ink rounded-xl text-xs font-bold transition shadow-xs flex items-center space-x-1.5 shrink-0"
            >
              {sending ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Send size={13} aria-hidden="true" />}
              <span>Kirim</span>
            </button>
          </form>
        ) : undefined
      }
    >

        {/* Body */}
        <div
          ref={containerRef}
          className="p-4 overflow-y-auto overscroll-contain flex-1 space-y-3 bg-content min-h-[300px]"
          style={{
            backgroundImage: `radial-gradient(rgb(var(--c-strong)) 0.75px, transparent 0.75px)`,
            backgroundSize: '16px 16px',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {loading ? (
            <div className="flex justify-center items-center py-20">
              <Loader2 className="animate-spin text-accent" size={32} />
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-20 text-ink-3 text-xs">
              <MessageSquare size={32} className="mx-auto text-ink-3 mb-2 opacity-40" />
              <p className="font-semibold text-ink">Belum ada riwayat pesan tercatat.</p>
              {canReply && <p className="text-ink-3 mt-0.5">Ketik pesan di bawah untuk memulai percakapan.</p>}
            </div>
          ) : (
            <>
              {messages.map((msg, idx) => {
                const isInbound = (msg.direction || '').toUpperCase() === 'INBOUND';
                const prev = idx > 0 ? messages[idx - 1] : null;
                const msgHasDate = !!msg?.created_at && !isNaN(new Date(msg.created_at).getTime());
                const prevHasDate = !!prev?.created_at && !isNaN(new Date(prev.created_at).getTime());
                const showSeparator = msgHasDate && (!prevHasDate || isDifferentDayWib(msg.created_at, prev?.created_at || null));
                const media = extractMedia(msg);
                return (
                  <React.Fragment key={msg.id || `msg-${idx}`}>
                    {showSeparator && (
                      <div className="flex justify-center py-1">
                        <span className="px-3 py-1 rounded-full bg-surface/90 border border-divider text-[10px] font-semibold text-ink-2 shadow-xs">
                          {formatChatDateSeparatorWib(msg.created_at)}
                        </span>
                      </div>
                    )}
                    <div className={`flex flex-col ${isInbound ? 'items-start' : 'items-end'}`}>
                      <div className="flex items-center space-x-1 text-[10px] text-ink-3 mb-0.5 px-1">
                        <span className="font-bold text-ink">{resolveSender(msg)}</span>
                        <span>•</span>
                        <Clock size={9} />
                        <span>{msgHasDate ? formatWibTime(msg.created_at) : '-'}</span>
                      </div>
                      <div
                        className={`max-w-[85%] sm:max-w-[75%] p-3 rounded-2xl text-xs leading-relaxed shadow-xs ${
                          isInbound
                            ? 'bg-bubble-in text-ink rounded-tl-none border border-divider/40'
                            : 'bg-bubble-out text-ink rounded-tr-none border border-accent/20'
                        }`}
                      >
                        {media && (
                          <div className="mb-1.5">
                            <MediaImage
                              src={media.url}
                              downloadSrc={media.hdUrl}
                              thumbUrl={media.thumbUrl}
                              caption={media.caption}
                            />
                          </div>
                        )}
                        {(() => {
                          const displayText = resolveMessageDisplayText({ content: msg.content, media });
                          if (!displayText) return null;
                          return (
                            <p className="whitespace-pre-wrap break-words">
                              {renderFormattedMessageContent(displayText)}
                            </p>
                          );
                        })()}
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
              <div ref={messagesEndRef} className="h-0 w-0 pointer-events-none" />
            </>
          )}
        </div>
    </Modal>
  );
};

export default ChatHistoryModal;
