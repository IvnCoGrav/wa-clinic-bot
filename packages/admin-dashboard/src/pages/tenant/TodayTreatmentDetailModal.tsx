/**
 * Modal detail lengkap customer dan treatment di dashboard tenant.
 *
 * Presentasi murni: data berasal dari `task`, aksi dikirim lewat callback.
 */
import React from 'react';
import {
  Baby,
  CheckCircle2,
  CreditCard,
  Image as ImageIcon,
  MessageSquare,
  Navigation,
  Timer,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { formatRupiah } from '../../utils/money';
import { formatPatientName, formatChildAgeText } from '../../utils/staffDisplayFormat';
import { parseTreatmentItems as parseNumberedTreatments } from '../../utils/durationCalculator';
import { getGoogleMapsDirectionUrl } from '../../utils/geoUtils';
import { TreatmentTask } from './todayTreatmentsTypes';
import { formatTimeRange, getCategoryIcon } from './todayTreatmentsLogic';

interface TodayTreatmentDetailModalProps {
  task: TreatmentTask;
  onClose: () => void;
  onOpenChat: (task: TreatmentTask) => void;
  onShowImage: (url: string | null) => void;
}

export const TodayTreatmentDetailModal: React.FC<TodayTreatmentDetailModalProps> = ({
  task,
  onClose,
  onOpenChat,
  onShowImage,
}) => {
  return (
  <Modal
    open
    onClose={() => onClose()}
    size="md"
    title={
      <span className="flex items-center gap-3 min-w-0">
        {task.customerProfilePictureUrl ? (
          <img
            src={task.customerProfilePictureUrl}
            alt={task.customerName || 'Pasien'}
            className="h-9 w-9 rounded-xl object-cover border border-divider"
          />
        ) : (
          <span className="h-9 w-9 rounded-xl bg-accent-soft border border-divider text-accent flex items-center justify-center font-extrabold text-sm shrink-0">
            {(task.customerName || 'P').charAt(0).toUpperCase()}
          </span>
        )}
        <span className="truncate">{formatPatientName(task.customerName)}</span>
      </span>
    }
    subtitle={`Jam kunjungan: ${formatTimeRange(
      task.bookingDate,
      parseNumberedTreatments(task.treatmentDetail).totalMinutes
    )}`}
  >

  {task.customerStats && (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-accent-soft text-accent font-bold">
        {task.customerStats.totalTreatments > 1
          ? `${task.customerStats.totalTreatments}x Treatment`
          : 'Pasien Baru (1x)'}
      </span>
      <span className="text-ink-2 font-mono">
        LTV: <strong className="text-ink">{formatRupiah(task.customerStats.ltv)}</strong>
      </span>
      <span
        className={`px-2 py-0.5 rounded-md border ${getCategoryIcon(task.treatmentCategory).badge}`}
        title={getCategoryIcon(task.treatmentCategory).label}
      >
        {getCategoryIcon(task.treatmentCategory).label}
      </span>
    </div>
  )}

        {/* Treatment & Layanan */}
        <div className="p-3.5 bg-surface-2 rounded-2xl border border-divider space-y-2">
          <span className="text-[10px] font-bold text-ink-2 uppercase tracking-wider block">
            Layanan Treatment Dipesan
          </span>
          <div className="space-y-1 text-xs">
            {parseNumberedTreatments(task.treatmentDetail).items.map((it, idx) => (
              <div key={idx} className="font-semibold text-ink flex items-start gap-2">
                <span className="h-5 w-5 rounded-full bg-accent-soft text-accent flex items-center justify-center font-bold text-[10px] shrink-0">
                  {idx + 1}
                </span>
                <span>{it}</span>
              </div>
            ))}
          </div>

          {parseNumberedTreatments(task.treatmentDetail).totalMinutes > 0 && (
            <div className="pt-1">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-warning-soft text-warning border border-warning-line text-xs font-bold">
                <Timer size={12} className="text-warning" />
                <span>Total Estimasi Waktu: {parseNumberedTreatments(task.treatmentDetail).totalMinutes} Menit</span>
              </span>
            </div>
          )}
        </div>

        {/* Data Pasien Anak */}
        {task.children && task.children.length > 0 && (
          <div className="p-3.5 bg-surface-2 rounded-2xl border border-divider space-y-1.5">
            <span className="text-[10px] font-bold text-ink-2 uppercase tracking-wider block">
              Data Pasien Anak
            </span>
            <div className="flex flex-wrap gap-1.5">
              {task.children.map((c, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-xl bg-info-soft text-info border border-info-line text-xs font-semibold"
                >
                  <Baby size={13} />
                  <span>{formatPatientName(c.name)} {c.currentAge ? `(${c.currentAge})` : c.rawAgeText ? `(${formatChildAgeText(c.rawAgeText)})` : ''}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Alamat & Lokasi */}
        <div className="p-3.5 bg-surface-2 dark:bg-surface-2 rounded-2xl border border-divider space-y-2">
          <span className="text-[10px] font-bold text-ink-2 uppercase tracking-wider block">
            Alamat & Titik Lokasi
          </span>
          <p className="text-xs text-ink leading-relaxed">{task.address.fullText}</p>
          
          {task.address.landmark && (
            <p className="text-xs text-ink-2">
              <span className="font-bold text-ink">Patokan:</span> {task.address.landmark}
            </p>
          )}

          {task.address.housePhotoUrl && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => onShowImage(task.address.housePhotoUrl || null)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface border border-divider text-xs font-bold text-accent shadow-2xs hover:bg-accent-soft cursor-pointer"
              >
                <ImageIcon size={14} />
                <span>Lihat Foto Depan Rumah (Zoom)</span>
              </button>
            </div>
          )}
        </div>

        {/* Rincian Finansial */}
        <div className="p-3.5 bg-surface-2 dark:bg-surface-2 rounded-2xl border border-divider space-y-2 text-xs">
          <span className="text-[10px] font-bold text-ink-2 uppercase tracking-wider block">
            Rincian Biaya & Status Pembayaran
          </span>
          <div className="space-y-1">
            <div className="flex justify-between text-ink-2">
              <span>Biaya Layanan:</span>
              <span>{formatRupiah(task.pricing.treatmentFee)}</span>
            </div>
            <div className="flex justify-between text-ink-2">
              <span>Ongkos Kirim:</span>
              <span>{formatRupiah(task.pricing.deliveryFee)}</span>
            </div>
            <div className="flex justify-between font-bold text-ink pt-1 border-t border-divider">
              <span>Total Tagihan:</span>
              <span className="text-accent text-sm">{formatRupiah(task.pricing.totalFee)}</span>
            </div>
          </div>

          <div className="pt-2 flex items-center justify-between">
            <span className="text-xs text-ink-2">Status Pembayaran:</span>
            {task.pricing.paymentStatus === 'LUNAS' ? (
              <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-bubble-out text-accent border border-accent/30 flex items-center space-x-1">
                <CheckCircle2 size={12} />
                <span>LUNAS</span>
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 dark:bg-amber-950/40 text-amber-900 dark:text-warning border border-amber-300 dark:border-amber-800/40 flex items-center space-x-1">
                <CreditCard size={12} />
                <span>TAGIH DI TEMPAT</span>
              </span>
            )}
          </div>
        </div>

        {/* Action Buttons di Modal */}
        <div className="pt-2 flex space-x-2">
          {(() => {
            const detailMapsUrl = task.navigationUrl || task.mapsUrl || getGoogleMapsDirectionUrl(task.address.lat, task.address.lng, task.address.fullText || task.address.kelurahan);
            return (
              <a
                href={detailMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-2.5 px-4 bg-accent hover:bg-accent-hover text-accent-ink rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 shadow-xs cursor-pointer active:scale-[0.98]"
              >
                <Navigation size={14} />
                <span>Buka Google Maps</span>
              </a>
            );
          })()}
          <button
            type="button"
            onClick={() => {
              const t = task;
              onClose();
              onOpenChat(t);
            }}
            className="py-2.5 px-4 bg-surface hover:bg-fill-1 border border-divider text-ink rounded-xl text-xs font-bold transition flex items-center space-x-1.5 cursor-pointer"
          >
            <MessageSquare size={14} className="text-accent" />
            <span>Chat WA</span>
          </button>
          <button
            type="button"
            onClick={() => onClose()}
            className="py-2.5 px-4 bg-surface hover:bg-fill-1 border border-divider text-ink-2 rounded-xl text-xs font-bold transition cursor-pointer"
          >
            Tutup
          </button>
        </div>
  </Modal>
  );
};
