import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';
import { formatRupiah } from '../../utils/money';
import {
  CalendarDays,
  CalendarRange,
  Grid3X3,
  Info,
  RefreshCw,
  Timer,
  TrendingUp,
  Activity,
  AlertTriangle,
} from 'lucide-react';

type HeatmapScope = 'weekly' | 'monthly' | 'multi';

interface HeatmapCellMetrics {
  count: number;
  revenue: number;
  itemCount: number;
}

interface HeatmapHourlyCell extends HeatmapCellMetrics {
  dayIndex: number;
  hour: number;
}

interface HeatmapDayCell extends HeatmapCellMetrics {
  dateKey: string;
  dayOfMonth: number;
  dayIndex: number;
  dayName: string;
  isToday: boolean;
  isFuture: boolean;
}

interface HeatmapWeekRow extends HeatmapCellMetrics {
  weekIndex: number;
  label: string;
  startDateKey: string;
  endDateKey: string;
  days: HeatmapDayCell[];
}

interface HeatmapMonthSummary extends HeatmapCellMetrics {
  year: number;
  month: number;
  monthName: string;
  peakDay: { dateKey: string; count: number } | null;
  days: HeatmapDayCell[];
}

interface HeatmapQuality {
  totalCompleted: number;
  missingBookingDate: number;
  outsideHoursCount: number;
  defaultedHourCount: number;
  excludedNonCompleted: number;
}

interface HeatmapData {
  year: number;
  month: number;
  monthName: string;
  scope: HeatmapScope;
  generatedAt: string;
  metric: 'count';
  hours: { startHourWib: number; endHourWib: number };
  hourSlots: number[];
  maxCount: number;
  maxRevenue: number;
  totals: HeatmapCellMetrics;
  hourly?: HeatmapHourlyCell[];
  weeks?: HeatmapWeekRow[];
  days?: HeatmapDayCell[];
  months?: HeatmapMonthSummary[];
  quality: HeatmapQuality;
}

interface TreatmentHeatmapTabProps {
  year: number;
  month: number;
}

const DAY_ROW_LABELS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
const DAY_SHORT_LABELS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const MULTI_MONTH_OPTIONS = [3, 6, 12];

/** Intensitas warna 0–4. Level 4 memakai accent solid + teks terang. */
function levelOf(count: number, maxCount: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || maxCount <= 0) return 0;
  const ratio = count / maxCount;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function cellStyle(level: 0 | 1 | 2 | 3 | 4): React.CSSProperties {
  const alpha = [0, 0.18, 0.38, 0.6, 1][level];
  return level === 0
    ? {}
    : { backgroundColor: `rgb(var(--c-accent) / ${alpha})` };
}

function cellClass(level: 0 | 1 | 2 | 3 | 4): string {
  if (level === 0) return 'bg-fill-1 text-ink-3';
  // Hanya accent solid (level 4) yang memakai teks on-solid; level 1–3 masih
  // semi-transparan sehingga teks ink lebih terbaca (kontras ≥4,5:1).
  if (level === 4) return 'text-on-solid font-bold';
  return 'text-ink font-semibold';
}

function cellTitle(label: string, cell: HeatmapCellMetrics): string {
  return `${label}\n${cell.count} kunjungan selesai\nOmzet ${formatRupiah(cell.revenue)} · ${cell.itemCount} item`;
}

