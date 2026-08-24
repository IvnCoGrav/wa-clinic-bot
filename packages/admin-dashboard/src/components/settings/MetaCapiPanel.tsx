import React from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, KeyRound, ShieldCheck, Check, FileClock, ArrowRight } from 'lucide-react';
import { ToggleSwitch } from '../common/ToggleSwitch';

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
    <div className="bg-white border border-[#e9edef] rounded-2xl p-5 space-y-4 shadow-xs">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-[#111b21] flex items-center space-x-2">
          <BarChart3 className="text-[#008069]" size={16} />
          <span>Meta Pixel &amp; CAPI (Konversi Iklan Meta)</span>
        </h3>
        <span
          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
            capiConfigured ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-slate-100 text-slate-700 border border-slate-200'
          }`}
        >
          {capiConfigured ? `CONFIGURED (${capiSource.toUpperCase()})` : 'NOT CONFIGURED'}
        </span>
      </div>

      <p className="text-xs text-[#667781] leading-relaxed">
        Integrasi Conversion API (CAPI) Meta untuk mengirim event konversi (Lead &amp; Purchase) secara server-side ke Meta Ads Manager.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
        <div className="space-y-1">
          <label className="text-[11px] font-bold text-[#111b21] flex items-center space-x-1">
            <BarChart3 size={11} className="text-[#008069]" />
            <span>Meta Pixel ID</span>
          </label>
          <input
            type="text"
            value={metaPixelId}
            onChange={(e) => setMetaPixelId(e.target.value)}
            placeholder="mis. 123456789012345"
            className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-bold text-[#111b21] flex items-center space-x-1">
            <ShieldCheck size={11} className="text-[#008069]" />
            <span>CAPI Access Token (Meta Conversion API)</span>
          </label>
          <input
            type="password"
            value={capiAccessToken}
            onChange={(e) => setCapiAccessToken(e.target.value)}
            placeholder={capiConfigured ? '•••••••• (kosongkan bila tidak diubah)' : 'EAA... Meta CAPI Access Token'}
            className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs"
          />
        </div>
      </div>

      <div className="flex justify-end pt-1">
        <button
          onClick={handleSaveCapi}
          disabled={savingCapi}
          className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 disabled:opacity-50 shadow-xs"
        >
          <span>{savingCapi ? 'Menyimpan CAPI...' : 'Simpan Kredensial CAPI'}</span>
        </button>
      </div>

      {/* Moderasi Event Purchase Meta CAPI (Outlier Filter Queue) */}
      <div className="border-t border-[#e9edef] pt-4 mt-2">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-bold text-[#111b21] flex items-center space-x-1.5">
            <FileClock className="text-[#008069]" size={14} />
            <span>Moderasi Purchase Meta (CAPI)</span>
          </h4>
          <Link
            to="/admin/meta-capi-queue"
            className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#111b21] text-xs font-semibold transition shadow-xs"
          >
            <span>Buka Meta CAPI Queue</span>
            <ArrowRight size={11} />
          </Link>
        </div>
        <p className="text-xs text-[#667781] leading-relaxed mb-3">
          Jika OFF, transaksi pembayaran ditahan di queue moderasi (Pending Review) sampai disetujui admin —
          mencegah data outlier terkirim ke Meta.
        </p>
        <div className="flex items-center justify-between p-3.5 rounded-xl bg-[#f8fafc] border border-[#e9edef]">
          <div className="pr-3">
            <span className="text-xs font-bold text-[#111b21]">Auto-send Purchase CAPI</span>
            <p className="text-xs text-[#667781] mt-0.5">
              {autoSendPurchaseCapi
                ? 'Aktif — event pembayaran langsung dikirim ke Meta.'
                : 'Off — event ditahan di queue moderasi (Pending Review Meta) sampai disetujui admin.'}
            </p>
          </div>
          <ToggleSwitch
            checked={autoSendPurchaseCapi}
            onChange={(next) => handleTogglePurchaseModeration(next)}
            disabled={savingPurchaseModeration}
            loading={savingPurchaseModeration}
            onLabel="ON (AUTO-SEND)"
            offLabel="OFF (MODERASI)"
            size="md"
            title="Toggle moderasi event Purchase Meta CAPI"
          />
        </div>
      </div>
    </div>
  );
};
