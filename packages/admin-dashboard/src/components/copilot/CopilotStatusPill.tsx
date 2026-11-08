import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCopilot } from '../../contexts/CopilotContext';
import { formatElapsedSeconds } from '../../utils/copilotStatus';
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

/**
 * CopilotStatusPill — Indikator mengambang status turn Copilot saat panel tertutup.
 *
 * Memberi feedback visual langsung kepada admin (terutama di mobile setelah menutup panel):
 * - running: menampilkan waktu berjalan (elapsed) via ticker lokal mandiri
 * - done + unread: memberitahu jawaban telah siap (auto-dismiss 8 detik)
 * - error: memberitahu kendala jaringan / timeout
 */
export const CopilotStatusPill: React.FC = () => {
  const { open, setOpen, session } = useCopilot();
  const { status, hasUnread, startedAt } = session;
  const [doneDismissed, setDoneDismissed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Ticker lokal mandiri: menghitung detik tanpa memicu re-render context global
  const [localElapsedMs, setLocalElapsedMs] = useState(0);
  useEffect(() => {
    if (status !== 'running' || !startedAt) {
      setLocalElapsedMs(0);
      return;
    }
    const t0 = startedAt;
    setLocalElapsedMs(Date.now() - t0);
    const id = setInterval(() => {
      setLocalElapsedMs(Date.now() - t0);
    }, 500);
    return () => clearInterval(id);
  }, [status, startedAt]);

  // Auto-dismiss pesan "Jawaban siap" setelah 8 detik jika panel belum dibuka
  useEffect(() => {
    if (status === 'done' && hasUnread) {
      setDoneDismissed(false);
      const timer = setTimeout(() => {
        setDoneDismissed(true);
      }, 8000);
      return () => clearTimeout(timer);
    } else if (status === 'running') {
      setDoneDismissed(false);
    }
  }, [status, hasUnread]);

  // Pill hanya muncul jika panel tertutup dan ada proses aktif / unread / error
  if (open) return null;
  if (status === 'idle') return null;
  if (status === 'done' && (!hasUnread || doneDismissed)) return null;

  const handleClick = () => {
    // Jika diklik dari halaman selain Live Chat (mis. Reservasi/Overview), arahkan ke Live Chat tempat panel terpasang
    if (!location.pathname.startsWith('/admin/live-chat')) {
      navigate('/admin/live-chat');
    }
    setOpen(true);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 z-40 bottom-[calc(6rem+env(safe-area-inset-bottom))] animate-[fadeIn_150ms_ease-out]"
    >
      <button
        type="button"
        onClick={handleClick}
        className="flex items-center gap-2 px-3.5 py-2.5 min-h-[44px] rounded-full bg-surface border border-divider shadow-lg hover:border-accent/40 active:scale-95 transition cursor-pointer text-xs font-semibold text-ink touch-manipulation"
      >
        {status === 'running' && (
          <>
            <Loader2 size={15} className="animate-spin text-accent shrink-0 motion-reduce:animate-none" />
            <span className="tabular-nums">Copilot memproses… {formatElapsedSeconds(localElapsedMs)}</span>
          </>
        )}

        {status === 'done' && hasUnread && !doneDismissed && (
          <>
            <CheckCircle2 size={15} className="text-success shrink-0" />
            <span className="text-success font-bold">Jawaban siap</span>
          </>
        )}

        {status === 'error' && (
          <>
            <AlertTriangle size={15} className="text-warning shrink-0" />
            <span className="text-warning font-medium">Copilot gagal — coba lagi</span>
          </>
        )}
      </button>
    </div>
  );
};
