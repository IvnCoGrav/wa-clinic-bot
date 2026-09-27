import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, X, Send, Loader, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';
import { useCopilot } from '../../contexts/CopilotContext';

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
  'Chat siapa yang belum dibalas?',
  'Jadwal besok siapa saja?',
  'Jadwal hari ini status pending?',
];

export const AdminCopilotPanel: React.FC = () => {
  const { toast } = useUiFeedback();
  const { open, setOpen } = useCopilot();
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
