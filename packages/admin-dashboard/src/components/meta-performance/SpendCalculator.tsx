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
  <div className="flex items-center gap-2 rounded-xl border border-divider bg-surface-2 px-3 py-2">
    <span className={`shrink-0 ${tone === 'ok' ? 'text-accent' : 'text-ink-2'}`}>{icon}</span>
    <div className="min-w-0">
      <p className="text-[10px] uppercase font-bold text-ink-3 tracking-wider">{label}</p>
      <p className={`text-sm font-extrabold truncate ${tone === 'ok' ? 'text-accent' : 'text-ink'}`}>{value}</p>
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
    <section className="bg-surface border border-divider rounded-2xl p-4 shadow-xs space-y-3">
      <div className="flex flex-col lg:flex-row lg:items-end gap-3 justify-between">
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-2.5">
          {/* Input Spend LPWA */}
          <div className="space-y-1">
            <label className="text-[10.5px] uppercase font-bold text-ink-3 flex items-center gap-1">
              <DollarSign size={12} className="text-info" /> Spend LPWA (Rp)
            </label>
            <input
              type="number"
              min={0}
              value={lpwaSpend}
              onChange={(e) => onLpwaSpendChange(e.target.value)}
              placeholder="mis. 1430000"
              className="w-full sm:w-36 bg-surface border border-strong rounded-xl px-2.5 py-1.5 text-xs text-ink placeholder-ink-3 focus:outline-none focus:border-accent shadow-xs font-mono"
            />
          </div>

          {/* Input Spend CTWA */}
          <div className="space-y-1">
            <label className="text-[10.5px] uppercase font-bold text-ink-3 flex items-center gap-1">
              <DollarSign size={12} className="text-violet-600 dark:text-violet-400" /> Spend CTWA (Rp)
            </label>
            <input
              type="number"
              min={0}
              value={ctwaSpend}
              onChange={(e) => onCtwaSpendChange(e.target.value)}
              placeholder="mis. 1144000"
              className="w-full sm:w-36 bg-surface border border-strong rounded-xl px-2.5 py-1.5 text-xs text-ink placeholder-ink-3 focus:outline-none focus:border-accent shadow-xs font-mono"
            />
          </div>

          {/* Total Spend Display */}
          <div className="space-y-1">
            <p className="text-[10.5px] uppercase font-bold text-ink-3">Total Biaya</p>
            <div className="bg-surface-2 border border-divider rounded-xl px-3 py-1.5 text-xs font-mono font-bold text-ink min-w-[110px]">
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
                  ? 'bg-success text-on-solid'
                  : 'bg-accent hover:bg-accent-hover text-accent-ink'
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
      <p className="text-[10px] text-ink-3">
        Biaya iklan disimpan permanen di database PostgreSQL klinik, sehingga riwayat CAC/ROAS tetap terjaga di semua perangkat.
      </p>
    </section>
  );
};

export default SpendCalculator;
