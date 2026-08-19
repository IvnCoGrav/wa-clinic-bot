import React, { useEffect, useState, useMemo } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import {
  Users,
  UserPlus,
  Phone,
  Lock,
  Sparkles,
  Pencil,
  Trash2,
  Shield,
  ShieldCheck,
  UserCheck,
  CheckSquare,
  Square,
  Plus,
  Sliders,
  Search,
  ChevronRight,
  Info,
  CheckCircle2,
  Compass,
  ListOrdered,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import {
  ROLE_LABELS,
  ALL_MODULES,
  RoleConfig,
  getCustomRoles,
  fetchRolesFromApi,
  saveRoleConfig,
  deleteCustomRole,
} from '../../config/rolePermissions';

interface StaffItem {
  id: string;
  tenant_id: string;
  name: string;
  phone: string;
  role: string;
  active: boolean;
  telegram_chat_id?: string | null;
  created_at: string;
  updated_at: string;
  _count?: {
    reservations: number;
  };
}

export const StaffManagement: React.FC = () => {
  const { toast, confirm } = useUiFeedback();
  const [activeTab, setActiveTab] = useState<'STAFF' | 'ROLES'>('STAFF');
  const [staffList, setStaffList] = useState<StaffItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');

  // Roles State (Dynamic RBAC)
  const [rolesMap, setRolesMap] = useState<Record<string, RoleConfig>>({});

  // Modal Create Staff State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<string>('THERAPIST');
  const [creating, setCreating] = useState(false);

  // Modal Edit Staff State
  const [selectedStaffForEdit, setSelectedStaffForEdit] = useState<StaffItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editRole, setEditRole] = useState<string>('THERAPIST');
  const [editPassword, setEditPassword] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [savingEdit, setSavingEdit] = useState(false);

  // Modal Create / Edit Role State
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [roleModalMode, setRoleModalMode] = useState<'CREATE' | 'EDIT'>('CREATE');
  const [roleKey, setRoleKey] = useState('');
  const [roleLabel, setRoleLabel] = useState('');
  const [roleDescription, setRoleDescription] = useState('');
  const [roleAllowedPaths, setRoleAllowedPaths] = useState<string[]>([]);
  const [roleDefaultRedirect, setRoleDefaultRedirect] = useState('/admin/overview');

  const refreshRoles = () => {
    setRolesMap(getCustomRoles());
  };

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
    fetchRolesFromApi().then(() => refreshRoles());

    const handleRolesUpdate = () => {
      refreshRoles();
    };
    window.addEventListener('roles-updated', handleRolesUpdate);
    return () => window.removeEventListener('roles-updated', handleRolesUpdate);
  }, []);

  // Filtered staff list
  const filteredStaffList = useMemo(() => {
    return staffList.filter((s) => {
      const matchesSearch =
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.phone.includes(searchQuery);
      const matchesRole =
        roleFilter === 'ALL' ||
        s.role.toLowerCase() === roleFilter.toLowerCase();
      return matchesSearch && matchesRole;
    });
  }, [staffList, searchQuery, roleFilter]);

  // Grouped modules for matrix
  const moduleCategories = useMemo(() => {
    const map = new Map<string, typeof ALL_MODULES>();
    for (const mod of ALL_MODULES) {
      const list = map.get(mod.category) || [];
      list.push(mod);
      map.set(mod.category, list);
    }
    return Array.from(map.entries()).map(([category, modules]) => ({
      category,
      modules,
    }));
  }, []);

  // Staff counter per role
  const staffCountPerRole = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of staffList) {
      const key = s.role.toLowerCase();
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [staffList]);

  // ==========================================
  // STAFF ACTIONS
  // ==========================================
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
          role: role.toUpperCase(),
        }),
      });

      if (res.success) {
        toast(`Akun staff ${res.data?.name || ''} berhasil dibuat!`, 'success');
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
    setEditRole(staff.role);
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
        role: editRole.toUpperCase(),
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

  // ==========================================
  // ROLE & PERMISSION ACTIONS
  // ==========================================
  const handleOpenCreateRole = () => {
    setRoleModalMode('CREATE');
    setRoleKey('');
    setRoleLabel('');
    setRoleDescription('');
    setRoleAllowedPaths([
      '/admin/overview',
      '/admin/customers',
      '/admin/reservations',
    ]);
    setRoleDefaultRedirect('/admin/overview');
    setShowRoleModal(true);
  };

  const handleOpenEditRole = (cfg: RoleConfig) => {
    setRoleModalMode('EDIT');
    setRoleKey(cfg.key);
    setRoleLabel(cfg.label);
    setRoleDescription(cfg.description);
    setRoleAllowedPaths([...cfg.allowedPaths]);
    setRoleDefaultRedirect(cfg.defaultRedirect || '/admin/overview');
    setShowRoleModal(true);
  };

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleLabel.trim()) {
      toast('Nama role wajib diisi.', 'error');
      return;
    }

    const key =
      roleModalMode === 'CREATE'
        ? roleKey.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_') ||
          roleLabel.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')
        : roleKey;

    if (!key) {
      toast('Key identifier role tidak valid.', 'error');
      return;
    }

    const existingConfig = rolesMap[key];
    const isSystem = existingConfig ? existingConfig.isSystem : false;

    const newConfig: RoleConfig = {
      key,
      label: roleLabel.trim(),
      description: roleDescription.trim(),
      isSystem,
      allowedPaths: roleAllowedPaths,
      defaultRedirect: roleDefaultRedirect,
    };

    await saveRoleConfig(newConfig);
    await fetchRolesFromApi();
    refreshRoles();
    setShowRoleModal(false);
    toast(
      roleModalMode === 'CREATE'
        ? `Role baru "${newConfig.label}" berhasil dibuat & disimpan ke database!`
        : `Hak akses untuk role "${newConfig.label}" berhasil diperbarui di database!`,
      'success'
    );
  };

  const handleDeleteRole = async (cfg: RoleConfig) => {
    if (cfg.isSystem) {
      toast('Role bawaan sistem tidak dapat dihapus.', 'error');
      return;
    }

    const activeCount = staffCountPerRole[cfg.key.toLowerCase()] || 0;
    if (activeCount > 0) {
      toast(`Tidak dapat menghapus role "${cfg.label}" karena masih digunakan oleh ${activeCount} staff aktif.`, 'error');
      return;
    }

    const confirmed = await confirm({
      title: 'Hapus Custom Role',
      message: `Apakah Anda yakin ingin menghapus role "${cfg.label}"? Peran ini akan dihapus dari database.`,
      confirmText: 'Hapus Role',
      cancelText: 'Batal',
      danger: true,
    });

    if (!confirmed) return;

    const success = await deleteCustomRole(cfg.key);
    if (success) {
      await fetchRolesFromApi();
      refreshRoles();
      toast(`Role "${cfg.label}" telah dihapus dari database.`, 'success');
    } else {
      toast('Gagal menghapus role.', 'error');
    }
  };

  const handleToggleMatrixPermission = (roleKeyToToggle: string, path: string) => {
    const targetRole = rolesMap[roleKeyToToggle];
    if (!targetRole) return;
    if (targetRole.isSystem && (roleKeyToToggle === 'super_admin' || roleKeyToToggle === 'tenant_admin')) {
      toast('Hak akses Admin Utama / Super Admin selalu penuh dan tidak dapat dikurangi.', 'info');
      return;
    }

    const hasP = targetRole.allowedPaths.includes(path);
    const newPaths = hasP
      ? targetRole.allowedPaths.filter((p) => p !== path)
      : [...targetRole.allowedPaths, path];

    const updated: RoleConfig = {
      ...targetRole,
      allowedPaths: newPaths,
    };

    saveRoleConfig(updated);
    refreshRoles();
    toast(`Hak akses "${targetRole.label}" diperbarui.`, 'success');
  };

  const handleToggleCategoryForRole = (roleKeyToToggle: string, paths: string[], selectAll: boolean) => {
    const targetRole = rolesMap[roleKeyToToggle];
    if (!targetRole) return;
    if (targetRole.isSystem && (roleKeyToToggle === 'super_admin' || roleKeyToToggle === 'tenant_admin')) {
      toast('Hak akses Admin Utama selalu penuh.', 'info');
      return;
    }

    let newPaths: string[];
    if (selectAll) {
      const set = new Set([...targetRole.allowedPaths, ...paths]);
      newPaths = Array.from(set);
    } else {
      newPaths = targetRole.allowedPaths.filter((p) => !paths.includes(p));
    }

    const updated: RoleConfig = {
      ...targetRole,
      allowedPaths: newPaths,
    };

    saveRoleConfig(updated);
    refreshRoles();
    toast(`Izin kategori untuk "${targetRole.label}" diperbarui.`, 'success');
  };

  // Helper Role Badge
  const getRoleBadge = (roleStr: string) => {
    const formatted = roleStr.toLowerCase();
    const config = rolesMap[formatted] || rolesMap[roleStr];
    const label = config ? config.label : ROLE_LABELS[formatted] || roleStr;

    if (formatted === 'therapist') {
      return (
        <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#e8f5f2] text-[#008069] border border-[#c2e7e0]">
          <Sparkles size={11} />
          <span>{label}</span>
        </span>
      );
    }
    if (formatted === 'admin_cs') {
      return (
        <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 border border-purple-200">
          <UserCheck size={11} />
          <span>{label}</span>
        </span>
      );
    }
    if (formatted === 'advertiser') {
      return (
        <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-100 text-sky-800 border border-sky-200">
          <Shield size={11} />
          <span>{label}</span>
        </span>
      );
    }
    if (formatted === 'super_admin' || formatted === 'tenant_admin') {
      return (
        <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
          <ShieldCheck size={11} />
          <span>{label}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
        <Shield size={11} />
        <span>{label}</span>
      </span>
    );
  };

  const roleEntries = Object.values(rolesMap);

  return (
    <div className="space-y-6">
      {/* ========================================================================= */}
      {/* TOP HEADER & TAB NAVIGATION */}
      {/* ========================================================================= */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-[#e9edef] shadow-xs">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-[#008069]/10 text-[#008069]">
              <Users size={22} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-[#111b21]">Manajemen Staff & Akun Pengguna</h1>
              <p className="text-xs text-[#667781] mt-0.5">
                Kelola akun staf klinik, terapis, dan konfigurasi izin hak akses modul (Role-Based Access Control).
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              setActiveTab('ROLES');
              handleOpenCreateRole();
            }}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-[#f0f2f5] text-[#008069] font-bold text-xs border border-[#008069]/30 hover:border-[#008069] shadow-xs transition-all"
          >
            <ShieldCheck size={15} />
            <span>+ Setup Role & Hak Akses</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('STAFF');
              setShowCreateModal(true);
            }}
            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white font-bold text-xs shadow-xs transition-all active:scale-95"
          >
            <UserPlus size={15} />
            <span>+ Tambah Staff Baru</span>
          </button>
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="flex items-center space-x-2 border-b border-[#e9edef] pb-2">
        <button
          onClick={() => setActiveTab('STAFF')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'STAFF'
              ? 'bg-[#008069] text-white shadow-xs'
              : 'bg-white text-[#54656f] border border-[#e9edef] hover:bg-[#f0f2f5]'
          }`}
        >
          <Users size={15} />
          <span>Daftar Akun Pengguna</span>
          <span
            className={`ml-1.5 px-2 py-0.2 rounded-full text-[10px] font-bold ${
              activeTab === 'STAFF' ? 'bg-white/20 text-white' : 'bg-[#e8f5f2] text-[#008069]'
            }`}
          >
            {staffList.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('ROLES')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'ROLES'
              ? 'bg-[#008069] text-white shadow-xs'
              : 'bg-white text-[#54656f] border border-[#e9edef] hover:bg-[#f0f2f5]'
          }`}
        >
          <ShieldCheck size={15} />
          <span>Setup Hak Akses & Role (RBAC)</span>
          <span
            className={`ml-1.5 px-2 py-0.2 rounded-full text-[10px] font-bold ${
              activeTab === 'ROLES' ? 'bg-white/20 text-white' : 'bg-purple-100 text-purple-800'
            }`}
          >
            {roleEntries.length} Role
          </span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: DAFTAR AKUN STAFF */}
      {/* ========================================================================= */}
      {activeTab === 'STAFF' && (
        <div className="space-y-4">
          {/* Search and Filters */}
          <div className="bg-white p-3.5 rounded-2xl border border-[#e9edef] shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-72">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-[#8696a0]">
                <Search size={14} />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari nama atau nomor WhatsApp..."
                className="w-full pl-9 pr-3.5 py-1.5 rounded-xl bg-[#f0f2f5] border-0 text-[#111b21] text-xs focus:outline-none focus:ring-2 focus:ring-[#008069]"
              />
            </div>

            <div className="flex items-center space-x-2 w-full sm:w-auto">
              <label className="text-xs text-[#667781] font-medium whitespace-nowrap">Filter Role:</label>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="px-3 py-1.5 rounded-xl bg-[#f0f2f5] border-0 text-[#111b21] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#008069]"
              >
                <option value="ALL">Semua Peran ({staffList.length})</option>
                {roleEntries.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label} ({staffCountPerRole[r.key.toLowerCase()] || 0})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Staff Table Card */}
          <div className="bg-white rounded-2xl border border-[#e9edef] overflow-hidden shadow-xs">
            <div className="p-4 border-b border-[#e9edef] flex items-center justify-between bg-[#f8fafc]">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-[#667781] uppercase tracking-wider">
                  Daftar Pengguna Terdaftar
                </span>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#e8f5f2] text-[#008069] border border-[#c2e7e0]">
                  {filteredStaffList.length} Akun
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
                    <th className="px-5 py-3.5">Notifikasi Telegram</th>
                    <th className="px-5 py-3.5 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e9edef]">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-12 text-center text-[#667781]">
                        <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-[#008069] border-t-transparent mb-2"></div>
                        <p className="text-xs">Memuat data staff...</p>
                      </td>
                    </tr>
                  ) : filteredStaffList.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-12 text-center text-[#667781]">
                        <Users size={36} className="mx-auto text-[#8696a0] mb-2" />
                        <p className="font-bold text-[#111b21]">Tidak ada akun staff yang cocok</p>
                        <p className="text-xs mt-1">Coba sesuaikan kata kunci pencarian atau filter peran.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredStaffList.map((staff) => (
                      <tr key={staff.id} className="hover:bg-[#f8fafc] transition-colors">
                        {/* Name */}
                        <td className="px-5 py-3.5 font-bold text-[#111b21]">
                          <div className="flex items-center space-x-2.5">
                            <span
                              className={`h-2 w-2 rounded-full shrink-0 ${
                                staff.active ? 'bg-emerald-500' : 'bg-[#d1d7db]'
                              }`}
                              title={staff.active ? 'Akun aktif' : 'Akun nonaktif'}
                            />
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

                        {/* Telegram Status */}
                        <td className="px-5 py-3.5">
                          {staff.telegram_chat_id ? (
                            <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                              <CheckCircle2 size={11} className="text-emerald-600" />
                              <span>Terhubung</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#f0f2f5] text-[#8696a0] border border-[#e9edef]">
                              <span>Belum Terhubung</span>
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
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: SETUP HAK AKSES & ROLE (RBAC) */}
      {/* ========================================================================= */}
      {activeTab === 'ROLES' && (
        <div className="space-y-6 animate-fadeIn">
          {/* Banner Info */}
          <div className="bg-[#e8f5f2] border border-[#c2e7e0] p-4 rounded-2xl flex items-start gap-3">
            <Info size={18} className="text-[#008069] mt-0.5 flex-shrink-0" />
            <div className="text-xs text-[#111b21] space-y-1">
              <p className="font-bold">Konfigurasi Hak Akses Peran (Role-Based Access Control)</p>
              <p className="text-[#54656f] leading-relaxed">
                Tentukan modul mana saja yang dapat dibuka dan dioperasikan oleh setiap peran pengguna. Perubahan hak akses akan langsung berlaku saat pengguna memuat halaman dashboard.
              </p>
            </div>
          </div>

          {/* Role Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {roleEntries.map((cfg) => {
              const activeMembers = staffCountPerRole[cfg.key.toLowerCase()] || 0;
              const totalModules = ALL_MODULES.length;
              const allowedCount = cfg.allowedPaths.length;

              return (
                <div
                  key={cfg.key}
                  className="bg-white rounded-2xl border border-[#e9edef] p-5 shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow relative overflow-hidden"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <h3 className="font-bold text-sm text-[#111b21]">{cfg.label}</h3>
                          {cfg.isSystem ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                              Sistem
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
                              Kustom
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] font-mono text-[#8696a0]">key: {cfg.key}</p>
                      </div>

                      <span className="px-2.5 py-1 rounded-xl text-xs font-bold bg-[#f0f2f5] text-[#111b21] border border-[#e9edef]">
                        {activeMembers} Staf
                      </span>
                    </div>

                    <p className="text-xs text-[#54656f] line-clamp-2 min-h-[32px]">
                      {cfg.description || 'Tidak ada deskripsi tambahan.'}
                    </p>

                    {/* Module count pill */}
                    <div className="pt-2 border-t border-[#f0f2f5] flex items-center justify-between text-xs">
                      <span className="text-[#667781]">Izin Modul:</span>
                      <span className="font-bold text-[#008069]">
                        {cfg.key === 'super_admin' || cfg.key === 'tenant_admin'
                          ? 'Akses Penuh (19/19)'
                          : `${allowedCount} dari ${totalModules} Modul`}
                      </span>
                    </div>
                  </div>

                  {/* Role Card Actions */}
                  <div className="mt-4 pt-3 border-t border-[#f0f2f5] flex items-center justify-between">
                    <button
                      onClick={() => handleOpenEditRole(cfg)}
                      className="inline-flex items-center space-x-1 text-xs font-bold text-[#008069] hover:text-[#00a884] transition-colors"
                    >
                      <Sliders size={13} />
                      <span>Setup Izin Role</span>
                    </button>

                    {!cfg.isSystem && (
                      <button
                        onClick={() => handleDeleteRole(cfg)}
                        className="p-1 text-rose-500 hover:text-rose-700 transition-colors"
                        title="Hapus Custom Role"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Card Add Role Shortcut */}
            <button
              onClick={handleOpenCreateRole}
              className="rounded-2xl border-2 border-dashed border-[#d1d7db] hover:border-[#008069] p-5 text-center flex flex-col items-center justify-center space-y-2 text-[#667781] hover:text-[#008069] transition-all bg-[#f8fafc] hover:bg-[#e8f5f2]/40 group"
            >
              <div className="p-3 rounded-full bg-white shadow-xs group-hover:scale-110 transition-transform">
                <Plus size={20} className="text-[#008069]" />
              </div>
              <span className="text-xs font-bold">+ Tambah Role Kustom Baru</span>
              <span className="text-[11px] text-[#8696a0]">Buat peran baru & atur izin menu sesuai kebutuhan klinik</span>
            </button>
          </div>

          {/* ========================================================================= */}
          {/* INTERACTIVE PERMISSION MATRIX TABLE */}
          {/* ========================================================================= */}
          <div className="bg-white rounded-2xl border border-[#e9edef] overflow-hidden shadow-xs">
            <div className="p-4 border-b border-[#e9edef] bg-[#f8fafc] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-[#111b21] flex items-center space-x-2">
                  <ShieldCheck className="text-[#008069]" size={17} />
                  <span>Matriks Hak Akses Modul Dashboard</span>
                </h3>
                <p className="text-xs text-[#667781] mt-0.5">
                  Centang atau hapus centang untuk mengatur izin akses modul per peran secara real-time.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#f0f2f5] border-b border-[#e9edef] text-[#111b21]">
                  <tr>
                    <th className="px-5 py-3.5 font-bold uppercase text-[11px] text-[#54656f] w-1/3">
                      Modul Dashboard / Fitur
                    </th>
                    {roleEntries.map((r) => (
                      <th
                        key={r.key}
                        className="px-4 py-3.5 font-bold text-center text-xs whitespace-nowrap"
                      >
                        <div className="flex flex-col items-center">
                          <span>{r.label}</span>
                          <span className="text-[10px] font-normal text-[#667781] font-mono">
                            {r.isSystem ? '(System)' : '(Custom)'}
                          </span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody className="divide-y divide-[#e9edef]">
                  {moduleCategories.map((group) => {
                    const categoryPaths = group.modules.map((m) => m.path);

                    return (
                      <React.Fragment key={group.category}>
                        {/* Category Header Row */}
                        <tr className="bg-[#f8fafc] font-bold text-xs text-[#008069] border-t border-b border-[#e9edef]">
                          <td className="px-5 py-2.5 uppercase tracking-wider flex items-center space-x-1.5">
                            <ChevronRight size={13} />
                            <span>{group.category}</span>
                          </td>
                          {roleEntries.map((r) => {
                            const isSuper = r.key === 'super_admin' || r.key === 'tenant_admin';
                            const allChecked = categoryPaths.every((p) => r.allowedPaths.includes(p));

                            return (
                              <td key={r.key} className="px-4 py-2.5 text-center">
                                {!isSuper && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleToggleCategoryForRole(r.key, categoryPaths, !allChecked)
                                    }
                                    className="text-[10px] text-[#667781] hover:text-[#008069] underline font-semibold transition"
                                    title={allChecked ? 'Hapus Centang Semua' : 'Pilih Semua'}
                                  >
                                    {allChecked ? 'Batal Semua' : 'Pilih Semua'}
                                  </button>
                                )}
                              </td>
                            );
                          })}
                        </tr>

                        {/* Module Rows */}
                        {group.modules.map((mod) => (
                          <tr key={mod.id} className="hover:bg-[#f8fafc] transition-colors">
                            <td className="px-5 py-3">
                              <div>
                                <p className="font-bold text-[#111b21]">{mod.name}</p>
                                <p className="text-[11px] text-[#667781] leading-snug">{mod.description}</p>
                                <p className="text-[10px] font-mono text-[#8696a0] mt-0.5">{mod.path}</p>
                              </div>
                            </td>

                            {roleEntries.map((r) => {
                              const isSuper = r.key === 'super_admin' || r.key === 'tenant_admin';
                              const isAllowed = isSuper || r.allowedPaths.includes(mod.path);

                              return (
                                <td key={r.key} className="px-4 py-3 text-center">
                                  <button
                                    type="button"
                                    disabled={isSuper}
                                    onClick={() => handleToggleMatrixPermission(r.key, mod.path)}
                                    className={`p-1.5 rounded-lg transition-all ${
                                      isSuper
                                        ? 'cursor-not-allowed text-[#008069] opacity-80'
                                        : isAllowed
                                        ? 'text-[#008069] hover:bg-[#e8f5f2] active:scale-95'
                                        : 'text-[#d1d7db] hover:text-[#8696a0] hover:bg-[#f0f2f5]'
                                    }`}
                                    title={
                                      isSuper
                                        ? 'Akses penuh sistem'
                                        : isAllowed
                                        ? `Cabut izin akses ${mod.name} untuk ${r.label}`
                                        : `Berikan izin akses ${mod.name} untuk ${r.label}`
                                    }
                                  >
                                    {isAllowed ? (
                                      <CheckSquare size={18} className="text-[#008069]" />
                                    ) : (
                                      <Square size={18} />
                                    )}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: TAMBAH / EDIT ROLE & HAK AKSES */}
      {/* ========================================================================= */}
      {showRoleModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fadeIn"
          onClick={() => setShowRoleModal(false)}
        >
          <div
            className="w-full max-w-2xl bg-white border border-[#e9edef] rounded-2xl p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#e9edef] pb-3 flex-shrink-0">
              <h3 className="text-base font-bold text-[#111b21] flex items-center space-x-2">
                <ShieldCheck className="text-[#008069]" size={19} />
                <span>
                  {roleModalMode === 'CREATE'
                    ? 'Tambah Role & Setup Hak Akses Baru'
                    : `Edit Hak Akses Role: ${roleLabel}`}
                </span>
              </h3>
              <button
                onClick={() => setShowRoleModal(false)}
                className="p-1.5 rounded-lg text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5]"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveRole} className="space-y-4 overflow-y-auto flex-1 pr-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-[#111b21]">Nama Role</label>
                  <input
                    type="text"
                    required
                    value={roleLabel}
                    onChange={(e) => {
                      setRoleLabel(e.target.value);
                      if (roleModalMode === 'CREATE') {
                        setRoleKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
                      }
                    }}
                    placeholder="Contoh: Supervisor Cabang / Finance"
                    className="w-full px-3.5 py-2 rounded-xl bg-white border border-[#d1d7db] text-[#111b21] text-xs focus:outline-none focus:border-[#008069] shadow-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-[#111b21]">
                    Key Identifier (Slug Sistem)
                  </label>
                  <input
                    type="text"
                    required
                    disabled={roleModalMode === 'EDIT'}
                    value={roleKey}
                    onChange={(e) => setRoleKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                    placeholder="supervisor_cabang"
                    className="w-full px-3.5 py-2 rounded-xl bg-[#f0f2f5] border border-[#d1d7db] font-mono text-[#111b21] text-xs focus:outline-none focus:border-[#008069] disabled:opacity-70 shadow-xs"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-[#111b21]">Deskripsi Singkat Tanggung Jawab</label>
                <input
                  type="text"
                  value={roleDescription}
                  onChange={(e) => setRoleDescription(e.target.value)}
                  placeholder="Contoh: Mengawasi operasional harian, reservasi kalender, dan laporan CS"
                  className="w-full px-3.5 py-2 rounded-xl bg-white border border-[#d1d7db] text-[#111b21] text-xs focus:outline-none focus:border-[#008069] shadow-xs"
                />
              </div>

              {/* Module Checkbox Selector */}
              <div className="space-y-2 pt-2 border-t border-[#e9edef]">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-[#111b21] flex items-center space-x-1.5">
                    <CheckSquare size={14} className="text-[#008069]" />
                    <span>Pilih Izin Modul & Menu Dashboard ({roleAllowedPaths.length} Terpilih)</span>
                  </label>

                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => setRoleAllowedPaths(ALL_MODULES.map((m) => m.path))}
                      className="text-[11px] text-[#008069] hover:underline font-bold"
                    >
                      Pilih Semua (19)
                    </button>
                    <span className="text-[#d1d7db]">|</span>
                    <button
                      type="button"
                      onClick={() => setRoleAllowedPaths([])}
                      className="text-[11px] text-rose-600 hover:underline font-bold"
                    >
                      Hapus Semua
                    </button>
                  </div>
                </div>

                <div className="space-y-3 max-h-72 overflow-y-auto p-3 bg-[#f8fafc] rounded-xl border border-[#e9edef]">
                  {moduleCategories.map((group) => (
                    <div key={group.category} className="space-y-1.5">
                      <div className="text-[11px] font-bold text-[#008069] uppercase tracking-wider border-b border-[#e9edef] pb-1 flex items-center justify-between">
                        <span>{group.category}</span>
                        <button
                          type="button"
                          onClick={() => {
                            const groupPaths = group.modules.map((m) => m.path);
                            const allIn = groupPaths.every((p) => roleAllowedPaths.includes(p));
                            if (allIn) {
                              setRoleAllowedPaths(roleAllowedPaths.filter((p) => !groupPaths.includes(p)));
                            } else {
                              const set = new Set([...roleAllowedPaths, ...groupPaths]);
                              setRoleAllowedPaths(Array.from(set));
                            }
                          }}
                          className="text-[10px] text-[#667781] hover:text-[#008069] normal-case"
                        >
                          Toggle Kategori
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                        {group.modules.map((mod) => {
                          const isChecked = roleAllowedPaths.includes(mod.path);
                          return (
                            <label
                              key={mod.id}
                              className={`flex items-start space-x-2.5 p-2 rounded-xl border cursor-pointer transition-all ${
                                isChecked
                                  ? 'bg-[#e8f5f2] border-[#008069]/30 text-[#111b21]'
                                  : 'bg-white border-[#e9edef] text-[#54656f] hover:bg-[#f0f2f5]'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setRoleAllowedPaths([...roleAllowedPaths, mod.path]);
                                  } else {
                                    setRoleAllowedPaths(
                                      roleAllowedPaths.filter((p) => p !== mod.path)
                                    );
                                  }
                                }}
                                className="mt-0.5 h-4 w-4 rounded text-[#008069] focus:ring-[#008069]"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold leading-tight">{mod.name}</p>
                                <p className="text-[10px] text-[#667781] truncate">{mod.description}</p>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Landing Page Selector */}
              <div className="space-y-1.5 pt-2 border-t border-[#e9edef]">
                <label className="text-xs font-bold text-[#111b21] flex items-center space-x-1.5">
                  <Compass size={14} className="text-[#008069]" />
                  <span>Halaman Awal Masuk Setelah Login (Landing Page)</span>
                </label>
                <p className="text-[11px] text-[#667781]">
                  Pilih menu utama yang langsung dibuka otomatis ketika staf dengan peran ini masuk ke dashboard.
                </p>
                <select
                  value={roleDefaultRedirect}
                  onChange={(e) => setRoleDefaultRedirect(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-[#d1d7db] text-[#111b21] text-xs focus:outline-none focus:border-[#008069] shadow-xs font-medium"
                >
                  {roleAllowedPaths.map((p) => {
                    const mod = ALL_MODULES.find((m) => m.path === p);
                    return (
                      <option key={p} value={p}>
                        {mod ? `${mod.name} (${p})` : p}
                      </option>
                    );
                  })}
                  {!roleAllowedPaths.includes(roleDefaultRedirect) && (
                    <option value={roleDefaultRedirect}>
                      {roleDefaultRedirect} (Kustom)
                    </option>
                  )}
                </select>
              </div>

              {/* Sidebar Menu Sequence / Order Selector */}
              {roleAllowedPaths.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-[#e9edef]">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-[#111b21] flex items-center space-x-1.5">
                      <ListOrdered size={14} className="text-[#008069]" />
                      <span>Urutan Menu di Sidebar ({roleAllowedPaths.length} Menu)</span>
                    </label>
                    <span className="text-[10px] text-[#8696a0]">
                      Klik ▲ atau ▼ untuk memindahkan urutan
                    </span>
                  </div>

                  <div className="space-y-1 max-h-48 overflow-y-auto p-2 bg-[#f8fafc] rounded-xl border border-[#e9edef]">
                    {roleAllowedPaths.map((p, idx) => {
                      const mod = ALL_MODULES.find((m) => m.path === p);
                      const isLanding = roleDefaultRedirect === p;

                      const moveUp = (e: React.MouseEvent) => {
                        e.preventDefault();
                        if (idx === 0) return;
                        const copy = [...roleAllowedPaths];
                        const temp = copy[idx - 1];
                        copy[idx - 1] = copy[idx];
                        copy[idx] = temp;
                        setRoleAllowedPaths(copy);
                      };

                      const moveDown = (e: React.MouseEvent) => {
                        e.preventDefault();
                        if (idx === roleAllowedPaths.length - 1) return;
                        const copy = [...roleAllowedPaths];
                        const temp = copy[idx + 1];
                        copy[idx + 1] = copy[idx];
                        copy[idx] = temp;
                        setRoleAllowedPaths(copy);
                      };

                      return (
                        <div
                          key={p}
                          className={`flex items-center justify-between px-3 py-1.5 rounded-lg border transition-colors ${
                            isLanding
                              ? 'bg-[#e8f5f2] border-[#008069]/40 text-[#111b21]'
                              : 'bg-white border-[#e9edef] text-[#54656f]'
                          }`}
                        >
                          <div className="flex items-center space-x-2 min-w-0">
                            <span className="h-5 w-5 rounded-md bg-[#e9edef] text-[#111b21] flex items-center justify-center text-[10px] font-bold">
                              #{idx + 1}
                            </span>
                            <span className="text-xs font-semibold truncate">
                              {mod?.name || p}
                            </span>
                            {isLanding && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#008069] text-white">
                                Landing Page
                              </span>
                            )}
                          </div>

                          <div className="flex items-center space-x-1">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={moveUp}
                              title="Pindah ke Atas"
                              className="p-1 rounded-md text-[#54656f] hover:bg-[#e9edef] hover:text-[#111b21] disabled:opacity-30"
                            >
                              <ArrowUp size={13} />
                            </button>
                            <button
                              type="button"
                              disabled={idx === roleAllowedPaths.length - 1}
                              onClick={moveDown}
                              title="Pindah ke Bawah"
                              className="p-1 rounded-md text-[#54656f] hover:bg-[#e9edef] hover:text-[#111b21] disabled:opacity-30"
                            >
                              <ArrowDown size={13} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-[#e9edef] flex items-center justify-end space-x-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setShowRoleModal(false)}
                  className="px-4 py-2 rounded-xl text-[#54656f] hover:bg-[#f0f2f5] text-xs font-semibold transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white font-bold text-xs shadow-xs transition-all active:scale-95"
                >
                  Simpan Konfigurasi Role
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: TAMBAH STAFF BARU */}
      {/* ========================================================================= */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fadeIn"
          onClick={() => setShowCreateModal(false)}
        >
          <div
            className="w-full max-w-md bg-white border border-[#e9edef] rounded-2xl p-6 shadow-xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
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
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-[#111b21]">Peran / Hak Akses (Role)</label>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateModal(false);
                      setActiveTab('ROLES');
                      handleOpenCreateRole();
                    }}
                    className="text-[11px] text-[#008069] hover:underline font-bold"
                  >
                    + Buat Role Baru
                  </button>
                </div>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-white border border-[#d1d7db] text-[#111b21] text-xs focus:outline-none focus:border-[#008069] shadow-xs font-medium"
                >
                  {roleEntries.map((r) => (
                    <option key={r.key} value={r.key.toUpperCase()}>
                      {r.label} ({r.description || r.key})
                    </option>
                  ))}
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
                  className="px-4 py-2 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white font-bold text-xs shadow-xs disabled:opacity-50 transition-all active:scale-95"
                >
                  {creating ? 'Menyimpan...' : 'Simpan Akun Staff'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: EDIT STAFF */}
      {/* ========================================================================= */}
      {selectedStaffForEdit && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fadeIn"
          onClick={() => setSelectedStaffForEdit(null)}
        >
          <div
            className="w-full max-w-md bg-white border border-[#e9edef] rounded-2xl p-6 shadow-xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
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
                  onChange={(e) => setEditRole(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-white border border-[#d1d7db] text-[#111b21] text-xs focus:outline-none focus:border-[#008069] shadow-xs font-medium"
                >
                  {roleEntries.map((r) => (
                    <option key={r.key} value={r.key.toUpperCase()}>
                      {r.label} ({r.description || r.key})
                    </option>
                  ))}
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
                  className="px-4 py-2 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white font-bold text-xs shadow-xs disabled:opacity-50 transition-all active:scale-95"
                >
                  {savingEdit ? 'Menyimpan...' : 'Simpan Perubahan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
