import React from 'react';
import { Modal } from '../ui/Modal';
import {
  Tag,
  Loader,
  Receipt,
  Eye,
  MapPin,
  PenLine,
  Calendar,
  ExternalLink,
} from 'lucide-react';
import { CustomerAvatar } from '../common/CustomerAvatar';
import { StaffOwnershipBadge } from '../common/StaffOwnershipBadge';
import { CustomerFollowUpSection } from '../customer/CustomerFollowUpSection';
import { formatClinicalAge } from '../../utils/clinicalAge';
import {
  getLocationBadgeConfig,
  getGoogleMapsDirectionUrl,
} from '../../utils/geoUtils';
import { formatRupiahRingkas as formatRpShort } from '../../utils/money';
import { formatWib } from '../../utils/dateWib';

export interface LiveChatCustomerModalProps {
  isOpen: boolean;
  customerDetailData: any;
  selectedChat: any;
  customerDetailLoading: boolean;
  savedAddressCount: number;
  onClose: () => void;
  onOpenAddressBook: (cid: string, name: string) => void;
  onEditProfile: () => void;
  onSelectReservation: (r: any) => void;
  onViewProofModal: (r: any) => void;
  onRefreshFollowUp: () => Promise<void>;
}

export const LiveChatCustomerModal: React.FC<LiveChatCustomerModalProps> = ({
  isOpen,
  customerDetailData,
  selectedChat,
  customerDetailLoading,
  savedAddressCount,
  onClose,
  onOpenAddressBook,
  onEditProfile,
  onSelectReservation,
  onViewProofModal,
  onRefreshFollowUp,
}) => {
  if (!isOpen) return null;

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      size="lg"
      bodyClassName="p-0 overflow-hidden flex-1 flex flex-col min-h-0"
      title={
        <span className="flex items-center gap-3 min-w-0">
          <CustomerAvatar
            src={customerDetailData?.profile_picture_url || selectedChat?.customerProfilePictureUrl}
            name={customerDetailData?.name || selectedChat?.customerName}
            phone={customerDetailData?.phone || selectedChat?.customerPhone}
            size="md"
          />
          <span className="truncate">{customerDetailData?.name || selectedChat?.customerName || 'Customer'}</span>
        </span>
      }
      subtitle={customerDetailData?.phone || selectedChat?.customerPhone || '-'}
    >

        {/* Modal Body */}
        <div className="p-5 space-y-5 overflow-y-auto flex-1 text-xs text-ink">
          {customerDetailLoading ? (
            <div className="py-12 flex justify-center items-center">
              <Loader size={24} className="animate-spin text-accent" />
            </div>
          ) : (
            <>
              <StaffOwnershipBadge
                variant="banner"
                ownership={(customerDetailData as any)?.staffOwnership ?? selectedChat?.staffOwnership}
                showNew
              />
              {/* Quick Metric Cards */}
              <div className="grid grid-cols-3 gap-2.5">
                <div className="p-3 bg-surface-2 border border-divider rounded-xl text-center space-y-1">
                  <p className="text-[10px] text-ink-2 font-semibold uppercase">Total Order</p>
                  <p className="text-base font-bold text-ink">{customerDetailData?.purchaseCount || customerDetailData?.reservations?.length || 0}x</p>
                </div>
                <div className="p-3 bg-surface-2 border border-divider rounded-xl text-center space-y-1">
                  <p className="text-[10px] text-ink-2 font-semibold uppercase">LTV (Value)</p>
                  <p className="text-base font-bold text-accent">{formatRpShort(customerDetailData?.ltv || 0)}</p>
                </div>
                <div className="p-3 bg-surface-2 border border-divider rounded-xl text-center space-y-1">
                  <p className="text-[10px] text-ink-2 font-semibold uppercase">Segment</p>
                  <p className="text-xs font-bold text-ink truncate">
                    {customerDetailData?.is_legacy_source ? 'Legacy' : (customerDetailData?.purchaseCount > 0 ? 'Repeat' : 'New Customer')}
                  </p>
                </div>
              </div>

              {/* Customer Labels Section */}
              <div className="space-y-2">
                <h4 className="font-bold text-ink-2 uppercase tracking-wider text-[11px] flex items-center space-x-1.5">
                  <Tag size={12} />
                  <span>Label Pasien</span>
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {(customerDetailData?.labels || []).length === 0 ? (
                    <p className="text-ink-3 italic">Belum ada label kustom.</p>
                  ) : (
                    customerDetailData.labels.map((cl: any) => {
                      const lbl = cl.label || cl;
                      return (
                        <span
                          key={lbl.id}
                          className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold text-white shadow-2xs"
                          style={{ backgroundColor: lbl.color || 'rgb(var(--c-accent))' }}
                          title={lbl.description ? `${lbl.name}: ${lbl.description}` : lbl.name}
                        >
                          {lbl.name}
                        </span>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Detail Alamat & Lokasi */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-ink-2 uppercase tracking-wider text-[11px] flex items-center space-x-1.5">
                    <MapPin size={12} />
                    <span>Alamat & Lokasi</span>
                  </h4>
                  {(() => {
                    const badge = getLocationBadgeConfig(
                      customerDetailData,
                      customerDetailData?.preferences?.location_source_label
                    );
                    if (!badge.source) return null;
                    return (
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${badge.badgeClass}`}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: badge.dotColor }} />
                        <span>{badge.label}</span>
                        {customerDetailData?.preferences?.location_refreshed_at ? (
                          <span className="opacity-75 font-normal ml-0.5" title="Terakhir diperbarui via shareloc">
                            • {formatWib(customerDetailData.preferences.location_refreshed_at, { dateStyle: 'short', timeStyle: 'short' })}
                          </span>
                        ) : null}
                      </span>
                    );
                  })()}
                </div>
                <div className="p-3 bg-surface-2 border border-divider rounded-xl space-y-1.5">
                  <div>
                    <span className="text-ink-3 text-[10px] block">Alamat Utama</span>
                    <p className="font-medium text-ink">{customerDetailData?.preferences?.address || customerDetailData?.address || '-'}</p>
                    <div className="mt-1">
                      <button
                        type="button"
                        onClick={() => {
                          const cid = customerDetailData?.id || selectedChat?.customerId;
                          if (cid) onOpenAddressBook(cid, customerDetailData?.name || selectedChat?.customerName);
                        }}
                        className="text-[11px] text-accent hover:underline font-semibold flex items-center space-x-1 cursor-pointer"
                      >
                        <MapPin size={11} />
                        <span>Kelola Alamat ({savedAddressCount || 1} tersimpan) →</span>
                      </button>
                    </div>
                    {(customerDetailData?.preferences?.landmark || customerDetailData?.preferences?.address_notes) && (
                      <p className="text-[11px] text-accent mt-0.5 font-medium">Patokan: {customerDetailData?.preferences?.landmark || customerDetailData?.preferences?.address_notes}</p>
                    )}
                    {customerDetailData?.kelurahan && (
                      <p className="text-[10px] text-ink-3 mt-0.5">Kel. {customerDetailData.kelurahan}</p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-divider">
                    <div>
                      <span className="text-ink-3 text-[10px] block">Kecamatan</span>
                      <p className="font-medium text-ink">{customerDetailData?.kecamatan || selectedChat?.kecamatan || '-'}</p>
                    </div>
                    <div>
                      <span className="text-ink-3 text-[10px] block">Kota / Wilayah</span>
                      <p className="font-medium text-ink">{customerDetailData?.kota || selectedChat?.kota || '-'}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-divider">
                    <div>
                      <span className="text-ink-3 text-[10px] block">Jarak & Ongkir Estimasi</span>
                      <p className="font-medium text-ink">
                        {(customerDetailData?.distance_km != null ? customerDetailData.distance_km : selectedChat?.distanceKm) != null
                          ? `${customerDetailData?.distance_km ?? selectedChat?.distanceKm} km`
                          : '-'} (Rp {Number(customerDetailData?.ongkir ?? selectedChat?.ongkir ?? 0).toLocaleString('id-ID')})
                      </p>
                    </div>
                    <div>
                      <span className="text-ink-3 text-[10px] block">Koordinat GPS</span>
                      {customerDetailData?.lat && customerDetailData?.lng ? (
                        <a
                          href={getGoogleMapsDirectionUrl(customerDetailData.lat, customerDetailData.lng, customerDetailData.address)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-accent hover:underline flex items-center space-x-1"
                        >
                          <span>{Number(customerDetailData.lat).toFixed(4)}, {Number(customerDetailData.lng).toFixed(4)}</span>
                          <ExternalLink size={10} />
                        </a>
                      ) : (
                        <p className="text-ink-3">-</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Children / Anak Data */}
              <div className="space-y-2">
                <h4 className="font-bold text-ink-2 uppercase tracking-wider text-[11px]">
                  Data Anak / Bayi ({customerDetailData?.children?.length || 0})
                </h4>
                {(customerDetailData?.children || []).length === 0 ? (
                  <p className="text-ink-3 italic">Belum ada profil anak terdaftar.</p>
                ) : (
                  <div className="space-y-1.5">
                    {customerDetailData.children.map((ch: any) => (
                      <div key={ch.id} className="p-2.5 bg-surface-2 border border-divider rounded-xl flex items-center justify-between">
                        <div>
                          <p className="font-bold text-ink">{ch.name}</p>
                          <p className="text-[10px] text-ink-2">
                            {ch.current_age ? `Usia: ${ch.current_age}` : formatClinicalAge(ch.birth_date) ? `Usia: ${formatClinicalAge(ch.birth_date)}` : ch.age_months ? `Usia: ${ch.age_months} bulan` : ch.birth_date ? `Lahir: ${formatWib(ch.birth_date, { day: '2-digit', month: 'short', year: 'numeric' })}` : ch.raw_age_text ? `Usia: ${ch.raw_age_text}` : '-'}
                            {ch.gender ? ` • ${ch.gender}` : ''}
                          </p>
                        </div>
                        {ch.notes && <span className="text-[10px] text-ink-3 italic truncate max-w-[140px]">{ch.notes}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Riwayat Reservasi */}
              <div className="space-y-2">
                <h4 className="font-bold text-ink-2 uppercase tracking-wider text-[11px] flex items-center justify-between">
                  <span>Riwayat Reservasi ({customerDetailData?.reservations?.length || 0})</span>
                </h4>
                {(customerDetailData?.reservations || []).length === 0 ? (
                  <p className="text-ink-3 italic">Belum ada riwayat reservasi.</p>
                ) : (
                  <>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {customerDetailData.reservations.map((r: any) => (
                        <div
                          key={r.id}
                          onClick={() => onSelectReservation(r)}
                          className="p-2.5 bg-surface-2 border border-divider hover:border-accent/40 rounded-xl flex items-center justify-between transition cursor-pointer hover:bg-fill-1 group"
                        >
                          <div>
                            <p className="font-bold text-ink flex items-center space-x-1.5">
                              <span>{r.treatment_name || (r.services ? r.services.map((s: any) => s.name || s).join(', ') : 'Layanan')}</span>
                              <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-accent font-normal flex items-center gap-0.5">
                                <Eye size={10} />
                                <span>Detail</span>
                              </span>
                            </p>
                            <p className="text-[10px] text-ink-2 flex items-center space-x-1">
                              <Calendar size={10} />
                              <span>{formatWib(r.booking_date, { dateStyle: 'medium' })} • {r.booking_time}</span>
                            </p>
                          </div>
                          <div className="flex items-center space-x-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onViewProofModal(r);
                              }}
                              className={`p-1.5 rounded-lg border transition cursor-pointer ${
                                r.proof_url
                                  ? 'bg-accent/10 border-accent/30 text-accent hover:bg-accent/20'
                                  : 'bg-fill-1 border-divider text-ink-3 hover:text-ink'
                              }`}
                              title={r.proof_url ? 'Lihat Bukti Transfer' : 'Input / Cek Bukti Transfer'}
                            >
                              <Receipt size={13} />
                            </button>
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                              r.status === 'confirmed' || r.status === 'en_route'
                              ? 'bg-success-soft text-success'
                              : r.status === 'pending'
                                ? 'bg-warning-soft text-warning'
                                : 'bg-fill-1 text-ink'
                            }`}>
                              {r.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-ink-3 italic flex items-center space-x-1"><Eye size={10} /><span>Klik card untuk lihat detail lengkap</span></p>
                  </>
                )}
              </div>

              {/* Antrean Follow-Up (reusable modular) */}
              <CustomerFollowUpSection
                customerId={customerDetailData?.id || selectedChat?.customerId || ''}
                customerPhone={customerDetailData?.phone || selectedChat?.customerPhone}
                customerName={customerDetailData?.name || selectedChat?.customerName}
                followUps={customerDetailData?.follow_ups || []}
                onRefresh={onRefreshFollowUp}
              />
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-divider bg-surface-2 flex justify-end space-x-2">
          <button
            type="button"
            onClick={() => {
              const cid = customerDetailData?.id || selectedChat?.customerId;
              if (cid) onOpenAddressBook(cid, customerDetailData?.name || selectedChat?.customerName);
            }}
            className="min-h-[44px] px-3.5 py-2 bg-surface hover:bg-fill-1 text-ink border border-divider text-xs font-bold rounded-xl transition shadow-xs inline-flex items-center space-x-1.5 active:scale-[0.98] focus-visible:ring-2 cursor-pointer"
            title="Buka Buku Alamat"
          >
            <MapPin size={14} className="text-accent" />
            <span>Buku Alamat{savedAddressCount > 0 ? ` (${savedAddressCount})` : ''}</span>
          </button>
          <button
            type="button"
            onClick={onEditProfile}
            className="min-h-[44px] px-4 py-2 bg-accent-soft hover:bg-accent-soft/80 text-accent border border-accent/30 text-xs font-bold rounded-xl transition shadow-xs flex items-center space-x-1.5 active:scale-[0.98] focus-visible:ring-2 cursor-pointer"
          >
            <PenLine size={14} />
            <span>Edit Profil</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-ink hover:bg-black text-white text-xs font-bold rounded-xl transition shadow-xs cursor-pointer"
          >
            Tutup
          </button>
        </div>
    </Modal>
  );
};
