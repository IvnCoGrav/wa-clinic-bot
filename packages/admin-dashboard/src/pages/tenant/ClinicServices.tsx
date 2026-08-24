import React, { useEffect, useState, useMemo } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import { ToggleSwitch } from '../../components/common/ToggleSwitch';
import { 
  Activity, 
  Plus, 
  Edit3, 
  Trash2, 
  Check, 
  X, 
  Clock, 
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Package,
  PlusCircle,
  AlertCircle,
  Info,
  Search,
  CheckCircle2,
  Layers,
  Tag
} from 'lucide-react';

interface AgeTier {
  minAgeMonths: number;
  maxAgeMonths: number | null;
  label: string;
}

export type ClinicServiceCategory = 'BABY' | 'KIDS' | 'MOMS' | 'BOTH' | 'BUNDLE' | 'ADD_ON';
export type ClinicServiceType = 'STANDARD' | 'BUNDLE' | 'ADD_ON';

export interface ClinicServiceItem {
  id: string;
  name: string;
  category: ClinicServiceCategory;
  serviceType?: ClinicServiceType;
  bundleItemIds?: string[];
  isAddon?: boolean;
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
  
  // Filter & Search states
  const [selectedTab, setSelectedTab] = useState<'ALL' | 'BABY' | 'KIDS' | 'MOMS' | 'BUNDLE' | 'ADD_ON'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<ClinicServiceItem | null>(null);
  
  // Form states
  const [formServiceType, setFormServiceType] = useState<ClinicServiceType>('STANDARD');
  const [formId, setFormId] = useState('');
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState<ClinicServiceCategory>('BABY');
  const [formBundleItemIds, setFormBundleItemIds] = useState<string[]>([]);
  const [formMinAge, setFormMinAge] = useState(0);
  const [formMaxAge, setFormMaxAge] = useState<number | string>('');
  const [formAgeLabel, setFormAgeLabel] = useState('');
  const [formDuration, setFormDuration] = useState(40);
  const [formOriginalPrice, setFormOriginalPrice] = useState(80000);
  const [formPromoPrice, setFormPromoPrice] = useState(60000);
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

  // Helper map for fast lookup
  const serviceMap = useMemo(() => {
    const map = new Map<string, ClinicServiceItem>();
    services.forEach((s) => map.set(s.id, s));
    return map;
  }, [services]);

  // List of candidate services that can be added to a bundle (standard or add-on, not self or another bundle)
  const candidateBundleServices = useMemo(() => {
    return services.filter((s) => {
      if (editingService && s.id === editingService.id) return false;
      const isBundle = s.category === 'BUNDLE' || s.serviceType === 'BUNDLE' || (s.bundleItemIds && s.bundleItemIds.length >= 2);
      return !isBundle;
    });
  }, [services, editingService]);

  // Computed sum for bundle components in the form
  const bundleComponentDetails = useMemo(() => {
    if (formServiceType !== 'BUNDLE') {
      return { totalOriginalPrice: 0, totalPromoPrice: 0, totalDuration: 0, items: [] };
    }
    const items = formBundleItemIds
      .map((id) => serviceMap.get(id))
      .filter((item): item is ClinicServiceItem => item !== undefined);

    const totalOriginalPrice = items.reduce((sum, item) => sum + (item.originalPrice || 0), 0);
    const totalPromoPrice = items.reduce((sum, item) => sum + (item.promoPrice || item.originalPrice || 0), 0);
    const totalDuration = items.reduce((sum, item) => sum + (item.durationMinutes || 0), 0);

    return { totalOriginalPrice, totalPromoPrice, totalDuration, items };
  }, [formServiceType, formBundleItemIds, serviceMap]);

