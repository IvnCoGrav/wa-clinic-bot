import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { apiRequest } from '../services/api';
import type { DispatchTripData } from '../components/livechat/LiveChatDispatchWidget';
import type { LiveChatItem, ChatMessage } from '../types/livechat';
import {
  extractScheduleFromMessages,
  ExtractedScheduleData,
  WilayahReference,
} from '../utils/chatScheduleExtractor';
import {
  getWibDateKey,
  getWibHoursAndMinutes,
} from '../utils/dateWib';
import { resolveEffectiveLocationSource } from '../utils/geoUtils';

// Cache referensi wilayah (backend gazetteer) — diambil sekali per sesi invoice
let cachedWilayahRef: WilayahReference | null = null;
let wilayahRefInflight: Promise<WilayahReference | null> | null = null;
async function getWilayahRef(): Promise<WilayahReference | null> {
  if (cachedWilayahRef) return cachedWilayahRef;
  if (!wilayahRefInflight) {
    wilayahRefInflight = (async () => {
      try {
        const res = await apiRequest('/api/admin/geo/areas');
        const data = res?.data as WilayahReference | undefined;
        if (data && (Array.isArray(data.kecamatan) || Array.isArray(data.kota))) {
          cachedWilayahRef = { kecamatan: data.kecamatan || [], kota: data.kota || [] };
          return cachedWilayahRef;
        }
      } catch {}
      return null;
    })().finally(() => { wilayahRefInflight = null; });
  }
  return wilayahRefInflight;
}

export interface UseLiveChatReservationsProps {
  selectedChat: LiveChatItem | null;
  selectedIdRef: React.MutableRefObject<string | null>;
  chatsRef: React.MutableRefObject<LiveChatItem[]>;
  setChats: React.Dispatch<React.SetStateAction<LiveChatItem[]>>;
  messages: ChatMessage[];
  toast: (message: string, type?: 'info' | 'success' | 'error') => void;
  confirm: (options: {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
  }) => Promise<boolean>;
}