export const TreatmentHeatmapTab: React.FC<TreatmentHeatmapTabProps> = ({ year, month }) => {
  const { toast } = useUiFeedback();
  const [scope, setScope] = useState<HeatmapScope>('weekly');
  const [multiMonths, setMultiMonths] = useState<number>(3);
  const [data, setData] = useState<HeatmapData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  // Penjaga urutan: respons lama (scope/bulan sebelumnya) tidak boleh menimpa
  // hasil permintaan terbaru saat admin berpindah tab dengan cepat.
  const requestSeq = useRef(0);

  const fetchHeatmap = useCallback(
    async (forceFresh = false) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      try {
        const query = new URLSearchParams({
          year: String(year),
          month: String(month),
          scope,
        });
        if (scope === 'multi') query.set('months', String(multiMonths));

        const res = await apiRequest<{ success: boolean; data: HeatmapData }>(
          `/api/admin/financial-analytics/heatmap?${query.toString()}`,
          forceFresh ? { forceFresh: true } : {}
        );
        if (seq !== requestSeq.current) return;
        if (res.success && res.data) setData(res.data);
      } catch (err: any) {
        if (seq !== requestSeq.current) return;
        toast(err.message || 'Gagal memuat heatmap treatment.', 'error');
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [year, month, scope, multiMonths, toast]
  );

  useEffect(() => {
    void fetchHeatmap();
  }, [fetchHeatmap]);

  const hourlyLookup = useMemo(() => {
    const map = new Map<string, HeatmapHourlyCell>();
    for (const cell of data?.hourly || []) map.set(`${cell.dayIndex}-${cell.hour}`, cell);
    return map;
  }, [data]);

  const hasData = (data?.totals.count || 0) > 0;
  const quality = data?.quality;

  return (
    <div className="space-y-6">
      {/* Kontrol tampilan */}
      <div className="bg-surface p-4 sm:p-5 rounded-2xl border border-divider shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-ink flex items-center gap-2">
            <Grid3X3 size={18} className="text-accent" />
            <span>Heatmap Kepadatan Treatment</span>
          </h2>
          <p className="text-xs text-ink-2 mt-0.5">
            Warna = jumlah reservasi <strong>selesai</strong>. Reservasi mendatang, batal, dan hold tidak dihitung.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex p-1 rounded-xl bg-fill-1 border border-divider">
            {(
              [
                { id: 'weekly', label: 'Pola Hari & Jam', icon: Timer },
                { id: 'monthly', label: 'Kalender Bulan', icon: CalendarDays },
                { id: 'multi', label: 'Multi-Bulan', icon: CalendarRange },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setScope(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                    scope === tab.id
                      ? 'bg-surface text-accent shadow-xs ring-1 ring-accent/20'
                      : 'text-ink-2 hover:text-ink'
                  }`}
                >
                  <Icon size={13} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {scope === 'multi' && (
            <div className="inline-flex p-1 rounded-xl bg-fill-1 border border-divider">
              {MULTI_MONTH_OPTIONS.map((n) => (
                <button
                  key={n}
                  onClick={() => setMultiMonths(n)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    multiMonths === n
                      ? 'bg-surface text-accent shadow-xs ring-1 ring-accent/20'
                      : 'text-ink-2 hover:text-ink'
                  }`}
                >
                  {n} bln
                </button>
              ))}
            </div>
          )}

          <button
            aria-label="Muat ulang heatmap"
            onClick={() => fetchHeatmap(true)}
            disabled={loading}
            className="p-2 rounded-xl bg-surface border border-divider text-ink-2 hover:text-ink hover:bg-fill-1 transition shadow-xs disabled:opacity-50 cursor-pointer"
            title="Muat ulang heatmap"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin text-accent' : ''} />
          </button>
        </div>
      </div>

      {/* Ringkasan */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface p-4 rounded-2xl border border-divider shadow-xs">
          <p className="text-[11px] font-bold text-ink-2 uppercase tracking-wider">Kunjungan Selesai</p>
          <h3 className="text-2xl font-black text-ink mt-1">
            {loading && !data ? '—' : data?.totals.count || 0}
          </h3>
          <p className="text-[11px] text-ink-3 mt-1">
            {data?.monthName} {data?.year}
            {scope === 'multi' ? ` · ${data?.months?.length || multiMonths} bulan` : ''}
          </p>
        </div>
        <div className="bg-surface p-4 rounded-2xl border border-divider shadow-xs">
          <p className="text-[11px] font-bold text-ink-2 uppercase tracking-wider">Omzet Periode</p>
          <h3 className="text-2xl font-black text-accent mt-1">{formatRupiah(data?.totals.revenue || 0)}</h3>
          <p className="text-[11px] text-ink-3 mt-1">Layanan + ongkir (tanpa potongan)</p>
        </div>
        <div className="bg-surface p-4 rounded-2xl border border-divider shadow-xs">
          <p className="text-[11px] font-bold text-ink-2 uppercase tracking-wider">Item Treatment</p>
          <h3 className="text-2xl font-black text-ink mt-1">{data?.totals.itemCount || 0}</h3>
          <p className="text-[11px] text-ink-3 mt-1">Total baris layanan terjadwal</p>
        </div>
        <div className="bg-surface p-4 rounded-2xl border border-divider shadow-xs">
          <p className="text-[11px] font-bold text-ink-2 uppercase tracking-wider">Jam Operasional</p>
          <h3 className="text-2xl font-black text-ink mt-1">
            {data ? `${String(data.hours.startHourWib).padStart(2, '0')}–${String(data.hours.endHourWib).padStart(2, '0')}` : '—'}
          </h3>
          <p className="text-[11px] text-ink-3 mt-1">
            {quality && quality.outsideHoursCount > 0
              ? `${quality.outsideHoursCount} kunjungan di luar jam`
              : 'WIB, mengikuti pengaturan tenant'}
          </p>
        </div>
      </div>

      {/* Catatan kualitas data */}
      {quality && (quality.defaultedHourCount > 0 || quality.missingBookingDate > 0) && (
        <div className="flex items-start gap-2.5 bg-warning-soft border border-warning-line text-warning rounded-xl px-3.5 py-3 text-[11px]">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            {quality.defaultedHourCount > 0 && (
              <p>
                <strong>{quality.defaultedHourCount}</strong> kunjungan tercatat tepat <strong>09:00 WIB</strong> — kemungkinan
                booking lama tanpa jam eksplisit (jam default sistem), bukan jadwal sebenarnya.
              </p>
            )}
            {quality.missingBookingDate > 0 && (
              <p>
                <strong>{quality.missingBookingDate}</strong> reservasi selesai tidak punya tanggal kunjungan sehingga tidak
                bisa dipetakan ke heatmap.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Konten heatmap */}
      {loading && !data ? (
        <div className="bg-surface rounded-2xl border border-divider p-10 text-center text-ink-3 text-xs">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent mb-2" />
          <p>Memuat heatmap treatment...</p>
        </div>
      ) : !hasData ? (
        <div className="bg-surface rounded-2xl border border-divider p-10 text-center text-ink-3 text-xs space-y-1">
          <Activity size={22} className="mx-auto text-ink-3" />
          <p className="font-semibold text-ink-2">Belum ada kunjungan selesai pada periode ini.</p>
          <p>Heatmap akan terisi setelah reservasi ditandai selesai.</p>
        </div>
      ) : scope === 'weekly' ? (
        <WeeklyHeatmap data={data!} lookup={hourlyLookup} />
      ) : scope === 'monthly' ? (
        <MonthlyCalendar data={data!} />
      ) : (
        <MultiMonthGrid data={data!} />
      )}

      {/* Legenda */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-ink-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold">Intensitas:</span>
          {([0, 1, 2, 3, 4] as const).map((level) => (
            <span key={level} className="flex items-center gap-1">
              <span
                className={`inline-block h-4 w-4 rounded ${level === 0 ? 'bg-fill-1 border border-divider' : ''}`}
                style={cellStyle(level)}
              />
              {level === 0 ? '0' : level === 4 ? 'maks' : ''}
            </span>
          ))}
        </div>
        <span className="flex items-center gap-1.5">
          <Info size={12} />
          Arahkan kursor ke sel untuk melihat omzet & jumlah item.
        </span>
      </div>
    </div>
  );
};

function WeeklyHeatmap({
  data,
  lookup,
}: {
  data: HeatmapData;
  lookup: Map<string, HeatmapHourlyCell>;
}) {
  const hours = [...(data.hourSlots || []), -1];
  const gridTemplateColumns = `52px repeat(${hours.length}, minmax(34px, 1fr))`;

  return (
    <div className="bg-surface rounded-2xl border border-divider shadow-xs overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-divider">
        <h3 className="text-sm font-bold text-ink flex items-center gap-2">
          <Timer size={16} className="text-accent" />
          <span>Pola Kepadatan per Hari & Jam — {data.monthName} {data.year}</span>
        </h3>
        <p className="text-[11px] text-ink-2 mt-0.5">
          Setiap sel menjumlahkan kunjungan selesai pada hari dan jam WIB yang sama sepanjang bulan.
        </p>
      </div>

      <div className="overflow-x-auto p-3 sm:p-4">
        <div className="min-w-[560px] space-y-1">
          {/* Header jam */}
          <div className="grid items-center gap-1" style={{ gridTemplateColumns }}>
            <span />
            {hours.map((hour) => (
              <span key={hour} className="text-center text-[10px] font-bold text-ink-3">
                {hour === -1 ? 'Luar' : String(hour).padStart(2, '0')}
              </span>
            ))}
          </div>

          {DAY_ROW_LABELS.map((dayLabel, dayIndex) => (
            <div key={dayLabel} className="grid items-center gap-1" style={{ gridTemplateColumns }}>
              <span className="text-[11px] font-bold text-ink-2 pr-1 truncate">{dayLabel}</span>
              {hours.map((hour) => {
                const cell = lookup.get(`${dayIndex}-${hour}`) || {
                  count: 0,
                  revenue: 0,
                  itemCount: 0,
                };
                const level = levelOf(cell.count, data.maxCount);
                const label = `${dayLabel}, ${hour === -1 ? 'di luar jam operasional' : `${String(hour).padStart(2, '0')}:00 WIB`}`;
                return (
                  <div
                    key={`${dayIndex}-${hour}`}
                    title={cellTitle(label, cell)}
                    aria-label={cellTitle(label, cell)}
                    className={`h-9 rounded-md flex items-center justify-center text-[11px] transition-colors ${cellClass(level)}`}
                    style={cellStyle(level)}
                  >
                    {cell.count > 0 ? cell.count : ''}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {data.weeks && data.weeks.length > 0 && (
        <div className="border-t border-divider p-4 sm:p-5 space-y-2">
          <h4 className="text-xs font-bold text-ink-2 uppercase tracking-wider">Rekap Mingguan</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {data.weeks.map((week) => (
              <div key={week.weekIndex} className="flex items-center justify-between bg-surface-2 border border-divider rounded-xl px-3 py-2 text-[11px]">
                <span className="font-semibold text-ink">{week.label}</span>
                <span className="text-ink-2">
                  <strong className="text-accent">{week.count}</strong> kunjungan · {formatRupiah(week.revenue)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CalendarGrid({
  days,
  maxCount,
  compact = false,
}: {
  days: HeatmapDayCell[];
  maxCount: number;
  compact?: boolean;
}) {
  if (days.length === 0) return null;
  const leading = days[0].dayIndex;
  const sizeClass = compact ? 'h-7 sm:h-8' : 'h-10 sm:h-12';

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-7 gap-1">
        {DAY_SHORT_LABELS.map((label) => (
          <span key={label} className="text-center text-[10px] font-bold text-ink-3">
            {label}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: leading }, (_, i) => (
          <span key={`lead-${i}`} aria-hidden="true" />
        ))}
        {days.map((day) => {
          const level = levelOf(day.count, maxCount);
          const label = `${day.dayName}, ${day.dateKey}`;
          return (
            <div
              key={day.dateKey}
              title={cellTitle(label, day)}
              aria-label={cellTitle(label, day)}
              className={`relative rounded-md border ${sizeClass} ${cellClass(level)} ${
                day.isToday ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface' : 'border-divider'
              } ${day.isFuture ? 'opacity-70' : ''}`}
              style={cellStyle(level)}
            >
              <span className={`absolute top-0.5 left-1 text-[9px] ${level === 4 ? 'text-on-solid/80' : 'text-ink-3'}`}>
                {day.dayOfMonth}
              </span>
              {day.count > 0 && (
                <span className={`absolute inset-0 flex items-center justify-center ${compact ? 'text-[10px]' : 'text-xs'}`}>
                  {day.count}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthlyCalendar({ data }: { data: HeatmapData }) {
  return (
    <div className="bg-surface rounded-2xl border border-divider shadow-xs overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-divider flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-ink flex items-center gap-2">
            <CalendarDays size={16} className="text-accent" />
            <span>Kalender Kunjungan — {data.monthName} {data.year}</span>
          </h3>
          <p className="text-[11px] text-ink-2 mt-0.5">Angka di dalam sel = jumlah kunjungan selesai pada tanggal tersebut.</p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-ink-2">
          <span className="flex items-center gap-1">
            <TrendingUp size={12} className="text-accent" />
            Puncak: <strong className="text-ink">{data.maxCount}</strong> kunjungan/hari
          </span>
        </div>
      </div>
      <div className="p-3 sm:p-5">
        <CalendarGrid days={data.days || []} maxCount={data.maxCount} />
      </div>
    </div>
  );
}

function MultiMonthGrid({ data }: { data: HeatmapData }) {
  return (
    <div className="space-y-4">
      {(data.months || []).map((monthData) => (
        <div key={`${monthData.year}-${monthData.month}`} className="bg-surface rounded-2xl border border-divider shadow-xs overflow-hidden">
          <div className="px-4 py-3 border-b border-divider flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-bold text-ink">
              {monthData.monthName} {monthData.year}
            </h4>
            <div className="flex items-center gap-3 text-[11px] text-ink-2">
              <span>
                <strong className="text-accent">{monthData.count}</strong> kunjungan
              </span>
              <span>{formatRupiah(monthData.revenue)}</span>
              {monthData.peakDay && (
                <span className="hidden sm:inline">
                  Puncak: {monthData.peakDay.dateKey} ({monthData.peakDay.count})
                </span>
              )}
            </div>
          </div>
          <div className="p-3 sm:p-4">
            <CalendarGrid days={monthData.days} maxCount={data.maxCount} compact />
          </div>
        </div>
      ))}
    </div>
  );
}
