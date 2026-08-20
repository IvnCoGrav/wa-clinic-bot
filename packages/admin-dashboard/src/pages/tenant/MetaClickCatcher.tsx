import React, { useEffect, useState, useCallback } from 'react';
import { apiRequest, fetchMetaClicks, fetchMetaSummary, testCapiEvent } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import { Pagination } from '../../components/common/Pagination';
import {
  MousePointerClick,
  RefreshCw,
  Search,
  Zap,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Activity,
  Send,
  Loader,
  CalendarDays,
  Globe,
  Tag,
} from 'lucide-react';

// ---------------------------------------------------------------- Types
interface ClickEntry {
  id: string;
  trackingCode: string | null;
  fbclid: string | null;
  fbp: string | null;
  fbc: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  landingUrl: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  phone: string | null;
  matchedAt: string | null;
  createdAt: string;
  status: 'MATCHED' | 'PENDING';
  customer: { id: string; name: string | null; phone: string | null } | null;
}

interface MetaSummary {
  totalClicks: number;
  matchedChats: number;
  unmatchedDrain: number;
  conversionRate: number;
  purchaseEvents: number;
  capiEventsDelivered: number;
  capiNote?: string;
  capiHealth: {
    pixelIdConfigured: boolean;
    tokenConfigured: boolean;
    source: 'db' | 'env' | 'none';
    circuitState: string;
    circuitFallbackUsed: boolean;
  };
  dbNote?: string;
}

interface CapiTestResult {
  success: boolean;
  status: number | null;
  message: string;
  metaErrorCode?: number;
  metaErrorSubcode?: number;
  responseBody?: any;
  pixelIdConfigured: boolean;
  tokenConfigured: boolean;
  source: 'db' | 'env' | 'none';
}

// -------------------------------------------------------------------------------- Helpers
const fmtTime = (iso?: string | null) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
};

function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function StatCard({ label, value, tone = 'default', sub }: { label: string; value: React.ReactNode; tone?: 'ok' | 'warn' | 'err' | 'default'; sub?: React.ReactNode }) {
  const toneCls =
    tone === 'ok' ? 'text-[#008069]' : tone === 'warn' ? 'text-amber-700' : tone === 'err' ? 'text-rose-600' : 'text-[#111b21]';
  return (
    <div className="bg-white border border-[#e9edef] rounded-2xl p-4 flex flex-col gap-1 shadow-xs">
      <p className="text-[11px] uppercase font-bold text-[#667781] tracking-wider">{label}</p>
      <p className={`text-2xl font-extrabold ${toneCls}`}>{value}</p>
      {sub && <p className="text-xs text-[#8696a0] truncate">{sub}</p>}
    </div>
  );
}

function StatusBadge({ entry }: { entry: ClickEntry }) {
  if (entry.status === 'MATCHED') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
        <CheckCircle2 size={11} className="text-emerald-600" /> MATCHED
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
      <Activity size={11} className="text-slate-500" /> PENDING
    </span>
  );
}

function MetaTiny({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <p className="text-[10px]"><span className="text-[#8696a0] uppercase font-bold">{label}:</span> <span className="text-[#111b21] font-mono">{value}</span></p>
  );
}

const fmtPct = (v: number) => `${v.toFixed(2)}%`;

