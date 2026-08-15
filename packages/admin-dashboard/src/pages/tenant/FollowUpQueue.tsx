import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { Pagination } from '../../components/common/Pagination';
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
  Sparkles,
  Edit2,
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
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: 'cancel' | 'send'; id: string } | null>(null);

  // Reschedule Modal
  const [rescheduleModal, setRescheduleModal] = useState<{ open: boolean; item?: FollowUpItem; newDate?: string }>({ open: false });

  const PAGE_SIZE = 20;

  const loadFollowUps = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (typeFilter) params.append('type', typeFilter);
      if (search) params.append('search', search);
      params.append('page', String(page));
      params.append('pageSize', String(PAGE_SIZE));

      const endpoint = `follow-ups${params.toString() ? `?${params.toString()}` : ''}`;
      const res = await apiRequest(endpoint);
      const list = Array.isArray(res) ? res : (res?.data || []);
      setFollowUps(list);
      setTotalPages(res?.pagination?.totalPages || 1);
      setTotalItems(res?.pagination?.total || 0);
    } catch (err: any) {
      console.warn('Gagal load follow-ups:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFollowUps();
  }, [statusFilter, typeFilter, page]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
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
        return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-rose-600 border border-rose-200 flex w-fit items-center space-x-1"><AlertCircle size={10} /><span>FAILED</span></span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-50 text-slate-600">{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[#111b21] flex items-center space-x-2">
            <Clock className="text-[#008069]" size={22} />
            <span>Follow-Up & Reminder Queue</span>
          </h2>
          <p className="text-xs text-[#667781] mt-0.5">
            Antrian otomatis follow-up belum purchase, treatment lanjutan, dan reminder jadwal
          </p>
        </div>
        <button
          onClick={loadFollowUps}
          className="px-3.5 py-2 rounded-xl bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#111b21] transition flex items-center space-x-1.5 shadow-xs"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin text-[#008069]' : 'text-[#667781]'} />
          <span className="text-xs font-semibold">Refresh</span>
        </button>
      </div>

      {/* Filters & Search Bar */}
      <div className="bg-white border border-[#e9edef] rounded-2xl p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <Filter size={15} className="text-[#008069] flex-shrink-0" />
          
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
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
            className="p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
          >
            <option value="">Semua Tipe</option>
            <option value="NO_PURCHASE">Belum Purchase (+3, +7, +14 Hari)</option>
            <option value="NEXT_TREATMENT">Treatment Lanjutan (+1, +2, +3 Bulan)</option>
          </select>
        </div>

        <form onSubmit={handleSearchSubmit} className="flex items-center space-x-2 w-full md:w-auto">
          <div className="relative w-full md:w-64">
            <Search size={14} className="absolute left-3 top-2.5 text-[#8696a0]" />
            <input
              type="text"
              placeholder="Cari nama / HP / kelurahan..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs"
            />
          </div>
          <button
            type="submit"
            className="px-3.5 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-semibold transition shadow-xs"
          >
            Cari
          </button>
        </form>
      </div>

      {/* Main Table */}
      <div className="bg-white border border-[#e9edef] rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[#111b21]">
            <thead>
              <tr className="border-b border-[#e9edef] bg-[#f8fafc] text-[#667781] font-bold uppercase text-[10px]">
                <th className="px-4 py-3.5">Tanggal Kirim (`date_send`)</th>
                <th className="px-4 py-3.5">Jam (`time_send`)</th>
                <th className="px-4 py-3.5">Tipe & Stage</th>
                <th className="px-4 py-3.5">Customer & No. HP</th>
                <th className="px-4 py-3.5">Rotasi Template</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e9edef]">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-xs text-[#667781]">
                    <RefreshCw className="animate-spin mx-auto text-[#008069] mb-2" size={24} />
                    <span>Memuat antrian follow-up...</span>
                  </td>
                </tr>
              ) : followUps.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-xs text-[#667781]">
                    Tidak ada antrian follow-up yang sesuai filter.
                  </td>
                </tr>
              ) : (
                followUps.map((fu) => {
                  const { date, time } = formatDateTime(fu.scheduled_at);
                  const typeInfo = getTypeLabel(fu.type, fu.stage);
                  const c = fu.customer;

                  return (
                    <tr key={fu.id} className="hover:bg-[#f8fafc] transition-colors">
                      {/* Date */}
                      <td className="px-4 py-3.5 font-bold text-[#111b21]">
                        <div className="flex items-center space-x-1.5">
                          <Calendar size={13} className="text-[#008069] flex-shrink-0" />
                          <span>{date}</span>
                        </div>
                      </td>

                      {/* Time */}
                      <td className="px-4 py-3.5 font-mono text-xs text-[#54656f]">
                        {time}
                      </td>

                      {/* Type & Stage */}
                      <td className="px-4 py-3.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${typeInfo.color}`}>
                          {typeInfo.label}
                        </span>
                      </td>

                      {/* Customer */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center space-x-1.5">
                          <User size={13} className="text-[#8696a0] flex-shrink-0" />
                          <span className="font-bold text-[#111b21]">{c?.name || 'Bunda'}</span>
                        </div>
                        <div className="text-[10px] text-[#667781] font-mono ml-4">{c?.phone}</div>
                      </td>

                      {/* Template Rolling */}
                      <td className="px-4 py-3.5 text-xs text-[#54656f]">
                        <div className="flex items-center space-x-1">
                          <Sparkles size={11} className="text-amber-500 flex-shrink-0" />
                          <span>Varian #{((fu.stage - 1) % 3) + 1} (Auto)</span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5">{getStatusBadge(fu.status)}</td>

                      {/* Actions */}
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end space-x-1">
                          {fu.status === 'PENDING' && (
                            <>
                              <button
                                onClick={() => setConfirmAction({ type: 'send', id: fu.id })}
                                disabled={actionLoading === fu.id}
                                className="p-1.5 rounded-xl bg-[#e8f5f2] hover:bg-[#c2e7e0] border border-[#c2e7e0] text-[#008069] text-xs font-semibold flex items-center space-x-1 transition shadow-xs"
                                title="Kirim Sekarang"
                              >
                                <Send size={12} />
                                <span className="hidden md:inline">Kirim</span>
                              </button>
                              <button
                                onClick={() => setRescheduleModal({ open: true, item: fu, newDate: fu.scheduled_at.slice(0, 16) })}
                                disabled={actionLoading === fu.id}
                                className="p-1.5 rounded-xl bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] hover:text-[#111b21] text-xs font-semibold transition shadow-xs"
                                title="Ubah Jadwal"
                              >
                                <Edit2 size={12} />
                              </button>
                              <button
                                onClick={() => setConfirmAction({ type: 'cancel', id: fu.id })}
                                disabled={actionLoading === fu.id}
                                className="p-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 text-xs font-semibold transition shadow-xs"
                                title="Batalkan"
                              >
                                <XCircle size={12} />
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

      {/* Pagination */}
      <Pagination
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        loading={loading}
        label={`Menampilkan ${totalItems > 0 ? ((page - 1) * 20) + 1 : 0} - ${Math.min(page * 20, totalItems)} dari ${totalItems} antrian`}
      />

      {/* Reschedule Modal */}
      {rescheduleModal.open && rescheduleModal.item && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          onClick={() => setRescheduleModal({ open: false })}
        >
          <div
            className="bg-white border border-[#e9edef] rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-[#111b21] flex items-center space-x-2">
              <Calendar className="text-[#008069]" size={18} />
              <span>Ubah Jadwal Kirim Follow-Up</span>
            </h3>

            <div className="text-xs text-[#54656f] space-y-1 bg-[#f8fafc] p-3 rounded-xl border border-[#e9edef]">
              <p><strong className="text-[#111b21]">Customer:</strong> {rescheduleModal.item.customer?.name} ({rescheduleModal.item.customer?.phone})</p>
              <p><strong className="text-[#111b21]">Tipe:</strong> {rescheduleModal.item.type} Stage {rescheduleModal.item.stage}</p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-[#111b21]">Jadwal Kirim Baru</label>
              <input
                type="datetime-local"
                value={rescheduleModal.newDate}
                onChange={(e) => setRescheduleModal({ ...rescheduleModal, newDate: e.target.value })}
                className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-[#e9edef]">
              <button
                onClick={() => setRescheduleModal({ open: false })}
                className="px-4 py-2 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] rounded-xl text-xs font-semibold transition"
              >
                Batal
              </button>
              <button
                onClick={handleRescheduleSave}
                className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-bold transition shadow-xs"
              >
                Simpan Jadwal Baru
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Modal untuk Send Now / Cancel */}
      {confirmAction && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          onClick={() => setConfirmAction(null)}
        >
          <div
            className="bg-white border border-[#e9edef] rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-[#111b21] flex items-center space-x-2">
              {confirmAction.type === 'cancel'
                ? <><XCircle className="text-rose-600" size={18} /><span>Batalkan Follow-Up?</span></>
                : <><Send className="text-[#008069]" size={18} /><span>Kirim Sekarang?</span></>
              }
            </h3>
            <p className="text-xs text-[#54656f]">
              {confirmAction.type === 'cancel'
                ? 'Follow-up ini akan dibatalkan dan tidak akan dikirim otomatis.'
                : 'Pesan akan langsung dikirim sekarang tanpa menunggu jadwal cron.'}
            </p>
            <div className="flex justify-end space-x-2 pt-2 border-t border-[#e9edef]">
              <button
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] rounded-xl text-xs font-semibold transition"
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
                className={`px-4 py-2 text-white rounded-xl text-xs font-bold transition shadow-xs ${
                  confirmAction.type === 'cancel'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-[#008069] hover:bg-[#00a884]'
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
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-rose-50 border-rose-200 text-rose-800'
        }`}>
          {toastMsg.type === 'success' ? <CheckCircle size={14} className="text-emerald-600" /> : <AlertCircle size={14} className="text-rose-600" />}
          <span>{toastMsg.text}</span>
          <button onClick={() => setToastMsg(null)} className="ml-2 text-[#8696a0] hover:text-[#111b21]">
            <XCircle size={13} />
          </button>
        </div>
      )}
    </div>
  );
};

export default FollowUpQueue;
