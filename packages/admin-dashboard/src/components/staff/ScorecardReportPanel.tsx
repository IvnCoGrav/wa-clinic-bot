import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  CalendarDays,
  CheckCircle2,
  Clock,
  Info,
  Lock,
  RefreshCw,
  Repeat2,
  TrendingUp,
  Users,
} from 'lucide-react';
import { apiRequest } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useUiFeedback } from '../common/UiFeedback';
import { Button } from '../ui/Button';
import { formatMonthYearWib, formatWibClock, formatWibDate } from '../../utils/dateWib';

/**
 * ScorecardReportPanel (F9)
 * Raport admin mengikuti prototipe `raport-bidan-v2.html`:
 * tab Ringkasan, per bidan, dan Data & Metode. Grade tetap ditampilkan
 * terpisah dari tiga status bukti (keputusan D5).
 */

interface VisitBreakdown {
  newPatients: number;
  repeatVisits: number;
  ownRepeat: number;
  handoffRepeat: number;
  visitNumbers: Array<{ visitNumber: number; count: number }>;
  previousPeriodVisits: number | null;
}

interface LateVisit {
  reservationId: string;
  customerName: string | null;
  bookingDate: string;
  minutes: number;
  source: 'JAM' | 'CHAT';
}

interface ScorecardItem {
  staffId: string;
  staffName: string;
  periodYear: number;
  periodMonth: number;
  punctuality: {
    pct: number | null;
    onTime: number;
    lateMeasured: number;
    chatLate: number;
    unknown: number;
    assessed: number;
    total: number;
    status: string;
  };
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
  visits: VisitBreakdown | null;
  worstLate: LateVisit[];
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
  formula_version?: string;
}

interface ScorecardReport {
  tenantId: string;
  periodYear: number;
  periodMonth: number;
  policy: ScorecardPolicy;
  items: ScorecardItem[];
}

type TabKey = 'summary' | 'method' | string;

function gradeClass(grade: string | null): string {
  switch (grade) {
    case 'A':
      return 'bg-success-soft text-success border-success-line';
    case 'B':
      return 'bg-accent-soft text-accent border-accent/30';
    case 'C':
      return 'bg-warning-soft text-warning border-warning-line';
    case 'D':
      return 'bg-caution-soft text-caution border-caution-line';
    case 'E':
      return 'bg-danger-soft text-danger border-danger-line';
    default:
      return 'bg-fill-1 text-ink-2 border-divider';
  }
}

