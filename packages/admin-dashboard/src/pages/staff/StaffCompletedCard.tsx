/**
 * Daftar treatment Selesai, dikelompokkan per tanggal.
 *
 * Komponen presentasi murni: detail, pembayaran, chat, QRIS, dan pengiriman
 * tagihan diteruskan ke halaman induk lewat callback.
 */
import React from 'react';
import {
  Baby,
  CheckCheck,
  CheckCircle2,
  Compass,
  CreditCard,
  Info,
  MapPin,
  Maximize2,
  MessageSquare,
  QrCode,
} from 'lucide-react';
import { CustomerAvatar } from '../../components/common/CustomerAvatar';
import { formatRupiah } from '../../utils/money';
import { formatPatientName, formatChildAgeText } from '../../utils/staffDisplayFormat';
import { StaffTask } from './staffTaskTypes';
import { AccuracyBadge, AddressUpdatedAtChip, getCategoryIcon } from './staffTaskDisplay';
import { formatTaskTime, isChatWindowOpen } from './staffTaskLogic';

interface StaffCompletedCardProps {
  dateLabel: string;
  items: StaffTask[];
  isSendingPaymentInfo: boolean;
  onOpenDetail: (task: StaffTask) => void;
  onOpenPayment: (task: StaffTask) => void;
  onOpenChat: (task: StaffTask) => void;
  onOpenQris: (task: StaffTask, e?: React.MouseEvent) => void;
  onSendPaymentInfo: (task: StaffTask) => void;
  onShowImage: (kind: 'house' | 'proof', url: string | null) => void;
}