export function useLiveChatReservations({
  selectedChat,
  selectedIdRef,
  chatsRef,
  setChats,
  messages,
  toast,
  confirm,
}: UseLiveChatReservationsProps) {
  const [customerDetailModalOpen, setCustomerDetailModalOpen] = useState(false);
  const [customerDetailEditMode, setCustomerDetailEditMode] = useState(false);
  const [customerDetailLoading, setCustomerDetailLoading] = useState(false);
  const [customerDetailData, setCustomerDetailData] = useState<any>(null);
  const [addrBookCustomer, setAddrBookCustomer] = useState<{ id: string; name?: string } | null>(null);
  const [savedAddressCount, setSavedAddressCount] = useState<number>(0);

  // Cache address count bila customer aktif berganti (Fase 3, Micro-Task 3.1)
  useEffect(() => {
    const cid = customerDetailData?.id || selectedChat?.customerId;
    if (!cid) {
      setSavedAddressCount(0);
      return;
    }
    apiRequest<{ success: boolean; addresses: any[] }>(`/api/admin/customers/${cid}/addresses`)
      .then((res) => {
        if (res?.success && Array.isArray(res.addresses)) {
          setSavedAddressCount(res.addresses.length);
        }
      })
      .catch(() => setSavedAddressCount(0));
  }, [customerDetailData?.id, selectedChat?.customerId]);

  const [refreshingLocation, setRefreshingLocation] = useState(false);
  // Reservation detail dari riwayat (klik card reservasi)
  const [selectedReservation, setSelectedReservation] = useState<any>(null);
  // Modal Bukti Transfer dari banner reservasi aktif
  const [proofModalReservation, setProofModalReservation] = useState<any>(null);
  // F-C: ref ke handler refetch reservasi customer aktif (dipanggil saat SSE
  // conversation.updated tiba agar banner/HOLD/OTW tidak basi sampai refresh manual).
  const reservationRefreshRef = useRef<(() => void) | null>(null);
  const lastReservationRefreshTimeRef = useRef<number>(0);
  // Widget pemantauan perjalanan terapis (OTW) untuk CS.
  const [dispatchTrip, setDispatchTrip] = useState<DispatchTripData | null>(null);
  const [dispatchLoading, setDispatchLoading] = useState(false);
  // Fase 3 (plan 2026-10-02): drawer radar OTW untuk laptop <1280px.
  const [dispatchDrawerOpen, setDispatchDrawerOpen] = useState(false);
  const loadDispatchTripRef = useRef<((reservationId: string) => void) | null>(null);
  const dispatchReservationIdRef = useRef<string | null>(null);
  const dispatchOriginRef = useRef<boolean>(false);

  const [reservationStaffList, setReservationStaffList] = useState<any[]>([]);
  // Prefetch staff list on mount agar modal edit tidak kosong saat diklik
  useEffect(() => {
    if (reservationStaffList.length === 0) {
      apiRequest('/api/admin/staff')
        .then((res: any) => {
          const list = res?.data || (Array.isArray(res) ? res : []);
          if (Array.isArray(list) && list.length > 0) setReservationStaffList(list);
        })
        .catch(() => {});
    }
  }, []);

  const [showQuickBookingModal, setShowQuickBookingModal] = useState(false);
  const [showQuickHoldModal, setShowQuickHoldModal] = useState(false);
  const [quickHoldInitialDate, setQuickHoldInitialDate] = useState<Date | string | null>(null);
  const [quickHoldInitialTime, setQuickHoldInitialTime] = useState<string | null>(null);
  const [convertingHoldId, setConvertingHoldId] = useState<string | null>(null);
  const [activeEditingHoldReservation, setActiveEditingHoldReservation] = useState<any | null>(null);
  const [activeEditingConfirmedReservation, setActiveEditingConfirmedReservation] = useState<any | null>(null);

  // Smart Micro-Pill auto-collapse (mobile <768px): banner penuh 3 detik lalu menciut
  const [isBannerCollapsed, setIsBannerCollapsed] = useState(false);
  const [userManuallyExpanded, setUserManuallyExpanded] = useState(false);
  const manualExpandRef = useRef(false);
  const [quickBookingTargetSlot, setQuickBookingTargetSlot] = useState<any>(null);
  const [quickBookingExtracted, setQuickBookingExtracted] = useState<ExtractedScheduleData | null>(null);
  // Fase 4B: dismiss smart-banner "FORM RESERVASI MASUK" — kunci per-signatur form
  // (percakapan + entitas), sehingga form BARU (konten beda) bisa muncul kembali.
  const [dismissedFormBanner, setDismissedFormBanner] = useState<string | null>(null);
  const [showDailyScheduleModal, setShowDailyScheduleModal] = useState(false);
  // Invoice Generator Modal (Draft Preview)
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [invoiceModalData, setInvoiceModalData] = useState<ExtractedScheduleData | null>(null);
  const [clinicServices, setClinicServices] = useState<any[]>([]);

  // ⬅️ Sentralisasi Gestur Usapan Tepi Layar / Modal navigation history:
  const pushModalHistory = (modalName: string) => {
    try {
      if (typeof window !== 'undefined' && window.history.state?.view !== 'live-chat-modal') {
        window.history.pushState({ view: 'live-chat-modal', modal: modalName }, '');
      }
    } catch (_) {}
  };

  // AUDIT FASE 2 (T-08): konsumsi entri history modal saat modal ditutup lewat
  // tombol UI (bukan tombol back). Tanpa ini, satu tekanan back "termakan"
  // entri hantu sehingga tombol back perangkat terasa tidak bereaksi.
  const prevTrackedModalOpenRef = useRef(false);
  useEffect(() => {
    const anyTrackedModalOpen = customerDetailModalOpen || showQuickBookingModal || showInvoiceModal;
    if (!anyTrackedModalOpen && prevTrackedModalOpenRef.current) {
      try {
        if (typeof window !== 'undefined' && window.history.state?.view === 'live-chat-modal') {
          window.history.back();
        }
      } catch {}
    }
    prevTrackedModalOpenRef.current = anyTrackedModalOpen;
  }, [customerDetailModalOpen, showQuickBookingModal, showInvoiceModal]);

  const handleOpenCustomerDetail = async (chat: LiveChatItem) => {
    setCustomerDetailModalOpen(true);
    pushModalHistory('customer-detail');
    setCustomerDetailLoading(true);
    // Instant preliminary data so modal never opens empty
    const initialLabels = (chat.customerLabels || []).map((l) => ({ label: l }));
    setCustomerDetailData({
      id: chat.customerId,
      name: chat.customerName,
      phone: chat.customerPhone,
      profile_picture_url: chat.customerProfilePictureUrl,
      labels: initialLabels,
      purchaseCount: chat.purchaseCount || 0,
      ltv: chat.ltv || 0,
    });
    try {
      const res = await apiRequest(`/api/admin/customers/${chat.customerId}`);
      if (res?.data) {
        const fetchedLabels = (res.data.labels && res.data.labels.length > 0)
          ? res.data.labels
          : initialLabels;
        setCustomerDetailData({
          ...res.data,
          labels: fetchedLabels,
        });
      }
    } catch (err: any) {
      // Preliminary data already active
    } finally {
      setCustomerDetailLoading(false);
    }
  };

  const handleSaveCustomerDetail = async (data: any) => {
    const customerId = customerDetailData?.id || selectedChat?.customerId;
    if (!customerId) throw new Error('Customer ID tidak ditemukan');
    await apiRequest(`/api/admin/customers/${customerId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    // Refresh customer detail data after save
    const res = await apiRequest(`/api/admin/customers/${customerId}`);
    if (res?.data) {
      setCustomerDetailData({ ...res.data, labels: customerDetailData?.labels || [] });
      // 2.3: sinkronkan nama/telepon ke daftar tanpa tunggu refresh penuh
      const updatedName = (res.data.name ?? res.data.customerName ?? data.name) as string | undefined;
      const updatedPhone = (res.data.phone ?? res.data.customerPhone ?? data.phone) as string | undefined;
      if (updatedName || updatedPhone) {
        const final = chatsRef.current.map((c) =>
          c.customerId === customerId || c.conversationId === selectedIdRef.current
            ? { ...c, customerName: updatedName ?? c.customerName, customerPhone: updatedPhone ?? c.customerPhone }
            : c
        );
        setChats(final);
        chatsRef.current = final;
      }
    }
    setCustomerDetailEditMode(false);
  };

  const handleRefreshLocation = async () => {
    const customerId = customerDetailData?.id || selectedChat?.customerId;
    if (!customerId) {
      toast('Customer ID tidak ditemukan', 'error');
      return;
    }
    setRefreshingLocation(true);
    try {
      const res: any = await apiRequest(`/api/admin/customers/${customerId}/refresh-location`, { method: 'POST' });
      if (res?.success && res?.data) {
        const d = res.data;
        setCustomerDetailData((prev: any) => ({
          ...prev,
          lat: d.lat,
          lng: d.lng,
          distance_km: d.distanceKm,
          ongkir: d.ongkir,
          is_out_of_coverage: d.isOutOfCoverage,
          kelurahan: d.kelurahan ?? prev?.kelurahan,
          kecamatan: d.kecamatan ?? prev?.kecamatan,
          kota: d.kota ?? prev?.kota,
          preferences: {
            ...(prev?.preferences || {}),
            location_source: d.source,
            location_source_label: d.sourceLabel,
            location_refreshed_at: d.refreshedAt,
            location_refreshed_by: d.refreshedBy,
          },
        }));
        // sync ke daftar chats tanpa reload
        const updatedChats = chatsRef.current.map((c) =>
          c.customerId === customerId
            ? { ...c, kelurahan: d.kelurahan ?? c.kelurahan, kecamatan: d.kecamatan ?? c.kecamatan, kota: d.kota ?? c.kota, distanceKm: d.distanceKm, ongkir: d.ongkir }
            : c
        );
        setChats(updatedChats);
        chatsRef.current = updatedChats;
        toast(res.message || `Lokasi diperbarui: ${d.sourceLabel} — ${d.distanceKm.toFixed(2)} km, Rp ${d.ongkir.toLocaleString('id-ID')}`, 'success');
      } else {
        toast(res?.error || 'Gagal refresh lokasi', 'error');
      }
    } catch (err: any) {
      toast(err?.message || 'Gagal refresh lokasi', 'error');
    } finally {
      setRefreshingLocation(false);
    }
  };

  const handleOpenReservationDetail = async (reservationId: string) => {
    try {
      const res = await apiRequest(`/api/admin/reservation/${reservationId}`);
      const data = res?.data || res;
      if (data) {
        setSelectedReservation(data);
        // load staff list jika belum
        if (reservationStaffList.length === 0) {
          try {
            const staffRes = await apiRequest('/api/admin/staff');
            if (staffRes?.success && Array.isArray(staffRes.data)) setReservationStaffList(staffRes.data);
            else if (Array.isArray(staffRes)) setReservationStaffList(staffRes);
          } catch {}
        }
      }
    } catch (err: any) {
      toast(`Gagal memuat detail reservasi: ${err.message}`, 'error');
    }
  };

  const handleReservationUpdate = async (deletedReservationId?: string) => {
    const cid = customerDetailData?.id || selectedChat?.customerId;
    if (cid) {
      try {
        const res = await apiRequest(`/api/admin/customers/${cid}`);
        const reservations = res?.data?.reservations || [];
        const isHoldValidLocal = (r: any) => {
          if (!r || r.status !== 'hold') return false;
          if (!r.booking_date) return false;
          const bd = new Date(r.booking_date).getTime();
          if (isNaN(bd) || bd < Date.now() - 2 * 60 * 60 * 1000) return false;
          return true;
        };
        const activeHold = reservations.find((r: any) => isHoldValidLocal(r)) || null;
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const activeConfirmed = reservations.find((r: any) => {
          if (!r || (r.status !== 'confirmed' && r.status !== 'en_route') || !r.booking_date) return false;
          const bd = new Date(r.booking_date).getTime();
          return !isNaN(bd) && bd >= startOfToday.getTime();
        }) || null;
        const activePending = reservations.find((r: any) => r.status === 'pending') || null;
        const hasActiveHold = Boolean(activeHold);
        const hasUpcomingBooking = Boolean(activeConfirmed);
        const hasPendingBooking = Boolean(activePending);
        setCustomerDetailData((prev: any) => ({ ...prev, ...res.data, reservations }));
        if (selectedChat) {
          setChats((prev) => {
            const updated = prev.map((c) => {
              if (c.conversationId !== selectedChat?.conversationId) return c;
              return {
                ...c,
                hasUpcomingBooking,
                hasPendingBooking,
                hasActiveHold,
                activeHoldReservation: activeHold ? { ...activeHold } : null,
                activeConfirmedReservation: activeConfirmed ? { ...activeConfirmed } : null,
                activePendingReservation: activePending ? { ...activePending } : null,
                purchaseCount: reservations.length,
              };
            });
            chatsRef.current = updated;
            return updated;
          });
        }
      } catch {}
    }
    if (deletedReservationId) {
      setSelectedReservation(null);
      return;
    }
    if (selectedReservation?.id) {
      try {
        const res = await apiRequest(`/api/admin/reservation/${selectedReservation.id}`);
        const data = res?.data || res;
        if (data) setSelectedReservation(data);
      } catch {}
    }
  };

  reservationRefreshRef.current = handleReservationUpdate;

  const handleSlotHold = async (date: string, time: string) => {
    setQuickHoldInitialDate(date || null);
    setQuickHoldInitialTime(time);
    await handleOpenQuickHold();
  };

  const handleConvertHoldToBooking = (holdRes: any) => {
    // WIB, bukan zona lokal browser — admin di luar WIB tetap melihat jam/tanggal operasional klinik.
    const { hours, timeFormatted } = getWibHoursAndMinutes(holdRes.booking_date);
    setConvertingHoldId(holdRes.id);
    setActiveEditingHoldReservation(holdRes);
    setQuickBookingTargetSlot({
      date: getWibDateKey(holdRes.booking_date),
      hour: hours,
      timeStr: timeFormatted,
      staffId: holdRes.assigned_staff_id,
    });
    setShowQuickBookingModal(true);
  };

  const isHoldValid = (r: any) => {
    if (!r || r.status !== 'hold') return false;
    if (!r.booking_date) return false;
    const bd = new Date(r.booking_date).getTime();
    if (isNaN(bd) || bd < Date.now() - 2 * 60 * 60 * 1000) return false;
    return true;
  };

  const activeHoldReservation = useMemo(() => {
    if (!selectedChat) return null;
    if (customerDetailData && customerDetailData.id === selectedChat.customerId) {
      return customerDetailData.reservations?.find((r: any) => isHoldValid(r)) || null;
    }
    const fromChat = (selectedChat as any).activeHoldReservation;
    if (fromChat && isHoldValid(fromChat)) return fromChat;
    return null;
  }, [selectedChat, customerDetailData]);

  const activeConfirmedReservation = useMemo(() => {
    if (!selectedChat) return null;
    const isUpcomingConfirmed = (r: any) => {
      if (!r || (r.status !== 'confirmed' && r.status !== 'en_route') || !r.booking_date) return false;
      const bd = new Date(r.booking_date).getTime();
      if (isNaN(bd)) return false;
      // Jadwal aktif = hari ini atau ke depan (selaras endpoint active-reservations).
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      return bd >= startOfToday.getTime();
    };
    if (customerDetailData && customerDetailData.id === selectedChat.customerId) {
      return customerDetailData.reservations?.find((r: any) => isUpcomingConfirmed(r)) || null;
    }
    const fromChat = (selectedChat as any).activeConfirmedReservation;
    if (fromChat && isUpcomingConfirmed(fromChat)) return fromChat;
    return null;
  }, [selectedChat, customerDetailData]);

  const activePendingReservation = useMemo(() => {
    if (!selectedChat) return null;
    if (customerDetailData && customerDetailData.id === selectedChat.customerId) {
      return customerDetailData.reservations?.find((r: any) => r.status === 'pending') || null;
    }
    const fromChat = (selectedChat as any).activePendingReservation;
    if (fromChat) return fromChat;
    return null;
  }, [selectedChat, customerDetailData]);

  const handleOpenQuickReservation = async () => {
    if (!selectedChat) {
      toast('Pilih percakapan customer terlebih dahulu.', 'info');
      return;
    }
    // Jika chat ini sedang memiliki slot hold aktif, langsung arahkan untuk melengkapi hold tersebut
    if (activeHoldReservation) {
      handleConvertHoldToBooking(activeHoldReservation);
      return;
    }
    if (reservationStaffList.length === 0) {
      try {
        const staffRes = await apiRequest('/api/admin/staff');
        if (staffRes?.success && Array.isArray(staffRes.data)) setReservationStaffList(staffRes.data);
        else if (Array.isArray(staffRes)) setReservationStaffList(staffRes);
      } catch {}
    }
    // Pastikan customer detail terbaru termuat
    if (selectedChat.customerId && (!customerDetailData || customerDetailData.id !== selectedChat.customerId)) {
      try {
        const res = await apiRequest(`/api/admin/customers/${selectedChat.customerId}`);
        if (res?.data) setCustomerDetailData(res.data);
      } catch {}
    }
    // Fase 2R: Pre-fill cerdas tanggal & jam dari chat (data-driven, tanpa hardcode jam)
    try {
      let currentServices = clinicServices;
      if (currentServices.length === 0) {
        try {
          const sRes: any = await apiRequest('/api/admin/services');
          if (sRes?.data && Array.isArray(sRes.data)) {
            currentServices = sRes.data;
            setClinicServices(sRes.data);
          } else if (Array.isArray(sRes)) {
            currentServices = sRes;
            setClinicServices(sRes);
          }
        } catch {}
      }
      let wilayahRef: WilayahReference | null = null;
      try { wilayahRef = await getWilayahRef(); } catch {}
      const custData = customerDetailData || (selectedChat ? {
        id: (selectedChat as any).customerId,
        name: (selectedChat as any).customerName,
        phone: (selectedChat as any).customerPhone,
      } : null);
      const extracted = extractScheduleFromMessages(messages, custData as any, currentServices as any, wilayahRef);
      setQuickBookingExtracted(extracted || null);
      if (extracted?.bookingDate && extracted?.timeDisplay) {
        // Normalisasi "13.00-14.30" / "13.00" -> "13:00"
        const rawTime = String(extracted.timeDisplay).split('-')[0].trim().split('–')[0].trim();
        const normalized = rawTime.replace('.', ':');
        const timeHHMM = /^\d{1,2}[:.]\d{2}$/.test(normalized) ? normalized.padStart(5, '0').replace('.', ':') : normalized;
        const [hhStr] = timeHHMM.split(':');
        const hh = parseInt(hhStr, 10);
        if (!isNaN(hh) && extracted.bookingDate) {
          // Tanggal dalam WIB (bukan zona lokal browser) agar konsisten operasional klinik.
          const cleanHHMM = /^\d{2}:\d{2}$/.test(timeHHMM) ? timeHHMM : `${String(hh).padStart(2, '0')}:00`;
          setQuickBookingTargetSlot({
            date: getWibDateKey(extracted.bookingDate),
            hour: hh,
            timeStr: cleanHHMM,
            staffId: '',
          });
        } else {
          setQuickBookingTargetSlot(null);
        }
      } else {
        setQuickBookingTargetSlot(null);
      }
    } catch {
      setQuickBookingTargetSlot(null);
    }
    setShowQuickBookingModal(true);
    pushModalHistory('quick-booking');
  };

  const handleOpenQuickHold = async () => {
    if (!selectedChat) {
      toast('Pilih percakapan customer terlebih dahulu.', 'info');
      return;
    }
    if (reservationStaffList.length === 0) {
      try {
        const staffRes = await apiRequest('/api/admin/staff');
        if (staffRes?.success && Array.isArray(staffRes.data)) setReservationStaffList(staffRes.data);
        else if (Array.isArray(staffRes)) setReservationStaffList(staffRes);
      } catch {}
    }
    // Pastikan customer detail terbaru termuat
    if (selectedChat.customerId && (!customerDetailData || customerDetailData.id !== selectedChat.customerId)) {
      try {
        const res = await apiRequest(`/api/admin/customers/${selectedChat.customerId}`);
        if (res?.data) setCustomerDetailData(res.data);
      } catch {}
    }
    setQuickHoldInitialDate(null);
    setQuickHoldInitialTime(null);
    setShowQuickHoldModal(true);
  };

  const handleConfirmPendingBooking = async (pendingRes: any) => {
    const dateStr = pendingRes.booking_date
      ? new Date(pendingRes.booking_date).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' })
      : 'jadwal terpilih';
    const ok = await confirm({
      title: 'Konfirmasi Jadwal?',
      message: `Konfirmasi reservasi untuk ${pendingRes.customer?.name || selectedChat?.customerName || 'Bunda'} pada ${dateStr} (${pendingRes.treatment_detail || 'Treatment'}) menjadi Terjadwal?`,
      confirmText: 'Ya, Konfirmasi Jadwal',
      cancelText: 'Batal',
    });
    if (!ok) return;
    try {
      await apiRequest(`/api/admin/reservation/${pendingRes.id}/confirm`, { method: 'PATCH' });
      toast('Reservasi berhasil dikonfirmasi dan disinkronkan ke Google Calendar! ✨', 'success');
      await handleReservationUpdate();
    } catch (err: any) {
      toast(`Gagal konfirmasi: ${err.message}`, 'error');
    }
  };

  // Reservasi aktif yang sedang berjalan untuk chat terpilih (confirmed / pending / hold)
  const currentActiveReservation = useMemo(() => {
    return activeConfirmedReservation || activePendingReservation || activeHoldReservation || null;
  }, [activeConfirmedReservation, activePendingReservation, activeHoldReservation]);

  // Reservasi aktif terpilih (prioritas: OTW aktif > confirmed > hold > pending).
  const dispatchReservationId = useMemo<string | null>(() => {
    const fromChat = [
      (selectedChat as any)?.activeConfirmedReservation,
      (selectedChat as any)?.activeHoldReservation,
      (selectedChat as any)?.activePendingReservation,
    ].find((r: any) => r?.otw_sent_at && !r?.arrived_at);
    if (fromChat?.id) return fromChat.id;
    const fromDetail = (customerDetailData?.reservations || []).find(
      (r: any) => r.otw_sent_at && !r.arrived_at && !['completed', 'cancelled', 'rejected'].includes(String(r.status))
    );
    if (fromDetail?.id) return fromDetail.id;
    if (selectedReservation?.reservationId && selectedReservation?.otwSentAt && !selectedReservation?.arrivedAt) {
      return selectedReservation.reservationId;
    }
    return (
      activeConfirmedReservation?.id ||
      activeHoldReservation?.id ||
      activePendingReservation?.id ||
      null
    );
  }, [selectedChat, customerDetailData, selectedReservation, activeConfirmedReservation, activeHoldReservation, activePendingReservation]);

  dispatchReservationIdRef.current = dispatchReservationId;

  const loadDispatchTrip = useCallback(async (reservationId: string) => {
    setDispatchLoading(true);
    try {
      const res = await apiRequest(`/api/admin/dispatch/trip/${reservationId}`);
      const data = res?.data || res;
      if (dispatchReservationIdRef.current === reservationId) {
        setDispatchTrip(data || null);
      }
    } catch {
      if (dispatchReservationIdRef.current === reservationId) setDispatchTrip(null);
    } finally {
      setDispatchLoading(false);
    }
  }, []);
  loadDispatchTripRef.current = loadDispatchTrip;

  useEffect(() => {
    if (!dispatchReservationId) {
      setDispatchTrip(null);
      return;
    }
    loadDispatchTrip(dispatchReservationId);
  }, [dispatchReservationId, loadDispatchTrip]);

  // Refresh berkala ringan (10s) hanya bila OTW aktif — jaring bila SSE terputus.
  useEffect(() => {
    if ((!dispatchTrip?.otwSentAt && !dispatchTrip?.trip) || dispatchTrip?.arrivedAt) return;
    const id = dispatchReservationIdRef.current;
    if (!id) return;
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        loadDispatchTrip(id);
      }
    }, 10_000);
    return () => clearInterval(t);
  }, [dispatchTrip?.otwSentAt, dispatchTrip?.trip, dispatchTrip?.arrivedAt, loadDispatchTrip]);

  // Smart Micro-Pill: reset tiap ganti chat/reservasi; auto-collapse 3 detik khusus mobile
  useEffect(() => {
    setIsBannerCollapsed(false);
    setUserManuallyExpanded(false);
    manualExpandRef.current = false;
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      const t = setTimeout(() => {
        if (!manualExpandRef.current) setIsBannerCollapsed(true);
      }, 3000);
      return () => clearTimeout(t);
    }
  }, [selectedChat?.conversationId, activeHoldReservation?.id, activeConfirmedReservation?.id, activePendingReservation?.id]);

  const expandBanner = () => {
    setIsBannerCollapsed(false);
    setUserManuallyExpanded(true);
    manualExpandRef.current = true;
  };

  // Provenance akurasi lokasi dari data customer-detail via shared geoUtils (Mikro 3.2, D-1a)
  const dispatchLocationSource =
    resolveEffectiveLocationSource(customerDetailData) ||
    resolveEffectiveLocationSource(activeConfirmedReservation) ||
    resolveEffectiveLocationSource(activeHoldReservation) ||
    resolveEffectiveLocationSource(selectedChat?.locationSource) ||
    null;

  return {
    customerDetailModalOpen,
    setCustomerDetailModalOpen,
    customerDetailEditMode,
    setCustomerDetailEditMode,
    customerDetailLoading,
    setCustomerDetailLoading,
    customerDetailData,
    setCustomerDetailData,
    addrBookCustomer,
    setAddrBookCustomer,
    savedAddressCount,
    setSavedAddressCount,
    refreshingLocation,
    handleRefreshLocation,
    selectedReservation,
    setSelectedReservation,
    proofModalReservation,
    setProofModalReservation,
    reservationRefreshRef,
    lastReservationRefreshTimeRef,
    dispatchTrip,
    setDispatchTrip,
    dispatchLoading,
    dispatchDrawerOpen,
    setDispatchDrawerOpen,
    loadDispatchTripRef,
    dispatchReservationIdRef,
    dispatchOriginRef,
    reservationStaffList,
    setReservationStaffList,
    showQuickBookingModal,
    setShowQuickBookingModal,
    showQuickHoldModal,
    setShowQuickHoldModal,
    quickHoldInitialDate,
    setQuickHoldInitialDate,
    quickHoldInitialTime,
    setQuickHoldInitialTime,
    convertingHoldId,
    setConvertingHoldId,
    activeEditingHoldReservation,
    setActiveEditingHoldReservation,
    activeEditingConfirmedReservation,
    setActiveEditingConfirmedReservation,
    isBannerCollapsed,
    setIsBannerCollapsed,
    userManuallyExpanded,
    setUserManuallyExpanded,
    manualExpandRef,
    expandBanner,
    quickBookingTargetSlot,
    setQuickBookingTargetSlot,
    quickBookingExtracted,
    setQuickBookingExtracted,
    dismissedFormBanner,
    setDismissedFormBanner,
    showDailyScheduleModal,
    setShowDailyScheduleModal,
    showInvoiceModal,
    setShowInvoiceModal,
    invoiceModalData,
    setInvoiceModalData,
    clinicServices,
    setClinicServices,
    pushModalHistory,
    handleOpenCustomerDetail,
    handleSaveCustomerDetail,
    handleOpenReservationDetail,
    handleReservationUpdate,
    handleOpenQuickReservation,
    handleOpenQuickHold,
    handleSlotHold,
    handleConvertHoldToBooking,
    handleConfirmPendingBooking,
    activeHoldReservation,
    activeConfirmedReservation,
    activePendingReservation,
    currentActiveReservation,
    dispatchReservationId,
    loadDispatchTrip,
    dispatchLocationSource,
  };
}
