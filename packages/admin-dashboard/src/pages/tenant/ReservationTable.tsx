/**
 * Tabel reservasi desktop: kolom customer, jadwal, layanan, status, bukti
 * bayar, dan aksi. Data dan pemilihan massal dikirim dari halaman induk.
 */
import React from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Eye } from 'lucide-react';
import { Reservation } from '../../types';
import { evaluatePaymentProof } from '../../utils/paymentProof';
import { resolveStaffName } from '../../utils/resolveStaffName';
import { formatBookingDate, getPaymentMethodLabel, getStatusBadge } from './reservationsUi';

type SortField = 'booking_date' | 'customer' | 'category' | 'status' | 'created_at';

interface ReservationTableProps {
  reservations: Reservation[];
  staffList: Array<{ id: string; name: string }>;
  selectedIds: Set<string>;
  sortField: SortField;
  sortOrder: 'asc' | 'desc';
  onSelect: (reservation: Reservation) => void;
  onShowProof: (reservation: Reservation) => void;
  onToggleSelect: (id: string, e?: React.MouseEvent) => void;
  onToggleAll: () => void;
  onSort: (field: SortField) => void;
}

export const ReservationTable: React.FC<ReservationTableProps> = ({
  reservations,
  staffList,
  selectedIds,
  sortField,
  sortOrder,
  onSelect,
  onShowProof,
  onToggleSelect,
  onToggleAll,
  onSort,
}) => (
  <div className="hidden md:block bg-surface border border-divider rounded-2xl overflow-hidden shadow-xs">
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-divider bg-surface-2 text-ink-3 text-xs uppercase tracking-wider font-bold select-none">
            <th className="py-3.5 pl-5 pr-0 w-8">
              <input
                type="checkbox"
                checked={reservations.length > 0 && reservations.every((r) => selectedIds.has(r.id))}
                ref={(el) => {
                  if (el) {
                    const some = reservations.some((r) => selectedIds.has(r.id));
                    const all = reservations.every((r) => selectedIds.has(r.id));
                    el.indeterminate = some && !all;
                  }
                }}
                onChange={onToggleAll}
                className="h-4 w-4 accent-accent cursor-pointer align-middle"
                title="Pilih semua reservasi di halaman ini"
                aria-label="Pilih semua reservasi di halaman ini"
              />
            </th>
            <th 
              onClick={() => onSort('customer')} 
              className="py-3.5 px-5 cursor-pointer hover:bg-fill-1 transition-colors"
              title="Klik untuk mengurutkan nama customer"
            >
              <div className="flex items-center gap-1.5">
                <span>Customer</span>
                {sortField === 'customer' ? (
                  sortOrder === 'asc' ? <ArrowUp size={13} className="text-accent" /> : <ArrowDown size={13} className="text-accent" />
                ) : (
                  <ArrowUpDown size={12} className="opacity-40" />
                )}
              </div>
            </th>
            <th 
              onClick={() => onSort('category')} 
              className="py-3.5 px-5 cursor-pointer hover:bg-fill-1 transition-colors"
              title="Klik untuk mengurutkan kategori layanan"
            >
              <div className="flex items-center gap-1.5">
                <span>Kategori</span>
                {sortField === 'category' ? (
                  sortOrder === 'asc' ? <ArrowUp size={13} className="text-accent" /> : <ArrowDown size={13} className="text-accent" />
                ) : (
                  <ArrowUpDown size={12} className="opacity-40" />
                )}
              </div>
            </th>
            <th className="py-3.5 px-5">Detail Layanan</th>
            <th 
              onClick={() => onSort('booking_date')} 
              className="py-3.5 px-5 cursor-pointer hover:bg-fill-1 transition-colors"
              title="Klik untuk mengurutkan jadwal kunjungan"
            >
              <div className="flex items-center gap-1.5">
                <span>Jadwal Kunjungan</span>
                {sortField === 'booking_date' ? (
                  sortOrder === 'asc' ? <ArrowUp size={13} className="text-accent" /> : <ArrowDown size={13} className="text-accent" />
                ) : (
                  <ArrowUpDown size={12} className="opacity-40" />
                )}
              </div>
            </th>
            <th className="py-3.5 px-5">Terapis</th>
            <th 
              onClick={() => onSort('status')} 
              className="py-3.5 px-5 cursor-pointer hover:bg-fill-1 transition-colors"
              title="Klik untuk mengurutkan status"
            >
              <div className="flex items-center gap-1.5">
                <span>Status</span>
                {sortField === 'status' ? (
                  sortOrder === 'asc' ? <ArrowUp size={13} className="text-accent" /> : <ArrowDown size={13} className="text-accent" />
                ) : (
                  <ArrowUpDown size={12} className="opacity-40" />
                )}
              </div>
            </th>
            <th className="py-3.5 px-5">Bukti Bayar</th>
            <th className="py-3.5 px-5 text-right">Aksi</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-divider text-xs text-ink">
          {reservations.length === 0 ? (
            <tr>
              <td colSpan={9} className="py-8 text-center text-ink-3 text-xs">
                Tidak ada data reservasi yang sesuai.
              </td>
            </tr>
          ) : (
            reservations.map((res) => (
              <tr
                key={res.id}
                onClick={() => onSelect(res)}
                className="hover:bg-fill-1 transition cursor-pointer group"
              >
                <td className="py-3.5 pl-5 pr-0 w-8">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(res.id)}
                    onClick={(e) => onToggleSelect(res.id, e)}
                    onChange={() => {}}
                    className="h-4 w-4 accent-accent cursor-pointer align-middle"
                    aria-label={`Pilih reservasi ${res.customer?.name || 'Bunda'}`}
                  />
                </td>
                <td className="py-3.5 px-5 font-medium">
                  <p className="font-bold text-ink group-hover:text-accent transition">{res.customer?.name || 'Bunda'}</p>
                  <p className="text-xs text-ink-3 font-mono">{res.customer?.phone}</p>
                  {res.customer && (
                    <div className="flex items-center gap-1.5 mt-0.5 text-[10px]">
                      <span className="inline-flex items-center px-1.5 py-0.2 rounded-md bg-accent-soft text-accent font-bold">
                        {(res.customer.totalTreatments ?? 1) > 1 ? `${res.customer.totalTreatments}x` : 'Baru (1x)'}
                      </span>
                      {res.customer.ltv !== undefined && (
                        <span className="text-ink-3 font-mono">
                          LTV: Rp {res.customer.ltv.toLocaleString('id-ID')}
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td className="py-3.5 px-5">
                  <span className="px-2 py-0.5 rounded bg-fill-1 text-[11px] text-ink-2 font-semibold">
                    {res.treatment_category}
                  </span>
                </td>
                <td className="py-3.5 px-5 max-w-xs truncate text-ink-2" title={res.treatment_detail}>
                  {res.treatment_detail}
                </td>
                <td className="py-3.5 px-5 font-semibold text-accent whitespace-nowrap">
                  {res.booking_date ? (
                    formatBookingDate(res.booking_date, res.treatment_detail)
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(res);
                      }}
                      className="px-2 py-1 rounded-lg bg-accent-soft border border-divider text-accent hover:bg-accent-soft text-xs font-semibold transition cursor-pointer"
                    >
                      + Atur Jadwal
                    </button>
                  )}
                </td>
                <td className="py-3.5 px-5">
                  {(() => {
                    const staffName = resolveStaffName(res, staffList);
                    return staffName ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-accent-soft text-accent border border-divider">
                        {staffName}
                      </span>
                    ) : (
                      <span className="text-xs text-ink-3 italic">Belum ditugaskan</span>
                    );
                  })()}
                </td>
                <td className="py-3.5 px-5">{getStatusBadge(res.status, res.raw_text)}</td>
                <td className="py-3.5 px-5 whitespace-nowrap">
                  {res.proof_url ? (() => {
                    const proofEval = evaluatePaymentProof(res);
                    return (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onShowProof(res);
                          }}
                          className={`p-2 rounded-xl transition flex items-center justify-center cursor-pointer border ${
                            proofEval.isMismatch
                              ? 'bg-danger-soft hover:bg-danger-line text-danger border-danger-line shadow-2xs'
                              : 'bg-accent-soft hover:bg-accent-soft text-accent border-divider'
                          }`}
                          title={`Lihat Bukti Bayar: ${getPaymentMethodLabel(res.payment_method)}`}
                        >
                          <Eye size={15} />
                        </button>
                        {proofEval.isMismatch ? (
                          <span
                            className="px-2 py-0.5 rounded-md bg-danger-soft text-danger border border-danger-line text-[10px] font-bold flex items-center gap-1 cursor-help"
                            title={proofEval.description}
                          >
                            <AlertTriangle size={11} className="shrink-0" />
                            <span>Beda: Rp {proofEval.receiptAmount?.toLocaleString('id-ID')}</span>
                          </span>
                        ) : res.payment_method ? (
                          <span className="px-2 py-0.5 rounded bg-fill-1 text-[11px] text-ink-2 font-semibold">
                            {getPaymentMethodLabel(res.payment_method)}
                          </span>
                        ) : null}
                      </div>
                    );
                  })() : res.payment_method ? (
                    <span className="px-2 py-0.5 rounded bg-fill-1 text-[11px] text-ink-2 font-semibold">
                      {getPaymentMethodLabel(res.payment_method)}
                    </span>
                  ) : (
                    <span className="text-ink-3 text-xs">-</span>
                  )}
                </td>
                <td className="py-3.5 px-5 text-right">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(res);
                    }}
                    className="px-3 py-1.5 bg-surface hover:bg-accent text-ink hover:text-accent-ink border border-divider rounded-xl text-xs transition font-semibold shadow-xs cursor-pointer"
                  >
                    Manage
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  </div>
);
