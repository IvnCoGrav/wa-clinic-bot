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
  Code2,
  Copy,
  Sparkles,
  MapPin,
} from 'lucide-react';

interface QueueItem {
  id: string;
  status: string;
  eventType?: string;
  treatment_detail: string;
  raw_text: string;
  purchase_occurred_at: string | null;
  purchase_event_sent_at: string | null;
  purchase_review_status: string;
  value: number | null;
  distanceKm?: string | null;
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
  if (val == null || isNaN(val) || val <= 0) return '—';
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
        <span className="px-2.5 py-1 rounded-full bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-bold whitespace-nowrap" title="Event terkirim ke Meta CAPI">
          🟢 Terkirim
        </span>
      );
    case 'ignored_outlier':
      return (
        <span className="px-2.5 py-1 rounded-full bg-rose-100 border border-rose-200 text-rose-800 text-xs font-bold whitespace-nowrap" title="Event diabaikan sebagai outlier, tidak dikirim ke Meta">
          🔴 Outlier
        </span>
      );
    default:
      return (
        <span className="px-2.5 py-1 rounded-full bg-amber-100 border border-amber-200 text-amber-800 text-xs font-bold whitespace-nowrap" title="Menunggu keputusan admin">
          🟡 Pending Review
        </span>
      );
  }
};

const attributionBadge = (isPaid: boolean) =>
  isPaid ? (
    <span className="px-2 py-0.5 rounded bg-purple-100 border border-purple-200 text-purple-800 text-[10px] font-bold whitespace-nowrap" title="Pelanggan datang dari iklan (ad_click terpasang)">
      PAID
    </span>
  ) : (
    <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-bold whitespace-nowrap" title="Tidak ada jejak iklan (organik / direct)">
      ORGANIC
    </span>
  );

const utmText = (u: QueueItem['utm']) => {
  const parts = [u.campaign, u.source, u.medium].filter(Boolean);
  return parts.length ? parts.join(' / ') : '—';
};

/**
 * Membersihkan format treatment dari durasi [xxm], kurung bayi/anak, dan menyusunnya menjadi daftar bersih bernomor
 */
export function cleanTreatmentList(detail: string): string[] {
  if (!detail || detail === '—') return [];

  // Hapus tag durasi seperti [90m] dan seluruh isi dalam kurung (Bayi: ..., Usia: ...)
  let cleaned = detail.replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, '');

  // Pisahkan berdasarkan pipe '|' (misal Baby: ... | Moms: ...)
  const parts = cleaned.split(/\|/g);
  const items: string[] = [];

  for (const part of parts) {
    let p = part.trim();
    if (!p) continue;

    // Hapus prefix seperti "Baby:", "Moms:", "Kids:", "Pilihan treatment (Moms) :"
    p = p.replace(/^(?:Baby|Moms|Kids|Pilihan treatment\s*(?:\([^)]*\))?)\s*:\s*/i, '');

    // Pisahkan jika ada tanda '+'
    const subParts = p.split(/\s*\+\s*/g);
    for (const sub of subParts) {
      let cleanSub = sub.replace(/\s+/g, ' ').trim();
      cleanSub = cleanSub.replace(/^(?:treatment\s*:\s*)/i, '');
      if (cleanSub && cleanSub.length > 2 && !cleanSub.toLowerCase().startsWith('usia')) {
        // Format huruf kapital awal kata
        const formatted = cleanSub
          .toLowerCase()
          .replace(/(?:^|\s)\S/g, (a) => a.toUpperCase());
        if (!items.includes(formatted)) {
          items.push(formatted);
        }
      }
    }
  }

  return items.length > 0 ? items : [detail.replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, '').trim()];
}

/**
 * Membangun preview payload JSON Meta Graph API CAPI
 */
