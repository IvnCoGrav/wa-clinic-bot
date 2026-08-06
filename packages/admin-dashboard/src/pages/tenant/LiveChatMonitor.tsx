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
} from 'lucide-react';
import { MediaImage, ChatMediaData } from '../../components/common/MediaImage';

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
  isMql?: boolean;
  mqlBubbleCount?: number;
  isSandboxTest?: boolean;
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
  const [selectedImage, setSelectedImage] = useState<{ file: File; preview: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [releasingId, setReleasingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [labelFilter, setLabelFilter] = useState<'all' | 'medical_concern' | 'unresolved_faq' | 'human_request'>('human_request');
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const chatsRef = useRef<LiveChatItem[]>([]);
  const selectedIdRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const listSentinelRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);
  const firstRenderRef = useRef(true);

  // Auto-scroll ke pesan terbaru saat thread berubah / pesan baru masuk.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, selectedId]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // Infinite scroll: muat halaman berikutnya saat sentinel terlihat di ujung daftar.
  useEffect(() => {
    const sentinel = listSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMoreRef.current) {
          loadChats(false);
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, labelFilter]);

  // Ganti filter label → reset daftar ke halaman pertama.
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    loadChats(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelFilter]);

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
      const res = await apiRequest(`/api/admin/live-chat/conversations?limit=50&offset=${offset}`);
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

  const loadThread = async (conversationId: string) => {
    try {
      const res = await apiRequest(`/api/admin/live-chat/conversations/${conversationId}/messages`);
      const list: ChatMessage[] = Array.isArray(res) ? res : (res?.data || []);
      setMessages(list.map((m) => ({ ...m, media: extractMedia(m) })));
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

    const unsubscribe = connectLiveChatSse({      onStatusChange: (connected) => setSseConnected(connected),
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
            media: extractMedia(payload),
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

  const getChatLabel = (chat: LiveChatItem): 'medical_concern' | 'unresolved_faq' | 'human_request' => {
    if (chat.escalationReason === 'medical_concern') return 'medical_concern';
    if (chat.escalationReason === 'unresolved_faq') return 'unresolved_faq';
    return 'human_request';
  };

  const filteredChats = chats.filter(
    (chat) => labelFilter === 'all' || getChatLabel(chat) === labelFilter
  );

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
            <div className="flex justify-between items-center">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                Daftar Percakapan
              </h3>
              <select
                value={labelFilter}
                onChange={(e) => setLabelFilter(e.target.value as typeof labelFilter)}
                className="px-2.5 py-1.5 bg-slate-900 border border-white/10 rounded-lg text-[10px] font-bold text-slate-300 focus:outline-none focus:border-pink-500 cursor-pointer"
              >
                <option value="human_request">Human Request</option>
                <option value="medical_concern">Medical Emergency</option>
                <option value="unresolved_faq">Unresolved FAQ</option>
                <option value="all">Semua Label</option>
              </select>
            </div>

            {filteredChats.length === 0 ? (
              <div className="glass-panel border border-white/5 rounded-2xl p-12 text-center text-slate-500 text-xs">
                <CheckCircle className="mx-auto text-emerald-500/80 mb-3" size={36} />
                <p className="font-bold text-slate-400">
                  {chats.length === 0 ? 'Belum ada percakapan' : 'Tidak ada percakapan sesuai filter'}
                </p>
                <p className="text-slate-600 mt-1">
                  {chats.length === 0
                    ? 'Percakapan baru akan muncul di sini secara real-time.'
                    : 'Coba ganti filter label atau pilih "Semua Label".'}
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
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
                      onClick={() => handleSelect(chat.conversationId)}
                      className={`glass-card rounded-2xl p-4 border transition cursor-pointer text-left flex flex-col justify-between space-y-3 ${
                        isSelected
                          ? 'border-pink-500 bg-pink-500/10 ring-2 ring-pink-500/40 shadow-lg shadow-pink-500/10 hover:!border-pink-400 hover:bg-pink-500/20'
                          : isMedical
                            ? 'border-rose-500/20 bg-rose-500/5 hover:!border-rose-500/50 hover:bg-rose-500/15'
                            : 'border-white/5 hover:!border-white/25 hover:bg-slate-800/60 hover:!shadow-none'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="space-y-1">
                          <h4 className="font-bold text-white text-xs flex items-center space-x-1.5">
                            <User size={12} className="text-slate-400" />
                            <span>{chatName}</span>
                            <span className="text-[10px] text-slate-500 font-normal">({chat.customerPhone || 'Unknown'})</span>
                          </h4>
                          <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                            <span className={`inline-block px-2 py-0.5 rounded text-[8px] font-black uppercase ${
                              isMedical
                                ? 'bg-rose-500/25 text-rose-300 border border-rose-500/30'
                                : chat.escalationReason === 'unresolved_faq'
                                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                  : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                            }`}>
                              {isMedical ? '🚨 MEDICAL EMERGENCY' : chat.escalationReason || 'Human Request'}
                            </span>
                            {chat.isMql && (
                              <span className="inline-block px-2 py-0.5 rounded text-[8px] font-black uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                ⚡ MQL ({chat.mqlBubbleCount ?? 0} Bubble)
                              </span>
                            )}
                            {chat.isSandboxTest && (
                              <span className="inline-block px-2 py-0.5 rounded text-[8px] font-black uppercase bg-purple-500/20 text-purple-300 border border-purple-500/30" title="Chat test/simulasi (bukan WhatsApp asli)">
                                🧪 QA TEST
                              </span>
                            )}
                          </div>
                        </div>
                        {chat.isHumanHandling ? (
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
                        ) : (
                          <span className="px-2 py-1 rounded-lg text-[9px] font-black uppercase bg-white/5 text-slate-500 border border-white/10">
                            Ditangani bot
                          </span>
                        )}
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
                {hasMore && (
                  <div ref={listSentinelRef} className="flex justify-center py-3">
                    <Loader size={16} className={`animate-spin text-pink-500 ${loadingMore ? '' : 'opacity-0'}`} />
                  </div>
                )}
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
                    {selectedChat.isHumanHandling ? (
                      <button
                        onClick={() => handleRelease(selectedChat)}
                        disabled={releasingId === selectedChat.conversationId}
                        className="px-3.5 py-1.5 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-black transition flex items-center space-x-1.5 shadow-lg shadow-pink-500/10 disabled:opacity-50"
                      >
                        <Play size={12} fill="currentColor" />
                        <span>Kembalikan ke Bot</span>
                      </button>
                    ) : (
                      <span className="px-3 py-1.5 bg-white/5 text-slate-500 border border-white/10 rounded-xl text-[10px] font-bold uppercase tracking-wider">
                        Ditangani Bot
                      </span>
                    )}
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
                            {msg.media && (
                              <div className="mb-2">
                                <MediaImage
                                  src={msg.media.url || msg.media.hdUrl}
                                  downloadSrc={msg.media.hdUrl}
                                  caption={msg.media.caption || undefined}
                                  blur={isCustomer}
                                />
                              </div>
                            )}
                            {msg.content && !/^\[(IMAGE|MEDIA|LOCATION)/.test(msg.content) && (
                              <p className="font-sans whitespace-pre-wrap">{msg.content}</p>
                            )}
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
                  {selectedImage && (
                    <div className="relative inline-block mb-2">
                      <img
                        src={selectedImage.preview}
                        alt="Preview"
                        className="w-24 h-20 object-cover rounded-xl border border-white/10"
                      />
                      <button
                        onClick={() => {
                          setSelectedImage(null);
                        }}
                        className="absolute -top-2 -right-2 p-1 rounded-full bg-rose-500 text-white shadow hover:bg-rose-600 transition"
                        title="Hapus lampiran"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )}
                  <div className="flex items-end space-x-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handlePickImage}
                      className="hidden"
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={sending}
                      className="px-3 py-3 bg-slate-900 border border-white/10 hover:border-pink-500/50 disabled:opacity-40 text-slate-400 hover:text-pink-400 rounded-xl text-xs font-bold transition flex items-center"
                      title="Lampirkan gambar"
                    >
                      <ImagePlus size={14} />
                    </button>
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
                      disabled={sending || (!replyText.trim() && !selectedImage)}
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
