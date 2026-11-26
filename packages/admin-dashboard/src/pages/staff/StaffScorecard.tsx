import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Award,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock,
  RefreshCw,
  Repeat2,
  TrendingUp,
} from 'lucide-react';
import { apiRequest } from '../../services/api';
import { useStaffAuth } from '../../contexts/StaffAuthContext';
import { formatMonthYearWib } from '../../utils/dateWib';

/**
 * Raport bidan (F6) — dashboard HP yang membaca angka dari
 * `GET /api/staff/scorecard/me`. staffId selalu dari sesi server.
 */

interface ScorecardPunctuality {
  pct: number | null;
  onTime: number;
  lateMeasured: number;
  chatLate: number;
  unknown: number;
  assessed: number;
  total: number;
  status: string;
}

interface ScorecardItem {
  staffId: string;
  staffName: string;
  periodYear: number;
  periodMonth: number;
  punctuality: ScorecardPunctuality;
  retention: {
    pct: number | null;
    eligible: boolean;
    status: string;
    cohortN: number;
    retainedN: number;
    benchmarkPct: number | null;
  };
  volume: { pct: number | null; visits: number; target: number };
  coveragePct: number;
  score: number | null;
  grade: string | null;
  usedWeights: { punctuality: number; retention: number; volume: number };
  excluded: string[];
  status: 'PREVIEW' | 'FINAL';
  computedAt: string;
}

interface ScorecardPolicy {
  weight_punctuality: number;
  weight_retention: number;
  weight_volume: number;
  tolerance_minutes: number;
  chat_evidence_minutes: number;
  target_visits_per_day: number;
  working_days_per_month: number;
  min_sample_punctuality: number;
  min_sample_retention: number;
  min_tenure_months: number;
  grade_a_min: number;
  grade_b_min: number;
  grade_c_min: number;
  grade_d_min: number;
}

interface ScorecardResponse {
  success: boolean;
  data: {
    period: { year: number; month: number };
    item: ScorecardItem | null;
    included: boolean;
    policy: ScorecardPolicy;
    retentionPolicy: {
      benchmark_pct: number;
      min_sample: number;
      min_tenure_months: number;
      window_days: number;
      formula_version: string;
    };
  };
  error?: string;
}

type LoadState = 'loading' | 'ready' | 'error' | 'empty';

const GRADE_STYLE: Record<string, { text: string; badge: string; ring: string }> = {
  A: { text: 'text-success', badge: 'bg-success-soft text-success border-success-line', ring: 'border-success-line' },
  B: { text: 'text-accent', badge: 'bg-accent-soft text-accent border-accent/30', ring: 'border-accent/40' },
  C: { text: 'text-warning', badge: 'bg-warning-soft text-warning border-warning-line', ring: 'border-warning-line' },
  D: { text: 'text-caution', badge: 'bg-caution-soft text-caution border-caution-line', ring: 'border-caution-line' },
  E: { text: 'text-danger', badge: 'bg-danger-soft text-danger border-danger-line', ring: 'border-danger-line' },
};

function gradeStyle(grade: string | null) {
  return (grade && GRADE_STYLE[grade]) || {
    text: 'text-ink-2',
    badge: 'bg-fill-1 text-ink-2 border-divider',
    ring: 'border-divider',
  };
}

function formatPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits).replace('.', ',')}%`;
}

function retentionLabel(
  status: string,
  policy: ScorecardPolicy,
  retentionPolicy: { min_sample: number; min_tenure_months: number }
): string {
  if (status === 'OK') return 'Dinilai';
  if (status === 'INSUFFICIENT_SAMPLE') {
    return `Belum dinilai — sampel < ${retentionPolicy.min_sample} pasien`;
  }
  if (status === 'NO_DATA') return 'Belum ada data kohort';
  if (status.startsWith('SKIPPED:TENURE')) {
    return `Belum dinilai — masa kerja < ${
      retentionPolicy.min_tenure_months || policy.min_tenure_months
    } bulan`;
  }
  if (status.startsWith('SKIPPED:OWNER_OR_NOT_ELIGIBLE')) {
    return 'Tidak dinilai — akun owner / tidak ikut insentif';
  }
  if (status.startsWith('SKIPPED:VOLUME_SCHEME')) return 'Tidak dinilai — skema volume';
  if (status.startsWith('SKIPPED:UNASSIGNED_STAFF')) return 'Tidak dinilai — belum ada penugasan';
  return status;
}

export function StaffScorecard() {
  const navigate = useNavigate();
  const { staff } = useStaffAuth();
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ScorecardResponse['data'] | null>(null);

  const nowWib = useMemo(() => {
    // Periode awal = bulan berjalan menurut WIB (format en-CA → YYYY-MM).
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
    const [year, month] = key.split('-').map(Number);
    return { year, month };
  }, []);

  const [period, setPeriod] = useState(nowWib);

  const load = useCallback(
    async (target: { year: number; month: number }) => {
      setState('loading');
      setError(null);
      try {
        const res = (await apiRequest(
          `/api/staff/scorecard/me?year=${target.year}&month=${target.month}`
        )) as ScorecardResponse;
        if (!res?.success) {
          throw new Error(res?.error || 'Gagal memuat raport.');
        }
        setPayload(res.data);
        setState(res.data.item ? 'ready' : 'empty');
      } catch (err: any) {
        setPayload(null);
        setError(err?.message || 'Gagal memuat raport. Periksa koneksi lalu coba lagi.');
        setState('error');
      }
    },
    []
  );

  useEffect(() => {
    void load(period);
  }, [load, period]);

  const shiftPeriod = (delta: number) => {
    setPeriod((prev) => {
      const index = prev.year * 12 + (prev.month - 1) + delta;
      return { year: Math.floor(index / 12), month: (index % 12) + 1 };
    });
  };

  const isCurrentPeriod = period.year === nowWib.year && period.month === nowWib.month;
  const item = payload?.item || null;
  const policy = payload?.policy || null;
  const style = gradeStyle(item?.grade || null);

  return (
    <div className="min-h-screen bg-surface-2 dark:bg-surface">
      <header className="bg-surface border-b border-divider px-4 py-3 sticky top-0 z-20 pt-[calc(0.75rem+env(safe-area-inset-top,0px))]">
        <div className="max-w-2xl mx-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/admin/staff/today')}
            className="p-2 rounded-full bg-fill-1 hover:bg-fill-2 text-ink-2 border border-divider transition active:scale-95"
            aria-label="Kembali ke tugas"
            title="Kembali ke tugas"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-bold text-ink truncate">Raport Bidan</h1>
            <p className="text-[11px] text-ink-2 truncate">
              {staff?.name || item?.staffName || 'Bidan'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load(period)}
            disabled={state === 'loading'}
            className="p-2 rounded-full bg-surface hover:bg-fill-2 text-ink-2 border border-divider transition disabled:opacity-50 active:scale-95"
            aria-label="Muat ulang raport"
            title="Muat ulang"
          >
            <RefreshCw size={14} className={state === 'loading' ? 'animate-spin text-accent' : ''} />
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] space-y-3">
        <div className="flex items-center justify-between gap-2 bg-surface border border-divider rounded-xl px-2 py-1.5">
          <button
            type="button"
            onClick={() => shiftPeriod(-1)}
            className="p-1.5 rounded-lg bg-fill-1 hover:bg-fill-2 text-ink-2 transition active:scale-95"
            aria-label="Periode sebelumnya"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="text-center min-w-0">
            <div className="text-xs font-bold text-ink truncate">
              {formatMonthYearWib(period.year, period.month - 1)}
            </div>
            <div className="text-[10px] text-ink-2">
              {isCurrentPeriod ? 'Bulan berjalan' : 'Periode lampau'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => shiftPeriod(1)}
            disabled={isCurrentPeriod}
            className="p-1.5 rounded-lg bg-fill-1 hover:bg-fill-2 text-ink-2 transition disabled:opacity-40 active:scale-95"
            aria-label="Periode berikutnya"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {state === 'loading' && <ScorecardSkeleton />}

        {state === 'error' && (
          <div className="bg-danger-soft border border-danger-line rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2 text-danger font-bold text-sm">
              <AlertTriangle size={16} />
              <span>Raport belum bisa dimuat</span>
            </div>
            <p className="text-xs text-danger leading-relaxed">{error}</p>
            <button
              type="button"
              onClick={() => void load(period)}
              className="w-full py-2 rounded-lg bg-danger text-on-solid text-xs font-bold transition active:scale-95"
            >
              Coba Lagi
            </button>
          </div>
        )}

        {state === 'empty' && (
          <div className="bg-surface border border-divider rounded-xl p-5 text-center space-y-2">
            <CalendarClock size={26} className="mx-auto text-ink-3" />
            <div className="text-sm font-bold text-ink">Belum masuk penilaian</div>
            <p className="text-xs text-ink-2 leading-relaxed">
              Akun Anda belum terdaftar sebagai bidan yang dinilai pada periode{' '}
              {formatMonthYearWib(period.year, period.month - 1)}. Hubungi admin klinik bila ini
              keliru.
            </p>
          </div>
        )}

        {state === 'ready' && payload && item && policy && (
          <>
            <section className={`bg-surface border ${style.ring} rounded-xl p-4`}>
              <div className="flex items-center gap-4">
                <div className={`h-20 w-20 rounded-2xl border grid place-items-center shrink-0 ${style.badge}`}>
                  <span className={`text-4xl font-bold leading-none ${style.text}`}>
                    {item.grade || 'NA'}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-ink-3">
                    Nilai Akhir
                  </div>
                  <div className="text-2xl font-bold text-ink leading-tight">
                    {item.score === null ? '—' : item.score.toFixed(1).replace('.', ',')}
                    <span className="text-xs font-medium text-ink-3"> / 100</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${
                        item.status === 'FINAL'
                          ? 'bg-success-soft text-success border-success-line'
                          : 'bg-warning-soft text-warning border-warning-line'
                      }`}
                    >
                      {item.status === 'FINAL' ? 'FINAL' : 'PREVIEW'}
                    </span>
                    <span className="text-[10px] text-ink-2">
                      Cakupan bukti {formatPct(item.coveragePct)} ({item.punctuality.assessed}/
                      {item.punctuality.total})
                    </span>
                  </div>
                </div>
              </div>
              {item.excluded.length > 0 && (
                <p className="mt-3 text-[11px] text-ink-2 leading-relaxed border-t border-divider pt-2.5">
                  Komponen {item.excluded.map((key) => (key === 'retention' ? 'retensi' : key)).join(', ')}{' '}
                  tidak dinilai pada periode ini, sehingga bobot komponen lain disesuaikan otomatis.
                </p>
              )}
              {item.status === 'PREVIEW' && (
                <p className="mt-2 text-[10px] text-ink-3 leading-relaxed">
                  Angka masih berjalan dan dapat berubah sampai admin membekukan raport periode ini.
                </p>
              )}
            </section>

            <section className="space-y-2">
              <h2 className="text-xs font-bold text-ink uppercase tracking-wider px-1">
                Rincian Komponen
              </h2>

              <ComponentCard
                icon={<Clock size={15} />}
                title="Ketepatan Waktu"
                pct={item.punctuality.pct}
                weight={item.usedWeights.punctuality}
                tone="accent"
                caption={`Toleransi ${policy.tolerance_minutes} menit dari jadwal`}
              >
                <div className="grid grid-cols-2 gap-1.5 mt-2">
                  <MiniStat label="Tepat waktu" value={item.punctuality.onTime} tone="success" />
                  <MiniStat label="Telat (jam)" value={item.punctuality.lateMeasured} tone="warning" />
                  <MiniStat label="Telat (chat)" value={item.punctuality.chatLate} tone="warning" />
                  <MiniStat label="Belum terbukti" value={item.punctuality.unknown} tone="muted" />
                </div>
                <p className="mt-2 text-[10px] text-ink-3 leading-relaxed">
                  Telat dari chat hanya dihitung setelah disetujui admin. Kunjungan tanpa bukti tidak
                  dianggap tepat maupun telat.
                </p>
              </ComponentCard>

              <ComponentCard
                icon={<Repeat2 size={15} />}
                title="Retensi Pasien"
                pct={item.retention.eligible ? item.retention.pct : null}
                weight={item.usedWeights.retention}
                tone="violet"
                caption={
                  item.retention.eligible
                    ? `${item.retention.retainedN} dari ${item.retention.cohortN} pasien kembali`
                    : retentionLabel(item.retention.status, policy, payload.retentionPolicy)
                }
              >
                {item.retention.eligible ? (
                  <p className="mt-2 text-[10px] text-ink-3 leading-relaxed">
                    Benchmark klinik {formatPct(item.retention.benchmarkPct)}. Retensi memakai kohort
                    bulan sebelumnya.
                  </p>
                ) : (
                  <p className="mt-2 text-[10px] text-ink-3 leading-relaxed">
                    Komponen ini dilewati agar bidan baru tidak dihukum data yang belum cukup.
                  </p>
                )}
              </ComponentCard>

              <ComponentCard
                icon={<TrendingUp size={15} />}
                title="Volume Kunjungan"
                pct={item.volume.pct}
                weight={item.usedWeights.volume}
                tone="success"
                caption={`${item.volume.visits} kunjungan selesai`}
              >
                <p className="mt-2 text-[10px] text-ink-3 leading-relaxed">
                  Target {policy.target_visits_per_day} kunjungan/hari × {policy.working_days_per_month}{' '}
                  hari kerja (prorata hari berjalan) ≈ {item.volume.target.toFixed(1).replace('.', ',')}{' '}
                  kunjungan.
                </p>
              </ComponentCard>
            </section>

            <section className="bg-fill-1 border border-divider rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-ink-2 text-[11px] font-bold">
                <Award size={13} className="text-accent" />
                <span>Ambang Grade</span>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {[
                  { grade: 'A', min: policy.grade_a_min },
                  { grade: 'B', min: policy.grade_b_min },
                  { grade: 'C', min: policy.grade_c_min },
                  { grade: 'D', min: policy.grade_d_min },
                  { grade: 'E', min: 0 },
                ].map((row) => (
                  <span
                    key={row.grade}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                      item.grade === row.grade
                        ? gradeStyle(row.grade).badge
                        : 'bg-surface text-ink-2 border-divider'
                    }`}
                  >
                    {row.grade} ≥ {row.min}
                  </span>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function ScorecardSkeleton() {
  return (
    <div className="space-y-3" aria-label="Memuat raport" role="status">
      <div className="bg-surface border border-divider rounded-xl p-4 animate-pulse">
        <div className="flex items-center gap-4">
          <div className="h-20 w-20 rounded-2xl bg-fill-2" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-20 bg-fill-2 rounded" />
            <div className="h-6 w-28 bg-fill-2 rounded" />
            <div className="h-3 w-40 bg-fill-2 rounded" />
          </div>
        </div>
      </div>
      {[0, 1, 2].map((row) => (
        <div key={row} className="bg-surface border border-divider rounded-xl p-3 animate-pulse space-y-2">
          <div className="h-3 w-32 bg-fill-2 rounded" />
          <div className="h-2 w-full bg-fill-2 rounded" />
          <div className="h-2 w-2/3 bg-fill-2 rounded" />
        </div>
      ))}
    </div>
  );
}

const TONE_BAR: Record<string, string> = {
  accent: 'bg-accent',
  violet: 'bg-violet',
  success: 'bg-success',
};

function ComponentCard(props: {
  icon: React.ReactNode;
  title: string;
  pct: number | null;
  weight: number;
  tone: 'accent' | 'violet' | 'success';
  caption: string;
  children?: React.ReactNode;
}) {
  const width = Math.max(0, Math.min(100, props.pct ?? 0));
  return (
    <div className="bg-surface border border-divider rounded-xl p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="h-6 w-6 rounded-lg bg-fill-1 grid place-items-center text-ink-2 shrink-0">
            {props.icon}
          </span>
          <div className="min-w-0">
            <div className="text-xs font-bold text-ink truncate">{props.title}</div>
            <div className="text-[10px] text-ink-2 truncate">{props.caption}</div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-bold text-ink">{formatPct(props.pct)}</div>
          <div className="text-[9px] text-ink-3">bobot {props.weight}%</div>
        </div>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-fill-1 overflow-hidden">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${TONE_BAR[props.tone]}`}
          style={{ width: `${width}%` }}
        />
      </div>
      {props.children}
    </div>
  );
}

const MINI_TONE: Record<string, string> = {
  success: 'text-success bg-success-soft border-success-line',
  warning: 'text-warning bg-warning-soft border-warning-line',
  muted: 'text-ink-2 bg-fill-1 border-divider',
};

function MiniStat(props: { label: string; value: number; tone: 'success' | 'warning' | 'muted' }) {
  return (
    <div className={`rounded-lg border px-2 py-1.5 ${MINI_TONE[props.tone]}`}>
      <div className="text-sm font-bold leading-none">{props.value}</div>
      <div className="text-[9px] leading-tight mt-0.5 opacity-80">{props.label}</div>
    </div>
  );
}

export default StaffScorecard;
