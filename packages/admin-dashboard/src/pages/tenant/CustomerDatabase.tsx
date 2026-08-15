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
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#111b21] tracking-tight flex items-center space-x-2">
            <Users className="text-[#008069]" size={22} />
            <span>Database Customer</span>
          </h1>
          <p className="text-xs text-[#667781] mt-0.5">
            Kelola data customer, lihat Tracking Code, nilai LTV, riwayat chat, dan kirim event Meta CAPI secara manual.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setMqlOnly(!mqlOnly)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 border shadow-xs ${
              mqlOnly
                ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                : 'bg-white text-[#54656f] border-[#d1d7db] hover:bg-[#f0f2f5] hover:text-[#111b21]'
            }`}
          >
            <Zap size={13} className={mqlOnly ? 'text-emerald-700 fill-emerald-700' : 'text-[#8696a0]'} />
            <span>{mqlOnly ? 'Filter: MQL Only' : 'Semua Customer'}</span>
          </button>

          <button
            onClick={loadCustomers}
            disabled={loading}
            className="p-2 rounded-xl bg-white border border-[#d1d7db] text-[#54656f] hover:bg-[#f0f2f5] hover:text-[#111b21] transition shadow-xs disabled:opacity-50"
            title="Refresh database"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin text-[#008069]' : ''} />
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSearchSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-2.5 text-[#8696a0]" size={15} />
          <input
            type="text"
            placeholder="Cari berdasarkan No HP, Nama, atau Tracking Code (TC-XXXXX)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs"
          />
        </div>
        <button
          type="submit"
          className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-bold transition flex items-center space-x-1 shadow-xs"
        >
          <span>Cari</span>
        </button>
      </form>

      {/* Customer Table & Mobile Cards */}
      <div className="bg-white border border-[#e9edef] rounded-2xl overflow-hidden shadow-xs">
        {loading ? (
          <div className="flex justify-center items-center py-20">
            <Loader className="animate-spin text-[#008069]" size={32} />
          </div>
        ) : customers.length === 0 ? (
          <div className="text-center py-16 text-[#667781] text-xs">
            <AlertCircle className="mx-auto text-[#8696a0] mb-2" size={32} />
            <p className="font-bold text-[#111b21]">Tidak ada customer ditemukan</p>
          </div>
        ) : (
          <>
            {/* Mobile Card List (< md) */}
            <div className="md:hidden divide-y divide-[#e9edef]">
              {customers.map((customer) => (
                <div key={customer.id} className="p-4 space-y-3 bg-white">
                  {/* Top row: Name/Phone & LTV */}
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center space-x-1.5">
                        <span className="font-bold text-sm text-[#111b21]">
                          {customer.name || 'Bunda Customer'}
                        </span>
                      </div>
                      <div className="flex items-center space-x-1.5 text-xs text-[#54656f] mt-0.5">
                        <Phone size={13} className="text-[#8696a0]" />
                        <span className="font-mono">{customer.phone}</span>
                      </div>
                    </div>

                    <div className="text-right flex-shrink-0">
                      <div className="font-bold text-[#008069] text-sm">
                        {formatCurrency(customer.ltv)}
                      </div>
                      <span className="text-[10px] text-[#667781]">
                        {customer.reservationCount}x transaksi
                      </span>
                    </div>
                  </div>

                  {/* Badges & Meta */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <div className="flex items-center space-x-1">
                      <span className="font-mono text-[#008069] bg-[#e8f5f2] border border-[#c2e7e0] px-2 py-0.5 rounded text-[11px] font-bold">
                        {customer.trackingCode}
                      </span>
                      <button
                        onClick={() => handleCopyCode(customer.trackingCode)}
                        className="text-[#8696a0] hover:text-[#111b21] transition p-1.5 rounded hover:bg-[#f0f2f5]"
                        title="Salin Tracking Code"
                        aria-label="Salin Tracking Code"
                      >
                        {copiedCode === customer.trackingCode ? <Check size={13} className="text-[#008069]" /> : <Copy size={13} />}
                      </button>
                    </div>

                    {customer.isMql ? (
                      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-bold uppercase">
                        <Zap size={10} className="fill-emerald-700 text-emerald-700" />
                        <span>MQL ({customer.mqlBubbleCount} Bubble)</span>
                      </span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-[#f0f2f5] text-[#54656f] border border-[#e9edef]">
                        Regular ({customer.mqlBubbleCount} Bubble)
                      </span>
                    )}

                    <div className="flex items-center space-x-1 ml-auto">
                      <button
                        onClick={() => handleToggleLabel(customer, 'admin', !customer.isAdminLabeled)}
                        className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide border transition ${
                          customer.isAdminLabeled
                            ? 'bg-rose-100 text-rose-800 border-rose-200'
                            : 'bg-[#f0f2f5] text-[#54656f] border-[#e9edef]'
                        }`}
                      >
                        Admin
                      </button>
                      <button
                        onClick={() => handleToggleLabel(customer, 'hold', !customer.isHoldLabeled)}
                        className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide border transition ${
                          customer.isHoldLabeled
                            ? 'bg-amber-100 text-amber-800 border-amber-200'
                            : 'bg-[#f0f2f5] text-[#54656f] border-[#e9edef]'
                        }`}
                      >
                        Hold
                      </button>
                    </div>
                  </div>

                  {customer.adClick?.utmCampaign && (
                    <p className="text-[11px] text-[#667781] truncate">
                      Campaign: <span className="text-[#111b21] font-medium">{customer.adClick.utmCampaign}</span>
                    </p>
                  )}

                  {/* Action buttons */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      onClick={() => handleOpenHistory(customer)}
                      className="py-2.5 px-3 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 text-xs font-semibold transition flex items-center justify-center space-x-1.5 shadow-xs"
                    >
                      <MessageSquare size={14} />
                      <span>History Chat</span>
                    </button>

                    <button
                      onClick={() => setActiveEventCustomer(customer)}
                      className="py-2.5 px-3 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white text-xs font-semibold transition flex items-center justify-center space-x-1.5 shadow-xs"
                    >
                      <Send size={14} />
                      <span>Send Event</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Table (>= md) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#e9edef] bg-[#f8fafc] text-[#667781] font-bold uppercase text-[10px] tracking-wider">
                    <th className="py-3 px-4">Tracking Code (ID)</th>
                    <th className="py-3 px-4">No HP / Nama</th>
                    <th className="py-3 px-4">Status MQL</th>
                    <th className="py-3 px-4">Label WA</th>
                    <th className="py-3 px-4">LTV (Lifetime Value)</th>
                    <th className="py-3 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e9edef]">
                  {customers.map((customer) => (
                    <tr key={customer.id} className="hover:bg-[#f8fafc] transition">
                      {/* Tracking Code */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center space-x-1.5">
                          <span className="font-mono text-[#008069] bg-[#e8f5f2] border border-[#c2e7e0] px-2 py-0.5 rounded text-[11px] font-bold">
                            {customer.trackingCode}
                          </span>
                          <button
                            onClick={() => handleCopyCode(customer.trackingCode)}
                            className="text-[#8696a0] hover:text-[#111b21] transition p-1 rounded hover:bg-[#f0f2f5]"
                            title="Salin Tracking Code"
                          >
                            {copiedCode === customer.trackingCode ? <Check size={12} className="text-[#008069]" /> : <Copy size={12} />}
                          </button>
                        </div>
                        {customer.adClick?.utmCampaign && (
                          <p className="text-[10px] text-[#667781] mt-1 truncate max-w-[150px]">
                            Campaign: {customer.adClick.utmCampaign}
                          </p>
                        )}
                      </td>

                      {/* Customer Phone & Name */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center space-x-2">
                          <Phone size={14} className="text-[#8696a0] flex-shrink-0" />
                          <div>
                            <span className="font-bold text-[#111b21] block">{customer.phone}</span>
                            <span className="text-[11px] text-[#667781]">{customer.name || 'Bunda Customer'}</span>
                          </div>
                        </div>
                      </td>

                      {/* Status MQL */}
                      <td className="py-3.5 px-4">
                        {customer.isMql ? (
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-bold uppercase">
                            <Zap size={10} className="fill-emerald-700 text-emerald-700" />
                            <span>MQL ({customer.mqlBubbleCount} Bubble)</span>
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-[#f0f2f5] text-[#54656f] border border-[#e9edef]">
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
                            className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wide border transition ${
                              customer.isAdminLabeled
                                ? 'bg-rose-100 text-rose-800 border-rose-200'
                                : 'bg-[#f0f2f5] text-[#54656f] border-[#e9edef] hover:text-[#111b21] hover:bg-[#e2e8f0]'
                            }`}
                          >
                            Admin
                          </button>
                          <button
                            onClick={() => handleToggleLabel(customer, 'hold', !customer.isHoldLabeled)}
                            title={customer.isHoldLabeled ? 'Klik untuk lepas label Hold' : 'Klik untuk pasang label Hold'}
                            className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wide border transition ${
                              customer.isHoldLabeled
                                ? 'bg-amber-100 text-amber-800 border-amber-200'
                                : 'bg-[#f0f2f5] text-[#54656f] border-[#e9edef] hover:text-[#111b21] hover:bg-[#e2e8f0]'
                            }`}
                          >
                            Hold
                          </button>
                        </div>
                      </td>

                      {/* LTV */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-[#008069] text-xs">
                          {formatCurrency(customer.ltv)}
                        </div>
                        <span className="text-[10px] text-[#667781]">
                          {customer.reservationCount} transaksi terkonfirmasi
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end space-x-1.5">
                          {/* Chat History Button */}
                          <button
                            onClick={() => handleOpenHistory(customer)}
                            className="px-2.5 py-1.5 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 text-xs font-semibold transition flex items-center space-x-1 shadow-xs"
                          >
                            <MessageSquare size={12} />
                            <span>History</span>
                          </button>

                          {/* Send Event Button */}
                          <button
                            onClick={() => setActiveEventCustomer(customer)}
                            className="px-2.5 py-1.5 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white text-xs font-semibold transition flex items-center space-x-1 shadow-xs"
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
          </>
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
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#e9edef] rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 border-b border-[#e9edef] flex justify-between items-center bg-[#f8fafc]">
              <div>
                <h3 className="font-bold text-[#111b21] text-sm flex items-center space-x-2">
                  <MessageSquare size={16} className="text-[#008069]" />
                  <span>Riwayat Chat: {activeHistoryCustomer.phone}</span>
                </h3>
                <p className="text-[11px] text-[#667781]">
                  {activeHistoryCustomer.name || 'Customer'} • Tracking Code: {activeHistoryCustomer.trackingCode}
                </p>
              </div>
              <button
                onClick={() => setActiveHistoryCustomer(null)}
                className="p-1.5 rounded-lg text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5] transition"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body: Message Stream with WhatsApp Wallpaper */}
            <div 
              className="p-4 overflow-y-auto flex-1 space-y-3 bg-[#efeae2] min-h-[300px]"
              style={{
                backgroundImage: `radial-gradient(#d1d7db 0.75px, transparent 0.75px)`,
                backgroundSize: '16px 16px',
              }}
            >
              {loadingHistory ? (
                <div className="flex justify-center items-center py-12">
                  <Loader className="animate-spin text-[#008069]" size={32} />
                </div>
              ) : historyMessages.length === 0 ? (
                <div className="text-center py-12 text-[#667781] text-xs">
                  Belum ada pesan tercatat untuk customer ini.
                </div>
              ) : (
                historyMessages.map((msg) => {
                  const isInbound = msg.direction === 'INBOUND';
                  const sender = isInbound ? 'Customer' : msg.sender_type === 'ADMIN' ? msg.sender_name || 'Admin' : 'Bot';

                  return (
                    <div key={msg.id} className={`flex flex-col ${isInbound ? 'items-start' : 'items-end'}`}>
                      <div className="flex items-center space-x-1 text-[10px] text-[#667781] mb-0.5">
                        <span className="font-bold text-[#111b21]">{sender}</span>
                        <span>•</span>
                        <Clock size={9} />
                        <span>{new Date(msg.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <div
                        className={`max-w-[80%] p-3 rounded-xl text-xs leading-relaxed shadow-xs ${
                          isInbound
                            ? 'bg-white text-[#111b21] rounded-tl-none border border-black/5'
                            : 'bg-[#d9fdd3] text-[#111b21] rounded-tr-none border border-[#00a884]/20'
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
            <div className="p-3.5 border-t border-[#e9edef] bg-[#f8fafc] flex justify-end">
              <button
                onClick={() => setActiveHistoryCustomer(null)}
                className="px-4 py-2 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#111b21] rounded-xl text-xs font-semibold transition shadow-xs"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Send Meta Event Modal */}
      {activeEventCustomer && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#e9edef] rounded-2xl w-full max-w-md shadow-xl overflow-hidden">
            <form onSubmit={handleSendMetaEvent}>
              {/* Modal Header */}
              <div className="p-4 border-b border-[#e9edef] flex justify-between items-center bg-[#f8fafc]">
                <div>
                  <h3 className="font-bold text-[#111b21] text-sm flex items-center space-x-2">
                    <Send size={15} className="text-[#008069]" />
                    <span>Send Event ke Meta Pixel / CAPI</span>
                  </h3>
                  <p className="text-[11px] text-[#667781]">
                    Customer: {activeEventCustomer.phone} ({activeEventCustomer.trackingCode})
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveEventCustomer(null)}
                  className="p-1.5 rounded-lg text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5] transition"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Modal Form Content */}
              <div className="p-5 space-y-4 text-xs">
                <div className="space-y-1.5">
                  <label className="text-[#111b21] font-bold block">Pilih Event Meta CAPI</label>
                  <select
                    value={selectedEvent}
                    onChange={(e) => setSelectedEvent(e.target.value)}
                    className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-xl text-[#111b21] text-xs focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs"
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
                      <label className="text-[#111b21] font-bold block">Nilai Transaksi (Rp)</label>
                      <input
                        type="number"
                        placeholder="Contoh: 150000"
                        value={eventValue}
                        onChange={(e) => setEventValue(e.target.value === '' ? '' : Number(e.target.value))}
                        className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-xl text-[#111b21] text-xs focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[#111b21] font-bold block">Mata Uang</label>
                      <input
                        type="text"
                        value={eventCurrency}
                        onChange={(e) => setEventCurrency(e.target.value)}
                        className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-xl text-[#111b21] text-xs font-mono focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs"
                      />
                    </div>
                  </div>
                )}

                <div className="p-3 rounded-xl bg-[#e8f5f2] border border-[#c2e7e0] text-[#008069] text-[11px] leading-relaxed">
                  Event akan dikirim langsung ke Meta Conversions API menggunakan data atribusi (<code>fbclid</code>, <code>fbp</code>, <code>fbc</code>, IP, UserAgent) milik customer.
                </div>
              </div>

              {/* Modal Footer */}
              <div className="p-4 border-t border-[#e9edef] bg-[#f8fafc] flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setActiveEventCustomer(null)}
                  className="px-4 py-2 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#111b21] rounded-xl text-xs font-semibold transition shadow-xs"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={sendingEvent}
                  className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 disabled:opacity-50 shadow-xs"
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