const buildCapiJsonPayload = (item: QueueItem) => {
  const eventName = item.eventType || 'Purchase';
  const cleanTreatments = cleanTreatmentList(item.treatment_detail);
  const occurredTimestamp = item.purchase_occurred_at
    ? Math.floor(new Date(item.purchase_occurred_at).getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  return {
    event_name: eventName,
    event_time: occurredTimestamp,
    event_id: item.attribution.trackingCode || `${eventName.toLowerCase()}_${item.id.slice(0, 8)}`,
    event_source_url: item.attribution.landingUrl || 'https://kalamomsspa.com',
    action_source: 'system_generated',
    user_data: {
      ph: item.customer.phone ? `sha256(${item.customer.phone})` : undefined,
      fn: item.customer.name ? `sha256(${item.customer.name.split(' ')[0]})` : undefined,
      fbp: item.attribution.isPaid ? 'fb.1.1787293849.1029384756' : undefined,
      fbc: item.attribution.isPaid && item.attribution.trackingCode ? `fb.1.1787293849.${item.attribution.trackingCode}` : undefined,
    },
    custom_data:
      eventName === 'Purchase'
        ? {
            currency: 'IDR',
            value: item.value || 0,
            content_name: cleanTreatments.join(', ') || item.treatment_detail || 'Treatment',
            content_type: 'product',
            contents: cleanTreatments.map((t, idx) => ({
              id: `treatment_${idx + 1}`,
              item_name: t,
              quantity: 1,
            })),
            utm_campaign: item.utm.campaign || undefined,
            utm_source: item.utm.source || undefined,
            utm_medium: item.utm.medium || undefined,
            source: 'CAPI_MODERATION_QUEUE',
          }
        : {
            lead_type: 'MQL_QUALIFIED',
            utm_campaign: item.utm.campaign || undefined,
            utm_source: item.utm.source || undefined,
            utm_medium: item.utm.medium || undefined,
            source: 'CAPI_MODERATION_QUEUE',
          },
  };
};

export const MetaCapiQueue: React.FC = () => {
  const { toast, confirm } = useUiFeedback();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [mode, setMode] = useState<'pending' | 'all'>('pending');

  // JSON Modal State
  const [selectedJsonItem, setSelectedJsonItem] = useState<QueueItem | null>(null);
  const [copiedJson, setCopiedJson] = useState(false);

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
    const eventName = item.eventType || 'Purchase';
    const ok = item.metaDropRisk
      ? await confirm({
          title: '⚠️ Event Lebih dari 7 Hari',
          message:
            `Event terjadi pada ${formatDateTime(item.purchase_occurred_at)} (${item.daysOld} hari lalu). ` +
            'Meta CAPI kemungkinan akan mengabaikan event historis yang terlalu lama. Tetap kirim ke Meta?',
          confirmText: 'Ya, Tetap Kirim',
        })
      : await confirm({
          title: `Kirim ${eventName} ke Meta CAPI?`,
          message:
            `Event ${eventName} akan dikirim ke Meta dengan event_time historis agar attribution akurat. Lanjutkan?`,
          confirmText: 'Ya, Kirim',
        });
    if (!ok) return;

    try {
      setLoading(true);
      const res = await apiRequest(`/api/admin/reservation/${item.id}/approve-purchase`, {
        method: 'POST',
      });
      if (res && res.success === false) {
        toast(res.error || `Gagal approve ${eventName} event.`, 'error');
      } else if (res?.warning) {
        toast(`⚠️ ${res.warning}`, 'info');
      } else {
        toast(`Event ${eventName} disetujui & dikirim ke Meta CAPI.`, 'success');
      }
      loadQueue();
    } catch (err: any) {
      toast(`Error approving event: ${err.message}`, 'error');
      setLoading(false);
    }
  };

  const handleReject = async (item: QueueItem) => {
    const eventName = item.eventType || 'Purchase';
    const ok = await confirm({
      title: 'Tandai sebagai Outlier / Abaikan?',
      message:
        `Event ${eventName} ini akan diabaikan dan TIDAK dikirim ke Meta CAPI. Data internal tetap tercatat. Lanjutkan?`,
      confirmText: 'Ya, Abaikan',
      danger: true,
    });
    if (!ok) return;

    try {
      setLoading(true);
      await apiRequest(`/api/admin/reservation/${item.id}/reject-purchase`, { method: 'POST' });
      toast(`Event ${eventName} ditandai Outlier & tidak dikirim ke Meta.`, 'success');
      loadQueue();
    } catch (err: any) {
      toast(`Error rejecting event: ${err.message}`, 'error');
      setLoading(false);
    }
  };

  const handleCopyJson = (payload: any) => {
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopiedJson(true);
    toast('JSON Payload berhasil disalin ke clipboard!', 'success');
    setTimeout(() => setCopiedJson(false), 3000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-[#e9edef]">
        <div>
          <h2 className="text-xl font-bold text-[#111b21] flex items-center gap-2">
            <ShieldAlert className="text-[#008069]" size={22} />
            <span>Meta CAPI Queue</span>
          </h2>
          <p className="text-xs text-[#667781] mt-0.5">
            Review &amp; kirim event Purchase dan Lead ke Meta CAPI sebelum kedaluwarsa (7 hari).
          </p>
        </div>
        <button
          onClick={loadQueue}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] rounded-xl text-xs font-semibold text-[#111b21] transition shadow-xs self-start sm:self-auto"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin text-[#008069]' : ''} />
          <span>Reload</span>
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-[#e9edef] shadow-xs">
          <div className="text-[11px] text-[#667781] font-bold uppercase tracking-wider">Total Event</div>
          <div className="text-2xl font-extrabold text-[#111b21] mt-1">{counts.total}</div>
        </div>
        <div className="bg-amber-50/60 p-4 rounded-2xl border border-amber-200 shadow-xs">
          <div className="text-[11px] text-amber-800 font-bold uppercase tracking-wider">Pending Review</div>
          <div className="text-2xl font-extrabold text-amber-700 mt-1">{counts.pending}</div>
        </div>
        <div className="bg-emerald-50/60 p-4 rounded-2xl border border-emerald-200 shadow-xs">
          <div className="text-[11px] text-emerald-800 font-bold uppercase tracking-wider">Terkirim</div>
          <div className="text-2xl font-extrabold text-[#008069] mt-1">{counts.approved}</div>
        </div>
        <div className="bg-rose-50/60 p-4 rounded-2xl border border-rose-200 shadow-xs">
          <div className="text-[11px] text-rose-800 font-bold uppercase tracking-wider">Outlier</div>
          <div className="text-2xl font-extrabold text-rose-600 mt-1">{counts.outlier}</div>
        </div>
        <div className="bg-purple-50/60 p-4 rounded-2xl border border-purple-200 shadow-xs">
          <div className="text-[11px] text-purple-800 font-bold uppercase tracking-wider">Risiko Drop</div>
          <div className="text-2xl font-extrabold text-purple-700 mt-1">{counts.risk}</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="flex space-x-1.5 p-1 bg-white border border-[#e9edef] rounded-xl w-fit shadow-xs">
          <button
            onClick={() => setMode('pending')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition shadow-xs ${
              mode === 'pending'
                ? 'bg-amber-500 text-white'
                : 'text-[#667781] hover:text-[#111b21]'
            }`}
          >
            Pending Review ({counts.pending})
          </button>
          <button
            onClick={() => setMode('all')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition shadow-xs ${
              mode === 'all'
                ? 'bg-[#008069] text-white'
                : 'text-[#667781] hover:text-[#111b21]'
            }`}
          >
            Semua Event
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center">
          <div className="relative w-full sm:w-64">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-[#8696a0]">
              <Search size={14} />
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama, phone, treatment, UTM..."
              className="w-full bg-white border border-[#d1d7db] rounded-xl pl-9 pr-3 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs"
            />
          </div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
          >
            <option value="all">Semua Status</option>
            <option value="pending">Pending Review</option>
            <option value="approved">Terkirim ke Meta</option>
            <option value="ignored_outlier">Outlier (Abaikan)</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-[#e9edef] overflow-hidden shadow-xs">
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-[#667781] text-xs">
            <RefreshCw size={18} className="animate-spin mr-2 text-[#008069]" />
            Memuat queue...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-[#8696a0] text-xs space-y-2">
            <Target size={28} className="text-[#8696a0]" />
            <span className="font-semibold text-[#111b21]">Tidak ada event yang cocok.</span>
            <span>
              Event CAPI yang ditahan untuk review akan muncul di sini.
            </span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[#e9edef] text-[11px] uppercase font-bold text-[#667781] bg-[#f8fafc]">
                  <th className="py-3 px-4">Pelanggan</th>
                  <th className="py-3 px-4">Treatment</th>
                  <th className="py-3 px-4">Event &amp; Nilai</th>
                  <th className="py-3 px-4">UTM</th>
                  <th className="py-3 px-4">Waktu Transaksi</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-center">JSON</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const cleanTreatments = cleanTreatmentList(item.treatment_detail);
                  const isPurchase = (item.eventType || 'Purchase') === 'Purchase';

                  return (
                    <tr key={item.id} className="border-b border-[#e9edef] hover:bg-[#f8fafc] transition-colors">
                      {/* 1. Pelanggan & Jarak */}
                      <td className="py-3.5 px-4 align-top">
                        <div className="flex items-center space-x-2">
                          <div className="min-w-0">
                            <div className="font-bold text-[#111b21] text-xs truncate max-w-[170px]">
                              {item.customer.name}
                            </div>
                            <div className="text-xs text-[#667781] font-mono">{item.customer.phone}</div>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                          {attributionBadge(item.attribution.isPaid)}
                          {item.attribution.trackingCode && (
                            <span className="px-1.5 py-0.5 rounded bg-[#e8f5f2] text-[#008069] border border-[#c2e7e0] text-[10px] font-mono font-bold">
                              {item.attribution.trackingCode}
                            </span>
                          )}
                          {item.distanceKm && (
                            <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-semibold flex items-center gap-0.5 whitespace-nowrap">
                              <MapPin size={9} className="text-blue-500" />
                              <span>{item.distanceKm}</span>
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 2. Treatment (Clean Numbered List without times) */}
                      <td className="py-3.5 px-4 align-top">
                        <div className="space-y-1">
                          {cleanTreatments.map((t, idx) => (
                            <div key={idx} className="text-xs font-semibold text-[#111b21] flex items-start space-x-1.5">
                              <span className="text-[#008069] font-bold shrink-0">{idx + 1}.</span>
                              <span className="leading-snug">{t}</span>
                            </div>
                          ))}
                        </div>
                      </td>

                      {/* 3. Event CAPI & Nilai GMV di bawahnya (Tanpa IDR) */}
                      <td className="py-3.5 px-4 align-top">
                        <div
                          className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-extrabold border ${
                            isPurchase
                              ? 'bg-blue-50 border-blue-200 text-blue-800'
                              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                          }`}
                        >
                          <Sparkles size={11} className={isPurchase ? 'text-blue-600' : 'text-emerald-600'} />
                          <span>{item.eventType || 'Purchase'}</span>
                        </div>
                        {item.value && item.value > 0 ? (
                          <div className="text-xs font-extrabold text-[#008069] mt-1.5 font-mono">
                            {formatRupiah(item.value)}
                          </div>
                        ) : null}
                      </td>

                      {/* 4. UTM */}
                      <td className="py-3.5 px-4 align-top">
                        <div className="text-xs text-[#111b21] max-w-[150px] truncate">{utmText(item.utm)}</div>
                        {item.attribution.isPaid && !utmText(item.utm).includes('—') && (
                          <div className="text-[10px] text-[#8696a0] mt-0.5 truncate max-w-[150px]">
                            {item.attribution.landingUrl || '—'}
                          </div>
                        )}
                      </td>

                      {/* 5. Waktu Transaksi */}
                      <td className="py-3.5 px-4 align-top">
                        <div className="text-xs text-[#111b21] font-medium">{formatDateTime(item.purchase_occurred_at)}</div>
                        <div className="text-[10px] text-[#8696a0] mt-0.5">
                          {item.ageHours < 1 ? 'baru saja' : item.ageHours < 24 ? `${item.ageHours} jam lalu` : `${item.daysOld} hari lalu`}
                        </div>
                      </td>

                      {/* 6. Status */}
                      <td className="py-3.5 px-4 align-top">
                        {statusBadge(item.purchase_review_status)}
                        {item.metaDropRisk && item.purchase_review_status === 'pending' && (
                          <div className="mt-1">
                            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-purple-100 text-purple-800 text-[10px] font-bold">
                              <AlertTriangle size={10} />
                              <span>Drop Risk (&gt;7d)</span>
                            </span>
                          </div>
                        )}
                      </td>

                      {/* 7. View JSON Button */}
                      <td className="py-3.5 px-4 text-center align-top">
                        <button
                          onClick={() => setSelectedJsonItem(item)}
                          className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-[#f0f2f5] hover:bg-[#e9edef] text-[#111b21] text-xs font-mono font-bold transition shadow-xs"
                          title="Lihat Payload JSON Meta CAPI"
                        >
                          <Code2 size={13} className="text-[#008069]" />
                          <span>JSON</span>
                        </button>
                      </td>

                      {/* 8. Aksi */}
                      <td className="py-3.5 px-4 text-right align-top">
                        {item.purchase_review_status === 'pending' ? (
                          <div className="flex flex-col gap-1.5 items-end">
                            <button
                              onClick={() => handleApprove(item)}
                              className="flex items-center justify-center space-x-1 px-3 py-1.5 rounded-lg bg-[#008069] hover:bg-[#00a884] text-white text-xs font-bold transition shadow-xs whitespace-nowrap"
                              title="Kirim event ke Meta CAPI dengan event_time saat transaksi/interaksi"
                            >
                              <Check size={13} />
                              <span>Approve</span>
                            </button>
                            <button
                              onClick={() => handleReject(item)}
                              className="flex items-center justify-center space-x-1 px-3 py-1 rounded-lg bg-white hover:bg-rose-50 border border-[#d1d7db] hover:border-rose-200 text-[#54656f] hover:text-rose-600 text-xs font-semibold transition shadow-xs whitespace-nowrap"
                              title="Tandai sebagai outlier — event TIDAK dikirim ke Meta"
                            >
                              <X size={12} />
                              <span>Abaikan</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-[#8696a0] inline-flex items-center space-x-1">
                            <Zap size={12} className="text-[#008069]" />
                            <span>Selesai</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 📦 Modal View JSON Payload */}
      {selectedJsonItem && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-[#e9edef] overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#e9edef] bg-[#f8fafc]">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 rounded-xl bg-[#e8f5f2] text-[#008069] border border-[#c2e7e0]">
                  <Code2 size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#111b21]">Meta Graph API CAPI Payload</h3>
                  <p className="text-[11px] text-[#667781]">
                    Event: <span className="font-bold text-[#008069]">{selectedJsonItem.eventType || 'Purchase'}</span> • Pasien: <span className="font-bold">{selectedJsonItem.customer.name}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedJsonItem(null)}
                aria-label="Tutup modal"
                className="text-[#8696a0] hover:text-[#111b21] p-1.5 rounded-xl hover:bg-[#e9edef] transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body: JSON Code */}
            <div className="p-5 flex-1 overflow-y-auto bg-[#1e293b] text-slate-100 font-mono text-xs leading-relaxed">
              <pre className="overflow-x-auto select-all">
                {JSON.stringify(buildCapiJsonPayload(selectedJsonItem), null, 2)}
              </pre>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-5 py-3.5 border-t border-[#e9edef] bg-white">
              <span className="text-[11px] text-[#667781]">
                Data ini yang akan dikirimkan ke endpoint Meta Conversions API.
              </span>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleCopyJson(buildCapiJsonPayload(selectedJsonItem))}
                  className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-[#f0f2f5] hover:bg-[#e9edef] text-[#111b21] text-xs font-bold transition shadow-xs"
                >
                  {copiedJson ? <Check size={14} className="text-[#008069]" /> : <Copy size={14} />}
                  <span>{copiedJson ? 'Tersalin!' : 'Copy JSON'}</span>
                </button>
                <button
                  onClick={() => setSelectedJsonItem(null)}
                  className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] text-white text-xs font-bold rounded-xl transition shadow-xs"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-[#8696a0]">
        Catatan: event Purchase &amp; Lead hanya dapat dikirim ke Meta dalam jendela ±7 hari sejak transaksi/interaksi. Event yang
        di-approve di luar jendela berisiko di-drop Meta — keputusan tetap tercatat di database.
      </p>
    </div>
  );
};
