import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bot,
  X,
  Send,
  Loader,
  ShieldCheck,
  Search,
  Brain,
  PenLine,
  ListChecks,
  Hourglass,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react';
import { useUiFeedback } from '../common/UiFeedback';
import { useCopilot } from '../../contexts/CopilotContext';
import { useAuth } from '../../contexts/AuthContext';
import { getCopilotStatus, formatElapsedSeconds, type CopilotStage } from '../../utils/copilotStatus';
import { CopilotAnswer } from './CopilotAnswer';

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

export const AdminCopilotPanel: React.FC<{
  conversationId?: string | null;
  customerId?: string | null;
  patientName?: string | null;
}> = ({ conversationId, customerId, patientName }) => {
  const { toast, confirm } = useUiFeedback();
  const { open, setOpen, session, send, cancel, reset } = useCopilot();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [input, setInput] = useState('');

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  const {
    messages,
    status,
    startedAt,
    stage: streamStage,
    step: stepInfo,
    rowsFound,
  } = session;
  const loading = status === 'running';

  // Ticker lokal durasi turn (hanya me-render ulang AdminCopilotPanel saat running)
  const [localElapsedMs, setLocalElapsedMs] = useState(0);
  useEffect(() => {
    if (!loading || !startedAt) {
      setLocalElapsedMs(0);
      return;
    }
    const t0 = startedAt;
    setLocalElapsedMs(Date.now() - t0);
    const id = setInterval(() => {
      setLocalElapsedMs(Date.now() - t0);
    }, 500);
    return () => clearInterval(id);
  }, [loading, startedAt]);

  // Deep-link Live Chat: sinkronkan selectedId
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
  }, [messages, open]);

  // Listener tombol Escape untuk menutup panel
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, setOpen]);

  // Swipe-down gesture handler untuk bottom sheet mobile
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartYRef.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartYRef.current != null) {
      const deltaY = e.changedTouches[0].clientY - touchStartYRef.current;
      if (deltaY > 80) {
        setOpen(false);
      }
      touchStartYRef.current = null;
    }
  };

  const handleSend = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setInput('');
    send(trimmed, { conversationId, customerId });
  };

  const handleReset = async () => {
    const ok = await confirm({
      title: 'Hapus Riwayat Copilot',
      message: 'Hapus riwayat chat Copilot di perangkat ini?',
      confirmText: 'Hapus',
      cancelText: 'Batal',
      danger: true,
    });
    if (ok) {
      reset();
      toast('Riwayat Copilot berhasil dibersihkan', 'info');
    }
  };

  // Konteks pesan terakhir vs konteks aktif
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const contextShifted =
    lastMsg &&
    lastMsg.contextCustomerId !== undefined &&
    lastMsg.contextCustomerId !== (customerId ?? null);

  // ADR-001: sembunyikan panel untuk tenant non-owner
  if (user?.copilotEnabled === false) return null;

  return (
    <>
      {open && (
        <>
          {/* Scrim mobile */}
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] sm:hidden"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          {/* Panel bottom sheet di mobile, floating card di desktop */}
          <div
            id="copilot-panel"
            role="dialog"
            aria-modal="true"
            aria-label="AI Clinic Copilot"
            className="fixed inset-x-0 bottom-0 z-50 flex h-[85dvh] flex-col overflow-hidden rounded-t-2xl border-t border-divider bg-surface shadow-2xl
                       sm:inset-auto sm:bottom-24 sm:right-4 sm:h-[min(70vh,520px)] sm:w-[380px] sm:rounded-2xl sm:border sm:shadow-lg"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            {/* Drag handle untuk mobile */}
            <div
              className="flex justify-center pt-2.5 pb-1 sm:hidden touch-none cursor-grab active:cursor-grabbing shrink-0"
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              <span className="h-1.5 w-10 rounded-full bg-divider/80" />
            </div>

            {/* Header */}
            <div
              className="px-3.5 py-2.5 bg-accent text-white flex items-center justify-between shrink-0 select-none"
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-bold flex items-center gap-1.5 truncate">
                  <Bot size={15} className="shrink-0" /> AI Clinic Copilot
                </span>
                <div className="flex items-center gap-1 text-[10px] text-white/80 font-normal truncate mt-0.5">
                  {customerId ? (
                    <span className="truncate">Konteks: {patientName || 'Pasien aktif'}</span>
                  ) : (
                    <span>Tanpa konteks pasien</span>
                  )}
                  {contextShifted && (
                    <span className="bg-white/20 text-white px-1.5 py-0.2 rounded text-[9px] shrink-0 font-medium">
                      Konteks berpindah
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0 ml-2">
                <button
                  type="button"
                  onClick={handleReset}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center hover:bg-white/15 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 transition-colors"
                  title="Hapus riwayat chat Copilot"
                  aria-label="Hapus riwayat chat Copilot"
                >
                  <RotateCcw size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center hover:bg-white/15 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 transition-colors"
                  aria-label="Tutup Copilot"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* Area Pesan */}
            <div
              ref={scrollRef}
              role="log"
              aria-live="polite"
              aria-atomic="false"
              className="flex-1 overflow-y-auto overscroll-contain p-3.5 space-y-3.5"
            >
              {messages.length === 0 && (
                <div className="space-y-2.5">
                  <p className="text-xs text-ink-2">
                    Tanyakan data operasional klinik. Jawaban diambil langsung dari database.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {QUICK_PROMPTS.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => handleSend(q)}
                        className="min-h-[44px] px-3 py-2 rounded-xl bg-accent-soft hover:bg-accent-soft/80 text-accent text-xs font-semibold border border-accent/30 active:scale-[0.98] transition flex items-center cursor-pointer"
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
                    className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                      m.role === 'user'
                        ? 'bg-accent text-white rounded-tr-none'
                        : 'bg-surface-2 text-ink border border-divider rounded-tl-none'
                    }`}
                  >
                    {m.role === 'assistant' ? (
                      <CopilotAnswer content={m.content} toolsUsed={m.toolsUsed} onNavigate={openLiveChat} />
                    ) : (
                      m.content
                    )}

                    {m.role === 'assistant' && (
                      <div className="mt-2 pt-2 border-t border-divider flex flex-wrap items-center justify-between gap-1 text-[11px] text-ink-2">
                        <div className="flex items-center gap-1">
                          {m.toolsUsed && m.toolsUsed.length > 0 && (
                            <>
                              <ShieldCheck size={12} className={m.grounded ? 'text-success' : 'text-warning'} />
                              <span>{m.grounded ? 'Terverifikasi dari data' : 'Perlu verifikasi manual'}</span>
                            </>
                          )}
                        </div>
                        {m.summaryMeta && (
                          <span className="text-ink-3">
                            Selesai dalam {m.summaryMeta.elapsedSec}s · {m.summaryMeta.toolsCount} tool
                            {m.summaryMeta.rowsTotal > 0 ? ` · ${m.summaryMeta.rowsTotal} baris` : ''}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {loading &&
                (() => {
                  const copilotStatus = getCopilotStatus(localElapsedMs);
                  const StageIcon = STAGE_ICON[copilotStatus.stage];
                  return (
                    <div className="flex flex-col gap-1.5" aria-live="polite" aria-busy="true">
                      <div className="bg-surface-2 border border-divider rounded-xl px-3.5 py-2.5 text-xs text-ink-2 flex items-center justify-between gap-2 tabular-nums">
                        <div className="flex items-center gap-2 overflow-hidden">
                          <span className="relative flex items-center justify-center shrink-0">
                            <Loader size={13} className="animate-spin text-accent" />
                            <StageIcon size={13} className="absolute text-accent opacity-60" />
                          </span>
                          <span
                            key={streamStage || copilotStatus.stage}
                            className="truncate animate-[fadeIn_200ms_ease-out]"
                          >
                            {streamStage || copilotStatus.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-ink-3">{formatElapsedSeconds(localElapsedMs)}</span>
                          <button
                            type="button"
                            onClick={cancel}
                            className="min-h-[44px] px-3 flex items-center text-xs font-semibold text-rose-500 hover:text-rose-600 hover:underline rounded-lg transition"
                          >
                            Batal
                          </button>
                        </div>
                      </div>
                      {(stepInfo || rowsFound > 0) && (
                        <div className="flex items-center gap-1.5 px-2 text-[11px] text-ink-3">
                          {stepInfo && <span>Langkah {stepInfo.step}/{stepInfo.maxSteps}</span>}
                          {stepInfo && rowsFound > 0 && <span>·</span>}
                          {rowsFound > 0 && <span>{rowsFound} baris data ditemukan</span>}
                        </div>
                      )}
                    </div>
                  );
                })()}
            </div>

            {/* Footer Input */}
            <div className="p-3 border-t border-divider flex items-center gap-2 shrink-0">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSend(input);
                  }
                }}
                placeholder="Tanya data klinik..."
                className="flex-1 bg-surface-2 border border-divider rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-ink focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
              />
              <button
                type="button"
                onClick={() => handleSend(input)}
                disabled={loading || !input.trim()}
                className="min-h-[44px] min-w-[44px] rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-40 text-white flex items-center justify-center shrink-0 active:scale-95 transition cursor-pointer"
                aria-label="Kirim pertanyaan"
              >
                <Send size={15} />
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
};
