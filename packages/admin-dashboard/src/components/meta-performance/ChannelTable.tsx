import React from 'react';
import { GitCompareArrows } from 'lucide-react';
import { MetaPerformanceReport, fmtRupiah, fmtNum } from './types';

const CHANNEL_LABEL: Record<string, string> = {
  CTWA_NATIVE: 'Click-to-WhatsApp (Native)',
  PROMO_CTA: 'Landing Page / Promo Code',
};

/** Komparasi head-to-head atribusi bawah funnel: CTWA native vs Promo/CTA. */
export const ChannelTable: React.FC<{ report: MetaPerformanceReport }> = ({ report }) => {
  const rows = report.channelComparison;
  if (!rows || rows.length === 0) return null;
  return (
    <section className="bg-white border border-[#e9edef] rounded-2xl p-5 shadow-xs space-y-3">
      <h3 className="text-sm font-bold text-[#111b21] flex items-center gap-2">
        <GitCompareArrows size={16} className="text-[#008069]" /> Komparasi Kanal (Bawah Funnel)
      </h3>
      <p className="text-[11px] text-[#8696a0]">
        LP/PageView tidak dapat diatribusikan ke customer (tidak menyimpan nomor WA), sehingga komparasi ini murni pada kanal yang memiliki jejak AdClick.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left uppercase font-bold text-[#667781] border-b border-[#e9edef] bg-[#f8fafc]">
              <th className="py-2.5 px-3">Kanal</th>
              <th className="py-2.5 px-3 text-right">Leads</th>
              <th className="py-2.5 px-3 text-right">MQL</th>
              <th className="py-2.5 px-3 text-right">Pembeli Baru</th>
              <th className="py-2.5 px-3 text-right">Omset Awal</th>
              <th className="py-2.5 px-3 text-right">AOV</th>
              <th className="py-2.5 px-3 text-right">Rata-rata Journey</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.channel} className="border-b border-[#e9edef] last:border-0 hover:bg-[#f8fafc]">
                <td className="py-2.5 px-3 font-semibold text-[#111b21]">{CHANNEL_LABEL[r.channel] || r.channel}</td>
                <td className="py-2.5 px-3 text-right font-mono">{fmtNum(r.leads)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{fmtNum(r.mql)}</td>
                <td className="py-2.5 px-3 text-right font-mono font-bold text-[#008069]">{fmtNum(r.firstTimeBuyers)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{fmtRupiah(r.initialRevenue)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{fmtRupiah(r.aov)}</td>
                <td className="py-2.5 px-3 text-right font-mono">
                  {r.meanJourneyDays !== null ? `${r.meanJourneyDays.toFixed(1)} hr` : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default ChannelTable;
