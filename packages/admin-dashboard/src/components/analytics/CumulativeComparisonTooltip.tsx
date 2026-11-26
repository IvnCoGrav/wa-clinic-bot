import React from 'react';
import { formatRupiah } from '../../utils/money';
import { type ForecastSummaryDto } from '../../lib/dashboard-metrics';

export interface CumulativeComparisonTooltipProps {
  active?: boolean;
  payload?: any[];
  labels: { current: string; previous: string; baseline: string };
  metricType: 'revenue' | 'bookings';
  baselineAvailable: boolean;
  monthsUsed: number;
  forecastSummary?: ForecastSummaryDto | null;
}

export const CumulativeComparisonTooltip: React.FC<CumulativeComparisonTooltipProps> = ({
  active,
  payload,
  labels,
  metricType,
  baselineAvailable,
  monthsUsed,
  forecastSummary,
}) => {
  if (!active || !payload || !payload.length) return null;

  const item = payload[0]?.payload;
  if (!item) return null;

  const isRevenue = metricType === 'revenue';
  const dayNumber = item.day ?? item.name;
  const dayName = item.dayName ? `${item.dayName}, ` : '';
  const dateStr = item.dateStr ? ` (${item.dateStr})` : '';

  const current = isRevenue ? item.cumulativeRevenue : item.cumulativeBookings;
  const prev = isRevenue ? item.cumulativeLastMonthRevenue : item.cumulativeLastMonthBookings;
  const avg = isRevenue ? item.cumulativeAvgRevenue : item.cumulativeAvgBookings;
  const newVal = isRevenue ? item.cumulativeNewRevenue : item.cumulativeNewBookings;
  const repeatVal = isRevenue ? item.cumulativeRepeatRevenue : item.cumulativeRepeatBookings;
  const forecast = isRevenue ? item.cumulativeForecastRevenue : item.cumulativeForecastBookings;
  const scheduled = isRevenue ? item.scheduledRevenue : 0;

  const formatVal = (v: number | null | undefined): string => {
    if (v == null) return '-';
    return isRevenue ? formatRupiah(v) : `${Math.round(v * 10) / 10} Pasien`;
  };

  const momPct =
    current != null && prev != null && prev > 0
      ? Math.round(((current - prev) / prev) * 100)
      : null;
  const vsAvgPct =
    current != null && avg != null && avg > 0
      ? Math.round(((current - avg) / avg) * 100)
      : null;

  return (
    <div className="bg-surface p-3.5 rounded-2xl shadow-xl border border-divider text-xs space-y-2 min-w-60 max-w-80">
      {/* Header Tanggal & Badges */}
      <div className="border-b border-divider pb-1.5 flex items-center justify-between gap-1.5 flex-wrap">
        <span className="font-bold text-ink">
          {dayName}Tgl {dayNumber}
          <span className="text-[10px] text-ink-3 font-normal">{dateStr}</span>
        </span>
        <div className="flex items-center gap-1">
          {momPct !== null && (
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                momPct >= 0
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                  : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400'
              }`}
              title="Perbandingan terhadap akumulasi tanggal yang sama bulan lalu"
            >
              {momPct >= 0 ? `+${momPct}%` : `${momPct}%`} MoM
            </span>
          )}
          {vsAvgPct !== null && (
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                vsAvgPct >= 0
                  ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                  : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }`}
              title="Perbandingan terhadap rata-rata akumulasi baseline"
            >
              {vsAvgPct >= 0 ? `+${vsAvgPct}%` : `${vsAvgPct}%`} Avg
            </span>
          )}
        </div>
      </div>

      {/* 1. Realisasi atau Proyeksi */}
      {item.isForecast ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between font-semibold">
            <span className="flex items-center gap-1.5 text-accent">
              <span className="w-2 h-0.5 border-t-2 border-dashed border-accent shrink-0" />
              <span>Proyeksi Akumulasi:</span>
            </span>
            <span className="font-bold text-accent">
              {formatVal(forecast)}
            </span>
          </div>

          {scheduled > 0 && (
            <div className="pl-3.5 text-[11px] text-ink-3 flex items-center justify-between">
              <span>Terjadwal hari ini:</span>
              <span className="font-semibold text-info">{formatVal(scheduled)}</span>
            </div>
          )}

          {forecastSummary?.projectedEndRevenue != null && (
            <div className="pl-3.5 pt-1 text-[11px] text-ink-3 border-t border-divider/60 flex items-center justify-between">
              <span className="font-medium text-ink-2">Estimasi Tutup Bulan:</span>
              <span className="font-bold text-accent">
                {formatVal(isRevenue ? forecastSummary.projectedEndRevenue : forecastSummary.projectedEndBookings)}
              </span>
            </div>
          )}
        </div>
      ) : item.hasHappened ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-ink font-semibold">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
              <span>{labels.current} (Akumulasi):</span>
            </span>
            <span className="font-bold text-accent">
              {formatVal(current)}
            </span>
          </div>

          {/* Breakdown Pasien Baru vs Repeat */}
          {newVal != null && repeatVal != null && (newVal > 0 || repeatVal > 0) && (
            <div className="pl-3.5 space-y-0.5 text-[11px] text-ink-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-info shrink-0" />
                  <span>Pasien Baru:</span>
                </span>
                <span className="font-medium text-info">{formatVal(newVal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                  <span>Reservasi Repeat:</span>
                </span>
                <span className="font-medium text-accent">{formatVal(repeatVal)}</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-ink-3 italic text-[11px]">Belum ada transaksi realisasi</div>
      )}

      {/* 2. Komparasi Bulan Lalu (M-1) */}
      <div className="pt-1.5 border-t border-divider space-y-0.5">
        <div className="flex items-center justify-between text-ink-2">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-0.5 border-t-2 border-dashed border-info shrink-0" />
            <span>{labels.previous} (Akumulasi):</span>
          </span>
          <span className="font-semibold text-info">
            {formatVal(prev)}
          </span>
        </div>
      </div>

      {/* 3. Baseline Rata-rata */}
      <div className="pt-1.5 border-t border-divider space-y-0.5">
        <div className="flex items-center justify-between text-ink-2">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-1 rounded-xs bg-warning shrink-0" />
            <span>{labels.baseline}:</span>
          </span>
          <span className="font-semibold text-warning">
            {baselineAvailable && avg != null ? formatVal(avg) : 'Data belum cukup'}
          </span>
        </div>
        {baselineAvailable && monthsUsed > 0 && (
          <div className="pl-3.5 text-[10px] text-ink-3">
            Basis {monthsUsed} bulan historis
          </div>
        )}
      </div>
    </div>
  );
};
