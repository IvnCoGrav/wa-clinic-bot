import React from 'react';
import { formatRupiah } from '../../utils/money';

export interface DailyComparisonTooltipLabels {
  current: string;
  previous: string;
  baseline: string;
}

export interface DailyComparisonTooltipProps {
  active?: boolean;
  payload?: any[];
  labels: DailyComparisonTooltipLabels;
  baselineAvailable?: boolean;
  showBookings?: boolean;
}

export const DailyComparisonTooltip: React.FC<DailyComparisonTooltipProps> = ({
  active,
  payload,
  labels,
  baselineAvailable = true,
  showBookings = true,
}) => {
  if (!active || !payload || !payload.length) return null;

  const item = payload[0]?.payload;
  if (!item) return null;

  const dayNumber = item.day ?? item.name;
  const dayName = item.dayName ? `${item.dayName}, ` : '';
  const dateStr = item.dateStr ? ` (${item.dateStr})` : '';

  const currentRevenue = item.revenue !== undefined && item.revenue !== null ? Number(item.revenue) : null;
  const lunasRevenue = Number(item.lunasRevenue ?? 0);
  const pendingRevenue = Number(item.pendingRevenue ?? 0);
  const currentBookings = item.bookings !== undefined ? Number(item.bookings) : Number(item.bookingsCount ?? 0);

  const prevRevenue = item.lastMonthRevenue !== undefined && item.lastMonthRevenue !== null
    ? Number(item.lastMonthRevenue)
    : null;
  const prevBookings = item.lastMonthBookings !== undefined && item.lastMonthBookings !== null
    ? Number(item.lastMonthBookings)
    : null;

  const avgRevenue = item.avg6mRevenue !== undefined && item.avg6mRevenue !== null
    ? Number(item.avg6mRevenue)
    : null;
  const avgBookings = item.avg6mBookings !== undefined && item.avg6mBookings !== null
    ? Number(item.avg6mBookings)
    : null;
  const samples = Number.isFinite(item.baselineSamples) ? Number(item.baselineSamples) : 0;

  // Hitung deviasi terhadap baseline 6 bulan (A-018: baseline null atau 0 -> jangan tampilkan persen)
  const deviation =
    currentRevenue !== null && avgRevenue !== null && avgRevenue > 0
      ? Math.round(((currentRevenue - avgRevenue) / avgRevenue) * 100)
      : null;

  return (
    <div className="bg-surface p-3.5 rounded-2xl shadow-xl border border-divider text-xs space-y-2 min-w-56 max-w-72">
      {/* Header Tanggal */}
      <div className="border-b border-divider pb-1.5 flex items-center justify-between gap-2">
        <span className="font-bold text-ink">
          {dayName}Tgl {dayNumber}
          <span className="text-[10px] text-ink-3 font-normal">{dateStr}</span>
        </span>
        {deviation !== null && (
          <span
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
              deviation >= 0
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400'
            }`}
          >
            {deviation >= 0 ? `+${deviation}%` : `${deviation}%`}
          </span>
        )}
      </div>

      {/* 1. Bulan Ini (Aktual) */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-ink font-semibold">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
            <span>{labels.current}:</span>
          </span>
          <span className="font-bold text-accent">
            {currentRevenue !== null ? formatRupiah(currentRevenue) : '-'}
          </span>
        </div>

        {/* Rincian lunas & tagih di tempat jika ada */}
        {lunasRevenue > 0 && pendingRevenue > 0 && (
          <div className="pl-3.5 text-[11px] text-ink-3 flex items-center justify-between">
            <span>✓ Lunas: {formatRupiah(lunasRevenue)}</span>
            <span className="text-warning">⏳ Tagih: {formatRupiah(pendingRevenue)}</span>
          </div>
        )}

        {showBookings && currentRevenue !== null && (
          <div className="pl-3.5 text-[11px] text-ink-3">
            {currentBookings} Pasien/Reservasi
          </div>
        )}
      </div>

      {/* 2. Bulan Lalu (M-1) */}
      <div className="pt-1.5 border-t border-divider space-y-0.5">
        <div className="flex items-center justify-between text-ink-2">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-0.5 border-t-2 border-dashed border-info shrink-0" />
            <span>{labels.previous}:</span>
          </span>
          <span className="font-semibold text-info">
            {prevRevenue !== null ? formatRupiah(prevRevenue) : '-'}
          </span>
        </div>
        {showBookings && prevBookings !== null && (
          <div className="pl-3.5 text-[11px] text-ink-3">
            {prevBookings} Pasien
          </div>
        )}
      </div>

      {/* 3. Baseline Rata-rata 6 Bulan */}
      <div className="pt-1.5 border-t border-divider space-y-0.5">
        <div className="flex items-center justify-between text-ink-2">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-1 rounded-xs bg-warning shrink-0" />
            <span>{labels.baseline}:</span>
          </span>
          <span className="font-semibold text-warning">
            {baselineAvailable && avgRevenue !== null ? formatRupiah(avgRevenue) : 'Data belum cukup'}
          </span>
        </div>
        {baselineAvailable && showBookings && avgBookings !== null && (
          <div className="pl-3.5 text-[11px] text-ink-3">
            Rata-rata {avgBookings} Pasien
            {samples > 0 && <span className="text-ink-3"> · n={samples}</span>}
          </div>
        )}
      </div>
    </div>
  );
};
