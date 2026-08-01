import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import {
  Clock,
  Send,
  XCircle,
  Calendar,
  Search,
  Filter,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  User,
  MapPin,
  Sparkles,
  Edit2
} from 'lucide-react';

interface Customer {
  id: string;
  name: string | null;
  phone: string;
  kelurahan: string | null;
  kecamatan: string | null;
  kota: string | null;
  status: string;
}

interface FollowUpItem {
  id: string;
  type: string; // NO_PURCHASE | NEXT_TREATMENT
  stage: number;
  scheduled_at: string;
  sent_at: string | null;
  status: string; // PENDING | QUEUED | SENT | CANCELLED | FAILED
  customer: Customer | null;
}

export const FollowUpQueue: React.FC = () => {
  const [followUps, setFollowUps] = useState<FollowUpItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: 'cancel' | 'send'; id: string } | null>(null);

  // Reschedule Modal
  const [rescheduleModal, setRescheduleModal] = useState<{ open: boolean; item?: FollowUpItem; newDate?: string }>({ open: false });

  const loadFollowUps = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (typeFilter) params.append('type', typeFilter);
      if (search) params.append('search', search);

      const endpoint = `follow-ups${params.toString() ? `?${params.toString()}` : ''}`;
      const res = await apiRequest(endpoint);
      const list = Array.isArray(res) ? res : (res?.data || []);
      setFollowUps(list);
    } catch (err: any) {
      console.warn('Gagal load follow-ups:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFollowUps();
  }, [statusFilter, typeFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadFollowUps();
  };

  const handleSendNow = async (id: string) => {
    setActionLoading(id);
    try {
      await apiRequest(`follow-ups/${id}/send-now`, { method: 'POST' });
      setToastMsg({ type: 'success', text: 'Follow-up berhasil dikirim!' });
      loadFollowUps();
    } catch (err: any) {
      setToastMsg({ type: 'error', text: `Gagal mengirim: ${err.message}` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (id: string) => {
    setActionLoading(id);
    try {
      await apiRequest(`follow-ups/${id}/cancel`, { method: 'PATCH' });
      setToastMsg({ type: 'success', text: 'Follow-up berhasil dibatalkan.' });
      loadFollowUps();
    } catch (err: any) {
      setToastMsg({ type: 'error', text: `Gagal membatalkan: ${err.message}` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRescheduleSave = async () => {
    if (!rescheduleModal.item || !rescheduleModal.newDate) return;
    setActionLoading(rescheduleModal.item.id);
    try {
      await apiRequest(`follow-ups/${rescheduleModal.item.id}/reschedule`, {
        method: 'PATCH',
        body: JSON.stringify({ scheduledAt: rescheduleModal.newDate }),
      });
      setRescheduleModal({ open: false });
      loadFollowUps();
    } catch (err: any) {
      setToastMsg({ type: 'error', text: `Gagal reschedule: ${err.message}` });
    } finally {
      setActionLoading(null);
    }
  };

  const formatDateTime = (isoStr: string) => {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return { date: '-', time: '-' };
    const date = d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
    const time = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';
    return { date, time };
  };

  const getTypeLabel = (type: string, stage: number) => {
    if (type === 'NO_PURCHASE') {
      const days = [3, 7, 14];
      return {
        label: `Belum Purchase (+${days[stage - 1] || stage} Hari)`,
        color: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      };
    }
    if (type === 'NEXT_TREATMENT') {
      return {
        label: `Treatment Lanjutan (+${stage} Bulan)`,
        color: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
      };
    }
    return { label: `${type} Stage ${stage}`, color: 'bg-slate-500/10 text-slate-400 border-slate-500/20' };
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center space-x-1"><Clock size={10} /><span>PENDING</span></span>;
      case 'SENT':
        return <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center space-x-1"><CheckCircle size={10} /><span>SENT</span></span>;
      case 'CANCELLED':
        return <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-slate-500/10 text-slate-400 border border-slate-500/20 flex items-center space-x-1"><XCircle size={10} /><span>CANCELLED</span></span>;
      case 'FAILED':
        return <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 flex items-center space-x-1"><AlertCircle size={10} /><span>FAILED</span></span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-slate-500/10 text-slate-400">{status}</span>;
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white flex items-center space-x-3">
            <Clock className="text-pink-400" />
            <span>Follow-Up & Reminder Queue</span>
          </h2>
          <p className="text-slate-400 mt-1">
            Antrian otomatis follow-up belum purchase, treatment lanjutan, dan reminder jadwal
          </p>
        </div>
        <button
          onClick={loadFollowUps}
          className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white transition flex items-center space-x-1.5"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span className="text-xs font-bold">Refresh</span>
        </button>
      </div>

      {/* Filters & Search Bar */}
      <div className="glass-panel border border-white/5 rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center space-x-3 w-full md:w-auto">
          <Filter size={16} className="text-pink-400 flex-shrink-0" />
          
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="p-2 bg-slate-950 border border-white/10 rounded-xl text-xs text-white focus:outline-none"
          >
            <option value="">Semua Status</option>
            <option value="PENDING">PENDING (Jadwal Mendatang)</option>
            <option value="SENT">SENT (Sudah Terkirim)</option>
            <option value="CANCELLED">CANCELLED (Dibatalkan)</option>
            <option value="FAILED">FAILED (Gagal)</option>
          </select>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="p-2 bg-slate-950 border border-white/10 rounded-xl text-xs text-white focus:outline-none"
          >
            <option value="">Semua Tipe</option>
            <option value="NO_PURCHASE">Belum Purchase (+3, +7, +14 Hari)</option>
            <option value="NEXT_TREATMENT">Treatment Lanjutan (+1, +2, +3 Bulan)</option>
          </select>
        </div>

        <form onSubmit={handleSearchSubmit} className="flex items-center space-x-2 w-full md:w-auto">
          <div className="relative w-full md:w-64">
            <Search size={14} className="absolute left-3 top-3 text-slate-500" />
            <input
              type="text"
              placeholder="Cari nama / HP / kelurahan..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-white/10 rounded-xl text-xs text-white"
            />
          </div>
          <button
            type="submit"
            className="px-3 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold transition"
          >
            Cari
          </button>
        </form>
      </div>

      {/* Main Table */}
      <div className="glass-panel border border-white/5 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/5 bg-slate-900/40">
                <th className="px-4 py-3 text-[9px] uppercase font-black text-slate-500">Tanggal Kirim (`date_send`)</th>
                <th className="px-4 py-3 text-[9px] uppercase font-black text-slate-500">Jam (`time_send`)</th>
                <th className="px-4 py-3 text-[9px] uppercase font-black text-slate-500">Tipe & Stage</th>
                <th className="px-4 py-3 text-[9px] uppercase font-black text-slate-500">Customer & No. HP</th>
                <th className="px-4 py-3 text-[9px] uppercase font-black text-slate-500">Lokasi / Alamat</th>
                <th className="px-4 py-3 text-[9px] uppercase font-black text-slate-500">Rotasi Template</th>
                <th className="px-4 py-3 text-[9px] uppercase font-black text-slate-500">Status</th>
                <th className="px-4 py-3 text-[9px] uppercase font-black text-slate-500 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-xs text-slate-500">
                    <RefreshCw className="animate-spin mx-auto text-pink-400 mb-2" size={24} />
                    <span>Memuat antrian follow-up...</span>
                  </td>
                </tr>
              ) : followUps.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-xs text-slate-500">
                    Tidak ada antrian follow-up yang sesuai filter.
                  </td>
                </tr>
              ) : (
                followUps.map((fu) => {
                  const { date, time } = formatDateTime(fu.scheduled_at);
                  const typeInfo = getTypeLabel(fu.type, fu.stage);
                  const c = fu.customer;

                  return (
                    <tr key={fu.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                      {/* Date */}
                      <td className="px-4 py-3 text-xs font-bold text-white flex items-center space-x-1.5">
                        <Calendar size={12} className="text-pink-400 flex-shrink-0" />
                        <span>{date}</span>
                      </td>

                      {/* Time */}
                      <td className="px-4 py-3 text-xs font-mono text-slate-300">
                        {time}
                      </td>

                      {/* Type & Stage */}
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${typeInfo.color}`}>
                          {typeInfo.label}
                        </span>
                      </td>

                      {/* Customer */}
                      <td className="px-4 py-3">
                        <div className="flex items-center space-x-1.5">
                          <User size={12} className="text-slate-500 flex-shrink-0" />
                          <span className="text-xs font-bold text-white">{c?.name || 'Bunda'}</span>
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono ml-4">{c?.phone}</div>
                      </td>

                      {/* Location */}
                      <td className="px-4 py-3 text-xs text-slate-300">
                        <div className="flex items-center space-x-1">
                          <MapPin size={10} className="text-pink-400 flex-shrink-0" />
                          <span>{c?.kelurahan || '-'}, {c?.kecamatan || '-'}</span>
                        </div>
                      </td>

                      {/* Template Rolling */}
                      <td className="px-4 py-3 text-[10px] text-slate-400 flex items-center space-x-1">
                        <Sparkles size={10} className="text-amber-400 flex-shrink-0" />
                        <span>Varian #{((fu.stage - 1) % 3) + 1} (Auto)</span>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">{getStatusBadge(fu.status)}</td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end space-x-1">
                          {fu.status === 'PENDING' && (
                            <>
                              <button
                                onClick={() => setConfirmAction({ type: 'send', id: fu.id })}
                                disabled={actionLoading === fu.id}
                                className="p-1.5 rounded bg-pink-500/10 hover:bg-pink-500/20 text-pink-400 text-[10px] font-bold flex items-center space-x-1 transition"
                                title="Kirim Sekarang"
                              >
                                <Send size={11} />
                                <span className="hidden md:inline">Kirim</span>
                              </button>
                              <button
                                onClick={() => setRescheduleModal({ open: true, item: fu, newDate: fu.scheduled_at.slice(0, 16) })}
                                disabled={actionLoading === fu.id}
                                className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-slate-400 text-[10px] font-bold flex items-center space-x-1 transition"
                                title="Ubah Jadwal"
                              >
                                <Edit2 size={11} />
                              </button>
                              <button
                                onClick={() => setConfirmAction({ type: 'cancel', id: fu.id })}
                                disabled={actionLoading === fu.id}
                                className="p-1.5 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-[10px] font-bold flex items-center space-x-1 transition"
                                title="Batalkan"
                              >
                                <XCircle size={11} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reschedule Modal */}
      {rescheduleModal.open && rescheduleModal.item && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="glass-panel border border-white/10 rounded-2xl p-6 w-full max-w-md space-y-4">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <Calendar className="text-pink-400" />
              <span>Ubah Jadwal Kirim Follow-Up</span>
            </h3>

            <div className="text-xs text-slate-400 space-y-1">
              <p><strong className="text-white">Customer:</strong> {rescheduleModal.item.customer?.name} ({rescheduleModal.item.customer?.phone})</p>
              <p><strong className="text-white">Tipe:</strong> {rescheduleModal.item.type} Stage {rescheduleModal.item.stage}</p>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-400">Jadwal Kirim Baru</label>
              <input
                type="datetime-local"
                value={rescheduleModal.newDate}
                onChange={(e) => setRescheduleModal({ ...rescheduleModal, newDate: e.target.value })}
                className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-xs text-white"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => setRescheduleModal({ open: false })}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 rounded-xl text-xs font-bold transition"
              >
                Batal
              </button>
              <button
                onClick={handleRescheduleSave}
                className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold transition"
              >
                Simpan Jadwal Baru
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Modal untuk Send Now / Cancel (tanpa window.confirm) */}
      {confirmAction && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="glass-panel border border-white/10 rounded-2xl p-6 w-full max-w-sm space-y-4">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              {confirmAction.type === 'cancel'
                ? <><XCircle className="text-rose-400" /><span>Batalkan Follow-Up?</span></>
                : <><Send className="text-pink-400" /><span>Kirim Sekarang?</span></>
              }
            </h3>
            <p className="text-xs text-slate-400">
              {confirmAction.type === 'cancel'
                ? 'Follow-up ini akan dibatalkan dan tidak akan dikirim otomatis.'
                : 'Pesan akan langsung dikirim sekarang tanpa menunggu jadwal cron.'}
            </p>
            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 rounded-xl text-xs font-bold transition"
              >
                Batal
              </button>
              <button
                onClick={() => {
                  const { type, id } = confirmAction;
                  setConfirmAction(null);
                  if (type === 'cancel') handleCancel(id);
                  else handleSendNow(id);
                }}
                disabled={actionLoading === confirmAction.id}
                className={`px-4 py-2 text-white rounded-xl text-xs font-bold transition ${
                  confirmAction.type === 'cancel'
                    ? 'bg-rose-500 hover:bg-rose-600'
                    : 'bg-pink-500 hover:bg-pink-600'
                }`}
              >
                {actionLoading === confirmAction.id ? 'Memproses...' : (confirmAction.type === 'cancel' ? 'Ya, Batalkan' : 'Ya, Kirim')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMsg && (
        <div className={`fixed bottom-6 right-6 z-[70] px-4 py-3 rounded-xl border text-xs font-bold shadow-xl flex items-center space-x-2 ${
          toastMsg.type === 'success'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
        }`}>
          {toastMsg.type === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
          <span>{toastMsg.text}</span>
          <button onClick={() => setToastMsg(null)} className="ml-2 text-slate-500 hover:text-white">
            <XCircle size={12} />
          </button>
        </div>
      )}
    </div>
  );
};

export default FollowUpQueue;
