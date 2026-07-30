import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { Reservation } from '../../types';
import { 
  Search, 
  Calendar as CalendarIcon, 
  User, 
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
  const [loading, setLoading] = useState(true);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selectedRes, setSelectedRes] = useState<Reservation | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'table' | 'calendar'>('table');
  const [searchQuery, setSearchQuery] = useState('');
  const [googleCalendarMockActive, setGoogleCalendarMockActive] = useState(true);
  const [editDate, setEditDate] = useState('');

  const loadReservations = async () => {
    try {
      const data = await apiRequest('/api/admin/reservations');
      setReservations(data || []);
    } catch (err) {
      console.error('Failed to load reservations:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReservations();
  }, []);

  const handleConfirm = async (id: string) => {
    try {
      setLoading(true);
      await apiRequest(`/api/admin/reservation/${id}/confirm`, {
        method: 'PATCH'
      });
      alert('Reservation confirmed and event synced to Google Calendar!');
      setSelectedRes(null);
      loadReservations();
    } catch (err: any) {
      alert(`Error confirming reservation: ${err.message}`);
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
      alert('Reservation schedule updated successfully!');
      setSelectedRes(null);
      setEditDate('');
      loadReservations();
    } catch (err: any) {
      alert(`Error updating date: ${err.message}`);
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to cancel and delete this reservation?')) return;
    try {
      setLoading(true);
      await apiRequest(`/api/admin/reservation/${id}`, {
        method: 'DELETE'
      });
      alert('Reservation deleted/cancelled.');
      setSelectedRes(null);
      loadReservations();
    } catch (err: any) {
      alert(`Error deleting: ${err.message}`);
      setLoading(false);
    }
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
        <button 
          onClick={() => { setLoading(true); loadReservations(); }}
          className="flex items-center space-x-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl text-xs font-semibold text-slate-300 transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span>Reload</span>
        </button>
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
                          {res.booking_date ? new Date(res.booking_date).toLocaleString('id-ID') : 'Not Set (Admin decision)'}
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
                    Update Booking Schedule
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

              {selectedRes.status === 'pending' && (
                <button
                  onClick={() => handleConfirm(selectedRes.id)}
                  className="px-5 py-2 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 transition text-xs font-semibold flex items-center space-x-1.5 shadow shadow-emerald-500/20"
                >
                  <Check size={14} />
                  <span>Confirm Reservation</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