function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits).replace('.', ',')}%`;
}

function periodFromWib(): { year: number; month: number } {
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const [year, month] = key.split('-').map(Number);
  return { year, month };
}

function retentionReason(item: ScorecardItem, policy: ScorecardPolicy): string {
  if (item.retention.eligible) return 'Dinilai';
  const status = item.retention.status;
  if (status === 'INSUFFICIENT_SAMPLE') return `Sampel < ${policy.min_sample_retention} pasien`;
  if (status.startsWith('SKIPPED:TENURE')) return `Masa kerja < ${policy.min_tenure_months} bulan`;
  if (status === 'NO_DATA') return 'Belum ada kohort';
  if (status.startsWith('SKIPPED:OWNER_OR_NOT_ELIGIBLE')) return 'Owner / tidak ikut insentif';
  if (status.startsWith('SKIPPED:VOLUME_SCHEME')) return 'Skema volume';
  if (status.startsWith('SKIPPED:UNASSIGNED_STAFF')) return 'Belum ada penugasan';
  return status;
}

function recommendations(item: ScorecardItem, policy: ScorecardPolicy): string[] {
  const out: string[] = [];
  if (item.coveragePct < 60) {
    out.push(
      `Cakupan bukti baru ${pct(item.coveragePct)}. Lengkapi bukti chat/foto agar penilaian tidak bergantung pada asumsi.`
    );
  }
  if (item.punctuality.chatLate > 0) {
    out.push(
      `${item.punctuality.chatLate} kunjungan terbukti telat dari chat. Konfirmasi pola keterlambatan ke bidan.`
    );
  }
  if (
    item.retention.eligible &&
    item.retention.pct != null &&
    item.retention.benchmarkPct != null &&
    item.retention.pct < item.retention.benchmarkPct
  ) {
    out.push(
      `Retensi ${pct(item.retention.pct)} di bawah benchmark ${pct(item.retention.benchmarkPct)}.`
    );
  }
  if (!item.retention.eligible) {
    out.push(`Retensi belum dinilai: ${retentionReason(item, policy)}.`);
  }
  if (item.volume.pct != null && item.volume.pct < 60) {
    out.push(`Volume ${pct(item.volume.pct)} dari target. Periksa beban jadwal/penugasan.`);
  }
  if (out.length === 0) {
    out.push('Tidak ada anomali besar pada periode ini.');
  }
  return out.slice(0, 3);
}

export const ScorecardReportPanel: React.FC = () => {
  const { user } = useAuth();
  const { toast, confirm } = useUiFeedback();

  const initialPeriod = useMemo(periodFromWib, []);
  const [period, setPeriod] = useState(initialPeriod);
  const [report, setReport] = useState<ScorecardReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<'recalculate' | 'freeze' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('summary');

  const isSuperAdmin = String(user?.role || '').toLowerCase() === 'super_admin';
  const years = useMemo(() => {
    const base = initialPeriod.year;
    return [base, base - 1, base - 2];
  }, [initialPeriod.year]);

  const load = useCallback(async (target: { year: number; month: number }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest(
        `/api/admin/staff-scorecard/report?year=${target.year}&month=${target.month}`
      );
      if (!res?.success || !res.data) {
        throw new Error(res?.error || 'Gagal memuat raport.');
      }
      setReport(res.data as ScorecardReport);
    } catch (err: any) {
      setReport(null);
      setError(err?.message || 'Gagal memuat raport penilaian.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [load, period]);

  const recalculate = async () => {
    setWorking('recalculate');
    setError(null);
    try {
      const res = await apiRequest('/api/admin/staff-scorecard/recalculate', {
        method: 'POST',
        body: JSON.stringify({ year: period.year, month: period.month }),
      });
      if (!res?.success || !res.data) {
        throw new Error(res?.error || 'Gagal menghitung ulang.');
      }
      setReport(res.data as ScorecardReport);
      toast('Nilai dihitung ulang dari data terbaru.', 'success');
    } catch (err: any) {
      setError(err?.message || 'Gagal menghitung ulang raport.');
    } finally {
      setWorking(null);
    }
  };

  const freeze = async () => {
    const isCurrent = period.year === initialPeriod.year && period.month === initialPeriod.month;
    const ok = await confirm({
      title: 'Bekukan Nilai Periode Ini?',
      message: isCurrent
        ? 'Periode ini masih berjalan. Membekukan sekarang mengunci nilai sementara dan angka tidak akan berubah lagi. Lanjutkan?'
        : 'Nilai akan dikunci sebagai FINAL. Snapshot FINAL tidak bisa dihitung ulang atau ditimpa. Lanjutkan?',
      confirmText: 'Ya, Bekukan',
      danger: true,
    });
    if (!ok) return;

    setWorking('freeze');
    setError(null);
    try {
      const res = await apiRequest('/api/admin/staff-scorecard/snapshot', {
        method: 'POST',
        body: JSON.stringify({ year: period.year, month: period.month }),
      });
      if (!res?.success || !res.data) {
        throw new Error(res?.error || 'Gagal membekukan nilai.');
      }
      toast(
        `Snapshot dibekukan: ${res.data.written} ditulis, ${res.data.skipped} dilewati.`,
        'success'
      );
      await load(period);
    } catch (err: any) {
      setError(err?.message || 'Gagal membekukan snapshot.');
    } finally {
      setWorking(null);
    }
  };

  const items = report?.items || [];
  const policy = report?.policy;
  const finalCount = items.filter((item) => item.status === 'FINAL').length;

  const totals = items.reduce(
    (acc, item) => ({
      visits: acc.visits + item.punctuality.total,
      assessed: acc.assessed + item.punctuality.assessed,
      onTime: acc.onTime + item.punctuality.onTime,
      lateMeasured: acc.lateMeasured + item.punctuality.lateMeasured,
      chatLate: acc.chatLate + item.punctuality.chatLate,
      unknown: acc.unknown + item.punctuality.unknown,
      newPatients: acc.newPatients + (item.visits?.newPatients ?? 0),
      repeatVisits: acc.repeatVisits + (item.visits?.repeatVisits ?? 0),
    }),
    {
      visits: 0,
      assessed: 0,
      onTime: 0,
      lateMeasured: 0,
      chatLate: 0,
      unknown: 0,
      newPatients: 0,
      repeatVisits: 0,
    }
  );
  const totalCoverage = totals.visits > 0 ? (totals.assessed / totals.visits) * 100 : 0;

  const effectiveTab: TabKey =
    activeTab !== 'summary' && activeTab !== 'method' && !items.some((i) => i.staffId === activeTab)
      ? 'summary'
      : activeTab;
  const activeItem = items.find((item) => item.staffId === effectiveTab) || null;

  return (
    <div className="space-y-4">
      <div className="bg-surface border border-divider rounded-2xl p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-accent/10 text-accent">
              <Award size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-ink">Raport Kinerja Bidan</h2>
              <p className="text-xs text-ink-3 mt-0.5 max-w-2xl">
                Setiap angka menyertakan sumber buktinya. Tiga status bukti dipisah; grade
                berbobot ditampilkan terpisah agar tidak mencampur bukti satu arah.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label htmlFor="scorecard-report-month" className="text-[11px] font-bold text-ink-2">
              Bulan
              <select
                id="scorecard-report-month"
                value={period.month}
                onChange={(e) => setPeriod((prev) => ({ ...prev, month: Number(e.target.value) }))}
                className="mt-1 block px-2.5 py-1.5 rounded-lg bg-surface border border-divider text-xs text-ink focus:outline-none focus:border-accent"
              >
                {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                  <option key={month} value={month}>
                    {formatMonthYearWib(period.year, month - 1).split(' ')[0]}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="scorecard-report-year" className="text-[11px] font-bold text-ink-2">
              Tahun
              <select
                id="scorecard-report-year"
                value={period.year}
                onChange={(e) => setPeriod((prev) => ({ ...prev, year: Number(e.target.value) }))}
                className="mt-1 block px-2.5 py-1.5 rounded-lg bg-surface border border-divider text-xs text-ink focus:outline-none focus:border-accent"
              >
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void recalculate()}
              disabled={working !== null || loading}
            >
              <RefreshCw size={14} className={working === 'recalculate' ? 'animate-spin' : ''} />
              Hitung Ulang
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void freeze()}
              disabled={working !== null || loading || !isSuperAdmin}
              title={
                isSuperAdmin
                  ? 'Kunci nilai periode ini sebagai FINAL'
                  : 'Pembekuan hanya dapat dilakukan Super Admin'
              }
            >
              <Lock size={14} className={isSuperAdmin ? '' : 'opacity-60'} />
              Bekukan
            </Button>
          </div>
        </div>

        {!isSuperAdmin && (
          <p className="mt-3 text-[11px] text-ink-3 flex items-center gap-1.5">
            <Info size={13} />
            Anda dapat memeriksa dan mengoreksi data, tetapi pembekuan hanya oleh Super Admin.
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <SummaryChip icon={<Users size={13} />} label="Bidan dinilai" value={String(items.length)} />
          <SummaryChip icon={<CalendarDays size={13} />} label="Kunjungan" value={String(totals.visits)} />
          <SummaryChip
            icon={<Info size={13} />}
            label="Cakupan bukti"
            value={pct(totalCoverage)}
          />
          <SummaryChip
            icon={<Award size={13} />}
            label="Sudah FINAL"
            value={`${finalCount}/${items.length}`}
          />
        </div>

        {policy && (
          <div className="mt-3 flex items-start gap-2 p-3 rounded-xl bg-fill-1 border border-divider text-[11px] text-ink-2">
            <Info size={14} className="text-accent mt-0.5 flex-shrink-0" />
            <p>
              Bobot {policy.weight_punctuality}/{policy.weight_retention}/{policy.weight_volume}{' '}
              (ketepatan/retensi/volume). Toleransi {policy.tolerance_minutes} menit; ambang bukti
              chat {policy.chat_evidence_minutes} menit. Target {policy.target_visits_per_day}{' '}
              kunjungan/hari × {policy.working_days_per_month} hari kerja. Formula{' '}
              {policy.formula_version || 'v1'}.
            </p>
          </div>
        )}

        {error && (
          <div className="mt-3 flex items-start gap-2 p-3 rounded-xl bg-danger-soft border border-danger-line text-[11px] text-danger">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div>{error}</div>
              <button type="button" onClick={() => void load(period)} className="mt-1 font-bold underline">
                Coba lagi
              </button>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="bg-surface border border-divider rounded-2xl p-6 text-xs text-ink-3">
          Menghitung raport periode {formatMonthYearWib(period.year, period.month - 1)}…
        </div>
      ) : items.length === 0 ? (
        <div className="bg-surface border border-divider rounded-2xl p-6 text-center space-y-1.5">
          <Users size={24} className="mx-auto text-ink-3" />
          <div className="text-sm font-bold text-ink">Belum ada bidan yang masuk penilaian</div>
          <p className="text-xs text-ink-2">
            Pastikan akun bidan aktif dan <b>Incentive Eligible</b> di tab Daftar Staff.
          </p>
        </div>
      ) : (
        <div className="bg-surface border border-divider rounded-2xl overflow-hidden">
          <div
            role="tablist"
            aria-label="Bagian raport"
            className="flex gap-1 px-3 pt-3 pb-0 overflow-x-auto border-b border-divider"
          >
            <TabButton active={effectiveTab === 'summary'} onClick={() => setActiveTab('summary')}>
              Ringkasan
            </TabButton>
            {items.map((item) => (
              <TabButton
                key={item.staffId}
                active={effectiveTab === item.staffId}
                onClick={() => setActiveTab(item.staffId)}
              >
                {item.staffName.replace(/^Bidan\s+/i, '')}
              </TabButton>
            ))}
            <TabButton active={effectiveTab === 'method'} onClick={() => setActiveTab('method')}>
              Data &amp; Metode
            </TabButton>
          </div>

          <div className="p-4 space-y-4">
            {effectiveTab === 'summary' && policy && (
              <SummaryTab
                items={items}
                totals={totals}
                coverage={totalCoverage}
                policy={policy}
                onOpenStaff={(staffId) => setActiveTab(staffId)}
              />
            )}

            {activeItem && policy && (
              <StaffTab item={activeItem} policy={policy} periodLabel={formatMonthYearWib(period.year, period.month - 1)} />
            )}

            {effectiveTab === 'method' && policy && (
              <MethodTab policy={policy} items={items} coverage={totalCoverage} />
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-ink-3 px-1">
        <span>
          Dihitung{' '}
          {report
            ? `${formatWibDate(new Date(), { day: '2-digit', month: '2-digit', year: 'numeric' })} ${formatWibClock(new Date())}`
            : '—'}{' '}
          · sumber: reservasi selesai, bukti kedatangan, policy retensi kanonis.
        </span>
        {report && <span>Snapshot FINAL tidak dihitung ulang.</span>}
      </div>
    </div>
  );
};

function TabButton(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.active}
      onClick={props.onClick}
      className={`px-3 py-2 rounded-t-lg text-xs font-bold whitespace-nowrap border-b-2 transition ${
        props.active
          ? 'border-accent text-accent bg-accent-soft/40'
          : 'border-transparent text-ink-2 hover:text-ink hover:bg-fill-1'
      }`}
    >
      {props.children}
    </button>
  );
}

function SummaryChip(props: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-divider bg-fill-1 px-3 py-2">
      <div className="flex items-center gap-1 text-[10px] text-ink-3 font-bold uppercase tracking-wide">
        {props.icon}
        <span>{props.label}</span>
      </div>
      <div className="text-sm font-bold text-ink mt-0.5 truncate">{props.value}</div>
    </div>
  );
}

function SummaryTab(props: {
  items: ScorecardItem[];
  totals: {
    visits: number;
    assessed: number;
    onTime: number;
    lateMeasured: number;
    chatLate: number;
    unknown: number;
    newPatients: number;
    repeatVisits: number;
  };
  coverage: number;
  policy: ScorecardPolicy;
  onOpenStaff: (staffId: string) => void;
}) {
  const { items, totals, coverage, policy } = props;
  const attention = items
    .filter(
      (item) =>
        item.coveragePct < 60 ||
        item.grade === 'D' ||
        item.grade === 'E' ||
        (item.retention.eligible &&
          item.retention.pct != null &&
          item.retention.benchmarkPct != null &&
          item.retention.pct < item.retention.benchmarkPct)
    )
    .slice(0, 3);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Kunjungan selesai"
          value={String(totals.visits)}
          note={`${totals.newPatients} baru · ${totals.repeatVisits} ulang`}
        />
        <StatCard
          label="Cakupan bukti"
          value={pct(coverage)}
          note={`${totals.assessed} dari ${totals.visits} terukur`}
          tone={coverage < 60 ? 'warning' : 'success'}
        />
        <StatCard
          label="Terbukti telat"
          value={String(totals.lateMeasured + totals.chatLate)}
          note={`${totals.lateMeasured} jam · ${totals.chatLate} chat`}
          tone="danger"
        />
        <StatCard
          label="Tanpa bukti"
          value={String(totals.unknown)}
          note="Tidak disimpulkan"
          tone={totals.unknown > 0 ? 'muted' : 'success'}
        />
      </div>

      <section className="rounded-xl border border-divider overflow-hidden">
        <div className="px-4 py-3 border-b border-divider bg-fill-1">
          <h3 className="text-sm font-bold text-ink">Perbandingan bidan</h3>
          <p className="text-[11px] text-ink-3">
            Tiga sumber bukti dipisah. Klik nama untuk membuka rincian.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[11px]">
            <thead className="bg-surface-2 text-ink-3 uppercase tracking-wide text-[10px]">
              <tr>
                <th className="px-4 py-2">Bidan</th>
                <th className="px-2 py-2 text-right">Kunjungan</th>
                <th className="px-2 py-2 text-right">Cakupan</th>
                <th className="px-2 py-2 text-right">Tepat</th>
                <th className="px-2 py-2 text-right">Telat jam</th>
                <th className="px-2 py-2 text-right">Telat chat</th>
                <th className="px-2 py-2 text-right">Belum</th>
                <th className="px-2 py-2 text-center">Grade</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.staffId} className="border-t border-divider hover:bg-fill-1/60">
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => props.onOpenStaff(item.staffId)}
                      className="font-bold text-ink hover:text-accent"
                    >
                      {item.staffName}
                    </button>
                  </td>
                  <td className="px-2 py-2 text-right">{item.punctuality.total}</td>
                  <td
                    className={`px-2 py-2 text-right font-bold ${
                      item.coveragePct < 60 ? 'text-warning' : 'text-ink-2'
                    }`}
                  >
                    {pct(item.coveragePct)}
                  </td>
                  <td className="px-2 py-2 text-right">{item.punctuality.onTime}</td>
                  <td className="px-2 py-2 text-right">{item.punctuality.lateMeasured}</td>
                  <td className="px-2 py-2 text-right">{item.punctuality.chatLate}</td>
                  <td className="px-2 py-2 text-right">{item.punctuality.unknown}</td>
                  <td className="px-2 py-2 text-center">
                    <span
                      className={`inline-grid place-items-center h-7 w-7 rounded-lg border text-xs font-bold ${gradeClass(
                        item.grade
                      )}`}
                    >
                      {item.grade || '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2.5 text-[10px] text-ink-3 border-t border-divider">
          Tepat dan telat jam hanya dari jam kedatangan. Telat chat hanya dari bukti yang sudah
          disetujui. Tidak ada satu persen yang mencampur ketiganya.
        </p>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <section className="rounded-xl border border-divider p-4">
          <h3 className="text-sm font-bold text-ink">Retensi kohort</h3>
          <p className="text-[11px] text-ink-3 mt-0.5">
            Kohort bulan sebelumnya. Benchmark {pct(items[0]?.retention.benchmarkPct ?? null)}.
          </p>
          <div className="mt-3 space-y-2">
            {items.map((item) => (
              <div key={item.staffId} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-bold text-ink truncate">{item.staffName}</span>
                {item.retention.eligible ? (
                  <span className="text-ink-2">
                    {item.retention.retainedN}/{item.retention.cohortN} ·{' '}
                    <b className="text-ink">{pct(item.retention.pct)}</b>
                  </span>
                ) : (
                  <span className="text-ink-3">{retentionReason(item, policy)}</span>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-divider p-4">
          <h3 className="text-sm font-bold text-ink">Perlu perhatian</h3>
          <p className="text-[11px] text-ink-3 mt-0.5">
            Dipilih karena dampaknya ke validitas penilaian, bukan karena angkanya jelek.
          </p>
          {attention.length === 0 ? (
            <p className="mt-3 text-[11px] text-success flex items-center gap-1.5">
              <CheckCircle2 size={13} /> Tidak ada anomali besar pada periode ini.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {attention.map((item) => (
                <li key={item.staffId} className="text-[11px] text-ink-2">
                  <button
                    type="button"
                    onClick={() => props.onOpenStaff(item.staffId)}
                    className="font-bold text-ink hover:text-accent"
                  >
                    {item.staffName}
                  </button>
                  <span className="text-ink-3"> — </span>
                  {recommendations(item, policy)[0]}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function StatCard(props: {
  label: string;
  value: string;
  note: string;
  tone?: 'success' | 'warning' | 'danger' | 'muted';
}) {
  const tone =
    props.tone === 'success'
      ? 'text-success'
      : props.tone === 'warning'
        ? 'text-warning'
        : props.tone === 'danger'
          ? 'text-danger'
          : props.tone === 'muted'
            ? 'text-ink-2'
            : 'text-ink';
  return (
    <div className="rounded-xl border border-divider bg-surface-2 px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3">{props.label}</div>
      <div className={`text-xl font-bold mt-0.5 ${tone}`}>{props.value}</div>
      <div className="text-[10px] text-ink-3 mt-0.5">{props.note}</div>
    </div>
  );
}

function StaffTab(props: { item: ScorecardItem; policy: ScorecardPolicy; periodLabel: string }) {
  const { item, policy, periodLabel } = props;
  const measured = item.punctuality.onTime + item.punctuality.lateMeasured;
  const breakdown = item.visits;
  const repeatNumbers = breakdown?.visitNumbers || [];
  const previous = breakdown?.previousPeriodVisits ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold text-ink">{item.staffName}</h3>
          <p className="text-[11px] text-ink-3">
            {item.punctuality.total} kunjungan selesai · {periodLabel} ·{' '}
            {item.status === 'FINAL' ? 'nilai FINAL' : 'nilai PREVIEW'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`h-14 w-14 rounded-xl border grid place-items-center text-2xl font-bold ${gradeClass(
              item.grade
            )}`}
          >
            {item.grade || '—'}
          </span>
          <div className="text-left">
            <div className="text-[10px] text-ink-3 uppercase font-bold">Nilai akhir</div>
            <div className="text-xl font-bold text-ink">
              {item.score === null ? '—' : item.score.toFixed(1).replace('.', ',')}
              <span className="text-[10px] font-normal text-ink-3"> /100</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <section className="rounded-xl border border-divider p-4">
          <h4 className="text-sm font-bold text-ink flex items-center gap-1.5">
            <TrendingUp size={14} className="text-accent" /> Kunjungan
          </h4>
          {breakdown ? (
            <>
              <div className="mt-2 flex items-end justify-between">
                <div>
                  <span className="text-2xl font-bold text-ink">{item.punctuality.total}</span>
                  <span className="text-[11px] text-ink-3"> kunjungan selesai</span>
                </div>
                {previous != null && (
                  <span className="text-[10px] text-ink-3">
                    Periode sama bulan lalu: {previous}
                  </span>
                )}
              </div>
              <SplitBar
                left={breakdown.newPatients}
                right={breakdown.repeatVisits}
                leftLabel="baru"
                rightLabel="ulang"
              />
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-2">
                <span>
                  <i className="inline-block h-2 w-2 rounded-full bg-accent mr-1" />
                  <b>{breakdown.newPatients}</b> pasien baru
                </span>
                <span>
                  <i className="inline-block h-2 w-2 rounded-full bg-warning mr-1" />
                  <b>{breakdown.repeatVisits}</b> kunjungan ulang
                </span>
              </div>
            </>
          ) : (
            <p className="mt-2 text-[11px] text-ink-3">
              {item.status === 'FINAL'
                ? 'Rincian pasien baru/ulang tidak tersimpan pada snapshot FINAL.'
                : item.punctuality.total === 0
                  ? 'Belum ada kunjungan selesai pada periode ini.'
                  : 'Rincian kunjungan tidak tersedia.'}
            </p>
          )}
        </section>

        <section className="rounded-xl border border-divider p-4">
          <h4 className="text-sm font-bold text-ink flex items-center gap-1.5">
            <Repeat2 size={14} className="text-violet" /> Retensi kohort
          </h4>
          {item.retention.eligible ? (
            <>
              <div className="mt-2 flex items-end justify-between">
                <div>
                  <span className="text-2xl font-bold text-ink">{pct(item.retention.pct)}</span>
                  <span className="text-[11px] text-ink-3">
                    {' '}
                    · {item.retention.retainedN}/{item.retention.cohortN} kembali
                  </span>
                </div>
                <span className="text-[10px] text-ink-3">
                  Benchmark {pct(item.retention.benchmarkPct)}
                </span>
              </div>
              <ProgressBar
                value={item.retention.pct ?? 0}
                benchmark={item.retention.benchmarkPct ?? null}
              />
              <p className="mt-2 text-[10px] text-ink-3">
                Kohort pasien bulan sebelumnya; hanya pasien yang memenuhi masa kerja & sampel.
              </p>
            </>
          ) : (
            <p className="mt-2 text-[11px] text-ink-2">{retentionReason(item, policy)}.</p>
          )}
        </section>

        <section className="rounded-xl border border-divider p-4">
          <h4 className="text-sm font-bold text-ink flex items-center gap-1.5">
            <Clock size={14} className="text-warning" /> Ketepatan waktu
          </h4>
          <p className="text-[11px] text-ink-3 mt-0.5">
            {measured} dari {item.punctuality.total} punya jam kedatangan.
          </p>
          <div className="mt-2 space-y-1.5 text-[11px]">
            <StatusRow
              color="bg-success"
              label="Tepat jam"
              value={item.punctuality.onTime}
              note="dari jam kedatangan"
            />
            <StatusRow
              color="bg-warning"
              label="Telat jam"
              value={item.punctuality.lateMeasured}
              note="di atas toleransi"
            />
            <StatusRow
              color="bg-caution"
              label="Telat chat"
              value={item.punctuality.chatLate}
              note="bukti disetujui"
            />
            <StatusRow
              color="bg-ink-3"
              label="Tanpa bukti"
              value={item.punctuality.unknown}
              note="tidak disimpulkan"
            />
          </div>
          <p className="mt-2 text-[10px] text-ink-3">
            Persentase ketepatan {pct(item.punctuality.pct)} hanya dari {measured + item.punctuality.chatLate}{' '}
            kunjungan yang terukur.
          </p>
          <div className="mt-3 border-t border-divider pt-2">
            <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3">
              Keterlambatan terburuk
            </div>
            {item.worstLate.length === 0 ? (
              <p className="text-[11px] text-ink-3 mt-1">Tidak ada keterlambatan terbukti.</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {item.worstLate.map((visit) => (
                  <li
                    key={`${visit.reservationId}-${visit.source}`}
                    className="flex items-center justify-between gap-2 text-[11px]"
                  >
                    <span className="text-ink-2 truncate">
                      {visit.customerName || 'Customer'} · {formatWibDate(visit.bookingDate)}
                    </span>
                    <span className="font-bold text-ink whitespace-nowrap">
                      +{visit.minutes} mnt{' '}
                      <span className="text-[9px] font-normal text-ink-3">
                        ({visit.source === 'JAM' ? 'jam' : 'chat'})
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-divider p-4">
          <h4 className="text-sm font-bold text-ink">Peran di tim</h4>
          {breakdown ? (
            <>
              <p className="text-[11px] text-ink-3 mt-0.5">
                Asal pasien ulang: milik sendiri vs titipan bidan lain.
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-2">
                <span>
                  <b className="text-ink">{breakdown.ownRepeat}</b> milik sendiri
                </span>
                <span>
                  <b className="text-ink">{breakdown.handoffRepeat}</b> titipan
                </span>
              </div>
              {repeatNumbers.length > 0 ? (
                <p className="mt-2 text-[11px] text-ink-2">
                  {repeatNumbers
                    .map((row) => `${row.count} kunjungan ke-${row.visitNumber}`)
                    .join(', ')}
                  .
                </p>
              ) : (
                <p className="mt-2 text-[11px] text-ink-3">Belum ada kunjungan ulang.</p>
              )}
              <p className="mt-2 text-[10px] text-ink-3">
                Ini komposisi tim, bukan angka retensi pribadi.
              </p>
            </>
          ) : (
            <p className="mt-2 text-[11px] text-ink-3">
              {item.status === 'FINAL'
                ? 'Rincian peran tim tidak tersimpan pada snapshot FINAL.'
                : item.punctuality.total === 0
                  ? 'Belum ada kunjungan ulang pada periode ini.'
                  : 'Rincian peran tim tidak tersedia.'}
            </p>
          )}
        </section>

        <section className="rounded-xl border border-divider p-4">
          <h4 className="text-sm font-bold text-ink flex items-center gap-1.5">
            <Award size={14} className="text-accent" /> Grade &amp; bobot
          </h4>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px]">
            <WeightBox label="Ketepatan" value={item.usedWeights.punctuality} />
            <WeightBox label="Retensi" value={item.usedWeights.retention} />
            <WeightBox label="Volume" value={item.usedWeights.volume} />
          </div>
          <p className="mt-2 text-[10px] text-ink-3">
            Bobot dinormalisasi bila komponen dikecualikan. Komponen dikecualikan:{' '}
            {item.excluded.length > 0 ? item.excluded.join(', ') : 'tidak ada'}.
          </p>
        </section>

        <section className="rounded-xl border border-divider p-4">
          <h4 className="text-sm font-bold text-ink flex items-center gap-1.5">
            <Info size={14} className="text-accent" /> Catatan &amp; tindakan
          </h4>
          <ul className="mt-2 space-y-1.5 text-[11px] text-ink-2">
            {recommendations(item, policy).map((note) => (
              <li key={note} className="flex items-start gap-1.5">
                <AlertTriangle size={12} className="text-warning mt-0.5 flex-shrink-0" />
                <span>{note}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-ink-3">
            Rekomendasi otomatis dari data periode ini; bukan catatan yang disimpan.
          </p>
        </section>
      </div>
    </div>
  );
}

function MethodTab(props: {
  policy: ScorecardPolicy;
  items: ScorecardItem[];
  coverage: number;
}) {
  const { policy, items, coverage } = props;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <MethodCard title="Cara angka ini dihitung">
          <ul className="space-y-1.5 text-[11px] text-ink-2">
            <li>
              <b>Tepat jam</b>: `arrived_at` ≤ jadwal + {policy.tolerance_minutes} menit.
            </li>
            <li>
              <b>Telat jam</b>: `arrived_at` &gt; toleransi. Hanya dari jam kedatangan.
            </li>
            <li>
              <b>Telat chat</b>: bukti chat <b>APPROVED</b> di atas{' '}
              {policy.chat_evidence_minutes} menit.
            </li>
            <li>
              <b>Tanpa bukti</b>: tidak punya jam maupun bukti chat yang disetujui.
            </li>
            <li>
              <b>Volume</b>: target {policy.target_visits_per_day}/hari ×{' '}
              {policy.working_days_per_month} hari kerja (prorata hari berjalan).
            </li>
          </ul>
        </MethodCard>

        <MethodCard title="Tiga status bukti">
          <p className="text-[11px] text-ink-2">
            Setiap kunjungan masuk salah satu status: <b>terukur</b> (jam/geofence),{' '}
            <b>bukti chat</b> (satu arah, menunggu persetujuan), atau <b>tanpa bukti</b>. Tidak ada
            status “dianggap tepat”.
          </p>
          <p className="mt-2 text-[11px] text-ink-3">
            Cakupan periode ini {pct(coverage)}. Bila cakupan rendah, angka ketepatan belum layak
            dipakai sebagai kesimpulan tunggal.
          </p>
        </MethodCard>

        <MethodCard title="Retensi kohort">
          <p className="text-[11px] text-ink-2">
            Kohort pasien bulan sebelumnya. Dinilai hanya jika sampel ≥{' '}
            {policy.min_sample_retention} pasien dan masa kerja ≥ {policy.min_tenure_months} bulan.
            Benchmark mengikuti policy retensi kanonis (contoh:{' '}
            {pct(items[0]?.retention.benchmarkPct ?? null)}).
          </p>
          <p className="mt-2 text-[11px] text-ink-3">
            Bila tidak layak, komponen dikecualikan dan bobot lain dinormalisasi.
          </p>
        </MethodCard>

        <MethodCard title="Grade &amp; batas data">
          <p className="text-[11px] text-ink-2">
            Grade memakai bobot {policy.weight_punctuality}/{policy.weight_retention}/
            {policy.weight_volume}, ambang A ≥ {policy.grade_a_min}, B ≥ {policy.grade_b_min}, C ≥{' '}
            {policy.grade_c_min}, D ≥ {policy.grade_d_min}. Grade ditampilkan terpisah dari tiga
            status bukti.
          </p>
          <ul className="mt-2 space-y-1 text-[11px] text-ink-3">
            <li>Jam kedatangan belum tentu terisi untuk semua kunjungan.</li>
            <li>Bukti chat bersifat satu arah dan wajib direview admin.</li>
            <li>Identitas pasien ganda (nama/HP) belum sepenuhnya dideduplikasi.</li>
            <li>Snapshot FINAL mengunci angka dan tidak menyimpan rincian kunjungan.</li>
          </ul>
        </MethodCard>
      </div>

      <MethodCard title="Sumber data">
        <ul className="space-y-1 text-[11px] text-ink-2">
          <li>
            <code>reservations</code> status <code>completed</code> (tenant aktif), tanggal dalam
            periode.
          </li>
          <li>
            <code>visit_arrival_evidence</code> — hanya bukti chat <code>APPROVED</code> yang
            dihitung telat.
          </li>
          <li>
            <code>staff_scorecard_policies</code> (bobot/ambang) dan policy retensi kanonis.
          </li>
          <li>
            <code>staff_scorecard_snapshots</code> — angka FINAL yang dibekukan.
          </li>
        </ul>
      </MethodCard>
    </div>
  );
}

function MethodCard(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-divider p-4">
      <h4 className="text-sm font-bold text-ink">{props.title}</h4>
      <div className="mt-2">{props.children}</div>
    </section>
  );
}

function SplitBar(props: { left: number; right: number; leftLabel: string; rightLabel: string }) {
  const total = props.left + props.right;
  const leftPct = total > 0 ? (props.left / total) * 100 : 0;
  return (
    <div className="mt-2">
      <div className="h-2 rounded-full bg-fill-1 overflow-hidden flex">
        {total > 0 ? (
          <>
            <div className="h-full bg-accent" style={{ width: `${leftPct}%` }} />
            <div className="h-full bg-warning" style={{ width: `${100 - leftPct}%` }} />
          </>
        ) : (
          <div className="h-full w-full bg-fill-2" />
        )}
      </div>
      <div className="flex justify-between text-[10px] text-ink-3 mt-1">
        <span>{props.leftLabel}</span>
        <span>{props.rightLabel}</span>
      </div>
    </div>
  );
}

function ProgressBar(props: { value: number; benchmark: number | null }) {
  return (
    <div className="mt-2">
      <div className="relative h-2 rounded-full bg-fill-1 overflow-hidden">
        <div
          className="h-full bg-violet"
          style={{ width: `${Math.max(0, Math.min(100, props.value))}%` }}
        />
        {props.benchmark != null && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-ink"
            style={{ left: `${Math.max(0, Math.min(100, props.benchmark))}%` }}
            title={`Benchmark ${pct(props.benchmark)}`}
          />
        )}
      </div>
    </div>
  );
}

function StatusRow(props: {
  color: string;
  label: string;
  value: number;
  note: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-ink-2">
        <i className={`inline-block h-2 w-2 rounded-full ${props.color}`} />
        {props.label}
      </span>
      <span className="text-right">
        <b className="text-ink">{props.value}</b>{' '}
        <span className="text-[10px] text-ink-3">{props.note}</span>
      </span>
    </div>
  );
}

function WeightBox(props: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-divider bg-fill-1 px-2 py-1.5">
      <div className="text-sm font-bold text-ink">{props.value}%</div>
      <div className="text-[9px] text-ink-3">{props.label}</div>
    </div>
  );
}

export default ScorecardReportPanel;
