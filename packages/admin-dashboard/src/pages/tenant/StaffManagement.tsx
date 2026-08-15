import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import {
  Users,
  UserPlus,
  Phone,
  Lock,
  CheckCircle2,
  XCircle,
  KeyRound,
  Sparkles,
  Calendar,
  Pencil,
  Trash2,
  Power,
  Shield,
  UserCheck,
} from 'lucide-react';
import { ROLE_LABELS } from '../../config/rolePermissions';

interface StaffItem {
  id: string;
  tenant_id: string;
  name: string;
  phone: string;
  role: 'THERAPIST' | 'ADMIN_CS' | 'ADVERTISER' | string;
  active: boolean;
  created_at: string;
  updated_at: string;
  _count?: {
    reservations: number;
  };
}

export const StaffManagement: React.FC = () => {
  const { toast, confirm } = useUiFeedback();
  const [staffList, setStaffList] = useState<StaffItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal Create Staff State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'THERAPIST' | 'ADMIN_CS' | 'ADVERTISER'>('THERAPIST');
  const [creating, setCreating] = useState(false);

  // Modal Edit Staff State
  const [selectedStaffForEdit, setSelectedStaffForEdit] = useState<StaffItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editRole, setEditRole] = useState<'THERAPIST' | 'ADMIN_CS' | 'ADVERTISER'>('THERAPIST');
  const [editPassword, setEditPassword] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [savingEdit, setSavingEdit] = useState(false);

  // Modal Reset Password State
  const [selectedStaffForPassword, setSelectedStaffForPassword] = useState<StaffItem | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resettingPassword, setResettingPassword] = useState(false);

  const fetchStaff = async () => {
    setLoading(true);
    try {
      const res = await apiRequest('/api/admin/staff');
      if (res.success && Array.isArray(res.data)) {
        setStaffList(res.data);
      }
    } catch (err: any) {
      toast(err.message || 'Gagal memuat data staff.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStaff();
  }, []);

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim() || !password.trim()) {
      toast('Nama, nomor HP, dan password wajib diisi.', 'error');
      return;
    }

    setCreating(true);
    try {
      const res = await apiRequest('/api/admin/staff', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          password: password.trim(),
          role,
        }),
      });

      if (res.success) {
        toast(`Akun staff ${res.data?.name || ''} (${res.data?.role || role}) berhasil dibuat!`, 'success');
        setShowCreateModal(false);
        setName('');
        setPhone('');
        setPassword('');
        setRole('THERAPIST');
        fetchStaff();
      }
    } catch (err: any) {
      toast(`Gagal membuat staff: ${err.message || 'Terjadi kesalahan'}`, 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleOpenEdit = (staff: StaffItem) => {
    setSelectedStaffForEdit(staff);
    setEditName(staff.name);
    setEditPhone(staff.phone);
    setEditRole((staff.role as any) || 'THERAPIST');
    setEditPassword('');
    setEditActive(staff.active);
  };

  const handleSaveEditStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStaffForEdit) return;
    if (!editName.trim() || !editPhone.trim()) {
      toast('Nama dan nomor HP staff wajib diisi.', 'error');
      return;
    }

    setSavingEdit(true);
    try {
      const payload: any = {
        name: editName.trim(),
        phone: editPhone.trim(),
        role: editRole,
        active: editActive,
      };
      if (editPassword && editPassword.trim()) {
        payload.password = editPassword.trim();
      }

      const res = await apiRequest(`/api/admin/staff/${selectedStaffForEdit.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      if (res.success) {
        toast(`Data staff "${res.data?.name || editName}" berhasil diperbarui.`, 'success');
        setSelectedStaffForEdit(null);
        fetchStaff();
      }
    } catch (err: any) {
      toast(`Gagal memperbarui staff: ${err.message || 'Terjadi kesalahan'}`, 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteStaff = async (staff: StaffItem) => {
    const confirmed = await confirm({
      title: 'Hapus Akun Staff',
      message: `Apakah Anda yakin ingin menghapus akun "${staff.name}" (${staff.phone}) secara permanen? Seluruh sesi aktif akan dicabut dan penugasan reservasi terkait akan dilepas.`,
      confirmText: 'Hapus Permanen',
      cancelText: 'Batal',
      danger: true,
    });

    if (!confirmed) return;

    try {
      const res = await apiRequest(`/api/admin/staff/${staff.id}`, {
        method: 'DELETE',
      });

      if (res.success) {
        toast(`Akun staff "${staff.name}" telah dihapus.`, 'success');
        fetchStaff();
      }
    } catch (err: any) {
      toast(`Gagal menghapus staff: ${err.message || 'Terjadi kesalahan'}`, 'error');
    }
  };

  const handleToggleActive = async (staff: StaffItem) => {
    const nextStatus = !staff.active;
    const actionLabel = nextStatus ? 'Mengaktifkan' : 'Menonaktifkan';

    const confirmed = await confirm({
      title: `${actionLabel} Akun Staff`,
      message: nextStatus
        ? `Apakah Anda yakin ingin mengaktifkan kembali akun "${staff.name}"? Staff akan dapat login ke portal.`
        : `Apakah Anda yakin ingin menonaktifkan akun "${staff.name}"? Seluruh sesi aktif staff akan dicabut seketika dan staff tidak dapat login lagi.`,
      confirmText: nextStatus ? 'Aktifkan' : 'Nonaktifkan',
      cancelText: 'Batal',
      danger: !nextStatus,
    });

    if (!confirmed) return;

    try {
      const res = await apiRequest(`/api/admin/staff/${staff.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: nextStatus }),
      });

      if (res.success) {
        toast(`Akun "${staff.name}" berhasil di${nextStatus ? 'aktifkan' : 'nonaktifkan'}.`, 'success');
        fetchStaff();
      }
    } catch (err: any) {
      toast(`Gagal mengubah status staff: ${err.message || 'Terjadi kesalahan'}`, 'error');
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStaffForPassword || !newPassword.trim()) return;

    setResettingPassword(true);
    try {
      const res = await apiRequest(`/api/admin/staff/${selectedStaffForPassword.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ password: newPassword.trim() }),
      });

      if (res.success) {
        toast(`Password untuk "${selectedStaffForPassword.name}" berhasil diubah dan sesi aktif telah dicabut.`, 'success');
        setSelectedStaffForPassword(null);
        setNewPassword('');
      }
    } catch (err: any) {
      toast(`Gagal mereset password: ${err.message || 'Terjadi kesalahan'}`, 'error');
    } finally {
      setResettingPassword(false);
    }
  };

  const getRoleBadge = (roleStr: string) => {
    const formatted = roleStr.toLowerCase();
    if (formatted === 'therapist') {
      return (
        <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#e8f5f2] text-[#008069] border border-[#c2e7e0]">
          <Sparkles size={11} />
          <span>Terapis Lapangan</span>
        </span>
      );
    }
    if (formatted === 'admin_cs') {
      return (
        <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 border border-purple-200">
          <UserCheck size={11} />
          <span>Admin CS</span>
        </span>
      );
    }
    if (formatted === 'advertiser') {
      return (
        <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-100 text-sky-800 border border-sky-200">
          <Shield size={11} />
          <span>Advertiser</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#f0f2f5] text-[#54656f] border border-[#e9edef]">
        <span>{roleStr}</span>
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#111b21] flex items-center space-x-2">
            <Users className="text-[#008069]" size={22} />
            <span>Manajemen Staff & Akun Pengguna</span>
          </h1>
          <p className="text-xs text-[#667781] mt-0.5">
            Kelola akun pengguna klinik (Terapis Lapangan, Admin CS & Reservasi, Advertiser).
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white font-semibold text-xs shadow-xs transition-all self-start sm:self-auto"
        >
          <UserPlus size={15} />
          <span>+ Tambah Staff Baru</span>
        </button>
      </div>

      {/* Staff Table Card */}
      <div className="bg-white rounded-2xl border border-[#e9edef] overflow-hidden shadow-xs">
        <div className="p-4 border-b border-[#e9edef] flex items-center justify-between bg-[#f8fafc]">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-bold text-[#667781] uppercase tracking-wider">
              Daftar Pengguna Terdaftar
            </span>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#e8f5f2] text-[#008069] border border-[#c2e7e0]">
              {staffList.length} Akun
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[#111b21]">
            <thead className="bg-[#f8fafc] text-xs font-bold uppercase text-[#667781] border-b border-[#e9edef]">
              <tr>
                <th className="px-5 py-3.5">Nama Staff</th>
                <th className="px-5 py-3.5">Nomor WhatsApp</th>
                <th className="px-5 py-3.5">Peran / Hak Akses</th>
                <th className="px-5 py-3.5">Tugas Reservasi</th>
                <th className="px-5 py-3.5">Status Akun</th>
                <th className="px-5 py-3.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e9edef]">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-[#667781]">
                    <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-[#008069] border-t-transparent mb-2"></div>
                    <p className="text-xs">Memuat data staff...</p>
                  </td>
                </tr>
              ) : staffList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-[#667781]">
                    <Users size={36} className="mx-auto text-[#8696a0] mb-2" />
                    <p className="font-bold text-[#111b21]">Belum ada akun staff</p>
                    <p className="text-xs mt-1">Klik "+ Tambah Staff Baru" untuk membuat akun pengguna pertama.</p>
                  </td>
                </tr>
              ) : (
                staffList.map((staff) => (
                  <tr key={staff.id} className="hover:bg-[#f8fafc] transition-colors">
                    {/* Name */}
                    <td className="px-5 py-3.5 font-bold text-[#111b21]">
                      <div className="flex items-center space-x-2.5">
                        <div className="h-8 w-8 rounded-xl bg-[#e8f5f2] text-[#008069] border border-[#c2e7e0] flex items-center justify-center font-bold text-xs">
                          {staff.name.charAt(0).toUpperCase()}
                        </div>
                        <span>{staff.name}</span>
                      </div>
                    </td>

                    {/* Phone */}
                    <td className="px-5 py-3.5 font-mono text-xs text-[#54656f]">
                      {staff.phone}
                    </td>

                    {/* Role */}
                    <td className="px-5 py-3.5">
                      {getRoleBadge(staff.role)}
                    </td>

                    {/* Assigned Reservations */}
                    <td className="px-5 py-3.5 text-xs text-[#54656f]">
                      <div className="flex items-center space-x-1.5">
                        <Calendar size={13} className="text-[#8696a0]" />
                        <span>{staff._count?.reservations || 0} Reservasi</span>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-5 py-3.5">
                      {staff.active ? (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                          <CheckCircle2 size={12} />
                          <span>Aktif</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-200">
                          <XCircle size={12} />
                          <span>Nonaktif</span>
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end space-x-1">
                        {/* Edit Button */}
                        <button
                          onClick={() => handleOpenEdit(staff)}
                          className="p-1.5 rounded-xl bg-white hover:bg-[#f0f2f5] text-[#54656f] hover:text-[#111b21] transition-colors border border-[#d1d7db] shadow-xs"
                          title="Edit Data Staff"
                        >
                          <Pencil size={13} />
                        </button>

                        {/* Reset password button */}
                        <button
                          onClick={() => {
                            setSelectedStaffForPassword(staff);
                            setNewPassword('');
                          }}
                          className="p-1.5 rounded-xl bg-white hover:bg-amber-50 text-[#54656f] hover:text-amber-700 transition-colors border border-[#d1d7db] shadow-xs"
                          title="Reset Password"
                        >
                          <KeyRound size={13} />
                        </button>

                        {/* Toggle active button */}
                        <button
                          onClick={() => handleToggleActive(staff)}
                          className={`p-1.5 rounded-xl transition-colors border shadow-xs ${
                            staff.active
                              ? 'bg-white hover:bg-rose-50 text-[#54656f] hover:text-rose-600 border-[#d1d7db]'
                              : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                          }`}
                          title={staff.active ? 'Nonaktifkan Akun' : 'Aktifkan Akun'}
                        >
                          <Power size={13} />
                        </button>

                        {/* Delete button */}
                        <button
                          onClick={() => handleDeleteStaff(staff)}
                          className="p-1.5 rounded-xl bg-white hover:bg-rose-50 text-rose-600 hover:text-rose-700 transition-colors border border-[#d1d7db] shadow-xs"
                          title="Hapus Akun Staff"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Create Staff */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white border border-[#e9edef] rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#e9edef] pb-3">
              <h3 className="text-base font-bold text-[#111b21] flex items-center space-x-2">
                <UserPlus className="text-[#008069]" size={18} />
                <span>Tambah Staff / Pengguna Baru</span>
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 rounded-lg text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5]"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateStaff} className="space-y-3.5">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#111b21]">Nama Lengkap Staff</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Contoh: Bidan Yusi / Dewi"
                  className="w-full px-3.5 py-2 rounded-xl bg-white border border-[#d1d7db] text-[#111b21] text-xs focus:outline-none focus:border-[#008069] shadow-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#111b21]">Nomor WhatsApp / HP (Username Login)</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-[#8696a0]">
                    <Phone size={14} />
                  </span>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="08123456789"
                    className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-white border border-[#d1d7db] text-[#111b21] text-xs focus:outline-none focus:border-[#008069] shadow-xs"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#111b21]">Peran / Hak Akses (Role)</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as any)}
                  className="w-full px-3.5 py-2 rounded-xl bg-white border border-[#d1d7db] text-[#111b21] text-xs focus:outline-none focus:border-[#008069] shadow-xs"
                >
                  <option value="THERAPIST">Terapis Lapangan (Portal Chat & Jadwal Tugas)</option>
                  <option value="ADMIN_CS">Admin CS & Reservasi (Dashboard Operasional)</option>
                  <option value="ADVERTISER">Advertiser / Media Buyer (Dashboard Iklan & CAPI)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#111b21]">Password Awal</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-[#8696a0]">
                    <Lock size={14} />
                  </span>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimal 6 karakter"
                    className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-white border border-[#d1d7db] text-[#111b21] text-xs focus:outline-none focus:border-[#008069] shadow-xs"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-[#e9edef] flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl text-[#54656f] hover:bg-[#f0f2f5] text-xs font-semibold transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white font-semibold text-xs shadow-xs disabled:opacity-50 transition-all"
                >
                  {creating ? 'Menyimpan...' : 'Simpan Akun Staff'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Staff */}
      {selectedStaffForEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white border border-[#e9edef] rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#e9edef] pb-3">
              <h3 className="text-base font-bold text-[#111b21] flex items-center space-x-2">
                <Pencil className="text-[#008069]" size={16} />
                <span>Edit Akun Staff</span>
              </h3>
              <button
                onClick={() => setSelectedStaffForEdit(null)}
                className="p-1.5 rounded-lg text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5]"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEditStaff} className="space-y-3.5">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#111b21]">Nama Lengkap</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-white border border-[#d1d7db] text-[#111b21] text-xs focus:outline-none focus:border-[#008069] shadow-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#111b21]">Nomor WhatsApp</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-[#8696a0]">
                    <Phone size={14} />
                  </span>
                  <input
                    type="tel"
                    required
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-white border border-[#d1d7db] text-[#111b21] text-xs focus:outline-none focus:border-[#008069] shadow-xs"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#111b21]">Peran / Hak Akses (Role)</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as any)}
                  className="w-full px-3.5 py-2 rounded-xl bg-white border border-[#d1d7db] text-[#111b21] text-xs focus:outline-none focus:border-[#008069] shadow-xs"
                >
                  <option value="THERAPIST">Terapis Lapangan (Portal Chat & Jadwal Tugas)</option>
                  <option value="ADMIN_CS">Admin CS & Reservasi (Dashboard Operasional)</option>
                  <option value="ADVERTISER">Advertiser / Media Buyer (Dashboard Iklan & CAPI)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#111b21]">
                  Password Baru <span className="text-[#8696a0] font-normal">(Kosongkan jika tidak diubah)</span>
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-[#8696a0]">
                    <Lock size={14} />
                  </span>
                  <input
                    type="password"
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    placeholder="Masukkan password baru"
                    className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-white border border-[#d1d7db] text-[#111b21] text-xs focus:outline-none focus:border-[#008069] shadow-xs"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#111b21]">Status Akun</label>
                <select
                  value={editActive ? 'active' : 'inactive'}
                  onChange={(e) => setEditActive(e.target.value === 'active')}
                  className="w-full px-3.5 py-2 rounded-xl bg-white border border-[#d1d7db] text-[#111b21] text-xs focus:outline-none focus:border-[#008069] shadow-xs"
                >
                  <option value="active">Aktif (Dapat Login)</option>
                  <option value="inactive">Nonaktif (Login Diblokir & Sesi Dicabut)</option>
                </select>
              </div>

              <div className="pt-2 border-t border-[#e9edef] flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setSelectedStaffForEdit(null)}
                  className="px-4 py-2 rounded-xl text-[#54656f] hover:bg-[#f0f2f5] text-xs font-semibold transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-4 py-2 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white font-semibold text-xs shadow-xs disabled:opacity-50 transition-all"
                >
                  {savingEdit ? 'Menyimpan...' : 'Simpan Perubahan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Reset Password */}
      {selectedStaffForPassword && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white border border-[#e9edef] rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#e9edef] pb-3">
              <h3 className="text-base font-bold text-[#111b21] flex items-center space-x-2">
                <KeyRound className="text-amber-600" size={18} />
                <span>Reset Password Staff</span>
              </h3>
              <button
                onClick={() => setSelectedStaffForPassword(null)}
                className="p-1.5 rounded-lg text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5]"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-[#54656f]">
              Ubah kata sandi untuk akun <strong className="text-[#111b21]">{selectedStaffForPassword.name}</strong> ({selectedStaffForPassword.phone}). Sesi aktif staff akan langsung dicabut setelah password diganti.
            </p>

            <form onSubmit={handleResetPassword} className="space-y-3.5">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#111b21]">Password Baru</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-[#8696a0]">
                    <Lock size={14} />
                  </span>
                  <input
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimal 6 karakter"
                    className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-white border border-[#d1d7db] text-[#111b21] text-xs focus:outline-none focus:border-[#008069] shadow-xs"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-[#e9edef] flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setSelectedStaffForPassword(null)}
                  className="px-4 py-2 rounded-xl text-[#54656f] hover:bg-[#f0f2f5] text-xs font-semibold transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={resettingPassword}
                  className="px-4 py-2 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white font-semibold text-xs shadow-xs disabled:opacity-50 transition-all"
                >
                  {resettingPassword ? 'Menyimpan...' : 'Ganti Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
