import React from 'react';
import { Cpu, Zap, Calendar, Check, Loader2, Clock } from 'lucide-react';
import { ToggleSwitch } from '../common/ToggleSwitch';

interface Props {
  aiRouterEnabled: boolean;
  aiRouterShadowMode: boolean;
  savingAiRouter: boolean;
  handleToggleAiRouter: (val: 'enabled' | 'shadowMode', next: boolean) => void;
  aiScope: 'NEW_ONLY' | 'ALL';
  aiScopeCutoffAt: string; // format YYYY-MM-DD
  aiScopeSummary: {
    totalCustomers: number;
    newCustomers: number;
    legacyCustomers: number;
    silencedByScope: number;
  };
  savingAiScope: boolean;
  handleUpdateAiScope: (scope?: 'NEW_ONLY' | 'ALL', cutoffDate?: string) => Promise<void>;
}

export const AiRouterPanel: React.FC<Props> = ({
  aiRouterEnabled,
  aiRouterShadowMode,
  savingAiRouter,
  handleToggleAiRouter,
  aiScope,
  aiScopeCutoffAt,
  aiScopeSummary,
  savingAiScope,
  handleUpdateAiScope,
}) => {
  // Format tanggal Indonesia (contoh: 20 Agustus 2026)
  const formatIndonesianDate = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const dt = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        return dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      }
      const dt = new Date(dateStr);
      if (isNaN(dt.getTime())) return dateStr;
      return dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  // Helper preset tanggal
  const handleSetPresetDate = (daysAgo: number) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    handleUpdateAiScope('NEW_ONLY', `${y}-${m}-${day}`);
  };

  const handleSetFirstOfMonth = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    handleUpdateAiScope('NEW_ONLY', `${y}-${m}-01`);
  };

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
              <ToggleSwitch
                checked={aiRouterEnabled}
                onChange={(next) => handleToggleAiRouter('enabled', next)}
                loading={savingAiRouter}
                disabled={savingAiRouter}
                onLabel="ON (AKTIF)"
                offLabel="OFF (NONAKTIF)"
                size="md"
              />
            </div>
            <p className="text-xs text-[#667781] leading-relaxed">
              Jika aktif, pesan masuk diklasifikasikan oleh AI Router sebelum diarahkan ke state machine.
            </p>
          </div>

          {/* AI Output Verifier Activation (QC Guardrail) */}
          <div className="p-3.5 rounded-xl bg-[#f8fafc] border border-[#e9edef] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#111b21]">AI Output Verifier (QC Guardrail)</span>
              <ToggleSwitch
                checked={aiRouterShadowMode}
                onChange={(next) => handleToggleAiRouter('shadowMode', next)}
                loading={savingAiRouter}
                disabled={savingAiRouter}
                onLabel="QC ON (GUARDRAIL)"
                offLabel="QC OFF"
                size="md"
              />
            </div>
            <p className="text-xs text-[#667781] leading-relaxed">
              Memeriksa draf balasan AI terhadap Ground Truth (kategori usia, SOP klinik, validasi lokasi) sebelum pesan dikirim ke customer.
            </p>
          </div>
        </div>
      </div>

      {/* AI Rollout Scope Panel */}
      <div className="bg-white border border-[#e9edef] rounded-2xl p-5 space-y-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-[#f0f2f5] pb-3">
          <div className="space-y-0.5">
            <h3 className="text-sm font-bold text-[#111b21] flex items-center space-x-2">
              <Zap className="text-amber-500" size={16} />
              <span>AI Rollout Scope (Target Pelanggan AI)</span>
            </h3>
            <p className="text-xs text-[#667781] leading-relaxed">
              Batasi balasan AI hanya untuk pelanggan baru agar pelanggan legacy (lama) tetap ditangani secara personal oleh staf manusia.
            </p>
          </div>

          {/* Auto-save status indicator */}
          <div className="flex items-center gap-1.5 shrink-0">
            {savingAiScope ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-[#008069] text-xs font-semibold animate-pulse border border-emerald-200">
                <Loader2 size={13} className="animate-spin" />
                <span>Menyimpan ke server...</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#f0f2f5] text-[#54656f] text-[11px] font-medium">
                <Check size={13} className="text-[#008069]" />
                <span>Otomatis tersimpan</span>
              </span>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {/* Target Audience Scope Radio */}
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider font-bold text-[#667781] block">
              Pilihan Target Pelanggan
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <label
                className={`flex items-center space-x-2 px-3.5 py-2.5 rounded-xl border text-xs font-semibold cursor-pointer transition shadow-xs ${
                  aiScope === 'NEW_ONLY'
                    ? 'border-[#008069] bg-emerald-50/50 text-[#008069]'
                    : 'border-[#e9edef] bg-white text-[#111b21] hover:bg-[#f8fafc]'
                }`}
              >
                <input
                  type="radio"
                  name="aiScope"
                  value="NEW_ONLY"
                  checked={aiScope === 'NEW_ONLY'}
                  onChange={() => handleUpdateAiScope('NEW_ONLY', aiScopeCutoffAt)}
                  disabled={savingAiScope}
                  className="text-[#008069] focus:ring-[#008069]"
                />
                <span>NEW_ONLY (Hanya Pelanggan Baru Mulai Tanggal Cutoff)</span>
              </label>

              <label
                className={`flex items-center space-x-2 px-3.5 py-2.5 rounded-xl border text-xs font-semibold cursor-pointer transition shadow-xs ${
                  aiScope === 'ALL'
                    ? 'border-[#008069] bg-emerald-50/50 text-[#008069]'
                    : 'border-[#e9edef] bg-white text-[#111b21] hover:bg-[#f8fafc]'
                }`}
              >
                <input
                  type="radio"
                  name="aiScope"
                  value="ALL"
                  checked={aiScope === 'ALL'}
                  onChange={() => handleUpdateAiScope('ALL', aiScopeCutoffAt)}
                  disabled={savingAiScope}
                  className="text-[#008069] focus:ring-[#008069]"
                />
                <span>ALL (Semua Pelanggan Lama &amp; Baru)</span>
              </label>
            </div>
          </div>

          {/* Date Picker Section - Only shown when NEW_ONLY */}
          {aiScope === 'NEW_ONLY' && (
            <div className="p-4 rounded-2xl bg-[#f8fafc] border border-[#e9edef] space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-[#111b21] flex items-center space-x-1.5">
                  <Calendar className="text-[#008069]" size={15} />
                  <span>Tanggal Cutoff Pelanggan Baru</span>
                </label>
                <span className="text-[11px] text-[#667781]">Pilih tanggal (tanpa jam)</span>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                {/* Clean HTML5 Date Input */}
                <div className="relative flex-1 max-w-xs">
                  <input
                    type="date"
                    value={aiScopeCutoffAt}
                    onChange={(e) => handleUpdateAiScope('NEW_ONLY', e.target.value)}
                    disabled={savingAiScope}
                    className="w-full bg-white border border-[#d1d7db] rounded-xl px-3.5 py-2 text-xs font-bold text-[#111b21] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs cursor-pointer disabled:opacity-50"
                  />
                </div>

                {/* Quick Presets */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] uppercase font-bold text-[#8696a0] mr-1">Preset:</span>
                  <button
                    type="button"
                    onClick={() => handleSetPresetDate(0)}
                    disabled={savingAiScope}
                    className="px-2.5 py-1.5 rounded-lg bg-white border border-[#d1d7db] hover:bg-[#f0f2f5] text-[#111b21] text-[11px] font-semibold transition disabled:opacity-50 shadow-2xs"
                  >
                    Hari Ini
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSetPresetDate(1)}
                    disabled={savingAiScope}
                    className="px-2.5 py-1.5 rounded-lg bg-white border border-[#d1d7db] hover:bg-[#f0f2f5] text-[#111b21] text-[11px] font-semibold transition disabled:opacity-50 shadow-2xs"
                  >
                    Kemarin
                  </button>
                  <button
                    type="button"
                    onClick={handleSetFirstOfMonth}
                    disabled={savingAiScope}
                    className="px-2.5 py-1.5 rounded-lg bg-white border border-[#d1d7db] hover:bg-[#f0f2f5] text-[#111b21] text-[11px] font-semibold transition disabled:opacity-50 shadow-2xs"
                  >
                    Awal Bulan Ini
                  </button>
                </div>
              </div>

              {/* Dynamic Explanatory Banner */}
              {aiScopeCutoffAt && (
                <div className="flex items-start space-x-2 text-xs text-[#54656f] bg-white border border-[#e9edef] rounded-xl p-3 shadow-2xs">
                  <Clock className="text-[#008069] shrink-0 mt-0.5" size={14} />
                  <p className="leading-relaxed">
                    Pelanggan yang pertama kali chat mulai <strong className="text-[#111b21]">{formatIndonesianDate(aiScopeCutoffAt)}</strong> akan otomatis dilayani bot AI. Pelanggan yang terdaftar sebelum tanggal tersebut disenyapkan (<em>silent auto-hold</em>) dan diteruskan ke admin manusia.
                  </p>
                </div>
              )}
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
        </div>
      </div>
    </div>
  );
};
