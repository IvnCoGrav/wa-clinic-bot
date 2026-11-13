import React from 'react';
import { ImageIcon, Save } from 'lucide-react';

interface Props {
  mediaRetentionDays: string;
  setMediaRetentionDays: (val: string) => void;
  mediaEnvFallbackDays: number;
  savingMediaRetention: boolean;
  handleSaveMediaRetention: () => void;
}

export const MediaRetentionPanel: React.FC<Props> = ({
  mediaRetentionDays,
  setMediaRetentionDays,
  mediaEnvFallbackDays,
  savingMediaRetention,
  handleSaveMediaRetention,
}) => {
  return (
    <div className="bg-surface border border-divider rounded-2xl p-5 space-y-3 shadow-xs">
      <h3 className="text-sm font-bold text-ink flex items-center space-x-2">
        <ImageIcon className="text-accent" size={16} />
        <span>Retensi Media Live Chat &amp; Dokumen</span>
      </h3>
      <p className="text-xs text-ink-3 leading-relaxed">
        Atur durasi penyimpanan file media (gambar &amp; dokumen) Live Chat sebelum dibersihkan otomatis oleh sistem maintenance.
      </p>

      <div className="space-y-3 pt-1">
        <div className="space-y-1">
          <label className="text-[11px] font-bold text-ink block">
            Masa Retensi Media (Hari, 1-3650)
          </label>
          <input
            type="number"
            min={1}
            max={3650}
            value={mediaRetentionDays}
            onChange={(e) => setMediaRetentionDays(e.target.value)}
            className="w-full bg-surface border border-divider rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent shadow-xs"
          />
          <span className="text-[10px] text-ink-3 mt-0.5 block">
            Fallback default environment: {mediaEnvFallbackDays} hari.
          </span>
        </div>

        <div className="flex justify-end pt-1">
          <button
            aria-label="Simpan"
            type="button"
            onClick={handleSaveMediaRetention}
            disabled={savingMediaRetention}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-accent-ink rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 disabled:opacity-50 shadow-xs cursor-pointer"
          >
            <Save size={12} />
            <span>{savingMediaRetention ? 'Menyimpan...' : 'Simpan Retensi Media'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
