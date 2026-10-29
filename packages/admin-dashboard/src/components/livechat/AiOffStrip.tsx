import React from 'react';
import { ShieldAlert } from 'lucide-react';

/**
 * Strip status AI Nonaktif — teks saja, tanpa toggle.
 * Toggle satu-satunya ada di sticky search bar agar tidak ada dialog ganda.
 */
export const AiOffStrip: React.FC<{ compact?: boolean }> = ({ compact = true }) => {
  return (
    <div className="lg:hidden mb-1 py-1 px-2.5 rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50/90 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 text-[10px] font-semibold flex items-center gap-1.5 shadow-2xs animate-fadeIn">
      <ShieldAlert size={13} className="text-amber-600 dark:text-[#f59e0b] shrink-0" />
      <span className="truncate">
        <span className="font-bold text-amber-700 dark:text-[#f59e0b]">AI NONAKTIF</span>{' '}
        <span className="text-amber-800 dark:text-amber-200">— CS manual. Nyalakan via sakelar ON/OFF di bilah cari.</span>
      </span>
    </div>
  );
};
