import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, X, Send, Loader, ExternalLink, ShieldCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';

/**
 * AdminCopilotPanel (Fase 6r, G3=B) — panel AI Copilot KONTEKSTUAL.
 *
 * Ditempatkan di dalam modul LiveChat (bukan drawer global Layout.tsx) sesuai
 * keputusan G3=B: scope sempit, lazy, tanpa beban bundle di semua halaman.
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
  'Chat siapa yang belum dibalas?',
  'Jadwal besok siapa saja?',
  'Jadwal hari ini status pending?',
];

export const AdminCopilotPanel: React.FC = () => {
  const { toast } = useUiFeedback();
  const [open, setOpen] = useState(false);
  // Mobile: floating button disembunyikan default; tab panah tepi kiri memunculkannya.
  const [edgeOpen, setEdgeOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || loading) return;
    setInput('');
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: 'user', content: msg }]);
    setLoading(true);
    try {
      const res = await apiRequest<{ success: boolean; data: { answer: string; toolsUsed: string[]; grounded: boolean } }>(
        '/api/admin/copilot/chat',
        {
          method: 'POST',
          body: JSON.stringify({ message: msg, history }),
        }
      );
      const data = res?.data;
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data?.answer || 'Tidak ada jawaban.',
          toolsUsed: data?.toolsUsed,
          grounded: data?.grounded,
        },
      ]);
    } catch (err: any) {
      toast(err.message || 'Copilot gagal menjawab', 'error');
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Gagal menghubungi Copilot. Coba lagi.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Mobile-only: tab panah tepi kiri untuk memunculkan floating button.
          Desktop (md+) tidak menampilkan tab ini; button selalu tampil. */}
      <button
        type="button"
        onClick={() => setEdgeOpen((v) => !v)}
        aria-expanded={edgeOpen}
        aria-label={edgeOpen ? 'Sembunyikan tombol Copilot' : 'Tampilkan tombol Copilot'}
        title={edgeOpen ? 'Sembunyikan Copilot' : 'Tampilkan Copilot'}
        className="md:hidden fixed left-0 top-1/2 -translate-y-1/2 z-40 w-7 h-14 rounded-r-xl bg-indigo-600/90 hover:bg-indigo-700 text-white shadow-lg flex items-center justify-center active:scale-95 transition"
      >
        {edgeOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
      </button>

      {/* Floating trigger: di mobile hanya muncul bila edgeOpen; di desktop selalu. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`${edgeOpen ? 'flex' : 'hidden'} md:flex fixed bottom-24 right-4 z-40 w-12 h-12 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg items-center justify-center active:scale-95 transition`}
        title="AI Clinic Copilot"
        aria-label="Buka AI Clinic Copilot"
      >
        {open ? <X size={20} /> : <Sparkles size={20} />}
      </button>

      {open && (
        <div className="fixed bottom-40 right-4 z-40 w-[min(92vw,380px)] h-[min(70vh,520px)] bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#2a3942] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          <div className="px-3.5 py-2.5 bg-indigo-600 text-white flex items-center justify-between shrink-0">
            <span className="text-xs font-bold flex items-center gap-1.5">
              <Sparkles size={14} /> AI Clinic Copilot
            </span>
            <button type="button" onClick={() => setOpen(false)} className="hover:bg-white/20 rounded-lg p-1">
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
                      className="px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-semibold border border-indigo-200"
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
                      ? 'bg-indigo-600 text-white rounded-tr-none'
                      : 'bg-[#f8fafc] dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] border border-[#e9edef] dark:border-[#2a3942] rounded-tl-none'
                  }`}
                >
                  {m.content}
                  {m.role === 'assistant' && m.toolsUsed && m.toolsUsed.length > 0 && (
                    <div className="mt-1.5 pt-1.5 border-t border-[#e9edef] dark:border-[#2a3942] flex items-center gap-1 text-[9px] text-[#667781] dark:text-[#8696a0]">
                      <ShieldCheck size={10} className={m.grounded ? 'text-emerald-600' : 'text-amber-600'} />
                      <span>{m.grounded ? 'Terverifikasi dari data' : 'Perlu verifikasi manual'}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-[#f8fafc] dark:bg-[#202c33] rounded-xl px-3 py-2 text-[12px] text-[#667781] flex items-center gap-2">
                  <Loader size={12} className="animate-spin" /> Menganalisis data...
                </div>
              </div>
            )}
          </div>

          <div className="p-2.5 border-t border-[#e9edef] dark:border-[#2a3942] flex items-center gap-2 shrink-0">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(input); } }}
              placeholder="Tanya data klinik..."
              className="flex-1 bg-[#f8fafc] dark:bg-[#202c33] border border-[#d1d7db] dark:border-[#2a3942] rounded-xl px-3 py-2 text-[12px] text-[#111b21] dark:text-[#e9edef] focus:outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              onClick={() => send(input)}
              disabled={loading || !input.trim()}
              className="w-9 h-9 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white flex items-center justify-center shrink-0"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      )}
    </>
  );
};
