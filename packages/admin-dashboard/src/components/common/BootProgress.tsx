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
  auth: 50,
  chunk: 75,
  mount: 90,
  data: 100,
};

// Bar progress boot non-blocking (Sleek Top Bar ala YouTube/GitHub)
// Tidak menutupi layar atau mengunci tombol navigasi pengguna.
export const BootProgress: React.FC = () => {
  const [visible, setVisible] = useState(!isBootFinished());
  const [pct, setPct] = useState(25);
  const pctRef = useRef(25);
  const settledRef = useRef(false);

  useEffect(() => {
    if (isBootFinished()) {
      setVisible(false);
      return;
    }

    const setP = (next: number) => {
      const capped = Math.min(Math.max(next, 0), 100);
      pctRef.current = capped;
      setPct(capped);
    };

    const finish = () => {
      if (settledRef.current) return;
      settledRef.current = true;
      setP(100);
      setTimeout(() => {
        markBootFinished();
        setVisible(false);
      }, 250);
    };

    const applyPhase = () => {
      if (settledRef.current) return;

      if (hasBootPhase('data') || hasBootPhase('done')) {
        finish();
        return;
      }
      if (hasBootPhase('mount')) {
        setP(Math.max(pctRef.current, PHASE_PCT.mount));
        setTimeout(finish, 150);
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

    // Hard Safety Timeout: Maksimal 1.2 detik bar akan otomatis selesai & hilang
    const autoDismissTimer = setTimeout(() => {
      finish();
    }, 1200);

    return () => {
      offProgress();
      clearTimeout(autoDismissTimer);
    };
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed top-0 left-0 right-0 h-[3px] z-[99999] bg-transparent pointer-events-none">
      <div
        className="h-full bg-[#008069] transition-[width] duration-200 ease-out shadow-[0_0_8px_rgba(0,128,105,0.6)]"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
};
