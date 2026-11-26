import React from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { ChartSeriesToggle, type ChartSeriesToggleItem } from './ChartSeriesToggle';
import { CumulativeComparisonTooltip } from './CumulativeComparisonTooltip';
import { chartTheme } from '../../lib/chartTheme';
import { type CumulativeChartPoint, type ForecastSummaryDto } from '../../lib/dashboard-metrics';

export interface CumulativeTrendChartProps {
  data: CumulativeChartPoint[];
  metricType: 'revenue' | 'bookings';
  visible: Record<string, boolean>;
  toggleItems: ChartSeriesToggleItem[];
  onToggle: (key: string) => void;
  labels: { current: string; previous: string; baseline: string };
  baselineAvailable: boolean;
  monthsUsed: number;
  monthsRequested: number;
  forecastSummary?: ForecastSummaryDto | null;
}

function formatCompactRupiah(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `Rp ${(amount / 1_000_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000_000) {
    return `Rp ${(amount / 1_000_000).toFixed(1)}jt`;
  }
  if (amount >= 1_000) {
    return `Rp ${(amount / 1_000).toFixed(0)}rb`;
  }
  return `Rp ${amount}`;
}

export const CumulativeTrendChart: React.FC<CumulativeTrendChartProps> = ({
  data,
  metricType,
  visible,
  toggleItems,
  onToggle,
  labels,
  baselineAvailable,
  monthsUsed,
  monthsRequested,
  forecastSummary,
}) => {
  const gridStroke = chartTheme.grid.stroke;

  const keys =
    metricType === 'revenue'
      ? {
          total: 'cumulativeRevenue',
          new: 'cumulativeNewRevenue',
          repeat: 'cumulativeRepeatRevenue',
          last: 'cumulativeLastMonthRevenue',
          avg: 'cumulativeAvgRevenue',
          forecast: 'cumulativeForecastRevenue',
        }
      : {
          total: 'cumulativeBookings',
          new: 'cumulativeNewBookings',
          repeat: 'cumulativeRepeatBookings',
          last: 'cumulativeLastMonthBookings',
          avg: 'cumulativeAvgBookings',
          forecast: 'cumulativeForecastBookings',
        };

  const yTickFormatter =
    metricType === 'revenue'
      ? formatCompactRupiah
      : (v: number) => `${Math.round(v)}`;

  return (
    <div className="space-y-4">
      {/* Series Toggles */}
      <div className="flex items-center justify-end">
        <ChartSeriesToggle
          items={toggleItems}
          visible={visible}
          onToggle={onToggle}
        />
      </div>

      {/* Chart Canvas */}
      <div className="h-72 w-full pt-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
            <defs>
              <linearGradient id="colorCumRevenue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={chartTheme.accent} stopOpacity={0.25} />
                <stop offset="95%" stopColor={chartTheme.accent} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorCumNew" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="rgb(var(--c-info))" stopOpacity={0.22} />
                <stop offset="95%" stopColor="rgb(var(--c-info))" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorCumRepeat" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={chartTheme.accent} stopOpacity={0.22} />
                <stop offset="95%" stopColor={chartTheme.accent} stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />

            <XAxis
              dataKey="day"
              tickLine={false}
              stroke={chartTheme.axis.stroke}
              fontSize={11}
              tickFormatter={(d) => `Tgl ${d}`}
            />

            <YAxis
              tickLine={false}
              stroke={chartTheme.axis.stroke}
              fontSize={11}
              tickFormatter={yTickFormatter}
            />

            <Tooltip
              content={
                <CumulativeComparisonTooltip
                  labels={labels}
                  metricType={metricType}
                  baselineAvailable={baselineAvailable}
                  monthsUsed={monthsUsed}
                  forecastSummary={forecastSummary}
                />
              }
            />

            {/* 1. Realisasi Total (Non-Stacked jika repeat breakdown tidak aktif) */}
            {visible.total && !(visible.new || visible.repeat) && (
              <Area
                type="monotone"
                dataKey={keys.total}
                stroke={chartTheme.accent}
                fill="url(#colorCumRevenue)"
                strokeWidth={2.5}
                dot={false}
                connectNulls={false}
              />
            )}

            {/* 2. Realisasi Stacked Breakdown (Pasien Baru) */}
            {visible.new && (
              <Area
                type="monotone"
                dataKey={keys.new}
                stackId="cum"
                stroke="rgb(var(--c-info))"
                fill="url(#colorCumNew)"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
              />
            )}

            {/* 3. Realisasi Stacked Breakdown (Reservasi Repeat) */}
            {visible.repeat && (
              <Area
                type="monotone"
                dataKey={keys.repeat}
                stackId="cum"
                stroke={chartTheme.accent}
                fill="url(#colorCumRepeat)"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
              />
            )}

            {/* 4. Bulan Lalu (Putus-Putus Halus) */}
            {visible.last && (
              <Line
                type="monotone"
                dataKey={keys.last}
                stroke="rgb(var(--c-info))"
                strokeDasharray="4 4"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
              />
            )}

            {/* 5. Baseline Rata-Rata */}
            {visible.avg && baselineAvailable && (
              <Line
                type="monotone"
                dataKey={keys.avg}
                stroke="rgb(var(--c-warning))"
                strokeWidth={2.5}
                dot={false}
                connectNulls={false}
              />
            )}

            {/* 6. Proyeksi Akhir Bulan (Forecasting Dashed Line) */}
            {visible.forecast && (
              <Line
                type="monotone"
                dataKey={keys.forecast}
                stroke={chartTheme.accent}
                strokeDasharray="3 3"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Catatan Kaki Baseline & Forecasting */}
      <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between text-[11px] text-ink-3 border-t border-divider gap-1">
        <span>
          * {baselineAvailable
            ? `Basis baseline ${monthsUsed} bulan historis (diminta ${monthsRequested})`
            : 'Baseline historis dinonaktifkan (data belum cukup)'}
          {forecastSummary?.method === 'RUN_RATE_FLAT' && ' · Proyeksi memakai run-rate harian (riwayat baseline belum cukup)'}
        </span>
        <span className="italic">Garis putus-putus = proyeksi statistik berjalan, bukan jaminan mutlak.</span>
      </div>
    </div>
  );
};
