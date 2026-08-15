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
      <div className="bg-white border border-[#e9edef] rounded-2xl p-5 space-y-3 shadow-xs">
        <h3 className="text-sm font-bold text-[#111b21] flex items-center space-x-2">
          <Volume2 className="text-[#008069]" size={16} />
          <span>MQL Automation (Otomatisasi Lead)</span>
        </h3>
        <p className="text-xs text-[#667781] leading-relaxed">
          Atur ambang batas bubble chat untuk mengonversi lead potensial menjadi Marketing Qualified Lead (MQL) secara otomatis.
        </p>

        <div className="space-y-3 pt-1">
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-[#111b21] block">
              Ambang Batas Bubble Chat (Default: 5)
            </label>
            <input
              type="number"
              min={1}
              max={50}
              value={mqlThresholdBubbles}
              onChange={(e) => setMqlThresholdBubbles(parseInt(e.target.value, 10) || 5)}
              className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs"
            />
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl bg-[#f8fafc] border border-[#e9edef]">
            <span className="text-xs font-semibold text-[#111b21]">Otomatisasi Auto-Lead</span>
            <input
              type="checkbox"
              checked={mqlAutoLeadEnabled}
              onChange={(e) => setMqlAutoLeadEnabled(e.target.checked)}
              className="w-4 h-4 text-[#008069] rounded focus:ring-[#008069] cursor-pointer"
            />
          </div>

          <div className="flex justify-end pt-1">
            <button
              onClick={handleSaveMql}
              disabled={savingMql}
              className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 disabled:opacity-50 shadow-xs"
            >
              <Save size={12} />
              <span>{savingMql ? 'Menyimpan...' : 'Simpan MQL Settings'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Live Chat Media Retention Settings */}
      <div className="bg-white border border-[#e9edef] rounded-2xl p-5 space-y-3 shadow-xs">
        <h3 className="text-sm font-bold text-[#111b21] flex items-center space-x-2">
          <ImageIcon className="text-[#008069]" size={16} />
          <span>Retensi Media Live Chat</span>
        </h3>
        <p className="text-xs text-[#667781] leading-relaxed">
          Atur durasi penyimpanan file media (gambar &amp; dokumen) Live Chat sebelum dibersihkan otomatis oleh sistem maintenance.
        </p>

        <div className="space-y-3 pt-1">
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-[#111b21] block">
              Masa Retensi Media (Hari, 1-3650)
            </label>
            <input
              type="number"
              min={1}
              max={3650}
              value={mediaRetentionDays}
              onChange={(e) => setMediaRetentionDays(e.target.value)}
              className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs"
            />
            <span className="text-[10px] text-[#8696a0] mt-0.5 block">
              Fallback default environment: {mediaEnvFallbackDays} hari.
            </span>
          </div>

          <div className="flex justify-end pt-1">
            <button
              onClick={handleSaveMediaRetention}
              disabled={savingMediaRetention}
              className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 disabled:opacity-50 shadow-xs"
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
