import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader, RefreshCw } from 'lucide-react';
import { fetchMetaPerformance } from '../../services/api';
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

const TENANT_STORAGE_KEY = 'meta_perf_tenant';
const spendKey = (tenant: string, startDate: string, endDate: string) =>
  `meta_spend:${tenant}:${startDate}_${endDate}`;

/**
 * Panel Performa Iklan & Penjualan (Tab performance). Logika kalkulasi berada di
 * backend `meta-performance-analytics.service.ts`; komponen ini hanya presentasi.
 */
export const MetaPerformancePanel: React.FC<Props> = ({ startDate, endDate }) => {
  const { toast } = useUiFeedback();
  const [report, setReport] = useState<MetaPerformanceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [spendInput, setSpendInput] = useState('');
  // Tenant hanya diketahui setelah load pertama (dari report.meta.tenantId);
  // cache di localStorage agar kunci biaya iklan tenant-aware & bertahan reload.
  const [tenant, setTenant] = useState<string | null>(() => {
    try {
      return localStorage.getItem(TENANT_STORAGE_KEY);
    } catch {
      return null;
    }
  });

  const load = useCallback(
    async (spend: string) => {
      setLoading(true);
      try {
        const parsed = spend.trim() === '' ? undefined : Number(spend);
        const valid = parsed === undefined || (Number.isFinite(parsed) && parsed >= 0);
        const res = await fetchMetaPerformance({
          startDate,
          endDate,
          spend: valid ? parsed : undefined,
        });
        if (res?.success && res.data) {
          const data = res.data as MetaPerformanceReport;
          setReport(data);
          const tid = data.meta?.tenantId;
          if (tid) {
            setTenant(tid);
            try {
              localStorage.setItem(TENANT_STORAGE_KEY, tid);
            } catch {}
          }
        } else toast('Gagal memuat laporan performa iklan.', 'error');
      } catch (err: any) {
        toast(`Gagal memuat performa iklan: ${err.message}`, 'error');
      } finally {
        setLoading(false);
      }
    },
    [startDate, endDate],
  );

  // Pulihkan biaya iklan tersimpan saat tenant/rentang berubah (tanpa menimpa ketikan).
  useEffect(() => {
    if (!tenant) return;
    try {
      const saved = localStorage.getItem(spendKey(tenant, startDate, endDate));
      setSpendInput(saved ?? '');
    } catch {}
  }, [tenant, startDate, endDate]);

  // Simpan biaya iklan per tenant+rentang.
  useEffect(() => {
    if (!tenant) return;
    try {
      const key = spendKey(tenant, startDate, endDate);
      if (spendInput.trim() === '') localStorage.removeItem(key);
      else localStorage.setItem(key, spendInput);
    } catch {}
  }, [tenant, startDate, endDate, spendInput]);

  useEffect(() => {
    const t = setTimeout(() => load(spendInput), spendInput === '' ? 0 : 400);
    return () => clearTimeout(t);
  }, [startDate, endDate, spendInput, load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[#667781]">
          Rentang: <span className="font-semibold text-[#111b21]">{startDate}</span> s/d{' '}
          <span className="font-semibold text-[#111b21]">{endDate}</span>
        </p>
        <button
          onClick={() => load(spendInput)}
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
          <span>Data melebihi batas {report.meta.revenueBasis.truncated ? '5.000' : ''} baris per kategori — angka ditampilkan sebagian (truncated).</span>
        </div>
      )}

      <SpendCalculator spendInput={spendInput} onSpendChange={setSpendInput} report={report} />

      {loading && !report ? (
        <div className="bg-white border border-[#e9edef] rounded-2xl p-12 flex flex-col items-center gap-2 text-[#667781]">
          <Loader size={20} className="animate-spin text-[#008069]" />
          <span className="text-xs">Menghitung performa iklan...</span>
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
        <div className="bg-white border border-[#e9edef] rounded-2xl p-12 text-center text-sm text-[#8696a0]">
          Tidak ada data untuk ditampilkan.
        </div>
      )}
    </div>
  );
};

export default MetaPerformancePanel;
