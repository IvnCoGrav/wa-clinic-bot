import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import {
  ShieldAlert,
  Target,
  Check,
  X,
  RefreshCw,
  AlertTriangle,
  Search,
  Zap,
  Clock,
} from 'lucide-react';

interface QueueItem {
  id: string;
  status: string;
  treatment_detail: string;
  raw_text: string;
  purchase_occurred_at: string | null;
  purchase_event_sent_at: string | null;
  purchase_review_status: string;
  value: number | null;
  customer: { name: string; phone: string };
  attribution: {
    isPaid: boolean;
    trackingCode: string | null;
    landingUrl: string | null;
  };
  utm: { campaign: string | null; source: string | null; medium: string | null };
  ageHours: number;
  daysOld: number;
  expiresInDays: number;
  metaDropRisk: boolean;
}

const formatRupiah = (val: number | null | undefined) => {
  if (val == null || isNaN(val)) return '—';
  return 'Rp ' + Math.round(val).toLocaleString('id-ID');
};

const formatDateTime = (iso: string | null | undefined) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '—';
  }
};

const statusBadge = (s: string | null | undefined) => {
  switch (s) {
    case 'approved':
      return (
        <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold whitespace-nowrap" title="Event Purchase terkirim ke Meta CAPI">
          🟢 Terkirim ke Meta
        </span>
      );
    case 'ignored_outlier':
      return (
        <span className="px-2.5 py-1 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-semibold whitespace-nowrap" title="Event diabaikan sebagai outlier, tidak dikirim ke Meta">
          🔴 Outlier (Abaikan)
        </span>
      );
    default:
      return (
        <span className="px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-semibold whitespace-nowrap" title="Menunggu keputusan admin">
          🟡 Pending Review
        </span>
      );
  }
};

const attributionBadge = (isPaid: boolean) =>
  isPaid ? (
    <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold whitespace-nowrap" title="Pelanggan datang dari iklan (ad_click terpasang)">
      PAID
    </span>
  ) : (
    <span className="px-2 py-0.5 rounded bg-slate-700/60 border border-white/10 text-slate-400 text-[10px] font-bold whitespace-nowrap" title="Tidak ada jejak iklan (organik / direct)">
      ORGANIC
    </span>
  );

const utmText = (u: QueueItem['utm']) => {
  const parts = [u.campaign, u.source, u.medium].filter(Boolean);
  return parts.length ? parts.join(' / ') : '—';
};

