import React, { useEffect, useRef, useState } from 'react';
import {
  BootPhase,
  hasBootPhase,
  isBootFinished,
  markBootFinished,
  onBootMessage,
  onBootProgress,
} from '../../lib/bootProgress';

const PHASE_PCT: Record<string, number> = {
  auth: 40,
  chunk: 65,
  mount: 85,
  data: 100,
};

const LABELS: Record<string, string> = {
  auth: 'Memeriksa sesi…',
  chunk: 'Memuat halaman…',
  mount: 'Menyiapkan tampilan…',
  data: 'Siap',
};

// Bar progress boot yang digerakkan fase nyata + creep anti-beku (cap 92%).
// Muncul sekali saat boot pertama; navigasi berikutnya memakai spinner lama.
export const BootProgress: React.FC = () => {
  const [visible, setVisible] = useState(!isBootFinished());
  const [pct, setPct] = useState(5);
  const [msg, setMsg] = useState('Memuat aplikasi…');
  const pctRef = useRef(5);
  const settledRef = useRef(false);

  useEffect(() => {
    if (isBootFinished()) return;

    const setP = (next: number) => {
      const capped = Math.min(Math.max(next, 0), 100);
      pctRef.current = capped;
      setPct(capped);
    };

    const phaseLabel = () => {
      const order: Array<[BootPhase, string]> = [
        ['data', LABELS.data],
        ['mount', LABELS.mount],
        ['chunk', LABELS.chunk],
        ['auth', LABELS.auth],
      ];
      for (const [phase, label] of order) {
        if (hasBootPhase(phase)) return label;
      }
      return null;
    };

    const finish = () => {
      if (settledRef.current) return;
      settledRef.current = true;
      setP(100);
      setTimeout(() => {
        markBootFinished();
        setVisible(false);
      }, 350);
    };

    const applyPhase = () => {
      if (settledRef.current) return;
      const label = phaseLabel();
      if (label) setMsg(label);

      if (hasBootPhase('data') || hasBootPhase('done')) {
        finish();
        return;
      }
      if (hasBootPhase('mount')) {
        // Konten sudah tampil — isi lalu memudar sebentar lagi
        setP(Math.max(pctRef.current, PHASE_PCT.mount));
        setTimeout(finish, 600);
        return;
      }
      let next = pctRef.current;
      for (const phase of ['auth', 'chunk'] as const) {
        if (hasBootPhase(phase)) next = Math.max(next, PHASE_PCT[phase]);
      }
      setP(next);
    };

    applyPhase();
    const offProgress = onBootProgress(applyPhase);
    const offMsg = onBootMessage(setMsg);

    // Anti-beku: merayap pelan bila fase macet (jaringan HP lambat)
    const creep = setInterval(() => {
      if (settledRef.current || hasBootPhase('mount') || hasBootPhase('done')) return;
      setP(pctRef.current + 2);
    }, 1500);

    return () => {
      offProgress();
      offMsg();
      clearInterval(creep);
    };
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#f0f2f5]">
      <div className="w-64 max-w-[70vw]">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#e9edef]">
          <div
            className="h-full rounded-full bg-[#008069] transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-3 text-center text-xs text-[#667781]">{msg}</p>
      </div>
    </div>
  );
};
