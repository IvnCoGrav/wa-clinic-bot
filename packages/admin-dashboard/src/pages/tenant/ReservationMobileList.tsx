/**
 * Daftar reservasi versi kartu untuk layar kecil.
 *
 * Data, pemilihan massal, dan aksi dikirim dari halaman induk.
 */
import React from 'react';
import { AlertTriangle, Baby, Eye } from 'lucide-react';
import { EmptyState } from '../../components/ui/StateViews';
import { Reservation } from '../../types';
import { resolveStaffName } from '../../utils/resolveStaffName';
import { momGestationalBadge } from '../../utils/clinicalAge';
import { evaluatePaymentProof } from '../../utils/paymentProof';
import { formatBookingDate, getBabyRows, getPaymentMethodLabel, getStatusBadge } from './reservationsUi';

interface ReservationMobileListProps {
  reservations: Reservation[];
  totalReservations: number;
  staffList: Array<{ id: string; name: string }>;
  selectedIds: Set<string>;
  onSelect: (reservation: Reservation) => void;
  onShowProof: (reservation: Reservation) => void;
  onToggleSelect: (id: string, e?: React.MouseEvent) => void;
  onToggleAll: () => void;
}

export const ReservationMobileList: React.FC<ReservationMobileListProps> = ({
  reservations,
  totalReservations,
  staffList,
  selectedIds,
  onSelect,
  onShowProof,
  onToggleSelect,
  onToggleAll,
}) => (
  <div className="block md:hidden space-y-3">
    {/* Mobile Count Bar */}
    <div className="flex items-center justify-between gap-2 px-1">
      <span className="text-ink-3 font-bold text-xs">
        {totalReservations > 0
          ? `Menampilkan ${reservations.length} dari ${totalReservations} Reservasi`
          : '0 Data Reservasi'}
      </span>
      {reservations.length > 0 && (
        <label
          htmlFor="select-all-reservations-mobile"
          className="flex items-center gap-1.5 text-ink-2 font-bold text-xs cursor-pointer select-none"
        >
          <input
            id="select-all-reservations-mobile"
            type="checkbox"
            checked={reservations.every((r) => selectedIds.has(r.id))}
            ref={(el) => {
              if (el) {
                const some = reservations.some((r) => selectedIds.has(r.id));
                const all = reservations.every((r) => selectedIds.has(r.id));
                el.indeterminate = some && !all;
              }
            }}
            onChange={onToggleAll}
            className="h-4 w-4 accent-accent cursor-pointer"
          />
          <span>Pilih semua</span>
        </label>
      )}
    </div>

    {reservations.length === 0 ? (
      <div className="bg-surface border border-divider rounded-2xl shadow-xs">
        <EmptyState
          title="Tidak ada reservasi yang cocok"
          description="Ubah filter atau pilih tanggal lain untuk melihat jadwal."
        />
      </div>
    ) : (
      reservations.map((res) => (
        <div
          key={res.id}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(res)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect(res);
            }
          }}
          className="bg-surface rounded-2xl p-4 border border-divider shadow-xs space-y-3 cursor-pointer hover:border-accent hover:shadow-md transition"
        >
          <div className="flex justify-between items-start">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={selectedIds.has(res.id)}
                onClick={(e) => onToggleSelect(res.id, e)}
                onChange={() => {}}
                className="mt-1 h-4 w-4 accent-accent cursor-pointer shrink-0"
                aria-label={`Pilih reservasi ${res.customer?.name || 'Bunda'}`}
              />
              <div>
                <h4 className="font-bold text-ink text-sm group-hover:text-accent transition">{res.customer?.name || 'Bunda'}</h4>
                <p className="text-xs text-ink-3 font-mono mt-0.5">{res.customer?.phone}</p>
                {res.customer && (
                  <div className="flex items-center gap-1.5 mt-1 text-[10px]">
                    <span className="inline-flex items-center px-1.5 py-0.2 rounded-md bg-accent-soft text-accent font-bold">
                      {(res.customer.totalTreatments ?? 1) > 1 ? `${res.customer.totalTreatments}x Treatment` : 'Pasien Baru (1x)'}
                    </span>
                    {res.customer.ltv !== undefined && (
                      <span className="text-ink-3 font-mono">
                        LTV: Rp {res.customer.ltv.toLocaleString('id-ID')}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div>{getStatusBadge(res.status, res.raw_text)}</div>
          </div>

          <div className="flex items-center justify-between text-xs pt-1 border-t border-divider">
            <span className="px-2 py-0.5 rounded bg-fill-1 text-ink-2 font-semibold text-[10px]">
              {res.treatment_category}
            </span>
            <span className="font-bold text-accent bg-accent-soft px-2 py-0.5 rounded border border-divider text-xs">
              {res.booking_date ? formatBookingDate(res.booking_date, res.treatment_detail) : 'Belum ada jadwal'}
            </span>
          </div>

          {res.treatment_detail && (
            <p className="text-xs text-ink-2 bg-surface-2 p-2.5 rounded-xl border border-divider line-clamp-2">
              {res.treatment_detail}
            </p>
          )}

          {(momGestationalBadge(res.mom_gestational_info) || getBabyRows(res).length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {momGestationalBadge(res.mom_gestational_info) && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-danger-soft text-danger border border-danger-line text-[10px] font-bold">
                  {momGestationalBadge(res.mom_gestational_info)}
                </span>
              )}
              {getBabyRows(res).map((b, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-accent-soft text-accent border border-divider text-[10px] font-semibold">
                  <Baby size={10} />
                  {b.name}{b.age ? ` · ${b.age}` : ''}
                </span>
              ))}
            </div>
          )}

          {(() => {
            const staffName = resolveStaffName(res, staffList);
            if (!staffName) return null;
            return (
              <div className="text-xs text-accent font-semibold flex items-center space-x-1">
                <span>Terapis: {staffName}</span>
              </div>
            );
          })()}
          
          {Boolean(res.proof_url) && (() => {
            const proofEval = evaluatePaymentProof(res);
            return (
              <div className="pt-1 flex items-center justify-end gap-1.5">
                {proofEval.isMismatch && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-danger text-on-solid flex items-center gap-1 uppercase tracking-wider">
                    <AlertTriangle size={10} className="shrink-0" />
                    <span>{proofEval.badgeLabel}</span>
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onShowProof(res);
                  }}
                  className={`px-2.5 py-1 rounded-xl transition text-[11px] font-semibold flex items-center space-x-1 cursor-pointer border ${
                    proofEval.isMismatch
                      ? 'bg-danger-soft hover:bg-danger-line text-danger border-danger-line'
                      : 'bg-accent-soft hover:bg-accent-soft text-accent border-divider'
                  }`}
                  title={`Lihat Bukti Bayar (${getPaymentMethodLabel(res.payment_method)})`}
                >
                  <Eye size={13} />
                  <span>Bukti Bayar</span>
                </button>
              </div>
            );
          })()}
        </div>
      ))
    )}
  </div>
);
