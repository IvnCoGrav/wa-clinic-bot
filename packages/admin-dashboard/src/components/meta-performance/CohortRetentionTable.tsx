import React from 'react';
import { Users } from 'lucide-react';
import { MetaPerformanceReport, fmtNum, fmtPct } from './types';

interface CellProps {
  value: number | null;
  size: number;
}

const Cell: React.FC<CellProps> = ({ value, size }) => {
  if (value === null) return <span className="text-[#cbd5e1]">-</span>;
  const pct = size > 0 ? (value / size) * 100 : 0;
  return (
    <span className="font-mono">
      {fmtNum(value)} <span className="text-[#8696a0]">({fmtPct(pct, 0)})</span>
    </span>
  );
};

/** Kohort retensi repeat order pasien iklan: % repeat dalam 30/60/90 hari. */
export const CohortRetentionTable: React.FC<{ report: MetaPerformanceReport }> = ({ report }) => {
  const rows = report.retentionCohorts;
  if (!rows || rows.length === 0) return null;
  return (
    <section className="bg-white border border-[#e9edef] rounded-2xl p-5 shadow-xs space-y-3">
      <h3 className="text-sm font-bold text-[#111b21] flex items-center gap-2">
        <Users size={16} className="text-[#008069]" /> Retensi Repeat Order (Kohort)
      </h3>
      <p className="text-[11px] text-[#8696a0]">
        Kohort = minggu/bulan kunjungan pertama pasien iklan. Sel "-" berarti jendela belum matang (bukan 0 repeat).
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left uppercase font-bold text-[#667781] border-b border-[#e9edef] bg-[#f8fafc]">
              <th className="py-2.5 px-3">Kohort</th>
              <th className="py-2.5 px-3 text-right">Ukuran</th>
              <th className="py-2.5 px-3 text-right">Repeat 30 hr</th>
              <th className="py-2.5 px-3 text-right">Repeat 60 hr</th>
              <th className="py-2.5 px-3 text-right">Repeat 90 hr</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cohort} className="border-b border-[#e9edef] last:border-0 hover:bg-[#f8fafc]">
                <td className="py-2.5 px-3 font-semibold text-[#111b21]">{r.cohort}</td>
                <td className="py-2.5 px-3 text-right font-mono">{fmtNum(r.size)}</td>
                <td className="py-2.5 px-3 text-right"><Cell value={r.returned30} size={r.size} /></td>
                <td className="py-2.5 px-3 text-right"><Cell value={r.returned60} size={r.size} /></td>
                <td className="py-2.5 px-3 text-right"><Cell value={r.returned90} size={r.size} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default CohortRetentionTable;
