import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
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
  category: 'BABY' | 'KIDS' | 'MOMS' | 'BOTH';
  ageTier: AgeTier;
  durationMinutes: number;
  originalPrice: number;
  promoPrice: number;
  description: string;
  isActive: boolean;
}

export const ClinicServices: React.FC = () => {
  const [services, setServices] = useState<ClinicServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<ClinicServiceItem | null>(null);
  
  // Form states
  const [formId, setFormId] = useState('');
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState<'BABY' | 'KIDS' | 'MOMS' | 'BOTH'>('BABY');
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
      alert(`Gagal memuat katalog layanan: ${err.message}`);
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
    } catch (err: any) {
      alert(`Gagal menyimpan layanan: ${err.message}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Yakin ingin menghapus layanan ini dari katalog?')) return;
    try {
      await apiRequest(`/api/admin/services/${id}`, {
        method: 'DELETE'
      });
      loadServices();
    } catch (err: any) {
      alert(`Gagal menghapus layanan: ${err.message}`);
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
      alert(`Gagal mengubah status aktif: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center space-x-2">
            <Activity className="text-pink-500" />
            <span>Katalog Layanan Treatment</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Kelola data paket treatment, durasi pengerjaan, harga normal/promo, dan kriteria usia untuk respon otomatis bot WhatsApp.
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-black transition flex items-center space-x-1.5 shadow-lg shadow-pink-500/10"
        >
          <Plus size={14} />
          <span>Tambah Layanan</span>
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-20">
          <Loader className="animate-spin text-pink-500" size={36} />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {services.map(srv => (
            <div 
              key={srv.id} 
              className={`glass-card rounded-2xl p-6 border flex flex-col justify-between space-y-4 ${
                srv.isActive ? 'border-white/5' : 'border-white/5 opacity-50 bg-slate-950/20'
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                    srv.category === 'BABY' 
                      ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' 
                      : srv.category === 'KIDS'
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        : srv.category === 'MOMS'
                          ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                          : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  }`}>
                    {srv.category}
                  </span>
                  
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleToggleActive(srv)}
                      className="text-slate-500 hover:text-slate-300 transition"
                      title={srv.isActive ? "Nonaktifkan Layanan" : "Aktifkan Layanan"}
                    >
                      {srv.isActive ? <ToggleRight className="text-pink-500" size={20} /> : <ToggleLeft size={20} />}
                    </button>
                    <button
                      onClick={() => openEditModal(srv)}
                      className="p-1 rounded bg-white/5 hover:bg-pink-500/10 text-slate-400 hover:text-pink-400 transition"
                      title="Edit Layanan"
                    >
                      <Edit3 size={12} />
                    </button>
                    <button
                      onClick={() => handleDelete(srv.id)}
                      className="p-1 rounded bg-white/5 hover:bg-rose-500/10 text-slate-500 hover:text-rose-400 transition"
                      title="Hapus Layanan"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <h3 className="font-bold text-white text-sm leading-snug">{srv.name}</h3>
                  <p className="text-[10px] text-slate-500 font-mono">ID: {srv.id}</p>
                </div>

                <div className="flex items-center space-x-3 text-[10px] text-slate-400 font-medium">
                  <span className="flex items-center space-x-1">
                    <Clock size={10} />
                    <span>{srv.durationMinutes} Menit</span>
                  </span>
                  <span>•</span>
                  <span>Usia: {srv.ageTier.label}</span>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed font-sans">{srv.description}</p>
              </div>

              {/* Price Tag Box */}
              <div className="pt-3 border-t border-white/5 flex items-center justify-between">
                <div>
                  <span className="block text-[9px] text-slate-500 uppercase font-semibold">Harga Normal</span>
                  <span className="text-xs text-slate-400 line-through">Rp {srv.originalPrice.toLocaleString('id-ID')}</span>
                </div>
                <div className="text-right">
                  <span className="block text-[9px] text-pink-400 uppercase font-extrabold flex items-center justify-end space-x-0.5">
                    <Sparkles size={8} />
                    <span>Harga Promo</span>
                  </span>
                  <span className="text-sm font-extrabold text-white">Rp {srv.promoPrice.toLocaleString('id-ID')}</span>
                </div>
              </div>

            </div>
          ))}
        </div>
      )}

      {/* Modal Form */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="glass-panel border border-white/10 rounded-2xl w-full max-w-lg overflow-hidden flex flex-col">
            
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-white/5 flex justify-between items-center bg-slate-900/50">
              <h3 className="font-bold text-white text-sm">
                {editingService ? `Edit Layanan: ${editingService.name}` : 'Tambah Layanan Baru'}
              </h3>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSave} className="p-6 space-y-4 max-h-[500px] overflow-y-auto">
              
              {!editingService && (
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-bold block">ID Layanan (Unik)</label>
                  <input
                    type="text"
                    value={formId}
                    onChange={(e) => setFormId(e.target.value)}
                    placeholder="Contoh: baby-massage-ceria (kosongkan untuk generate otomatis)"
                    className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-xs text-white"
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-bold block">Nama Layanan / Treatment</label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Contoh: Pijat Bayi Ceria"
                  className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-xs text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-bold block">Kategori</label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value as any)}
                    className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-xs text-white focus:outline-none"
                  >
                    <option value="BABY">BABY</option>
                    <option value="KIDS">KIDS</option>
                    <option value="MOMS">MOMS</option>
                    <option value="BOTH">BOTH</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-bold block">Durasi (Menit)</label>
                  <input
                    type="number"
                    required
                    value={formDuration}
                    onChange={(e) => setFormDuration(Number(e.target.value))}
                    className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-xs text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-bold block">Min Usia (Bulan)</label>
                  <input
                    type="number"
                    required
                    value={formMinAge}
                    onChange={(e) => setFormMinAge(Number(e.target.value))}
                    className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-xs text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-bold block">Max Usia (Bulan)</label>
                  <input
                    type="number"
                    value={formMaxAge}
                    onChange={(e) => setFormMaxAge(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="Infinity"
                    className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-xs text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-bold block">Label Usia (UI)</label>
                  <input
                    type="text"
                    required
                    value={formAgeLabel}
                    onChange={(e) => setFormAgeLabel(e.target.value)}
                    placeholder="0 - 24 Bulan"
                    className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-xs text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-bold block">Harga Normal (Rp)</label>
                  <input
                    type="number"
                    required
                    value={formOriginalPrice}
                    onChange={(e) => setFormOriginalPrice(Number(e.target.value))}
                    className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-xs text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-bold block">Harga Promo (Rp)</label>
                  <input
                    type="number"
                    required
                    value={formPromoPrice}
                    onChange={(e) => setFormPromoPrice(Number(e.target.value))}
                    className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-xs text-white"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-bold block">Deskripsi & Manfaat</label>
                <textarea
                  rows={3}
                  required
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Deskripsikan secara lengkap manfaat treatment ini..."
                  className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-xs text-white leading-relaxed font-sans"
                />
              </div>

              <div className="flex items-center space-x-2 pt-2">
                <input
                  type="checkbox"
                  id="formIsActive"
                  checked={formIsActive}
                  onChange={(e) => setFormIsActive(e.target.checked)}
                  className="rounded bg-slate-950 border-white/10 text-pink-500 focus:ring-pink-500/20"
                />
                <label htmlFor="formIsActive" className="text-xs text-slate-300 font-semibold cursor-pointer">
                  Aktifkan layanan ini di katalog WhatsApp AI Bot
                </label>
              </div>

              {/* Modal Actions */}
              <div className="flex justify-end space-x-2 pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 rounded-xl text-xs font-bold transition flex items-center space-x-1"
                >
                  <X size={14} />
                  <span>Batal</span>
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-black transition flex items-center space-x-1"
                >
                  <Check size={14} />
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