  // Handle bundle service selection toggle
  const handleToggleBundleItem = (serviceId: string) => {
    setFormBundleItemIds((prev) => {
      let next: string[];
      if (prev.includes(serviceId)) {
        next = prev.filter((id) => id !== serviceId);
      } else {
        next = [...prev, serviceId];
      }

      // Auto update duration and original price based on selected items
      const selectedItems = next
        .map((id) => serviceMap.get(id))
        .filter((item): item is ClinicServiceItem => item !== undefined);
      
      const newTotalOriginalPrice = selectedItems.reduce((sum, item) => sum + (item.originalPrice || 0), 0);
      const newTotalDuration = selectedItems.reduce((sum, item) => sum + (item.durationMinutes || 0), 0);

      if (newTotalOriginalPrice > 0) {
        setFormOriginalPrice(newTotalOriginalPrice);
        // Suggest a discounted bundle promo price (e.g. ~20% discount if not already set lower)
        if (formPromoPrice >= newTotalOriginalPrice || formPromoPrice === 0) {
          setFormPromoPrice(Math.round((newTotalOriginalPrice * 0.8) / 5000) * 5000);
        }
      }
      if (newTotalDuration > 0) {
        setFormDuration(newTotalDuration);
      }

      return next;
    });
  };

  const openAddModal = () => {
    setEditingService(null);
    setFormServiceType('STANDARD');
    setFormId('');
    setFormName('');
    setFormCategory('BABY');
    setFormBundleItemIds([]);
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
    const isBundle = srv.category === 'BUNDLE' || srv.serviceType === 'BUNDLE' || (Array.isArray(srv.bundleItemIds) && srv.bundleItemIds.length >= 2);
    const isAddon = srv.category === 'ADD_ON' || srv.serviceType === 'ADD_ON' || srv.isAddon === true;
    const resolvedType: ClinicServiceType = isBundle ? 'BUNDLE' : isAddon ? 'ADD_ON' : 'STANDARD';

    setEditingService(srv);
    setFormServiceType(resolvedType);
    setFormId(srv.id);
    setFormName(srv.name);
    setFormCategory(srv.category);
    setFormBundleItemIds(srv.bundleItemIds || []);
    setFormMinAge(srv.ageTier?.minAgeMonths ?? 0);
    setFormMaxAge(srv.ageTier?.maxAgeMonths !== null && srv.ageTier?.maxAgeMonths !== undefined ? srv.ageTier.maxAgeMonths : '');
    setFormAgeLabel(srv.ageTier?.label || '');
    setFormDuration(srv.durationMinutes);
    setFormOriginalPrice(srv.originalPrice);
    setFormPromoPrice(srv.promoPrice);
    setFormDescription(srv.description);
    setFormIsActive(srv.isActive);
    setIsModalOpen(true);
  };

