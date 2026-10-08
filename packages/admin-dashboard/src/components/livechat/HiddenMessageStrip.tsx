import React from 'react';
import { EyeOff, Eye, Undo2, Loader2 } from 'lucide-react';

interface HiddenMessageStripProps {
  messageId: string;
  hiddenBy?: string | null;
  isRevealedLocally: boolean;
  onToggleRevealLocal: () => void;
  onUnhidePermanent: () => void;
  isUnhiding?: boolean;
}

/**
 * Placeholder & Banner untuk Bubble Chat yang Disembunyikan (UI only).
 * Menjaga privasi monitor dashboard tanpa mempengaruhi WhatsApp pasien.
 */
export const HiddenMessageStrip: React.FC<HiddenMessageStripProps> = ({
  hiddenBy,
  isRevealedLocally,
  onToggleRevealLocal,
  onUnhidePermanent,
  isUnhiding = false,
}) => {
  if (isRevealedLocally) {
    // Tampilan ketika bubble sedang dibuka sementara di browser staf ini
    return (
      <div className="flex items-center justify-between gap-2 px-2.5 py-1 mb-1 bg-amber-500/10 dark:bg-amber-400/10 border border-amber-500/20 rounded-md text-[10px] text-amber-700 dark:text-amber-300 select-none">
        <span className="flex items-center gap-1 font-semibold truncate">
          <Eye size={12} className="shrink-0 text-amber-600" />
          <span>Tampilan Sementara (Pesan Disembunyikan{hiddenBy ? ` oleh ${hiddenBy}` : ''})</span>
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onToggleRevealLocal}
            className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-white/80 dark:bg-black/30 hover:bg-white border border-amber-300 dark:border-amber-700 transition active:scale-95 cursor-pointer"
            title="Tutup kembali tampilan sementara"
          >
            Tutup
          </button>
          <button
            type="button"
            disabled={isUnhiding}
            onClick={onUnhidePermanent}
            className="px-1.5 py-0.5 rounded text-[9px] font-bold text-white bg-amber-600 hover:bg-amber-700 transition active:scale-95 disabled:opacity-50 cursor-pointer flex items-center gap-1"
            title="Tampilkan kembali secara permanen untuk semua admin"
          >
            {isUnhiding ? (
              <Loader2 size={10} className="animate-spin" />
            ) : (
              <Undo2 size={10} />
            )}
            <span>Pulihkan</span>
          </button>
        </div>
      </div>
    );
  }

  // Tampilan collapsed (tertutup) default
  return (
    <div className="flex justify-center my-1 select-none animate-fadeIn">
      <div className="flex items-center gap-2 px-3 py-1 bg-slate-100/90 dark:bg-slate-800/80 backdrop-blur-xs border border-dashed border-slate-300 dark:border-slate-700 rounded-lg text-[11px] text-[#667781] dark:text-slate-400 shadow-2xs">
        <EyeOff size={13} className="shrink-0 text-slate-400" />
        <span className="truncate">
          Pesan disembunyikan internal{hiddenBy ? ` • oleh ${hiddenBy}` : ''}
        </span>
        <div className="flex items-center gap-1 ml-1 shrink-0">
          <button
            type="button"
            onClick={onToggleRevealLocal}
            className="px-2 py-0.5 rounded bg-white dark:bg-slate-700 hover:bg-emerald-50 dark:hover:bg-slate-600 hover:text-[#008069] dark:hover:text-emerald-300 border border-slate-200 dark:border-slate-600 font-semibold text-[10px] transition active:scale-95 cursor-pointer flex items-center gap-1"
            title="Lihat isi pesan sementara di layar Anda"
          >
            <Eye size={11} />
            <span>Lihat</span>
          </button>
          <button
            type="button"
            disabled={isUnhiding}
            onClick={onUnhidePermanent}
            className="px-2 py-0.5 rounded bg-white dark:bg-slate-700 hover:bg-amber-50 dark:hover:bg-slate-600 hover:text-amber-700 dark:hover:text-amber-300 border border-slate-200 dark:border-slate-600 font-semibold text-[10px] transition active:scale-95 disabled:opacity-50 cursor-pointer flex items-center gap-1"
            title="Tampilkan kembali untuk semua admin"
          >
            {isUnhiding ? (
              <Loader2 size={11} className="animate-spin text-amber-600" />
            ) : (
              <Undo2 size={11} />
            )}
            <span>Pulihkan</span>
          </button>
        </div>
      </div>
    </div>
  );
};
