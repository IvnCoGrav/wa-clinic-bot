import React from 'react';
import { GitCompareArrows, Info, AlertCircle } from 'lucide-react';
import { MetaPerformanceReport, fmtRupiah, fmtNum } from './types';

const CHANNEL_LABEL: Record<string, string> = {
  CTWA_NATIVE: 'Click-to-WhatsApp (Native)',
  PROMO_CTA: 'Landing Page / Promo Code',
};

/** Komparasi head-to-head atribusi bawah funnel: CTWA native vs Promo/CTA. */
export const ChannelTable: React.FC<{ report: MetaPerformanceReport }> = ({ report }) => {
  const rows = report.channelComparison;
  if (!rows || rows.length === 0) return null;
  const ctwa = rows.find((r) => r.channel === 'CTWA_NATIVE');
  return (
    <section className="bg-white border border-[#e9edef] rounded-2xl p-5 shadow-xs space-y-3">
      <h3 className="text-sm font-bold text-[#111b21] flex items-center gap-2">
        <GitCompareArrows size={16} className="text-[#008069]" /> Komparasi Kanal (Bawah Funnel)
        <span title="Berbasis customer: menghitung total kontak/customer unik yang diatribusikan ke iklan." className="text-[#8696a0] cursor-help">
          <Info size={13} />
        </span>
      </h3>
      <p className="text-[11px] text-[#8696a0]">
        LP/PageView tidak dapat diatribusikan ke customer (tidak menyimpan nomor WA), sehingga komparasi ini murni pada kanal yang memiliki jejak AdClick.
      </p>
      {ctwa && ctwa.leads === 0 && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          <AlertCircle size={13} className="text-amber-600 mt-0.5 shrink-0" />
          CTWA Native bernilai 0 karena seluruh traffic dikirim ke Landing Page (Promo CTA). Iklan Click-to-WhatsApp Native belum diaktifkan.
        </p>
      )}
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
                  {r.meanJourneyDays !== null ? `${r.meanJourneyDays.toFixed(1)} hari` : '-'}
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
