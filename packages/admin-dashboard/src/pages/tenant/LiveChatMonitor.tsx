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
  trafficSource?: 'meta' | 'legacy' | null;
  purchaseCount?: number;
  ltv?: number;
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
  const [labelFilter, setLabelFilter] = useState<'all' | 'medical_concern' | 'unresolved_faq' | 'human_request'>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'real' | 'sandbox'>('all');
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [syncingHistory, setSyncingHistory] = useState(false);
  const [syncNextOffset, setSyncNextOffset] = useState<number | null>(null);
  const [syncProgress, setSyncProgress] = useState<string | null>(null);
  const [gatewayCapability, setGatewayCapability] = useState<{ provider: string; supportsRevoke: boolean } | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const chatsRef = useRef<LiveChatItem[]>([]);
  const selectedIdRef = useRef<string | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);
  const firstRenderRef = useRef(true);

  // Auto-scroll internal container ke pesan terbaru saat thread berubah / pesan baru masuk.
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, selectedId]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // Load gateway capability on mount
  useEffect(() => {
    apiRequest('/api/admin/gateway-capability')
      .then((res) => {
        if (res?.success && res.data) setGatewayCapability(res.data);
      })
      .catch(() => {});
  }, []);

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
            sender_type: payload.senderType || payload.sender_type || null,
            sender_name: payload.senderName || payload.sender_name || null,
            created_at: payload.createdAt || payload.created_at || new Date().toISOString(),
            media: extractMedia(payload),
          };

          // Append ke thread yang sedang dibuka (hindari duplikat by id / timestamp & content)
          if (selectedIdRef.current === conversationId) {
            setMessages((prev) =>
              prev.some(
                (m) =>
                  m.id === msg.id ||
                  (m.content === msg.content &&
                    m.direction === msg.direction &&
                    Math.abs(new Date(m.created_at).getTime() - new Date(msg.created_at).getTime()) < 3000)
              )
                ? prev
                : [...prev, msg]
            );
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
                    lastMessageAt: payload.createdAt || payload.created_at || c.lastMessageAt,
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
        } else if (type === 'message.updated' && payload?.messageId) {
          const { messageId, content, isRevoked } = payload;
          if (selectedIdRef.current === payload.conversationId) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === messageId ? { ...m, content, is_revoked: isRevoked } : m
              )
            );
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
    return m.sender_type === 'ADMIN' ? m.sender_name || 'Admin' : 'Bot';
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#111b21] tracking-tight flex items-center space-x-2">
            <MessageSquare className="text-[#008069]" size={22} />
            <span>Live Chat Monitor</span>
          </h1>
          <p className="text-xs text-[#667781] mt-0.5">
            Pantau percakapan dan balas langsung dari dashboard secara real-time.
          </p>
        </div>
        <div className="flex items-center space-x-2.5">
          <button
            onClick={() => handleSyncHistory(syncNextOffset ?? 0)}
            disabled={syncingHistory}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-white hover:bg-[#f0f2f5] text-[#111b21] border border-[#d1d7db] shadow-xs transition flex items-center space-x-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            title={syncNextOffset !== null ? 'Lanjutkan sinkronisasi batch berikutnya' : 'Backfill history chat dari WAHA ke Live Chat (batch 50)'}
          >
            {syncingHistory ? <Loader size={12} className="animate-spin text-[#008069]" /> : <RefreshCw size={12} />}
            <span>{syncingHistory ? 'Menyinkronkan...' : syncNextOffset !== null ? `Load More Sync (${syncNextOffset})` : 'Sync WAHA History'}</span>
          </button>
          <div className="flex items-center space-x-1.5 px-2.5 py-1 bg-white border border-[#e9edef] rounded-xl shadow-xs">
            {sseConnected ? (
              <>
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="text-[11px] text-emerald-700 font-semibold flex items-center space-x-1">
                  <Wifi size={11} />
                  <span>Real-time</span>
                </span>
              </>
            ) : (
              <>
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse"></span>
                <span className="text-[11px] text-amber-700 font-semibold flex items-center space-x-1">
                  <WifiOff size={11} />
                  <span>Menyambung...</span>
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {syncProgress && (
        <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 text-sky-800 text-xs font-medium flex items-center space-x-2">
          <RefreshCw size={14} className="text-sky-600" />
          <span>{syncProgress}</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium flex items-center space-x-2">
          <AlertTriangle size={15} className="text-rose-600" />
          <span>{errorMessage}</span>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center items-center py-20">
          <Loader className="animate-spin text-[#008069]" size={32} />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Conversations List */}
          <div className="lg:col-span-5 space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="text-xs font-bold text-[#667781] uppercase tracking-wider block">
                Daftar Percakapan
              </h3>
              <select
                value={labelFilter}
                onChange={(e) => setLabelFilter(e.target.value as typeof labelFilter)}
                className="px-2.5 py-1 bg-white border border-[#d1d7db] rounded-lg text-xs font-semibold text-[#111b21] focus:outline-none focus:border-[#008069] cursor-pointer shadow-xs"
              >
                <option value="all">Semua (Normal + Label)</option>
                <option value="human_request">Human Request</option>
                <option value="medical_concern">Medical Emergency</option>
                <option value="unresolved_faq">Unresolved FAQ</option>
              </select>
            </div>

            {/* Filter sumber percakapan: WhatsApp asli vs sandbox/test */}
            <div className="flex items-center space-x-1 p-1 bg-white border border-[#e9edef] rounded-xl w-fit shadow-xs">
              {(
                [
                  { value: 'all', label: 'Semua' },
                  { value: 'real', label: 'WhatsApp Asli' },
                  { value: 'sandbox', label: 'Sandbox/Test' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSourceFilter(opt.value)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition flex items-center space-x-1.5 cursor-pointer ${
                    sourceFilter === opt.value
                      ? opt.value === 'sandbox'
                        ? 'bg-purple-100 text-purple-800 border border-purple-200 shadow-xs'
                        : opt.value === 'real'
                          ? 'bg-[#e8f5f2] text-[#008069] border border-[#c2e7e0] shadow-xs'
                          : 'bg-[#111b21] text-white shadow-xs'
                      : 'text-[#667781] hover:text-[#111b21] hover:bg-[#f0f2f5]'
                  }`}
                >
                  {opt.value === 'sandbox' && <FlaskConical size={11} />}
                  {opt.value === 'real' && <CheckCircle size={11} />}
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>

            {filteredChats.length === 0 ? (
              <div className="bg-white border border-[#e9edef] rounded-2xl p-10 text-center text-[#667781] text-xs shadow-xs">
                <CheckCircle className="mx-auto text-[#008069] mb-2" size={32} />
                <p className="font-bold text-[#111b21]">
                  {chats.length === 0 ? 'Belum ada percakapan' : 'Tidak ada percakapan sesuai filter'}
                </p>
                <p className="text-[#667781] mt-1">
                  {chats.length === 0
                    ? 'Percakapan baru akan muncul di sini secara real-time.'
                    : 'Coba ganti filter label atau pilih "Semua Label".'}
                </p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[620px] overflow-y-auto pr-1">
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
                      className={`bg-white rounded-xl p-3.5 border transition cursor-pointer text-left flex flex-col justify-between space-y-2.5 shadow-xs ${
                        isSelected
                          ? 'border-[#008069] bg-[#e8f5f2] ring-1 ring-[#008069]'
                          : isMedical
                            ? 'border-rose-300 bg-rose-50/40 hover:bg-rose-50/70'
                            : 'border-[#e9edef] hover:border-[#c2e7e0] hover:bg-[#f8fafc]'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="space-y-0.5">
                          <h4 className="font-bold text-[#111b21] text-xs flex items-center space-x-1.5">
                            <User size={13} className="text-[#8696a0]" />
                            <span>{chatName}</span>
                            <span className="text-[11px] text-[#667781] font-normal">({chat.customerPhone || 'Unknown'})</span>
                          </h4>
                        </div>
                        {chat.isHumanHandling ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRelease(chat);
                            }}
                            disabled={releasingId === chat.conversationId}
                            className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition flex items-center space-x-1 uppercase disabled:opacity-50 ${
                              isMedical
                                ? 'bg-rose-600 hover:bg-rose-700 text-white'
                                : 'bg-[#008069] hover:bg-[#00a884] text-white'
                            }`}
                          >
                            <Play size={9} fill="currentColor" />
                            <span>{releasingId === chat.conversationId ? 'Releasing...' : 'Release'}</span>
                          </button>
                        ) : (
                          <span
                            title="Ditangani bot"
                            className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-[#f0f2f5] text-[#667781] border border-[#e9edef]"
                          >
                            <Bot size={12} />
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-[#54656f] line-clamp-1 italic leading-relaxed">
                        "{preview || 'Tidak ada pesan'}"
                      </p>

                      <div className="flex justify-between items-center text-[10px] text-[#667781] pt-1.5 border-t border-[#e9edef]">
                          <span className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                            <span className="flex items-center space-x-1" title={chat.isHumanHandling ? 'Ditangani admin' : 'Ditangani bot'}>
                              <Clock size={11} />
                              <span>
                                {chat.isHumanHandling
                                  ? getElapsedTime(chat.humanHandlingSince) || 'Ditangani admin'
                                  : 'Bot'}
                              </span>
                            </span>
                            {isMedical && (
                              <span
                                title="Medical Emergency"
                                className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-100 text-rose-700 border border-rose-200"
                              >
                                <AlertTriangle size={9} className="mr-0.5" />
                                Medis
                              </span>
                            )}
                            {!isMedical && chat.escalationReason === 'unresolved_faq' && (
                              <span
                                title="Unresolved FAQ"
                                className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-200"
                              >
                                <Info size={9} className="mr-0.5" />
                                FAQ
                              </span>
                            )}
                            {chat.isMql && (
                              <span
                                title={`MQL (${chat.mqlBubbleCount ?? 0} Bubble)`}
                                className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200"
                              >
                                <Zap size={9} className="mr-0.5" />
                                MQL
                              </span>
                            )}
                            {chat.trafficSource === 'meta' && (
                              <span
                                title="Traffic Meta"
                                className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-sky-100 text-sky-800 border border-sky-200"
                              >
                                <Facebook size={9} className="mr-0.5" />
                                Meta
                              </span>
                            )}
                            {chat.isSandboxTest && (
                              <span
                                className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-100 text-purple-800 border border-purple-200"
                                title="Chat test/simulasi"
                              >
                                Sandbox
                              </span>
                            )}
                            {!!chat.purchaseCount && chat.purchaseCount > 0 && (
                              <span
                                title={
                                  chat.purchaseCount === 1
                                    ? `Purchase 1x (LTV: ${formatRp(chat.ltv || 0)})`
                                    : `Repeat Order ${chat.purchaseCount}x (LTV: ${formatRp(chat.ltv || 0)})`
                                }
                                className={`inline-flex items-center space-x-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                                  chat.purchaseCount === 1
                                    ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                                    : 'bg-amber-100 text-amber-800 border-amber-200'
                                }`}
                              >
                                <ShoppingBag size={9} className="mr-0.5" />
                                <span>{chat.purchaseCount}x</span>
                              </span>
                            )}
                          </span>
                          <span className="flex items-center space-x-2">
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

          {/* Right Panel - Chat Inspector */}
          <div className="lg:col-span-7">
            {selectedChat ? (
              <div className="bg-white border border-[#e9edef] rounded-2xl p-4 sm:p-5 h-[650px] flex flex-col justify-between shadow-xs">
                {/* Header Info */}
                <div className="border-b border-[#e9edef] pb-3 space-y-2">
                  {selectedChat.isSandboxTest && (
                    <div className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-purple-50 border border-purple-200 text-purple-700 text-xs font-bold uppercase tracking-wider">
                      <FlaskConical size={12} />
                      <span>QA TEST — chat simulasi, bukan WhatsApp asli</span>
                    </div>
                  )}
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="text-sm font-bold text-[#111b21] flex items-center space-x-2">
                        <MessageCircle className="text-[#008069]" size={16} />
                        <span>{selectedChat.customerName || 'Customer'}</span>
                      </h3>
                      <p className="text-xs text-[#667781] font-mono mt-0.5">
                        {selectedChat.customerPhone || 'Unknown'}
                      </p>
                      {!!selectedChat.purchaseCount && selectedChat.purchaseCount > 0 && (
                        <p className="text-xs text-[#008069] font-medium flex items-center space-x-1 mt-0.5">
                          <ShoppingBag size={11} />
                          <span>{selectedChat.purchaseCount === 1 ? 'Purchase 1x' : `Repeat Order ${selectedChat.purchaseCount}x`}</span>
                          {!!selectedChat.ltv && selectedChat.ltv > 0 && (
                            <span className="text-[#667781]">· LTV: {formatRp(selectedChat.ltv)}</span>
                          )}
                        </p>
                      )}
                    </div>
                    {selectedChat.isHumanHandling ? (
                      <button
                        onClick={() => handleRelease(selectedChat)}
                        disabled={releasingId === selectedChat.conversationId}
                        className="px-3 py-1.5 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50"
                      >
                        <Play size={11} fill="currentColor" />
                        <span>Kembalikan ke Bot</span>
                      </button>
                    ) : (
                      <span
                        title="Ditangani Bot"
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#f0f2f5] text-[#54656f] border border-[#e9edef] rounded-xl text-xs font-semibold uppercase tracking-wider"
                      >
                        <Bot size={12} />
                        <span>Bot</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Chat Bubbles Container with WhatsApp Wallpaper */}
                <div 
                  ref={chatContainerRef} 
                  className="flex-1 overflow-y-auto p-4 space-y-3 my-3 rounded-xl border border-[#e9edef] bg-[#efeae2]"
                  style={{
                    backgroundImage: `radial-gradient(#d1d7db 0.75px, transparent 0.75px)`,
                    backgroundSize: '16px 16px',
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
                      const isAdmin = msg.direction === 'OUTBOUND' && msg.sender_type === 'ADMIN';
                      const isRevoked = msg.content === '🚫 Pesan ini telah ditarik' || (msg as any).is_revoked || (msg as any).payload_raw?.is_revoked;
                      const canRevoke = !isCustomer && !isRevoked && !!gatewayCapability?.supportsRevoke;

                      return (
                        <div key={msg.id} className={`flex ${isCustomer ? 'justify-start' : 'justify-end'}`}>
                          <div className={`max-w-[82%] sm:max-w-[70%] rounded-lg px-3 py-2 text-xs leading-relaxed shadow-xs ${
                            isCustomer
                              ? 'bg-white text-[#111b21] rounded-tl-none border border-black/5'
                              : isAdmin
                                ? 'bg-[#d9fdd3] text-[#111b21] rounded-tr-none border border-[#00a884]/20'
                                : 'bg-white text-[#111b21] rounded-tr-none border-l-4 border-[#008069]'
                          }`}>
                            <span className={`block text-[10px] font-bold mb-1 flex items-center space-x-1 ${
                              isCustomer ? 'text-[#667781]' : isAdmin ? 'text-[#008069]' : 'text-[#008069]'
                            }`}>
                              {!isCustomer && !isAdmin && <Bot size={10} />}
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
                              <p className={`font-sans whitespace-pre-wrap ${isRevoked ? 'italic text-[#667781]' : ''}`}>{msg.content}</p>
                            )}
                            <div className="flex items-center justify-end space-x-1.5 mt-1 text-right select-none text-[10px] text-[#667781]">
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
                <div className="border-t border-[#e9edef] pt-3">
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
                  <div className="flex items-end space-x-2 bg-[#f0f2f5] p-2 rounded-xl border border-[#e9edef]">
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
                      className="p-2 bg-white border border-[#d1d7db] hover:border-[#008069] disabled:opacity-40 text-[#54656f] hover:text-[#008069] rounded-xl text-xs font-bold transition flex items-center shadow-xs"
                      title="Lampirkan gambar"
                    >
                      <ImagePlus size={15} />
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
                      className="flex-1 resize-none rounded-xl bg-white border border-[#d1d7db] focus:border-[#008069] focus:ring-1 focus:ring-[#008069] focus:outline-none text-xs text-[#111b21] placeholder-[#8696a0] p-2.5 shadow-xs"
                    />
                    <button
                      onClick={handleSendReply}
                      disabled={sending || (!replyText.trim() && !selectedImage)}
                      className="px-3.5 py-2.5 bg-[#008069] hover:bg-[#00a884] disabled:opacity-40 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-xs"
                    >
                      <Send size={13} />
                      <span>{sending ? 'Mengirim...' : 'Kirim'}</span>
                    </button>
                  </div>
                </>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-white border border-[#e9edef] rounded-2xl p-12 h-[650px] flex flex-col justify-center items-center text-center text-[#667781] text-xs shadow-xs">
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
    </div>
  );
};
