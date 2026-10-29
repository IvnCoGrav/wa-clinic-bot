import React from 'react';
import { GitCompareArrows, Info, AlertCircle } from 'lucide-react';
import { MetaPerformanceReport, fmtRupiah, fmtNum } from './types';

const CHANNEL_LABEL: Record<string, string> = {
  CTWA_NATIVE: 'Click-to-WhatsApp (Native)',
  CTWA_FUZZY: 'Click-to-WhatsApp (Greeting Fuzzy)',
  PROMO_CTA: 'Landing Page / Promo Code',
};

/** Komparasi head-to-head atribusi bawah funnel: CTWA native vs Promo/CTA. */
export const ChannelTable: React.FC<{ report: MetaPerformanceReport }> = ({ report }) => {
  const rows = report.channelComparison;
  if (!rows || rows.length === 0) return null;
  const ctwaNative = rows.find((r) => r.channel === 'CTWA_NATIVE');
  const ctwaFuzzy = rows.find((r) => r.channel === 'CTWA_FUZZY');
  const hasFuzzyLeads = (ctwaFuzzy?.leads ?? 0) > 0;
  return (
    <section className="bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#202c33] rounded-2xl p-5 shadow-xs space-y-3">
      <h3 className="text-sm font-bold text-[#111b21] dark:text-[#e9edef] flex items-center gap-2">
        <GitCompareArrows size={16} className="text-[#008069]" /> Komparasi Kanal (Bawah Funnel)
        <span title="Berbasis customer: menghitung total kontak/customer unik yang diatribusikan ke iklan." className="text-[#8696a0] cursor-help">
          <Info size={13} />
        </span>
      </h3>
      <p className="text-[11px] text-[#8696a0]">
        LP/PageView tidak dapat diatribusikan ke customer (tidak menyimpan nomor WA), sehingga komparasi ini murni pada kanal yang memiliki jejak AdClick.
      </p>
      {ctwaNative && ctwaNative.leads === 0 && !hasFuzzyLeads && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-800 dark:text-[#f59e0b] bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/40 rounded-lg px-2.5 py-1.5">
          <AlertCircle size={13} className="text-amber-600 mt-0.5 shrink-0" />
          CTWA Native bernilai 0 karena seluruh traffic dikirim ke Landing Page (Promo CTA). Iklan Click-to-WhatsApp Native belum diaktifkan.
        </p>
      )}
      {ctwaNative && ctwaNative.leads === 0 && hasFuzzyLeads && (
        <p className="flex items-start gap-1.5 text-[11px] text-teal-800 dark:text-[#2dd4bf] bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800/40 rounded-lg px-2.5 py-1.5">
          <Info size={13} className="text-teal-600 mt-0.5 shrink-0" />
          Iklan CTWA berjalan dan tertangkap melalui Greeting Catcher (Fuzzy Attribution). Native bernilai 0 karena traffic lewat sapaan.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left uppercase font-bold text-[#667781] dark:text-[#8696a0] border-b border-[#e9edef] dark:border-[#202c33] bg-[#f8fafc] dark:bg-[#182229]">
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
              <tr key={r.channel} className="border-b border-[#e9edef] dark:border-[#202c33] last:border-0 hover:bg-[#f8fafc] dark:hover:bg-[#202c33]">
                <td className="py-2.5 px-3 font-semibold text-[#111b21] dark:text-[#e9edef]">{CHANNEL_LABEL[r.channel] || r.channel}</td>
                <td className="py-2.5 px-3 text-right font-mono">{fmtNum(r.leads)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{fmtNum(r.mql)}</td>
                <td className="py-2.5 px-3 text-right font-mono font-bold text-[#008069]">
                  {fmtNum(r.firstTimeBuyers)}
                  {r.firstTimeBuyers > 0 && r.firstTimeBuyers < 20 && (
                    <span
                      className="ml-1 px-1 py-0.2 rounded text-[9px] font-bold bg-slate-200 text-slate-700 font-sans"
                      title="Sampel kecil (<20 pasien)"
                    >
                      &lt;20
                    </span>
                  )}
                </td>
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
