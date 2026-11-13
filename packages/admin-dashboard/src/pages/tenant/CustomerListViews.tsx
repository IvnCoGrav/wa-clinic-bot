/**
 * Daftar customer versi kartu mobile dan tabel desktop.
 *
 * Presentasi murni: data, sort, dan aksi detail/riwayat/event dari halaman.
 */
import React from 'react';
import { ChevronRight, Eye, MapPin, MessageSquare, Phone, Send, Zap } from 'lucide-react';
import { StaffOwnershipBadge } from '../../components/common/StaffOwnershipBadge';
import { formatRupiah as formatCurrency } from '../../utils/money';
import { formatWib } from '../../utils/dateWib';

import { CustomerItem } from './customerTypes';

interface CustomerMobileListProps {
  customers: CustomerItem[];
  onOpenDetail: (customer: CustomerItem) => void;
}

export const CustomerMobileList: React.FC<CustomerMobileListProps> = ({ customers, onOpenDetail }) => (
  <>
  {/* Mobile Card List (< md) */}
  <div className="md:hidden divide-y divide-divider">
    {customers.map((customer) => (
      <div
        key={customer.id}
        role="button"
        tabIndex={0}
        onClick={() => onOpenDetail(customer)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpenDetail(customer);
          }
        }}
        className="p-4 space-y-2.5 bg-surface hover:bg-surface-2 active:bg-fill-1 transition cursor-pointer"
      >
        {/* Top row: Name/Phone/Location & LTV */}
        <div className="flex justify-between items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center space-x-1.5">
              <span className="font-bold text-sm text-ink truncate">
                {customer.name || 'Bunda Customer'}
              </span>
              {customer.isMql && (
                <span
                  title={`MQL (${customer.mqlBubbleCount ?? 0} Bubble)`}
                  className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold bg-success-soft text-success border border-success-line shrink-0"
                >
                  <Zap size={8} className="mr-0.5" />
                  MQL
                </span>
              )}
            </div>
            <div className="flex items-center space-x-1.5 text-xs text-ink-2 mt-0.5">
              <Phone size={12} className="text-ink-3 shrink-0" />
              <span className="font-mono">{customer.phone}</span>
            </div>
            {(customer.kecamatan || customer.kota) && (
              <div className="flex items-center space-x-1.5 text-xs text-ink-2 mt-1">
                <MapPin size={12} className="text-accent shrink-0" />
                <span className="truncate">
                  {[customer.kecamatan, customer.kota].filter(Boolean).join(', ')}
                </span>
              </div>
            )}
            <div className="mt-1">
              <StaffOwnershipBadge ownership={customer.staffOwnership} />
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            <div className="text-right">
              {customer.ltv > 0 ? (
                <>
                  <div className="font-bold text-success text-sm">
                    {formatCurrency(customer.ltv)}
                  </div>
                  <span className="text-[10px] text-success font-medium">
                    {customer.reservationCount}x transaksi
                  </span>
                </>
              ) : (
                <>
                  <div className="font-semibold text-ink-2 text-xs bg-fill-1 px-1.5 py-0.5 rounded">
                    Rp 0
                  </div>
                  <span className="text-[10px] text-ink-3">
                    Prospek
                  </span>
                </>
              )}
            </div>
            <ChevronRight size={16} className="text-ink-3" />
          </div>
        </div>

        {/* Ad Campaign (if any) */}
        {customer.adClick?.utmCampaign && (
          <div className="flex items-center space-x-1 text-[11px] text-ink-3 truncate">
            <span className="text-ink-3">Campaign:</span>
            <span className="text-ink font-medium truncate">{customer.adClick.utmCampaign}</span>
          </div>
        )}
      </div>
    ))}
  </div>
  </>
);

interface CustomerTableProps {
  customers: CustomerItem[];
  renderSortIcon: (field: string) => React.ReactNode;
  onSort: (field: string) => void;
  onOpenDetail: (customer: CustomerItem) => void;
  onOpenHistory: (customer: CustomerItem) => void;
  onOpenEvent: (customer: CustomerItem) => void;
}

