import React from 'react';
import { Phone, MapPin, Baby, Calendar, Tag, ShoppingBag, DollarSign } from 'lucide-react';

export interface CustomerProfileChild {
  name?: string | null;
  birth_date?: string | null;
  birthDate?: string | null;
  ageMonths?: number | null;
  notes?: string | null;
}

function formatChildAge(birthDate?: string | null, ageMonths?: number | null): string {
  let months: number | null = null;
  if (typeof ageMonths === 'number' && !isNaN(ageMonths)) months = ageMonths;
  else if (birthDate) {
    const d = new Date(birthDate);
    if (!isNaN(d.getTime())) {
      const now = new Date();
      months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
      if (now.getDate() < d.getDate()) months -= 1;
      months = Math.max(0, months);
    }
  }
  if (months === null) return '-';
  if (months < 12) return `${months} bln`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest === 0 ? `${years} thn` : `${years} thn ${rest} bln`;
}

export interface CustomerProfilePanelProps {
  customer: {
    id?: string;
    name?: string | null;
    phone?: string | null;
    kelurahan?: string | null;
    kecamatan?: string | null;
    kota?: string | null;
    address?: string | null;
    ltv?: number | null;
    ltv_cache?: number | null;
    reservationCount?: number | null;
    labels?: Array<{ name: string; color?: string } | string>;
    children?: CustomerProfileChild[];
    status?: string | null;
  } | null;
  reservations?: Array<{ id: string; treatment_detail?: string | null; booking_date?: string | null; status?: string | null }>;
  variant?: 'sidebar' | 'modal';
}

export const CustomerProfilePanel: React.FC<CustomerProfilePanelProps> = ({ customer, reservations = [], variant = 'sidebar' }) => {
  if (!customer) {
    return <div className="text-xs text-[#667781] p-4">Data customer tidak tersedia.</div>;
  }

  const ltv = (customer as any).ltv ?? (customer as any).ltv_cache ?? null;
  const labels: Array<{ name: string; color?: string }> = (customer.labels || []).map((l: any) =>
    typeof l === 'string' ? { name: l } : { name: l.name, color: l.color }
  );

  const containerClass = variant === 'sidebar'
    ? 'bg-white border border-[#e9edef] rounded-2xl p-4 space-y-4 shadow-xs'
    : 'bg-white border border-[#e9edef] rounded-2xl p-4 space-y-4';

  return (
    <div className={containerClass}>
      <div className="flex items-center space-x-3">
        <div className="w-10 h-10 rounded-full bg-[#008069] text-white flex items-center justify-center font-bold text-sm shrink-0">
          {(customer.name?.[0] || 'C').toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-[#111b21] truncate">{customer.name || 'Customer'}</div>
          <div className="text-xs text-[#667781] flex items-center gap-1">
            <Phone size={11} /> <span className="font-mono">{customer.phone || '-'}</span>
          </div>
        </div>
      </div>

      <div className="text-xs space-y-1 text-[#54656f]">
        <div className="flex items-start gap-1.5">
          <MapPin size={12} className="mt-0.5 shrink-0 text-[#8696a0]" />
          <span>{[customer.kelurahan, customer.kecamatan, customer.kota, customer.address].filter(Boolean).join(', ') || '-'}</span>
        </div>
        {customer.status && (
          <div className="flex items-center gap-1.5">
            <Tag size={12} className="text-[#8696a0]" /> <span>Status: {customer.status}</span>
          </div>
        )}
      </div>

      {labels.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {labels.map((l, i) => (
            <span key={`${l.name}-${i}`} className="px-2 py-0.5 rounded-full text-[10px] font-bold border" style={{ backgroundColor: `${l.color || '#e8f5f2'}20`, borderColor: l.color || '#c2e7e0', color: l.color || '#008069' }}>
              {l.name}
            </span>
          ))}
        </div>
      )}

      {(customer.children && customer.children.length > 0) && (
        <div className="space-y-2">
          <div className="text-[11px] font-bold text-[#111b21] flex items-center gap-1.5">
            <Baby size={13} className="text-[#008069]" /> Anak ({customer.children.length})
          </div>
          {customer.children.map((c, idx) => (
            <div key={idx} className="flex items-center justify-between bg-[#f8fafc] border border-[#e9edef] rounded-xl px-3 py-2">
              <div>
                <div className="text-xs font-semibold text-[#111b21]">{c.name || `Anak ${idx + 1}`}</div>
                {c.notes && <div className="text-[11px] text-[#667781]">{c.notes}</div>}
              </div>
              <div className="text-[11px] font-mono text-[#54656f]">{formatChildAge((c as any).birth_date || (c as any).birthDate, c.ageMonths)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-[#f8fafc] border border-[#e9edef] rounded-xl p-2.5 text-center">
          <div className="text-[10px] text-[#667781] font-bold uppercase flex items-center justify-center gap-1"><ShoppingBag size={11} /> Reservasi</div>
          <div className="text-sm font-bold text-[#111b21]">{customer.reservationCount ?? reservations.length ?? 0}</div>
        </div>
        <div className="bg-[#f8fafc] border border-[#e9edef] rounded-xl p-2.5 text-center">
          <div className="text-[10px] text-[#667781] font-bold uppercase flex items-center justify-center gap-1"><DollarSign size={11} /> LTV</div>
          <div className="text-sm font-bold text-[#111b21]">{ltv !== null ? `Rp ${Number(ltv).toLocaleString('id-ID')}` : '-'}</div>
        </div>
      </div>

      {reservations.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-bold text-[#111b21] flex items-center gap-1.5"><Calendar size={12} className="text-[#008069]" /> Riwayat Treatment</div>
          {reservations.slice(0, 5).map((r) => (
            <div key={r.id} className="flex items-center justify-between text-xs bg-white border border-[#e9edef] rounded-xl px-3 py-2">
              <span className="truncate text-[#111b21]">{r.treatment_detail || 'Treatment'}</span>
              <span className="text-[10px] text-[#667781] ml-2 shrink-0">{r.booking_date ? new Date(r.booking_date).toLocaleDateString('id-ID') : r.status || '-'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CustomerProfilePanel;
