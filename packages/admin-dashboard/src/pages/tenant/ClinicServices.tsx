import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import { 
  Activity, 
  Plus, 
  Edit3, 
  Trash2, 
  Check, 
  X, 
  HelpCircle, 
  Clock, 
  Sparkles,
  ToggleLeft,
  ToggleRight
} from 'lucide-react';

interface AgeTier {
  minAgeMonths: number;
  maxAgeMonths: number | null;
  label: string;
}

interface ClinicServiceItem {
  id: string;
  name: string;
  category: 'BABY' | 'KIDS' | 'MOMS' | 'BOTH' | 'BUNDLE';
  ageTier: AgeTier;
  durationMinutes: number;
  originalPrice: number;
  promoPrice: number;
  description: string;
  isActive: boolean;
}

export const ClinicServices: React.FC = () => {
  const { toast, confirm } = useUiFeedback();
  const [services, setServices] = useState<ClinicServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<ClinicServiceItem | null>(null);
  
  // Form states
  const [formId, setFormId] = useState('');
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState<'BABY' | 'KIDS' | 'MOMS' | 'BOTH' | 'BUNDLE'>('BABY');
  const [formMinAge, setFormMinAge] = useState(0);
  const [formMaxAge, setFormMaxAge] = useState<number | string>('');
  const [formAgeLabel, setFormAgeLabel] = useState('');
  const [formDuration, setFormDuration] = useState(30);
  const [formOriginalPrice, setFormOriginalPrice] = useState(50000);
  const [formPromoPrice, setFormPromoPrice] = useState(40000);
  const [formDescription, setFormDescription] = useState('');
  const [formIsActive, setFormIsActive] = useState(true);

  const loadServices = async () => {
    setLoading(true);
    try {
      const res = await apiRequest('/api/admin/services');
      const list = Array.isArray(res) ? res : (res?.data || []);
      setServices(list);
    } catch (err: any) {
      toast(`Gagal memuat katalog layanan: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadServices();
  }, []);

  const openAddModal = () => {
    setEditingService(null);
    setFormId('');
    setFormName('');
    setFormCategory('BABY');
    setFormMinAge(0);
    setFormMaxAge('');
    setFormAgeLabel('0 - 24 Bulan');
    setFormDuration(45);
    setFormOriginalPrice(80000);
    setFormPromoPrice(60000);
    setFormDescription('');
    setFormIsActive(true);
    setIsModalOpen(true);
  };

  const openEditModal = (srv: ClinicServiceItem) => {
    setEditingService(srv);
    setFormId(srv.id);
    setFormName(srv.name);
    setFormCategory(srv.category);
    setFormMinAge(srv.ageTier.minAgeMonths);
    setFormMaxAge(srv.ageTier.maxAgeMonths !== null ? srv.ageTier.maxAgeMonths : '');
    setFormAgeLabel(srv.ageTier.label);
    setFormDuration(srv.durationMinutes);
    setFormOriginalPrice(srv.originalPrice);
    setFormPromoPrice(srv.promoPrice);
    setFormDescription(srv.description);
    setFormIsActive(srv.isActive);
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Auto-generate ID if it's new
    const finalId = formId.trim() || formName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    
    const payload = {
      id: finalId,
      name: formName,
      category: formCategory,
      ageTier: {
        minAgeMonths: Number(formMinAge),
        maxAgeMonths: formMaxAge === '' ? null : Number(formMaxAge),
        label: formAgeLabel || `${formMinAge} - ${formMaxAge || 'Any'} Bulan`
      },
      durationMinutes: Number(formDuration),
      originalPrice: Number(formOriginalPrice),
      promoPrice: Number(formPromoPrice),
      description: formDescription,
      isActive: formIsActive
    };

    try {
      if (editingService) {
        // Edit mode
        await apiRequest(`/api/admin/services/${editingService.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      } else {
        // Create mode
        await apiRequest('/api/admin/services', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }
      setIsModalOpen(false);
      loadServices();
      toast('Layanan berhasil disimpan!', 'success');
    } catch (err: any) {
      toast(`Gagal menyimpan layanan: ${err.message}`, 'error');
    }
  };

  const handleDelete = async (id: string) => {
    const isConfirmed = await confirm({
      title: 'Hapus Layanan?',
      message: 'Yakin ingin menghapus layanan ini dari katalog?',
      confirmText: 'Ya, Hapus',
      danger: true,
    });
    if (!isConfirmed) return;
    try {
      await apiRequest(`/api/admin/services/${id}`, {
        method: 'DELETE'
      });
      loadServices();
      toast('Layanan berhasil dihapus.', 'success');
    } catch (err: any) {
      toast(`Gagal menghapus layanan: ${err.message}`, 'error');
    }
  };

  const handleToggleActive = async (srv: ClinicServiceItem) => {
    try {
      await apiRequest(`/api/admin/services/${srv.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...srv, isActive: !srv.isActive })
      });
      loadServices();
    } catch (err: any) {
      toast(`Gagal mengubah status aktif: ${err.message}`, 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#111b21] tracking-tight flex items-center space-x-2">
            <Activity className="text-[#008069]" size={22} />
            <span>Katalog Layanan Treatment</span>
          </h1>
          <p className="text-xs text-[#667781] mt-0.5">
            Kelola data paket treatment, durasi pengerjaan, harga normal/promo, dan kriteria usia untuk respon otomatis bot WhatsApp.
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="px-3.5 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 shadow-xs"
        >
          <Plus size={14} />
          <span>Tambah Layanan</span>
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-20">
          <Loader className="animate-spin text-[#008069]" size={32} />
        </div>
      ) : (
        <div className="bg-white border border-[#e9edef] rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#111b21]">
              <thead>
                <tr className="border-b border-[#e9edef] bg-[#f8fafc] text-[#667781] font-bold uppercase text-[10px]">
                  <th className="px-4 py-3.5">Layanan</th>
                  <th className="px-4 py-3.5">Kategori</th>
                  <th className="px-4 py-3.5">Usia</th>
                  <th className="px-4 py-3.5">Durasi</th>
                  <th className="px-4 py-3.5 text-right">Harga Normal</th>
                  <th className="px-4 py-3.5 text-right">Harga Promo</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-4 py-3.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e9edef]">
                {services.map(srv => (
                  <tr
                    key={srv.id}
                    className={`hover:bg-[#f8fafc] transition-colors ${!srv.isActive ? 'opacity-50' : ''}`}
                  >
                    <td className="px-4 py-3.5">
                      <div className="font-bold text-[#111b21] text-xs">{srv.name}</div>
                      <div className="text-[10px] text-[#8696a0] font-mono">ID: {srv.id}</div>
                      <div className="text-[11px] text-[#54656f] mt-0.5 line-clamp-1">{srv.description}</div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        srv.category === 'BABY' 
                          ? 'bg-sky-100 text-sky-800 border border-sky-200' 
                          : srv.category === 'KIDS'
                            ? 'bg-amber-100 text-amber-800 border border-amber-200'
                            : srv.category === 'MOMS'
                              ? 'bg-purple-100 text-purple-800 border border-purple-200'
                              : srv.category === 'BUNDLE'
                                ? 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                                : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      }`}>
                        {srv.category}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-[#54656f]">{srv.ageTier.label}</td>
                    <td className="px-4 py-3.5 text-xs text-[#54656f]">
                      <div className="flex items-center space-x-1">
                        <Clock size={12} className="text-[#8696a0]" />
                        <span>{srv.durationMinutes} mnt</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-[#8696a0] text-right line-through">Rp {srv.originalPrice.toLocaleString('id-ID')}</td>
                    <td className="px-4 py-3.5 text-xs font-bold text-[#008069] text-right">
                      <span className="flex items-center justify-end space-x-0.5 text-[#008069]">
                        <Sparkles size={11} />
                        <span>Rp {srv.promoPrice.toLocaleString('id-ID')}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <button
                        onClick={() => handleToggleActive(srv)}
                        className="flex items-center space-x-1.5 text-xs font-bold"
                        title={srv.isActive ? "Nonaktifkan Layanan" : "Aktifkan Layanan"}
                      >
                        {srv.isActive ? (
                          <>
                            <ToggleRight className="text-[#008069]" size={20} />
                            <span className="text-emerald-700">Aktif</span>
                          </>
                        ) : (
                          <>
                            <ToggleLeft className="text-[#8696a0]" size={20} />
                            <span className="text-[#8696a0]">Nonaktif</span>
                          </>
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-end space-x-1">
                        <button
                          onClick={() => openEditModal(srv)}
                          className="p-1.5 rounded-xl bg-white hover:bg-[#f0f2f5] text-[#54656f] hover:text-[#111b21] transition border border-[#d1d7db] shadow-xs"
                          title="Edit Layanan"
                        >
                          <Edit3 size={12} />
                        </button>
                        <button
                          onClick={() => handleDelete(srv.id)}
                          className="p-1.5 rounded-xl bg-white hover:bg-rose-50 text-rose-600 hover:text-rose-700 transition border border-[#d1d7db] shadow-xs"
                          title="Hapus Layanan"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {services.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-xs text-[#667781]">
                      Belum ada layanan. Klik "Tambah Layanan" untuk mulai.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Form */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="bg-white border border-[#e9edef] rounded-2xl w-full max-w-lg overflow-hidden flex flex-col shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-[#e9edef] flex justify-between items-center bg-[#f8fafc]">
              <h3 className="font-bold text-[#111b21] text-sm">
                {editingService ? `Edit Layanan: ${editingService.name}` : 'Tambah Layanan Baru'}
              </h3>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-lg text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5]"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSave} className="p-6 space-y-4 max-h-[500px] overflow-y-auto text-xs">
              
              {!editingService && (
                <div className="space-y-1">
                  <label className="text-[10px] text-[#667781] uppercase font-bold block">ID Layanan (Unik)</label>
                  <input
                    type="text"
                    value={formId}
                    onChange={(e) => setFormId(e.target.value)}
                    placeholder="Contoh: baby-massage-ceria (kosongkan untuk generate otomatis)"
                    className="w-full p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] text-[#667781] uppercase font-bold block">Nama Layanan / Treatment</label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Contoh: Pijat Bayi Ceria"
                  className="w-full p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-[#667781] uppercase font-bold block">Kategori</label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value as any)}
                    className="w-full p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                  >
                    <option value="BABY">BABY</option>
                    <option value="KIDS">KIDS</option>
                    <option value="MOMS">MOMS</option>
                    <option value="BOTH">BOTH</option>
                    <option value="BUNDLE">BUNDLE</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-[#667781] uppercase font-bold block">Durasi (Menit)</label>
                  <input
                    type="number"
                    required
                    value={formDuration}
                    onChange={(e) => setFormDuration(Number(e.target.value))}
                    className="w-full p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-[#667781] uppercase font-bold block">Min Usia (Bulan)</label>
                  <input
                    type="number"
                    required
                    value={formMinAge}
                    onChange={(e) => setFormMinAge(Number(e.target.value))}
                    className="w-full p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-[#667781] uppercase font-bold block">Max Usia (Bulan)</label>
                  <input
                    type="number"
                    value={formMaxAge}
                    onChange={(e) => setFormMaxAge(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="Infinity"
                    className="w-full p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-[#667781] uppercase font-bold block">Label Usia (UI)</label>
                  <input
                    type="text"
                    required
                    value={formAgeLabel}
                    onChange={(e) => setFormAgeLabel(e.target.value)}
                    placeholder="0 - 24 Bulan"
                    className="w-full p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-[#667781] uppercase font-bold block">Harga Normal (Rp)</label>
                  <input
                    type="number"
                    required
                    value={formOriginalPrice}
                    onChange={(e) => setFormOriginalPrice(Number(e.target.value))}
                    className="w-full p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-[#667781] uppercase font-bold block">Harga Promo (Rp)</label>
                  <input
                    type="number"
                    required
                    value={formPromoPrice}
                    onChange={(e) => setFormPromoPrice(Number(e.target.value))}
                    className="w-full p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-[#667781] uppercase font-bold block">Deskripsi & Manfaat</label>
                <textarea
                  rows={3}
                  required
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Deskripsikan secara lengkap manfaat treatment ini..."
                  className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] leading-relaxed resize-none focus:outline-none focus:border-[#008069] shadow-xs"
                />
              </div>

              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="formIsActive"
                  checked={formIsActive}
                  onChange={(e) => setFormIsActive(e.target.checked)}
                  className="rounded border-[#d1d7db] text-[#008069] focus:ring-[#008069]"
                />
                <label htmlFor="formIsActive" className="text-xs text-[#111b21] font-semibold cursor-pointer">
                  Aktifkan layanan ini di katalog WhatsApp AI Bot
                </label>
              </div>

              {/* Modal Actions */}
              <div className="flex justify-end space-x-2 pt-3 border-t border-[#e9edef]">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#111b21] rounded-xl text-xs font-semibold transition flex items-center space-x-1 shadow-xs"
                >
                  <X size={13} />
                  <span>Batal</span>
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-bold transition flex items-center space-x-1 shadow-xs"
                >
                  <Check size={13} />
                  <span>Simpan Layanan</span>
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

    </div>
  );
};

interface LoaderProps {
  className?: string;
  size?: number;
}
const Loader: React.FC<LoaderProps> = ({ className, size = 20 }) => (
  <div className={className}>
    <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  </div>
);
