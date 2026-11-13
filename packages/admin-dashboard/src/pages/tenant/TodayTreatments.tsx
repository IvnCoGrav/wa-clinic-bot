import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest, getCachedApiResponse } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useUiFeedback } from '../../components/common/UiFeedback';
import {
  Calendar,
  Clock,
  MapPin,
  Baby,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  Send,
  Navigation2,
  Camera,
  Crosshair,
  User,
  X,
  MessageSquare,
  Users,
  CheckCheck,
  Image as ImageIcon,
  Maximize2,
  BarChart3,
  Timer,
  ChevronDown,
  ChevronUp,
  Info,
  Phone,
  CalendarDays,
  ArrowRight,
  Link2,
  ExternalLink,
  Edit3,
  ArrowLeft,
  Pencil,
  Loader,
} from 'lucide-react';
import { extractLatLngFromMapsUrl, getCurrentDeviceLocation, geocodeAddressWithNominatim, getGoogleMapsDirectionUrl } from '../../utils/geoUtils';
import { useMapsShortlinkResolver } from '../../hooks/useMapsShortlinkResolver';
import { compressImageFile, compressDataUrl, resolveCompressProfile } from '../../utils/imageCompressor';
import { stampGpsWatermark } from '../../utils/imageWatermark';
import {
} from '../../utils/durationCalculator';
import { isEnRouteStatus } from '../../utils/reservationStatus';
import { FleetMapModal, type FleetMapTask } from '../../components/maps/FleetMapModal';
import { getTodayWibDateKey } from '../../utils/dateWib';
import { needsHousePhoto, resolveLocModalMode } from '../staff/housePhotoGuard';
import { StatusChip } from '../../components/ui/StatusChip';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/StateViews';
import { TreatmentTask, DateMeta } from './todayTreatmentsTypes';
import { formatTime, getCategoryIcon } from './todayTreatmentsLogic';
import { TodayTreatmentCard } from './TodayTreatmentCard';
import { TodayTreatmentDetailModal } from './TodayTreatmentDetailModal';
import { TodayMetricsModal } from './TodayMetricsModal';
import { ReassignStaffModal } from './ReassignStaffModal';
import { TodayPaymentModal } from './TodayPaymentModal';
import { TodayLocationModal } from './TodayLocationModal';
import { TodayQuickChatModal } from './TodayQuickChatModal';
import { ImageZoomModal } from '../../components/common/ImageZoomModal';

