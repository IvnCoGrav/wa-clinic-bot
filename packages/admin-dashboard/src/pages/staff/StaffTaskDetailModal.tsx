/**
 * Modal detail tugas terapis: layanan, alamat, data anak, rincian biaya, dan
 * aksi lanjutan (catat pembayaran, kirim tagihan, buka chat, buka peta).
 *
 * Semua aksi yang mengubah state halaman induk dikirim lewat callback, jadi
 * modal ini tidak menyimpan state bisnis sendiri. Tampilan murni membaca
 * `task` dari server.
 */
import React from 'react';
import {
  Baby,
  Camera,
  CheckCircle2,
  Compass,
  CreditCard,
  MapPin,
  Maximize2,
  MessageSquare,
  Navigation,
  PenLine,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { CustomerAvatar } from '../../components/common/CustomerAvatar';
import { formatRupiah } from '../../utils/money';
import { formatPatientName, formatChildAgeText } from '../../utils/staffDisplayFormat';
import { needsNavigationPreflight } from '../../utils/geoUtils';
import { StaffTask } from './staffTaskTypes';
import { AccuracyBadge, AddressUpdatedAtChip, getCategoryIcon } from './staffTaskDisplay';

export type DetailImageKind = 'house' | 'proof';

interface StaffTaskDetailModalProps {
  task: StaffTask;
  /** Jam booking yang sudah diformat halaman induk, mis. "10:30 WIB". */
  timeLabel: string;
  /** Server-driven: apakah jendela chat untuk tugas ini sedang terbuka. */
  chatOpen: boolean;
  onClose: () => void;
  onEditLocation: (task: StaffTask) => void;
  onOpenPayment: (task: StaffTask) => void;
  onSendPaymentInfo: (task: StaffTask) => void;
  isSendingPaymentInfo: boolean;
  onShowImage: (kind: DetailImageKind, url: string) => void;
  onOpenChat: (task: StaffTask) => void;
  onNavigate: (task: StaffTask, e: React.MouseEvent) => void;
}

export const StaffTaskDetailModal: React.FC<StaffTaskDetailModalProps> = ({
  task,
  timeLabel,
  chatOpen,
  onClose,
  onEditLocation,
  onOpenPayment,
  onSendPaymentInfo,
  isSendingPaymentInfo,
  onShowImage,
  onOpenChat,
  onNavigate,
}) => {
  return (
    <Modal
      open
      onClose={onClose}
      variant="sheet"
      size="md"
      title={
        <span className="flex items-center gap-3 min-w-0">
          <CustomerAvatar src={task.customerProfilePictureUrl} name={task.customerName} size="lg" />
          <span className="truncate">{task.customerName || 'Customer'}</span>
        </span>
      }
      subtitle={timeLabel}
    >
      {/* Treatment & Category */}
      <div className="p-3.5 rounded-2xl bg-surface-2 border border-divider space-y-1.5">
        <span className="text-[10px] font-bold text-ink-2 uppercase tracking-wider block">
          Layanan & Treatment
        </span>
        <p className="text-sm font-bold text-ink">{task.treatmentDetail || 'Treatment Layanan Spa'}</p>
        <span className="inline-block px-2.5 py-0.5 rounded-md text-xs font-semibold bg-accent-soft text-accent border border-accent/30">
          Kategori: {getCategoryIcon(task.treatmentCategory).label}
        </span>
      </div>

      {/* Alamat & Jarak */}
      <div className="p-3.5 rounded-2xl bg-surface-2 border border-divider space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-ink-2 uppercase tracking-wider block">
            Alamat Lokasi Kunjungan
          </span>
          <button
            type="button"
            onClick={() => {
              onClose();
              onEditLocation(task);
            }}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline"
          >
            <PenLine size={11} />
            <span>Update Titik & Foto</span>
          </button>
        </div>

        <div className="flex items-start space-x-2 text-xs text-ink">
          <MapPin size={15} className="text-accent mt-0.5 flex-shrink-0" />
          <div className="leading-relaxed flex-1 min-w-0">
            <p className="font-medium">{task.address.fullText}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <AccuracyBadge source={task.address.locationSource} />
              <AddressUpdatedAtChip updatedAt={task.address.addressUpdatedAt} />
            </div>
            {task.address.distanceKm != null && (
              <p className="text-[11px] font-semibold text-accent mt-1 flex items-center space-x-1">
                <Compass size={12} />
                <span>
                  {task.address.distanceSource === 'PREVIOUS_PATIENT' && task.address.originName
                    ? `${task.address.distanceKm.toFixed(1)} km dari ${task.address.originName}`
                    : `${task.address.distanceKm.toFixed(1)} km dari klinik`}
                  {task.address.estimatedMinutes != null && (
                    <span className="text-ink-2 font-normal ml-1">
                      (±{task.address.estimatedMinutes} menit)
                    </span>
                  )}
                </span>
              </p>
            )}
          </div>
        </div>

        {/* Foto Depan Rumah & Patokan Landmark */}
        {task.address.housePhotoUrl ? (
          <div className="flex items-center gap-2.5 p-2 rounded-xl bg-surface border border-divider mt-1">
            <button
              type="button"
              onClick={() => onShowImage('house', task.address.housePhotoUrl as string)}
              className="h-14 w-14 rounded-xl bg-fill-1 overflow-hidden flex-shrink-0 relative group cursor-pointer border border-divider"
              title="Klik untuk memperbesar foto rumah"
            >
              <img
                src={task.address.housePhotoUrl}
                alt="Foto Depan Rumah"
                className="h-full w-full object-cover group-hover:scale-105 transition-transform"
              />
              <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                <Maximize2 size={14} />
              </div>
            </button>
            <div className="flex-1 min-w-0">
              <span className="text-[10px] font-bold text-accent uppercase tracking-wider block">
                Foto Tampak Depan Rumah
              </span>
              {task.address.landmark ? (
                <p className="text-xs text-ink font-semibold mt-0.5">Patokan: {task.address.landmark}</p>
              ) : (
                <p className="text-[11px] text-ink-2">Panduan visual tersimpan</p>
              )}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              onClose();
              onEditLocation(task);
            }}
            className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-surface hover:bg-accent-soft text-accent text-xs font-semibold border border-dashed border-accent/40 transition active:scale-95"
          >
            <Camera size={13} />
            <span>+ Tambah Foto Depan Rumah & Update GPS</span>
          </button>
        )}
      </div>

      {/* Ringkasan Pasien (catatan karakter dari LiveChat) */}
      {task.adminNotes && (
        <div className="p-3.5 rounded-2xl bg-warning-soft border border-warning-line space-y-1.5">
          <span className="text-[10px] font-bold text-warning uppercase tracking-wider block flex items-center gap-1">
            Ringkasan Pasien: Catatan Khusus
          </span>
          <p className="text-xs text-warning whitespace-pre-wrap leading-relaxed">{task.adminNotes}</p>
        </div>
      )}

      {/* Data Anak */}
      {task.children && task.children.length > 0 && (
        <div className="p-3.5 rounded-2xl bg-surface-2 border border-divider space-y-1.5">
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
                <span>
                  {formatPatientName(c.name)} {c.rawAgeText ? `(${formatChildAgeText(c.rawAgeText)})` : ''}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Rincian Finansial / Pembayaran */}
      <div className="p-3.5 rounded-2xl bg-surface-2 border border-divider space-y-2">
        <span className="text-[10px] font-bold text-ink-2 uppercase tracking-wider block">
          Rincian Biaya & Status Pembayaran
        </span>
        <div className="space-y-1 text-xs">
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
            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-warning-soft text-warning border border-warning-line flex items-center space-x-1">
              <CreditCard size={12} />
              <span>TAGIH DI TEMPAT</span>
            </span>
          )}
        </div>

        {/* Aksi pembayaran pasca-selesai (tanpa gate jendela chat) */}
        <div className="pt-2 flex flex-wrap gap-2">
          {task.pricing.paymentStatus === 'TAGIH_DI_TEMPAT' ? (
            <>
              <button
                type="button"
                onClick={() => onOpenPayment(task)}
                className="flex-1 min-w-[160px] py-2.5 px-3 bg-warning-soft hover:bg-warning text-warning border border-warning-line rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 active:scale-95"
                title="Catat pembayaran & unggah bukti transfer pasien"
              >
                <CreditCard size={14} className="text-warning" />
                <span>Catat Pembayaran & Unggah Bukti</span>
              </button>
              {task.conversationId && (
                <button
                  type="button"
                  onClick={() => onSendPaymentInfo(task)}
                  disabled={isSendingPaymentInfo}
                  className="flex-1 min-w-[160px] py-2.5 px-3 bg-bubble-out hover:bg-accent-soft/80 text-accent border border-accent/30 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 active:scale-95 disabled:opacity-50"
                  title="Kirim rincian tagihan & QRIS ke WhatsApp pasien"
                >
                  <MessageSquare size={14} />
                  <span>Kirim Tagihan & QRIS ke WA</span>
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (task.pricing.proofUrl) onShowImage('proof', task.pricing.proofUrl);
                else onOpenPayment(task);
              }}
              className="flex-1 min-w-[160px] py-2.5 px-3 bg-bubble-out hover:bg-accent-soft/80 text-accent border border-accent/30 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 active:scale-95"
              title={
                task.pricing.proofUrl
                  ? 'Lihat bukti pembayaran tersimpan'
                  : 'Unggah bukti pembayaran / invoice susulan'
              }
            >
              <CheckCircle2 size={14} />
              <span>{task.pricing.proofUrl ? 'Lihat Bukti Pembayaran' : 'Unggah Bukti Pembayaran'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Modal Actions */}
      <div className="pt-1 flex space-x-2">
        {task.conversationId && chatOpen && (
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenChat(task);
            }}
            className="flex-1 py-3 px-4 bg-bubble-out hover:bg-accent-soft/80 text-accent border border-accent/30 rounded-2xl text-xs font-bold transition flex items-center justify-center space-x-1.5 shadow-xs cursor-pointer active:scale-95"
            title="Buka Chat WhatsApp Pasien"
          >
            <MessageSquare size={14} className="text-accent" />
            <span>Chat Pasien</span>
          </button>
        )}
        {(task.navigationUrl || task.mapsUrl) && (
          <button
            type="button"
            onClick={(e) => onNavigate(task, e)}
            className={`flex-1 py-3 px-4 rounded-2xl text-xs font-bold transition flex items-center justify-center space-x-1.5 shadow-xs cursor-pointer active:scale-95 ${
              needsNavigationPreflight(task.address?.locationSource)
                ? 'bg-warning-soft hover:bg-warning text-warning border border-warning-line'
                : 'bg-accent hover:bg-accent-hover text-on-solid'
            }`}
          >
            <Navigation size={14} />
            <span>
              {needsNavigationPreflight(task.address?.locationSource)
                ? 'Buka Peta (Estimasi)'
                : 'Buka Peta Navigasi'}
            </span>
          </button>
        )}
        <button
          onClick={onClose}
          className="py-3 px-5 bg-surface hover:bg-fill-1 border border-divider text-ink rounded-2xl text-xs font-bold transition shadow-xs"
        >
          Tutup
        </button>
      </div>
    </Modal>
  );
};
