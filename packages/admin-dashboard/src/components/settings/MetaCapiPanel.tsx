import React from 'react';
import { BarChart3, KeyRound, ShieldCheck, Check } from 'lucide-react';

interface Props {
  metaPixelId: string;
  setMetaPixelId: (val: string) => void;
  capiAccessToken: string;
  setCapiAccessToken: (val: string) => void;
  capiConfigured: boolean;
  capiSource: string;
  savingCapi: boolean;
  handleSaveCapi: () => void;
}

export const MetaCapiPanel: React.FC<Props> = ({
  metaPixelId,
  setMetaPixelId,
  capiAccessToken,
  setCapiAccessToken,
  capiConfigured,
  capiSource,
  savingCapi,
  handleSaveCapi,
}) => {
  return (
    <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-white flex items-center space-x-2">
          <BarChart3 className="text-pink-400" />
          <span>Meta Pixel &amp; CAPI (Konversi Iklan Meta)</span>
        </h3>
        <span
          className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${
            capiConfigured ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'
          }`}
        >
          {capiConfigured ? `CONFIGURED (${capiSource.toUpperCase()})` : 'NOT CONFIGURED'}
        </span>
      </div>

      <p className="text-xs text-slate-400 leading-relaxed">
        Integrasi Conversion API (CAPI) Meta untuk mengirim event konversi (Lead &amp; Purchase) secara server-side ke Meta Ads Manager.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
        <div>
          <label className="text-[10px] uppercase font-bold text-slate-400 flex items-center space-x-1 mb-1">
            <BarChart3 size={10} />
            <span>Meta Pixel ID</span>
          </label>
          <input
            type="text"
            value={metaPixelId}
            onChange={(e) => setMetaPixelId(e.target.value)}
            placeholder="mis. 123456789012345"
            className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-pink-500"
          />
        </div>

        <div>
          <label className="text-[10px] uppercase font-bold text-slate-400 flex items-center space-x-1 mb-1">
            <ShieldCheck size={10} />
            <span>CAPI Access Token (Meta Conversion API)</span>
          </label>
          <input
            type="password"
            value={capiAccessToken}
            onChange={(e) => setCapiAccessToken(e.target.value)}
            placeholder={capiConfigured ? '•••••••• (kosongkan bila tidak diubah)' : 'EAA... Meta CAPI Access Token'}
            className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-pink-500"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSaveCapi}
          disabled={savingCapi}
          className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold transition flex items-center space-x-2 disabled:opacity-50"
        >
          <span>{savingCapi ? 'Menyimpan CAPI...' : 'Simpan Kredensial CAPI'}</span>
        </button>
      </div>
    </div>
  );
};