export const TodayTreatments: React.FC = () => {
  const { user } = useAuth();
  const { toast, confirm } = useUiFeedback();

  // Date selection states: 'today' | 'tomorrow' | 'custom'
  const [dateTab, setDateTab] = useState<'today' | 'tomorrow' | 'custom'>('today');
  const [customDate, setCustomDate] = useState<string>(() => getTodayWibDateKey());
  const [dateMeta, setDateMeta] = useState<DateMeta | null>(null);

  const cachedTasksRes = getCachedApiResponse<any>('/api/staff/today-tasks?scope=all') || getCachedApiResponse<any>('/api/staff/today-tasks?scope=mine');
  const [loading, setLoading] = useState(!cachedTasksRes?.data);
  const [tasks, setTasks] = useState<TreatmentTask[]>(() => Array.isArray(cachedTasksRes?.data) ? cachedTasksRes.data : []);
  const tasksCountRef = useRef(tasks.length);
  tasksCountRef.current = tasks.length;
  
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'UPCOMING' | 'COMPLETED' | 'OTW' | 'ALL'>('UPCOMING');
  const [scopeFilter, setScopeFilter] = useState<string>('all');
  const [isSupervisor, setIsSupervisor] = useState(false);

  // Modals
  const [showMetricsModal, setShowMetricsModal] = useState(false);
  const [showFleetMap, setShowFleetMap] = useState(false);
  const [detailModalTask, setDetailModalTask] = useState<TreatmentTask | null>(null);

  // Delegation / Reassign Modal
  const [teamMembers, setTeamMembers] = useState<{ id: string; name: string; role?: string }[]>([]);
  const [reassignTask, setReassignTask] = useState<TreatmentTask | null>(null);
  const [reassignStaffId, setReassignStaffId] = useState<string>('');
  const [submittingReassign, setSubmittingReassign] = useState(false);

  // Payment Recording Modal
  const [paymentTask, setPaymentTask] = useState<TreatmentTask | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'TRANSFER' | 'QRIS'>('CASH');
  const [proofImageB64, setProofImageB64] = useState<string | null>(null);
  const [submittingPayment, setSubmittingPayment] = useState(false);

  // Location & House Photo Modal
  const [locationTask, setLocationTask] = useState<TreatmentTask | null>(null);
  const [locModalMode, setLocModalMode] = useState<'view' | 'edit'>('view');
  const [hasSavedLocData, setHasSavedLocData] = useState(false);
  const [locLandmark, setLocLandmark] = useState('');
  const [locCoords, setLocCoords] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [locHousePhotoB64, setLocHousePhotoB64] = useState<string | null>(null);
  const [locRawHousePhotoB64, setLocRawHousePhotoB64] = useState<string | null>(null);
  const [locGettingGps, setLocGettingGps] = useState(false);
  const [locGpsError, setLocGpsError] = useState<string | null>(null);
  const [locSaving, setLocSaving] = useState(false);
  const [locMapsUrlInput, setLocMapsUrlInput] = useState('');
  const { resolve: resolveLocMapsUrl, isResolving: locMapsResolving } = useMapsShortlinkResolver();
  const [locGeocoding, setLocGeocoding] = useState(false);
  const [locShowManualCoords, setLocShowManualCoords] = useState(false);
  const [locProcessingPhoto, setLocProcessingPhoto] = useState(false);
  const locHouseCameraInputRef = useRef<HTMLInputElement>(null);
  const locHouseGalleryInputRef = useRef<HTMLInputElement>(null);

  // Zoom Image Modal
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);

  // Sending OTW Status
  const [sendingOtwId, setSendingOtwId] = useState<string | null>(null);

  // Quick Chat Modal
  const [chatModalTask, setChatModalTask] = useState<TreatmentTask | null>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const [selectedChatImage, setSelectedChatImage] = useState<{ file: File; preview: string } | null>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const chatMessagesEndRef = useRef<HTMLDivElement>(null);

  const scrollChatToBottom = useCallback((smooth = false) => {
    const doScroll = () => {
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight + 99999;
      }
      if (chatMessagesEndRef.current) {
        chatMessagesEndRef.current.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' });
      }
    };
    doScroll();
    requestAnimationFrame(doScroll);
    setTimeout(doScroll, 30);
    setTimeout(doScroll, 100);
    setTimeout(doScroll, 250);
  }, []);

  useEffect(() => {
    if (chatModalTask && chatMessages.length > 0 && !loadingChat) {
      scrollChatToBottom(false);
    }
  }, [chatModalTask, chatMessages, loadingChat, scrollChatToBottom]);

  // Escape key handler for active modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (zoomImageUrl) setZoomImageUrl(null);
        else if (detailModalTask) setDetailModalTask(null);
        else if (showMetricsModal) setShowMetricsModal(false);
        else if (reassignTask) setReassignTask(null);
        else if (paymentTask) setPaymentTask(null);
        else if (locationTask) setLocationTask(null);
        else if (chatModalTask) setChatModalTask(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomImageUrl, detailModalTask, showMetricsModal, reassignTask, paymentTask, locationTask, chatModalTask]);

  // OTW Safety Gate: Kirim OTW hanya aktif pada hari-H dan maksimal 2 jam sebelum jam kunjungan
  const isOtwAllowed = (task: TreatmentTask) => {
    if (dateTab !== 'today') return false;
    if (!task.bookingDate) return true;
    return Date.now() >= new Date(task.bookingDate).getTime() - 2 * 60 * 60 * 1000;
  };

  const fetchTasks = useCallback(async (isPolling = false) => {
    if (!isPolling && tasksCountRef.current === 0) setLoading(true);
    try {
      const apiScope = scopeFilter.startsWith('staff:') ? 'all' : scopeFilter;
      const apiDate = dateTab === 'custom' ? customDate : dateTab;
      const res = await apiRequest(`/api/staff/today-tasks?scope=${apiScope}&date=${apiDate}`);
      if (res.success && Array.isArray(res.data)) {
        setTasks(res.data);
        if (res.isSupervisor !== undefined) {
          const supervisorBool = Boolean(res.isSupervisor);
          setIsSupervisor(supervisorBool);
          if (!supervisorBool && scopeFilter === 'all') {
            setScopeFilter('mine');
          }
        }
        if (res.meta) {
          setDateMeta(res.meta);
        }
      }
    } catch (err: any) {
      if (!isPolling && tasksCountRef.current === 0) toast(err.message || 'Gagal memuat tugas treatment.', 'error');
    } finally {
      setLoading(false);
    }
  }, [scopeFilter, dateTab, customDate, toast]);

  const fetchTeamMembers = useCallback(async () => {
    try {
      const res = await apiRequest('/api/staff/team-members');
      if (res.success && Array.isArray(res.data)) {
        setTeamMembers(res.data);
      }
    } catch (_) {
      // Daftar tim hanya untuk filter; daftar treatment tetap tampil.
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    fetchTeamMembers();

    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      fetchTasks(true);
    }, 15000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchTasks(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchTasks, fetchTeamMembers]);



  const isDbCompleted = (t: TreatmentTask) => {
    return t.status.toLowerCase() === 'completed';
  };

  // Filtered Tasks
  const filteredTasks = tasks.filter((t) => {
    if (scopeFilter.startsWith('staff:')) {
      const targetStaffId = scopeFilter.replace('staff:', '');
      if (t.assignedStaff?.id !== targetStaffId) return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = (t.customerName || '').toLowerCase().includes(q);
      const matchTreat = (t.treatmentDetail || '').toLowerCase().includes(q);
      const matchAddr = (t.address.fullText || '').toLowerCase().includes(q);
      const matchStaff = (t.assignedStaff?.name || '').toLowerCase().includes(q);
      if (!matchName && !matchTreat && !matchAddr && !matchStaff) return false;
    }

    if (statusFilter === 'UPCOMING') {
      // Seluruh jadwal hari ini yang belum selesai (termasuk yang sedang berjalan/jam terlewat)
      return t.status.toLowerCase() !== 'completed';
    }
    if (statusFilter === 'COMPLETED') {
      // Hanya jadwal yang berstatus DB 'completed'
      return isDbCompleted(t);
    }
    if (statusFilter === 'OTW') {
      return isEnRouteStatus(t.status);
    }

    return true;
  });

  // Summary Metrics
  const totalCount = tasks.length;
  // Fase 4 (plan 2026-10-02): data peta sebaran — seluruh jadwal pada tanggal aktif.
  const fleetTasks: FleetMapTask[] = tasks.map((t) => ({
    reservationId: t.reservationId,
    customerName: t.customerName,
    staffName: t.assignedStaff?.name || null,
    timeLabel: t.bookingDate ? new Date(t.bookingDate).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) : null,
    status: t.status,
    lat: t.address?.lat ?? null,
    lng: t.address?.lng ?? null,
  }));  const upcomingCount = tasks.filter((t) => t.status.toLowerCase() !== 'completed').length;
  const completedCount = tasks.filter((t) => t.status.toLowerCase() === 'completed').length;
  const otwCount = tasks.filter((t) => isEnRouteStatus(t.status)).length;
  const lunasCount = tasks.filter((t) => t.pricing.paymentStatus === 'LUNAS').length;
  const totalRevenue = tasks.reduce((sum, t) => sum + (t.pricing.totalFee || 0), 0);

  // Handle Send OTW
  const handleSendOtw = async (task: TreatmentTask) => {
    if (dateTab !== 'today') {
      toast('Notifikasi OTW hanya dapat dikirim pada hari-H kunjungan.', 'info');
      return;
    }

    const ok = await confirm({
      title: 'Kirim Notifikasi OTW?',
      message: `Kirim pesan WhatsApp otomatis ke ${task.customerName || 'pasien'} bahwa terapis sedang meluncur ke lokasi?`,
      confirmText: 'Ya, Kirim OTW',
    });
    if (!ok) return;

    setSendingOtwId(task.reservationId);
    try {
      const res = await apiRequest(`/api/staff/reservations/${task.reservationId}/otw`, { method: 'POST' });
      if (res.success) {
        if (res?.data?.alreadySent) {
          toast('Info OTW sudah pernah dikirim sebelumnya: tidak dikirim ulang.', 'info');
        } else {
          toast('Notifikasi OTW berhasil dikirim ke WhatsApp pasien!', 'success');
        }
        fetchTasks(true);
      }
    } catch (err: any) {
      toast(err.message || 'Gagal mengirim notifikasi OTW.', 'error');
    } finally {
      setSendingOtwId(null);
    }
  };

  // Handle Reassign
  const handleOpenReassign = (task: TreatmentTask) => {
    setReassignTask(task);
    setReassignStaffId(task.assignedStaff?.id || '');
  };

  const handleSaveReassign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reassignTask || !reassignStaffId) return;

    setSubmittingReassign(true);
    try {
      const res = await apiRequest(`/api/staff/reservations/${reassignTask.reservationId}/reassign`, {
        method: 'POST',
        body: JSON.stringify({ targetStaffId: reassignStaffId, staffId: reassignStaffId }),
      });
      if (res.success) {
        toast('Jadwal berhasil didelegasikan ke terapis baru.', 'success');
        setReassignTask(null);
        fetchTasks();
      }
    } catch (err: any) {
      toast(err.message || 'Gagal mendelegasikan jadwal.', 'error');
    } finally {
      setSubmittingReassign(false);
    }
  };

  // Handle Payment
  const handleSavePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentTask) return;

    setSubmittingPayment(true);
    try {
      const res = await apiRequest(`/api/staff/reservations/${paymentTask.reservationId}/payment`, {
        method: 'POST',
        body: JSON.stringify({
          paymentMethod,
          proofImageB64: paymentMethod !== 'CASH' ? proofImageB64 : null,
        }),
      });
      if (res.success) {
        toast('Status pembayaran berhasil diperbarui menjadi LUNAS.', 'success');
        setPaymentTask(null);
        setProofImageB64(null);
        fetchTasks();
      }
    } catch (err: any) {
      toast(err.message || 'Gagal menyimpan status lunas.', 'error');
    } finally {
      setSubmittingPayment(false);
    }
  };

  // Handle Location & GPS
  const handleOpenLocationModal = (task: TreatmentTask) => {
    setLocationTask(task);
    setLocLandmark(task.address.landmark || '');
    setLocCoords(task.address.lat && task.address.lng ? { lat: task.address.lat, lng: task.address.lng } : null);
    setLocGpsError(null);
    setLocHousePhotoB64(task.address.housePhotoUrl || null);
    setLocRawHousePhotoB64(null);
    setLocMapsUrlInput('');
    setLocShowManualCoords(false);

    const hasData = Boolean(
      task.address.housePhotoUrl ||
      (task.address.lat && task.address.lng) ||
      task.address.landmark
    );
    setHasSavedLocData(hasData);
    setLocModalMode(resolveLocModalMode(task));
  };

  // Helper untuk membubuhkan watermark GPS & info lokasi ke raw photo
  const applyWatermarkToRaw = async (
    rawB64: string,
    coords: { lat: number; lng: number; accuracy?: number } | null,
    landmark: string,
    taskObj?: TreatmentTask | null
  ) => {
    const currentTask = taskObj || locationTask;
    // Koordinat target: koordinat saat ini -> fallback ke koordinat task di database
    const targetLat = coords?.lat ?? currentTask?.address?.lat ?? null;
    const targetLng = coords?.lng ?? currentTask?.address?.lng ?? null;
    const targetAcc = coords?.accuracy ?? null;

    const currentTakerName = user?.name || user?.email || 'Admin Klinik';
    const watermarked = await stampGpsWatermark(rawB64, {
      lat: targetLat,
      lng: targetLng,
      accuracy: targetAcc,
      kelurahan: currentTask?.address?.kelurahan,
      kecamatan: currentTask?.address?.kecamatan,
      landmark: landmark || currentTask?.address?.landmark || null,
      customerName: currentTask?.customerName || undefined,
    takerName: currentTakerName,
      staffName: currentTakerName,
    });
    // Fase 2.2: stampGpsWatermark q0.85 bisa membengkakkan file → re-kompres ke profil 'house'.
    let finalB64 = watermarked;
    try {
      const hp = resolveCompressProfile('house');
      const rec = await compressDataUrl(watermarked, { maxWidth: hp.maxWidth, maxHeight: hp.maxHeight, quality: hp.quality });
      if (rec) finalB64 = rec;
    } catch {
      /* pakai hasil watermark apa adanya */
    }
    setLocHousePhotoB64(finalB64);
    return finalB64;
  };

  // Kompresi instan di sisi client (<100KB) tanpa lag
  const handleProcessHousePhoto = async (file: File) => {
    setLocProcessingPhoto(true);
    try {
      // 1. Fast Canvas downscaling — profil 'house' seragam (1000px/q0.70)
      const hp = resolveCompressProfile('house');
      const compressed = await compressImageFile(file, { maxWidth: hp.maxWidth, maxHeight: hp.maxHeight, quality: hp.quality });
      setLocRawHousePhotoB64(compressed.dataUrl);
      setLocHousePhotoB64(compressed.dataUrl);
      toast('Foto rumah berhasil dimuat!', 'success');

      // 2. Auto-fetch GPS di background jika koordinat belum terkunci
      if (!locCoords && 'geolocation' in navigator && !locGettingGps) {
        handleGetGps(compressed.dataUrl);
      }
    } catch {
      toast('Gagal memproses foto rumah.', 'error');
    } finally {
      setLocProcessingPhoto(false);
    }
  };

  const handleGetGps = async (overrideRawPhoto?: string) => {
    setLocGettingGps(true);
    setLocGpsError(null);
    try {
      const loc = await getCurrentDeviceLocation(8000);
      const newCoords = {
        lat: loc.lat,
        lng: loc.lng,
        accuracy: loc.accuracy,
      };
      setLocCoords(newCoords);
      toast(`GPS terkunci (Akurasi: ±${loc.accuracy}m)!`, 'success');
    } catch (err: any) {
      setLocGpsError(err.message || 'Gagal membaca GPS.');
      toast(err.message || 'Gagal membaca GPS.', 'error');
    } finally {
      setLocGettingGps(false);
    }
  };

  // Smart Maps URL Parser
  const handlePasteLocMapsUrl = async (rawUrl: string) => {
    setLocMapsUrlInput(rawUrl);
    if (!rawUrl.trim()) return;

    const extracted = await resolveLocMapsUrl(rawUrl);
    if (extracted) {
      setLocCoords({ lat: extracted.lat, lng: extracted.lng });
    }
  };

  // Geocoding dari Kelurahan & Kecamatan
  const handleGeocodeLocAddress = async () => {
    if (!locationTask) return;
    const { kelurahan, kecamatan, kota } = locationTask.address;
    if (!kelurahan && !kecamatan) {
      toast('Nama kelurahan/kecamatan belum terisi untuk geocoding.', 'error');
      return;
    }

    setLocGeocoding(true);
    try {
      const query = [kelurahan, kecamatan, kota || 'Surabaya', 'Indonesia'].filter(Boolean).join(', ');
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
      const data = await res.json();
      if (data && data.length > 0) {
        const foundLat = parseFloat(data[0].lat);
        const foundLng = parseFloat(data[0].lon);
        setLocCoords({ lat: foundLat, lng: foundLng });
        toast(`Titik area ${kelurahan || kecamatan} ditemukan!`, 'success');
      } else {
        toast('Alamat area tidak ditemukan di peta. Gunakan Kunci GPS atau tempel Link Maps.', 'error');
      }
    } catch {
      toast('Gagal melakukan pencarian peta alamat.', 'error');
    } finally {
      setLocGeocoding(false);
    }
  };

  // Simpan Lokasi Instan (Optimistic UI - 0 Detik Loading)
  const handleSaveLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!locationTask) return;
    const hasPhotoForGuard = !!(locRawHousePhotoB64 || (locHousePhotoB64 && locHousePhotoB64.startsWith('data:image/')));
    if (hasPhotoForGuard && !locCoords) {
      toast('Kunci titik GPS dulu sebelum menyimpan foto rumah.', 'error');
      return;
    }

    // Konfirmasi sebelum menimpa data lokasi/foto yang sudah ada sebelumnya
    if (hasSavedLocData) {
      const ok = await confirm({
        title: 'Konfirmasi Timpa Data Lokasi',
        message: `Data panduan rumah dan koordinat GPS untuk ${locationTask.customerName || 'pasien'} sudah tersimpan sebelumnya.\n\nApakah Anda yakin ingin menimpa dengan data foto & koordinat yang baru?`,
        confirmText: 'Ya, Timpa Data',
        cancelText: 'Batal',
        danger: false,
      });
      if (!ok) return;
    }

    const targetResId = locationTask.reservationId;
    const photoPayload = locRawHousePhotoB64 || (locHousePhotoB64 && locHousePhotoB64.startsWith('data:image/') ? locHousePhotoB64 : undefined);
    const newLandmark = locLandmark || locationTask.address.landmark;
    const newLat = locCoords?.lat ?? locationTask.address.lat;
    const newLng = locCoords?.lng ?? locationTask.address.lng;
    const newMapsUrl = newLat && newLng ? `https://maps.google.com/?q=${newLat},${newLng}` : null;
    const newNavUrl =
      newLat && newLng
        ? `https://www.google.com/maps/dir/?api=1&destination=${newLat},${newLng}&travelmode=two-wheeler`
        : null;

    // 1. UPDATE STATE SECARA INSTAN (0s Perceived Loading)
    setTasks((prev) =>
      prev.map((t) =>
        t.reservationId === targetResId
          ? {
              ...t,
              mapsUrl: newMapsUrl,
              navigationUrl: newNavUrl,
              address: {
                ...t.address,
                lat: newLat,
                lng: newLng,
                housePhotoUrl: photoPayload || t.address.housePhotoUrl,
                landmark: newLandmark,
              },
            }
          : t
      )
    );

    // Langsung tutup modal & tampilkan feedback sukses instan
    setLocationTask(null);
    setLocRawHousePhotoB64(null);
    toast('Lokasi & panduan berhasil disimpan!', 'success');

    // 2. SINKRONISASI SERVER DI BACKGROUND
    try {
      const res = await apiRequest('/api/staff/update-location', {
        method: 'POST',
        body: JSON.stringify({
          reservationId: targetResId,
          landmark: locLandmark || null,
          lat: locCoords?.lat || null,
          lng: locCoords?.lng || null,
          accuracyM: locCoords?.accuracy || null,
          housePhotoB64: photoPayload,
        }),
      });

      if (res && res.success && res.data?.housePhotoUrl) {
        // Update URL foto resmi dari server yang sudah ber-watermark permanen
        setTasks((prev) =>
          prev.map((t) =>
            t.reservationId === targetResId
              ? {
                  ...t,
                  address: {
                    ...t.address,
                    housePhotoUrl: res.data.housePhotoUrl,
                    distanceKm: res.data.distanceKm ?? t.address.distanceKm,
                    estimatedMinutes: res.data.estimatedMinutes ?? t.address.estimatedMinutes,
                  },
                }
              : t
          )
        );
      }
      if (res && res.data?.coordsUpdated === false) {
        toast('Catatan lokasi tersimpan (tanpa perubahan titik GPS): foto tersimpan tapi koordinat tidak diperbarui.', 'error');
      }
    } catch (err: any) {
      console.warn('[TODAY] Background sync location error:', err?.message || err);
    }
  };

  // Handle Chat Modal
  const handleOpenChat = async (task: TreatmentTask) => {
    setChatModalTask(task);
    setReplyText('');
    setSelectedChatImage(null);
    if (!task.conversationId) {
      setChatMessages([]);
      return;
    }

    setLoadingChat(true);
    try {
      const res = await apiRequest(`/api/staff/conversations/${task.conversationId}/messages`);
      if (res.success && Array.isArray(res.data)) {
        setChatMessages(res.data);
      }
    } catch (err: any) {
      toast(err.message || 'Gagal memuat pesan chat.', 'error');
    } finally {
      setLoadingChat(false);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatModalTask?.conversationId || (!replyText.trim() && !selectedChatImage)) return;

    setSendingChat(true);
    try {
      let imageBase64: string | undefined;
      if (selectedChatImage) {
        imageBase64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(selectedChatImage.file);
        });
      }

      const res = await apiRequest(`/api/staff/conversations/${chatModalTask.conversationId}/reply`, {
        method: 'POST',
        body: JSON.stringify({
          message: replyText.trim(),
          imageBase64,
        }),
      });

      if (res.success) {
        setReplyText('');
        setSelectedChatImage(null);
        toast('Pesan berhasil terkirim ke WhatsApp pasien.', 'success');
        const updated = await apiRequest(`/api/staff/conversations/${chatModalTask.conversationId}/messages`);
        if (updated.success && Array.isArray(updated.data)) {
          setChatMessages(updated.data);
        }
      }
    } catch (err: any) {
      toast(err.message || 'Gagal mengirim pesan chat.', 'error');
    } finally {
      setSendingChat(false);
    }
  };

  // Effective display date string
  const displayDateText = dateMeta?.formattedDate || (dateTab === 'today' ? 'Hari Ini' : dateTab === 'tomorrow' ? 'Besok' : customDate);

  return (
    <div className="space-y-5 animate-fadeIn pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-divider">
        <div className="flex items-center space-x-3.5">
          <div className="h-12 w-12 rounded-2xl bg-accent text-accent-ink flex items-center justify-center shadow-sm shrink-0">
            <CalendarDays size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-black text-ink tracking-tight">
                {dateTab === 'today' ? 'Treatment Hari Ini' : dateTab === 'tomorrow' ? 'Treatment Besok' : 'Jadwal Treatment'}
              </h1>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold border ${
                dateTab === 'tomorrow'
                  ? 'bg-violet-soft text-violet border-violet-line'
                  : 'bg-accent-soft text-accent border-divider'
              }`}>
                {filteredTasks.length} Jadwal
              </span>
            </div>
            <p className="text-xs text-ink-2 mt-1 flex items-center gap-1.5 font-medium">
              <Calendar size={13} className="text-accent shrink-0" />
              <span className="font-semibold text-ink">{displayDateText}</span>
              {dateTab === 'tomorrow' && (
                <span className="text-[11px] px-1.5 py-0.2 rounded bg-violet-soft text-violet font-bold ml-1">
                  Besok
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Date Segmented Tabs & Scope Select */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Segmented Date Control */}
          <div className="inline-flex p-1 rounded-2xl bg-fill-1 dark:bg-surface border border-divider shadow-2xs">
            <button
              type="button"
              onClick={() => setDateTab('today')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition duration-150 cursor-pointer ${
                dateTab === 'today'
                  ? 'bg-surface text-accent shadow-xs ring-1 ring-accent/20'
                  : 'text-ink-2 hover:text-ink dark:hover:text-ink'
              }`}
            >
              Hari Ini
            </button>
            <button
              type="button"
              onClick={() => setDateTab('tomorrow')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition duration-150 cursor-pointer ${
                dateTab === 'tomorrow'
                  ? 'bg-surface text-purple-700 dark:text-ink-2 shadow-xs ring-1 ring-purple-500/20'
                  : 'text-ink-2 hover:text-ink dark:hover:text-ink'
              }`}
            >
              Besok
            </button>
            <div className="relative inline-flex items-center">
              <input
                type="date"
                value={customDate}
                onChange={(e) => {
                  if (e.target.value) {
                    setCustomDate(e.target.value);
                    setDateTab('custom');
                  }
                }}
                className={`text-xs font-bold px-2.5 py-1.5 rounded-xl border-0 bg-transparent cursor-pointer focus:outline-none dark:[color-scheme:dark] ${
                  dateTab === 'custom'
                    ? 'bg-surface text-sky-700 dark:text-info shadow-xs ring-1 ring-sky-500/20'
                    : 'text-ink-2 hover:text-ink dark:hover:text-ink'
                }`}
                title="Pilih Tanggal Tertentu"
              />
            </div>
          </div>

          {/* Scope Select (Mine vs All) */}
          <div className="relative">
            <select
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value)}
              className="bg-surface border border-divider text-ink text-xs font-bold rounded-xl px-3 py-2 pr-8 focus:outline-none focus:border-accent shadow-xs cursor-pointer appearance-none min-h-[38px]"
            >
              <option value="mine">Tugas Saya</option>
              {isSupervisor && <option value="all">Semua Terapis</option>}
              {teamMembers.length > 0 && (
                <optgroup label="Terapis Spesifik">
                  {teamMembers.map((m) => (
                    <option key={m.id} value={`staff:${m.id}`}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-ink-2">
              <ChevronDown size={14} />
            </div>
          </div>

          {/* Metrics Modal Toggle */}
          <button
            onClick={() => setShowMetricsModal(true)}
            className="p-2.5 rounded-xl bg-surface border border-divider text-ink hover:bg-fill-1 transition shadow-xs active:scale-[0.98] cursor-pointer min-h-[38px] min-w-[38px] flex items-center justify-center"
            title="Rekap Ringkasan Metrik"
          >
            <BarChart3 size={16} className="text-accent" />
          </button>

          {/* Fase 4 (plan 2026-10-02): Peta Sebaran Armada Hari Ini */}
          <button
            onClick={() => setShowFleetMap(true)}
            className="p-2.5 rounded-xl bg-surface border border-divider text-ink hover:bg-fill-1 transition shadow-xs active:scale-[0.98] cursor-pointer min-h-[38px] min-w-[38px] flex items-center justify-center"
            title="Peta Sebaran Hari Ini"
          >
            <MapPin size={16} className="text-accent" />
          </button>

          {/* Reload Button */}
          <button
            onClick={() => fetchTasks()}
            disabled={loading}
            className="p-2.5 rounded-xl bg-surface border border-divider text-ink-2 hover:text-ink dark:hover:text-ink hover:bg-fill-1 transition shadow-xs disabled:opacity-50 active:scale-[0.98] cursor-pointer min-h-[38px] min-w-[38px] flex items-center justify-center"
            title="Muat Ulang Tugas"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin text-accent' : ''} />
          </button>
        </div>
      </div>

      {/* Date Notice Banner if Tomorrow or Custom Date */}
      {dateTab !== 'today' && (
        <div className={`p-3.5 rounded-2xl border flex items-center justify-between text-xs font-semibold ${
          dateTab === 'tomorrow'
            ? 'bg-purple-50/70 dark:bg-fill-1 border-purple-200 dark:border-divider text-purple-900 dark:text-purple-200'
            : 'bg-sky-50/70 dark:bg-sky-950/30 border-sky-200 dark:border-sky-800/40 text-sky-900 dark:text-sky-200'
        }`}>
          <div className="flex items-center gap-2.5">
            <Info size={16} className={dateTab === 'tomorrow' ? 'text-violet' : 'text-info'} />
            <span>
              {dateTab === 'tomorrow'
                ? `Menampilkan jadwal persiapan treatment untuk BESOK (${displayDateText}). Anda dapat meninjau rute dan mendelegasikan terapis lebih awal.`
                : `Menampilkan jadwal treatment untuk tanggal ${displayDateText}.`}
            </span>
          </div>
          <button
            onClick={() => setDateTab('today')}
            className="px-3 py-1 bg-surface border border-current rounded-xl text-xs font-bold hover:bg-white/80 transition cursor-pointer shrink-0 ml-2"
          >
            Kembali ke Hari Ini
          </button>
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="bg-surface p-3.5 rounded-2xl border border-divider shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-ink-3">
            <Search size={14} />
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari pasien, alamat, terapis, atau treatment..."
            className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-fill-1 border-0 text-ink placeholder:text-ink-3 text-xs focus:outline-none focus:ring-2 focus:ring-accent min-h-[38px]"
          />
        </div>

        <div className="flex items-center space-x-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setStatusFilter('UPCOMING')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer ${
              statusFilter === 'UPCOMING'
                ? 'bg-accent text-accent-ink shadow-xs'
                : 'bg-fill-1 text-ink-2 hover:bg-fill-2 dark:hover:bg-fill-2'
            }`}
          >
            Akan Datang ({upcomingCount})
          </button>
          <button
            onClick={() => setStatusFilter('COMPLETED')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer ${
              statusFilter === 'COMPLETED'
                ? 'bg-accent text-accent-ink shadow-xs'
                : 'bg-fill-1 text-ink-2 hover:bg-fill-2 dark:hover:bg-fill-2'
            }`}
          >
            Selesai ({completedCount})
          </button>
          <button
            onClick={() => setStatusFilter('OTW')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer ${
              statusFilter === 'OTW'
                ? 'bg-accent text-accent-ink shadow-xs'
                : 'bg-fill-1 text-ink-2 hover:bg-fill-2 dark:hover:bg-fill-2'
            }`}
          >
            OTW ({otwCount})
          </button>
          <button
            onClick={() => setStatusFilter('ALL')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer ${
              statusFilter === 'ALL'
                ? 'bg-accent text-accent-ink shadow-xs'
                : 'bg-fill-1 text-ink-2 hover:bg-fill-2 dark:hover:bg-fill-2'
            }`}
          >
            Semua ({totalCount})
          </button>
        </div>
      </div>

      {/* Task List Cards */}
      {loading ? (
        <div className="bg-surface rounded-2xl border border-divider p-12 text-center text-ink-3 dark:text-ink-2 shadow-xs">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-3 border-accent border-t-transparent mb-3"></div>
          <p className="text-xs font-bold text-ink">Memuat daftar tugas treatment...</p>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="bg-surface rounded-2xl border border-divider shadow-xs">
          <EmptyState
            icon={<Calendar size={20} aria-hidden="true" />}
            title={
              dateTab === 'tomorrow'
                ? 'Belum ada reservasi treatment terjadwal untuk besok'
                : 'Tidak ada jadwal treatment yang cocok'
            }
            description={
              searchQuery
                ? 'Coba ganti kata kunci pencarian.'
                : dateTab === 'tomorrow'
                ? 'Reservasi yang masuk dan sudah dikonfirmasi untuk besok akan muncul di sini.'
                : 'Belum ada reservasi treatment pada filter ini.'
            }
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4 max-w-4xl mx-auto w-full">
          {filteredTasks.map((task, index) => (
            <TodayTreatmentCard
              key={task.reservationId}
              task={task}
              index={index}
              isSupervisor={isSupervisor}
              isSendingOtw={sendingOtwId === task.reservationId}
              otwReady={isOtwAllowed(task)}
              dateTab={dateTab}
              onOpenDetail={setDetailModalTask}
              onOpenPayment={(t) => {
                setPaymentTask(t);
                setPaymentMethod('CASH');
                setProofImageB64(null);
              }}
              onOpenChat={handleOpenChat}
              onOpenLocation={handleOpenLocationModal}
              onReassign={handleOpenReassign}
              onSendOtw={handleSendOtw}
              onShowImage={setZoomImageUrl}
            />
          ))}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL DETAIL LENGKAP CUSTOMER & TREATMENT */}
      {/* ========================================================================= */}
      <FleetMapModal open={showFleetMap} onClose={() => setShowFleetMap(false)} tasks={fleetTasks} />
      {detailModalTask && (
        <TodayTreatmentDetailModal
          task={detailModalTask}
          onClose={() => setDetailModalTask(null)}
          onOpenChat={handleOpenChat}
          onShowImage={setZoomImageUrl}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL DETAIL REKAP RESERVASI */}
      {/* ========================================================================= */}
      {showMetricsModal && (
        <TodayMetricsModal
          dateLabel={dateTab === 'today' ? 'Hari Ini' : dateTab === 'tomorrow' ? 'Besok' : displayDateText}
          totalCount={totalCount}
          completedCount={completedCount}
          otwCount={otwCount}
          lunasCount={lunasCount}
          totalRevenue={totalRevenue}
          onClose={() => setShowMetricsModal(false)}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL FULL SCREEN ZOOM IMAGE */}
      {/* ========================================================================= */}
      {zoomImageUrl && (
        <ImageZoomModal url={zoomImageUrl} onClose={() => setZoomImageUrl(null)} />
      )}

      {/* ========================================================================= */}
      {/* MODAL DELEGASI & GANTI TERAPIS */}
      {/* ========================================================================= */}
      {reassignTask && (
        <ReassignStaffModal
          task={reassignTask}
          staffId={reassignStaffId}
          teamMembers={teamMembers}
          submitting={submittingReassign}
          onClose={() => setReassignTask(null)}
          onStaffChange={setReassignStaffId}
          onSubmit={handleSaveReassign}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL PENCATATAN PEMBAYARAN */}
      {/* ========================================================================= */}
      {paymentTask && (
        <TodayPaymentModal
          task={paymentTask}
          method={paymentMethod}
          proofImageB64={proofImageB64}
          submitting={submittingPayment}
          onClose={() => setPaymentTask(null)}
          onMethodChange={setPaymentMethod}
          onProofChange={setProofImageB64}
          onSave={handleSavePayment}
          onShowImage={setZoomImageUrl}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL UPDATE LOKASI & FOTO RUMAH */}
      {/* ========================================================================= */}
      {locationTask && (
        <TodayLocationModal
          task={locationTask}
          mode={locModalMode}
          hasSavedLocData={hasSavedLocData}
          coords={locCoords}
          gettingGps={locGettingGps}
          gpsError={locGpsError}
          geocoding={locGeocoding}
          mapsResolving={locMapsResolving}
          mapsUrlInput={locMapsUrlInput}
          showManualCoords={locShowManualCoords}
          housePhotoB64={locHousePhotoB64}
          landmark={locLandmark}
          processingPhoto={locProcessingPhoto}
          saving={locSaving}
          onClose={() => setLocationTask(null)}
          onModeChange={setLocModalMode}
          onGetGps={handleGetGps}
          onPasteMapsUrl={handlePasteLocMapsUrl}
          onGeocodeAddress={handleGeocodeLocAddress}
          onProcessPhoto={handleProcessHousePhoto}
          onCoordsChange={setLocCoords}
          onToggleManual={() => setLocShowManualCoords((v) => !v)}
          onRemoveHousePhoto={() => setLocHousePhotoB64(null)}
          onLandmarkChange={setLocLandmark}
          onShowImage={setZoomImageUrl}
          onSave={handleSaveLocation}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL QUICK LIVE CHAT */}
      {/* ========================================================================= */}
      {chatModalTask && (
        <TodayQuickChatModal
          task={chatModalTask}
          messages={chatMessages}
          loading={loadingChat}
          replyText={replyText}
          selectedImage={selectedChatImage}
          sending={sendingChat}
          chatContainerRef={chatContainerRef}
          chatMessagesEndRef={chatMessagesEndRef}
          chatFileInputRef={chatFileInputRef}
          onClose={() => setChatModalTask(null)}
          onReplyChange={setReplyText}
          onImageChange={setSelectedChatImage}
          onSend={handleSendReply}
        />
      )}
    </div>
  );
};

export default TodayTreatments;
