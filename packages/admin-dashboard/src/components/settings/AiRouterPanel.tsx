import React from 'react';
import { Cpu, Zap, ShieldCheck } from 'lucide-react';

interface Props {
  aiRouterEnabled: boolean;
  aiRouterShadowMode: boolean;
  savingAiRouter: boolean;
  handleToggleAiRouter: (val: 'enabled' | 'shadowMode', next: boolean) => void;
  aiScope: 'NEW_ONLY' | 'ALL';
  setAiScope: (scope: 'NEW_ONLY' | 'ALL') => void;
  aiScopeCutoffAt: string;
  setAiScopeCutoffAt: (cutoff: string) => void;
  aiScopeSummary: {
    totalCustomers: number;
    newCustomers: number;
    legacyCustomers: number;
    silencedByScope: number;
  };
  savingAiScope: boolean;
  handleSaveAiScope: () => void;
}

export const AiRouterPanel: React.FC<Props> = ({
  aiRouterEnabled,
  aiRouterShadowMode,
  savingAiRouter,
  handleToggleAiRouter,
  aiScope,
  setAiScope,
  aiScopeCutoffAt,
  setAiScopeCutoffAt,
  aiScopeSummary,
  savingAiScope,
  handleSaveAiScope,
}) => {
  return (
    <div className="space-y-6">
      {/* AI Router Engine Toggle Panel */}
      <div className="bg-white border border-[#e9edef] rounded-2xl p-5 space-y-3 shadow-xs">
        <h3 className="text-sm font-bold text-[#111b21] flex items-center space-x-2">
          <Cpu className="text-[#008069]" size={16} />
          <span>AI Router Engine</span>
        </h3>
        <p className="text-xs text-[#667781]">
          Atur mesin AI Router untuk klasifikasi intent, routing otomatis, dan pencegahan eskalasi manusia yang tidak perlu.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          {/* Router Activation */}
          <div className="p-3.5 rounded-xl bg-[#f8fafc] border border-[#e9edef] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#111b21]">Status AI Router</span>
              <button
                onClick={() => handleToggleAiRouter('enabled', !aiRouterEnabled)}
                disabled={savingAiRouter}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition shadow-xs ${
                  aiRouterEnabled ? 'bg-[#008069] text-white' : 'bg-rose-50 text-rose-700 border border-rose-200'
                }`}
              >
                {aiRouterEnabled ? 'ENABLED (ON)' : 'DISABLED (OFF)'}
              </button>
            </div>
            <p className="text-xs text-[#667781] leading-relaxed">
              Jika aktif, pesan masuk diklasifikasikan oleh AI Router sebelum diarahkan ke state machine.
            </p>
          </div>

          {/* Shadow Mode Activation */}
          <div className="p-3.5 rounded-xl bg-[#f8fafc] border border-[#e9edef] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#111b21]">Shadow Mode (Uji Coba)</span>
              <button
                onClick={() => handleToggleAiRouter('shadowMode', !aiRouterShadowMode)}
                disabled={savingAiRouter}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition shadow-xs ${
                  aiRouterShadowMode ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-[#008069] text-white'
                }`}
              >
                {aiRouterShadowMode ? 'SHADOW MODE (LOG ONLY)' : 'FULL ACTIVE (LIVE)'}
              </button>
            </div>
            <p className="text-xs text-[#667781] leading-relaxed">
              Dalam Shadow Mode, hasil evaluasi AI Router hanya dicatat di log tanpa mengubah routing langsung.
            </p>
          </div>
        </div>
      </div>

      {/* AI Rollout Scope Panel */}
      <div className="bg-white border border-[#e9edef] rounded-2xl p-5 space-y-3 shadow-xs">
        <h3 className="text-sm font-bold text-[#111b21] flex items-center space-x-2">
          <Zap className="text-amber-500" size={16} />
          <span>AI Rollout Scope (Target Pelanggan AI)</span>
        </h3>
        <p className="text-xs text-[#667781] leading-relaxed">
          Batasi balasan AI hanya untuk pelanggan baru (dibuat setelah cutoff) agar tidak mengganggu pelanggan legacy yang sedang diproses admin manusia.
        </p>

        <div className="space-y-3 pt-1">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center space-x-2 text-xs font-bold text-[#111b21] cursor-pointer">
              <input
                type="radio"
                name="aiScope"
                value="NEW_ONLY"
                checked={aiScope === 'NEW_ONLY'}
                onChange={() => setAiScope('NEW_ONLY')}
                className="text-[#008069] focus:ring-[#008069]"
              />
              <span>NEW_ONLY (Hanya Pelanggan Baru)</span>
            </label>

            <label className="flex items-center space-x-2 text-xs font-bold text-[#111b21] cursor-pointer">
              <input
                type="radio"
                name="aiScope"
                value="ALL"
                checked={aiScope === 'ALL'}
                onChange={() => setAiScope('ALL')}
                className="text-[#008069] focus:ring-[#008069]"
              />
              <span>ALL (Semua Pelanggan Baru &amp; Legacy)</span>
            </label>
          </div>

          {aiScope === 'NEW_ONLY' && (
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-[#667781] block">
                Tanggal Cutoff Pelanggan Baru (ISO Date)
              </label>
              <input
                type="text"
                value={aiScopeCutoffAt}
                onChange={(e) => setAiScopeCutoffAt(e.target.value)}
                placeholder="2026-08-01T00:00:00.000Z"
                className="w-full max-w-md bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs"
              />
            </div>
          )}

          {/* Scope Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
            <div className="p-3 rounded-xl bg-[#f8fafc] border border-[#e9edef]">
              <span className="text-[10px] uppercase font-bold text-[#667781] block">Total Pelanggan</span>
              <span className="text-base font-extrabold text-[#111b21]">{aiScopeSummary.totalCustomers}</span>
            </div>
            <div className="p-3 rounded-xl bg-[#f8fafc] border border-[#e9edef]">
              <span className="text-[10px] uppercase font-bold text-[#008069] block">Pelanggan Baru (AI)</span>
              <span className="text-base font-extrabold text-[#008069]">{aiScopeSummary.newCustomers}</span>
            </div>
            <div className="p-3 rounded-xl bg-[#f8fafc] border border-[#e9edef]">
              <span className="text-[10px] uppercase font-bold text-amber-700 block">Legacy (Skip AI)</span>
              <span className="text-base font-extrabold text-amber-700">{aiScopeSummary.legacyCustomers}</span>
            </div>
            <div className="p-3 rounded-xl bg-[#f8fafc] border border-[#e9edef]">
              <span className="text-[10px] uppercase font-bold text-[#667781] block">Silenced by Scope</span>
              <span className="text-base font-extrabold text-[#54656f]">{aiScopeSummary.silencedByScope}</span>
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <button
              onClick={handleSaveAiScope}
              disabled={savingAiScope}
              className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 disabled:opacity-50 shadow-xs"
            >
              <span>{savingAiScope ? 'Menyimpan Scope...' : 'Simpan Rollout Scope'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
