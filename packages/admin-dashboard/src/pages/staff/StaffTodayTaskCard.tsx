/**
 * Kartu tugas terapis untuk daftar Hari Ini. Semua aksi dikirim lewat callback
 * agar halaman induk tetap memegang state modal, pembayaran, dan navigasi.
 */
import React from 'react';
import {
  AlertCircle,
  ArrowRightLeft,
  Baby,
  Camera,
  CheckCircle2,
  Clock,
  Compass,
  Copy,
  CreditCard,
  Home,
  MapPin,
  Maximize2,
  MessageSquare,
  Navigation,
  Navigation2,
  PenLine,
  QrCode,
} from 'lucide-react';
import { CustomerAvatar } from '../../components/common/CustomerAvatar';
import { formatRupiah } from '../../utils/money';
import { formatPatientName, formatChildAgeText } from '../../utils/staffDisplayFormat';
import { formatClinicalAge } from '../../utils/clinicalAge';
import { needsNavigationPreflight } from '../../utils/geoUtils';
import { resolveTaskAction } from './taskAction';
import { StaffTask } from './staffTaskTypes';
import { AccuracyBadge, AddressUpdatedAtChip, getCategoryIcon } from './staffTaskDisplay';
import {
  chatLockedTitle,
  isChatWindowOpen,
  isOtwAllowed,
  isScheduleOngoing,
  isScheduleOverdue,
  isTimeForArrival,
  formatTaskTime,
} from './staffTaskLogic';

export type CardImageKind = 'house' | 'proof';

interface StaffTodayTaskCardProps {
  task: StaffTask;
  isSelected: boolean;
  isSendingOtw: boolean;
  /** Fase 5 (plan 2026-11-24): pesan OTW sudah diantrekan tapi belum dikonfirmasi server. */
  otwPending?: boolean;
  isCompleting: boolean;
  isSendingArrival: boolean;
  isSupervisor: boolean;
  onOpenDetail: (task: StaffTask) => void;
  onOpenPayment: (task: StaffTask) => void;
  onReassign: (task: StaffTask) => void;
  onReassignStaffChange: (staffId: string) => void;
  onShowImage: (kind: CardImageKind, url: string | null) => void;
  onComplete: (task: StaffTask, e?: React.MouseEvent) => void;
  onOpenChat: (task: StaffTask) => void;
  onOpenQris: (task: StaffTask, e?: React.MouseEvent) => void;
  onEditLocation: (task: StaffTask) => void;
  onRecordArrival: (task: StaffTask, e?: React.MouseEvent) => void;
  onNavigate: (task: StaffTask, e?: React.MouseEvent) => void;
  onToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  index: number;
}

