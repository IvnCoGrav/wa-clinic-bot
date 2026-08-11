import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import { Pagination } from '../../components/common/Pagination';
import {
  Users,
  Search,
  MessageSquare,
  Send,
  Loader,
  RefreshCw,
  X,
  Zap,
  Phone,
  Copy,
  Check,
  Tag,
  DollarSign,
  AlertCircle,
  Clock,
} from 'lucide-react';

interface CustomerItem {
  id: string;
  phone: string;
  name: string | null;
  status: string;
  isMql: boolean;
  mqlBubbleCount: number;
  mqlTriggeredAt: string | null;
  trackingCode: string;
  adClick: any;
  ltv: number;
  reservationCount: number;
  createdAt: string;
  updatedAt: string;
  isAdminLabeled: boolean;
  isHoldLabeled: boolean;
}

interface ChatMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  content: string;
  sender_type?: string | null;
  sender_name?: string | null;
  created_at: string;
}

export const CustomerDatabase: React.FC = () => {
  const { toast, confirm } = useUiFeedback();
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<CustomerItem[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [mqlOnly, setMqlOnly] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Chat History Modal State
  const [activeHistoryCustomer, setActiveHistoryCustomer] = useState<CustomerItem | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyMessages, setHistoryMessages] = useState<ChatMessage[]>([]);

  // Send Event Modal State
  const [activeEventCustomer, setActiveEventCustomer] = useState<CustomerItem | null>(null);
  const [selectedEvent, setSelectedEvent] = useState('Lead');
  const [eventValue, setEventValue] = useState<number | ''>('');
  const [eventCurrency, setEventCurrency] = useState('IDR');
  const [sendingEvent, setSendingEvent] = useState(false);

  const loadCustomers = async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(page),
        pageSize: '15',
        ...(search ? { search } : {}),
        ...(mqlOnly ? { mqlOnly: 'true' } : {}),
      });

      const res = await apiRequest(`/api/admin/customers?${query.toString()}`);
      if (res && res.success) {
        setCustomers(res.customers || []);
        setTotalPages(res.totalPages || 1);
        setTotalCount(res.total || 0);
      }
    } catch (err: any) {
      toast(`Gagal memuat database customer: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, [page, mqlOnly]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadCustomers();
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    toast(`Tracking Code ${code} disalin!`, 'info');
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleToggleLabel = async (customer: CustomerItem, label: 'admin' | 'hold', enabled: boolean) => {
    const labelName = label === 'admin' ? 'Admin' : 'Hold';
    const ok = await confirm({
      title: `${enabled ? 'Pasang' : 'Lepas'} Label "${labelName}"`,
      message: `${enabled ? 'Pasang' : 'Lepas'} label WhatsApp "${labelName}" untuk ${customer.name || customer.phone}?`,
      confirmText: `Ya, ${enabled ? 'Pasang' : 'Lepas'}`,
      danger: !enabled,
    });
    if (!ok) return;

    try {
      const res = await apiRequest(`/api/admin/customers/${customer.id}/label`, {
        method: 'PATCH',
        body: JSON.stringify({ label, enabled }),
      });
      if (res && res.success) {
        toast(res.message || `Label "${labelName}" diperbarui.`);
        if (!res.data?.wahaOk) {
          toast('Label tersimpan di database, tapi gagal di-mirror ke WhatsApp (cek WAHA).', 'error');
        }
        loadCustomers();
      } else {
        toast(res?.error || `Gagal memperbarui label "${labelName}".`, 'error');
      }
    } catch (err: any) {
      toast(`Gagal memperbarui label: ${err.message}`, 'error');
    }
  };

  // Open Chat History Modal
  const handleOpenHistory = async (customer: CustomerItem) => {
    setActiveHistoryCustomer(customer);
    setLoadingHistory(true);
    setHistoryMessages([]);
    try {
      const res = await apiRequest(`/api/admin/customers/${customer.id}/messages`);
      if (res && res.success) {
        setHistoryMessages(res.data || []);
      }
    } catch (err: any) {
      toast(`Gagal memuat riwayat chat: ${err.message}`, 'error');
    } finally {
      setLoadingHistory(false);
    }
  };

  // Submit Send Event
  const handleSendMetaEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEventCustomer || !selectedEvent) return;

    setSendingEvent(true);
    try {
      const res = await apiRequest(`/api/admin/customers/${activeEventCustomer.id}/send-event`, {
        method: 'POST',
        body: JSON.stringify({
          eventName: selectedEvent,
          value: eventValue !== '' ? Number(eventValue) : undefined,
          currency: eventCurrency,
        }),
      });

      if (res && res.success) {
        toast(`Event '${selectedEvent}' berhasil dikirim ke Meta CAPI!`, 'success');
        setActiveEventCustomer(null);
      }
    } catch (err: any) {
      toast(`Gagal mengirim event Meta CAPI: ${err.message}`, 'error');
    } finally {
      setSendingEvent(false);
    }
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);
  };

  return (
    <div className="space-y-6">
      {/* Header & Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center space-x-2">
            <Users className="text-pink-500" />
            <span>Customer Database</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Kelola data customer, lihat Tracking Code, nilai LTV, riwayat chat, dan kirim event Meta CAPI secara manual.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => setMqlOnly(!mqlOnly)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 border ${
              mqlOnly
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-white/5 text-slate-400 border-white/10 hover:text-white'
            }`}
          >
            <Zap size={14} className={mqlOnly ? 'text-emerald-400 fill-emerald-400' : ''} />
            <span>{mqlOnly ? 'Filter: MQL Only' : 'Semua Customer'}</span>
          </button>

          <button
            onClick={loadCustomers}
            disabled={loading}
            className="p-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white transition disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSearchSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-3 text-slate-500" size={16} />
          <input
            type="text"
            placeholder="Cari berdasarkan No HP, Nama, atau Tracking Code (TC-XXXXX)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-950/80 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-pink-500/50"
          />
        </div>
        <button
          type="submit"
          className="px-5 py-2.5 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1"
        >
          <span>Cari</span>
        </button>
      </form>

      {/* Customer Table */}
      <div className="glass-panel border border-white/5 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center items-center py-20">
            <Loader className="animate-spin text-pink-500" size={36} />
          </div>
        ) : customers.length === 0 ? (
          <div className="text-center py-16 text-slate-500 text-xs">
            <AlertCircle className="mx-auto text-slate-600 mb-2" size={32} />
            <p className="font-semibold">Tidak ada customer ditemukan</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-white/10 bg-slate-950/60 text-slate-400 font-bold uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-4">Tracking Code (ID)</th>
                  <th className="py-3 px-4">No HP / Nama</th>
                  <th className="py-3 px-4">Status MQL</th>
                  <th className="py-3 px-4">Label WA</th>
                  <th className="py-3 px-4">LTV (Lifetime Value)</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {customers.map((customer) => (
                  <tr key={customer.id} className="hover:bg-white/[0.02] transition">
                    {/* Tracking Code */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center space-x-1.5">
                        <span className="font-mono text-pink-400 bg-pink-500/10 border border-pink-500/20 px-2 py-0.5 rounded text-[11px] font-bold">
                          {customer.trackingCode}
                        </span>
                        <button
                          onClick={() => handleCopyCode(customer.trackingCode)}
                          className="text-slate-500 hover:text-white transition"
                          title="Salin Tracking Code"
                        >
                          {copiedCode === customer.trackingCode ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                        </button>
                      </div>
                      {customer.adClick?.utmCampaign && (
                        <p className="text-[9px] text-slate-500 mt-1 truncate max-w-[150px]">
                          Campaign: {customer.adClick.utmCampaign}
                        </p>
                      )}
                    </td>

                    {/* Customer Phone & Name */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center space-x-2">
                        <Phone size={14} className="text-slate-400 flex-shrink-0" />
                        <div>
                          <span className="font-bold text-white block">{customer.phone}</span>
                          <span className="text-[10px] text-slate-400">{customer.name || 'Bunda Customer'}</span>
                        </div>
                      </div>
                    </td>

                    {/* Status MQL */}
                    <td className="py-3.5 px-4">
                      {customer.isMql ? (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-black uppercase">
                          <Zap size={10} className="fill-emerald-300" />
                          <span>MQL ({customer.mqlBubbleCount} Bubble)</span>
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-400 border border-white/5">
                          Regular ({customer.mqlBubbleCount} Bubble)
                        </span>
                      )}
                    </td>

                    {/* Label WA */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center space-x-1.5">
                        <button
                          onClick={() => handleToggleLabel(customer, 'admin', !customer.isAdminLabeled)}
                          title={customer.isAdminLabeled ? 'Klik untuk lepas label Admin' : 'Klik untuk pasang label Admin'}
                          className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wide border transition ${
                            customer.isAdminLabeled
                              ? 'bg-pink-500/20 text-pink-300 border-pink-500/40'
                              : 'bg-slate-800/60 text-slate-500 border-white/5 hover:text-slate-300 hover:border-white/20'
                          }`}
                        >
                          Admin
                        </button>
                        <button
                          onClick={() => handleToggleLabel(customer, 'hold', !customer.isHoldLabeled)}
                          title={customer.isHoldLabeled ? 'Klik untuk lepas label Hold' : 'Klik untuk pasang label Hold'}
                          className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wide border transition ${
                            customer.isHoldLabeled
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                              : 'bg-slate-800/60 text-slate-500 border-white/5 hover:text-slate-300 hover:border-white/20'
                          }`}
                        >
                          Hold
                        </button>
                      </div>
                    </td>

                    {/* LTV */}
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-emerald-400 text-xs">
                        {formatCurrency(customer.ltv)}
                      </div>
                      <span className="text-[9px] text-slate-500">
                        {customer.reservationCount} transaksi terkonfirmasi
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        {/* Chat History Button */}
                        <button
                          onClick={() => handleOpenHistory(customer)}
                          className="px-2.5 py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[11px] font-bold transition flex items-center space-x-1"
                        >
                          <MessageSquare size={12} />
                          <span>History Chat</span>
                        </button>

                        {/* Send Event Button */}
                        <button
                          onClick={() => setActiveEventCustomer(customer)}
                          className="px-2.5 py-1.5 rounded-lg bg-pink-500 hover:bg-pink-600 text-white text-[11px] font-bold transition flex items-center space-x-1"
                        >
                          <Send size={12} />
                          <span>Send Event</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {!loading && customers.length > 0 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            label={`Menampilkan ${customers.length} dari total ${totalCount} customer`}
          />
        )}
      </div>

      {/* Modal 1: Chat History Modal */}
      {activeHistoryCustomer && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-slate-950">
              <div>
                <h3 className="font-bold text-white text-sm flex items-center space-x-2">
                  <MessageSquare size={16} className="text-pink-400" />
                  <span>Riwayat Chat: {activeHistoryCustomer.phone}</span>
                </h3>
                <p className="text-[10px] text-slate-400">
                  {activeHistoryCustomer.name || 'Customer'} • Tracking Code: {activeHistoryCustomer.trackingCode}
                </p>
              </div>
              <button
                onClick={() => setActiveHistoryCustomer(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body: Message Stream */}
            <div className="p-4 overflow-y-auto flex-1 space-y-3 bg-slate-950/50 min-h-[300px]">
              {loadingHistory ? (
                <div className="flex justify-center items-center py-12">
                  <Loader className="animate-spin text-pink-500" size={32} />
                </div>
              ) : historyMessages.length === 0 ? (
                <div className="text-center py-12 text-slate-500 text-xs">
                  Belum ada pesan tercatat untuk customer ini.
                </div>
              ) : (
                historyMessages.map((msg) => {
                  const isInbound = msg.direction === 'INBOUND';
                  const sender = isInbound ? 'Customer' : msg.sender_type === 'ADMIN' ? msg.sender_name || 'Admin' : 'Bot';

                  return (
                    <div key={msg.id} className={`flex flex-col ${isInbound ? 'items-start' : 'items-end'}`}>
                      <div className="flex items-center space-x-1 text-[9px] text-slate-500 mb-1">
                        <span className="font-semibold text-slate-400">{sender}</span>
                        <span>•</span>
                        <Clock size={8} />
                        <span>{new Date(msg.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <div
                        className={`max-w-[80%] p-3 rounded-2xl text-xs leading-relaxed ${
                          isInbound
                            ? 'bg-slate-800 text-slate-200 rounded-tl-none border border-white/5'
                            : 'bg-pink-600/90 text-white rounded-tr-none'
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 border-t border-white/10 bg-slate-950 flex justify-end">
              <button
                onClick={() => setActiveHistoryCustomer(null)}
                className="px-4 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Send Meta Event Modal */}
      {activeEventCustomer && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <form onSubmit={handleSendMetaEvent}>
              {/* Modal Header */}
              <div className="p-4 border-b border-white/10 flex justify-between items-center bg-slate-950">
                <div>
                  <h3 className="font-bold text-white text-sm flex items-center space-x-2">
                    <Send size={16} className="text-pink-400" />
                    <span>Send Event ke Meta Pixel / CAPI</span>
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    Customer: {activeEventCustomer.phone} ({activeEventCustomer.trackingCode})
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveEventCustomer(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Modal Form Content */}
              <div className="p-5 space-y-4 text-xs">
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-semibold block">Pilih Event Meta CAPI</label>
                  <select
                    value={selectedEvent}
                    onChange={(e) => setSelectedEvent(e.target.value)}
                    className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-white text-xs focus:outline-none focus:border-pink-500"
                  >
                    <option value="Lead">Lead (Minimum Qualified Lead)</option>
                    <option value="Purchase">Purchase (Pembelian / Transaksi)</option>
                    <option value="Contact">Contact (Kontak via WhatsApp)</option>
                    <option value="ViewContent">ViewContent (Melihat Layanan/Menu)</option>
                    <option value="AddToCart">AddToCart (Tambah ke Keranjang)</option>
                    <option value="InitiateCheckout">InitiateCheckout (Mulai Checkout)</option>
                  </select>
                </div>

                {(selectedEvent === 'Purchase' || selectedEvent === 'InitiateCheckout') && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-slate-300 font-semibold block">Nilai Transaksi (Rp)</label>
                      <input
                        type="number"
                        placeholder="Contoh: 150000"
                        value={eventValue}
                        onChange={(e) => setEventValue(e.target.value === '' ? '' : Number(e.target.value))}
                        className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-white text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-slate-300 font-semibold block">Mata Uang</label>
                      <input
                        type="text"
                        value={eventCurrency}
                        onChange={(e) => setEventCurrency(e.target.value)}
                        className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-white text-xs font-mono"
                      />
                    </div>
                  </div>
                )}

                <div className="p-3 rounded-xl bg-pink-500/10 border border-pink-500/20 text-pink-300 text-[10px] leading-relaxed">
                  Event akan dikirim langsung ke Meta Conversions API menggunakan data atribusi (`fbclid`, `fbp`, `fbc`, IP, UserAgent) milik customer.
                </div>
              </div>

              {/* Modal Footer */}
              <div className="p-4 border-t border-white/10 bg-slate-950 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setActiveEventCustomer(null)}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={sendingEvent}
                  className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 disabled:opacity-50"
                >
                  <Send size={12} />
                  <span>{sendingEvent ? 'Mengirim...' : 'Kirim Event Sekarang'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
