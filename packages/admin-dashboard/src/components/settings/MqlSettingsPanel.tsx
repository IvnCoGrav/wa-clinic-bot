import React from 'react';
import { Volume2, ImageIcon, Save } from 'lucide-react';

interface Props {
  mqlThresholdBubbles: number;
  setMqlThresholdBubbles: (val: number) => void;
  mqlAutoLeadEnabled: boolean;
  setMqlAutoLeadEnabled: (val: boolean) => void;
  savingMql: boolean;
  handleSaveMql: () => void;
  mediaRetentionDays: string;
  setMediaRetentionDays: (val: string) => void;
  mediaEnvFallbackDays: number;
  savingMediaRetention: boolean;
  handleSaveMediaRetention: () => void;
}

export const MqlSettingsPanel: React.FC<Props> = ({
  mqlThresholdBubbles,
  setMqlThresholdBubbles,
  mqlAutoLeadEnabled,
  setMqlAutoLeadEnabled,
  savingMql,
  handleSaveMql,
  mediaRetentionDays,
  setMediaRetentionDays,
  mediaEnvFallbackDays,
  savingMediaRetention,
  handleSaveMediaRetention,
}) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* MQL Automation Settings */}
      <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-4">
        <h3 className="text-base font-bold text-white flex items-center space-x-2">
          <Volume2 className="text-pink-400" />
          <span>MQL Automation (Otomatisasi Lead)</span>
        </h3>
        <p className="text-xs text-slate-400 leading-relaxed">
          Atur ambang batas bubble chat untuk mengonversi lead potensial menjadi Marketing Qualified Lead (MQL) secara otomatis.
        </p>

        <div className="space-y-4 pt-2">
          <div>
            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
              Ambang Batas Bubble Chat (Default: 5)
            </label>
            <input
              type="number"
              min={1}
              max={50}
              value={mqlThresholdBubbles}
              onChange={(e) => setMqlThresholdBubbles(parseInt(e.target.value, 10) || 5)}
              className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-pink-500"
            />
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-white/5">
            <span className="text-xs font-bold text-slate-300">Otomatisasi Auto-Lead</span>
            <input
              type="checkbox"
              checked={mqlAutoLeadEnabled}
              onChange={(e) => setMqlAutoLeadEnabled(e.target.checked)}
              className="w-4 h-4 text-pink-500 rounded focus:ring-pink-500 cursor-pointer"
            />
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSaveMql}
              disabled={savingMql}
              className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold transition flex items-center space-x-2 disabled:opacity-50"
            >
              <Save size={12} />
              <span>{savingMql ? 'Menyimpan...' : 'Simpan MQL Settings'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Live Chat Media Retention Settings */}
      <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-4">
        <h3 className="text-base font-bold text-white flex items-center space-x-2">
          <ImageIcon className="text-pink-400" />
          <span>Retensi Media Live Chat</span>
        </h3>
        <p className="text-xs text-slate-400 leading-relaxed">
          Atur durasi penyimpanan file media (gambar &amp; dokumen) Live Chat sebelum dibersihkan otomatis oleh sistem maintenance.
        </p>

        <div className="space-y-4 pt-2">
          <div>
            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
              Masa Retensi Media (Hari, 1-3650)
            </label>
            <input
              type="number"
              min={1}
              max={3650}
              value={mediaRetentionDays}
              onChange={(e) => setMediaRetentionDays(e.target.value)}
              className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-pink-500"
            />
            <span className="text-[10px] text-slate-500 mt-1 block">
              Fallback default environment: {mediaEnvFallbackDays} hari.
            </span>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSaveMediaRetention}
              disabled={savingMediaRetention}
              className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold transition flex items-center space-x-2 disabled:opacity-50"
            >
              <Save size={12} />
              <span>{savingMediaRetention ? 'Menyimpan...' : 'Simpan Retensi Media'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
