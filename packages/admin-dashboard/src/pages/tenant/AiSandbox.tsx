import React, { useState, useEffect, useRef } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import { BRAND } from '../../config/brand';
import { 
  Send, 
  Terminal, 
  Eye, 
  Search, 
  Activity, 
  Cpu, 
  AlertOctagon,
  Sparkles,
  Edit3,
  Save,
  X,
  RefreshCw,
  Zap,
} from 'lucide-react';

interface ChatMessage {
  sender: 'user' | 'bot';
  content: string;
  timestamp: Date;
  isError?: boolean;
}

export const AiSandbox: React.FC = () => {
  const { toast, confirm } = useUiFeedback();
  const [sandboxPhone, setSandboxPhone] = useState<string>(() => {
    let stored = sessionStorage.getItem('sandbox_phone');
    if (!stored) {
      stored = '6289999' + Math.floor(100000 + Math.random() * 900000);
      sessionStorage.setItem('sandbox_phone', stored);
    }
    return stored;
  });

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const stored = sessionStorage.getItem('sandbox_messages');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((m: any) => ({
            ...m,
            timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
          }));
        }
      }
    } catch {}
    return [
      { sender: 'bot', content: `Halo Bunda! Saya asisten AI ${BRAND.businessName} (Sesi Baru ${sandboxPhone.substring(7)}). Silakan coba kirim pertanyaan di bawah untuk menguji respon RAG & Persona saya! 🌸`, timestamp: new Date() }
    ];
  });
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeRequests, setActiveRequests] = useState(0);
  
  // ⚡ Burst message simulation state
  const [burstMode, setBurstMode] = useState<boolean>(() => {
    try {
      const stored = sessionStorage.getItem('sandbox_burst_mode');
      if (stored !== null) return stored === 'true';
    } catch {}
    return true;
  });
  const [pendingBurst, setPendingBurst] = useState<string[]>([]);
  const pendingBurstRef = useRef<string[]>([]);
  const burstTimerRef = useRef<any>(null);
  const burstIntervalRef = useRef<any>(null);
  const [burstTimeLeft, setBurstTimeLeft] = useState<number>(0);

  // Simulated outage toggle
  const [sumoPodOutage, setSumoPodOutage] = useState(false);

  // Inspector state
  const [inspectorData, setInspectorData] = useState<any>(() => {
    try {
      const stored = sessionStorage.getItem('sandbox_inspector');
      if (stored) return JSON.parse(stored);
    } catch {}
    return {
      query: '',
      chunks: [],
      systemPrompt: `Kamu adalah asisten chat ramah dari ${BRAND.businessName}...`,
      latencyMs: 0
    };
  });

  // Edit chunk states
  const [editingChunkId, setEditingChunkId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingContent, setEditingContent] = useState('');
  const [editLoading, setEditLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [editingPersona, setEditingPersona] = useState(false);
  const [personaText, setPersonaText] = useState('');
  const [personaLoading, setPersonaLoading] = useState(false);

  const loadPersona = async () => {
    try {
      const res = await apiRequest('/api/admin/persona');
      setPersonaText(res.persona || '');
      setInspectorData((prev: any) => ({ ...prev, systemPrompt: res.persona || prev.systemPrompt }));
    } catch (err) {
      console.error('Failed to load persona:', err);
    }
  };

  useEffect(() => {
    loadPersona();
  }, []);

  // Sync messages to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem('sandbox_messages', JSON.stringify(messages));
    } catch {}
  }, [messages]);

  // Sync inspectorData to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem('sandbox_inspector', JSON.stringify(inspectorData));
    } catch {}
  }, [inspectorData]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const clearBurstTimers = () => {
    if (burstTimerRef.current) {
      clearTimeout(burstTimerRef.current);
      burstTimerRef.current = null;
    }
    if (burstIntervalRef.current) {
      clearInterval(burstIntervalRef.current);
      burstIntervalRef.current = null;
    }
    setBurstTimeLeft(0);
  };

  useEffect(() => {
    return () => {
      clearBurstTimers();
    };
  }, []);

  const handleNewCleanSession = () => {
    clearBurstTimers();
    pendingBurstRef.current = [];
    setPendingBurst([]);

    const newPhone = '6289999' + Math.floor(100000 + Math.random() * 900000);
    sessionStorage.setItem('sandbox_phone', newPhone);
    setSandboxPhone(newPhone);
    const initialMsgs: ChatMessage[] = [
      { sender: 'bot', content: `Sesi simulator baru dimulai (ID: ${newPhone.substring(7)})! Customer baru, state bersih dari INITIAL 🌸`, timestamp: new Date() }
    ];
    setMessages(initialMsgs);
    sessionStorage.setItem('sandbox_messages', JSON.stringify(initialMsgs));
    const emptyInspector = {
      query: '',
      chunks: [],
      systemPrompt: personaText || `Kamu adalah asisten chat ramah dari ${BRAND.businessName}...`,
      latencyMs: 0
    };
    setInspectorData(emptyInspector);
    sessionStorage.setItem('sandbox_inspector', JSON.stringify(emptyInspector));

    // Reset state percakapan di backend agar bersih dari HUMAN_HANDLING atau state lama
    apiRequest('/api/admin/sandbox/chat', {
      method: 'POST',
      body: JSON.stringify({ text: '/reset', sandboxPhone: newPhone })
    }).catch(() => {});
  };

  const handleStartEdit = (chunk: any) => {
    setEditingChunkId(chunk.id || chunk.title); // Use chunk.id, fallback to title
    setEditingTitle(chunk.title);
    setEditingContent(chunk.content);
  };

  const handleCancelEdit = () => {
    setEditingChunkId(null);
    setEditingTitle('');
    setEditingContent('');
  };
  const handleSaveEdit = async (chunkId: string) => {
    if (!editingTitle.trim() || !editingContent.trim() || editLoading) return;

    const isConfirmed = await confirm({
      title: 'Simpan Perubahan Chunk?',
      message: 'Perubahan ini bersifat PERMANEN dan langsung disimpan ke database utama (tabel KnowledgeChunk). Ini akan memengaruhi jawaban AI Bot untuk seluruh customer asli Anda di WhatsApp produksi.',
      confirmText: 'Ya, Simpan',
      danger: true,
    });
    if (!isConfirmed) return;

    setEditLoading(true);
    try {
      await apiRequest(`/api/admin/knowledge/chunks/${chunkId}`, {
        method: 'PUT',
        body: JSON.stringify({ title: editingTitle, content: editingContent })
      });
      
      // Update inspector local state
      setInspectorData((prev: any) => ({
        ...prev,
        chunks: prev.chunks.map((c: any) => 
          (c.id === chunkId || c.title === chunkId) ? { ...c, title: editingTitle, content: editingContent } : c
        )
      }));
      setEditingChunkId(null);
      toast('Chunk berhasil disimpan.', 'success');
    } catch (err: any) {
      toast(`Failed to save chunk: ${err.message}`, 'error');
    } finally {
      setEditLoading(false);
    }
  };

  const handleSavePersona = async () => {
    if (!personaText.trim() || personaLoading) return;
    const isConfirmed = await confirm({
      title: 'Simpan Perubahan Persona?',
      message: 'Perubahan ini bersifat PERMANEN dan langsung mengubah SYSTEM PERSONA PROMPT bot AI Anda secara live. Ini akan memengaruhi cara bot merespon seluruh chat customer asli Anda di WhatsApp produksi.',
      confirmText: 'Ya, Simpan',
      danger: true,
    });
    if (!isConfirmed) return;

    setPersonaLoading(true);
    try {
      await apiRequest('/api/admin/persona', {
        method: 'POST',
        body: JSON.stringify({ persona: personaText })
      });
      setEditingPersona(false);
      setInspectorData((prev: any) => ({ ...prev, systemPrompt: personaText }));
      toast('Persona berhasil disimpan.', 'success');
    } catch (err: any) {
      toast(`Gagal menyimpan perubahan persona: ${err.message}`, 'error');
    } finally {
      setPersonaLoading(false);
    }
  };

  const flushBurst = async (overrideList?: string[]) => {
    clearBurstTimers();
    const batch = overrideList && overrideList.length > 0 ? overrideList : [...pendingBurstRef.current];
    pendingBurstRef.current = [];
    setPendingBurst([]);

    if (batch.length === 0) return;

    setLoading(true);
    setActiveRequests(prev => prev + 1);
    const startTime = Date.now();

    try {
      const data = await apiRequest('/api/admin/sandbox/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: batch,
          text: batch.join('\n'),
          simulateOutage: sumoPodOutage,
          sandboxPhone,
        }),
        timeoutMs: 120000,
      });

      const endTime = Date.now();

      if (data.sentBubbles && Array.isArray(data.sentBubbles) && data.sentBubbles.length > 0) {
        const botBubbles = data.sentBubbles.map((bubbleText: string) => ({
          sender: 'bot' as const,
          content: bubbleText,
          timestamp: new Date(),
          isError: Boolean(data.llmError),
        }));
        setMessages(prev => [...prev, ...botBubbles]);
      } else {
        setMessages(prev => [...prev, {
          sender: 'bot',
          content: data.answer || 'Maaf, saya tidak mengerti maksud Bunda.',
          timestamp: new Date(),
          isError: Boolean(data.llmError),
        }]);
      }

      setInspectorData({
        query: data.query || batch.join('\n'),
        chunks: data.chunks || [],
        systemPrompt: `TUGAS UTAMA: Jawab pertanyaan customer tentang informasi/FAQ moms & baby spa berdasarkan Referensi Dokumen...`,
        latencyMs: endTime - startTime,
        error: data.llmError || null,
      });
    } catch (err: any) {
      setMessages(prev => [...prev, {
        sender: 'bot',
        content: `Error calling AI Generator: ${err.message}`,
        timestamp: new Date(),
        isError: true,
      }]);
    } finally {
      setActiveRequests(prev => {
        const next = Math.max(0, prev - 1);
        if (next === 0) {
          setLoading(false);
        }
        return next;
      });
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const userText = inputText.trim();
    setInputText('');

    // Append user message bubble to chat UI immediately
    const newMsg: ChatMessage = { sender: 'user', content: userText, timestamp: new Date() };
    setMessages(prev => [...prev, newMsg]);

    // Command (seperti /reset, /location) atau jika mode burst OFF -> kirim langsung seketika
    if (userText.startsWith('/') || !burstMode) {
      if (pendingBurstRef.current.length > 0) {
        const all = [...pendingBurstRef.current, userText];
        await flushBurst(all);
      } else {
        await flushBurst([userText]);
      }
      return;
    }

    // ⚡ Mode Burst ON: Tambahkan ke buffer dan mulai timer debounce 2.5s
    pendingBurstRef.current.push(userText);
    setPendingBurst([...pendingBurstRef.current]);

    clearBurstTimers();

    const BURST_WINDOW_MS = 2500;
    const targetEnd = Date.now() + BURST_WINDOW_MS;
    setBurstTimeLeft(BURST_WINDOW_MS);

    burstIntervalRef.current = setInterval(() => {
      const remaining = Math.max(0, targetEnd - Date.now());
      setBurstTimeLeft(remaining);
      if (remaining <= 0) {
        if (burstIntervalRef.current) clearInterval(burstIntervalRef.current);
      }
    }, 100);

    burstTimerRef.current = setTimeout(() => {
      flushBurst();
    }, BURST_WINDOW_MS);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[#111b21] flex items-center space-x-2">
            <Terminal className="text-[#008069]" size={22} />
            <span>AI Sandbox Simulator</span>
          </h2>
          <p className="text-xs text-[#667781] mt-0.5">Test respons AI WhatsApp, inspeksi hasil vector retrieval FAQ, dan simulasi kondisi error</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleNewCleanSession}
            className="px-3.5 py-2 bg-white hover:bg-[#f0f2f5] text-[#008069] border border-[#c2e7e0] rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 shadow-xs"
            title="Mulai sesi simulator customer baru yang bersih"
          >
            <Sparkles size={13} />
            <span>Sesi Bersih Baru</span>
          </button>

          {/* SumoPod Outage Toggle */}
          <div className="flex items-center space-x-2.5 bg-white border border-[#e9edef] px-3.5 py-1.5 rounded-xl shadow-xs">
            <span className="text-xs font-semibold text-[#54656f]">Simulasi Outage LLM</span>
            <button
              onClick={() => setSumoPodOutage(!sumoPodOutage)}
              className={`w-9 h-5 rounded-full transition-all relative ${sumoPodOutage ? 'bg-rose-500' : 'bg-[#d1d7db]'}`}
            >
              <div className={`absolute top-0.5 left-0.5 bg-white h-4 w-4 rounded-full transition-all ${sumoPodOutage ? 'translate-x-4' : ''}`}></div>
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Chat Simulator panel */}
        <div className="bg-white border border-[#e9edef] rounded-2xl p-5 flex flex-col h-[560px] justify-between shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-[#e9edef] mb-3">
            <span className="text-xs font-bold text-[#111b21] uppercase flex items-center space-x-1.5">
              <Sparkles size={14} className="text-[#008069]" />
              <span>Simulated WhatsApp Chat</span>
            </span>

            <div className="flex items-center space-x-2">
              {/* Burst Mode Toggle Pill */}
              <button
                type="button"
                onClick={() => {
                  const next = !burstMode;
                  setBurstMode(next);
                  try {
                    sessionStorage.setItem('sandbox_burst_mode', String(next));
                  } catch {}
                  if (!next && pendingBurstRef.current.length > 0) {
                    flushBurst();
                  }
                }}
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center space-x-1 border transition active:scale-95 ${
                  burstMode
                    ? 'bg-amber-50 border-amber-300 text-amber-800 shadow-2xs'
                    : 'bg-[#f0f2f5] border-[#d1d7db] text-[#54656f] hover:bg-white'
                }`}
                title="Mode Burst WhatsApp: Mengumpulkan pesan beruntun dalam window 2.5 detik sebelum bot membalas satu kali (seperti perilaku customer asli)."
              >
                <Zap size={11} className={burstMode ? 'text-amber-600 fill-amber-500' : 'text-[#8696a0]'} />
                <span>Burst (2.5s): {burstMode ? 'ON' : 'OFF'}</span>
              </button>

              {sumoPodOutage ? (
                <span className="px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-bold animate-pulse flex items-center space-x-1">
                  <AlertOctagon size={10} />
                  <span>LLM API OUTAGE</span>
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] font-bold">
                  AI Agent Active
                </span>
              )}
            </div>
          </div>

          {/* Messages list with WhatsApp light wallpaper */}
          <div className="flex-1 overflow-y-auto space-y-3 p-3 mb-3 bg-[#efeae2] rounded-xl border border-[#e9edef] shadow-inner" style={{ backgroundImage: 'radial-gradient(#d1d7db 0.75px, transparent 0.75px)', backgroundSize: '16px 16px' }}>
            {messages.map((msg, idx) => (
              <div 
                key={idx} 
                className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[85%] rounded-xl p-3 text-xs leading-relaxed shadow-xs ${
                  msg.sender === 'user' 
                    ? 'bg-[#d9fdd3] text-[#111b21] rounded-tr-none border border-[#00a884]/20'
                    : msg.isError 
                      ? 'bg-rose-50 border border-rose-200 text-rose-800 rounded-tl-none font-medium'
                      : 'bg-white text-[#111b21] rounded-tl-none border border-black/5'
                }`}>
                  <div className="whitespace-pre-wrap break-words font-sans">{msg.content}</div>
                  <span className="block text-[9px] text-[#667781] mt-1 text-right">
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-white border border-black/5 rounded-xl rounded-tl-none p-3 text-xs flex items-center space-x-1.5 text-[#667781] shadow-xs">
                  <div className="h-1.5 w-1.5 bg-[#008069] rounded-full animate-bounce"></div>
                  <div className="h-1.5 w-1.5 bg-[#008069] rounded-full animate-bounce [animation-delay:0.2s]"></div>
                  <div className="h-1.5 w-1.5 bg-[#008069] rounded-full animate-bounce [animation-delay:0.4s]"></div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Form input — WhatsApp-like style */}
          <form onSubmit={handleSend} className="bg-[#f0f2f5] border border-[#e9edef] rounded-xl p-2.5 space-y-2 shadow-xs">
            {/* Active Burst Queue Status Banner */}
            {pendingBurst.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-center justify-between text-xs animate-fadeIn">
                <div className="flex items-center space-x-1.5 text-amber-900 font-semibold text-[11px] truncate">
                  <Zap size={13} className="text-amber-600 fill-amber-500 animate-pulse shrink-0" />
                  <span className="truncate">
                    <span className="font-bold">{pendingBurst.length} pesan burst</span> terkumpul • Kirim dlm{' '}
                    <span className="font-mono font-bold text-amber-700">{(burstTimeLeft / 1000).toFixed(1)}s</span>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => flushBurst()}
                  disabled={loading}
                  className="px-2.5 py-0.5 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-[10px] font-bold transition shadow-xs shrink-0 ml-2 cursor-pointer"
                >
                  Kirim Sekarang
                </button>
              </div>
            )}

            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  (e.target as HTMLTextAreaElement).form?.requestSubmit();
                }
              }}
              placeholder={burstMode ? "Ketik pesan simulasi... (Tekan Enter beruntun untuk pesan burst)" : "Ketik pesan simulasi... (Enter untuk kirim)"}
              rows={2}
              className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-lg text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] resize-none shadow-xs"
            />
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-[#667781] truncate">
                {inputText.length > 0
                  ? `${inputText.length} karakter`
                  : burstMode
                    ? '⚡ Mode Burst aktif (kirim beruntun, bot membalas sekali)'
                    : 'Tekan Enter atau klik Kirim'}
              </span>
              <button
                type="submit"
                disabled={!inputText.trim()}
                className="px-3.5 py-1.5 bg-[#008069] hover:bg-[#00a884] disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-lg text-xs font-semibold transition flex items-center space-x-1.5 shadow-xs shrink-0 cursor-pointer"
              >
                {loading ? <RefreshCw size={12} className="animate-spin" /> : <Send size={12} />}
                <span>{pendingBurst.length > 0 ? 'Tambah Burst' : 'Kirim'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* RAG Inspector Panel */}
        <div className="bg-white border border-[#e9edef] rounded-2xl p-5 h-[560px] overflow-y-auto space-y-5 shadow-xs">
          <div className="flex items-center space-x-2 pb-3 border-b border-[#e9edef]">
            <Eye className="text-[#008069]" size={16} />
            <h3 className="text-xs font-bold text-[#111b21] uppercase">RAG Chunks & Prompt Inspector</h3>
          </div>

          {inspectorData.query ? (
            <div className="space-y-4">
              
              {/* Query & Latency metrics */}
              <div className="flex justify-between items-center text-xs p-2.5 bg-[#f8fafc] border border-[#e9edef] rounded-xl">
                <div className="flex items-center space-x-1.5 truncate">
                  <Search size={13} className="text-[#667781]" />
                  <span className="text-[#667781]">Query:</span>
                  <span className="font-semibold text-[#111b21] truncate">"{inspectorData.query}"</span>
                </div>
                <div className="flex items-center space-x-1 text-[#667781] flex-shrink-0 ml-2 font-mono text-[11px]">
                  <Activity size={13} />
                  <span>{inspectorData.latencyMs} ms</span>
                </div>
              </div>

              {/* Error log if outage */}
              {inspectorData.error && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-mono">
                  <span className="font-bold">Error:</span> {inspectorData.error}
                </div>
              )}

              {/* Reference Chunks section */}
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-[#667781] block uppercase">Vector Chunks Retrieved ({inspectorData.chunks?.length || 0})</span>
                <div className="space-y-2.5">
                  {inspectorData.chunks?.map((chunk: any, i: number) => {
                    const chunkId = chunk.id || chunk.title;
                    const isEditing = editingChunkId === chunkId;
                    return (
                      <div key={i} className="p-3.5 rounded-xl bg-[#f8fafc] border border-[#e9edef] space-y-2">
                        {isEditing ? (
                          <div className="space-y-2">
                            <div className="space-y-1">
                              <label className="text-[10px] text-[#667781] font-semibold">Judul Chunk</label>
                              <input
                                type="text"
                                value={editingTitle}
                                onChange={(e) => setEditingTitle(e.target.value)}
                                className="w-full p-2 rounded-lg bg-white border border-[#d1d7db] text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] text-[#667781] font-semibold">Konten Chunk</label>
                              <textarea
                                rows={4}
                                value={editingContent}
                                onChange={(e) => setEditingContent(e.target.value)}
                                className="w-full p-2 rounded-lg bg-white border border-[#d1d7db] text-xs text-[#111b21] focus:outline-none focus:border-[#008069] leading-relaxed resize-none shadow-xs"
                              />
                            </div>
                            <div className="flex space-x-2 justify-end pt-1">
                              <button
                                type="button"
                                onClick={handleCancelEdit}
                                className="px-2.5 py-1 rounded-lg bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] text-xs font-semibold"
                              >
                                Batal
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSaveEdit(chunkId)}
                                disabled={editLoading}
                                className="px-3 py-1 rounded-lg bg-[#008069] hover:bg-[#00a884] text-white text-xs font-bold transition flex items-center space-x-1 disabled:opacity-50 shadow-xs"
                              >
                                <Save size={12} />
                                <span>{editLoading ? 'Menyimpan...' : 'Simpan'}</span>
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-bold text-[#008069]">{chunk.title}</span>
                              <div className="flex items-center space-x-2">
                                <span className="text-[10px] text-[#8696a0] font-mono">Similarity: {(chunk.score || 0.85).toFixed(2)}</span>
                                <button
                                  type="button"
                                  onClick={() => handleStartEdit(chunk)}
                                  className="p-1 rounded-md bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] hover:text-[#111b21] transition shadow-xs"
                                  title="Edit Chunk"
                                >
                                  <Edit3 size={11} />
                                </button>
                              </div>
                            </div>
                            <p className="text-xs text-[#54656f] leading-relaxed">
                              {chunk.content}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {(!inspectorData.chunks || inspectorData.chunks.length === 0) && (
                    <div className="text-xs text-[#8696a0] py-2 italic">
                      Tidak ada vector chunks yang relevan untuk pertanyaan ini.
                    </div>
                  )}
                </div>
              </div>

              {/* System Persona prompt */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-bold text-[#667781] block uppercase flex items-center space-x-1">
                    <Cpu size={12} />
                    <span>Active System Persona Prompt</span>
                  </span>
                  {!editingPersona ? (
                    <button
                      type="button"
                      onClick={() => setEditingPersona(true)}
                      className="px-2 py-0.5 rounded-lg bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] hover:text-[#111b21] text-[10px] font-bold transition flex items-center space-x-1 shadow-xs"
                    >
                      <Edit3 size={10} />
                      <span>Edit Persona</span>
                    </button>
                  ) : (
                    <div className="flex space-x-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingPersona(false);
                          setPersonaText(inspectorData.systemPrompt || '');
                        }}
                        className="px-2 py-0.5 rounded-lg bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] text-[10px] font-semibold"
                      >
                        Batal
                      </button>
                      <button
                        type="button"
                        onClick={handleSavePersona}
                        disabled={personaLoading}
                        className="px-2.5 py-0.5 rounded-lg bg-[#008069] hover:bg-[#00a884] text-white text-[10px] font-bold transition flex items-center space-x-1 disabled:opacity-50 shadow-xs"
                      >
                        <Save size={10} />
                        <span>{personaLoading ? 'Menyimpan...' : 'Simpan'}</span>
                      </button>
                    </div>
                  )}
                </div>

                {editingPersona ? (
                  <textarea
                    rows={10}
                    value={personaText}
                    onChange={(e) => setPersonaText(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-white border border-[#d1d7db] text-xs text-[#111b21] focus:outline-none focus:border-[#008069] leading-relaxed font-mono resize-none shadow-xs"
                  />
                ) : (
                  <pre className="p-3 bg-[#f8fafc] border border-[#e9edef] rounded-xl text-[10px] text-[#54656f] font-mono overflow-auto max-h-40 whitespace-pre-wrap leading-relaxed">
                    {inspectorData.systemPrompt}
                  </pre>
                )}
              </div>

            </div>
          ) : (
            <div className="h-full flex flex-col justify-center items-center text-center text-[#8696a0] text-xs py-20">
              <Eye size={32} className="mb-2 text-[#8696a0]" />
              <p>Ketik dan kirim pesan di simulator chat untuk menginspeksi variabel RAG secara real-time.</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
