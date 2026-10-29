import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Cell } from 'recharts';
import { Timer, Info } from 'lucide-react';
import { MetaPerformanceReport, fmtNum } from './types';

const COLORS = ['rgb(var(--c-accent))', 'rgb(var(--c-accent) / 0.8)', 'rgb(var(--c-accent) / 0.6)', 'rgb(var(--c-accent) / 0.4)', 'rgb(var(--c-accent) / 0.2)'];

/** Histogram siklus konversi (journey) + distribusi lead time booking. */
export const JourneyHistogram: React.FC<{ report: MetaPerformanceReport }> = ({ report }) => {
  const journey = report.journeyVelocity.brackets;
  const lead = report.bookingLeadTime;
  return (
    <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className="bg-surface border border-divider rounded-2xl p-5 shadow-xs space-y-3">
        <h3 className="text-sm font-bold text-ink flex items-center gap-2">
          <Timer size={16} className="text-accent" /> Distribusi Siklus Konversi
        </h3>
        <p className="text-[11px] text-ink-3">Jarak hari dari touch iklan (klik teratribusi) hingga reservasi pertama pasien.</p>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={journey} margin={{ top: 8, right: 8, left: -18, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--c-divider))" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'rgb(var(--c-ink-2))' }} interval={0} />
              <YAxis tick={{ fontSize: 10, fill: 'rgb(var(--c-ink-2))' }} allowDecimals={false} />
              <Tooltip
                formatter={(v: any) => [`${v} pasien`, 'Jumlah']}
                contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid rgb(var(--c-divider))', backgroundColor: 'rgb(var(--c-surface-2))', color: 'rgb(var(--c-ink))' }}
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

      <div className="bg-surface border border-divider rounded-2xl p-5 shadow-xs space-y-3">
        <h3 className="text-sm font-bold text-ink flex items-center gap-2">
          <Timer size={16} className="text-accent" /> Lead Time Pemesanan
          <span title="Berbasis order: menghitung total janji temu fisik yang dipesan pada rentang ini." className="text-ink-3 cursor-help">
            <Info size={13} />
          </span>
        </h3>
        <div className="space-y-2.5 pt-1">
          {lead.map((b) => (
            <div key={b.key} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-ink">{b.label}</span>
                <span className="font-mono text-ink-2">
                  {fmtNum(b.count)} {b.pct > 0 ? <span className="text-ink-3">({b.pct}%)</span> : null}
                </span>
              </div>
              <div className="h-2 bg-fill-1 rounded-full overflow-hidden">
                <div className="h-full bg-accent rounded-full" style={{ width: `${Math.min(100, b.pct)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default JourneyHistogram;
