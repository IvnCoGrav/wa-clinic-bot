import React from 'react';
import { Users, Wallet, Repeat, Percent, ShoppingBag, Timer } from 'lucide-react';
import { MetaPerformanceReport, fmtRupiah, fmtNum, fmtPct } from './types';

const Card: React.FC<{
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon: React.ReactNode;
  tone?: 'ok' | 'warn' | 'default';
}> = ({ label, value, sub, icon, tone = 'default' }) => {
  const toneCls = tone === 'ok' ? 'text-[#008069]' : tone === 'warn' ? 'text-amber-700' : 'text-[#111b21]';
  return (
    <div className="bg-white border border-[#e9edef] rounded-2xl p-4 flex flex-col gap-1 shadow-xs">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase font-bold text-[#667781] tracking-wider">{label}</p>
        <span className="text-[#8696a0]">{icon}</span>
      </div>
      <p className={`text-2xl font-extrabold ${toneCls}`}>{value}</p>
      {sub && <p className="text-xs text-[#8696a0] truncate">{sub}</p>}
    </div>
  );
};

/** Grid KPI utama CAC (akuisisi) vs LTV (retensi). */
export const KpiGrid: React.FC<{ report: MetaPerformanceReport }> = ({ report }) => {
  const k = report.kpiSummary;
  const j = report.journeyVelocity;
  return (
    <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      <Card
        label="Pembeli Baru (CAC)"
        value={fmtNum(k.newCustomersAcquired)}
        sub={`${fmtNum(k.repeatCustomersCount)} repeat di periode`}
        icon={<Users size={15} />}
        tone="ok"
      />
      <Card
        label="Omset Akuisisi"
        value={fmtRupiah(k.initialRevenue)}
        sub={`AOV awal ${fmtRupiah(k.initialAov)}`}
        icon={<ShoppingBag size={15} />}
        tone="ok"
      />
      <Card
        label="Omset Repeat (LTV)"
        value={fmtRupiah(k.repeatRevenue)}
        sub={`Omset dari iklan: ${fmtRupiah(k.totalAdRevenue)}`}
        icon={<Repeat size={15} />}
      />
      <Card
        label="Kontribusi Iklan"
        value={fmtPct(k.adRevenueSharePct, 1)}
        sub={`dari total klinik ${fmtRupiah(k.totalClinicRevenue)}`}
        icon={<Percent size={15} />}
      />
      <Card label="Total Omset Klinik" value={fmtRupiah(k.totalClinicRevenue)} sub={`Iklan ${fmtRupiah(k.totalAdRevenue)}`} icon={<Wallet size={15} />} />
      <Card
        label="Journey Konversi"
        value={j.medianDays !== null ? `${j.medianDays} hari` : '-'}
        sub={j.meanDays !== null ? `rata-rata ${j.meanDays.toFixed(1)} hari` : 'belum ada data'}
        icon={<Timer size={15} />}
      />
    </section>
  );
};

export default KpiGrid;
