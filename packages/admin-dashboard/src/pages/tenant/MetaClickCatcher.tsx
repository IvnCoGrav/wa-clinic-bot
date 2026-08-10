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
    tone === 'ok' ? 'text-emerald-400' : tone === 'warn' ? 'text-amber-400' : tone === 'err' ? 'text-rose-400' : 'text-slate-100';
  return (
    <div className="glass-panel rounded-2xl p-4 flex flex-col gap-1">
      <p className="text-[11px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`text-2xl font-bold ${toneCls}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-500 truncate">{sub}</p>}
    </div>
  );
}

function StatusBadge({ entry }: { entry: ClickEntry }) {
  if (entry.status === 'MATCHED') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        <CheckCircle2 size={11} /> MATCHED
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-500/10 text-slate-400 border border-slate-500/20">
      <Activity size={11} /> PENDING
    </span>
  );
}

function MetaTiny({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <p className="text-[10px]"><span className="text-slate-600 uppercase">{label}:</span> <span className="text-slate-400 font-mono">{value}</span></p>
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

  // Paksa reload kedua sumber data (ringkasan + log klik) pakai filter yang sedang berlaku.
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

  const capi = summary?.capiHealth;
  const circuitOk = capi?.circuitState === 'CLOSED';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <MousePointerClick size={20} className="text-pink-400" /> Meta Click Catcher &amp; CAPI Debug
          </h2>
          <p className="text-sm text-slate-500">Pantau performa iklan Meta Ads, atribusi chat WhatsApp, dan kesehatan Conversion API.</p>
        </div>
        <button
          onClick={handleRefresh}
          className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loadingSummary || loadingClicks ? 'animate-spin' : ''} />
          Muat Ulang
        </button>
      </div>

      {summary?.dbNote && (
        <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
          <AlertTriangle size={14} />
          <span>{summary.dbNote} — menampilkan data fallback.</span>
        </div>
      )}

      {/* ---------------- 1. Summary KPI Cards ---------------- */}
      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Total Ad Clicks" value={summary?.totalClicks ?? '-'} sub="klik iklan Meta tercatat" />
        <StatCard label="Matched WA Chats" value={summary?.matchedChats ?? '-'} tone="ok" sub="klik → chat ter-link tracking code" />
        <StatCard label="WA Conversion Rate" value={summary ? fmtPct(summary.conversionRate) : '-'} tone="ok" sub={`${summary?.matchedChats ?? 0} / ${summary?.totalClicks ?? 0} klik jadi chat`} />
        <StatCard label="CAPI Events Delivered" value={summary?.capiEventsDelivered ?? '-'} tone="warn" sub={`Contact ${summary?.matchedChats ?? 0} + Purchase ${summary?.purchaseEvents ?? 0}`} />
        <StatCard label="Unmatched Drain" value={summary?.unmatchedDrain ?? '-'} tone={summary && summary.unmatchedDrain > 0 ? 'err' : 'default'} sub="klik tanpa pengiriman pesan WA" />
      </section>

      {/* ---------------- 2. Filter Bar ---------------- */}
      <section className="glass-panel rounded-2xl p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1 mb-1"><CalendarDays size={11} /> Dari</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1 mb-1"><CalendarDays size={11} /> Sampai</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1 mb-1"><Activity size={11} /> Status</label>
            <select value={status} onChange={(e) => { setStatus(e.target.value as any); setPage(1); }} className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500">
              <option value="all">Semua</option>
              <option value="matched">MATCHED</option>
              <option value="unmatched">PENDING</option>
            </select>
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1 mb-1"><Tag size={11} /> Tracking Code / Campaign</label>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleApplyFilters()}
              placeholder="Cari kode tracking (mis. a7) atau campaign..."
              className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-pink-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleApplyFilters} className="px-4 py-2 bg-white/5 hover:bg-pink-500/10 border border-white/10 text-slate-300 hover:text-pink-400 rounded-xl text-xs font-bold transition flex items-center gap-2">
              <Search size={13} /> Terapkan
            </button>
            <button onClick={handleResetFilters} className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 rounded-xl text-xs font-medium transition">
              Reset
            </button>
          </div>
        </div>
      </section>

      {/* ---------------- 3. Ad Click Log Table ---------------- */}
      <section className="glass-panel rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <MousePointerClick size={16} className="text-pink-400" /> Log Klik Iklan (atribusi)
          </h3>
          <span className="text-[11px] text-slate-500">{total} klik · halaman {page}/{totalPages}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left uppercase tracking-wider text-slate-500 border-b border-white/5">
                <th className="py-2 pr-3">Tracking</th>
                <th className="py-2 pr-3">Waktu Klik</th>
                <th className="py-2 pr-3">Status Atribusi</th>
                <th className="py-2 pr-3">Pasien</th>
                <th className="py-2 pr-3">UTM</th>
                <th className="py-2">Meta / Browser</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && !loadingClicks && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-500">Belum ada klik iklan pada rentang/filter ini.</td>
                </tr>
              )}
              {loadingClicks && entries.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-500"><Loader size={14} className="inline animate-spin mr-2" />Memuat...</td>
                </tr>
              )}
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-white/5 last:border-0 align-top">
                  <td className="py-2 pr-3">
                    <span className="font-mono font-bold text-pink-400 bg-pink-500/10 border border-pink-500/20 rounded-lg px-2 py-0.5">{e.trackingCode ?? '-'}</span>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-slate-400">{fmtTime(e.createdAt)}</td>
                  <td className="py-2 pr-3">
                    <StatusBadge entry={e} />
                    {e.status === 'MATCHED' && e.matchedAt && (
                      <span className="block text-[10px] text-emerald-500/80 mt-0.5">matched {fmtTime(e.matchedAt)}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {e.customer ? (
                      <div>
                        <p className="text-slate-200 font-medium">{e.customer.name || 'Tanpa nama'}</p>
                        <p className="text-slate-500 font-mono">{e.customer.phone}</p>
                      </div>
                    ) : e.phone ? (
                      <p className="text-slate-600 font-mono">{e.phone}</p>
                    ) : (
                      <span className="text-slate-600">-</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {e.utmCampaign ? (
                      <div className="text-[10px] space-y-0.5">
                        <p className="text-sky-400">@{e.utmCampaign}</p>
                        {e.utmSource && <p className="text-slate-500">{e.utmSource}{e.utmMedium ? ` / ${e.utmMedium}` : ''}</p>}
                        {e.landingUrl && <p className="text-slate-600 truncate max-w-[160px]" title={e.landingUrl}><Globe size={9} className="inline mr-0.5 -mt-px" />{e.landingUrl}</p>}
                      </div>
                    ) : (
                      <span className="text-slate-600">-</span>
                    )}
                  </td>
                  <td className="py-2">
                    <MetaTiny label="fbclid" value={e.fbclid} />
                    <MetaTiny label="fbp" value={e.fbp} />
                    <MetaTiny label="fbc" value={e.fbc} />
                    {e.ipAddress && <p className="text-[10px]"><span className="text-slate-600 uppercase">IP:</span> <span className="text-slate-400 font-mono">{e.ipAddress}</span></p>}
                    {e.userAgent && <p className="text-[10px] text-slate-600 truncate max-w-[220px]" title={e.userAgent}>{e.userAgent}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} loading={loadingClicks} totalItems={total} loadedItems={entries.length} />
      </section>

      {/* ---------------- 4. CAPI Health & Live Tester ---------------- */}
      <section className="glass-panel rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <Zap size={16} className="text-pink-400" /> Meta CAPI Health &amp; Live Tester
          </h3>
          {capi && (
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                circuitOk
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : capi.circuitState === 'HALF_OPEN'
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
              }`}
            >
              <Activity size={11} /> Circuit: {capi.circuitState}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${capi?.pixelIdConfigured ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-white/5 text-slate-400 border-white/10'}`}>
            <ShieldCheck size={11} /> Pixel ID {capi?.pixelIdConfigured ? 'OK' : 'MISSING'}
          </span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${capi?.tokenConfigured ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
            <ShieldCheck size={11} /> Access Token {capi?.tokenConfigured ? 'OK' : 'MISSING'}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-white/5 text-slate-400 border border-white/10">
            <ShieldCheck size={11} /> Sumber: {capi?.source ? capi.source.toUpperCase() : '-'}
          </span>
        </div>

        {capi?.circuitFallbackUsed && (
          <p className="text-[11px] text-amber-400 flex items-center gap-1">
            <AlertTriangle size={11} /> Fallback Circuit Breaker aktif — beberapa request CAPI terakhir difallback (jaringan / rate-limit / server Meta).
          </p>
        )}

        <div className="border-t border-white/5 pt-4">
          <h4 className="text-sm font-bold text-slate-200 mb-3">Live Test Event CAPI</h4>
          <p className="text-[11px] text-slate-500 mb-3">
            Kirim event test ke Meta untuk memastikan Pixel ID &amp; Access Token valid tanpa menunggu transaksi riil. Konfigurasi kredensial di <span className="text-slate-300">Operational Settings → Meta Pixel &amp; CAPI</span>.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">Event</label>
              <select value={testEvent} onChange={(e) => setTestEvent(e.target.value as any)} className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500">
                <option>Contact</option>
                <option>Purchase</option>
                <option>Lead</option>
                <option>ViewContent</option>
                <option>InitiateCheckout</option>
                <option>AddToCart</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">Nilai (opsional)</label>
              <input type="number" value={testValue} onChange={(e) => setTestValue(e.target.value)} placeholder="mis. 150000" className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-pink-500" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">Currency</label>
              <select value={testCurrency} onChange={(e) => setTestCurrency(e.target.value)} className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500">
                <option>IDR</option>
                <option>USD</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">Test Event Code (opsional)</label>
              <input type="text" value={testEventCode} onChange={(e) => setTestEventCode(e.target.value)} placeholder="TESTxxxx (Events Manager)" className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-pink-500" />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleTestCapi}
              disabled={testing}
              className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 disabled:opacity-50"
            >
              {testing ? <Loader size={14} className="animate-spin" /> : <Send size={14} />}
              {testing ? 'Mengirim test...' : 'Kirim Test Event CAPI'}
            </button>
            {testResult && (
              <span className={`text-[11px] inline-flex items-center gap-1 ${testResult.success ? 'text-emerald-400' : 'text-rose-400'}`}>
                {testResult.success ? <CheckCircle2 size={12} /> : <XCircle size={12} />} HTTP {testResult.status ?? '-'}
              </span>
            )}
          </div>

          {testResult && (
            <div className={`mt-3 rounded-xl border px-3 py-2 text-xs ${
              testResult.success ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
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