import React from 'react';
import { Eye, MousePointerClick, MessageSquare, Target, Users, Info } from 'lucide-react';
import { MetaPerformanceReport, fmtNum, fmtPct } from './types';

interface Stage {
  label: string;
  value: number;
  icon: React.ReactNode;
  widthPct: number;
  dropPct: number | null;
}

/** Corong konversi PageView → Klik → Chat → MQL → Pembeli dengan drop-off per tahap. */
export const FunnelBars: React.FC<{ report: MetaPerformanceReport }> = ({ report }) => {
  const f = report.funnel;
  const stages: Stage[] = [
    { label: 'Page View', value: f.pageViews, icon: <Eye size={14} />, widthPct: 100, dropPct: null },
    { label: 'Klik CTA', value: f.totalClicks, icon: <MousePointerClick size={14} />, widthPct: 0, dropPct: null },
    { label: 'Chat Masuk', value: f.matchedChats, icon: <MessageSquare size={14} />, widthPct: 0, dropPct: null },
    { label: 'MQL', value: f.mqlLeads, icon: <Target size={14} />, widthPct: 0, dropPct: null },
    { label: 'Pembeli Baru', value: f.newCustomers, icon: <Users size={14} />, widthPct: 0, dropPct: null },
  ];
  const base = Math.max(f.pageViews, f.totalClicks, 1);
  stages.forEach((s, i) => {
    s.widthPct = Math.max(2, Math.round((s.value / base) * 100));
    if (i > 0) {
      const prev = stages[i - 1].value;
      s.dropPct = prev > 0 ? Math.round(((prev - s.value) / prev) * 100) : null;
    }
  });

  return (
    <section className="bg-white border border-[#e9edef] rounded-2xl p-5 shadow-xs space-y-4">
      <h3 className="text-sm font-bold text-[#111b21] flex items-center gap-2">
        <Target size={16} className="text-[#008069]" /> Corong Konversi Iklan
        <span title="Berbasis event: menghitung interaksi klik & chat masuk pada rentang ini." className="text-[#8696a0] cursor-help">
          <Info size={13} />
        </span>
      </h3>
      <div className="space-y-2.5">
        {stages.map((s) => (
          <div key={s.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-semibold text-[#111b21]">
                <span className="text-[#008069]">{s.icon}</span> {s.label}
              </span>
              <span className="font-mono font-bold text-[#111b21]">
                {fmtNum(s.value)}
                {s.dropPct !== null && <span className="ml-2 text-rose-500 font-sans text-[10px]">-{s.dropPct}%</span>}
              </span>
            </div>
            <div className="h-2.5 bg-[#f0f2f5] rounded-full overflow-hidden">
              <div className="h-full bg-[#008069] rounded-full transition-all" style={{ width: `${s.widthPct}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-1">
        {[
          ['LP → Klik', f.conversionRates.lpToClick],
          ['Klik → Chat', f.conversionRates.clickToChat],
          ['Chat → MQL', f.conversionRates.chatToMql],
          ['MQL → Beli', f.conversionRates.mqlToBuyer],
        ].map(([label, val]) => (
          <div key={label as string} className="rounded-xl border border-[#e9edef] bg-[#f8fafc] px-3 py-2">
            <p className="text-[10px] uppercase font-bold text-[#8696a0]">{label}</p>
            <p className="text-sm font-extrabold text-[#008069]">{fmtPct(val as number, 1)}</p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-[#8696a0] leading-relaxed">{f.coverageNote}</p>
    </section>
  );
};

export default FunnelBars;
