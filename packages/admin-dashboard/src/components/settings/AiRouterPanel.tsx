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
      <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-4">
        <h3 className="text-base font-bold text-white flex items-center space-x-2">
          <Cpu className="text-pink-400" />
          <span>AI Router Engine</span>
        </h3>
        <p className="text-xs text-slate-400">
          Atur mesin AI Router untuk klasifikasi intent, routing otomatis, dan pencegahan eskalasi manusia yang tidak perlu.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          {/* Router Activation */}
          <div className="p-4 rounded-xl bg-slate-950 border border-white/5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white">Status AI Router</span>
              <button
                onClick={() => handleToggleAiRouter('enabled', !aiRouterEnabled)}
                disabled={savingAiRouter}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                  aiRouterEnabled ? 'bg-emerald-500 text-white' : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                }`}
              >
                {aiRouterEnabled ? 'ENABLED (ON)' : 'DISABLED (OFF)'}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Jika aktif, pesan masuk diklasifikasikan oleh AI Router sebelum diarahkan ke state machine.
            </p>
          </div>

          {/* Shadow Mode Activation */}
          <div className="p-4 rounded-xl bg-slate-950 border border-white/5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white">Shadow Mode (Uji Coba)</span>
              <button
                onClick={() => handleToggleAiRouter('shadowMode', !aiRouterShadowMode)}
                disabled={savingAiRouter}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                  aiRouterShadowMode ? 'bg-amber-500 text-slate-950' : 'bg-emerald-500 text-white'
                }`}
              >
                {aiRouterShadowMode ? 'SHADOW MODE (LOG ONLY)' : 'FULL ACTIVE (LIVE)'}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Dalam Shadow Mode, hasil evaluasi AI Router hanya dicatat di log tanpa mengubah routing langsung.
            </p>
          </div>
        </div>
      </div>

      {/* AI Rollout Scope Panel */}
      <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-4">
        <h3 className="text-base font-bold text-white flex items-center space-x-2">
          <Zap className="text-amber-400" />
          <span>AI Rollout Scope (Target Pelanggan AI)</span>
        </h3>
        <p className="text-xs text-slate-400 leading-relaxed">
          Batasi balasan AI hanya untuk pelanggan baru (dibuat setelah cutoff) agar tidak mengganggu pelanggan legacy yang sedang diproses admin manusia.
        </p>

        <div className="space-y-4 pt-2">
          <div className="flex items-center space-x-4">
            <label className="flex items-center space-x-2 text-xs font-bold text-slate-300 cursor-pointer">
              <input
                type="radio"
                name="aiScope"
                value="NEW_ONLY"
                checked={aiScope === 'NEW_ONLY'}
                onChange={() => setAiScope('NEW_ONLY')}
                className="text-pink-500 focus:ring-pink-500"
              />
              <span>NEW_ONLY (Hanya Pelanggan Baru)</span>
            </label>

            <label className="flex items-center space-x-2 text-xs font-bold text-slate-300 cursor-pointer">
              <input
                type="radio"
                name="aiScope"
                value="ALL"
                checked={aiScope === 'ALL'}
                onChange={() => setAiScope('ALL')}
                className="text-pink-500 focus:ring-pink-500"
              />
              <span>ALL (Semua Pelanggan Baru &amp; Legacy)</span>
            </label>
          </div>

          {aiScope === 'NEW_ONLY' && (
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                Tanggal Cutoff Pelanggan Baru (ISO Date)
              </label>
              <input
                type="text"
                value={aiScopeCutoffAt}
                onChange={(e) => setAiScopeCutoffAt(e.target.value)}
                placeholder="2026-08-01T00:00:00.000Z"
                className="w-full max-w-md bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-pink-500"
              />
            </div>
          )}

          {/* Scope Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
            <div className="p-3 rounded-xl bg-slate-950 border border-white/5">
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Total Pelanggan</span>
              <span className="text-base font-extrabold text-white">{aiScopeSummary.totalCustomers}</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950 border border-white/5">
              <span className="text-[10px] uppercase font-bold text-emerald-400 block">Pelanggan Baru (AI)</span>
              <span className="text-base font-extrabold text-emerald-400">{aiScopeSummary.newCustomers}</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950 border border-white/5">
              <span className="text-[10px] uppercase font-bold text-amber-400 block">Legacy (Skip AI)</span>
              <span className="text-base font-extrabold text-amber-400">{aiScopeSummary.legacyCustomers}</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950 border border-white/5">
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Silenced by Scope</span>
              <span className="text-base font-extrabold text-slate-300">{aiScopeSummary.silencedByScope}</span>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSaveAiScope}
              disabled={savingAiScope}
              className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold transition flex items-center space-x-2 disabled:opacity-50"
            >
              <span>{savingAiScope ? 'Menyimpan Scope...' : 'Simpan Rollout Scope'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
