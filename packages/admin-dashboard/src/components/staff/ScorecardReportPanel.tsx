import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Info,
  Lock,
  RefreshCw,
  Users,
} from 'lucide-react';
import { apiRequest } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useUiFeedback } from '../common/UiFeedback';
import { Button } from '../ui/Button';
import { formatMonthYearWib } from '../../utils/dateWib';

/**
 * ScorecardReportPanel (F8)
 * Raport kinerja bidan untuk review admin/owner: nilai per periode, rincian
 * komponen, cakupan bukti, serta hitung ulang & pembekuan snapshot.
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
  formula_version?: string;
}

interface ScorecardReport {
  tenantId: string;
  periodYear: number;
  periodMonth: number;
  policy: ScorecardPolicy;
  items: ScorecardItem[];
}

const GRADE_STYLE: Record<string, string> = {
  A: 'bg-success-soft text-success border-success-line',
  B: 'bg-accent-soft text-accent border-accent/30',
  C: 'bg-warning-soft text-warning border-warning-line',
  D: 'bg-caution-soft text-caution border-caution-line',
  E: 'bg-danger-soft text-danger border-danger-line',
};

function gradeClass(grade: string | null): string {
  return (grade && GRADE_STYLE[grade]) || 'bg-fill-1 text-ink-2 border-divider';
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
  if (item.retention.eligible) return item.retention.status;
  const status = item.retention.status;
  if (status === 'INSUFFICIENT_SAMPLE') return `Sampel < ${policy.min_sample_retention} pasien`;
  if (status.startsWith('SKIPPED:TENURE')) return `Masa kerja < ${policy.min_tenure_months} bulan`;
  if (status === 'NO_DATA') return 'Belum ada kohort';
  if (status.startsWith('SKIPPED:OWNER_OR_NOT_ELIGIBLE')) return 'Owner / tidak ikut insentif';
  if (status.startsWith('SKIPPED:VOLUME_SCHEME')) return 'Skema volume';
  if (status.startsWith('SKIPPED:UNASSIGNED_STAFF')) return 'Belum ada penugasan';
  return status;
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const isSuperAdmin = String(user?.role || '').toLowerCase() === 'super_admin';
  const years = useMemo(() => {
    const base = initialPeriod.year;
    return [base, base - 1, base - 2];
  }, [initialPeriod.year]);

  const load = useCallback(
    async (target: { year: number; month: number }) => {
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
    },
    []
  );

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

  const toggleRow = (staffId: string) => {
    setExpanded((prev) => ({ ...prev, [staffId]: !prev[staffId] }));
  };

  const items = report?.items || [];
  const finalCount = items.filter((item) => item.status === 'FINAL').length;

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
                Nilai per periode dari kunjungan selesai, bukti chat yang sudah diverifikasi, dan
                retensi kohort. Angka <b>PREVIEW</b> masih bisa berubah; <b>FINAL</b> terkunci.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[11px] font-bold text-ink-2">
              Bulan
              <select
                value={period.month}
                onChange={(e) => setPeriod((prev) => ({ ...prev, month: Number(e.target.value) }))}
                className="mt-1 block w-full px-2.5 py-1.5 rounded-lg bg-surface border border-divider text-xs text-ink focus:outline-none focus:border-accent"
              >
                {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                  <option key={month} value={month}>
                    {formatMonthYearWib(period.year, month - 1).split(' ')[0]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] font-bold text-ink-2">
              Tahun
              <select
                value={period.year}
                onChange={(e) => setPeriod((prev) => ({ ...prev, year: Number(e.target.value) }))}
                className="mt-1 block w-full px-2.5 py-1.5 rounded-lg bg-surface border border-divider text-xs text-ink focus:outline-none focus:border-accent"
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
              {isSuperAdmin ? <Lock size={14} /> : <Lock size={14} className="opacity-60" />}
              Bekukan
            </Button>
          </div>
        </div>

        {!isSuperAdmin && (
          <p className="mt-3 text-[11px] text-ink-3 flex items-center gap-1.5">
            <Info size={13} className="text-ink-3" />
            Anda dapat memeriksa dan mengoreksi data, tetapi pembekuan nilai hanya oleh Super Admin.
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <SummaryChip icon={<Users size={13} />} label="Bidan dinilai" value={String(items.length)} />
          <SummaryChip
            icon={<ClipboardCheck size={13} />}
            label="Sudah FINAL"
            value={`${finalCount}/${items.length}`}
          />
          <SummaryChip
            icon={<Info size={13} />}
            label="Periode"
            value={formatMonthYearWib(period.year, period.month - 1)}
          />
          <SummaryChip
            icon={<Award size={13} />}
            label="Formula"
            value={report?.policy?.formula_version || 'v1'}
          />
        </div>

        {report?.policy && (
          <div className="mt-3 flex items-start gap-2 p-3 rounded-xl bg-fill-1 border border-divider text-[11px] text-ink-2">
            <Info size={14} className="text-accent mt-0.5 flex-shrink-0" />
            <p>
              Bobot {report.policy.weight_punctuality}/{report.policy.weight_retention}/
              {report.policy.weight_volume} (ketepatan/retensi/volume). Telat dihitung di atas{' '}
              {report.policy.tolerance_minutes} menit; bukti chat di atas{' '}
              {report.policy.chat_evidence_minutes} menit wajib diverifikasi. Target{' '}
              {report.policy.target_visits_per_day} kunjungan/hari ×{' '}
              {report.policy.working_days_per_month} hari kerja.
            </p>
          </div>
        )}

        {error && (
          <div className="mt-3 flex items-start gap-2 p-3 rounded-xl bg-danger-soft border border-danger-line text-[11px] text-danger">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div>{error}</div>
              <button
                type="button"
                onClick={() => void load(period)}
                className="mt-1 font-bold underline"
              >
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
            Pastikan akun bidan berstatus aktif dan <b>Incentive Eligible</b> di tab Daftar Staff.
          </p>
        </div>
      ) : (
        <div className="bg-surface border border-divider rounded-2xl overflow-hidden">
          <div className="hidden md:grid grid-cols-[minmax(0,1.4fr)_60px_80px_96px_96px_88px_82px_92px_32px] gap-2 px-4 py-2.5 bg-fill-1 border-b border-divider text-[10px] font-bold uppercase tracking-wide text-ink-3">
            <span>Bidan</span>
            <span className="text-center">Grade</span>
            <span className="text-right">Nilai</span>
            <span className="text-right">Ketepatan</span>
            <span className="text-right">Retensi</span>
            <span className="text-right">Volume</span>
            <span className="text-right">Cakupan</span>
            <span className="text-center">Status</span>
            <span />
          </div>

          {items.map((item) => {
            const isOpen = Boolean(expanded[item.staffId]);
            return (
              <div key={item.staffId} className="border-b border-divider last:border-b-0">
                <button
                  type="button"
                  onClick={() => toggleRow(item.staffId)}
                  className="w-full text-left px-4 py-3 hover:bg-fill-1/60 transition grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.4fr)_60px_80px_96px_96px_88px_82px_92px_32px] gap-2 items-center"
                  aria-expanded={isOpen}
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-bold text-ink truncate">
                      {item.staffName}
                    </span>
                    <span className="block md:hidden text-[10px] text-ink-2 mt-0.5">
                      {pct(item.punctuality.pct)} tepat · retensi {pct(item.retention.pct)} · volume{' '}
                      {pct(item.volume.pct)}
                    </span>
                  </span>

                  <span className="hidden md:flex justify-center">
                    <GradeBadge grade={item.grade} />
                  </span>
                  <span className="hidden md:block text-right text-xs font-bold text-ink">
                    {item.score === null ? '—' : item.score.toFixed(1).replace('.', ',')}
                  </span>
                  <span className="hidden md:block text-right text-[11px] text-ink-2">
                    {pct(item.punctuality.pct)}
                  </span>
                  <span className="hidden md:block text-right text-[11px] text-ink-2">
                    {item.retention.eligible ? pct(item.retention.pct) : '—'}
                  </span>
                  <span className="hidden md:block text-right text-[11px] text-ink-2">
                    {pct(item.volume.pct)}
                  </span>
                  <span
                    className={`hidden md:block text-right text-[11px] font-bold ${
                      item.coveragePct >= 60 ? 'text-ink-2' : 'text-warning'
                    }`}
                  >
                    {pct(item.coveragePct)}
                  </span>
                  <span className="hidden md:flex justify-center">
                    <StatusChip status={item.status} />
                  </span>

                  <span className="flex md:hidden items-center gap-1.5">
                    <GradeBadge grade={item.grade} />
                    <StatusChip status={item.status} />
                  </span>

                  <span className="hidden md:flex justify-end text-ink-3">
                    {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </span>
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 pt-1 bg-fill-1/40 border-t border-divider">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <DetailStat label="Tepat waktu" value={String(item.punctuality.onTime)} />
                      <DetailStat label="Telat (jam)" value={String(item.punctuality.lateMeasured)} />
                      <DetailStat label="Telat (chat)" value={String(item.punctuality.chatLate)} />
                      <DetailStat
                        label="Belum terbukti"
                        value={String(item.punctuality.unknown)}
                        tone="warning"
                      />
                    </div>

                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-ink-2">
                      <div className="p-2.5 rounded-lg bg-surface border border-divider">
                        <div className="font-bold text-ink">Ketepatan</div>
                        <div className="mt-0.5">
                          Terukur {item.punctuality.assessed} dari {item.punctuality.total} kunjungan
                          (cakupan {pct(item.coveragePct)}). Bobot dipakai{' '}
                          {item.usedWeights.punctuality}%.
                        </div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-surface border border-divider">
                        <div className="font-bold text-ink">Retensi</div>
                        <div className="mt-0.5">
                          {item.retention.eligible
                            ? `${item.retention.retainedN}/${item.retention.cohortN} kembali · benchmark ${pct(item.retention.benchmarkPct)}`
                            : `${retentionReason(item, report!.policy)} — komponen dikecualikan.`}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-surface border border-divider">
                        <div className="font-bold text-ink">Volume</div>
                        <div className="mt-0.5">
                          {item.volume.visits} kunjungan dari target{' '}
                          {item.volume.target.toFixed(1).replace('.', ',')}. Bobot dipakai{' '}
                          {item.usedWeights.volume}%.
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-ink-3">
                      <span>
                        Bobot terpakai: ketepatan {item.usedWeights.punctuality}% · retensi{' '}
                        {item.usedWeights.retention}% · volume {item.usedWeights.volume}%
                      </span>
                      <span>Dihitung {new Date(item.computedAt).toLocaleString('id-ID')}</span>
                      {item.excluded.length > 0 && (
                        <span className="text-warning font-bold">
                          Dikecualikan: {item.excluded.join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

function GradeBadge({ grade }: { grade: string | null }) {
  return (
    <span
      className={`h-7 w-7 rounded-lg border grid place-items-center text-xs font-bold ${gradeClass(grade)}`}
      title={grade ? `Grade ${grade}` : 'Belum ada grade'}
    >
      {grade || '—'}
    </span>
  );
}

function StatusChip({ status }: { status: 'PREVIEW' | 'FINAL' }) {
  return (
    <span
      className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${
        status === 'FINAL'
          ? 'bg-success-soft text-success border-success-line'
          : 'bg-warning-soft text-warning border-warning-line'
      }`}
    >
      {status}
    </span>
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

function DetailStat(props: { label: string; value: string; tone?: 'warning' }) {
  return (
    <div className="rounded-lg bg-surface border border-divider px-2.5 py-2">
      <div className="text-[9px] font-bold uppercase tracking-wide text-ink-3">{props.label}</div>
      <div
        className={`text-sm font-bold mt-0.5 ${
          props.tone === 'warning' ? 'text-warning' : 'text-ink'
        }`}
      >
        {props.value}
      </div>
    </div>
  );
}

export default ScorecardReportPanel;
