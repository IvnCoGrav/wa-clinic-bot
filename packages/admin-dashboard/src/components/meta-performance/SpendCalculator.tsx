import React from 'react';
import { DollarSign, TrendingUp, Target, Users, MessageSquare } from 'lucide-react';
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
  spendInput: string;
  onSpendChange: (v: string) => void;
  report: MetaPerformanceReport | null;
}

/**
 * Input biaya iklan + badge CAC/CPL/CPMQL/ROAS. Nilai yang tidak dapat dihitung
 * (tanpa spend atau pembagi 0) ditampilkan "-", bukan Infinity/NaN.
 */
export const SpendCalculator: React.FC<SpendCalculatorProps> = ({ spendInput, onSpendChange, report }) => {
  const k = report?.kpiSummary;
  return (
    <section className="bg-white border border-[#e9edef] rounded-2xl p-4 shadow-xs space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="space-y-1">
          <label className="text-[11px] uppercase font-bold text-[#667781] flex items-center gap-1">
            <DollarSign size={12} className="text-[#008069]" /> Total Biaya Iklan (Rp)
          </label>
          <input
            type="number"
            min={0}
            value={spendInput}
            onChange={(e) => onSpendChange(e.target.value)}
            placeholder="mis. 3000000"
            className="w-full sm:w-56 bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-sm text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs"
          />
          <p className="text-[10px] text-[#8696a0]">Isi untuk menghitung CAC &amp; ROAS riil. Kosongkan untuk menyembunyikan.</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 flex-1">
          <Badge label="Real CAC" value={fmtRupiah(k?.realCac)} icon={<Users size={15} />} tone="ok" />
          <Badge label="Cost / Chat" value={fmtRupiah(k?.costPerLead)} icon={<MessageSquare size={15} />} />
          <Badge label="Cost / MQL" value={fmtRupiah(k?.costPerMql)} icon={<Target size={15} />} />
          <Badge label="Initial ROAS" value={k?.initialRoas !== undefined ? `${k.initialRoas}x` : '-'} icon={<TrendingUp size={15} />} tone="ok" />
          <Badge label="Lifetime ROAS" value={k?.lifetimeRoas !== undefined ? `${k.lifetimeRoas}x` : '-'} icon={<TrendingUp size={15} />} tone="ok" />
        </div>
      </div>
    </section>
  );
};

export default SpendCalculator;
