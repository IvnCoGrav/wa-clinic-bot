import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, MessageSquare, Send, Loader2, ExternalLink, Clock } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';
import { MediaImage, ChatMediaData } from '../common/MediaImage';
import { extractMedia } from '../../utils/mediaExtractor';
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

/** Ekstraksi media terpusat di utils/mediaExtractor.ts (single source of truth). */

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

  // Muat riwayat saat dibuka / ganti customer. initialMessages dipakai langsung bila ada.
  useEffect(() => {
    if (!isOpen || !customer?.id) return;
    if (initialMessages && initialMessages.length > 0) {
      setMessages(initialMessages);
      return;
    }
    setMessages([]);
    void loadMessages(customer.id);
  }, [isOpen, customer?.id, initialMessages, loadMessages]);

  // Auto-scroll ke pesan terbaru.
  useEffect(() => {
    if (!isOpen || loading || messages.length === 0) return;
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight + 99999;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [isOpen, messages, loading]);

  // Escape / swipe-back / popstate fase CAPTURE: hanya modal terdepan yang menutup.
  useEffect(() => {
    if (!isOpen) return;
    const closeTop = (e: Event) => {
      e.stopPropagation();
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
      // Satu-satunya endpoint balasan yang valid — tanpa fallback ke route yang tidak ada.
      await apiRequest(`/api/admin/live-chat/conversations/${conversationId}/reply`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      setReplyText('');
      // Optimistic append + refresh otoritatif agar id/waktu sinkron dengan server.
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

  return createPortal(
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn"
      style={{ zIndex }}
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#e9edef] rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col my-auto max-h-[85vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-[#e9edef] flex justify-between items-center bg-[#f8fafc] shrink-0">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-[#008069] text-white flex items-center justify-center font-bold text-sm shadow-xs shrink-0">
              {(customer.name ? customer.name.slice(0, 2).toUpperCase() : 'CU')}
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-[#111b21] text-sm flex items-center space-x-1.5 truncate">
                <MessageSquare size={14} className="text-[#008069] shrink-0" />
                <span className="truncate">{customer.name || 'Customer'}</span>
              </h3>
              <p className="text-[11px] text-[#667781] truncate">
                <span className="font-mono">{customer.phone || '-'}</span>
                {customer.trackingCode ? <span> • Tracking: {customer.trackingCode}</span> : null}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2 shrink-0">
            <a
              href={liveChatUrl}
              target="_blank"
              rel="noreferrer"
              className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-[#f0f2f5] active:scale-95 border border-[#d1d7db] text-[#54656f] text-xs font-semibold transition flex items-center space-x-1"
              title="Buka di Live Chat Penuh"
            >
              <ExternalLink size={12} />
              <span className="hidden sm:inline">Buka di Live Chat Penuh ↗</span>
            </a>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#8696a0] hover:text-[#111b21] hover:bg-[#e9edef] transition"
              title="Tutup (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div
          ref={containerRef}
          className="p-4 overflow-y-auto overscroll-contain flex-1 space-y-3 bg-[#efeae2] min-h-[300px]"
          style={{
            backgroundImage: `radial-gradient(#d1d7db 0.75px, transparent 0.75px)`,
            backgroundSize: '16px 16px',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {loading ? (
            <div className="flex justify-center items-center py-20">
              <Loader2 className="animate-spin text-[#008069]" size={32} />
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-20 text-[#667781] text-xs">
              <MessageSquare size={32} className="mx-auto text-[#8696a0] mb-2 opacity-40" />
              <p className="font-semibold text-[#111b21]">Belum ada riwayat pesan tercatat.</p>
              {canReply && <p className="text-[#8696a0] mt-0.5">Ketik pesan di bawah untuk memulai percakapan.</p>}
            </div>
          ) : (
            <>
              {messages.map((msg, idx) => {
                const isInbound = (msg.direction || '').toUpperCase() === 'INBOUND';
                const prev = idx > 0 ? messages[idx - 1] : null;
                const showSeparator = !prev || isDifferentDayWib(msg.created_at, prev.created_at || null);
                const media = extractMedia(msg);
                return (
                  <React.Fragment key={msg.id || `msg-${idx}`}>
                    {showSeparator && (
                      <div className="flex justify-center py-1">
                        <span className="px-3 py-1 rounded-full bg-white/90 border border-[#e9edef] text-[10px] font-semibold text-[#54656f] shadow-xs">
                          {formatChatDateSeparatorWib(msg.created_at)}
                        </span>
                      </div>
                    )}
                    <div className={`flex flex-col ${isInbound ? 'items-start' : 'items-end'}`}>
                      <div className="flex items-center space-x-1 text-[10px] text-[#667781] mb-0.5 px-1">
                        <span className="font-bold text-[#111b21]">{resolveSender(msg)}</span>
                        <span>•</span>
                        <Clock size={9} />
                        <span>{formatWibTime(msg.created_at)}</span>
                      </div>
                      <div
                        className={`max-w-[85%] sm:max-w-[75%] p-3 rounded-2xl text-xs leading-relaxed shadow-xs ${
                          isInbound
                            ? 'bg-white text-[#111b21] rounded-tl-none border border-black/5'
                            : 'bg-[#d9fdd3] text-[#111b21] rounded-tr-none border border-[#00a884]/20'
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
                        <p className="whitespace-pre-wrap break-words">{msg.content || ''}</p>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
              <div ref={messagesEndRef} className="h-0 w-0 pointer-events-none" />
            </>
          )}
        </div>

        {/* Footer: quick reply hanya bila conversation valid */}
        {canReply && (
          <form
            onSubmit={handleSendReply}
            className="p-3 border-t border-[#e9edef] bg-[#f8fafc] flex items-center space-x-2 shrink-0"
          >
            <input
              type="text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Ketik balasan WhatsApp langsung ke nomor ini..."
              className="flex-1 px-3.5 py-2.5 bg-white border border-[#d1d7db] hover:border-[#008069] focus:border-[#008069] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none shadow-xs transition"
            />
            <button
              type="submit"
              disabled={sending || !replyText.trim()}
              className="px-4 py-2.5 bg-[#008069] hover:bg-[#00a884] active:scale-95 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition shadow-xs flex items-center space-x-1.5 shrink-0"
            >
              {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              <span>Kirim</span>
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
};

export default ChatHistoryModal;
