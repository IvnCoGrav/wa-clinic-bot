import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';
import { useAuth } from '../../contexts/AuthContext';
import {
  X,
  Info,
  User,
  MapPin,
  Baby,
  Calendar as CalendarIcon,
  FileText,
  AlertTriangle,
  Check,
  CheckCircle,
  CheckCheck,
  Navigation,
  Camera,
  PenLine,
  Upload,
  Trash2,
  Maximize2,
  Eye,
  Receipt,
  Loader,
  Copy,
  MessageSquare,
  Plus,
} from 'lucide-react';
import { extractBabiesFromRawText } from '../../utils/reservationBabies';
import { generateReservationInvoiceText } from '../../utils/paymentInvoiceFormatter';
import { Reservation } from '../../types';
import { CreateReservationModal } from '../calendar/CreateReservationModal';
import { extractDurationMinutes } from '../../utils/durationCalculator';
import { getCleanTreatmentName, getTotalDurationLabel } from '../../utils/treatmentFormatter';

interface StaffOption {
  id: string;
  name: string;
  role?: string;
  active?: boolean;
}

interface ReservationDetailModalProps {
  reservation: Reservation | null;
  staffList: StaffOption[];
  user?: { id: string } | null;
  googleCalendarMockActive: boolean;
  onClose: () => void;
  onUpdate: () => void; // Refresh parent list
  // Callback functions that will be implemented by parent
  onConfirm?: (id: string) => Promise<void>;
  onComplete?: (id: string) => Promise<void>;
  onStatusChange?: (id: string, newStatus: string) => Promise<void>;
  onSetDate?: (id: string, date: string) => Promise<void>;
  onAssignStaff?: (id: string, staffId: string | null) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onCancel?: (id: string) => Promise<void>;
  onDeletePermanent?: (id: string) => Promise<void>;
  onOpenChatHistory?: (customerId: string, customerName?: string, customerPhone?: string) => void;
  onProofUpload?: (file: File) => Promise<void>;
  onProofRemove?: () => Promise<void>;
  onOpenEditLocation?: (res: Reservation) => void;
  onProofView?: (res: Reservation) => void;
  onHousePhotoView?: (url: string) => void;
}

const getBabyRows = (res: Reservation): Array<{ name: string; age: string; regAge?: string }> => {
  if (!res) return [];
  const children = res.customer?.children;
  if (children && children.length > 0) {
    return children.map((c) => ({
      name: c.name,
      age: (c.current_age as string) || (c.raw_age_text as string) || '',
      regAge: (c.raw_age_text as string) ?? undefined,
    }));
  }
  const bd = (res as any).baby_details;
  if (bd && bd.length > 0) return bd.map((b: any) => ({ name: b.name, age: b.age }));
  return extractBabiesFromRawText(res.raw_text, res.treatment_detail).map((b) => ({ name: b.name, age: b.age }));
};

const getPaymentMethodLabel = (m?: string | null) => {
  if (m === 'CASH') return 'Tunai';
  if (m === 'TRANSFER') return 'Transfer';
  if (m === 'QRIS') return 'QRIS';
  return '-';
};

const formatBookingDate = (dateStr: string | null | undefined, detail?: string | null) => {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const dayMonth = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
    const startTime = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', ':');
    const duration = extractDurationMinutes(detail);
    const endD = new Date(d.getTime() + duration * 60 * 1000);
    const endTime = endD.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', ':');
    return `${dayMonth} ${startTime} - ${endTime}`;
  } catch {
    return '';
  }
};