export const StaffTodayTaskCard: React.FC<StaffTodayTaskCardProps> = ({
  task,
  isSelected,
  isSendingOtw,
  otwPending = false,
  isCompleting,
  isSendingArrival,
  isSupervisor,
  onOpenDetail,
  onOpenPayment,
  onReassign,
  onReassignStaffChange,
  onShowImage,
  onComplete,
  onOpenChat,
  onOpenQris,
  onEditLocation,
  onRecordArrival,
  onNavigate,
  onToast,
  index,
}) => {
  const isLunas = task.pricing.paymentStatus === 'LUNAS';
  const catInfo = getCategoryIcon(task.treatmentCategory);

  /**
   * Status keterlambatan untuk warna border kartu (tenant-aware):
   * - level `critical` (default toleransi 30 + extra 15 = 45 menit) → border merah + pulse
   * - level `warning` / waktu berangkat terlewat → border amber
   * - tidak terlambat → warna kategori seperti biasa
   * Ambang tidak di-hardcode di UI; server menghitung dari setelan Delay Watchdog.
   */
  const delayMinutes = task.delay?.delayMinutes ?? 0;
  const isDelayActive =
    Boolean(task.delay) &&
    (delayMinutes > 0 || Boolean(task.delay?.missedDeparture)) &&
    !task.arrivedAt &&
    task.status !== 'completed';
  const isSevereDelay = isDelayActive && task.delay?.level === 'critical';
  /**
   * Hinjauan preventif: tampilkan batas jam berangkat SELALU selama bidan belum
   * OTW dan belum lewat batas — bukan hanya saat sudah terlambat.
   */
  const showPreventiveDepartureHint =
    Boolean(task.delay?.departureDeadlineWib) &&
    !task.otwSentAt &&
    !task.arrivedAt &&
    task.status !== 'completed' &&
    !task.delay?.missedDeparture;
  const delayBorderClass = isSevereDelay
    ? 'border-danger border-l-danger ring-1 ring-danger/40 animate-delay-pulse'
    : isDelayActive
      ? 'border-warning border-l-warning'
      : '';
  const selectionClass = isDelayActive
    ? isSelected
      ? 'ring-2 ring-danger/30 shadow-md'
      : 'hover:shadow-sm active:scale-[0.98]'
    : isSelected
      ? 'border-accent ring-2 ring-accent/30 shadow-md'
      : 'border-divider hover:border-accent/40 hover:shadow-sm active:scale-[0.98]';

  return (

    <div
      className={`p-3.5 rounded-2xl transition duration-200 text-left relative bg-surface shadow-xs border ${selectionClass} ${
        isDelayActive ? delayBorderClass : catInfo.borderAccent
      } border-l-4`}
    >
      {/* Header: Customer Icon & Name & Time (KLIK BARIS INI = DETAIL CUSTOMER) */}
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          onOpenDetail(task);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpenDetail(task);
          }
        }}
        className="flex items-start justify-between gap-2 mb-1 p-1 -m-1 rounded-xl hover:bg-fill-1 transition cursor-pointer group"
        title="Klik untuk melihat detail lengkap pasien"
      >
        <div className="flex items-center space-x-2.5 min-w-0">
          {/* Customer Avatar with Visit Order Badge */}
          <div className="relative flex-shrink-0">
            <CustomerAvatar
              src={task.customerProfilePictureUrl}
              name={task.customerName}
              size="md"
            />
            <span className="absolute -top-1.5 -left-1.5 px-1.5 py-0.2 rounded-full bg-accent text-on-solid text-[9px] font-extrabold shadow-xs">
              #{index + 1}
            </span>
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-sm text-ink truncate group-hover:text-accent transition">
              {task.customerName || 'Customer'}
            </h3>
            <p className="text-[11px] text-accent font-medium line-clamp-2">
              {task.treatmentDetail || 'Treatment Spa'}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-1.5 flex-shrink-0">
          {task.status === 'completed' ? (
            <span className="text-[10px] font-bold text-success bg-success-soft px-1.5 py-0.5 rounded-md border border-success-line flex items-center gap-1">
              <CheckCircle2 size={10} />
              <span>Selesai</span>
            </span>
          ) : task.arrivedAt ? (
            <span className="text-[10px] font-bold text-info bg-info-soft px-1.5 py-0.5 rounded-md border border-info-line flex items-center gap-1">
              
              <span>Tiba</span>
            </span>
          ) : task.otwSentAt ? (
            <span
              className="text-[10px] font-bold text-warning bg-warning-soft px-1.5 py-0.5 rounded-md border border-warning-line flex items-center gap-1"
              title="Sedang menuju lokasi pasien"
            >
              
              <span>Dalam Perjalanan</span>
            </span>
          ) : isScheduleOngoing(task) ? (
            <span className="text-[10px] font-bold text-warning bg-warning-soft px-1.5 py-0.5 rounded-md border border-warning-line flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-warning inline-block" />
              <span>Berlangsung</span>
            </span>
          ) : isScheduleOverdue(task) ? (
            <span className="text-[10px] font-bold text-danger bg-danger-soft px-1.5 py-0.5 rounded-md border border-danger-line flex items-center gap-1">
              <AlertCircle size={10} />
              <span>Perlu Selesai</span>
            </span>
          ) : null}
          <div className="flex items-center space-x-1 text-[11px] font-semibold text-accent bg-bubble-out px-2 py-0.5 rounded-md whitespace-nowrap border border-accent/30">
            <Clock size={11} />
            <span>{formatTaskTime(task.bookingDate).split(' ')[0]}</span>
          </div>
        </div>
      </div>

      {/* Area Bawah: Alamat, Foto Rumah, & Tombol Aksi */}
      <div>
        {/* Fase 5: status jujur saat pesan OTW belum terkonfirmasi server. */}
        {otwPending && !task.otwSentAt && (
          <div className="mb-2 px-2.5 py-1.5 rounded-xl border border-warning-line bg-warning-soft text-[11px] font-semibold text-warning flex items-center gap-1.5">
            <Clock size={12} className="shrink-0" />
            <span>Pesan OTW belum terkonfirmasi — dikirim ulang otomatis</span>
          </div>
        )}
        {/* Departure Watchdog: peringatan satu baris + aksi cepat infokan keterlambatan */}
        {isDelayActive && (
          <div
            className={`mb-2 px-2.5 py-1.5 rounded-xl border text-xs flex items-center justify-between gap-2 ${
              isSevereDelay
                ? 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300 animate-delay-pulse'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
            }`}
          >
            <span className="font-semibold flex items-center gap-1.5 min-w-0 truncate">
              <AlertCircle size={13} className={`shrink-0 ${isSevereDelay ? 'text-danger' : 'text-warning'}`} />
              <span className="truncate">
                {delayMinutes > 0 ? `Potensi Terlambat ±${delayMinutes} menit` : 'Waktu keberangkatan terlewat'}
              </span>
            </span>
            {!task.otwSentAt && task.delay?.departureDeadlineWib && (
              <span
                className={`shrink-0 text-[10px] font-semibold whitespace-nowrap ${
                  isSevereDelay ? 'text-red-600 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'
                }`}
                title="Jam berangkat paling lambat agar tiba tepat waktu"
              >
                {task.delay.missedDeparture
                  ? `Target berangkat ${task.delay.departureDeadlineWib}`
                  : `Berangkat sebelum ${task.delay.departureDeadlineWib}`}
              </span>
            )}
          </div>
        )}

        {/* Langkah preventif: batas jam berangkat (selalu tampil sebelum OTW) */}
        {showPreventiveDepartureHint && (
          <div className="mb-2 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-accent/5 border border-accent/20 text-[11px] text-ink-2">
            <Clock size={12} className="text-accent shrink-0" />
            <span>
              Berangkat sebelum{' '}
              <strong className="text-ink">{task.delay?.departureDeadlineWib} WIB</strong> agar tiba tepat waktu
            </span>
          </div>
        )}

        {/* Alamat & Jarak dari Klinik */}
        <div className="text-xs text-ink-2 mb-2 mt-2 bg-fill-1 p-2.5 rounded-xl border border-divider space-y-2">
          <div className="flex items-start gap-1.5">
            <MapPin size={13} className="text-accent mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-ink leading-snug">{task.address.fullText}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <AccuracyBadge source={task.address.locationSource} />
                <AddressUpdatedAtChip updatedAt={task.address.addressUpdatedAt} />
              </div>
            {task.address.distanceKm != null && (
              <p className="text-[10px] font-semibold text-accent mt-0.5 flex items-center gap-1">
                <Compass size={10} />
                <span>
                  {task.address.distanceSource === 'PREVIOUS_PATIENT' && task.address.originName
                    ? `Jarak: ${task.address.distanceKm.toFixed(1)} km dari ${task.address.originName}`
                    : `Jarak: ${task.address.distanceKm.toFixed(1)} km dari klinik`}
                  {task.address.estimatedMinutes != null && (
                    <span className="text-ink-2 font-normal ml-1">
                      (±{task.address.estimatedMinutes} mnt perjalanan)
                    </span>
                  )}
                </span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={async (e) => {
              e.stopPropagation();
              const copyText = `${task.address.fullText}${
                task.address.landmark ? ` (Patokan: ${task.address.landmark})` : ''
              }`;
              try {
                await navigator.clipboard.writeText(copyText);
                onToast('Alamat disalin ke clipboard. Tempel di Waze/Gojek!', 'success');
              } catch {
                const ta = document.createElement('textarea');
                ta.value = copyText;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                onToast('Alamat disalin ke clipboard. Tempel di Waze/Gojek!', 'success');
              }
            }}
            className="p-1.5 rounded-lg text-ink-2 hover:text-accent hover:bg-surface border border-divider transition active:scale-95 flex-shrink-0"
            title="Salin alamat lengkap untuk Waze/Gojek"
          >
            <Copy size={12} />
          </button>
        </div>

        {/* Foto Depan Rumah & Patokan Landmark */}
        {task.address.housePhotoUrl ? (
          <div className="flex items-center gap-2 p-1.5 rounded-lg bg-surface border border-divider">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onShowImage('house', task.address.housePhotoUrl || null);
              }}
              className="h-11 w-11 rounded-lg bg-fill-1 overflow-hidden flex-shrink-0 relative group cursor-pointer border border-divider"
              title="Klik untuk memperbesar foto rumah"
              aria-label="Perbesar foto rumah"
            >
              <img
                src={task.address.housePhotoUrl}
                alt="Foto Depan Rumah"
                className="h-full w-full object-cover group-hover:scale-105 transition-transform"
              />
              <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                <Maximize2 size={12} />
              </div>
            </button>
            <div className="flex-1 min-w-0">
              <span className="text-[10px] font-bold text-accent uppercase tracking-wider block">
                Foto Depan Rumah
              </span>
              {task.address.landmark ? (
                <p className="text-[11px] text-ink truncate font-medium">
                  Patokan: {task.address.landmark}
                </p>
              ) : (
                <p className="text-[10px] text-ink-2 truncate">Panduan visual tersimpan</p>
              )}
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEditLocation(task);
              }}
              className="p-1.5 text-xs text-accent hover:bg-accent-soft rounded-lg transition border border-divider flex-shrink-0"
              title="Perbarui titik lokasi / foto rumah"
            >
              <PenLine size={12} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEditLocation(task);
            }}
            className="w-full flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl bg-warning-soft hover:bg-warning-line text-warning text-[11px] font-bold border border-warning-line shadow-2xs transition active:scale-95"
            title="Ambil foto rumah untuk panduan visual kunjungan"
          >
            <Camera size={13} className="text-warning" />
            <span>Butuh Foto Rumah • Ambil Foto Sekarang</span>
          </button>
        )}
      </div>

      {(task.address as any).needsMoveConfirmation && (
        <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-900/50 text-amber-900 dark:text-amber-200">
          <MapPin size={14} className="text-warning flex-shrink-0" />
          <p className="text-[11px] font-bold leading-snug">Perlu konfirmasi pindah rumah — titik baru berbeda jauh dari titik tersimpan.</p>
        </div>
      )}

      {/* Kotak Patokan Rumah (plan 2026-10-02): kontras tinggi agar
          Bidan langsung hafal ciri pagar/rumah sebelum mengetuk pintu. */}
      {(task.address.landmark || task.address.addressDetail) && (
        <div className="mb-2 flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-300 dark:border-amber-900/50 text-amber-900 dark:text-amber-200">
          <Home size={14} className="text-warning flex-shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-warning">
              Patokan Rumah
            </p>
            {task.address.landmark && (
              <p className="text-[12px] font-bold leading-snug">{task.address.landmark}</p>
            )}
            {task.address.addressDetail && (
              <p className="text-[11px] text-warning leading-snug">{task.address.addressDetail}</p>
            )}
          </div>
        </div>
      )}

      {/* Data Pasien Bayi / Anak (plan 2026-10-02 - quick-peek klinis:
          usia terhitung presisi dari birthDate bila tersedia, fallback
          ke teks usia mentah. Bidan langsung hafal sebelum mengetuk pintu.) */}
      {task.children && task.children.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {task.children.map((child, i) => {
            const computedAge = child.birthDate ? formatClinicalAge(child.birthDate) : '';
            const ageLabel = computedAge || (child.rawAgeText ? formatChildAgeText(child.rawAgeText) : '');
            return (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-bubble-out dark:bg-accent/20 text-accent text-[11px] font-medium border border-accent/20 dark:border-accent/40"
              >
                <Baby size={11} />
                <span>{formatPatientName(child.name)}</span>
                {ageLabel && (
                  <span className="text-ink-2">({ageLabel})</span>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* Cuplikan Catatan Klinis / Keluhan (dari CS/LiveChat) */}
      {task.adminNotes && (
        <div className="mb-2 flex items-start gap-1.5 px-2 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 text-amber-900 dark:text-amber-200 text-[11px] font-medium">
          <AlertCircle size={12} className="text-warning flex-shrink-0 mt-0.5" />
          <span className="line-clamp-2" title={task.adminNotes}>
            <strong>Keluhan/Catatan:</strong> {task.adminNotes}
          </span>
        </div>
      )}

      {/* Total Biaya & Status Bayar */}
      <div className="flex items-center justify-between text-xs pt-1 border-t border-divider">
        <div className="flex items-center gap-1 text-ink-2" title="Total biaya kunjungan">
          <CreditCard size={12} className="text-accent" />
          <span className="text-ink font-bold">
            {formatRupiah(task.pricing.totalFee)}
          </span>
        </div>

        {isLunas ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (task.pricing.proofUrl) {
                onShowImage('proof', task.pricing.proofUrl);
              } else {
                onOpenPayment(task);
              }
            }}
            className="text-[10px] font-extrabold uppercase tracking-wide text-on-solid bg-success hover:bg-success-hover px-2.5 py-1 rounded-full shadow-xs transition active:scale-95 flex items-center gap-1"
            title={task.pricing.proofUrl ? 'Lihat bukti pembayaran yang tersimpan' : 'Unggah bukti pembayaran / invoice susulan'}
          >
            <CheckCircle2 size={12} />
            <span>SUDAH LUNAS: JANGAN TAGIH</span>
            {task.pricing.proofUrl && <span className="text-[9px] font-bold">• BUKTI</span>}
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={(e) => onOpenQris(task, e)}
              className="text-[10px] font-bold text-accent bg-bubble-out hover:bg-accent-soft px-2 py-0.5 rounded-full border border-accent/30 transition active:scale-95 flex items-center gap-1 shadow-2xs"
              title="Tampilkan barcode QRIS langsung ke pasien"
            >
              <QrCode size={11} />
              <span>QRIS</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenPayment(task);
              }}
              className="text-[10px] font-extrabold uppercase tracking-wide text-on-solid bg-danger hover:bg-danger-hover px-2.5 py-1 rounded-full border border-danger transition active:scale-95 flex items-center gap-1 shadow-xs"
              title="Klik untuk mencatat pembayaran transaksi ini"
            >
              <CreditCard size={12} />
              <span>Bayar</span>
            </button>
          </div>
        )}
      </div>

      {/* Quick Action Buttons (plan 2026-10-02 - unifikasi 1-tap):
          Chat + aksi utama tunggal. Tombol "Navigasi" & "Infokan OTW"
          digabung menjadi [ MULAI JALAN ] agar Bidan tak bingung. */}
      {(() => {
        const isChatHidden = (task.status === 'completed' && !isChatWindowOpen(task)) || task.chatWindow?.reason === 'CLOSED_AFTER_COMPLETE';
        const navUrl = task.navigationUrl || task.mapsUrl;
        const action = resolveTaskAction({
          status: task.status,
          arrivedAt: task.arrivedAt,
          otwSentAt: task.otwSentAt,
          bookingDate: task.bookingDate,
          navUrl,
          isScheduleOverdue: isScheduleOverdue(task),
          timeForArrival: isTimeForArrival(task),
        });
        const isTerminal = task.status === 'completed';
        const isArrived = !isTerminal && (Boolean(task.arrivedAt) || isScheduleOverdue(task));
        const isOtw = !isTerminal && !isArrived && !!task.otwSentAt;
        const isDirectArrival = !isTerminal && !isArrived && !isOtw && isTimeForArrival(task);
        const showExtraNav = action.showExtraNav ?? ((isOtw || isDirectArrival) && !!navUrl);
        const colsClass = isChatHidden
          ? (showExtraNav ? 'grid-cols-2' : 'grid-cols-1')
          : (showExtraNav ? 'grid-cols-3' : 'grid-cols-2');
        return (
          <div className={`grid ${colsClass} gap-2 pt-2 mt-1`}>
            {!isChatHidden && (
              isChatWindowOpen(task) ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenChat(task);
                  }}
                  className="flex items-center justify-center space-x-1 min-h-[44px] py-2.5 px-2 sm:px-3 text-[11px] sm:text-xs font-bold text-accent bg-bubble-out hover:bg-accent-soft/80 rounded-xl transition active:scale-95 border border-accent/30 shadow-xs"
                  title="Buka Ruang Percakapan WhatsApp Pasien"
                >
                  <MessageSquare size={15} className="text-accent" />
                  <span>Chat</span>
                </button>
              ) : (
                <div
                  className="flex items-center justify-center space-x-1 min-h-[44px] py-2.5 px-2 sm:px-3 text-[11px] sm:text-xs font-bold text-ink-3 bg-fill-1 rounded-xl border border-divider cursor-not-allowed"
                  title={chatLockedTitle(task)}
                >
                  <MessageSquare size={15} className="text-ink-3" />
                  <span>Chat Terkunci</span>
                </div>
              )
            )}

            {/* Mode sudah OTW: tombol Navigasi (buka peta ulang) tetap tersedia */}
            {isOtw && (
              navUrl ? (
                <button
                  type="button"
                  onClick={(e) => onNavigate(task, e)}
                  className={`flex items-center justify-center space-x-1 min-h-[44px] py-2.5 px-2 sm:px-3 text-[11px] sm:text-xs font-bold rounded-xl transition active:scale-95 shadow-xs cursor-pointer ${
                    needsNavigationPreflight(task.address)
                      ? 'text-warning bg-warning-soft hover:bg-warning border border-warning-line'
                      : 'text-on-solid bg-accent hover:bg-accent-hover'
                  }`}
                  title={needsNavigationPreflight(task.address) ? 'Titik estimasi: konfirmasi patokan dulu' : 'Buka ulang peta navigasi'}
                >
                  <Navigation size={15} />
                  <span>{needsNavigationPreflight(task.address) ? 'Navigasi (Estimasi)' : 'Navigasi'}</span>
                </button>
              ) : (
                <div className="text-[10px] text-ink-2 flex items-center justify-center min-h-[44px] py-2.5 rounded-xl bg-fill-1 border border-divider">
                  Tanpa Peta
                </div>
              )
            )}

            {/* Mode jam tiba langsung (H-10): tombol OTW kedua di samping aksi utama Sampai */}
            {action.secondary === 'otw' && (
              <button
                type="button"
                disabled={isSendingOtw}
                onClick={(e) => onNavigate(task, e)}
                className="flex items-center justify-center space-x-1 min-h-[44px] py-2.5 px-2 sm:px-3 text-[11px] sm:text-xs font-bold rounded-xl transition active:scale-95 shadow-xs text-accent bg-bubble-out hover:bg-accent-soft border border-accent/30"
                title="Kirim info OTW ke pasien & buka peta navigasi"
              >
                <Navigation size={15} />
                <span>OTW</span>
              </button>
            )}

            {/* Aksi operasional 3-state */}
            {isTerminal || isArrived ? (
              <button
                type="button"
                disabled={isCompleting || isTerminal}
                onClick={(e) => onComplete(task, e)}
                className={`flex items-center justify-center space-x-1 min-h-[44px] py-2.5 px-2 sm:px-3 text-[11px] sm:text-xs font-bold rounded-xl transition active:scale-95 shadow-xs disabled:opacity-60 ${
                  isTerminal
                    ? 'text-success bg-success-soft border border-success-line'
                    : 'text-on-solid bg-accent hover:bg-accent-hover' + (isCompleting ? '' : ' animate-action-pulse')
                }`}
                title={isTerminal ? 'Kunjungan telah selesai' : 'Tandai tindakan selesai dan kunjungan tuntas'}
              >
                {isCompleting ? (
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <>
                    <CheckCircle2 size={15} />
                    <span>Selesai</span>
                  </>
                )}
              </button>
            ) : (isOtw || isDirectArrival) ? (
              <button
                type="button"
                disabled={isSendingArrival}
                onClick={(e) => onRecordArrival(task, e)}
                className="flex items-center justify-center space-x-1 min-h-[44px] py-2.5 px-2 sm:px-3 text-[11px] sm:text-xs font-bold text-on-solid bg-info hover:bg-info-hover rounded-xl transition active:scale-95 shadow-xs disabled:opacity-50"
                title="Infokan ke pasien dan klinik bahwa Anda sudah sampai di lokasi"
              >
                {isSendingArrival ? (
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <>
                    <MapPin size={15} />
                    <span>Sampai</span>
                  </>
                )}
              </button>
            ) : (
              /* Default: SATU tombol besar - buka peta + kirim OTW sekaligus */
              <button
                type="button"
                disabled={isSendingOtw}
                onClick={(e) => onNavigate(task, e)}
                className={`flex items-center justify-center space-x-1.5 min-h-[44px] py-2.5 px-2 sm:px-3 text-[11px] sm:text-xs font-bold rounded-xl transition active:scale-95 shadow-xs ${
                  navUrl && needsNavigationPreflight(task.address)
                    ? 'text-warning bg-warning-soft hover:bg-warning border border-warning-line'
                    : navUrl || isOtwAllowed(task)
                      ? 'text-on-solid bg-accent hover:bg-accent-hover'
                      : 'text-ink-2 bg-fill-2 opacity-75 cursor-pointer border border-divider'
                }`}
                title={
                  navUrl
                    ? 'Buka peta navigasi & otomatis infokan OTW ke pasien'
                    : `OTW H-2 jam s/d H+15 menit (${formatTaskTime(task.bookingDate)}); lewat itu pakai Sudah Sampai`
                }
              >
                {isSendingOtw ? (
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <>
                    <Navigation2 size={15} />
                    <span>MULAI JALAN (OTW &amp; PETA)</span>
                  </>
                )}
              </button>
            )}
          </div>
        );
      })()}

      {/* Bar Terapis Penanggung Jawab & Delegasi (Khusus Supervisor / Mode Tim) */}
      {isSupervisor && (
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-divider text-xs">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[10px] text-ink-2 font-semibold flex-shrink-0">Terapis:</span>
            <span className="px-2 py-0.5 rounded-md bg-violet-soft text-violet text-[10px] font-bold border border-violet-line truncate">
              {task.assignedStaff?.name || 'Belum Ditugaskan'}
            </span>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onReassign(task);
              onReassignStaffChange(task.assignedStaff?.id || '');
            }}
            className="px-2.5 py-1 rounded-lg bg-surface hover:bg-violet-soft text-violet text-[10px] font-bold border border-violet-line shadow-2xs transition active:scale-95 flex items-center gap-1 flex-shrink-0"
            title="Ganti / Delegasikan terapis penanggung jawab"
          >
            <ArrowRightLeft size={11} />
            <span>Delegasikan</span>
          </button>
        </div>
      )}
    </div>
  </div>
  );
};
