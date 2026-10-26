import React from 'react';
import { DollarSign, TrendingUp, Target, Users, MessageSquare, Save, Check } from 'lucide-react';
import { MetaPerformanceReport, fmtRupiah } from './types';

interface BadgeProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone?: 'ok' | 'default';
}

const Badge: React.FC<BadgeProps> = ({ label, value, icon, tone = 'default' }) => (
  <div className="flex items-center gap-2 rounded-xl border border-[#e9edef] bg-[#f8fafc] px-3 py-2">
    <span className={`shrink-0 ${tone === 'ok' ? 'text-[#008069]' : 'text-[#667781]'}`}>{icon}</span>
    <div className="min-w-0">
      <p className="text-[10px] uppercase font-bold text-[#8696a0] tracking-wider">{label}</p>
      <p className={`text-sm font-extrabold truncate ${tone === 'ok' ? 'text-[#008069]' : 'text-[#111b21]'}`}>{value}</p>
    </div>
  </div>
);

interface SpendCalculatorProps {
  lpwaSpend: string;
  ctwaSpend: string;
  onLpwaSpendChange: (v: string) => void;
  onCtwaSpendChange: (v: string) => void;
  onSaveSpends?: () => Promise<void>;
  isSaving?: boolean;
  saveSuccess?: boolean;
  report: MetaPerformanceReport | null;
  // Backward compatibility
  spendInput?: string;
  onSpendChange?: (v: string) => void;
}

export const SpendCalculator: React.FC<SpendCalculatorProps> = ({
  lpwaSpend,
  ctwaSpend,
  onLpwaSpendChange,
  onCtwaSpendChange,
  onSaveSpends,
  isSaving = false,
  saveSuccess = false,
  report,
}) => {
  const k = report?.kpiSummary;

  const lpNum = Number(lpwaSpend) || 0;
  const ctNum = Number(ctwaSpend) || 0;
  const totalSpend = lpNum + ctNum;

  return (
    <section className="bg-white border border-[#e9edef] rounded-2xl p-4 shadow-xs space-y-3">
      <div className="flex flex-col lg:flex-row lg:items-end gap-3 justify-between">
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-2.5">
          {/* Input Spend LPWA */}
          <div className="space-y-1">
            <label className="text-[10.5px] uppercase font-bold text-[#667781] flex items-center gap-1">
              <DollarSign size={12} className="text-[#0284c7]" /> Spend LPWA (Rp)
            </label>
            <input
              type="number"
              min={0}
              value={lpwaSpend}
              onChange={(e) => onLpwaSpendChange(e.target.value)}
              placeholder="mis. 1430000"
              className="w-full sm:w-36 bg-white border border-[#d1d7db] rounded-xl px-2.5 py-1.5 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs font-mono"
            />
          </div>

          {/* Input Spend CTWA */}
          <div className="space-y-1">
            <label className="text-[10.5px] uppercase font-bold text-[#667781] flex items-center gap-1">
              <DollarSign size={12} className="text-[#9333ea]" /> Spend CTWA (Rp)
            </label>
            <input
              type="number"
              min={0}
              value={ctwaSpend}
              onChange={(e) => onCtwaSpendChange(e.target.value)}
              placeholder="mis. 1144000"
              className="w-full sm:w-36 bg-white border border-[#d1d7db] rounded-xl px-2.5 py-1.5 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs font-mono"
            />
          </div>

          {/* Total Spend Display */}
          <div className="space-y-1">
            <p className="text-[10.5px] uppercase font-bold text-[#667781]">Total Biaya</p>
            <div className="bg-[#f8fafc] border border-[#e2e8f0] rounded-xl px-3 py-1.5 text-xs font-mono font-bold text-[#0f172a] min-w-[110px]">
              {totalSpend > 0 ? fmtRupiah(totalSpend) : '-'}
            </div>
          </div>

          {/* Tombol Simpan ke Database */}
          {onSaveSpends && (
            <button
              onClick={onSaveSpends}
              disabled={isSaving}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-xs disabled:opacity-50 mt-2 sm:mt-0 ${
                saveSuccess
                  ? 'bg-emerald-600 text-white'
                  : 'bg-[#008069] hover:bg-[#00a884] text-white'
              }`}
            >
              {saveSuccess ? (
                <>
                  <Check size={13} />
                  <span>Tersimpan</span>
                </>
              ) : (
                <>
                  <Save size={13} />
                  <span>{isSaving ? 'Menyimpan...' : 'Simpan DB'}</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Badges CAC, CPL, CPMQL, ROAS */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 flex-1 lg:max-w-3xl">
          <Badge label="Real CAC" value={fmtRupiah(k?.realCac)} icon={<Users size={15} />} tone="ok" />
          <Badge label="Cost / Chat" value={fmtRupiah(k?.costPerLead)} icon={<MessageSquare size={15} />} />
          <Badge label="Cost / MQL" value={fmtRupiah(k?.costPerMql)} icon={<Target size={15} />} />
          <Badge label="Initial ROAS" value={k?.initialRoas !== undefined ? `${k.initialRoas}x` : '-'} icon={<TrendingUp size={15} />} tone="ok" />
          <Badge label="Lifetime ROAS" value={k?.lifetimeRoas !== undefined ? `${k.lifetimeRoas}x` : '-'} icon={<TrendingUp size={15} />} tone="ok" />
        </div>
      </div>
      <p className="text-[10px] text-[#8696a0]">
        Biaya iklan disimpan permanen di database PostgreSQL klinik, sehingga riwayat CAC/ROAS tetap terjaga di semua perangkat.
      </p>
    </section>
  );
};

export default SpendCalculator;
