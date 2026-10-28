import React, { useState } from 'react';
import {
  Users,
  Target,
  DollarSign,
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  Sparkles,
  Info,
} from 'lucide-react';
import {
  MetaPerformanceReport,
  UnifiedMonthlyCohortRow,
  CohortMonthlyPeriodMetric,
  CohortChannel,
  fmtRupiah,
  fmtNum,
} from './types';

interface CohortRetentionTableProps {
  report: MetaPerformanceReport;
}

export const CohortRetentionTable: React.FC<CohortRetentionTableProps> = ({ report }) => {
  const [selectedChannel, setSelectedChannel] = useState<CohortChannel>('ALL');
  const [viewMode, setViewMode] = useState<'MONTHLY' | 'ROLLING_90'>('MONTHLY');
  const [marginInput, setMarginInput] = useState<number>(() => {
    return report.cohortPlanning?.grossMarginPct ?? 40;
  });

  const planning = report.cohortPlanning;
  const matureLtv = planning?.matureLtv60Days ?? null;
  const matureSample = planning?.matureSamplePatients ?? 0;
  const hasEnoughData = planning?.hasEnoughData ?? false;

  // Max CAC dinamis berdasarkan slider/input margin
  const calculatedMaxCac =
    matureLtv !== null ? Math.round(matureLtv * (marginInput / 100)) : null;

  // Pilih dataset sesuai viewMode
  const sourceRows: UnifiedMonthlyCohortRow[] =
    viewMode === 'ROLLING_90'
      ? report.rolling3MonthCohorts || []
      : report.monthlyCohorts || [];

  // Filter baris sesuai channel pill
  const filteredRows = sourceRows.filter((r) => r.channel === selectedChannel);

  const channelBadge = (ch: CohortChannel) => {
    switch (ch) {
      case 'LPWA':
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
            LPWA
          </span>
        );
      case 'CTWA':
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
            CTWA
          </span>
        );
      case 'ORGANIC':
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            Organik
          </span>
        );
      case 'ALL':
      default:
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
            Semua
          </span>
        );
    }
  };

  const paybackBadge = (r: UnifiedMonthlyCohortRow) => {
    if (r.paybackStatus === 'TIDAK_BERLAKU') {
      return <span className="text-[#94a3b8]">-</span>;
    }
    if (r.paybackStatus === 'BELUM_DIISI') {
      return (
        <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 text-slate-500 italic">
          Belum Diisi
        </span>
      );
    }
    if (r.paybackStatus === 'BALIK_MODAL') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
          <CheckCircle2 size={11} className="text-emerald-700" /> Balik Modal
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-300">
        <Clock size={11} className="text-amber-700" /> Belum Balik
      </span>
    );
  };

  const renderRepeatCell = (metric: CohortMonthlyPeriodMetric | null | undefined) => {
    if (!metric) return <span className="text-[#cbd5e1]">-</span>;
    return (
      <div>
        <p className="font-semibold text-[#111b21]">
          {fmtNum(metric.count)}{' '}
          <span className="text-[#64748b] font-normal">
            ({metric.pct.toFixed(0)}%)
          </span>
        </p>
        <p className="text-[10px] text-[#64748b]">
          {fmtRupiah(metric.revenue)}
        </p>
        {metric.status === 'ONGOING' && (
          <span className="text-[9px] text-amber-600 font-sans font-medium">
            (berjalan)
          </span>
        )}
      </div>
    );
  };

  return (
    <section className="bg-white border border-[#e9edef] rounded-2xl p-5 shadow-xs space-y-5">
      {/* ── Header Judul ────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-[#111b21] flex items-center gap-2">
            <Users size={16} className="text-[#008069]" /> Retensi Repeat Order &amp; Performa Unit Economics (Kohort)
          </h3>
          <p className="text-[11px] text-[#8696a0] mt-0.5">
            Kohort berbasis tanggal kunjungan riil (<code className="text-[#54656f]">booking_date</code>). Omzet hanya menghitung biaya perawatan yang telah selesai (<code className="text-[#54656f]">completed</code>), ongkir dipisahkan.
          </p>
        </div>

        {/* Toggle Tampilan Waktu */}
        <div className="flex items-center bg-[#f0f2f5] p-1 rounded-xl text-xs font-semibold self-start sm:self-auto">
          <button
            onClick={() => setViewMode('MONTHLY')}
            className={`px-3 py-1.5 rounded-lg transition ${
              viewMode === 'MONTHLY'
                ? 'bg-white text-[#111b21] shadow-xs'
                : 'text-[#667781] hover:text-[#111b21]'
            }`}
          >
            Bulanan
          </button>
          <button
            onClick={() => setViewMode('ROLLING_90')}
            className={`px-3 py-1.5 rounded-lg transition ${
              viewMode === 'ROLLING_90'
                ? 'bg-white text-[#111b21] shadow-xs'
                : 'text-[#667781] hover:text-[#111b21]'
            }`}
          >
            Rolling 90 Hari (3 Bln)
          </button>
        </div>
      </div>

      {/* ── Kartu Perencanaan Forward-Looking (Planning Cards) ─────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4 bg-gradient-to-br from-[#f8fafc] to-[#f1f5f9] border border-[#e2e8f0] rounded-2xl">
        {/* Card 1: LTV 60 Hari Matang (Pasien Iklan) */}
        <div className="bg-white border border-[#e2e8f0] rounded-xl p-3.5 space-y-1.5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase font-bold text-[#64748b] tracking-wider flex items-center gap-1.5">
              <Sparkles size={13} className="text-[#008069]" /> LTV 60-Hari (Iklan)
            </span>
            {hasEnoughData ? (
              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                Data Matang
              </span>
            ) : (
              <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                Sampel Terbatas
              </span>
            )}
          </div>
          <p className="text-xl font-extrabold text-[#0f172a]">
            {fmtRupiah(matureLtv)}
          </p>
          <p className="text-[10px] text-[#64748b]">
            Rata-rata omzet murni dari {matureSample} pasien iklan kohort matang (&ge;60 hari). Pasien organik tidak dicampur.
          </p>
        </div>

        {/* Card 2: Pengaturan Margin Kotor */}
        <div className="bg-white border border-[#e2e8f0] rounded-xl p-3.5 space-y-1.5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase font-bold text-[#64748b] tracking-wider flex items-center gap-1.5">
              <DollarSign size={13} className="text-[#0284c7]" /> Margin Kotor Klinik
            </span>
            <span className="text-xs font-mono font-bold text-[#0f172a]">
              {marginInput}%
            </span>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <input
              type="range"
              min={10}
              max={90}
              step={5}
              value={marginInput}
              onChange={(e) => setMarginInput(Number(e.target.value))}
              className="w-full accent-[#008069] cursor-pointer"
            />
          </div>
          <p className="text-[10px] text-[#64748b]">
            Margin setelah honor terapis, transport, dan bahan perawatan (bisa disesuaikan).
          </p>
        </div>

        {/* Card 3: Batas Maksimal CAC Aman */}
        <div className="bg-white border border-[#e2e8f0] rounded-xl p-3.5 space-y-1.5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase font-bold text-[#64748b] tracking-wider flex items-center gap-1.5">
              <Target size={13} className="text-[#10b981]" /> Max Allowable CAC
            </span>
            <span
              className="text-[#94a3b8] cursor-help"
              title="Batas maksimal biaya iklan per pasien baru agar klinik tidak rugi (LTV 60hr × % Margin)."
            >
              <Info size={12} />
            </span>
          </div>
          <p className={`text-xl font-extrabold ${calculatedMaxCac ? 'text-[#008069]' : 'text-[#64748b]'}`}>
            {fmtRupiah(calculatedMaxCac)}
          </p>
          <p className="text-[10px] text-[#64748b]">
            Batas maksimal biaya akuisisi per pasien baru dari iklan agar klinik tetap profit.
          </p>
        </div>
      </div>

      {/* ── Filter Pills Kanal ──────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[#e9edef] pb-3">
        <span className="text-xs font-semibold text-[#667781] mr-1">Filter Kanal:</span>
        {(['ALL', 'LPWA', 'CTWA', 'ORGANIC'] as CohortChannel[]).map((ch) => {
          const labels: Record<CohortChannel, string> = {
            ALL: 'Semua Pasien',
            LPWA: 'LPWA (Landing Page)',
            CTWA: 'CTWA (Click to WA)',
            ORGANIC: 'Organik',
          };
          const isActive = selectedChannel === ch;
          return (
            <button
              key={ch}
              onClick={() => setSelectedChannel(ch)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
                isActive
                  ? 'bg-[#008069] text-white shadow-xs'
                  : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e2e8f0]'
              }`}
            >
              {labels[ch]}
            </button>
          );
        })}
      </div>

      {/* ── Tabel Kohort ────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[980px]">
          <thead>
            <tr className="text-left uppercase font-bold text-[#667781] border-b border-[#e9edef] bg-[#f8fafc]">
              <th className="py-2.5 px-3">Kohort</th>
              <th className="py-2.5 px-3">Kanal</th>
              <th className="py-2.5 px-3 text-right">Pasien Baru</th>
              <th className="py-2.5 px-3 text-right">Biaya Iklan</th>
              <th className="py-2.5 px-3 text-right">Real CAC</th>
              <th className="py-2.5 px-3 text-right">Kunjungan #1</th>
              <th className="py-2.5 px-3 text-right">Repeat M+1</th>
              <th className="py-2.5 px-3 text-right">Repeat M+2</th>
              <th className="py-2.5 px-3 text-right">Repeat M+3</th>
              <th className="py-2.5 px-3 text-right">Repeat M+4</th>
              <th className="py-2.5 px-3 text-right">Repeat M+5</th>
              <th className="py-2.5 px-3 text-right">Total Omzet</th>
              <th className="py-2.5 px-3 text-right">Nilai/Pasien</th>
              <th className="py-2.5 px-3 text-right">ROAS</th>
              <th className="py-2.5 px-3 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={15} className="text-center py-6 text-slate-400 italic">
                  Tidak ada data kohort untuk kanal ini pada periode yang dipilih.
                </td>
              </tr>
            ) : (
              filteredRows.map((r, idx) => {
                const isEven = idx % 2 === 0;
                return (
                  <tr
                    key={`${r.cohortMonth}-${r.channel}`}
                    className={`border-b border-[#e9edef] hover:bg-slate-50 transition ${
                      isEven ? 'bg-white' : 'bg-[#fafafa]'
                    }`}
                  >
                    {/* Kohort */}
                    <td className="py-2.5 px-3 font-semibold text-[#111b21] whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <Calendar size={13} className="text-[#008069] shrink-0" />
                        <span>{r.cohortMonth}</span>
                        {r.isOngoing && (
                          <span
                            className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800 whitespace-nowrap"
                            title="Bulan ini masih berjalan, data repeat masih akan bertambah."
                          >
                            Berjalan
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Kanal */}
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {channelBadge(r.channel)}
                    </td>

                    {/* Pasien Baru */}
                    <td className="py-2.5 px-3 text-right font-mono">
                      <span className="font-bold text-[#111b21]">{fmtNum(r.cohortSize)}</span>
                      {r.isSmallSample && r.cohortSize > 0 && (
                        <span
                          className="ml-1 px-1 py-0.2 rounded text-[9px] font-bold bg-slate-200 text-slate-700"
                          title="Sampel kecil (<20 pasien), persentase retensi rentan fluktuasi."
                        >
                          &lt;20
                        </span>
                      )}
                    </td>

                    {/* Biaya Iklan */}
                    <td className="py-2.5 px-3 text-right font-mono text-[#54656f] whitespace-nowrap">
                      {r.channel === 'ORGANIC' ? (
                        <span className="text-[#cbd5e1]">-</span>
                      ) : r.adSpend !== null && r.adSpend > 0 ? (
                        fmtRupiah(r.adSpend)
                      ) : (
                        <span className="text-slate-400 italic text-[11px]">Belum diisi</span>
                      )}
                    </td>

                    {/* Real CAC */}
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-[#111b21] whitespace-nowrap">
                      {r.channel === 'ORGANIC' || r.channel === 'ALL' ? (
                        <span className="text-[#cbd5e1]">-</span>
                      ) : (
                        fmtRupiah(r.cac)
                      )}
                    </td>

                    {/* Kunjungan #1 */}
                    <td className="py-2.5 px-3 text-right font-mono whitespace-nowrap">
                      <p className="font-semibold text-[#111b21]">{fmtRupiah(r.initialRevenue)}</p>
                      {r.initialUpcomingOrders > 0 && (
                        <p className="text-[10px] text-amber-700 font-sans">
                          +{r.initialUpcomingOrders} terjadwal
                        </p>
                      )}
                    </td>

                    {/* Repeat M+1 */}
                    <td className="py-2.5 px-3 text-right font-mono whitespace-nowrap">
                      {renderRepeatCell(r.repeatM1)}
                    </td>

                    {/* Repeat M+2 */}
                    <td className="py-2.5 px-3 text-right font-mono whitespace-nowrap">
                      {renderRepeatCell(r.repeatM2)}
                    </td>

                    {/* Repeat M+3 */}
                    <td className="py-2.5 px-3 text-right font-mono whitespace-nowrap">
                      {renderRepeatCell(r.repeatM3)}
                    </td>

                    {/* Repeat M+4 */}
                    <td className="py-2.5 px-3 text-right font-mono whitespace-nowrap">
                      {renderRepeatCell(r.repeatM4)}
                    </td>

                    {/* Repeat M+5 */}
                    <td className="py-2.5 px-3 text-right font-mono whitespace-nowrap">
                      {renderRepeatCell(r.repeatM5)}
                    </td>

                    {/* Total Realized Revenue */}
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-[#008069] whitespace-nowrap">
                      {fmtRupiah(r.totalRealizedRevenue)}
                    </td>

                    {/* Nilai / Pasien */}
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-[#111b21] whitespace-nowrap">
                      {fmtRupiah(r.revenuePerPatient)}
                    </td>

                    {/* Kumulatif ROAS */}
                    <td className="py-2.5 px-3 text-right font-mono font-bold whitespace-nowrap">
                      {r.channel === 'ORGANIC' || r.channel === 'ALL' ? (
                        <span className="text-[#cbd5e1]" title="ROAS tidak ditampilkan di baris organik/campuran agar tidak bias.">-</span>
                      ) : r.roas !== null ? (
                        <span className={r.roas >= 1.0 ? 'text-emerald-700' : 'text-amber-700'}>
                          {r.roas.toFixed(2)}x
                        </span>
                      ) : (
                        <span className="text-[#cbd5e1]">-</span>
                      )}
                    </td>

                    {/* Status Balik Modal */}
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      {paybackBadge(r)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Catatan Kaki Metodologi ─────────────────────────────── */}
      <div className="text-[11px] text-[#8696a0] bg-[#f8fafc] border border-[#e9edef] rounded-xl p-3 space-y-1">
        <p className="flex items-center gap-1.5 font-semibold text-[#54656f]">
          <AlertCircle size={13} className="text-[#008069]" /> Catatan Analisis Kohort:
        </p>
        <ul className="list-disc list-inside space-y-0.5 text-[10.5px]">
          <li><strong>Pemisahan Ongkir</strong>: Seluruh omzet di atas murni biaya perawatan (<em>treatment fee</em>). Biaya transportasi terapis tidak dihitung sebagai omzet klinik.</li>
          <li><strong>ROAS Murni Iklan</strong>: ROAS hanya ditampilkan pada kanal iklan (LPWA dan CTWA). Baris "Semua Pasien" dan "Organik" tidak menampilkan ROAS untuk mencegah distorsi omzet organik ke belanja iklan.</li>
          <li><strong>Pasien Organik</strong>: Pasien tanpa parameter pelacak iklan dikelompokkan ke kanal Organik. Sebagian pasien iklan yang mengganti perangkat dapat masuk ke Organik.</li>
          <li><strong>Bulan Berjalan</strong>: Kohort atau jendela repeat yang berstatus <em>Berjalan</em> belum final karena pasien masih dapat melakukan reservasi hingga akhir bulan.</li>
        </ul>
      </div>
    </section>
  );
};

export default CohortRetentionTable;
