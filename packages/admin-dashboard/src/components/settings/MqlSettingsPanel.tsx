import React from 'react';
import { Volume2, Save } from 'lucide-react';
import { PricelistImagePanel } from './PricelistImagePanel';
import { ToggleSwitch } from '../common/ToggleSwitch';

interface Props {
  initialPricelistUrl: string | null;
  onPricelistSaved?: () => void;
  mqlThresholdBubbles: number;
  setMqlThresholdBubbles: (val: number) => void;
  mqlAutoLeadEnabled: boolean;
  setMqlAutoLeadEnabled: (val: boolean) => void;
  savingMql: boolean;
  handleSaveMql: () => void;
}

export const MqlSettingsPanel: React.FC<Props> = ({
  initialPricelistUrl,
  onPricelistSaved,
  mqlThresholdBubbles,
  setMqlThresholdBubbles,
  mqlAutoLeadEnabled,
  setMqlAutoLeadEnabled,
  savingMql,
  handleSaveMql,
}) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Gambar Pricelist WhatsApp */}
      <PricelistImagePanel
        initialImageUrl={initialPricelistUrl}
        onSaved={onPricelistSaved}
      />

      {/* MQL Automation Settings */}
      <div className="bg-surface border border-divider rounded-2xl p-5 space-y-3 shadow-xs">
        <h3 className="text-sm font-bold text-ink flex items-center space-x-2">
          <Volume2 className="text-accent" size={16} />
          <span>MQL Automation (Otomatisasi Lead)</span>
        </h3>
        <p className="text-xs text-ink-3 leading-relaxed">
          Atur ambang batas bubble chat untuk mengonversi lead potensial menjadi Marketing Qualified Lead (MQL) secara otomatis.
        </p>

        <div className="space-y-3 pt-1">
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-ink block">
              Ambang Batas Bubble Chat (Default: 5)
            </label>
            <input
              type="number"
              min={1}
              max={50}
              value={mqlThresholdBubbles}
              onChange={(e) => setMqlThresholdBubbles(parseInt(e.target.value, 10) || 5)}
              className="w-full bg-surface border border-divider rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent shadow-xs"
            />
          </div>

          <div className="flex items-center justify-between p-3.5 rounded-xl bg-surface-2 border border-divider">
            <div>
              <span className="text-xs font-bold text-ink block">Otomatisasi Auto-Lead</span>
              <span className="text-[11px] text-ink-3">Tandai customer sebagai MQL otomatis saat batas tercapai</span>
            </div>
            <ToggleSwitch
              checked={mqlAutoLeadEnabled}
              onChange={(next) => setMqlAutoLeadEnabled(next)}
              onLabel="ON (AKTIF)"
              offLabel="OFF (NONAKTIF)"
              size="md"
            />
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={handleSaveMql}
              disabled={savingMql}
              className="px-4 py-2 bg-accent hover:bg-accent-hover text-accent-ink rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 disabled:opacity-50 shadow-xs cursor-pointer"
            >
              <Save size={12} />
              <span>{savingMql ? 'Menyimpan...' : 'Simpan MQL Settings'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