// -------------------------------------------------------------------------------- Page
export const MetaClickCatcher: React.FC = () => {
  const { toast } = useUiFeedback();

  // Summary
  const [summary, setSummary] = useState<MetaSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);

  // Clicks + filters
  const [entries, setEntries] = useState<ClickEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingClicks, setLoadingClicks] = useState(true);

  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return toDateInput(d);
  });
  const [endDate, setEndDate] = useState(() => toDateInput(new Date()));
  const [status, setStatus] = useState<'all' | 'matched' | 'unmatched'>('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [utmCampaign, setUtmCampaign] = useState('');
  const [campaignInput, setCampaignInput] = useState('');

  // CAPI tester
  const [testEvent, setTestEvent] = useState<'Contact' | 'Purchase' | 'Lead' | 'ViewContent'>('Contact');
  const [testValue, setTestValue] = useState<string>('');
  const [testCurrency, setTestCurrency] = useState('IDR');
  const [testEventCode, setTestEventCode] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<CapiTestResult | null>(null);

  const loadSummary = useCallback(async (sDate: string, eDate: string) => {
    setLoadingSummary(true);
    try {
      const res = await fetchMetaSummary({ startDate: sDate, endDate: eDate });
      if (res && res.data) setSummary(res.data);
    } catch (err: any) {
      toast(`Gagal memuat ringkasan Meta: ${err.message}`, 'error');
    } finally {
      setLoadingSummary(false);
    }
  }, []);

  const loadClicks = useCallback(async (filters: { startDate: string; endDate: string; status: string; search: string; utmCampaign: string; page: number }) => {
    setLoadingClicks(true);
    try {
      const res = await fetchMetaClicks({
        page: filters.page,
        pageSize: 15,
        status: filters.status as any,
        startDate: filters.startDate,
        endDate: filters.endDate,
        search: filters.search || undefined,
        utmCampaign: filters.utmCampaign || undefined,
      });
      if (res?.success) {
        setEntries(res.data?.entries || []);
        setTotal(res.data?.total || 0);
        setTotalPages(res.data?.totalPages || 1);
      }
    } catch (err: any) {
      toast(`Gagal memuat log klik Meta: ${err.message}`, 'error');
    } finally {
      setLoadingClicks(false);
    }
  }, []);

  useEffect(() => {
    loadSummary(startDate, endDate);
  }, [startDate, endDate, loadSummary]);

  useEffect(() => {
    loadClicks({ startDate, endDate, status, search, utmCampaign, page });
  }, [startDate, endDate, status, search, utmCampaign, page, loadClicks]);

  const handleApplyFilters = () => {
    setSearch(searchInput.trim());
    setUtmCampaign(campaignInput.trim());
    setPage(1);
  };

  // Paksa reload kedua sumber data pakai filter yang sedang berlaku.
  const handleRefresh = () => {
    loadSummary(startDate, endDate);
    loadClicks({ startDate, endDate, status, search, utmCampaign, page });
  };

  const handleResetFilters = () => {
    setSearchInput('');
    setCampaignInput('');
    setSearch('');
    setUtmCampaign('');
    setStatus('all');
    setPage(1);
  };

  const handleTestCapi = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testCapiEvent({
        eventName: testEvent,
        value: testValue ? Number(testValue) : undefined,
        currency: testCurrency,
        testEventCode: testEventCode.trim() || undefined,
      });
      setTestResult(res?.data || null);
      if (res?.success) {
        toast(`Event test '${testEvent}' dikirim — kredensial valid.`, 'success');
      } else {
        toast(`Test CAPI gagal: ${res?.data?.message || 'Meta menolak event test.'}`, 'error');
      }
    } catch (err: any) {
      toast(`Gagal menjalankan test CAPI: ${err.message}`, 'error');
    } finally {
      setTesting(false);
    }
  };

  const setDatePreset = (preset: 'today' | '7days' | '30days' | 'thisMonth' | 'allTime') => {
    const now = new Date();
    const todayStr = toDateInput(now);
    let startStr = todayStr;

    if (preset === 'today') {
      startStr = todayStr;
    } else if (preset === '7days') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      startStr = toDateInput(d);
    } else if (preset === '30days') {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      startStr = toDateInput(d);
    } else if (preset === 'thisMonth') {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      startStr = toDateInput(d);
    } else if (preset === 'allTime') {
      startStr = '2024-01-01';
    }

    setStartDate(startStr);
    setEndDate(todayStr);
    setPage(1);
  };

  const capi = summary?.capiHealth;
  const circuitOk = capi?.circuitState === 'CLOSED';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-[#e9edef]">
        <div>
          <h2 className="text-xl font-bold text-[#111b21] flex items-center gap-2">
            <MousePointerClick size={22} className="text-[#008069]" /> Meta Click Catcher &amp; CAPI Debug
          </h2>
          <p className="text-xs text-[#667781] mt-0.5">Pantau performa iklan Meta Ads, atribusi chat WhatsApp, dan kesehatan Conversion API.</p>
        </div>
        <button
          onClick={handleRefresh}
          className="px-3.5 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-xs disabled:opacity-50"
        >
          <RefreshCw size={13} className={loadingSummary || loadingClicks ? 'animate-spin' : ''} />
          <span>Muat Ulang</span>
        </button>
      </div>

      {summary?.dbNote && (
        <div className="flex items-center gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          <AlertTriangle size={14} className="text-amber-600" />
          <span>{summary.dbNote} — menampilkan data fallback.</span>
        </div>
      )}

      {/* ---------------- 1. Summary KPI Cards ---------------- */}
      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard
          label="Total Page View / Kunjungan"
          value={summary?.totalClicks ?? '-'}
          sub="pengunjung buka link/LP"
        />
        <StatCard
          label="Total Klik CTA"
          value={summary?.totalClicks ?? '-'}
          sub="klik tombol chat / redirect WA"
        />
        <StatCard
          label="Chat WA Masuk (Matched)"
          value={summary?.matchedChats ?? '-'}
          tone="ok"
          sub={`${summary ? fmtPct(summary.conversionRate) : '0%'} dari Klik CTA`}
        />
        <StatCard
          label="Drop-off (Batal Kirim WA)"
          value={summary?.unmatchedDrain ?? '-'}
          tone={summary && summary.unmatchedDrain > 0 ? 'warn' : 'default'}
          sub={`${summary && summary.totalClicks > 0 ? fmtPct((summary.unmatchedDrain / summary.totalClicks) * 100) : '0%'} klik tanpa kirim chat`}
        />
        <StatCard
          label="CAPI Events Delivered"
          value={summary?.capiEventsDelivered ?? '-'}
          tone="ok"
          sub={`Contact ${summary?.matchedChats ?? 0} + Purchase ${summary?.purchaseEvents ?? 0}`}
        />
      </section>

      {/* ---------------- 2. Filter Bar ---------------- */}
      <section className="bg-white border border-[#e9edef] rounded-2xl p-4 shadow-xs space-y-3">
        {/* Preset Shortcuts */}
        <div className="flex items-center gap-1.5 flex-wrap pb-2 border-b border-[#f0f2f5]">
          <span className="text-[11px] font-bold text-[#667781] uppercase mr-1">Shortcut Tanggal:</span>
          <button
            type="button"
            onClick={() => setDatePreset('today')}
            className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#f0f2f5] hover:bg-[#e9edef] text-[#111b21] transition shadow-2xs"
          >
            Hari Ini
          </button>
          <button
            type="button"
            onClick={() => setDatePreset('7days')}
            className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#f0f2f5] hover:bg-[#e9edef] text-[#111b21] transition shadow-2xs"
          >
            7 Hari Terakhir
          </button>
          <button
            type="button"
            onClick={() => setDatePreset('30days')}
            className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#f0f2f5] hover:bg-[#e9edef] text-[#111b21] transition shadow-2xs"
          >
            30 Hari Terakhir
          </button>
          <button
            type="button"
            onClick={() => setDatePreset('thisMonth')}
            className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#f0f2f5] hover:bg-[#e9edef] text-[#111b21] transition shadow-2xs"
          >
            Bulan Ini
          </button>
          <button
            type="button"
            onClick={() => setDatePreset('allTime')}
            className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#f0f2f5] hover:bg-[#e9edef] text-[#111b21] transition shadow-2xs"
          >
            Semua Waktu
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-[11px] uppercase font-bold text-[#667781] flex items-center gap-1"><CalendarDays size={12} className="text-[#008069]" /> Dari</label>
            <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPage(1); }} className="bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] uppercase font-bold text-[#667781] flex items-center gap-1"><CalendarDays size={12} className="text-[#008069]" /> Sampai</label>
            <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setPage(1); }} className="bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] uppercase font-bold text-[#667781] flex items-center gap-1"><Activity size={12} className="text-[#008069]" /> Status</label>
            <select value={status} onChange={(e) => { setStatus(e.target.value as any); setPage(1); }} className="bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs">
              <option value="all">Semua Status</option>
              <option value="matched">MATCHED (Chat Masuk)</option>
              <option value="unmatched">PENDING (Batal / Belum Chat)</option>
            </select>
          </div>
          <div className="flex-1 min-w-[180px] space-y-1">
            <label className="text-[11px] uppercase font-bold text-[#667781] flex items-center gap-1"><Tag size={12} className="text-[#008069]" /> Tracking Code / Campaign</label>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleApplyFilters()}
              placeholder="Cari kode tracking (mis. mh) atau campaign..."
              className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleApplyFilters} className="px-3.5 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-xs">
              <Search size={13} /> <span>Terapkan</span>
            </button>
            <button onClick={handleResetFilters} className="px-3.5 py-2 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#111b21] rounded-xl text-xs font-semibold transition shadow-xs">
              Reset
            </button>
          </div>
        </div>
      </section>

      {/* ---------------- 3. Ad Click Log Table ---------------- */}
      <section className="bg-white border border-[#e9edef] rounded-2xl p-5 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-[#111b21] flex items-center gap-2">
            <MousePointerClick size={16} className="text-[#008069]" /> <span>Log Klik Iklan &amp; Atribusi Pasien</span>
          </h3>
          <span className="text-xs text-[#8696a0]">{total} klik tercatat · halaman {page}/{totalPages}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left uppercase font-bold text-[#667781] border-b border-[#e9edef] bg-[#f8fafc]">
                <th className="py-2.5 px-3">Tracking Code</th>
                <th className="py-2.5 px-3">Waktu Klik</th>
                <th className="py-2.5 px-3">Status Atribusi</th>
                <th className="py-2.5 px-3">Data Pasien (Nama &amp; WhatsApp)</th>
                <th className="py-2.5 px-3">UTM Campaign / Sumber</th>
                <th className="py-2.5 px-3">Meta Tracking Data</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && !loadingClicks && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[#8696a0]">Belum ada data klik iklan pada rentang tanggal/filter ini.</td>
                </tr>
              )}
              {loadingClicks && entries.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[#8696a0]"><Loader size={14} className="inline animate-spin mr-2 text-[#008069]" />Memuat log klik...</td>
                </tr>
              )}
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-[#e9edef] last:border-0 align-top hover:bg-[#f8fafc] transition-colors">
                  <td className="py-2.5 px-3">
                    <span className="font-mono font-bold text-[#008069] bg-[#e8f5f2] border border-[#c2e7e0] rounded-lg px-2 py-0.5">{e.trackingCode ?? '-'}</span>
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap text-[#667781]">{fmtTime(e.createdAt)}</td>
                  <td className="py-2.5 px-3">
                    <StatusBadge entry={e} />
                    {e.status === 'MATCHED' && e.matchedAt && (
                      <span className="block text-[10px] text-emerald-700 mt-0.5 font-medium">terhubung {fmtTime(e.matchedAt)}</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3">
                    {e.customer ? (
                      <div className="space-y-0.5">
                        <p className="text-[#111b21] font-bold text-xs">
                          {e.customer.name || 'Pelanggan WhatsApp'}
                        </p>
                        {e.customer.phone && (
                          <a
                            href={`https://wa.me/${e.customer.phone.replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[#008069] hover:underline font-mono text-[11px] font-semibold inline-flex items-center gap-1"
                            title="Buka Chat WhatsApp Pasien"
                          >
                            <span>📱</span> {e.customer.phone}
                          </a>
                        )}
                      </div>
                    ) : e.phone ? (
                      <div className="space-y-0.5">
                        <p className="text-[#667781] font-semibold text-[11px]">Nomor Terdeteksi</p>
                        <a
                          href={`https://wa.me/${e.phone.replace(/\D/g, '')}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#008069] hover:underline font-mono text-[11px]"
                        >
                          {e.phone}
                        </a>
                      </div>
                    ) : (
                      <span className="text-[#8696a0] text-[11px] italic flex items-center gap-1">
                        <Activity size={11} className="text-slate-400" /> Belum kirim chat WA
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3">
                    {e.utmCampaign ? (
                      <div className="text-[11px] space-y-0.5">
                        <p className="text-[#008069] font-bold">@{e.utmCampaign}</p>
                        {e.utmSource && <p className="text-[#667781]"><span className="font-semibold text-[#111b21]">Source:</span> {e.utmSource}{e.utmMedium ? ` / ${e.utmMedium}` : ''}</p>}
                        {e.landingUrl && <p className="text-[#8696a0] truncate max-w-[180px]" title={e.landingUrl}><Globe size={10} className="inline mr-0.5 text-[#008069]" />{e.landingUrl}</p>}
                      </div>
                    ) : e.utmSource || e.landingUrl ? (
                      <div className="text-[11px] space-y-0.5">
                        {e.utmSource && <p className="text-[#667781]"><span className="font-semibold text-[#111b21]">Source:</span> {e.utmSource}</p>}
                        {e.landingUrl && <p className="text-[#8696a0] truncate max-w-[180px]" title={e.landingUrl}><Globe size={10} className="inline mr-0.5 text-[#008069]" />{e.landingUrl}</p>}
                      </div>
                    ) : (
                      <span className="text-[#8696a0]">-</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3">
                    <MetaTiny label="fbclid" value={e.fbclid} />
                    <MetaTiny label="fbp" value={e.fbp} />
                    <MetaTiny label="fbc" value={e.fbc} />
                    {e.ipAddress && <p className="text-[10px]"><span className="text-[#8696a0] uppercase font-bold">IP:</span> <span className="text-[#111b21] font-mono">{e.ipAddress}</span></p>}
                    {e.userAgent && <p className="text-[10px] text-[#8696a0] truncate max-w-[220px]" title={e.userAgent}>{e.userAgent}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} loading={loadingClicks} totalItems={total} loadedItems={entries.length} />
      </section>

      {/* ---------------- 4. CAPI Health & Live Tester ---------------- */}
      <section className="bg-white border border-[#e9edef] rounded-2xl p-5 space-y-4 shadow-xs">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#111b21] flex items-center gap-2">
            <Zap size={16} className="text-[#008069]" /> <span>Meta CAPI Health &amp; Live Tester</span>
          </h3>
          {capi && (
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                circuitOk
                  ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                  : capi.circuitState === 'HALF_OPEN'
                  ? 'bg-amber-100 text-amber-800 border-amber-200'
                  : 'bg-rose-100 text-rose-800 border-rose-200'
              }`}
            >
              <Activity size={11} /> Circuit: {capi.circuitState}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border ${capi?.pixelIdConfigured ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>
            <ShieldCheck size={12} className={capi?.pixelIdConfigured ? 'text-emerald-600' : 'text-slate-500'} /> Pixel ID {capi?.pixelIdConfigured ? 'OK' : 'MISSING'}
          </span>
          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border ${capi?.tokenConfigured ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-rose-100 text-rose-800 border-rose-200'}`}>
            <ShieldCheck size={12} className={capi?.tokenConfigured ? 'text-emerald-600' : 'text-rose-600'} /> Access Token {capi?.tokenConfigured ? 'OK' : 'MISSING'}
          </span>
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
            <ShieldCheck size={12} className="text-slate-500" /> Sumber: {capi?.source ? capi.source.toUpperCase() : '-'}
          </span>
        </div>

        {capi?.circuitFallbackUsed && (
          <p className="text-xs text-amber-800 flex items-center gap-1">
            <AlertTriangle size={13} className="text-amber-600" /> Fallback Circuit Breaker aktif — beberapa request CAPI terakhir difallback (jaringan / rate-limit / server Meta).
          </p>
        )}

        <div className="border-t border-[#e9edef] pt-4">
          <h4 className="text-xs font-bold text-[#111b21] mb-2">Live Test Event CAPI</h4>
          <p className="text-xs text-[#667781] mb-3">
            Kirim event test ke Meta untuk memastikan Pixel ID &amp; Access Token valid tanpa menunggu transaksi riil. Konfigurasi kredensial di <span className="text-[#111b21] font-semibold">Operational Settings → Meta Pixel &amp; CAPI</span>.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
            <div className="space-y-1">
              <label className="text-[11px] uppercase font-bold text-[#111b21] block">Event</label>
              <select value={testEvent} onChange={(e) => setTestEvent(e.target.value as any)} className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs">
                <option>Contact</option>
                <option>Purchase</option>
                <option>Lead</option>
                <option>ViewContent</option>
                <option>InitiateCheckout</option>
                <option>AddToCart</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] uppercase font-bold text-[#111b21] block">Nilai (opsional)</label>
              <input type="number" value={testValue} onChange={(e) => setTestValue(e.target.value)} placeholder="mis. 150000" className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs" />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] uppercase font-bold text-[#111b21] block">Currency</label>
              <select value={testCurrency} onChange={(e) => setTestCurrency(e.target.value)} className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs">
                <option>IDR</option>
                <option>USD</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] uppercase font-bold text-[#111b21] block">Test Event Code (opsional)</label>
              <input type="text" value={testEventCode} onChange={(e) => setTestEventCode(e.target.value)} placeholder="TESTxxxx (Events Manager)" className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs" />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleTestCapi}
              disabled={testing}
              className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-xs disabled:opacity-50"
            >
              {testing ? <Loader size={13} className="animate-spin" /> : <Send size={13} />}
              <span>{testing ? 'Mengirim test...' : 'Kirim Test Event CAPI'}</span>
            </button>
            {testResult && (
              <span className={`text-xs inline-flex items-center gap-1 font-semibold ${testResult.success ? 'text-emerald-700' : 'text-rose-600'}`}>
                {testResult.success ? <CheckCircle2 size={13} /> : <XCircle size={13} />} HTTP {testResult.status ?? '-'}
              </span>
            )}
          </div>

          {testResult && (
            <div className={`mt-3 rounded-xl border px-3.5 py-2.5 text-xs shadow-xs ${
              testResult.success ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}>
              {testResult.message}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default MetaClickCatcher;