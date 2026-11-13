/**
 * Header panel chat staf: tombol kembali, detail pasien, navigasi, pembayaran,
 * dan aksi operasional (OTW, tiba, selesai).
 */
import React from 'react';
import { CheckCircle2, ChevronLeft, CreditCard, MapPin, Navigation, Navigation2 } from 'lucide-react';
import { CustomerAvatar } from '../../components/common/CustomerAvatar';
import { needsNavigationPreflight } from '../../utils/geoUtils';
import { StaffTask } from './staffTaskTypes';
import { formatTaskTime } from './staffTaskLogic';

interface StaffChatHeaderProps {
  task: StaffTask;
  isCompleting: boolean;
  isSendingArrival: boolean;
  isSendingOtw: boolean;
  isOverdue: boolean;
  isTimeForArrival: boolean;
  isOtwReady: boolean;
  onBackToList: () => void;
  onOpenDetail: (task: StaffTask) => void;
  onNavigate: (task: StaffTask, e?: React.MouseEvent) => void;
  onOpenPayment: (task: StaffTask) => void;
  onComplete: (task: StaffTask) => void;
  onRecordArrival: (task: StaffTask) => void;
}

export const StaffChatHeader: React.FC<StaffChatHeaderProps> = ({
  task,
  isCompleting,
  isSendingArrival,
  isSendingOtw,
  isOverdue,
  isTimeForArrival,
  isOtwReady,
  onBackToList,
  onOpenDetail,
  onNavigate,
  onOpenPayment,
  onComplete,
  onRecordArrival,
}) => (
  <>
  {/* WhatsApp Web Chat Header — safe-area for notch/Dynamic Island */}
  <div className="bg-fill-1 border-b border-divider dark:border-divider px-4 pt-[calc(0.625rem+env(safe-area-inset-top,0px))] md:pt-2.5 pb-2.5 flex items-center justify-between gap-3 shadow-xs z-10 shrink-0">
    <div className="flex items-center space-x-2.5 min-w-0">
      {/* Mobile Back to List Button */}
      <button
        onClick={onBackToList}
        className="md:hidden p-2 rounded-full bg-surface hover:bg-fill-2 text-ink-2 transition active:scale-95 border border-divider flex-shrink-0"
        title="Kembali ke daftar kunjungan"
        aria-label="Kembali"
      >
        <ChevronLeft size={18} />
      </button>

      {/* Customer Info Header - Klik untuk melihat Detail Pasien */}
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
        className="flex items-center space-x-2.5 min-w-0 p-1 -m-1 rounded-xl hover:bg-fill-2 transition cursor-pointer group"
        title="Klik untuk melihat detail lengkap pasien"
      >
        {/* Customer Avatar */}
        <CustomerAvatar
          src={task.customerProfilePictureUrl}
          name={task.customerName}
          size="md"
        />

        <div className="min-w-0">
          <div className="flex items-center space-x-2">
            <h2 className="font-semibold text-ink text-sm truncate group-hover:text-accent transition">
              {task.customerName || 'Customer'}
            </h2>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-bubble-out text-accent font-bold border border-accent/30 whitespace-nowrap">
              {formatTaskTime(task.bookingDate)}
            </span>
          </div>
          <p className="text-[11px] text-ink-2 truncate mt-0.5">
            {task.treatmentDetail || 'Treatment'} • {task.address.fullText}
          </p>
        </div>
      </div>
    </div>

    {/* Header Actions: Navigasi, Bayar, Infokan OTW (icon-only) */}
    <div className="flex items-center space-x-1.5 flex-shrink-0">
      {(task.navigationUrl || task.mapsUrl) && (
        <button
          type="button"
          onClick={(e) => onNavigate(task, e)}
          className={`h-9 w-9 flex items-center justify-center rounded-lg shadow-xs transition active:scale-95 cursor-pointer ${
            needsNavigationPreflight(task.address?.locationSource)
              ? 'bg-warning-soft hover:bg-warning text-warning border border-warning-line'
              : 'bg-accent hover:bg-accent-hover text-on-solid'
          }`}
          title={needsNavigationPreflight(task.address?.locationSource) ? 'Titik estimasi: konfirmasi patokan dulu' : 'Buka Peta Navigasi Google Maps & Mulai Perjalanan'}
        >
          <Navigation size={16} />
        </button>
      )}

      <button
        onClick={() => onOpenPayment(task)}
        className={`h-9 w-9 flex items-center justify-center rounded-lg text-xs font-semibold transition shadow-xs active:scale-95 ${
          task.pricing.paymentStatus === 'LUNAS'
            ? 'bg-bubble-out text-accent border border-accent/30'
            : 'bg-warning-soft hover:bg-warning text-warning border border-warning-line'
        }`}
        title={
          task.pricing.paymentStatus === 'LUNAS'
            ? 'Pembayaran sudah lunas'
            : 'Catat Status Pembayaran Transaksi'
        }
      >
        <CreditCard size={16} />
      </button>

  {/* Dynamic Transit Progress Button in Chat Drawer */}
       {/* Anti-OTW Trap: jika jadwal sudah terlewat (overdue), bypass langsung ke tombol Selesai */}
       {task.status === 'completed' ? (
         <div
           className="h-9 w-9 flex items-center justify-center rounded-lg bg-success-soft text-success border border-success-line shadow-xs"
           title="Kunjungan telah selesai"
         >
           <CheckCircle2 size={16} />
         </div>
       ) : task.arrivedAt || isOverdue ? (
         <button
           onClick={() => onComplete(task)}
           disabled={isCompleting}
           className={`h-9 w-9 flex items-center justify-center rounded-lg bg-accent hover:bg-accent-hover text-on-solid transition shadow-xs active:scale-95 disabled:opacity-50 ${
             isCompleting ? '' : 'animate-action-pulse'
           }`}
           title="Tandai Tindakan Selesai"
         >
           {isCompleting ? (
             <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
           ) : (
             <CheckCircle2 size={16} />
           )}
         </button>
       ) : task.otwSentAt || isTimeForArrival ? (
         <button
           onClick={() => onRecordArrival(task)}
           disabled={isSendingArrival}
           className="h-9 w-9 flex items-center justify-center rounded-lg bg-info hover:bg-info-hover text-on-solid transition shadow-xs active:scale-95 disabled:opacity-50"
           title="Tandai Sudah Sampai di Lokasi"
         >
           {isSendingArrival ? (
             <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
           ) : (
             <MapPin size={16} />
           )}
         </button>
        ) : (
          <button
            onClick={() => onNavigate(task)}
            disabled={isSendingOtw}
            className={`h-9 w-9 flex items-center justify-center rounded-lg transition border shadow-xs active:scale-95 ${
             isOtwReady || task.navigationUrl || task.mapsUrl
               ? 'bg-bubble-out hover:bg-accent-soft text-accent border-accent/30'
               : 'bg-fill-1 text-ink-2 border-divider'
           }`}
          title={
            task.navigationUrl || task.mapsUrl
              ? 'Buka peta navigasi & otomatis infokan OTW'
              : isOtwReady
              ? 'Kirim info menuju lokasi (OTW) ke WhatsApp pasien'
              : `OTW H-2 jam s/d H+15 menit (${formatTaskTime(task.bookingDate)}); lewat itu pakai Sudah Sampai`
          }
        >
          {isSendingOtw ? (
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          ) : (
            <Navigation2 size={16} />
          )}
        </button>
      )}
    </div>
  </div>
  </>
);
