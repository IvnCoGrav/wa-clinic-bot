import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';
import { ToggleSwitch } from '../common/ToggleSwitch';
import { 
  X, 
  Calendar as CalendarIcon, 
  Search, 
  Baby, 
  Sparkles, 
  Clock, 
  ChevronDown, 
  Check, 
  Plus, 
  Minus,
  MapPin,
  FileText,
  Eye,
  Trash2,
  CalendarDays,
  UserCheck,
  Zap,
  Bike,
  Home,
  Copy,
  CheckCircle2,
  Receipt,
  Percent,
  BookmarkPlus,
} from 'lucide-react';
import { ClinicServiceItem, StaffOption, QuickSlotTarget } from './types';
import { Reservation } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { calculateOngkirFromTiers, DeliveryTierItem } from '../../utils/deliveryTierCalculator';
import { useFormDraft } from '../../hooks/useFormDraft';

const CLINIC_COORDS = {
  lat: -7.34886,
  lng: 112.751677,
  name: 'Kala Moms and Baby Spa (Klinik)',
};

function calculateHaversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

export function isAddonService(t: { name: string; category?: string; serviceType?: string; isAddon?: boolean }): boolean {
  if (t.isAddon === true || t.category === 'ADD_ON' || t.serviceType === 'ADD_ON') {
    return true;
  }
  const name = (t.name || '').toLowerCase();
  return (
    name.includes('moksa') ||
    name.includes('moxa') ||
    name.includes('addon') ||
    name.includes('add-on') ||
    name.includes('tambahan') ||
    name.includes('taping') ||
    name.includes('kinesio') ||
    name.includes('ear candle') ||
    name.includes('nebulizer') ||
    name.includes('potong kuku') ||
    name.includes('tindik')
  );
}

function formatMinutesToTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export const DEFAULT_CLINIC_SERVICES_FALLBACK: ClinicServiceItem[] = [
  { id: 'baby-massage-ceria', name: 'Pijat Bayi Ceria (Rileksasi)', category: 'BABY', durationMinutes: 40, originalPrice: 80000, promoPrice: 60000, description: 'Pijat relaksasi bayi', isActive: true },
  { id: 'baby-massage-pulih-ceria', name: 'Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)', category: 'BABY', durationMinutes: 40, originalPrice: 90000, promoPrice: 70000, description: 'Pijat terapi bapil', isActive: true },
  { id: 'baby-massage-lahap-juara', name: 'Pijat Lahap Juara (Nafsu Makan)', category: 'BABY', durationMinutes: 40, originalPrice: 95000, promoPrice: 75000, description: 'Pijat nafsu makan', isActive: true },
  { id: 'baby-cukur', name: 'Cukur Rambut Bayi', category: 'BABY', durationMinutes: 15, originalPrice: 30000, promoPrice: 25000, description: 'Cukur rambut bayi', isActive: true },
  { id: 'baby-tindik', name: 'Tindik Telinga Bayi', category: 'BABY', durationMinutes: 15, originalPrice: 70000, promoPrice: 50000, description: 'Tindik telinga bayi', isActive: true },
  { id: 'baby-paket-selapan', name: 'Paket Selapan (Cukur + Pijat Ceria)', category: 'BUNDLE', durationMinutes: 55, originalPrice: 85000, promoPrice: 80000, description: 'Paket selapan', isActive: true },
  { id: 'baby-cukur-pijat-terapi', name: 'Cukur + Pijat Terapi', category: 'BUNDLE', durationMinutes: 55, originalPrice: 95000, promoPrice: 85000, description: 'Cukur + Pijat Terapi', isActive: true },
  { id: 'moms-prenatal-massage', name: 'Prenatal Massage (Pijat Hamil)', category: 'MOMS', durationMinutes: 60, originalPrice: 125000, promoPrice: 100000, description: 'Pijat hamil', isActive: true },
  { id: 'moms-prenatal-yoga', name: 'Prenatal Yoga', category: 'MOMS', durationMinutes: 45, originalPrice: 70000, promoPrice: 50000, description: 'Yoga hamil', isActive: true },
  { id: 'moms-laktasi-oksitosin', name: 'Paket Laktasi (Breast + Oksitosin)', category: 'MOMS', durationMinutes: 75, originalPrice: 100000, promoPrice: 80000, description: 'Paket laktasi', isActive: true },
  { id: 'moms-laktasi-breast', name: 'Paket Laktasi (Breast Massage)', category: 'MOMS', durationMinutes: 40, originalPrice: 70000, promoPrice: 50000, description: 'Breast massage', isActive: true },
  { id: 'moms-oksitosin-fullbody', name: 'Oksitosin Massage Fullbody', category: 'MOMS', durationMinutes: 60, originalPrice: 130000, promoPrice: 105000, description: 'Oksitosin fullbody', isActive: true },
  { id: 'moms-oksitosin-non-fullbody', name: 'Oksitosin Massage Non-Fullbody', category: 'MOMS', durationMinutes: 40, originalPrice: 70000, promoPrice: 50000, description: 'Oksitosin non-fullbody', isActive: true },
  { id: 'moms-perineum', name: 'Perineum Massage', category: 'MOMS', durationMinutes: 30, originalPrice: 60000, promoPrice: 45000, description: 'Perineum massage', isActive: true },
  { id: 'moms-laktasi-oksitosin-full', name: 'Breast + Oksitoksin Fullbody Massage', category: 'MOMS', durationMinutes: 75, originalPrice: 200000, promoPrice: 155000, description: 'Breast + Oksitosin Fullbody', isActive: true },
  { id: 'moms-bundle-pra-kelahiran', name: 'Paket Pra Kelahiran Lengkap (Perineum + Yoga + Breast)', category: 'MOMS', durationMinutes: 105, originalPrice: 185000, promoPrice: 135000, description: 'Paket pra kelahiran lengkap', isActive: true },
  { id: 'kids-massage-2-4', name: 'Pijat Kids Ceria (Usia 2-4 th)', category: 'KIDS', durationMinutes: 45, originalPrice: 90000, promoPrice: 70000, description: 'Pijat kids 2-4 tahun', isActive: true },
  { id: 'kids-massage-4-6', name: 'Pijat Kids Ceria (Usia >4-6 th)', category: 'KIDS', durationMinutes: 45, originalPrice: 100000, promoPrice: 80000, description: 'Pijat kids 4-6 tahun', isActive: true },
  { id: 'kids-massage-6-8', name: 'Pijat Kids Ceria (Usia >6-8 th)', category: 'KIDS', durationMinutes: 45, originalPrice: 110000, promoPrice: 90000, description: 'Pijat kids 6-8 tahun', isActive: true },
  { id: 'addon-moksa', name: 'Sinar Moksa (Add-on)', category: 'ADD_ON', durationMinutes: 15, originalPrice: 15000, promoPrice: 10000, isAddon: true, description: 'Sinar moksa', isActive: true },
  { id: 'addon-nebulizer', name: 'Nebulizer (Terapi Uap Add-on)', category: 'ADD_ON', durationMinutes: 20, originalPrice: 50000, promoPrice: 35000, isAddon: true, description: 'Nebulizer add-on', isActive: true },
  { id: 'addon-nebulizer-obat', name: 'Nebulizer + Obat (Terapi Uap Lengkap)', category: 'ADD_ON', durationMinutes: 20, originalPrice: 85000, promoPrice: 65000, isAddon: true, description: 'Nebulizer lengkap', isActive: true },
  { id: 'baby-newborn-treatment', name: 'Newborn Treatment', category: 'BABY', durationMinutes: 120, originalPrice: 700000, promoPrice: 500000, description: 'Newborn treatment', isActive: true },
];

export function parseTreatmentsFromDetail(
  detail: string | null | undefined,
  catalog: ClinicServiceItem[] = [],
  initialPurchaseValue?: number | null
): SelectedTreatmentItem[] {
  if (!detail) return [];
  const effectiveCatalog = catalog && catalog.length > 0 ? catalog : DEFAULT_CLINIC_SERVICES_FALLBACK;
  const cleanSummary = detail
    .replace(/\[\s*Total\s+.*?\]/gi, '')
    .trim();
  
  const parts = cleanSummary.split(/\s*[\+,]\s*/).map((p) => p.trim()).filter(Boolean);
  const items: SelectedTreatmentItem[] = [];

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const durationMatch = p.match(/\[\s*(\d+)\s*m.*?\s*\]/i);
    const durationMinutes = durationMatch ? parseInt(durationMatch[1], 10) : 60;
    
    // Bersihkan tag durasi kurung siku [..] dan nama anak opsional (Anak #1 / Nama), tapi pertahankan nama medis (Rileksasi/Terapi)
    let cleanName = p.replace(/\[.*?\]/g, '').trim();
    cleanName = cleanName.replace(/\(\s*(?:Anak\s*#?\d+|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*\)$/i, '').trim();

    if (!cleanName) continue;

    const normTarget = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Cari di katalog yang diberikan atau default fallback
    let matchedService = effectiveCatalog.find((s) => {
      const normS = s.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      return normS === normTarget || normTarget.includes(normS) || normS.includes(normTarget);
    });

    if (!matchedService) {
      matchedService = DEFAULT_CLINIC_SERVICES_FALLBACK.find((s) => {
        const normS = s.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        return normS === normTarget || normTarget.includes(normS) || normS.includes(normTarget);
      });
    }

    let price = matchedService ? (matchedService.promoPrice || matchedService.originalPrice || 0) : 0;
    
    // Jika hanya 1 treatment dan ada initialPurchaseValue dari DB (> 0), prioritaskan purchase_value asli!
    if (parts.length === 1 && typeof initialPurchaseValue === 'number' && initialPurchaseValue > 0) {
      price = initialPurchaseValue;
    } else if (price === 0 && typeof initialPurchaseValue === 'number' && initialPurchaseValue > 0 && i === 0) {
      price = initialPurchaseValue;
    }

    const category = matchedService ? matchedService.category : 'BABY';
    const isAddon = matchedService ? (matchedService.isAddon || isAddonService(matchedService)) : isAddonService({ name: cleanName });

    items.push({
      instanceId: `edit-treatment-${i + 1}-${Math.random().toString(36).substring(2, 7)}`,
      serviceId: matchedService?.id || `custom-${i + 1}`,
      name: matchedService?.name || cleanName,
      category: (category as any) || 'BABY',
      durationMinutes: durationMinutes || matchedService?.durationMinutes || 60,
      price: price || 0,
      isAddon: isAddon,
      assignedChildIndex: 0,
    });
  }

  return items;
}

export interface SelectedTreatmentItem {
  instanceId: string;
  serviceId: string;
  name: string;
  category: 'BABY' | 'MOMS' | 'BOTH' | 'KIDS' | 'BUNDLE' | 'ADD_ON';
  durationMinutes: number;
  price: number;
  isAddon?: boolean;
  assignedChildIndex?: number; // 0 for Child #1, 1 for Child #2, -1 for Moms/General
}

export interface SlotRecommendation {
  startTime: string;
  departureTime: string;
  arrivalTime: string;
  endTime: string;
  staffId: string;
  staffName: string;
  distanceKm: number;
  travelMinutes: number;
  originDesc: string;
  score: number;
}

interface CreateReservationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newReservation?: any) => void;
  staffList: StaffOption[];
  initialSlotTarget?: QuickSlotTarget | null;
  initialCustomer?: any | null;
  initialCustomerId?: string;
  existingReservations?: Reservation[];
  mode?: 'create' | 'edit';
  initialReservation?: Reservation | any;
}

