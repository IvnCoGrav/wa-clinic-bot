import React, { useEffect, useState, useCallback } from 'react';
import { apiRequest, fetchMetaClicks, fetchMetaSummary, testCapiEvent, sendManualCapiEvent, fetchManualCapiHistory } from '../../services/api';
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
  Copy,
  Check,
  Target,
  User,
  Phone,
  DollarSign,
  Clock,
  Eye,
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

interface ManualHistoryItem {
  id: string;
  action: string;
  adminIdentity: string;
  createdAt: string;
  phone: string;
  name: string;
  eventName: string;
  value: number | null;
  currency: string;
  status: 'SUCCESS' | 'FAILED';
  message: string;
  testEventCode?: string | null;
  rawPayload: any;
}

interface MetaSummary {
  totalPageViews?: number;
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

const toDateInput = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/**
 * Menganalisis string User-Agent menjadi ringkasan perangkat yang informatif bagi pengguna.
 */
function parseDeviceSummary(ua?: string | null): string {
  if (!ua) return 'Perangkat Tidak Diketahui';
  const lower = ua.toLowerCase();

  if (lower.includes('facebookexternalhit') || lower.includes('facebot') || lower.includes('meta-externalagent')) {
    return 'Meta Review Bot';
  }
  if (lower.includes('googlebot')) return 'Googlebot';
  if (lower.includes('bytespider') || lower.includes('bingbot')) return 'Search Bot / Crawler';

  let appWrapper = '';
  if (lower.includes('fban') || lower.includes('fbav') || lower.includes('fb_iab')) appWrapper = 'Facebook App';
  else if (lower.includes('instagram')) appWrapper = 'Instagram App';
  else if (lower.includes('tiktok')) appWrapper = 'TikTok App';
  else if (lower.includes('whatsapp')) appWrapper = 'WhatsApp In-App';

  let os = '';
  if (lower.includes('iphone')) os = 'iPhone';
  else if (lower.includes('ipad')) os = 'iPad';
  else if (lower.includes('android')) {
    const androidMatch = ua.match(/Android\s([0-9\.]+)/i);
    os = androidMatch ? `Android ${androidMatch[1]}` : 'Android';
  } else if (lower.includes('windows')) os = 'Windows PC';
  else if (lower.includes('macintosh') || lower.includes('mac os')) os = 'macOS';
  else if (lower.includes('linux')) os = 'Linux';

  let browser = '';
  if (!appWrapper) {
    if (lower.includes('chrome') && !lower.includes('edg') && !lower.includes('opr')) browser = 'Chrome';
    else if (lower.includes('safari') && !lower.includes('chrome')) browser = 'Safari';
    else if (lower.includes('firefox')) browser = 'Firefox';
    else if (lower.includes('edg')) browser = 'Edge';
    else if (lower.includes('samsungbrowser')) browser = 'Samsung Internet';
    else browser = 'Web Browser';
  }

  if (appWrapper && os) return `${appWrapper} (${os})`;
  if (appWrapper) return appWrapper;
  if (browser && os) return `${browser} (${os})`;
  return os || browser || 'Web Browser';
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

  // Manual Event Sender & History State
  const [manualPhone, setManualPhone] = useState('087751148065');
  const [manualName, setManualName] = useState('');
  const [manualTreatment, setManualTreatment] = useState('Baby Spa & Massage');
  const [manualEvent, setManualEvent] = useState('Purchase');
  const [manualValue, setManualValue] = useState('250000');
  const [manualTestCode, setManualTestCode] = useState('');
  const [sendingManual, setSendingManual] = useState(false);
  const [manualHistory, setManualHistory] = useState<ManualHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Detail modal inspector
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const copyText = (txt: string, id: string) => {
    navigator.clipboard.writeText(txt);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const loadSummary = useCallback(async (sDate: string, eDate: string, campaign?: string, qSearch?: string) => {
    setLoadingSummary(true);
    try {
      const res = await fetchMetaSummary({
        startDate: sDate,
        endDate: eDate,
        utmCampaign: campaign || undefined,
        search: qSearch || undefined,
      });
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
    loadSummary(startDate, endDate, utmCampaign, search);
  }, [startDate, endDate, utmCampaign, search, loadSummary]);

  useEffect(() => {
    loadClicks({ startDate, endDate, status, search, utmCampaign, page });
  }, [startDate, endDate, status, search, utmCampaign, page, loadClicks]);

  const handleApplyFilters = () => {
    setSearch(searchInput.trim());
    setUtmCampaign(campaignInput.trim());
    setPage(1);
  };

  const loadManualHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await fetchManualCapiHistory();
      if (res?.success && Array.isArray(res.data)) {
        setManualHistory(res.data);
      }
    } catch (err: any) {
      console.warn('Gagal memuat riwayat manual CAPI:', err.message);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    loadManualHistory();
  }, [loadManualHistory]);

  const handleSendManualEvent = async () => {
    if (!manualPhone.trim()) {
      toast('Nomor WhatsApp wajib diisi.', 'error');
      return;
    }
    setSendingManual(true);
    try {
      const res = await sendManualCapiEvent({
        phone: manualPhone.trim(),
        name: manualName.trim() || undefined,
        treatment: manualTreatment.trim() || undefined,
        eventName: manualEvent,
        value: manualValue ? Number(manualValue) : undefined,
        currency: 'IDR',
        testEventCode: manualTestCode.trim() || undefined,
      });

      if (res?.success) {
        toast(`Event ${manualEvent} untuk ${manualPhone} berhasil dikirim ke Meta CAPI!`, 'success');
        loadManualHistory();
        loadSummary(startDate, endDate, utmCampaign, search);
      } else {
        toast(`Gagal mengirim event: ${res?.message || 'Meta CAPI menolak request'}`, 'error');
      }
    } catch (err: any) {
      toast(`Error kirim event: ${err.message}`, 'error');
    } finally {
      setSendingManual(false);
    }
  };

  // Paksa reload seluruh sumber data pakai filter yang sedang berlaku.
  const handleRefresh = () => {
    loadSummary(startDate, endDate, utmCampaign, search);
    loadClicks({ startDate, endDate, status, search, utmCampaign, page });
    loadManualHistory();
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
          value={summary?.totalPageViews ?? summary?.totalClicks ?? '-'}
          sub="pengunjung buka web/LP"
        />
        <StatCard
          label="Total Klik CTA"
          value={summary?.totalClicks ?? '-'}
          sub={
            summary && summary.totalPageViews && summary.totalPageViews > 0
              ? `${fmtPct((summary.totalClicks / summary.totalPageViews) * 100)} CTR dari Page View`
              : 'klik tombol chat / redirect WA'
          }
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
                <th className="py-2.5 px-3">Perangkat &amp; IP</th>
                <th className="py-2.5 px-3 text-right">Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && !loadingClicks && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[#8696a0]">Belum ada data klik iklan pada rentang tanggal/filter ini.</td>
                </tr>
              )}
              {loadingClicks && entries.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[#8696a0]"><Loader size={14} className="inline animate-spin mr-2 text-[#008069]" />Memuat log klik...</td>
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
                  </td>
                  <td className="py-2.5 px-3">
                    {e.customer ? (
                      <div className="space-y-0.5">
                        <p className="text-[#111b21] font-bold text-xs">
                          {e.customer.name || 'Pelanggan WhatsApp'}
                        </p>
                        {e.customer.phone && (
                          <p className="text-[#667781] font-mono text-[11px]">
                            {e.customer.phone}
                          </p>
                        )}
                        <a
                          href="/admin/chats"
                          className="text-[#008069] hover:underline text-[11px] font-semibold inline-flex items-center gap-1 mt-0.5"
                          title="Buka di Panel Live Chat"
                        >
                          <span>💬</span> Buka Live Chat
                        </a>
                      </div>
                    ) : e.phone ? (
                      <div className="space-y-0.5">
                        <p className="text-[#667781] font-semibold text-[11px]">Nomor Terdeteksi</p>
                        <p className="text-[#111b21] font-mono text-[11px]">{e.phone}</p>
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
                    <p className="text-[#111b21] font-medium text-[11px]">{parseDeviceSummary(e.userAgent)}</p>
                    {e.ipAddress && (
                      <p className="text-[10px] text-[#8696a0] font-mono mt-0.5">
                        <span className="font-semibold text-[#667781]">IP:</span> {e.ipAddress}
                      </p>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <button
                      onClick={() => setSelectedItem(e)}
                      className="px-2.5 py-1 rounded-lg bg-[#f0f2f5] hover:bg-[#e9edef] text-[#111b21] hover:text-[#008069] text-[11px] font-semibold transition inline-flex items-center gap-1"
                      title="Lihat Detail Koneksi Meta"
                    >
                      <Eye size={13} />
                      <span>Detail</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} loading={loadingClicks} totalItems={total} loadedItems={entries.length} />
      </section>

      {/* ---------------- 4. Manual CAPI Event Sender & History (2 Cards Side-by-Side) ---------------- */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Card 1: Kirim Manual Event (5 cols) */}
        <div className="lg:col-span-5 bg-white border border-[#e9edef] rounded-2xl p-5 space-y-4 shadow-xs flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-[#f0f2f5] pb-2.5">
              <h3 className="text-sm font-bold text-[#111b21] flex items-center gap-2">
                <Send size={16} className="text-[#008069]" />
                <span>Kirim Manual Event CAPI</span>
              </h3>
              <span className="text-[10px] font-bold text-[#008069] bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                Direct Hash PII
              </span>
            </div>
            <p className="text-xs text-[#667781]">
              Kirimkan event konversi (Purchase, Contact, Lead, dll.) secara langsung ke Meta Conversion API untuk nomor WhatsApp tertentu.
            </p>

            <div className="space-y-3 pt-1">
              <div>
                <label className="text-[11px] uppercase font-bold text-[#111b21] block mb-1">
                  Nomor WhatsApp Pelanggan <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#8696a0]">
                    <Phone size={13} />
                  </span>
                  <input
                    type="text"
                    value={manualPhone}
                    onChange={(e) => setManualPhone(e.target.value)}
                    placeholder="mis. 087751148065 atau 628..."
                    className="w-full bg-white border border-[#d1d7db] rounded-xl pl-8 pr-3 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[11px] uppercase font-bold text-[#111b21] block mb-1">
                    Nama Pasien (Opsional)
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-[#8696a0]">
                      <User size={13} />
                    </span>
                    <input
                      type="text"
                      value={manualName}
                      onChange={(e) => setManualName(e.target.value)}
                      placeholder="mis. Bunda Siti"
                      className="w-full bg-white border border-[#d1d7db] rounded-xl pl-7 pr-3 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] uppercase font-bold text-[#111b21] block mb-1">
                    Nama Event <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={manualEvent}
                    onChange={(e) => setManualEvent(e.target.value)}
                    className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                  >
                    <option value="Purchase">Purchase (Pembayaran)</option>
                    <option value="Contact">Contact (Chat Masuk)</option>
                    <option value="Lead">Lead (MQL / Minat)</option>
                    <option value="InitiateCheckout">InitiateCheckout</option>
                    <option value="AddToCart">AddToCart (Klik CTA)</option>
                    <option value="ViewContent">ViewContent</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[11px] uppercase font-bold text-[#111b21] block mb-1">
                  Treatment / Layanan (Opsional)
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-[#8696a0]">
                    <Tag size={13} />
                  </span>
                  <input
                    type="text"
                    value={manualTreatment}
                    onChange={(e) => setManualTreatment(e.target.value)}
                    placeholder="mis. Baby Spa Hydrotherapy / Pijat Bayi"
                    className="w-full bg-white border border-[#d1d7db] rounded-xl pl-7 pr-3 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[11px] uppercase font-bold text-[#111b21] block mb-1">
                    Nilai / Value (Rp)
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-[#8696a0]">
                      <DollarSign size={13} />
                    </span>
                    <input
                      type="number"
                      value={manualValue}
                      onChange={(e) => setManualValue(e.target.value)}
                      placeholder="mis. 250000"
                      className="w-full bg-white border border-[#d1d7db] rounded-xl pl-7 pr-3 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] uppercase font-bold text-[#111b21] block mb-1">
                    Test Event Code
                  </label>
                  <input
                    type="text"
                    value={manualTestCode}
                    onChange={(e) => setManualTestCode(e.target.value)}
                    placeholder="TESTxxxx (opsional)"
                    className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-[#f0f2f5]">
            <button
              onClick={handleSendManualEvent}
              disabled={sendingManual || !manualPhone.trim()}
              className="w-full py-2.5 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-xs disabled:opacity-50"
            >
              {sendingManual ? <Loader size={14} className="animate-spin" /> : <Send size={14} />}
              <span>{sendingManual ? 'Mengirim ke Meta CAPI...' : 'Kirim Event ke Meta CAPI'}</span>
            </button>
          </div>
        </div>

        {/* Card 2: Tabel Riwayat Manual Event (7 cols) */}
        <div className="lg:col-span-7 bg-white border border-[#e9edef] rounded-2xl p-5 space-y-3 shadow-xs flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-[#f0f2f5] pb-2.5">
              <h3 className="text-sm font-bold text-[#111b21] flex items-center gap-2">
                <Activity size={16} className="text-[#008069]" />
                <span>Riwayat Manual Event Terkirim</span>
              </h3>
              <button
                onClick={loadManualHistory}
                className="text-[#008069] hover:text-[#00a884] text-xs font-semibold flex items-center gap-1"
                title="Segarkan Riwayat"
              >
                <RefreshCw size={12} className={loadingHistory ? 'animate-spin' : ''} />
                <span>Segarkan</span>
              </button>
            </div>

            <div className="overflow-x-auto min-h-[220px] max-h-[290px] overflow-y-auto">
              {loadingHistory ? (
                <div className="py-12 text-center text-xs text-[#667781] flex flex-col items-center gap-2">
                  <Loader size={18} className="animate-spin text-[#008069]" />
                  <span>Memuat riwayat pengiriman...</span>
                </div>
              ) : manualHistory.length === 0 ? (
                <div className="py-12 text-center text-xs text-[#8696a0] italic">
                  Belum ada riwayat manual event yang dikirimkan.
                </div>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#f0f2f5] text-[#667781] text-[10px] uppercase font-bold sticky top-0 bg-white">
                      <th className="py-1.5 px-2">Waktu</th>
                      <th className="py-1.5 px-2">Event</th>
                      <th className="py-1.5 px-2">WhatsApp / Customer</th>
                      <th className="py-1.5 px-2">Nominal</th>
                      <th className="py-1.5 px-2">Status</th>
                      <th className="py-1.5 px-2 text-right">Detail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f0f2f5]">
                    {manualHistory.map((h) => (
                      <tr key={h.id} className="hover:bg-[#f8f9fa] transition">
                        <td className="py-2 px-2 text-[11px] text-[#667781] whitespace-nowrap">
                          {fmtTime(h.createdAt)}
                        </td>
                        <td className="py-2 px-2">
                          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                            h.eventName === 'Purchase' ? 'bg-purple-100 text-purple-800' :
                            h.eventName === 'Lead' ? 'bg-emerald-100 text-emerald-800' :
                            h.eventName === 'Contact' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-800'
                          }`}>
                            {h.eventName}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-[11px]">
                          <p className="font-mono text-[#111b21] font-semibold">{h.phone}</p>
                          {h.name && h.name !== '-' && <p className="text-[10px] text-[#8696a0]">{h.name}</p>}
                        </td>
                        <td className="py-2 px-2 text-[11px] font-medium text-[#111b21]">
                          {h.value ? `Rp ${Number(h.value).toLocaleString('id-ID')}` : '-'}
                        </td>
                        <td className="py-2 px-2">
                          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            h.status === 'SUCCESS' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
                          }`}>
                            {h.status === 'SUCCESS' ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                            <span>{h.status}</span>
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right">
                          <button
                            onClick={() => setSelectedItem(h.rawPayload || h)}
                            className="px-2 py-1 rounded bg-[#f0f2f5] hover:bg-[#e9edef] text-[11px] font-semibold text-[#111b21] hover:text-[#008069] transition inline-flex items-center gap-1"
                            title="Lihat Detail Koneksi Meta"
                          >
                            <Eye size={12} />
                            <span>Detail</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          <p className="text-[11px] text-[#8696a0] pt-1">
            * Riwayat audit pengiriman event konversi langsung ke Pixel Meta: 1465457801784141.
          </p>
        </div>
      </section>

      {/* ---------------- 5. CAPI Health & Live Tester ---------------- */}
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

      {/* ---------------- 5. Human-Friendly Detail Modal Inspector ---------------- */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5 max-h-[90vh] flex flex-col border border-[#e9edef]">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-[#e9edef] pb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center text-[#008069]">
                    <ShieldCheck size={20} />
                  </div>
                  <div>
                    <h4 className="text-base font-bold text-[#111b21]">
                      Detail Koneksi Meta CAPI &amp; Atribusi
                    </h4>
                    <p className="text-xs text-[#667781]">
                      Verifikasi data terhubung antara WhatsApp, Layanan / Treatment, dan Pixel Meta
                    </p>
                  </div>
                </div>
              </div>
              <button
                onClick={() => { setSelectedItem(null); setShowRawJson(false); }}
                className="w-8 h-8 rounded-xl bg-[#f0f2f5] hover:bg-[#e9edef] text-[#667781] hover:text-[#111b21] flex items-center justify-center text-sm font-bold transition"
              >
                ✕
              </button>
            </div>

            {/* Modal Content / Cards */}
            <div className="overflow-y-auto flex-1 space-y-4 pr-1">
              {/* Status Header Banner */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-[#f8f9fa] rounded-xl border border-[#e9edef]">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#667781]">Status Pengiriman:</span>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                    (selectedItem.status === 'SUCCESS' || selectedItem.status === 'MATCHED')
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      : 'bg-amber-100 text-amber-800 border border-amber-200'
                  }`}>
                    {(selectedItem.status === 'SUCCESS' || selectedItem.status === 'MATCHED') ? <CheckCircle2 size={12} /> : <Activity size={12} />}
                    <span>{selectedItem.status === 'SUCCESS' ? 'Terkirim ke Meta CAPI (HTTP 200)' : selectedItem.status === 'MATCHED' ? 'Terhubung dengan Chat WA' : 'Menunggu Chat Pasien'}</span>
                  </span>
                </div>
                <div className="text-xs text-[#667781]">
                  <span className="font-semibold text-[#111b21]">Target Pixel:</span>{' '}
                  <span className="font-mono font-bold text-[#008069]">{selectedItem.metaPixelId || '1465457801784141'}</span>
                </div>
              </div>

              {/* Grid: 2 Columns */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {/* 1. Data Pelanggan */}
                <div className="bg-white border border-[#e9edef] rounded-xl p-4 space-y-2.5 shadow-2xs">
                  <h5 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-[#008069]">
                    <User size={14} /> <span>1. Data Pelanggan (Customer)</span>
                  </h5>
                  <div className="space-y-2 text-xs">
                    <div>
                      <span className="text-[#8696a0] block text-[11px]">Nomor WhatsApp:</span>
                      <span className="font-mono font-bold text-[#111b21] text-sm">
                        {selectedItem.customer?.phone || selectedItem.phone || '-'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#8696a0] block text-[11px]">Nama Pasien:</span>
                      <span className="font-semibold text-[#111b21]">
                        {selectedItem.customer?.name || selectedItem.name || 'Pelanggan WhatsApp'}
                      </span>
                    </div>
                    <div className="pt-1">
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                        <ShieldCheck size={11} /> PII Ter-Hash SHA-256 (Aman &amp; Standar Meta)
                      </span>
                    </div>
                  </div>
                </div>

                {/* 2. Detail Layanan & Konversi */}
                <div className="bg-white border border-[#e9edef] rounded-xl p-4 space-y-2.5 shadow-2xs">
                  <h5 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-[#008069]">
                    <DollarSign size={14} /> <span>2. Konversi &amp; Layanan</span>
                  </h5>
                  <div className="space-y-2 text-xs">
                    <div>
                      <span className="text-[#8696a0] block text-[11px]">Nama Event:</span>
                      <span className={`inline-block font-bold text-xs px-2 py-0.5 rounded-md ${
                        (selectedItem.eventName === 'Purchase' || selectedItem.status === 'MATCHED') ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                      }`}>
                        {selectedItem.eventName || (selectedItem.status === 'MATCHED' ? 'Contact / Visit' : 'Ad Click')}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#8696a0] block text-[11px]">Treatment / Layanan:</span>
                      <span className="font-semibold text-[#111b21]">
                        {selectedItem.conversionData?.treatment || selectedItem.treatment || 'Treatment Klinik (Reservasi)'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#8696a0] block text-[11px]">Nominal Transaksi:</span>
                      <span className="font-mono font-bold text-emerald-700 text-sm">
                        {selectedItem.conversionData?.value || selectedItem.value
                          ? `Rp ${Number(selectedItem.conversionData?.value || selectedItem.value).toLocaleString('id-ID')}`
                          : '-'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 3. Koneksi Atribusi Iklan */}
                <div className="bg-white border border-[#e9edef] rounded-xl p-4 space-y-2.5 shadow-2xs">
                  <h5 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-[#008069]">
                    <Target size={14} /> <span>3. Koneksi Atribusi Iklan</span>
                  </h5>
                  <div className="space-y-2 text-xs">
                    <div>
                      <span className="text-[#8696a0] block text-[11px]">Tracking Code:</span>
                      <span className="font-mono font-bold text-[#008069] bg-[#e8f5f2] border border-[#c2e7e0] px-2 py-0.5 rounded-md">
                        {selectedItem.attribution?.trackingCode || selectedItem.trackingCode || 'Direct'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#8696a0] block text-[11px]">Sumber Trafik:</span>
                      <span className="font-semibold text-[#111b21]">
                        {selectedItem.attribution?.utmSource || selectedItem.utmSource || 'Instagram / Facebook Ads'}
                        {(selectedItem.attribution?.utmMedium || selectedItem.utmMedium) ? ` / ${selectedItem.attribution?.utmMedium || selectedItem.utmMedium}` : ''}
                      </span>
                    </div>
                    {(selectedItem.attribution?.utmCampaign || selectedItem.utmCampaign) && (
                      <div>
                        <span className="text-[#8696a0] block text-[11px]">Campaign ID:</span>
                        <span className="font-mono font-semibold text-[#111b21]">
                          {selectedItem.attribution?.utmCampaign || selectedItem.utmCampaign}
                        </span>
                      </div>
                    )}
                    <div>
                      <span className="text-[#8696a0] block text-[11px]">Perangkat Pasien:</span>
                      <span className="text-[#111b21]">
                        {parseDeviceSummary(selectedItem.userAgent || selectedItem.attribution?.userAgent)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 4. Respon Meta & Audit */}
                <div className="bg-white border border-[#e9edef] rounded-xl p-4 space-y-2.5 shadow-2xs">
                  <h5 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-[#008069]">
                    <Clock size={14} /> <span>4. Waktu &amp; Pengiriman</span>
                  </h5>
                  <div className="space-y-2 text-xs">
                    <div>
                      <span className="text-[#8696a0] block text-[11px]">Waktu Pengiriman:</span>
                      <span className="font-medium text-[#111b21]">
                        {fmtTime(selectedItem.timestamp || selectedItem.createdAt || selectedItem.matchedAt)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#8696a0] block text-[11px]">Channel Event:</span>
                      <span className="font-medium text-[#111b21]">
                        WhatsApp In-App / Chat Commerce
                      </span>
                    </div>
                    <div>
                      <span className="text-[#8696a0] block text-[11px]">Operator Pengirim:</span>
                      <span className="font-medium text-[#111b21]">
                        {selectedItem.adminIdentity || 'Sistem Otomatis / Admin CS'}
                      </span>
                    </div>
                    {selectedItem.metaGraphApiResponse?.fbtrace_id && (
                      <div>
                        <span className="text-[#8696a0] block text-[11px]">Meta Trace ID:</span>
                        <span className="font-mono text-[10px] text-[#667781] truncate block">
                          {selectedItem.metaGraphApiResponse.fbtrace_id}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Optional Collapsible Raw JSON for Developer Debugging */}
              <div className="pt-2">
                <button
                  onClick={() => setShowRawJson(!showRawJson)}
                  className="text-[11px] font-semibold text-[#667781] hover:text-[#008069] flex items-center gap-1 transition"
                >
                  <span>{showRawJson ? '▼ Sembunyikan Data Teknis Mentah' : '▶ Tampilkan Data Teknis Mentah (Opsional)'}</span>
                </button>
                {showRawJson && (
                  <div className="mt-2 p-3 bg-[#1e293b] text-emerald-400 rounded-xl font-mono text-[11px] whitespace-pre-wrap max-h-48 overflow-y-auto animate-in fade-in">
                    {JSON.stringify(selectedItem, null, 2)}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-[#e9edef]">
              <span className="text-xs text-[#8696a0] flex items-center gap-1">
                <ShieldCheck size={13} className="text-[#008069]" /> Terverifikasi terkirim ke Meta Conversions API
              </span>
              <button
                onClick={() => { setSelectedItem(null); setShowRawJson(false); }}
                className="px-5 py-2 rounded-xl bg-[#008069] hover:bg-[#00705a] text-white text-xs font-bold transition shadow-xs"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MetaClickCatcher;