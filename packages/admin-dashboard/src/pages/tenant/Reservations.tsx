import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import { Reservation } from '../../types';
import { extractBabiesFromRawText } from '../../utils/reservationBabies';
import { 
  Search, 
  Calendar as CalendarIcon, 
  User, 
  Baby,
  MapPin, 
  Check, 
  X, 
  Info, 
  CalendarDays,
  FileText,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';

export const Reservations: React.FC = () => {
  const { toast, confirm } = useUiFeedback();
  const [loading, setLoading] = useState(true);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selectedRes, setSelectedRes] = useState<Reservation | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'table' | 'calendar'>('table');
  const [searchQuery, setSearchQuery] = useState('');
  const [googleCalendarMockActive, setGoogleCalendarMockActive] = useState(true);
  const [editDate, setEditDate] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    customerId: '',
    customerSearch: '',
    treatmentCategory: 'BABY' as 'BABY' | 'MOMS' | 'BOTH',
    treatmentDetail: '',
    bookingDate: '',
    babies: [] as Array<{ name: string; ageText: string }>,
  });
  const [customerSearchResults, setCustomerSearchResults] = useState<any[]>([]);
  const [searchingCustomers, setSearchingCustomers] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalReservations, setTotalReservations] = useState(0);

  const PAGE_SIZE = 100;

  const loadReservations = async (targetPage = 1, append = false) => {
    try {
      setLoading(true);
      const res = await apiRequest(`/api/admin/reservations?page=${targetPage}&pageSize=${PAGE_SIZE}`);
      const data = Array.isArray(res) ? res : (res?.data || []);
      setReservations(prev => append ? [...prev, ...data] : data);
      if (!Array.isArray(res)) {
        setTotalPages(res?.totalPages || 1);
        setTotalReservations(res?.total ?? data.length);
      } else {
        setTotalPages(1);
        setTotalReservations(data.length);
      }
      setPage(targetPage);
    } catch (err) {
      console.error('Failed to load reservations:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReservations(1);
  }, []);

  const loadMore = () => {
    if (page < totalPages) loadReservations(page + 1, true);
  };

  const handleConfirm = async (id: string) => {
    try {
      setLoading(true);
      await apiRequest(`/api/admin/reservation/${id}/confirm`, {
        method: 'PATCH'
      });
      toast('Reservasi ditandai lunas & disinkronkan ke Google Calendar', 'success');
      setSelectedRes(null);
      loadReservations();
    } catch (err: any) {
      toast(`Error confirming reservation: ${err.message}`, 'error');
      setLoading(false);
    }
  };

  const handleSetDate = async (id: string) => {
    if (!editDate) return;
    try {
      setLoading(true);
      await apiRequest(`/api/admin/reservation/${id}/set-date`, {
        method: 'PATCH',
        body: JSON.stringify({ bookingDate: new Date(editDate).toISOString() })
      });
      toast('Reservation schedule updated successfully!', 'success');
      setSelectedRes(null);
      setEditDate('');
      loadReservations();
    } catch (err: any) {
      toast(`Error updating date: ${err.message}`, 'error');
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    const isConfirmed = await confirm({
      title: 'Hapus Reservasi?',
      message: 'Are you sure you want to cancel and delete this reservation?',
      confirmText: 'Ya, Hapus',
      danger: true,
    });
    if (!isConfirmed) return;
    try {
      setLoading(true);
      await apiRequest(`/api/admin/reservation/${id}`, {
        method: 'DELETE'
      });
      toast('Reservation deleted/cancelled.', 'success');
      setSelectedRes(null);
      loadReservations();
    } catch (err: any) {
      toast(`Error deleting: ${err.message}`, 'error');
      setLoading(false);
    }
  };

  // --- Task 9: Buat Jadwal Baru (customer search + structured form) ---
  const searchCustomers = async (query: string) => {
    if (!query || query.length < 2) { setCustomerSearchResults([]); return; }
    setSearchingCustomers(true);
    try {
      const params = new URLSearchParams({ search: query, pageSize: '10' });
      const res = await apiRequest(`/api/admin/customers?${params.toString()}`);
      setCustomerSearchResults(res.customers || []);
    } catch {
      setCustomerSearchResults([]);
    } finally {
      setSearchingCustomers(false);
    }
  };

  const handleCreateReservation = async () => {
    if (!createForm.customerId || !createForm.treatmentDetail) {
      toast('Pilih customer dan isi detail treatment', 'error'); return;
    }
    try {
      await apiRequest('/api/admin/reservation', {
        method: 'POST',
        body: JSON.stringify({
          customerId: createForm.customerId,
          treatmentCategory: createForm.treatmentCategory,
          treatmentDetail: createForm.treatmentDetail,
          bookingDate: createForm.bookingDate || undefined,
          babies: createForm.babies.length > 0 ? createForm.babies : undefined,
        }),
      });
      toast('Reservasi baru berhasil dibuat!', 'success');
      setShowCreateModal(false);
      setCreateForm({ customerId: '', customerSearch: '', treatmentCategory: 'BABY', treatmentDetail: '', bookingDate: '', babies: [] });
      setCustomerSearchResults([]);
      loadReservations();
    } catch (err: any) {
      toast(`Gagal membuat reservasi: ${err.message}`, 'error');
    }
  };

  const updateBaby = (index: number, field: 'name' | 'ageText', value: string) => {
    const next = [...createForm.babies];
    next[index] = { ...next[index], [field]: value };
    setCreateForm((prev) => ({ ...prev, babies: next }));
  };

  // Resolve info bayi/anak: prioritas children DB (usia real-time) → baby_details API → parse raw_text client
  const getBabyRows = (res: Reservation | null): Array<{ name: string; age: string; regAge?: string }> => {
    if (!res) return [];
    const children = res.customer?.children;
    if (children && children.length > 0) {
      return children.map((c) => ({
        name: c.name,
        age: c.current_age || c.raw_age_text || '',
        regAge: c.raw_age_text || undefined,
      }));
    }
    const bd = res.baby_details;
    if (bd && bd.length > 0) return bd.map((b) => ({ name: b.name, age: b.age }));
    return extractBabiesFromRawText(res.raw_text, res.treatment_detail).map((b) => ({ name: b.name, age: b.age }));
  };

  // Filter reservations
  const filtered = reservations.filter(res => {
    const statusMatch = filterStatus === 'all' || res.status === filterStatus;
    const customerPhone = res.customer?.phone || '';
    const customerName = res.customer?.name || '';
    const textBody = res.treatment_detail || '';
    const query = searchQuery.toLowerCase();
    
    const searchMatch = !searchQuery || 
      customerPhone.toLowerCase().includes(query) ||
      customerName.toLowerCase().includes(query) ||
      textBody.toLowerCase().includes(query);

    return statusMatch && searchMatch;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'confirmed':
        return <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">Confirmed</span>;
      case 'completed':
        return <span className="px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold">Completed</span>;
      case 'cancelled':
        return <span className="px-2.5 py-1 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-semibold">Cancelled</span>;
      default:
        return <span className="px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-semibold">Pending</span>;
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white">Reservations</h2>
          <p className="text-slate-400">View schedule, confirm bookings, and manage clinic calendars</p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-pink-500 hover:bg-pink-600 rounded-xl text-xs font-semibold text-white transition-colors shadow shadow-pink-500/20"
          >
            <CalendarIcon size={14} />
            <span>+ Buat Jadwal Baru</span>
          </button>
          <button 
            onClick={() => { setLoading(true); loadReservations(); }}
            className="flex items-center space-x-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl text-xs font-semibold text-slate-300 transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Reload</span>
          </button>
        </div>
      </div>

      {/* Tabs Menu */}
      <div className="flex space-x-2 p-1 bg-slate-900/60 border border-white/5 rounded-xl max-w-xs">
        <button 
          onClick={() => setActiveTab('table')}
          className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all ${activeTab === 'table' ? 'bg-pink-500 text-white shadow' : 'text-slate-400 hover:text-white'}`}
        >
          Table List
        </button>
        <button 
          onClick={() => setActiveTab('calendar')}
          className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all ${activeTab === 'calendar' ? 'bg-pink-500 text-white shadow' : 'text-slate-400 hover:text-white'}`}
        >
          Calendar View
        </button>
      </div>

      {/* Main reservation content */}
      {activeTab === 'table' ? (
        <div className="space-y-4">
          
          {/* Filters Row */}
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative w-full md:max-w-xs">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500">
                <Search size={16} />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search phone, name, or detail..."
                className="w-full pl-9 pr-4 py-2 bg-slate-900/60 border border-white/5 rounded-xl text-sm focus:outline-none focus:border-pink-500/40"
              />
            </div>

            <div className="flex space-x-2 overflow-x-auto w-full md:w-auto">
              {['all', 'pending', 'confirmed', 'completed', 'cancelled'].map((status) => (
                <button
                  key={status}
                  onClick={() => setFilterStatus(status)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                    filterStatus === status 
                      ? 'bg-pink-500/10 border-pink-500 text-pink-400' 
                      : 'border-white/5 text-slate-400 hover:text-white bg-slate-900/35'
                  }`}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Table list */}
          <div className="glass-panel border border-white/5 rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 bg-slate-900/40 text-slate-400 text-xs uppercase tracking-wider font-semibold">
                    <th className="py-4 px-6">Customer</th>
                    <th className="py-4 px-6">Treatment Category</th>
                    <th className="py-4 px-6">Detail</th>
                    <th className="py-4 px-6">Date & Time</th>
                    <th className="py-4 px-6">Status</th>
                    <th className="py-4 px-6">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-sm text-slate-300">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500 text-xs">
                        No reservations found matching current criteria.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((res) => (
                      <tr key={res.id} className="hover:bg-white/5 transition-all">
                        <td className="py-4 px-6 font-medium text-white">
                          <p>{res.customer?.name || 'Bunda'}</p>
                          <p className="text-xs text-slate-500">{res.customer?.phone}</p>
                        </td>
                        <td className="py-4 px-6">
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-xs text-slate-300 font-medium">
                            {res.treatment_category}
                          </span>
                        </td>
                        <td className="py-4 px-6 max-w-xs truncate" title={res.treatment_detail}>
                          {res.treatment_detail}
                        </td>
                        <td className="py-4 px-6 font-semibold">
                          {res.booking_date
                            ? new Date(res.booking_date).toLocaleString('id-ID')
                            : (
                              <button
                                onClick={() => { setSelectedRes(res); setEditDate(''); }}
                                className="px-2 py-1 rounded-lg bg-pink-500/10 border border-pink-500/20 text-pink-400 hover:bg-pink-500/20 text-xs font-semibold transition-all"
                              >
                                + Tambahkan Jadwal Kunjungan
                              </button>
                            )
                          }
                        </td>
                        <td className="py-4 px-6">
                          {getStatusBadge(res.status)}
                        </td>
                        <td className="py-4 px-6">
                          <button
                            onClick={() => setSelectedRes(res)}
                            className="px-3 py-1 bg-white/5 hover:bg-pink-500/10 text-slate-300 hover:text-pink-400 border border-white/5 hover:border-pink-500/20 rounded-lg text-xs transition-all font-semibold"
                          >
                            Manage
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination Footer */}
          {totalPages > 1 && (
            <div className="p-4 border-t border-white/5 flex items-center justify-between text-xs text-slate-400">
              <span>
                Menampilkan {reservations.length} dari total <span className="text-white font-bold">{totalReservations}</span> reservasi
              </span>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => { setReservations([]); loadReservations(1); }}
                  disabled={page === 1 || loading}
                  className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition font-semibold"
                >
                  Awal
                </button>
                <button
                  onClick={loadMore}
                  disabled={page >= totalPages || loading}
                  className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition font-semibold"
                >
                  {loading ? 'Memuat...' : `Muat Halaman ${page + 1} / ${totalPages}`}
                </button>
              </div>
            </div>
          )}

        </div>
      ) : (
        /* Simple Calendar View layout */
        <div className="glass-panel border border-white/5 rounded-2xl p-6 shadow-xl space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <CalendarDays className="text-pink-400" />
              <span>Agenda Reservasi</span>
            </h3>
            <span className="text-xs text-slate-500">Upcoming schedules</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {reservations.filter(r => r.status === 'confirmed' && r.booking_date).map((res) => (
              <div key={res.id} className="p-4 rounded-xl bg-slate-900/60 border border-white/5 flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between items-start">
                    <span className="text-xs font-semibold text-pink-400">
                      {res.treatment_category}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {new Date(res.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <h4 className="font-bold text-slate-200">{res.customer?.name || 'Bunda'}</h4>
                  <p className="text-xs text-slate-400 line-clamp-2">{res.treatment_detail}</p>
                </div>
                <div className="pt-3 border-t border-white/5 flex items-center justify-between text-xs text-slate-300 font-semibold">
                  <span>{res.booking_date ? new Date(res.booking_date).toLocaleString('id-ID') : ''}</span>
                  <button onClick={() => setSelectedRes(res)} className="text-pink-400 hover:underline">Edit</button>
                </div>
              </div>
            ))}
            {reservations.filter(r => r.status === 'confirmed' && r.booking_date).length === 0 && (
              <div className="col-span-full py-12 text-center text-slate-500 text-xs">
                No confirmed reservations scheduled yet.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reservation Details & Management Modal */}
      {selectedRes && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-slate-900 border border-white/10 rounded-2xl p-6 space-y-6 shadow-2xl relative">
            <button 
              onClick={() => setSelectedRes(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <X size={20} />
            </button>

            {/* Modal Header */}
            <div>
              <h3 className="text-xl font-bold text-white flex items-center space-x-2">
                <Info size={20} className="text-pink-400" />
                <span>Reservation Details</span>
              </h3>
              <p className="text-xs text-slate-400 mt-1">Manage state variables & manual integrations</p>
            </div>

            {/* Info contents split layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-slate-950 border border-white/5 space-y-2">
                  <span className="text-xs text-slate-500 font-semibold block uppercase">Patient Details</span>
                  <div className="flex items-center space-x-2 text-slate-200">
                    <User size={16} className="text-slate-500" />
                    <span>{selectedRes.customer?.name || 'Bunda'} ({selectedRes.customer?.phone})</span>
                  </div>
                  {selectedRes.customer?.kelurahan && (
                    <div className="flex items-center space-x-2 text-slate-400 text-xs">
                      <MapPin size={14} className="text-slate-500" />
                      <span>{selectedRes.customer?.kelurahan}, {selectedRes.customer?.kecamatan}, {selectedRes.customer?.kota}</span>
                    </div>
                  )}

                  {/* Baby / Anak info */}
                  {getBabyRows(selectedRes).length > 0 && (
                    <div className="mt-2 pt-2 border-t border-white/5 space-y-1.5">
                      <span className="text-[11px] text-pink-400 font-bold uppercase tracking-wider block">
                        Bayi / Anak ({getBabyRows(selectedRes).length})
                      </span>
                      {getBabyRows(selectedRes).map((baby, i) => (
                        <div key={i} className="flex items-center space-x-2 text-slate-200">
                          <Baby size={14} className="text-pink-500/70 flex-shrink-0" />
                          <span>
                            <span className="font-semibold">{baby.name || '-'}</span>
                            <span className="text-slate-300 text-xs"> · {baby.age || '?'}</span>
                            {baby.regAge && baby.regAge !== baby.age && (
                              <span className="text-slate-500 text-[11px] ml-1">
                                (saat booking: {baby.regAge})
                              </span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-4 rounded-xl bg-slate-950 border border-white/5 space-y-2">
                  <span className="text-xs text-slate-500 font-semibold block uppercase">Location & Logistics</span>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Distance from Branch</span>
                    <span className="text-slate-200 font-bold">{selectedRes.customer?.distance_km?.toFixed(2) || '0.0'} km</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Delivery Fee (Ongkir)</span>
                    <span className="text-slate-200 font-bold">
                      {selectedRes.customer?.ongkir ? `Rp ${selectedRes.customer.ongkir.toLocaleString()}` : 'Free/Not calculated'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-emerald-400">
                    <span>Haversine Fallback Multiplier</span>
                    <span className="font-bold">Active (1.25x)</span>
                  </div>
                </div>
              </div>

              {/* Edit Schedule section */}
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-slate-950 border border-white/5 space-y-3">
                  <span className="text-xs text-slate-500 font-semibold block uppercase">Set booking schedule</span>
                  <input
                    type="datetime-local"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full p-2 bg-slate-900 border border-white/10 rounded-lg text-xs text-white"
                  />
                  <button
                    onClick={() => handleSetDate(selectedRes.id)}
                    className="w-full py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-lg text-xs font-semibold transition"
                  >
                    Tambahkan Jadwal Kunjungan
                  </button>
                </div>

                {/* Google Calendar sync notifier */}
                {googleCalendarMockActive && (
                  <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-start space-x-3 text-xs">
                    <AlertTriangle className="flex-shrink-0 mt-0.5" size={16} />
                    <div>
                      <p className="font-bold">Google Calendar integration is in Mock Mode</p>
                      <p className="mt-0.5 text-[10px] text-amber-500/80">
                        OAuth credentials are missing in backend `.env`. Operations will fall back to local mock triggers.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Raw Text Log */}
            <div className="space-y-2">
              <span className="text-xs text-slate-500 font-semibold block uppercase flex items-center space-x-1">
                <FileText size={12} />
                <span>Raw Chat Submission text</span>
              </span>
              <pre className="p-3 bg-slate-950 border border-white/5 rounded-xl text-[11px] text-slate-400 font-mono overflow-auto max-h-32 whitespace-pre-wrap">
                {selectedRes.raw_text}
              </pre>
            </div>

            {/* Actions button footer */}
            <div className="pt-4 border-t border-white/5 flex justify-between">
              <button
                onClick={() => handleDelete(selectedRes.id)}
                className="px-4 py-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500 hover:text-white transition text-xs font-semibold flex items-center space-x-1.5"
              >
                <X size={14} />
                <span>Delete & Cancel</span>
              </button>

              {selectedRes.status === 'pending' && (() => {
                const purchaseSentAt = selectedRes.purchase_event_sent_at ? new Date(selectedRes.purchase_event_sent_at) : null;
                const purchaseWindowOpen = purchaseSentAt && (Date.now() - purchaseSentAt.getTime()) < 7 * 24 * 60 * 60 * 1000;
                return (
                  <button
                    onClick={() => handleConfirm(selectedRes.id)}
                    disabled={!!purchaseWindowOpen}
                    title={purchaseWindowOpen
                      ? `Purchase event sudah terkirim ${purchaseSentAt.toLocaleString('id-ID')}. Nonaktif 7 hari untuk mencegah double-count / potensi repeat order.`
                      : undefined}
                    className={`px-5 py-2 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition ${
                      purchaseWindowOpen
                        ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                        : 'bg-emerald-500 text-white hover:bg-emerald-600 shadow shadow-emerald-500/20'
                    }`}
                  >
                    <Check size={14} />
                    <span>{purchaseWindowOpen ? 'Purchase Sudah Dikirim' : 'Tandai Lunas'}</span>
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Buat Jadwal Baru Modal (Task 9) */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-slate-900 border border-white/10 rounded-2xl p-6 space-y-5 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowCreateModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <X size={20} />
            </button>

            <div>
              <h3 className="text-xl font-bold text-white flex items-center space-x-2">
                <CalendarIcon size={20} className="text-pink-400" />
                <span>Buat Jadwal Baru</span>
              </h3>
              <p className="text-xs text-slate-400 mt-1">Buat reservasi manual tanpa raw text — input terstruktur</p>
            </div>

            {/* Customer Search Picker */}
            <div className="space-y-2">
              <span className="text-xs text-slate-500 font-semibold block uppercase">Customer</span>
              <input
                type="text"
                value={createForm.customerSearch}
                onChange={(e) => {
                  const v = e.target.value;
                  setCreateForm((prev) => ({ ...prev, customerSearch: v, customerId: '' }));
                  searchCustomers(v);
                }}
                placeholder="Cari nama / nomor HP customer..."
                className="w-full p-2 bg-slate-900 border border-white/10 rounded-lg text-xs text-white"
              />
              {searchingCustomers && <p className="text-[11px] text-slate-500">Mencari...</p>}
              {customerSearchResults.length > 0 && !createForm.customerId && (
                <div className="border border-white/10 rounded-lg bg-slate-950 max-h-48 overflow-y-auto divide-y divide-white/5">
                  {customerSearchResults.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setCreateForm((prev) => ({
                        ...prev,
                        customerId: c.id,
                        customerSearch: `${c.name || 'Bunda'} (${c.phone})`,
                      }))}
                      className="w-full text-left px-3 py-2 hover:bg-white/5 text-xs text-slate-200"
                    >
                      <span className="font-semibold">{c.name || 'Bunda'}</span>
                      <span className="text-slate-500 ml-2">{c.phone}</span>
                    </button>
                  ))}
                </div>
              )}
              {createForm.customerId && (
                <div className="flex items-center justify-between px-3 py-2 bg-pink-500/10 border border-pink-500/20 rounded-lg text-xs text-pink-300">
                  <span>{createForm.customerSearch}</span>
                  <button
                    onClick={() => setCreateForm((prev) => ({ ...prev, customerId: '', customerSearch: '' }))}
                    className="text-slate-400 hover:text-white"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>

            {/* Treatment Category */}
            <div className="space-y-2">
              <span className="text-xs text-slate-500 font-semibold block uppercase">Kategori Treatment</span>
              <div className="flex space-x-2">
                {(['BABY', 'MOMS', 'BOTH'] as const).map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setCreateForm((prev) => ({ ...prev, treatmentCategory: cat }))}
                    className={`px-4 py-2 rounded-lg text-xs font-semibold border transition-all ${
                      createForm.treatmentCategory === cat
                        ? 'bg-pink-500/10 border-pink-500 text-pink-400'
                        : 'border-white/5 text-slate-400 hover:text-white bg-slate-900/35'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Treatment Detail */}
            <div className="space-y-2">
              <span className="text-xs text-slate-500 font-semibold block uppercase">Detail Treatment</span>
              <textarea
                value={createForm.treatmentDetail}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, treatmentDetail: e.target.value }))}
                placeholder="Contoh: Pijat Bayi Ceria (Bayi: Zayn, Usia: 6 bulan)"
                rows={3}
                className="w-full p-2 bg-slate-900 border border-white/10 rounded-lg text-xs text-white resize-none"
              />
            </div>

            {/* Booking Date (optional) */}
            <div className="space-y-2">
              <span className="text-xs text-slate-500 font-semibold block uppercase">Tanggal Booking (opsional)</span>
              <input
                type="datetime-local"
                value={createForm.bookingDate}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, bookingDate: e.target.value }))}
                className="w-full p-2 bg-slate-900 border border-white/10 rounded-lg text-xs text-white"
              />
            </div>

            {/* Dynamic Baby Inputs (BABY / BOTH) */}
            {createForm.treatmentCategory !== 'MOMS' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500 font-semibold block uppercase">Bayi / Anak</span>
                  <button
                    onClick={() => setCreateForm((prev) => ({ ...prev, babies: [...prev.babies, { name: '', ageText: '' }] }))}
                    className="px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-xs font-semibold text-slate-300 hover:bg-pink-500/10 hover:text-pink-400 transition-all"
                  >
                    + Tambah Bayi
                  </button>
                </div>
                {createForm.babies.length === 0 && (
                  <p className="text-[11px] text-slate-600">Belum ada bayi ditambahkan.</p>
                )}
                {createForm.babies.map((baby, i) => (
                  <div key={i} className="flex items-center space-x-2">
                    <input
                      type="text"
                      value={baby.name}
                      onChange={(e) => updateBaby(i, 'name', e.target.value)}
                      placeholder="Nama bayi"
                      className="flex-1 p-2 bg-slate-900 border border-white/10 rounded-lg text-xs text-white"
                    />
                    <input
                      type="text"
                      value={baby.ageText}
                      onChange={(e) => updateBaby(i, 'ageText', e.target.value)}
                      placeholder="Usia (mis. 6 bulan)"
                      className="flex-1 p-2 bg-slate-900 border border-white/10 rounded-lg text-xs text-white"
                    />
                    <button
                      onClick={() => setCreateForm((prev) => ({ ...prev, babies: prev.babies.filter((_, idx) => idx !== i) }))}
                      className="p-2 text-slate-500 hover:text-rose-400"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="pt-4 border-t border-white/5 flex justify-end">
              <button
                onClick={handleCreateReservation}
                className="px-5 py-2 rounded-xl bg-pink-500 hover:bg-pink-600 text-white transition text-xs font-semibold flex items-center space-x-1.5 shadow shadow-pink-500/20"
              >
                <CalendarIcon size={14} />
                <span>Simpan Reservasi</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
