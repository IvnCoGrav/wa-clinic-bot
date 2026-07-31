import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { 
  MessageSquare, 
  AlertTriangle, 
  Play, 
  User, 
  Clock, 
  Loader, 
  CheckCircle, 
  MessageCircle,
  MapPin,
  HelpCircle
} from 'lucide-react';

interface ChatMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  content: string;
  created_at: string;
}

interface Conversation {
  id: string;
  current_state: string;
  is_human_handling: boolean;
  human_handling_since: string | null;
  escalation_reason: string | null;
  customer: {
    id: string;
    phone: string;
    name: string | null;
    kelurahan: string | null;
    kecamatan: string | null;
    ongkir: number | null;
    distance: number | null;
  } | null;
  messages?: ChatMessage[];
}

export const LiveChatMonitor: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [chats, setChats] = useState<Conversation[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [releasingId, setReleasingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadChats = async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {
      const res = await apiRequest('/api/admin/human-handling-conversations');
      const data = Array.isArray(res) ? res : (res?.data || []);
      setChats(data);
      setErrorMessage(null);
    } catch (err: any) {
      console.error('Failed to load human-handling conversations:', err);
      setErrorMessage(err.message || 'Gagal memuat percakapan aktif.');
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  // Poll active conversations every 2 seconds
  useEffect(() => {
    loadChats(true);
    const interval = setInterval(() => {
      loadChats(false);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleRelease = async (chat: Conversation) => {
    const isMedical = chat.escalation_reason === 'medical_concern';
    
    const confirmMessage = isMedical
      ? "🚨 [PERINGATAN DARURAT MEDIS]\n\nPercakapan ini ditandai sebagai eskalasi medis. Bot AI tidak memiliki auto-release waktu untuk kasus medis demi keselamatan.\n\nApakah Anda benar-benar yakin ingin mengembalikan chat ini ke respon otomatis AI Bot?"
      : "Apakah Anda yakin ingin mengembalikan percakapan ini ke bot otomatis? Bot akan mulai merespon chat berikutnya secara mandiri.";

    if (!window.confirm(confirmMessage)) return;

    setReleasingId(chat.id);
    try {
      await apiRequest(`/api/admin/conversation/${chat.id}/release`, {
        method: 'PATCH'
      });
      // Refresh list
      loadChats(false);
      if (selectedChatId === chat.id) {
        setSelectedChatId(null);
      }
    } catch (err: any) {
      alert(`Gagal merilis percakapan ke bot: ${err.message}`);
    } finally {
      setReleasingId(null);
    }
  };

  const selectedChat = chats.find(c => c.id === selectedChatId);

  const getElapsedTime = (sinceStr: string | null) => {
    if (!sinceStr) return '';
    const diffMs = Date.now() - new Date(sinceStr).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins} menit lalu`;
    const diffHours = Math.floor(diffMins / 60);
    const remainingMins = diffMins % 60;
    return `${diffHours} jam ${remainingMins} menit lalu`;
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
            Pantau chat yang sedang ditangani oleh Admin/Bidan secara real-time dan kembalikan penanganan ke AI Bot kapan saja.
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">Live Polling (2s)</span>
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
          
          {/* Active Conversations List */}
          <div className="lg:col-span-5 space-y-4">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
              Daftar Chat Agent Aktif ({chats.length})
            </h3>
            
            {chats.length === 0 ? (
              <div className="glass-panel border border-white/5 rounded-2xl p-12 text-center text-slate-500 text-xs">
                <CheckCircle className="mx-auto text-emerald-500/80 mb-3" size={36} />
                <p className="font-bold text-slate-400">Semua chat aman!</p>
                <p className="text-slate-600 mt-1">Saat ini tidak ada percakapan aktif yang ditangani admin/human agent. Seluruh customer dilayani otomatis oleh AI.</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                {chats.map(chat => {
                  const isMedical = chat.escalation_reason === 'medical_concern';
                  const isSelected = chat.id === selectedChatId;
                  const chatPhone = chat.customer?.phone || 'Unknown';
                  const chatName = chat.customer?.name || 'Customer';
                  
                  return (
                    <div 
                      key={chat.id}
                      onClick={() => setSelectedChatId(chat.id)}
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
                            <span className="text-[10px] text-slate-500 font-normal">({chatPhone})</span>
                          </h4>
                          <span className={`inline-block px-2 py-0.5 rounded text-[8px] font-black uppercase ${
                            isMedical 
                              ? 'bg-rose-500/25 text-rose-300 border border-rose-500/30' 
                              : chat.escalation_reason === 'unresolved_faq'
                                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                          }`}>
                            {isMedical ? '🚨 MEDICAL EMERGENCY' : chat.escalation_reason || 'Human Request'}
                          </span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRelease(chat);
                          }}
                          disabled={releasingId === chat.id}
                          className={`px-2 py-1 rounded-lg text-[9px] font-black transition flex items-center space-x-1 uppercase disabled:opacity-50 ${
                            isMedical 
                              ? 'bg-rose-500 hover:bg-rose-600 text-white' 
                              : 'bg-pink-500 hover:bg-pink-600 text-white'
                          }`}
                        >
                          <Play size={10} fill="currentColor" />
                          <span>{releasingId === chat.id ? 'Releasing...' : 'Release'}</span>
                        </button>
                      </div>

                      {/* Last message preview */}
                      <p className="text-[11px] text-slate-400 line-clamp-1 italic font-sans leading-relaxed">
                        "{(chat.messages && chat.messages[0]?.content) || 'Tidak ada pesan'}"
                      </p>

                      <div className="flex justify-between items-center text-[10px] text-slate-500 pt-1 border-t border-white/5">
                        <span className="flex items-center space-x-1">
                          <Clock size={10} />
                          <span>{getElapsedTime(chat.human_handling_since)}</span>
                        </span>
                        <span className="font-mono text-[9px] uppercase">{chat.current_state}</span>
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
                        <span>Chat Inspector: {selectedChat.customer?.name || 'Customer'}</span>
                      </h3>
                      <p className="text-[11px] text-slate-500 font-mono mt-0.5">JID: {selectedChat.customer?.phone || 'Unknown'}@c.us</p>
                    </div>
                    <button
                      onClick={() => handleRelease(selectedChat)}
                      disabled={releasingId === selectedChat.id}
                      className="px-3.5 py-1.5 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-black transition flex items-center space-x-1.5 shadow-lg shadow-pink-500/10 disabled:opacity-50"
                    >
                      <Play size={12} fill="currentColor" />
                      <span>Kembalikan ke Bot</span>
                    </button>
                  </div>

                  {/* Customer Metadata pills */}
                  <div className="flex flex-wrap gap-2 pt-2">
                    <span className="px-2.5 py-0.5 rounded-full bg-slate-900 border border-white/5 text-slate-400 text-[10px] flex items-center space-x-1">
                      <MapPin size={10} />
                      <span>Kelurahan: {selectedChat.customer?.kelurahan || '-'}</span>
                    </span>
                    {selectedChat.customer?.distance !== undefined && selectedChat.customer?.distance !== null && (
                      <span className="px-2.5 py-0.5 rounded-full bg-slate-900 border border-white/5 text-slate-400 text-[10px]">
                        Jarak: {selectedChat.customer.distance.toFixed(2)} km
                      </span>
                    )}
                    {selectedChat.customer?.ongkir !== undefined && selectedChat.customer?.ongkir !== null && (
                      <span className="px-2.5 py-0.5 rounded-full bg-slate-900 border border-white/5 text-slate-400 text-[10px]">
                        Ongkir: Rp {selectedChat.customer.ongkir.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>

                {/* Chat Bubbles Container */}
                <div className="flex-1 overflow-y-auto py-4 space-y-3 my-4 pr-1">
                  {/* Map message history (reverse order to display oldest first) */}
                  {[...(selectedChat.messages || [])].reverse().map((msg) => {
                    const isUser = msg.direction === 'INBOUND';
                    return (
                      <div 
                        key={msg.id} 
                        className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                      >
                        <div className={`max-w-[80%] rounded-2xl p-3.5 text-xs leading-relaxed ${
                          isUser 
                            ? 'bg-pink-500 text-white rounded-tr-none'
                            : 'bg-slate-800 text-slate-100 rounded-tl-none border border-white/5'
                        }`}>
                          <p className="font-sans whitespace-pre-wrap">{msg.content}</p>
                          <span className="block text-[8px] text-slate-400/80 mt-1.5 text-right font-mono">
                            {msg.created_at ? new Date(msg.created_at).toLocaleTimeString() : ''}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Footer Info */}
                <div className="border-t border-white/5 pt-4 flex justify-between items-center text-xs">
                  <div className="flex items-center space-x-1.5 text-slate-500">
                    <HelpCircle size={14} />
                    <span>State Machine Saat Ini:</span>
                    <span className="font-bold text-slate-300 font-mono">{selectedChat.current_state}</span>
                  </div>
                  <span className="text-[10px] text-slate-500">Menampilkan 5 pesan historis terakhir</span>
                </div>

              </div>
            ) : (
              <div className="glass-panel border border-white/5 rounded-2xl p-12 h-[635px] flex flex-col justify-center items-center text-center text-slate-500 text-xs">
                <MessageSquare size={48} className="mb-4 text-slate-700" />
                <p className="font-bold text-slate-400">Pilih Percakapan</p>
                <p className="text-slate-600 max-w-sm mt-1">Pilih salah satu nomor customer dari daftar di sebelah kiri untuk menginspeksi rincian pesan dan mengembalikan kendalinya ke AI Bot.</p>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
};
