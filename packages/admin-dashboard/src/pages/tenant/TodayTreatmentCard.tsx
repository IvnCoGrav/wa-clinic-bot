/**
 * Kartu tugas treatment harian untuk dashboard tenant.
 *
 * Komponen presentasi: detail, pembayaran, chat, lokasi, delegasi, OTW, dan
 * pembesaran foto diteruskan ke halaman induk lewat callback.
 */
import React from 'react';
import {
  AlertTriangle,
  Baby,
  Camera,
  CheckCircle2,
  Clock,
  CreditCard,
  Image as ImageIcon,
  MapPin,
  Maximize2,
  MessageSquare,
  Navigation,
  Navigation2,
  Send,
  Timer,
  UserCheck,
} from 'lucide-react';
import { formatRupiah } from '../../utils/money';
import { formatPatientName, formatChildAgeText } from '../../utils/staffDisplayFormat';
import { parseTreatmentItems as parseNumberedTreatments } from '../../utils/durationCalculator';
import { isEnRouteStatus } from '../../utils/reservationStatus';
import { getGoogleMapsDirectionUrl } from '../../utils/geoUtils';
import { needsHousePhoto } from '../staff/housePhotoGuard';
import { StatusChip } from '../../components/ui/StatusChip';
import { TreatmentTask } from './todayTreatmentsTypes';
import { formatTime, formatTimeRange, getCategoryIcon, isTaskPastTime } from './todayTreatmentsLogic';

interface TodayTreatmentCardProps {
  task: TreatmentTask;
  index: number;
  isSupervisor: boolean;
  isSendingOtw: boolean;
  otwReady: boolean;
  dateTab: string;
  onOpenDetail: (task: TreatmentTask) => void;
  onOpenPayment: (task: TreatmentTask) => void;
  onOpenChat: (task: TreatmentTask) => void;
  onOpenLocation: (task: TreatmentTask) => void;
  onReassign: (task: TreatmentTask) => void;
  onSendOtw: (task: TreatmentTask) => void;
  onShowImage: (url: string | null) => void;
}

