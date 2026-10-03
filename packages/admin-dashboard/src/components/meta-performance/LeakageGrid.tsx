import React from 'react';
import { MapPin, AlertTriangle, MessageSquareWarning, HeartHandshake, Sparkles } from 'lucide-react';
import { MetaPerformanceReport, fmtNum, fmtRupiah } from './types';

/** Diagnosa kebocoran prospek + preferensi layanan pasien iklan. */
export const LeakageGrid: React.FC<{ report: MetaPerformanceReport }> = ({ report }) => {
  const d = report.leakageDiagnostics;
  const prefs = report.treatmentPreferences;
  return (
    <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className="bg-white border border-[#e9edef] rounded-2xl p-5 shadow-xs space-y-3">
        <h3 className="text-sm font-bold text-[#111b21] flex items-center gap-2">
          <Sparkles size={16} className="text-[#008069]" /> Preferensi Layanan Pasien Iklan
        </h3>
        {prefs.length === 0 ? (
          <p className="text-xs text-[#8696a0] italic">Belum ada pembelian dari kanal iklan pada rentang ini.</p>
        ) : (
          <div className="space-y-2">
            {prefs.map((t, i) => (
              <div key={`${t.category}-${t.name}`} className="flex items-center justify-between gap-2 text-xs border-b border-[#f0f2f5] last:border-0 pb-1.5 last:pb-0">
                <span className="flex items-center gap-2 min-w-0">
                  <span className="w-5 h-5 shrink-0 rounded-lg bg-[#e8f5f2] text-[#008069] text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                  <span className="truncate font-semibold text-[#111b21]" title={t.name}>{t.name}</span>
                </span>
                <span className="shrink-0 font-mono text-[#667781]">{fmtNum(t.orders)}x · {fmtRupiah(t.revenue)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-[#e9edef] rounded-2xl p-5 shadow-xs space-y-4">
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-[#111b21] flex items-center gap-2">
            <MessageSquareWarning size={16} className="text-[#008069]" /> Titik Henti Percakapan
          </h3>
          {d.topDropOffStates.length === 0 ? (
            <p className="text-xs text-[#8696a0] italic">Tidak ada prospek iklan tertahan pada rentang ini.</p>
          ) : (
            <div className="space-y-1.5">
              {d.topDropOffStates.map((s) => (
                <div key={s.state} className="flex items-center justify-between text-xs">
                  <span className="text-[#5b6b73] truncate" title={s.state}>{s.state}</span>
                  <span className="font-mono font-bold text-[#111b21]">{fmtNum(s.count)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-[#f0f2f5] pt-3 space-y-2">
          <h3 className="text-sm font-bold text-[#111b21] flex items-center gap-2">
            <MapPin size={16} className="text-[#008069]" /> Sebaran Wilayah Peminat
          </h3>
          {d.topRegions.length === 0 ? (
            <p className="text-xs text-[#8696a0] italic">Belum ada data wilayah.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {d.topRegions.map((r) => (
                <span key={r.region} className="inline-flex items-center gap-1 rounded-lg bg-[#f0f2f5] px-2 py-1 text-[11px] text-[#111b21]">
                  {r.region} <span className="font-mono font-bold text-[#008069]">{fmtNum(r.count)}</span>
                </span>
              ))}
            </div>
          )}
          {d.outOfCoverageCount > 0 && (
            <p className="inline-flex items-center gap-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
              <AlertTriangle size={12} className="text-amber-600" /> {fmtNum(d.outOfCoverageCount)} prospek iklan di luar jangkauan (out-of-coverage).
            </p>
          )}
        </div>

        <div className="border-t border-[#f0f2f5] pt-3 space-y-1">
          <h3 className="text-sm font-bold text-[#111b21] flex items-center gap-2">
            <HeartHandshake size={16} className="text-[#008069]" /> Pemulihan Follow-Up
          </h3>
          <p className="text-xs text-[#5b6b73]">
            Terkirim: <span className="font-bold text-[#111b21]">{fmtNum(d.followUpRecovery.sent)}</span>
            {Object.entries(d.followUpRecovery.byStatus).map(([st, c]) => (
              <span key={st} className="ml-2 text-[#8696a0]">
                {st}: <span className="font-mono text-[#111b21]">{fmtNum(c)}</span>
              </span>
            ))}
          </p>
        </div>

        {d.mqlDropOff && d.mqlDropOff.mqlTotal > 0 && (
          <div className="border-t border-[#f0f2f5] pt-3 space-y-2">
            <h3 className="text-sm font-bold text-[#111b21] flex items-center gap-2">
              <MessageSquareWarning size={16} className="text-[#008069]" /> Alasan Gagal Closing (MQL)
            </h3>
            <p className="text-[11px] text-[#8696a0]">
              {fmtNum(d.mqlDropOff.dropped)} dari {fmtNum(d.mqlDropOff.mqlTotal)} MQL belum closing. Diklasifikasikan dari state/DB
              (bukan tebakan teks chat).
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {([
                ['Sudah Closing', d.mqlDropOff.converted, 'text-[#008069]'],
                ['Tanpa Reservasi', d.mqlDropOff.noReservation, 'text-[#111b21]'],
                ['Batal', d.mqlDropOff.cancelled, 'text-amber-700'],
                ['Di Luar Area', d.mqlDropOff.outOfCoverage, 'text-rose-600'],
              ] as const).map(([label, val, cls]) => (
                <div key={label} className="flex items-center justify-between rounded-lg border border-[#e9edef] bg-[#f8fafc] px-2.5 py-1.5 text-[11px]">
                  <span className="text-[#5b6b73]">{label}</span>
                  <span className={`font-mono font-bold ${cls}`}>{fmtNum(val)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default LeakageGrid;
