import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, X, Send, Loader, ShieldCheck, MessageCircle, Search, Brain, PenLine, ListChecks, Hourglass, type LucideIcon } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';
import { useCopilot } from '../../contexts/CopilotContext';
import { useAuth } from '../../contexts/AuthContext';
import { getCopilotStatus, formatElapsedSeconds, type CopilotStage } from '../../utils/copilotStatus';

/**
 * AdminCopilotPanel (Fase 6r, G3=B) — panel AI Copilot KONTEKSTUAL.
 *
 * Ditempatkan di dalam modul LiveChat (bukan drawer global Layout.tsx) sesuai
 * keputusan G3=B: scope sempit, lazy, tanpa beban bundle di semua halaman.
 *
 * State buka/tutup dimiliki CopilotContext: tombol on/off berada di SIDEBAR
 * (Layout.tsx), panel dirender di sini mengikuti `open` dari context.
 *
 * Jawaban grounded pada tool DB; bila kosong → "tidak ditemukan" (anti-halusinasi).
 */

interface CopilotMessage {
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
  grounded?: boolean;
}

const QUICK_PROMPTS = [
  'Jadwal besok siapa saja?',
  'Chat siapa yang belum dibalas?',
  'Riwayat Bunda Devia sebelumnya apa?',
  'SOP jeda pijat setelah vaksin?',
];

/** Ikon per tahap progres (indikasi visual proses berjalan, bukan macet). */
const STAGE_ICON: Record<CopilotStage, LucideIcon> = {
  searching: Search,
  reasoning: Brain,
  drafting: PenLine,
  polishing: ListChecks,
  finalizing: Hourglass,
};

/** Markdown inline minimal: tautan `[teks](url)` dan tebal `**teks**`. */
const INLINE_RE = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;

/**
 * Renderer pesan Copilot: mengubah markdown tautan internal `/admin/live-chat`
 * menjadi tombol yang membuka ruang obrolan, plus penebalan `**teks**`.
 * Hanya tautan internal Live Chat yang diaktifkan; URL eksternal ditolak (anti open-redirect).
 */
const RichMessage: React.FC<{ content: string; onNavigate: (url: string) => void }> = ({ content, onNavigate }) => {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(content)) !== null) {
    if (m.index > last) nodes.push(content.slice(last, m.index));
    if (m[1] !== undefined) {
      const label = m[1];
      const url = m[2];
      if (url.startsWith('/admin/live-chat')) {
        nodes.push(
          <button
            key={`link-${m.index}`}
            type="button"
            onClick={() => onNavigate(url)}
            className="inline-flex items-center gap-1 align-middle mx-0.5 px-1.5 py-0.5 rounded-md bg-[#008069] hover:bg-[#00a884] text-white text-[10px] font-semibold active:scale-[0.97] transition-colors"
          >
            <MessageCircle size={10} /> {label}
          </button>
        );
      } else {
        nodes.push(
          <a key={`ext-${m.index}`} href={url} target="_blank" rel="noopener noreferrer" className="underline">
            {label}
          </a>
        );
      }
    } else {
      nodes.push(<strong key={`b-${m.index}`}>{m[3]}</strong>);
    }
    last = m.index + m[0].length;
  }
  if (last < content.length) nodes.push(content.slice(last));
  return <>{nodes}</>;
};

