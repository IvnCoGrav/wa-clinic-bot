import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader, RefreshCw, Activity, Settings, ChevronUp, ChevronDown } from 'lucide-react';
import {
  fetchMetaPerformance,
  fetchMetaPerformanceSettings,
  updateMetaPerformanceSettings,
} from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';
import { MetaPerformanceReport } from './types';
import { SpendCalculator } from './SpendCalculator';
import { KpiGrid } from './KpiGrid';
import { FunnelBars } from './FunnelBars';
import { ChannelTable } from './ChannelTable';
import { CampaignTable } from './CampaignTable';
import { LeakageGrid } from './LeakageGrid';
import { TherapistUtilizationCard } from './TherapistUtilizationCard';
import { CohortRetentionTable } from './CohortRetentionTable';

const JourneyHistogram = React.lazy(() => import('./JourneyHistogram'));

interface Props {
  startDate: string;
  endDate: string;
}

export const MetaPerformancePanel: React.FC<Props> = ({ startDate, endDate }) => {
  const { toast } = useUiFeedback();
  const [report, setReport] = useState<MetaPerformanceReport | null>(null);
  const [loading, setLoading] = useState(true);

  // Biaya iklan terpisah kanal LPWA vs CTWA
  const [lpwaSpend, setLpwaSpend] = useState('');
  const [ctwaSpend, setCtwaSpend] = useState('');
  const [isSavingSpend, setIsSavingSpend] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Konfigurasi analitik per-tenant
  const [cohortStartMonth, setCohortStartMonth] = useState('');
  const [excludedCohortMonths, setExcludedCohortMonths] = useState('');
  const [dailySlots, setDailySlots] = useState('');
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  const activeMonth = startDate.slice(0, 7);

  // Ambil pengaturan biaya iklan dari database saat bulan berubah
  useEffect(() => {
    let cancelled = false;
    async function loadSettings() {
      try {
        const res = await fetchMetaPerformanceSettings();
        if (cancelled) return;
        if (res?.success && res.data?.monthlySpends) {
          const cfg = res.data.monthlySpends[activeMonth];
          if (cfg) {
            setLpwaSpend(cfg.lpwa !== undefined && cfg.lpwa !== null ? String(cfg.lpwa) : '');
            setCtwaSpend(cfg.ctwa !== undefined && cfg.ctwa !== null ? String(cfg.ctwa) : '');
          } else {
            setLpwaSpend('');
            setCtwaSpend('');
          }
        }
        if (res?.success && res.data) {
          if (res.data.cohortStartMonth !== undefined) setCohortStartMonth(res.data.cohortStartMonth || '');
          if (Array.isArray(res.data.excludedCohortMonths)) setExcludedCohortMonths(res.data.excludedCohortMonths.join(', '));
          if (res.data.dailySlotsPerTherapist !== undefined && res.data.dailySlotsPerTherapist !== null) {
            setDailySlots(String(res.data.dailySlotsPerTherapist));
          }
        }
      } catch {
        // Degrade silent
      }
    }
    loadSettings();
    return () => {
      cancelled = true;
    };
  }, [activeMonth]);

  const totalSpendNum = (Number(lpwaSpend) || 0) + (Number(ctwaSpend) || 0);

  const load = useCallback(
    async (spend?: number) => {
      setLoading(true);
      try {
        const res = await fetchMetaPerformance({
          startDate,
          endDate,
          spend: spend !== undefined && spend > 0 ? spend : undefined,
        });
        if (res?.success && res.data) {
          setReport(res.data as MetaPerformanceReport);
        } else {
          toast('Gagal memuat laporan performa iklan.', 'error');
        }
      } catch (err: any) {
        toast(`Gagal memuat performa iklan: ${err.message}`, 'error');
      } finally {
        setLoading(false);
      }
    },
    [startDate, endDate, toast],
  );

  // Simpan konfigurasi analitik per-tenant ke DB
  const handleSaveConfig = async () => {
    setIsSavingConfig(true);
    try {
      const cleanStart = cohortStartMonth.trim() || null;
      const cleanExcluded = excludedCohortMonths
        .split(',')
        .map((m) => m.trim())
        .filter((m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m));
      const cleanSlots = dailySlots.trim() ? Number(dailySlots) : null;

      await updateMetaPerformanceSettings({
        cohortStartMonth: cleanStart,
        excludedCohortMonths: cleanExcluded,
        dailySlotsPerTherapist: cleanSlots && cleanSlots > 0 ? cleanSlots : null,
      });
      toast('Konfigurasi analitik tenant berhasil disimpan', 'success');
      load(totalSpendNum > 0 ? totalSpendNum : undefined);
    } catch (err: any) {
      toast(`Gagal menyimpan konfigurasi analitik: ${err.message}`, 'error');
    } finally {
      setIsSavingConfig(false);
    }
  };

  // Simpan biaya iklan ke DB
  const handleSaveSpends = async () => {
    setIsSavingSpend(true);
    setSaveSuccess(false);
    try {
      const lpNum = Number(lpwaSpend) || 0;
      const ctNum = Number(ctwaSpend) || 0;
      await updateMetaPerformanceSettings({
        monthlySpends: {
          [activeMonth]: {
            lpwa: lpNum,
            ctwa: ctNum,
          },
        },
      });
      setSaveSuccess(true);
      toast(`Biaya iklan bulan ${activeMonth} berhasil disimpan permanen ke database`, 'success');
      setTimeout(() => setSaveSuccess(false), 2500);
      load(lpNum + ctNum);
    } catch (err: any) {
      toast(`Gagal menyimpan biaya iklan: ${err.message}`, 'error');
    } finally {
      setIsSavingSpend(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => {
      load(totalSpendNum > 0 ? totalSpendNum : undefined);
    }, 300);
    return () => clearTimeout(t);
  }, [startDate, endDate, load, totalSpendNum]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[#667781]">
          Rentang: <span className="font-semibold text-[#111b21]">{startDate}</span> s/d{' '}
          <span className="font-semibold text-[#111b21]">{endDate}</span>
        </p>
        <button
          onClick={() => load(totalSpendNum > 0 ? totalSpendNum : undefined)}
          disabled={loading}
          className="px-3.5 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-xs disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          <span>Segarkan</span>
        </button>
      </div>

      {report?.meta?.dbNote && (
        <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          <AlertTriangle size={14} className="text-amber-600 mt-0.5 shrink-0" />
          <span>{report.meta.dbNote}</span>
        </div>
      )}
      {report?.meta?.revenueBasis?.truncated && (
        <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          <AlertTriangle size={14} className="text-amber-600 mt-0.5 shrink-0" />
          <span>Data melebihi batas 5.000 baris per kategori — angka ditampilkan sebagian (truncated).</span>
        </div>
      )}

      <SpendCalculator
        lpwaSpend={lpwaSpend}
        ctwaSpend={ctwaSpend}
        onLpwaSpendChange={setLpwaSpend}
        onCtwaSpendChange={setCtwaSpend}
        onSaveSpends={handleSaveSpends}
        isSaving={isSavingSpend}
        saveSuccess={saveSuccess}
        report={report}
      />

      {/* Konfigurasi Analitik Tenant (Collapsible) */}
      <div className="bg-white border border-[#e9edef] rounded-2xl shadow-xs overflow-hidden">
        <button
          type="button"
          onClick={() => setIsConfigOpen(!isConfigOpen)}
          className="w-full px-4 py-3 flex items-center justify-between text-xs font-bold text-[#111b21] hover:bg-[#f8fafc] transition"
        >
          <div className="flex items-center gap-2">
            <Settings size={15} className="text-[#008069]" />
            <span>Konfigurasi Analitik Tenant (Periode Kohort &amp; Kapasitas Terapis)</span>
          </div>
          {isConfigOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {isConfigOpen && (
          <div className="px-4 pb-4 pt-2 border-t border-[#f0f2f5] space-y-3 bg-[#fafbfc]">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-[10.5px] uppercase font-bold text-[#667781]">Mulai Bulan Kohort</label>
                <input
                  type="month"
                  value={cohortStartMonth}
                  onChange={(e) => setCohortStartMonth(e.target.value)}
                  placeholder="YYYY-MM"
                  className="w-full bg-white border border-[#d1d7db] rounded-xl px-2.5 py-1.5 text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                />
                <p className="text-[9.5px] text-[#8696a0]">Kosong = tanpa batas awal</p>
              </div>

              <div className="space-y-1">
                <label className="text-[10.5px] uppercase font-bold text-[#667781]">Bulan Dikecualikan</label>
                <input
                  type="text"
                  value={excludedCohortMonths}
                  onChange={(e) => setExcludedCohortMonths(e.target.value)}
                  placeholder="mis. 2025-08"
                  className="w-full bg-white border border-[#d1d7db] rounded-xl px-2.5 py-1.5 text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs font-mono"
                />
                <p className="text-[9.5px] text-[#8696a0]">Pisahkan dengan koma (YYYY-MM)</p>
              </div>

              <div className="space-y-1">
                <label className="text-[10.5px] uppercase font-bold text-[#667781]">Slot / Terapis / Hari</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={dailySlots}
                  onChange={(e) => setDailySlots(e.target.value)}
                  placeholder="mis. 4"
                  className="w-full bg-white border border-[#d1d7db] rounded-xl px-2.5 py-1.5 text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs font-mono"
                />
                <p className="text-[9.5px] text-[#8696a0]">Kapasitas harian per bidan</p>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={handleSaveConfig}
                disabled={isSavingConfig}
                className="px-4 py-1.5 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-xs disabled:opacity-50"
              >
                <span>{isSavingConfig ? 'Menyimpan...' : 'Simpan Konfigurasi'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {loading && !report ? (
        <div className="bg-white border border-[#e9edef] rounded-2xl p-12 flex flex-col items-center gap-2 text-[#667781]">
          <Loader size={20} className="animate-spin text-[#008069]" />
          <span className="text-xs">Menghitung performa iklan &amp; kohort...</span>
        </div>
      ) : report ? (
        <>
          <KpiGrid report={report} />
          <TherapistUtilizationCard report={report} />
          <FunnelBars report={report} />
          <ChannelTable report={report} />
          <Suspense
            fallback={
              <div className="bg-white border border-[#e9edef] rounded-2xl p-8 flex items-center justify-center text-[#8696a0]">
                <Loader size={16} className="animate-spin text-[#008069] mr-2" /> Memuat grafik...
              </div>
            }
          >
            <JourneyHistogram report={report} />
          </Suspense>
          <CampaignTable report={report} />
          <CohortRetentionTable report={report} />
          <LeakageGrid report={report} />
        </>
      ) : (
        <div className="bg-white border border-[#e9edef] rounded-2xl p-12 text-center shadow-xs space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-[#e8f5f2] text-[#008069] flex items-center justify-center mx-auto">
            <Activity size={24} />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h4 className="text-sm font-bold text-[#111b21]">Belum Ada Data Event Meta Pixel</h4>
            <p className="text-xs text-[#667781] leading-relaxed">
              Sistem belum menerima kiriman event pelacakan iklan pada rentang tanggal ini. Pastikan kampanye iklan Meta aktif dan Meta Pixel ID telah dipasang pada halaman landing page klinik.
            </p>
          </div>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => load(totalSpendNum > 0 ? totalSpendNum : undefined)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-semibold shadow-xs transition"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              <span>Cek Ulang Data</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MetaPerformancePanel;