export const CreateReservationModal: React.FC<CreateReservationModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  staffList,
  initialSlotTarget,
  initialCustomer,
  initialCustomerId,
  existingReservations = [],
  mode = 'create',
  initialReservation,
}) => {
  const { user } = useAuth();
  const { toast } = useUiFeedback();
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomerInfo, setSelectedCustomerInfo] = useState<any | null>(null);
  const [customerResults, setCustomerResults] = useState<any[]>([]);
  const [searchingCustomer, setSearchingCustomer] = useState(false);

  // Service Catalog
  const [services, setServices] = useState<ClinicServiceItem[]>(DEFAULT_CLINIC_SERVICES_FALLBACK);
  const [loadingServices, setLoadingServices] = useState(false);
  const [serviceSearch, setServiceSearch] = useState('');
  const [isServiceDropdownOpen, setIsServiceDropdownOpen] = useState(false);

  // Multi-Treatment Selection (Supports multiple instances of the same treatment for 2 children)
  const [selectedTreatments, setSelectedTreatments] = useState<SelectedTreatmentItem[]>([]);
  const [customServiceName, setCustomServiceName] = useState('');
  const [customServiceDuration, setCustomServiceDuration] = useState<number | ''>(60);
  const [customServicePrice, setCustomServicePrice] = useState<number | ''>(0);
  const [customCategory, setCustomCategory] = useState<'BABY' | 'MOMS' | 'BOTH' | 'KIDS' | 'BUNDLE'>('BABY');
  const [customIsAddon, setCustomIsAddon] = useState(false);
  const [showCustomServiceInput, setShowCustomServiceInput] = useState(false);

  // Category Pills (Filter / Overall)
  const [treatmentCategory, setTreatmentCategory] = useState<'BABY' | 'MOMS' | 'BOTH' | 'KIDS' | 'BUNDLE'>('BABY');

  // Date & Time
  const [bookingDate, setBookingDate] = useState('');
  const [bookingTime, setBookingTime] = useState('09:00');

  // Staff & Status
  const [assignedStaffId, setAssignedStaffId] = useState('');
  const [status, setStatus] = useState<'pending' | 'confirmed'>('pending');
  const [notes, setNotes] = useState('');

  // Payment Breakdown & Discounts
  const [ongkir, setOngkir] = useState<number | ''>(0);
  const [discount, setDiscount] = useState<number | ''>(0);

  // Multi-Session Package State
  const [isMultiSession, setIsMultiSession] = useState(false);
  const [multiSessionTotal, setMultiSessionTotal] = useState(0);
  const [multiSessionSchedule, setMultiSessionSchedule] = useState<Array<{
    sessionNumber: number;
    date: string;
    time: string;
    staffId: string;
  }>>([]);

  // Delivery Tiers State (SaaS-Ready from DB)
  const [deliveryTiers, setDeliveryTiers] = useState<DeliveryTierItem[]>([]);

  useEffect(() => {
    apiRequest('/api/admin/delivery-tiers')
      .then((res) => {
        const list = Array.isArray(res) ? res : res?.data || [];
        if (Array.isArray(list) && list.length > 0) {
          setDeliveryTiers(list);
        }
      })
      .catch(() => {});
  }, []);

  // Live Reservations Synchronizer
  const [loadedReservations, setLoadedReservations] = useState<Reservation[]>([]);
  const [loadingReservations, setLoadingReservations] = useState(false);

  // Children / Babies (Multi-Anak Support)
  const [babies, setBabies] = useState<Array<{ name: string; ageText: string }>>([]);

  // Modals & Recommendations UI
  const [showBookedSlotsModal, setShowBookedSlotsModal] = useState(false);
  const [recommendations, setRecommendations] = useState<SlotRecommendation[]>([]);
  const [hasCalculatedRecommendations, setHasCalculatedRecommendations] = useState(false);
  const initializedEditIdRef = useRef<string | null>(null);

  // Form Draft Persistence Hook (1-hour TTL)
  const currentFormPayload = useMemo(() => ({
    customerId,
    customerSearch,
    selectedCustomerInfo,
    treatmentCategory,
    bookingDate,
    bookingTime,
    assignedStaffId,
    status,
    notes,
    ongkir,
    discount,
    babies,
    selectedTreatments,
  }), [
    customerId,
    customerSearch,
    selectedCustomerInfo,
    treatmentCategory,
    bookingDate,
    bookingTime,
    assignedStaffId,
    status,
    notes,
    ongkir,
    discount,
    babies,
    selectedTreatments,
  ]);

  const handleRestoreDraft = (restored: any) => {
    if (!restored) return;
    if (restored.customerId !== undefined) setCustomerId(restored.customerId);
    if (restored.customerSearch !== undefined) setCustomerSearch(restored.customerSearch);
    if (restored.selectedCustomerInfo !== undefined) setSelectedCustomerInfo(restored.selectedCustomerInfo);
    if (restored.treatmentCategory !== undefined) setTreatmentCategory(restored.treatmentCategory);
    if (restored.bookingDate !== undefined) setBookingDate(restored.bookingDate);
    if (restored.bookingTime !== undefined) setBookingTime(restored.bookingTime);
    if (restored.assignedStaffId !== undefined) setAssignedStaffId(restored.assignedStaffId);
    if (restored.status !== undefined) setStatus(restored.status);
    if (restored.notes !== undefined) setNotes(restored.notes);
    if (restored.ongkir !== undefined) setOngkir(restored.ongkir);
    if (restored.discount !== undefined) setDiscount(restored.discount);
    if (restored.babies !== undefined) setBabies(restored.babies);
    if (restored.selectedTreatments !== undefined) setSelectedTreatments(restored.selectedTreatments);
  };

  const isReservationDraftMeaningful = useCallback((data: typeof currentFormPayload) => {
    if (!data) return false;
    const hasCustomer = Boolean(
      (data.customerId && data.customerId.trim().length > 0) ||
      (data.customerSearch && data.customerSearch.trim().length > 0) ||
      data.selectedCustomerInfo
    );
    const hasTreatments = Array.isArray(data.selectedTreatments) && data.selectedTreatments.length > 0;
    const hasBabies = Array.isArray(data.babies) && data.babies.some((b: any) => b?.name?.trim() || b?.ageText?.trim());
    const hasNotes = Boolean(data.notes && data.notes.trim().length > 0);
    const hasDiscount = typeof data.discount === 'number' && data.discount > 0;
    const hasAssignedStaff = Boolean(data.assignedStaffId && data.assignedStaffId.trim().length > 0);

    return hasCustomer || hasTreatments || hasBabies || hasNotes || hasDiscount || hasAssignedStaff;
  }, []);

  const { hasDraft, draftTimeAgo, saveDraftManually, restoreDraft, discardDraft } = useFormDraft(
    'create_reservation',
    currentFormPayload,
    handleRestoreDraft,
    {
      enabled: isOpen && mode !== 'edit',
      isMeaningful: isReservationDraftMeaningful,
    }
  );

  // Load clinic services catalog with auto-repair
  useEffect(() => {
    async function loadCatalog() {
      try {
        setLoadingServices(true);
        const res = await apiRequest('/api/admin/services');
        const list = Array.isArray(res) ? res : res?.data || [];
        const activeList = list.filter((s: ClinicServiceItem) => s.isActive !== false);
        const finalList = activeList.length > 0 ? activeList : DEFAULT_CLINIC_SERVICES_FALLBACK;
        setServices(finalList);

        // Auto-repair any selected treatments that currently have price === 0
        setSelectedTreatments((prev) => {
          if (!prev || prev.length === 0) return prev;
          let changed = false;
          const next = prev.map((t) => {
            if (!t.price || t.price === 0) {
              const normTarget = t.name.toLowerCase().replace(/[^a-z0-9]/g, '');
              const matched = finalList.find((s: ClinicServiceItem) => {
                const normS = s.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                return normS === normTarget || normTarget.includes(normS) || normS.includes(normTarget);
              });
              if (matched) {
                changed = true;
                return {
                  ...t,
                  price: matched.promoPrice || matched.originalPrice || 0,
                  serviceId: t.serviceId.startsWith('custom-') ? matched.id : t.serviceId,
                };
              }
            }
            return t;
          });
          return changed ? next : prev;
        });
      } catch {
        setServices(DEFAULT_CLINIC_SERVICES_FALLBACK);
      } finally {
        setLoadingServices(false);
      }
    }
    if (isOpen) {
      loadCatalog();
    }
  }, [isOpen]);

  // Synchronize active reservations from database on open
  useEffect(() => {
    if (isOpen) {
      if (Array.isArray(existingReservations) && existingReservations.length > 0) {
        setLoadedReservations(existingReservations);
      } else {
        setLoadingReservations(true);
        apiRequest('/api/admin/reservations?pageSize=300')
          .then((res) => {
            const list = Array.isArray(res) ? res : res?.reservations || res?.data || [];
            setLoadedReservations(list);
          })
          .catch((err) => {
            console.error('Gagal memuat jadwal reservasi untuk modal:', err);
          })
          .finally(() => {
            setLoadingReservations(false);
          });
      }
    }
  }, [isOpen, existingReservations]);

  // Sync initial target slot if opened via calendar slot click
  useEffect(() => {
    if (isOpen && initialSlotTarget) {
      const d = new Date(initialSlotTarget.date);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      setBookingDate(`${yyyy}-${mm}-${dd}`);

      const hh = String(initialSlotTarget.hour || 9).padStart(2, '0');
      setBookingTime(`${hh}:00`);
    } else if (isOpen && !bookingDate) {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      setBookingDate(`${yyyy}-${mm}-${dd}`);
      setBookingTime('09:00');
    }
  }, [isOpen, initialSlotTarget]);

  // Auto-populate customer if initialCustomer is provided
  useEffect(() => {
    if (isOpen && initialCustomer) {
      handleSelectCustomer(initialCustomer);
    } else if (isOpen && initialCustomerId && !customerId && mode !== 'edit') {
      apiRequest(`/api/admin/customers/${initialCustomerId}`)
        .then((res) => {
          const c = res?.customer || res?.data || res;
          if (c?.id) handleSelectCustomer(c);
        })
        .catch(() => {});
    }
  }, [isOpen, initialCustomer, initialCustomerId, mode]);

  // Pre-fill state when opened in edit mode
  useEffect(() => {
    if (isOpen && mode === 'edit' && initialReservation) {
      if (initializedEditIdRef.current === initialReservation.id) {
        return;
      }
      initializedEditIdRef.current = initialReservation.id;

      const res = initialReservation;
      const cust = res.customer;
      if (cust) {
        setCustomerId(cust.id || res.customer_id || '');
        setSelectedCustomerInfo(cust);
        setCustomerSearch(`${cust.name || 'Bunda'} (${cust.phone || ''})`);
        if (cust.ongkir !== undefined && cust.ongkir !== null && !isNaN(Number(cust.ongkir))) {
          setOngkir(Number(cust.ongkir));
        }
      } else if (res.customer_id) {
        setCustomerId(res.customer_id);
      }

      if (res.treatment_category) {
        const cat = res.treatment_category as any;
        setTreatmentCategory(cat === 'KIDS' ? 'BABY' : (cat === 'BUNDLE' ? 'BOTH' : cat));
      }

      if (res.booking_date) {
        try {
          const d = new Date(res.booking_date);
          if (!isNaN(d.getTime())) {
            const yr = d.getFullYear();
            const mo = String(d.getMonth() + 1).padStart(2, '0');
            const dy = String(d.getDate()).padStart(2, '0');
            setBookingDate(`${yr}-${mo}-${dy}`);
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            setBookingTime(`${hh}:${mm}`);
          }
        } catch {}
      }

      if (res.assigned_staff_id || res.assigned_staff?.id) {
        setAssignedStaffId(res.assigned_staff_id || res.assigned_staff?.id || '');
      }

      setStatus(res.status === 'confirmed' ? 'confirmed' : 'pending');
      const extractedNotes = res.notes || (() => {
        if (!res.raw_text) return '';
        const match = res.raw_text.match(/(?:^|\n)Catatan:\s*([\s\S]*)$/i);
        return match ? match[1].trim() : '';
      })();
      setNotes(extractedNotes);

      // Children / babies pre-fill — fallback ke baby_details untuk reservasi lama
      const rawBabies = cust?.children || res.children || (res as any).baby_details || [];
      if (Array.isArray(rawBabies) && rawBabies.length > 0) {
        setBabies(
          rawBabies.map((b: any) => ({
            name: b.name || '',
            ageText: b.ageText || b.age || b.raw_age_text || b.current_age || '',
          }))
        );
      }

      // Treatments pre-fill
      if (res.treatment_detail) {
        try {
          const parsed = parseTreatmentsFromDetail(res.treatment_detail, services, res.purchase_value);
          if (parsed.length > 0) {
            setSelectedTreatments(parsed);
          }
        } catch {}
      }
    } else if (!isOpen) {
      initializedEditIdRef.current = null;
    }
  }, [isOpen, mode, initialReservation, services]);

  // Customer search
  const handleCustomerSearch = async (query: string) => {
    setCustomerSearch(query);
    if (!query || query.length < 2) {
      setCustomerResults([]);
      return;
    }
    setSearchingCustomer(true);
    try {
      const params = new URLSearchParams({ search: query, pageSize: '8' });
      const res = await apiRequest(`/api/admin/customers?${params.toString()}`);
      setCustomerResults(res?.customers || res?.data || []);
    } catch {
      setCustomerResults([]);
    } finally {
      setSearchingCustomer(false);
    }
  };

  const handleSelectCustomer = (c: any) => {
    setCustomerId(c.id);
    setSelectedCustomerInfo(c);
    setCustomerSearch(`${c.name || 'Bunda'} (${c.phone})`);
    setCustomerResults([]);

    if (c.children && c.children.length > 0) {
      setBabies(
        c.children.map((child: any) => ({
          name: child.name,
          ageText: child.current_age || child.raw_age_text || '',
        }))
      );
    }

    // Auto calculate & fill ongkir from customer profile / distance via DB delivery tiers
    if (c.ongkir !== undefined && c.ongkir !== null && !isNaN(Number(c.ongkir))) {
      setOngkir(Number(c.ongkir));
    } else if (c.distance_km || c.distanceKm) {
      const dist = Number(c.distance_km || c.distanceKm);
      const calc = calculateOngkirFromTiers(dist, deliveryTiers);
      setOngkir(calc.netOngkir);
    }
  };

  // Filter services by search term
  const filteredServices = useMemo(() => {
    if (!serviceSearch.trim()) return services;
    const q = serviceSearch.toLowerCase();
    return services.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        (s.description && s.description.toLowerCase().includes(q))
    );
  }, [services, serviceSearch]);

  // Multi-treatment handler: Supports adding multiple instances (for 2 children)
  const handleAddServiceInstance = (srv: ClinicServiceItem, targetChildIndex?: number) => {
    const isAddon = isAddonService(srv);

    // Business Rule Check: Add-on cannot stand alone.
    // If trying to add an Add-on and there are no main (non-addon) treatments selected yet:
    const hasMainService = selectedTreatments.some((t) => !isAddonService(t));
    if (isAddon && !hasMainService) {
      toast(`Layanan "${srv.name}" adalah Add-on dan tidak bisa berdiri sendiri. Silakan pilih minimal 1 layanan utama terlebih dahulu.`, 'error');
      return;
    }

    const existingForService = selectedTreatments.filter((t) => t.serviceId === srv.id);
    const nextChildIndex = targetChildIndex !== undefined 
      ? targetChildIndex 
      : Math.min(existingForService.length, Math.max(0, babies.length - 1));

    const newItem: SelectedTreatmentItem = {
      instanceId: `inst-${srv.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      serviceId: srv.id,
      name: srv.name,
      category: srv.category,
      durationMinutes: srv.durationMinutes || (isAddon ? 15 : 60),
      price: srv.promoPrice || srv.originalPrice || 0,
      isAddon,
      assignedChildIndex: nextChildIndex,
    };
    setSelectedTreatments((prev) => [...prev, newItem]);
    if (!isAddon && srv.category !== 'ADD_ON') {
      setTreatmentCategory(srv.category as any);
    }

    // Detect multi-session treatment and generate schedule
    if (srv.totalSessions && srv.totalSessions > 1) {
      setIsMultiSession(true);
      setMultiSessionTotal(srv.totalSessions);
      // Generate default schedule: starting from tomorrow, daily 09:00 + 15:00
      const schedule = [];
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      for (let i = 0; i < srv.totalSessions; i++) {
        const dayOffset = Math.floor(i / 2);
        const date = new Date(tomorrow);
        date.setDate(date.getDate() + dayOffset);
        const dateStr = date.toISOString().split('T')[0];
        const time = i % 2 === 0 ? '09:00' : '15:00';
        schedule.push({ sessionNumber: i + 1, date: dateStr, time, staffId: assignedStaffId || '' });
      }
      setMultiSessionSchedule(schedule);
    }
  };

  const handleRemoveLastServiceInstance = (serviceId: string) => {
    setSelectedTreatments((prev) => {
      const idx = prev.map((t) => t.serviceId).lastIndexOf(serviceId);
      if (idx === -1) return prev;
      const next = prev.filter((_, i) => i !== idx);
      const remainingMain = next.filter((t) => !isAddonService(t));
      const remainingAddons = next.filter((t) => isAddonService(t));
      if (remainingMain.length === 0 && remainingAddons.length > 0) {
        toast('Perhatian: Reservasi yang tersisa hanya berisi layanan add-on. Harap tambahkan layanan utama.', 'info');
      }
      return next;
    });
  };

  const handleDuplicateTreatment = (item: SelectedTreatmentItem) => {
    const nextChildIndex = (item.assignedChildIndex !== undefined && item.assignedChildIndex < babies.length - 1)
      ? item.assignedChildIndex + 1
      : item.assignedChildIndex ?? 0;

    const newItem: SelectedTreatmentItem = {
      ...item,
      instanceId: `inst-${item.serviceId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      assignedChildIndex: nextChildIndex,
    };
    setSelectedTreatments((prev) => [...prev, newItem]);
    toast(`Treatment "${item.name}" berhasil ditambahkan untuk anak berikutnya!`, 'success');
  };

  const handleUpdateTreatmentChild = (instanceId: string, childIdx: number) => {
    setSelectedTreatments((prev) =>
      prev.map((t) => (t.instanceId === instanceId ? { ...t, assignedChildIndex: childIdx } : t))
    );
  };

  const handleAddCustomTreatment = () => {
    if (!customServiceName.trim()) {
      toast('Nama treatment kustom wajib diisi', 'error');
      return;
    }
    const isAddon = customIsAddon;
    const hasMainService = selectedTreatments.some((t) => !isAddonService(t));
    if (isAddon && !hasMainService) {
      toast(`Layanan kustom "${customServiceName}" adalah Add-on dan tidak bisa berdiri sendiri. Silakan pilih minimal 1 layanan utama terlebih dahulu.`, 'error');
      return;
    }

    const newItem: SelectedTreatmentItem = {
      instanceId: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      serviceId: `custom-${Date.now()}`,
      name: customServiceName.trim(),
      category: customCategory,
      durationMinutes: Math.max(10, Number(customServiceDuration) || 60),
      price: Number(customServicePrice) || 0,
      isAddon,
      assignedChildIndex: 0,
    };
    setSelectedTreatments((prev) => [...prev, newItem]);
    setCustomServiceName('');
    setCustomServicePrice(0);
    setCustomIsAddon(false);
    setShowCustomServiceInput(false);
  };

  const handleRemoveTreatment = (instanceId: string) => {
    setSelectedTreatments((prev) => {
      const next = prev.filter((t) => t.instanceId !== instanceId);
      const remainingMain = next.filter((t) => !isAddonService(t));
      const remainingAddons = next.filter((t) => isAddonService(t));
      if (remainingMain.length === 0 && remainingAddons.length > 0) {
        toast('Perhatian: Reservasi yang tersisa hanya berisi layanan add-on. Harap tambahkan layanan utama.', 'info');
      }
      return next;
    });
  };

  const handleUpdateTreatmentPrice = (instanceId: string, newPrice: number) => {
    setSelectedTreatments((prev) =>
      prev.map((t) => (t.instanceId === instanceId ? { ...t, price: Math.max(0, isNaN(newPrice) ? 0 : newPrice) } : t))
    );
  };

  // Duration & Buffer Calculation: +20 min per MAIN treatment (Addon like moksa = 0 buffer)
  const pureDurationMinutes = useMemo(() => {
    if (selectedTreatments.length === 0) return 60;
    return selectedTreatments.reduce((sum, t) => sum + (t.durationMinutes || 0), 0);
  }, [selectedTreatments]);

  const subtotalTreatments = useMemo(() => {
    return selectedTreatments.reduce((sum, t) => sum + (Number(t.price) || 0), 0);
  }, [selectedTreatments]);

  const totalPaymentAmount = useMemo(() => {
    const sub = Number(subtotalTreatments) || 0;
    const ong = Number(ongkir) || 0;
    const disc = Number(discount) || 0;
    return Math.max(0, sub + ong - disc);
  }, [subtotalTreatments, ongkir, discount]);

  const mainTreatmentsCount = useMemo(() => {
    return selectedTreatments.filter((t) => !isAddonService(t)).length;
  }, [selectedTreatments]);

  const addonTreatmentsCount = useMemo(() => {
    return selectedTreatments.filter((t) => isAddonService(t)).length;
  }, [selectedTreatments]);

  const totalBufferMinutes = useMemo(() => {
    if (selectedTreatments.length === 0) return 20;
    if (mainTreatmentsCount === 0) return 10;
    return mainTreatmentsCount * 20; // 20 menit per MAIN treatment (moksa/addon = 0 buffer)
  }, [selectedTreatments, mainTreatmentsCount]);

  const totalScheduledDurationMinutes = useMemo(() => {
    return pureDurationMinutes + totalBufferMinutes;
  }, [pureDurationMinutes, totalBufferMinutes]);

  // End time calculation
  const calculateEndTime = () => {
    if (!bookingTime) return '';
    const [h, m] = bookingTime.split(':').map(Number);
    const totalMinutes = h * 60 + m + totalScheduledDurationMinutes;
    return formatMinutesToTime(totalMinutes);
  };

  // Babies Handlers
  const handleAddBaby = () => {
    setBabies((prev) => [...prev, { name: '', ageText: '' }]);
  };

  const handleUpdateBaby = (idx: number, field: 'name' | 'ageText', val: string) => {
    setBabies((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      return next;
    });
  };

  const handleRemoveBaby = (idx: number) => {
    setBabies((prev) => prev.filter((_, i) => i !== idx));
  };

  // Filter existing reservations for selected date (accurately matching date across timezones and string formats)
  const bookedReservationsForDate = useMemo(() => {
    if (!bookingDate) return [];
    const targetDateStr = bookingDate.trim(); // "YYYY-MM-DD"
    const sourceList = loadedReservations.length > 0 ? loadedReservations : existingReservations;

    return sourceList.filter((r) => {
      if (!r.booking_date || (r.status as string) === 'cancelled' || (r.status as string) === 'rejected') return false;
      
      if (typeof r.booking_date === 'string' && r.booking_date.startsWith(targetDateStr)) {
        return true;
      }

      const rDate = new Date(r.booking_date);
      if (isNaN(rDate.getTime())) return false;

      const yyyy = rDate.getFullYear();
      const mm = String(rDate.getMonth() + 1).padStart(2, '0');
      const dd = String(rDate.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}` === targetDateStr;
    });
  }, [loadedReservations, existingReservations, bookingDate]);

  // Smart Slot Recommendation Generator with Accurate Midwife Arrival & Departure
  const handleGenerateRecommendations = () => {
    if (!bookingDate) {
      toast('Pilih tanggal kunjungan terlebih dahulu', 'error');
      return;
    }

    // Filter staff: If specific staff chosen in dropdown, recommend for that staff.
    // Otherwise, strictly filter for active field therapists (role === 'THERAPIST').
    let targetStaffList = staffList.filter((s) => {
      if (s.active === false) return false;
      if (assignedStaffId) return s.id === assignedStaffId;
      return s.role === 'THERAPIST' || (s.role || '').toLowerCase().includes('therapist');
    });

    if (targetStaffList.length === 0) {
      targetStaffList = staffList.filter((s) => s.active !== false);
    }

    if (targetStaffList.length === 0) {
      toast('Tidak ada staf/terapis aktif yang terdaftar', 'error');
      return;
    }

    // Customer Location
    const custLat = selectedCustomerInfo?.lat || CLINIC_COORDS.lat;
    const custLng = selectedCustomerInfo?.lng || CLINIC_COORDS.lng;

    // Standard Candidate Slots: 08:30 to 16:30
    const CANDIDATE_SLOTS = [
      '08:30', '09:00', '09:30', '10:00', '10:30',
      '11:00', '11:30', '13:00', '13:30', '14:00',
      '14:30', '15:00', '15:30', '16:00', '16:30',
    ];

    // Cek apakah tanggal reservasi adalah HARI INI (Case 1: Hindari rekomendasi jam lampau)
    const now = new Date();
    const todayYyyy = now.getFullYear();
    const todayMm = String(now.getMonth() + 1).padStart(2, '0');
    const todayDd = String(now.getDate()).padStart(2, '0');
    const todayStr = `${todayYyyy}-${todayMm}-${todayDd}`;
    const isToday = bookingDate === todayStr;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const results: SlotRecommendation[] = [];

    for (const staff of targetStaffList) {
      // Find staff's bookings on this date sorted by time
      const staffBookings = bookedReservationsForDate
        .filter((r) => r.assigned_staff_id === staff.id)
        .sort((a, b) => new Date(a.booking_date!).getTime() - new Date(b.booking_date!).getTime());

      for (const slotTime of CANDIDATE_SLOTS) {
        const [slotH, slotM] = slotTime.split(':').map(Number);
        const slotStartMinutes = slotH * 60 + slotM;
        const slotEndMinutes = slotStartMinutes + totalScheduledDurationMinutes;

        // Case 1 Guard: Jika hari ini, jangan rekomendasikan jam yang sudah lewat / kurang dari 15 menit dari sekarang
        if (isToday && slotStartMinutes <= nowMinutes + 15) {
          continue;
        }

        // Check if overlaps with any existing booking
        let hasConflict = false;
        let prevBooking: Reservation | null = null;
        let nextBooking: Reservation | null = null;

        for (const b of staffBookings) {
          const bDate = new Date(b.booking_date!);
          const bStartMinutes = bDate.getHours() * 60 + bDate.getMinutes();
          const bDuration = (b as any).duration_minutes || 60;
          const bBuffer = 20; // standard buffer
          const bEndMinutes = bStartMinutes + bDuration + bBuffer;

          // Direct slot overlap
          if (slotStartMinutes < bEndMinutes && slotEndMinutes > bStartMinutes) {
            hasConflict = true;
            break;
          }

          if (bEndMinutes <= slotStartMinutes) {
            prevBooking = b;
          }
          if (bStartMinutes >= slotEndMinutes && !nextBooking) {
            nextBooking = b;
          }
        }

        if (hasConflict) continue;

        // Calculate travel distance from origin (Clinic or Prev Patient)
        let originLat = CLINIC_COORDS.lat;
        let originLng = CLINIC_COORDS.lng;
        let originDesc = CLINIC_COORDS.name;

        if (prevBooking) {
          const prevCust = prevBooking.customer as any;
          if (prevCust?.lat && prevCust?.lng) {
            originLat = prevCust.lat;
            originLng = prevCust.lng;
            originDesc = `Pasien Ny. ${prevCust.name || 'Sebelumnya'} (${prevCust.kelurahan || 'Sidoarjo'})`;
          } else {
            originDesc = `Pasien Ny. ${prevCust?.name || 'Sebelumnya'}`;
          }
        }

        const distanceKm = calculateHaversine(originLat, originLng, custLat, custLng);
        const travelMinutes = Math.max(5, Math.round(distanceKm * 2.05 + 3));
        const prepMinutes = 10; // Waktu bidan tiba lebih awal untuk cuci tangan & persiapan di rumah pasien

        // Calculate Arrival & Departure Timeline
        const plannedDepartureMinutes = slotStartMinutes - travelMinutes - prepMinutes;
        const plannedArrivalMinutes = slotStartMinutes - prepMinutes;

        // If midwife has prior booking, departure cannot be earlier than previous booking end
        if (prevBooking) {
          const bDate = new Date(prevBooking.booking_date!);
          const prevEndMinutes = bDate.getHours() * 60 + bDate.getMinutes() + ((prevBooking as any).duration_minutes || 60) + 20;
          if (plannedDepartureMinutes < prevEndMinutes) {
            continue; // Midwife hasn't finished prior patient yet!
          }
        } else {
          // First booking of the day: departure from clinic cannot be earlier than clinic start (08:00 = 480 mins)
          if (plannedDepartureMinutes < 480) {
            continue;
          }
        }

        // Jika reservasi hari ini, waktu keberangkatan bidan tidak boleh sudah lewat dari jam sekarang
        if (isToday && plannedDepartureMinutes <= nowMinutes) {
          continue;
        }

        // If midwife has next booking, verify she can travel to next booking on time
        if (nextBooking) {
          const nbDate = new Date(nextBooking.booking_date!);
          const nextStartMinutes = nbDate.getHours() * 60 + nbDate.getMinutes();
          const nextCust = nextBooking.customer as any;
          const nextLat = nextCust?.lat || CLINIC_COORDS.lat;
          const nextLng = nextCust?.lng || CLINIC_COORDS.lng;
          const toNextDistanceKm = calculateHaversine(custLat, custLng, nextLat, nextLng);
          const toNextTravelMinutes = Math.max(5, Math.round(toNextDistanceKm * 2.05 + 3));

          if (slotEndMinutes + toNextTravelMinutes + 10 > nextStartMinutes) {
            continue; // Cannot arrive at next booking in time!
          }
        }

        // Score: closer distance gets higher priority
        const score = Math.max(1, 100 - distanceKm * 5);

        results.push({
          startTime: slotTime,
          departureTime: formatMinutesToTime(plannedDepartureMinutes),
          arrivalTime: formatMinutesToTime(plannedArrivalMinutes),
          endTime: formatMinutesToTime(slotEndMinutes),
          staffId: staff.id,
          staffName: staff.name,
          distanceKm,
          travelMinutes,
          originDesc,
          score,
        });
      }
    }

    // Sort by earliest time and best distance score
    results.sort((a, b) => {
      if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
      return a.distanceKm - b.distanceKm;
    });

    // Pick up to 6 distinct recommendations across available therapists
    const topRecs: SlotRecommendation[] = [];
    const seenStaffSlots = new Set<string>();
    for (const r of results) {
      const key = `${r.startTime}-${r.staffId}`;
      if (!seenStaffSlots.has(key) && topRecs.length < 6) {
        seenStaffSlots.add(key);
        topRecs.push(r);
      }
    }

    setRecommendations(topRecs);
    setHasCalculatedRecommendations(true);

    if (topRecs.length === 0) {
      toast('Semua slot terapis penuh pada tanggal ini. Coba pilih tanggal lain.', 'error');
    } else {
      toast(`${topRecs.length} rekomendasi jam kunjungan berhasil dihitung untuk ${targetStaffList.map(s => s.name).join(', ')}!`, 'success');
    }
  };

  const handleApplyRecommendation = (rec: SlotRecommendation) => {
    setBookingTime(rec.startTime);
    setAssignedStaffId(rec.staffId);
    toast(`Jam diatur ke ${rec.startTime} WIB dengan terapis ${rec.staffName}. Estimasi tiba: ${rec.arrivalTime} WIB.`, 'success');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId) {
      toast('Pilih customer terlebih dahulu', 'error');
      return;
    }
    if (selectedTreatments.length === 0) {
      toast('Pilih minimal 1 layanan treatment', 'error');
      return;
    }

    let fullBookingIso: string | undefined = undefined;
    if (bookingDate && bookingTime) {
      fullBookingIso = new Date(`${bookingDate}T${bookingTime}:00`).toISOString();
    }

    // Serialize clean treatment string — hanya nama layanan + label total waktu (tanpa nama bayi/usia)
    const treatmentSummary = selectedTreatments.map((t) => t.name).join(' + ');
    const finalTreatmentDetail = `${treatmentSummary} [Total ${totalScheduledDurationMinutes}m]`;

    // Overall category: if both mom & baby exist
    const hasBaby = selectedTreatments.some((t) => t.category === 'BABY' || t.category === 'KIDS');
    const hasMoms = selectedTreatments.some((t) => t.category === 'MOMS');
    const computedCategory = hasBaby && hasMoms ? 'BOTH' : selectedTreatments[0]?.category || treatmentCategory;

    setSubmitting(true);
    try {
      if (mode === 'edit' && initialReservation?.id) {
        const res = await apiRequest(`/api/admin/reservation/${initialReservation.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            customerId,
            treatmentCategory: computedCategory,
            treatmentDetail: finalTreatmentDetail,
            bookingDate: fullBookingIso || null,
            durationMinutes: totalScheduledDurationMinutes,
            assignedStaffId: assignedStaffId ? assignedStaffId : null,
            status,
            notes: notes.trim() ? notes.trim() : null,
            babies: babies.filter((b) => b.name.trim().length > 0),
            purchaseValue: totalPaymentAmount,
          }),
        });

        toast('Perubahan reservasi berhasil disimpan!', 'success');
        discardDraft(true);
        onSuccess(res?.reservation || res?.data || res || initialReservation);
        onClose();
      } else if (isMultiSession && multiSessionSchedule.length > 0) {
        // Multi-Session Series Creation
        const primaryTreatment = selectedTreatments.find((t) => !isAddonService(t));
        const res = await apiRequest('/api/admin/reservation-series', {
          method: 'POST',
          body: JSON.stringify({
            customerId,
            treatmentName: primaryTreatment?.name || treatmentSummary,
            treatmentCategory: computedCategory,
            totalSessions: multiSessionTotal,
            purchaseValue: totalPaymentAmount,
            assignedStaffId: assignedStaffId || undefined,
            notes: notes.trim() || undefined,
            sessions: multiSessionSchedule.map((s) => ({
              sessionNumber: s.sessionNumber,
              bookingDate: new Date(`${s.date}T${s.time}:00`).toISOString(),
              assignedStaffId: s.staffId || assignedStaffId || undefined,
            })),
          }),
        });

        toast(`Paket ${multiSessionTotal} sesi berhasil dibuat!`, 'success');
        discardDraft(true);
        onSuccess(res?.data || res);
        onClose();
      } else {
        const res = await apiRequest('/api/admin/reservation', {
          method: 'POST',
          body: JSON.stringify({
            customerId,
            treatmentCategory: computedCategory,
            treatmentDetail: finalTreatmentDetail,
            bookingDate: fullBookingIso,
            durationMinutes: totalScheduledDurationMinutes,
            assignedStaffId: assignedStaffId || undefined,
            status,
            notes: notes.trim() || undefined,
            babies: babies.filter((b) => b.name.trim().length > 0),
            purchaseValue: totalPaymentAmount,
          }),
        });

        toast('Jadwal reservasi multi-treatment berhasil dibuat!', 'success');
        discardDraft(true);
        onSuccess(res?.reservation || res?.data || res);
        onClose();
      }
    } catch (err: any) {
      toast(`Gagal ${mode === 'edit' ? 'memperbarui' : 'membuat'} jadwal: ${err.message || 'Terjadi kesalahan'}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Keyboard Escape, app-swipe-back & popstate listener for mobile back gestures
  useEffect(() => {
    if (!isOpen) return;

    try {
      window.history.pushState({ modal: 'create-reservation' }, '');
    } catch (_) {}

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showBookedSlotsModal) {
          setShowBookedSlotsModal(false);
        } else {
          onClose();
        }
      }
    };

    const handleSwipeBack = (e: Event) => {
      e.preventDefault();
      if (showBookedSlotsModal) {
        setShowBookedSlotsModal(false);
      } else {
        onClose();
      }
    };

    const handlePopState = () => {
      if (showBookedSlotsModal) {
        setShowBookedSlotsModal(false);
      } else {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('app-swipe-back', handleSwipeBack);
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('app-swipe-back', handleSwipeBack);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isOpen, showBookedSlotsModal, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      data-modal-active="true"
      className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[99999] flex items-center justify-center p-2.5 sm:p-4 overflow-y-auto overflow-x-hidden touch-pan-y overscroll-contain animate-fadeIn h-[100dvh] w-[100dvw]"
      onClick={onClose}
      style={{ touchAction: 'pan-y' }}
    >
      <div
        className="w-full max-w-2xl bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#2a3942] dark:text-[#e9edef] rounded-3xl p-4 sm:p-6 shadow-2xl relative my-auto max-h-[92vh] flex flex-col mx-auto overflow-x-hidden touch-pan-y overscroll-contain animate-modalScaleUp"
        onClick={(e) => e.stopPropagation()}
        style={{ touchAction: 'pan-y' }}
      >
        {/* Close button */}
        <button
          data-modal-close="true"
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-full text-[#8696a0] hover:text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] transition-colors cursor-pointer"
        >
          <X size={18} />
        </button>

        {/* Modal Header */}
        <div className="mb-4 pr-6">
          <h3 className="text-base sm:text-lg font-bold text-[#111b21] dark:text-[#e9edef] flex items-center space-x-2">
            <CalendarIcon size={18} className="text-[#008069] flex-shrink-0" />
            <span>{mode === 'edit' ? '✏️ Edit Data Reservasi' : isMultiSession ? `📅 Buat Paket ${multiSessionTotal} Sesi` : 'Buat Jadwal Reservasi Baru'}</span>
          </h3>
          <p className="text-xs text-[#667781] dark:text-[#8696a0] mt-0.5">
            {mode === 'edit'
              ? 'Perbarui rincian layanan, pasien anak, tanggal, jam, terapis, dan tarif reservasi'
              : 'Mendukung multi-treatment, reservasi 2 anak (kembar/kakak-adik), add-on tanpa buffer (moksa), dan rekomendasi jam'}
          </p>
        </div>

        {/* Draft Restore Notification Banner */}
        {hasDraft && (
          <div className="mb-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 rounded-xl flex items-center justify-between text-xs text-amber-900 dark:text-amber-200 animate-in fade-in shrink-0">
            <div className="flex items-center space-x-2">
              <FileText size={15} className="text-amber-600 shrink-0" />
              <span>
                Ditemukan draf reservasi yang tersimpan <strong>{draftTimeAgo}</strong>.
              </span>
            </div>
            <div className="flex items-center space-x-2 shrink-0">
              <button
                type="button"
                onClick={restoreDraft}
                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg shadow-xs transition cursor-pointer"
              >
                Pulihkan
              </button>
              <button
                type="button"
                onClick={() => discardDraft(false)}
                className="px-2 py-1 text-amber-800 hover:text-rose-600 text-xs font-semibold cursor-pointer"
              >
                Buang
              </button>
            </div>
          </div>
        )}

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto overflow-x-hidden pr-1 flex-1 w-full max-w-full touch-pan-y overscroll-contain">
          {/* Section 1: Customer Picker */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider block">
              Customer / Pasien *
            </label>
            <div className="relative">
              <input
                type="text"
                value={customerSearch}
                onChange={(e) => handleCustomerSearch(e.target.value)}
                placeholder="Cari nama atau nomor WhatsApp customer..."
                enterKeyHint="search"
                inputMode="search"
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
                className="w-full pl-9 pr-4 py-2.5 bg-white border border-[#d1d7db] dark:border-[#374248] rounded-xl text-xs text-[#111b21] dark:text-[#e9edef] focus:outline-none focus:border-[#008069] shadow-xs font-medium"
              />
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-[#8696a0] pointer-events-none">
                <Search size={14} />
              </span>
              {customerId && (
                <button
                  type="button"
                  onClick={() => {
                    setCustomerId('');
                    setCustomerSearch('');
                    setSelectedCustomerInfo(null);
                  }}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#8696a0] hover:text-rose-500 cursor-pointer"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {searchingCustomer && (
              <p className="text-[11px] text-[#008069] font-semibold animate-pulse">
                Mencari data customer...
              </p>
            )}

            {/* Customer search results dropdown */}
            {customerResults.length > 0 && !customerId && (
              <div className="border border-[#e9edef] dark:border-[#2a3942] rounded-xl bg-white dark:bg-[#111b21] max-h-48 overflow-y-auto divide-y divide-[#e9edef] dark:divide-[#2a3942] shadow-lg z-20">
                {customerResults.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleSelectCustomer(c)}
                    className="w-full text-left px-3 py-2.5 hover:bg-[#f8fafc] text-xs text-[#111b21] dark:text-[#e9edef] flex justify-between items-center transition-colors cursor-pointer"
                  >
                    <div>
                      <span className="font-bold">{c.name || 'Bunda'}</span>
                      <span className="text-[#667781] dark:text-[#8696a0] ml-2 font-mono">{c.phone}</span>
                      {c.kelurahan && (
                        <p className="text-[10px] text-[#8696a0]">
                          {c.kelurahan}, {c.kecamatan}
                        </p>
                      )}
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#e8f5f2] text-[#008069] font-bold">
                      Pilih
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Selected Customer Details Banner */}
            {selectedCustomerInfo && (
              <div className="p-3 bg-[#e8f5f2] border border-[#c2e7e0] rounded-xl flex items-start justify-between text-xs text-[#008069]">
                <div className="space-y-0.5">
                  <p className="font-bold">{selectedCustomerInfo.name || 'Bunda'} ({selectedCustomerInfo.phone})</p>
                  {selectedCustomerInfo.kelurahan && (
                    <p className="text-[11px] text-[#54656f] dark:text-[#aebac1] flex items-center space-x-1">
                      <MapPin size={11} className="text-[#008069]" />
                      <span>{selectedCustomerInfo.kelurahan}, {selectedCustomerInfo.kecamatan} ({selectedCustomerInfo.distance_km?.toFixed(1) || '0'} km)</span>
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Section 2: Multi-Treatment Selection (Supports multiple identical treatments for 2 children) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider block flex items-center space-x-1.5">
                <Sparkles size={14} className="text-[#008069]" />
                <span>Pilih Layanan / Treatment ({selectedTreatments.length} Dipilih) *</span>
              </label>
              <button
                type="button"
                onClick={() => setShowCustomServiceInput(!showCustomServiceInput)}
                className="text-[11px] text-[#008069] font-bold hover:underline cursor-pointer"
              >
                {showCustomServiceInput ? 'Batal Kustom' : '+ Tambah Treatment Kustom'}
              </button>
            </div>

            {/* Custom service creator input */}
            {showCustomServiceInput && (
              <div className="p-3 bg-[#f8fafc] border border-[#e9edef] dark:border-[#2a3942] rounded-xl space-y-2">
                <p className="text-xs font-bold text-[#111b21] dark:text-[#e9edef]">Tambah Treatment Manual / Kustom</p>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <input
                    type="text"
                    value={customServiceName}
                    onChange={(e) => setCustomServiceName(e.target.value)}
                    placeholder="Nama treatment kustom"
                    autoComplete="off"
                    className="p-2 bg-white border border-[#d1d7db] dark:border-[#374248] rounded-lg text-xs text-[#111b21] dark:text-[#e9edef]"
                  />
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      value={customServiceDuration}
                      onChange={(e) => setCustomServiceDuration(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="60"
                      className="w-20 p-2 bg-white border border-[#d1d7db] dark:border-[#374248] rounded-lg text-xs text-[#111b21] dark:text-[#e9edef]"
                    />
                    <span className="text-xs text-[#667781] dark:text-[#8696a0]">mnt</span>
                    <ToggleSwitch
                      checked={customIsAddon}
                      onChange={(next) => setCustomIsAddon(next)}
                      size="sm"
                      onLabel="Add-on (0m)"
                      offLabel="Standar"
                      title="Add-on: treatment tambahan tanpa buffer perjalanan (0 menit)"
                    />
                  </div>
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-[#667781] dark:text-[#8696a0]">Rp</span>
                    <input
                      type="number"
                      value={customServicePrice}
                      onChange={(e) => setCustomServicePrice(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="0"
                      className="w-full pl-8 pr-2 p-2 bg-white border border-[#d1d7db] dark:border-[#374248] rounded-lg text-xs text-[#111b21] dark:text-[#e9edef]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleAddCustomTreatment}
                    className="px-3 py-2 bg-[#008069] text-white rounded-lg text-xs font-bold hover:bg-[#00a884] cursor-pointer"
                  >
                    Tambahkan
                  </button>
                </div>
              </div>
            )}

            {/* Catalog Selector Dropdown Button */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsServiceDropdownOpen(!isServiceDropdownOpen)}
                className="w-full p-2.5 bg-white border border-[#d1d7db] dark:border-[#374248] rounded-xl text-xs text-left text-[#111b21] dark:text-[#e9edef] focus:outline-none focus:border-[#008069] shadow-xs flex items-center justify-between cursor-pointer"
              >
                <div className="flex items-center space-x-2 truncate">
                  <Plus size={14} className="text-[#008069] flex-shrink-0" />
                  <span className="truncate font-semibold text-[#54656f] dark:text-[#aebac1]">
                    {selectedTreatments.length > 0
                      ? `${selectedTreatments.length} treatment dipilih (klik untuk ubah/tambah)...`
                      : '+ Klik untuk memilih treatment dari katalog layanan...'}
                  </span>
                </div>
                <ChevronDown size={14} className="text-[#8696a0] flex-shrink-0" />
              </button>

              {/* Dropdown Menu with Stepper Qty and OK/Selesai Confirmation Button */}
              {isServiceDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-[#111b21] border border-[#d1d7db] dark:border-[#374248] rounded-2xl shadow-2xl z-40 p-2.5 space-y-2 max-h-72 flex flex-col">
                  {/* Search inside dropdown */}
                  <div className="relative shrink-0">
                    <input
                      type="text"
                      name="service-search-input"
                      value={serviceSearch}
                      onChange={(e) => setServiceSearch(e.target.value)}
                      placeholder="Cari layanan (misal: Pijat Bayi, Laktasi, Moksa)..."
                      enterKeyHint="search"
                      inputMode="search"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck="false"
                      className="w-full pl-8 pr-3 py-1.5 bg-[#f0f2f5] border border-[#d1d7db] dark:border-[#374248] rounded-lg text-xs text-[#111b21] dark:text-[#e9edef] focus:outline-none focus:border-[#008069]"
                      autoFocus
                    />
                    <Search size={13} className="absolute left-2.5 top-2.5 text-[#8696a0]" />
                  </div>

                  {/* Services List with Quantity Controls */}
                  <div className="divide-y divide-[#e9edef] dark:divide-[#2a3942] overflow-y-auto flex-1 pr-1">
                    {filteredServices.map((srv) => {
                      const count = selectedTreatments.filter((t) => t.serviceId === srv.id).length;
                      const isAddon = isAddonService(srv);
                      return (
                        <div
                          key={srv.id}
                          className={`p-2 rounded-lg transition-colors flex items-center justify-between group ${
                            count > 0 ? 'bg-[#e8f5f2]/70' : 'hover:bg-[#f0f2f5]'
                          }`}
                        >
                          <div className="flex-1 min-w-0 pr-2">
                            <div className="flex items-center space-x-1.5">
                              <span className="font-bold text-xs text-[#111b21] dark:text-[#e9edef] group-hover:text-[#008069] truncate">
                                {srv.name}
                              </span>
                              <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold shrink-0 ${
                                isAddon
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-[#f0f2f5] text-[#54656f] dark:text-[#aebac1]'
                              }`}>
                                {isAddon ? 'Add-on (0m buffer)' : srv.category}
                              </span>
                            </div>
                            <div className="flex items-center space-x-2 text-[10px] text-[#667781] dark:text-[#8696a0] mt-0.5">
                              <span>Durasi: {srv.durationMinutes} mnt {!isAddon && '(+20m buffer)'}</span>
                              <span>•</span>
                              <span className="font-bold text-[#008069]">
                                Rp {srv.promoPrice ? srv.promoPrice.toLocaleString('id-ID') : srv.originalPrice?.toLocaleString('id-ID')}
                              </span>
                            </div>
                          </div>

                          {/* Stepper Quantity Buttons */}
                          <div className="shrink-0">
                            {count === 0 ? (
                              <button
                                type="button"
                                onClick={() => handleAddServiceInstance(srv)}
                                className="px-2.5 py-1 rounded-lg bg-white hover:bg-[#008069] text-[#008069] hover:text-white border border-[#008069] text-xs font-bold transition shadow-2xs active:scale-95 cursor-pointer"
                              >
                                + Pilih
                              </button>
                            ) : (
                              <div className="flex items-center space-x-1 bg-white border border-[#c2e7e0] rounded-lg p-0.5 shadow-2xs">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveLastServiceInstance(srv.id)}
                                  className="w-6 h-6 rounded bg-[#f0f2f5] hover:bg-rose-100 text-[#54656f] dark:text-[#aebac1] hover:text-rose-700 font-bold text-xs flex items-center justify-center transition cursor-pointer"
                                  title="Kurangi 1 treatment"
                                >
                                  <Minus size={11} />
                                </button>
                                <span className="w-5 text-center font-extrabold text-xs text-[#008069]">
                                  {count}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleAddServiceInstance(srv)}
                                  className="w-6 h-6 rounded bg-[#008069] hover:bg-[#00a884] text-white font-bold text-xs flex items-center justify-center transition cursor-pointer"
                                  title="Tambah lagi (misal untuk Anak ke-2)"
                                >
                                  <Plus size={11} />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Bottom Checklist / OK Button */}
                  <div className="pt-2 border-t border-[#e9edef] dark:border-[#2a3942] flex items-center justify-between shrink-0">
                    <span className="text-[11px] font-semibold text-[#008069]">
                      ✓ {selectedTreatments.length} treatment terpilih
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsServiceDropdownOpen(false)}
                      className="px-3.5 py-1.5 bg-[#008069] hover:bg-[#00a884] text-white rounded-lg text-xs font-bold transition flex items-center space-x-1.5 shadow-xs cursor-pointer active:scale-95"
                    >
                      <Check size={14} />
                      <span>Selesai Memilih</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Selected Treatments Chips / List */}
            {selectedTreatments.length > 0 && (
              <div className="space-y-2 p-3 bg-[#f8fafc] border border-[#e9edef] dark:border-[#2a3942] rounded-xl">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-bold text-[#111b21] dark:text-[#e9edef] uppercase tracking-wider">
                    Daftar Treatment Terpilih ({selectedTreatments.length} Layanan):
                  </p>
                  {babies.length > 1 && (
                    <span className="text-[10px] text-[#008069] font-bold bg-[#e8f5f2] px-2 py-0.5 rounded-full border border-[#c2e7e0]">
                      2+ Anak Terdaftar
                    </span>
                  )}
                </div>

                <div className="space-y-1.5">
                  {selectedTreatments.map((t, idx) => {
                    const isAddon = isAddonService(t);
                    return (
                      <div
                        key={t.instanceId || idx}
                        className="p-2.5 bg-white dark:bg-[#1c272e] border border-[#e9edef] dark:border-[#2a3942] rounded-xl text-xs shadow-2xs space-y-2"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-start space-x-2 min-w-0">
                            <span className="h-5 w-5 rounded-full bg-[#e8f5f2] text-[#008069] flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5 sm:mt-0">
                              #{idx + 1}
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center flex-wrap gap-1.5">
                                <span className="font-bold text-[#111b21] dark:text-[#e9edef]">{t.name}</span>
                                <span className="text-[#667781] dark:text-[#8696a0] text-[11px]">({t.durationMinutes} mnt)</span>
                                <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                                  isAddon
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-[#e8f5f2] text-[#008069]'
                                }`}>
                                  {isAddon ? 'Add-on (0m buffer)' : 'Layanan Utama (+20m buffer)'}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between sm:justify-end space-x-2 shrink-0 pt-1 sm:pt-0 border-t sm:border-t-0 border-[#f0f2f5]">
                            {/* Inline Editable Price Input */}
                            <div className="flex items-center space-x-1 bg-[#f8fafc] border border-[#d1d7db] dark:border-[#374248] hover:border-[#008069] focus-within:border-[#008069] focus-within:ring-1 focus-within:ring-[#008069] rounded-lg px-2 py-0.5 shadow-2xs transition">
                              <span className="text-[10px] font-bold text-[#667781] dark:text-[#8696a0]">Rp</span>
                              <input
                                type="number"
                                value={t.price === 0 ? '' : t.price}
                                onChange={(e) => handleUpdateTreatmentPrice(t.instanceId, e.target.value === '' ? 0 : Number(e.target.value))}
                                placeholder="0"
                                step={5000}
                                min={0}
                                className="w-20 bg-transparent text-xs font-extrabold text-[#008069] focus:outline-none text-right font-mono"
                                title="Ubah tarif harga treatment ini jika ada harga khusus"
                              />
                            </div>

                            <div className="flex items-center space-x-1">
                              {/* Duplicate Button for second child */}
                              {babies.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleDuplicateTreatment(t)}
                                  className="p-1 rounded-md text-[#008069] hover:bg-[#e8f5f2] transition flex items-center space-x-1 cursor-pointer text-[10px] font-bold border border-[#c2e7e0]"
                                  title="Duplikat treatment ini untuk anak lainnya"
                                >
                                  <Copy size={11} />
                                  <span className="hidden sm:inline">+ Duplikat Anak</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleRemoveTreatment(t.instanceId)}
                                className="text-[#8696a0] hover:text-rose-600 p-1.5 rounded-md hover:bg-rose-50 cursor-pointer transition"
                                title="Hapus treatment"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Child Assignment Dropdown (If customer has children) */}
                        {babies.length > 0 && t.category !== 'MOMS' && (
                          <div className="flex items-center space-x-2 pt-1.5 border-t border-[#f0f2f5] text-[11px] flex-wrap sm:flex-nowrap gap-1">
                            <span className="text-[#667781] dark:text-[#8696a0] font-semibold flex items-center space-x-1 shrink-0">
                              <Baby size={11} className="text-[#008069]" />
                              <span>Ditujukan untuk:</span>
                            </span>
                            <select
                              value={t.assignedChildIndex ?? 0}
                              onChange={(e) => handleUpdateTreatmentChild(t.instanceId, Number(e.target.value))}
                              className="flex-1 min-w-0 max-w-full sm:max-w-xs px-2 py-1 bg-[#f0f2f5] border border-[#d1d7db] dark:border-[#374248] rounded-lg text-xs font-bold text-[#111b21] dark:text-[#e9edef] focus:outline-none focus:border-[#008069] cursor-pointer truncate"
                            >
                              {babies.map((b, bIdx) => (
                                <option key={bIdx} value={bIdx}>
                                  👶 Anak #{bIdx + 1}: {b.name || `Anak ${bIdx + 1}`} {b.ageText ? `(${b.ageText})` : ''}
                                </option>
                              ))}
                              <option value={-1}>👩 Bunda / Umum</option>
                            </select>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Duration & Buffer Breakdown */}
                <div className="pt-2 border-t border-[#e9edef] dark:border-[#2a3942] flex flex-wrap items-center gap-2 text-xs">
                  <span className="px-2.5 py-1 rounded-lg bg-white border border-[#d1d7db] dark:border-[#374248] text-[#54656f] dark:text-[#aebac1] font-medium">
                    🕒 Durasi Layanan: <strong className="text-[#111b21] dark:text-[#e9edef]">{pureDurationMinutes} mnt</strong>
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 text-amber-800 dark:text-amber-200 font-medium">
                    ☕ Buffer Jeda: <strong>+{totalBufferMinutes} mnt</strong> ({mainTreatmentsCount} Utama @20m{addonTreatmentsCount > 0 ? `, ${addonTreatmentsCount} Add-on @0m` : ''})
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-[#e8f5f2] dark:bg-[#00a884]/15 border border-[#c2e7e0] dark:border-[#00a884]/30 text-[#008069] dark:text-[#00a884] font-bold">
                    ⏱️ Total Waktu: {totalScheduledDurationMinutes} mnt
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-[#008069] text-white font-bold">
                    🏁 Selesai: {calculateEndTime()} WIB
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Section 3: Date, Time & Smart Recommendations */}
          <div className="space-y-3 pt-2 border-t border-[#e9edef] dark:border-[#2a3942]">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Date */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider block">
                    Tanggal Kunjungan *
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowBookedSlotsModal(true)}
                    className="text-[11px] text-[#008069] font-bold hover:underline flex items-center space-x-1 cursor-pointer"
                  >
                    <Eye size={12} />
                    <span>Lihat Jadwal Terisi ({bookedReservationsForDate.length})</span>
                  </button>
                </div>
                <div className="flex items-center space-x-1.5">
                  <input
                    type="date"
                    required
                    value={bookingDate}
                    onChange={(e) => {
                      setBookingDate(e.target.value);
                      setHasCalculatedRecommendations(false);
                    }}
                    className="flex-1 p-2 bg-white border border-[#d1d7db] dark:border-[#374248] rounded-xl text-xs text-[#111b21] dark:text-[#e9edef] focus:outline-none focus:border-[#008069] shadow-xs font-semibold"
                  />
                  <button
                    type="button"
                    onClick={() => setShowBookedSlotsModal(true)}
                    className="p-2 bg-[#e8f5f2] hover:bg-[#c2e7e0] text-[#008069] rounded-xl border border-[#c2e7e0] shadow-xs transition cursor-pointer"
                    title="Lihat Jadwal Terisi Hari Ini"
                  >
                    <CalendarDays size={16} />
                  </button>
                </div>
              </div>

              {/* Start Time & Recommendation Button */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider block">
                    Jam Mulai (WIB) *
                  </label>
                  <button
                    type="button"
                    onClick={handleGenerateRecommendations}
                    className="text-[11px] text-[#008069] font-bold hover:underline flex items-center space-x-1 cursor-pointer"
                  >
                    <Zap size={12} className="text-amber-500 fill-amber-500" />
                    <span>Rekomendasikan Jam</span>
                  </button>
                </div>
                <input
                  type="time"
                  required
                  value={bookingTime}
                  onChange={(e) => setBookingTime(e.target.value)}
                  className="w-full p-2 bg-white border border-[#d1d7db] dark:border-[#374248] rounded-xl text-xs text-[#111b21] dark:text-[#e9edef] focus:outline-none focus:border-[#008069] shadow-xs font-bold"
                />
              </div>
            </div>

            {/* Recommendations Chips Area with Arrival Timeline */}
            {recommendations.length > 0 && (
              <div className="p-3 bg-[#e8f5f2] border border-[#c2e7e0] rounded-xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#008069] flex items-center space-x-1.5">
                    <Sparkles size={14} />
                    <span>Rekomendasi Jam & Estimasi Kedatangan Bidan</span>
                  </span>
                  <span className="text-[10px] text-[#54656f] dark:text-[#aebac1]">Klik slot untuk memilih</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {recommendations.map((rec, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleApplyRecommendation(rec)}
                      className={`p-2.5 rounded-xl border text-left transition-all flex flex-col justify-between cursor-pointer space-y-2 ${
                        bookingTime === rec.startTime && assignedStaffId === rec.staffId
                          ? 'bg-[#008069] text-white border-[#008069] shadow-sm'
                          : 'bg-white border-[#c2e7e0] hover:bg-white/90 text-[#111b21] dark:text-[#e9edef]'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center space-x-2">
                          <span className="font-extrabold text-sm">{rec.startTime} WIB</span>
                          <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                            bookingTime === rec.startTime && assignedStaffId === rec.staffId
                              ? 'bg-white/20 text-white'
                              : 'bg-[#e8f5f2] text-[#008069]'
                          }`}>
                            {rec.staffName}
                          </span>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          bookingTime === rec.startTime && assignedStaffId === rec.staffId
                            ? 'bg-white text-[#008069]'
                            : 'bg-[#e8f5f2] text-[#008069]'
                        }`}>
                          Pilih
                        </span>
                      </div>

                      {/* Detailed Midwife Arrival & Departure Timeline */}
                      <div className={`text-[10px] space-y-1 pt-1.5 border-t ${
                        bookingTime === rec.startTime && assignedStaffId === rec.staffId
                          ? 'border-white/20 text-white/90'
                          : 'border-[#f0f2f5] text-[#54656f] dark:text-[#aebac1]'
                      }`}>
                        <div className="flex items-center justify-between">
                          <span className="flex items-center space-x-1">
                            <Bike size={11} className="opacity-80" />
                            <span>Bidan Berangkat:</span>
                          </span>
                          <strong className="font-mono">{rec.departureTime} WIB</strong>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="flex items-center space-x-1">
                            <Home size={11} className="opacity-80" />
                            <span>Estimasi Tiba di Rumah:</span>
                          </span>
                          <strong className="font-mono font-bold text-amber-700 bg-amber-50 px-1 rounded">{rec.arrivalTime} WIB</strong>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="flex items-center space-x-1">
                            <Clock size={11} className="opacity-80" />
                            <span>Treatment Selesai:</span>
                          </span>
                          <strong className="font-mono">{rec.endTime} WIB</strong>
                        </div>
                        <p className="text-[9px] opacity-75 truncate pt-0.5">
                          Rute: ± {rec.distanceKm} km (~{rec.travelMinutes} mnt dari {rec.originDesc})
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-[#54656f] dark:text-[#aebac1] italic">
                  * Jadwal tiba dihitung 10 menit sebelum treatment dimulai untuk persiapan terapis, cuci tangan, dan sterilisasi alat.
                </p>
              </div>
            )}

            {/* Multi-Session Schedule Builder */}
            {isMultiSession && multiSessionSchedule.length > 0 && (
              <div className="p-3 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-blue-700 flex items-center space-x-1.5">
                    <CalendarDays size={14} />
                    <span>Jadwal Paket {multiSessionTotal} Sesi</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => { setIsMultiSession(false); setMultiSessionSchedule([]); }}
                    className="text-[10px] text-blue-600 hover:text-red-600 font-bold cursor-pointer"
                  >
                    Batal Paket
                  </button>
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1.5">
                  {multiSessionSchedule.map((s, idx) => (
                    <div key={idx} className="flex items-center gap-2 bg-white rounded-lg px-2.5 py-1.5 border border-blue-100">
                      <span className="text-[10px] font-bold text-blue-600 w-12 shrink-0">Sesi {s.sessionNumber}</span>
                      <input
                        type="date"
                        value={s.date}
                        onChange={(e) => {
                          const newSchedule = [...multiSessionSchedule];
                          newSchedule[idx].date = e.target.value;
                          setMultiSessionSchedule(newSchedule);
                        }}
                        className="flex-1 min-w-0 px-2 py-1 border border-[#d1d7db] dark:border-[#374248] rounded-lg text-[11px] text-[#111b21] dark:text-[#e9edef] focus:outline-none focus:border-[#008069]"
                      />
                      <input
                        type="time"
                        value={s.time}
                        onChange={(e) => {
                          const newSchedule = [...multiSessionSchedule];
                          newSchedule[idx].time = e.target.value;
                          setMultiSessionSchedule(newSchedule);
                        }}
                        className="w-24 px-2 py-1 border border-[#d1d7db] dark:border-[#374248] rounded-lg text-[11px] text-[#111b21] dark:text-[#e9edef] font-bold focus:outline-none focus:border-[#008069]"
                      />
                      <select
                        value={s.staffId}
                        onChange={(e) => {
                          const newSchedule = [...multiSessionSchedule];
                          newSchedule[idx].staffId = e.target.value;
                          setMultiSessionSchedule(newSchedule);
                        }}
                        className="w-28 px-2 py-1 border border-[#d1d7db] dark:border-[#374248] rounded-lg text-[11px] text-[#111b21] dark:text-[#e9edef] focus:outline-none focus:border-[#008069] truncate"
                      >
                        <option value="">Default</option>
                        {staffList.map((st) => (
                          <option key={st.id} value={st.id}>{st.name}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-blue-600 italic">
                  * Atur tanggal & jam per sesi. Klik "Buat Paket" untuk membuat {multiSessionTotal} reservasi sekaligus.
                </p>
              </div>
            )}
          </div>

          {/* Section 4: Staff / Terapis Assignment & Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Staff */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider block flex items-center space-x-1">
                  <UserCheck size={12} />
                  <span>Penugasan Terapis</span>
                </label>
                {user?.id && (
                  <button
                    type="button"
                    onClick={() => setAssignedStaffId(user.id)}
                    className="text-[10px] text-[#008069] font-bold hover:underline flex items-center gap-1 cursor-pointer bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200"
                  >
                    <span>⚡ Saya Sendiri</span>
                  </button>
                )}
              </div>
              <select
                value={assignedStaffId}
                onChange={(e) => setAssignedStaffId(e.target.value)}
                className="w-full p-2 bg-white border border-[#d1d7db] dark:border-[#374248] rounded-xl text-xs text-[#111b21] dark:text-[#e9edef] focus:outline-none focus:border-[#008069] shadow-xs font-medium"
              >
                <option value="">-- Otomatis / Belum Ditugaskan --</option>
                {staffList
                  .filter((s) => s.active !== false)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.role === 'THERAPIST' ? '(Terapis)' : `(${s.role})`}
                    </option>
                  ))}
              </select>
            </div>

            {/* Status */}
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider block">
                Status Pembayaran / Booking
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="w-full p-2 bg-white border border-[#d1d7db] dark:border-[#374248] rounded-xl text-xs text-[#111b21] dark:text-[#e9edef] focus:outline-none focus:border-[#008069] shadow-xs font-medium"
              >
                <option value="pending">Pending (Menunggu Pembayaran)</option>
                <option value="confirmed">Confirmed (Lunas / Terkonfirmasi)</option>
              </select>
            </div>
          </div>

          {/* Section 5: Children / Baby details (Multi-Anak Support) */}
          {treatmentCategory !== 'MOMS' && (
            <div className="space-y-2 p-3.5 bg-[#f8fafc] border border-[#e9edef] dark:border-[#2a3942] rounded-xl">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-[#008069] uppercase tracking-wider flex items-center space-x-1.5">
                  <Baby size={14} />
                  <span>Data Anak / Bayi ({babies.length} Anak)</span>
                </span>
                <button
                  type="button"
                  onClick={handleAddBaby}
                  className="px-2.5 py-1 rounded-lg bg-white border border-[#d1d7db] dark:border-[#374248] text-[11px] font-bold text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] shadow-xs flex items-center space-x-1 cursor-pointer"
                >
                  <Plus size={12} />
                  <span>+ Tambah Anak</span>
                </button>
              </div>

              {babies.length === 0 ? (
                <p className="text-[11px] text-[#8696a0] italic">
                  Belum ada data anak yang diisi (opsional jika perawatan khusus Bunda).
                </p>
              ) : (
                <div className="space-y-2">
                  {babies.map((b, idx) => (
                    <div key={idx} className="p-2.5 bg-white border border-[#e9edef] dark:border-[#2a3942] rounded-xl space-y-2 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[#111b21] dark:text-[#e9edef]">Anak #{idx + 1}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveBaby(idx)}
                          className="text-[#8696a0] hover:text-rose-600 p-1 cursor-pointer"
                          title="Hapus anak ini"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={b.name}
                          onChange={(e) => handleUpdateBaby(idx, 'name', e.target.value)}
                          placeholder="Nama Lengkap / Panggilan Anak"
                          className="p-2 bg-white border border-[#d1d7db] dark:border-[#374248] rounded-lg text-xs text-[#111b21] dark:text-[#e9edef]"
                        />
                        <input
                          type="text"
                          value={b.ageText}
                          onChange={(e) => handleUpdateBaby(idx, 'ageText', e.target.value)}
                          placeholder="Usia (misal: 8 bulan / 2 tahun)"
                          className="p-2 bg-white border border-[#d1d7db] dark:border-[#374248] rounded-lg text-xs text-[#111b21] dark:text-[#e9edef]"
                        />
                      </div>
                    </div>
                  ))}

                  {babies.length > 1 && selectedTreatments.length === 1 && (
                    <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-800 flex items-center justify-between">
                      <span>💡 Anda mengisi 2 anak. Ingin menambah treatment untuk anak ke-2?</span>
                      <button
                        type="button"
                        onClick={() => handleDuplicateTreatment(selectedTreatments[0])}
                        className="px-2 py-0.5 bg-amber-600 text-white rounded font-bold text-[10px] hover:bg-amber-700 cursor-pointer shrink-0 ml-2"
                      >
                        + Duplikat Layanan
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Section: Rincian Biaya & Total Pembayaran */}
          <div className="p-3.5 bg-gradient-to-br from-[#f8fafc] to-emerald-50/40 border border-[#e9edef] dark:border-[#2a3942] rounded-xl space-y-3 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[#008069] uppercase tracking-wider flex items-center space-x-1.5">
                <Receipt size={14} />
                <span>Rincian Biaya & Total Pembayaran</span>
              </span>
              <span className="text-xs font-mono font-extrabold text-[#008069]">
                Total: Rp {totalPaymentAmount.toLocaleString('id-ID')}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {/* Subtotal Treatments */}
              <div>
                <label className="block text-[11px] font-semibold text-[#54656f] dark:text-[#aebac1] mb-1">
                  Subtotal Layanan ({selectedTreatments.length})
                </label>
                <div className="px-3 py-1.5 bg-white border border-[#d1d7db] dark:border-[#374248] rounded-lg text-xs font-bold text-[#111b21] dark:text-[#e9edef] font-mono">
                  Rp {subtotalTreatments.toLocaleString('id-ID')}
                </div>
              </div>

              {/* Ongkir */}
              <div>
                <label className="block text-[11px] font-semibold text-[#54656f] dark:text-[#aebac1] mb-1">
                  Ongkos Kirim (Rp)
                </label>
                <input
                  type="number"
                  value={ongkir}
                  onChange={(e) => setOngkir(e.target.value === '' ? '' : Number(e.target.value))}
                  step={5000}
                  min={0}
                  placeholder="0"
                  className="w-full px-3 py-1.5 bg-white border border-[#d1d7db] dark:border-[#374248] rounded-lg text-xs font-bold text-[#111b21] dark:text-[#e9edef] focus:border-[#008069] focus:outline-none transition font-mono"
                />
              </div>

              {/* Diskon / Promo */}
              <div>
                <label className="block text-[11px] font-semibold text-rose-600 mb-1 flex items-center gap-1">
                  <Percent size={11} />
                  <span>Diskon / Promo (Rp)</span>
                </label>
                <input
                  type="number"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value === '' ? '' : Number(e.target.value))}
                  step={5000}
                  min={0}
                  placeholder="0"
                  className="w-full px-3 py-1.5 bg-white border border-rose-200 rounded-lg text-xs font-bold text-rose-600 focus:border-rose-500 focus:outline-none transition font-mono"
                />
              </div>
            </div>

            {/* Quick Shortcuts */}
            <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1 border-t border-[#e9edef] dark:border-[#2a3942]/80 text-[10px]">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[#8696a0] font-semibold">Ongkir:</span>
                <button
                  type="button"
                  onClick={() => setOngkir(0)}
                  className={`px-2 py-0.5 rounded-md font-bold border transition cursor-pointer ${
                    Number(ongkir) === 0 ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white dark:bg-transparent text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/40 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
                  }`}
                >
                  Free (0)
                </button>
                {deliveryTiers.filter(t => (Number(t.fee) - Number(t.promoDiscount || 0)) > 0).map(t => {
                  const net = Math.max(0, Number(t.fee) - Number(t.promoDiscount || 0));
                  return (
                    <button
                      key={String(t.id || t.maxDist)}
                      type="button"
                      onClick={() => setOngkir(net)}
                      className={`px-2 py-0.5 rounded-md font-semibold border transition cursor-pointer ${
                        Number(ongkir) === net ? 'bg-[#008069] text-white border-[#008069]' : 'bg-white dark:bg-transparent text-[#54656f] dark:text-[#aebac1] border-[#d1d7db] dark:border-[#374248] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]'
                      }`}
                      title={`Tier s/d ${t.maxDist} km`}
                    >
                      {net.toLocaleString('id-ID')}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-rose-600 font-semibold">Promo:</span>
                <button
                  type="button"
                  onClick={() => setDiscount(0)}
                  className={`px-2 py-0.5 rounded-md font-semibold border transition cursor-pointer ${
                    Number(discount) === 0 ? 'bg-gray-700 text-white border-gray-700' : 'bg-white dark:bg-transparent text-gray-700 dark:text-gray-300 border-gray-200 dark:border-[#374248] hover:bg-gray-50 dark:hover:bg-[#2a3942]'
                  }`}
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={() => setDiscount(5000)}
                  className={`px-2 py-0.5 rounded-md font-bold border transition cursor-pointer ${
                    Number(discount) === 5000 ? 'bg-rose-600 text-white border-rose-600' : 'bg-white dark:bg-transparent text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/40 hover:bg-rose-50 dark:hover:bg-rose-950/40'
                  }`}
                >
                  -5.000
                </button>
                <button
                  type="button"
                  onClick={() => setDiscount(10000)}
                  className={`px-2 py-0.5 rounded-md font-bold border transition cursor-pointer ${
                    Number(discount) === 10000 ? 'bg-rose-600 text-white border-rose-600' : 'bg-white dark:bg-transparent text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/40 hover:bg-rose-50 dark:hover:bg-rose-950/40'
                  }`}
                >
                  -10.000
                </button>
              </div>
            </div>

            {/* Grand Total Bar */}
            <div className="pt-2 border-t border-[#e9edef] dark:border-[#2a3942] flex items-center justify-between text-xs">
              <div className="text-[#667781] dark:text-[#8696a0]">
                <span>Total tagihan: </span>
                <span className="text-[11px] italic text-[#8696a0]">
                  (Layanan Rp {subtotalTreatments.toLocaleString('id-ID')} + Ongkir Rp {Number(ongkir).toLocaleString('id-ID')}{Number(discount) > 0 ? ` - Promo Rp ${Number(discount).toLocaleString('id-ID')}` : ''})
                </span>
              </div>
              <div className="text-sm sm:text-base font-extrabold text-[#008069] font-mono">
                Rp {totalPaymentAmount.toLocaleString('id-ID')}
              </div>
            </div>
          </div>

          {/* Section 6: Notes */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider block flex items-center space-x-1">
              <FileText size={12} />
              <span>Catatan / Keluhan Khusus Pasien</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contoh: Pasien minta terapis senior, anak sedang pilek ringan..."
              rows={2}
              className="w-full p-2.5 bg-white border border-[#d1d7db] dark:border-[#374248] rounded-xl text-xs text-[#111b21] dark:text-[#e9edef] focus:outline-none focus:border-[#008069] resize-none shadow-xs"
            />
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t border-[#e9edef] dark:border-[#2a3942] flex items-center justify-between">
            <button
              type="button"
              onClick={saveDraftManually}
              className="px-3 py-2 rounded-xl bg-white border border-[#d1d7db] dark:border-[#374248] text-xs font-bold text-[#54656f] dark:text-[#aebac1] hover:bg-amber-50 hover:text-amber-700 hover:border-amber-300 transition flex items-center space-x-1.5 cursor-pointer shadow-2xs"
              title="Simpan draf lokal selama 1 jam"
            >
              <BookmarkPlus size={14} className="text-amber-600" />
              <span>Simpan Draf</span>
            </button>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-[#d1d7db] dark:border-[#374248] text-xs font-semibold text-[#54656f] dark:text-[#aebac1] hover:bg-[#f0f2f5] transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 rounded-xl bg-[#008069] hover:bg-[#00a884] disabled:opacity-50 text-white text-xs font-semibold flex items-center space-x-1.5 shadow-xs transition-colors cursor-pointer"
              >
                <Check size={14} />
                <span>{submitting ? 'Menyimpan...' : (mode === 'edit' ? 'Simpan Perubahan Reservasi' : isMultiSession ? `Buat Paket ${multiSessionTotal} Sesi` : 'Simpan & Buat Jadwal')}</span>
              </button>
            </div>
          </div>
        </form>

        {/* ========================================================================= */}
        {/* MODAL / DRAWER: LIHAT JADWAL TERISI (CALENDAR PEEK) */}
        {/* ========================================================================= */}
        {showBookedSlotsModal && (
          <div
            className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fadeIn overflow-y-auto overflow-x-hidden touch-pan-y overscroll-contain"
            onClick={() => setShowBookedSlotsModal(false)}
            style={{ touchAction: 'pan-y' }}
          >
            <div
              className="w-full max-w-lg bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#2a3942] dark:text-[#e9edef] rounded-2xl p-4 sm:p-5 shadow-2xl space-y-4 max-h-[85vh] flex flex-col mx-auto overflow-x-hidden touch-pan-y overscroll-contain"
              onClick={(e) => e.stopPropagation()}
              style={{ touchAction: 'pan-y' }}
            >
              <div className="flex items-center justify-between border-b border-[#e9edef] dark:border-[#2a3942] pb-3">
                <div>
                  <h3 className="text-base font-bold text-[#111b21] dark:text-[#e9edef] flex items-center space-x-2">
                    <CalendarDays className="text-[#008069]" size={18} />
                    <span>Jadwal Terisi pada {bookingDate || 'Hari Ini'}</span>
                  </h3>
                  <p className="text-xs text-[#667781] dark:text-[#8696a0] mt-0.5">
                    {bookedReservationsForDate.length} reservasi terdaftar pada tanggal ini
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowBookedSlotsModal(false)}
                  className="p-1.5 rounded-lg text-[#8696a0] hover:text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Bookings Timeline List */}
              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {bookedReservationsForDate.length === 0 ? (
                  <div className="p-8 text-center bg-[#f8fafc] border border-dashed border-[#d1d7db] dark:border-[#374248] rounded-2xl">
                    <CheckCircle2 size={32} className="text-[#008069] mx-auto mb-2 opacity-80" />
                    <p className="text-sm font-bold text-[#111b21] dark:text-[#e9edef]">Hari Ini Masih Kosong</p>
                    <p className="text-xs text-[#667781] dark:text-[#8696a0] mt-1">
                      Belum ada jadwal reservasi yang terisi pada tanggal ini. Seluruh slot jam tersedia!
                    </p>
                  </div>
                ) : (
                  bookedReservationsForDate.map((res) => {
                    const rDate = new Date(res.booking_date!);
                    const startTimeStr = `${String(rDate.getHours()).padStart(2, '0')}:${String(rDate.getMinutes()).padStart(2, '0')}`;
                    const cust = res.customer as any;
                    return (
                      <div
                        key={res.id}
                        className="p-3 bg-white dark:bg-[#1c272e] border border-[#e9edef] dark:border-[#2a3942] rounded-xl shadow-2xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="px-2 py-0.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 text-xs font-bold font-mono">
                            🔴 {startTimeStr} WIB
                          </span>
                          <span className="text-xs font-bold text-[#008069] bg-[#e8f5f2] px-2 py-0.5 rounded-full">
                            {res.assigned_staff?.name || 'Terapis Belum Ditugaskan'}
                          </span>
                        </div>

                        <div className="text-xs space-y-0.5">
                          <p className="font-bold text-[#111b21] dark:text-[#e9edef]">
                            {cust?.name || 'Bunda'} ({cust?.phone})
                          </p>
                          <p className="text-[#54656f] dark:text-[#aebac1] text-[11px] line-clamp-1">
                            {res.treatment_detail || res.treatment_category}
                          </p>
                          {cust?.kelurahan && (
                            <p className="text-[10px] text-[#8696a0] flex items-center space-x-1">
                              <MapPin size={10} className="text-[#008069]" />
                              <span>{cust.kelurahan}, {cust.kecamatan}</span>
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="pt-3 border-t border-[#e9edef] dark:border-[#2a3942] flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowBookedSlotsModal(false)}
                  className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  Tutup Pratinjau
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
