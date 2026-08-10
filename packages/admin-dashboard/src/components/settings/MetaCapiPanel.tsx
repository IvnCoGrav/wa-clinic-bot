import React from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, KeyRound, ShieldCheck, Check, FileClock, ArrowRight } from 'lucide-react';

interface Props {
  metaPixelId: string;
  setMetaPixelId: (val: string) => void;
  capiAccessToken: string;
  setCapiAccessToken: (val: string) => void;
  capiConfigured: boolean;
  capiSource: string;
  savingCapi: boolean;
  handleSaveCapi: () => void;
  autoSendPurchaseCapi: boolean;
  savingPurchaseModeration: boolean;
  handleTogglePurchaseModeration: (val: boolean) => void;
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
  autoSendPurchaseCapi,
  savingPurchaseModeration,
  handleTogglePurchaseModeration,
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

      {/* Moderasi Event Purchase Meta CAPI (Outlier Filter Queue) */}
      <div className="border-t border-white/5 pt-4 mt-1">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-bold text-white flex items-center space-x-2">
            <FileClock className="text-pink-400" size={14} />
            <span>Moderasi Purchase Meta (CAPI)</span>
          </h4>
          <Link
            to="/admin/meta-capi-queue"
            className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-[11px] font-semibold transition"
          >
            <span>Buka Meta CAPI Queue</span>
            <ArrowRight size={12} />
          </Link>
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
          Jika OFF, transaksi pembayaran ditahan di queue moderasi (Pending Review) sampai di-approve admin —
          mencegah data outlier terkirim ke Meta.
        </p>
        <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950 border border-white/5">
          <div className="pr-3">
            <span className="text-sm font-semibold text-slate-300">Auto-send Purchase CAPI</span>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {autoSendPurchaseCapi
                ? 'Aktif — event pembayaran langsung dikirim ke Meta.'
                : 'Off — event ditahan di queue moderasi (Pending Review Meta) sampai di-approve admin.'}
            </p>
          </div>
          <button
            onClick={() => handleTogglePurchaseModeration(!autoSendPurchaseCapi)}
            disabled={savingPurchaseModeration}
            className={`w-14 h-7 rounded-full transition-all relative flex-shrink-0 ${autoSendPurchaseCapi ? 'bg-emerald-500' : 'bg-rose-500'} ${savingPurchaseModeration ? 'opacity-50' : ''}`}
            title="Toggle moderasi event Purchase Meta CAPI"
          >
            <div className={`absolute top-1 left-1 bg-white h-5 w-5 rounded-full transition-all ${autoSendPurchaseCapi ? 'translate-x-7' : ''}`}></div>
          </button>
        </div>
      </div>
    </div>
  );
};