export const StaffCompletedCard: React.FC<StaffCompletedCardProps> = ({
  dateLabel,
  items,
  isSendingPaymentInfo,
  onOpenDetail,
  onOpenPayment,
  onOpenChat,
  onOpenQris,
  onSendPaymentInfo,
  onShowImage,
}) => (

<div className="space-y-3">
  {/* Date Header Pill */}
  <div className="flex items-center space-x-2 pt-2">
    <span className="h-2.5 w-2.5 rounded-full bg-success"></span>
    <h2 className="font-bold text-sm text-ink">{dateLabel}</h2>
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-surface text-ink-2 border border-divider">
      {items.length} Selesai
    </span>
  </div>

  {/* Cards Grid */}
  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
    {items.map((item) => {
      const catInfo = getCategoryIcon(item.treatmentCategory);
      return (
        <div
          key={item.reservationId}
          className={`bg-surface rounded-2xl p-4 border border-divider dark:border-divider shadow-xs hover:border-emerald-500/40 transition space-y-3 text-left ${catInfo.borderAccent} border-l-4`}
        >
          {/* Header: Name & Completed Badge (KLIK BARIS INI = DETAIL PASIEN) */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => onOpenDetail(item)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpenDetail(item);
              }
            }}
            className="flex items-start justify-between gap-2 p-1 -m-1 rounded-xl hover:bg-fill-1 transition cursor-pointer group"
            title="Klik untuk melihat detail lengkap pasien"
          >
            <div className="flex items-center space-x-2.5 min-w-0">
              {/* Customer Avatar */}
              <CustomerAvatar
                src={item.customerProfilePictureUrl}
                name={item.customerName}
                size="md"
              />
              <div className="min-w-0">
                <h3 className="font-bold text-sm text-ink truncate group-hover:text-accent transition">
                  {item.customerName || 'Customer'}
                </h3>
                <p className="text-xs text-accent font-medium line-clamp-2">
                  {item.treatmentDetail || 'Treatment Layanan Spa'}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-1 text-xs font-semibold text-success bg-success-soft px-2.5 py-1 rounded-lg whitespace-nowrap border border-success-line flex-shrink-0">
              <CheckCheck size={13} className="text-success" />
              <span>Selesai</span>
            </div>
          </div>

          {/* Alamat & Jarak dari Klinik */}
          <div className="text-xs text-ink-2 bg-surface-2 p-2.5 rounded-xl border border-divider dark:border-divider space-y-2">
            <div className="flex items-start gap-1.5">
              <MapPin size={14} className="text-accent mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-ink leading-snug">{item.address.fullText}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <AccuracyBadge source={item.address.locationSource} />
                  <AddressUpdatedAtChip updatedAt={item.address.addressUpdatedAt} />
                </div>
                {item.address.distanceKm != null && (
                  <p className="text-[10px] font-semibold text-accent mt-1 flex items-center gap-1">
                    <Compass size={11} />
                    <span>Jarak: {item.address.distanceKm.toFixed(1)} km dari klinik</span>
                  </p>
                )}
              </div>
            </div>

            {/* Foto Depan Rumah & Patokan Landmark */}
            {item.address.housePhotoUrl && (
              <div className="flex items-center gap-2 p-1.5 rounded-lg bg-surface border border-divider">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onShowImage('house', item.address.housePhotoUrl || null);
                  }}
                  className="h-11 w-11 rounded-lg bg-fill-1 overflow-hidden flex-shrink-0 relative group cursor-pointer border border-divider"
                  title="Klik untuk memperbesar foto rumah"
                  aria-label="Perbesar foto rumah"
                >
                  <img
                    src={item.address.housePhotoUrl}
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
                  {item.address.landmark ? (
                    <p className="text-[11px] text-ink truncate font-medium">
                      Patokan: {item.address.landmark}
                    </p>
                  ) : (
                    <p className="text-[10px] text-ink-2 truncate">Panduan visual tersimpan</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Data Pasien Bayi / Anak */}
          {item.children && item.children.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {item.children.map((child, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-bubble-out text-accent text-xs font-medium border border-accent/20"
                >
                  <Baby size={12} />
                  <span>{formatPatientName(child.name)}</span>
                  {child.rawAgeText && (
                    <span className="text-ink-2">({formatChildAgeText(child.rawAgeText)})</span>
                  )}
                </span>
              ))}
            </div>
          )}

          {/* Status Pembayaran & Detail Button */}
          <div className="pt-2 border-t border-divider space-y-1.5">
            <div className="flex items-center gap-1 text-xs text-ink-2 flex-wrap">
              <CreditCard size={13} className="text-success" />
              <strong className="text-success font-bold ml-0.5">
                {formatRupiah(item.pricing.totalFee)}
              </strong>
              <span className="text-[10px] px-1.5 py-0.5 bg-success-soft text-success rounded font-semibold ml-1">
                {item.pricing.paymentStatusLabel}
              </span>
            </div>

            {item.pricing.paymentStatus === 'TAGIH_DI_TEMPAT' ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {item.conversationId && isChatWindowOpen(item) && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenChat(item);
                    }}
                    className="min-h-[44px] py-2 px-2 text-xs font-semibold text-ink-2 bg-fill-1 hover:bg-fill-2 rounded-lg transition active:scale-95 border border-divider flex items-center justify-center gap-1"
                    title="Buka Riwayat Chat WhatsApp"
                  >
                    <MessageSquare size={13} className="text-accent" />
                    <span>Chat</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={(e) => onOpenQris(item, e)}
                  className="min-h-[44px] py-2 px-2 text-xs font-bold text-accent bg-bubble-out hover:bg-accent-soft/80 rounded-lg transition active:scale-95 border border-accent/30 flex items-center justify-center gap-1"
                  title="Tampilkan barcode QRIS langsung ke pasien"
                >
                  <QrCode size={13} />
                  <span>QRIS</span>
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenPayment(item);
                  }}
                  className="min-h-[44px] py-2 px-2 text-xs font-bold text-warning bg-warning-soft hover:bg-warning rounded-lg transition active:scale-95 border border-warning-line flex items-center justify-center gap-1"
                  title="Catat pembayaran / unggah bukti transfer pasien"
                >
                  <CreditCard size={13} className="text-warning" />
                  <span>Catat Bayar</span>
                </button>

                {item.conversationId && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSendPaymentInfo(item);
                    }}
                    disabled={isSendingPaymentInfo}
                    className="min-h-[44px] py-2 px-2 text-xs font-bold text-accent bg-bubble-out hover:bg-accent-soft/80 rounded-lg transition active:scale-95 border border-accent/30 disabled:opacity-50 flex items-center justify-center gap-1"
                    title="Kirim rincian tagihan & QRIS ke WhatsApp pasien"
                  >
                    <MessageSquare size={13} />
                    <span>Kirim Tagihan</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onOpenDetail(item)}
                  className="min-h-[44px] py-2 px-2 text-xs font-semibold text-accent bg-bubble-out hover:bg-accent-soft/80 rounded-lg transition active:scale-95 border border-accent/30 flex items-center justify-center gap-1"
                  title="Lihat Detail Lengkap Pasien"
                >
                  <Info size={13} />
                  <span>Detail</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-1.5 flex-wrap">
                <div className="flex items-center gap-1.5">
                  {item.conversationId && isChatWindowOpen(item) && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenChat(item);
                      }}
                      className="min-h-[44px] py-2 px-3 text-xs font-semibold text-ink-2 bg-fill-1 hover:bg-fill-2 rounded-lg transition active:scale-95 border border-divider flex items-center gap-1"
                      title="Buka Riwayat Chat WhatsApp"
                    >
                      <MessageSquare size={13} className="text-accent" />
                      <span>Chat</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (item.pricing.proofUrl) {
                        onShowImage('proof', item.pricing.proofUrl);
                      } else {
                        onOpenPayment(item);
                      }
                    }}
                    className="min-h-[44px] py-2 px-3 text-xs font-bold text-accent bg-bubble-out hover:bg-accent-soft/80 rounded-lg transition active:scale-95 border border-accent/30 flex items-center gap-1"
                    title={item.pricing.proofUrl ? 'Lihat bukti pembayaran tersimpan' : 'Unggah bukti pembayaran / invoice susulan'}
                  >
                    <CheckCircle2 size={13} />
                    <span>{item.pricing.proofUrl ? 'Bukti Bayar' : 'Unggah Bukti'}</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => onOpenDetail(item)}
                  className="min-h-[44px] py-2 px-3 text-xs font-semibold text-accent bg-bubble-out hover:bg-accent-soft/80 rounded-lg transition active:scale-95 border border-accent/30 flex items-center gap-1"
                  title="Lihat Detail Lengkap Pasien"
                >
                  <Info size={13} />
                  <span>Detail</span>
                </button>
              </div>
            )}
          </div>
        </div>
      );
    })}
  </div>
</div>
);
