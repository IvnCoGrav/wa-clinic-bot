import React, { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiRequest } from '../../services/api';
import { DeliveryTiers } from './DeliveryTiers';
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
  totalSessions?: number;
  sessionScheduleType?: string;
}

export const ClinicServices: React.FC = () => {
  const { toast, confirm } = useUiFeedback();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeMainTab = (searchParams.get('tab') === 'delivery' ? 'DELIVERY' : 'CATALOG') as 'CATALOG' | 'DELIVERY';
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
  const [formMinAge, setFormMinAge] = useState<number | ''>(0);
  const [formMaxAge, setFormMaxAge] = useState<number | ''>('');
  const [formAgeLabel, setFormAgeLabel] = useState('');
  const [formDuration, setFormDuration] = useState<number | ''>(40);
  const [formOriginalPrice, setFormOriginalPrice] = useState<number | ''>(80000);
  const [formPromoPrice, setFormPromoPrice] = useState<number | ''>(60000);
  const [formTotalSessions, setFormTotalSessions] = useState<number | ''>('');
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
        const currentPromo = Number(formPromoPrice) || 0;
        if (currentPromo >= newTotalOriginalPrice || currentPromo === 0) {
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
    setFormTotalSessions('');
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
    setFormTotalSessions(srv.totalSessions ?? '');
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
        minAgeMonths: formMinAge === '' ? 0 : Number(formMinAge),
        maxAgeMonths: formMaxAge === '' ? null : Number(formMaxAge),
        label: formAgeLabel || `${formMinAge === '' ? 0 : formMinAge} - ${formMaxAge || 'Any'} Bulan`
      },
      durationMinutes: formDuration === '' ? 40 : Number(formDuration),
      originalPrice: formOriginalPrice === '' ? 0 : Number(formOriginalPrice),
      promoPrice: formPromoPrice === '' ? 0 : Number(formPromoPrice),
      totalSessions: formTotalSessions === '' ? undefined : Number(formTotalSessions),
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
      {/* Top-level Tabs: Katalog vs Ongkir */}
      <div className="flex items-center gap-2 border-b border-divider pb-0">
        <button
          onClick={() => setSearchParams({}, { replace: true })}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition -mb-px ${activeMainTab === 'CATALOG' ? 'border-accent text-accent' : 'border-transparent text-ink-3 hover:text-ink'}`}
        >
          Katalog Layanan
        </button>
        <button
          onClick={() => setSearchParams({ tab: 'delivery' }, { replace: true })}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition -mb-px ${activeMainTab === 'DELIVERY' ? 'border-accent text-accent' : 'border-transparent text-ink-3 hover:text-ink'}`}
        >
          Tarif Ongkir &amp; Delivery
        </button>
      </div>

      {activeMainTab === 'DELIVERY' ? (
        <DeliveryTiers />
      ) : (
      <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink tracking-tight flex items-center space-x-2">
            <Activity className="text-accent" size={22} />
            <span>Katalog Layanan & Treatment</span>
          </h1>
          <p className="text-xs text-ink-3 mt-0.5">
            Kelola data paket treatment, paket hemat bundle, layanan tambahan add-on, durasi, harga promo, dan kriteria usia untuk rekomendasi WhatsApp AI.
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="px-3.5 py-2 bg-accent hover:bg-accent-hover text-accent-ink rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 shadow-xs"
        >
          <Plus size={14} />
          <span>Tambah Layanan</span>
        </button>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-surface dark:text-ink p-3.5 rounded-2xl border border-divider shadow-xs flex items-center space-x-3">
          <div className="p-2.5 bg-success-soft text-accent rounded-xl">
            <Activity size={18} />
          </div>
          <div>
            <div className="text-[10px] text-ink-3 uppercase font-bold">Total Layanan</div>
            <div className="text-base font-bold text-ink">{services.length} Item</div>
          </div>
        </div>

        <div className="bg-surface dark:text-ink p-3.5 rounded-2xl border border-divider shadow-xs flex items-center space-x-3">
          <div className="p-2.5 bg-info-soft text-info rounded-xl">
            <Package size={18} />
          </div>
          <div>
            <div className="text-[10px] text-ink-3 uppercase font-bold">Paket Bundle</div>
            <div className="text-base font-bold text-info">{counts.bundle} Paket</div>
          </div>
        </div>

        <div className="bg-surface dark:text-ink p-3.5 rounded-2xl border border-divider shadow-xs flex items-center space-x-3">
          <div className="p-2.5 bg-danger-soft text-danger rounded-xl">
            <PlusCircle size={18} />
          </div>
          <div>
            <div className="text-[10px] text-ink-3 uppercase font-bold">Layanan Add-on</div>
            <div className="text-base font-bold text-danger">{counts.addon} Item</div>
          </div>
        </div>

        <div className="bg-surface dark:text-ink p-3.5 rounded-2xl border border-divider shadow-xs flex items-center space-x-3">
          <div className="p-2.5 bg-info-soft text-info rounded-xl">
            <Layers size={18} />
          </div>
          <div>
            <div className="text-[10px] text-ink-3 uppercase font-bold">Layanan Mandiri</div>
            <div className="text-base font-bold text-info">{counts.baby + counts.kids + counts.moms} Item</div>
          </div>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 bg-surface p-2.5 rounded-2xl border border-divider shadow-xs">
        {/* Category Tabs */}
        <div className="flex items-center space-x-1 overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setSelectedTab('ALL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
              selectedTab === 'ALL'
                ? 'bg-accent text-accent-ink shadow-xs'
                : 'text-ink-2 hover:bg-fill-1'
            }`}
          >
            Semua ({counts.all})
          </button>
          <button
            onClick={() => setSelectedTab('BABY')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
              selectedTab === 'BABY'
                ? 'bg-info text-on-solid shadow-xs'
                : 'text-ink-2 hover:bg-fill-1'
            }`}
          >
            Baby ({counts.baby})
          </button>
          <button
            onClick={() => setSelectedTab('KIDS')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
              selectedTab === 'KIDS'
                ? 'bg-warning text-on-solid shadow-xs'
                : 'text-ink-2 hover:bg-fill-1'
            }`}
          >
            Kids ({counts.kids})
          </button>
          <button
            onClick={() => setSelectedTab('MOMS')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
              selectedTab === 'MOMS'
                ? 'bg-violet text-on-solid shadow-xs'
                : 'text-ink-2 hover:bg-fill-1'
            }`}
          >
            Moms ({counts.moms})
          </button>
          <button
            onClick={() => setSelectedTab('BUNDLE')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition flex items-center space-x-1 ${
              selectedTab === 'BUNDLE'
                ? 'bg-info text-on-solid shadow-xs'
                : 'text-info bg-info-soft hover:bg-info-line'
            }`}
          >
            <Package size={12} />
            <span>Bundle ({counts.bundle})</span>
          </button>
          <button
            onClick={() => setSelectedTab('ADD_ON')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition flex items-center space-x-1 ${
              selectedTab === 'ADD_ON'
                ? 'bg-danger text-on-solid shadow-xs'
                : 'text-danger bg-danger-soft hover:bg-danger-line'
            }`}
          >
            <PlusCircle size={12} />
            <span>Add-on ({counts.addon})</span>
          </button>
        </div>

        {/* Search */}
        <div className="relative min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari layanan / kata kunci..."
            className="w-full pl-8 pr-3 py-1.5 bg-surface-2 border border-divider rounded-xl text-xs text-ink focus:outline-none focus:border-accent focus:bg-surface transition"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-20">
          <Loader className="animate-spin text-accent" size={32} />
        </div>
      ) : (
        <div className="bg-surface border border-divider rounded-2xl overflow-hidden shadow-xs">
          {/* Mobile Card Stack (< md) */}
          <div className="md:hidden divide-y divide-divider">
            {filteredServices.map(srv => {
              const isBundle = srv.category === 'BUNDLE' || srv.serviceType === 'BUNDLE' || (Array.isArray(srv.bundleItemIds) && srv.bundleItemIds.length >= 2);
              const isAddon = srv.category === 'ADD_ON' || srv.serviceType === 'ADD_ON' || srv.isAddon === true;
              const bundleComponents = isBundle && srv.bundleItemIds ? srv.bundleItemIds.map(id => serviceMap.get(id)).filter(Boolean) as ClinicServiceItem[] : [];
              const origPrice = Number(srv.originalPrice) || 0;
              const promPrice = Number(srv.promoPrice) || 0;
              const savings = origPrice - promPrice;
              const savingsPercent = origPrice > 0 ? Math.round((savings / origPrice) * 100) : 0;

              return (
                <div key={srv.id} className={`p-4 space-y-3 ${!srv.isActive ? 'opacity-60 bg-gray-50/50 dark:bg-gray-900/20' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                        <span className="font-bold text-ink text-sm">{srv.name}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          isBundle
                            ? 'bg-info-soft text-info border border-info-line'
                            : isAddon
                              ? 'bg-danger-soft text-danger border border-danger-line'
                              : srv.category === 'BABY' 
                                ? 'bg-info-soft text-info border border-info-line' 
                                : srv.category === 'KIDS'
                                  ? 'bg-warning-soft text-warning border border-warning-line'
                                  : srv.category === 'MOMS'
                                    ? 'bg-violet-soft text-violet border border-violet-line'
                                    : 'bg-success-soft text-success border border-success-line'
                        }`}>
                          {isBundle ? 'BUNDLE' : isAddon ? 'ADD-ON' : srv.category}
                        </span>
                      </div>
                      <div className="text-[10px] text-ink-3 font-mono">ID: {srv.id}</div>
                    </div>
                    <div className="flex items-center space-x-1 shrink-0 text-xs text-ink-2">
                      <Clock size={12} className="text-ink-3" />
                      <span>{srv.durationMinutes || 0} mnt</span>
                    </div>
                  </div>

                  {srv.description && (
                    <p className="text-xs text-ink-2 line-clamp-2">{srv.description}</p>
                  )}

                  {srv.ageTier?.label && (
                    <div className="text-[11px] text-ink-3">
                      Target: <span className="font-medium text-ink">{srv.ageTier.label}</span>
                    </div>
                  )}

                  {/* Bundle Components */}
                  {isBundle && bundleComponents.length > 0 && (
                    <div className="p-2.5 bg-indigo-50/70 dark:bg-fill-1 border border-indigo-100 dark:border-divider rounded-xl space-y-1.5">
                      <div className="text-[10px] font-bold text-indigo-900 dark:text-ink-2 flex items-center space-x-1">
                        <Package size={11} className="text-info" />
                        <span>Termasuk {bundleComponents.length} Layanan:</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {bundleComponents.map((c) => (
                          <span
                            key={c.id}
                            className="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-medium bg-white dark:bg-transparent text-indigo-800 dark:text-ink-2 border border-indigo-200 dark:border-divider"
                          >
                            {c.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Pricing row */}
                  <div className="flex items-center justify-between pt-1">
                    <div className="space-y-0.5">
                      {origPrice > 0 && origPrice !== promPrice && (
                        <div className="text-xs text-ink-3 line-through">
                          Rp {origPrice.toLocaleString('id-ID')}
                        </div>
                      )}
                      <div className="flex items-center space-x-1 text-sm font-bold text-accent">
                        <Tag size={13} />
                        <span>Rp {promPrice.toLocaleString('id-ID')}</span>
                      </div>
                      {savings > 0 && (
                        <span className="text-[10px] text-success font-semibold">
                          Hemat Rp {savings.toLocaleString('id-ID')} ({savingsPercent}%)
                        </span>
                      )}
                    </div>

                    <div className="flex items-center space-x-2">
                      <ToggleSwitch
                        checked={srv.isActive}
                        onChange={() => handleToggleActive(srv)}
                        size="sm"
                        onLabel="Aktif"
                        offLabel="Nonaktif"
                      />
                      <div className="flex items-center space-x-1 pl-1 border-l border-divider">
                        <button
                          onClick={() => openEditModal(srv)}
                          className="w-9 h-9 flex items-center justify-center rounded-xl bg-fill-1 text-ink-2 active:scale-95 transition"
                          title="Edit Layanan"
                        >
                          <Edit3 size={15} />
                        </button>
                        <button
                          onClick={() => handleDelete(srv.id)}
                          className="w-9 h-9 flex items-center justify-center rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-600 active:scale-95 transition"
                          title="Hapus Layanan"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {filteredServices.length === 0 && (
              <div className="p-8 text-center text-xs text-ink-3">
                {searchQuery
                  ? 'Tidak ada layanan yang cocok dengan pencarian Anda.'
                  : 'Belum ada layanan pada kategori ini. Klik "Tambah Layanan" untuk mulai.'}
              </div>
            )}
          </div>

          {/* Desktop Table (>= md) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs text-ink">
              <thead>
                <tr className="border-b border-divider bg-surface-2 dark:bg-surface-2 text-ink-3 font-bold uppercase text-[10px]">
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
              <tbody className="divide-y divide-divider">
                {filteredServices.map(srv => {
                  const isBundle = srv.category === 'BUNDLE' || srv.serviceType === 'BUNDLE' || (Array.isArray(srv.bundleItemIds) && srv.bundleItemIds.length >= 2);
                  const isAddon = srv.category === 'ADD_ON' || srv.serviceType === 'ADD_ON' || srv.isAddon === true;
                  const bundleComponents = isBundle && srv.bundleItemIds ? srv.bundleItemIds.map(id => serviceMap.get(id)).filter(Boolean) as ClinicServiceItem[] : [];
                  const origPrice = Number(srv.originalPrice) || 0;
                  const promPrice = Number(srv.promoPrice) || 0;
                  const savings = origPrice - promPrice;
                  const savingsPercent = origPrice > 0 ? Math.round((savings / origPrice) * 100) : 0;

                  return (
                    <tr
                      key={srv.id}
                      className={`hover:bg-surface-2 dark:hover:bg-fill-1 transition-colors ${!srv.isActive ? 'opacity-50' : ''}`}
                    >
                      <td className="px-4 py-3.5">
                        <div className="flex items-center space-x-1.5">
                          <span className="font-bold text-ink text-xs">{srv.name}</span>
                          {isBundle && (
                            <span className="px-1.5 py-0.5 bg-info-soft text-info rounded-md text-[9px] font-bold uppercase">
                              Bundle
                            </span>
                          )}
                          {isAddon && (
                            <span className="px-1.5 py-0.5 bg-danger-soft text-danger rounded-md text-[9px] font-bold uppercase">
                              Add-on
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-ink-3 font-mono mt-0.5">ID: {srv.id}</div>
                        <div className="text-[11px] text-ink-2 mt-0.5 line-clamp-1">{srv.description}</div>

                        {/* Bundle Component Pills */}
                        {isBundle && bundleComponents.length > 0 && (
                          <div className="mt-2 p-2 bg-indigo-50/70 dark:bg-fill-1 border border-indigo-100 dark:border-divider rounded-xl space-y-1">
                            <div className="text-[10px] font-bold text-indigo-900 dark:text-ink-2 flex items-center space-x-1">
                              <Package size={11} className="text-info" />
                              <span>Termasuk {bundleComponents.length} Layanan Eksisting:</span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {bundleComponents.map((c) => (
                                <span
                                  key={c.id}
                                  className="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-medium bg-white dark:bg-transparent text-indigo-800 dark:text-ink-2 border border-indigo-200 dark:border-divider"
                                >
                                  {c.name} (Rp {Number(c.originalPrice || 0).toLocaleString('id-ID')})
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Addon Guidance Pill */}
                        {isAddon && (
                          <div className="mt-1 text-[10px] text-danger flex items-center space-x-1">
                            <Info size={11} />
                            <span>Wajib dikombinasikan dengan layanan utama.</span>
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          isBundle
                            ? 'bg-info-soft text-info border border-info-line'
                            : isAddon
                              ? 'bg-danger-soft text-danger border border-danger-line'
                              : srv.category === 'BABY' 
                                ? 'bg-info-soft text-info border border-info-line' 
                                : srv.category === 'KIDS'
                                  ? 'bg-warning-soft text-warning border border-warning-line'
                                  : srv.category === 'MOMS'
                                    ? 'bg-violet-soft text-violet border border-violet-line'
                                    : 'bg-success-soft text-success border border-success-line'
                        }`}>
                          {isBundle ? 'BUNDLE' : isAddon ? 'ADD-ON' : srv.category}
                        </span>
                      </td>

                      <td className="px-4 py-3.5 text-xs text-ink-2">{srv.ageTier?.label || 'Semua Usia'}</td>

                      <td className="px-4 py-3.5 text-xs text-ink-2">
                        <div className="flex items-center space-x-1">
                          <Clock size={12} className="text-ink-3" />
                          <span>{srv.durationMinutes || 0} mnt</span>
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-xs text-ink-3 text-right line-through">
                        Rp {origPrice.toLocaleString('id-ID')}
                      </td>

                      <td className="px-4 py-3.5 text-xs text-right">
                        <div className="flex items-center justify-end space-x-0.5 font-bold text-accent">
                          <Tag size={11} />
                          <span>Rp {promPrice.toLocaleString('id-ID')}</span>
                        </div>
                        {savings > 0 && (
                          <div className="text-[10px] text-success font-semibold mt-0.5">
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
                            className="p-1.5 rounded-xl bg-surface hover:bg-fill-1 text-ink-2 hover:text-ink transition border border-divider shadow-xs"
                            title="Edit Layanan"
                          >
                            <Edit3 size={12} />
                          </button>
                          <button
                            onClick={() => handleDelete(srv.id)}
                            className="p-1.5 rounded-xl bg-surface hover:bg-danger-soft text-danger hover:text-danger transition border border-divider shadow-xs"
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
                    <td colSpan={8} className="px-4 py-12 text-center text-xs text-ink-3">
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
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-xs animate-fadeIn"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="bg-surface dark:text-ink border border-divider rounded-t-3xl sm:rounded-2xl w-full max-w-xl overflow-hidden flex flex-col shadow-xl animate-in fade-in zoom-in-95 duration-150 max-h-[88dvh] sm:max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-1.5 bg-divider dark:bg-divider rounded-full mx-auto mt-2.5 sm:hidden shrink-0" />
            
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-divider flex justify-between items-center bg-surface-2 dark:bg-surface-2">
              <div>
                <h3 className="font-bold text-ink text-sm flex items-center space-x-2">
                  <Activity className="text-accent" size={16} />
                  <span>{editingService ? `Edit Layanan: ${editingService.name}` : 'Tambah Layanan Baru'}</span>
                </h3>
                <p className="text-[11px] text-ink-3 mt-0.5">
                  Tentukan tipe layanan, komponen gabungan (bundle), durasi, dan harga khusus.
                </p>
              </div>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="p-2 rounded-xl text-ink-3 hover:text-ink hover:bg-fill-1 active:scale-95 transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSave} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
              
              {/* Service Type Switcher */}
              <div className="space-y-1.5">
                <label className="text-[10px] text-ink-3 uppercase font-bold block">Jenis / Sifat Layanan</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => handleChangeServiceType('STANDARD')}
                    className={`p-2.5 rounded-xl border text-left flex flex-col justify-between transition ${
                      formServiceType === 'STANDARD'
                        ? 'border-accent bg-accent/5 dark:bg-accent-soft text-accent font-bold shadow-xs'
                        : 'border-divider bg-white dark:bg-transparent text-ink-2 hover:bg-surface-2 dark:hover:bg-fill-1'
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
                        ? 'border-indigo-600 bg-indigo-50 dark:bg-fill-1 text-indigo-800 dark:text-ink-2 font-bold shadow-xs'
                        : 'border-divider bg-white dark:bg-transparent text-ink-2 hover:bg-surface-2 dark:hover:bg-fill-1'
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
                        ? 'border-rose-600 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-danger font-bold shadow-xs'
                        : 'border-divider bg-white dark:bg-transparent text-ink-2 hover:bg-surface-2 dark:hover:bg-fill-1'
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
                <div className="p-3.5 bg-indigo-50/70 dark:bg-fill-1 border border-indigo-200 dark:border-divider rounded-2xl space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-xs font-bold text-indigo-950 dark:text-indigo-200 flex items-center space-x-1.5">
                        <Package size={14} className="text-info" />
                        <span>Pilih Layanan Penyusun Bundle (Minimal 2 Layanan)</span>
                      </div>
                      <p className="text-[11px] text-info/80 mt-0.5">
                        Centang layanan eksisting yang akan digabungkan menjadi satu paket dengan harga hemat.
                      </p>
                    </div>
                    <span className="px-2 py-0.5 bg-info-line text-info rounded-lg text-[10px] font-bold">
                      {formBundleItemIds.length} Terpilih
                    </span>
                  </div>

                  <div className="max-h-40 overflow-y-auto space-y-1.5 bg-surface p-2.5 rounded-xl border border-indigo-200 dark:border-divider">
                    {candidateBundleServices.map((cand) => {
                      const isSelected = formBundleItemIds.includes(cand.id);
                      return (
                        <label
                          key={cand.id}
                          className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition text-xs ${
                            isSelected
                              ? 'bg-info-soft/70 text-info font-semibold border border-info-line'
                              : 'hover:bg-fill-1 text-ink'
                          }`}
                        >
                          <div className="flex items-center space-x-2.5">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleBundleItem(cand.id)}
                              className="rounded text-info focus:ring-info"
                            />
                            <span>{cand.name}</span>
                          </div>
                          <div className="text-[11px] text-ink-3 space-x-2">
                            <span>{cand.durationMinutes} mnt</span>
                            <span className="font-semibold text-info">Rp {cand.originalPrice.toLocaleString('id-ID')}</span>
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  {/* Realtime Bundle Calculations */}
                    <div className="p-2.5 bg-surface rounded-xl border border-indigo-100 dark:border-divider space-y-1.5">
                    <div className="flex justify-between text-xs text-ink-2">
                      <span>Total Durasi Penyusun:</span>
                      <span className="font-bold text-ink">{bundleComponentDetails.totalDuration} Menit</span>
                    </div>
                    <div className="flex justify-between text-xs text-ink-2">
                      <span>Total Harga Normal Satuan:</span>
                      <span className="font-bold text-ink">Rp {bundleComponentDetails.totalOriginalPrice.toLocaleString('id-ID')}</span>
                    </div>

                    {formBundleItemIds.length >= 2 ? (
                      (Number(formPromoPrice) || 0) < bundleComponentDetails.totalOriginalPrice ? (
                        <div className="p-2 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40 rounded-lg text-emerald-800 dark:text-emerald-200 text-[11px] font-semibold flex items-center space-x-1.5">
                          <Tag size={13} />
                          <span>
                            Paket Hemat! Customer berhemat Rp {(bundleComponentDetails.totalOriginalPrice - (Number(formPromoPrice) || 0)).toLocaleString('id-ID')} ({Math.round(((bundleComponentDetails.totalOriginalPrice - (Number(formPromoPrice) || 0)) / bundleComponentDetails.totalOriginalPrice) * 100)}% lebih murah).
                          </span>
                        </div>
                      ) : (
                        <div className="p-2 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/40 rounded-lg text-rose-800 dark:text-rose-200 text-[11px] font-semibold flex items-center space-x-1.5">
                          <AlertCircle size={13} />
                          <span>
                            Harga Bundle (Rp {(Number(formPromoPrice) || 0).toLocaleString('id-ID')}) harus lebih murah dari total harga normal layanan (Rp {bundleComponentDetails.totalOriginalPrice.toLocaleString('id-ID')}).
                          </span>
                        </div>
                      )
                    ) : (
                      <div className="text-[11px] text-warning flex items-center space-x-1">
                        <AlertCircle size={12} />
                        <span>Pilih minimal 2 layanan untuk mengaktifkan paket bundle.</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ADD-ON GUIDANCE BANNER */}
              {formServiceType === 'ADD_ON' && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/40 rounded-2xl text-rose-900 dark:text-rose-200 text-xs flex items-start space-x-2">
                  <Info size={16} className="text-danger shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold">Layanan Tambahan (Add-on)</div>
                    <div className="text-[11px] text-danger/90 mt-0.5">
                      Layanan ini tidak bisa berdiri sendiri. Customer di WhatsApp maupun staf di form reservasi wajib memilih minimal satu layanan utama sebelum dapat menambahkan layanan add-on ini.
                    </div>
                  </div>
                </div>
              )}

              {!editingService && (
                <div className="space-y-1">
                  <label className="text-[10px] text-ink-3 uppercase font-bold block">ID Layanan (Unik)</label>
                  <input
                    type="text"
                    value={formId}
                    onChange={(e) => setFormId(e.target.value)}
                    placeholder="Contoh: paket-bundling-ceria (kosongkan untuk generate otomatis)"
                    className="w-full p-2 bg-surface border border-divider rounded-xl text-xs text-ink focus:outline-none focus:border-accent shadow-xs"
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] text-ink-3 uppercase font-bold block">Nama Layanan / Treatment</label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Contoh: Paket Pijat Ceria + Sinar Moksa"
                  className="w-full p-2 bg-surface border border-divider rounded-xl text-xs text-ink focus:outline-none focus:border-accent shadow-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-ink-3 uppercase font-bold block">Kategori</label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value as any)}
                    className="w-full p-2 bg-surface border border-divider rounded-xl text-xs text-ink focus:outline-none focus:border-accent shadow-xs"
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
                  <label className="text-[10px] text-ink-3 uppercase font-bold block">Durasi Pengerjaan (Menit)</label>
                  <input
                    type="number"
                    required
                    value={formDuration}
                    onChange={(e) => setFormDuration(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="40"
                    className="w-full p-2 bg-surface border border-divider rounded-xl text-xs text-ink focus:outline-none focus:border-accent shadow-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-ink-3 uppercase font-bold block">Min Usia (Bulan)</label>
                  <input
                    type="number"
                    required
                    value={formMinAge}
                    onChange={(e) => setFormMinAge(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="0"
                    className="w-full p-2 bg-surface border border-divider rounded-xl text-xs text-ink focus:outline-none focus:border-accent shadow-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-ink-3 uppercase font-bold block">Max Usia (Bulan)</label>
                  <input
                    type="number"
                    value={formMaxAge}
                    onChange={(e) => setFormMaxAge(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="Infinity"
                    className="w-full p-2 bg-surface border border-divider rounded-xl text-xs text-ink focus:outline-none focus:border-accent shadow-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-ink-3 uppercase font-bold block">Label Usia (UI)</label>
                  <input
                    type="text"
                    required
                    value={formAgeLabel}
                    onChange={(e) => setFormAgeLabel(e.target.value)}
                    placeholder="0 - 24 Bulan"
                    className="w-full p-2 bg-surface border border-divider rounded-xl text-xs text-ink focus:outline-none focus:border-accent shadow-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-ink-3 uppercase font-bold block">
                    {formServiceType === 'BUNDLE' ? 'Total Harga Normal Gabungan (Rp)' : 'Harga Normal (Rp)'}
                  </label>
                  <input
                    type="number"
                    required
                    value={formOriginalPrice}
                    onChange={(e) => setFormOriginalPrice(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="0"
                    className="w-full p-2 bg-surface border border-divider rounded-xl text-xs text-ink focus:outline-none focus:border-accent shadow-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-ink-3 uppercase font-bold block">
                    {formServiceType === 'BUNDLE' ? 'Harga Paket Bundle Hemat (Rp)' : 'Harga Promo (Rp)'}
                  </label>
                  <input
                    type="number"
                    required
                    value={formPromoPrice}
                    onChange={(e) => setFormPromoPrice(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="0"
                    className="w-full p-2 bg-surface border border-divider rounded-xl text-xs text-ink focus:outline-none focus:border-accent shadow-xs font-bold text-accent"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-ink-3 uppercase font-bold block">Jumlah Sesi Paket (Opsional)</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={formTotalSessions}
                  onChange={(e) => setFormTotalSessions(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="Contoh: 14 (kosongkan jika bukan paket sesi)"
                  className="w-full p-2 bg-surface border border-divider rounded-xl text-xs text-ink focus:outline-none focus:border-accent shadow-xs"
                />
                <p className="text-[10px] text-ink-3">Jika diisi, layanan ini akan menawarkan pembuatan paket multi-sesi otomatis saat reservasi.</p>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-ink-3 uppercase font-bold block">Deskripsi & Manfaat Treatment</label>
                <textarea
                  rows={3}
                  required
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Deskripsikan secara lengkap manfaat treatment ini..."
                  className="w-full p-2.5 bg-surface border border-divider rounded-xl text-xs text-ink leading-relaxed resize-none focus:outline-none focus:border-accent shadow-xs"
                />
              </div>

              <div className="pt-2">
                <div className="flex items-center justify-between p-3 rounded-xl bg-surface-2 border border-divider">
                  <div>
                    <span className="text-xs font-bold text-ink block">Status Layanan</span>
                    <span className="text-[11px] text-ink-3">Tampilkan di katalog WhatsApp AI Bot & Kalender Reservasi</span>
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
              <div className="flex justify-end space-x-2 pt-3 border-t border-divider">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-surface hover:bg-fill-1 border border-divider text-ink rounded-xl text-xs font-semibold transition flex items-center space-x-1 shadow-xs"
                >
                  <X size={13} />
                  <span>Batal</span>
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-accent hover:bg-accent-hover text-accent-ink rounded-xl text-xs font-bold transition flex items-center space-x-1 shadow-xs"
                >
                  <Check size={13} />
                  <span>Simpan Layanan</span>
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      </>
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