export const CustomerTable: React.FC<CustomerTableProps> = ({
  customers,
  renderSortIcon,
  onSort,
  onOpenDetail,
  onOpenHistory,
  onOpenEvent,
}) => (
  <>
  {/* Desktop Table (>= md) */}
  <div className="hidden md:block overflow-x-auto">
    <table className="w-full text-left border-collapse text-xs">
      <thead>
        <tr className="border-b border-divider bg-surface-2 dark:bg-surface-2 text-ink-3 font-bold uppercase text-[10px] tracking-wider select-none">
          <th
            className="py-3 px-4 cursor-pointer hover:text-ink group transition"
            onClick={() => onSort('name')}
          >
            <div className="flex items-center space-x-1.5">
              <span>No HP / Nama</span>
              {renderSortIcon('name')}
            </div>
          </th>
          <th
            className="py-3 px-4 cursor-pointer hover:text-ink group transition"
            onClick={() => onSort('kecamatan')}
          >
            <div className="flex items-center space-x-1.5">
              <span>Wilayah (Kecamatan & Kota)</span>
              {renderSortIcon('kecamatan')}
            </div>
          </th>
          <th
            className="py-3 px-4 cursor-pointer hover:text-ink group transition"
            onClick={() => onSort('ltv')}
          >
            <div className="flex items-center space-x-1.5">
              <span>LTV (Lifetime Value)</span>
              {renderSortIcon('ltv')}
            </div>
          </th>
          <th
            className="py-3 px-4 cursor-pointer hover:text-ink group transition"
            onClick={() => onSort('created_at')}
          >
            <div className="flex items-center space-x-1.5">
              <span>Terdaftar</span>
              {renderSortIcon('created_at')}
            </div>
          </th>
          <th className="py-3 px-4 text-right">Aksi</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-divider">
        {customers.map((customer) => (
          <tr key={customer.id} className="hover:bg-surface-2 transition text-ink">
            {/* Customer Phone & Name with MQL icon */}
            <td className="py-3.5 px-4">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-full bg-accent-soft text-accent flex items-center justify-center font-bold text-xs shrink-0">
                  {(customer.name || customer.phone || 'B').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center space-x-1.5">
                    <span className="font-bold text-ink truncate">
                      {customer.name || 'Bunda Customer'}
                    </span>
                    {customer.isMql && (
                      <span
                        title={`MQL (${customer.mqlBubbleCount ?? 0} Bubble)`}
                        className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold bg-success-soft text-success border border-success-line shrink-0"
                      >
                        <Zap size={8} className="mr-0.5" />
                        MQL
                      </span>
                    )}
                  </div>
                  <div className="flex items-center space-x-1 text-[11px] text-ink-3 font-mono mt-0.5">
                    <Phone size={11} className="text-ink-3 shrink-0" />
                    <span>{customer.phone}</span>
                  </div>
                  <div className="mt-1">
                    <StaffOwnershipBadge ownership={customer.staffOwnership} />
                  </div>
                  {customer.adClick?.utmCampaign && (
                    <p className="text-[10px] text-ink-3 truncate max-w-[170px] mt-0.5">
                      Ad: {customer.adClick.utmCampaign}
                    </p>
                  )}
                </div>
              </div>
            </td>

            {/* Wilayah (Kecamatan & Kota) */}
            <td className="py-3.5 px-4">
              {customer.kecamatan || customer.kota ? (
                <div className="flex items-start space-x-1.5">
                  <MapPin size={13} className="text-accent shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <span className="font-bold text-ink block truncate text-xs">
                      {customer.kecamatan || '-'}
                    </span>
                    <span className="text-[11px] text-ink-3 block truncate">
                      {customer.kota || '-'}
                    </span>
                  </div>
                </div>
              ) : (
                <span className="text-ink-3 text-xs italic">-</span>
              )}
            </td>

            {/* LTV */}
            <td className="py-3.5 px-4">
              {customer.ltv > 0 ? (
                <div>
                  <span className="font-bold text-success bg-success-soft border border-success-line px-2 py-0.5 rounded text-[11px] inline-block">
                    {formatCurrency(customer.ltv)}
                  </span>
                  <span className="text-[10px] text-success block mt-0.5 font-medium">
                    {customer.reservationCount}x Transaksi
                  </span>
                </div>
              ) : (
                <div>
                  <span className="font-semibold text-ink-3 bg-fill-1 border border-divider px-2 py-0.5 rounded text-[10px] inline-block">
                    Rp 0
                  </span>
                  <span className="text-[10px] text-ink-3 block mt-0.5">
                    Prospek
                  </span>
                </div>
              )}
            </td>

            {/* Terdaftar */}
            <td className="py-3.5 px-4 text-ink-2 text-[11px] whitespace-nowrap">
              {customer.createdAt ? formatWib(customer.createdAt, { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}
            </td>

            {/* Actions */}
            <td className="py-3.5 px-4 text-right">
              <div className="flex items-center justify-end space-x-1.5">
                <button
                  onClick={() => onOpenDetail(customer)}
                  className="px-2.5 py-1.5 rounded-xl bg-accent-soft hover:bg-accent-soft text-accent border border-divider text-xs font-semibold transition flex items-center space-x-1 shadow-xs cursor-pointer"
                  title="Lihat Detail Lengkap Pasien"
                >
                  <Eye size={12} />
                  <span>Detail</span>
                </button>

                <button
                  onClick={() => onOpenHistory(customer)}
                  className="px-2.5 py-1.5 rounded-xl bg-info-soft hover:bg-info-line text-info border border-info-line text-xs font-semibold transition flex items-center space-x-1 shadow-xs cursor-pointer"
                  title="Buka Riwayat Chat"
                >
                  <MessageSquare size={12} />
                  <span>History</span>
                </button>

                <button
                  onClick={() => onOpenEvent(customer)}
                  className="px-2.5 py-1.5 rounded-xl bg-accent hover:bg-accent-hover text-accent-ink text-xs font-semibold transition flex items-center space-x-1 shadow-xs cursor-pointer"
                  title="Kirim Event Meta CAPI"
                >
                  <Send size={12} />
                  <span>Event</span>
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
  </>
);
