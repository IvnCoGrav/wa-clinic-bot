import React from 'react';
import { Activity, Info } from 'lucide-react';
import { MetaPerformanceReport, fmtNum, fmtPct } from './types';

const BAND: Record<string, { label: string; cls: string }> = {
  AMAN: { label: 'Aman untuk scale iklan', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800' },
  OPTIMAL: { label: 'Optimal — pertahankan budget', cls: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800' },
  PENUH: { label: 'Penuh — tambah terapis sebelum scale', cls: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800' },
  UNKNOWN: { label: 'Data kapasitas belum tersedia', cls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700' },
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
    <section className="bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#202c33] rounded-2xl p-5 shadow-xs space-y-3">
      <h3 className="text-sm font-bold text-[#111b21] dark:text-[#e9edef] flex items-center gap-2">
        <Activity size={16} className="text-[#008069]" /> Kapasitas & Utilisasi Terapis
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="rounded-xl border border-[#e9edef] dark:border-[#202c33] bg-[#f8fafc] dark:bg-[#182229] px-3 py-2">
          <p className="text-[10px] uppercase font-bold text-[#8696a0]">Terapis Aktif</p>
          <p className="text-sm font-extrabold text-[#111b21] dark:text-[#e9edef]">{fmtNum(cap.activeTherapists)} orang</p>
        </div>
        <div className="rounded-xl border border-[#e9edef] dark:border-[#202c33] bg-[#f8fafc] dark:bg-[#182229] px-3 py-2">
          <p className="text-[10px] uppercase font-bold text-[#8696a0]">Kapasitas Slot</p>
          <p className="text-sm font-extrabold text-[#111b21] dark:text-[#e9edef]">
            {fmtNum(cap.totalSlotsCapacity)} <span className="text-[10px] font-normal text-[#64748b] dark:text-[#8696a0]">slot</span>
          </p>
          <p className="text-[9px] text-[#8696a0]">@{cap.dailySlotsPerTherapist || 4} slot/terapis/hari</p>
        </div>
        <div className="rounded-xl border border-[#e9edef] dark:border-[#202c33] bg-[#f8fafc] dark:bg-[#182229] px-3 py-2">
          <p className="text-[10px] uppercase font-bold text-[#8696a0]">Booking Periode</p>
          <p className="text-sm font-extrabold text-[#111b21] dark:text-[#e9edef]">{fmtNum(cap.bookingCount)}</p>
        </div>
        <div className="rounded-xl border border-[#e9edef] dark:border-[#202c33] bg-[#f8fafc] dark:bg-[#182229] px-3 py-2">
          <p className="text-[10px] uppercase font-bold text-[#8696a0]">Utilisasi Slot</p>
          <p className="text-sm font-extrabold text-[#111b21] dark:text-[#e9edef]">
            {cap.utilizationPct !== null ? fmtPct(cap.utilizationPct, 1) : '-'}
          </p>
        </div>
      </div>
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${band.cls}`}>
        <span className="w-2 h-2 rounded-full bg-current" /> {band.label}
      </span>
      <p className="text-[11px] text-[#8696a0] flex items-start gap-1">
        <Info size={12} className="mt-0.5 shrink-0" />
        Kapasitas dihitung berbasis slot riil: {cap.activeTherapists} terapis aktif &times; {cap.dailySlotsPerTherapist || 4} slot per hari &times; jumlah hari periode.
      </p>
    </section>
  );
};

export default TherapistUtilizationCard;
