import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  /** Snapshot inspector (RAG chunks, tools, exemplar, session) per turn — untuk klik bubble. */
  trace?: {
    query?: string;
    chunks?: any[];
    exemplars?: any[];
    executedTools?: any[];
    systemPrompt?: string;
    reasoning?: any;
    tokens?: any;
    costIdr?: number;
    latencyMs?: number;
    error?: any;
    goalSession?: any;
    contextSummary?: string;
    conversationState?: string;
  } | null;
}

const fmtRpId = (n: any): string => {
  const v = Number(n);
  return Number.isFinite(v) ? `Rp ${v.toLocaleString('id-ID')}` : '-';
};

function parseContextSummary(summary?: string | null): { done: string[]; banned: string[]; focus: string[] } {
  const out: { done: string[]; banned: string[]; focus: string[] } = { done: [], banned: [], focus: [] };
  if (!summary || typeof summary !== 'string') return out;
  let section: 'done' | 'banned' | 'focus' | null = null;
  for (const raw of summary.split('\n')) {
    const line = raw.trim();
    if (/^STATUS DATA YANG SUDAH DILALUI/i.test(line)) { section = 'done'; continue; }
    if (/^FOKUS SAAT INI/i.test(line)) { section = 'focus'; continue; }
    if (/^PANDUAN ANTI-PENGULANGAN/i.test(line)) { section = 'banned'; continue; }
    if (/^\[RINGKASAN/i.test(line) || line === '') continue;
    const m = line.match(/^[•\-*]\s*(.+)$/);
    if (m && section) out[section].push(m[1].replace(/^[⏳🎯🚫]\s*/u, '').trim());
  }
  return out;
}

const ONGKIR_STATUS_META: Record<string, { label: string; cls: string }> = {
  QUOTED: { label: 'QUOTED · Sudah Disampaikan - Dilarang Hitung Ulang', cls: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/40' },
  CONFIRMED: { label: 'CONFIRMED · Disetujui Customer', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/40' },
  UNQUOTED: { label: 'UNQUOTED · Belum dihitung', cls: 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-[#2a3942] dark:text-[#aebac1] dark:border-[#374248]' },
};

const CONV_STATE_CLS: Record<string, string> = {
  INITIAL: 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-[#2a3942] dark:text-[#aebac1] dark:border-[#374248]',
  LOCATION_CONFIRMED: 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/40',
  AWAITING_INTEREST: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/40',
  RESERVATION_SENT: 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/40',
  HUMAN_HANDLING: 'bg-rose-100 text-rose-700 border-rose-300 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/40',
  COMPLETED: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/40',
};

const CART_TYPE_META: Record<string, { label: string; cls: string }> = {
  PRIMARY: { label: 'Utama', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/40' },
  ADDON: { label: 'Add-on', cls: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/40' },
  SERVICE: { label: 'Layanan', cls: 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/40' },
};

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

  // Inspector tab: session | chunks | bank | tools | prompt
  const [inspectorTab, setInspectorTab] = useState<'session' | 'chunks' | 'bank' | 'tools' | 'prompt'>('session');
  // Bubble bot yang sedang dipilih untuk inspeksi per-turn (index di messages)
  const [selectedBubbleIdx, setSelectedBubbleIdx] = useState<number | null>(null);

  const handleInspectBubble = (idx: number, msg: ChatMessage) => {
    if (msg.sender !== 'bot' || !msg.trace) return;
    setSelectedBubbleIdx(idx);
    setInspectorData((prev: any) => ({ ...prev, ...msg.trace }));
    // Alihkan ke tab State & Keranjang — kondisi state turn tersebut langsung termuat
    setInspectorTab('session');
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback((smooth = false) => {
    const doScroll = () => {
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight + 99999;
      }
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' });
      }
    };
    doScroll();
    requestAnimationFrame(doScroll);
    setTimeout(doScroll, 30);
    setTimeout(doScroll, 100);
    setTimeout(doScroll, 250);
  }, []);

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
    if (messages.length > 0) {
      scrollToBottom(false);
    }
  }, [messages, scrollToBottom]);

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

      // Snapshot inspector per turn — ditempel ke setiap bubble bot agar klik bubble
      // menampilkan data RAG/tools/exemplar turn tersebut (bukan hanya turn terakhir).
      const turnTrace = {
        query: data.query || batch.join('\n'),
        chunks: data.chunks || [],
        exemplars: data.exemplars || [],
        executedTools: data.v3?.executedTools || [],
        goalSession: data.v3?.goalSession || null,
        contextSummary: data.v3?.contextSummary || '',
        conversationState: data.v3?.conversationState || 'INITIAL',
        systemPrompt: data.systemPrompt || `TUGAS UTAMA: Jawab pertanyaan customer tentang informasi/FAQ moms & baby spa berdasarkan Referensi Dokumen...`,
        reasoning: data.reasoning || null,
        tokens: data.tokens || null,
        costIdr: data.costIdr || 0,
        latencyMs: endTime - startTime,
        error: data.llmError || null,
      };

      if (data.sentBubbles && Array.isArray(data.sentBubbles) && data.sentBubbles.length > 0) {
        const botBubbles = data.sentBubbles.map((bubbleText: string) => ({
          sender: 'bot' as const,
          content: bubbleText,
          timestamp: new Date(),
          isError: Boolean(data.llmError),
          trace: turnTrace,
        }));
        setMessages(prev => [...prev, ...botBubbles]);
      } else {
        setMessages(prev => [...prev, {
          sender: 'bot',
          content: data.answer || 'Maaf, saya tidak mengerti maksud Bunda.',
          timestamp: new Date(),
          isError: Boolean(data.llmError),
          trace: turnTrace,
        }]);
      }

      setInspectorData(turnTrace);
      setSelectedBubbleIdx(null);
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
          <div
            ref={chatContainerRef}
            className="flex-1 overflow-y-auto space-y-3 p-3 mb-3 bg-[#efeae2] rounded-xl border border-[#e9edef] shadow-inner"
            style={{ backgroundImage: 'radial-gradient(#d1d7db 0.75px, transparent 0.75px)', backgroundSize: '16px 16px' }}
          >
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  onClick={() => handleInspectBubble(idx, msg)}
                  title={msg.sender === 'bot' && msg.trace ? 'Klik untuk melihat RAG Chunks, Tool Calls & Exemplar turn ini di inspector' : undefined}
                  className={`max-w-[85%] rounded-xl p-3 text-xs leading-relaxed shadow-xs ${
                    msg.sender === 'user'
                      ? 'bg-[#d9fdd3] text-[#111b21] rounded-tr-none border border-[#00a884]/20'
                      : msg.isError
                        ? 'bg-rose-50 border border-rose-200 text-rose-800 rounded-tl-none font-medium'
                        : 'bg-white text-[#111b21] rounded-tl-none border border-black/5'
                  } ${msg.sender === 'bot' && msg.trace ? 'cursor-pointer hover:border-[#008069]/40 transition' : ''} ${
                    selectedBubbleIdx === idx ? 'ring-2 ring-[#008069]/50 border-[#008069]/50' : ''
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

              {/* Inspector tab navigation */}
              <div className="flex flex-wrap gap-1.5">
                {[
                  { id: 'session' as const, label: '🎯 State & Keranjang' },
                  { id: 'chunks' as const, label: `📚 RAG Chunks (${inspectorData.chunks?.length || 0})` },
                  { id: 'bank' as const, label: `💬 Chat Bank (${inspectorData.exemplars?.length || 0})` },
                  { id: 'tools' as const, label: `🛠️ Tool Calls (${inspectorData.executedTools?.length || 0})` },
                  { id: 'prompt' as const, label: '📝 Prompt & Reasoning' },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setInspectorTab(t.id)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition border ${
                      inspectorTab === t.id
                        ? 'bg-[#008069] text-white border-[#008069]'
                        : 'bg-white text-[#54656f] border-[#d1d7db] hover:bg-[#f0f2f5]'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Session State & Cart section */}
              {inspectorTab === 'session' && (
              <div className="space-y-2.5">
                {(() => {
                  const gs = inspectorData.goalSession || {};
                  const loc = gs.location || {};
                  const cart: any[] = Array.isArray(gs.cartItems) ? gs.cartItems : [];
                  const subtotal = cart.reduce((s, it) => s + Number(it.promoPrice ?? it.price ?? 0), 0);
                  const ongkir = Number(loc.ongkirPromo ?? 0);
                  const state = inspectorData.conversationState || 'INITIAL';
                  const ongkirMeta = ONGKIR_STATUS_META[gs.ongkirStatus] || ONGKIR_STATUS_META.UNQUOTED;
                  const summary = parseContextSummary(inspectorData.contextSummary);
                  return (
                    <>
                      {/* Header Card */}
                      <div className="p-3.5 rounded-xl bg-[#f8fafc] dark:bg-[#111b21] border border-[#e9edef] dark:border-[#2a3942] space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-xs font-bold text-[#111b21] dark:text-[#e9edef]">
                            {gs.genderGreeting || 'Bunda'}{gs.customerName ? ` (${gs.customerName})` : ''}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${CONV_STATE_CLS[state] || CONV_STATE_CLS.INITIAL}`}>
                            {state}
                          </span>
                        </div>
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${ongkirMeta.cls}`}>
                          {ongkirMeta.label}
                        </span>
                      </div>

                      {/* Card 1: Lokasi & Ongkir */}
                      <div className="p-3.5 rounded-xl bg-white dark:bg-[#202c33] border border-[#e9edef] dark:border-[#2a3942] space-y-1.5">
                        <span className="text-[11px] font-bold text-[#667781] dark:text-[#8696a0] block uppercase">📍 Lokasi & Status Ongkir</span>
                        <div className="text-xs text-[#111b21] dark:text-[#e9edef] font-semibold">
                          {[loc.kelurahan, loc.kecamatan, loc.kota].filter(Boolean).join(', ') || 'Belum diketahui'}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#54656f] dark:text-[#aebac1]">
                          <span>Jarak: <b className="font-mono">{loc.distanceKm != null ? `~${loc.distanceKm} km` : '-'}</b></span>
                          <span>Normal: <b className="font-mono">{loc.ongkirNormal != null ? fmtRpId(loc.ongkirNormal) : '-'}</b></span>
                          <span>Promo: <b className="font-mono text-[#008069] dark:text-[#00a884]">{loc.ongkirPromo != null ? fmtRpId(loc.ongkirPromo) : '-'}</b></span>
                        </div>
                      </div>

                      {/* Card 2: Keranjang */}
                      <div className="p-3.5 rounded-xl bg-white dark:bg-[#202c33] border border-[#e9edef] dark:border-[#2a3942] space-y-2">
                        <span className="text-[11px] font-bold text-[#667781] dark:text-[#8696a0] block uppercase">🛒 Keranjang Layanan ({cart.length})</span>
                        {cart.length === 0 ? (
                          <div className="text-[11px] text-[#8696a0] italic">Keranjang masih kosong.</div>
                        ) : (
                          <>
                            <div className="space-y-1.5">
                              {cart.map((it, i) => {
                                const tm = CART_TYPE_META[it.type] || CART_TYPE_META.PRIMARY;
                                const recipient = it.recipientLabel
                                  || (it.recipientScope === 'MOMS' ? 'Bunda' : it.recipientScope === 'CHILD_2' ? 'Kakak' : it.recipientScope === 'CHILD_1' ? 'Si Kecil' : null);
                                return (
                                  <div key={i} className="flex items-center justify-between gap-2 text-xs">
                                    <span className="text-[#111b21] dark:text-[#e9edef] font-semibold truncate">
                                      {recipient && <span className="mr-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/40">[{recipient}]</span>}
                                      {it.name}
                                    </span>
                                    <span className="flex items-center gap-1.5 shrink-0">
                                      <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold border ${tm.cls}`}>{tm.label}</span>
                                      <span className="font-mono font-bold text-[#008069] dark:text-[#00a884]">{fmtRpId(it.promoPrice ?? it.price)}</span>
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="pt-2 border-t border-[#e9edef] dark:border-[#2a3942] space-y-1 text-[11px] text-[#54656f] dark:text-[#aebac1]">
                              <div className="flex justify-between"><span>Subtotal Layanan</span><span className="font-mono font-bold">{fmtRpId(subtotal)}</span></div>
                              <div className="flex justify-between"><span>Ongkir Promo</span><span className="font-mono font-bold">{fmtRpId(ongkir)}</span></div>
                            </div>
                            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 px-3 py-2 flex items-center justify-between">
                              <span className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300">Total Akumulasi</span>
                              <span className="text-base font-black font-mono text-emerald-800 dark:text-emerald-300">{fmtRpId(subtotal + ongkir)}</span>
                            </div>
                          </>
                        )}
                      </div>

                      {/* Card 3: Pasien adaptif multi-audience (Bunda / Si Kecil / Keduanya) & Jadwal */}
                      {((gs.momProfile?.gestationalWeeks != null || gs.momProfile?.stage || (gs.momProfile?.complaints || []).length > 0 || gs.targetAudience === 'MOMS' || gs.targetAudience === 'BOTH') && (
                      <div className="p-3.5 rounded-xl bg-white dark:bg-[#202c33] border border-[#e9edef] dark:border-[#2a3942] space-y-1.5">
                        <span className="text-[11px] font-bold text-[#667781] dark:text-[#8696a0] block uppercase">🤰 Data Kehamilan & Jadwal</span>
                        <div className="text-xs text-[#111b21] dark:text-[#e9edef]">
                          Usia Kehamilan: <b>{gs.momProfile?.gestationalWeeks != null ? `${gs.momProfile.gestationalWeeks} minggu` : '-'}</b>
                        </div>
                        <div className="text-xs text-[#111b21] dark:text-[#e9edef]">
                          Kondisi: <b>{gs.momProfile?.stage === 'PREGNANT' ? 'Ibu Hamil' : gs.momProfile?.stage === 'POSTPARTUM' ? `Paska Salin/Nifas${gs.momProfile?.postpartumPeriod ? ` (${gs.momProfile.postpartumPeriod})` : ''}` : gs.momProfile?.stage === 'GENERAL' ? 'Relaksasi Umum' : (gs.targetAudience === 'MOMS' ? 'Ibu' : '-')}</b>
                        </div>
                        <div className="text-xs text-[#111b21] dark:text-[#e9edef]">
                          Keluhan Bunda: <b>{(gs.momProfile?.complaints || []).length > 0 ? gs.momProfile.complaints.join(', ') : '-'}</b>
                        </div>
                        {gs.targetAudience && (
                          <div className="text-xs text-[#54656f] dark:text-[#aebac1]">
                            Subjek: <b className="text-[#111b21] dark:text-[#e9edef]">{gs.targetAudience === 'BOTH' ? 'Bunda & Si Kecil' : gs.targetAudience === 'MOMS' ? 'Bunda (Ibu)' : gs.targetAudience}</b>
                          </div>
                        )}
                      </div>
                      ))}
                      {((gs.children && gs.children.length > 0) || gs.childProfile || gs.targetAudience === 'BABY' || gs.targetAudience === 'KIDS' || gs.targetAudience === 'BOTH') && (
                      <div className="p-3.5 rounded-xl bg-white dark:bg-[#202c33] border border-[#e9edef] dark:border-[#2a3942] space-y-1.5">
                        <span className="text-[11px] font-bold text-[#667781] dark:text-[#8696a0] block uppercase">👶 Data Si Kecil & Jadwal</span>
                        {(gs.children && gs.children.length > 1) ? (
                          <div className="space-y-1">
                            {gs.children.map((k: any, ki: number) => (
                              <div key={ki} className="text-xs text-[#111b21] dark:text-[#e9edef]">
                                <b>{k.roleLabel || `Anak ${ki + 1}`}</b>
                                {k.ageMonths != null ? ` • ${k.ageMonths} bln` : ' • usia -'}
                                {(k.symptoms || []).length > 0 ? ` • ${k.symptoms.join(', ')}` : ''}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <>
                            <div className="text-xs text-[#111b21] dark:text-[#e9edef]">
                              Usia: <b>{(gs.children?.[0]?.ageMonths ?? gs.childProfile?.ageMonths) != null ? `${gs.children?.[0]?.ageMonths ?? gs.childProfile.ageMonths} bulan` : '-'}</b>
                            </div>
                            <div className="text-xs text-[#111b21] dark:text-[#e9edef]">
                              Keluhan: <b>{((gs.children?.[0]?.symptoms || gs.childProfile?.symptoms || []) as string[]).length > 0 ? (gs.children?.[0]?.symptoms || gs.childProfile.symptoms).join(', ') : '-'}</b>
                            </div>
                          </>
                        )}
                        <div className="text-xs text-[#111b21] dark:text-[#e9edef]">
                          Jadwal: <b>{gs.booking?.preferredDate ? `${gs.booking.preferredDate}${gs.booking.preferredTime ? ` • ${gs.booking.preferredTime}` : ''}` : '-'}</b>
                        </div>
                        {gs.selectedTreatment && (
                          <div className="text-xs text-[#54656f] dark:text-[#aebac1]">
                            Treatment: <b className="text-[#111b21] dark:text-[#e9edef]">{gs.selectedTreatment}</b>
                          </div>
                        )}
                      </div>
                      )}
                      {(!gs.momProfile && !gs.childProfile && (!gs.children || gs.children.length === 0) && !gs.targetAudience && (
                      <div className="p-3.5 rounded-xl bg-white dark:bg-[#202c33] border border-[#e9edef] dark:border-[#2a3942] space-y-1.5">
                        <span className="text-[11px] font-bold text-[#667781] dark:text-[#8696a0] block uppercase">👶 Data Si Kecil & Jadwal</span>
                        <div className="text-xs text-[#111b21] dark:text-[#e9edef]">
                          Jadwal: <b>{gs.booking?.preferredDate ? `${gs.booking.preferredDate}${gs.booking.preferredTime ? ` • ${gs.booking.preferredTime}` : ''}` : '-'}</b>
                        </div>
                        {gs.selectedTreatment && (
                          <div className="text-xs text-[#54656f] dark:text-[#aebac1]">
                            Treatment: <b className="text-[#111b21] dark:text-[#e9edef]">{gs.selectedTreatment}</b>
                          </div>
                        )}
                      </div>
                      ))}

                      {/* Card 4: Memori Anti-Amnesia */}
                      <div className="p-3.5 rounded-xl bg-white dark:bg-[#202c33] border border-[#e9edef] dark:border-[#2a3942] space-y-2">
                        <span className="text-[11px] font-bold text-[#667781] dark:text-[#8696a0] block uppercase">🧠 Memori Konteks (Anti-Amnesia)</span>
                        {(!inspectorData.contextSummary) ? (
                          <div className="text-[11px] text-[#8696a0] italic">Belum ada ringkasan konteks untuk turn ini.</div>
                        ) : (
                          <>
                            {summary.done.length > 0 && (
                              <div>
                                <div className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 uppercase mb-1">✅ Sudah Dibahas & Tuntas</div>
                                <ul className="space-y-0.5 text-[11px] text-[#111b21] dark:text-[#e9edef]">
                                  {summary.done.map((s, i) => <li key={i}>• {s}</li>)}
                                </ul>
                              </div>
                            )}
                            {summary.banned.length > 0 && (
                              <div>
                                <div className="text-[10px] font-bold text-rose-600 dark:text-rose-300 uppercase mb-1">🚫 Dilarang Diulang</div>
                                <ul className="space-y-0.5 text-[11px] text-[#111b21] dark:text-[#e9edef]">
                                  {summary.banned.map((s, i) => <li key={i}>• {s}</li>)}
                                </ul>
                              </div>
                            )}
                            {summary.focus.length > 0 && (
                              <div>
                                <div className="text-[10px] font-bold text-sky-700 dark:text-sky-300 uppercase mb-1">🎯 Topik Fokus Saat Ini</div>
                                <ul className="space-y-0.5 text-[11px] text-[#111b21] dark:text-[#e9edef]">
                                  {summary.focus.map((s, i) => <li key={i}>• {s}</li>)}
                                </ul>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>
              )}

              {/* Reference Chunks section */}
              {inspectorTab === 'chunks' && (
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-[#667781] block uppercase">Vector Chunks Retrieved ({inspectorData.chunks?.length || 0}) — SOP/FAQ + Katalog</span>
                <span className="text-[10px] text-[#8696a0] block">Ground truth terpadu: artikel SOP/FAQ medis (pre-retrieval deterministik + tool) dan spesifikasi katalog layanan resmi yang dipakai LLM turn ini.</span>
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
                              <span className="text-xs font-bold text-[#008069]">
                                {String(chunk.title || '').startsWith('[Katalog Layanan]') && (
                                  <span className="mr-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-sky-100 text-sky-800 border border-sky-200">KATALOG</span>
                                )}
                                {String(chunk.title || '').startsWith('[Katalog Layanan]') ? String(chunk.title).replace('[Katalog Layanan] ', '') : chunk.title}
                                {!String(chunk.title || '').startsWith('[Katalog Layanan]') && (
                                  <span className="ml-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">SOP/FAQ</span>
                                )}
                              </span>
                              <div className="flex items-center space-x-2">
                                <span className="text-[10px] text-[#8696a0] font-mono">Similarity: {(chunk.similarity ?? chunk.score ?? 0).toFixed(2)}</span>
                                {!String(chunk.title || '').startsWith('[Katalog Layanan]') && (
                                <button
                                  type="button"
                                  onClick={() => handleStartEdit(chunk)}
                                  className="p-1 rounded-md bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] hover:text-[#111b21] transition shadow-xs"
                                  title="Edit Chunk"
                                >
                                  <Edit3 size={11} />
                                </button>
                                )}
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
                      {inspectorData.executedTools?.some((t: any) => t.name === 'search_knowledge_faq')
                        ? 'Tool FAQ dipanggil tetapi tidak ada artikel yang cocok.'
                        : 'Belum ada grounding deterministik untuk turn ini (sapaan murni / tanya harga / lokasi). Pertanyaan konsultatif (keluhan, perbedaan treatment, syarat usia, SOP) otomatis memicu pre-retrieval knowledge base.'}
                    </div>
                  )}
                </div>
              </div>
              )}

              {/* Chat Bank (few-shot exemplars) section */}
              {inspectorTab === 'bank' && (
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-[#667781] block uppercase">Dialog Master Bidan Yusi ({inspectorData.exemplars?.length || 0})</span>
                <span className="text-[10px] text-[#8696a0] block">Contoh Percakapan Ideal (Few-Shot Prompt) yang disuntikkan sebagai panduan nada bicara LLM, bukan artikel SOP/Knowledge Base.</span>
                <div className="space-y-2.5">
                  {(inspectorData.exemplars || []).map((ex: any, i: number) => (
                    <div key={ex.id || i} className="p-3.5 rounded-xl bg-[#f8fafc] border border-[#e9edef] space-y-2">
                      <div className="text-[11px] font-bold text-[#008069]">{ex.scenario || `Contoh ${i + 1}`}</div>
                      <div className="rounded-lg bg-white border border-[#e9edef] p-2.5 text-xs text-[#111b21]">
                        <span className="font-bold text-[#667781]">Pasien: </span>{ex.customerMessage}
                      </div>
                      <div className="rounded-lg bg-[#d9fdd3] border border-[#00a884]/20 p-2.5 text-xs text-[#111b21]">
                        <span className="font-bold text-[#008069]">Bidan Yusi: </span>{ex.idealResponse}
                      </div>
                      {Array.isArray(ex.tags) && ex.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {ex.tags.map((t: string) => (
                            <span key={t} className="px-1.5 py-0.5 rounded-md bg-white border border-[#d1d7db] text-[10px] font-mono text-[#54656f]">{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {(!inspectorData.exemplars || inspectorData.exemplars.length === 0) && (
                    <div className="text-xs text-[#8696a0] py-2 italic">
                      Tidak ada exemplar dinamis spesifik yang disuntikkan — AI menggunakan persona dasar dan contoh percakapan SOP standar.
                    </div>
                  )}
                </div>
              </div>
              )}

              {/* Tool Calls section */}
              {inspectorTab === 'tools' && (
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-[#667781] block uppercase">Urutan Tools Dipanggil ({inspectorData.executedTools?.length || 0})</span>
                <div className="space-y-2.5">
                  {(inspectorData.executedTools || []).map((t: any, i: number) => (
                    <div key={i} className="p-3.5 rounded-xl bg-[#f8fafc] border border-[#e9edef] space-y-1.5">
                      <div className="flex items-center space-x-1.5">
                        <span className="px-1.5 py-0.5 rounded-md bg-[#008069] text-white text-[10px] font-bold font-mono">{i + 1}</span>
                        <span className="text-xs font-bold text-[#111b21] font-mono">{t.name}</span>
                      </div>
                      <details className="text-[11px]">
                        <summary className="cursor-pointer text-[#008069] font-semibold">Parameter & hasil</summary>
                        <pre className="mt-1 p-2 rounded-lg bg-white border border-[#e9edef] text-[10px] font-mono text-[#54656f] whitespace-pre-wrap overflow-x-auto max-h-48">
                          {JSON.stringify({ args: t.args, result: t.result }, null, 2)}
                        </pre>
                      </details>
                    </div>
                  ))}
                  {(!inspectorData.executedTools || inspectorData.executedTools.length === 0) && (
                    <div className="text-xs text-[#8696a0] py-2 italic">
                      Tidak ada tool yang dipanggil — jawaban langsung dari LLM (mis. sapaan statis Turn-0).
                    </div>
                  )}
                </div>
              </div>
              )}

              {/* System Persona prompt */}
              {inspectorTab === 'prompt' && (
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

                {/* Model reasoning */}
                <div className="space-y-1">
                  <span className="text-[11px] font-bold text-[#667781] block uppercase">🧠 Reasoning Model</span>
                  {inspectorData.reasoning ? (
                    <pre className="p-3 bg-purple-50/80 border border-purple-200 rounded-xl text-[10px] text-purple-950 font-mono overflow-auto max-h-40 whitespace-pre-wrap leading-relaxed">
                      {inspectorData.reasoning}
                    </pre>
                  ) : (
                    <div className="text-xs text-[#8696a0] py-1 italic">Provider tidak mengembalikan reasoning terpisah.</div>
                  )}
                </div>

                {/* Token & cost metrics */}
                {(inspectorData.tokens || inspectorData.costIdr) && (
                  <div className="flex flex-wrap gap-1.5 text-[10px] font-mono">
                    {typeof inspectorData.tokens?.prompt === 'number' && (
                      <span className="px-2 py-1 rounded-lg bg-white border border-[#d1d7db] text-[#54656f]">in: {inspectorData.tokens.prompt}</span>
                    )}
                    {typeof inspectorData.tokens?.completion === 'number' && (
                      <span className="px-2 py-1 rounded-lg bg-white border border-[#d1d7db] text-[#54656f]">out: {inspectorData.tokens.completion}</span>
                    )}
                    {typeof inspectorData.costIdr === 'number' && inspectorData.costIdr > 0 && (
                      <span className="px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800">≈ Rp {inspectorData.costIdr.toLocaleString('id-ID')}</span>
                    )}
                  </div>
                )}
              </div>
              )}

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