  // Helper when changing service type tab inside modal
  const handleChangeServiceType = (type: ClinicServiceType) => {
    setFormServiceType(type);
    if (type === 'BUNDLE') {
      setFormCategory('BUNDLE');
      if (formAgeLabel === '0 - 24 Bulan' || !formAgeLabel) {
        setFormAgeLabel('Semua Usia / Kombinasi');
      }
    } else if (type === 'ADD_ON') {
      setFormCategory('ADD_ON');
      if (!formAgeLabel) {
        setFormAgeLabel('Semua Usia');
      }
    } else {
      if (formCategory === 'BUNDLE' || formCategory === 'ADD_ON') {
        setFormCategory('BABY');
      }
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Auto-generate ID if it's new
    const finalId = formId.trim() || formName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const isBundle = formServiceType === 'BUNDLE' || formCategory === 'BUNDLE';
    const isAddon = formServiceType === 'ADD_ON' || formCategory === 'ADD_ON';

    // VALIDATION: Bundle must have at least 2 items and price must be cheaper
    if (isBundle) {
      if (formBundleItemIds.length < 2) {
        toast('Paket Bundle wajib menggabungkan minimal 2 layanan eksisting.', 'error');
        return;
      }

      const totalNormalPrice = bundleComponentDetails.totalOriginalPrice || Number(formOriginalPrice);
      const effectiveBundlePrice = Number(formPromoPrice);

      if (effectiveBundlePrice >= totalNormalPrice) {
        toast(`Harga Bundle (Rp ${effectiveBundlePrice.toLocaleString('id-ID')}) harus lebih murah dari total harga normal layanan penyusunnya (Rp ${totalNormalPrice.toLocaleString('id-ID')}).`, 'error');
        return;
      }
    }

    const payload = {
      id: finalId,
      name: formName,
      category: isBundle ? 'BUNDLE' : isAddon ? 'ADD_ON' : formCategory,
      serviceType: formServiceType,
      bundleItemIds: isBundle ? formBundleItemIds : undefined,
      isAddon: isAddon,
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
        await apiRequest(`/api/admin/services/${editingService.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      } else {
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

  // Filtered services based on Tab & Search Query
  const filteredServices = useMemo(() => {
    return services.filter((srv) => {
      const isBundle = srv.category === 'BUNDLE' || srv.serviceType === 'BUNDLE' || (Array.isArray(srv.bundleItemIds) && srv.bundleItemIds.length >= 2);
      const isAddon = srv.category === 'ADD_ON' || srv.serviceType === 'ADD_ON' || srv.isAddon === true;

      // Tab filter
      if (selectedTab === 'BABY' && srv.category !== 'BABY') return false;
      if (selectedTab === 'KIDS' && srv.category !== 'KIDS') return false;
      if (selectedTab === 'MOMS' && srv.category !== 'MOMS') return false;
      if (selectedTab === 'BUNDLE' && !isBundle) return false;
      if (selectedTab === 'ADD_ON' && !isAddon) return false;

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = srv.name.toLowerCase().includes(q);
        const matchesId = srv.id.toLowerCase().includes(q);
        const matchesDesc = srv.description.toLowerCase().includes(q);
        const matchesComponents = isBundle && srv.bundleItemIds?.some((id) => {
          const c = serviceMap.get(id);
          return c && c.name.toLowerCase().includes(q);
        });
        if (!matchesName && !matchesId && !matchesDesc && !matchesComponents) {
          return false;
        }
      }

      return true;
    });
  }, [services, selectedTab, searchQuery, serviceMap]);

  // Tab counts
  const counts = useMemo(() => {
    let baby = 0, kids = 0, moms = 0, bundle = 0, addon = 0;
    services.forEach((s) => {
      const isB = s.category === 'BUNDLE' || s.serviceType === 'BUNDLE' || (s.bundleItemIds && s.bundleItemIds.length >= 2);
      const isA = s.category === 'ADD_ON' || s.serviceType === 'ADD_ON' || s.isAddon === true;
      if (isB) bundle++;
      else if (isA) addon++;
      else if (s.category === 'BABY') baby++;
      else if (s.category === 'KIDS') kids++;
      else if (s.category === 'MOMS') moms++;
    });
    return { all: services.length, baby, kids, moms, bundle, addon };
  }, [services]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#111b21] tracking-tight flex items-center space-x-2">
            <Activity className="text-[#008069]" size={22} />
            <span>Katalog Layanan & Treatment</span>
          </h1>
          <p className="text-xs text-[#667781] mt-0.5">
            Kelola data paket treatment, paket hemat bundle, layanan tambahan add-on, durasi, harga promo, dan kriteria usia untuk rekomendasi WhatsApp AI.
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

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white p-3.5 rounded-2xl border border-[#e9edef] shadow-xs flex items-center space-x-3">
          <div className="p-2.5 bg-emerald-50 text-[#008069] rounded-xl">
            <Activity size={18} />
          </div>
          <div>
            <div className="text-[10px] text-[#667781] uppercase font-bold">Total Layanan</div>
            <div className="text-base font-bold text-[#111b21]">{services.length} Item</div>
          </div>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-[#e9edef] shadow-xs flex items-center space-x-3">
          <div className="p-2.5 bg-indigo-50 text-indigo-700 rounded-xl">
            <Package size={18} />
          </div>
          <div>
            <div className="text-[10px] text-[#667781] uppercase font-bold">Paket Bundle</div>
            <div className="text-base font-bold text-indigo-700">{counts.bundle} Paket</div>
          </div>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-[#e9edef] shadow-xs flex items-center space-x-3">
          <div className="p-2.5 bg-rose-50 text-rose-700 rounded-xl">
            <PlusCircle size={18} />
          </div>
          <div>
            <div className="text-[10px] text-[#667781] uppercase font-bold">Layanan Add-on</div>
            <div className="text-base font-bold text-rose-700">{counts.addon} Item</div>
          </div>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-[#e9edef] shadow-xs flex items-center space-x-3">
          <div className="p-2.5 bg-sky-50 text-sky-700 rounded-xl">
            <Layers size={18} />
          </div>
          <div>
            <div className="text-[10px] text-[#667781] uppercase font-bold">Layanan Mandiri</div>
            <div className="text-base font-bold text-sky-700">{counts.baby + counts.kids + counts.moms} Item</div>
          </div>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 bg-white p-2.5 rounded-2xl border border-[#e9edef] shadow-xs">
        {/* Category Tabs */}
        <div className="flex items-center space-x-1 overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setSelectedTab('ALL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
              selectedTab === 'ALL'
                ? 'bg-[#008069] text-white shadow-xs'
                : 'text-[#54656f] hover:bg-[#f0f2f5]'
            }`}
          >
            Semua ({counts.all})
          </button>
          <button
            onClick={() => setSelectedTab('BABY')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
              selectedTab === 'BABY'
                ? 'bg-sky-700 text-white shadow-xs'
                : 'text-[#54656f] hover:bg-[#f0f2f5]'
            }`}
          >
            Baby ({counts.baby})
          </button>
          <button
            onClick={() => setSelectedTab('KIDS')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
              selectedTab === 'KIDS'
                ? 'bg-amber-700 text-white shadow-xs'
                : 'text-[#54656f] hover:bg-[#f0f2f5]'
            }`}
          >
            Kids ({counts.kids})
          </button>
          <button
            onClick={() => setSelectedTab('MOMS')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
              selectedTab === 'MOMS'
                ? 'bg-purple-700 text-white shadow-xs'
                : 'text-[#54656f] hover:bg-[#f0f2f5]'
            }`}
          >
            Moms ({counts.moms})
          </button>
          <button
            onClick={() => setSelectedTab('BUNDLE')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition flex items-center space-x-1 ${
              selectedTab === 'BUNDLE'
                ? 'bg-indigo-700 text-white shadow-xs'
                : 'text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
            }`}
          >
            <Package size={12} />
            <span>Bundle ({counts.bundle})</span>
          </button>
          <button
            onClick={() => setSelectedTab('ADD_ON')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition flex items-center space-x-1 ${
              selectedTab === 'ADD_ON'
                ? 'bg-rose-700 text-white shadow-xs'
                : 'text-rose-700 bg-rose-50 hover:bg-rose-100'
            }`}
          >
            <PlusCircle size={12} />
            <span>Add-on ({counts.addon})</span>
          </button>
        </div>

        {/* Search */}
        <div className="relative min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8696a0]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari layanan / kata kunci..."
            className="w-full pl-8 pr-3 py-1.5 bg-[#f8fafc] border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] focus:bg-white transition"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8696a0] hover:text-[#111b21]"
            >
              <X size={12} />
            </button>
          )}
        </div>
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
                  <th className="px-4 py-3.5">Layanan / Detail Paket</th>
                  <th className="px-4 py-3.5">Tipe & Kategori</th>
                  <th className="px-4 py-3.5">Target Usia</th>
                  <th className="px-4 py-3.5">Durasi</th>
                  <th className="px-4 py-3.5 text-right">Harga Normal</th>
                  <th className="px-4 py-3.5 text-right">Harga Promo / Bundle</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-4 py-3.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e9edef]">
                {filteredServices.map(srv => {
                  const isBundle = srv.category === 'BUNDLE' || srv.serviceType === 'BUNDLE' || (Array.isArray(srv.bundleItemIds) && srv.bundleItemIds.length >= 2);
                  const isAddon = srv.category === 'ADD_ON' || srv.serviceType === 'ADD_ON' || srv.isAddon === true;
                  const bundleComponents = isBundle && srv.bundleItemIds ? srv.bundleItemIds.map(id => serviceMap.get(id)).filter(Boolean) as ClinicServiceItem[] : [];
                  const savings = srv.originalPrice - srv.promoPrice;
                  const savingsPercent = srv.originalPrice > 0 ? Math.round((savings / srv.originalPrice) * 100) : 0;

                  return (
                    <tr
                      key={srv.id}
                      className={`hover:bg-[#f8fafc] transition-colors ${!srv.isActive ? 'opacity-50' : ''}`}
                    >
                      <td className="px-4 py-3.5">
                        <div className="flex items-center space-x-1.5">
                          <span className="font-bold text-[#111b21] text-xs">{srv.name}</span>
                          {isBundle && (
                            <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-800 rounded-md text-[9px] font-bold uppercase">
                              Bundle
                            </span>
                          )}
                          {isAddon && (
                            <span className="px-1.5 py-0.5 bg-rose-100 text-rose-800 rounded-md text-[9px] font-bold uppercase">
                              Add-on
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-[#8696a0] font-mono mt-0.5">ID: {srv.id}</div>
                        <div className="text-[11px] text-[#54656f] mt-0.5 line-clamp-1">{srv.description}</div>

                        {/* Bundle Component Pills */}
                        {isBundle && bundleComponents.length > 0 && (
                          <div className="mt-2 p-2 bg-indigo-50/70 border border-indigo-100 rounded-xl space-y-1">
                            <div className="text-[10px] font-bold text-indigo-900 flex items-center space-x-1">
                              <Package size={11} className="text-indigo-600" />
                              <span>Termasuk {bundleComponents.length} Layanan Eksisting:</span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {bundleComponents.map((c) => (
                                <span
                                  key={c.id}
                                  className="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-medium bg-white text-indigo-800 border border-indigo-200"
                                >
                                  {c.name} (Rp {c.originalPrice.toLocaleString('id-ID')})
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Addon Guidance Pill */}
                        {isAddon && (
                          <div className="mt-1 text-[10px] text-rose-700 flex items-center space-x-1">
                            <Info size={11} />
                            <span>Wajib dikombinasikan dengan layanan utama.</span>
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          isBundle
                            ? 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                            : isAddon
                              ? 'bg-rose-100 text-rose-800 border border-rose-200'
                              : srv.category === 'BABY' 
                                ? 'bg-sky-100 text-sky-800 border border-sky-200' 
                                : srv.category === 'KIDS'
                                  ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                  : srv.category === 'MOMS'
                                    ? 'bg-purple-100 text-purple-800 border border-purple-200'
                                    : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                        }`}>
                          {isBundle ? 'BUNDLE' : isAddon ? 'ADD-ON' : srv.category}
                        </span>
                      </td>

                      <td className="px-4 py-3.5 text-xs text-[#54656f]">{srv.ageTier?.label || 'Semua Usia'}</td>

                      <td className="px-4 py-3.5 text-xs text-[#54656f]">
                        <div className="flex items-center space-x-1">
                          <Clock size={12} className="text-[#8696a0]" />
                          <span>{srv.durationMinutes} mnt</span>
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-xs text-[#8696a0] text-right line-through">
                        Rp {srv.originalPrice.toLocaleString('id-ID')}
                      </td>

                      <td className="px-4 py-3.5 text-xs text-right">
                        <div className="flex items-center justify-end space-x-0.5 font-bold text-[#008069]">
                          <Sparkles size={11} />
                          <span>Rp {srv.promoPrice.toLocaleString('id-ID')}</span>
                        </div>
                        {savings > 0 && (
                          <div className="text-[10px] text-emerald-600 font-semibold mt-0.5">
                            Hemat Rp {savings.toLocaleString('id-ID')} ({savingsPercent}%)
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3.5">
                        <ToggleSwitch
                          checked={srv.isActive}
                          onChange={() => handleToggleActive(srv)}
                          size="sm"
                          onLabel="Aktif"
                          offLabel="Nonaktif"
                          title={srv.isActive ? "Klik untuk nonaktifkan layanan" : "Klik untuk aktifkan layanan"}
                        />
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
                  );
                })}
                {filteredServices.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-xs text-[#667781]">
                      {searchQuery
                        ? 'Tidak ada layanan yang cocok dengan pencarian Anda.'
                        : 'Belum ada layanan pada kategori ini. Klik "Tambah Layanan" untuk mulai.'}
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
            className="bg-white border border-[#e9edef] rounded-2xl w-full max-w-xl overflow-hidden flex flex-col shadow-xl animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-[#e9edef] flex justify-between items-center bg-[#f8fafc]">
              <div>
                <h3 className="font-bold text-[#111b21] text-sm flex items-center space-x-2">
                  <Activity className="text-[#008069]" size={16} />
                  <span>{editingService ? `Edit Layanan: ${editingService.name}` : 'Tambah Layanan Baru'}</span>
                </h3>
                <p className="text-[11px] text-[#667781] mt-0.5">
                  Tentukan tipe layanan, komponen gabungan (bundle), durasi, dan harga khusus.
                </p>
              </div>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-lg text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5]"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSave} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
              
              {/* Service Type Switcher */}
              <div className="space-y-1.5">
                <label className="text-[10px] text-[#667781] uppercase font-bold block">Jenis / Sifat Layanan</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => handleChangeServiceType('STANDARD')}
                    className={`p-2.5 rounded-xl border text-left flex flex-col justify-between transition ${
                      formServiceType === 'STANDARD'
                        ? 'border-[#008069] bg-[#008069]/5 text-[#008069] font-bold shadow-xs'
                        : 'border-[#d1d7db] bg-white text-[#54656f] hover:bg-[#f8fafc]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs">Layanan Standar</span>
                      {formServiceType === 'STANDARD' && <CheckCircle2 size={13} />}
                    </div>
                    <span className="text-[10px] font-normal opacity-80 mt-1">Layanan mandiri (Single)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleChangeServiceType('BUNDLE')}
                    className={`p-2.5 rounded-xl border text-left flex flex-col justify-between transition ${
                      formServiceType === 'BUNDLE'
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-800 font-bold shadow-xs'
                        : 'border-[#d1d7db] bg-white text-[#54656f] hover:bg-[#f8fafc]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs flex items-center space-x-1">
                        <Package size={12} />
                        <span>Paket Bundle</span>
                      </span>
                      {formServiceType === 'BUNDLE' && <CheckCircle2 size={13} />}
                    </div>
                    <span className="text-[10px] font-normal opacity-80 mt-1">Gabungan 2+ Layanan (Hemat)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleChangeServiceType('ADD_ON')}
                    className={`p-2.5 rounded-xl border text-left flex flex-col justify-between transition ${
                      formServiceType === 'ADD_ON'
                        ? 'border-rose-600 bg-rose-50 text-rose-800 font-bold shadow-xs'
                        : 'border-[#d1d7db] bg-white text-[#54656f] hover:bg-[#f8fafc]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs flex items-center space-x-1">
                        <PlusCircle size={12} />
                        <span>Add-on</span>
                      </span>
                      {formServiceType === 'ADD_ON' && <CheckCircle2 size={13} />}
                    </div>
                    <span className="text-[10px] font-normal opacity-80 mt-1">Layanan Tambahan (Dependen)</span>
                  </button>
                </div>
              </div>

              {/* BUNDLE COMPONENT PICKER */}
              {formServiceType === 'BUNDLE' && (
                <div className="p-3.5 bg-indigo-50/70 border border-indigo-200 rounded-2xl space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-xs font-bold text-indigo-950 flex items-center space-x-1.5">
                        <Package size={14} className="text-indigo-600" />
                        <span>Pilih Layanan Penyusun Bundle (Minimal 2 Layanan)</span>
                      </div>
                      <p className="text-[11px] text-indigo-800/80 mt-0.5">
                        Centang layanan eksisting yang akan digabungkan menjadi satu paket dengan harga hemat.
                      </p>
                    </div>
                    <span className="px-2 py-0.5 bg-indigo-200 text-indigo-900 rounded-lg text-[10px] font-bold">
                      {formBundleItemIds.length} Terpilih
                    </span>
                  </div>

                  <div className="max-h-40 overflow-y-auto space-y-1.5 bg-white p-2.5 rounded-xl border border-indigo-200">
                    {candidateBundleServices.map((cand) => {
                      const isSelected = formBundleItemIds.includes(cand.id);
                      return (
                        <label
                          key={cand.id}
                          className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition text-xs ${
                            isSelected
                              ? 'bg-indigo-100/70 text-indigo-950 font-semibold border border-indigo-300'
                              : 'hover:bg-gray-50 text-[#111b21]'
                          }`}
                        >
                          <div className="flex items-center space-x-2.5">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleBundleItem(cand.id)}
                              className="rounded text-indigo-600 focus:ring-indigo-500"
                            />
                            <span>{cand.name}</span>
                          </div>
                          <div className="text-[11px] text-[#667781] space-x-2">
                            <span>{cand.durationMinutes} mnt</span>
                            <span className="font-semibold text-indigo-900">Rp {cand.originalPrice.toLocaleString('id-ID')}</span>
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  {/* Realtime Bundle Calculations */}
                  <div className="p-2.5 bg-white rounded-xl border border-indigo-100 space-y-1.5">
                    <div className="flex justify-between text-xs text-[#54656f]">
                      <span>Total Durasi Penyusun:</span>
                      <span className="font-bold text-[#111b21]">{bundleComponentDetails.totalDuration} Menit</span>
                    </div>
                    <div className="flex justify-between text-xs text-[#54656f]">
                      <span>Total Harga Normal Satuan:</span>
                      <span className="font-bold text-[#111b21]">Rp {bundleComponentDetails.totalOriginalPrice.toLocaleString('id-ID')}</span>
                    </div>

                    {formBundleItemIds.length >= 2 ? (
                      formPromoPrice < bundleComponentDetails.totalOriginalPrice ? (
                        <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-[11px] font-semibold flex items-center space-x-1.5">
                          <Tag size={13} />
                          <span>
                            Paket Hemat! Customer berhemat Rp {(bundleComponentDetails.totalOriginalPrice - formPromoPrice).toLocaleString('id-ID')} ({Math.round(((bundleComponentDetails.totalOriginalPrice - formPromoPrice) / bundleComponentDetails.totalOriginalPrice) * 100)}% lebih murah).
                          </span>
                        </div>
                      ) : (
                        <div className="p-2 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-[11px] font-semibold flex items-center space-x-1.5">
                          <AlertCircle size={13} />
                          <span>
                            Harga Bundle (Rp {formPromoPrice.toLocaleString('id-ID')}) harus lebih murah dari total harga normal layanan (Rp {bundleComponentDetails.totalOriginalPrice.toLocaleString('id-ID')}).
                          </span>
                        </div>
                      )
                    ) : (
                      <div className="text-[11px] text-amber-700 flex items-center space-x-1">
                        <AlertCircle size={12} />
                        <span>Pilih minimal 2 layanan untuk mengaktifkan paket bundle.</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ADD-ON GUIDANCE BANNER */}
              {formServiceType === 'ADD_ON' && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-2xl text-rose-900 text-xs flex items-start space-x-2">
                  <Info size={16} className="text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold">Layanan Tambahan (Add-on)</div>
                    <div className="text-[11px] text-rose-800/90 mt-0.5">
                      Layanan ini tidak bisa berdiri sendiri. Customer di WhatsApp maupun staf di form reservasi wajib memilih minimal satu layanan utama sebelum dapat menambahkan layanan add-on ini.
                    </div>
                  </div>
                </div>
              )}

              {!editingService && (
                <div className="space-y-1">
                  <label className="text-[10px] text-[#667781] uppercase font-bold block">ID Layanan (Unik)</label>
                  <input
                    type="text"
                    value={formId}
                    onChange={(e) => setFormId(e.target.value)}
                    placeholder="Contoh: paket-bundling-ceria (kosongkan untuk generate otomatis)"
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
                  placeholder="Contoh: Paket Pijat Ceria + Sinar Moksa"
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
                    {formServiceType === 'BUNDLE' ? (
                      <option value="BUNDLE">BUNDLE (Paket Gabungan)</option>
                    ) : formServiceType === 'ADD_ON' ? (
                      <>
                        <option value="ADD_ON">ADD_ON (Layanan Tambahan)</option>
                        <option value="BABY">BABY (Add-on Bayi)</option>
                        <option value="KIDS">KIDS (Add-on Anak)</option>
                        <option value="MOMS">MOMS (Add-on Ibu)</option>
                        <option value="BOTH">BOTH (Semua)</option>
                      </>
                    ) : (
                      <>
                        <option value="BABY">BABY</option>
                        <option value="KIDS">KIDS</option>
                        <option value="MOMS">MOMS</option>
                        <option value="BOTH">BOTH (Mom & Baby)</option>
                      </>
                    )}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-[#667781] uppercase font-bold block">Durasi Pengerjaan (Menit)</label>
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
                  <label className="text-[10px] text-[#667781] uppercase font-bold block">
                    {formServiceType === 'BUNDLE' ? 'Total Harga Normal Gabungan (Rp)' : 'Harga Normal (Rp)'}
                  </label>
                  <input
                    type="number"
                    required
                    value={formOriginalPrice}
                    onChange={(e) => setFormOriginalPrice(Number(e.target.value))}
                    className="w-full p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-[#667781] uppercase font-bold block">
                    {formServiceType === 'BUNDLE' ? 'Harga Paket Bundle Hemat (Rp)' : 'Harga Promo (Rp)'}
                  </label>
                  <input
                    type="number"
                    required
                    value={formPromoPrice}
                    onChange={(e) => setFormPromoPrice(Number(e.target.value))}
                    className="w-full p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs font-bold text-[#008069]"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-[#667781] uppercase font-bold block">Deskripsi & Manfaat Treatment</label>
                <textarea
                  rows={3}
                  required
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Deskripsikan secara lengkap manfaat treatment ini..."
                  className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] leading-relaxed resize-none focus:outline-none focus:border-[#008069] shadow-xs"
                />
              </div>

              <div className="pt-2">
                <div className="flex items-center justify-between p-3 rounded-xl bg-[#f8fafc] border border-[#e9edef]">
                  <div>
                    <span className="text-xs font-bold text-[#111b21] block">Status Layanan</span>
                    <span className="text-[11px] text-[#667781]">Tampilkan di katalog WhatsApp AI Bot & Kalender Reservasi</span>
                  </div>
                  <ToggleSwitch
                    checked={formIsActive}
                    onChange={(next) => setFormIsActive(next)}
                    size="sm"
                    onLabel="Aktif"
                    offLabel="Nonaktif"
                  />
                </div>
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