export const MetaCapiQueue: React.FC = () => {
  const { toast, confirm } = useUiFeedback();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [mode, setMode] = useState<'pending' | 'all'>('pending');

  const loadQueue = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiRequest('/api/admin/capi-queue');
      const data = Array.isArray(res?.data) ? res.data : [];
      setItems(data);
    } catch (err: any) {
      toast(`Error memuat queue: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const counts = useMemo(() => ({
    total: items.length,
    pending: items.filter((i) => i.purchase_review_status === 'pending').length,
    approved: items.filter((i) => i.purchase_review_status === 'approved').length,
    outlier: items.filter((i) => i.purchase_review_status === 'ignored_outlier').length,
    risk: items.filter((i) => i.metaDropRisk && i.purchase_review_status !== 'approved').length,
  }), [items]);

  const filtered = useMemo(() => {
    let list = items;
    if (mode === 'pending') list = list.filter((i) => i.purchase_review_status === 'pending');
    if (filterStatus !== 'all') list = list.filter((i) => i.purchase_review_status === filterStatus);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (i) =>
          i.customer.name.toLowerCase().includes(q) ||
          i.customer.phone.includes(q) ||
          (i.treatment_detail || '').toLowerCase().includes(q) ||
          utmText(i.utm).toLowerCase().includes(q)
      );
    }
    return list;
  }, [items, mode, filterStatus, searchQuery]);

  const handleApprove = async (item: QueueItem) => {
    const ok = item.metaDropRisk
      ? await confirm({
          title: '⚠️ Event Lebih dari 7 Hari',
          message:
            `Pembayaran terjadi pada ${formatDateTime(item.purchase_occurred_at)} (${item.daysOld} hari lalu). ` +
            'Meta CAPI kemungkinan akan mengabaikan event historis yang terlalu lama. Tetap kirim ke Meta?',
          confirmText: 'Ya, Tetap Kirim',
        })
      : await confirm({
          title: 'Kirim Purchase ke Meta CAPI?',
          message:
            'Event Purchase akan dikirim ke Meta dengan event_time HISTORIS (saat pembayaran) agar attribution akurat. Lanjutkan?',
          confirmText: 'Ya, Kirim',
        });
    if (!ok) return;

    try {
      setLoading(true);
      const res = await apiRequest(`/api/admin/reservation/${item.id}/approve-purchase`, {
        method: 'POST',
      });
      if (res && res.success === false) {
        toast(res.error || 'Gagal approve purchase event.', 'error');
      } else if (res?.warning) {
        toast(`⚠️ ${res.warning}`, 'info');
      } else {
        toast('Purchase event disetujui & dikirim ke Meta CAPI.', 'success');
      }
      loadQueue();
    } catch (err: any) {
      toast(`Error approving purchase: ${err.message}`, 'error');
      setLoading(false);
    }
  };

  const handleReject = async (item: QueueItem) => {
    const ok = await confirm({
      title: 'Tandai sebagai Outlier?',
      message:
        'Event Purchase ini akan diabaikan dan TIDAK dikirim ke Meta CAPI. Data internal tetap tercatat. Lanjutkan?',
      confirmText: 'Ya, Tandai Outlier',
      danger: true,
    });
    if (!ok) return;

    try {
      setLoading(true);
      await apiRequest(`/api/admin/reservation/${item.id}/reject-purchase`, { method: 'POST' });
      toast('Event Purchase ditandai Outlier & tidak dikirim ke Meta.', 'success');
      loadQueue();
    } catch (err: any) {
      toast(`Error rejecting purchase: ${err.message}`, 'error');
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white flex items-center space-x-3">
            <ShieldAlert className="text-pink-400" size={28} />
            <span>Meta CAPI Queue</span>
          </h2>
          <p className="text-slate-400 mt-1">
            Meja kerja advertiser — review &amp; kirim event Purchase ke Meta CAPI sebelum kedaluwarsa (7 hari).
          </p>
        </div>
        <button
          onClick={loadQueue}
          className="flex items-center space-x-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl text-xs font-semibold text-slate-300 transition-colors self-start md:self-auto"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span>Reload</span>
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="glass-panel p-4 rounded-2xl border border-white/5">
          <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Total Event</div>
          <div className="text-2xl font-extrabold text-white mt-1">{counts.total}</div>
        </div>
        <div className="glass-panel p-4 rounded-2xl border border-amber-500/20 bg-amber-500/5">
          <div className="text-[11px] text-amber-400 font-bold uppercase tracking-wider">Pending Review</div>
          <div className="text-2xl font-extrabold text-amber-400 mt-1">{counts.pending}</div>
        </div>
        <div className="glass-panel p-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/5">
          <div className="text-[11px] text-emerald-400 font-bold uppercase tracking-wider">Terkirim</div>
          <div className="text-2xl font-extrabold text-emerald-400 mt-1">{counts.approved}</div>
        </div>
        <div className="glass-panel p-4 rounded-2xl border border-rose-500/20 bg-rose-500/5">
          <div className="text-[11px] text-rose-400 font-bold uppercase tracking-wider">Outlier</div>
          <div className="text-2xl font-extrabold text-rose-400 mt-1">{counts.outlier}</div>
        </div>
        <div className="glass-panel p-4 rounded-2xl border border-pink-500/20 bg-pink-500/5">
          <div className="text-[11px] text-pink-400 font-bold uppercase tracking-wider">Risiko Drop</div>
          <div className="text-2xl font-extrabold text-pink-400 mt-1">{counts.risk}</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="flex space-x-2 p-1 bg-slate-900/60 border border-white/5 rounded-xl w-fit">
          <button
            onClick={() => setMode('pending')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${mode === 'pending' ? 'bg-amber-500 text-white shadow' : 'text-slate-400 hover:text-white'}`}
          >
            Pending Review ({counts.pending})
          </button>
          <button
            onClick={() => setMode('all')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${mode === 'all' ? 'bg-pink-500 text-white shadow' : 'text-slate-400 hover:text-white'}`}
          >
            Semua Event
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          <div className="relative w-full sm:w-64">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500">
              <Search size={14} />
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama, phone, treatment, UTM..."
              className="w-full bg-slate-900/60 border border-white/5 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-pink-500/40"
            />
          </div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-slate-900/60 border border-white/5 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-pink-500/40"
          >
            <option value="all">Semua Status</option>
            <option value="pending">Pending Review</option>
            <option value="approved">Terkirim ke Meta</option>
            <option value="ignored_outlier">Outlier (Abaikan)</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="glass-panel rounded-2xl border border-white/5 overflow-hidden">
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
            <RefreshCw size={18} className="animate-spin mr-2" />
            Memuat queue...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500 text-sm space-y-2">
            <Target size={28} className="text-slate-600" />
            <span>Tidak ada event purchase yang cocok.</span>
            <span className="text-xs text-slate-600">
              Event Purchase yang ditahan untuk review akan muncul di sini.
            </span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="py-3 px-5 font-bold">Pelanggan</th>
                  <th className="py-3 px-5 font-bold">Treatment</th>
                  <th className="py-3 px-5 font-bold">UTM</th>
                  <th className="py-3 px-5 font-bold">Waktu Transaksi</th>
                  <th className="py-3 px-5 font-bold text-right">Nilai</th>
                  <th className="py-3 px-5 font-bold">Umur Event</th>
                  <th className="py-3 px-5 font-bold">Status</th>
                  <th className="py-3 px-5 font-bold">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="py-4 px-5">
                      <div className="flex items-center space-x-2">
                        <div className="min-w-0">
                          <div className="font-bold text-white text-sm truncate max-w-[180px]">
                            {item.customer.name}
                          </div>
                          <div className="text-xs text-slate-400 font-mono">{item.customer.phone}</div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-1.5 mt-1.5">
                        {attributionBadge(item.attribution.isPaid)}
                        {item.attribution.trackingCode && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px] font-mono">
                            {item.attribution.trackingCode}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-5">
                      <div className="text-xs font-semibold text-slate-200">{item.treatment_detail || '—'}</div>
                      {item.raw_text && (
                        <div className="text-[11px] text-slate-500 mt-0.5 truncate max-w-[220px]">
                          {item.raw_text}
                        </div>
                      )}
                    </td>
                    <td className="py-4 px-5">
                      <div className="text-xs text-slate-300 max-w-[160px] truncate">{utmText(item.utm)}</div>
                      {item.attribution.isPaid && !utmText(item.utm).includes('—') && (
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {item.attribution.landingUrl || '—'}
                        </div>
                      )}
                    </td>
                    <td className="py-4 px-5">
                      <div className="text-xs text-slate-300">{formatDateTime(item.purchase_occurred_at)}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {item.ageHours < 1 ? 'baru saja' : item.ageHours < 24 ? `${item.ageHours} jam lalu` : `${item.daysOld} hari lalu`}
                      </div>
                    </td>
                    <td className="py-4 px-5 text-right">
                      <span className="text-sm font-extrabold text-emerald-400">{formatRupiah(item.value)}</span>
                    </td>
                    <td className="py-4 px-5">
                      {item.metaDropRisk ? (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full bg-pink-500/10 border border-pink-500/30 text-pink-400 text-xs font-bold whitespace-nowrap" title="Meta umumnya hanya menerima event &lt; 7 hari">
                          <AlertTriangle size={12} />
                          <span>Drop risk ({item.daysOld}d)</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full bg-slate-800 text-slate-400 text-xs whitespace-nowrap">
                          <Clock size={12} />
                          <span>{item.expiresInDays} hari tersisa</span>
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-5">{statusBadge(item.purchase_review_status)}</td>
                    <td className="py-4 px-5">
                      {item.purchase_review_status === 'pending' ? (
                        <div className="flex flex-col gap-1.5">
                          <button
                            onClick={() => handleApprove(item)}
                            className="flex items-center justify-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold transition shadow shadow-emerald-500/20 whitespace-nowrap"
                            title="Kirim event Purchase ke Meta CAPI dengan event_time saat pembayaran"
                          >
                            <Check size={12} />
                            <span>Approve to Meta</span>
                          </button>
                          <button
                            onClick={() => handleReject(item)}
                            className="flex items-center justify-center space-x-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500 hover:text-white text-xs font-semibold transition whitespace-nowrap"
                            title="Tandai sebagai outlier — event TIDAK dikirim ke Meta"
                          >
                            <X size={12} />
                            <span>Outlier</span>
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-600 flex items-center space-x-1">
                          <Zap size={12} />
                          <span>Selesai</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-600">
        Catatan: event Purchase hanya dapat dikirim ke Meta dalam jendela ±7 hari sejak pembayaran. Event yang
        di-approve di luar jendela berisiko di-drop Meta — keputusan tetap tercatat di database.
      </p>
    </div>
  );
};
