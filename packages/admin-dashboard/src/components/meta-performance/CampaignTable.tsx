import React, { useMemo, useState } from 'react';
import { Megaphone } from 'lucide-react';
import { Pagination } from '../common/Pagination';
import { MetaPerformanceReport, fmtRupiah, fmtNum } from './types';

const PAGE_SIZE = 10;

/** Breakdown kinerja per kampanye (utmCampaign). */
export const CampaignTable: React.FC<{ report: MetaPerformanceReport }> = ({ report }) => {
  const [page, setPage] = useState(1);
  const rows = report.campaignBreakdown || [];
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const paged = useMemo(() => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [rows, page]);

  if (rows.length === 0) return null;

  return (
    <section className="bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#202c33] rounded-2xl p-5 shadow-xs space-y-3">
      <h3 className="text-sm font-bold text-[#111b21] dark:text-[#e9edef] flex items-center gap-2">
        <Megaphone size={16} className="text-[#008069]" /> Kinerja per Kampanye
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left uppercase font-bold text-[#667781] dark:text-[#8696a0] border-b border-[#e9edef] dark:border-[#202c33] bg-[#f8fafc] dark:bg-[#182229]">
              <th className="py-2.5 px-3">Kampanye / UTM</th>
              <th className="py-2.5 px-3">Sumber</th>
              <th className="py-2.5 px-3 text-right">Klik</th>
              <th className="py-2.5 px-3 text-right">Chat</th>
              <th className="py-2.5 px-3 text-right">MQL</th>
              <th className="py-2.5 px-3 text-right">Pembeli Baru</th>
              <th className="py-2.5 px-3 text-right">Omset Awal</th>
              <th className="py-2.5 px-3 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((r) => (
              <tr key={r.utmCampaign} className="border-b border-[#e9edef] dark:border-[#202c33] last:border-0 hover:bg-[#f8fafc] dark:hover:bg-[#202c33]">
                <td className="py-2.5 px-3 font-semibold text-[#008069] max-w-[220px] truncate" title={r.utmCampaign}>
                  {r.utmCampaign}
                </td>
                <td className="py-2.5 px-3 text-[#667781]">{r.source || '-'}</td>
                <td className="py-2.5 px-3 text-right font-mono">{fmtNum(r.clicks)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{fmtNum(r.chats)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{fmtNum(r.mql)}</td>
                <td className="py-2.5 px-3 text-right font-mono font-bold text-[#008069]">{fmtNum(r.buyers)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{fmtRupiah(r.initialRevenue)}</td>
                <td className="py-2.5 px-3 text-center">
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                      r.status === 'MATCHED'
                        ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                        : 'bg-slate-100 text-slate-700 border-slate-200'
                    }`}
                  >
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} totalItems={rows.length} loadedItems={paged.length} />
    </section>
  );
};

export default CampaignTable;