export const TodayTreatmentCard: React.FC<TodayTreatmentCardProps> = ({
  task,
  index,
  isSupervisor,
  isSendingOtw,
  otwReady,
  dateTab,
  onOpenDetail,
  onOpenPayment,
  onOpenChat,
  onOpenLocation,
  onReassign,
  onSendOtw,
  onShowImage,
}) => {
  const isPast = isTaskPastTime(task);
  const isCompleted = task.status.toLowerCase() === 'completed';
  const isOverdue = !isCompleted && isPast;
  const isOtw = !isCompleted && isEnRouteStatus(task.status);
  const isLunas = task.pricing.paymentStatus === 'LUNAS';
  const catCfg = getCategoryIcon(task.treatmentCategory);
  const parsedTreatments = parseNumberedTreatments(task.treatmentDetail);

  return (

    <div
        role="button"
        tabIndex={0}
        onClick={() => onOpenDetail(task)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpenDetail(task);
          }
        }}
      className={`bg-surface rounded-2xl border dark:border-divider p-5 shadow-xs transition space-y-4 relative cursor-pointer group hover:shadow-md ${catCfg.borderAccent} ${
        isCompleted
          ? 'border-emerald-200 dark:border-emerald-800/40 bg-emerald-50/10 dark:bg-emerald-950/20'
          : isOtw
          ? 'border-sky-300 dark:border-sky-800/40 bg-sky-50/15 dark:bg-sky-950/20 ring-1 ring-sky-300 dark:ring-sky-800/30'
          : isOverdue
          ? 'border-amber-300 dark:border-amber-800/40 bg-amber-50/15 dark:bg-amber-950/20 ring-1 ring-amber-300/40'
          : 'border-divider hover:border-accent'
      }`}
    >
      {/* Card Top: Sequence Number, Time, Avatar, Status, Assigned Staff */}
      <div className="flex items-start justify-between gap-3 border-b border-divider dark:border-divider pb-3">
        <div className="flex items-center space-x-3.5">
          {/* Sequence Badge */}
          <div
            className="h-9 w-9 rounded-xl bg-fill-1 group-hover:bg-accent-soft dark:group-hover:bg-accent/15 border border-divider group-hover:border-divider text-ink group-hover:text-accent flex flex-col items-center justify-center shrink-0 transition-colors shadow-2xs"
            title={`Urutan Kunjungan #${index + 1}`}
          >
            <span className="text-[9px] font-bold uppercase leading-none opacity-60">No</span>
            <span className="text-sm font-black leading-none">{index + 1}</span>
          </div>

          <div className="relative shrink-0">
            {task.customerProfilePictureUrl ? (
              <img
                src={task.customerProfilePictureUrl}
                alt={task.customerName || 'Pasien'}
                className="h-11 w-11 rounded-2xl object-cover border border-divider shadow-xs"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <div className="h-11 w-11 rounded-2xl bg-accent-soft border border-divider text-accent flex items-center justify-center font-extrabold text-sm shadow-xs">
                {(task.customerName || 'P').charAt(0).toUpperCase()}
              </div>
            )}
            {/* Waktu Mulai Saja di Foto/Avatar */}
            <span className="absolute -bottom-1 -right-1 px-1.5 py-0.5 rounded-md bg-ink text-surface text-[9px] font-mono font-bold shadow-xs whitespace-nowrap">
              {formatTime(task.bookingDate)}
            </span>
          </div>

          <div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="font-bold text-sm text-ink group-hover:text-accent transition">
                {formatPatientName(task.customerName)}
              </h3>
              <span
                className={`p-1 rounded-md border ${catCfg.badge} inline-flex items-center justify-center shadow-2xs`}
                title={catCfg.label}
              >
                {catCfg.icon}
              </span>
              <span className="text-xs font-semibold text-ink-2 hidden sm:inline">
                ({formatTimeRange(task.bookingDate, parsedTreatments.totalMinutes)})
              </span>
            </div>

            <div className="flex items-center gap-1 text-[11px] text-ink-2 mt-0.5 font-mono" title="Terapis Penanggung Jawab">
              <UserCheck size={13} className="text-accent shrink-0" />
              <span className="font-bold text-accent truncate">{task.assignedStaff?.name || 'Belum Ditugaskan'}</span>
            </div>

            {task.customerStats && (
              <div className="flex items-center gap-1.5 mt-1 text-[10px]">
                <span className="inline-flex items-center px-1.5 py-0.2 rounded-md bg-accent-soft text-accent font-bold">
                  {task.customerStats.totalTreatments > 1 ? `${task.customerStats.totalTreatments}x Treatment` : 'Pasien Baru (1x)'}
                </span>
                <span className="text-ink-3 font-mono">
                  LTV: {formatRupiah(task.customerStats.ltv)}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1">
            {isCompleted ? (
              <StatusChip tone="success" label="Selesai" icon={<CheckCircle2 size={12} />} />
            ) : isOtw ? (
              <StatusChip tone="info" label="Sedang OTW" icon={<Navigation2 size={12} />} />
            ) : isOverdue ? (
              <StatusChip tone="warning" label="Jam Terlewat" icon={<AlertTriangle size={12} />} />
            ) : (
              <StatusChip tone="neutral" label="Akan Datang" icon={<Clock size={12} />} />
            )}

          {isLunas ? (
            <span className="text-[10px] font-bold text-accent">Lunas</span>
          ) : (
            <span className="text-[10px] font-bold text-warning">Tagih: {formatRupiah(task.pricing.totalFee)}</span>
          )}
        </div>
      </div>

      {/* Treatment List Numbering Bersih + Total Waktu Terpadu */}
      <div className="space-y-2 text-xs">
        <div className="space-y-1">
          {parsedTreatments.items.map((treatmentName, idx) => (
              <div key={idx} className="font-semibold text-ink flex items-start gap-2">
              <span className="h-5 w-5 rounded-full bg-accent-soft text-accent flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">
                {idx + 1}
              </span>
              <span className="leading-tight pt-0.5">{treatmentName}</span>
            </div>
          ))}
        </div>

        {/* Total Estimasi Waktu Layanan & Data Anak */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {parsedTreatments.totalMinutes > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-warning border border-amber-200 dark:border-amber-800/40 text-[11px] font-bold">
              <Timer size={12} className="text-warning" />
              <span>Total Durasi: {parsedTreatments.totalMinutes} Menit</span>
            </span>
          )}

          {task.children && task.children.length > 0 && (
            task.children.map((c, idx) => (
              <span
                key={idx}
                className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-lg bg-sky-50 dark:bg-sky-950/30 text-sky-800 dark:text-info border border-sky-200 dark:border-sky-800/40 text-[11px]"
              >
                <Baby size={11} />
                <span>{formatPatientName(c.name)} {c.currentAge ? `(${c.currentAge})` : c.rawAgeText ? `(${formatChildAgeText(c.rawAgeText)})` : ''}</span>
              </span>
            ))
          )}
        </div>
      </div>

      {/* Address, Chain Route & Landmark */}
      <div className="p-3 bg-surface-2 dark:bg-surface-2 rounded-xl border border-divider space-y-1.5 text-xs">
        <div className="flex items-start gap-1.5 text-ink">
          <MapPin size={14} className="text-accent mt-0.5 shrink-0" />
          <span className="line-clamp-2">{task.address.fullText || 'Alamat belum tercatat lengkap'}</span>
        </div>
        
        {task.address.landmark && (
          <p className="text-[11px] text-ink-2 pl-5">
            <span className="font-bold text-ink">Patokan:</span> {task.address.landmark}
          </p>
        )}

        {/* Chain Route Smart Indicator */}
        {task.address.distanceKm !== null && (
          <div className="pl-5 pt-0.5 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="font-bold text-accent font-mono">
              ±{task.address.distanceKm.toFixed(1)} km
            </span>
            {task.address.distanceSource === 'PREVIOUS_PATIENT' ? (
                <span className="px-2 py-0.2 rounded-md bg-purple-50 dark:bg-fill-1 text-purple-700 dark:text-ink-2 border border-purple-200 dark:border-divider font-medium text-[10px]">
                Rute Berantai dari {task.address.originName || 'Pasien Sebelumnya'}
              </span>
            ) : (
                <span className="px-2 py-0.2 rounded-md bg-gray-100 dark:bg-divider text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-divider font-medium text-[10px]">
                Dari Klinik
              </span>
            )}
            {task.address.estimatedMinutes && (
              <span className="text-ink-3 text-[10px] font-mono">
                (Est. {task.address.estimatedMinutes} menit)
              </span>
            )}
          </div>
        )}

        {/* House Photo Thumbnail */}
        {task.address.housePhotoUrl && (
          <div className="pl-5 pt-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onShowImage(task.address.housePhotoUrl || null);
              }}
              className="group relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-surface border border-divider text-[11px] font-bold text-ink-2 hover:text-accent hover:border-accent transition shadow-2xs cursor-pointer"
            >
              <ImageIcon size={13} className="text-accent" />
              <span>Lihat Foto Depan Rumah Pasien</span>
              <Maximize2 size={11} className="text-ink-3 group-hover:scale-110 transition" />
            </button>
          </div>
        )}
      </div>

      {/* Mobile-First Impeccable Action Toolbar */}
      {(() => {
        const mapsDirectionUrl = task.navigationUrl || task.mapsUrl || getGoogleMapsDirectionUrl(task.address.lat, task.address.lng, task.address.fullText || task.address.kelurahan);
        return (
          <div
            role="presentation"
            className="pt-3 border-t border-divider space-y-2.5"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Primary Actions Row: OTW & Catat Lunas (Full-width prominent cards on mobile) */}
            {((!isCompleted && !isOtw) || !isLunas) && (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                {!isCompleted && !isOtw && (
                  <button
                    onClick={() => onSendOtw(task)}
                    disabled={isSendingOtw || !otwReady}
                    className={`flex-1 py-3 px-4 rounded-xl text-white text-xs font-bold transition flex items-center justify-center gap-2 shadow-xs active:scale-[0.98] touch-manipulation cursor-pointer ${
                      dateTab !== 'today'
                        ? 'bg-fill-2 text-ink-2 border border-strong cursor-not-allowed opacity-80'
                        : otwReady
                        ? 'bg-accent hover:bg-accent'
                        : 'bg-fill-2 cursor-not-allowed opacity-70'
                    }`}
                    title={
                      dateTab !== 'today'
                        ? 'Tombol Kirim OTW hanya aktif pada hari-H kunjungan'
                        : otwReady
                        ? 'Kirim notifikasi OTW ke pasien'
                        : 'Tombol OTW aktif 2 jam sebelum jam treatment'
                    }
                  >
                    <Send size={14} />
                    <span>
                      {dateTab !== 'today'
                        ? 'Jadwal Besok (OTW Hari-H)'
                        : otwReady
                        ? 'Kirim Info OTW'
                        : 'OTW (Aktif H-2 Jam)'}
                    </span>
                  </button>
                )}

                {!isLunas && (
                  <button
                    onClick={() => {
                      onOpenPayment(task);
                    }}
                    className="flex-1 py-3 px-4 rounded-xl bg-warning hover:bg-warning-hover text-on-solid text-xs font-bold transition flex items-center justify-center gap-2 shadow-xs active:scale-[0.98] touch-manipulation cursor-pointer"
                  >
                    <CreditCard size={14} />
                    <span>Catat Lunas ({formatRupiah(task.pricing.totalFee)})</span>
                  </button>
                )}
              </div>
            )}

            {/* Secondary Quick Action Chips Row: Maps, Lokasi, Chat, Delegasi */}
            <div className="grid grid-cols-3 sm:flex sm:items-center gap-2">
              {/* Buka Google Maps Navigasi (Selalu Tersedia untuk Setiap Pasien) */}
              <a
                href={mapsDirectionUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="py-2.5 px-3 rounded-xl bg-surface border border-divider text-ink hover:bg-accent-soft dark:hover:bg-accent/15 hover:border-accent/40 text-xs font-bold flex items-center justify-center gap-1.5 shadow-2xs transition active:scale-95 touch-manipulation cursor-pointer"
                title="Buka Peta Navigasi Google Maps"
              >
                <Navigation size={14} className="text-accent" />
                <span>Maps</span>
              </a>

              {/* Update GPS & Foto Rumah */}
              <button
                onClick={() => onOpenLocation(task)}
                className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 shadow-2xs transition active:scale-95 touch-manipulation cursor-pointer ${
                  needsHousePhoto(task)
                    ? 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:border-amber-700/60 dark:text-warning'
                    : 'bg-surface border-divider text-ink-2 hover:text-ink dark:hover:text-ink hover:bg-fill-1'
                }`}
                title={needsHousePhoto(task) ? 'Foto rumah belum ada • Klik untuk unggah' : 'Update Titik GPS & Foto Rumah Pasien'}
              >
                <Camera size={14} className={needsHousePhoto(task) ? 'text-amber-600 dark:text-warning' : ''} />
                <span>{needsHousePhoto(task) ? 'Butuh Foto' : 'Lokasi'}</span>
              </button>

              {/* Chat WhatsApp Pasien */}
              <button
                onClick={() => onOpenChat(task)}
                className="py-2.5 px-3 rounded-xl bg-surface border border-divider text-ink-2 hover:text-accent hover:bg-accent-soft dark:hover:bg-accent/15 text-xs font-bold flex items-center justify-center gap-1.5 shadow-2xs transition active:scale-95 touch-manipulation cursor-pointer"
                title="Buka Live Chat WhatsApp Pasien"
              >
                <MessageSquare size={14} className="text-accent" />
                <span>Chat</span>
              </button>

              {/* Delegasikan Terapis (Supervisor Only) */}
              {isSupervisor && (
                <button
                  onClick={() => onReassign(task)}
                  className="col-span-3 sm:col-span-1 py-2.5 px-3 rounded-xl bg-purple-50 dark:bg-fill-1 hover:bg-purple-100 dark:hover:bg-purple-500/20 text-purple-700 dark:text-ink-2 border border-purple-200 dark:border-divider text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-2xs active:scale-95 touch-manipulation cursor-pointer"
                  title={task.assignedStaff ? 'Ganti Terapis yang Ditugaskan' : 'Delegasikan Jadwal ke Terapis Lain'}
                >
                  <UserCheck size={14} />
                  <span>{task.assignedStaff ? 'Ganti Terapis' : 'Delegasi'}</span>
                </button>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
};