export const AdminCopilotPanel: React.FC<{ conversationId?: string | null; customerId?: string | null }> = ({ conversationId, customerId }) => {
  const { toast } = useUiFeedback();
  const { open, setOpen } = useCopilot();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [streamStage, setStreamStage] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const startedAtRef = useRef<number | null>(null);

  // Deep-link Live Chat: sinkronkan selectedId (pola sama dengan useLiveChatNotification).
  const openLiveChat = (url: string) => {
    try {
      const convId = new URLSearchParams(url.split('?')[1] || '').get('conversationId');
      if (convId) sessionStorage.setItem('liveChat:selectedId', convId);
    } catch {
      /* abaikan URL malformed */
    }
    navigate(url);
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open, elapsedMs]);

  // Timer progres: hanya aktif saat loading. Elapsed asli (bukan tick count)
  // dihitung dari timestamp agar akurat walau tab di-throttle. Dibersihkan
  // pada unmount / selesai.
  useEffect(() => {
    if (!loading) return;
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    const id = setInterval(() => {
      if (startedAtRef.current != null) setElapsedMs(Date.now() - startedAtRef.current);
    }, 500);
    return () => {
      clearInterval(id);
      startedAtRef.current = null;
    };
  }, [loading]);

  /**
   * Konsumsi SSE `POST /api/admin/copilot/stream`.
   *
   * Kontrak backend (lihat copilot.subroute.ts): `tool_start` → `tool_result`
   * (progres nyata pipeline) → `chunk` (jawaban final SUDAH tervalidasi) → `done`.
   * Token mentah model tidak dialirkan, jadi tidak ada risiko menampilkan halusinasi.
   * Dipakai fetch + ReadableStream (bukan apiRequest) karena respons berupa stream,
   * bukan JSON. Header CSRF disamakan dengan apiRequest agar lolos guard cookie.
   */
  const runStreaming = async (
    msg: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    assistantIndex: number
  ) => {
    const res = await fetch('/api/admin/copilot/stream', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({
        message: msg,
        history,
        conversationId: conversationId || undefined,
        customerId: customerId || undefined,
      }),
    });
    if (!res.ok || !res.body) {
      const e: any = new Error(res.status === 403 ? 'Fitur Copilot tidak tersedia.' : 'stream tidak tersedia');
      e.status = res.status;
      throw e;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let acc = '';
    let toolsUsed: string[] = [];
    let grounded: boolean | undefined;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        let ev = 'message';
        let dataStr = '';
        for (const line of raw.split('\n')) {
          if (line.startsWith('event:')) ev = line.slice(6).trim();
          else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
        }
        if (!dataStr) continue;
        let payload: any = {};
        try {
          payload = JSON.parse(dataStr);
        } catch {
          continue;
        }
        if (ev === 'tool_start') {
          const toolName = String(payload.tool || '');
          toolsUsed = toolsUsed.includes(toolName) ? toolsUsed : [...toolsUsed, toolName];
          setStreamStage(`Mengecek ${toolName.replace(/_/g, ' ')}...`);
        } else if (ev === 'chunk') {
          acc = payload.text || acc;
          setMessages((prev) => prev.map((m, i) => (i === assistantIndex ? { ...m, content: acc } : m)));
        } else if (ev === 'done') {
          if (typeof payload?.grounded === 'boolean') grounded = payload.grounded;
          if (Array.isArray(payload?.toolsUsed) && payload.toolsUsed.length) toolsUsed = payload.toolsUsed;
          if (payload?.answer && !acc) {
            acc = payload.answer;
            setMessages((prev) => prev.map((m, i) => (i === assistantIndex ? { ...m, content: acc } : m)));
          }
        }
      }
    }
    if (!acc) acc = 'Tidak ada jawaban.';
    setMessages((prev) => prev.map((m, i) => (i === assistantIndex ? { ...m, content: acc, toolsUsed, grounded } : m)));
  };

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || loading) return;
    setInput('');
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const assistantIndex = history.length + 1;
    // Placeholder user + assistant (assistant diisi progresif via stream).
    setMessages((prev) => [...prev, { role: 'user', content: msg }, { role: 'assistant', content: '' }]);
    setLoading(true);
    setStreamStage(null);
    try {
      await runStreaming(msg, history, assistantIndex);
    } catch {
      // Fallback non-streaming (mis. proxy memblokir SSE): perilaku lama tetap utuh.
      try {
        const res = await apiRequest<{ success: boolean; data: { answer: string; toolsUsed: string[]; grounded: boolean } }>(
          '/api/admin/copilot/chat',
          {
            method: 'POST',
            body: JSON.stringify({
              message: msg,
              history,
              conversationId: conversationId || undefined,
              customerId: customerId || undefined,
            }),
            // Anggaran backend satu turn = 120 dtk (COPILOT_TOTAL_BUDGET_MS). Beri margin
            // di atasnya agar backend sempat mengembalikan degradasi jujur SEBELUM klien abort.
            timeoutMs: 125000,
          }
        );
        const data = res?.data;
        setMessages((prev) =>
          prev.map((m, i) =>
            i === assistantIndex
              ? { role: 'assistant', content: data?.answer || 'Tidak ada jawaban.', toolsUsed: data?.toolsUsed, grounded: data?.grounded }
              : m
          )
        );
      } catch (err: any) {
        toast(err.message || 'Copilot gagal menjawab', 'error');
        setMessages((prev) =>
          prev.map((m, i) => (i === assistantIndex ? { role: 'assistant', content: 'Gagal menghubungi Copilot. Coba lagi.' } : m))
        );
      }
    } finally {
      setLoading(false);
      setStreamStage(null);
    }
  };

  // ADR-001: sembunyikan panel untuk tenant non-owner (gerbang UI; backend tetap
  // otoritas via 403 + guard service).
  if (user?.copilotEnabled === false) return null;

  return (
    <>
      {open && (
        <div id="copilot-panel" className="fixed bottom-24 right-4 z-40 w-[min(92vw,380px)] h-[min(70vh,520px)] bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#2a3942] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          <div className="px-3.5 py-2.5 bg-[#008069] text-white flex items-center justify-between shrink-0">
            <span className="text-xs font-bold flex items-center gap-1.5">
              <Sparkles size={14} /> AI Clinic Copilot
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="hover:bg-white/15 rounded-lg p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 transition-colors"
              aria-label="Tutup Copilot"
            >
              <X size={14} />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-[11px] text-[#667781] dark:text-[#8696a0]">
                  Tanyakan data operasional klinik. Jawaban diambil langsung dari database.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_PROMPTS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => send(q)}
                      className="px-2.5 py-1.5 rounded-lg bg-[#e8f5f2] hover:bg-[#d9f0ea] text-[#00695c] text-[11px] font-semibold border border-[#c2e7e0] active:scale-[0.98] transition"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-[#008069] text-white rounded-tr-none'
                      : 'bg-[#f8fafc] dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] border border-[#e9edef] dark:border-[#2a3942] rounded-tl-none'
                  }`}
                >
                  {m.role === 'assistant' ? <RichMessage content={m.content} onNavigate={openLiveChat} /> : m.content}
                  {m.role === 'assistant' && m.toolsUsed && m.toolsUsed.length > 0 && (
                    <div className="mt-1.5 pt-1.5 border-t border-[#e9edef] dark:border-[#2a3942] flex items-center gap-1 text-[9px] text-[#667781] dark:text-[#8696a0]">
                      <ShieldCheck size={10} className={m.grounded ? 'text-emerald-600' : 'text-amber-600'} />
                      <span>{m.grounded ? 'Terverifikasi dari data' : 'Perlu verifikasi manual'}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (() => {
              const status = getCopilotStatus(elapsedMs);
              const StageIcon = STAGE_ICON[status.stage];
              return (
                <div className="flex justify-start" aria-live="polite" aria-busy="true">
                  <div className="bg-[#f8fafc] dark:bg-[#202c33] rounded-xl px-3 py-2 text-[12px] text-[#667781] dark:text-[#8696a0] flex items-center gap-2 tabular-nums">
                    <span className="relative flex items-center justify-center">
                      <Loader size={12} className="animate-spin text-[#008069]" />
                      <StageIcon size={12} className="absolute text-[#008069] dark:text-[#00a884]" />
                    </span>
                    <span key={streamStage || status.stage} className="animate-[fadeIn_200ms_ease-out]">{streamStage || status.label}</span>
                    <span className="ml-auto text-[10px] text-[#8696a0] dark:text-[#667781]">{formatElapsedSeconds(elapsedMs)}</span>
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="p-2.5 border-t border-[#e9edef] dark:border-[#2a3942] flex items-center gap-2 shrink-0">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(input); } }}
              placeholder="Tanya data klinik..."
              className="flex-1 bg-[#f8fafc] dark:bg-[#202c33] border border-[#d1d7db] dark:border-[#2a3942] rounded-xl px-3 py-2 text-[12px] text-[#111b21] dark:text-[#e9edef] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069]/30"
            />
            <button
              type="button"
              onClick={() => send(input)}
              disabled={loading || !input.trim()}
              className="w-9 h-9 rounded-xl bg-[#008069] hover:bg-[#00a884] disabled:opacity-40 text-white flex items-center justify-center shrink-0 active:scale-95 transition"
              aria-label="Kirim pertanyaan"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      )}
    </>
  );
};
