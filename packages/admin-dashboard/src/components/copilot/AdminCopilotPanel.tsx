import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, X, Send, Loader, ShieldCheck, MessageCircle, Search, Brain, PenLine, ListChecks, Hourglass, type LucideIcon } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';
import { useCopilot } from '../../contexts/CopilotContext';
import { useAuth } from '../../contexts/AuthContext';
import { getCopilotStatus, formatElapsedSeconds, type CopilotStage } from '../../utils/copilotStatus';

/**
 * AdminCopilotPanel (Fase 6r + GLM-5.3 2026-11-03) — panel AI Copilot KONTEKSTUAL.
 *
 * Fitur:
 * - Budget 300 detik dengan visual ladder responsif
 * - SSE streaming dengan live heartbeat & stage events
 * - Counter langkah multi-step (Langkah X/Y) & baris data ditemukan
 * - Tombol Batal (AbortController) untuk membatalkan proses kapan saja
 * - Ringkasan akhir turn: durasi, tool terpakai, total baris
 */

interface CopilotMessage {
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
  grounded?: boolean;
  summaryMeta?: {
    elapsedSec: number;
    toolsCount: number;
    rowsTotal: number;
  };
}

const QUICK_PROMPTS = [
  'Jadwal besok siapa saja?',
  'Berapa chat hari ini?',
  'Chat siapa yang belum dibalas?',
  'Omzet minggu ini berapa?',
  'Follow-up yang gagal apa saja?',
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
            className="inline-flex items-center gap-1 align-middle mx-0.5 px-1.5 py-0.5 rounded-md bg-accent hover:bg-accent-hover text-on-solid text-[10px] font-semibold active:scale-[0.97] transition-colors"
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
  const [stepInfo, setStepInfo] = useState<{ step: number; maxSteps: number } | null>(null);
  const [rowsFound, setRowsFound] = useState(0);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

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

  const cancelTurn = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
    setStreamStage(null);
    setStepInfo(null);
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === 'assistant' && !last.content) {
        return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: 'Pencarian dibatalkan oleh pengguna.' } : m));
      }
      return prev;
    });
  };

  /**
   * Konsumsi SSE `POST /api/admin/copilot/stream`.
   *
   * Kontrak backend (lihat copilot.subroute.ts): `stage` → `tool_start` → `tool_result`
   * → `chunk` (jawaban final SUDAH tervalidasi) → `done`.
   */
  const runStreaming = async (
    msg: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    assistantIndex: number
  ) => {
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    let accumulatedRows = 0;

    const res = await fetch('/api/admin/copilot/stream', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      signal: abortController.signal,
      body: JSON.stringify({
        message: msg,
        history,
        conversationId: conversationId || undefined,
        customerId: customerId || undefined,
      }),
    });
    if (!res.ok || !res.body) {
      const e: any = new Error(res.status === 403 ? 'Fitur Copilot tidak tersedia.' : res.status === 429 ? 'Copilot sedang memproses giliran lain.' : 'stream tidak tersedia');
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
        if (ev === 'stage') {
          if (payload?.label) setStreamStage(payload.label);
          if (payload?.step && payload?.maxSteps) setStepInfo({ step: payload.step, maxSteps: payload.maxSteps });
        } else if (ev === 'tool_start') {
          const toolName = String(payload.tool || '');
          toolsUsed = toolsUsed.includes(toolName) ? toolsUsed : [...toolsUsed, toolName];
          setStreamStage(`Mengecek ${toolName.replace(/_/g, ' ')}...`);
        } else if (ev === 'tool_result') {
          const count = Number(payload.count) || 0;
          accumulatedRows += count;
          setRowsFound((prev) => prev + count);
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
    const finalElapsed = startedAtRef.current ? Math.floor((Date.now() - startedAtRef.current) / 1000) : 0;
    setMessages((prev) =>
      prev.map((m, i) =>
        i === assistantIndex
          ? {
              ...m,
              content: acc,
              toolsUsed,
              grounded,
              summaryMeta: {
                elapsedSec: finalElapsed,
                toolsCount: toolsUsed.length,
                rowsTotal: accumulatedRows,
              },
            }
          : m
      )
    );
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
    setStepInfo(null);
    setRowsFound(0);

    try {
      await runStreaming(msg, history, assistantIndex);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return; // Dibatalkan sengaja oleh user
      }
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
            // Anggaran backend satu turn = 300 dtk (COPILOT_TOTAL_BUDGET_MS).
            // Margin 5 dtk agar backend sempat mengembalikan jawaban degradasi sebelum timeout klien.
            timeoutMs: 305000,
          }
        );
        const data = res?.data;
        const finalElapsed = startedAtRef.current ? Math.floor((Date.now() - startedAtRef.current) / 1000) : 0;
        setMessages((prev) =>
          prev.map((m, i) =>
            i === assistantIndex
              ? {
                  role: 'assistant',
                  content: data?.answer || 'Tidak ada jawaban.',
                  toolsUsed: data?.toolsUsed,
                  grounded: data?.grounded,
                  summaryMeta: {
                    elapsedSec: finalElapsed,
                    toolsCount: data?.toolsUsed?.length || 0,
                    rowsTotal: 0,
                  },
                }
              : m
          )
        );
      } catch (fallbackErr: any) {
        toast(fallbackErr.message || 'Copilot gagal menjawab', 'error');
        setMessages((prev) =>
          prev.map((m, i) => (i === assistantIndex ? { role: 'assistant', content: 'Gagal menghubungi Copilot. Coba lagi.' } : m))
        );
      }
    } finally {
      setLoading(false);
      setStreamStage(null);
      setStepInfo(null);
      abortControllerRef.current = null;
    }
  };

  // ADR-001: sembunyikan panel untuk tenant non-owner (gerbang UI; backend tetap
  // otoritas via 403 + guard service).
  if (user?.copilotEnabled === false) return null;

  return (
    <>
      {open && (
        <div id="copilot-panel" className="fixed bottom-24 right-4 z-40 w-[min(92vw,380px)] h-[min(70vh,520px)] bg-surface border border-divider rounded-2xl shadow-lg flex flex-col overflow-hidden">
          <div className="px-3.5 py-2.5 bg-accent text-on-solid flex items-center justify-between shrink-0">
            <span className="text-xs font-bold flex items-center gap-1.5">
              <Bot size={14} /> AI Clinic Copilot
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
                <p className="text-[11px] text-ink-2">
                  Tanyakan data operasional klinik. Jawaban diambil langsung dari database.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_PROMPTS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => send(q)}
                      className="px-2.5 py-1.5 rounded-lg bg-accent-soft hover:bg-accent-soft/80 text-accent text-[11px] font-semibold border border-accent/30 active:scale-[0.98] transition"
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
                      ? 'bg-accent text-on-solid rounded-tr-none'
                      : 'bg-surface-2 text-ink border border-divider rounded-tl-none'
                  }`}
                >
                  {m.role === 'assistant' ? <RichMessage content={m.content} onNavigate={openLiveChat} /> : m.content}
                  {m.role === 'assistant' && (
                    <div className="mt-1.5 pt-1.5 border-t border-divider flex flex-wrap items-center justify-between gap-1 text-[9px] text-ink-2">
                      <div className="flex items-center gap-1">
                        {m.toolsUsed && m.toolsUsed.length > 0 && (
                          <>
                            <ShieldCheck size={10} className={m.grounded ? 'text-success' : 'text-warning'} />
                            <span>{m.grounded ? 'Terverifikasi dari data' : 'Perlu verifikasi manual'}</span>
                          </>
                        )}
                      </div>
                      {m.summaryMeta && (
                        <span className="text-ink-3">
                          Selesai dalam {m.summaryMeta.elapsedSec}s · {m.summaryMeta.toolsCount} tool{m.summaryMeta.rowsTotal > 0 ? ` · ${m.summaryMeta.rowsTotal} baris` : ''}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (() => {
              const status = getCopilotStatus(elapsedMs);
              const StageIcon = STAGE_ICON[status.stage];
              return (
                <div className="flex flex-col gap-1.5" aria-live="polite" aria-busy="true">
                  <div className="bg-surface-2 border border-divider rounded-xl px-3 py-2 text-[12px] text-ink-2 flex items-center justify-between gap-2 tabular-nums">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <span className="relative flex items-center justify-center shrink-0">
                        <Loader size={12} className="animate-spin text-accent" />
                        <StageIcon size={12} className="absolute text-accent opacity-60" />
                      </span>
                      <span key={streamStage || status.stage} className="truncate animate-[fadeIn_200ms_ease-out]">
                        {streamStage || status.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-ink-3">{formatElapsedSeconds(elapsedMs)}</span>
                      <button
                        type="button"
                        onClick={cancelTurn}
                        className="text-[10px] font-semibold text-danger hover:opacity-80 hover:underline px-1 py-0.5 rounded transition"
                      >
                        Batal
                      </button>
                    </div>
                  </div>
                  {(stepInfo || rowsFound > 0) && (
                    <div className="flex items-center gap-1.5 px-2 text-[10px] text-ink-3">
                      {stepInfo && (
                        <span>Langkah {stepInfo.step}/{stepInfo.maxSteps}</span>
                      )}
                      {stepInfo && rowsFound > 0 && <span>·</span>}
                      {rowsFound > 0 && (
                        <span>{rowsFound} baris data ditemukan</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          <div className="p-2.5 border-t border-divider flex items-center gap-2 shrink-0">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(input); } }}
              placeholder="Tanya data klinik..."
              className="flex-1 bg-surface-2 border border-divider rounded-xl px-3 py-2 text-[12px] text-ink focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
            />
            <button
              type="button"
              onClick={() => send(input)}
              disabled={loading || !input.trim()}
              className="w-9 h-9 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-40 text-on-solid flex items-center justify-center shrink-0 active:scale-95 transition"
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
