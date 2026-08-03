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
} from 'lucide-react';

interface ChatMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  content: string;
  sender_type?: string | null;
  sender_name?: string | null;
  created_at: string;
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
  lastMessageAt: string;
  createdAt: string;
  lastMessages?: ChatMessage[];
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
  const [releasingId, setReleasingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const chatsRef = useRef<LiveChatItem[]>([]);
  const selectedIdRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll ke pesan terbaru saat thread berubah / pesan baru masuk.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, selectedId]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const loadChats = async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {
      const res = await apiRequest('/api/admin/live-chat/conversations');
      const data = Array.isArray(res) ? res : (res?.data || []);
      setChats(data);
      chatsRef.current = data;
      setErrorMessage(null);
    } catch (err: any) {
      console.error('Failed to load live chat conversations:', err);
      setErrorMessage(err.message || 'Gagal memuat percakapan.');
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  const loadThread = async (conversationId: string) => {
    try {
      const res = await apiRequest(`/api/admin/live-chat/conversations/${conversationId}/messages`);
      setMessages(Array.isArray(res) ? res : (res?.data || []));
    } catch (err: any) {
      console.error('Failed to load conversation thread:', err);
      setMessages([]);
    }
  };

  const handleSelect = (conversationId: string) => {
    setSelectedId(conversationId);
    loadThread(conversationId);
  };

  // SSE real-time: message.created & conversation.updated
  useEffect(() => {
    loadChats(true);

    const unsubscribe = connectLiveChatSse({
      onStatusChange: (connected) => setSseConnected(connected),
      onEvent: (type, payload) => {
        if (type === 'message.created') {
          const conversationId = payload.conversationId;
          const msg: ChatMessage = {
            id: payload.messageId || `sse_${Date.now()}`,
            direction: payload.direction,
            content: payload.content || '',
            sender_type: payload.senderType || null,
            sender_name: payload.senderName || null,
            created_at: payload.createdAt || new Date().toISOString(),
          };

          // Append ke thread yang sedang dibuka (hindari duplikat by id)
          if (selectedIdRef.current === conversationId) {
            setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
          }

          // Update preview daftar
          const current = chatsRef.current;
          const existing = current.find((c) => c.conversationId === conversationId);
          if (existing) {
            const updated = current.map((c) =>
              c.conversationId !== conversationId
                ? c
                : {
                    ...c,
                    lastMessageAt: payload.createdAt || c.lastMessageAt,
                    lastMessages: [...(c.lastMessages || []), msg].slice(-3),
                  }
            );
            setChats(updated);
            chatsRef.current = updated;
          } else {
            // Percakapan baru muncul → reload daftar
            loadChats(false);
          }
        } else if (type === 'conversation.updated') {
          const current = chatsRef.current;
          if (!current.some((c) => c.conversationId === payload.conversationId)) {
            loadChats(false);
            return;
          }
          const updated = current.map((c) =>
            c.conversationId === payload.conversationId
              ? {
                  ...c,
                  currentState: payload.currentState ?? c.currentState,
                  isHumanHandling: !!payload.isHumanHandling,
                  humanHandlingSince: payload.humanHandlingSince ?? c.humanHandlingSince,
                  escalationReason: payload.escalationReason ?? c.escalationReason,
                }
              : c
          );
          setChats(updated);
          chatsRef.current = updated;
        }
      },
    });

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      });
      loadChats(false);
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

  const handleSendReply = async () => {
    if (!selectedId || !replyText.trim()) return;
    setSending(true);
    try {
      await apiRequest(`/api/admin/live-chat/conversations/${selectedId}/reply`, {
        method: 'POST',
        body: JSON.stringify({ text: replyText.trim(), adminName: user?.email || 'Admin' }),
      });
      setReplyText('');
      toast('Balasan admin terkirim.', 'success');
    } catch (err: any) {
      toast(`Gagal mengirim balasan: ${err.message}`, 'error');
    } finally {
      setSending(false);
    }
  };

  const selectedChat = chats.find((c) => c.conversationId === selectedId);

  const getElapsedTime = (sinceStr: string | null) => {
    if (!sinceStr) return '';
    const diffMs = Date.now() - new Date(sinceStr).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins} menit lalu`;
    const diffHours = Math.floor(diffMins / 60);
    const remainingMins = diffMins % 60;
    return `${diffHours} jam ${remainingMins} menit lalu`;
  };

  const senderLabel = (m: ChatMessage) => {
    if (m.direction === 'INBOUND') return 'Customer';
    return m.sender_type === 'ADMIN' ? m.sender_name || 'Admin' : 'Bot';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center space-x-2">
            <MessageSquare className="text-pink-500" />
            <span>Live Chat Monitor</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Pantau percakapan dan balas langsung dari dashboard secara real-time.
          </p>
        </div>
        <div className="flex items-center space-x-2">
          {sseConnected ? (
            <>
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider flex items-center space-x-1">
                <Wifi size={12} />
                <span>SSE Real-time</span>
              </span>
            </>
          ) : (
            <>
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse"></span>
              <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider flex items-center space-x-1">
                <WifiOff size={12} />
                <span>Menyambung ulang...</span>
              </span>
            </>
          )}
        </div>
      </div>

      {errorMessage && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/25 text-rose-400 text-xs font-medium flex items-center space-x-2">
          <AlertTriangle size={16} />
          <span>{errorMessage}</span>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center items-center py-20">
          <Loader className="animate-spin text-pink-500" size={36} />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Conversations List */}
          <div className="lg:col-span-5 space-y-4">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
              Daftar Percakapan ({chats.length})
            </h3>

            {chats.length === 0 ? (
              <div className="glass-panel border border-white/5 rounded-2xl p-12 text-center text-slate-500 text-xs">
                <CheckCircle className="mx-auto text-emerald-500/80 mb-3" size={36} />
                <p className="font-bold text-slate-400">Belum ada percakapan</p>
                <p className="text-slate-600 mt-1">Percakapan baru akan muncul di sini secara real-time.</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                {chats.map((chat) => {
                  const isMedical = chat.escalationReason === 'medical_concern';
                  const isSelected = chat.conversationId === selectedId;
                  const chatName = chat.customerName || 'Customer';
                  const preview = chat.lastMessages && chat.lastMessages.length > 0
                    ? chat.lastMessages[chat.lastMessages.length - 1]?.content
                    : null;

                  return (
                    <div
                      key={chat.conversationId}
                      onClick={() => handleSelect(chat.conversationId)}
                      className={`glass-card rounded-2xl p-4 border transition cursor-pointer text-left flex flex-col justify-between space-y-3 ${
                        isSelected
                          ? 'border-pink-500/50 bg-pink-500/5'
                          : isMedical
                            ? 'border-rose-500/20 bg-rose-500/5 hover:border-rose-500/40'
                            : 'border-white/5 hover:border-white/10'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="space-y-1">
                          <h4 className="font-bold text-white text-xs flex items-center space-x-1.5">
                            <User size={12} className="text-slate-400" />
                            <span>{chatName}</span>
                            <span className="text-[10px] text-slate-500 font-normal">({chat.customerPhone || 'Unknown'})</span>
                          </h4>
                          <span className={`inline-block px-2 py-0.5 rounded text-[8px] font-black uppercase ${
                            isMedical
                              ? 'bg-rose-500/25 text-rose-300 border border-rose-500/30'
                              : chat.escalationReason === 'unresolved_faq'
                                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                          }`}>
                            {isMedical ? '🚨 MEDICAL EMERGENCY' : chat.escalationReason || 'Human Request'}
                          </span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRelease(chat);
                          }}
                          disabled={releasingId === chat.conversationId}
                          className={`px-2 py-1 rounded-lg text-[9px] font-black transition flex items-center space-x-1 uppercase disabled:opacity-50 ${
                            isMedical
                              ? 'bg-rose-500 hover:bg-rose-600 text-white'
                              : 'bg-pink-500 hover:bg-pink-600 text-white'
                          }`}
                        >
                          <Play size={10} fill="currentColor" />
                          <span>{releasingId === chat.conversationId ? 'Releasing...' : 'Release'}</span>
                        </button>
                      </div>

                      <p className="text-[11px] text-slate-400 line-clamp-1 italic font-sans leading-relaxed">
                        "{preview || 'Tidak ada pesan'}"
                      </p>

                      <div className="flex justify-between items-center text-[10px] text-slate-500 pt-1 border-t border-white/5">
                        <span className="flex items-center space-x-1">
                          <Clock size={10} />
                          <span>{chat.isHumanHandling ? getElapsedTime(chat.humanHandlingSince) : 'Ditangani bot'}</span>
                        </span>
                        <span className="font-mono text-[9px] uppercase">{chat.currentState}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Panel - Chat Inspector */}
          <div className="lg:col-span-7">
            {selectedChat ? (
              <div className="glass-panel border border-white/5 rounded-2xl p-6 h-[635px] flex flex-col justify-between">
                {/* Header Info */}
                <div className="border-b border-white/5 pb-4 space-y-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="text-base font-bold text-white flex items-center space-x-2">
                        <MessageCircle className="text-pink-400" />
                        <span>{selectedChat.customerName || 'Customer'}</span>
                      </h3>
                      <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                        {selectedChat.customerPhone || 'Unknown'}@c.us
                      </p>
                    </div>
                    <button
                      onClick={() => handleRelease(selectedChat)}
                      disabled={releasingId === selectedChat.conversationId}
                      className="px-3.5 py-1.5 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-black transition flex items-center space-x-1.5 shadow-lg shadow-pink-500/10 disabled:opacity-50"
                    >
                      <Play size={12} fill="currentColor" />
                      <span>Kembalikan ke Bot</span>
                    </button>
                  </div>
                </div>

                {/* Chat Bubbles Container */}
                <div className="flex-1 overflow-y-auto py-4 space-y-3 my-4 pr-1">
                  {messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center text-slate-600 text-xs">
                      <MessageCircle size={32} className="mb-2 text-slate-700" />
                      <p>Belum ada pesan di percakapan ini.</p>
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const isCustomer = msg.direction === 'INBOUND';
                      const isAdmin = msg.direction === 'OUTBOUND' && msg.sender_type === 'ADMIN';
                      return (
                        <div key={msg.id} className={`flex ${isCustomer ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[80%] rounded-2xl p-3.5 text-xs leading-relaxed ${
                            isCustomer
                              ? 'bg-pink-500 text-white rounded-tr-none'
                              : isAdmin
                                ? 'bg-emerald-600/80 text-white rounded-tl-none'
                                : 'bg-slate-800 text-slate-100 rounded-tl-none border border-white/5'
                          }`}>
                            <span className={`block text-[8px] font-black uppercase tracking-wider mb-1 flex items-center space-x-1 ${
                              isCustomer ? 'text-pink-100' : isAdmin ? 'text-emerald-100' : 'text-slate-400'
                            }`}>
                              {!isCustomer && !isAdmin && <Bot size={9} />}
                              <span>{senderLabel(msg)}</span>
                            </span>
                            <p className="font-sans whitespace-pre-wrap">{msg.content}</p>
                            <span className="block text-[8px] text-slate-400/80 mt-1.5 text-right font-mono">
                              {msg.created_at ? new Date(msg.created_at).toLocaleTimeString() : ''}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Reply Composer */}
                <div className="border-t border-white/5 pt-4">
                  <div className="flex items-end space-x-2">
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendReply();
                        }
                      }}
                      rows={2}
                      placeholder="Tulis balasan sebagai admin... (Enter kirim, Shift+Enter baris baru)"
                      className="flex-1 resize-none rounded-xl bg-slate-900 border border-white/10 focus:border-emerald-500/50 focus:outline-none text-xs text-slate-200 placeholder-slate-600 p-3"
                    />
                    <button
                      onClick={handleSendReply}
                      disabled={sending || !replyText.trim()}
                      className="px-4 py-3 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white rounded-xl text-xs font-black transition flex items-center space-x-1.5 shadow-lg shadow-emerald-500/10"
                    >
                      <Send size={13} />
                      <span>{sending ? 'Mengirim...' : 'Kirim'}</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="glass-panel border border-white/5 rounded-2xl p-12 h-[635px] flex flex-col justify-center items-center text-center text-slate-500 text-xs">
                <MessageSquare size={48} className="mb-4 text-slate-700" />
                <p className="font-bold text-slate-400">Pilih Percakapan</p>
                <p className="text-slate-600 max-w-sm mt-1">
                  Pilih salah satu percakapan dari daftar di sebelah kiri untuk melihat thread dan membalas langsung.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
