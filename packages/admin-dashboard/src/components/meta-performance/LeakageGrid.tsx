import React from 'react';
import { MapPin, AlertTriangle, MessageSquareWarning, HeartHandshake } from 'lucide-react';
import { MetaPerformanceReport, fmtNum, fmtRupiah } from './types';

/** Diagnosa kebocoran prospek + preferensi layanan pasien iklan. */
export const LeakageGrid: React.FC<{ report: MetaPerformanceReport }> = ({ report }) => {
  const d = report.leakageDiagnostics;
  const prefs = report.treatmentPreferences;
  return (
    <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className="bg-surface border border-divider rounded-2xl p-5 shadow-xs space-y-3">
        <h3 className="text-sm font-bold text-ink flex items-center gap-2">
          <HeartHandshake size={16} className="text-accent" /> Preferensi Layanan Pasien Iklan
        </h3>
        {prefs.length === 0 ? (
          <p className="text-xs text-ink-3 italic">Belum ada pembelian dari kanal iklan pada rentang ini.</p>
        ) : (
          <div className="space-y-2">
            {prefs.map((t, i) => (
              <div key={`${t.category}-${t.name}`} className="flex items-center justify-between gap-2 text-xs border-b border-divider last:border-0 pb-1.5 last:pb-0">
                <span className="flex items-center gap-2 min-w-0">
                  <span className="w-5 h-5 shrink-0 rounded-lg bg-accent-soft text-accent text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                  <span className="truncate font-semibold text-ink" title={t.name}>{t.name}</span>
                </span>
                <span className="shrink-0 font-mono text-ink-2">{fmtNum(t.orders)}x · {fmtRupiah(t.revenue)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-surface border border-divider rounded-2xl p-5 shadow-xs space-y-4">
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-ink flex items-center gap-2">
            <MessageSquareWarning size={16} className="text-accent" /> Titik Henti Percakapan
          </h3>
          {d.topDropOffStates.length === 0 ? (
            <p className="text-xs text-ink-3 italic">Tidak ada prospek iklan tertahan pada rentang ini.</p>
          ) : (
            <div className="space-y-1.5">
              {d.topDropOffStates.map((s) => (
                <div key={s.state} className="flex items-center justify-between text-xs">
                  <span className="text-ink-2 truncate" title={s.state}>{s.state}</span>
                  <span className="font-mono font-bold text-ink">{fmtNum(s.count)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-divider pt-3 space-y-2">
          <h3 className="text-sm font-bold text-ink flex items-center gap-2">
            <MapPin size={16} className="text-accent" /> Sebaran Wilayah Peminat
          </h3>
          {d.topRegions.length === 0 ? (
            <p className="text-xs text-ink-3">Belum ada deteksi wilayah. Sistem mencatat wilayah saat pasien menyebutkan lokasi kecamatan/kelurahan di chat WhatsApp.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {d.topRegions.map((r) => (
                <span key={r.region} className="inline-flex items-center gap-1 rounded-lg bg-fill-1 px-2 py-1 text-[11px] text-ink">
                  {r.region} <span className="font-mono font-bold text-accent">{fmtNum(r.count)}</span>
                </span>
              ))}
            </div>
          )}
          {d.outOfCoverageCount > 0 && (
            <p className="inline-flex items-center gap-1.5 text-[11px] text-amber-800 dark:text-warning bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded-lg px-2 py-1">
              <AlertTriangle size={12} className="text-warning" /> {fmtNum(d.outOfCoverageCount)} prospek iklan di luar jangkauan (out-of-coverage).
            </p>
          )}
        </div>

        <div className="border-t border-divider pt-3 space-y-1">
          <h3 className="text-sm font-bold text-ink flex items-center gap-2">
            <HeartHandshake size={16} className="text-accent" /> Pemulihan Follow-Up
          </h3>
          <p className="text-xs text-ink-2">
            Terkirim: <span className="font-bold text-ink">{fmtNum(d.followUpRecovery.sent)}</span>
            {Object.entries(d.followUpRecovery.byStatus).map(([st, c]) => (
              <span key={st} className="ml-2 text-ink-3">
                {st}: <span className="font-mono text-ink">{fmtNum(c)}</span>
              </span>
            ))}
          </p>
        </div>

        {d.mqlDropOff && d.mqlDropOff.mqlTotal > 0 && (
          <div className="border-t border-divider pt-3 space-y-2">
            <h3 className="text-sm font-bold text-ink flex items-center gap-2">
              <MessageSquareWarning size={16} className="text-accent" /> Alasan Gagal Closing (MQL)
            </h3>
            <p className="text-[11px] text-ink-3">
              {fmtNum(d.mqlDropOff.dropped)} dari {fmtNum(d.mqlDropOff.mqlTotal)} MQL belum closing. Diklasifikasikan dari state/DB
              (bukan tebakan teks chat).
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {([
                [
                  'Sudah Closing',
                  d.mqlDropOff.converted,
                  'text-accent',
                  d.mqlDropOff.convertedFirstTime !== undefined
                    ? `${fmtNum(d.mqlDropOff.convertedFirstTime)} Baru · ${fmtNum(d.mqlDropOff.convertedRepeat ?? 0)} Repeat`
                    : undefined,
                ],
                ['Tanpa Reservasi', d.mqlDropOff.noReservation, 'text-ink', undefined],
                ['Batal', d.mqlDropOff.cancelled, 'text-warning', undefined],
                ['Di Luar Area', d.mqlDropOff.outOfCoverage, 'text-danger', undefined],
              ] as const).map(([label, val, cls, sub]) => (
                <div key={label} className="flex flex-col justify-between rounded-lg border border-divider bg-surface-2 px-2.5 py-1.5 text-[11px]">
                  <div className="flex items-center justify-between w-full">
                    <span className="text-ink-2">{label}</span>
                    <span className={`font-mono font-bold ${cls}`}>{fmtNum(val)}</span>
                  </div>
                  {sub && <span className="text-[10px] text-ink-2 mt-0.5">{sub}</span>}
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
