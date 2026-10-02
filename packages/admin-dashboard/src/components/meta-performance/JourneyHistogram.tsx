import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Cell } from 'recharts';
import { Timer } from 'lucide-react';
import { MetaPerformanceReport, fmtNum } from './types';

const COLORS = ['#008069', '#12a58a', '#4cc0a8', '#8dd8c8', '#c2e7e0'];

/** Histogram siklus konversi (journey) + distribusi lead time booking. */
export const JourneyHistogram: React.FC<{ report: MetaPerformanceReport }> = ({ report }) => {
  const journey = report.journeyVelocity.brackets;
  const lead = report.bookingLeadTime;
  return (
    <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className="bg-white border border-[#e9edef] rounded-2xl p-5 shadow-xs space-y-3">
        <h3 className="text-sm font-bold text-[#111b21] flex items-center gap-2">
          <Timer size={16} className="text-[#008069]" /> Distribusi Siklus Konversi
        </h3>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={journey} margin={{ top: 8, right: 8, left: -18, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e9edef" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#667781' }} interval={0} />
              <YAxis tick={{ fontSize: 10, fill: '#667781' }} allowDecimals={false} />
              <Tooltip
                formatter={(v: any) => [`${v} pasien`, 'Jumlah']}
                contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #e9edef' }}
              />
              <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                {journey.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white border border-[#e9edef] rounded-2xl p-5 shadow-xs space-y-3">
        <h3 className="text-sm font-bold text-[#111b21] flex items-center gap-2">
          <Timer size={16} className="text-[#008069]" /> Lead Time Pemesanan
        </h3>
        <div className="space-y-2.5 pt-1">
          {lead.map((b) => (
            <div key={b.key} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#111b21]">{b.label}</span>
                <span className="font-mono text-[#667781]">
                  {fmtNum(b.count)} {b.pct > 0 ? <span className="text-[#8696a0]">({b.pct}%)</span> : null}
                </span>
              </div>
              <div className="h-2 bg-[#f0f2f5] rounded-full overflow-hidden">
                <div className="h-full bg-[#008069] rounded-full" style={{ width: `${Math.min(100, b.pct)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default JourneyHistogram;