export const ReservationDetailModal: React.FC<ReservationDetailModalProps> = ({
  reservation,
  staffList,
  user,
  googleCalendarMockActive,
  onClose,
  onUpdate,
  onConfirm,
  onComplete,
  onStatusChange,
  onSetDate,
  onAssignStaff,
  onDelete,
  onCancel,
  onDeletePermanent,
  onOpenChatHistory,
  onProofUpload,
  onProofRemove,
  onOpenEditLocation,
  onProofView,
  onHousePhotoView,
}) => {
  if (!reservation) return null;

  const { toast, confirm } = useUiFeedback();
  const [editDate, setEditDate] = useState('');
  const [assigningStaff, setAssigningStaff] = useState(false);
  const [proofUploading, setProofUploading] = useState(false);
  const [submittingLocation, setSubmittingLocation] = useState(false);
  const proofFileInputRef = useRef<HTMLInputElement>(null);

  // Full Edit Mode State (delegates to unified CreateReservationModal in edit mode)
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (reservation?.booking_date) {
      const d = new Date(reservation.booking_date);
      const tzOffset = d.getTimezoneOffset() * 60000;
      const localIso = new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
      setEditDate(localIso);
    } else {
      setEditDate('');
    }
  }, [reservation]);

  const handleProofPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('Hanya file gambar yang didukung.', 'error');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast('Gambar maksimal 8 MB.', 'error');
      return;
    }
    onProofUpload?.(file);
    if (proofFileInputRef.current) proofFileInputRef.current.value = '';
  };

  const handleProofRemoveClick = async () => {
    const ok = await confirm({
      title: 'Hapus Bukti Bayar',
      message: 'Hapus bukti bayar dari reservasi ini?',
      danger: true,
      confirmText: 'Ya, Hapus',
    });
    if (!ok) return;
    await onProofRemove?.();
    toast('Bukti bayar dihapus.', 'success');
    onUpdate();
  };

  const handleSetDateClick = async () => {
    if (!editDate || !onSetDate) return;
    try {
      const parsed = new Date(editDate);
      if (isNaN(parsed.getTime())) {
        toast('Format tanggal tidak valid', 'error');
        return;
      }
      await onSetDate(reservation.id, parsed.toISOString());
      toast('Jadwal reservasi berhasil diperbarui.', 'success');
      onUpdate();
    } catch (err: any) {
      toast(`Gagal memperbarui jadwal: ${err.message}`, 'error');
    }
  };
  const handleSaveEditDate = handleSetDateClick;

  const handleStaffChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const staffId = e.target.value || null;
    setAssigningStaff(true);
    try {
      await onAssignStaff?.(reservation.id, staffId);
      toast(staffId ? 'Staff berhasil ditugaskan ke reservasi.' : 'Penugasan staff telah dilepas.', 'success');
      onUpdate();
    } catch (err: any) {
      toast(`Gagal menugaskan staff: ${err.message}`, 'error');
    } finally {
      setAssigningStaff(false);
    }
  };
  const handleAssignStaffClick = (staffId: string | null) =>
    handleStaffChange({ target: { value: staffId || '' } } as any);

  const handleConfirmClick = async () => {
    if (!onConfirm) return;
    await onConfirm(reservation.id);
    toast('Reservasi ditandai lunas & disinkronkan ke Google Calendar', 'success');
    onUpdate();
  };

  const handleCompleteClick = async () => {
    if (!onComplete) return;
    const ok = await confirm({
      title: 'Tandai Selesai Treatment?',
      message: 'Apakah reservasi ini sudah selesai dilakukan penanganan/treatment oleh terapis?',
      confirmText: 'Ya, Selesai',
    });
    if (!ok) return;
    await onComplete(reservation.id);
    toast('Reservasi berhasil ditandai Selesai Treatment!', 'success');
    onUpdate();
  };

  const handleStatusChangeClick = async (newStatus: string) => {
    if (!onStatusChange) return;
    await onStatusChange(reservation.id, newStatus);
    toast(`Status reservasi diubah menjadi ${newStatus}.`, 'success');
    onUpdate();
  };

  const handleCancelClick = async () => {
    if (onCancel) {
      await onCancel(reservation.id);
      return;
    }
    const ok = await confirm({
      title: 'Batalkan Reservasi?',
      message: 'Apakah Anda yakin ingin membatalkan jadwal reservasi ini? Status reservasi akan diubah menjadi Cancelled.',
      confirmText: 'Ya, Batalkan',
      danger: true,
    });
    if (!ok) return;
    if (onStatusChange) {
      await onStatusChange(reservation.id, 'cancelled');
    } else if (onDelete) {
      await onDelete(reservation.id);
    }
    toast('Reservasi berhasil dibatalkan.', 'success');
    onClose();
    onUpdate();
  };

  const handleDeletePermanentClick = async () => {
    if (onDeletePermanent) {
      await onDeletePermanent(reservation.id);
      return;
    }
    const ok = await confirm({
      title: 'Hapus Reservasi Permanen?',
      message: 'Apakah Anda yakin ingin menghapus data reservasi ini secara permanen dari database? Tindakan ini tidak dapat dibatalkan.',
      confirmText: 'Ya, Hapus Permanen',
      danger: true,
    });
    if (!ok) return;
    try {
      await apiRequest(`/api/admin/reservation/${reservation.id}?hard=true`, {
        method: 'DELETE',
      });
      toast('Reservasi berhasil dihapus permanen.', 'success');
      onClose();
      onUpdate();
    } catch (err: any) {
      toast(`Gagal menghapus reservasi: ${err.message}`, 'error');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'confirmed':
        return <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-semibold">Confirmed</span>;
      case 'completed':
        return <span className="px-2.5 py-0.5 rounded-full bg-sky-100 border border-sky-200 text-sky-800 text-xs font-semibold">Completed</span>;
      case 'cancelled':
        return <span className="px-2.5 py-0.5 rounded-full bg-rose-100 border border-rose-200 text-rose-800 text-xs font-semibold">Cancelled</span>;
      default:
        return <span className="px-2.5 py-0.5 rounded-full bg-amber-100 border border-amber-200 text-amber-800 text-xs font-semibold">Pending</span>;
    }
  };

  const [copiedInvoice, setCopiedInvoice] = useState(false);

  const handleCopyInvoice = async () => {
    try {
      const text = generateReservationInvoiceText({
        reservation,
        customer: reservation.customer as any,
      });
      await navigator.clipboard.writeText(text);
      setCopiedInvoice(true);
      toast('Format invoice WhatsApp berhasil disalin ke clipboard!', 'success');
      setTimeout(() => setCopiedInvoice(false), 3000);
    } catch {
      toast('Gagal menyalin invoice ke clipboard.', 'error');
    }
  };

  // Keyboard Escape, app-swipe-back & popstate listeners for mobile back gestures
  useEffect(() => {
    try {
      window.history.pushState({ modal: 'reservation-detail' }, '');
    } catch (_) {}

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    const handleSwipeBack = (e: Event) => {
      e.preventDefault();
      onClose();
    };

    const handlePopState = () => {
      onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('app-swipe-back', handleSwipeBack);
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('app-swipe-back', handleSwipeBack);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [onClose]);

  if (isEditing) {
    return (
      <CreateReservationModal
        isOpen={true}
        mode="edit"
        initialReservation={reservation}
        staffList={staffList}
        onClose={() => setIsEditing(false)}
        onSuccess={() => {
          setIsEditing(false);
          onUpdate();
          onClose();
        }}
      />
    );
  }

  return createPortal(
    <div
      data-modal-active="true"
      className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[9999] flex items-center justify-center p-3 sm:p-4 animate-fadeIn h-[100dvh] w-[100dvw]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-white border border-[#e9edef] rounded-3xl p-4 sm:p-6 space-y-4 sm:space-y-5 shadow-2xl relative max-h-[90vh] overflow-y-auto animate-modalScaleUp"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          data-modal-close="true"
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-full text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5] transition-colors cursor-pointer"
        >
          <X size={18} />
        </button>

        {/* Modal Header */}
        <div className="flex items-start justify-between pr-8 flex-wrap gap-2">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-[#111b21] flex items-center space-x-2">
              <Info size={18} className="text-[#008069] flex-shrink-0" />
              <span>Detail Reservasi</span>
            </h3>
            <p className="text-xs text-[#667781] mt-0.5">
              Kelola penugasan terapis, tanggal jadwal, dan status pembayaran
            </p>
          </div>

          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-[#008069] border border-emerald-300 text-xs font-bold transition flex items-center space-x-1.5 shadow-2xs cursor-pointer"
            title="Edit Data Reservasi"
          >
            <PenLine size={13} />
            <span>Edit Reservasi</span>
          </button>
        </div>

        {/* ========================================================= */}
        {/* STANDARD DETAIL VIEW */}
        {/* ========================================================= */}
        <div className="space-y-4 sm:space-y-5">
          {/* Info contents split layout */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5 text-xs">
              <div className="space-y-3">
                <div className="p-3.5 rounded-xl bg-[#f8fafc] border border-[#e9edef] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[#667781] font-bold block uppercase">Data Pasien</span>
                    {getStatusBadge(reservation.status)}
                  </div>
                  <div className="flex items-center space-x-2 text-[#111b21]">
                    <User size={15} className="text-[#8696a0] flex-shrink-0" />
                    <span className="font-semibold break-all">
                      {reservation.customer?.name || 'Bunda'} ({reservation.customer?.phone})
                    </span>
                  </div>
                  {reservation.customer?.kelurahan && (
                    <div className="flex items-center space-x-2 text-[#54656f] text-[11px]">
                      <MapPin size={13} className="text-[#8696a0] flex-shrink-0" />
                      <span className="break-words">
                        {reservation.customer?.kelurahan}, {reservation.customer?.kecamatan}, {reservation.customer?.kota}
                      </span>
                    </div>
                  )}

                  {/* Baby / Anak info */}
                  {getBabyRows(reservation).length > 0 && (
                    <div className="mt-2 pt-2 border-t border-[#e9edef] space-y-1.5">
                      <span className="text-[11px] text-[#008069] font-bold uppercase tracking-wider block">
                        Bayi / Anak ({getBabyRows(reservation).length})
                      </span>
                      {getBabyRows(reservation).map((baby, i) => (
                        <div key={i} className="flex items-center space-x-2 text-[#111b21]">
                          <Baby size={14} className="text-[#008069] flex-shrink-0" />
                          <span className="break-words">
                            <span className="font-semibold">{baby.name || '-'}</span>
                            <span className="text-[#54656f] text-xs"> · {baby.age || '?'}</span>
                            {baby.regAge && baby.regAge !== baby.age && (
                              <span className="text-[#8696a0] text-[11px] ml-1">
                                (saat booking: {baby.regAge})
                              </span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-3.5 rounded-xl bg-[#f8fafc] border border-[#e9edef] space-y-2.5">
                  <span className="text-[11px] text-[#667781] font-bold block uppercase">Lokasi & Pengiriman</span>
                  <div className="flex justify-between text-xs">
                    <span className="text-[#667781]">Jarak dari Cabang</span>
                    <span className="text-[#111b21] font-bold">
                      {reservation.customer?.distance_km?.toFixed(2) || '0.0'} km
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-[#667781]">Ongkir</span>
                    <span className="text-[#111b21] font-bold">
                      {reservation.customer?.ongkir ? `Rp ${reservation.customer.ongkir.toLocaleString()}` : 'Gratis / Belum dihitung'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-[#008069]">
                    <span>Status Jarak</span>
                    <span className="font-bold">Haversine 1.6x Terkalibrasi</span>
                  </div>

                  {/* Foto Depan Rumah & Landmark Patokan */}
                  {(() => {
                    const prefs = reservation.customer?.preferences as any;
                    const housePhoto = prefs?.house_photo_url;
                    const landmark = prefs?.landmark;
                    const lat = reservation.customer?.lat;
                    const lng = reservation.customer?.lng;
                    const mapsUrl = lat && lng ? `https://maps.google.com/?q=${lat},${lng}` : null;

                    if (!housePhoto && !landmark && !mapsUrl) {
                      return (
                        <div className="mt-2 pt-2 border-t border-[#e9edef]">
                          <button
                            type="button"
                            onClick={() => onOpenEditLocation?.(reservation)}
                            className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-white hover:bg-[#e8f5f2] text-[#008069] text-xs font-semibold border border-dashed border-[#00a884]/40 transition shadow-xs"
                          >
                            <Camera size={13} />
                            <span>+ Tambah Foto Rumah & Patokan</span>
                          </button>
                        </div>
                      );
                    }

                    return (
                      <div className="mt-2 pt-2 border-t border-[#e9edef] space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-[#008069] font-bold uppercase tracking-wider block">
                            Panduan Lokasi & Foto Rumah
                          </span>
                          <div className="flex items-center space-x-2">
                            {mapsUrl && (
                              <a
                                href={mapsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] text-[#008069] hover:underline font-semibold flex items-center gap-1"
                              >
                                <Navigation size={11} />
                                <span>Maps</span>
                              </a>
                            )}
                            <button
                              type="button"
                              onClick={() => onOpenEditLocation?.(reservation)}
                              className="text-[11px] text-[#008069] hover:underline font-semibold flex items-center gap-1"
                              title="Edit foto rumah / patokan / titik koordinat"
                            >
                              <PenLine size={11} />
                              <span>Edit</span>
                            </button>
                          </div>
                        </div>

                        {housePhoto && (
                          <div
                            onClick={() => onHousePhotoView?.(housePhoto)}
                            className="flex items-center gap-2.5 p-2 rounded-xl bg-white border border-[#e9edef] cursor-pointer"
                          >
                            <div className="h-14 w-14 rounded-xl bg-[#f0f2f5] overflow-hidden flex-shrink-0 relative group border border-[#e9edef]">
                              <img
                                src={housePhoto}
                                alt="Foto Depan Rumah"
                                className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                              />
                              <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                                <Maximize2 size={14} />
                              </div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="text-[10px] font-bold text-[#008069] uppercase tracking-wider block">
                                🏠 Foto Tampak Depan Rumah
                              </span>
                              {landmark ? (
                                <p className="text-xs text-[#111b21] font-semibold mt-0.5 leading-snug">
                                  Patokan: {landmark}
                                </p>
                              ) : (
                                <p className="text-[11px] text-[#667781]">Foto panduan tersimpan</p>
                              )}
                              {prefs?.location_updated_by_staff_name && (
                                <p className="text-[10px] text-[#8696a0] mt-0.5">
                                  Diperbarui oleh: {prefs.location_updated_by_staff_name}
                                </p>
                              )}
                            </div>
                          </div>
                        )}

                        {!housePhoto && landmark && (
                          <div className="p-2 rounded-xl bg-white border border-[#e9edef] text-xs">
                            <span className="text-[10px] font-bold text-[#008069] uppercase tracking-wider block">
                              📍 Patokan Rumah
                            </span>
                            <p className="text-xs text-[#111b21] font-semibold mt-0.5">{landmark}</p>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Bukti Bayar (upload + lihat) */}
                <div className="p-3.5 rounded-xl bg-[#f8fafc] border border-[#e9edef] space-y-2">
                  <span className="text-[11px] text-[#667781] font-bold block uppercase">Bukti Bayar</span>
                  {reservation.proof_url ? (
                    <div className="flex items-center space-x-2.5">
                      <img
                        src={reservation.proof_url}
                        alt="Bukti bayar"
                        className="h-14 w-14 object-cover rounded-lg border border-[#e9edef] shadow-xs bg-white"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-[#54656f] truncate">
                          Metode: <span className="font-bold text-[#111b21]">{getPaymentMethodLabel(reservation.payment_method)}</span>
                        </p>
                        <p className="text-[10px] text-[#8696a0]">Bukti tersimpan (versi ringan)</p>
                      </div>
                      <button
                        onClick={() => onProofView?.(reservation)}
                        className="p-2 rounded-lg bg-[#e8f5f2] hover:bg-[#c2e7e0] text-[#008069] border border-[#c2e7e0] transition flex items-center justify-center"
                        title="Lihat Detail Bukti Bayar"
                      >
                        <Eye size={15} />
                      </button>
                      <button
                        onClick={handleProofRemoveClick}
                        disabled={proofUploading}
                        className="p-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 transition flex items-center justify-center disabled:opacity-50"
                        title="Hapus Bukti Bayar"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => proofFileInputRef.current?.click()}
                      disabled={proofUploading}
                      className="w-full py-3 rounded-xl border-2 border-dashed border-[#d1d7db] hover:border-[#008069] hover:bg-[#e8f5f2]/20 text-xs text-[#54656f] hover:text-[#008069] font-semibold transition flex items-center justify-center space-x-2 disabled:opacity-50"
                    >
                      {proofUploading ? (
                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#008069] border-t-transparent"></div>
                      ) : (
                        <Upload size={14} />
                      )}
                      <span>{proofUploading ? 'Menyimpan...' : 'Unggah Bukti Bayar (maks 8 MB)'}</span>
                    </button>
                  )}
                  <input
                    ref={proofFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleProofPick}
                  />
                </div>
              </div>

              {/* Edit Schedule section */}
              <div className="space-y-3">
                <div className="p-3.5 rounded-xl bg-[#f8fafc] border border-[#e9edef] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[#667781] font-bold block uppercase">Layanan &amp; Jadwal</span>
                    <span className="font-bold text-xs text-[#008069] font-mono">
                      {reservation.purchase_value ? `Rp ${reservation.purchase_value.toLocaleString('id-ID')}` : 'Rp -'}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-white border border-[#e9edef] space-y-1">
                    <span className="text-[10px] font-bold text-[#008069] uppercase tracking-wider block">
                      {reservation.treatment_category}
                    </span>
                    <p className="text-xs font-semibold text-[#111b21]">
                      {getCleanTreatmentName(reservation.treatment_detail)}
                    </p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {getTotalDurationLabel(reservation.treatment_detail) && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#f0f2f5] border border-[#e9edef] text-[10px] font-bold text-[#54656f]">
                          {getTotalDurationLabel(reservation.treatment_detail)}
                        </span>
                      )}
                    </div>
                  </div>

                  <span className="text-[11px] text-[#667781] font-bold block uppercase pt-1">Atur Jam Jadwal</span>
                  <input
                    type="datetime-local"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full p-2 bg-white border border-[#d1d7db] rounded-lg text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                  />
                  <button
                    onClick={handleSaveEditDate}
                    className="w-full py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-lg text-xs font-semibold transition shadow-xs"
                  >
                    Simpan Jadwal Kunjungan
                  </button>
                </div>

                {/* Staff Assignment */}
                <div className="p-3.5 rounded-xl bg-[#f8fafc] border border-[#e9edef] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[#667781] font-bold block uppercase">Penugasan Staff / Terapis</span>
                    {user?.id && reservation.assigned_staff_id !== user.id && (
                      <button
                        type="button"
                        onClick={() => handleAssignStaffClick(user.id)}
                        disabled={assigningStaff}
                        className="text-[10px] text-[#008069] font-bold hover:underline flex items-center gap-1 cursor-pointer bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200"
                      >
                        <span>⚡ Tugaskan ke Saya</span>
                      </button>
                    )}
                  </div>
                  <select
                    value={reservation.assigned_staff_id || ''}
                    onChange={(e) => handleAssignStaffClick(e.target.value || null)}
                    disabled={assigningStaff}
                    className="w-full p-2 bg-white border border-[#d1d7db] rounded-lg text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                  >
                    <option value="">-- Belum Ditugaskan --</option>
                    {staffList
                      .filter((s) => s.active !== false || s.id === reservation.assigned_staff_id)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} {s.active === false ? '(Nonaktif)' : ''}
                        </option>
                      ))}
                  </select>
                  {reservation.assigned_staff && (
                    <p className="text-xs text-[#008069] font-bold">
                      Ditugaskan ke: {reservation.assigned_staff.name}
                    </p>
                  )}
                </div>

                {/* Google Calendar sync notifier */}
                {googleCalendarMockActive && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 flex items-start space-x-2.5 text-xs">
                    <AlertTriangle className="flex-shrink-0 mt-0.5 text-amber-600" size={15} />
                    <div>
                      <p className="font-bold">Google Calendar: Mode Mock Aktif</p>
                      <p className="mt-0.5 text-[10px] text-amber-700">
                        Sinkronisasi berjalan dalam simulasi lokal.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Raw Text Log */}
            <div className="space-y-1.5">
              <span className="text-[11px] text-[#667781] font-bold block uppercase flex items-center space-x-1">
                <FileText size={12} />
                <span>Format Teks Chat Asli / Detail</span>
              </span>
              <pre className="p-3 bg-[#f8fafc] border border-[#e9edef] rounded-xl text-[11px] text-[#54656f] font-mono overflow-auto max-h-28 whitespace-pre-wrap break-all">
                {reservation.raw_text}
              </pre>
            </div>

            {/* Actions button footer */}
            <div className="pt-3.5 border-t border-[#e9edef] flex flex-col-reverse sm:flex-row gap-2.5 sm:gap-2 justify-between items-stretch sm:items-center">
              {/* Left Action Group: Batalkan & Hapus */}
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                {reservation.status !== 'cancelled' && (
                  <button
                    onClick={handleCancelClick}
                    className="flex-1 sm:flex-initial justify-center px-3.5 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 hover:bg-amber-100 transition text-xs font-semibold flex items-center space-x-1.5 shadow-xs cursor-pointer"
                    title="Batalkan reservasi (Status berubah menjadi Cancelled)"
                  >
                    <X size={14} />
                    <span>Batalkan</span>
                  </button>
                )}

                <button
                  onClick={handleDeletePermanentClick}
                  className="flex-1 sm:flex-initial justify-center px-3.5 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 transition text-xs font-semibold flex items-center space-x-1.5 shadow-xs cursor-pointer"
                  title="Hapus data reservasi secara permanen dari database"
                >
                  <Trash2 size={14} />
                  <span>Hapus Reservasi</span>
                </button>
              </div>

              {/* Right Action Group: Edit, Riwayat Chat, Invoice WA, Action Status */}
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
                <button
                  onClick={() => setIsEditing(true)}
                  className="flex-1 sm:flex-initial justify-center px-3.5 py-2 rounded-xl bg-emerald-50 border border-emerald-300 text-[#008069] hover:bg-emerald-100 transition text-xs font-bold flex items-center space-x-1.5 shadow-2xs cursor-pointer"
                  title="Buka Formulir Edit Reservasi"
                >
                  <PenLine size={13} />
                  <span>Edit Reservasi</span>
                </button>

                {reservation.customer?.id && onOpenChatHistory && (
                  <button
                    onClick={() =>
                      onOpenChatHistory(
                        reservation.customer?.id!,
                        reservation.customer?.name || undefined,
                        reservation.customer?.phone || undefined
                      )
                    }
                    className="flex-1 sm:flex-initial justify-center px-3.5 py-2 rounded-xl bg-sky-50 border border-sky-200 text-sky-700 hover:bg-sky-100 transition text-xs font-semibold flex items-center space-x-1.5 shadow-xs cursor-pointer"
                    title="Lihat riwayat chat WhatsApp customer ini"
                  >
                    <MessageSquare size={14} className="text-sky-600" />
                    <span>Riwayat Chat</span>
                  </button>
                )}

                <button
                  onClick={handleCopyInvoice}
                  className={`flex-1 sm:flex-initial justify-center px-3.5 py-2 rounded-xl border text-xs font-semibold flex items-center space-x-1.5 transition cursor-pointer ${
                    copiedInvoice
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                      : 'bg-white border-[#d1d7db] text-[#111b21] hover:bg-[#f0f2f5] shadow-xs'
                  }`}
                  title="Salin rincian format reservasi & payment untuk WhatsApp"
                >
                  <Receipt size={14} className={copiedInvoice ? 'text-emerald-600' : 'text-[#008069]'} />
                  <span>{copiedInvoice ? 'Invoice Tersalin!' : 'Salin Invoice WA'}</span>
                </button>

                {reservation.status === 'pending' && (() => {
                  const purchaseSentAt = reservation.purchase_event_sent_at ? new Date(reservation.purchase_event_sent_at) : null;
                  const purchaseWindowOpen = purchaseSentAt && Date.now() - purchaseSentAt.getTime() < 7 * 24 * 60 * 60 * 1000;
                  return (
                    <button
                      onClick={handleConfirmClick}
                      disabled={!!purchaseWindowOpen}
                      title={
                        purchaseWindowOpen
                          ? `Purchase event sudah terkirim ${purchaseSentAt.toLocaleString('id-ID')}. Nonaktif 7 hari untuk mencegah double-count.`
                          : undefined
                      }
                      className={`flex-1 sm:flex-initial justify-center px-5 py-2 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition cursor-pointer ${
                        purchaseWindowOpen
                          ? 'bg-[#e9edef] text-[#8696a0] cursor-not-allowed'
                          : 'bg-[#008069] text-white hover:bg-[#00a884] shadow-xs'
                      }`}
                    >
                      <Check size={14} />
                      <span>{purchaseWindowOpen ? 'Purchase Dikirim' : 'Tandai Lunas'}</span>
                    </button>
                  );
                })()}

                {reservation.status === 'confirmed' && (
                  <button
                    onClick={handleCompleteClick}
                    className="flex-1 sm:flex-initial justify-center px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold flex items-center space-x-1.5 transition shadow-xs cursor-pointer"
                  >
                    <CheckCircle size={14} />
                    <span>Tandai Selesai</span>
                  </button>
                )}

                {reservation.status === 'completed' && (
                  <div className="flex items-center space-x-2">
                    <span className="px-3 py-1.5 rounded-xl bg-sky-100 border border-sky-200 text-sky-800 text-xs font-bold flex items-center space-x-1">
                      <CheckCheck size={14} className="text-sky-600" />
                      <span>Treatment Selesai</span>
                    </span>
                    <button
                      onClick={() => handleStatusChangeClick('confirmed')}
                      className="px-2.5 py-1.5 rounded-xl bg-white border border-[#d1d7db] text-[#54656f] hover:text-[#111b21] text-xs font-semibold transition cursor-pointer"
                      title="Kembalikan ke status Terkonfirmasi / Lunas"
                    >
                      Ubah Status
                    </button>
                  </div>
                )}
              </div>
            </div>
        </div>
      </div>
    </div>,
    document.body
  );
};