import React from 'react';
import { Activity, Info } from 'lucide-react';
import { MetaPerformanceReport, fmtNum, fmtPct } from './types';

const BAND: Record<string, { label: string; cls: string }> = {
  AMAN: { label: 'Aman untuk scale iklan', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  OPTIMAL: { label: 'Optimal — pertahankan budget', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  PENUH: { label: 'Penuh — tambah terapis sebelum scale', cls: 'bg-rose-100 text-rose-800 border-rose-200' },
  UNKNOWN: { label: 'Data kapasitas belum tersedia', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
};

/**
 * Kapasitas & utilisasi terapis homecare. Jumlah terapis = Staff aktif (DB),
 * kapasitas periode = terapis x jumlah hari. Ambang pita 65/85 bersifat
 * provisional (kalibrasi ADR), bukan data bisnis tersimpan.
 */
export const TherapistUtilizationCard: React.FC<{ report: MetaPerformanceReport }> = ({ report }) => {
  const cap = report.therapistCapacity;
  if (!cap) return null;
  const band = BAND[cap.band] || BAND.UNKNOWN;
  return (
    <section className="bg-white border border-[#e9edef] rounded-2xl p-5 shadow-xs space-y-3">
      <h3 className="text-sm font-bold text-[#111b21] flex items-center gap-2">
        <Activity size={16} className="text-[#008069]" /> Kapasitas & Utilisasi Terapis
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <div className="rounded-xl border border-[#e9edef] bg-[#f8fafc] px-3 py-2">
          <p className="text-[10px] uppercase font-bold text-[#8696a0]">Terapis Aktif</p>
          <p className="text-sm font-extrabold text-[#111b21]">{fmtNum(cap.activeTherapists)}</p>
        </div>
        <div className="rounded-xl border border-[#e9edef] bg-[#f8fafc] px-3 py-2">
          <p className="text-[10px] uppercase font-bold text-[#8696a0]">Booking Periode</p>
          <p className="text-sm font-extrabold text-[#111b21]">{fmtNum(cap.bookingCount)}</p>
        </div>
        <div className="rounded-xl border border-[#e9edef] bg-[#f8fafc] px-3 py-2">
          <p className="text-[10px] uppercase font-bold text-[#8696a0]">Utilisasi</p>
          <p className="text-sm font-extrabold text-[#111b21]">
            {cap.utilizationPct !== null ? fmtPct(cap.utilizationPct, 1) : '-'}
          </p>
        </div>
      </div>
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${band.cls}`}>
        <span className="w-2 h-2 rounded-full bg-current" /> {band.label}
      </span>
      <p className="text-[11px] text-[#8696a0] flex items-start gap-1">
        <Info size={12} className="mt-0.5 shrink-0" />
        Kapasitas = terapis aktif x jumlah hari periode. Pita utilisasi (65% / 85%) masih provisional.
      </p>
    </section>
  );
};

export default TherapistUtilizationCard;
