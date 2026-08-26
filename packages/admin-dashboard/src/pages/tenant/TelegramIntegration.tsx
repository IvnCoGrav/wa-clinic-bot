import React, { useState, useEffect, useMemo } from 'react';
import {
  Send,
  Users,
  CheckCircle2,
  XCircle,
  Copy,
  ExternalLink,
  RefreshCw,
  Sparkles,
  Calendar,
  AlertCircle,
  Search,
  Check,
  Building2,
  Radio,
  Clock,
  ShieldCheck,
  FileText,
} from 'lucide-react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import { DailyReportPanel } from '../../components/settings/DailyReportPanel';

interface StaffItem {
  id: string;
  name: string;
  phone: string;
  role: string;
  active: boolean;
  telegram_chat_id?: string | null;
  created_at: string;
}

export const TelegramIntegration: React.FC = () => {
  const { toast, confirm } = useUiFeedback();
  const [activeTab, setActiveTab] = useState<'STAFF_DISPATCH' | 'CLINIC_REPORTS'>('STAFF_DISPATCH');
  const [loading, setLoading] = useState(true);
  const [staffList, setStaffList] = useState<StaffItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [broadcastingBriefing, setBroadcastingBriefing] = useState(false);

  useEffect(() => {
    fetchStaff();
  }, []);

  const fetchStaff = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ success: boolean; data: StaffItem[] }>('/api/admin/staff');
      if (res.success && Array.isArray(res.data)) {
        // Filter specifically staff with role THERAPIST or active staff
        setStaffList(res.data);
      }
    } catch (err: any) {
      toast(err.message || 'Gagal memuat daftar staff.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const filteredStaff = useMemo(() => {
    return staffList.filter((s) => {
      const q = searchQuery.toLowerCase();
      return s.name.toLowerCase().includes(q) || s.phone.includes(q) || s.role.toLowerCase().includes(q);
    });
  }, [staffList, searchQuery]);

  const stats = useMemo(() => {
    const total = staffList.length;
    const connected = staffList.filter((s) => Boolean(s.telegram_chat_id)).length;
    const unconnected = total - connected;
    return { total, connected, unconnected };
  }, [staffList]);

  // Handle Copy Pairing Link for Staff
  const handleCopyPairingLink = async (staff: StaffItem) => {
    setActionLoadingId(staff.id);
    try {
      const res = await apiRequest<{
        success: boolean;
        data: { directLink: string; botUsername: string; pairingToken: string };
      }>(`/api/admin/staff/${staff.id}/telegram-pairing`);

      if (res.success && res.data?.directLink) {
        await navigator.clipboard.writeText(res.data.directLink);
        setCopiedId(staff.id);
        toast(`Link aktivasi Telegram untuk ${staff.name} berhasil disalin! Silakan bagikan via WhatsApp.`, 'success');
        setTimeout(() => setCopiedId(null), 3000);
      } else {
        toast('Gagal mengambil link pairing staff.', 'error');
      }
    } catch (err: any) {
      toast(err.message || 'Gagal mengambil link pairing.', 'error');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Handle Test Send Daily Briefing to Staff
  const handleTestBriefing = async (staff: StaffItem) => {
    const isConfirmed = await confirm({
      title: `Test Kirim Briefing ke ${staff.name}?`,
      message: `Sistem akan mengirimkan rangkuman jadwal kunjungan hari ini ke akun Telegram ${staff.name}. Pastikan Bidan sudah menghubungkan Telegram.`,
      confirmText: 'Kirim Sekarang',
      cancelText: 'Batal',
    });

    if (!isConfirmed) return;

    setActionLoadingId(`briefing-${staff.id}`);
    try {
      const res = await apiRequest<{
        success: boolean;
        message?: string;
        data?: { sent: boolean; count?: number; reason?: string };
      }>(`/api/admin/staff/${staff.id}/send-briefing`, {
        method: 'POST',
      });

      if (res.success) {
        toast(`Briefing jadwal berhasil terkirim ke Telegram ${staff.name} (${res.data?.count || 0} jadwal)!`, 'success');
      } else {
        toast(res.data?.reason || 'Gagal mengirimkan briefing.', 'error');
      }
    } catch (err: any) {
      toast(err.message || 'Gagal mengirimkan briefing.', 'error');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Handle Broadcast Morning Briefings to All Staff
  const handleBroadcastAll = async () => {
    const isConfirmed = await confirm({
      title: 'Kirim Morning Briefing ke Seluruh Bidan?',
      message: 'Sistem akan mengirimkan pesan rangkuman jadwal hari ini ke semua Bidan/Terapis aktif yang telah menghubungkan akun Telegram.',
      confirmText: 'Broadcast Sekarang',
      cancelText: 'Batal',
    });

    if (!isConfirmed) return;

    setBroadcastingBriefing(true);
    try {
      const res = await apiRequest<{
        success: boolean;
        message?: string;
        data?: { totalStaff: number; briefedStaff: number; totalReservations: number };
      }>('/api/admin/staff/trigger-morning-briefing', {
        method: 'POST',
      });

      if (res.success) {
        toast(res.message || 'Morning Briefing berhasil dikirim ke seluruh staf bertugas!', 'success');
      }
    } catch (err: any) {
      toast(err.message || 'Gagal broadcast morning briefing.', 'error');
    } finally {
      setBroadcastingBriefing(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#e9edef] pb-5">
        <div>
          <div className="flex items-center space-x-2">
            <div className="p-2 rounded-xl bg-sky-50 text-sky-600 border border-sky-200">
              <Send size={22} />
            </div>
            <h1 className="text-2xl font-bold text-[#111b21]">Koneksi & Notifikasi Telegram</h1>
          </div>
          <p className="text-sm text-[#54656f] mt-1">
            Pusat kendali integrasi Telegram untuk briefing jadwal harian tim Bidan/Terapis dan laporan operasional klinik.
          </p>
        </div>

        {/* Global Action */}
        {activeTab === 'STAFF_DISPATCH' && (
          <button
            onClick={handleBroadcastAll}
            disabled={broadcastingBriefing}
            className="inline-flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
          >
            {broadcastingBriefing ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                <span>Mengirim Briefing...</span>
              </>
            ) : (
              <>
                <Sparkles size={14} />
                <span>Kirim Morning Briefing Hari Ini</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center space-x-2 border-b border-[#e9edef]">
        <button
          onClick={() => setActiveTab('STAFF_DISPATCH')}
          className={`flex items-center space-x-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all ${
            activeTab === 'STAFF_DISPATCH'
              ? 'border-[#008069] text-[#008069]'
              : 'border-transparent text-[#54656f] hover:text-[#111b21]'
          }`}
        >
          <Users size={16} />
          <span>Notifikasi Jadwal Bidan / Terapis</span>
          <span className="ml-1.5 px-2 py-0.5 rounded-full text-[10px] bg-[#f0f2f5] text-[#54656f]">
            {staffList.length} Staf
          </span>
        </button>

        <button
          onClick={() => setActiveTab('CLINIC_REPORTS')}
          className={`flex items-center space-x-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all ${
            activeTab === 'CLINIC_REPORTS'
              ? 'border-[#008069] text-[#008069]'
              : 'border-transparent text-[#54656f] hover:text-[#111b21]'
          }`}
        >
          <Building2 size={16} />
          <span>Laporan Harian & Alert Tim Klinik</span>
        </button>
      </div>

      {/* Tab 1: Staff Dispatch & Telegram Pairing */}
      {activeTab === 'STAFF_DISPATCH' && (
        <div className="space-y-6">
          {/* Summary Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-2xl border border-[#e9edef] shadow-xs">
              <div className="text-xs font-medium text-[#54656f]">Total Staff Terdaftar</div>
              <div className="text-2xl font-bold text-[#111b21] mt-1">{stats.total}</div>
              <div className="text-[11px] text-[#8696a0] mt-1">Bidan, Terapis, dan Petugas Lapangan</div>
            </div>

            <div className="bg-emerald-50/60 p-4 rounded-2xl border border-emerald-200/80 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-emerald-800">Telegram Terhubung</span>
                <CheckCircle2 size={16} className="text-emerald-600" />
              </div>
              <div className="text-2xl font-bold text-emerald-900 mt-1">{stats.connected}</div>
              <div className="text-[11px] text-emerald-700 mt-1">Siap menerima notifikasi penugasan & briefing pagi</div>
            </div>

            <div className="bg-amber-50/60 p-4 rounded-2xl border border-amber-200/80 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-amber-800">Belum Terhubung</span>
                <AlertCircle size={16} className="text-amber-600" />
              </div>
              <div className="text-2xl font-bold text-amber-900 mt-1">{stats.unconnected}</div>
              <div className="text-[11px] text-amber-700 mt-1">Salin link pairing & kirim via WhatsApp ke Bidan</div>
            </div>
          </div>

          {/* Info Banner */}
          <div className="bg-sky-50 border border-sky-200 rounded-2xl p-4 text-xs text-sky-900 flex items-start space-x-3">
            <Radio size={18} className="text-sky-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-sky-950">Cara Menghubungkan Telegram Bidan:</div>
              <p className="mt-0.5 text-sky-800">
                1. Klik tombol <b>"Salin Link Pairing"</b> pada nama Bidan yang bersangkutan.<br />
                2. Kirimkan tautan tersebut ke WhatsApp Bidan: <i>"Bidan Siti, klik link ini untuk aktivasi notifikasi jadwal harian di Telegram ya: https://t.me/..."</i><br />
                3. Begitu Bidan membuka link dan menekan <b>Start</b> di Telegram, status akan otomatis berubah menjadi <b>Terhubung</b>. ✨
              </p>
            </div>
          </div>

          {/* Staff Table & Search Filter */}
          <div className="bg-white rounded-2xl border border-[#e9edef] shadow-xs overflow-hidden">
            {/* Table Toolbar */}
            <div className="p-4 border-b border-[#e9edef] flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#fcfdfd]">
              <div className="relative flex-1 max-w-md">
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8696a0]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari nama staff atau nomor HP..."
                  className="w-full pl-9 pr-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-hidden focus:border-[#008069]"
                />
              </div>

              <div className="flex items-center space-x-2 text-xs text-[#54656f]">
                <Clock size={13} className="text-[#8696a0]" />
                <span>Briefing otomatis terjadwal setiap <b>06:00 / 07:00 WIB</b></span>
              </div>
            </div>

            {/* Table Content */}
            {loading ? (
              <div className="p-12 text-center text-xs text-[#8696a0]">
                <RefreshCw size={20} className="animate-spin mx-auto mb-2 text-[#008069]" />
                <span>Memuat data staff...</span>
              </div>
            ) : filteredStaff.length === 0 ? (
              <div className="p-12 text-center text-xs text-[#8696a0]">
                Tidak ada data staff yang cocok dengan pencarian.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#f0f2f5] text-[#54656f] font-semibold border-b border-[#e9edef]">
                      <th className="px-5 py-3.5">Nama Staff</th>
                      <th className="px-5 py-3.5">Nomor HP</th>
                      <th className="px-5 py-3.5">Peran (Role)</th>
                      <th className="px-5 py-3.5">Status Telegram</th>
                      <th className="px-5 py-3.5 text-right">Tindakan Admin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e9edef]">
                    {filteredStaff.map((staff) => {
                      const isConnected = Boolean(staff.telegram_chat_id);
                      const isCopied = copiedId === staff.id;
                      const isLoadingThis = actionLoadingId === staff.id;
                      const isBriefingThis = actionLoadingId === `briefing-${staff.id}`;

                      return (
                        <tr key={staff.id} className="hover:bg-[#fcfdfd] transition-colors">
                          {/* Name & Active Status */}
                          <td className="px-5 py-3.5">
                            <div className="flex items-center space-x-2.5">
                              <span
                                className={`h-2 w-2 rounded-full shrink-0 ${
                                  staff.active ? 'bg-emerald-500' : 'bg-[#d1d7db]'
                                }`}
                                title={staff.active ? 'Akun aktif' : 'Akun nonaktif'}
                              />
                              <span className="font-semibold text-[#111b21]">{staff.name}</span>
                            </div>
                          </td>

                          {/* Phone */}
                          <td className="px-5 py-3.5 font-mono text-[#54656f]">
                            {staff.phone}
                          </td>

                          {/* Role */}
                          <td className="px-5 py-3.5">
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#f0f2f5] text-[#54656f] border border-[#d1d7db]">
                              {staff.role}
                            </span>
                          </td>

                          {/* Telegram Status */}
                          <td className="px-5 py-3.5">
                            {isConnected ? (
                              <div className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                <CheckCircle2 size={12} className="text-emerald-600" />
                                <span>Terhubung ({staff.telegram_chat_id})</span>
                              </div>
                            ) : (
                              <div className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-[#f0f2f5] text-[#8696a0] border border-[#e9edef]">
                                <XCircle size={12} />
                                <span>Belum Terhubung</span>
                              </div>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="px-5 py-3.5 text-right">
                            <div className="flex items-center justify-end space-x-1.5">
                              {/* Copy Link Button */}
                              <button
                                onClick={() => handleCopyPairingLink(staff)}
                                disabled={isLoadingThis}
                                className={`inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold transition-all ${
                                  isCopied
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                                    : 'bg-white hover:bg-[#f0f2f5] text-[#111b21] border-[#d1d7db] shadow-2xs'
                                }`}
                                title="Salin link aktivasi Telegram untuk Bidan"
                              >
                                {isCopied ? (
                                  <>
                                    <Check size={12} />
                                    <span>Tersalin!</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy size={12} className="text-[#54656f]" />
                                    <span>Salin Link Pairing</span>
                                  </>
                                )}
                              </button>

                              {/* Test Briefing Button (Only if connected) */}
                              {isConnected && (
                                <button
                                  onClick={() => handleTestBriefing(staff)}
                                  disabled={isBriefingThis}
                                  className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 text-[11px] font-semibold transition-all"
                                  title="Test kirim briefing jadwal hari ini ke Telegram Bidan"
                                >
                                  {isBriefingThis ? (
                                    <RefreshCw size={12} className="animate-spin" />
                                  ) : (
                                    <Send size={12} />
                                  )}
                                  <span>Test Briefing</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Clinic Reports & Owner / Group Telegram */}
      {activeTab === 'CLINIC_REPORTS' && (
        <div className="space-y-4">
          <DailyReportPanel />
        </div>
      )}
    </div>
  );
};
